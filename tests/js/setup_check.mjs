// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = (name) => pathToFileURL(resolve(here, "../../app/static/app/js", name)).href;

const empty = { 1: [], 2: [], 3: [], 4: [], 5: [] };
const lesson = (subject, block) => ({ block, subject, room: "R101", teacher: "" });
const named = (name) => ({ name, label: name, short: name.slice(0, 3), hue: "rose" });
const baseData = () => ({
  user: { state: "", grade: null, iserv: "desktop" },
  blocks: [{ n: 1, start: "08:00", end: "09:30" }, { n: 2, start: "09:50", end: "11:20" }],
  subjects: {},
  courses: {},
  timetable: { A: { ...empty }, B: { ...empty } },
  abReference: "2026-01-12",
  changes: [],
  tasks: [],
  taskPool: [],
  deadlines: [],
  events: [],
  holidays: [],
  weather: { hours: [] },
  status: {},
});

const nodes = { appData: { textContent: JSON.stringify(baseData()) }, appStore: { textContent: "{}" } };
const local = new Map();
globalThis.localStorage = {
  getItem: (key) => (local.has(key) ? local.get(key) : null),
  setItem: (key, value) => local.set(key, String(value)),
  removeItem: (key) => local.delete(key),
};
globalThis.document = {
  documentElement: { dataset: { brand: "App", motion: "calm" }, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, style: { setProperty() {} } },
  getElementById: (id) => nodes[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  dispatchEvent: () => true,
  createElement: () => ({ content: { childNodes: [] }, set innerHTML(value) {} }),
  hidden: false,
  visibilityState: "visible",
};
globalThis.location = { search: "", pathname: "/hub", href: "http://127.0.0.1/hub" };
globalThis.self = globalThis;
globalThis.window = globalThis;
Object.defineProperty(globalThis, "navigator", { value: { platform: "MacIntel", userAgent: "node" }, configurable: true });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.addEventListener = () => {};
globalThis.dispatchEvent = () => true;
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });

const core = await import(script("core.js"));
const reminders = await import(script("reminders.js"));
const plan = await import(script("setup-data.js"));

let instance = 0;
async function coreWith(data, store = {}) {
  nodes.appData.textContent = JSON.stringify({ ...baseData(), ...data });
  nodes.appStore.textContent = JSON.stringify(store);
  instance += 1;
  return import(`${script("core.js")}?case=${instance}`);
}

const planned = { A: { ...empty, 1: [lesson("mathe", 1)] }, B: { ...empty } };
const subjects = { mathe: named("Mathe") };

const tests = {
  "someone new starts without A/B weeks and without a plan"() {
    assert.equal(core.abWeeks(), false);
    assert.equal(core.abAnswered(), false);
    assert.equal(core.hasPlan(), false);
  },
  async "a plan stored before the question keeps its A/B weeks"() {
    const stored = await coreWith({ subjects, timetable: planned });
    assert.equal(stored.abWeeks(), true);
    assert.equal(stored.hasPlan(), true);
  },
  async "a plan typed in the settings counts as stored too"() {
    const typed = await coreWith({}, { "app-subjects": { items: { "x-mat": { custom: true, name: "Mathe", short: "Mat", hue: "slate", type: "GK" } } }, "app-timetable-edits": { "A:1:1": { subject: "x-mat", room: "" } } });
    assert.equal(typed.abWeeks(), true);
    assert.equal(typed.hasPlan(), true);
    assert.equal(typed.data.timetable.A["1"][0].room, "");
  },
  async "a saved answer wins over the default"() {
    const no = await coreWith({ subjects, timetable: planned }, { "app-ab-weeks": false });
    assert.equal(no.abWeeks(), false);
    const yes = await coreWith({}, { "app-ab-weeks": true });
    assert.equal(yes.abWeeks(), true);
    assert.equal(yes.abAnswered(), true);
  },
  async "a school day can have up to twelve periods"() {
    assert.equal(core.MAX_BLOCKS, 12);
    const blocks = plan.blockTimes({ length: 45, start: "07:30", count: 12, small: 5, big: 20 });
    const twelve = await coreWith({}, { "app-block-times": { v: 2, blocks } });
    assert.equal(twelve.data.blocks.length, 12);
    const thirteen = await coreWith({}, { "app-block-times": { v: 2, blocks: [...blocks, { n: 13, start: "18:00", end: "18:45" }] } });
    assert.equal(thirteen.data.blocks.length, 2);
  },
  "the sky comes from the weather code, never from the clock"() {
    assert.deepEqual(core.skyOf(0, 13), { kind: "clear", word: "sonnig" });
    assert.deepEqual(core.skyOf(0, 22), { kind: "clear", word: "klar" });
    assert.equal(core.skyOf(63, 13).word, "Regen");
    assert.equal(core.skyOf(73, 13).kind, "snow");
    assert.equal(core.skyOf(undefined, 13), null);
    assert.equal(core.hourIcon({ h: 13, rain: 0 }), "cloud");
    assert.equal(core.hourIcon({ h: 13, rain: 0, code: 2 }), "cloud-sun");
    assert.equal(core.hourIcon({ h: 23, rain: 0, code: 1 }), "cloud-moon");
    assert.equal(core.hourIcon({ h: 9, rain: 70, code: 61 }), "cloud-rain");
    assert.equal(core.hourIcon({ h: 9, rain: 10, code: 95 }), "cloud-lightning");
  },
  "reminders start on for someone new and the choice is stored"() {
    reminders.adoptDefault();
    assert.equal(core.storage.get("app-settings")?.notify?.enabled, true);
    assert.equal(reminders.readPrefs().enabled, true);
  },
  "whoever used the app before keeps reminders off until they turn them on"() {
    core.storage.remove("app-settings");
    core.data.tasks.push({ id: "t1", title: "Vokabeln", done: false });
    reminders.adoptDefault();
    assert.equal(core.storage.get("app-settings"), null);
    assert.equal(reminders.readPrefs().enabled, false);
    core.storage.set("app-settings", { notify: { enabled: false } });
    core.data.tasks.length = 0;
    reminders.adoptDefault();
    assert.equal(core.storage.get("app-settings").notify.enabled, false);
  },
  "a choice of single periods gives the classic school day"() {
    const day = plan.blockTimes({ length: 45, start: "08:00", count: 8, small: 5, big: 20 });
    assert.deepEqual(day.map((block) => `${block.start}-${block.end}`), ["08:00-08:45", "08:50-09:35", "09:55-10:40", "10:45-11:30", "11:50-12:35", "12:40-13:25", "13:45-14:30", "14:35-15:20"]);
    assert.equal(plan.templateOf(day), 45);
  },
  "double periods start like the default plan"() {
    const day = plan.blockTimes(plan.TEMPLATES[90]);
    assert.deepEqual(day.map((block) => `${block.start}-${block.end}`), ["08:00-09:30", "09:50-11:20", "11:30-13:00", "13:30-15:00"]);
    assert.equal(plan.templateOf(day), 90);
  },
  "no period runs past midnight"() {
    assert.equal(plan.blockTimes({ length: 90, start: "20:00", count: 6, small: 10, big: 20 }).length, 2);
    assert.deepEqual(plan.blockTimes({ length: 45, start: "8:00", count: 8, small: 5, big: 20 }), []);
  },
  async "the answer about this week sets the swap so the weeks count as the student said"() {
    const on = await coreWith({}, { "app-ab-weeks": true });
    for (let days = -30; days < 400; days += 1) {
      const date = new Date(2026, 0, 12 + days, 9);
      assert.equal(plan.weekLetter(date, "2026-01-12"), on.weekType(date), `day ${days}`);
    }
    const monday = new Date(2026, 10, 2, 12);
    const letter = on.weekType(monday);
    const other = letter === "A" ? "B" : "A";
    assert.equal(plan.swapFor(letter, monday, "2026-01-12"), false);
    assert.equal(plan.swapFor(other, monday, "2026-01-12"), true);
    const swapped = await coreWith({}, { "app-ab-weeks": true, "app-ab-swap": true });
    assert.equal(swapped.weekType(monday), other);
  },
  "teachers are read with or without a title"() {
    assert.deepEqual(plan.parseTeacher("Frau Beck"), { title: "Frau", name: "Beck" });
    assert.deepEqual(plan.parseTeacher("hr. Meier"), { title: "Herr", name: "Meier" });
    assert.deepEqual(plan.parseTeacher("  Dr. Lang "), { title: "", name: "Dr. Lang" });
    assert.equal(plan.parseTeacher("   "), null);
  },
  "short names stay unique"() {
    assert.equal(plan.suggestShort("Deutsch", []), "Deu");
    assert.equal(plan.suggestShort("Politische Bildung", []), "PB");
    assert.equal(plan.suggestShort("Astronomie", ["Ast"]), "Astr");
    assert.equal(plan.suggestShort("Sport", ["Spo"]), "Spor");
  },
  "colours repeat only once all are used"() {
    const hues = ["rose", "ochre", "olive"];
    assert.equal(plan.pickHue("ochre", ["rose"], hues), "ochre");
    assert.equal(plan.pickHue("ochre", ["ochre"], hues), "rose");
    assert.equal(plan.pickHue("ochre", hues, hues), "ochre");
  },
  "an edit is kept only where it differs from the stored plan"() {
    const base = { A: { 1: [{ block: 1, subject: "mathe", room: "R1" }] } };
    const edits = {};
    plan.setLesson(edits, base, "A", 1, 1, { subject: "mathe", room: "R1" });
    assert.deepEqual(edits, {});
    plan.setLesson(edits, base, "A", 1, 1, null);
    assert.deepEqual(edits, { "A:1:1": null });
    plan.setLesson(edits, base, "A", 2, 3, { subject: "x-deu", room: "" });
    assert.deepEqual(edits["A:2:3"], { subject: "x-deu", room: "" });
    plan.setLesson(edits, base, "A", 2, 3, null);
    assert.equal("A:2:3" in edits, false);
  },
  "the B week can be copied from the A week"() {
    const timetable = { A: { ...empty, 1: [{ block: 1, subject: "x-deu", room: "R2" }], 3: [{ block: 2, subject: "x-mat", room: "" }] }, B: { ...empty, 4: [{ block: 1, subject: "x-bio", room: "" }] } };
    const edits = plan.copyWeek({}, { A: {}, B: {} }, timetable, [{ n: 1 }, { n: 2 }]);
    assert.deepEqual(edits, { "B:1:1": { subject: "x-deu", room: "R2" }, "B:3:2": { subject: "x-mat", room: "" } });
  },
  "rooms are written the way schools write them"() {
    assert.equal(plan.normalizeRoom(" r 121 "), "R 121");
    assert.equal(plan.normalizeRoom("aula"), "Aula");
    assert.equal(plan.normalizeRoom(""), "");
  },
  "the course lists fit the class"() {
    assert.ok(plan.catalogFor(12).some((item) => item.name === "Seminarkurs" && item.type === "SK"));
    assert.ok(!plan.catalogFor(8).some((item) => item.name === "Seminarkurs"));
    assert.ok(plan.catalogFor(8).some((item) => item.name === "WAT"));
    assert.equal(plan.scaleText(11), "in Punkten von 0 bis 15");
    assert.equal(plan.scaleText(10), "in Noten von 1 bis 6");
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n${error.stack}`);
  }
}
process.exit(failed ? 1 : 0);
