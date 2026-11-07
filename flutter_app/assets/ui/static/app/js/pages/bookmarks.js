// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { data, esc, icon, luna, HUES } from "../core.js";
import { travels, flipKeyed, enterInPlace, exitInPlace } from "../motion.js";
import { toast, registerSearch, placeNear, clampSheet } from "../shell.js";

const $ = (id) => document.getElementById(id);
const page = data?.page || {};
const ENDPOINT = "/api/hub/bookmarks";
const CATEGORIES = [["Other", "Sonstiges"], ["Work", "Arbeit"], ["Personal", "Persönlich"], ["Dev", "Dev"]];
const CATEGORY = Object.fromEntries(CATEGORIES);
const ICON_LOOK = 2;

const view = (row) => ({
  id: String(row.id),
  title: String(row.title || "").trim(),
  url: String(row.url || "").trim(),
  category: CATEGORY[row.category] ? row.category : "Other",
});

const state = { links: (page.bookmarks || []).map(view), filter: "all", editing: null, invoker: null, busy: false };
const iconState = new Map();

function webAddress(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

const hostOf = (url) => (webAddress(url)?.hostname || url).replace(/^www\./, "");

function hueOf(text) {
  let hash = 0;
  for (const letter of text) hash = (hash * 31 + letter.codePointAt(0)) >>> 0;
  return HUES[hash % HUES.length];
}

function iconVersion(url) {
  let hash = 0;
  for (const letter of url) hash = (hash * 31 + letter.codePointAt(0)) >>> 0;
  return hash.toString(36);
}

// The window may ask the site itself where the app could not, but only where the page's own rules allow outside images.
function siteIcon(url) {
  const address = webAddress(url);
  return page.siteFallback && address?.protocol === "https:" ? `${address.origin}/favicon.ico` : "";
}

function logoHtml(link) {
  const host = hostOf(link.url);
  const letter = ([...(link.title || host || "?").trim()][0] || "?").toUpperCase();
  const key = `${link.id}:${iconVersion(link.url)}`;
  const known = iconState.get(key);
  const site = siteIcon(link.url);
  const source = known === "site" ? `src="${esc(site)}" data-tried="1"` : `src="${ENDPOINT}/${encodeURIComponent(link.id)}/icon?v=${iconVersion(link.url)}&look=${ICON_LOOK}"`;
  const image = known === "none" ? "" : `<img ${source} data-key="${esc(key)}" data-site="${esc(site)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  const shown = known === "ok" || known === "site" ? " has-icon is-known" : "";
  return `<span class="link-logo${shown}" style="--hue: var(--hue-${hueOf(host)})" aria-hidden="true"><span class="link-letter">${esc(letter)}</span>${image}</span>`;
}

function tileHtml(link, index = 0) {
  const address = webAddress(link.url);
  const body = `${logoHtml(link)}<span class="link-text"><span class="link-title">${esc(link.title || hostOf(link.url))}</span><span class="link-host">${esc(hostOf(link.url))}</span></span>`;
  const open = address
    ? `<a class="link-open" href="${esc(address.href)}" target="_blank" rel="noopener noreferrer">${body}<span class="visually-hidden">, öffnet im Browser</span></a>`
    : `<span class="link-open is-dead">${body}</span>`;
  return `<li class="link-tile" data-id="${esc(link.id)}" style="--i: ${Math.min(index, 12)}">${open}<button class="icon-button link-edit" type="button" data-edit aria-label="${esc(link.title || hostOf(link.url))} bearbeiten">${icon("pencil")}</button></li>`;
}

function emptyHtml() {
  return `<li class="empty-state link-empty" data-flip="link-empty">${luna("ruhe")}<p class="empty-title">Noch keine Lesezeichen.</p><p class="empty-text">Leg hier Links ab, die du oft brauchst.</p><button type="button" class="empty-action" data-add>Lesezeichen hinzufügen${icon("chevron-right")}</button></li>`;
}

const shown = () => state.links.filter((link) => state.filter === "all" || link.category === state.filter);

function renderFilters() {
  const used = CATEGORIES.filter(([key]) => state.links.some((link) => link.category === key));
  const box = $("linkFilters");
  if (used.length < 2) {
    state.filter = "all";
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  if (state.filter !== "all" && !used.some(([key]) => key === state.filter)) state.filter = "all";
  box.hidden = false;
  box.innerHTML = [["all", "Alle"], ...used]
    .map(([key, label]) => `<button type="button" class="pill" data-filter="${key}" aria-pressed="${state.filter === key}">${esc(label)}</button>`)
    .join("");
}

function render({ flip = false } = {}) {
  const paint = () => {
    const list = shown();
    $("linkGrid").innerHTML = list.length ? list.map((link, index) => tileHtml(link, index)).join("") : emptyHtml();
  };
  if (flip) flipKeyed("#linkGrid .link-tile, #linkGrid .link-empty", paint);
  else paint();
  renderFilters();
  const count = state.links.length;
  $("linkCount").textContent = count ? `${count} Lesezeichen` : "";
}

function onIcon(event) {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.closest(".link-logo")) return;
  const key = image.dataset.key;
  const logo = image.parentElement;
  if (event.type === "load" && image.naturalWidth >= 8) {
    iconState.set(key, image.dataset.tried ? "site" : "ok");
    logo.classList.add("has-icon");
    return;
  }
  if (image.dataset.site && !image.dataset.tried) {
    image.dataset.tried = "1";
    image.src = image.dataset.site;
    return;
  }
  iconState.set(key, "none");
  image.remove();
}

async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {}
  if (!response.ok || payload.success === false) throw new Error(payload.error || "");
  return payload;
}

function readAddress(value) {
  const typed = value.trim();
  if (!typed) return { error: "Trag eine Adresse ein." };
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`;
  const address = webAddress(candidate);
  if (!address || !address.hostname || /\s/.test(typed)) return { error: "Das sieht nicht nach einer Webadresse aus. Sie beginnt etwa mit https://" };
  return { url: address.href };
}

function setFieldError(input, box, text) {
  box.hidden = !text;
  box.innerHTML = text ? `${icon("circle-alert")}<span>${esc(text)}</span>` : "";
  if (!input) return;
  if (text) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

function openSheet(link, invoker) {
  state.editing = link ? link.id : null;
  state.invoker = invoker || null;
  const sheet = $("linkSheet");
  $("linkSheetTitle").textContent = link ? "Lesezeichen bearbeiten" : "Neues Lesezeichen";
  $("linkUrl").value = link?.url || "";
  $("linkTitle").value = link?.title || "";
  $("linkCategory").value = link?.category || (state.filter !== "all" ? state.filter : "Other");
  $("linkDelete").hidden = !link;
  setFieldError($("linkUrl"), $("linkUrlError"), "");
  setFieldError(null, $("linkError"), "");
  if (!sheet.matches(":popover-open")) sheet.showPopover();
  placeNear(sheet, invoker && invoker.isConnected ? invoker : $("linkAdd"), "right");
  clampSheet(sheet);
  $(link ? "linkTitle" : "linkUrl").focus({ preventScroll: true });
}

function closeSheet() {
  const sheet = $("linkSheet");
  if (sheet.matches(":popover-open")) sheet.hidePopover();
}

function say(text) {
  const live = $("linkLive");
  live.textContent = "";
  requestAnimationFrame(() => (live.textContent = text));
}

async function save(event) {
  event.preventDefault();
  if (state.busy) return;
  const input = $("linkUrl");
  const { url, error } = readAddress(input.value);
  setFieldError(input, $("linkUrlError"), error || "");
  if (error) {
    input.focus();
    return;
  }
  const title = $("linkTitle").value.trim() || hostOf(url);
  const body = { title, url, category: $("linkCategory").value };
  const editing = state.editing;
  state.busy = true;
  $("linkSave").disabled = true;
  try {
    const result = await request(editing ? "PUT" : "POST", editing ? `${ENDPOINT}/${encodeURIComponent(editing)}` : ENDPOINT, body);
    const saved = view(result.bookmark || { ...body, id: editing });
    if (editing) {
      state.links = state.links.map((link) => (link.id === editing ? saved : link));
    } else {
      state.links = [saved, ...state.links];
      if (state.filter !== "all" && state.filter !== saved.category) state.filter = "all";
    }
    closeSheet();
    render({ flip: true });
    const tile = document.querySelector(`#linkGrid .link-tile[data-id="${CSS.escape(saved.id)}"]`);
    if (!editing) enterInPlace(tile);
    tile?.querySelector(".link-edit")?.focus({ preventScroll: true });
    say(editing ? "Gespeichert" : `${saved.title} hinzugefügt`);
  } catch {
    setFieldError(null, $("linkError"), "Das ließ sich gerade nicht speichern. Versuch es gleich noch einmal.");
  } finally {
    state.busy = false;
    $("linkSave").disabled = false;
  }
}

async function remove() {
  const link = state.links.find((item) => item.id === state.editing);
  if (!link || state.busy) return;
  state.busy = true;
  try {
    await request("DELETE", `${ENDPOINT}/${encodeURIComponent(link.id)}`);
  } catch {
    state.busy = false;
    setFieldError(null, $("linkError"), "Das ließ sich gerade nicht löschen. Versuch es gleich noch einmal.");
    return;
  }
  state.busy = false;
  closeSheet();
  const tile = document.querySelector(`#linkGrid .link-tile[data-id="${CSS.escape(link.id)}"]`);
  await exitInPlace(tile);
  state.links = state.links.filter((item) => item.id !== link.id);
  render({ flip: true });
  $("linkAdd").focus({ preventScroll: true });
  toast(`„${esc(link.title)}“ gelöscht`, {
    icon: "trash-2",
    action: { label: "Rückgängig", undo: true, run: () => restore(link) },
  });
}

async function restore(link) {
  try {
    const result = await request("POST", ENDPOINT, { title: link.title, url: link.url, category: link.category });
    state.links = [view(result.bookmark), ...state.links];
    render({ flip: true });
    say(`${link.title} ist wieder da`);
  } catch {
    toast("Das Lesezeichen ließ sich nicht zurückholen.", { icon: "circle-alert" });
  }
}

function openLink(link) {
  const address = webAddress(link.url);
  if (!address) return;
  const anchor = Object.assign(document.createElement("a"), { href: address.href, target: "_blank", rel: "noopener noreferrer" });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function paletteItems() {
  const query = $("paletteInput")?.value.trim() || "";
  if (query.length < 2) return [];
  return state.links.map((link) => ({
    group: "Lesezeichen",
    label: link.title || hostOf(link.url),
    keywords: `${link.url} ${CATEGORY[link.category]}`,
    icon: "bookmark",
    hint: hostOf(link.url),
    run: () => openLink(link),
  }));
}

export function init() {
  if (!$("bookmarksPage")) return;
  const grid = $("linkGrid");
  if (travels()) {
    grid.classList.add("is-entering");
    setTimeout(() => grid.classList.remove("is-entering"), 1500);
  }
  render();
  grid.addEventListener("load", onIcon, true);
  grid.addEventListener("error", onIcon, true);
  grid.addEventListener("click", (event) => {
    if (event.target.closest("[data-add]")) {
      openSheet(null, event.target.closest("[data-add]"));
      return;
    }
    const edit = event.target.closest("[data-edit]");
    if (edit) openSheet(state.links.find((link) => link.id === edit.closest(".link-tile").dataset.id), edit);
  });
  $("linkFilters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button || button.dataset.filter === state.filter) return;
    state.filter = button.dataset.filter;
    render({ flip: true });
    $("linkFilters").querySelector(`[data-filter="${state.filter}"]`)?.focus({ preventScroll: true });
  });
  $("linkAdd").addEventListener("click", (event) => openSheet(null, event.currentTarget));
  $("linkForm").addEventListener("submit", save);
  $("linkDelete").addEventListener("click", remove);
  $("linkSheet").addEventListener("toggle", (event) => {
    if (event.newState !== "closed") return;
    const back = state.invoker?.isConnected ? state.invoker : $("linkAdd");
    state.editing = null;
    if (!document.activeElement || document.activeElement === document.body || $("linkSheet").contains(document.activeElement)) back.focus({ preventScroll: true });
  });
  registerSearch(paletteItems);
}
