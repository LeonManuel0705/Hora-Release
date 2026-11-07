// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const shell = readFileSync(process.argv[2] || resolve(here, "../../flutter_app/web/index.html"), "utf8");
const page = readFileSync(resolve(here, "../../app/static/app/js/plan-share.js"), "utf8");
const scripts = [...shell.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
const KEY = /const PENDING_KEY = "([^"]+)"/.exec(page)[1];
const APP = "https://example.org/pwa/";

function browser(address, { popstateOnFragment = true } = {}) {
  const entries = [{ url: new URL(address), state: null }];
  let index = 0;
  const listeners = [];
  const traversals = [];
  const stored = new Map();
  const posted = [];
  const app = { messages: [], route: "/" };
  const current = () => entries[index];
  const clone = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
  const target = (path) => (path === undefined || path === null ? current().url : new URL(path, current().url));
  const window = {};
  const dispatch = (type, state = null) => {
    const event = { type, state: clone(state), stopped: false, stopImmediatePropagation() { this.stopped = true; } };
    const order = [...listeners.filter((item) => item.type === type && item.capture), ...listeners.filter((item) => item.type === type && !item.capture)];
    for (const item of order) {
      if (event.stopped) break;
      item.listener.call(window, event);
    }
  };
  const history = {
    get state() { return clone(current().state); },
    get length() { return entries.length; },
    pushState(state, title, path) {
      entries.splice(index + 1);
      entries.push({ url: target(path), state: clone(state) });
      index += 1;
    },
    replaceState(state, title, path) {
      entries[index] = { url: target(path), state: clone(state) };
    },
    go(delta) { traversals.push(delta); },
    back() { traversals.push(-1); },
    forward() { traversals.push(1); },
  };
  const location = {
    get href() { return current().url.href; },
    get origin() { return current().url.origin; },
    get pathname() { return current().url.pathname; },
    get search() { return current().url.search; },
    get hash() { return current().url.hash; },
  };
  const frame = { contentWindow: { postMessage: (data, origin) => posted.push({ data, origin }) } };
  Object.assign(window, {
    window,
    self: window,
    history,
    location,
    navigator: {},
    URL,
    setTimeout: () => 0,
    clearTimeout: () => {},
    console,
    sessionStorage: { getItem: (key) => (stored.has(key) ? stored.get(key) : null), setItem: (key, value) => stored.set(key, String(value)), removeItem: (key) => stored.delete(key) },
    document: { getElementById: (id) => (id === "hub-frame" && app.booted ? frame : null), querySelector: () => null },
    addEventListener: (type, listener, options) => listeners.push({ type, listener, capture: options === true || !!options?.capture }),
    removeEventListener: () => {},
  });
  vm.createContext(window);
  scripts.forEach((source) => {
    try {
      vm.runInContext(source, window);
    } catch {}
  });

  function settle() {
    for (let turn = 0; traversals.length && turn < 50; turn += 1) {
      const step = index + traversals.shift();
      if (step < 0 || step >= entries.length) continue;
      const hash = current().url.hash;
      index = step;
      dispatch("popstate", current().state);
      if (current().url.hash !== hash) dispatch("hashchange");
    }
  }

  return {
    window,
    stored,
    posted,
    app,
    entries: () => entries.map((entry) => `${entry.url.pathname}${entry.url.hash}${entry.state ? ` ${JSON.stringify(entry.state)}` : ""}`),
    at: () => index,
    boot() {
      const isOrigin = (state) => state?.origin === true;
      const isApp = (state) => state?.flutter === true;
      const path = () => location.hash.slice(1) || "/";
      app.route = path();
      if (!isApp(history.state)) {
        history.replaceState({ origin: true, state: history.state }, "origin", `${location.pathname}${location.search}`);
        history.pushState({ flutter: true }, "flutter", `${location.pathname}${location.search}#${app.route}`);
      }
      app.booted = true;
      window.addEventListener("popstate", (event) => {
        if (isOrigin(event.state)) {
          history.pushState({ flutter: true }, "flutter", `${location.pathname}${location.search}#${app.route}`);
          app.messages.push("popRoute");
        } else if (isApp(event.state)) {
          app.messages.push(`pushRoute ${app.route}`);
        } else {
          app.route = path();
          history.go(-1);
        }
      });
    },
    open(hash) {
      entries.splice(index + 1);
      entries.push({ url: new URL(hash, current().url), state: null });
      index += 1;
      if (popstateOnFragment) dispatch("popstate", null);
      dispatch("hashchange");
      settle();
    },
    back() {
      history.back();
      settle();
    },
    forward() {
      history.forward();
      settle();
    },
  };
}

const tests = {
  "a cold start link is kept for the page and taken out of the address before the app starts"() {
    const tab = browser(`${APP}#plan=COLD`);
    assert.equal(tab.stored.get(KEY), "plan=COLD");
    assert.equal(tab.window.location.hash, "");
    tab.boot();
    assert.deepEqual(tab.entries(), ['/pwa/ {"origin":true,"state":null}', '/pwa/#/ {"flutter":true}']);
    tab.back();
    assert.deepEqual(tab.app.messages, ["popRoute"]);
  },
  "a link while the app is open reaches the page once and never the app"() {
    for (const popstateOnFragment of [true, false]) {
      const tab = browser(APP, { popstateOnFragment });
      tab.boot();
      tab.open("#plan=OPEN");
      assert.equal(tab.stored.get(KEY), "plan=OPEN");
      assert.equal(tab.posted.length, 1);
      assert.equal(JSON.stringify(tab.posted[0]), JSON.stringify({ data: { source: "shell", type: "plan-link" }, origin: "https://example.org" }));
      assert.equal(tab.at(), 1);
      assert.deepEqual(tab.window.history.state, { flutter: true });
      assert.deepEqual(tab.app.messages, []);
    }
  },
  "back after such a link leaves the app as it would without the link, without a second shell"() {
    for (const popstateOnFragment of [true, false]) {
      const tab = browser(APP, { popstateOnFragment });
      tab.boot();
      tab.open("#plan=OPEN");
      tab.back();
      assert.deepEqual(tab.app.messages, ["popRoute"]);
    }
  },
  "forward onto the spent link entry bounces back without a second import"() {
    const tab = browser(APP);
    tab.boot();
    tab.open("#plan=OPEN");
    tab.stored.delete(KEY);
    tab.forward();
    assert.equal(tab.at(), 1);
    assert.deepEqual(tab.app.messages, []);
    assert.equal(tab.stored.has(KEY), false);
    assert.equal(tab.posted.length, 1);
    tab.back();
    assert.deepEqual(tab.app.messages, ["popRoute"]);
  },
  "two links in a row and an ordinary route change still behave"() {
    const tab = browser(APP);
    tab.boot();
    tab.open("#plan=ONE");
    tab.open("#plan=TWO");
    assert.equal(tab.stored.get(KEY), "plan=TWO");
    assert.deepEqual(tab.app.messages, []);
    tab.open("#/settings");
    assert.deepEqual(tab.app.messages, ["pushRoute /settings"]);
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    run();
    console.log(`ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${String(error?.stack || error).split("\n").join("\n      ")}`);
  }
}
if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
