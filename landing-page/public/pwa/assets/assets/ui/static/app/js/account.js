// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { data, accountStore, syncStore } from "./core.js";
import { connectSync, disconnectSync, syncConnected, syncStatus } from "./sync.js";
import { connectProfileSync, disconnectProfileSync } from "./profile-sync.js";
import { createSyncClient } from "./sync/client.js";
import { createKeyStore } from "./sync/key-store.js";
import { AuthError, appFetch, createAuthClient } from "./account/auth-client.js";
import { checkPassword as judgePassword } from "./account/password-check.js";

export { AuthError };

const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

function serviceOf(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.origin === value.replace(/\/$/, "") ? url.origin : null;
  } catch {
    return null;
  }
}

const service = serviceOf(data?.accountService);
let saved = null;
let entryKey = null;
let linked = null;
let keyStore = null;
let auth = null;
let started = null;
let checking = false;
let offline = false;
let retrying = false;
let chooser = null;
let deleting = null;
const choosers = [];

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// What this device keeps of its account, device-only like the sync state: the session token with the account it belongs
// to and the service that gave it, whether an account was ever signed in here, the choice to go on without one, whether
// the last session ended on its own, and whether the screens already offered an account here by themselves.
function readSaved() {
  const value = accountStore.get();
  const stored = isObject(value) ? value : {};
  const account = stored.account;
  const valid = stored.service === service && typeof stored.token === "string" && TOKEN.test(stored.token)
    && isObject(account) && typeof account.id === "string" && account.id !== "" && typeof account.email === "string";
  return {
    token: valid ? stored.token : null,
    account: valid ? { id: account.id, email: account.email } : null,
    known: valid || stored.known === true,
    guest: !valid && stored.guest === true,
    ended: !valid && stored.ended === true,
    offered: stored.offered === true,
  };
}

function keep(next) {
  saved = next;
  const value = {
    ...(next.token ? { service, token: next.token, account: next.account } : {}),
    ...(next.known ? { known: true } : {}),
    ...(next.guest ? { guest: true } : {}),
    ...(next.ended ? { ended: true } : {}),
    ...(next.offered ? { offered: true } : {}),
  };
  accountStore.set(Object.keys(value).length ? value : null);
}

export function accountState() {
  const signedIn = Boolean(saved?.token);
  return {
    available: Boolean(service),
    ready: saved !== null,
    signedIn,
    email: saved?.account?.email ?? null,
    needsPassword: signedIn && !entryKey,
    guest: Boolean(saved?.guest),
    knownDevice: Boolean(saved?.known),
    sessionEnded: Boolean(saved?.ended),
    offered: Boolean(saved?.offered),
    checking,
    offline,
    sync: syncStatus(),
  };
}

function announce(change) {
  dispatchEvent(new CustomEvent("app:account", { detail: { change, ...accountState() } }));
}

const owned = (record, account) => (record?.key && record.account === account ? { key: record.key, account } : null);

// The question which plan stays after signing in waits for the screens that ask it.
function choosePlan() {
  if (chooser) return chooser();
  return new Promise((resolve) => choosers.push(resolve)).then((ask) => ask());
}

export function onPlanQuestion(ask) {
  chooser = typeof ask === "function" ? ask : null;
  if (chooser) choosers.splice(0).forEach((resolve) => resolve(chooser));
}

function connect(signedIn, ask = false) {
  if (!saved?.token || !entryKey || entryKey.account !== saved.account.id) return;
  if (!signedIn && linked === entryKey && syncConnected()) return;
  linked = entryKey;
  const fetchImpl = (url, options) => request(url, options);
  const client = createSyncClient({ key: entryKey.key, account: entryKey.account, baseUrl: service, fetchImpl });
  connectSync(client, { signedIn, ask, choose: choosePlan });
  connectProfileSync(client, { signedIn });
}

function unlink() {
  linked = null;
  if (syncConnected() || syncStore.get()) disconnectSync();
  disconnectProfileSync();
}

// Signing out on this device keeps every plan and all data here; only the session, the key and the sync state go.
function forget({ ended, known = true, offered = saved.offered }) {
  entryKey = null;
  offline = false;
  checking = false;
  keep({ token: null, account: null, known, guest: false, ended, offered });
  const removed = keyStore.remove();
  unlink();
  return removed;
}

// While the account is being deleted, a 401 from the sync is the deletion itself, not a session that ended.
function sessionEnded(token) {
  if (!saved?.token || saved.token !== token || deleting === token) return;
  forget({ ended: true });
  announce("session-ended");
}

const request = appFetch({ token: () => saved?.token ?? null, onSessionEnded: sessionEnded });

function retryWhenBack() {
  if (retrying) return;
  retrying = true;
  const again = () => {
    if (document.visibilityState === "hidden") return;
    retrying = false;
    removeEventListener("online", again);
    document.removeEventListener("visibilitychange", again);
    check();
  };
  addEventListener("online", again);
  document.addEventListener("visibilitychange", again);
}

// An offline start or a failing service never signs out: the device goes on with what it keeps and asks again once it
// is back online or shown again. Only an answer that the session is gone ends it.
async function check() {
  const token = saved?.token;
  if (!token) return;
  checking = true;
  let session = null;
  try {
    session = await auth.session();
  } catch (error) {
    if (saved.token !== token) return;
    checking = false;
    if (error.status === 401) return;
    offline = true;
    connect(false);
    retryWhenBack();
    announce("offline");
    return;
  }
  if (saved.token !== token) return;
  checking = false;
  offline = false;
  const account = isObject(session?.account) && typeof session.account.id === "string" ? session.account : saved.account;
  if (account.id !== saved.account.id || account.email !== saved.account.email) {
    keep({ ...saved, account: { id: account.id, email: typeof account.email === "string" ? account.email : saved.account.email } });
    entryKey = owned(entryKey, account.id) || owned(await keyStore.get(), account.id);
    if (saved.token !== token) return;
  }
  connect(false);
  announce("checked");
}

async function begin() {
  keyStore = createKeyStore();
  auth = createAuthClient({ baseUrl: service, fetchImpl: request });
  saved = readSaved();
  addEventListener("app:sync", (event) => {
    if (!saved?.token) return;
    if (event.detail?.error === "no_session") sessionEnded(saved.token);
    else announce("sync");
  });
  if (!saved.token) {
    if (syncStore.get()) unlink();
    announce("start");
    return accountState();
  }
  entryKey = owned(await keyStore.get(), saved.account.id);
  checking = true;
  announce("start");
  await check();
  return accountState();
}

// Starts the account core of this page. main.js calls it only when the backend names an account service; without one
// nothing of it runs.
export function startAccount() {
  if (!service) return Promise.resolve(accountState());
  started ??= begin();
  return started;
}

async function ready() {
  if (!service) throw new AuthError("unavailable");
  await startAccount();
}

async function opened({ account, token, key }, { ask = false } = {}) {
  const previous = saved.token;
  entryKey = key ? { key, account: account.id } : null;
  if (entryKey) await keyStore.set(entryKey);
  else await keyStore.remove();
  offline = false;
  checking = false;
  keep({ token, account: { id: account.id, email: account.email }, known: true, guest: false, ended: false, offered: saved.offered });
  if (previous && previous !== token) auth.endSession(previous).catch(() => {});
  if (!entryKey) unlink();
  announce("signed-in");
  connect(true, ask);
  return { account: { ...account } };
}

export async function signUp(email, password) {
  await ready();
  return auth.signUp(email, password);
}

export async function verifyEmail(email, code) {
  await ready();
  return opened(await auth.verifyEmail(email, code));
}

export async function resendCode(email) {
  await ready();
  return auth.resendCode(email);
}

export async function signIn(email, password) {
  await ready();
  return opened(await auth.signIn(email, password), { ask: true });
}

// The session is still valid but the key is gone from this device (cleared site data, or the phone's page server moved
// to another port, which is another origin). The password brings the key back and a new session replaces the old one.
export async function unlock(password) {
  await ready();
  if (!saved.token) throw new AuthError("no_session");
  await opened(await auth.signIn(saved.account.email, password));
  return accountState();
}

export async function signOut() {
  await ready();
  const token = saved.token;
  await forget({ ended: false });
  announce("signed-out");
  if (token) await auth.endSession(token).catch(() => {});
  return accountState();
}

// Deletes the account and everything of it in the cloud. This device keeps every plan and all its data and forgets the
// account as if it had never been signed in here, without offering one by itself again; the other devices find their
// session gone at their next call.
export async function deleteAccount(password) {
  await ready();
  const token = saved.token;
  if (!token) throw new AuthError("no_session");
  deleting = token;
  try {
    await auth.deleteAccount(saved.account.email, String(password ?? ""));
  } catch (error) {
    deleting = null;
    if (error.status === 401) sessionEnded(token);
    throw error;
  }
  deleting = null;
  if (saved.token === token) {
    await forget({ ended: false, known: false, offered: true });
    announce("deleted");
  }
  return accountState();
}

export async function requestPasswordReset(email) {
  await ready();
  return auth.requestPasswordReset(email);
}

export async function resetPassword(email, code, newPassword) {
  await ready();
  return opened(await auth.resetPassword(email, code, newPassword));
}

export const checkPassword = (password, email = "") => judgePassword(String(password ?? ""), String(email ?? ""));

export async function continueWithoutAccount() {
  await ready();
  if (!saved.token && !saved.guest) {
    keep({ ...saved, guest: true, ended: false });
    announce("guest");
  }
  return accountState();
}

export async function resetGuest() {
  await ready();
  if (saved.guest) {
    keep({ ...saved, guest: false });
    announce("guest");
  }
  return accountState();
}

export async function dismissSessionEnded() {
  await ready();
  if (saved.ended) {
    keep({ ...saved, ended: false });
    announce("dismissed");
  }
  return accountState();
}

// The screens open themselves at most once on a device; after that only the user opens them.
export async function markOffered() {
  await ready();
  if (!saved.offered) {
    keep({ ...saved, offered: true });
    announce("offered");
  }
  return accountState();
}
