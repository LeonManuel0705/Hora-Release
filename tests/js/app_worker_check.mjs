// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../../flutter_app/web/app_worker.js"), "utf8");
const ORIGIN = "https://app.example";
const SCRIPT = `${ORIGIN}/pwa/app_worker.js`;
const urlOf = (key) => (typeof key === "string" ? new URL(key, SCRIPT).href : key.url);
const sha = (text) => createHash("sha256").update(text).digest("hex");

class Cache {
  entries = new Map();
  async match(key) {
    const hit = this.entries.get(urlOf(key));
    return hit && new Response(hit.body, { status: hit.status, headers: hit.headers });
  }
  async put(key, response) {
    this.entries.set(urlOf(key), { body: await response.text(), status: response.status, headers: [...response.headers] });
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(key) {
    return this.entries.delete(urlOf(key));
  }
}

class Caches {
  named = new Map();
  async open(name) {
    if (!this.named.has(name)) this.named.set(name, new Cache());
    return this.named.get(name);
  }
  async has(name) {
    return this.named.has(name);
  }
  async keys() {
    return [...this.named.keys()];
  }
  async delete(name) {
    return this.named.delete(name);
  }
}

const served = new Map();
const asked = [];
let online = true;
let deploys = 0;
const caches = new Caches();
const live = new Set();

function deploy(files) {
  deploys += 1;
  served.clear();
  for (const [path, body] of Object.entries(files)) served.set(`/pwa/${path === "index.html" ? "" : path}`, body);
}

async function network(input) {
  const url = new URL(urlOf(input));
  asked.push(url.pathname);
  if (!online) throw new TypeError("offline");
  const body = served.get(url.pathname);
  if (body === undefined) return new Response("missing", { status: 404 });
  const page = url.pathname.endsWith("/") ? body.replace("<head>", "<head><!-- host -->") : body;
  return new Response(page, { status: 200, headers: { "Content-Type": "text/plain", "X-Deploy": String(deploys) } });
}

function worker(files) {
  const manifest = files ? { build: sha(JSON.stringify(Object.entries(files).map(([path, body]) => [path, sha(body)]))).slice(0, 16), files: Object.fromEntries(Object.entries(files).map(([path, body]) => [path, sha(body)])) } : null;
  const handlers = {};
  const scope = {
    location: new URL(SCRIPT),
    addEventListener: (type, handler) => (handlers[type] = handler),
    skipWaiting: async () => {},
    clients: { matchAll: async () => [...live].map((id) => ({ id })) },
    caches,
    fetch: network,
    crypto: globalThis.crypto,
    Response,
    Request,
    URL,
    TextEncoder,
    console,
  };
  scope.self = scope;
  vm.runInNewContext(source.replace(/^const MANIFEST = .*;$/m, `const MANIFEST = ${JSON.stringify(manifest)};`), scope);
  const extend = async (type, fields = {}) => {
    const pending = [];
    let answer = null;
    const event = { ...fields, waitUntil: (promise) => pending.push(promise), respondWith: (promise) => (answer = promise) };
    handlers[type](event);
    const response = answer && (await answer);
    await Promise.all(pending);
    await Promise.all(pending);
    return response;
  };
  return {
    build: manifest && manifest.build,
    install: () => extend("install"),
    activate: () => extend("activate"),
    open: async (client, path = "") => {
      live.add(client);
      const response = await extend("fetch", { request: { url: `${ORIGIN}/pwa/${path}`, method: "GET", mode: "navigate" }, clientId: "", resultingClientId: client });
      return response.text();
    },
    load: async (client, path) => {
      const response = await extend("fetch", { request: new Request(`${ORIGIN}/pwa/${path}`), clientId: client, resultingClientId: "" });
      return response && response.status === 200 ? response.text() : null;
    },
  };
}

const shellNames = async () => (await caches.keys()).filter((name) => name.startsWith("app-shell-")).sort();

const first = {
  "index.html": "<html><head></head><body>start</body></html>",
  "main.dart.js": "code(1)",
  "assets/assets/ui/pages/tasks.html": "<html><head></head>tasks 1</html>",
  "assets/assets/ui/static/app/js/settings.js": "settings 1",
};
const second = { ...first, "main.dart.js": "code(2)", "assets/assets/ui/pages/tasks.html": "<html><head></head>tasks 2</html>" };

deploy(first);
const one = worker(first);
await one.install();
await one.activate();
assert.deepEqual(await shellNames(), [`app-shell-${one.build}`]);

assert.match(await one.open("tab-a"), /start/, "the start page comes from the kept copy");
assert.equal(await one.load("tab-a", "main.dart.js"), "code(1)");

online = false;
assert.match(await one.open("tab-b"), /start/, "without network the app still starts");
assert.equal(await one.load("tab-b", "assets/assets/ui/pages/tasks.html"), "<html><head></head>tasks 1</html>", "a page never opened before is there offline");
live.delete("tab-b");
online = true;

deploy(second);
asked.length = 0;
const two = worker(second);
await two.install();
assert.deepEqual(asked.sort(), ["/pwa/assets/assets/ui/pages/tasks.html", "/pwa/main.dart.js"], "only files that changed are downloaded again");
await two.activate();
assert.deepEqual(await shellNames(), [`app-shell-${one.build}`, `app-shell-${two.build}`].sort(), "the old copy stays while a tab still runs it");

assert.equal(await two.load("tab-a", "main.dart.js"), "code(1)", "a running tab keeps the code it started with");
assert.equal(await two.load("tab-a", "assets/assets/ui/pages/tasks.html"), "<html><head></head>tasks 1</html>", "and the pages that belong to it");

const startPage = async () => (await (await caches.open(`app-shell-${two.build}`)).match("/pwa/index.html")).headers.get("X-Deploy");
assert.equal(await startPage(), "1", "an unchanged start page is taken over from the old copy");
await two.open("tab-c");
assert.equal(await startPage(), "2", "and gets the current headers of the host on the next start");
assert.equal(await two.load("tab-c", "main.dart.js"), "code(2)", "the next start runs the new build");
assert.equal(await two.load("tab-c", "assets/assets/ui/pages/tasks.html"), "<html><head></head>tasks 2</html>");

live.delete("tab-a");
await two.open("tab-d");
assert.deepEqual(await shellNames(), [`app-shell-${two.build}`], "the old copy goes once no tab runs it");
assert.ok(!(await (await caches.open("app-pins")).keys()).some((request) => request.url.endsWith("tab-a")), "pins of closed tabs are dropped");

const third = { ...second, "main.dart.js": "code(3)" };
deploy({ ...third, "main.dart.js": "code(4)" });
const broken = worker(third);
await assert.rejects(broken.install(), /another build/, "a copy that mixes two deploys is never finished");
assert.equal(await two.load("tab-c", "main.dart.js"), "code(2)");
const fresh = await (await caches.open(`app-shell-${broken.build}`)).match("/pwa/__ready");
assert.equal(fresh, undefined);

deploy(first);
const bare = worker(null);
await bare.install();
await bare.activate();
asked.length = 0;
assert.equal(await bare.load("tab-x", "main.dart.js"), "code(1)", "without a file list the worker only passes requests on");
assert.deepEqual(asked, ["/pwa/main.dart.js"]);

console.log("app worker: ok");
