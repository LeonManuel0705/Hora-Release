// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Runs the page's reminder engine for every minute of a few days and prints the first
// minute each reminder is due, so the planned reminders of the phone can be compared.
import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(process.argv[2], "utf8"));
const values = new Map();
const nodes = { appData: { textContent: JSON.stringify(fixture.data) }, appStore: { textContent: JSON.stringify(fixture.store) } };
globalThis.localStorage = {
  getItem: (key) => (values.has(key) ? values.get(key) : null),
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
globalThis.document = {
  documentElement: { dataset: { brand: fixture.brand, motion: "calm" }, classList: { toggle() {}, add() {}, remove() {} }, style: { setProperty() {} } },
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
Object.defineProperty(globalThis, "navigator", { value: { platform: "Linux armv8l", userAgent: "node" }, configurable: true });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.addEventListener = () => {};
globalThis.dispatchEvent = () => true;
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const engine = pathToFileURL(resolve(here, "../../assets/ui/static/app/js/reminders.js")).href;
const { dueReminders, readPrefs } = await import(engine);

const [year, month, day] = fixture.from.split("-").map(Number);
const prefs = readPrefs();
const seen = new Map();
for (let offset = 0; offset < fixture.days; offset += 1) {
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const date = new Date(year, month - 1, day + offset, Math.floor(minute / 60), minute % 60);
    for (const reminder of dueReminders(prefs, date)) {
      if (seen.has(reminder.key)) continue;
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      seen.set(reminder.key, { key: reminder.key, day: iso, minute, title: reminder.title, body: reminder.body });
    }
  }
}
process.stdout.write(JSON.stringify([...seen.values()]));
