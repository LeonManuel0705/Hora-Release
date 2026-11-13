// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { root, BRAND } from "./core.js";
import { toast } from "./shell.js";
import * as account from "./account.js";
import { profileName, answerName, wantsName } from "./profile.js";
import { view, esc, reducedMotion, finePointer } from "./account-screens/dom.js";
import { Mascot } from "./account-screens/mascot/mascot.js";
import { createScene } from "./account-screens/scene.js";
import luna from "./account-screens/luna-scene.js";
import { createActor } from "./account-screens/actor.js";
import { createPanel, STACKED, isVertical } from "./account-screens/panel.js";
import { createMotion } from "./account-screens/motion.js";
import { createSheet } from "./account-screens/sheet.js";
import { createKeyboard } from "./account-screens/keyboard.js";
import { pending } from "./account-screens/flow.js";
import { icon } from "./account-screens/icons.js";
import { SCREENS } from "./account-screens/screens/index.js";

const STYLES = ["tokens", "base", "layout", "components", "screens", "mascot", "scene", "luna", "phone", "stage"];
const styleUrl = (name) => new URL(`../css/account-screens/${name}.css`, import.meta.url).href;
const MARK = '<svg class="brand-mark" viewBox="14 18 72 66" aria-hidden="true" focusable="false"><circle class="mark-a" cx="40" cy="44" r="26"/><rect class="mark-b" x="44" y="42" width="42" height="42" rx="12"/><path class="mark-c" d="M44 69.69V54A12 12 0 0 1 56 42H65.92A26 26 0 0 1 44 69.69Z"/></svg>';
const RANK = { signin: 1, unlock: 1, create: 2, forgot: 2, code: 3, reset: 3, guest: 3, success: 4, name: 4 };
const STRIPPED = ["id", "name", "autocomplete", "aria-live", "role", "for"];
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

let hostStyle = null;
let sheets = null;
let prepared = null;
let active = null;

function loaded(link) {
  return new Promise((resolve) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", resolve, { once: true });
    setTimeout(resolve, 4000);
  });
}

function loadHostStyle() {
  if (!hostStyle) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = styleUrl("host");
    hostStyle = loaded(link);
    document.head.append(link);
  }
  return hostStyle;
}

// The stylesheets of the scene, read once and shared by every opening, so a new shadow root has them at once.
function loadSheets() {
  sheets ||= Promise.all(STYLES.map(async (name) => {
    const response = await fetch(styleUrl(name));
    if (!response.ok) throw new Error(name);
    const sheet = new CSSStyleSheet();
    await sheet.replace(await response.text());
    return sheet;
  })).catch((error) => {
    sheets = null;
    throw error;
  });
  return sheets;
}

// Everything the first frame of the entrance needs, fetched while the page is idle: the modules came with this one,
// the stylesheets and the font follow here.
export function prepare() {
  prepared ||= Promise.all([loadHostStyle(), loadSheets().catch(() => null), document.fonts?.ready.catch(() => {})]).then(([, ready]) => ready);
  return prepared;
}

const shellMarkup = () => `<div class="acct" data-step="auth" data-look="beige" data-tone="light" data-warming>
  <div class="backdrop" aria-hidden="true"><div class="backdrop-beige"></div><div class="backdrop-glow"></div></div>
  <div class="app" id="app" data-screen="boot">
    <header class="topbar">
      <span class="brand" aria-hidden="true">${MARK}<span class="brand-name">${esc(BRAND)}</span></span>
      <button class="close" type="button" data-close aria-label="Schließen">${icon("x", { size: 20 })}</button>
    </header>
    <div class="card" id="card">
      <div class="forms" id="forms"><div class="layers" id="layers"><div class="layer" id="layer"></div></div></div>
      <div class="panel" id="panel"><div class="scene-frame" id="scene-frame" data-layout="tall"><div class="mascot" id="mascot"></div></div></div>
    </div>
  </div>
</div>`;

function retire(node) {
  for (const form of node.querySelectorAll("form")) {
    const stand = document.createElement("div");
    stand.className = form.className;
    stand.append(...form.childNodes);
    form.replaceWith(stand);
  }
  for (const element of node.querySelectorAll("[id], [name], [autocomplete], [aria-live], [role], [for]")) {
    for (const attribute of STRIPPED) element.removeAttribute(attribute);
  }
  node.classList.add("is-outgoing");
  node.setAttribute("aria-hidden", "true");
  node.inert = true;
}

function describeWithSub(layer) {
  const target = layer.querySelector('input:not([type="hidden"]):not([aria-hidden="true"]), .btn');
  if (!target || !layer.querySelector("#view-sub")) return;
  const ids = (target.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
  if (!ids.includes("view-sub")) target.setAttribute("aria-describedby", [...ids, "view-sub"].join(" "));
}

function decorate(layer, spec) {
  const head = layer.querySelector(".head");
  if (head && spec.sub && !head.querySelector(".lede")) head.insertAdjacentHTML("beforeend", `<p class="sub" id="view-sub" aria-live="polite">${esc(spec.sub)}</p>`);
  if (spec.link) {
    layer.insertAdjacentHTML("beforeend", `<p class="view-switch"><span>${esc(spec.link.copy)}</span><button class="link" type="button" data-go="${esc(spec.link.go)}" data-carry>${esc(spec.link.label)}</button></p>`);
  }
  if (spec.guest) layer.insertAdjacentHTML("beforeend", '<p class="view-guest"><button class="link" type="button" data-guest>Ohne Konto weiter</button></p>');
}

// Opens the Luna scene above the page and resolves once it is closed again, with what came of it.
function mount({ screen, email }) {
  const controller = new AbortController();
  const { signal } = controller;
  const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const dialog = document.createElement("dialog");
  dialog.className = "account-scene";
  const host = document.createElement("div");
  host.className = "account-scene-host";
  dialog.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  // Keys and focus inside the scene belong to it: the page's shortcuts, its guard against Backspace and its scrolling
  // of a focused field clear of a toast stay out, or the page would move behind the scene.
  for (const type of ["keydown", "keyup", "keypress", "focusin", "focusout"]) dialog.addEventListener(type, (event) => event.stopPropagation(), { signal });
  // A tap shows the pressed look like everywhere else in the app; the page's own helper cannot see into the shadow root.
  let byFinger = false;
  shadow.addEventListener("pointerdown", (event) => (byFinger = event.pointerType !== "mouse"), { signal, capture: true });
  shadow.addEventListener("click", (event) => {
    const pressed = byFinger ? event.target.closest?.("a, button, label, [role='button']") : null;
    if (!pressed || pressed.matches(":disabled, [aria-disabled='true']")) return;
    pressed.classList.add("is-pressed");
    setTimeout(() => pressed.classList.remove("is-pressed"), 180);
  }, { signal, capture: true });
  document.body.append(dialog);

  let resolve;
  const done = new Promise((settled) => (resolve = settled));
  const state = { closing: false, closed: false, timers: new Set() };
  const later = (run, ms) => {
    const timer = setTimeout(() => {
      state.timers.delete(timer);
      if (!state.closed) run();
    }, ms);
    state.timers.add(timer);
  };
  const handle = { done, back: () => false, go: () => {} };

  const start = prepare().then(async (ready) => {
    if (ready) shadow.adoptedStyleSheets = ready;
    else {
      const links = STYLES.map((name) => Object.assign(document.createElement("link"), { rel: "stylesheet", href: styleUrl(name) }));
      shadow.append(...links);
      await Promise.all(links.map(loaded));
    }
    const holder = document.createElement("template");
    holder.innerHTML = shellMarkup();
    shadow.append(holder.content);
    if (state.closed) return;
    view.root = shadow;
    view.signal = signal;
    const find = (selector) => shadow.querySelector(selector);
    const acct = find(".acct");
    const app = find("#app");
    const card = find("#card");
    const forms = find("#forms");
    const layers = find("#layers");
    const frame = find("#scene-frame");
    const hero = find("#panel");
    const topbar = find(".topbar");

    // The scene keeps its light beige look in every theme of the app; only the motion setting reaches it.
    const look = {
      sync() {
        acct.toggleAttribute("data-still", reducedMotion());
      },
      setStep(name) {
        acct.dataset.step = name;
        look.sync();
      },
    };
    look.sync();
    const moved = new MutationObserver(() => look.sync());
    moved.observe(root, { attributes: true, attributeFilter: ["data-motion"] });
    signal.addEventListener("abort", () => moved.disconnect());
    matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => look.sync(), { signal });

    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close({});
    }, { signal });
    find("[data-close]").addEventListener("click", () => close({}), { signal });

    // The scene is built and drawn once nearly invisible before anything moves, so the first frames of the entrance only
    // animate and never wait for layout, parsing or painting.
    dialog.style.opacity = "0.001";
    dialog.showModal();
    root.classList.add("account-open");

    const scene = createScene(frame, luna);
    const figure = new Mascot(find("#mascot"));
    const mascot = createActor(figure, scene);
    const panel = createPanel({ frame, scene });
    const dropHero = (top) => {
      const reserved = parseFloat(app.style.getPropertyValue("--sheet-h"));
      const drop = isVertical() && reserved ? Math.max(0, top - (app.clientHeight - parseFloat(getComputedStyle(forms).bottom) - reserved)) : 0;
      const height = frame.offsetHeight || 1;
      hero.style.setProperty("--hero-drop", `${Math.round(drop)}px`);
      hero.style.setProperty("--hero-zoom", Math.min(1.25, 1 + (drop * 0.6) / height).toFixed(3));
    };
    const sheetMotion = createSheet(forms, { onTop: dropHero });
    const motion = createMotion({ app, hero, sheet: forms, topbar, sheetMotion, look, mascot, panel, scene });
    createKeyboard({ screen: app, sheet: sheetMotion, sheetEl: forms, heroEl: hero, frameEl: frame, brandbar: topbar });

    const signedIn = account.accountState();
    const nav = { id: null, cleanup: null, session: signedIn.signedIn ? { email: signedIn.email } : null };
    let layer = find("#layer");

    const ctx = {
      auth: account,
      profile: { name: profileName, answer: answerName, wanted: () => wantsName(true) },
      mascot,
      get session() {
        return nav.session;
      },
      get from() {
        return nav.id;
      },
      setSession(value) {
        nav.session = value;
      },
      go,
      close,
    };

    function focusStart(screenView) {
      requestAnimationFrame(() => {
        const current = shadow.activeElement;
        if (current && layer.contains(current)) return;
        const wanted = screenView.focus && finePointer() ? layer.querySelector(screenView.focus) : null;
        (wanted || layer.querySelector(".title"))?.focus({ preventScroll: true });
      });
    }

    function measureSheet() {
      if (!isVertical()) {
        dropHero(0);
        return;
      }
      const probe = document.createElement("div");
      probe.className = "layer is-probe";
      probe.innerHTML = SCREENS.signin.render(ctx, {}).html;
      decorate(probe, SCREENS.signin.panel(ctx, {}));
      forms.append(probe);
      const sheet = getComputedStyle(forms);
      const own = getComputedStyle(probe);
      const height = probe.offsetHeight + parseFloat(own.marginTop) + parseFloat(own.marginBottom) + parseFloat(sheet.paddingTop) + parseFloat(sheet.paddingBottom);
      probe.remove();
      app.style.setProperty("--sheet-h", `${Math.ceil(height)}px`);
      dropHero(forms.offsetTop);
    }

    let entrance = null;

    function go(id, params = {}, { hold = false } = {}) {
      if (state.closing) return;
      const target = SCREENS[id];
      const redirect = target.guard?.(ctx, params);
      if (redirect) return go(redirect.id, redirect.params ?? {});

      motion.finish();
      nav.cleanup?.();
      nav.cleanup = null;
      app.removeAttribute("data-arriving");
      mascot.progress("");

      const first = nav.id === null;
      const from = nav.id;
      const arrival = Boolean(params.arrival);
      const spec = target.panel(ctx, params);
      const entering = first || arrival;
      const outgoing = first ? null : layer;
      const incoming = first ? layer : document.createElement("div");
      incoming.className = "layer";
      const screenView = target.render(ctx, params);
      incoming.innerHTML = screenView.html;
      decorate(incoming, spec);

      const place = () => {
        if (outgoing) {
          if (entering) outgoing.remove();
          else retire(outgoing);
        }
        if (!first) layers.prepend(incoming);
      };
      if (entering) place();
      else sheetMotion.resize(place);
      layer = incoming;

      app.dataset.screen = id;
      dialog.setAttribute("aria-label", target.title);
      nav.id = id;

      if (entering && hold) {
        panel.apply(spec, { animate: false });
        entrance = { spec, incoming, arrival };
      } else if (entering) motion.rise({ spec, incoming, arrival });
      else if (reducedMotion()) motion.fade({ spec, outgoing, incoming });
      else motion.swap({ spec, outgoing, incoming, direction: (RANK[id] ?? 0) >= (RANK[from] ?? 0) ? 1 : -1 });

      nav.cleanup = target.mount?.(incoming, ctx, params) ?? null;
      describeWithSub(incoming);
      if (hold) return screenView;
      focusStart(screenView);
      if (!arrival) later(() => mascot.blink(), first ? 1100 : 700);
      return screenView;
    }

    card.addEventListener("click", async (event) => {
      const trigger = event.target.closest("[data-go], [data-guest]");
      if (!trigger || trigger.getAttribute("aria-disabled") === "true") return;
      if (trigger.hasAttribute("data-guest")) {
        go("guest");
        return;
      }
      const next = {};
      const emailField = layer.querySelector('input[name="email"]');
      if (trigger.hasAttribute("data-carry") && emailField?.value.trim()) next.email = emailField.value.trim();
      if (trigger.dataset.email) next.email = trigger.dataset.email;
      go(trigger.dataset.go, next);
    }, { signal });

    matchMedia(STACKED).addEventListener("change", measureSheet, { signal });
    addEventListener("resize", () => {
      if (!app.hasAttribute("data-kb")) measureSheet();
    }, { signal });

    // The phone's back button steps back where a screen has a way back, and closes the scene otherwise.
    handle.back = () => {
      if (state.closing) return true;
      const back = layer.querySelector(".sheet-top .back");
      if (back) back.click();
      else if (SCREENS[nav.id]?.back) go(SCREENS[nav.id].back);
      else close({});
      return true;
    };
    handle.go = (id, next = {}) => {
      if (SCREENS[id] && id !== nav.id) go(id, next);
    };

    async function close(result = {}) {
      if (state.closing || state.closed) return;
      if (layer.querySelector('form[aria-busy="true"]') && !result.opened) return;
      state.closing = true;
      nav.cleanup?.();
      nav.cleanup = null;
      pending.clear();
      if (result.opened) await motion.leave({ spec: { scene: { stage: 3, done: true } }, layer, celebrate: true });
      // Closing without an account is quick: the sheet drops a little while the whole scene fades.
      else if (!reducedMotion()) forms.animate([{ transform: "none" }, { transform: "translateY(36px)" }], { duration: 260, easing: "cubic-bezier(0.55, 0, 0.85, 0.36)", fill: "forwards" });
      const fade = dialog.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion() ? 100 : result.opened ? 220 : 260, easing: "ease-in", fill: "forwards" });
      await fade.finished.catch(() => {});
      motion.finish();
      teardown();
      if (result.note) toast(esc(result.note), { icon: "circle-check" });
      resolve(result);
    }

    function teardown() {
      if (state.closed) return;
      state.closed = true;
      state.timers.forEach((timer) => clearTimeout(timer));
      controller.abort();
      figure.destroy();
      if (dialog.open) dialog.close();
      dialog.remove();
      root.classList.remove("account-open");
      if (view.root === shadow) {
        view.root = null;
        view.signal = null;
      }
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    }

    measureSheet();
    const first = SCREENS[screen] ? screen : "create";
    const screenView = go(first, { email, arrival: first === "create" && !signedIn.knownDevice }, { hold: true });
    await nextFrame();
    await nextFrame();
    if (state.closing || state.closed) return;
    acct.removeAttribute("data-warming");
    dialog.style.opacity = "";
    dialog.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reducedMotion() ? 120 : 260, easing: "ease-out" });
    if (entrance) motion.rise(entrance);
    entrance = null;
    focusStart(screenView);
    if (first !== "create" || signedIn.knownDevice) later(() => mascot.blink(), 1100);
  });

  start.catch(() => {
    controller.abort();
    dialog.remove();
    root.classList.remove("account-open");
    resolve({ failed: true });
  });
  return handle;
}

export function openScene({ screen = "create", email = "" } = {}) {
  if (active) {
    active.go(screen, { email });
    return active.done;
  }
  const handle = mount({ screen, email });
  active = handle;
  handle.done.finally(() => {
    if (active === handle) active = null;
  });
  return handle.done;
}

export const sceneBack = () => (active ? active.back() : false);

export const sceneOpen = () => Boolean(active);
