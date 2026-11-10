// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Drives the settings page on a forgiving stand-in for the page and checks what each way of changing the plan leaves
// in its record. Every case runs in its own node process.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = (name) => pathToFileURL(resolve(here, "../../app/static/app/js", name)).href;

const META = "app-timetable-meta";
const DEVICE = "5e7c0f3a9b214d6e8a1f0c2b3d4e5f60";
const FOREIGN = "ffffffffffffffffffffffffffffffff";
const BLOCKS = [{ n: 1, start: "08:00", end: "09:30" }, { n: 2, start: "09:50", end: "11:20" }];
const week = (days = {}) => ({ 1: [], 2: [], 3: [], 4: [], 5: [], ...days });
const EARLIER = { at: 1_700_000_000_000, origin: "edit", device: DEVICE, seen: 1_700_000_000_000 };

const FALSE = new Set(["disabled", "hidden", "checked", "open", "isConnected"]);
const created = [];

// Every element the page asks for exists, answers calls it does not know with nothing, and keeps its listeners.
function node(tag = "div") {
  const children = new Map();
  const target = {
    tagName: tag.toUpperCase(),
    listeners: {},
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    attributes: {},
    hidden: false,
    disabled: false,
    checked: false,
    open: false,
    value: "",
    className: "",
    innerHTML: "",
    textContent: "",
    options: [],
    children: [],
    childNodes: [],
    content: { childNodes: [] },
    files: [],
    addEventListener(type, fn) {
      (target.listeners[type] ||= []).push(fn);
    },
    removeEventListener() {},
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, node());
      return children.get(selector);
    },
    querySelectorAll: () => [],
    append() {},
    replaceChildren() {},
    getAnimations: () => [],
    animate: () => ({ finished: Promise.resolve(), cancel() {}, addEventListener() {} }),
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
    setAttribute(name, value) {
      target.attributes[name] = value;
    },
    getAttribute: (name) => target.attributes[name] ?? null,
    matches: () => false,
    contains: () => false,
    closest: () => null,
  };
  return new Proxy(target, {
    get(object, key) {
      if (key in object) return object[key];
      if (key === "then" || typeof key === "symbol") return undefined;
      if (FALSE.has(key)) return false;
      return () => undefined;
    },
    set(object, key, value) {
      object[key] = value;
      return true;
    },
  });
}

async function boot({ store = {}, plan = { subjects: {}, courses: {}, timetable: { A: week(), B: week() } }, now = 1_800_000_000_000, tour = null } = {}) {
  const data = {
    user: { state: "BB", grade: 12, iserv: "desktop" },
    blocks: BLOCKS,
    ...plan,
    abReference: "2026-01-12",
    changes: [], tasks: [], taskPool: [], deadlines: [], events: [], holidays: [], weather: { hours: [] }, status: {},
    device: DEVICE,
    page: { school: { grade: 12, state: "BB" }, states: [{ code: "BB", name: "Brandenburg" }], courses: {}, accounts: { iserv: {}, google: {} }, notifications: {}, subjectUse: {}, places: {}, about: {} },
  };
  const nodes = new Map([["appData", { textContent: JSON.stringify(data) }], ["appStore", { textContent: JSON.stringify(store) }]]);
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, node());
    return nodes.get(id);
  };
  const server = new Map(Object.entries(store));
  const clock = { now };
  Date.now = () => clock.now;
  const events = new EventTarget();
  globalThis.addEventListener = events.addEventListener.bind(events);
  globalThis.removeEventListener = events.removeEventListener.bind(events);
  globalThis.dispatchEvent = events.dispatchEvent.bind(events);
  const local = new Map();
  globalThis.localStorage = globalThis.sessionStorage = { getItem: (key) => local.get(key) ?? null, setItem: (key, value) => local.set(key, String(value)), removeItem: (key) => local.delete(key) };
  const html = node("html");
  html.dataset.brand = "App";
  html.dataset.motion = "minimal";
  globalThis.document = {
    documentElement: html,
    head: node("head"),
    body: node("body"),
    activeElement: null,
    getElementById: byId,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
    createElement: (tag) => {
      const made = node(tag);
      created.push(made);
      return made;
    },
    createDocumentFragment: () => node(),
    createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: 0 }) }),
    hidden: false,
    visibilityState: "visible",
  };
  globalThis.HTMLElement = class {};
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.location = { search: "", hash: "", pathname: "/hub/settings", href: "http://127.0.0.1/hub/settings", reload() {}, assign() {} };
  globalThis.history = { state: null, replaceState() {} };
  globalThis.self = globalThis;
  globalThis.window = globalThis;
  Object.defineProperty(globalThis, "navigator", { value: { platform: "MacIntel", userAgent: "node", maxTouchPoints: 0 }, configurable: true });
  globalThis.matchMedia = (query) => ({ matches: query.includes("reduce"), addEventListener() {} });
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  globalThis.requestAnimationFrame = (run) => setTimeout(run, 0);
  globalThis.cancelAnimationFrame = () => {};
  globalThis.CSS = { escape: (text) => String(text) };
  globalThis.IntersectionObserver = globalThis.MutationObserver = globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const tours = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path === "/api/hub/tour") {
      if (options.method === "POST") tours.push(JSON.parse(options.body).state);
      return { ok: true, status: 200, json: async () => ({ success: true, state: tour }) };
    }
    if (path.startsWith("/api/ui/store/")) {
      const key = decodeURIComponent(path.slice(14));
      if (options.method === "DELETE") server.delete(key);
      else server.set(key, JSON.parse(options.body));
    }
    const answer = path.startsWith("/api/ui/export") ? { tasks: [], deadlines: [], grades: [], notes: [], events: [], places: {} } : {};
    return { ok: true, status: 200, json: async () => ({ success: true, data: answer }) };
  };
  const files = [];
  globalThis.hubShell = { saveFile: async (name, text) => (files.push(JSON.parse(text)), { name, folder: "Downloads" }) };
  const core = await import(script("core.js"));
  await import(pathToFileURL(resolve(here, "../../app/static/js/tour.js")).href);
  const settings = await import(script("pages/settings.js"));
  settings.init();
  const settle = async () => {
    for (let turn = 0; turn < 30; turn += 1) await new Promise((done) => setTimeout(done, 0));
    await core.storage.settled();
  };
  const click = async (card, selector) => {
    for (const listener of byId(card).listeners.click || []) await listener({ target: { closest: (wanted) => (wanted === selector ? {} : null) } });
    await settle();
  };
  const undo = async () => {
    const button = created.filter((made) => made.className === "toast-action").at(-1);
    for (const listener of button.listeners.click) await listener({});
    await settle();
  };
  const importFile = async (payload) => {
    const input = byId("importFile");
    input.files = [{ name: "sicherung.json", text: async () => JSON.stringify(payload) }];
    for (const listener of input.listeners.change) await listener({});
    await settle();
  };
  return { core, server, clock, files, click, undo, importFile, settle, tours, local };
}

async function backupFile() {
  const { wholeSchool } = await import(script("backup.js"));
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
  const theirs = { at: 9_000_000_000_000, origin: "edit", device: FOREIGN, seen: 9_000_000_000_000 };
  const entries = { ...values, [META]: theirs, "app-theme-choice": "dark" };
  return { app: "App", version: 2, values: Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)])), school: { abReference: "2026-01-12", subjects: {} } };
}

const CASES = {};

CASES["a backup taken over in whole is an import of this device, whatever record the file holds"] = async () => {
  const page = await boot({ store: { [META]: EARLIER } });
  await page.importFile(await backupFile());
  assert.deepEqual(page.core.storage.get("app-timetable-edits")["A:1:1"], { subject: "m", room: "R1" });
  assert.equal(page.core.storage.get("app-theme-choice"), "dark");
  assert.deepEqual(page.core.planMeta(), { at: 1_800_000_000_000, origin: "import", device: DEVICE });
  assert.deepEqual(page.server.get(META), { at: 1_800_000_000_000, origin: "import", device: DEVICE, seen: 1_800_000_000_000 });
};

CASES["undoing a backup brings back the record from before it"] = async () => {
  const page = await boot({ store: { [META]: EARLIER } });
  await page.importFile(await backupFile());
  assert.equal(page.core.planMeta().origin, "import");
  await page.undo();
  assert.equal(page.core.storage.get("app-timetable-edits"), null);
  assert.deepEqual(page.core.planMeta(), { at: 1_700_000_000_000, origin: "edit", device: DEVICE });
  assert.equal(page.server.get(META).seen, 1_800_000_000_000, "the clock keeps the time it saw");
};

CASES["a backup made here carries neither the record nor the device id"] = async () => {
  const page = await boot({ store: { "app-timetable-edits": { "A:1:1": null }, [META]: EARLIER } });
  await page.click("rhythmCard", "#abSwap");
  assert.equal(page.core.planMeta().origin, "edit");
  await page.click("dataCard", "#dataExport");
  assert.equal(page.files.length, 1);
  const text = JSON.stringify(page.files[0]);
  assert.ok(Object.keys(page.files[0].values).includes("app-ab-swap"));
  assert.ok(!text.includes(META), "the record stays on the device");
  assert.ok(!text.includes(DEVICE), "the device id stays on the device");
};

CASES["a backup carries a finished tutorial"] = async () => {
  const page = await boot({ tour: "done" });
  await page.click("dataCard", "#dataExport");
  assert.equal(page.files[0].tour, "done");
};

CASES["a backup does not carry a tutorial that never ended"] = async () => {
  const page = await boot({ tour: null });
  await page.click("dataCard", "#dataExport");
  assert.equal(page.files[0].tour, undefined);
};

CASES["taking over a backup with a finished tutorial ends an unfinished one here for good"] = async () => {
  const page = await boot({ tour: null });
  page.local.set("app-tour", JSON.stringify({ id: "task-new", at: 1_800_000_000_000 }));
  await page.importFile({ ...(await backupFile()), tour: "done" });
  assert.deepEqual(page.tours, ["done"], "the state is saved on this device");
  assert.equal(page.local.get("app-tour"), undefined, "the unfinished run is forgotten");
};

CASES["a backup without a finished tutorial leaves the tutorial alone"] = async () => {
  const page = await boot({ tour: null });
  page.local.set("app-tour", JSON.stringify({ id: "task-new", at: 1_800_000_000_000 }));
  await page.importFile({ ...(await backupFile()), tour: "halfway" });
  assert.deepEqual(page.tours, []);
  assert.ok(page.local.get("app-tour"));
};

CASES["deleting everything on this device leaves the plan without a change of its own, and undo brings it back"] = async () => {
  const page = await boot({ store: { "app-ab-swap": true, [META]: EARLIER } });
  await page.click("dataCard", "#dataWipe");
  assert.equal(page.core.storage.get("app-ab-swap"), null);
  assert.equal(page.core.planMeta(), null);
  assert.deepEqual(page.server.get(META), { seen: 1_700_000_000_000 });
  await page.undo();
  assert.equal(page.core.storage.get("app-ab-swap"), true);
  assert.deepEqual(page.core.planMeta(), { at: 1_700_000_000_000, origin: "edit", device: DEVICE });
};

CASES["changes made in the settings are own edits, and one that changes nothing records nothing"] = async () => {
  const plan = { subjects: { m: { name: "Mathe", label: "Mathe", short: "Ma", hue: "slate" } }, courses: {}, timetable: { A: week({ 1: [{ block: 1, subject: "m", room: "R1", teacher: "" }] }), B: week({ 1: [{ block: 1, subject: "m", room: "R1", teacher: "" }] }) } };
  const page = await boot({ plan });
  await page.click("copyWeek", "");
  assert.equal(page.core.abAnswered(), true, "the A/B default was filled in");
  assert.equal(page.core.planMeta(), null, "copying a B week that is already like the A week is no change");
  assert.equal(page.server.get(META), undefined);
  await page.click("rhythmCard", "#abToggle");
  assert.equal(page.core.abWeeks(), false);
  assert.deepEqual(page.core.planMeta(), { at: 1_800_000_000_000, origin: "edit", device: DEVICE });
  page.clock.now -= 60_000;
  await page.undo();
  assert.equal(page.core.abWeeks(), true);
  assert.deepEqual(page.core.planMeta(), { at: 1_800_000_000_001, origin: "edit", device: DEVICE }, "undoing an own edit is an own edit");
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
