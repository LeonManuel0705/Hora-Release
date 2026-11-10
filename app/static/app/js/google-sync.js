// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { data } from "./core.js";
import { attentive, onAttention } from "./attention.js";

const NUDGE_GAP = 60 * 1000;
const PULL_GAP = 5 * 60 * 1000;
const SETTLE = 4000;

let nudged = 0;
let pulling = false;

async function pull() {
  if (pulling) return;
  pulling = true;
  try {
    const response = await fetch("/api/ui/google/events", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json();
    if (response.ok && payload.success !== false && Array.isArray(payload.events)) {
      data.events = payload.events;
      data.status.google = payload.google;
    }
  } catch {}
  pulling = false;
}

function nudge() {
  if (!attentive() || Date.now() - nudged < NUDGE_GAP) return;
  nudged = Date.now();
  fetch("/api/ui/google/nudge", { method: "POST", credentials: "same-origin" })
    .then(() => setTimeout(pull, SETTLE))
    .catch(() => {});
}

// The calendar page keeps its events fresh itself and more often (pages/calendar.js, keepFresh).
export function initGoogleSync() {
  if (!data?.status?.google || document.getElementById("calendarPage")) return;
  nudge();
  onAttention(nudge);
  setInterval(pull, PULL_GAP);
}
