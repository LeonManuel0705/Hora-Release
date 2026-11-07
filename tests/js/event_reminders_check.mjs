// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = (name) => pathToFileURL(resolve(here, "../../app/static/app/js", name)).href;

const event = (id, date, start, extra = {}) => ({ id, title: id, date, start, end: null, place: "", kind: "private", synced: false, ...extra });
const appData = {
  blocks: [], subjects: {}, courses: {}, timetable: { A: {}, B: {} }, abReference: "2026-01-12", changes: [], tasks: [], deadlines: [], holidays: [],
  weather: {}, status: {},
  events: [
    event("plain", "2026-11-10", "16:00"),
    event("half", "2026-11-10", "17:00", { reminderMinutes: 30 }),
    event("never", "2026-11-10", "18:00", { reminderMinutes: -1 }),
    event("start", "2026-11-10", "19:00", { reminderMinutes: 0, place: "Aula" }),
    event("tomorrow", "2026-11-11", "08:00", { reminderMinutes: 1440 }),
    event("klavier", "2026-10-20", "15:00", { reminderMinutes: 10, recurrence: { freq: "weekly", exceptions: ["2026-11-17"] } }),
    event("late", "2026-11-10", "23:00"),
    event("allday", "2026-11-10", null, { reminderMinutes: 0 }),
  ],
};
const store = new Map();
const nodes = { appData: { textContent: JSON.stringify(appData) }, appStore: { textContent: "{}" } };
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
globalThis.document = {
  documentElement: { dataset: { brand: "App", motion: "calm" }, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, style: { setProperty() {} } },
  getElementById: (id) => nodes[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: () => ({ content: { childNodes: [] }, set innerHTML(value) {}, style: {}, classList: { add() {}, remove() {} } }),
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

const { dueReminders, readPrefs } = await import(script("reminders.js"));

const at = (day, clock) => {
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] = clock.split(":").map(Number);
  return new Date(year, month - 1, date, hours, minutes);
};
const on = readPrefs({ notify: { enabled: true } });
const off = readPrefs({ notify: { enabled: true, categories: { events: { on: false } } } });
const seen = (prefs, day, clock) => dueReminders(prefs, at(day, clock)).filter((item) => item.key.startsWith("event:")).map((item) => `${item.title}: ${item.body}`);

const tests = {
  "an event without its own reminder reminds as the settings say"() {
    assert.deepEqual(seen(on, "2026-11-10", "15:45"), ["plain: Um 16:00"]);
    assert.deepEqual(seen(on, "2026-11-10", "15:40"), []);
  },
  "an event with its own minutes reminds then and only then"() {
    assert.deepEqual(seen(on, "2026-11-10", "16:30"), ["half: Um 17:00"]);
    assert.deepEqual(seen(on, "2026-11-10", "16:45"), []);
  },
  "an event that should not remind stays quiet"() {
    assert.deepEqual(seen(on, "2026-11-10", "17:45"), []);
  },
  "at the start means at the start"() {
    assert.deepEqual(seen(on, "2026-11-10", "19:00"), ["start: Jetzt in Aula"]);
  },
  "a day before reminds the day before at the same time"() {
    assert.deepEqual(seen(on, "2026-11-10", "08:00"), ["tomorrow: Morgen um 8:00"]);
    assert.deepEqual(seen(on, "2026-11-11", "07:45"), []);
  },
  "every occurrence of a series reminds of its own, a left out one does not"() {
    assert.deepEqual(seen(on, "2026-11-10", "14:50").filter((text) => text.startsWith("klavier")), ["klavier: Um 15:00"]);
    assert.deepEqual(seen(on, "2026-11-17", "14:50").filter((text) => text.startsWith("klavier")), []);
    assert.deepEqual(dueReminders(on, at("2026-11-24", "14:50")).filter((item) => item.key.startsWith("event:klavier")).map((item) => item.key), ["event:klavier~2026-11-24:2026-11-24"]);
  },
  "with event reminders switched off only events with their own minutes remind"() {
    assert.deepEqual(seen(off, "2026-11-10", "15:45"), []);
    assert.deepEqual(seen(off, "2026-11-10", "16:30"), ["half: Um 17:00"]);
  },
  "quiet hours and events without a time stay quiet"() {
    assert.deepEqual(seen(on, "2026-11-10", "22:45"), []);
    assert.deepEqual(seen(on, "2026-11-10", "00:00"), []);
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
