// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Loads the script the phone injects into every page with a fake WebView bridge and checks
// what reaches the app for reminders, the permission question and downloads.
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
globalThis.dispatchEvent = (event) => {
  for (const { type, handler } of listeners.window) if (type === event.type) handler(event);
  return true;
};
globalThis.MutationObserver = class { observe() {} };
globalThis.CSS = { supports: () => true };
globalThis.HTMLElement = class {};
HTMLElement.prototype.popover = null;
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onload();
    });
  }
};

new Function(readFileSync(process.argv[2], "utf8"))();

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const click = (attributes) => {
  const link = { getAttribute: (name) => attributes[name] ?? null };
  const event = { target: { closest: (selector) => (selector === "a[download]" && "download" in attributes ? link : null) }, prevented: false, preventDefault() { this.prevented = true; } };
  for (const { type, handler } of listeners.document) if (type === "click") handler(event);
  return event;
};

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

const outcomes = [];
addEventListener("app:download", (event) => outcomes.push(event.detail));

answers.saveFile = { state: "saved", name: "sicherung (1).json", folder: "Download" };
const blob = new Blob(['{"a":1}'], { type: "application/json" });
const url = URL.createObjectURL(blob);
const saved = click({ href: url, download: "sicherung.json" });
assert.equal(saved.prevented, true);
await settle();
assert.deepEqual(calls.splice(0), [["saveFile", { name: "sicherung.json", data: Buffer.from('{"a":1}').toString("base64") }]]);
assert.deepEqual(outcomes.splice(0), [{ state: "saved", name: "sicherung (1).json", folder: "Download" }], "the page hears the name the file got");

answers.saveFile = { state: "cancelled", name: "sicherung.json", folder: null };
click({ href: URL.createObjectURL(new Blob(["x"])), download: "sicherung.json" });
await settle();
assert.deepEqual(outcomes.splice(0), [{ state: "cancelled", name: "sicherung.json", folder: null }]);
calls.splice(0);

const huge = URL.createObjectURL(new Blob([new Uint8Array(64 * 1024 * 1024 + 1)]));
assert.equal(click({ href: huge, download: "riesig.json" }).prevented, true);
await settle();
assert.equal(calls.length, 0, "a file too large for the app never crosses the bridge");
assert.deepEqual(outcomes.splice(0), [{ state: "failed", name: "riesig.json", folder: null, reason: "too-large" }]);

answers.saveFile = null;
click({ href: URL.createObjectURL(new Blob(["x"])), download: "kaputt.json" });
await settle();
calls.splice(0);
assert.deepEqual(outcomes.splice(0), [{ state: "failed", name: "kaputt.json", folder: null, reason: null }], "no answer counts as failed");

URL.revokeObjectURL(url);
assert.equal(click({ href: url, download: "weg.json" }).prevented, false, "a revoked blob is left to the WebView");
answers.saveFile = { state: "saved", name: "gruss.txt", folder: "Download" };
const inline = click({ href: "data:text/plain,Hallo", download: "gruss.txt" });
assert.equal(inline.prevented, true);
await settle();
assert.deepEqual(calls.splice(0), [["saveFile", { name: "gruss.txt", url: "data:text/plain,Hallo" }]]);
assert.deepEqual(outcomes.splice(0), [{ state: "saved", name: "gruss.txt", folder: "Download" }]);
assert.equal(click({ href: "/hub/tasks" }).prevented, false);
assert.equal(calls.length, 0);
process.stdout.write("ok");
