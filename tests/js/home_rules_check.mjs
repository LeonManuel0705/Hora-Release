// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const empty = { 1: [], 2: [], 3: [], 4: [], 5: [] };
const appData = {
  blocks: [{ n: 1, start: "08:00", end: "08:45" }],
  subjects: {},
  courses: {},
  timetable: { A: empty, B: empty },
  abReference: "2026-01-12",
  changes: [],
  tasks: [],
  deadlines: [],
  events: [],
  holidays: [],
  weather: {},
  status: {},
};

const nodes = { appData: { textContent: JSON.stringify(appData) }, appStore: { textContent: "{}" } };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
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

const { dueItems, blockIn, testAhead, homeFirst } = await import(pathToFileURL(resolve(here, "../../app/static/app/js/home-rules.js")).href);

const tuesday = new Date(2026, 10, 10, 7, 12);
const lesson = (block, subject, start, end) => ({ block, subject, startMin: start, endMin: end });
const day = (nowMin, lessons = [lesson(1, "eng", 480, 525), lesson(5, "psy", 690, 735), lesson(6, "psy", 740, 785)]) => ({ date: tuesday, nowMin, lessons });
const test = { id: "t1", kind: "Test", subject: "psy", title: "Gedächtnis", date: "2026-11-10" };
const homework = { id: "h1", kind: "Hausaufgabe", subject: "phy", title: "Arbeitsblatt 4", date: "2026-11-10" };
const late = { id: "h0", kind: "Hausaufgabe", subject: "mat", title: "Buch S. 34", date: "2026-11-09" };
const study = { id: "s1", title: "Karteikarten schreiben", date: "2026-11-12", deadline: "t1" };

const tests = {
  "a test of today stays due when study tasks hang on it"() {
    const { overdue, soon } = dueItems(tuesday, [homework, test, late], [study]);
    assert.deepEqual(overdue.map((item) => item.id), ["h0"]);
    assert.deepEqual(soon.map((item) => item.id), ["t1", "h1", "s1"]);
    assert.equal(soon.filter((item) => item.id === "t1").length, 1);
  },
  "a test that was written leaves the due list for the written ones"() {
    const { soon, written } = dueItems(new Date(2026, 10, 11, 9, 0), [test], []);
    assert.deepEqual(soon, []);
    assert.deepEqual(written.map((item) => item.id), ["t1"]);
  },
  "an entry belongs to the first lesson of its subject that day"() {
    const lessons = day(0).lessons;
    assert.equal(blockIn(test, lessons), 5);
    assert.equal(blockIn({ ...test, block: 6 }, lessons), 6);
    assert.equal(blockIn({ ...test, block: 1 }, lessons), 5);
    assert.equal(blockIn({ ...test, subject: "bio" }, lessons), null);
    assert.equal(blockIn({ ...test, subject: null }, lessons), null);
  },
  "the hero names the test of today until its lesson is over"() {
    assert.equal(testAhead([homework, test], day(432))?.block, 5);
    assert.equal(testAhead([test], day(734))?.id, "t1");
    assert.equal(testAhead([test], day(735)), null);
    assert.equal(testAhead([homework], day(432)), null);
    assert.equal(testAhead([{ ...test, date: "2026-11-11" }], day(432)), null);
  },
  "a test outside the plan counts all day and the earlier lesson comes first"() {
    const loose = { ...test, subject: "bio" };
    assert.equal(testAhead([loose], day(900))?.block, null);
    const talk = { ...test, id: "t2", kind: "Vortrag", subject: "eng" };
    assert.equal(testAhead([loose, test, talk], day(432))?.id, "t2");
    assert.equal(testAhead([loose, test, talk], day(600))?.id, "t1");
    assert.equal(testAhead([loose, test, talk], day(800))?.subject, "bio");
  },
  "right after school the way home comes first unless an event is close"() {
    const bus = { time: "16:13" };
    const gym = { start: "16:30", title: "Gym" };
    assert.equal(homeFirst(null, gym, 935), false);
    assert.equal(homeFirst(bus, undefined, 935), true);
    assert.equal(homeFirst(bus, gym, 935), true);
    assert.equal(homeFirst(bus, gym, 945), false);
    assert.equal(homeFirst(bus, { start: "17:00" }, 950), true);
    assert.equal(homeFirst({ time: "16:43" }, gym, 935), false);
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
