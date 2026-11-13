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

const { dueReminders, readPrefs, sampleReminder, blockedPlace } = await import(source);
const { data } = await import(pathToFileURL(resolve(here, "../../app/static/app/js/core.js")).href);

const prefs = { ...readPrefs({ notify: { enabled: true, quiet: { from: "22:00", to: "07:00" } } }) };
const task = (id, title, date, extra = {}) => ({ id, title, date, done: false, minutes: 20, ...extra });
const deadline = (id, kind, date) => ({ id, kind, title: "Analysis", subject: null, date, detail: "", status: "offen" });
const deadlines = (at, given = prefs) => dueReminders(given, new Date(`${at}:00`)).filter((item) => item.key.startsWith("deadline:")).map((item) => [item.key, item.body]);
const morning = (time = "07:00") => dueReminders(prefs, new Date(`2026-11-06T${time}:00`)).filter((item) => item.key.startsWith("tasks:"));

const tests = {
  "the sample reminder names the next real lesson and makes none up without a plan"() {
    const before = { timetable: data.timetable, subjects: data.subjects };
    const empty = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    try {
      assert.deepEqual(sampleReminder(new Date("2026-11-08T12:00:00")), { lesson: false, body: "Das ist eine Probe. Mit Stundenplan steht hier deine nächste Stunde." });
      const monday = (room) => ({ ...empty, 1: [{ block: 1, subject: "mathe", room, teacher: "T" }] });
      data.subjects = { mathe: { name: "Mathe", label: "Mathe LK", short: "Ma", hue: "rose" } };
      data.timetable = { A: monday("R101"), B: monday("R101") };
      assert.deepEqual(sampleReminder(new Date("2026-11-08T12:00:00")), { lesson: true, body: "Mathe LK um 8:00 in R101." });
      assert.equal(sampleReminder(new Date("2026-11-09T07:00:00")).body, "Mathe LK um 8:00 in R101.");
      data.timetable = { A: monday(""), B: monday("") };
      assert.equal(sampleReminder(new Date("2026-11-09T09:00:00")).body, "Mathe LK um 8:00.");
    } finally {
      Object.assign(data, before);
    }
  },
  "blocked reminders point to the settings of the system the page runs in"() {
    const agents = {
      mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
      windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Electron/38.0.0 Safari/537.36",
      linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Electron/38.0.0 Safari/537.36",
      chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    };
    const place = (options) => blockedPlace(options);
    assert.deepEqual(place({ shell: "android", app: true, agent: agents.android }), { where: "in den Einstellungen unter Apps › App › Benachrichtigungen", settings: "Einstellungen" });
    assert.deepEqual(place({ app: true, agent: agents.mac }), { where: "in den Systemeinstellungen unter Mitteilungen › App", settings: "Systemeinstellungen" });
    assert.deepEqual(place({ app: true, agent: agents.windows }), { where: "in den Windows-Einstellungen unter System › Benachrichtigungen", settings: "Einstellungen" });
    assert.equal(place({ app: true, agent: agents.linux }).where, "in den Systemeinstellungen unter Benachrichtigungen");
    assert.deepEqual(place({ shell: "web", agent: agents.iphone, homeScreen: true }), { where: "in den Einstellungen des iPhones unter Mitteilungen › App", settings: "" });
    assert.equal(place({ agent: agents.safari, touchPoints: 5 }).where, "in den Einstellungen des iPads unter Mitteilungen › App");
    assert.equal(place({ agent: agents.safari }).where, "in Safari unter Einstellungen › Websites › Mitteilungen");
    assert.equal(place({ agent: agents.safari, homeScreen: true }).where, "in den Systemeinstellungen unter Mitteilungen › App");
    assert.equal(place({ agent: agents.chrome }).where, "über das Symbol links neben der Adresse, dort bei Benachrichtigungen");
    assert.equal(place({ agent: agents.chrome, homeScreen: true }).where, "in den Website-Einstellungen des Browsers");
    assert.equal(place({ shell: "web", agent: agents.android, homeScreen: true }).where, "in den Einstellungen unter Apps › App › Benachrichtigungen");
    assert.equal(place({ agent: agents.android }).settings, "");
  },
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
  "a test without a time names its lesson in the words of the school, the one the server named when the plan has it that day"() {
    const before = { timetable: data.timetable, subjects: data.subjects, blocks: data.blocks };
    const empty = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    const lesson = (block, key) => ({ block, subject: key, room: "", teacher: "T" });
    const test = (id, extra) => ({ ...deadline(id, "Test", "2026-11-10"), subject: "mathe", ...extra });
    try {
      data.subjects = { mathe: { name: "Mathe", label: "Mathe", short: "Ma", hue: "rose" }, bio: { name: "Bio", label: "Bio", short: "Bi", hue: "moss" } };
      data.blocks = [{ n: 1, start: "08:00", end: "08:45" }, { n: 2, start: "08:50", end: "09:35" }, { n: 3, start: "09:55", end: "10:40" }];
      const tuesday = { ...empty, 2: [lesson(1, "bio"), lesson(2, "mathe"), lesson(3, "mathe")] };
      data.timetable = { A: tuesday, B: tuesday };
      data.deadlines = [test("t1"), test("t2", { block: 3 }), test("t3", { block: 1 }), test("t4", { time: "08:50" }), test("t5", { subject: "bio" }), test("t6", { subject: null })];
      assert.deepEqual(deadlines("2026-11-09T18:00").map(([, body]) => body), [
        "Morgen, 2.\u00a0Stunde, Mathe", "Morgen, 3.\u00a0Stunde, Mathe", "Morgen, 2.\u00a0Stunde, Mathe", "Morgen um 8:50, Mathe", "Morgen, 1.\u00a0Stunde, Bio", "Morgen",
      ]);
      assert.equal(deadlines("2026-11-10T07:00")[0][1], "Heute, 2.\u00a0Stunde, Mathe");
      data.deadlines = [{ ...test("t7"), detail: "Brüche" }, { ...test("t8"), kind: "Klausur", date: "2026-11-11" }];
      assert.deepEqual(deadlines("2026-11-09T18:00").map(([, body]) => body), ["Morgen, 2.\u00a0Stunde, Mathe\nLernstoff: Brüche"]);
      assert.deepEqual(deadlines("2026-11-10T18:00").filter(([key]) => key.startsWith("deadline:t8:")).map(([, body]) => body), ["Morgen, Mathe"], "no lesson of the subject that day");
      data.blocks = [{ n: 1, start: "08:00", end: "09:30" }, { n: 2, start: "09:50", end: "11:20" }, { n: 3, start: "11:40", end: "13:10" }];
      data.deadlines = [test("t9")];
      assert.equal(deadlines("2026-11-09T18:00")[0][1], "Morgen, 2.\u00a0Block, Mathe");
    } finally {
      Object.assign(data, before);
      data.deadlines = [];
    }
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
