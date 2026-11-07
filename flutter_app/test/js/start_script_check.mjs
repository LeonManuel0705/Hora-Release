// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Loads the script the phone injects into every page with a fake WebView bridge and checks
// what reaches the app for reminders and the permission question.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const calls = [];
const answers = { notifyPermission: "granted" };
const listeners = { document: [], window: [] };
globalThis.window = globalThis;
globalThis.flutter_inappwebview = {
  callHandler(name, value) {
    calls.push([name, value]);
    return Promise.resolve(answers[name] ?? null);
  },
};
globalThis.document = {
  documentElement: { dataset: {}, toggleAttribute() {}, style: { setProperty() {} } },
  addEventListener: (type, handler, capture) => listeners.document.push({ type, handler, capture }),
};
globalThis.addEventListener = (type, handler) => listeners.window.push({ type, handler });
globalThis.MutationObserver = class { observe() {} };
globalThis.CSS = { supports: () => true };
globalThis.HTMLElement = class {};
HTMLElement.prototype.popover = null;
new Function(readFileSync(process.argv[2], "utf8"))();

new Notification("Titel", { body: "Mathe um 8:00 in R101.", tag: "lesson:2026-11-09:1", silent: true });
new Notification("Probe");
assert.deepEqual(calls.splice(0), [
  ["notify", { title: "Titel", body: "Mathe um 8:00 in R101.", tag: "lesson:2026-11-09:1", silent: true }],
  ["notify", { title: "Probe", body: "", tag: "", silent: false }],
]);

assert.equal(Notification.permission, "default");
let told = null;
assert.equal(await Notification.requestPermission((value) => (told = value)), "granted");
assert.equal(told, "granted");
assert.equal(Notification.permission, "granted");
assert.deepEqual(calls.splice(0), [["notifyPermission", true]]);
for (const { type, handler } of listeners.window) if (type === "app:notify-permission") handler({ detail: "denied" });
assert.equal(Notification.permission, "denied");

process.stdout.write("ok");
