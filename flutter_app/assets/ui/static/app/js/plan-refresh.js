// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { applySchoolEdits } from "./core.js";

const views = new Set();
const waiting = new Set();
const HELD_BY = ["pointerup", "pointercancel", "focusout", "close", "toggle"];
let listening = false;
let soon = 0;

function pressed() {
  try {
    return !!document.querySelector(":active");
  } catch {
    return false;
  }
}

function hold(on) {
  if (on === listening) return;
  listening = on;
  HELD_BY.forEach((type) => (on ? document.addEventListener : document.removeEventListener).call(document, type, planViewsFree, true));
}

function run(view) {
  if (pressed() || view.busy()) {
    waiting.add(view);
    hold(true);
    return;
  }
  waiting.delete(view);
  view.refresh();
}

function retry() {
  soon = 0;
  [...waiting].forEach(run);
  if (!waiting.size) hold(false);
}

// A part of a page that shows the plan registers how it draws itself again, and when that would cost the user what they
// are doing (typing, an open editor or dialog). Such a part waits and is drawn again once that is over.
export function onPlanRefresh(refresh, busy = () => false) {
  const view = { refresh, busy };
  views.add(view);
  return () => {
    views.delete(view);
    waiting.delete(view);
  };
}

// Something that held a refresh back has closed. Focus, dialogs, popovers and presses are watched on their own.
export function planViewsFree() {
  if (!waiting.size || soon) return;
  soon = setTimeout(retry, 0);
}

// The plan on this device was replaced, by a sync with the account. The page shows it without a reload.
export function refreshPlan() {
  applySchoolEdits();
  views.forEach(run);
  dispatchEvent(new CustomEvent("app:plan-refreshed", { detail: { waiting: waiting.size } }));
}
