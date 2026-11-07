import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = pathToFileURL(resolve(here, "../../app/static/app/js/core.js")).href;
const { cases } = JSON.parse(readFileSync(resolve(here, "../ab_weeks.json"), "utf8"));

const week = { 1: [{ block: 1, subject: "mathe", room: "R101", teacher: "T" }], 2: [], 3: [], 4: [], 5: [] };
const appData = {
  blocks: [{ n: 1, start: "08:00", end: "09:30" }],
  subjects: { mathe: { name: "Mathe", label: "Mathe", short: "Ma", hue: "rose" } },
  courses: {},
  timetable: { A: week, B: week },
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

async function load(store, tag) {
  nodes.appStore.textContent = JSON.stringify(store);
  return import(`${source}?${tag}`);
}

const at = (iso, time) => new Date(`${iso}T${time}:00`);
const other = (letter) => (letter === "A" ? "B" : "A");

const plain = await load({}, "plain");
const off = await load({ "app-ab-weeks": false }, "off");
const swapped = await load({ "app-ab-swap": true }, "swapped");

const tests = {
  "the page counts the weeks from the reference exactly like the desktop"() {
    assert.ok(cases.length > 30);
    for (const item of cases) {
      plain.data.abReference = item.reference;
      for (const time of ["00:00", "12:00", "23:59"]) {
        assert.equal(plain.weekType(at(item.day, time)), item.week, `${item.day} ${time} from ${item.reference}`);
      }
    }
  },
  "with A/B weeks off every week is an A week"() {
    for (const item of cases) {
      off.data.abReference = item.reference;
      assert.equal(off.weekType(at(item.day, "12:00")), "A", item.day);
    }
  },
  "swapping A and B turns every week of the reference around"() {
    assert.equal(swapped.data.abReference, "2026-01-19");
    for (const item of cases.filter((entry) => entry.reference === "2026-01-12")) {
      assert.equal(swapped.weekType(at(item.day, "12:00")), other(item.week), item.day);
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
