// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Every change of the timetable leaves a record of when it happened, where it came from and on which device. Each case
// runs in its own node process, so it starts from the stores it names and from a clock of its own.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = (name) => pathToFileURL(resolve(here, "../../app/static/app/js", name)).href;

const META = "app-timetable-meta";
const DEVICE = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const BLOCKS = [{ n: 1, start: "08:00", end: "09:30" }, { n: 2, start: "09:50", end: "11:20" }, { n: 3, start: "11:30", end: "13:00" }];
const week = (days = {}) => ({ 1: [], 2: [], 3: [], 4: [], 5: [], ...days });
const EMPTY = { subjects: {}, courses: {}, timetable: { A: week(), B: week() } };
const LESSONS = { "A:1:1": { subject: "s-mathe", room: "R1" }, "A:2:2": { subject: "s-mathe", room: "R2" } };
const SUBJECTS = { items: { "s-mathe": { custom: true, name: "Mathe", short: "Ma", hue: "slate", type: "GK" } }, removed: [] };

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

async function boot({ store = {}, plan = EMPTY, device = DEVICE, now = 1_800_000_000_000, failing = false, again = "" } = {}) {
  const page = {
    user: { state: "BB", grade: 12, iserv: "desktop" },
    blocks: BLOCKS,
    ...plan,
    abReference: "2026-01-12",
    changes: [], tasks: [], taskPool: [], deadlines: [], events: [], holidays: [], weather: { hours: [] }, status: {},
    ...(device ? { device } : {}),
  };
  const nodes = { appData: { textContent: JSON.stringify(page) }, appStore: { textContent: JSON.stringify(store) } };
  const server = new Map(Object.entries(store));
  const calls = [];
  const local = new Map();
  const session = new Map();
  const clock = { now };
  Date.now = () => clock.now;
  const events = new EventTarget();
  globalThis.addEventListener = events.addEventListener.bind(events);
  globalThis.removeEventListener = events.removeEventListener.bind(events);
  globalThis.dispatchEvent = events.dispatchEvent.bind(events);
  globalThis.localStorage = { getItem: (key) => (local.has(key) ? local.get(key) : null), setItem: (key, value) => local.set(key, String(value)), removeItem: (key) => local.delete(key) };
  globalThis.sessionStorage = { getItem: (key) => (session.has(key) ? session.get(key) : null), setItem: (key, value) => session.set(key, String(value)), removeItem: (key) => session.delete(key) };
  const head = element("head");
  head.append = (node) => node.listeners.load?.forEach((fn) => fn());
  const dialogs = [];
  globalThis.document = {
    documentElement: { dataset: { brand: "App", motion: "minimal" }, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, style: { setProperty() {} }, matches: () => false, querySelectorAll: () => [] },
    head,
    body: { append: (node) => dialogs.push(node) },
    activeElement: null,
    getElementById: (id) => nodes[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    dispatchEvent: () => true,
    createElement: (tag) => element(tag),
    hidden: false,
    visibilityState: "visible",
  };
  globalThis.HTMLElement = class {};
  globalThis.location = { search: "", hash: "", pathname: "/hub/settings", href: "http://127.0.0.1/hub/settings", reload() {}, assign() {} };
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
    const call = { method: options.method || "GET", url: String(url), body: options.body === undefined ? undefined : JSON.parse(options.body) };
    calls.push(call);
    const key = decodeURIComponent(call.url.replace("/api/ui/store/", ""));
    if (failing && call.url.startsWith("/api/ui/store/")) return { ok: false, status: 503, json: async () => ({}) };
    if (call.url.startsWith("/api/ui/store/")) {
      if (call.method === "DELETE") server.delete(key);
      else server.set(key, call.body);
    }
    return { ok: true, json: async () => ({ success: true }) };
  };
  const core = await import(`${script("core.js")}${again}`);
  return {
    core,
    calls,
    clock,
    server,
    nodes,
    dialog: () => dialogs.at(-1),
    stamps: () => calls.filter((call) => call.url === `/api/ui/store/${META}`).map((call) => call.body),
  };
}

const tick = () => new Promise((done) => setTimeout(done, 0));

const CASES = {};

CASES["an own edit is recorded with its time, as an edit, on this device"] = async () => {
  const page = await boot();
  assert.deepEqual(page.calls, [], "loading the page writes nothing");
  assert.equal(page.core.planMeta(), null);
  page.core.storage.set("app-timetable-edits", LESSONS);
  await tick();
  assert.deepEqual(page.core.planMeta(), { at: 1_800_000_000_000, origin: "edit", device: DEVICE });
  assert.deepEqual(page.server.get(META), { at: 1_800_000_000_000, origin: "edit", device: DEVICE, seen: 1_800_000_000_000 });
};

CASES["the writes of one action are one change with one time"] = async () => {
  const page = await boot();
  page.core.storage.set("app-subjects", SUBJECTS);
  page.core.storage.set("app-rooms", { added: ["R1", "R2"], removed: [] });
  page.core.storage.set("app-timetable-edits", LESSONS);
  page.core.storage.set("app-settings", { school: { grade: 12 } });
  await page.core.storage.settled();
  assert.equal(page.stamps().length, 1);
  assert.equal(page.core.planMeta().at, 1_800_000_000_000);
  page.core.storage.remove("app-rooms");
  await tick();
  assert.equal(page.stamps().length, 2);
  assert.equal(page.core.planMeta().at, 1_800_000_000_001, "the next change is later even where the clock did not move on");
};

CASES["the clock never goes back, also after a restart"] = async () => {
  const page = await boot({ now: 5_000_000 });
  page.core.storage.set("app-timetable-edits", LESSONS);
  await tick();
  assert.equal(page.core.planMeta().at, 5_000_000);
  page.clock.now = 1_000;
  page.core.storage.set("app-ab-swap", true);
  await tick();
  assert.equal(page.core.planMeta().at, 5_000_001, "a clock set back does not date the change before the last one");
  page.clock.now = 7_000_000;
  page.core.storage.remove("app-ab-swap");
  await tick();
  assert.equal(page.core.planMeta().at, 7_000_000, "a clock that is ahead counts as it is");
  await page.core.storage.settled();
  const saved = Object.fromEntries(page.server);
  assert.equal(saved[META].seen, 7_000_000);
  const later = await boot({ store: saved, now: 2_000, again: "?restart" });
  assert.deepEqual(later.calls, []);
  later.core.storage.set("app-timetable-edits", { "A:1:1": null });
  await tick();
  assert.equal(later.core.planMeta().at, 7_000_001, "the time seen before the restart still counts");
};

CASES["writes that leave the plan as it was, or touch no plan, record nothing"] = async () => {
  const page = await boot({ store: { "app-timetable-edits": { "A:2:2": { room: "R2", subject: "s-mathe" }, "A:1:1": { subject: "s-mathe", room: "R1" } }, "app-subjects": SUBJECTS } });
  page.core.storage.set("app-timetable-edits", LESSONS);
  page.core.storage.set("app-subjects", JSON.parse(JSON.stringify(SUBJECTS)));
  page.core.storage.remove("app-block-times");
  page.core.storage.set("app-settings", { school: { grade: 11 } });
  page.core.storage.set("app-theme-choice", "dark");
  page.core.storage.set("app-task-filter", "alle");
  await page.core.storage.settled();
  assert.deepEqual(page.stamps(), []);
  assert.equal(page.core.planMeta(), null);
};

CASES["a default the app stores on its own is no change, also next to own writes"] = async () => {
  const plan = { ...EMPTY, timetable: { A: week({ 1: [{ block: 1, subject: "s-mathe", room: "R1", teacher: "" }] }), B: week() } };
  const page = await boot({ store: { "app-timetable-edits": LESSONS }, plan });
  const fill = () => page.core.planChange(null, () => page.core.storage.set("app-ab-weeks", page.core.abWeeks()));
  assert.equal(page.core.abAnswered(), false);
  fill();
  page.core.storage.set("app-timetable-edits", { "A:1:1": null });
  page.core.storage.set("app-timetable-edits", LESSONS);
  await page.core.storage.settled();
  assert.equal(page.core.abAnswered(), true, "the A/B default is stored");
  assert.deepEqual(page.stamps(), [], "an action that ends where it began, with the default filled in, is no change");

  const next = await boot({ store: { "app-timetable-edits": LESSONS }, plan, again: "?again" });
  next.core.storage.set("app-block-times", { v: 2, blocks: BLOCKS.slice(0, 2) });
  next.core.planChange(null, () => next.core.storage.set("app-ab-weeks", next.core.abWeeks()));
  next.core.storage.set("app-timetable-edits", { "A:1:1": { subject: "s-mathe", room: "R1" } });
  await next.core.storage.settled();
  assert.equal(next.stamps().length, 1);
  assert.equal(next.core.planMeta().origin, "edit");

  const answer = await boot({ store: { "app-timetable-edits": LESSONS }, plan, again: "?answer" });
  answer.core.storage.set("app-ab-weeks", answer.core.abWeeks());
  await answer.core.storage.settled();
  assert.equal(answer.core.planMeta()?.origin, "edit", "an answer someone gives is a change, even where it matches the default");
};

CASES["the record is written by changes of the plan only and is not one of the stored values"] = async () => {
  const theirs = { at: 9_000_000_000_000, origin: "edit", device: "ffffffffffffffffffffffffffffffff", seen: 9_000_000_000_000 };
  const page = await boot({ store: { "app-settings": { school: { grade: 12 } } } });
  page.core.storage.set(META, theirs);
  page.core.storage.remove(META);
  await tick();
  assert.equal(page.core.planMeta(), null);
  assert.deepEqual(page.calls, []);
  page.core.storage.set("app-timetable-edits", LESSONS);
  await tick();
  assert.deepEqual(page.core.storage.keys().sort(), ["app-settings", "app-timetable-edits"]);
  assert.equal(page.core.storage.get(META).device, DEVICE);
};

CASES["an import and a shared plan are recorded as such, and each batch of writes is one change"] = async () => {
  const page = await boot();
  page.core.planChange("import", () => {
    page.core.storage.set("app-subjects", SUBJECTS);
    page.core.storage.set("app-timetable-edits", LESSONS);
    page.core.planChange("edit", () => page.core.storage.set("app-rooms", { added: ["R1"], removed: [] }));
  });
  assert.deepEqual(page.core.planMeta(), { at: 1_800_000_000_000, origin: "import", device: DEVICE });
  await tick();
  assert.equal(page.stamps().length, 1, "writes inside planChange join it");
  page.core.planChange("share", () => page.core.storage.set("app-timetable-edits", { ...LESSONS, "A:3:1": { subject: "s-mathe", room: "R3" } }));
  assert.equal(page.core.planMeta().origin, "share");
  assert.equal(page.core.planMeta().at, 1_800_000_000_001);
  const result = page.core.planChange("import", () => {
    page.core.storage.set("app-timetable-edits", LESSONS);
    page.core.storage.set("app-timetable-edits", { ...LESSONS, "A:3:1": { subject: "s-mathe", room: "R3" } });
    return "same";
  });
  assert.equal(result, "same");
  assert.equal(page.core.planMeta().origin, "share", "a batch that ends where it started is no change");
};

CASES["an action in several steps keeps one time, unless an own edit came between"] = async () => {
  const page = await boot();
  const fromFile = page.core.planChange("import");
  fromFile(() => page.core.storage.set("app-subjects", SUBJECTS));
  const first = page.core.planMeta();
  assert.equal(first.origin, "import");
  page.clock.now += 5_000;
  fromFile(() => page.core.storage.set("app-timetable-edits", LESSONS));
  assert.deepEqual(page.core.planMeta(), first);
  page.core.storage.set("app-ab-swap", true);
  await tick();
  assert.equal(page.core.planMeta().origin, "edit");
  fromFile(() => page.core.storage.remove("app-timetable-edits"));
  assert.equal(page.core.planMeta().origin, "import");
  assert.ok(page.core.planMeta().at > first.at + 5_000 - 1);
};

CASES["taking back an import brings back the record from before it, and the clock stays ahead"] = async () => {
  const earlier = { at: 1_700_000_000_000, origin: "edit", device: DEVICE, seen: 1_700_000_000_000 };
  const page = await boot({ store: { "app-timetable-edits": LESSONS, [META]: earlier } });
  const before = page.core.planMeta();
  page.core.planChange("import", () => page.core.storage.remove("app-timetable-edits"));
  assert.equal(page.core.planMeta().at, 1_800_000_000_000);
  page.core.planRevert(before, () => page.core.storage.set("app-timetable-edits", LESSONS));
  assert.deepEqual(page.core.planMeta(), { at: 1_700_000_000_000, origin: "edit", device: DEVICE });
  assert.equal(page.core.storage.get(META).seen, 1_800_000_000_000);
  page.core.planRevert(null, () => page.core.storage.remove("app-timetable-edits"));
  assert.equal(page.core.planMeta(), null, "a plan put back to the start has no change of its own");
  assert.deepEqual(page.core.storage.get(META), { seen: 1_800_000_000_000 });
  page.clock.now = 1_000;
  page.core.storage.set("app-timetable-edits", LESSONS);
  await tick();
  assert.equal(page.core.planMeta().at, 1_800_000_000_001);
};

CASES["a page without a device id still records the change"] = async () => {
  const page = await boot({ device: null });
  page.core.storage.set("app-timetable-edits", LESSONS);
  await tick();
  assert.deepEqual(page.core.planMeta(), { at: 1_800_000_000_000, origin: "edit", device: null });
};

async function share(page) {
  const { initPlanShare, importFlow } = await import(script("plan-share.js"));
  initPlanShare();
  return importFlow;
}

async function apply(page) {
  for (let turn = 0; turn < 20 && !page.dialog(); turn += 1) await tick();
  const body = page.dialog().querySelector("#shareBody");
  for (let turn = 0; turn < 20 && !body.querySelector("#shareApply").listeners.click; turn += 1) await tick();
  for (const listener of body.querySelector("#shareApply").listeners.click) await listener({});
  await page.core.storage.settled();
  return body;
}

async function sharedModel() {
  const format = await import(script("plan-format.js"));
  return format.planOf({
    subjects: { m: { name: "Mathe", short: "Ma", hue: "slate", type: "LK", teacherId: "", room: "R1" }, d: { name: "Deutsch", short: "De", hue: "brick", type: "GK", teacherId: "", room: "R2" } },
    teachers: [],
    rooms: ["R1", "R2"],
    blocks: BLOCKS,
    timetable: { A: week({ 1: [{ block: 1, subject: "m", room: "R1" }], 2: [{ block: 2, subject: "d", room: "R2" }] }), B: week({ 1: [{ block: 1, subject: "m", room: "R1" }] }) },
    edits: null,
    weeks: true,
    abReference: "2026-01-12",
  });
}

CASES["a file picker closed without a file leaves the import open, only its own Escape closes it"] = async () => {
  const page = await boot();
  const importFlow = await share(page);
  let closed = "open";
  importFlow().then((result) => (closed = result));
  for (let turn = 0; turn < 20 && !page.dialog()?.open; turn += 1) await tick();
  const sheet = page.dialog();
  assert.equal(sheet.open, true);
  const picker = sheet.querySelector("#shareBody").querySelector("#shareFileInput");
  let prevented = false;
  for (const listener of sheet.listeners.cancel) listener({ target: picker, preventDefault: () => (prevented = true) });
  await tick();
  assert.equal(closed, "open", "the dismissed file picker's own cancel does not end the import");
  assert.equal(prevented, false, "and is left alone");
  for (const listener of sheet.listeners.cancel) listener({ target: sheet, preventDefault: () => (prevented = true) });
  await tick();
  assert.equal(closed, null, "Escape on the sheet closes it without a plan");
  assert.equal(prevented, true);
};

CASES["a plan taken over from a link is recorded as shared, not as an own edit"] = async () => {
  const page = await boot();
  const importFlow = await share(page);
  const format = await import(script("plan-format.js"));
  const link = format.linkOf("https://example.org", await format.encodePlan(await sharedModel()));
  importFlow({ text: link });
  await apply(page);
  assert.ok(page.core.storage.get("app-timetable-edits"), "the plan was written");
  assert.deepEqual(page.core.planMeta(), { at: 1_800_000_000_000, origin: "share", device: DEVICE });
  assert.equal(page.stamps().length, 1);
};

CASES["a shared plan file is recorded as shared"] = async () => {
  const page = await boot();
  const importFlow = await share(page);
  const format = await import(script("plan-format.js"));
  const text = JSON.stringify(format.planFile(await sharedModel(), "App", "2026-11-10T10:00:00.000Z"));
  importFlow({ file: { name: "plan.json", text: async () => text } });
  await apply(page);
  assert.equal(page.core.planMeta().origin, "share");
};

CASES["the timetable from a backup is recorded as an import with this device, whatever record the file holds"] = async () => {
  const page = await boot();
  const importFlow = await share(page);
  const { wholeSchool } = await import(script("backup.js"));
  const theirs = { at: 9_000_000_000_000, origin: "edit", device: "ffffffffffffffffffffffffffffffff", seen: 9_000_000_000_000 };
  const values = wholeSchool({
    subjects: { m: { name: "Mathe", short: "Ma", hue: "slate", type: "GK", teacherId: "", room: "R1" } },
    teachers: [],
    rooms: ["R1"],
    blocks: BLOCKS,
    timetable: { A: week({ 1: [{ block: 1, subject: "m", room: "R1" }] }), B: week() },
    edits: null,
    gone: {},
    weeks: true,
  });
  const payload = { app: "App", version: 2, values: Object.fromEntries(Object.entries({ ...values, [META]: theirs }).map(([key, value]) => [key, JSON.stringify(value)])), school: { abReference: "2026-01-12", subjects: {} } };
  importFlow({ backup: payload });
  await apply(page);
  assert.ok(page.core.storage.get("app-timetable-edits"));
  assert.deepEqual(page.core.planMeta(), { at: 1_800_000_000_000, origin: "import", device: DEVICE });
};

CASES["a shared plan that could not be saved leaves the record as it was"] = async () => {
  const earlier = { at: 1_700_000_000_000, origin: "edit", device: DEVICE, seen: 1_700_000_000_000 };
  const page = await boot({ store: { [META]: earlier }, failing: true });
  const importFlow = await share(page);
  const format = await import(script("plan-format.js"));
  importFlow({ text: format.linkOf("https://example.org", await format.encodePlan(await sharedModel())) });
  const body = await apply(page);
  assert.match(body.querySelector("#shareError").innerHTML, /nicht speichern/);
  assert.deepEqual(page.core.planMeta(), { at: 1_700_000_000_000, origin: "edit", device: DEVICE });
  assert.equal(page.core.storage.get("app-timetable-edits"), null);
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
