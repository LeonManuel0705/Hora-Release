// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "../icons.js";
import { esc } from "../dom.js";

export function setBusy(button, on, label = "") {
  if (on) {
    if (button.dataset.original === undefined) button.dataset.original = button.innerHTML;
    button.classList.add("is-busy");
    button.classList.remove("is-complete");
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<i class="busy-ring" aria-hidden="true"></i><span class="busy-label">${esc(label)}</span><span class="busy-ok" aria-hidden="true">${icon("check", { size: 20 })}</span>`;
    return;
  }
  button.classList.remove("is-busy", "is-complete");
  button.removeAttribute("aria-busy");
  if (button.dataset.original !== undefined) {
    button.innerHTML = button.dataset.original;
    delete button.dataset.original;
  }
  button.removeAttribute("aria-disabled");
}

export function completeBusy(button) {
  button.classList.add("is-complete");
}
