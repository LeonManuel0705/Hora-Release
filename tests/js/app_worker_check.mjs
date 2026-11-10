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
const comparable = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/[ \t\n\r\f]+/g, "");
const sha = (path, body) => createHash("sha256").update(path.endsWith(".html") ? comparable(body) : body).digest("hex");
const tick = () => new Promise((done) => setTimeout(done, 5));

class Cache {
  entries = new Map();
  constructor(state) {
    this.state = state;
  }
  async match(key) {
    const hit = this.entries.get(urlOf(key));
    return hit && new Response(hit.body, { status: hit.status, headers: hit.headers });
  }
  async put(key, response) {
    if (this.state.full && urlOf(key).includes("/__pin/")) throw new DOMException("Quota exceeded", "QuotaExceededError");
    this.entries.set(urlOf(key), { body: await response.text(), status: response.status, headers: [...response.headers] });
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(key) {
    return this.entries.delete(urlOf(key));
  }
}

function world() {
  const named = new Map();
  const state = { broken: 0, online: true, deploys: 0, asked: [], modes: [], http: new Map(), held: new Map(), served: new Map(), live: new Set(), clock: 1e12, full: false };
  const fail = () => {
    if (state.broken < 1) return;
    state.broken -= 1;
    throw new DOMException("Unexpected internal error", "UnknownError");
  };
  const caches = {
    async open(name) {
      fail();
      if (!named.has(name)) named.set(name, new Cache(state));
      return named.get(name);
    },
    async has(name) {
      fail();
      return named.has(name);
    },
    async keys() {
      return [...named.keys()];
    },
    async delete(name) {
      return named.delete(name);
    },
  };
  const registration = { installing: null, waiting: null, unregistered: false, unregister: async () => (registration.unregistered = true) };

  const answer = ({ body, deploy }) => new Response(body, { status: 200, headers: { "Content-Type": "text/plain", "X-Deploy": String(deploy) } });

  async function network(input, init = {}) {
    const url = new URL(urlOf(input));
    state.modes.push(`${init.cache || "default"} ${url.pathname}`);
    const kept = state.http.get(url.pathname);
    if (init.cache === "force-cache" && kept) return answer(kept);
    state.asked.push(url.pathname);
    const gate = state.held.get(url.pathname);
    if (gate) await gate.promise;
    if (!state.online) throw new TypeError("Load failed");
    const body = state.served.get(url.pathname);
    if (body === undefined) return new Response("missing", { status: 404 });
    const page = url.pathname.endsWith("/") || url.pathname.endsWith(".html") ? body.replace("<head>", "<head>\n<!-- injected by the host -->") : body;
    state.http.set(url.pathname, { body: page, deploy: state.deploys });
    return answer({ body: page, deploy: state.deploys });
  }

  async function pageLoads(paths) {
    for (const path of paths) await (await network(`/pwa/${path}`)).text();
    state.asked.length = 0;
    state.modes.length = 0;
  }

  function deploy(files) {
    state.deploys += 1;
    state.served.clear();
    for (const [path, body] of Object.entries(files)) state.served.set(`/pwa/${path === "index.html" ? "" : path}`, body);
  }

  function hold(path) {
    let release;
    const promise = new Promise((done) => (release = done));
    state.held.set(path, { promise });
    return () => {
      state.held.delete(path);
      release();
    };
  }

  function worker(files) {
    const manifest = files === "off" ? "off" : files && {
      build: sha("", JSON.stringify(Object.entries(files))).slice(0, 16),
      files: Object.fromEntries(Object.entries(files).map(([path, body]) => [path, sha(path, body)])),
    };
    const handlers = {};
    const scope = {
      location: new URL(SCRIPT),
      addEventListener: (type, handler) => (handlers[type] = handler),
      skipWaiting: async () => {},
      clients: { matchAll: async () => [...state.live].map((id) => ({ id })) },
      registration,
      caches,
      fetch: network,
      crypto: globalThis.crypto,
      Response,
      Request,
      URL,
      TextEncoder,
      DOMException,
      Date: { now: () => (state.clock += 1) },
      console,
    };
    scope.self = scope;
    vm.runInNewContext(source.replace(/^const MANIFEST = .*;$/m, `const MANIFEST = ${JSON.stringify(manifest)};`), scope);
    const extend = async (type, fields = {}) => {
      const pending = [];
      let answer = null;
      const event = { ...fields, waitUntil: (promise) => pending.push(promise), respondWith: (promise) => (answer = promise) };
      if (!handlers[type]) return { handled: false };
      handlers[type](event);
      const response = answer ? await answer : null;
      await Promise.allSettled(pending);
      const failed = (await Promise.allSettled(pending)).find((result) => result.status === "rejected");
      if (failed && type !== "fetch") throw failed.reason;
      return { handled: !!answer, response };
    };
    const id = manifest && manifest.build;
    return {
      build: id,
      handles: () => !!handlers.fetch,
      install: async () => {
        registration.installing = id || "installing";
        try {
          await extend("install");
          registration.waiting = id || "waiting";
        } finally {
          registration.installing = null;
        }
      },
      activate: async () => {
        registration.waiting = null;
        await extend("activate");
      },
      open: async (client, path = "") => {
        state.live.add(client);
        const { handled, response } = await extend("fetch", { request: { url: `${ORIGIN}/pwa/${path}`, method: "GET", mode: "navigate" }, clientId: "", resultingClientId: client });
        return handled ? response.text() : "NOT HANDLED";
      },
      load: async (client, path) => {
        const { handled, response } = await extend("fetch", { request: new Request(`${ORIGIN}/pwa/${path}`), clientId: client, resultingClientId: "" });
        if (!handled) return "NOT HANDLED";
        return response.status === 200 ? response.text() : null;
      },
    };
  }

  const shells = () => [...named.keys()].filter((name) => name.startsWith("app-shell-")).sort();
  const finished = async (build) => named.has(`app-shell-${build}`) && !!(await named.get(`app-shell-${build}`).match("/pwa/__ready"));
  return { state, named, caches, registration, deploy, hold, pageLoads, worker, shells, finished };
}

const first = {
  "index.html": "<html><head></head><body>start</body></html>",
  "main.dart.js": "code(1)",
  "assets/assets/ui/pages/tasks.html": "<html><head></head>tasks 1</html>",
  "assets/assets/ui/static/app/js/settings.js": "settings 1",
};
const second = { ...first, "main.dart.js": "code(2)", "assets/assets/ui/pages/tasks.html": "<html><head></head>tasks 2</html>" };

async function installed(w, files) {
  const one = w.worker(files);
  await one.install();
  await one.activate();
  return one;
}

{
  const w = world();
  w.deploy(first);
  const one = await installed(w, first);
  assert.deepEqual(w.shells(), [`app-shell-${one.build}`]);
  assert.match(await one.open("tab-a"), /start/, "the start page comes from the kept copy");
  assert.equal(await one.load("tab-a", "main.dart.js"), "code(1)");
  w.state.online = false;
  assert.match(await one.open("tab-b"), /start/, "without network the app still starts");
  assert.match(await one.load("tab-b", "assets/assets/ui/pages/tasks.html"), /tasks 1/, "a page never opened before is there offline");
  w.state.live.delete("tab-b");
  w.state.online = true;

  w.deploy(second);
  w.state.asked.length = 0;
  const two = w.worker(second);
  await two.install();
  assert.deepEqual(w.state.asked.sort(), ["/pwa/assets/assets/ui/pages/tasks.html", "/pwa/main.dart.js"], "only files that changed are downloaded again");
  await two.activate();
  assert.deepEqual(w.shells(), [`app-shell-${one.build}`, `app-shell-${two.build}`].sort(), "the old copy stays while a tab still runs it");
  assert.equal(await two.load("tab-a", "main.dart.js"), "code(1)", "a running tab keeps the code it started with");
  assert.match(await two.load("tab-a", "assets/assets/ui/pages/tasks.html"), /tasks 1/, "and the pages that belong to it");
  const startPage = async () => (await (await w.caches.open(`app-shell-${two.build}`)).match("/pwa/index.html")).headers.get("X-Deploy");
  assert.equal(await startPage(), "1", "an unchanged start page is taken over from the old copy");
  await two.open("tab-c");
  assert.equal(await startPage(), "2", "and gets the current headers of the host on the next start");
  assert.equal(await two.load("tab-c", "main.dart.js"), "code(2)", "the next start runs the new build");
  w.state.live.delete("tab-a");
  await two.open("tab-back");
  assert.ok(w.shells().includes(`app-shell-${one.build}`), "a tab in the back-forward cache keeps its copy for a day");
  assert.equal(await two.load("tab-a", "main.dart.js"), "code(1)", "and its build when it comes back");
  w.state.clock += 25 * 60 * 60 * 1000;
  await two.open("tab-d");
  assert.deepEqual(w.shells(), [`app-shell-${two.build}`], "the old copy goes once no tab runs it");
  assert.ok(!(await (await w.caches.open("app-pins")).keys()).some((request) => request.url.endsWith("tab-a")), "pins of closed tabs are dropped");
}

{
  const w = world();
  w.deploy(first);
  const one = await installed(w, first);
  await one.open("tab-1");
  w.deploy(second);
  const release = w.hold("/pwa/main.dart.js");
  const two = w.worker(second);
  const install = two.install();
  while (!w.state.asked.includes("/pwa/main.dart.js")) await tick();
  assert.match(await one.open("tab-reload"), /start/, "a reload while the update downloads still starts the running build");
  assert.ok(w.shells().includes(`app-shell-${two.build}`), "and leaves the copy that is being filled alone");
  release();
  await install;
  await two.activate();
  assert.ok(await w.finished(two.build), "the new copy is complete after the download");
  w.state.online = false;
  assert.match(await two.open("tab-offline"), /start/, "so the next start works offline");
  assert.equal(await two.load("tab-offline", "main.dart.js"), "code(2)");
}

{
  const w = world();
  w.deploy(first);
  const one = await installed(w, first);
  w.deploy(second);
  const release = w.hold("/pwa/");
  const navigation = one.open("tab-slow");
  const two = w.worker(second);
  await two.install();
  await two.activate();
  release();
  assert.match(await navigation, /start/);
  assert.ok(await w.finished(two.build), "a slow check of the start page cannot delete a newer finished copy");
  w.state.online = false;
  assert.equal(await (async () => (await two.open("tab-next"), two.load("tab-next", "main.dart.js")))(), "code(2)");
}

{
  const w = world();
  w.deploy(first);
  const one = await installed(w, first);
  await w.caches.delete(`app-shell-${one.build}`);
  const restarted = w.worker(first);
  assert.match(await restarted.open("tab-x"), /start/, "a lost copy is served from the network");
  assert.ok(await w.finished(one.build), "and filled again in the background");
  w.state.online = false;
  assert.match(await w.worker(first).open("tab-y"), /start/, "so the next start works offline again");
}

{
  const w = world();
  w.deploy(first);
  await installed(w, first);
  const restarted = w.worker(first);
  w.state.broken = 1;
  assert.match(await restarted.open("tab-e"), /start/, "a failing Cache API falls back to the network");
  w.state.online = false;
  assert.match(await restarted.open("tab-f"), /start/, "and the same worker uses the cache again once it works");
  w.state.online = true;
  const another = w.worker(first);
  await another.open("tab-g");
  const fresh = w.worker(first);
  w.state.broken = 1;
  assert.equal(await fresh.load("tab-g", "main.dart.js"), "code(1)", "an open tab gets its files from the network while the cache fails");
  w.state.online = false;
  assert.equal(await fresh.load("tab-g", "main.dart.js"), "code(1)", "and from the cache again afterwards");
}

{
  const w = world();
  w.deploy(first);
  const one = await installed(w, first);
  await assert.rejects(w.worker(null).install(), /no file list/, "a build without a file list refuses to install");
  assert.deepEqual(w.shells(), [`app-shell-${one.build}`], "and leaves the offline copy alone");
  const retiring = w.worker("off");
  assert.equal(retiring.handles(), false, "the off switch answers no requests");
  await retiring.install();
  await retiring.activate();
  assert.deepEqual([...w.named.keys()], [], "it removes every offline copy");
  assert.ok(w.registration.unregistered, "and itself");
}

{
  const w = world();
  w.deploy(first);
  await installed(w, first);
  const restarted = w.worker(first);
  w.state.full = true;
  w.state.online = false;
  assert.equal(await restarted.load("tab-full", "main.dart.js"), "code(1)", "a full storage only loses the pin, the files still come from the copy");
}

{
  const w = world();
  w.deploy(first);
  const one = await installed(w, first);
  w.deploy(second);
  const release = w.hold("/pwa/main.dart.js");
  const two = w.worker(second);
  const install = two.install();
  const partial = async () => (await w.caches.open(`app-shell-${two.build}`)).match("/pwa/assets/assets/ui/pages/tasks.html");
  while (!w.state.asked.includes("/pwa/main.dart.js") || !(await partial())) await tick();
  w.state.online = false;
  release();
  await assert.rejects(install);
  await one.open("tab-short");
  assert.ok(w.shells().includes(`app-shell-${two.build}`), "a start after an interrupted update keeps what was downloaded");
  w.state.online = true;
  w.state.asked.length = 0;
  const again = w.worker(second);
  await again.install();
  assert.deepEqual(w.state.asked, ["/pwa/main.dart.js"], "and the next attempt only fetches what is still missing");
}

for (const [changed, failure] of [
  [{ "main.dart.js": "code(3)" }, /main.dart.js belongs to another build/],
  [{ "assets/assets/ui/pages/tasks.html": "<html><head></head>tasks 3</html>" }, /tasks.html belongs to another build/],
]) {
  const w = world();
  w.deploy({ ...second, ...changed });
  await assert.rejects(w.worker(second).install(), failure, "a copy that mixes two deploys is never finished, page templates included");
}

{
  const w = world();
  w.deploy({ ...second, "assets/assets/ui/pages/tasks.html": "<html>\n  <head></head>\n  tasks 2\n</html>" });
  const fine = w.worker(second);
  await fine.install();
  assert.ok(await w.finished(fine.build), "comments and line breaks the host adds do not count");
}

{
  const w = world();
  w.deploy(first);
  await w.pageLoads(["", "main.dart.js"]);
  const one = await installed(w, first);
  assert.deepEqual(
    w.state.asked.sort(),
    ["/pwa/assets/assets/ui/pages/tasks.html", "/pwa/assets/assets/ui/static/app/js/settings.js"],
    "what the page loaded just before is taken from the browser's cache, the rest comes once from the network",
  );
  assert.ok(w.state.modes.includes("force-cache /pwa/main.dart.js"), "the browser's copy is asked for first");
  assert.ok(!w.state.modes.some((line) => line.startsWith("no-cache")), "and nothing is fetched twice");
  w.state.online = false;
  assert.equal(await one.load("tab-1", "main.dart.js"), "code(1)", "the copy from the browser's cache works offline");
  assert.match(await one.open("tab-1"), /start/);
}

{
  const w = world();
  w.deploy(first);
  await w.pageLoads(["main.dart.js"]);
  w.deploy(second);
  const two = await installed(w, second);
  assert.deepEqual(
    w.state.modes.filter((line) => line.endsWith(" /pwa/main.dart.js")),
    ["force-cache /pwa/main.dart.js", "no-cache /pwa/main.dart.js"],
    "a copy of an older deploy in the browser's cache is checked against the list and fetched again",
  );
  w.state.online = false;
  assert.equal(await two.load("tab-2", "main.dart.js"), "code(2)", "so the offline copy holds the build it belongs to");
}

{
  const w = world();
  w.deploy(first);
  await w.pageLoads(["main.dart.js"]);
  w.deploy({ ...second, "main.dart.js": "code(3)" });
  await assert.rejects(installed(w, second), /main.dart.js belongs to another build/, "a wrong copy in the cache and a wrong one on the network still refuse the build");
  assert.ok(!(await w.finished(w.worker(second).build)), "and the copy is never finished");
}

console.log("app worker: ok");
