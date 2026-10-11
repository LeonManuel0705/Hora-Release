import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = (name) => pathToFileURL(resolve(here, "../../app/static/app/js", name)).href;

const named = (name) => ({ name, label: name, short: name.slice(0, 2), hue: "rose" });
const days = { 1: [], 2: [], 3: [], 4: [], 5: [] };
const appData = {
  blocks: [{ n: 1, start: "08:00", end: "09:30" }],
  subjects: { geo: named("Geografie"), mathe: named("Mathe") },
  courses: {},
  timetable: { A: days, B: days },
  abReference: "2026-01-12",
  changes: [],
  tasks: [],
  deadlines: [
    { id: "talk-1", kind: "Vortrag", title: "Stadtklima", subject: "geo", date: "2026-10-13", status: "offen" },
    { id: "talk-2", kind: "Vortrag", title: "Klimazonen", subject: "geo", date: "2026-10-13", time: "09:50", status: "offen" },
    { id: "talk-3", kind: "Vortrag", title: "Plattentektonik", subject: "geo", date: "2026-10-05", status: "offen" },
    { id: "test-1", kind: "Test", title: "Vektoren", subject: "mathe", date: "2026-10-15", status: "offen" },
    { id: "hw-1", kind: "Hausaufgabe", title: "Atlas S. 24", subject: "geo", date: "2026-10-13", status: "offen" },
  ],
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

const { ASSESSMENTS, isAssessment, isOverdue, pastText, pastWord, assessmentCount } = await import(script("core.js"));
const { dueReminders, readPrefs } = await import(script("reminders.js"));

const kinds = (...names) => names.map((kind) => ({ kind }));
const monday = new Date("2026-10-12T12:00:00");
const reminded = (notify) => dueReminders(readPrefs({ notify: { enabled: true, ...notify } }), monday).map((reminder) => [reminder.title, reminder.body]);

const tests = {
  "a presentation is an assessment like a test and an exam"() {
    assert.deepEqual(Object.keys(ASSESSMENTS), ["Test", "Klausur", "Vortrag"]);
    assert.ok(kinds("Test", "Klausur", "Vortrag").every(isAssessment));
    assert.ok(!kinds("Hausaufgabe", "Abgabe", "Referat", "Aufgabe").some(isAssessment));
    assert.equal(isAssessment(undefined), false);
  },
  "every assessment has an icon the page can draw"() {
    const sprite = readFileSync(resolve(here, "../../app/templates/app/_icons.svg"), "utf8");
    for (const [kind, info] of Object.entries(ASSESSMENTS)) assert.ok(sprite.includes(`<symbol id="i-${info.icon}"`), kind);
  },
  "a presentation that is over was held and is never overdue"() {
    assert.equal(isOverdue({ kind: "Vortrag", date: "2026-10-05", status: "offen" }, "2026-10-12"), false);
    assert.equal(isOverdue({ kind: "Hausaufgabe", date: "2026-10-05", status: "offen" }, "2026-10-12"), true);
    assert.equal(pastText(-1, new Date(2026, 9, 11), "Vortrag"), "gestern gehalten");
    assert.equal(pastText(-3, new Date(2026, 9, 9), "Vortrag"), "vor 3\u00a0Tagen gehalten");
    assert.equal(pastText(-20, new Date(2026, 8, 22), "Vortrag"), "am 22.9. gehalten");
    assert.equal(pastText(-1, new Date(2026, 9, 11), "Klausur"), "gestern geschrieben");
  },
  "what is over is summed up by the word that fits all of it"() {
    assert.equal(pastWord(kinds("Test", "Klausur")), "geschrieben");
    assert.equal(pastWord(kinds("Vortrag", "Vortrag")), "gehalten");
    assert.equal(pastWord(kinds("Test", "Vortrag")), "vorbei");
    assert.equal(pastWord([]), "vorbei");
  },
  "each kind is counted by its own name"() {
    assert.equal(assessmentCount(kinds("Vortrag", "Test", "Klausur", "Test", "Hausaufgabe")), "2\u00a0Tests, 1\u00a0Klausur, 1\u00a0Vortrag");
    assert.equal(assessmentCount(kinds("Vortrag", "Vortrag")), "2\u00a0Vorträge");
    assert.equal(assessmentCount(kinds("Hausaufgabe")), "");
  },
  "the next one is announced in the gender of its kind"() {
    assert.deepEqual(Object.values(ASSESSMENTS).map((info) => info.next), ["Nächster Test", "Nächste Klausur", "Nächster Vortrag"]);
  },
  "a presentation is announced the day before like a test"() {
    assert.deepEqual(reminded({}), [
      ["Vortrag: Stadtklima", "Morgen, Geografie"],
      ["Vortrag: Klimazonen", "Morgen um 9:50, Geografie"],
      ["Hausaufgabe: Atlas S. 24", "Fällig morgen, Geografie"],
    ]);
  },
  "it follows the switch and the lead time of tests"() {
    assert.deepEqual(reminded({ categories: { tests: { on: false } } }), [["Hausaufgabe: Atlas S. 24", "Fällig morgen, Geografie"]]);
    assert.deepEqual(reminded({ categories: { tests: { lead: 3 }, homework: { on: false } } }).map(([title]) => title), ["Vortrag: Stadtklima", "Vortrag: Klimazonen", "Test: Vektoren"]);
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
