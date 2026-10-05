import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = pathToFileURL(resolve(here, "../../app/static/app/js/core.js")).href;

const lessons = (subjects) => subjects.map((subject, index) => ({ block: index + 1, subject, room: "R101", teacher: "T" }));
const week = { 1: lessons(["mathe", "deutsch"]), 2: lessons(["englisch"]), 3: lessons(["mathe"]), 4: lessons(["physik"]), 5: lessons(["deutsch", "sport"]) };
const named = (name) => ({ name, label: name, short: name.slice(0, 2), hue: "rose" });
const appData = {
  blocks: [{ n: 1, start: "08:00", end: "09:30" }, { n: 2, start: "09:50", end: "11:20" }],
  subjects: { mathe: named("Mathe"), deutsch: named("Deutsch"), englisch: named("Englisch"), physik: named("Physik"), sport: named("Sport"), kunst: named("Kunst") },
  courses: {},
  timetable: { A: week, B: week },
  abReference: "2026-01-12",
  changes: [],
  tasks: [],
  deadlines: [],
  events: [],
  holidays: [{ date: "2026-10-19", endDate: "2026-10-31", title: "Herbstferien" }],
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
  documentElement: { dataset: { brand: "Hora", motion: "calm" }, classList: { toggle() {}, add() {}, remove() {} }, style: { setProperty() {} } },
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

const { homeworkDate, nextRepeatDate } = await import(source);
const noon = (iso) => new Date(`${iso}T12:00:00`);

const tests = {
  "a task done on its day comes back the day after"() {
    assert.equal(nextRepeatDate("2026-10-05", "daily", "2026-10-05"), "2026-10-06");
  },
  "an overdue daily task comes back tomorrow, not in the past"() {
    assert.equal(nextRepeatDate("2026-10-01", "daily", "2026-10-05"), "2026-10-06");
  },
  "an overdue weekly task keeps its weekday"() {
    assert.equal(nextRepeatDate("2026-09-28", "weekly", "2026-10-08"), "2026-10-12");
  },
  "a weekly task finished early moves one week on"() {
    assert.equal(nextRepeatDate("2026-10-09", "weekly", "2026-10-05"), "2026-10-16");
  },
  "a monthly task on the 31st lands on the last day of a shorter month"() {
    assert.equal(nextRepeatDate("2026-01-31", "monthly", "2026-01-31"), "2026-02-28");
    assert.equal(nextRepeatDate("2026-12-31", "monthly", "2026-12-31"), "2027-01-31");
  },
  "a task without a rhythm has no next date"() {
    assert.equal(nextRepeatDate("2026-10-05", undefined, "2026-10-05"), null);
    assert.equal(nextRepeatDate("2026-10-05", "yearly", "2026-10-05"), null);
  },
  "homework is due at the next lesson of the subject"() {
    assert.equal(homeworkDate("mathe", noon("2026-10-05")), "2026-10-07");
    assert.equal(homeworkDate("deutsch", noon("2026-10-05")), "2026-10-09");
  },
  "homework noted before the holidays is due at the first lesson after them"() {
    assert.equal(homeworkDate("physik", noon("2026-10-15")), "2026-11-05");
    assert.equal(homeworkDate("mathe", noon("2026-10-16")), "2026-11-02");
  },
  "homework without a subject is due on the next school day"() {
    assert.equal(homeworkDate(undefined, noon("2026-10-09")), "2026-10-12");
    assert.equal(homeworkDate(null, noon("2026-10-16")), "2026-11-02");
  },
  "homework for a subject outside the timetable is due on the next school day"() {
    assert.equal(homeworkDate("kunst", noon("2026-10-05")), "2026-10-06");
    assert.equal(homeworkDate("kunst", noon("2026-10-16")), "2026-11-02");
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n${error.stack}`);
  }
}
process.exit(failed ? 1 : 0);
