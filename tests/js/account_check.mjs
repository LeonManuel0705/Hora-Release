// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The account core of the app pages against an account service kept here in memory with the semantics of the real one:
// a session token for clients that mark themselves as the app, bearer sessions, 401 when a session is gone, prelogin
// parameters, codes, password resets that end every session and empty the entries. Every page load gets its own module
// graph (the loader below adds the page number to every import), while the page store, the session storage and the
// IndexedDB of a device live on between loads like in a browser.

import assert from "node:assert/strict";
import { register } from "node:module";
import { randomBytes } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const INITS = ["initShell", "initHome", "initTasks", "initReminders", "initPomodoro", "initPlanShare", "initFeedback", "initSetup", "initGoogleSync"];
const HOOKS = `
let port = null;
export function initialize(data) {
  port = data.port;
}
const STUB = ${JSON.stringify(`data:text/javascript,${encodeURIComponent(INITS.map((name) => `export const ${name} = () => {};`).join(""))}`)};
export async function resolve(specifier, context, next) {
  const parent = context.parentURL?.startsWith("file:") ? new URL(context.parentURL) : null;
  const page = parent?.searchParams.get("page");
  if (page && parent.pathname.endsWith("/main.js") && specifier.startsWith("./") && !["./core.js", "./account.js"].includes(specifier)) {
    return { url: STUB, shortCircuit: true };
  }
  const result = await next(specifier, context);
  if (!page || !result.url.startsWith("file:")) return result;
  const url = new URL(result.url);
  if (url.search) return result;
  url.searchParams.set("page", page);
  port.postMessage(url.href);
  return { ...result, url: url.href };
}`;
const loaded = new Set();
const { port1, port2 } = new MessageChannel();
port1.on("message", (url) => loaded.add(url));
port1.unref();
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`, { data: { port: port2 }, transferList: [port2] });
const loadedOn = (page) => [...loaded].filter((url) => new URL(url).searchParams.get("page") === String(page)).map((url) => new URL(url).pathname.split("/js/")[1]);

const here = dirname(fileURLToPath(import.meta.url));
const script = (name) => pathToFileURL(resolve(here, "../../app/static/app/js", name)).href;

const SERVICE = "http://accounts.test";
const ACCOUNT = "app-account";
const SYNC = "app-timetable-sync";
const PASSWORD = "Stadtpark-im-Herbst-27";
const NEW_PASSWORD = "Lindenblüte-im-Stadtpark-7";
const BLOCKS = [{ n: 1, start: "08:00", end: "09:30" }, { n: 2, start: "09:50", end: "11:20" }];
const week = (days = {}) => ({ 1: [], 2: [], 3: [], 4: [], 5: [], ...days });
const SCHOOL = { subjects: {}, courses: {}, timetable: { A: week(), B: week() }, abReference: "2026-01-12" };
const SUBJECTS = {
  items: {
    "s-mathe": { custom: true, name: "Mathe", short: "Ma", hue: "slate", type: "GK" },
    "s-kunst": { custom: true, name: "Kunst", short: "Ku", hue: "rose", type: "GK" },
  },
  removed: [],
};
const MATHE = { "A:1:1": { subject: "s-mathe", room: "R1" }, "B:1:1": { subject: "s-mathe", room: "R1" } };
const KUNST = { "A:2:2": { subject: "s-kunst", room: "K1" }, "B:2:2": { subject: "s-kunst", room: "K1" } };

// Made with the account demo's own client: the same password and salt must give the same auth key, and the data key
// must open an entry the demo sealed. The password starts with a full-width S, which NFKC turns into a plain one.
const VECTOR = {
  password: "Ｓtadtpark im Herbst 27",
  salt: "SG9yYS1LQVQtVmVjLTAwMQ==",
  authKey: "0Os/k2s4taYgG8XPAQSM3t0D16TW3x5mxs9tGkrWsrc=",
  account: "acc-vector",
  sealed: "ARPaovSaRvh+ewbTDkGl51KxjIJtpiAO3qEGUeRs3wd1n4WWdAnkZGIj1Tx5hm+1WVHNgqVkI3j+UVNd0rOocCGjxNlCYLkvxipImv2/N87qzShaSYsS6la4TrF45fubkZOrbu1e2LvW51Zsmq/yKMhIZ/AGOwyYnPsVcejSj6vmecrA54x6ppVCNXc7iqunVb3IpAtTqhbe47T+Y8fFS//wb1BBhsDjfJ4VN5n5nnpXzBltPdOJsA7ZkaC3Ath6qTLS0fOrHPH44OV3VwDPnc0+D4Xk6rrZWqb/Yec3HyqrVZ64rxP1p5JcK/scgKzeLF6jKjWdkABgeczBPNRYGu9dU0SYjYdMfvgqRoCs/iUbeIP0rZLyWnWaomPdpVldeW5Z+tWOqdq9Xsv5/eX5JlNeolY04FsnS//Q6FgqmEYY/XWRJxjT1AGyTCsvycDecwyuA5ftSN2m+r5WFySRZ/pe9w4Z2MqiF6VNDkM6NUjIGaE0Y4gYqjnBdaWxmOcS/bA1pWzABzx97xwwTvCpVuXLAYVM608FeVM99yray1V1rmVW9kqdcT2Fqht/CmmGaHkBLiM5OL5CuTMUFMaYkg4KU7dJZ35NQiaYAYHeqk1SQjGCh0kmxZhOBifVRUsPp2nDHIDCNWP7zC+SSO4tgverbHkQ91A7xcDe2zV87BhwSiUWsbpzGA/Ce6QGPjrkh3onGbMEDZhyicY1DTe9hUPajJ7iRONmctuWRMDfvk85kE9uhUxp6SpYyVfkXikJmpeFogZ97ngXN2/xSNN9A8nZ0d1PMGIE76fPuVKtDv5KjOIuseTBd6Hha4JbhHh5Tma9dk7kvICpQraZDtXXKWi5kRf0xXEjSWcQELUzcDD4EZWuCXh1yNlwfIdkKHDQmWz9qwlQvQMQb6gJjXa3OxZhHlxuxMKLmfqUozDOG6YDMF7hVLfWWoOTdyXxxbQseq8jsonF2H4l+9X1OeD57ZS7F2mycM4iWiYufXfF4GT/h/QWleigFEfGldp7fOb0xQxLaMo8UW3Zs8pjp+4DpGxi0knPJvOPsy6UQOl7lMn6mdYS4OS3x5IitTgWZ2DbvHApkMIzODZ39zhY7i5zom8pc9vgDeVwH6fi21HZIf91CJE8ng2Ve0isJ9u+eNa+cPgwFaVz7X6BVabTWPd2EndEmcVZNRSx1v1fZal42G3vFsHEgKOy6ulWVgo+yRZM09v4TDRGraVab6cLg7OkPwg/+2EIvp+mTJuL4fLKjeIHggkutbcjkbL35iOs7uvhEqENkYqm/DU+mSu4jPaJXLU7cBliI2yUTxjn7Z3AZCJTLrrrgxvfdpmJsaqnofAWUFExWCTNjfEK5z6uGAc/76D43XC9hqxzv6j98MvmQuJX5DZ33U2hh8gr8Aq+",
};

const tick = () => new Promise((done) => setTimeout(done, 0));

// The account service side.

const reply = (status, payload) => new Response(status === 204 ? null : JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
const header = (headers, name) => Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null;
const randomToken = () => randomBytes(32).toString("base64url");

class AccountService {
  constructor() {
    this.accounts = new Map();
    this.codes = new Map();
    this.sessions = new Map();
    this.streams = new Map();
    this.requests = [];
    this.offline = false;
    this.count = 0;
  }

  code(email, purpose = "signup") {
    return this.codes.get(`${email}:${purpose}`);
  }

  endSessions(email) {
    const id = this.accounts.get(email).id;
    for (const [token, owner] of this.sessions) if (owner === id) this.sessions.delete(token);
  }

  calls(path) {
    return this.requests.filter((item) => item.path === path);
  }

  issue(email, purpose) {
    const code = String(100000 + ((this.count += 1) % 900000));
    this.codes.set(`${email}:${purpose}`, code);
    return { email, resendAfter: 60, expiresIn: 600 };
  }

  open(account, app) {
    const token = randomToken();
    this.sessions.set(token, account.id);
    const shown = { id: account.id, email: account.email, createdAt: "2026-11-13T08:00:00.000Z", verifiedAt: "2026-11-13T08:01:00.000Z" };
    return reply(200, app ? { account: shown, token } : { account: shown });
  }

  async fetch(url, options = {}) {
    if (this.offline) throw new TypeError("fetch failed");
    const address = new URL(url);
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : {};
    const bearer = /^Bearer (.+)$/.exec(header(options.headers, "Authorization") || "")?.[1] ?? null;
    const app = header(options.headers, "X-Account-Client") === "app";
    this.requests.push({ method, path: address.pathname, bearer, app, credentials: options.credentials });
    const account = this.accounts.get(body.email);
    const session = bearer && this.sessions.has(bearer) ? [...this.accounts.values()].find((item) => item.id === this.sessions.get(bearer)) : null;
    const route = `${method} ${address.pathname}`;
    if (route === "POST /api/prelogin") return reply(200, account ? { salt: account.salt, iterations: account.iterations } : { salt: VECTOR.salt, iterations: 600000 });
    if (route === "POST /api/signup") {
      if (account?.verified) return reply(409, { error: "email_taken" });
      this.accounts.set(body.email, { id: account?.id || `acc-${this.accounts.size + 1}`, email: body.email, salt: body.salt, iterations: body.iterations, verifier: body.authKey, verified: false });
      return reply(200, this.issue(body.email, "signup"));
    }
    if (route === "POST /api/verify") {
      if (!account || this.code(body.email) !== body.code) return reply(400, { error: "invalid_code" });
      this.codes.delete(`${body.email}:signup`);
      account.verified = true;
      return this.open(account, app);
    }
    if (route === "POST /api/resend") return reply(429, { error: "rate_limited", retryAfter: 42 });
    if (route === "POST /api/login") {
      if (!account || account.verifier !== body.authKey) return reply(401, { error: "invalid_credentials" });
      if (!account.verified) return reply(403, { error: "email_not_verified", ...this.issue(body.email, "signup") });
      return this.open(account, app);
    }
    if (route === "POST /api/reset/request") return reply(200, account?.verified ? this.issue(body.email, "reset") : { email: body.email, resendAfter: 60, expiresIn: 600 });
    if (route === "POST /api/reset/confirm") {
      if (!account || this.code(body.email, "reset") !== body.code) return reply(400, { error: "invalid_code" });
      Object.assign(account, { salt: body.salt, iterations: body.iterations, verifier: body.authKey });
      this.endSessions(body.email);
      this.stream(account.id).entries = [];
      return this.open(account, app);
    }
    if (route === "POST /api/logout") {
      if (bearer) this.sessions.delete(bearer);
      return reply(200, {});
    }
    if (!session) return reply(401, { error: "no_session" });
    if (route === "GET /api/session") return reply(200, { account: { id: session.id, email: session.email } });
    const stream = this.stream(session.id);
    if (route === "POST /api/entries") {
      stream.last += 1;
      stream.entries.push({ seq: stream.last, data: body.data });
      stream.entries = stream.entries.filter((entry) => entry.seq > stream.last - 20);
      return reply(201, { seq: stream.last });
    }
    if (route === "GET /api/entries") {
      const rest = stream.entries.filter((entry) => entry.seq > Number(address.searchParams.get("after") || 0));
      return reply(200, { entries: rest.slice(0, 10), latest: stream.last, more: rest.length > 10 });
    }
    return reply(404, { error: "not_found" });
  }

  stream(id) {
    if (!this.streams.has(id)) this.streams.set(id, { last: 0, entries: [] });
    return this.streams.get(id);
  }
}

// The device side.

function element() {
  const children = new Map();
  return {
    dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {}, addEventListener() {}, removeEventListener() {},
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    },
    querySelectorAll: () => [], append() {}, remove() {}, contains: () => false,
  };
}

function fakeIndexedDB(device) {
  const later = (transaction, action) => {
    const request = {};
    setTimeout(() => {
      request.result = action();
      transaction.oncomplete?.();
    });
    return request;
  };
  return {
    open(name) {
      device.opened += 1;
      const request = {};
      setTimeout(() => {
        const fresh = !device.databases.has(name);
        if (fresh) device.databases.set(name, new Map());
        const stores = device.databases.get(name);
        request.result = {
          createObjectStore: (store) => stores.set(store, new Map()),
          transaction(store) {
            const transaction = {};
            const area = stores.get(store);
            transaction.objectStore = () => ({
              get: (key) => later(transaction, () => area.get(key)),
              put: (value, key) => later(transaction, () => void area.set(key, value)),
              delete: (key) => later(transaction, () => void area.delete(key)),
            });
            return transaction;
          },
        };
        if (fresh) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

let pages = 0;

class Device {
  constructor(service, { address = SERVICE, id = "a".repeat(32) } = {}) {
    this.service = service;
    this.address = address;
    this.id = id;
    this.store = {};
    this.session = new Map();
    this.local = new Map();
    this.databases = new Map();
    this.opened = 0;
    this.writes = [];
    this.other = 0;
    this.page = null;
  }

  // A new page of the app, or with app: true a new start of the app, which empties the session storage.
  async load({ app = false, main = false } = {}) {
    if (this.page) await settle(this.page);
    if (app) this.session.clear();
    const number = (pages += 1);
    const device = this;
    const appData = { user: { state: "BB", grade: 12 }, blocks: BLOCKS, ...SCHOOL, changes: [], tasks: [], deadlines: [], events: [], holidays: [], weather: { hours: [] }, status: {}, device: this.id };
    if (this.address) appData.accountService = this.address;
    const nodes = { appData: { textContent: JSON.stringify(appData) }, appStore: { textContent: JSON.stringify(this.store) } };
    const counts = { reloads: 0, refreshes: 0 };
    const events = new EventTarget();
    globalThis.addEventListener = events.addEventListener.bind(events);
    globalThis.removeEventListener = events.removeEventListener.bind(events);
    globalThis.dispatchEvent = events.dispatchEvent.bind(events);
    const doc = new EventTarget();
    Object.assign(doc, {
      documentElement: { dataset: { brand: "App", motion: "minimal" }, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, style: { setProperty() {} } },
      head: element(), body: element(), activeElement: null, hidden: false, visibilityState: "visible",
      getElementById: (id) => nodes[id] || null, querySelector: () => null, querySelectorAll: () => [], createElement: () => element(),
    });
    globalThis.document = doc;
    globalThis.location = { search: "", hash: "", pathname: "/hub", href: "http://127.0.0.1:5050/hub", reload: () => (counts.reloads += 1) };
    globalThis.self = globalThis.window = globalThis;
    Object.defineProperty(globalThis, "navigator", { value: { platform: "MacIntel", userAgent: "node", maxTouchPoints: 0, onLine: true }, configurable: true });
    globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
    globalThis.localStorage = { getItem: (key) => this.local.get(key) ?? null, setItem: (key, value) => this.local.set(key, String(value)), removeItem: (key) => this.local.delete(key) };
    globalThis.sessionStorage = { getItem: (key) => this.session.get(key) ?? null, setItem: (key, value) => this.session.set(key, String(value)), removeItem: (key) => this.session.delete(key) };
    globalThis.indexedDB = fakeIndexedDB(this);
    globalThis.fetch = async (url, options = {}) => {
      const text = String(url);
      if (text.startsWith("/api/ui/store/")) {
        const key = decodeURIComponent(text.slice("/api/ui/store/".length));
        if (options.method === "DELETE") delete device.store[key];
        else device.store[key] = JSON.parse(options.body);
        device.writes.push(key);
        return reply(200, { success: true });
      }
      if (device.address && text.startsWith(device.address)) return device.service.fetch(text, options);
      device.other += 1;
      return reply(200, {});
    };
    addEventListener("app:plan-refreshed", () => (counts.refreshes += 1));
    const announced = [];
    addEventListener("app:account", (event) => announced.push(event.detail));
    const load = (name) => import(`${script(name)}?page=${number}${main ? "&main=1" : ""}`);
    if (main) {
      await load("main.js");
      await new Promise((done) => setTimeout(done, 50));
      this.loadedByMain = loadedOn(number);
    }
    const [core, sync, account, refresh] = [await load("core.js"), await load("sync.js"), await load("account.js"), await load("plan-refresh.js")];
    this.page = { number, core, sync, account, refresh, counts, announced, document: doc };
    return this.page;
  }

  storedAccount() {
    return this.store[ACCOUNT] ?? null;
  }

  async edit(lessons) {
    const { storage } = this.page.core;
    storage.set("app-subjects", SUBJECTS);
    storage.set("app-timetable-edits", lessons);
    await settle(this.page);
  }

  lessons() {
    return this.page.core.storage.get("app-timetable-edits");
  }

  async show() {
    const doc = this.page.document;
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await settle(this.page);
  }

  async online() {
    dispatchEvent(new Event("online"));
    await settle(this.page);
  }
}

async function settle(page) {
  for (let turn = 0; turn < 5; turn += 1) await tick();
  await page.sync.flushSync();
  for (let turn = 0; turn < 5; turn += 1) await tick();
  await page.core.storage.settled();
}

async function signedUp(device, email = "lina@example.org") {
  const { account } = device.page;
  await account.signUp(email, PASSWORD);
  await account.verifyEmail(email, device.service.code(email));
  await settle(device.page);
}

async function rejects(promise, code) {
  try {
    await promise;
  } catch (error) {
    assert.equal(error.code, code);
    assert.equal(error.name, "AuthError");
    return error;
  }
  assert.fail(`expected ${code}`);
}

const CASES = {};

CASES["without an address nothing of the account core loads, calls or stores anything"] = async () => {
  const service = new AccountService();
  const device = new Device(service, { address: null });
  device.store[ACCOUNT] = { service: SERVICE, token: "t".repeat(43), account: { id: "acc-1", email: "lina@example.org" }, known: true };
  const page = await device.load({ main: true });
  await settle(page);
  assert.deepEqual([service.requests, device.other, device.opened, device.writes], [[], 0, 0, []], "no request, no IndexedDB, no write");
  assert.ok(device.loadedByMain.includes("core.js"), "the loader saw the page");
  assert.deepEqual(device.loadedByMain.filter((name) => name.startsWith("account") || name === "sync/key-store.js"), [], "the account modules never load");
  assert.equal(page.account.accountState().available, false);
  assert.deepEqual(await page.account.startAccount(), page.account.accountState());
  await rejects(page.account.signIn("lina@example.org", PASSWORD), "unavailable");
  await rejects(page.account.continueWithoutAccount(), "unavailable");
  assert.deepEqual([service.requests, device.opened, device.writes], [[], 0, []], "still nothing after the calls");

  const configured = new Device(service);
  configured.store = { ...device.store };
  const started = await configured.load({ main: true });
  await settle(started);
  assert.deepEqual(service.requests.map((item) => item.path), ["/api/session"], "with an address the page starts the account core");
  assert.deepEqual(configured.loadedByMain.filter((name) => name.startsWith("account")).sort(), ["account.js", "account/auth-client.js", "account/password-check.js"]);
};

CASES["a device with an address but no account calls nothing and stores nothing"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  const page = await device.load();
  const state = await page.account.startAccount();
  assert.deepEqual(
    [state.available, state.ready, state.signedIn, state.email, state.needsPassword, state.guest, state.knownDevice, state.sync.connected],
    [true, true, false, null, false, false, false, false],
  );
  await settle(page);
  assert.deepEqual([service.requests, device.writes, device.opened], [[], [], 0], "not even the key store opens");
  assert.deepEqual(page.announced.map((item) => item.change), ["start"]);
};

CASES["sign up, verify and sign in keep the token device-only, send it as a bearer and connect the sync"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  const page = await device.load();
  await device.edit(MATHE);
  await rejects(page.account.signUp("lina@example.org", "kurz"), "weak_password");
  assert.deepEqual(service.requests, [], "a weak password never leaves the device");
  await page.account.signUp(" Lina@Example.org ", PASSWORD);
  await rejects(page.account.verifyEmail("lina@example.org", "000000"), "invalid_code");
  const verified = await page.account.verifyEmail("lina@example.org", service.code("lina@example.org"));
  await settle(page);
  assert.equal(verified.account.email, "lina@example.org");
  assert.ok(!("token" in verified), "the screens never see the token");
  const state = page.account.accountState();
  assert.deepEqual([state.signedIn, state.email, state.needsPassword, state.knownDevice, state.sync.connected, state.sync.ready], [true, "lina@example.org", false, true, true, true]);
  const stored = device.storedAccount();
  assert.deepEqual(Object.keys(stored).sort(), ["account", "known", "service", "token"]);
  assert.deepEqual([stored.service, stored.account.email, stored.token === [...service.sessions.keys()][0]], [SERVICE, "lina@example.org", true]);
  assert.equal(service.streams.get(stored.account.id).entries.length, 1, "the plan went up after the first pull");
  for (const call of service.requests) {
    assert.equal(call.app, true, `${call.path} marks the app`);
    assert.equal(call.credentials, "omit", `${call.path} sends no cookie`);
  }
  assert.deepEqual([...new Set(service.requests.filter((call) => call.bearer).map((call) => call.path))].sort(), ["/api/entries"], "only session calls carry the token");
  assert.ok(service.requests.filter((call) => call.path === "/api/entries").every((call) => call.bearer === stored.token));
  assert.ok(!page.core.storage.keys().includes(ACCOUNT), "storage.keys() leaves the account out");
  assert.deepEqual(page.announced.map((item) => item.change).slice(0, 2), ["start", "signed-in"]);
};

CASES["a reload with a stored token checks the session and connects without signing in again"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  await device.load();
  await device.edit(MATHE);
  await signedUp(device);
  const before = service.requests.length;
  const page = await device.load();
  const state = await page.account.startAccount();
  await settle(page);
  assert.deepEqual([state.signedIn, state.needsPassword, state.offline, state.sync.connected], [true, false, false, true]);
  assert.deepEqual(service.requests.slice(before).map((call) => `${call.method} ${call.path}`), ["GET /api/session"], "a new page in the same session only asks for the session");
  const restarted = await device.load({ app: true });
  await restarted.account.startAccount();
  await settle(restarted);
  assert.deepEqual(service.calls("/api/session").length, 2);
  assert.equal(restarted.sync.syncStatus().ready, true, "a new start pulls once");
  assert.deepEqual(device.lessons(), MATHE);
};

CASES["an offline start keeps the account and checks again when the device is back, without a timer"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  await device.load();
  await device.edit(MATHE);
  await signedUp(device);
  const token = device.storedAccount().token;
  service.offline = true;
  const page = await device.load({ app: true });
  await page.account.startAccount();
  await settle(page);
  const state = page.account.accountState();
  assert.deepEqual([state.signedIn, state.offline, state.needsPassword, state.sync.connected, state.sync.error], [true, true, false, true, "network"]);
  assert.equal(device.storedAccount().token, token, "offline never signs out");
  await new Promise((done) => setTimeout(done, 300));
  service.offline = false;
  assert.equal(service.calls("/api/session").length, 0, "nothing reached the service while offline, and nothing polls");
  await device.online();
  const back = page.account.accountState();
  assert.deepEqual([back.signedIn, back.offline, back.sync.ready, back.sync.error], [true, false, true, null]);
  assert.equal(service.calls("/api/session").length, 1, "one check once it is back");

  service.offline = true;
  const hidden = await device.load({ app: true });
  await hidden.account.startAccount();
  await settle(hidden);
  service.offline = false;
  await device.show();
  assert.deepEqual([hidden.account.accountState().offline, service.calls("/api/session").length], [false, 2], "or once it is shown again");
  await device.show();
  assert.equal(service.calls("/api/session").length, 2, "a check that went through is not repeated");
  assert.deepEqual(device.lessons(), MATHE);
};

CASES["a 401 signs out on this device, keeps the plan and tells the screens"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  const page = await device.load();
  await device.edit(MATHE);
  await signedUp(device);
  service.endSessions("lina@example.org");
  await device.show();
  const state = page.account.accountState();
  assert.deepEqual([state.signedIn, state.email, state.sessionEnded, state.knownDevice, state.sync.connected], [false, null, true, true, false]);
  assert.equal(page.announced.at(-1).change, "session-ended");
  assert.deepEqual(device.storedAccount(), { known: true, ended: true }, "token and account are gone");
  assert.equal(device.store[SYNC], undefined, "and the sync state");
  assert.deepEqual([...device.databases.get("hora-sync").get("keys").keys()], [], "and the key");
  assert.deepEqual(device.lessons(), MATHE, "the plan stays");

  const reloaded = await device.load();
  const after = await reloaded.account.startAccount();
  assert.deepEqual([after.signedIn, after.sessionEnded, after.knownDevice], [false, true, true], "the next page still knows why");
  await reloaded.account.dismissSessionEnded();
  assert.deepEqual(device.storedAccount(), { known: true });

  const other = new Device(service, { id: "b".repeat(32) });
  await other.load();
  await other.page.account.signIn("lina@example.org", PASSWORD);
  await settle(other.page);
  service.endSessions("lina@example.org");
  const start = await other.load({ app: true });
  const ended = await start.account.startAccount();
  assert.deepEqual([ended.signedIn, ended.sessionEnded], [false, true], "a 401 to the session check at the start as well");
};

CASES["with the key gone the device needs the password, and only the right one brings it back"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  await device.load();
  await device.edit(MATHE);
  await signedUp(device);
  const token = device.storedAccount().token;
  device.databases.clear();
  const page = await device.load({ app: true });
  const state = await page.account.startAccount();
  await settle(page);
  assert.deepEqual([state.signedIn, state.needsPassword, state.sync.connected], [true, true, false], "the session is valid, the key is not here");
  await rejects(page.account.unlock("Falsches-Passwort-123"), "invalid_credentials");
  const wrong = page.account.accountState();
  assert.deepEqual([wrong.signedIn, wrong.needsPassword, device.storedAccount().token], [true, true, token], "a wrong password is no sign out");
  const unlocked = await page.account.unlock(PASSWORD);
  await settle(page);
  assert.deepEqual([unlocked.signedIn, unlocked.needsPassword, page.sync.syncStatus().connected, page.sync.syncStatus().ready], [true, false, true, true]);
  assert.notEqual(device.storedAccount().token, token, "a new session replaces the old one");
  assert.equal(service.sessions.has(token), false, "which ends on the service");
  assert.equal(service.sessions.has(device.storedAccount().token), true);
  assert.deepEqual(device.lessons(), MATHE);
};

CASES["guest and known device are kept on the device like the token"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  let page = await device.load();
  await page.account.continueWithoutAccount();
  assert.deepEqual([page.account.accountState().guest, device.storedAccount()], [true, { guest: true }]);
  page = await device.load();
  assert.equal((await page.account.startAccount()).guest, true);
  await page.account.resetGuest();
  await settle(page);
  assert.deepEqual([page.account.accountState().guest, device.storedAccount()], [false, null], "its reset leaves nothing behind");
  await page.account.continueWithoutAccount();
  await signedUp(device);
  assert.deepEqual([page.account.accountState().guest, page.account.accountState().knownDevice], [false, true], "an account ends the guest mode");
  await page.account.signOut();
  page = await device.load();
  const state = await page.account.startAccount();
  assert.deepEqual([state.signedIn, state.guest, state.knownDevice], [false, false, true], "after signing out the device still knows an account");
  await page.account.continueWithoutAccount();
  assert.deepEqual(device.storedAccount(), { known: true, guest: true });
  assert.deepEqual(service.requests.filter((call) => call.path === "/api/session").length, 0, "no session check without a token");
};

CASES["signing out keeps the plan, forgets the key first and ends the session"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  const page = await device.load();
  await device.edit(MATHE);
  await signedUp(device);
  const token = device.storedAccount().token;
  const state = await page.account.signOut();
  await settle(page);
  assert.deepEqual([state.signedIn, state.knownDevice, state.sync.connected], [false, true, false]);
  assert.deepEqual(device.storedAccount(), { known: true });
  assert.equal(device.store[SYNC], undefined);
  assert.deepEqual([...device.databases.get("hora-sync").get("keys").keys()], []);
  assert.equal(service.sessions.has(token), false);
  assert.equal(service.calls("/api/logout")[0].bearer, token);
  assert.deepEqual(device.lessons(), MATHE, "the plan stays on the device");
  assert.equal(page.announced.at(-1).change, "signed-out");

  await page.account.signIn("lina@example.org", PASSWORD);
  service.offline = true;
  const offline = await page.account.signOut();
  assert.deepEqual([offline.signedIn, device.storedAccount()], [false, { known: true }], "offline the device signs out all the same");
};

CASES["a second device takes over the plan in place, and a password reset seals it anew"] = async () => {
  const service = new AccountService();
  const first = new Device(service);
  await first.load();
  await first.edit(KUNST);
  await signedUp(first);
  const second = new Device(service, { id: "b".repeat(32) });
  const page = await second.load();
  const drawn = [];
  page.refresh.onPlanRefresh(() => drawn.push(page.core.data.timetable.A[2].map((lesson) => page.core.data.subjects[lesson.subject].name)));
  await rejects(page.account.signIn("lina@example.org", "Falsches-Passwort-123"), "invalid_credentials");
  await page.account.signIn("LINA@example.org", PASSWORD);
  await settle(page);
  assert.deepEqual(second.lessons(), KUNST, "the plan of the first device");
  assert.deepEqual([drawn, page.counts.refreshes, page.counts.reloads], [[["Kunst"]], 1, 0], "shown in place, without a reload");

  await page.account.requestPasswordReset("lina@example.org");
  await page.account.resetPassword("lina@example.org", service.code("lina@example.org", "reset"), NEW_PASSWORD);
  await settle(page);
  const id = second.storedAccount().account.id;
  assert.equal(service.streams.get(id).entries.length, 1, "the plan went up again under the new key");
  assert.equal(page.account.accountState().signedIn, true);
  await first.load();
  const ended = await first.page.account.startAccount();
  assert.deepEqual([ended.signedIn, ended.sessionEnded], [false, true], "the reset ended the session of the first device");
  await first.page.account.signIn("lina@example.org", NEW_PASSWORD);
  await settle(first.page);
  assert.deepEqual([first.page.sync.syncStatus().unreadable, first.lessons()], [0, KUNST], "and with the new password it opens the plan");
};

CASES["error codes reach the screens unchanged, and a code screen gets the key of the sign in before it"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  const page = await device.load();
  await page.account.signUp("ole@example.org", PASSWORD);
  const resent = await rejects(page.account.resendCode("ole@example.org"), "rate_limited");
  assert.equal(resent.retryAfter, 42);
  await rejects(page.account.signUp("ole@example.org", "ole-ole-ole-ole"), "weak_password");
  const reloaded = await device.load();
  await rejects(reloaded.account.signIn("ole@example.org", PASSWORD), "email_not_verified");
  await reloaded.account.verifyEmail("ole@example.org", service.code("ole@example.org"));
  assert.equal(reloaded.account.accountState().needsPassword, false, "the sign in that asked for the code proved the password");
  await rejects(reloaded.account.signUp("ole@example.org", PASSWORD), "email_taken");
  await rejects(reloaded.account.signIn("niemand@example.org", PASSWORD), "invalid_credentials");
  service.offline = true;
  await rejects(reloaded.account.signIn("ole@example.org", PASSWORD), "network");
  service.offline = false;

  const fresh = await device.load();
  await fresh.account.signUp("mia@example.org", PASSWORD);
  const code = await device.load();
  await code.account.verifyEmail("mia@example.org", service.code("mia@example.org"));
  assert.equal(code.account.accountState().needsPassword, true, "a code screen after a reload has no key and asks for the password");
  assert.deepEqual(code.account.checkPassword("kurz"), { score: 0, acceptable: false, problems: ["too_short"] });
};

CASES["a token is only ever sent to the service that gave it"] = async () => {
  const service = new AccountService();
  const device = new Device(service, { address: "http://other.test" });
  device.store[ACCOUNT] = { service: SERVICE, token: "t".repeat(43), account: { id: "acc-1", email: "lina@example.org" }, known: true };
  const page = await device.load();
  const state = await page.account.startAccount();
  assert.deepEqual([state.signedIn, state.knownDevice], [false, true]);
  assert.deepEqual(service.requests, []);
};

CASES["the token and the account never reach a backup, a restore or the page's key list"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  const page = await device.load();
  await device.edit(MATHE);
  await signedUp(device);
  const { storage } = page.core;
  const stored = device.storedAccount();
  assert.ok(!storage.keys().includes(ACCOUNT));
  storage.set(ACCOUNT, { token: "x".repeat(43) });
  storage.remove(ACCOUNT);
  storage.keys().filter((key) => /^app-/.test(key)).forEach((key) => storage.remove(key));
  await settle(page);
  assert.deepEqual(device.storedAccount(), stored, "writing, restoring or wiping values cannot touch it");
  const backup = JSON.stringify(Object.fromEntries(storage.keys().map((key) => [key, storage.get(key)])));
  assert.ok(!backup.includes(stored.token) && !backup.includes(stored.account.id));
};

CASES["the derivation is the demo's byte for byte"] = async () => {
  const service = new AccountService();
  const device = new Device(service, { address: null });
  await device.load();
  const { createAuthClient, appFetch } = await import(`${script("account/auth-client.js")}?page=${device.page.number}`);
  const { createSyncClient } = await import(`${script("sync/client.js")}?page=${device.page.number}`);
  const bodies = [];
  const fetchImpl = async (url, options) => {
    bodies.push({ url, body: JSON.parse(options.body || "{}") });
    if (url.endsWith("/api/prelogin")) return reply(200, { salt: VECTOR.salt, iterations: 600000 });
    if (url.includes("/api/entries")) return reply(200, { entries: [{ seq: 1, data: VECTOR.sealed }], latest: 1, more: false });
    return reply(200, { account: { id: VECTOR.account, email: "kat@example.org" }, token: "t".repeat(43) });
  };
  const auth = createAuthClient({ baseUrl: SERVICE, fetchImpl: appFetch({ fetchImpl }) });
  const { key } = await auth.signIn("kat@example.org", VECTOR.password);
  assert.equal(bodies.find((item) => item.url.endsWith("/api/login")).body.authKey, VECTOR.authKey);
  const opened = await createSyncClient({ key, account: VECTOR.account, baseUrl: SERVICE, fetchImpl }).pull("timetable");
  assert.deepEqual(opened, { entries: [{ seq: 1, value: { v: 1, probe: "Mathe in R 204" } }], unreadable: [], latest: 1 });
  assert.equal(key.extractable, false);
};

CASES["the plan refreshes in place, and a part in use waits until it is free"] = async () => {
  const device = new Device(new AccountService(), { address: null });
  const page = await device.load();
  const { onPlanRefresh, refreshPlan, planViewsFree } = page.refresh;
  const drawn = [];
  let editing = true;
  onPlanRefresh(() => drawn.push("board"));
  onPlanRefresh(() => drawn.push("editor"), () => editing);
  refreshPlan();
  assert.deepEqual(drawn, ["board"], "the part in use waits");
  page.document.dispatchEvent(new Event("close"));
  await tick();
  assert.deepEqual(drawn, ["board"], "and keeps waiting while it is in use");
  editing = false;
  page.document.dispatchEvent(new Event("focusout"));
  await tick();
  assert.deepEqual(drawn, ["board", "editor"], "it is drawn once it is free");
  page.document.dispatchEvent(new Event("close"));
  await tick();
  assert.equal(drawn.length, 2, "and only once");
  editing = true;
  refreshPlan();
  editing = false;
  planViewsFree();
  await tick();
  assert.deepEqual(drawn, ["board", "editor", "board", "editor"], "a part that closes on its own says so");
  assert.equal(page.counts.reloads, 0);
};

const only = process.argv[2];
let failed = 0;
for (const name of Object.keys(CASES)) {
  if (only && name !== only) continue;
  try {
    await CASES[name]();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n${error?.stack || error}`);
  }
}
process.exit(failed ? 1 : 0);
