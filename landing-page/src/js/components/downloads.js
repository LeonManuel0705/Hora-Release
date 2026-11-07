import { t, raw, escapeHtml } from "../lib/i18n.js";
import { brand, icon, tux } from "../lib/icons.js";
import { reducedMotion } from "../lib/motion.js";
import { deviceName, megabytes, PLATFORMS } from "../lib/platform.js";
import { luna } from "../lib/luna.js";
import { CHEVRON } from "./page.js";

export function platformMark(id, size = 20) {
  const p = PLATFORMS[id];
  if (!p) return "";
  if (p.mark === "linux") return tux({ size });
  if (p.mark === "globe") return icon("globe", { size });
  return brand(p.mark, { size });
}

let toastEl = null;
let toastTimer = 0;

function closeToast() {
  if (!toastEl) return;
  const el = toastEl;
  toastEl = null;
  clearTimeout(toastTimer);
  el.classList.remove("is-open");
  setTimeout(() => el.remove(), reducedMotion() ? 0 : 320);
}

function openToast(id) {
  closeToast();
  const p = PLATFORMS[id];
  const list = raw(`steps.${id}`);
  const el = document.createElement("div");
  el.className = "dl-toast";
  el.setAttribute("role", "status");
  el.innerHTML = `<div class="dl-toast-luna">${luna("geschafft", 104)}</div>
    <div class="dl-toast-body">
      <p class="dl-toast-title">${escapeHtml(t("home_download.done_title"))}</p>
      <p class="dl-toast-file mono">${escapeHtml(p.file)}, ${megabytes(p.bytes)} MB</p>
      ${Array.isArray(list) ? `<ol>${list.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>` : ""}
    </div>
    <button type="button" class="dl-toast-close" aria-label="${escapeHtml(t("home_download.done_close"))}">${icon("x", { size: 18 })}</button>`;
  document.body.append(el);
  toastEl = el;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("is-open")));
  el.querySelector(".dl-toast-close").addEventListener("click", closeToast);
  toastTimer = setTimeout(() => {
    const slot = el.querySelector(".dl-toast-luna");
    if (slot && el.isConnected) slot.innerHTML = luna("ruhe", 104, t("home_download.luna_label"));
  }, 4200);
}

let sheetEl = null;
let sheetTimer = 0;

export const stepText = (step) => escapeHtml(step).replace("{share}", icon("share", { size: 17, cls: "ap-share-glyph" }));

const stepsHTML = (steps) => `<ol class="ap-sheet-steps">${steps.map((step, i) => `<li style="--i: ${i}">${stepText(step)}</li>`).join("")}</ol>`;

function sheetBody(id) {
  const p = PLATFORMS[id];
  if (p.kind === "pwa") {
    return `<h2 class="ap-sheet-title" id="ap-sheet-title" tabindex="-1" autofocus aria-live="polite">${escapeHtml(t("install.web_title", { device: deviceName(id) }))}</h2>
      <p class="ap-sheet-lead">${escapeHtml(t("install.web_lead"))}</p>
      ${stepsHTML(raw(`steps.${id}`) || [])}
      <div class="ap-sheet-actions"><a class="ap-btn ap-sheet-primary" href="${p.href}">${escapeHtml(t("start.cta_web"))}</a></div>`;
  }
  const alt = p.alt ? `<p class="ap-sheet-alt">${escapeHtml(t(`platforms.${id}.alt`))} <a href="${p.alt.href}" download data-sheet-get>${escapeHtml(p.alt.file)}, ${megabytes(p.alt.bytes)}&nbsp;MB</a></p>` : "";
  return `<h2 class="ap-sheet-title" id="ap-sheet-title" tabindex="-1" autofocus aria-live="polite">${escapeHtml(t("install.title", { platform: t(`platforms.${id}.name`) }))}</h2>
    <p class="ap-sheet-meta"><span class="mono">${escapeHtml(p.file)}</span>, ${megabytes(p.bytes)}&nbsp;MB</p>
    <p class="ap-sheet-req">${escapeHtml(t(`platforms.${id}.note`))}</p>
    <p class="ap-sheet-label">${escapeHtml(t("install.after"))}</p>
    ${stepsHTML(raw(`steps.${id}`) || [])}
    <div class="ap-sheet-actions">
      <a class="ap-btn ap-sheet-primary" href="${p.href}" download data-sheet-get>${escapeHtml(t("install.get"))}</a>
      <a class="ap-link" href="/download">${escapeHtml(t("start.get_all"))}${CHEVRON}</a>
    </div>
    ${alt}`;
}

function closeSheet({ instant = false } = {}) {
  if (!sheetEl) return;
  const el = sheetEl;
  sheetEl = null;
  clearTimeout(sheetTimer);
  document.body.classList.remove("sheet-open");
  const done = () => {
    if (el.open) el.close();
    el.remove();
  };
  el.classList.remove("is-open");
  el.classList.add("is-closing");
  if (instant || reducedMotion()) done();
  else setTimeout(done, 240);
}

function started(el) {
  el.querySelector(".ap-sheet-title").textContent = t("home_download.done_title");
  el.querySelector("[data-sheet-mark]").innerHTML = luna("geschafft", 64);
  const primary = el.querySelector(".ap-sheet-primary");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ap-btn ap-sheet-primary";
  button.dataset.sheetClose = "";
  button.textContent = t("install.done");
  primary.replaceWith(button);
  button.focus({ preventScroll: true });
  clearTimeout(sheetTimer);
  sheetTimer = setTimeout(() => {
    const slot = el.querySelector("[data-sheet-mark]");
    if (slot && el.isConnected) slot.innerHTML = luna("ruhe", 64, t("home_download.luna_label"));
  }, 4200);
}

export function openSheet(id) {
  closeToast();
  closeSheet({ instant: true });
  const el = document.createElement("dialog");
  el.className = "ap-sheet";
  el.setAttribute("aria-labelledby", "ap-sheet-title");
  el.innerHTML = `<div class="ap-sheet-card">
      <div class="ap-sheet-top">
        <span class="ap-sheet-mark" data-sheet-mark>${platformMark(id, 30)}</span>
        <button type="button" class="ap-sheet-close" data-sheet-close aria-label="${escapeHtml(t("home_download.done_close"))}">${icon("x", { size: 18 })}</button>
      </div>
      ${sheetBody(id)}
    </div>`;
  el.addEventListener("click", (event) => {
    if (event.target === el || event.target.closest("[data-sheet-close]")) return closeSheet();
    if (event.target.closest("[data-sheet-get]")) setTimeout(() => el.isConnected && started(el), 0);
  });
  el.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeSheet();
  });
  document.body.append(el);
  sheetEl = el;
  el.showModal();
  document.body.classList.add("sheet-open");
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("is-open")));
}

const plainClick = (event) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
const dialogs = typeof HTMLDialogElement === "function" && "showModal" in HTMLDialogElement.prototype;

export function mountDownloads(root) {
  const onClick = (event) => {
    const copy = event.target.closest("[data-copy]");
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy).then(() => {
        const label = copy.querySelector("span");
        label.textContent = t("steps.copied");
        copy.classList.add("is-done");
        setTimeout(() => {
          label.textContent = t("steps.copy");
          copy.classList.remove("is-done");
        }, 1800);
      }).catch(() => {});
      return;
    }
    const install = event.target.closest("[data-install]");
    if (install && dialogs && plainClick(event) && PLATFORMS[install.dataset.install]) {
      event.preventDefault();
      openSheet(install.dataset.install);
      return;
    }
    const link = event.target.closest("[data-download]");
    if (!link) return;
    openToast(link.dataset.download);
  };
  const onKey = (event) => {
    if (event.key === "Escape") closeToast();
  };
  root.addEventListener("click", onClick);
  document.addEventListener("keydown", onKey);
  return () => {
    root.removeEventListener("click", onClick);
    document.removeEventListener("keydown", onKey);
    closeToast();
    closeSheet({ instant: true });
  };
}
