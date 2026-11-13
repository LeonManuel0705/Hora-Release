// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { root, icon, hasPlan, onPlanChange } from "./core.js";
import { toast } from "./shell.js";
import * as account from "./account.js";
import { pageQuiet, shellSettled } from "./quiet.js";

export { pageBusy, pageQuiet } from "./quiet.js";

const HINT_KEY = "app-account-hint";

let scene = null;
let sceneModule = null;
let opening = null;

// The scene opens by itself at most once on a device: when it has a plan and nobody chose yet, neither an account nor
// going on without one. A device that had an account opens on signing in.
export function shouldOffer(state, planned) {
  return Boolean(state?.available && state.ready && planned && !state.signedIn && !state.guest && !state.offered && !state.sessionEnded);
}

export const offerScreen = (state) => (state?.knownDevice ? "signin" : "create");

function loadScene() {
  scene ||= import("./account-screens.js").then((module) => (sceneModule = module), (error) => {
    scene = null;
    throw error;
  });
  return scene;
}

// The scene, its stylesheets and the font are fetched once the page is loaded and idle, so a tap opens it at once.
function preloadWhenIdle() {
  const preload = () => loadScene().then((module) => module.prepare?.()).catch(() => {});
  const schedule = () => (typeof requestIdleCallback === "function" ? requestIdleCallback(preload, { timeout: 4000 }) : setTimeout(preload, 1500));
  if (document.readyState === "complete") schedule();
  else addEventListener("load", schedule, { once: true });
}

export function openAccount(screen = "create", options = {}) {
  const run = loadScene().then((module) => module.openScene({ screen, ...options }));
  const tracked = run.catch(() => {
    toast("Das ließ sich gerade nicht laden. Versuch es gleich noch einmal.", { icon: "circle-alert" });
    return { failed: true };
  });
  opening = tracked;
  tracked.finally(() => {
    if (opening === tracked) opening = null;
  });
  return tracked;
}

const sceneClosed = () => (opening ? opening.then(() => sceneClosed()) : Promise.resolve());

let leaving = false;

// A page already on its way to the next one, as after an import or the setup, leaves the offer to that page, so it is
// never marked as made without being seen.
async function offerOnce() {
  if (!shouldOffer(account.accountState(), hasPlan())) return false;
  await shellSettled();
  await pageQuiet();
  const state = account.accountState();
  if (leaving || !shouldOffer(state, hasPlan()) || opening) return false;
  await account.markOffered();
  await openAccount(offerScreen(state), { from: "offer" });
  return true;
}

// A first plan that comes while the page stays, as from a restored backup, brings the offer at the next quiet moment.
function offerOnFirstPlan() {
  const stop = onPlanChange(() => {
    if (!hasPlan()) return;
    stop();
    offerOnce().catch(() => false);
  });
}

function watchToast(node, onGone) {
  const host = node?.parentElement;
  if (!host) {
    onGone();
    return;
  }
  const watch = new MutationObserver(() => {
    if (node.isConnected) return;
    watch.disconnect();
    onGone();
  });
  watch.observe(host, { childList: true });
}

let endedShown = false;

function noticeEnded() {
  if (endedShown || !account.accountState().sessionEnded) return;
  endedShown = true;
  const shown = toast("Dieses Gerät wurde abgemeldet.", {
    icon: "user",
    action: { label: "Anmelden", run: () => openAccount("signin") },
  });
  watchToast(shown?.node, () => account.dismissSessionEnded().catch(() => {}));
}

function hintPassword() {
  if (!account.accountState().needsPassword) return;
  try {
    if (sessionStorage.getItem(HINT_KEY)) return;
    sessionStorage.setItem(HINT_KEY, "1");
  } catch {}
  toast("Passwort fehlt auf diesem Gerät.", {
    icon: "lock",
    action: { label: "Passwort eingeben", run: () => openAccount("unlock") },
  });
}

// Right after signing in on a device with its own plan: which of the two plans stays on every device.
export function askWhichPlan() {
  return sceneClosed().then(() => new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog plan-question";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-labelledby", "planQuestionTitle");
    dialog.setAttribute("aria-describedby", "planQuestionText planQuestionNote");
    dialog.innerHTML = `
      <div class="sheet-head"><h2 class="sheet-title" id="planQuestionTitle">Welcher Stundenplan soll bleiben?</h2></div>
      <p class="dialog-text" id="planQuestionText">In deinem Konto ist schon ein Stundenplan. Auf diesem Gerät ist ein anderer eingetragen.</p>
      <p class="dialog-note" id="planQuestionNote">${icon("info")}<span>Der andere wird auf allen deinen Geräten ersetzt.</span></p>
      <div class="dialog-actions">
        <button class="btn btn-quiet" type="button" data-plan="device">Den von diesem Gerät</button>
        <button class="btn btn-primary" type="button" data-plan="account">Den aus dem Konto</button>
      </div>`;
    dialog.addEventListener("cancel", (event) => event.preventDefault());
    dialog.addEventListener("click", (event) => {
      const choice = event.target.closest("[data-plan]");
      if (!choice) return;
      dialog.close();
      dialog.remove();
      resolve(choice.dataset.plan === "device" ? "device" : "account");
    });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('[data-plan="account"]').focus({ preventScroll: true });
  }));
}

function mark(state) {
  root.dataset.account = state.signedIn ? "in" : "out";
}

export async function initAccountUi() {
  account.onPlanQuestion(askWhichPlan);
  window.AppAccount = Object.freeze({
    open: (screen = "signin") => openAccount(screen).then(() => true),
    back: () => Boolean(sceneModule?.sceneBack()),
  });
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest?.("[data-account-open]");
    if (!trigger) return;
    event.preventDefault();
    openAccount(trigger.dataset.accountOpen || "signin");
  });
  addEventListener("app:account", (event) => {
    mark(event.detail);
    if (event.detail.change === "session-ended") noticeEnded();
  });
  const state = await account.startAccount();
  mark(state);
  if (state.sessionEnded) noticeEnded();
  hintPassword();
  addEventListener("beforeunload", () => (leaving = true));
  if (!hasPlan()) offerOnFirstPlan();
  // The page asks for the first name only once the offer is settled, and not after a scene the offer opened.
  offerOnce().catch(() => false).then((offered) => dispatchEvent(new CustomEvent("app:account-offer", { detail: { offered } })));
  preloadWhenIdle();
}
