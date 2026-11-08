// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = pathToFileURL(resolve(here, "../../app/static/app/js/reminders.js")).href;

const empty = { 1: [], 2: [], 3: [], 4: [], 5: [] };
const appData = {
  blocks: [{ n: 1, start: "08:00", end: "09:30" }],
  subjects: {},
  courses: {},
  timetable: { A: empty, B: empty },
  abReference: "2026-01-12",
  changes: [],
  tasks: [],
  taskPool: [],
  deadlines: [],
  events: [],
  holidays: [],
  weather: {},
  status: {},
};

const store = new Map();
const nodes = { appData: { textContent: JSON.stringify(appData) }, appStore: { textContent: "{}" } };
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
globalThis.document = {
  documentElement: { dataset: { brand: "App", motion: "calm" }, classList: { toggle() {}, add() {}, remove() {} }, style: { setProperty() {} } },
  getElementById: (id) => nodes[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
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

const { dueReminders, readPrefs } = await import(source);
const { data } = await import(pathToFileURL(resolve(here, "../../app/static/app/js/core.js")).href);

const prefs = { ...readPrefs({ notify: { enabled: true, quiet: { from: "22:00", to: "07:00" } } }) };
const task = (id, title, date, extra = {}) => ({ id, title, date, done: false, minutes: 20, ...extra });
const deadline = (id, kind, date) => ({ id, kind, title: "Analysis", subject: null, date, detail: "", status: "offen" });
const deadlines = (at, given = prefs) => dueReminders(given, new Date(`${at}:00`)).filter((item) => item.key.startsWith("deadline:")).map((item) => [item.key, item.body]);
const morning = (time = "07:00") => dueReminders(prefs, new Date(`2026-11-06T${time}:00`)).filter((item) => item.key.startsWith("tasks:"));

const tests = {
  "the morning reminder names tasks that are overdue, the oldest first"() {
    data.tasks = [task("3", "Referat", "2026-11-05", { dueTime: "18:00" }), task("2", "Vokabeln", "2026-11-06"), task("1", "Bio Mappe", "2026-11-04")];
    const [reminder] = morning();
    assert.equal(reminder.title, "3 Aufgaben für heute, 2 davon überfällig");
    assert.equal(reminder.body, "Bio Mappe, Referat, Vokabeln");
  },
  "only overdue tasks still give the morning reminder"() {
    data.tasks = [task("1", "Bio Mappe", "2026-11-04")];
    assert.deepEqual(morning().map((item) => item.title), ["Überfällig"]);
    data.tasks = [task("1", "Bio Mappe", "2026-11-04"), task("2", "Physik", "2026-11-03")];
    assert.deepEqual(morning().map((item) => item.title), ["2 Aufgaben überfällig"]);
  },
  "tasks for today read as before"() {
    data.tasks = [task("1", "Vokabeln", "2026-11-06")];
    assert.deepEqual(morning().map((item) => item.title), ["Heute fällig"]);
    data.tasks = [task("1", "Vokabeln", "2026-11-06"), task("2", "Lesen", null)];
    assert.deepEqual(morning().map((item) => [item.title, item.body]), [["2 Aufgaben heute fällig", "Vokabeln, Lesen"]]);
  },
  "nothing before seven, nothing for done or later tasks, and an overdue time does not ring again"() {
    data.tasks = [task("1", "Bio Mappe", "2026-11-04")];
    assert.deepEqual(morning("06:59"), []);
    data.tasks = [task("1", "Bio Mappe", "2026-11-04", { done: true }), task("2", "Morgen", "2026-11-07")];
    assert.deepEqual(morning(), []);
    data.tasks = [task("3", "Referat", "2026-11-05", { dueTime: "18:00" }), task("4", "Abgabe", "2026-11-06", { dueTime: "18:00" })];
    const at = dueReminders(prefs, new Date("2026-11-06T18:01:00")).filter((item) => item.key.startsWith("task:"));
    assert.deepEqual(at.map((item) => item.title), ["Abgabe"]);
  },
  "a test reminds at six the evening before and in the morning of its day, under the same keys"() {
    data.deadlines = [deadline("t1", "Test", "2026-11-10")];
    for (const time of ["07:00", "12:00", "17:59"]) assert.deepEqual(deadlines(`2026-11-09T${time}`), [], time);
    assert.deepEqual(deadlines("2026-11-09T18:00"), [["deadline:t1:2026-11-09", "Morgen"]]);
    assert.deepEqual(deadlines("2026-11-09T21:30"), [["deadline:t1:2026-11-09", "Morgen"]], "an open page still names a missed evening");
    assert.deepEqual(deadlines("2026-11-09T22:00"), []);
    assert.deepEqual(deadlines("2026-11-10T06:59"), []);
    assert.deepEqual(deadlines("2026-11-10T07:00"), [["deadline:t1:2026-11-10", "Heute"]]);
  },
  "homework and a longer lead remind every evening before the day"() {
    data.deadlines = [deadline("h1", "Hausaufgabe", "2026-11-10"), deadline("k1", "Klausur", "2026-11-12")];
    const longer = readPrefs({ notify: { enabled: true, categories: { tests: { on: true, lead: 3 } } } });
    assert.deepEqual(deadlines("2026-11-09T07:00", longer), []);
    assert.deepEqual(deadlines("2026-11-09T18:00", longer), [["deadline:h1:2026-11-09", "Fällig morgen"], ["deadline:k1:2026-11-09", "In 3 Tagen"]]);
    assert.deepEqual(deadlines("2026-11-10T07:00", longer), [["deadline:h1:2026-11-10", "Fällig heute"]]);
    assert.deepEqual(deadlines("2026-11-11T18:00", longer), [["deadline:k1:2026-11-11", "Morgen"]]);
    assert.deepEqual(deadlines("2026-11-12T07:00", longer), [["deadline:k1:2026-11-12", "Heute"]]);
  },
  "with six in the quiet hours the days before remind in the morning as before"() {
    data.deadlines = [deadline("t1", "Test", "2026-11-10"), deadline("h1", "Hausaufgabe", "2026-11-10")];
    const early = readPrefs({ notify: { enabled: true, quiet: { from: "17:30", to: "07:30" } } });
    assert.deepEqual(deadlines("2026-11-09T07:29", early), []);
    assert.deepEqual(deadlines("2026-11-09T07:30", early), [["deadline:t1:2026-11-09", "Morgen"], ["deadline:h1:2026-11-09", "Fällig morgen"]]);
    const fromSix = readPrefs({ notify: { enabled: true, quiet: { from: "18:00", to: "19:00" } } });
    assert.equal(deadlines("2026-11-09T00:00", fromSix).length, 2);
    const untilSix = readPrefs({ notify: { enabled: true, quiet: { from: "17:00", to: "18:00" } } });
    assert.deepEqual(deadlines("2026-11-09T12:00", untilSix), []);
    assert.equal(deadlines("2026-11-09T18:00", untilSix).length, 2);
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok - ${name}\n${error.stack}`);
  }
}
process.exit(failed ? 1 : 0);
