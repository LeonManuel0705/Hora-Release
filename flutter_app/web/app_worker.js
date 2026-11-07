// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

const MANIFEST = null;

const BASE = new URL("./", self.location).pathname;
const SHELL = "app-shell-";
const PINS = "app-pins";
const FONTS = "app-fonts";
const FONT_HOST = "https://fonts.gstatic.com";
const READY = `${BASE}__ready`;
const FILES = `${BASE}__files`;
const LANES = 6;

const build = MANIFEST ? MANIFEST.build : "";
const pins = new Map();
const opened = new Map();

const shellName = (id) => `${SHELL}${id}`;
const pinUrl = (client) => `${BASE}__pin/${encodeURIComponent(client)}`;
const sourceOf = (path) => (path === "index.html" ? BASE : BASE + path);

function later(event, promise) {
  try {
    event.waitUntil(promise);
  } catch (error) {}
}

async function digest(response) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", await response.arrayBuffer()));
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
  if (!path.endsWith(".html") && (await digest(response.clone())) !== MANIFEST.files[path]) {
    throw new Error(`${path} belongs to another build`);
  }
  return response;
}

async function fill() {
  if (!build) return;
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
  await cache.put(READY, new Response(build));
}

function ready(id) {
  if (!id) return Promise.resolve(null);
  if (!opened.has(id)) {
    opened.set(id, caches.has(shellName(id)).then(async (there) => {
      if (!there) return null;
      const cache = await caches.open(shellName(id));
      return (await cache.match(READY)) ? cache : null;
    }));
  }
  return opened.get(id).then((cache) => {
    if (!cache) opened.delete(id);
    return cache;
  });
}

async function pin(client, id) {
  pins.set(client, Promise.resolve(id));
  await (await caches.open(PINS)).put(pinUrl(client), new Response(id));
}

function pinned(client) {
  if (!client) return Promise.resolve(build);
  if (!pins.has(client)) {
    pins.set(client, caches.open(PINS).then(async (store) => {
      const stored = await store.match(pinUrl(client));
      if (stored) return stored.text();
      const id = (await ready(build)) ? build : "";
      await store.put(pinUrl(client), new Response(id));
      return id;
    }));
  }
  return pins.get(client);
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
  for (const name of await caches.keys()) {
    const old = name.startsWith(SHELL) && !kept.has(name.slice(SHELL.length));
    if (!old && !name.startsWith("flutter-")) continue;
    opened.delete(name.slice(SHELL.length));
    await caches.delete(name);
  }
}

async function freshen(cache, cached) {
  try {
    const response = await plain(await fetch(BASE, { cache: "no-cache" }));
    if (response.ok && (await response.clone().text()) === (await cached.text())) {
      await cache.put(`${BASE}index.html`, response);
    }
  } catch (error) {}
}

async function open(event, url) {
  const cache = await ready(build);
  const path = url.pathname === BASE ? "index.html" : url.pathname.slice(BASE.length);
  const hit = cache && (await cache.match(BASE + path, { ignoreVary: true }));
  if (event.resultingClientId) later(event, pin(event.resultingClientId, hit ? build : ""));
  if (!hit) return fetch(event.request);
  if (path === "index.html") later(event, freshen(cache, hit.clone()).then(tidy));
  return hit;
}

async function serve(event, url) {
  const cache = await ready(await pinned(event.clientId));
  const hit = cache && (await cache.match(BASE + url.pathname.slice(BASE.length), { ignoreVary: true }));
  return hit || fetch(event.request);
}

async function font(request) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === "cors") await cache.put(request, response.clone());
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(fill().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(tidy());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === FONT_HOST) {
    event.respondWith(font(request));
  } else if (url.origin === self.location.origin && url.pathname.startsWith(BASE)) {
    event.respondWith(request.mode === "navigate" ? open(event, url) : serve(event, url));
  }
});
