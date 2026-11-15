// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { root, params } from "./core.js";

const SETTLE_MS = 400;
const TOUR_GRACE_MS = 1600;
const PHONE_SHELLS = ["android", "ios"];

// The tour starts by itself 1.2 s after the page is ready on a device that never saw it.
function tourAhead() {
  if (document.body?.dataset.tourAuto !== "1" || location.pathname !== "/hub" || params.has("einrichtung")) return false;
  const ready = performance.getEntriesByType?.("navigation")?.[0]?.domContentLoadedEventEnd || 0;
  return !ready || performance.now() < ready + TOUR_GRACE_MS;
}

export function pageBusy() {
  return Boolean(
    document.querySelector("dialog[open], [popover]:popover-open:not(.variant-menu)")
      || root.classList.contains("setup-open")
      || root.classList.contains("tour-on")
      || root.classList.contains("account-open")
      || tourAhead(),
  );
}

// The phone's shell asks its own start questions (the first steps, the A/B week) over the page; it says when they are over.
export function shellSettled() {
  if (!PHONE_SHELLS.includes(root.dataset.shell)) return Promise.resolve();
  const ask = () => Promise.resolve(window.flutter_inappwebview.callHandler("startSettled")).catch(() => null);
  if (window.flutter_inappwebview?.callHandler) return ask();
  return new Promise((resolve) => addEventListener("flutterInAppWebViewPlatformReady", () => resolve(ask()), { once: true }));
}

// Waits until nothing else is open: no dialog, popover, setup, tour or the tour about to start. Events, no polling.
export function pageQuiet() {
  return new Promise((resolve) => {
    let timer = 0;
    const watch = new MutationObserver(() => soon());
    const types = ["close", "toggle", "transitionend", "animationend"];
    const stop = () => {
      clearTimeout(timer);
      watch.disconnect();
      types.forEach((type) => document.removeEventListener(type, soon, true));
    };
    function check() {
      timer = 0;
      if (pageBusy()) {
        if (tourAhead()) timer = setTimeout(check, 300);
        return;
      }
      stop();
      resolve();
    }
    function soon() {
      if (!timer) timer = setTimeout(check, SETTLE_MS);
    }
    watch.observe(root, { attributes: true, attributeFilter: ["class"] });
    if (document.body) watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    types.forEach((type) => document.addEventListener(type, soon, true));
    soon();
  });
}
