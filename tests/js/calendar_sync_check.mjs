// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The calendar page against a small stand-in for the browser: when it asks for Google's changes and what it redraws.

import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = (name) => pathToFileURL(resolve(here, "../../app/static/app/js", name)).href;

const WINDOW = { start: "2026-09-01", end: "2027-02-15" };
const appData = {
  blocks: [{ n: 1, start: "08:00", end: "09:30" }], subjects: {}, courses: {}, timetable: { A: {}, B: {} }, abReference: "2026-01-12",
  changes: [], tasks: [], deadlines: [], events: [], holidays: [], weather: {}, status: { google: "ok" },
  page: { region: "", events: [], holidays: [], notes: {}, sync: { source: "google", write: true, window: WINDOW, state: "ok", stand: "2026-11-17T15:20" } },
};

const counts = { view: 0, reveal: 0, spin: 0 };
const elements = new Map();
function element(id) {
  const classes = new Set();
  const attributes = new Map();
  let html = "";
  const node = {
    id, hidden: false, dataset: {}, textContent: "", placeholder: "", value: "",
    style: { setProperty() {}, removeProperty() {} },
    classList: {
      add: (...names) => names.forEach((name) => {
        if (id === "calSync" && name === "is-spinning") counts.spin += 1;
        classes.add(name);
      }),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, on = !classes.has(name)) => (on ? classes.add(name) : classes.delete(name), on),
      contains: (name) => classes.has(name),
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name) ?? null,
    removeAttribute: (name) => attributes.delete(name),
    addEventListener() {},
    focus() {},
    contains: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 900, height: 700, top: 0, left: 0, right: 900, bottom: 700 }),
    animate: () => ({ finished: Promise.resolve(), cancel() {} }),
  };
  Object.defineProperty(node, "innerHTML", {
    get: () => html,
    set(value) {
      html = value;
      if (id === "calView") counts.view += 1;
    },
  });
  return node;
}
const card = { animate: () => ((counts.reveal += 1), { finished: Promise.resolve(), cancel() {} }) };

const store = new Map();
const listeners = { window: {}, document: {} };
const listen = (target) => (type, run) => (listeners[target][type] ||= []).push(run);
const fire = (target, type) => (listeners[target][type] || []).forEach((run) => run({ type }));
const fixed = { appData: { textContent: JSON.stringify(appData) }, appStore: { textContent: "{}" } };
globalThis.sessionStorage = { getItem: () => "1", setItem() {} };
globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) };
globalThis.document = {
  documentElement: { dataset: { brand: "App", motion: "calm" }, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, style: { setProperty() {} } },
  getElementById(id) {
    if (fixed[id]) return fixed[id];
    if (!/^cal|^liveStatus$/.test(id)) return null;
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id);
  },
  querySelector: () => null,
  querySelectorAll: (selector) => (selector.startsWith("#calView .ev, ") ? [card] : []),
  addEventListener: listen("document"),
  createElement: () => element("scratch"),
  hasFocus: () => true,
  hidden: false,
  visibilityState: "visible",
};
globalThis.location = { search: "?datum=2026-11-17&t=15:20", pathname: "/hub/calendar", href: "http://127.0.0.1/hub/calendar", hash: "" };
globalThis.self = globalThis;
globalThis.window = globalThis;
Object.defineProperty(globalThis, "navigator", { value: { platform: "MacIntel", userAgent: "node" }, configurable: true });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.addEventListener = listen("window");
globalThis.dispatchEvent = () => true;
globalThis.ResizeObserver = class { observe() {} };
globalThis.CSS = { escape: (text) => text };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
globalThis.requestAnimationFrame = (run) => setTimeout(run, 0);

const intervals = [];
globalThis.setInterval = (run, wait) => intervals.push({ run, wait }) - 1;
const realNow = Date.now;
let ahead = 0;
Date.now = () => realNow() + ahead;
const later = (ms) => (ahead += ms);

const asked = [];
let answer = null;
globalThis.fetch = async (url) => {
  asked.push(String(url));
  return { ok: true, json: async () => answer(String(url)) };
};
const gym = { id: "g-primary-gym", date: "2026-11-18", start: "16:30", end: "18:00", title: "Gym", place: "", kind: "training", notes: "", synced: true, calendarName: "Privat", color: "#4285f4" };
const kino = { ...gym, id: "g-primary-kino", date: "2026-11-19", start: "20:00", end: "22:00", title: "Kino", kind: "private" };
const google = (events, stand, extra = {}) => () => ({ success: true, events, own: [], source: "google", stand, window: WINDOW, problem: null, message: "", ...extra });
const settle = async () => {
  for (let index = 0; index < 20; index += 1) await new Promise((done) => setTimeout(done, 0));
};

const { data } = await import(script("core.js"));
const calendar = await import(script("pages/calendar.js"));

answer = google([gym], "2026-11-17T15:20");
calendar.init();
await settle();
const minute = intervals.find((item) => item.wait === 60000);
const sync = elements.get("calSync");

const tests = {
  "the page asks at once when it opens and draws the events that came"() {
    assert.deepEqual(asked, ["/api/ui/events/synced?frisch=1"]);
    assert.ok(counts.view >= 1 && counts.reveal >= 1, JSON.stringify(counts));
    assert.equal(sync.hidden, false, "with Google the reload button is there");
  },
  async "every minute it asks quietly, and a check that only moves the stand redraws nothing"() {
    assert.ok(minute, "an interval of a minute keeps the open page fresh");
    for (const stand of ["2026-11-17T15:21", "2026-11-17T15:22", "2026-11-17T15:23"]) {
      const before = { ...counts, asked: asked.length };
      answer = google([gym], stand);
      later(61000);
      minute.run();
      await settle();
      assert.equal(asked.length, before.asked + 1, `${stand}: one check`);
      assert.equal(counts.spin, before.spin, `${stand}: the reload button does not spin for a check of its own`);
      assert.equal(counts.view, before.view, `${stand}: the view is not drawn again`);
      assert.equal(counts.reveal, before.reveal, `${stand}: nothing flies in again`);
    }
  },
  async "coming back to the front asks at once, but not within ten seconds of the last check"() {
    const before = asked.length;
    later(5000);
    fire("window", "focus");
    await settle();
    assert.equal(asked.length, before, "five seconds after a check");
    later(6000);
    fire("window", "focus");
    await settle();
    assert.equal(asked.length, before + 1, "eleven seconds after a check");
  },
  async "a hidden page asks nothing until it is shown again"() {
    const before = asked.length;
    document.hidden = true;
    document.visibilityState = "hidden";
    later(61000);
    minute.run();
    await settle();
    assert.equal(asked.length, before);
    document.hidden = false;
    document.visibilityState = "visible";
    fire("document", "visibilitychange");
    await settle();
    assert.equal(asked.length, before + 1);
  },
  async "a new event in Google draws the view and lets the events come in"() {
    const before = { ...counts };
    answer = google([gym, kino], "2026-11-17T15:30");
    later(61000);
    minute.run();
    await settle();
    assert.equal(counts.view, before.view + 1);
    assert.ok(counts.reveal > before.reveal);
    assert.equal(counts.spin, before.spin);
  },
  async "Google out of reach redraws the head line state once, without a fly-in"() {
    const before = { ...counts };
    answer = google([gym, kino], "2026-11-17T15:30", { problem: "offline", message: "Google ist gerade nicht erreichbar." });
    later(61000);
    minute.run();
    await settle();
    assert.equal(counts.view, before.view + 1);
    assert.equal(counts.reveal, before.reveal);
    assert.match(elements.get("calCount").textContent, /Google nicht erreichbar/);
  },
  async "without Google the page shows no reload button and never asks on its own"() {
    data.page = { ...data.page, sync: { source: null, write: false, window: WINDOW, state: null, stand: null } };
    const plain = await import(`${script("pages/calendar.js")}?plain`);
    const first = intervals.length;
    answer = () => ({ success: true, events: [], source: null });
    const before = asked.length;
    plain.init();
    await settle();
    assert.equal(asked.length, before + 1, "the first look for a Mac calendar stays");
    assert.equal(sync.hidden, true);
    const own = intervals.slice(first).find((item) => item.wait === 60000);
    later(61000);
    own.run();
    await settle();
    assert.equal(asked.length, before + 1);
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n${String(error.stack || error.message).slice(0, 2000)}`);
  }
}
process.exit(failed ? 1 : 0);
