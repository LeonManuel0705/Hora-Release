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

function pageData(plan, user = {}, status = {}) {
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
    status,
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

async function boot({ plan = STORED, user = {}, status = {}, store = {}, search = "", path = "/hub", notification = null, agent = "node" } = {}) {
  const nodes = { appData: { textContent: JSON.stringify(pageData(plan, user, status)) }, appStore: { textContent: JSON.stringify(store) } };
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
    pathname: path,
    href: `http://127.0.0.1${path}${search}`,
    assign: (to) => visits.push(to),
    reload: () => visits.push("reload"),
  };
  globalThis.history = { state: null, replaceState: (state, title, to) => visits.push(`replace ${to}`) };
  globalThis.self = globalThis;
  globalThis.window = globalThis;
  Object.defineProperty(globalThis, "navigator", { value: { platform: "MacIntel", userAgent: agent }, configurable: true });
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
    const node = { dataset: {}, disabled: false, attributes: {}, ...extra };
    node.closest = (wanted) => (wanted === selector ? node : null);
    node.setAttribute = (name, value) => (node.attributes[name] = value);
    node.querySelector = () => null;
    node.focus = () => {};
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
    foot,
    async next() {
      assert.ok(!/data-setup-next[^>]*disabled/.test(foot()), `Weiter is off on the step ${step()}`);
      await fire("click", { target: control("[data-setup-next]") });
    },
    async until(id) {
      for (let turn = 0; turn < 10 && step() !== id; turn += 1) await this.next();
      assert.equal(step(), id);
    },
    course: async (name) => {
      const button = control("[data-course]", { dataset: { course: name } });
      await fire("click", { target: button });
      return button.attributes["aria-pressed"];
    },
    change: (target) => fire("change", { target: { dataset: {}, name: "", id: "", ...target } }),
    type: (field, name, value) => fire("input", { target: { dataset: { [field]: name }, value } }),
    pick: (name) => fire("click", { target: control("[data-pick]", { dataset: { pick: name } }) }),
    typeLesson: (key, value) => fire("input", { target: { dataset: { lesson: key }, value, removeAttribute() {} } }),
    lessons: () => [...stage().matchAll(/<label class="setup-lesson"><span>([^<]+)<\/span><input class="field-control" data-lesson="([^"]+)"( data-follow)? value="([^"]*)"/g)].map((match) => ({ label: match[1], key: match[2], follows: !!match[3], room: match[4] })),
    paint: (dow, n, row = n - 1, col = dow - 1) => fire("click", { target: control("[data-cell]", { dataset: { cell: `${dow}:${n}`, row: String(row), col: String(col) } }) }),
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
  for (const id of ["times", "weeks", "subjects", "courses", "grid", "details"]) {
    await run.next();
    assert.equal(run.step(), id);
  }
  for (const text of ['value="Fr. Krüger"', 'value="Hr. Wolf"', 'value="Herr Schmidt"', 'value="Bio2"', 'value="R114"', 'value="Ph1"']) assert.ok(run.stage().includes(text), `the details show ${text}`);
  await run.next();
  assert.equal(run.step(), "done");
  await run.next();
  assert.deepEqual(page.visits, ["/hub"]);
  assert.deepEqual(storeWrites(page), ["PUT app-settings", "PUT app-settings"], "the grade and the answer Noch keine");
  assert.deepEqual({ ...snapshot(page.core), "app-settings": "" }, { ...before, "app-settings": "" });
  assert.deepEqual(page.core.storage.get("app-settings"), { notify: { enabled: true }, school: { grade: 12, noCourses: 12 } }, "Noch keine is an answer too");
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
  await run.until("details");
  await run.type("teacher", "Biologie", "fr. krüger");
  await run.type("teacher", "Mathematik", "Frau Krüger");
  await run.type("room", "Physik", "PH1");
  await run.type("teacher", "Deutsch", "Fr. Beck");
  await run.type("room", "Deutsch", "r 101");
  await run.next();
  assert.equal(run.step(), "done");
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
  await run.until("details");
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
  await run.until("grid");
  await run.paint(1, 1);
  await run.until("details");
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

CASES["closing the plan import started on the first step leads back to it, a taken plan does not"] = async () => {
  const page = await boot({ plan: EMPTY });
  const asked = [];
  let answer = null;
  globalThis.AppPlanShare = { importFlow: async () => {
    asked.push("import");
    return answer;
  } };
  page.flow.open({ from: "tour" });
  const run = driver(page);
  assert.equal(run.step(), "start");
  assert.match(run.stage(), /data-setup-share/);
  await run.fire("click", { target: run.control("[data-setup-share]") });
  assert.deepEqual(asked, ["import"]);
  assert.equal(run.dialog.open, true, "closed without a plan, the import leads back to the setup");
  assert.equal(run.step(), "start", "on its first step");
  answer = { mode: "replace", subjects: 1, lessons: 2 };
  await run.fire("click", { target: run.control("[data-setup-share]") });
  assert.equal(run.dialog.open, false, "a plan that was taken does not bring the setup back, the import reloads the page");
  assert.deepEqual(page.visits, [], "and the setup itself stores and reloads nothing");
};

CASES["entering a lesson or switching the week keeps the grid where it was scrolled to"] = async () => {
  const page = await boot();
  page.flow.open({});
  const run = driver(page);
  await answerSchool(run);
  await run.until("grid");
  const stage = run.dialog.querySelector("#setupStage");
  // WebKit puts a scrolled box back to its top as soon as content inside it is replaced.
  for (const id of ["#setupGrid", "#setupBoardHead"]) {
    const part = stage.querySelector(id);
    let html = part.innerHTML;
    Object.defineProperty(part, "innerHTML", { get: () => html, set: (value) => {
      html = value;
      stage.scrollTop = 0;
    } });
  }
  await run.change({ name: "brush", value: "s-physik", closest: () => null });
  stage.scrollTop = 240;
  await run.fire("click", { target: run.control("[data-cell]", { dataset: { cell: "4:2", row: "1", col: "3" } }) });
  assert.equal(page.core.storage.get("app-timetable-edits")?.["A:4:2"]?.subject, "s-physik", "the lesson is entered");
  assert.equal(stage.scrollTop, 240, "and the grid stays where it was");
  stage.scrollTop = 120;
  await run.fire("click", { target: run.control("[data-week]", { dataset: { week: "B" } }) });
  assert.match(stage.querySelector("#setupBoardHead").innerHTML, /data-week="B" aria-pressed="true"/);
  assert.equal(stage.scrollTop, 120, "switching to the B week keeps it too");
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
  await run.until("done");
}

const rows = (html) => [...html.matchAll(/<(button|div) type="button" class="setup-note-row([^"]*)"([^>]*)>|<div class="setup-note-row([^"]*)"([^>]*)>/g)].map((match, index) => {
  const titles = [...html.matchAll(/<b><span>([^<]+)<\/span><\/b>/g)].map((title) => title[1]);
  const cls = match[2] ?? match[4] ?? "";
  const attrs = match[3] ?? match[5] ?? "";
  return { title: titles[index], button: match[1] === "button", done: cls.includes("is-done"), go: /data-setup-go="([^"]+)"/.exec(attrs)?.[1] || (/data-setup-[a-z-]+/.exec(attrs)?.[0] ?? "") };
});

CASES["the last step is a note: the plan ticked off, what is left below with its verb and the way there"] = async () => {
  const page = await boot({ notification: "default" });
  page.flow.open({});
  const run = driver(page);
  await toDone(run);
  assert.doesNotMatch(run.stage(), /setup-extra/, "the old rows are gone");
  assert.match(run.stage(), /class="setup-note"><ul>/);
  assert.deepEqual(rows(run.stage()), [
    { title: "Stundenplan eintragen", button: false, done: true, go: "" },
    { title: "Erinnerungen erlauben", button: true, done: false, go: "data-setup-remind" },
    { title: "Zuhause und Schule festlegen", button: true, done: false, go: "/hub/settings#orte" },
    { title: "IServ verbinden", button: true, done: false, go: "/hub/settings#konten" },
  ]);
  for (const text of ["Ich melde mich vor jeder Stunde und am Vortag eines Tests.", "Dann zeigt der Fahrplan deinen Schulweg und den Heimweg.", "Vertretungsplan und Mails kommen dann aus IServ dazu."]) assert.ok(run.stage().includes(text), text);
  assert.match(run.stage(), /class="setup-note-row is-done is-plan"/, "with reduced motion the plan is ticked at once");
};

CASES["steps already done when the last step opens are ticked"] = async () => {
  const done = await boot({ notification: "granted", store: { "app-settings": { notify: { enabled: true } } }, status: { iserv: true, places: true } });
  done.flow.open({});
  const run = driver(done);
  await toDone(run);
  assert.deepEqual(rows(run.stage()).map(({ title, done: ticked, button }) => [title, ticked, button]), [
    ["Stundenplan eintragen", true, false],
    ["Erinnerungen erlauben", true, false],
    ["Zuhause und Schule festlegen", true, false],
    ["IServ verbinden", true, false],
  ]);
  assert.doesNotMatch(run.stage(), /setup-note-go/, "nothing left to go to");
};

CASES["home and school set on the settings page just now are ticked when the setup opens there again"] = async () => {
  const page = await boot({ path: "/hub/settings", plan: { ...STORED, page: { places: { home: "Unter den Linden 6, Berlin", school: "" } } }, status: { places: false } });
  page.flow.open({ from: "settings" });
  const run = driver(page);
  await toDone(run);
  const places = () => rows(run.stage()).find((row) => row.title === "Zuhause und Schule festlegen");
  assert.equal(places().done, false, "school still missing");
  const data = JSON.parse(globalThis.document.getElementById("appData").textContent);
  assert.equal(data.page.places.home, "Unter den Linden 6, Berlin");
  page.core.data.page.places.school = "Schulzentrum, Berlin";
  await run.fire("click", { target: run.control("[data-setup-back]") });
  await run.next();
  assert.equal(places().done, true, "both set now: ticked, without a new load");
};

CASES["blocked reminders say how to free them, and a page without IServ has no line for it"] = async () => {
  const blocked = await boot({ notification: "denied", status: { iservAvailable: false } });
  blocked.flow.open({});
  const second = driver(blocked);
  await toDone(second);
  const lines = rows(second.stage());
  assert.equal(lines[1].title, "Erinnerungen freigeben");
  assert.match(second.stage(), /Sind blockiert\. Freigeben kannst du sie/);
  assert.deepEqual(lines.map((line) => line.title), ["Stundenplan eintragen", "Erinnerungen freigeben", "Zuhause und Schule festlegen"], "no IServ where there is none");
};

CASES["switching reminders on ticks their line in place"] = async () => {
  const page = await boot({ store: { "app-settings": { notify: { enabled: false, chosen: true } } }, notification: "granted" });
  page.flow.open({});
  const run = driver(page);
  await toDone(run);
  assert.equal(rows(run.stage())[1].title, "Erinnerungen einschalten");
  await run.fire("click", { target: run.control("[data-setup-remind-on]") });
  const row = run.dialog.querySelector("#setupStage").querySelector("#setupRemind");
  assert.match(row.outerHTML, /^<div class="setup-note-row is-done" id="setupRemind" tabindex="-1">/);
  assert.match(row.outerHTML, /<b><span>Erinnerungen erlauben<\/span><\/b><small>Sind an\./);
};

CASES["a step of the last note that leads to another part of the same page loads it there, and never leaves the setup waiting"] = async () => {
  const page = await boot({ path: "/hub/settings", notification: "default" });
  page.flow.open({ from: "settings" });
  const run = driver(page);
  await toDone(run);
  await run.fire("click", { target: run.control("[data-setup-go]", { dataset: { setupGo: "/hub/settings#orte" } }) });
  assert.deepEqual(page.visits, ["replace /hub/settings#orte", "reload"], "a way to a section of the settings from the settings loads the page there");
  assert.match(run.dialog.querySelector("#setupFoot").innerHTML, /data-setup-next disabled/, "while the page loads anew");
  await new Promise((done) => setTimeout(done, 4100));
  assert.doesNotMatch(run.dialog.querySelector("#setupFoot").innerHTML, /data-setup-next disabled/, "a way that went nowhere gives Zur Übersicht back");
  await run.fire("click", { target: run.control("[data-setup-next]") });
  assert.equal(page.visits.at(-1), "/hub", "and Zur Übersicht leads home");
};

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
  await run.until("grid");
  await run.paint(1, 1);
  await run.next();
  assert.equal(run.step(), "details");
  await run.type("room", "Deutsch", "R101");
  await run.next();
  assert.equal(run.step(), "done");
  const record = page.core.planMeta();
  assert.equal(record.origin, "edit");
  assert.ok(record.at > times.at);
  assert.equal(storeWrites(page).filter((write) => write === "PUT app-timetable-meta").length, 5, "one change for each step that changed the plan, the lesson entered in the grid among them");
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

CASES["in the browser tab of an iPhone the last step says plainly that the tab gives no reminders"] = async () => {
  const agent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";
  const page = await boot({ agent });
  page.flow.open({});
  const run = driver(page);
  await answerSchool(run);
  await run.until("done");
  const reminders = /<b><span>Erinnerungen<\/span><\/b><small>([^<]*)<\/small>/.exec(run.stage())?.[1] ?? "";
  assert.match(reminders, /^Im Safari-Tab gibt es keine Erinnerungen\./);
  assert.match(reminders, /erinnert dich die App dort, solange sie geöffnet ist\./, "the home screen app only while it is open, not more");
  assert.match(reminders, /Einstellungen › Daten/, "and the plan typed in the tab can be taken along");
  assert.doesNotMatch(reminders, /[—–]/);
};

CASES["in the upper school Luna asks for the Leistungskurse right after the subjects, a tap marks one and another takes it back"] = async () => {
  const page = await boot();
  page.flow.open({});
  const run = driver(page);
  await answerSchool(run);
  await run.until("subjects");
  await run.next();
  assert.equal(run.step(), "courses");
  assert.match(run.stage(), /Welche davon sind deine Leistungskurse\?/);
  assert.match(run.stage(), /Tipp sie an\. Leistungskurse zählen bei den Noten doppelt\./);
  assert.match(run.stage(), /In Brandenburg sind es meistens zwei\./, "a quiet hint where the number is clear");
  assert.deepEqual([...run.stage().matchAll(/data-course="([^"]+)" aria-pressed="(true|false)"/g)].map((match) => `${match[1]}:${match[2]}`), ["Biologie:false", "Mathematik:false", "Physik:false"]);
  assert.match(run.foot(), />Noch keine</, "without any, the way on says Noch keine");
  assert.match(run.dialog.querySelector("#setupProgress").innerHTML, /<span>Kurse<\/span>/);
  assert.equal(await run.course("Mathematik"), "true");
  assert.match(run.foot(), />Weiter</);
  assert.match(run.foot(), /1&nbsp;Leistungskurs gewählt|1 Leistungskurs gewählt/);
  assert.equal(await run.course("Physik"), "true");
  assert.match(run.foot(), /2 Leistungskurse gewählt/);
  assert.equal(await run.course("Physik"), "false", "a second tap takes it back");
  assert.equal(await run.course("Biologie"), "true");
  assert.equal(await run.course("Physik"), "true", "and there is no limit");
  assert.match(run.foot(), /3 Leistungskurse gewählt/);
  assert.doesNotMatch(run.foot(), /disabled/);
  await run.course("Physik");
  await run.next();
  assert.equal(run.step(), "grid");
  await run.next();
  assert.equal(run.step(), "details");
  assert.doesNotMatch(run.stage(), /setup-type|Kursart|name="type:/, "the Lehrkräfte rows have no course toggle any more");
  const { items } = page.core.storage.get("app-subjects");
  assert.deepEqual([items["s-mathematik"], items["s-biologie"], items["s-physik"]], [{ type: "LK" }, { type: "LK" }, undefined]);
  assert.equal(page.core.data.subjects["s-mathematik"].type, "LK");
  assert.equal(page.core.storage.get("app-settings").school.noCourses, undefined);
  await run.fire("click", { target: run.control("[data-setup-back]") });
  await run.fire("click", { target: run.control("[data-setup-back]") });
  assert.equal(run.step(), "courses");
  assert.deepEqual([...run.stage().matchAll(/data-course="([^"]+)" aria-pressed="(true|false)"/g)].map((match) => `${match[1]}:${match[2]}`), ["Biologie:true", "Mathematik:true", "Physik:false"], "going back shows them marked");
};

CASES["Noch keine moves on without a Leistungskurs and is kept for that grade, a later mark clears it"] = async () => {
  const page = await boot();
  page.flow.open({});
  const run = driver(page);
  await answerSchool(run);
  await run.until("courses");
  await run.next();
  assert.equal(run.step(), "grid");
  assert.equal(page.core.storage.get("app-subjects"), null, "nothing of the plan changed");
  assert.equal(page.core.storage.get("app-settings").school.noCourses, 12);
};

CASES["a Leistungskurs marked after an earlier Noch keine clears that answer"] = async () => {
  const again = await boot({ store: { "app-settings": { school: { grade: 12, noCourses: 12 } } } });
  again.flow.open({});
  const second = driver(again);
  await answerSchool(second);
  await second.until("courses");
  await second.course("Physik");
  await second.next();
  assert.equal(again.core.storage.get("app-settings").school.noCourses, undefined);
  assert.deepEqual(again.core.storage.get("app-subjects").items["s-physik"], { type: "LK" });
};

CASES["below the upper school nothing asks for Leistungskurse, and a Seminarkurs is never one to mark"] = async () => {
  const lower = await boot();
  lower.flow.open({});
  const run = driver(lower);
  await run.next();
  await run.change({ id: "setupState", value: "BB" });
  await run.change({ name: "grade", value: "9" });
  await run.until("subjects");
  assert.doesNotMatch(run.dialog.querySelector("#setupProgress").innerHTML, /Kurse/, "no step for it in the progress");
  await run.next();
  assert.equal(run.step(), "grid");
  await run.fire("click", { target: run.control("[data-setup-back]") });
  assert.equal(run.step(), "subjects", "and none on the way back");
  assert.equal(lower.core.storage.get("app-settings").school.noCourses, undefined);
};

CASES["a Seminarkurs is never one to mark, and Berlin gets the quiet hint on the usual number"] = async () => {
  const seminar = {
    ...STORED,
    subjects: { ...STORED.subjects, "s-seminarkurs": { name: "Seminarkurs", label: "Seminarkurs", short: "Sem", hue: "olive" } },
    courses: { ...STORED.courses, "s-seminarkurs": { type: "SK" } },
    timetable: { ...STORED.timetable, A: { ...STORED.timetable.A, 4: [lesson(1, "s-seminarkurs", "R1", "")] } },
  };
  const upper = await boot({ plan: seminar });
  upper.flow.open({});
  const second = driver(upper);
  await second.next();
  await second.change({ id: "setupState", value: "BE" });
  await second.change({ name: "grade", value: "12" });
  await second.until("courses");
  assert.doesNotMatch(second.stage(), /data-course="Seminarkurs"/);
  assert.match(second.stage(), /data-course="Physik"/);
  assert.match(second.stage(), /In Berlin sind es meistens zwei\./);
};

CASES["opened only for the Leistungskurse, as from the grades, the setup is that one step and Fertig closes it"] = async () => {
  const page = await boot({ store: { "app-settings": { school: { grade: 11 } } } });
  page.flow.open({ only: "courses" });
  const run = driver(page);
  assert.equal(run.step(), "courses");
  assert.equal(run.dialog.querySelector("#setupProgress").hidden, true, "no progress for one step");
  assert.doesNotMatch(run.foot(), /data-setup-back/);
  assert.match(run.foot(), />Noch keine</);
  await run.course("Biologie");
  assert.match(run.foot(), />Fertig</);
  await run.next();
  assert.deepEqual(page.visits, ["reload"], "the page shows the marks at once");
  assert.deepEqual(page.core.storage.get("app-subjects").items["s-biologie"], { type: "LK" });
};

CASES["opened only for the Leistungskurse, Noch keine closes it and keeps the hint away for that grade"] = async () => {
  const none = await boot({ store: { "app-settings": { school: { grade: 11 } } } });
  none.flow.open({ only: "courses" });
  const second = driver(none);
  await second.next();
  assert.deepEqual(none.visits, ["reload"]);
  assert.equal(none.core.storage.get("app-settings").school.noCourses, 11, "Noch keine keeps the hint away for grade 11");
};

CASES["lessons in the subject's room follow it, a lesson with its own room keeps it, and the same lesson in both weeks is one line"] = async () => {
  const page = await boot();
  const plan = await import(script("setup-data.js"));
  const timetable = {
    A: { 1: [lesson(1, "m", "R1"), lesson(2, "m", "R1"), lesson(3, "d", "R7")], 2: [], 3: [], 4: [lesson(3, "m", "R1")], 5: [lesson(1, "m", "Lab")] },
    B: { 1: [lesson(1, "m", "R1"), lesson(2, "m", "R1")], 2: [], 3: [], 4: [lesson(3, "m", "X")], 5: [lesson(1, "m", "")] },
  };
  const groups = plan.lessonGroups(timetable, "m", ["A", "B"]);
  assert.deepEqual(groups.map((group) => `${group.weeks.join("")} ${group.dow} ${group.from}-${group.to} ${group.room}`), ["AB 1 1-2 R1", "A 4 3-3 R1", "B 4 3-3 X", "A 5 1-1 Lab", "B 5 1-1 "]);
  assert.deepEqual(plan.lessonGroups(timetable, "m", ["A"]).map((group) => group.id), ["A:1:1-2", "A:4:3-3", "A:5:1-1"], "one week only, nothing of B");

  const edits = { "A:5:1": { subject: "m", room: "Lab", teacher: "t-own" } };
  plan.followRoom(edits, { A: {}, B: {} }, timetable, "m", "R1", "R2");
  assert.deepEqual(Object.fromEntries(Object.entries(edits).map(([key, value]) => [key, value.room])), { "A:5:1": "Lab", "A:1:1": "R2", "A:1:2": "R2", "A:4:3": "R2", "B:1:1": "R2", "B:1:2": "R2", "B:5:1": "R2" }, "the old room and no room follow, X and Lab stay");
  assert.equal(edits["A:5:1"].teacher, "t-own", "a lesson's own teacher stays");
  assert.equal(edits["A:1:3"], undefined, "another subject is untouched");
  const same = {};
  plan.followRoom(same, {}, timetable, "m", "R1", "R1");
  assert.deepEqual(same, {});

  const own = {};
  plan.setGroupRoom(own, {}, timetable, "m", groups[0], "R9");
  assert.deepEqual(Object.keys(own).sort(), ["A:1:1", "A:1:2", "B:1:1", "B:1:2"]);
  plan.setGroupRoom(own, {}, { A: { 1: [lesson(1, "d", "R7")] } }, "m", { weeks: ["A"], dow: 1, from: 1, to: 1 }, "R5");
  assert.equal(own["A:1:1"].room, "R9", "a slot the subject left gets no room of it");
  assert.ok(page.core);
};

CASES["after the grid each subject has its room, a lesson can have another, and a changed room moves only the lessons that follow it"] = async () => {
  const page = await boot();
  page.flow.open({});
  const run = driver(page);
  await answerSchool(run);
  await run.until("details");
  assert.match(run.stage(), /data-lessons="s-biologie" aria-expanded="false"[^>]*><svg[^>]*><use href="#i-chevron-down"\/><\/svg><span>An manchen Tagen anders<\/span>/);
  assert.doesNotMatch(run.stage(), /data-lessons="s-physik"/, "one lesson needs no other room");
  assert.deepEqual(run.lessons().filter((item) => item.key.startsWith("s-biologie")).map(({ label, follows, room }) => `${label} ${follows} ${room}`), ["Mo 1. true Bio2", "Di 1. true Bio2"], "both weeks the same: one line each, filled with the subject's room");
  await run.fire("click", { target: run.control("[data-lessons]", { dataset: { lessons: "s-biologie" } }) });
  const tuesday = run.lessons().find((item) => item.label === "Di 1.").key;
  await run.typeLesson(tuesday, "bio 3");
  await run.type("room", "Biologie", "Bio1");
  await run.next();
  assert.equal(run.step(), "done");
  const at = (week, dow, n) => (page.core.data.timetable[week][String(dow)] || []).find((entry) => entry.block === n)?.room;
  assert.deepEqual([at("A", 1, 1), at("B", 1, 1), at("A", 2, 1), at("B", 2, 1)], ["BIO1", "BIO1", "BIO 3", "BIO 3"], "Monday follows the new room, Tuesday keeps its own");
  assert.equal(page.core.data.subjects["s-biologie"].room, "BIO1");
  assert.ok(page.core.data.rooms.includes("BIO 3"), "a lesson's own room is in the room list");
  assert.equal(at("A", 1, 2), "R114", "another subject keeps its room");

  await run.fire("click", { target: run.control("[data-setup-back]") });
  assert.equal(run.step(), "details");
  assert.deepEqual(run.lessons().filter((item) => item.key.startsWith("s-biologie")).map(({ label, follows, room }) => `${label} ${follows} ${room}`), ["Mo 1. true BIO1", "Di 1. false BIO 3"], "back again everything is there");
  assert.match(run.stage(), /data-lessons="s-biologie" aria-expanded="true"/, "a subject with another room shows its lessons");
  await run.type("room", "Biologie", "Bio5");
  await run.fire("click", { target: run.control("[data-setup-back]") });
  assert.equal(run.step(), "grid", "going back keeps what was typed");
  assert.deepEqual([at("A", 1, 1), at("A", 2, 1)], ["BIO5", "BIO 3"]);
  await run.next();
  const tue = run.lessons().find((item) => item.label === "Di 1.");
  await run.typeLesson(tue.key, "");
  await run.next();
  assert.equal(at("A", 2, 1), "BIO5", "an emptied lesson room is the subject's room again");
};

CASES["with A and B weeks a lesson that differs between them is a line for each week"] = async () => {
  const page = await boot({ store: { "app-timetable-edits": { "B:2:1": { subject: "s-biologie", room: "Bio4" } } } });
  page.flow.open({});
  const run = driver(page);
  await answerSchool(run);
  await run.until("details");
  assert.deepEqual(run.lessons().filter((item) => item.key.startsWith("s-biologie")).map(({ label, room }) => `${label}: ${room}`), ["Mo 1.: Bio2", "Di 1., A-Woche: Bio2", "Di 1., B-Woche: Bio4"]);
  assert.match(run.stage(), /data-lessons="s-biologie" aria-expanded="true"/);
  await run.type("room", "Biologie", "Bio7");
  await run.next();
  const at = (week, dow, n) => (page.core.data.timetable[week][String(dow)] || []).find((entry) => entry.block === n)?.room;
  assert.deepEqual([at("A", 1, 1), at("A", 2, 1), at("B", 2, 1)], ["BIO7", "BIO7", "Bio4"]);
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
