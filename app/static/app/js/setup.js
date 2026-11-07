// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { data, params, hasPlan } from "./core.js";
import { toast } from "./shell.js";

let loading = null;
let failures = 0;

export function openSetup(options = {}) {
  if (!data?.timetable) {
    location.assign("/hub?einrichtung=1");
    return Promise.resolve();
  }
  // A browser keeps a failed module import failed under its address, so another try asks under a new one.
  loading ||= import(`./setup-flow.js${failures ? `?retry=${failures}` : ""}`).catch((error) => {
    loading = null;
    failures += 1;
    throw error;
  });
  return loading.then((flow) => flow.open(options), () => {
    toast("Die Einrichtung ließ sich gerade nicht laden. Versuch es gleich noch einmal.", { icon: "circle-alert" });
  });
}

export function initSetup() {
  window.AppSetup = Object.freeze({ open: openSetup, needed: () => !!data?.timetable && !hasPlan() });
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest?.("[data-open-setup]");
    if (!trigger) return;
    event.preventDefault();
    openSetup({ from: trigger.dataset.openSetup || "" });
  });
  if (params.get("einrichtung") === "1") {
    const url = new URL(location.href);
    url.searchParams.delete("einrichtung");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
    openSetup({ from: "link" });
  }
}
