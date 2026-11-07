// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const kept = new Map();
const calls = [];
let answer = { ok: true };
globalThis.sessionStorage = {
  getItem: (key) => (kept.has(key) ? kept.get(key) : null),
  setItem: (key, value) => kept.set(key, String(value)),
  removeItem: (key) => kept.delete(key),
};
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true, writable: true });
globalThis.document = { documentElement: { dataset: {} } };
globalThis.window = { dispatchEvent: () => true };
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), method: options.method || "GET" });
  return answer;
};

const AppConnection = require(resolve(here, "../../app/static/js/connection-manager.js"));

function fresh({ linked = false, online = true, reply = { ok: true } } = {}) {
  kept.clear();
  calls.length = 0;
  answer = reply;
  navigator.onLine = online;
  document.documentElement.dataset = linked ? { iserv: "linked" } : { iserv: "none" };
  AppConnection.state = { internetAvailable: null, iservAvailable: null, lastCheck: null, checkInProgress: false };
}

const tests = {
  async "without an iserv login no ping is sent"() {
    fresh();
    await AppConnection.checkConnectivity();
    assert.deepEqual(calls, []);
    assert.equal(AppConnection.state.iservAvailable, false);
    assert.equal(AppConnection.state.internetAvailable, true);
  },
  async "a page without the flag counts as not linked"() {
    fresh();
    document.documentElement.dataset = {};
    await AppConnection.checkConnectivity();
    assert.deepEqual(calls, []);
    assert.equal(AppConnection.shouldCallIServ(), false);
  },
  async "with an iserv login the ping decides"() {
    fresh({ linked: true });
    await AppConnection.checkConnectivity();
    assert.deepEqual(calls, [{ url: "/api/iserv/ping", method: "HEAD" }]);
    assert.equal(AppConnection.shouldCallIServ(), true);
    fresh({ linked: true, reply: { ok: false } });
    await AppConnection.checkConnectivity();
    assert.equal(AppConnection.shouldCallIServ(), false);
  },
  async "nothing is asked of another server"() {
    for (const linked of [false, true]) {
      fresh({ linked });
      await AppConnection.init();
      await AppConnection.refresh();
      assert.ok(calls.every((call) => call.url.startsWith("/")), JSON.stringify(calls));
    }
  },
  async "offline means neither and asks nobody"() {
    fresh({ linked: true, online: false });
    await AppConnection.checkConnectivity();
    assert.deepEqual(calls, []);
    assert.equal(AppConnection.state.internetAvailable, false);
    assert.equal(AppConnection.state.iservAvailable, false);
  },
  async "online without a probe still counts as internet"() {
    fresh();
    await AppConnection.checkConnectivity();
    assert.equal(AppConnection.shouldCallExternalAPI(), true);
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n${error.stack}`);
  }
}
process.exit(failed ? 1 : 0);
