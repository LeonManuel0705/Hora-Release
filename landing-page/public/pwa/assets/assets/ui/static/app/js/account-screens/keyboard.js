// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { isPhone } from "./panel.js";
import { focused, view } from "./dom.js";

const PILL = 58;
const FOCUS = ["phone", "lock"];

export function createKeyboard({ screen, sheet, sheetEl, heroEl, frameEl, brandbar }) {
  const root = screen;
  const page = document.documentElement;
  let on = false;
  let last = "";
  let pending = 0;

  const active = () => {
    const element = focused();
    return element instanceof HTMLInputElement && sheetEl.contains(element) && !element.closest(".is-outgoing") ? element : null;
  };

  function band() {
    const view = window.visualViewport;
    if (!view) return { top: 0, gap: 0, pad: 0 };
    return {
      top: Math.max(0, view.offsetTop),
      gap: Math.max(0, screen.clientHeight - (view.offsetTop + view.height)),
      pad: /iPhone|iPad/.test(navigator.userAgent) ? PILL : 0,
    };
  }

  function focusBox() {
    const boxes = [];
    for (const name of FOCUS) {
      const box = frameEl.querySelector(`[data-part="${name}"]`)?.getBBox();
      if (box?.width && box.height) boxes.push([box.x / 480, box.y / 320, (box.x + box.width) / 480, (box.y + box.height) / 320]);
    }
    const mascot = frameEl.dataset.mascot === "on" ? frameEl.querySelector(".mascot") : null;
    if (mascot) {
      const [width, height] = [frameEl.offsetWidth, frameEl.offsetHeight];
      boxes.push([(mascot.offsetLeft + mascot.offsetWidth * 0.2) / width, (mascot.offsetTop + mascot.offsetHeight * 0.22) / height, (mascot.offsetLeft + mascot.offsetWidth * 0.8) / width, (mascot.offsetTop + mascot.offsetHeight * 0.8) / height]);
    }
    if (!boxes.length) return [0, 0, 1, 1];
    return boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  }

  function place(area) {
    if (!on) {
      frameEl.style.scale = "";
      frameEl.style.translate = "";
      return;
    }
    const [width, height] = [frameEl.offsetWidth, frameEl.offsetHeight];
    const [x0, y0, x1, y1] = focusBox();
    const top = area.top + (area.top > 0 ? 6 : brandbar.offsetTop - 6);
    const span = Math.max(80, sheetEl.offsetTop + 8 - top);
    const scale = Math.max(0.5, Math.min(1.8, (span - 14) / ((y1 - y0) * height), (screen.clientWidth * 0.92) / ((x1 - x0) * width)));
    const tx = screen.clientWidth / 2 - (heroEl.offsetLeft + frameEl.offsetLeft) - scale * (((x0 + x1) / 2) * width - width / 2);
    const ty = top + span / 2 - (heroEl.offsetTop + frameEl.offsetTop) - scale * (((y0 + y1) / 2) * height);
    frameEl.style.scale = scale.toFixed(3);
    frameEl.style.translate = `${Math.round(tx)}px ${Math.round(ty)}px`;
  }

  function update() {
    pending = 0;
    const area = band();
    const keyboard = area.gap > 120 || page.hasAttribute("data-keyboard");
    const next = isPhone() && root.parentElement?.dataset.step === "auth" && Boolean(active()) && keyboard;
    const signature = next ? `${Math.round(area.gap)}:${Math.round(area.top)}:${area.pad}` : "";
    if (signature === last) return;
    last = signature;
    on = next;
    sheet.relayout(() => {
      root.toggleAttribute("data-kb", on);
      root.style.setProperty("--kb-gap", `${on ? Math.round(area.gap) : 0}px`);
      root.style.setProperty("--kb-pad", `${on ? area.pad : 0}px`);
    });
    place(area);
  }

  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(update);
  };

  const signal = view.signal;
  sheetEl.addEventListener("focusin", schedule, { signal });
  sheetEl.addEventListener("focusout", () => setTimeout(schedule, 0), { signal });
  window.visualViewport?.addEventListener("resize", schedule, { signal });
  window.visualViewport?.addEventListener("scroll", schedule, { signal });
  const keys = new MutationObserver(schedule);
  keys.observe(page, { attributes: true, attributeFilter: ["data-keyboard"] });
  const sized = new ResizeObserver(() => {
    if (on) place(band());
  });
  sized.observe(sheetEl);
  signal?.addEventListener("abort", () => {
    keys.disconnect();
    sized.disconnect();
    cancelAnimationFrame(pending);
  });

  return { refresh: schedule };
}
