// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "../icons.js";
import { esc } from "../dom.js";
import { envelopeBadge } from "../luna-scene.js";

const ICONS = { error: "circle-alert", info: "info", ok: "circle-check" };

export function slotMarkup(name = "notice") {
  return `<div class="slot" data-slot="${name}" aria-live="assertive" aria-atomic="true"><div></div></div>`;
}

export function createNotice(root, name = "notice") {
  const slot = root.querySelector(`[data-slot="${name}"]`);
  const inner = slot.firstElementChild;
  let actions = [];
  let clearTimer = 0;

  inner.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    actions[Number(button.dataset.action)]?.run();
  });

  return {
    // A mail notice has no box: the scene's envelope beside the words, the sentence that matters in bold.
    show(kind, text, list = [], { strong = "" } = {}) {
      clearTimeout(clearTimer);
      actions = list;
      const buttons = list.length
        ? `<div class="notice-actions">${list.map((item, i) => `<button type="button" class="link" data-action="${i}">${esc(item.label)}</button>`).join("")}</div>`
        : "";
      inner.textContent = "";
      slot.classList.add("is-open");
      requestAnimationFrame(() => {
        const words = strong && text.includes(strong) ? esc(text).replace(esc(strong), `<strong>${esc(strong)}</strong>`) : esc(text);
        inner.innerHTML = kind === "mail"
          ? `<div class="notice-mail">${envelopeBadge()}<div><p>${words}</p>${buttons}</div></div>`
          : `<div class="notice is-${kind}">${icon(ICONS[kind], { size: 20 })}<div><p>${words}</p>${buttons}</div></div>`;
      });
    },
    hide() {
      actions = [];
      if (!slot.classList.contains("is-open")) return;
      slot.classList.remove("is-open");
      clearTimer = setTimeout(() => {
        if (!slot.classList.contains("is-open")) inner.textContent = "";
      }, 360);
    },
  };
}
