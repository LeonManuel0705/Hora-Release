// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The account screens around the scene: when it opens by itself, the card in the settings, the notices, deleting
// everything while signed in, and that nothing of it loads without an account service. Every page load gets its own
// module graph (the loader adds the page number to every import); the scene itself and the toasts are stand-ins that
// record what they were asked to show, while the account core and the sync run for real against an account service
// kept here in memory.

import assert from "node:assert/strict";
import { register } from "node:module";
import { randomBytes } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const INITS = ["initShell", "initProfile", "initHome", "initTasks", "initReminders", "initPomodoro", "initPlanShare", "initFeedback", "initSetup", "initGoogleSync"];
const STAND_INS = {
  main: `data:text/javascript,${encodeURIComponent(INITS.map((name) => `export const ${name} = () => {};`).join(""))}`,
  scene: `data:text/javascript,${encodeURIComponent("export function openScene(options) { return globalThis.__scene(options); } export const sceneBack = () => false; export function prepare() { globalThis.__prepared += 1; }")}`,
  shell: `data:text/javascript,${encodeURIComponent("export function toast(text, options = {}) { return globalThis.__toast(text, options); }")}`,
};
const HOOKS = `
let port = null;
export function initialize(data) {
  port = data.port;
}
const STAND_INS = ${JSON.stringify(STAND_INS)};
export async function resolve(specifier, context, next) {
  const parent = context.parentURL?.startsWith("file:") ? new URL(context.parentURL) : null;
  const page = parent?.searchParams.get("page");
  if (page && parent.pathname.endsWith("/main.js") && specifier.startsWith("./") && !["./core.js", "./account.js", "./account-ui.js"].includes(specifier)) {
    return { url: STAND_INS.main, shortCircuit: true };
  }
  if (page && specifier === "./account-screens.js") {
    port.postMessage(new URL(specifier, parent).href + "?page=" + page);
    return { url: STAND_INS.scene, shortCircuit: true };
  }
  if (page && specifier === "./shell.js" && /\\/account-(ui|card)\\.js$/.test(parent.pathname)) return { url: STAND_INS.shell, shortCircuit: true };
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
const PASSWORD = "Stadtpark-im-Herbst-27";
const BLOCKS = [{ n: 1, start: "08:00", end: "09:30" }, { n: 2, start: "09:50", end: "11:20" }];
const week = (days = {}) => ({ 1: [], 2: [], 3: [], 4: [], 5: [], ...days });
const SCHOOL = { subjects: {}, courses: {}, timetable: { A: week(), B: week() }, abReference: "2026-01-12" };
const PLANNED = {
  subjects: { "s-mathe": { name: "Mathe", short: "Ma", hue: "slate", type: "GK" } },
  courses: {},
  timetable: { A: week({ 1: [{ block: 1, subject: "s-mathe", room: "R1" }] }), B: week({ 1: [{ block: 1, subject: "s-mathe", room: "R1" }] }) },
  abReference: "2026-01-12",
};
const SUBJECTS = { items: { "s-kunst": { custom: true, name: "Kunst", short: "Ku", hue: "rose", type: "GK" } }, removed: [] };
const KUNST = { "A:2:2": { subject: "s-kunst", room: "K1" }, "B:2:2": { subject: "s-kunst", room: "K1" } };

const tick = () => new Promise((done) => setTimeout(done, 0));
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

const reply = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
const header = (headers, name) => Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null;

class AccountService {
  constructor() {
    this.accounts = new Map();
    this.codes = new Map();
    this.sessions = new Map();
    this.streams = new Map();
    this.requests = [];
    this.count = 0;
  }

  code(email) {
    return this.codes.get(email);
  }

  calls(path) {
    return this.requests.filter((item) => item.path === path);
  }

  stream(id) {
    if (!this.streams.has(id)) this.streams.set(id, { last: 0, entries: [] });
    return this.streams.get(id);
  }

  open(account) {
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, account.id);
    return reply(200, { account: { id: account.id, email: account.email }, token });
  }

  async fetch(url, options = {}) {
    const address = new URL(url);
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : {};
    const bearer = /^Bearer (.+)$/.exec(header(options.headers, "Authorization") || "")?.[1] ?? null;
    this.requests.push({ method, path: address.pathname, bearer });
    const account = this.accounts.get(body.email);
    const session = bearer && this.sessions.has(bearer) ? [...this.accounts.values()].find((item) => item.id === this.sessions.get(bearer)) : null;
    const route = `${method} ${address.pathname}`;
    if (route === "POST /api/prelogin") return reply(200, { salt: account?.salt ?? "SG9yYS1LQVQtVmVjLTAwMQ==", iterations: 600000 });
    if (route === "POST /api/signup") {
      this.accounts.set(body.email, { id: `acc-${this.accounts.size + 1}`, email: body.email, salt: body.salt, verifier: body.authKey });
      this.codes.set(body.email, String(100000 + (this.count += 1)));
      return reply(200, { email: body.email, resendAfter: 60, expiresIn: 600 });
    }
    if (route === "POST /api/verify") return account && this.code(body.email) === body.code ? this.open(account) : reply(400, { error: "invalid_code" });
    if (route === "POST /api/login") return account?.verifier === body.authKey ? this.open(account) : reply(401, { error: "invalid_credentials" });
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
      return reply(201, { seq: stream.last });
    }
    if (route === "GET /api/entries") {
      const rest = stream.entries.filter((entry) => entry.seq > Number(address.searchParams.get("after") || 0));
      return reply(200, { entries: rest.slice(0, 10), latest: stream.last, more: rest.length > 10 });
    }
    return reply(404, { error: "not_found" });
  }
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

// The page around the account screens: what is open on it, which observers watch it, which toasts it shows.
class Surface {
  constructor() {
    this.open = new Set();
    this.classes = new Set();
    this.observers = new Set();
    this.toasts = [];
    this.scenes = [];
    this.host = { children: [] };
  }

  set(kind, on) {
    if (on) this.open.add(kind);
    else this.open.delete(kind);
    if (kind === "setup-open" || kind === "tour-on") {
      if (on) this.classes.add(kind);
      else this.classes.delete(kind);
    }
    this.observers.forEach((observer) => observer.fire());
  }
}

let pages = 0;

class Device {
  constructor(service, { address = SERVICE, id = "a".repeat(32), school = SCHOOL, shell = "" } = {}) {
    Object.assign(this, { service, address, id, school, shell });
    this.store = {};
    this.session = new Map();
    this.databases = new Map();
    this.page = null;
  }

  async load({ app = false, main = false, quiet = true, surface = new Surface(), settled = null } = {}) {
    if (app) this.session.clear();
    const number = (pages += 1);
    const device = this;
    const appData = { user: { state: "BB", grade: 12 }, blocks: BLOCKS, ...this.school, changes: [], tasks: [], deadlines: [], events: [], holidays: [], weather: { hours: [] }, status: {}, device: this.id };
    if (this.address) appData.accountService = this.address;
    const nodes = { appData: { textContent: JSON.stringify(appData) }, appStore: { textContent: JSON.stringify(this.store) } };
    const events = new EventTarget();
    globalThis.addEventListener = events.addEventListener.bind(events);
    globalThis.removeEventListener = events.removeEventListener.bind(events);
    globalThis.dispatchEvent = events.dispatchEvent.bind(events);
    const doc = new EventTarget();
    const rootClasses = surface.classes;
    const dataset = { brand: "App", motion: "minimal" };
    if (this.shell) dataset.shell = this.shell;
    Object.assign(doc, {
      documentElement: { dataset, classList: { toggle() {}, add: (name) => rootClasses.add(name), remove: (name) => rootClasses.delete(name), contains: (name) => rootClasses.has(name) }, style: { setProperty() {} } },
      head: { append() {} },
      body: { dataset: { tourAuto: "0" }, append() {} },
      activeElement: null,
      hidden: false,
      visibilityState: "visible",
      readyState: "complete",
      getElementById: (id) => nodes[id] || null,
      querySelector: (selector) => (selector.includes("dialog[open]") && surface.open.has("dialog") ? {} : null),
      querySelectorAll: () => [],
      createElement: () => ({ dataset: {}, setAttribute() {}, addEventListener() {}, append() {}, querySelector: () => null }),
    });
    globalThis.document = doc;
    globalThis.location = { search: "", hash: "", pathname: "/hub/settings", href: "http://127.0.0.1:5050/hub/settings", reload() {} };
    globalThis.self = globalThis.window = globalThis;
    delete globalThis.AppAccount;
    delete globalThis.flutter_inappwebview;
    Object.defineProperty(globalThis, "navigator", { value: { platform: "MacIntel", userAgent: "node", maxTouchPoints: 0, onLine: true }, configurable: true });
    globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
    globalThis.sessionStorage = { getItem: (key) => this.session.get(key) ?? null, setItem: (key, value) => this.session.set(key, String(value)), removeItem: (key) => this.session.delete(key) };
    globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    globalThis.indexedDB = fakeIndexedDB(this);
    globalThis.MutationObserver = class {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {
        surface.observers.add(this);
      }
      disconnect() {
        surface.observers.delete(this);
      }
      fire() {
        this.callback([]);
      }
    };
    globalThis.__prepared = 0;
    globalThis.__toast = (text, options) => {
      const node = { text, options, isConnected: true, parentElement: surface.host };
      surface.toasts.push(node);
      return { node, dismiss() {} };
    };
    globalThis.__scene = (options) => {
      const entry = { options };
      entry.done = new Promise((resolve) => (entry.close = (result = {}) => resolve(result)));
      surface.scenes.push(entry);
      return entry.done;
    };
    if (settled) globalThis.flutter_inappwebview = { callHandler: (name) => (name === "startSettled" ? settled : null) };
    globalThis.fetch = async (url, options = {}) => {
      const text = String(url);
      if (text.startsWith("/api/ui/store/")) {
        const key = decodeURIComponent(text.slice("/api/ui/store/".length));
        if (options.method === "DELETE") delete device.store[key];
        else device.store[key] = JSON.parse(options.body);
        return reply(200, { success: true });
      }
      if (device.address && text.startsWith(device.address)) return device.service.fetch(text, options);
      return reply(200, {});
    };
    const load = (name) => import(`${script(name)}?page=${number}`);
    if (main) {
      await load("main.js");
      await wait(80);
      this.page = { number, core: await load("core.js"), surface, loaded: () => loadedOn(number) };
      return this.page;
    }
    const [core, account, ui, card] = [await load("core.js"), await load("account.js"), await load("account-ui.js"), await load("account-card.js")];
    this.page = { number, core, account, ui, card, surface, loaded: () => loadedOn(number) };
    if (ui && quiet) {
      await ui.initAccountUi();
      await settle();
    }
    return this.page;
  }

  storedAccount() {
    return this.store[ACCOUNT] ?? null;
  }
}

async function settle(ms = 520) {
  for (let turn = 0; turn < 5; turn += 1) await tick();
  await wait(ms);
  for (let turn = 0; turn < 5; turn += 1) await tick();
}

async function signedUp(device, email = "lina@example.org") {
  const { account } = device.page;
  await account.signUp(email, PASSWORD);
  await account.verifyEmail(email, device.service.code(email));
  await settle(50);
}

const CASES = {};

CASES["the rule: at most once, only with a plan and before any choice, on signing in for a known device"] = async () => {
  const device = new Device(new AccountService(), { address: null });
  const { ui } = await device.load({ quiet: false });
  const base = { available: true, ready: true, signedIn: false, guest: false, offered: false, sessionEnded: false, knownDevice: false };
  const rows = [
    ["new device without a plan", base, false, false],
    ["after the setup, or a device already set up", base, true, true],
    ["signed in", { ...base, signedIn: true }, true, false],
    ["going on without an account", { ...base, guest: true }, true, false],
    ["offered once already", { ...base, offered: true }, true, false],
    ["the session just ended, the notice speaks", { ...base, sessionEnded: true }, true, false],
    ["no account service", { ...base, available: false }, true, false],
    ["not started yet", { ...base, ready: false }, true, false],
  ];
  for (const [name, state, planned, expected] of rows) assert.equal(ui.shouldOffer(state, planned), expected, name);
  assert.equal(ui.offerScreen(base), "create", "a new device opens on creating an account");
  assert.equal(ui.offerScreen({ ...base, knownDevice: true }), "signin", "a known device on signing in");
};

CASES["a new device does not open the scene by itself, and nothing goes to the service"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  const page = await device.load();
  assert.deepEqual(page.surface.scenes, []);
  assert.deepEqual(service.requests, []);
  assert.equal(page.core.root.dataset.account, "out", "the quiet way in shows for a device without an account");
};

CASES["a device with a plan and no choice opens once on creating an account, and never again by itself"] = async () => {
  const service = new AccountService();
  const device = new Device(service, { school: PLANNED });
  const page = await device.load();
  assert.deepEqual(page.surface.scenes.map((entry) => entry.options.screen), ["create"]);
  assert.equal(page.account.accountState().offered, true);
  assert.deepEqual(device.storedAccount(), { offered: true }, "kept on the device");
  page.surface.scenes[0].close({});
  const again = await device.load({ app: true });
  assert.deepEqual(again.surface.scenes, [], "not at the next start");
  await again.account.continueWithoutAccount();
  assert.deepEqual(device.storedAccount(), { guest: true, offered: true });
};

CASES["the first plan brings the offer once whichever way it came: the setup, a link or QR code, a file, a backup"] = async () => {
  for (const origin of ["edit", "share", "import"]) {
    const device = new Device(new AccountService(), { school: PLANNED });
    device.store["app-timetable-meta"] = { at: Date.now(), origin, device: device.id, seen: Date.now() };
    const page = await device.load();
    assert.deepEqual(page.surface.scenes.map((entry) => entry.options.screen), ["create"], `a plan from ${origin}`);
    page.surface.scenes[0].close({});
    assert.deepEqual((await device.load({ app: true })).surface.scenes, [], `and only once after ${origin}`);
  }
};

const firstPlan = (core) => core.planChange("import", () => {
  core.storage.set("app-subjects", SUBJECTS);
  core.storage.set("app-timetable-edits", KUNST);
  core.applySchoolEdits();
});

CASES["a first plan that comes while the page stays, as from a restored backup, brings the offer at the next quiet moment"] = async () => {
  const device = new Device(new AccountService());
  const surface = new Surface();
  const page = await device.load({ surface });
  assert.deepEqual(surface.scenes, [], "nothing without a plan");
  surface.set("dialog", true);
  firstPlan(page.core);
  assert.equal(page.core.hasPlan(), true);
  await settle();
  assert.deepEqual(surface.scenes, [], "not over the dialog the plan came from");
  assert.equal(device.storedAccount(), null, "and nothing marked yet");
  surface.set("dialog", false);
  await settle();
  assert.deepEqual(surface.scenes.map((entry) => entry.options.screen), ["create"], "once the page is quiet");
  assert.deepEqual(device.storedAccount(), { offered: true });
  surface.scenes[0].close({});
  await settle(50);
  page.core.planChange("edit", () => page.core.storage.set("app-timetable-edits", { ...KUNST, "A:3:1": { subject: "s-kunst", room: "K2" } }));
  await settle();
  assert.equal(surface.scenes.length, 1, "never a second time");
};

CASES["a page on its way to the next one leaves the offer to that page and marks nothing"] = async () => {
  const device = new Device(new AccountService(), { school: PLANNED });
  const surface = new Surface();
  surface.set("dialog", true);
  await device.load({ surface });
  dispatchEvent(new Event("beforeunload"));
  surface.set("dialog", false);
  await settle();
  assert.deepEqual(surface.scenes, [], "no scene on a page that is leaving");
  assert.equal(device.storedAccount(), null, "not marked, so the next page offers it");
  assert.deepEqual((await device.load({ app: true })).surface.scenes.map((entry) => entry.options.screen), ["create"]);
};

CASES["a known device opens once on signing in, a guest never"] = async () => {
  const service = new AccountService();
  const known = new Device(service, { school: PLANNED });
  known.store[ACCOUNT] = { known: true };
  const page = await known.load();
  assert.deepEqual(page.surface.scenes.map((entry) => entry.options.screen), ["signin"]);

  const guest = new Device(service, { school: PLANNED });
  guest.store[ACCOUNT] = { guest: true };
  assert.deepEqual((await guest.load()).surface.scenes, []);
};

CASES["it waits until a dialog, the setup and the tour are closed"] = async () => {
  const service = new AccountService();
  const device = new Device(service, { school: PLANNED });
  const surface = new Surface();
  surface.set("dialog", true);
  surface.set("setup-open", true);
  const page = await device.load({ surface });
  assert.deepEqual(surface.scenes, [], "not on top of a dialog");
  surface.set("dialog", false);
  await settle();
  assert.deepEqual(surface.scenes, [], "nor while the setup is open");
  surface.set("tour-on", true);
  surface.set("setup-open", false);
  await settle();
  assert.deepEqual(surface.scenes, [], "nor during the tour");
  surface.set("tour-on", false);
  await settle();
  assert.deepEqual(surface.scenes.map((entry) => entry.options.screen), ["create"], "once everything is closed");
  assert.equal(page.account.accountState().offered, true);
};

CASES["on the phone it waits until the shell's own start questions are over"] = async () => {
  const service = new AccountService();
  const device = new Device(service, { school: PLANNED, shell: "android" });
  let done;
  const settled = new Promise((resolve) => (done = resolve));
  const page = await device.load({ settled });
  assert.deepEqual(page.surface.scenes, [], "the first steps or the week question are still open");
  assert.equal(page.account.accountState().offered, false);
  done(true);
  await settle();
  assert.deepEqual(page.surface.scenes.map((entry) => entry.options.screen), ["create"]);
};

CASES["a page opens the scene from a link, and the shell can open it and step back"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  const page = await device.load();
  assert.equal(typeof globalThis.AppAccount.open, "function");
  assert.equal(globalThis.AppAccount.back(), false, "nothing to step back while it is closed");
  const opened = globalThis.AppAccount.open("signin");
  await settle(20);
  assert.deepEqual(page.surface.scenes.map((entry) => entry.options.screen), ["signin"]);
  page.surface.scenes[0].close({});
  assert.equal(await opened, true, "the shell learns when it closed");
  assert.equal(page.account.accountState().offered, false, "opened by the user, not by itself");
};

CASES["the card: signed out, guest, signed in with its sync states, the password and the unreadable note"] = async () => {
  const device = new Device(new AccountService(), { address: null });
  const { card } = await device.load({ quiet: false });
  const row = ({ id, label, desc = "", control = "", cls = "", after = "" }) => `<div class="set-row ${cls}" id="${id}"><p class="set-row-label">${label}</p><p class="set-row-desc">${desc}</p>${after}<div class="set-row-control">${control}</div></div>`;
  const text = (html) => html.replace(/<svg[^>]*>.*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const opens = (html) => [...html.matchAll(/data-account-open="(\w+)"/g)].map((match) => match[1]);
  const now = Date.now();
  const clock = (stamp) => {
    const when = new Date(stamp);
    return `${when.getHours()}:${String(when.getMinutes()).padStart(2, "0")}`;
  };
  const base = { available: true, ready: true, signedIn: false, email: null, needsPassword: false, guest: false, offline: false, checking: false, sync: { connected: false, ready: false, busy: false, error: null, unreadable: 0, syncedAt: null } };

  const out = card.accountCardHtml(base, row);
  assert.match(text(out), /^App-Konto Nicht angemeldet Mit einem Konto ist dein Stundenplan auf all deinen Geräten gleich\./);
  assert.deepEqual(opens(out), ["signin", "create"]);
  assert.match(out, /btn btn-quiet[^>]*data-account-open="signin">Anmelden</);
  assert.match(out, /btn btn-primary[^>]*data-account-open="create">Konto erstellen</);
  assert.equal(card.accountCardHtml({ ...base, guest: true }, row), out, "a guest sees the same");

  const signedIn = { ...base, signedIn: true, email: "lina@example.org", sync: { ...base.sync, connected: true, ready: true, syncedAt: now } };
  const fine = card.accountCardHtml(signedIn, row);
  assert.equal(text(fine), `App-Konto Angemeldet Angemeldet als lina@example.org. Stundenplan abgeglichen um ${clock(now)} Uhr. Abmelden`);
  assert.match(fine, /id="accountSignOut">Abmelden</);
  assert.deepEqual(opens(fine), []);
  assert.match(text(card.accountCardHtml({ ...signedIn, sync: { ...signedIn.sync, busy: true } }, row)), /Gleicht ab .*gerade abgeglichen/);
  assert.match(text(card.accountCardHtml({ ...signedIn, offline: true }, row)), new RegExp(`Offline .*Gerade keine Verbindung, abgeglichen um ${clock(now)} Uhr\\. Sobald du wieder online bist, gleicht App ab\\.`));
  assert.match(text(card.accountCardHtml({ ...signedIn, sync: { ...signedIn.sync, error: "network" } }, row)), /Offline/);
  assert.match(text(card.accountCardHtml({ ...signedIn, sync: { ...signedIn.sync, error: "server" } }, row)), new RegExp(`Nicht abgeglichen .*Der letzte Abgleich hat nicht geklappt\\. Zuletzt abgeglichen um ${clock(now)} Uhr\\.`));
  assert.match(text(card.accountCardHtml({ ...signedIn, sync: { ...signedIn.sync, error: "rate_limited" } }, row)), /zu viele Abgleiche/);

  const locked = card.accountCardHtml({ ...signedIn, needsPassword: true, sync: { ...base.sync } }, row);
  assert.match(text(locked), /Passwort fehlt .*Gib dein Passwort ein, dann gleicht App wieder ab\./);
  assert.deepEqual(opens(locked), ["unlock"]);
  assert.match(locked, /btn btn-primary[^>]*data-account-open="unlock">Passwort eingeben</);

  const unreadable = card.accountCardHtml({ ...signedIn, sync: { ...signedIn.sync, unreadable: 2 } }, row);
  assert.match(text(unreadable), /Ältere Stände ließen sich nicht öffnen, weil dein Passwort auf einem anderen Gerät geändert wurde\./);
  assert.doesNotMatch(fine, /Ältere Stände/);
  assert.match(card.accountCardHtml({ ...signedIn, email: "<b>x</b>@example.org" }, row), /&lt;b&gt;x&lt;\/b&gt;@example\.org/, "the address is escaped");
};

CASES["the line above the accounts names a signed in account first"] = async () => {
  const device = new Device(new AccountService(), { address: null });
  const { card } = await device.load({ quiet: false });
  const rows = [
    ["Nichts verbunden", "App-Konto verbunden"],
    ["IServ und Google verbunden", "App-Konto, IServ und Google verbunden"],
    ["IServ verbunden", "App-Konto und IServ verbunden"],
    ["IServ verbunden, Google nicht", "App-Konto und IServ verbunden, Google nicht"],
    ["Google verbunden, IServ nicht", "App-Konto und Google verbunden, IServ nicht"],
    ["IServ verbunden, Google abgelaufen", "App-Konto und IServ verbunden, Google abgelaufen"],
    ["Google abgelaufen, IServ nicht", "App-Konto verbunden, Google abgelaufen, IServ nicht"],
  ];
  for (const [line, expected] of rows) assert.equal(card.withAccount(line), expected, line);
};

CASES["once the page is loaded and idle the scene and its styles are fetched, without opening it"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  const page = await device.load();
  assert.ok(!page.loaded().includes("account-screens.js"), "not during the start");
  await wait(1700);
  assert.ok(page.loaded().includes("account-screens.js"), "fetched in idle time");
  assert.ok(globalThis.__prepared >= 1, "with its stylesheets");
  assert.deepEqual(page.surface.scenes, [], "and nothing opened");
  assert.deepEqual(service.requests, [], "nothing went to the service");
};

CASES["going on without an account first lets Luna say what it means, and only Verstanden chooses it"] = async () => {
  const device = new Device(new AccountService(), { address: null });
  await device.load({ quiet: false });
  const guest = (await import(`${script("account-screens/screens/guest.js")}?page=${device.page.number}`)).default;
  const { html, focus } = guest.render({}, {});
  const words = html.replace(/<svg[^>]*>.*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.equal(words, "Alles klar! Dann bleibt dein Stundenplan nur auf diesem Gerät. Auf deinen anderen Geräten siehst du ihn nicht. Ein Konto kannst du später in den Einstellungen anlegen. Verstanden Doch ein Konto erstellen");
  assert.match(html, /btn btn-primary btn-block" type="button" data-understood>Verstanden/);
  assert.match(html, /class="link" type="button" data-go="create">Doch ein Konto erstellen</);
  assert.equal(focus, "[data-understood]");
  assert.equal(guest.back, "create", "the back button returns to creating an account");
  assert.equal(guest.panel().guest, undefined, "no second way out on this screen");
  const calls = [];
  const button = { attributes: {}, listeners: {}, getAttribute(name) { return this.attributes[name] ?? null; }, setAttribute(name, value) { this.attributes[name] = value; }, addEventListener(type, fn) { this.listeners[type] = fn; } };
  const root = { querySelector: () => button };
  const ctx = {
    mascot: { hold: (kind) => calls.push(`hold ${kind}`), wave: () => calls.push("wave") },
    auth: { continueWithoutAccount: async () => calls.push("guest") },
    profile: { wanted: () => false },
    close: (result) => calls.push(`close ${JSON.stringify(result)}`),
    go: (id) => calls.push(`go ${id}`),
  };
  const cleanup = guest.mount(root, ctx);
  assert.deepEqual(calls, ["hold null"], "nothing is chosen by showing it");
  await wait(420);
  assert.deepEqual(calls, ["hold null", "wave"], "Luna reacts");
  await button.listeners.click();
  await button.listeners.click();
  assert.deepEqual(calls.slice(2), ["guest", 'close {"guest":true}'], "Verstanden chooses once and closes");
  cleanup();

  calls.length = 0;
  button.attributes = {};
  ctx.profile.wanted = () => true;
  const again = guest.mount(root, ctx);
  await button.listeners.click();
  assert.deepEqual(calls.slice(-2), ["guest", "go name"], "without a first name Luna asks for it before closing");
  again();
};

// A form of the scene as the name question mounts it: the input, the form with its submit and the quiet skip.
function nameForm() {
  const listen = () => ({ listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
  const input = { ...listen(), value: "" };
  const form = { ...listen(), querySelector: () => input };
  const skip = listen();
  const root = { querySelector: (selector) => (selector === "[data-name-form]" ? form : selector === "[data-skip]" ? skip : null) };
  return { root, input, submit: () => form.listeners.submit({ preventDefault() {} }), skip: () => skip.listeners.click() };
}

const words = (html) => html.replace(/<svg[^>]*>.*?<\/svg>/gs, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

CASES["the scene asks for the first name after creating an account and after the guest choice, with a quiet Überspringen"] = async () => {
  const device = new Device(new AccountService(), { address: null });
  await device.load({ quiet: false });
  const load = async (name) => (await import(`${script(`account-screens/screens/${name}.js`)}?page=${device.page.number}`)).default;
  const [success, name, index] = [await load("success"), await load("name"), await import(`${script("account-screens/screens/index.js")}?page=${device.page.number}`)];
  assert.equal(index.SCREENS.name, name, "the name screen is part of the scene");

  const asking = success.render({ session: { email: "lina@example.org" }, profile: { name: () => null } }, {});
  assert.equal(words(asking.html), "Dein Konto ist bereit. Angemeldet als lina@example.org . Wie soll ich dich nennen? Weiter Überspringen");
  assert.match(asking.html, /placeholder="Vorname"/);
  assert.match(asking.html, /autocomplete="given-name"/);
  assert.equal(asking.focus, "#given-name");
  const named = success.render({ session: { email: "lina@example.org" }, profile: { name: () => "Lina" } }, {});
  assert.equal(words(named.html), "Dein Konto ist bereit. Angemeldet als lina@example.org . Weiter zu App", "a known name is not asked again");

  const question = name.render({}, {});
  assert.equal(words(question.html), "Wie soll ich dich nennen? Dein Vorname bleibt auf diesem Gerät. Vorname Weiter Überspringen");
  assert.match(question.html, /class="title luna-line"/, "Luna says it");
  assert.equal(question.back, undefined);

  const run = async (screen, act, extra = {}) => {
    const calls = [];
    const form = nameForm();
    const ctx = {
      mascot: { hold() {}, wave() {}, look() {}, celebrate() {}, reset() {} },
      profile: { answer: (value) => calls.push(`answer ${JSON.stringify(value)}`) },
      close: (result) => calls.push(`close ${JSON.stringify(result)}`),
      ...extra,
    };
    const root = { querySelector: (selector) => form.root.querySelector(selector) };
    const cleanup = screen.mount(root, ctx);
    await act(form);
    cleanup();
    return calls;
  };
  assert.deepEqual(await run(name, (form) => { form.input.value = "  Mira "; form.submit(); }), ['answer "  Mira "', 'close {"guest":true}'], "Weiter keeps the name and closes");
  assert.deepEqual(await run(name, (form) => form.skip()), ['answer ""', 'close {"guest":true}'], "Überspringen asks no more");
  assert.deepEqual(await run(name, () => {}), ['answer ""'], "closing the scene counts as asked");
  assert.deepEqual(await run(success, (form) => { form.input.value = "Lina"; form.submit(); form.submit(); }), ['answer "Lina"', 'close {"opened":true}'], "after creating an account it opens the app once");
};

CASES["forgetting the password: the padlock of the scene beside the note, the consequence in bold, the words unchanged"] = async () => {
  const device = new Device(new AccountService(), { address: null });
  await device.load({ quiet: false });
  const forgot = (await import(`${script("account-screens/screens/forgot.js")}?page=${device.page.number}`)).default;
  const { html } = forgot.render({}, {});
  const note = /<div class="notice-lock notice-static">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  assert.ok(note, "the note is there");
  assert.doesNotMatch(html, /notice is-info|class="notice /, "no box");
  assert.match(note, /^<svg class="lock-badge" viewBox="-32 -32 64 64" aria-hidden="true" focusable="false">/, "the padlock comes first");
  assert.match(note, /fill="#C96F4F"/, "in the terracotta of the scene");
  assert.match(note, /<p>Deine Daten im Konto sind mit deinem Passwort verschlüsselt\. <strong>Nach dem Zurücksetzen lassen sie sich nicht mehr öffnen\.<\/strong> Was auf deinen Geräten liegt, bleibt erhalten\.<\/p>$/);
  assert.equal(words(note), "Deine Daten im Konto sind mit deinem Passwort verschlüsselt. Nach dem Zurücksetzen lassen sie sich nicht mehr öffnen. Was auf deinen Geräten liegt, bleibt erhalten.");
};

CASES["an unverified address: the envelope of the scene beside the note, the new code in bold, the words unchanged"] = async () => {
  const device = new Device(new AccountService(), { address: null });
  await device.load({ quiet: false });
  const { createNotice } = await import(`${script("account-screens/ui/notice.js")}?page=${device.page.number}`);
  const messages = await import(`${script("account-screens/messages.js")}?page=${device.page.number}`);
  const inner = { innerHTML: "", textContent: "", addEventListener() {} };
  const slot = { firstElementChild: inner, classList: { add() {}, remove() {}, contains: () => true } };
  const notice = createNotice({ querySelector: () => slot });
  const frames = [];
  globalThis.requestAnimationFrame = (run) => frames.push(run);
  const text = messages.messageFor("email_not_verified");
  assert.equal(text, "Diese Adresse ist noch nicht bestätigt. Wir haben dir einen neuen Code geschickt.");
  notice.show("mail", text, [], { strong: "Wir haben dir einen neuen Code geschickt." });
  frames.forEach((run) => run());
  assert.doesNotMatch(inner.innerHTML, /class="notice |is-info/, "no box, no i");
  assert.match(inner.innerHTML, /^<div class="notice-mail"><svg class="mail-badge" viewBox="-38 -27 76 54" aria-hidden="true" focusable="false">/, "the envelope comes first");
  assert.match(inner.innerHTML, /fill="#E7C694"/, "in the sand and terracotta of the scene");
  assert.match(inner.innerHTML, /<p>Diese Adresse ist noch nicht bestätigt\. <strong>Wir haben dir einen neuen Code geschickt\.<\/strong><\/p>/);
  notice.show("error", "Das hat nicht geklappt.");
  frames.forEach((run) => run());
  assert.match(inner.innerHTML, /^<div class="notice is-error">/, "the other notices keep their box");
  const code = (await import("node:fs")).readFileSync(new URL(script("account-screens/screens/code.js")), "utf8");
  assert.match(code, /notice\.show\("mail", messageFor\("email_not_verified"\), \[\], \{ strong: "Wir haben dir einen neuen Code geschickt\." \}\)/, "the code screen shows it so");
};

// The profile without its change record, which every own change adds.
const plainProfile = (value) => value && Object.fromEntries(Object.entries(value).filter(([key]) => !["at", "by", "seen"].includes(key)));

CASES["the avatar: a chosen Luna, else the first letter of the first name, else of the email, else a neutral figure"] = async () => {
  const device = new Device(new AccountService(), { address: null });
  const page = await device.load({ quiet: false });
  const profile = await import(`${script("profile.js")}?page=${page.number}`);
  const plain = (name) => ({ name, avatar: "initial", asked: false });
  let model = profile.avatarModel(plain("lina"), null);
  assert.deepEqual([model.kind, model.letter], ["initial", "L"]);
  assert.equal(model.hue, profile.hueOf("Lina"), "the hue follows the name, whatever its case");
  assert.ok(page.core.HUES.includes(model.hue), "one of the app's hues");
  assert.equal(profile.avatarModel(plain("émile"), null).letter, "É");
  assert.equal(profile.avatarModel(plain("„Öz“"), null).letter, "Ö", "the first letter, not a quote mark");
  model = profile.avatarModel(plain(""), "jonas@example.org");
  assert.deepEqual([model.kind, model.letter, model.hue], ["initial", "J", profile.hueOf("jonas@example.org")], "the email stands in for a missing name");
  assert.equal(profile.avatarModel(plain("…"), "jonas@example.org").letter, "J", "a name without a letter falls back too");
  assert.deepEqual(profile.avatarModel(plain(""), null), { kind: "blank" }, "neither: the neutral figure");
  assert.match(profile.avatarHtml({ kind: "blank" }), /avatar is-blank.*#i-user/);
  model = profile.avatarModel({ name: "Lina", avatar: "abi" }, "lina@example.org");
  assert.deepEqual(model, { kind: "luna", look: "abi", hue: "plum", label: "Abi" }, "a chosen Luna wins over the letter");
  const hues = ["Lina", "Jonas", "Mira", "Ben", "Ella", "Noah", "Emil", "Lea", "Paul", "Ida"].map(profile.hueOf);
  assert.ok(new Set(hues).size >= 5, `names spread over the hues: ${hues}`);

  assert.equal(profile.LUNA_LOOKS.length, 6);
  assert.equal(new Set(profile.LUNA_LOOKS.map((look) => look.hue)).size, 6, "six hues");
  for (const look of profile.LUNA_LOOKS) {
    const art = profile.avatarHtml(profile.avatarModel({ name: "", avatar: look.id }, null));
    assert.match(art, new RegExp(`data-look="${look.id}"`));
    assert.match(art, /<svg class="luna-badge"/);
    assert.doesNotMatch(art, /luna-art/, "never rigged, so it never moves");
  }

  device.store["app-profile"] = { name: "Lina", avatar: "clown" };
  const again = await device.load({ quiet: false });
  const kept = await import(`${script("profile.js")}?page=${again.number}`);
  assert.deepEqual(kept.readProfile(), { name: "Lina", avatar: "initial", asked: false }, "an unknown avatar is the letter");

  const signedIn = new Device(new AccountService(), { school: PLANNED });
  signedIn.store[ACCOUNT] = { service: SERVICE, token: "t".repeat(43), account: { id: "acc-1", email: "mira@example.org" } };
  const before = await signedIn.load({ quiet: false });
  const own = await import(`${script("profile.js")}?page=${before.number}`);
  assert.equal(own.avatarModel().letter, "M", "before the core starts, the stored account gives the letter");
  own.noteAccount({ available: true, signedIn: false, email: null });
  assert.deepEqual(own.avatarModel(), { kind: "blank" }, "signed out, no email to show");
};

CASES["the profile sheet shows the account by its state, and nothing of it without a service"] = async () => {
  const plain = new Device(new AccountService(), { address: null });
  const off = await plain.load({ quiet: false });
  const without = await import(`${script("profile.js")}?page=${off.number}`);
  assert.equal(without.profileAccount(), null);
  assert.equal(without.accountPart(without.profileAccount()), null, "no account part at all");

  const device = new Device(new AccountService(), { school: PLANNED });
  const page = await device.load({ quiet: false });
  const profile = await import(`${script("profile.js")}?page=${page.number}`);
  await page.account.startAccount();
  assert.equal(profile.accountPart(page.account.accountState()), "out", "signed out: Anmelden and Konto erstellen");
  await page.account.continueWithoutAccount();
  assert.equal(profile.accountPart(page.account.accountState()), "out", "a guest too");
  await signedUp(device);
  assert.equal(profile.accountPart(page.account.accountState()), "in", "signed in: the sync and Abmelden");
  assert.equal(profile.accountPart({ ...page.account.accountState(), needsPassword: true }), "password", "the password step when the key is gone");
  await page.account.signOut();
  assert.equal(profile.accountPart(page.account.accountState()), "out");
};

CASES["the first name and the avatar stay on this device: cleaned, kept, read back, in no backup"] = async () => {
  const device = new Device(new AccountService(), { address: null, school: PLANNED });
  const page = await device.load({ quiet: false });
  const profile = await import(`${script("profile.js")}?page=${page.number}`);
  const heard = [];
  profile.onProfile((value) => heard.push(value.name));
  addEventListener("app:profile", (event) => heard.push(`event ${event.detail.name}`));
  assert.equal(profile.profileName(), null);
  assert.equal(profile.wantsName(false), false, "not before the device is set up");
  assert.equal(profile.wantsName(true), true, "once it is");

  profile.setProfileName("  Lina \n Marie\t");
  await settle(20);
  assert.deepEqual(device.store["app-profile"], { name: "Lina Marie" });
  assert.equal(profile.profileName(), "Lina Marie", "the rest of the page can read it");
  assert.deepEqual(heard, ["Lina Marie", "event Lina Marie"]);
  assert.equal(profile.wantsName(true), false, "a name means no question");
  profile.setProfileName("x".repeat(60));
  assert.equal(profile.profileName().length, 40);
  profile.setProfileName("");
  await settle(20);
  assert.equal(device.store["app-profile"], undefined, "nothing left, nothing kept");
  assert.equal(profile.profileName(), null);

  profile.answerName("   ");
  await settle(20);
  assert.deepEqual(device.store["app-profile"], { asked: true }, "Überspringen asks no more");
  assert.equal(profile.wantsName(true), false);
  profile.answerName("Jonas");
  profile.setAvatar("musik");
  profile.setAvatar("clown");
  profile.setAvatar("brille");
  await settle(20);
  assert.deepEqual(device.store["app-profile"], { name: "Jonas", avatar: "brille", asked: true });

  assert.ok(!page.core.storage.keys().includes("app-profile"), "no backup or key list takes it");
  page.core.storage.set("app-profile", { name: "Fremd" });
  page.core.storage.remove("app-profile");
  await settle(20);
  assert.equal(profile.profileName(), "Jonas", "a backup or a shared plan cannot write it");

  const again = await device.load({ quiet: false, app: true });
  const read = await import(`${script("profile.js")}?page=${again.number}`);
  assert.deepEqual(read.readProfile(), { name: "Jonas", avatar: "brille", asked: true }, "read back at the next start");
  read.replaceProfile(null);
  await settle(20);
  assert.equal(device.store["app-profile"], undefined, "deleting everything takes it");
  read.replaceProfile({ name: "Jonas", avatar: "initial", asked: true });
  await settle(20);
  assert.deepEqual(device.store["app-profile"], { name: "Jonas", asked: true }, "and the undo brings back what it read");
};

CASES["the page asks for the first name only after the offer, and not after a scene the offer opened"] = async () => {
  for (const [school, expected] of [[SCHOOL, false], [PLANNED, true]]) {
    const device = new Device(new AccountService(), { school });
    const page = await device.load({ quiet: false });
    const outcome = [];
    addEventListener("app:account-offer", (event) => outcome.push(event.detail.offered));
    await page.ui.initAccountUi();
    await settle();
    if (expected) {
      assert.deepEqual(outcome, [], "not while the scene is open");
      page.surface.scenes[0].close({});
      await settle(50);
    }
    assert.deepEqual(outcome, [expected], school === SCHOOL ? "no offer on a new device" : "the offer opened the scene");
  }
};

CASES["a session that ended shows one calm notice with Anmelden, dismissed once it is gone"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  device.store[ACCOUNT] = { known: true, ended: true };
  const page = await device.load();
  const { toasts, scenes } = page.surface;
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].text, "Dieses Gerät wurde abgemeldet.");
  assert.equal(toasts[0].options.action.label, "Anmelden");
  toasts[0].options.action.run();
  await settle(20);
  assert.deepEqual(scenes.map((entry) => entry.options.screen), ["signin"]);
  toasts[0].isConnected = false;
  page.surface.observers.forEach((observer) => observer.fire());
  await settle(20);
  assert.deepEqual(device.storedAccount(), { known: true }, "dismissSessionEnded ran");
  const next = await device.load();
  assert.equal(next.surface.toasts.length, 0, "it does not come again");
};

CASES["a missing key gives one quiet hint per app start, and a 401 mid-session the notice"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  let page = await device.load();
  await signedUp(device);
  device.databases.clear();
  page = await device.load({ app: true });
  assert.equal(page.account.accountState().needsPassword, true);
  assert.deepEqual(page.surface.toasts.map((item) => [item.text, item.options.action.label]), [["Passwort fehlt auf diesem Gerät.", "Passwort eingeben"]]);
  page.surface.toasts[0].options.action.run();
  await settle(20);
  assert.deepEqual(page.surface.scenes.map((entry) => entry.options.screen), ["unlock"]);
  assert.equal((await device.load()).surface.toasts.length, 0, "not again on the next page of the same start");
  assert.equal((await device.load({ app: true })).surface.toasts.length, 1, "again at the next start");

  const other = new Device(service, { id: "b".repeat(32) });
  const live = await other.load();
  await live.account.signIn("lina@example.org", PASSWORD);
  await settle(50);
  live.surface.toasts.length = 0;
  service.sessions.clear();
  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  document.visibilityState = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  await settle(50);
  assert.equal(live.account.accountState().sessionEnded, true);
  assert.deepEqual(live.surface.toasts.map((item) => item.options.action.label), ["Anmelden"]);
};

CASES["the plan question has the agreed words and resolves with the choice"] = async () => {
  const device = new Device(new AccountService());
  const page = await device.load();
  const made = [];
  document.createElement = () => {
    const node = { dataset: {}, attributes: {}, listeners: {}, setAttribute(name, value) { this.attributes[name] = value; }, addEventListener(type, fn) { this.listeners[type] = fn; }, showModal() { this.open = true; }, close() { this.open = false; }, remove() {}, querySelector: () => ({ focus() {} }) };
    made.push(node);
    return node;
  };
  const answer = page.ui.askWhichPlan();
  await settle(20);
  const dialog = made[0];
  assert.equal(dialog.className, "app-dialog plan-question");
  assert.equal(dialog.attributes.role, "alertdialog");
  const words = dialog.innerHTML.replace(/<svg[^>]*>.*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.equal(words, "Welcher Stundenplan soll bleiben? In deinem Konto ist schon ein Stundenplan. Auf diesem Gerät ist ein anderer eingetragen. Der andere wird auf allen deinen Geräten ersetzt. Den von diesem Gerät Den aus dem Konto");
  assert.match(dialog.innerHTML, /btn btn-primary" type="button" data-plan="account">Den aus dem Konto</);
  const cancel = { prevented: false, preventDefault() { this.prevented = true; } };
  dialog.listeners.cancel(cancel);
  assert.equal(cancel.prevented, true, "Escape does not decide for the user");
  dialog.listeners.click({ target: { closest: () => ({ dataset: { plan: "device" } }) } });
  assert.equal(await answer, "device");
};

CASES["deleting everything while signed in signs out here and deletes nothing in the account"] = async () => {
  const service = new AccountService();
  const device = new Device(service);
  const page = await device.load();
  page.core.storage.set("app-subjects", SUBJECTS);
  page.core.storage.set("app-timetable-edits", KUNST);
  await page.core.storage.settled();
  await signedUp(device);
  const id = device.storedAccount().account.id;
  const entries = service.stream(id).entries.length;
  assert.ok(entries >= 1, "the plan is in the account");
  const before = service.requests.length;
  assert.equal(await page.card.signOutForWipe(page.account), true);
  assert.deepEqual(service.requests.slice(before).map((call) => `${call.method} ${call.path}`), ["POST /api/logout"], "only the session ends");
  assert.equal(service.stream(id).entries.length, entries, "the account keeps every entry");
  assert.deepEqual(device.storedAccount(), { known: true });
  assert.equal(device.store["app-timetable-sync"], undefined, "the next sync cannot bring the plan back");
  assert.equal(page.account.accountState().sync.connected, false);
  assert.equal(await page.card.signOutForWipe(page.account), false, "nothing to sign out the second time");
  assert.equal(await page.card.signOutForWipe(null), false, "nor without an account service");
};

CASES["without an address nothing of the screens loads or shows, with one only the small part until it opens"] = async () => {
  const service = new AccountService();
  const plain = new Device(service, { address: null, school: PLANNED });
  const off = await plain.load({ main: true });
  await settle();
  const names = off.loaded();
  assert.ok(names.includes("core.js"), "the loader saw the page");
  assert.deepEqual(names.filter((name) => name.startsWith("account")), [], "no account module");
  assert.equal(globalThis.AppAccount, undefined);
  assert.equal(off.core.root.dataset.account, undefined, "the quiet link stays hidden");
  assert.deepEqual([off.surface.scenes, off.surface.toasts, service.requests], [[], [], []]);

  const configured = new Device(service, { school: PLANNED });
  const surface = new Surface();
  surface.set("dialog", true);
  const on = await configured.load({ main: true, surface });
  await settle();
  const seen = on.loaded();
  assert.ok(seen.includes("account-ui.js") && seen.includes("account.js"), "the small part loads with an address");
  assert.ok(!seen.includes("account-screens.js"), "the scene is not loaded while it waits");
  surface.set("dialog", false);
  await settle();
  assert.equal(surface.scenes.length, 1, "it opened by itself once the dialog closed");
  assert.ok(on.loaded().includes("account-screens.js"), "and the scene loaded only then");
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
