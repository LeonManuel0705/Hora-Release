// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The tour's marks and its page change on a small stand-in for the page: the field to type into gets a ring, Luna goes
// on from where she was and never starts in a corner, and before a page changes she taps its tab once, briefly.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = (name) => readFileSync(resolve(here, "../../app/static/js", name), "utf8");

function node(tag = "div") {
  const attributes = {};
  return {
    tagName: tag.toUpperCase(),
    style: {},
    dataset: {},
    attributes,
    classList: { set: new Set(), add(name) { this.set.add(name); }, remove(name) { this.set.delete(name); }, toggle(name, on) { if (on ?? !this.set.has(name)) this.set.add(name); else this.set.delete(name); }, contains(name) { return this.set.has(name); } },
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute: (name) => attributes[name] ?? null,
    addEventListener() {},
    appendChild() {},
    remove() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }),
  };
}

// An arm as the guide's drawing holds it: its name and widths, and the path it is drawn with.
function arm(name, side) {
  const el = node("path");
  el.dataset = { arm: name, w0: "7.5", w1: "2.4", side: String(side) };
  return el;
}

const ARMS = [arm("hl", 0), arm("hr", 0)];
const svg = node("svg");
svg.querySelector = () => node("g");
svg.querySelectorAll = (selector) => (selector === "[data-arm]" ? ARMS : []);

globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = {
  readyState: "loading",
  visibilityState: "hidden",
  documentElement: { dataset: {}, classList: { add() {}, remove() {}, contains: () => false } },
  body: { appendChild() {} },
  addEventListener() {},
  createElement(tag) {
    const el = node(tag);
    if (tag === "div") Object.defineProperty(el, "firstElementChild", { get: () => svg });
    return el;
  },
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.addEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.location = { search: "", pathname: "/hub" };
Object.defineProperty(globalThis, "navigator", { value: { hardwareConcurrency: 8, deviceMemory: 8 }, configurable: true });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = () => 0;
runInThisContext(source("luna.js"));
runInThisContext(source("tour.js"));
const { AppLuna, AppTour } = globalThis;

const CASES = {};

CASES["the field to type into gets a ring while the page stays bright, the other steps keep their marks"] = () => {
  assert.equal(AppTour.spotKind("task-new"), "outline", "Schreib oben ins Feld: a ring around the field");
  for (const id of ["nav", "home", "tasks", "school"]) assert.equal(AppTour.spotKind(id), "shade", id);
  assert.equal(AppTour.spotKind("hello"), "shade");
};

CASES["every page the tour goes to has the tab Luna taps"] = () => {
  assert.equal(AppTour.tabOf("/hub"), "home");
  assert.equal(AppTour.tabOf("/hub/tasks"), "tasks");
  assert.equal(AppTour.tabOf("/hub/school"), "school");
  assert.equal(AppTour.tabOf("/hub/settings"), null, "a page without a tab of its own: no tap");
  const pages = [...source("tour.js").matchAll(/page: '([^']+)'/g)].map((match) => match[1]);
  assert.ok(pages.length >= 5);
  for (const page of pages) assert.ok(AppTour.tabOf(page), page);
};

CASES["the tap is short, and with reduced motion only a mark"] = () => {
  const { reach, leave, still } = AppTour.TAP;
  assert.ok(reach > 200 && reach < leave, "the tentacle reaches out before the tab gives way");
  assert.ok(leave >= 500 && leave <= 700, `the page changes after ${leave} ms`);
  assert.ok(still <= 200, "reduced motion waits only a moment");
};

CASES["on the next page Luna goes on from where she was, kept inside the window, and never from the corner"] = () => {
  assert.deepEqual(AppTour.carried({ gx: 233, gy: 24 }, 1280, 800, 124), { x: 233, y: 24 });
  assert.deepEqual(AppTour.carried({ gx: 1240, gy: 790 }, 393, 852, 96), { x: 297, y: 756 }, "from a wider window into a phone");
  assert.deepEqual(AppTour.carried({ gx: -40, gy: -10 }, 393, 852, 96), { x: 0, y: 0 });
  assert.equal(AppTour.carried(null, 393, 852, 96), null, "nothing kept: she appears at the step's own place");
  assert.equal(AppTour.carried({ id: "home" }, 393, 852, 96), null);
};

CASES["the guide waits off screen until it is placed"] = () => {
  const guide = AppLuna.guide({ size: 96 });
  assert.equal(guide.el.style.transform, "translate3d(-1000px,-1000px,0)");
  guide.place(120, 300);
  assert.equal(guide.el.style.transform, "translate3d(120.00px,300.00px,0)");
};

CASES["the tap reaches out, presses once and then holds"] = () => {
  const guide = AppLuna.guide({ size: 96 });
  guide.place(200, 200);
  guide.setMode("tap", { x: 20, y: 400 });
  assert.equal(guide.side, -1, "the tentacle on the side of the tab");
  const tip = () => guide.cur.hl.at(-1);
  const reachOf = () => Math.hypot(tip()[0] - 39, tip()[1] - 58);
  const at = (seconds) => {
    while (guide.modeT < seconds) guide.step(1 / 60);
    return reachOf();
  };
  const start = at(0.02);
  const reached = at(0.26);
  const pressed = at(0.35);
  const after = at(0.5);
  const later = at(0.9);
  assert.ok(reached > start + 4, `the tentacle reaches out: ${start.toFixed(1)} to ${reached.toFixed(1)}`);
  assert.ok(pressed > reached + 2, `it presses: ${pressed.toFixed(1)} beyond ${reached.toFixed(1)}`);
  assert.ok(Math.abs(after - reached) < 2.5 && Math.abs(later - after) < 2.5, `then it holds: ${after.toFixed(1)}, ${later.toFixed(1)}`);
};

let failed = 0;
for (const [name, run] of Object.entries(CASES)) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n${error?.stack || error}`);
  }
}
process.exit(failed ? 1 : 0);
