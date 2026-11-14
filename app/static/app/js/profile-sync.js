// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { data } from "./core.js";
import { SyncError } from "./sync/client.js";
import { PROFILE_STREAM, profileEntry, readProfileEntry, newerRecord } from "./sync/profile-entry.js";
import { readProfile, profileValue, adoptProfile, datedProfile, onProfile } from "./profile.js";

const PUSH_DELAY = 1500;
const SESSION_KEY = "app-profile-pulled";

// Read once per start of the app, as the timetable is: later pages of the same session only send what changed.
const session = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  },
  set(value) {
    try {
      if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {}
  },
};

let link = null;
let chain = Promise.resolve();
let timer = 0;
let status = { connected: false, ready: false, error: null };

const recordOf = (profile) => (profile.at ? { at: profile.at, device: profile.by } : null);
const sameRecord = (one, other) => !!one && !!other && one.at === other.at && one.device === other.device;

export const profileSyncStatus = () => ({ ...status });

function serial(current, task) {
  const run = chain.then(async () => {
    if (link !== current) return;
    try {
      await task();
      if (link === current) status = { ...status, error: null };
    } catch (error) {
      if (link === current) status = { ...status, error: error instanceof SyncError ? error.code : "failed" };
    }
  });
  chain = run;
  return run.then(() => profileSyncStatus());
}

// Sends this device's profile when it is the newest one the account knows. Never an empty one, and never before the
// account's profiles were read.
async function pushOwn(current) {
  if (!current.ready || !profileValue()) return;
  const local = datedProfile();
  const record = recordOf(local);
  if (sameRecord(current.held, record) || (current.held && !newerRecord(record, current.held))) return;
  const entry = profileEntry({ record, profile: profileValue(local) });
  await current.client.push(PROFILE_STREAM, entry);
  if (link !== current) return;
  current.held = entry.record;
  session.set({ account: current.account, held: current.held });
}

// Reads the account's profiles, the stream keeps only the newest few, and takes the latest change if it is not this
// device's own; this device's profile goes up when it is the newer one. Nobody is ever asked.
async function pull(current) {
  const result = await current.client.pull(PROFILE_STREAM, 0);
  if (link !== current) return;
  const best = result.entries.map(({ value }) => readProfileEntry(value)).filter(Boolean)
    .reduce((top, entry) => (newerRecord(entry.record, top?.record) ? entry : top), null);
  current.ready = true;
  status = { ...status, ready: true };
  current.held = best?.record ?? null;
  session.set({ account: current.account, held: current.held });
  const local = recordOf(readProfile());
  if (best && (!local || !profileValue() || newerRecord(best.record, local))) {
    if (!sameRecord(best.record, local)) adoptProfile(best);
    return;
  }
  await pushOwn(current);
}

const pullSoon = (current) => serial(current, () => pull(current));

function pushSoon(current) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = 0;
    serial(current, () => pushOwn(current));
  }, PUSH_DELAY);
}

export function flushProfileSync() {
  const current = link;
  if (!current || !timer) return chain.then(() => profileSyncStatus());
  clearTimeout(timer);
  timer = 0;
  return serial(current, () => pushOwn(current));
}

function listen(current) {
  const shown = () => (document.visibilityState === "visible" ? pullSoon(current) : flushProfileSync());
  const online = () => pullSoon(current);
  const leave = () => flushProfileSync();
  document.addEventListener("visibilitychange", shown);
  addEventListener("online", online);
  addEventListener("pagehide", leave);
  const quiet = onProfile((profile, { own } = {}) => {
    if (own) pushSoon(current);
  });
  return () => {
    document.removeEventListener("visibilitychange", shown);
    removeEventListener("online", online);
    removeEventListener("pagehide", leave);
    quiet();
  };
}

// Called with the same client as the timetable's, on every page with an account and after signing in, verifying or
// resetting the password. Signing out disconnects and leaves the profile on this device.
export function connectProfileSync(client, { signedIn = false } = {}) {
  if (typeof client?.pull !== "function" || typeof client?.push !== "function") throw new TypeError("connectProfileSync needs a sync client");
  close();
  if (!data?.device) return Promise.resolve(profileSyncStatus());
  const account = typeof client.account === "string" ? client.account : "";
  const current = { client, account, held: null, ready: false };
  current.off = listen(current);
  link = current;
  status = { connected: true, ready: false, error: null };
  const known = session.get();
  if (!signedIn && known?.account === account) {
    current.ready = true;
    current.held = known.held && Number.isSafeInteger(known.held.at) ? known.held : null;
    status = { ...status, ready: true };
    return serial(current, () => pushOwn(current));
  }
  return pullSoon(current);
}

function close() {
  if (link) link.off();
  link = null;
  clearTimeout(timer);
  timer = 0;
  status = { connected: false, ready: false, error: null };
}

// Signing out: the profile stays on this device, only the link to the account goes.
export function disconnectProfileSync() {
  close();
  session.set(null);
}
