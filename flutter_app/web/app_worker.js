// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

const MANIFEST = null;

const BASE = new URL("./", self.location).pathname;
const SHELL = "app-shell-";
const PINS = "app-pins";
const READY = `${BASE}__ready`;
const FILES = `${BASE}__files`;
const LANES = 6;

const off = MANIFEST === "off";
const build = MANIFEST && !off ? MANIFEST.build : "";
const pins = new Map();
const opened = new Map();
let filling = null;

const shellName = (id) => `${SHELL}${id}`;
const pinUrl = (client) => `${BASE}__pin/${encodeURIComponent(client)}`;
const sourceOf = (path) => (path === "index.html" ? BASE : BASE + path);
const comparable = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/[ \t\n\r\f]+/g, "");

function later(event, promise) {
  try {
    event.waitUntil(promise);
  } catch (error) {}
}

function remember(memo, key, promise, keep) {
  memo.set(key, promise);
  promise.then(
    (value) => {
      if (!keep(value) && memo.get(key) === promise) memo.delete(key);
    },
    () => {
      if (memo.get(key) === promise) memo.delete(key);
    },
  );
  return promise;
}

async function digest(path, response) {
  const bytes = path.endsWith(".html") ? new TextEncoder().encode(comparable(await response.text())) : await response.arrayBuffer();
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function plain(response) {
  if (!response.redirected) return response;
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers });
}

async function earlier() {
  const found = new Map();
  for (const name of await caches.keys()) {
    if (!name.startsWith(SHELL) || name === shellName(build)) continue;
    const cache = await caches.open(name);
    const list = await cache.match(FILES);
    if (!list) continue;
    for (const [path, hash] of Object.entries(await list.json())) found.set(`${hash} ${path}`, cache);
  }
  return found;
}

async function fetched(path) {
  const response = await plain(await fetch(sourceOf(path), { cache: "no-cache" }));
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  if ((await digest(path, response.clone())) !== MANIFEST.files[path]) throw new Error(`${path} belongs to another build`);
  return response;
}

async function fill() {
  const cache = await caches.open(shellName(build));
  if (await cache.match(READY)) return;
  const known = await earlier();
  const paths = Object.keys(MANIFEST.files);
  let next = 0;
  const lane = async () => {
    while (next < paths.length) {
      const path = paths[next++];
      if (await cache.match(BASE + path)) continue;
      const before = known.get(`${MANIFEST.files[path]} ${path}`);
      const kept = before && (await before.match(BASE + path));
      await cache.put(BASE + path, kept || (await fetched(path)));
    }
  };
  await Promise.all(Array.from({ length: LANES }, lane));
  await cache.put(FILES, new Response(JSON.stringify(MANIFEST.files)));
  await cache.put(READY, new Response(String(Date.now())));
  opened.delete(build);
}

function refill() {
  if (!filling) filling = fill().finally(() => (filling = null));
  return filling;
}

function ready(id) {
  if (!id) return Promise.resolve(null);
  if (opened.has(id)) return opened.get(id);
  const probe = caches.has(shellName(id)).then(async (there) => {
    if (!there) return null;
    const cache = await caches.open(shellName(id));
    return (await cache.match(READY)) ? cache : null;
  });
  return remember(opened, id, probe, (cache) => !!cache);
}

async function finished(id) {
  const cache = await ready(id);
  const stamp = cache && (await cache.match(READY));
  return stamp ? Number(await stamp.text()) || 0 : null;
}

async function pin(client, id) {
  pins.set(client, Promise.resolve(id));
  await (await caches.open(PINS)).put(pinUrl(client), new Response(id));
}

function pinned(client) {
  if (!client) return Promise.resolve(build);
  if (pins.has(client)) return pins.get(client);
  const lookup = caches.open(PINS).then(async (store) => {
    const stored = await store.match(pinUrl(client));
    if (stored) return stored.text();
    const id = (await ready(build)) ? build : "";
    await store.put(pinUrl(client), new Response(id));
    return id;
  });
  return remember(pins, client, lookup, () => true);
}

async function tidy() {
  const live = new Set((await self.clients.matchAll({ includeUncontrolled: true, type: "all" })).map((client) => client.id));
  const store = await caches.open(PINS);
  const kept = new Set([build]);
  for (const request of await store.keys()) {
    const client = decodeURIComponent(request.url.slice(request.url.lastIndexOf("/") + 1));
    if (live.has(client)) {
      const stored = await store.match(request);
      if (stored) kept.add(await stored.text());
    } else {
      pins.delete(client);
      await store.delete(request);
    }
  }
  const own = await finished(build);
  for (const name of await caches.keys()) {
    const id = name.startsWith(SHELL) ? name.slice(SHELL.length) : null;
    if (id === null ? !name.startsWith("flutter-") : kept.has(id)) continue;
    if (id !== null) {
      const at = await finished(id);
      const busy = !!(self.registration.installing || self.registration.waiting);
      if (at === null ? busy : own === null || at >= own) continue;
      opened.delete(id);
    }
    await caches.delete(name);
  }
}

async function retire() {
  for (const name of await caches.keys()) {
    if (name.startsWith(SHELL) || name.startsWith("flutter-") || name === PINS) await caches.delete(name);
  }
  await self.registration.unregister();
}

async function freshen(cache, cached) {
  const response = await plain(await fetch(BASE, { cache: "no-cache" }));
  if (response.ok && (await response.clone().text()) === (await cached.text())) {
    await cache.put(`${BASE}index.html`, response);
  }
}

async function open(event, url) {
  const cache = await ready(build);
  const path = url.pathname === BASE ? "index.html" : url.pathname.slice(BASE.length);
  const hit = cache && (await cache.match(BASE + path, { ignoreVary: true }));
  if (event.resultingClientId) later(event, pin(event.resultingClientId, hit ? build : "").catch(() => {}));
  if (!cache) later(event, refill().catch(() => {}));
  if (!hit) return fetch(event.request);
  if (path === "index.html") later(event, freshen(cache, hit.clone()).catch(() => {}).then(tidy).catch(() => {}));
  return hit;
}

async function serve(event, url) {
  const cache = await ready(await pinned(event.clientId));
  const hit = cache && (await cache.match(BASE + url.pathname.slice(BASE.length), { ignoreVary: true }));
  return hit || fetch(event.request);
}

self.addEventListener("install", (event) => {
  if (off) {
    event.waitUntil(self.skipWaiting());
  } else if (build) {
    event.waitUntil(refill().then(() => self.skipWaiting()));
  } else {
    event.waitUntil(Promise.reject(new Error("This build has no file list. Build it with scripts/build_web_app.py.")));
  }
});

self.addEventListener("activate", (event) => {
  if (off) {
    event.waitUntil(retire());
    return;
  }
  event.waitUntil(tidy().catch(() => {}));
  refill().catch(() => {});
});

if (!off) {
  self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
    const answer = request.mode === "navigate" ? open(event, url) : serve(event, url);
    event.respondWith(answer.catch(() => fetch(request)));
  });
}
