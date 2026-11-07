// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { data, root, platform, esc, icon, storage, now, isoDate, slug, LOCAL_KEYS, MAX_BLOCKS, schoolDefaults, applySchoolEdits, abWeeks, BRAND, BRAND_NAMES } from "./core.js";
import { animates, travels } from "./motion.js";
import { toast } from "./shell.js";
import { PLAN_KEYS, PlanError, planOf, encodePlan, decodePlan, payloadOf, linkOf, planFile, planOfFile, planOfValues, describePlan, fitPlan, sameValue, changedKeys, writeValues } from "./plan-format.js";

const PENDING_KEY = "app-plan-link";
const UNDO_KEY = "app-plan-undo";
const STYLE_URL = "/static/app/css/plan-share.css";
const QR_MAX_VERSION = 25;
const UNDO_WINDOW = 120000;
const WEEKDAYS = [1, 2, 3, 4, 5];

const session = {
  get(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  take(key) {
    const value = session.get(key);
    try {
      sessionStorage.removeItem(key);
    } catch {}
    return value;
  },
};

const framed = (() => {
  try {
    return window.top !== window;
  } catch {
    return true;
  }
})();
const phoneApp = () => ["android", "ios"].includes(root.dataset.shell);
const inWebApp = () => root.dataset.shell === "web" || (framed && !window.hubShell && !root.dataset.shell);
const appleDevice = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || ""));
const touch = () => root.classList.contains("is-touch") || platform.touch;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function homeScreen() {
  const views = [window];
  try {
    if (window.top !== window) views.push(window.top);
  } catch {}
  return views.some((view) => {
    try {
      return view.matchMedia("(display-mode: standalone)").matches || view.navigator.standalone === true;
    } catch {
      return false;
    }
  });
}

const website = () => root.dataset.brandWebsite || data?.page?.about?.website || "";

function context() {
  return {
    mine: {
      subjects: data.subjects,
      teachers: data.teachers,
      rooms: data.rooms,
      blocks: data.blocks,
      timetable: data.timetable,
      edits: storage.get(LOCAL_KEYS.lessons),
      gone: { teachers: storage.get(LOCAL_KEYS.teachers)?.removed, rooms: storage.get(LOCAL_KEYS.rooms)?.removed },
      weeks: abWeeks(),
      abReference: data.abReference,
    },
    defaults: schoolDefaults,
    own: { subjects: storage.get(LOCAL_KEYS.subjects), teachers: storage.get(LOCAL_KEYS.teachers), rooms: storage.get(LOCAL_KEYS.rooms) },
  };
}

const myPlan = () => planOf(context().mine);

const perWeek = (size) => Math.max(size.lessons, size.lessonsB || 0);

function planLine(model, skip = []) {
  const size = describePlan(model, skip);
  const weeks = size.weeks ? ", mit A- und B-Woche" : "";
  return `${plural(size.subjects, "Fach", "Fächer")} und ${plural(perWeek(size), "Stunde", "Stunden")} pro Woche${weeks}`;
}

const snapshot = () => Object.fromEntries(PLAN_KEYS.map((key) => [key, storage.get(key)]));

async function writeChecked(values, keys) {
  const failed = [];
  const note = () => failed.push(1);
  addEventListener("app:save-failed", note);
  writeValues(storage, values, keys);
  await storage.settled();
  removeEventListener("app:save-failed", note);
  return !failed.length;
}

function reloadHere() {
  if (document.getElementById("settingsPage")) history.replaceState(history.state, "", `${location.pathname}${location.search}#stundenplan`);
  location.reload();
}

async function commit(fitted, message) {
  const before = snapshot();
  const keys = changedKeys(before, fitted.values);
  if (!keys.length || !fitted.changed) return "same";
  if (!(await writeChecked(fitted.values, keys))) {
    await writeChecked(before, keys);
    applySchoolEdits();
    return "failed";
  }
  applySchoolEdits();
  session.set(UNDO_KEY, JSON.stringify({ at: Date.now(), message, before, keys }));
  return "done";
}

async function undo(record) {
  const saved = await writeChecked(record.before, record.keys);
  session.set(UNDO_KEY, JSON.stringify({ at: Date.now(), message: saved ? "Rückgängig gemacht" : "Der alte Plan ließ sich nicht ganz zurückholen.", failed: !saved }));
  reloadHere();
}

function offerUndo() {
  let record = null;
  try {
    record = JSON.parse(session.take(UNDO_KEY) || "null");
  } catch {}
  if (!record || typeof record.message !== "string" || !(Date.now() - record.at < UNDO_WINDOW)) return;
  if (!record.before) {
    toast(esc(record.message), { icon: record.failed ? "triangle-alert" : "check" });
    return;
  }
  toast(esc(record.message), { icon: "table-2", action: { label: "Rückgängig", undo: true, run: () => undo(record) } });
}

function openPending() {
  const text = session.get(PENDING_KEY);
  if (text && !(flowOptions.pending && flowOptions.text === text)) importFlow({ text, pending: true });
}

function ownHashLink() {
  if (!/^#plan=/.test(location.hash)) return;
  session.set(PENDING_KEY, location.hash.slice(1));
  history.replaceState(history.state, "", `${location.pathname}${location.search}`);
}

export function initPlanShare() {
  window.AppPlanShare = Object.freeze({ exportFlow, importFlow });
  if (!data || !schoolDefaults) return;
  ownHashLink();
  const pending = !!session.get(PENDING_KEY);
  if (pending && document.body) document.body.dataset.tourAuto = "0";
  addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    if (event.data?.source === "shell" && event.data.type === "plan-link") openPending();
  });
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest?.("[data-plan-share], [data-plan-take]");
    if (!trigger || trigger.disabled) return;
    event.preventDefault();
    if (trigger.matches("[data-plan-share]")) exportFlow();
    else importFlow();
  });
  offerUndo();
  if (pending) openPending();
}

let sheet = null;
let styled = null;
let opener = null;
let settle = null;
let flow = 0;
let pressedOutside = false;
let closing = 0;
let flowOptions = {};

function loadStyles() {
  styled ||= new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = STYLE_URL;
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", resolve, { once: true });
    setTimeout(resolve, 4000);
    document.head.append(link);
  });
  return styled;
}

function sheetNode() {
  if (sheet) return sheet;
  sheet = document.createElement("dialog");
  sheet.className = "share-sheet";
  sheet.setAttribute("aria-labelledby", "shareTitle");
  sheet.innerHTML = `<div class="share-card"><div class="share-head"><h2 class="share-title" id="shareTitle" tabindex="-1"></h2><button class="icon-button share-close" type="button" data-share-close aria-label="Schließen">${icon("x")}</button></div><div class="share-body" id="shareBody"></div></div>`;
  sheet.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  sheet.addEventListener("pointerdown", (event) => (pressedOutside = event.target === sheet));
  sheet.addEventListener("click", (event) => {
    if ((event.target === sheet && pressedOutside) || event.target.closest("[data-share-close]")) close();
  });
  document.body.append(sheet);
  return sheet;
}

function begin(options = {}) {
  const resolve = settle;
  settle = null;
  if (flowOptions.pending && !options.pending) session.take(PENDING_KEY);
  resolve?.(null);
  flow += 1;
  flowOptions = options;
  return new Promise((done) => (settle = done));
}

async function show(title, html, bind) {
  const ticket = flow;
  await loadStyles();
  if (ticket !== flow) return null;
  const node = sheetNode();
  const body = node.querySelector("#shareBody");
  if (node.classList.contains("is-leaving")) {
    closing += 1;
    node.classList.remove("is-leaving");
  }
  const fresh = !node.open;
  node.querySelector("#shareTitle").textContent = title;
  body.innerHTML = html;
  bind?.(body);
  if (fresh) {
    opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    node.classList.remove("is-leaving");
    node.showModal();
  } else if (travels()) {
    body.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  }
  const target = (touch() ? null : body.querySelector("[data-focus], [data-autofocus]")) || (fresh ? node.querySelector("#shareTitle") : null);
  target?.focus({ preventScroll: true });
  return body;
}

function close(result = null) {
  const resolve = settle;
  settle = null;
  flow += 1;
  if (flowOptions.pending) session.take(PENDING_KEY);
  flowOptions = {};
  resolve?.(result);
  const node = sheet;
  if (!node?.open) return;
  const ticket = ++closing;
  const finish = () => {
    if (ticket !== closing) return;
    closing += 1;
    node.classList.remove("is-leaving");
    node.close();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  };
  if (!animates()) {
    finish();
    return;
  }
  const ended = (event) => {
    if (event.target !== node) return;
    node.removeEventListener("animationend", ended);
    finish();
  };
  node.classList.add("is-leaving");
  node.addEventListener("animationend", ended);
  setTimeout(finish, 360);
}

const button = (id, glyph, label, primary = false) => `<button class="btn ${primary ? "btn-primary" : "btn-quiet"}" type="button" id="${id}">${icon(glyph)}<span>${esc(label)}</span></button>`;

function status(body, text, { tone = "", action = null, field = "" } = {}) {
  const node = body.querySelector("#shareStatus");
  if (!node) return;
  node.className = `share-status${tone ? ` is-${tone}` : ""}`;
  node.innerHTML = text ? `${icon(tone === "warn" ? "circle-alert" : "check")}<span>${esc(text)}</span>` : "";
  if (text && field) {
    const input = document.createElement("input");
    input.className = "input share-link-field";
    input.readOnly = true;
    input.value = field;
    input.setAttribute("aria-label", "Link zum Stundenplan");
    input.addEventListener("focus", () => input.select());
    node.append(input);
    input.focus({ preventScroll: true });
  }
  if (text && action) {
    const extra = document.createElement("button");
    extra.type = "button";
    extra.className = "text-button";
    extra.innerHTML = `<span>${esc(action.label)}</span>`;
    extra.addEventListener("click", action.run);
    node.append(extra);
  }
}

async function copyText(value, host) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {}
  const area = document.createElement("textarea");
  area.value = value;
  area.readOnly = true;
  area.className = "share-copy-area";
  host.append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {}
  area.remove();
  return copied;
}

async function saveText(name, text) {
  const shell = window.hubShell;
  if (typeof shell?.saveFile === "function") {
    let saved = null;
    try {
      saved = await shell.saveFile(name, text);
    } catch {}
    if (saved?.error === "denied") return { tone: "warn", text: `${BRAND} darf nicht in „Downloads“ speichern. Erlaube es unter Systemeinstellungen › Datenschutz & Sicherheit › Dateien und Ordner.` };
    if (!saved?.name) return { tone: "warn", text: "Die Datei ließ sich nicht im Ordner „Downloads“ speichern." };
    const reveal = typeof shell.showFile === "function" ? { label: "Im Finder zeigen", run: () => shell.showFile(saved.path) } : null;
    return { text: `Gespeichert in „${saved.folder}“ als „${saved.name}“.`, action: reveal };
  }
  const file = new File([text], name, { type: "application/json" });
  if (touch() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Stundenplan" });
      return { text: "" };
    } catch (error) {
      if (error?.name === "AbortError") return { text: "" };
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  sheetNode().append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { text: `Gesichert als „${name}“.` };
}

async function qrMarkup(link) {
  let code;
  try {
    const { QrCode, QrSegment } = (await import("./qrcodegen.js")).default;
    code = QrCode.encodeSegments(QrSegment.makeSegments(link), QrCode.Ecc.LOW, 1, QR_MAX_VERSION, -1, true);
  } catch {
    return "";
  }
  const border = 4;
  const size = code.size + border * 2;
  let path = "";
  for (let y = 0; y < code.size; y += 1) {
    for (let x = 0; x < code.size; x += 1) {
      if (!code.getModule(x, y)) continue;
      let run = 1;
      while (x + run < code.size && code.getModule(x + run, y)) run += 1;
      path += `M${x + border} ${y + border}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  return `<svg class="share-qr-code" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR-Code mit dem Link zum Stundenplan" data-version="${code.version}"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#141a15"/></svg>`;
}

async function shareView() {
  const ticket = flow;
  const model = myPlan();
  if (!model.lessons.length) {
    show("Stundenplan teilen", `<p class="share-lead">Dein Stundenplan ist noch leer. Trag zuerst deine Stunden ein, dann kannst du ihn teilen.</p><div class="share-actions">${button("shareDone", "check", "Verstanden", true)}</div>`, (body) => body.querySelector("#shareDone").addEventListener("click", () => close()));
    return;
  }
  let link = "";
  try {
    const payload = await encodePlan(model);
    if (website() && sameValue(await decodePlan(payload), model)) link = linkOf(website(), payload);
  } catch {}
  if (ticket !== flow) return;
  const qr = link ? await qrMarkup(link) : "";
  if (ticket !== flow) return;
  const send = !!link && typeof navigator.share === "function" && !platform.desktop && !phoneApp();
  const code = qr
    ? `<figure class="share-qr">${qr}<figcaption>Mit der Handykamera scannen</figcaption></figure>`
    : `<p class="share-note">${icon("info")}<span>${link ? "Für einen QR-Code ist dieser Plan zu groß. Schick den Link oder die Datei." : "Einen Link kann dieses Gerät gerade nicht bauen. Die Datei geht trotzdem."}</span></p>`;
  const actions = [send ? button("shareSend", "share-2", "Teilen", true) : "", link ? button("shareCopy", "link", "Link kopieren", !send) : "", phoneApp() && link ? "" : button("shareFile", "download", "Als Datei sichern", !link)];
  show("Stundenplan teilen", `${code}<p class="share-summary">${esc(planLine(model))}. Der Link enthält nur den Stundenplan.</p><div class="share-actions">${actions.join("")}</div><p class="share-status" id="shareStatus" role="status"></p>`, (body) => {
    body.querySelector("#shareSend")?.addEventListener("click", async () => {
      try {
        await navigator.share({ title: "Stundenplan", text: `Mein Stundenplan für ${BRAND}`, url: link });
      } catch (error) {
        if (error?.name !== "AbortError") status(body, (await copyText(link, body)) ? "Teilen ging nicht, der Link ist kopiert." : "Teilen ging gerade nicht.", { tone: "warn" });
      }
    });
    body.querySelector("#shareCopy")?.addEventListener("click", async () => {
      if (await copyText(link, body)) status(body, "Link kopiert. Füg ihn im Chat deiner Klasse ein.");
      else status(body, "Kopieren ging nicht. Markier den Link hier und kopier ihn selbst.", { tone: "warn", field: link });
    });
    body.querySelector("#shareFile")?.addEventListener("click", async () => {
      const result = await saveText(`${slug(BRAND) || "app"}-stundenplan-${isoDate(now())}.json`, JSON.stringify(planFile(model, BRAND, new Date().toISOString()), null, 2));
      status(body, result.text, { tone: result.tone, action: result.action });
    });
  });
}

function reasonText(error, { file = false } = {}) {
  const reason = error instanceof PlanError ? error.reason : "damaged";
  if (reason === "newer") return `Dieser Plan kommt aus einer neueren Version von ${BRAND}. Aktualisiere die App, dann klappt es.`;
  if (reason === "empty") return "In diesem Plan stehen keine Stunden.";
  if (reason === "unsupported") return `Dieses Gerät kann Plan-Links nicht lesen. Lass dir den Plan als Datei schicken.`;
  if (reason === "blocks") return `Der Plan hat mehr Stunden am Tag, als hier ins Raster passen (höchstens ${MAX_BLOCKS}).`;
  return file ? "Die Datei ist unvollständig oder beschädigt. Lass sie dir noch einmal schicken." : "Der Link ist unvollständig oder beschädigt. Lass ihn dir noch einmal schicken.";
}

function qrHint() {
  if (inWebApp() && appleDevice()) {
    return homeScreen()
      ? "Halt die Kamera-App auf den Code. Der Link öffnet sich in Safari, getrennt von dieser App. Tipp dort auf „Link kopieren“ und füg ihn hier ein."
      : "Halt die Kamera-App auf den Code. Der Plan öffnet sich dann hier in Safari.";
  }
  if (phoneApp()) return "Halt die Kamera auf den Code. Der Link öffnet sich im Browser, kopier ihn dort und füg ihn hier ein.";
  return "Halt die Kamera auf den Code. Der Link öffnet sich dann im Browser.";
}

function linkNote() {
  if (inWebApp() && appleDevice() && homeScreen()) return "Auf dem iPhone öffnen sich Links in Safari, nicht in dieser App. Kopier den Link deshalb und füg ihn hier ein.";
  if (phoneApp()) return "Links öffnen sich im Browser, nicht in dieser App. Kopier den Link deshalb und füg ihn hier ein.";
  return "";
}

const errorLine = (text) => `<p class="share-error" id="shareError" role="alert"${text ? "" : " hidden"}>${text ? `${icon("circle-alert")}<span>${esc(text)}</span>` : ""}</p>`;

function setError(body, text) {
  const node = body.querySelector("#shareError");
  if (!node) return;
  node.hidden = !text;
  node.innerHTML = text ? `${icon("circle-alert")}<span>${esc(text)}</span>` : "";
}

function takeView(error = "", value = "") {
  const paste = touch() && typeof navigator.clipboard?.readText === "function";
  const note = linkNote();
  const qr = touch() ? `<div class="share-row">${icon("scan-qr-code")}<div class="share-row-text"><p class="share-row-label">QR-Code</p><p class="share-row-desc">${esc(qrHint())}</p></div></div>` : "";
  const html = `<label class="share-label" for="shareInput">Link</label>
    <div class="share-paste"><input class="input" id="shareInput" type="text" inputmode="url" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Link einfügen" value="${esc(value)}" data-autofocus>${paste ? button("sharePaste", "clipboard-paste", "Einsetzen") : ""}</div>
    ${errorLine(error)}
    ${note ? `<p class="share-note">${icon("info")}<span>${esc(note)}</span></p>` : ""}
    <div class="share-rows">
      <div class="share-row">${icon("file-up")}<div class="share-row-text"><p class="share-row-label">Datei</p><p class="share-row-desc">Ein geteilter Plan oder eine Sicherung von ${esc(BRAND)}</p></div><button class="btn btn-quiet" type="button" id="sharePick"><span>Datei wählen</span></button></div>
      ${qr}
    </div>
    <input type="file" id="shareFileInput" accept="application/json,.json" hidden>`;
  show("Plan übernehmen", html, (body) => {
    const input = body.querySelector("#shareInput");
    let timer = 0;
    const read = () => {
      clearTimeout(timer);
      const text = input.value.trim();
      if (!text) return setError(body, "");
      if (!payloadOf(text)) return setError(body, "Das ist kein Link zu einem Stundenplan.");
      openText(text);
    };
    input.addEventListener("paste", () => setTimeout(read));
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(read, 600);
    });
    input.addEventListener("keydown", (event) => event.key === "Enter" && read());
    body.querySelector("#sharePaste")?.addEventListener("click", async () => {
      try {
        input.value = await navigator.clipboard.readText();
        read();
      } catch {
        input.focus();
      }
    });
    const files = body.querySelector("#shareFileInput");
    body.querySelector("#sharePick").addEventListener("click", () => files.click());
    files.addEventListener("change", () => {
      const chosen = files.files?.[0];
      files.value = "";
      if (chosen) openFile(chosen);
    });
  });
}

async function openText(text) {
  const ticket = flow;
  let model;
  try {
    model = await decodePlan(payloadOf(text));
  } catch (error) {
    if (ticket === flow) takeView(payloadOf(text) ? reasonText(error) : "Das ist kein Link zu einem Stundenplan.", text);
    return;
  }
  if (ticket === flow) previewView(model, { link: linkOf(website(), payloadOf(text)) });
}

function backupValues(payload) {
  const names = BRAND_NAMES.map((name) => slug(name.toLowerCase())).filter(Boolean);
  const prefix = new RegExp(`^(app|${names.join("|")})-`);
  const values = {};
  Object.entries(payload?.values && typeof payload.values === "object" ? payload.values : {}).forEach(([key, value]) => {
    if (!prefix.test(key) || typeof value !== "string") return;
    try {
      values[key.replace(prefix, "app-")] = JSON.parse(value);
    } catch {}
  });
  return values;
}

async function openFile(file) {
  const ticket = flow;
  let payload = null;
  try {
    payload = JSON.parse(await file.text());
  } catch {}
  if (ticket !== flow) return;
  const ours = BRAND_NAMES.some((name) => name.toLowerCase() === String(payload?.app || "").toLowerCase());
  let model = null;
  try {
    model = ours ? planOfFile(payload) || planOfValues(backupValues(payload), payload.school) : null;
  } catch (error) {
    takeView(reasonText(error, { file: true }));
    return;
  }
  if (!model) {
    takeView(ours ? "In dieser Datei steht kein Stundenplan." : `Die Datei ist kein Stundenplan von ${BRAND}.`);
    return;
  }
  previewView(model, { backup: payload.kind !== "plan" });
}

function weeksHtml(model) {
  const weeks = model.weeks ? ["A", "B"] : ["A"];
  const days = `<div class="share-days" aria-hidden="true">${["Mo", "Di", "Mi", "Do", "Fr"].map((day) => `<span>${day}</span>`).join("")}</div>`;
  return weeks.map((week) => {
    const cells = [];
    model.blocks.forEach((_, row) => WEEKDAYS.forEach((day) => {
      const lesson = model.lessons.find((item) => item.week === week && item.day === day && item.block === row + 1);
      const hue = lesson ? ` --hue: var(--hue-${model.subjects[lesson.subject].hue});` : "";
      cells.push(`<i class="share-cell${lesson ? "" : " is-free"}"${lesson ? ` data-subject="${lesson.subject}"` : ""} style="--i: ${row + day - 1};${hue}"></i>`);
    }));
    return `<div class="share-week">${model.weeks ? `<p class="share-week-label">${week}-Woche</p>` : ""}${days}<div class="share-grid" style="--rows: ${model.blocks.length}">${cells.join("")}</div></div>`;
  }).join("");
}


function browserNote() {
  if (!inWebApp() || homeScreen()) return "";
  const text = appleDevice()
    ? "Nutzt du die App vom Home-Bildschirm? Sie hat einen eigenen Speicher, kopier den Link deshalb und füg ihn dort ein."
    : `Nutzt du ${BRAND} als App? Dann kopier den Link und füg ihn dort ein.`;
  return `<div class="share-note">${icon("info")}<div class="share-note-text"><p>${esc(text)}</p><button class="text-button share-note-action" type="button" id="shareCopyLink">${icon("link")}<span>Link kopieren</span></button><p class="share-status" id="shareStatus" role="status"></p></div></div>`;
}

function previewView(model, origin = {}) {
  const skip = new Set();
  const hasMine = myPlan().lessons.length > 0;
  const tooMany = model.blocks.length > MAX_BLOCKS;
  if (tooMany && !hasMine) {
    show("Plan übernehmen", `<p class="share-lead">${esc(reasonText(new PlanError("blocks")))} Aktualisiere ${esc(BRAND)}, dann klappt es.</p>`);
    return;
  }
  const merged = (left) => {
    try {
      return fitPlan(model, context(), { mode: "merge", skip: left, maxBlocks: MAX_BLOCKS });
    } catch {
      return { filled: 0, dropped: 0 };
    }
  };
  const mine = [...data.blocks].sort((a, b) => a.n - b.n);
  const sameTimes = model.blocks.length === mine.length && model.blocks.every((block, index) => block.start === mine[index].start && block.end === mine[index].end);
  let mode = !hasMine ? "replace" : tooMany || !merged([]).dropped ? "merge" : "replace";
  const chips = model.subjects.map((subject, index) => `<button type="button" class="share-chip" data-skip="${index}" aria-pressed="true" style="--hue: var(--hue-${subject.hue})"><i aria-hidden="true"></i><span>${esc(subject.name)}${subject.type === "LK" ? " LK" : ""}</span></button>`).join("");
  const pick = model.subjects.length > 1
    ? `<button class="text-button share-pick-toggle" type="button" id="sharePickToggle" aria-expanded="false" aria-controls="sharePickList"><span>Fächer auswählen</span>${icon("chevron-down")}</button><div class="share-pick" id="sharePickList" hidden><p class="share-row-desc">Tipp die Fächer an, die du nicht hast.</p><div class="share-chips">${chips}</div></div>`
    : "";
  const choice = hasMine
    ? `<fieldset class="share-choice"><legend class="share-label">So übernehmen</legend>
      <label class="share-option"><input type="radio" name="shareMode" value="merge"${mode === "merge" ? " checked" : ""}><span class="share-option-text"><b>Ergänzen</b><small id="shareMerge"></small></span></label>
      <label class="share-option"><input type="radio" name="shareMode" value="replace"${mode === "replace" ? " checked" : ""}${tooMany ? " disabled" : ""}><span class="share-option-text"><b>Ersetzen</b><small id="shareReplace"></small></span></label></fieldset>`
    : "";
  const note = origin.link ? browserNote() : origin.backup ? `<p class="share-note">${icon("info")}<span>Aus der Sicherung kommt nur der Stundenplan, alles andere bleibt, wie es ist.</span></p>` : "";
  const html = `<div class="share-preview" role="img" aria-label="${esc(planLine(model))}">${weeksHtml(model)}</div>
    <p class="share-summary" id="shareSummary">${esc(planLine(model))}</p>
    ${pick}${choice}${note}${errorLine("")}
    <div class="share-actions"><button class="btn btn-quiet" type="button" data-share-close><span>Abbrechen</span></button><button class="btn btn-primary" type="button" id="shareApply" data-focus>${icon("check")}<span>Übernehmen</span></button></div>`;
  show("Plan übernehmen?", html, (body) => {
    const apply = body.querySelector("#shareApply");
    const update = () => {
      const left = [...skip];
      body.querySelector("#shareSummary").textContent = planLine(model, left);
      body.querySelectorAll(".share-cell[data-subject]").forEach((cell) => cell.classList.toggle("is-free", skip.has(Number(cell.dataset.subject))));
      apply.disabled = describePlan(model, left).subjects === 0;
      if (!hasMine) return;
      const { filled, dropped } = merged(left);
      const outside = dropped ? ` ${plural(dropped, "Stunde passt", "Stunden passen")} nicht in dein Raster.` : "";
      body.querySelector("#shareMerge").textContent = filled
        ? `Deine Stunden bleiben, ${plural(filled, "freie Stunde", "freie Stunden")} pro Woche ${filled === 1 ? "kommt" : "kommen"} dazu.${outside}`
        : dropped ? "Keine dieser Stunden passt in dein Raster, die Stundenzeiten sind anders." : "Bei dir ist schon jede dieser Stunden belegt.";
      body.querySelector("#shareReplace").textContent = tooMany ? reasonText(new PlanError("blocks")) : `Dein Plan wird durch diesen ersetzt${sameTimes ? "" : ", auch die Stundenzeiten"}. Deine Fächer und Noten bleiben.`;
    };
    body.querySelector("#sharePickToggle")?.addEventListener("click", (event) => {
      const list = body.querySelector("#sharePickList");
      list.hidden = !list.hidden;
      event.currentTarget.setAttribute("aria-expanded", String(!list.hidden));
    });
    body.querySelectorAll(".share-chip").forEach((chip) => chip.addEventListener("click", () => {
      const index = Number(chip.dataset.skip);
      if (skip.has(index)) skip.delete(index);
      else skip.add(index);
      chip.setAttribute("aria-pressed", String(!skip.has(index)));
      update();
    }));
    body.querySelectorAll('input[name="shareMode"]').forEach((input) => input.addEventListener("change", () => (mode = input.value)));
    body.querySelector("#shareCopyLink")?.addEventListener("click", async () => {
      if (await copyText(origin.link, body)) status(body, "Link kopiert");
      else status(body, "Kopieren ging nicht. Markier den Link hier und kopier ihn selbst.", { tone: "warn", field: origin.link });
    });
    apply.addEventListener("click", async () => {
      apply.disabled = true;
      setError(body, "");
      const left = [...skip];
      let fitted;
      try {
        fitted = fitPlan(model, context(), { mode, skip: left, maxBlocks: MAX_BLOCKS });
      } catch (error) {
        setError(body, reasonText(error));
        apply.disabled = false;
        return;
      }
      const size = describePlan(model, left);
      const lessons = mode === "merge" ? fitted.filled : perWeek(size);
      const message = mode === "merge"
        ? `${plural(lessons, "Stunde", "Stunden")} pro Woche ergänzt`
        : `Plan übernommen: ${plural(size.subjects, "Fach", "Fächer")} und ${plural(lessons, "Stunde", "Stunden")} pro Woche`;
      const outcome = await commit(fitted, message);
      if (outcome === "failed") {
        setError(body, "Der Plan ließ sich gerade nicht speichern. Versuch es gleich noch einmal.");
        apply.disabled = false;
        return;
      }
      const reload = flowOptions.reload !== false;
      close(outcome === "same" ? null : { mode, subjects: size.subjects, lessons });
      if (outcome === "same") {
        const nothing = fitted.dropped && !fitted.filled ? "Nichts ergänzt, diese Stunden passen nicht in dein Raster." : "Nichts ergänzt, bei dir ist schon jede dieser Stunden belegt.";
        toast(mode === "merge" ? nothing : "Diesen Plan hast du schon.", { icon: "check" });
      }
      else if (reload) reloadHere();
      else offerUndo();
    });
    update();
  });
}

function openBackup(payload) {
  const model = planOfValues(backupValues(payload), payload?.school);
  if (model) previewView(model, { backup: true });
  else takeView("In dieser Sicherung steht kein Stundenplan.");
}

export function askBackup(line) {
  const done = begin();
  show("Ganze Sicherung übernehmen?", `<p class="share-lead">In der Datei stecken ${esc(line)}. Kommt sie von jemand anderem, übernimm nur den Stundenplan.</p><div class="share-actions">${button("backupPlan", "table-2", "Nur Stundenplan")}${button("backupAll", "upload", "Alles übernehmen", true)}</div>`, (body) => {
    body.querySelector("#backupPlan").addEventListener("click", () => close("plan"));
    body.querySelector("#backupAll").addEventListener("click", () => close("all"));
  });
  return done;
}

export function exportFlow() {
  const done = begin();
  if (data && schoolDefaults) shareView();
  else close();
  return done;
}

export function importFlow({ text = "", file = null, backup = null, reload = true, pending = false } = {}) {
  const done = begin({ reload, pending, text });
  if (!data || !schoolDefaults) close();
  else if (text) openText(text);
  else if (file) openFile(file);
  else if (backup) openBackup(backup);
  else takeView();
  return done;
}
