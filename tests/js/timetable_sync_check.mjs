// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The timetable sync between devices. Every device is a page in a process of its own, with its own store, session and
// clock, and all of them talk to one account service kept here in memory with the routes of the real one.

import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { webcrypto } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = (name) => pathToFileURL(resolve(here, "../../app/static/app/js", name)).href;

const SYNC = "app-timetable-sync";
const META = "app-timetable-meta";
const PLAN_KEYS = ["app-subjects", "app-teachers", "app-rooms", "app-block-times", "app-timetable-edits", "app-ab-weeks", "app-ab-swap"];
const BLOCKS = [{ n: 1, start: "08:00", end: "09:30" }, { n: 2, start: "09:50", end: "11:20" }, { n: 3, start: "11:30", end: "13:00" }];
const week = (days = {}) => ({ 1: [], 2: [], 3: [], 4: [], 5: [], ...days });
const EMPTY = { subjects: {}, courses: {}, timetable: { A: week(), B: week() }, abReference: "2026-01-12" };
const IDS = { a: "a".repeat(32), b: "b".repeat(32), c: "c".repeat(32), d: "d".repeat(32) };
const SUBJECTS = {
  items: {
    "s-mathe": { custom: true, name: "Mathe", short: "Ma", hue: "slate", type: "GK" },
    "s-kunst": { custom: true, name: "Kunst", short: "Ku", hue: "rose", type: "GK" },
  },
  removed: [],
};
const cells = (...lessons) => Object.fromEntries(lessons.map(([cell, subject, room]) => [cell, { subject, room }]));
const MATHE = cells(["A:1:1", "s-mathe", "R1"], ["B:1:1", "s-mathe", "R1"]);
const KUNST = cells(["A:2:2", "s-kunst", "K1"], ["B:2:2", "s-kunst", "K1"]);
const BOTH = { ...MATHE, ...KUNST };

// The device side.

function element(tag = "div") {
  const children = new Map();
  const listeners = {};
  return {
    tagName: tag.toUpperCase(),
    dataset: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    hidden: false,
    open: false,
    disabled: false,
    innerHTML: "",
    textContent: "",
    listeners,
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener() {},
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    },
    querySelectorAll: () => [],
    append() {},
    replaceChildren() {},
    remove() {},
    focus() {},
    contains: () => false,
    closest: () => null,
    matches: () => false,
    animate: () => ({ finished: Promise.resolve(), cancel() {} }),
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  };
}

const tick = () => new Promise((done) => setTimeout(done, 0));

async function boot({ device, store = {}, session = {}, now, school = EMPTY }) {
  const page = {
    user: { state: "BB", grade: 12, iserv: "desktop" },
    blocks: BLOCKS,
    subjects: school.subjects,
    courses: school.courses,
    timetable: school.timetable,
    abReference: school.abReference,
    changes: [], tasks: [], taskPool: [], deadlines: [], events: [], holidays: [], weather: { hours: [] }, status: {},
    device,
  };
  const nodes = { appData: { textContent: JSON.stringify(page) }, appStore: { textContent: JSON.stringify(store) } };
  const server = new Map(Object.entries(store));
  const kept = new Map(Object.entries(session));
  const clock = { now };
  const counts = { reloads: 0, refreshes: 0, store: 0 };
  Date.now = () => clock.now;
  const events = new EventTarget();
  globalThis.addEventListener = events.addEventListener.bind(events);
  globalThis.removeEventListener = events.removeEventListener.bind(events);
  globalThis.dispatchEvent = events.dispatchEvent.bind(events);
  events.addEventListener("app:plan-refreshed", () => (counts.refreshes += 1));
  const local = new Map();
  globalThis.localStorage = { getItem: (key) => (local.has(key) ? local.get(key) : null), setItem: (key, value) => local.set(key, String(value)), removeItem: (key) => local.delete(key) };
  globalThis.sessionStorage = { getItem: (key) => (kept.has(key) ? kept.get(key) : null), setItem: (key, value) => kept.set(key, String(value)), removeItem: (key) => kept.delete(key) };
  const head = element("head");
  head.append = (node) => node.listeners.load?.forEach((fn) => fn());
  const dialogs = [];
  const doc = new EventTarget();
  Object.assign(doc, {
    documentElement: { dataset: { brand: "App", motion: "minimal" }, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, style: { setProperty() {} }, matches: () => false, querySelectorAll: () => [] },
    head,
    body: { append: (node) => dialogs.push(node), dataset: {} },
    activeElement: null,
    getElementById: (id) => nodes[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => element(tag),
    hidden: false,
    visibilityState: "visible",
  });
  globalThis.document = doc;
  globalThis.HTMLElement = class {};
  globalThis.location = { search: "", hash: "", pathname: "/hub", href: "http://127.0.0.1/hub", reload: () => (counts.reloads += 1), assign() {} };
  globalThis.history = { state: null, replaceState() {} };
  globalThis.self = globalThis;
  globalThis.window = globalThis;
  Object.defineProperty(globalThis, "navigator", { value: { platform: "MacIntel", userAgent: "node", maxTouchPoints: 0 }, configurable: true });
  globalThis.matchMedia = (query) => ({ matches: query.includes("reduce"), addEventListener() {} });
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  globalThis.requestAnimationFrame = (run) => {
    run();
    return 0;
  };
  globalThis.CSS = { escape: (text) => String(text) };
  globalThis.IntersectionObserver = globalThis.MutationObserver = globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    if (String(url).startsWith("/api/ui/store/")) {
      counts.store += 1;
      const key = decodeURIComponent(String(url).replace("/api/ui/store/", ""));
      if (method === "DELETE") server.delete(key);
      else server.set(key, JSON.parse(options.body));
    }
    return { ok: true, json: async () => ({ success: true }) };
  };
  const core = await import(script("core.js"));
  const sync = await import(script("sync.js"));
  const client = await import(script("sync/client.js"));
  const format = await import(script("plan-format.js"));
  return { core, sync, client, format, server, kept, clock, counts, dialog: () => dialogs.at(-1), document: doc };
}

let waiting = 0;
const answers = new Map();

function accountFetch(account) {
  return (url, options = {}) => new Promise((done) => {
    const id = (waiting += 1);
    answers.set(id, done);
    process.send({ type: "account", id, account, method: options.method || "GET", url: String(url), body: options.body === undefined ? undefined : JSON.parse(options.body) });
  }).then(({ status, payload }) => ({ ok: status < 300, status, json: async () => payload }));
}

async function settled(page) {
  await tick();
  await page.sync.flushSync();
  await page.core.storage.settled();
}

function lessonsOf(page) {
  const { data } = page.core;
  const weeks = page.core.abWeeks() ? ["A", "B"] : ["A"];
  return weeks.flatMap((name) => Object.entries(data.timetable[name] || {}).flatMap(([dow, list]) => list.map((lesson) => `${name}${dow}.${lesson.block} ${data.subjects[lesson.subject]?.name} ${lesson.room}`))).sort();
}

async function sharedLink(page, subjects, lessons) {
  const model = page.format.planOf({
    subjects,
    teachers: [],
    rooms: [],
    blocks: BLOCKS,
    timetable: lessons,
    edits: null,
    weeks: true,
    abReference: "2026-01-12",
  });
  return page.format.linkOf("https://example.org", await page.format.encodePlan(model));
}

async function listenerOf(node, type = "click") {
  for (let turn = 0; turn < 40 && !node.listeners[type]?.length; turn += 1) await tick();
  assert.ok(node.listeners[type]?.length, "the button is there");
  return node.listeners[type];
}

function runDevice() {
  let page = null;
  const actions = {
    async boot(options) {
      page = await boot(options);
    },
    clock(now) {
      page.clock.now = now;
    },
    async connect({ account, key, signedIn = false }) {
      const cipher = await page.client.deriveCipherKey(Uint8Array.from(key));
      const status = await page.sync.connectSync(page.client.createSyncClient({ key: cipher, account, fetchImpl: accountFetch(account) }), { signedIn });
      await page.core.storage.settled();
      return status;
    },
    async disconnect() {
      page.sync.disconnectSync();
      await page.core.storage.settled();
    },
    async edit(lessons, subjects = SUBJECTS) {
      page.core.storage.set("app-subjects", subjects);
      page.core.storage.set("app-timetable-edits", lessons);
      await settled(page);
    },
    async burst(steps, flush = true) {
      for (const lessons of steps) {
        page.core.storage.set("app-subjects", SUBJECTS);
        page.core.storage.set("app-timetable-edits", lessons);
        await tick();
      }
      if (flush) await settled(page);
    },
    async weeks({ weeks, swap }) {
      page.core.storage.set("app-subjects", SUBJECTS);
      page.core.storage.set("app-timetable-edits", BOTH);
      page.core.storage.set("app-ab-weeks", weeks);
      if (swap) page.core.storage.set("app-ab-swap", true);
      else page.core.storage.remove("app-ab-swap");
      await settled(page);
    },
    async importPlan(lessons, subjects = SUBJECTS) {
      page.core.planChange("import", () => {
        page.core.storage.set("app-subjects", subjects);
        page.core.storage.set("app-timetable-edits", lessons);
      });
      await settled(page);
    },
    async seed(values) {
      Object.entries(values).forEach(([key, value]) => page.core.storage.set(key, value));
      await page.core.storage.settled();
    },
    async visible() {
      page.document.visibilityState = "hidden";
      page.document.dispatchEvent(new Event("visibilitychange"));
      page.document.visibilityState = "visible";
      page.document.dispatchEvent(new Event("visibilitychange"));
      await settled(page);
    },
    async online() {
      dispatchEvent(new Event("online"));
      await settled(page);
    },
    async share({ choice = null } = {}) {
      const { initPlanShare, importFlow } = await import(script("plan-share.js"));
      sessionStorage.removeItem("app-plan-undo");
      initPlanShare();
      const link = await sharedLink(page, { k: { name: "Kunst", short: "Ku", hue: "rose", type: "GK", teacherId: "", room: "K1" } }, { A: week({ 3: [{ block: 3, subject: "k", room: "K9" }] }), B: week({ 3: [{ block: 3, subject: "k", room: "K9" }] }) });
      importFlow({ text: link });
      for (let turn = 0; turn < 40 && !page.dialog(); turn += 1) await tick();
      const sheet = page.dialog();
      const body = sheet.querySelector("#shareBody");
      for (const listener of await listenerOf(body.querySelector("#shareApply"))) await listener({});
      for (let turn = 0; turn < 10; turn += 1) await tick();
      const title = sheet.querySelector("#shareTitle").textContent;
      const asked = title === "Diesen Plan überall nutzen?";
      if (asked) {
        assert.match(body.innerHTML, /Mit deinem Konto ist dein Stundenplan auf allen deinen Geräten gleich\. Nutzt du diesen Plan überall, ersetzt er ihn auch auf deinen anderen Geräten\./);
        assert.match(body.innerHTML, /Nur hier: Beim nächsten Abgleich kommt dein eigener Plan zurück\./);
        assert.match(body.innerHTML, /<span>Überall nutzen<\/span>/);
        assert.match(body.innerHTML, /<span>Nur hier<\/span>/);
        const button = body.querySelector(choice === "everywhere" ? "#shareEverywhere" : "#shareHere");
        for (const listener of await listenerOf(button)) await listener({});
      }
      await settled(page);
      return { asked, title };
    },
    inspect(dates = []) {
      const { core, sync } = page;
      return {
        meta: core.planMeta(),
        values: Object.fromEntries(PLAN_KEYS.map((key) => [key, core.storage.get(key)])),
        lessons: lessonsOf(page),
        subjects: Object.values(core.data.subjects).map((info) => info.name).sort(),
        status: sync.syncStatus(),
        connected: sync.syncConnected(),
        reloads: page.counts.reloads,
        refreshes: page.counts.refreshes,
        abReference: core.data.abReference,
        abAnswered: core.abAnswered(),
        weeks: dates.map((day) => core.weekType(new Date(`${day}T12:00:00`))),
        keys: core.storage.keys(),
        syncState: core.syncStore.get(),
        storeWrites: page.counts.store,
      };
    },
    backupKeys() {
      const { storage } = page.core;
      storage.set(SYNC, { account: "x", cursor: 99 });
      storage.remove(SYNC);
      storage.keys().filter((key) => /^app-/.test(key)).forEach((key) => storage.remove(key));
      return { keys: storage.keys(), state: page.core.syncStore.get() };
    },
  };
  process.on("message", async (message) => {
    if (message.type === "account-reply") {
      answers.get(message.id)?.(message);
      answers.delete(message.id);
      return;
    }
    if (message.type !== "call") return;
    try {
      const value = await actions[message.action](...message.args);
      if (page) await page.core.storage.settled();
      const snapshot = page ? { store: Object.fromEntries(page.server), session: Object.fromEntries(page.kept) } : null;
      process.send({ type: "result", id: message.id, value, snapshot });
    } catch (error) {
      process.send({ type: "result", id: message.id, error: String(error?.stack || error) });
    }
  });
}

// The account side, with the semantics of the routes in the account service: rising sequence numbers that survive a
// reset, the newest 20 entries kept, pages of 10 after a cursor, and nothing to change or delete an entry.

class AccountService {
  constructor() {
    this.streams = new Map();
    this.log = [];
  }

  stream(account) {
    if (!this.streams.has(account)) this.streams.set(account, { last: 0, entries: [] });
    return this.streams.get(account);
  }

  handle(account, { method, url, body }, who = "") {
    const address = new URL(url, "http://accounts.test");
    if (address.pathname !== "/api/entries") return { status: 404, payload: { error: "not_found" } };
    const stream = this.stream(account);
    if (method === "POST") {
      if (body?.stream !== "timetable") return { status: 400, payload: { error: "unknown_stream" } };
      const size = typeof body.data === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(body.data) ? Buffer.from(body.data, "base64").length : -1;
      if (size > 64 * 1024) return { status: 413, payload: { error: "entry_too_large", limit: 64 * 1024 } };
      if (size < 29) return { status: 400, payload: { error: "invalid_request" } };
      stream.last += 1;
      stream.entries.push({ seq: stream.last, data: body.data });
      stream.entries = stream.entries.filter((entry) => entry.seq > stream.last - 20);
      this.log.push({ who, account, push: stream.last });
      return { status: 201, payload: { seq: stream.last } };
    }
    if (address.searchParams.get("stream") !== "timetable") return { status: 400, payload: { error: "unknown_stream" } };
    const after = Number(address.searchParams.get("after") ?? "0");
    if (!Number.isSafeInteger(after) || after < 0) return { status: 400, payload: { error: "invalid_request" } };
    const rest = stream.entries.filter((entry) => entry.seq > after);
    this.log.push({ who, account, pull: after });
    return { status: 200, payload: { entries: rest.slice(0, 10), latest: stream.last, more: rest.length > 10 } };
  }

  resetPassword(account) {
    this.stream(account).entries = [];
  }

  seqs(account) {
    return this.stream(account).entries.map((entry) => entry.seq);
  }

  calls(who) {
    return this.log.filter((item) => item.who === who);
  }
}

class Device {
  constructor(service, name, options = {}) {
    this.service = service;
    this.name = name;
    this.options = { device: IDS[name], now: 1_800_000_000_000, school: EMPTY, ...options };
    this.store = options.store || {};
    this.session = {};
    this.calls = new Map();
    this.count = 0;
  }

  async start({ app = true } = {}) {
    if (app) this.session = {};
    this.child = fork(fileURLToPath(import.meta.url), ["device"], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
    this.child.on("message", (message) => this.receive(message));
    await this.call("boot", { ...this.options, store: this.store, session: this.session });
    return this;
  }

  receive(message) {
    if (message.type === "account") {
      const reply = this.service.handle(message.account, message, this.name);
      this.child.send({ type: "account-reply", id: message.id, ...reply });
      return;
    }
    const waiter = this.calls.get(message.id);
    if (!waiter) return;
    this.calls.delete(message.id);
    if (message.snapshot) {
      this.store = message.snapshot.store;
      this.session = message.snapshot.session;
    }
    if (message.error) waiter.reject(new Error(`${this.name}: ${message.error}`));
    else waiter.resolve(message.value);
  }

  call(action, ...args) {
    const id = (this.count += 1);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name}: ${action} took too long`)), 20000);
      this.calls.set(id, { resolve: (value) => (clearTimeout(timer), resolve(value)), reject: (error) => (clearTimeout(timer), reject(error)) });
      this.child.send({ type: "call", id, action, args });
    });
  }

  stop() {
    this.child?.kill();
    this.child = null;
  }

  // A new page in the same session, as after a tap on another page or after a reload, or a new start of the app.
  async restart({ app = false } = {}) {
    this.stop();
    return this.start({ app });
  }

  connect(account) {
    return this.call("connect", account);
  }

  inspect(dates = []) {
    return this.call("inspect", dates);
  }
}

function account(name) {
  return { account: name, key: [...webcrypto.getRandomValues(new Uint8Array(32))] };
}

async function sealedElsewhere(service, { account: name }, value) {
  const { createSyncClient, deriveCipherKey } = await import(script("sync/client.js"));
  const key = await deriveCipherKey(webcrypto.getRandomValues(new Uint8Array(32)));
  const fetchImpl = async (url, options = {}) => {
    const { status, payload } = service.handle(name, { method: options.method || "GET", url, body: options.body && JSON.parse(options.body) }, "other key");
    return { ok: status < 300, status, json: async () => payload };
  };
  return createSyncClient({ key, account: name, fetchImpl }).push("timetable", value);
}

const CASES = {};
let devices = [];
const make = (service, name, options) => {
  const device = new Device(service, name, options);
  devices.push(device);
  return device.start();
};

CASES["an edit on one device reaches the other, which does not send it back"] = async () => {
  const service = new AccountService();
  const shared = account("acc-1");
  const a = await make(service, "a");
  const b = await make(service, "b");
  await a.connect(shared);
  assert.deepEqual(service.seqs("acc-1"), [], "an empty device sends nothing");
  await a.call("edit", BOTH);
  assert.deepEqual(service.seqs("acc-1"), [1], "the edit went up once");
  const status = await b.connect(shared);
  assert.equal(status.ready, true);
  const onA = await a.inspect();
  const onB = await b.inspect();
  assert.deepEqual(onB.lessons, onA.lessons);
  assert.equal(onB.lessons.length, 2);
  assert.deepEqual(onB.meta, onA.meta, "the record came along, with the time and device of the edit");
  assert.equal(onB.meta.device, IDS.a);
  assert.equal(onB.refreshes, 1, "the page shows the plan it took");
  assert.equal(onB.reloads, 0, "in place, without a reload");
  assert.deepEqual(service.seqs("acc-1"), [1], "B sends nothing back");
  await b.restart();
  await b.connect(shared);
  await b.call("visible");
  await b.restart({ app: true });
  await b.connect(shared);
  await b.call("online");
  assert.deepEqual(service.seqs("acc-1"), [1], "not after a new page, a new start, coming back or coming online either");
  assert.equal((await b.inspect()).refreshes, 0, "and the plan it holds is not taken again");
  assert.deepEqual(service.calls("b").filter((call) => "pull" in call).map((call) => call.pull), [0, 1, 0, 1]);
};

CASES["of two edits the newer wins, and the same time goes to the higher device id"] = async () => {
  const service = new AccountService();
  const shared = account("acc-2");
  const a = await make(service, "a");
  const b = await make(service, "b");
  await a.connect(shared);
  await b.connect(shared);
  await a.call("clock", 1_800_000_001_000);
  await a.call("edit", MATHE);
  await b.call("visible");
  assert.deepEqual((await b.inspect()).lessons, (await a.inspect()).lessons);
  await b.call("clock", 1_800_000_002_000);
  await b.call("edit", KUNST);
  await a.call("visible");
  const later = await a.inspect();
  assert.equal(later.meta.device, IDS.b, "the newer edit of B wins on A");
  assert.deepEqual(later.lessons, (await b.inspect()).lessons);

  await a.call("clock", 1_800_000_005_000);
  await b.call("clock", 1_800_000_005_000);
  await a.call("edit", BOTH);
  await b.call("edit", MATHE);
  const [onA, onB] = [(await a.inspect()).meta, (await b.inspect()).meta];
  assert.equal(onA.at, onB.at, "both edits have the same time");
  await a.call("visible");
  await b.call("visible");
  const [endA, endB] = [await a.inspect(), await b.inspect()];
  assert.deepEqual(endA.meta, endB.meta);
  assert.equal(endA.meta.device, IDS.b, "the higher device id wins the tie");
  assert.deepEqual(endA.lessons, endB.lessons);
};

CASES["an import never beats an own edit, and the next sync brings the edit back"] = async () => {
  const service = new AccountService();
  const shared = account("acc-3");
  const a = await make(service, "a");
  const b = await make(service, "b");
  await a.connect(shared);
  await a.call("edit", MATHE);
  await b.connect(shared);
  await b.call("clock", 1_900_000_000_000);
  await b.call("importPlan", KUNST);
  const imported = await b.inspect();
  assert.equal(imported.meta.origin, "import");
  assert.deepEqual(service.seqs("acc-3"), [1, 2], "the import goes up too");
  await a.call("visible");
  const onA = await a.inspect();
  assert.equal(onA.meta.origin, "edit");
  assert.equal(onA.refreshes, 0, "A keeps its edit");
  await b.call("visible");
  const onB = await b.inspect();
  assert.deepEqual(onB.meta, onA.meta, "B takes the edit back");
  assert.deepEqual(onB.lessons, onA.lessons);
};

CASES["where no device has an own edit, the newest import wins"] = async () => {
  const service = new AccountService();
  const shared = account("acc-4");
  const a = await make(service, "a");
  const b = await make(service, "b");
  await a.connect(shared);
  await b.connect(shared);
  await a.call("importPlan", MATHE);
  await b.call("clock", 1_800_000_009_000);
  await b.call("importPlan", KUNST);
  await a.call("visible");
  const [onA, onB] = [await a.inspect(), await b.inspect()];
  assert.equal(onA.meta.origin, "import");
  assert.deepEqual(onA.meta, onB.meta);
  assert.deepEqual(onA.lessons, onB.lessons);
  await b.call("visible");
  assert.equal((await b.inspect()).refreshes, 0, "B keeps its own import");
  const c = await make(service, "c");
  await c.connect(shared);
  assert.deepEqual((await c.inspect()).meta, onB.meta, "a device that comes later takes the newest import as well");
};

CASES["a new device pulls everything before it sends anything and does not overwrite the plan of the others"] = async () => {
  const service = new AccountService();
  const shared = account("acc-5");
  const a = await make(service, "a");
  await a.connect(shared);
  await a.call("clock", 1_800_000_050_000);
  await a.call("edit", MATHE);
  for (let turn = 0; turn < 11; turn += 1) {
    await a.call("clock", 1_800_000_060_000 + turn);
    await a.call("edit", turn % 2 ? MATHE : BOTH);
  }
  const b = await make(service, "b");
  await b.call("edit", KUNST);
  const before = await b.inspect();
  assert.ok(before.meta.at < (await a.inspect()).meta.at, "B's own edit is older");
  await b.connect(shared);
  const calls = service.calls("b");
  assert.ok("pull" in calls[0], "the first call of B is a pull");
  assert.equal(calls.filter((call) => "pull" in call).length, 2, "it reads both pages");
  assert.equal(calls.filter((call) => "push" in call).length, 0, "and sends nothing");
  const [onA, onB] = [await a.inspect(), await b.inspect()];
  assert.deepEqual(onB.meta, onA.meta);
  assert.deepEqual(onB.lessons, onA.lessons);

  const c = await make(service, "c", { store: { "app-subjects": SUBJECTS, "app-timetable-edits": KUNST } });
  await c.connect(shared);
  assert.deepEqual((await c.inspect()).meta, onA.meta, "a plan from before the records were kept does not count either");
  assert.equal(service.calls("c").filter((call) => "push" in call).length, 0);
};

CASES["a plan from before the records were kept goes up as an import to an empty account"] = async () => {
  const service = new AccountService();
  const shared = account("acc-6");
  const a = await make(service, "a", { store: { "app-subjects": SUBJECTS, "app-timetable-edits": BOTH } });
  const empty = await make(service, "b");
  await empty.connect(shared);
  assert.deepEqual(service.seqs("acc-6"), [], "a device without a plan sends nothing");
  await a.connect(shared);
  const onA = await a.inspect();
  assert.equal(onA.meta.origin, "import");
  assert.deepEqual(service.seqs("acc-6"), [1]);
  await empty.call("visible");
  assert.deepEqual((await empty.inspect()).lessons, onA.lessons);
};

CASES["the last own edit is sent again when 20 imports pushed it out of the history"] = async () => {
  const service = new AccountService();
  const shared = account("acc-7");
  const a = await make(service, "a");
  const c = await make(service, "c");
  await a.connect(shared);
  await a.call("edit", MATHE);
  const edit = (await a.inspect()).meta;
  await c.connect(shared);
  for (let turn = 0; turn < 20; turn += 1) {
    await c.call("clock", 1_900_000_000_000 + turn * 1000);
    await c.call("importPlan", turn % 2 ? KUNST : BOTH);
  }
  assert.deepEqual(service.seqs("acc-7"), Array.from({ length: 20 }, (_, index) => index + 2), "the edit is gone from the history");
  await a.call("visible");
  assert.deepEqual(service.seqs("acc-7").at(-1), 22, "A sent it again");
  assert.deepEqual((await a.inspect()).meta, edit, "with the same record");
  await a.call("visible");
  assert.equal(service.seqs("acc-7").at(-1), 22, "and only once");
  const d = await make(service, "d");
  await d.connect(shared);
  const onD = await d.inspect();
  assert.deepEqual(onD.meta, edit, "a device that joins later still finds the edit");
  assert.deepEqual(onD.lessons, (await a.inspect()).lessons);
  await c.call("visible");
  assert.deepEqual((await c.inspect()).meta, edit);
};

CASES["entries nobody here can open are left out and reported"] = async () => {
  const service = new AccountService();
  const shared = account("acc-8");
  const a = await make(service, "a");
  await a.connect(shared);
  await a.call("edit", MATHE);
  const record = { at: 9_000_000_000_000, origin: "edit", device: "f".repeat(32) };
  await sealedElsewhere(service, shared, { v: 1, record, plan: { "app-subjects": { items: {}, removed: [] }, "app-timetable-edits": {} }, abReference: null });
  const b = await make(service, "b");
  const status = await b.connect(shared);
  assert.equal(status.unreadable, 1);
  const onB = await b.inspect();
  assert.deepEqual(onB.meta, (await a.inspect()).meta, "the entry of the old key does not win");
  await a.call("visible");
  const onA = await a.inspect();
  assert.equal(onA.status.unreadable, 1);
  assert.equal(onA.meta.device, IDS.a);

  service.resetPassword("acc-8");
  const fresh = account("acc-8");
  await a.connect(fresh);
  assert.deepEqual(service.seqs("acc-8"), [], "a new page does not pull again");
  await a.connect({ ...fresh, signedIn: true });
  assert.equal((await a.inspect()).status.unreadable, 0);
  assert.deepEqual(service.seqs("acc-8"), [3], "signing in after a password reset pulls again, and the device sends its plan under the new key");
};

CASES["a burst of changes is one entry, sent once it settles or the page goes away"] = async () => {
  const service = new AccountService();
  const shared = account("acc-9");
  const a = await make(service, "a");
  await a.connect(shared);
  await a.call("burst", [MATHE, BOTH, KUNST, BOTH]);
  assert.deepEqual(service.seqs("acc-9"), [1]);
  await a.call("burst", [MATHE], false);
  assert.deepEqual(service.seqs("acc-9"), [1], "it waits for the burst to end");
  await a.restart();
  await a.connect(shared);
  assert.deepEqual(service.seqs("acc-9"), [1, 2], "a change the page could not send before it went goes up from the next page");
};

CASES["the A/B setting travels with the plan, and the device that takes it has its answer"] = async () => {
  const service = new AccountService();
  const shared = account("acc-10");
  const days = ["2026-11-09", "2026-11-16", "2026-11-23", "2027-02-01"];
  const a = await make(service, "a");
  const b = await make(service, "b", { school: { ...EMPTY, abReference: "2026-01-19" } });
  const c = await make(service, "c", { school: { ...EMPTY, abReference: "2026-01-12" } });
  await a.connect(shared);
  await a.call("weeks", { weeks: true, swap: true });
  const onA = await a.inspect(days);
  assert.equal(onA.abReference, "2026-01-19");
  await b.connect(shared);
  await c.connect(shared);
  const onB = await b.inspect(days);
  const onC = await c.inspect(days);
  assert.deepEqual(onB.weeks, onA.weeks, "the phone with its own count shows the same weeks");
  assert.deepEqual(onC.weeks, onA.weeks);
  assert.equal(onB.values["app-ab-swap"], null, "its count already matches");
  assert.equal(onC.values["app-ab-swap"], true, "this one swaps");
  assert.equal(onB.abAnswered, true, "the A/B question is answered on the devices that took the plan");
  assert.equal(onC.abAnswered, true);
  assert.deepEqual(onB.lessons, onA.lessons);

  await a.call("weeks", { weeks: false, swap: false });
  await b.call("visible");
  const off = await b.inspect(days);
  assert.equal(off.values["app-ab-weeks"], false, "turning A/B weeks off travels as well");
  assert.deepEqual(off.weeks, ["A", "A", "A", "A"]);
};

CASES["the plan travels frozen and finds a renamed school subject on a device with other school defaults"] = async () => {
  const service = new AccountService();
  const shared = account("acc-11");
  const school = {
    subjects: { "s-mathe": { name: "Mathe", label: "Mathe", short: "Ma", hue: "slate" }, "s-deutsch": { name: "Deutsch", label: "Deutsch", short: "De", hue: "brick" } },
    courses: { "s-mathe": { type: "GK" }, "s-deutsch": { type: "GK" } },
    timetable: { A: week({ 1: [{ block: 1, subject: "s-mathe", room: "R1", teacher: "" }], 2: [{ block: 1, subject: "s-deutsch", room: "R2", teacher: "" }] }), B: week({ 1: [{ block: 1, subject: "s-mathe", room: "R1", teacher: "" }] }) },
    abReference: "2026-01-12",
  };
  const a = await make(service, "a", { school });
  const b = await make(service, "b", { school: { ...EMPTY, subjects: { "s-mathe": school.subjects["s-mathe"] }, courses: { "s-mathe": { type: "GK" } } } });
  await b.connect(shared);
  await a.connect(shared);
  assert.equal((await a.inspect()).meta.origin, "import", "the school plan of A had no record and went up as an import");
  await a.call("edit", cells(["A:3:2", "s-mathe", "R7"]), { items: { "s-mathe": { name: "Mathematik" } }, removed: [] });
  const onA = await a.inspect();
  assert.ok(onA.subjects.includes("Mathematik"));
  await b.call("visible");
  const onB = await b.inspect();
  assert.deepEqual(onB.lessons, onA.lessons, "B shows the lessons of A, though its school has none of them");
  assert.deepEqual(Object.keys(onB.values["app-subjects"].items).sort(), ["s-deutsch", "s-mathe"], "the renamed subject is B's own school subject");
  assert.equal(onB.values["app-subjects"].items["s-mathe"].name, "Mathematik");
};

CASES["a shared plan asks once and is recorded as an edit everywhere or as shared here"] = async () => {
  const service = new AccountService();
  const shared = account("acc-12");
  const a = await make(service, "a");
  const b = await make(service, "b");
  await a.connect(shared);
  await b.connect(shared);
  await a.call("edit", MATHE);
  await b.call("visible");
  const everywhere = await b.call("share", { choice: "everywhere" });
  assert.equal(everywhere.asked, true);
  const onB = await b.inspect();
  assert.equal(onB.meta.origin, "edit", "Überall nutzen records the plan as an own edit");
  assert.ok(onB.lessons.some((line) => line.includes("Kunst K9")));
  await a.call("visible");
  assert.deepEqual((await a.inspect()).lessons, onB.lessons, "and it reaches the other device");

  await b.restart();
  await b.connect(shared);
  await a.call("clock", 1_900_000_000_000);
  await a.call("edit", BOTH);
  await b.call("visible");
  const here = await b.call("share", { choice: "here" });
  assert.equal(here.asked, true);
  const onlyHere = await b.inspect();
  assert.equal(onlyHere.meta.origin, "share", "Nur hier records it as shared");
  assert.ok(onlyHere.lessons.some((line) => line.includes("Kunst K9")));
  await a.call("visible");
  assert.equal((await a.inspect()).meta.origin, "edit", "the other device keeps its plan");
  await b.restart();
  await b.connect(shared);
  assert.equal((await b.inspect()).meta.origin, "share", "a new page keeps the shared plan");
  await b.call("visible");
  const back = await b.inspect();
  assert.deepEqual(back.meta, (await a.inspect()).meta, "the next sync brings the own plan back");
  assert.deepEqual(back.lessons, (await a.inspect()).lessons);
};

CASES["without a connection nothing changes"] = async () => {
  const service = new AccountService();
  const a = await make(service, "a");
  await a.call("edit", MATHE);
  await a.call("importPlan", KUNST);
  const shown = await a.call("share");
  assert.equal(shown.asked, false, "no question");
  await a.call("visible");
  await a.call("online");
  const onA = await a.inspect();
  assert.equal(onA.meta.origin, "share", "the shared plan is recorded as shared, as before");
  assert.equal(onA.connected, false);
  assert.equal(onA.syncState, null);
  assert.ok(!(SYNC in a.store), "no sync state is stored");
  assert.deepEqual(service.log, [], "nothing goes to an account");
};

CASES["the sync state stays on the device and never lands in a backup"] = async () => {
  const service = new AccountService();
  const shared = account("acc-13");
  const a = await make(service, "a");
  await a.connect(shared);
  await a.call("edit", MATHE);
  const onA = await a.inspect();
  assert.equal(onA.syncState.account, "acc-13");
  assert.equal(onA.syncState.cursor, 1);
  assert.ok(SYNC in a.store, "it is kept with the page store of this device");
  assert.ok(!onA.keys.includes(SYNC), "but not among the values a backup takes");
  assert.ok(!onA.keys.includes(META));
  const after = await a.call("backupKeys");
  assert.deepEqual(after.keys, []);
  assert.equal(after.state.account, "acc-13", "writing or restoring values cannot change it");
  await a.call("disconnect");
  const gone = await a.inspect();
  assert.equal(gone.syncState, null, "signing out resets it");
  assert.equal(gone.connected, false);
  assert.ok(!(SYNC in a.store));
  assert.equal(gone.meta.origin, "edit", "and the plan stays");
};

if (process.argv[2] === "device") {
  runDevice();
} else {
  const only = process.argv[2];
  let failed = 0;
  for (const name of Object.keys(CASES)) {
    if (only && name !== only) continue;
    devices = [];
    try {
      await CASES[name]();
      console.log(`ok   ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${name}\n${error?.stack || error}`);
    } finally {
      devices.forEach((device) => device.stop());
    }
  }
  process.exit(failed ? 1 : 0);
}
