// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { root, platform, esc, icon, BRAND } from "./core.js";
import { toast } from "./shell.js";

export const CONTACT = "horaapp.team@gmail.com";

let dialog = null;

export function systemName(agent = navigator.userAgent) {
  if (/iPhone|iPad/.test(agent)) return "iOS";
  if (/Android/.test(agent)) return "Android";
  if (/Mac/.test(agent)) return "macOS";
  if (/Windows/.test(agent)) return "Windows";
  if (/Linux/.test(agent)) return "Linux";
  return "Web";
}

export function platformName() {
  const shell = root.dataset.shell;
  if (shell === "web") return `${systemName()}, Web-App`;
  if (shell) return `${systemName()}, App`;
  return `${systemName()}, ${platform.desktop ? "Desktop-App" : "im Browser"}`;
}

export function versionParts(text = document.body?.dataset.appVersion || "") {
  const clean = String(text).replace(/^v/, "").trim();
  const match = clean.match(/^(.*?)\s*\(Build (\d+)\)$/);
  return match ? { version: match[1], build: match[2] } : { version: clean, build: "" };
}

export function draftFacts() {
  const { version, build } = versionParts();
  return [["Version", version || "unbekannt"], ["Build", build || "unbekannt"], ["Plattform", platformName()]];
}

export function draftHref(facts = draftFacts()) {
  const body = `\n\n\n${facts.map(([name, value]) => `${name}: ${value}`).join("\n")}\n`;
  return `mailto:${CONTACT}?subject=${encodeURIComponent(`Rückmeldung zu ${BRAND}`)}&body=${encodeURIComponent(body)}`;
}

function build() {
  dialog = document.createElement("dialog");
  dialog.className = "app-dialog feedback";
  dialog.id = "feedback";
  dialog.setAttribute("aria-labelledby", "feedbackTitle");
  document.body.append(dialog);
  dialog.addEventListener("click", async (event) => {
    if (event.target === dialog || event.target.closest("[data-close]")) dialog.close();
    else if (event.target.closest("[data-copy]")) copyAddress();
    else if (event.target.closest("#feedbackOpen")) await openDraft(event);
  });
}

function render() {
  const facts = draftFacts();
  dialog.innerHTML = `
    <div class="sheet-head">
      <h2 class="sheet-title" id="feedbackTitle">Rückmeldung geben</h2>
      <button class="icon-button" type="button" data-close aria-label="Schließen">${icon("x")}</button>
    </div>
    <p class="dialog-text">Dein Mailprogramm öffnet einen Entwurf an <strong class="feedback-address">${esc(CONTACT)}</strong>. Schreib hinein, was nicht klappt oder was dir fehlt.</p>
    <h3 class="dialog-label">Schon im Entwurf</h3>
    <dl class="feedback-facts">${facts.map(([name, value]) => `<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>
    <p class="feedback-note">Sonst geht nichts mit. Du siehst die Mail, bevor du sie abschickst.</p>
    <div class="dialog-actions">
      <button class="btn btn-quiet" type="button" data-copy>${icon("copy")}Adresse kopieren</button>
      <a class="btn btn-primary" id="feedbackOpen" href="${esc(draftHref(facts))}">${icon("send")}Entwurf öffnen</a>
    </div>
    <p class="feedback-note" id="feedbackHint" hidden>Kein Mailprogramm aufgegangen? Kopier die Adresse und schreib aus deinem Postfach.</p>`;
}

async function openDraft(event) {
  const link = event.target.closest("#feedbackOpen");
  const shell = window.hubShell;
  if (typeof shell?.openMail === "function") {
    event.preventDefault();
    let opened = false;
    try {
      opened = Boolean(await shell.openMail(link.href));
    } catch {}
    if (!opened) toast("Das Mailprogramm ließ sich nicht öffnen. Kopier die Adresse und schreib aus deinem Postfach.", { icon: "circle-alert" });
  }
  setTimeout(() => {
    const hint = dialog.querySelector("#feedbackHint");
    if (hint) hint.hidden = false;
  }, 1200);
}

async function copyAddress() {
  try {
    await navigator.clipboard.writeText(CONTACT);
    toast("Adresse kopiert", { icon: "copy" });
  } catch {
    const address = dialog.querySelector(".feedback-address");
    getSelection()?.selectAllChildren(address);
    toast("Die Adresse ist markiert. Kopier sie mit der Tastatur.", { icon: "info" });
  }
}

export function openFeedback() {
  if (!dialog) build();
  render();
  if (!dialog.open) dialog.showModal();
  dialog.querySelector("#feedbackOpen")?.focus({ preventScroll: true });
}

export function initFeedback() {
  window.addEventListener("app:feedback", openFeedback);
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest?.("[data-feedback]");
    if (!trigger) return;
    event.preventDefault();
    trigger.closest("[popover]")?.hidePopover?.();
    openFeedback();
  });
}
