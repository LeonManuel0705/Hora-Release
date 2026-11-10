// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Drives the real setup module through whole runs on a small stand-in for the page. Every case runs in its own node
// process, so each starts from the plan and stores it names and nothing carries over.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = (name) => pathToFileURL(resolve(here, "../../app/static/app/js", name)).href;

const week = (days) => ({ 1: [], 2: [], 3: [], 4: [], 5: [], ...days });
const lesson = (block, subject, room, teacher) => ({ block, subject, room, teacher });
const DEFAULT_BLOCKS = [["08:00", "09:30"], ["09:50", "11:20"], ["11:30", "13:00"], ["13:30", "15:00"]].map(([start, end], index) => ({ n: index + 1, start, end }));

// A plan typed into the older screens, with teachers and rooms written the way that school writes them.
const STORED = {
  subjects: {
    "s-biologie": { name: "Biologie", label: "Biologie", short: "Bio", hue: "jade" },
    "s-mathematik": { name: "Mathematik", label: "Mathematik", short: "Mat", hue: "slate" },
    "s-physik": { name: "Physik", label: "Physik", short: "Phy", hue: "iris" },
  },
  courses: { "s-biologie": { type: "GK" }, "s-mathematik": { type: "GK" }, "s-physik": { type: "GK" } },
  timetable: Object.fromEntries(["A", "B"].map((name) => [name, week({
    1: [lesson(1, "s-biologie", "Bio2", "Fr. Krüger"), lesson(2, "s-mathematik", "R114", "Hr. Wolf")],
    2: [lesson(1, "s-biologie", "Bio2", "Fr. Krüger")],
    3: [lesson(1, "s-physik", "Ph1", "Herr Schmidt")],
  })])),
};

const EMPTY = { subjects: {}, courses: {}, timetable: { A: week({}), B: week({}) } };
const DEVICE = "0123456789abcdef0123456789abcdef";

function pageData(plan, user = {}) {
  return {
    user: { state: "", grade: null, iserv: "desktop", ...user },
    blocks: DEFAULT_BLOCKS,
    ...plan,
    abReference: "2026-01-12",
    changes: [],
    tasks: [],
    taskPool: [],
    deadlines: [],
    events: [],
    holidays: [],
    weather: { hours: [] },
    status: {},
    device: DEVICE,
  };
}

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
    scrollTop: 0,
    listeners,
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    toggleAttribute() {},
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
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
    get firstElementChild() {
      return element();
    },
  };
}

const CASES = {};

async function boot({ plan = STORED, user = {}, store = {}, search = "", notification = null } = {}) {
  const nodes = { appData: { textContent: JSON.stringify(pageData(plan, user)) }, appStore: { textContent: JSON.stringify(store) } };
  const local = new Map();
  const calls = [];
  const visits = [];
  const dialogs = [];
  globalThis.localStorage = {
    getItem: (key) => (local.has(key) ? local.get(key) : null),
    setItem: (key, value) => local.set(key, String(value)),
    removeItem: (key) => local.delete(key),
  };
  globalThis.document = {
    documentElement: { dataset: { brand: "App", motion: "calm" }, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, style: { setProperty() {} }, matches: () => false, querySelectorAll: () => [] },
    body: { append(node) {
      dialogs.push(node);
    } },
    activeElement: null,
    getElementById: (id) => nodes[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    dispatchEvent: () => true,
    createElement: (tag) => element(tag),
    createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: 0 }) }),
    hidden: false,
    visibilityState: "visible",
  };
  globalThis.location = {
    search,
    pathname: "/hub",
    href: `http://127.0.0.1/hub${search}`,
    assign: (to) => visits.push(to),
    reload: () => visits.push("reload"),
  };
  globalThis.self = globalThis;
  globalThis.window = globalThis;
  Object.defineProperty(globalThis, "navigator", { value: { platform: "MacIntel", userAgent: "node" }, configurable: true });
  globalThis.matchMedia = (query) => ({ matches: query.includes("reduce"), addEventListener() {} });
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  globalThis.requestAnimationFrame = (run) => {
    run();
    return 0;
  };
  globalThis.CSS = { escape: (text) => String(text) };
  globalThis.IntersectionObserver = globalThis.MutationObserver = globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.addEventListener = () => {};
  globalThis.dispatchEvent = () => true;
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  if (notification) globalThis.Notification = { permission: notification, requestPermission: async () => notification };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ method: options.method || "GET", url: String(url), body: options.body === undefined ? undefined : JSON.parse(options.body) });
    return { ok: true, json: async () => ({ success: true }) };
  };
  const core = await import(script("core.js"));
  const flow = await import(script("setup-flow.js"));
  return { core, flow, calls, visits, dialog: () => dialogs.at(-1) };
}

function driver(page) {
  const dialog = page.dialog();
  const settle = () => new Promise((done) => setTimeout(done, 0));
  const fire = async (type, event) => {
    for (const listener of dialog.listeners[type] || []) await listener(event);
    await settle();
  };
  const control = (selector, extra = {}) => {
    const node = { dataset: {}, disabled: false, ...extra };
    node.closest = (wanted) => (wanted === selector ? node : null);
    return node;
  };
  const stage = () => dialog.querySelector("#setupStage").innerHTML;
  const step = () => /data-step="([a-z]+)"/.exec(stage())?.[1];
  const foot = () => dialog.querySelector("#setupFoot").innerHTML;
  return {
    dialog,
    fire,
    control,
    stage,
    step,
    async next() {
      assert.ok(!/data-setup-next[^>]*disabled/.test(foot()), `Weiter is off on the step ${step()}`);
      await fire("click", { target: control("[data-setup-next]") });
    },
    change: (target) => fire("change", { target: { dataset: {}, name: "", id: "", ...target } }),
    type: (field, name, value) => fire("input", { target: { dataset: { [field]: name }, value } }),
    pick: (name) => fire("click", { target: control("[data-pick]", { dataset: { pick: name } }) }),
  };
}

const PLAN_KEYS = ["app-timetable-edits", "app-block-times", "app-ab-swap", "app-ab-weeks", "app-subjects", "app-teachers", "app-rooms", "app-settings"];
const snapshot = (core) => Object.fromEntries([...new Set([...PLAN_KEYS, ...core.storage.keys()])].map((key) => [key, JSON.stringify(core.storage.get(key))]));
const storeWrites = (page) => page.calls.filter((call) => call.url.startsWith("/api/ui/store/")).map((call) => `${call.method} ${call.url.slice(14)}`);

async function answerSchool(run) {
  await run.next();
  assert.equal(run.step(), "school");
  await run.change({ id: "setupState", value: "BB" });
  await run.change({ name: "grade", value: "12" });
}

CASES["going through a stored plan without typing changes nothing but the answers"] = async () => {
  const page = await boot({ store: { "app-settings": { notify: { enabled: true } } } });
  const before = snapshot(page.core);
  page.flow.open({ from: "settings" });
  const run = driver(page);
  assert.equal(run.step(), "start");
  await answerSchool(run);
  for (const id of ["times", "weeks", "subjects", "details"]) {
    await run.next();
    assert.equal(run.step(), id);
  }
  for (const text of ['value="Fr. Krüger"', 'value="Hr. Wolf"', 'value="Herr Schmidt"', 'value="Bio2"', 'value="R114"', 'value="Ph1"']) assert.ok(run.stage().includes(text), `the details show ${text}`);
  await run.next();
  await run.next();
  assert.equal(run.step(), "done");
  await run.next();
  assert.deepEqual(page.visits, ["/hub"]);
  assert.deepEqual(storeWrites(page), ["PUT app-settings"]);
  assert.deepEqual({ ...snapshot(page.core), "app-settings": "" }, { ...before, "app-settings": "" });
  assert.deepEqual(page.core.storage.get("app-settings"), { notify: { enabled: true }, school: { grade: 12 } });
  assert.ok(page.calls.some((call) => call.url === "/api/hub/bundesland" && call.body.bundesland === "BB"));
};

CASES["a teacher or room typed like the stored one stays the stored one"] = async () => {
  const page = await boot();
  page.flow.open({});
  const run = driver(page);
  await answerSchool(run);
  await run.next();
  await run.next();
  await run.next();
  await run.pick("Deutsch");
  await run.next();
  assert.equal(run.step(), "details");
  await run.type("teacher", "Biologie", "fr. krüger");
  await run.type("teacher", "Mathematik", "Frau Krüger");
  await run.type("room", "Physik", "PH1");
  await run.type("teacher", "Deutsch", "Fr. Beck");
  await run.type("room", "Deutsch", "r 101");
  await run.next();
  assert.equal(run.step(), "grid");
  const store = (key) => page.core.storage.get(key);
  assert.deepEqual(store("app-teachers"), { items: { "t-frau-beck": { custom: true, title: "Frau", name: "Beck" } }, removed: [] });
  assert.deepEqual(store("app-rooms"), { added: ["R 101"], removed: [] });
  const { items } = store("app-subjects");
  assert.deepEqual(items["s-mathematik"], { teacher: "t-fr-krueger" });
  assert.equal(items["s-biologie"], undefined);
  assert.equal(items["s-physik"], undefined);
  const german = Object.values(items).find((item) => item.name === "Deutsch");
  assert.equal(german.teacher, "t-frau-beck");
  assert.equal(german.room, "R 101");
  assert.deepEqual(page.core.data.teachers.map((teacher) => teacher.label).sort(), ["Fr. Krüger", "Frau Beck", "Herr Schmidt", "Hr. Wolf"]);
  assert.deepEqual(page.core.data.rooms, ["Bio2", "Ph1", "R 101", "R114"]);
};

CASES["a room removed from the list and typed again comes back as it was written"] = async () => {
  const page = await boot({ store: { "app-rooms": { added: [], removed: ["Ph1"] } } });
  page.flow.open({});
  const run = driver(page);
  await answerSchool(run);
  for (let index = 0; index < 4; index += 1) await run.next();
  assert.equal(run.step(), "details");
  await run.type("room", "Biologie", "PH1");
  await run.next();
  assert.equal(page.core.storage.get("app-rooms"), null);
  assert.deepEqual(page.core.storage.get("app-subjects").items["s-biologie"], { room: "Ph1" });
  assert.deepEqual(page.core.data.rooms, ["Bio2", "Ph1", "R114"]);
};

CASES["closing keeps what the open step holds"] = async () => {
  const page = await boot({ plan: EMPTY });
  page.flow.open({ from: "home" });
  const run = driver(page);
  await answerSchool(run);
  await run.next();
  await run.change({ name: "times", value: "45" });
  await run.next();
  await run.change({ name: "ab", value: "no" });
  await run.next();
  await run.pick("Deutsch");
  await run.pick("Mathematik");
  await run.next();
  assert.equal(run.step(), "details");
  await run.type("teacher", "Deutsch", "Frau Beck");
  await run.type("room", "Deutsch", "R101");
  await run.fire("cancel", { preventDefault() {} });
  assert.deepEqual(page.visits, ["reload"]);
  assert.deepEqual(page.core.storage.get("app-teachers").items, { "t-frau-beck": { custom: true, title: "Frau", name: "Beck" } });
  const german = Object.values(page.core.storage.get("app-subjects").items).find((item) => item.name === "Deutsch");
  assert.equal(german.teacher, "t-frau-beck");
  assert.equal(german.room, "R101");
  assert.equal(page.core.storage.get("app-block-times").blocks.length, 8);
  assert.equal(page.core.storage.get("app-ab-weeks"), false);
};

CASES["closing a step left half done keeps nothing of it"] = async () => {
  const page = await boot({ plan: EMPTY });
  page.flow.open({});
  const run = driver(page);
  await answerSchool(run);
  await run.next();
  await run.change({ name: "times", value: "90" });
  await run.next();
  await run.change({ name: "ab", value: "yes" });
  await run.fire("click", { target: run.control("[data-setup-close]") });
  assert.equal(page.core.storage.get("app-ab-weeks"), null);
  assert.deepEqual(storeWrites(page), ["PUT app-settings"]);
};

CASES["closing after only tapping another period length keeps the stored times"] = async () => {
  const page = await boot();
  page.flow.open({});
  const run = driver(page);
  await answerSchool(run);
  await run.next();
  assert.equal(run.step(), "times");
  await run.change({ name: "times", value: "45" });
  await run.fire("cancel", { preventDefault() {} });
  assert.equal(page.core.storage.get("app-block-times"), null);
  assert.deepEqual(storeWrites(page), ["PUT app-settings"]);
};

CASES["closing after changing the count keeps the new times"] = async () => {
  const page = await boot();
  page.flow.open({});
  const run = driver(page);
  await answerSchool(run);
  await run.next();
  await run.change({ name: "times", value: "45" });
  await run.fire("click", { target: run.control("[data-count]", { dataset: { count: "1" } }) });
  await run.fire("cancel", { preventDefault() {} });
  assert.equal(page.core.storage.get("app-block-times").blocks.length, 9);
};

async function toDone(run) {
  await answerSchool(run);
  for (let index = 0; index < 6; index += 1) await run.next();
  assert.equal(run.step(), "done");
}

CASES["the last step says reminders are on only when they are switched on"] = async () => {
  const page = await boot({ store: { "app-settings": { notify: { enabled: false, chosen: true } } }, notification: "granted" });
  page.flow.open({});
  const run = driver(page);
  await toDone(run);
  assert.ok(run.stage().includes("Sind aus.") && run.stage().includes("data-setup-remind-on"), "a granted permission with reminders off offers to switch them on");
  assert.ok(!run.stage().includes("Sind an."));
  await run.fire("click", { target: run.control("[data-setup-remind-on]") });
  assert.deepEqual(page.core.storage.get("app-settings").notify, { enabled: true, chosen: true });
  const row = run.dialog.querySelector("#setupStage").querySelector("#setupRemind");
  assert.ok(row.outerHTML.includes("Sind an.") && !row.outerHTML.includes("data-setup-remind-on"));
};

CASES["reminders switched on and allowed are reported as on"] = async () => {
  const page = await boot({ store: { "app-settings": { notify: { enabled: true } } }, notification: "granted" });
  page.flow.open({});
  const run = driver(page);
  await toDone(run);
  assert.ok(run.stage().includes("Sind an.") && !run.stage().includes("data-setup-remind"));
};

CASES["an off stored along from the old default is reported as on"] = async () => {
  const page = await boot({ store: { "app-settings": { notify: { enabled: false }, school: { grade: 12 } } }, notification: "granted" });
  page.flow.open({});
  const run = driver(page);
  await toDone(run);
  assert.ok(run.stage().includes("Sind an.") && !run.stage().includes("data-setup-remind"));
};

async function toWeeks(run) {
  await answerSchool(run);
  await run.next();
  await run.change({ name: "times", value: "90" });
  await run.next();
  assert.equal(run.step(), "weeks");
}

CASES["what is picked or typed in the setup is recorded as an own edit of this device"] = async () => {
  const page = await boot({ plan: EMPTY });
  page.flow.open({});
  const run = driver(page);
  await answerSchool(run);
  assert.equal(page.core.planMeta(), null, "the class and the Bundesland are no part of the plan");
  await run.next();
  await run.change({ name: "times", value: "45" });
  await run.next();
  assert.equal(run.step(), "weeks");
  const times = page.core.planMeta();
  assert.equal(times.origin, "edit");
  assert.equal(times.device, DEVICE);
  await run.change({ name: "ab", value: "yes" });
  await run.change({ name: "letter", value: "B" });
  await run.next();
  await run.pick("Deutsch");
  await run.next();
  await run.type("room", "Deutsch", "R101");
  await run.next();
  assert.equal(run.step(), "grid");
  const record = page.core.planMeta();
  assert.equal(record.origin, "edit");
  assert.ok(record.at > times.at);
  assert.equal(storeWrites(page).filter((write) => write === "PUT app-timetable-meta").length, 4, "one change for each step that changed the plan");
};

CASES["on a weekend the A/B question is about the coming week and waits for Weiter"] = async () => {
  const page = await boot({ plan: EMPTY, search: "?datum=2026-11-07&t=10:00" });
  page.flow.open({});
  const run = driver(page);
  await toWeeks(run);
  assert.ok(run.stage().includes("Ist die Woche ab Montag, dem 9. November, eine A-Woche?"));
  await run.change({ name: "ab", value: "yes" });
  await run.change({ name: "letter", value: "A" });
  await new Promise((done) => setTimeout(done, 450));
  assert.equal(run.step(), "weeks", "choosing an answer does not leave the step");
  await run.next();
  assert.equal(run.step(), "subjects");
  assert.equal(page.core.storage.get("app-ab-weeks"), true);
  assert.equal(page.core.weekType(new Date(2026, 10, 9, 9)), "A");
  assert.equal(page.core.weekType(new Date(2026, 10, 6, 9)), "B");
};

CASES["on a school day the A/B question is about this week"] = async () => {
  const page = await boot({ plan: EMPTY, search: "?datum=2026-11-04&t=10:00" });
  page.flow.open({});
  const run = driver(page);
  await toWeeks(run);
  assert.ok(run.stage().includes("Ist diese Woche, KW 45, eine A-Woche?"));
  await run.change({ name: "ab", value: "yes" });
  await run.change({ name: "letter", value: "B" });
  await run.next();
  assert.equal(page.core.weekType(new Date(2026, 10, 4, 9)), "B");
  assert.equal(page.core.weekType(new Date(2026, 10, 9, 9)), "A");
};

const only = process.argv[2];
if (only) {
  await CASES[only]();
  console.log(`ok   ${only}`);
  process.exit(0);
}
let failed = 0;
for (const name of Object.keys(CASES)) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name], { encoding: "utf8", timeout: 60000 });
  if (result.status === 0) {
    process.stdout.write(result.stdout);
  } else {
    failed += 1;
    console.log(`FAIL ${name}\n${result.stdout}${result.stderr}`);
  }
}
process.exit(failed ? 1 : 0);
