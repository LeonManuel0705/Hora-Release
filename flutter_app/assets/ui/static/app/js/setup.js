// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { data, params, hasPlan } from "./core.js";

let loading = null;

export function openSetup(options = {}) {
  if (!data?.timetable) {
    location.assign("/hub?einrichtung=1");
    return Promise.resolve();
  }
  loading ||= import("./setup-flow.js");
  return loading.then((flow) => flow.open(options));
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
