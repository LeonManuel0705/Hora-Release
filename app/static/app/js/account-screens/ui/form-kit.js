// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "../icons.js";
import { createNotice } from "./notice.js";
import { setBusy, completeBusy } from "./button.js";
import { countdown } from "./countdown.js";
import { formatClock } from "../messages.js";
import { isVertical } from "../panel.js";
import { focused } from "../dom.js";

export function createFormKit(root, ctx, { form, onIdle }) {
  const button = form.querySelector('button[type="submit"]');
  const notice = createNotice(root);
  const inputs = [...form.querySelectorAll("input")];
  let busy = false;
  let timer = null;
  let original = null;

  function lock(on) {
    for (const input of inputs) {
      if (on) {
        input.dataset.locked = input.readOnly ? "kept" : "yes";
        input.readOnly = true;
      } else if (input.dataset.locked === "yes") {
        input.readOnly = false;
      }
    }
    form.setAttribute("aria-busy", String(on));
  }

  const kit = {
    notice,
    button,
    get busy() {
      return busy;
    },
    get cooling() {
      return Boolean(timer);
    },
    start(label) {
      busy = true;
      if (isVertical()) focused()?.blur?.();
      notice.hide();
      lock(true);
      setBusy(button, true, label);
      ctx.mascot.cover(false);
      ctx.mascot.hold("progress");
      ctx.mascot.progress("working");
    },
    succeed() {
      completeBusy(button);
      ctx.mascot.progress("done");
    },
    finish() {
      busy = false;
      lock(false);
      setBusy(button, false);
      ctx.mascot.progress("");
      ctx.mascot.hold(null);
      onIdle?.();
    },
    cooldown(seconds) {
      timer?.stop();
      if (original === null) original = button.innerHTML;
      timer = countdown(Date.now() + seconds * 1000, {
        onTick(remaining) {
          if (remaining > 0) {
            button.setAttribute("aria-disabled", "true");
            button.innerHTML = `${icon("clock", { size: 18 })}<span>Warte ${formatClock(remaining)}</span>`;
          }
        },
        onDone() {
          timer = null;
          button.innerHTML = original;
          original = null;
          button.removeAttribute("aria-disabled");
          notice.hide();
        },
      });
    },
    destroy() {
      timer?.stop();
      timer = null;
    },
  };
  return kit;
}
