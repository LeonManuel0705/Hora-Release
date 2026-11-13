// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { data, esc, icon, luna, BRAND, hasPlan } from "./core.js";
import { placeNear, clampSheet, toast } from "./shell.js";
import { readProfile, cleanName, avatarModel, avatarHtml, paintAvatar, paintAvatars, setProfileName, setAvatar, answerName, wantsName, onProfile, profileAccount, noteAccount, accountPart, LUNA_LOOKS } from "./profile.js";
import { pageQuiet, shellSettled } from "./quiet.js";

const SAVE_MS = 500;
const CONFIRM_MS = 4000;
const PHONE = "(max-width: 759px)";

const sheet = document.getElementById("profileSheet");
let account = null;
let loading = null;
let invoker = null;
let saveTimer = 0;
let confirmTimer = 0;
let draft = null;

function loadAccount() {
  if (!data?.accountService) return null;
  loading ||= Promise.all([import("./account.js"), import("./account-card.js")]).then(([api, card]) => {
    account = { api, card };
    return account;
  }, (error) => {
    loading = null;
    throw error;
  });
  return loading;
}

const accountNow = () => (account ? account.api.accountState() : profileAccount());
const emailOf = (state) => (state?.signedIn ? state.email : null);
const shown = () => Boolean(sheet?.matches(":popover-open"));
const phone = () => matchMedia(PHONE).matches;

function accountHtml(state) {
  const part = accountPart(state);
  if (!part) return "";
  const title = `<h3 class="profile-account-title" id="profileAccountTitle">${esc(BRAND)}-Konto</h3>`;
  if (part === "out") {
    return `<section class="profile-account" aria-labelledby="profileAccountTitle">
      <div class="profile-account-head">${title}<span class="status is-off">Nicht angemeldet</span></div>
      <p class="profile-account-text">Mit einem Konto ist dein Stundenplan auf all deinen Geräten gleich.</p>
      <div class="profile-actions"><button class="btn btn-quiet" type="button" data-account-open="signin">Anmelden</button><button class="btn btn-primary" type="button" data-account-open="create">Konto erstellen</button></div>
    </section>`;
  }
  const line = account?.card.syncLine(state) || { status: "", text: "" };
  const unlock = part === "password" ? '<button class="btn btn-primary" type="button" data-account-open="unlock">Passwort eingeben</button>' : "";
  return `<section class="profile-account" aria-labelledby="profileAccountTitle">
    <div class="profile-account-head">${title}${line.status}</div>
    <p class="profile-account-text">${esc(line.text)}</p>
    <div class="profile-actions">${unlock}<button class="btn btn-quiet" type="button" data-profile-sign-out>${icon("log-out")}<span>Abmelden</span></button></div>
  </section>`;
}

function headHtml(profile, email) {
  return `<h2 class="profile-name" id="profileTitle">${esc(profile.name || "Dein Profil")}</h2>${email ? `<p class="profile-mail">${esc(email)}</p>` : ""}`;
}

function mainHtml() {
  const profile = readProfile();
  const state = accountNow();
  const email = emailOf(state);
  return `<div class="profile-view" data-view="main">
    <div class="profile-top">
      <span class="avatar" data-profile-avatar aria-hidden="true"></span>
      <div class="profile-who">
        <div class="profile-head" data-profile-head>${headHtml(profile, email)}</div>
        <button class="text-button profile-change" type="button" data-profile-pick>${icon("pencil")}<span>Profilbild ändern</span></button>
      </div>
      <button class="icon-button profile-close" type="button" data-profile-close aria-label="Schließen">${icon("x")}</button>
    </div>
    <label class="field profile-field"><span>Vorname</span><input class="input" id="profileNameInput" type="text" maxlength="40" autocomplete="given-name" autocapitalize="words" spellcheck="false" enterkeyhint="done" value="${esc(profile.name)}"></label>
    <p class="profile-hint">Name und Profilbild bleiben auf diesem Gerät.</p>
    <div data-profile-account>${accountHtml(state)}</div>
    <a class="profile-link" href="/hub/settings" data-page="settings">${icon("settings")}<span>Einstellungen</span>${icon("chevron-right")}</a>
  </div>`;
}

function pickHtml() {
  const profile = readProfile();
  const email = emailOf(accountNow());
  const plain = avatarModel({ ...profile, avatar: "initial" }, email);
  const options = [
    { id: "initial", label: plain.kind === "initial" ? "Buchstabe" : "Ohne Bild", model: plain },
    ...LUNA_LOOKS.map((look) => ({ id: look.id, label: look.label, model: avatarModel({ ...profile, avatar: look.id }, email) })),
  ];
  return `<div class="profile-view" data-view="pick">
    <div class="profile-pick-head"><button class="icon-button" type="button" data-profile-back aria-label="Zurück">${icon("chevron-left")}</button><h2 class="sheet-title" id="profilePickTitle">Profilbild</h2></div>
    <div class="avatar-grid" role="group" aria-labelledby="profilePickTitle">
      ${options.map((option) => `<button class="avatar-option" type="button" data-avatar-choice="${option.id}" aria-pressed="${profile.avatar === option.id}" aria-label="${esc(option.id === "initial" ? option.label : `Luna: ${option.label}`)}">${avatarHtml(option.model)}<span aria-hidden="true">${esc(option.label)}</span></button>`).join("")}
    </div>
  </div>`;
}

function show(which, direction = 0) {
  clearConfirm();
  sheet.innerHTML = which === "pick" ? pickHtml() : mainHtml();
  sheet.setAttribute("aria-labelledby", which === "pick" ? "profilePickTitle" : "profileTitle");
  const view = sheet.firstElementChild;
  if (which !== "pick") refreshHead();
  if (direction) {
    view.style.setProperty("--from", `${direction * 12}px`);
    view.classList.add("is-entering");
    view.addEventListener("animationend", () => view.classList.remove("is-entering"), { once: true });
  }
  if (!phone()) clampSheet(sheet);
}

function refreshHead() {
  const profile = draft === null ? readProfile() : { ...readProfile(), name: cleanName(draft) };
  const email = emailOf(accountNow());
  const head = sheet.querySelector("[data-profile-head]");
  if (head) head.innerHTML = headHtml(profile, email);
  const big = sheet.querySelector("[data-profile-avatar]");
  if (big) paintAvatar(big, avatarModel(profile, email));
}

function refreshAccount(force = false) {
  const holder = sheet?.querySelector("[data-profile-account]");
  if (!holder || (!force && holder.contains(document.activeElement))) return;
  holder.innerHTML = accountHtml(accountNow());
}

function saveName() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (draft === null) return;
  const value = draft;
  draft = null;
  setProfileName(value);
}

function clearConfirm() {
  clearTimeout(confirmTimer);
  confirmTimer = 0;
}

async function signOutHere(button) {
  if (!confirmTimer) {
    button.innerHTML = "<span>Wirklich abmelden?</span>";
    button.classList.add("danger-button");
    confirmTimer = setTimeout(() => {
      confirmTimer = 0;
      if (!button.isConnected) return;
      button.innerHTML = `${icon("log-out")}<span>Abmelden</span>`;
      button.classList.remove("danger-button");
    }, CONFIRM_MS);
    return;
  }
  clearConfirm();
  button.disabled = true;
  try {
    await (account || (await loadAccount())).api.signOut();
  } catch {
    button.disabled = false;
    toast("Abmelden hat nicht geklappt. Versuch es noch einmal.", { icon: "circle-alert" });
    return;
  }
  toast("Abgemeldet. Dein Stundenplan bleibt auf diesem Gerät.", { icon: "user" });
  refreshHead();
  refreshAccount(true);
  sheet.querySelector('[data-account-open="signin"]')?.focus({ preventScroll: true });
}

function placeSheet() {
  if (phone()) {
    sheet.style.removeProperty("top");
    sheet.style.removeProperty("right");
    sheet.style.removeProperty("left");
    return;
  }
  const visible = (node) => node?.offsetParent && node.getBoundingClientRect().width > 0;
  const source = [invoker, ...document.querySelectorAll("[data-profile-open]")].find(visible);
  placeNear(sheet, source, "right");
}

function bindSheet() {
  sheet.addEventListener("beforetoggle", (event) => {
    if (event.newState !== "open") return;
    draft = null;
    placeSheet();
    show("main");
  });
  sheet.addEventListener("toggle", (event) => {
    const open = event.newState === "open";
    document.querySelectorAll("[data-profile-open]").forEach((button) => button.setAttribute("aria-expanded", String(open)));
    if (open) {
      if (!phone()) clampSheet(sheet);
      sheet.focus({ preventScroll: true });
      return;
    }
    saveName();
    clearConfirm();
  });
  sheet.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    if (!target || !sheet.contains(target)) return;
    if (target.matches("a")) saveName();
    else if (target.hasAttribute("data-profile-close")) sheet.hidePopover();
    else if (target.hasAttribute("data-profile-pick")) {
      saveName();
      show("pick", 1);
      requestAnimationFrame(() => sheet.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true }));
    } else if (target.hasAttribute("data-profile-back")) {
      show("main", -1);
      sheet.querySelector("[data-profile-pick]")?.focus({ preventScroll: true });
    } else if (target.dataset.avatarChoice) {
      sheet.querySelectorAll("[data-avatar-choice]").forEach((option) => option.setAttribute("aria-pressed", String(option === target)));
      setAvatar(target.dataset.avatarChoice);
      setTimeout(() => {
        if (!shown() || !sheet.querySelector('[data-view="pick"]')) return;
        show("main", -1);
        sheet.querySelector("[data-profile-pick]")?.focus({ preventScroll: true });
      }, 220);
    } else if (target.hasAttribute("data-profile-sign-out")) signOutHere(target);
    else if (target.hasAttribute("data-account-open")) {
      saveName();
      sheet.hidePopover();
    }
  });
  sheet.addEventListener("input", (event) => {
    if (event.target.id !== "profileNameInput") return;
    draft = event.target.value;
    refreshHead();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveName, SAVE_MS);
  });
  sheet.addEventListener("change", (event) => {
    if (event.target.id === "profileNameInput") saveName();
  });
  sheet.addEventListener("keydown", (event) => {
    if (event.target.id !== "profileNameInput" || event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    saveName();
    event.target.value = readProfile().name;
    if (phone()) event.target.blur();
  });
}

function nameDialog() {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog name-question";
    dialog.setAttribute("aria-labelledby", "nameQuestionTitle");
    dialog.setAttribute("aria-describedby", "nameQuestionText");
    dialog.innerHTML = `
      <form class="name-question-form" novalidate autocomplete="off">
        <div class="name-question-luna">${luna("ruhe", 88)}</div>
        <h2 class="sheet-title" id="nameQuestionTitle" tabindex="-1">Wie soll ich dich nennen?</h2>
        <p class="dialog-text" id="nameQuestionText">Dein Vorname bleibt auf diesem Gerät.</p>
        <label class="field"><span>Vorname</span><input class="input" name="name" type="text" maxlength="40" autocomplete="given-name" autocapitalize="words" spellcheck="false" enterkeyhint="done"></label>
        <div class="dialog-actions">
          <button class="btn btn-quiet" type="button" data-skip>Überspringen</button>
          <button class="btn btn-primary" type="submit">Weiter</button>
        </div>
      </form>`;
    const input = dialog.querySelector("input");
    const finish = (value) => {
      if (!dialog.isConnected) return;
      answerName(value);
      dialog.close();
      dialog.remove();
      resolve(Boolean(cleanName(value)));
    };
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish("");
    });
    dialog.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      finish(input.value);
    });
    dialog.querySelector("[data-skip]").addEventListener("click", () => finish(""));
    document.body.append(dialog);
    dialog.showModal();
    if (!phone()) input.focus({ preventScroll: true });
    else dialog.querySelector("#nameQuestionTitle").focus({ preventScroll: true });
  });
}

// Once on a device that is set up and has no first name yet, at a quiet moment, never over anything else.
export async function askNameOnce() {
  if (!wantsName(hasPlan())) return false;
  await shellSettled();
  await pageQuiet();
  if (!wantsName(hasPlan())) return false;
  await nameDialog();
  return true;
}

export function initProfile() {
  paintAvatars();
  onProfile(() => {
    paintAvatars();
    if (shown()) refreshHead();
  });
  addEventListener("app:account", (event) => {
    noteAccount(event.detail);
    paintAvatars();
    if (shown()) {
      refreshHead();
      refreshAccount();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest?.("[data-profile-open]");
    if (button) invoker = button;
  }, true);
  document.addEventListener("keydown", (event) => {
    const button = (event.key === "Enter" || event.key === " ") && event.target.closest?.("[data-profile-open]");
    if (button) invoker = button;
  }, true);
  if (sheet) bindSheet();
  addEventListener("pagehide", saveName);
  loadAccount()?.then(() => {
    if (shown()) refreshAccount();
  }).catch(() => {});
  if (data?.accountService) {
    addEventListener("app:account-offer", (event) => {
      if (!event.detail?.offered) askNameOnce().catch(() => {});
    }, { once: true });
  } else askNameOnce().catch(() => {});
}
