// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { data, esc, icon, BRAND } from "./core.js";
import { toast } from "./shell.js";
import { travels, token } from "./motion.js";

const ENDPOINT = "/api/email/accounts";
const SETTINGS = "/hub/settings#konten";
const APP_PASSWORDS = "https://myaccount.google.com/apppasswords";
const KINDS = { iserv: ["graduation-cap", "Über dein IServ-Konto"], gmail: ["mail", "Über dein Google-Konto"], imap: ["mail", "Mit Passwort angemeldet"] };
const ERRORS = {
  login: "Google hat die Anmeldung abgelehnt. Prüf die Adresse und das App-Passwort.",
  app_password: "Hier braucht es ein App-Passwort, nicht dein normales Google-Passwort.",
  refused: "Der Mailserver hat die Verbindung abgelehnt. Versuch es später noch einmal.",
  unreachable: "Der Mailserver ist gerade nicht erreichbar. Prüf deine Internetverbindung und versuch es noch einmal.",
  address: "Diese Adresse passt nicht.",
};
const FAILED = "Das Postfach ließ sich nicht verbinden. Versuch es gleich noch einmal.";

let dialog = null;
let accounts = [];
let changed = () => {};
let choice = "";
let busy = false;
let removing = "";

const googleSignIn = () => data?.status?.googleConfigured !== false;
const $ = (id) => document.getElementById(id);

function build() {
  dialog = document.createElement("dialog");
  dialog.className = "app-dialog mailbox";
  dialog.id = "mailbox";
  dialog.setAttribute("aria-labelledby", "mailboxTitle");
  dialog.innerHTML = `
    <div class="sheet-head">
      <h2 class="sheet-title" id="mailboxTitle">Postfach hinzufügen</h2>
      <button class="icon-button" type="button" data-close aria-label="Schließen">${icon("x")}</button>
    </div>
    <section class="mailbox-known" id="mailboxKnown" aria-labelledby="mailboxKnownTitle" hidden>
      <h3 class="dialog-label" id="mailboxKnownTitle">Verbunden</h3>
      <ul class="mailbox-list" id="mailboxList"></ul>
    </section>
    <fieldset class="mailbox-choices">
      <legend class="dialog-label">Woher kommen deine Mails?</legend>
      ${[["iserv", "graduation-cap", "IServ", "Schule"], ["gmail", "mail", "Gmail", "Google"], ["outlook", "inbox", "Outlook", "Hotmail, Live"]]
        .map(([key, glyph, name, hint]) => `<label class="mailbox-choice"><input type="radio" name="mailboxKind" value="${key}">${icon(glyph)}<span>${name}<small>${hint}</small></span></label>`)
        .join("")}
    </fieldset>
    <div class="mailbox-detail" id="mailboxDetail"></div>`;
  document.body.append(dialog);
  dialog.addEventListener("click", onClick);
  dialog.addEventListener("change", (event) => {
    if (event.target.name !== "mailboxKind") return;
    choice = event.target.value;
    renderDetail();
  });
  dialog.addEventListener("submit", onSubmit);
  dialog.addEventListener("close", () => (removing = ""));
}

function knownHtml() {
  return accounts
    .map((account) => {
      const [glyph, how] = KINDS[account.kind] || KINDS.imap;
      const asking = removing === account.email;
      const action = account.kind === "imap"
        ? `<button class="btn btn-quiet mailbox-remove${asking ? " danger-button" : ""}" type="button" data-remove="${esc(account.email)}">${asking ? "Wirklich entfernen?" : "Entfernen"}</button>`
        : `<a class="text-button mailbox-where" href="${SETTINGS}"><span>Einstellungen</span></a>`;
      return `<li class="mailbox-row"><span class="mailbox-glyph">${icon(glyph)}</span><span class="mailbox-name">${esc(account.name || account.email)}<small>${how}</small></span>${action}</li>`;
    })
    .join("");
}

function linkButton(href, label) {
  return `<a class="btn btn-primary" href="${href}">${label}${icon("chevron-right")}</a>`;
}

function gmailForm() {
  return `<p class="dialog-text">Gmail verbindest du hier mit einem App-Passwort. Das legst du in deinem Google-Konto an, dafür muss die Bestätigung in zwei Schritten eingeschaltet sein.</p>
    <a class="text-button mailbox-help" href="${APP_PASSWORDS}" target="_blank" rel="noopener noreferrer">${icon("arrow-up-right")}<span>App-Passwort anlegen</span></a>
    <form class="mailbox-form" id="mailboxForm" novalidate autocomplete="off">
      <div class="field">
        <label class="field-label" for="mailboxAddress">Gmail-Adresse</label>
        <input class="field-control" id="mailboxAddress" type="email" inputmode="email" autocomplete="email" spellcheck="false" autocapitalize="off" maxlength="254" placeholder="name@gmail.com">
      </div>
      <div class="field">
        <label class="field-label" for="mailboxSecret">App-Passwort</label>
        <input class="field-control" id="mailboxSecret" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" maxlength="64" placeholder="16 Buchstaben">
      </div>
      <p class="field-error" id="mailboxError" role="alert" hidden></p>
      <div class="dialog-actions"><button class="btn btn-primary" type="submit" id="mailboxConnect">Verbinden</button></div>
    </form>`;
}

function detailHtml() {
  const iserv = accounts.some((account) => account.kind === "iserv");
  if (choice === "iserv") {
    return iserv
      ? `<p class="dialog-text">IServ ist verbunden. Deine Schulmails kommen schon hier an.</p>`
      : `<p class="dialog-text">Deine Schulmails kommen über dein IServ-Konto. Verbinde es einmal in den Einstellungen, danach landen sie hier.</p><div class="dialog-actions">${linkButton(SETTINGS, "IServ verbinden")}</div>`;
  }
  if (choice === "gmail") {
    return googleSignIn()
      ? `<p class="dialog-text">Gmail verbindest du über dein Google-Konto. Das geht in den Einstellungen unter Konten.</p><div class="dialog-actions">${linkButton(SETTINGS, "Zu den Einstellungen")}</div>`
      : gmailForm();
  }
  if (choice === "outlook") {
    return `<p class="dialog-text">Outlook und Hotmail lassen seit September 2024 keine Anmeldung mit Passwort mehr zu, auch nicht mit App-Passwort. Deshalb kann ${esc(BRAND)} diese Postfächer im Moment nicht abrufen.</p>`;
  }
  return "";
}

function renderKnown() {
  $("mailboxKnown").hidden = !accounts.length;
  $("mailboxList").innerHTML = knownHtml();
}

function renderDetail() {
  const box = $("mailboxDetail");
  box.innerHTML = detailHtml();
  box.hidden = !choice;
  if (choice && travels()) box.animate([{ opacity: 0, translate: "0 var(--lift-sm)" }, { opacity: 1, translate: "0 0" }], { duration: 220, easing: token("--ease-out") });
}

function setError(text) {
  const box = $("mailboxError");
  if (!box) return;
  box.hidden = !text;
  box.innerHTML = text ? `${icon("circle-alert")}<span>${esc(text)}</span>` : "";
}

function setBusy(on) {
  busy = on;
  dialog.querySelectorAll("#mailboxForm input, #mailboxForm button").forEach((node) => (node.disabled = on));
  const button = $("mailboxConnect");
  if (button) button.textContent = on ? "Wird geprüft …" : "Verbinden";
}

async function onSubmit(event) {
  if (event.target.id !== "mailboxForm") return;
  event.preventDefault();
  if (busy) return;
  const address = $("mailboxAddress");
  const secret = $("mailboxSecret");
  const email = address.value.trim();
  const password = secret.value.replace(/\s+/g, "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setError("Trag deine Gmail-Adresse ein.");
    address.focus();
    return;
  }
  if (!password) {
    setError("Trag das App-Passwort ein.");
    secret.focus();
    return;
  }
  setError("");
  setBusy(true);
  let payload = null;
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, provider: "gmail" }),
    });
    payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) throw Object.assign(new Error(""), { code: payload.code });
  } catch (error) {
    setBusy(false);
    setError(ERRORS[error.code] || FAILED);
    (error.code === "login" || error.code === "app_password" ? secret : address).focus();
    return;
  }
  setBusy(false);
  dialog.close();
  toast(`${esc(email)} ist verbunden`, { icon: "check" });
  changed();
}

async function remove(button) {
  const email = button.dataset.remove;
  if (removing !== email) {
    removing = email;
    renderKnown();
    dialog.querySelector(`[data-remove="${CSS.escape(email)}"]`)?.focus();
    return;
  }
  removing = "";
  button.disabled = true;
  try {
    const response = await fetch(`${ENDPOINT}/${encodeURIComponent(email)}`, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) throw new Error("");
  } catch {
    button.disabled = false;
    renderKnown();
    toast("Das Postfach ließ sich gerade nicht entfernen.", { icon: "circle-alert" });
    return;
  }
  accounts = accounts.filter((account) => account.email !== email);
  renderKnown();
  dialog.querySelector("[name='mailboxKind']")?.focus();
  toast(`${esc(email)} entfernt`, { icon: "trash-2" });
  changed();
}

function onClick(event) {
  if (event.target === dialog || event.target.closest("[data-close]")) {
    dialog.close();
    return;
  }
  const button = event.target.closest("[data-remove]");
  if (button && !button.disabled) remove(button);
}

export function openMailboxes(options = {}) {
  if (!dialog) build();
  accounts = [...(options.accounts || [])];
  changed = options.changed || (() => {});
  choice = "";
  removing = "";
  dialog.querySelectorAll("[name='mailboxKind']").forEach((input) => (input.checked = false));
  renderKnown();
  renderDetail();
  if (!dialog.open) dialog.showModal();
  dialog.querySelector("[name='mailboxKind']")?.focus();
  return dialog;
}
