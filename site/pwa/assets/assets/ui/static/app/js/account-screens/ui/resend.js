// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "../icons.js";
import { countdown } from "./countdown.js";
import { formatClock } from "../messages.js";

export function resendMarkup(label = "Keine Mail bekommen?") {
  return `<div class="resend"><span>${label}</span><button type="button" class="link" data-resend aria-disabled="true">Neuen Code senden</button><span class="visually-hidden" aria-live="polite" data-resend-live></span></div>`;
}

export function mountResend(root, { until, send }) {
  const button = root.querySelector("[data-resend]");
  const live = root.querySelector("[data-resend-live]");
  let sending = false;
  let running = false;
  let timer = null;

  const idle = () => {
    button.textContent = "Neuen Code senden";
    button.removeAttribute("aria-disabled");
  };

  function run(deadline) {
    timer?.stop();
    running = true;
    timer = countdown(deadline, {
      onTick(remaining) {
        if (remaining > 0) {
          button.setAttribute("aria-disabled", "true");
          button.textContent = `Neuen Code senden in ${formatClock(remaining)}`;
        }
      },
      onDone() {
        running = false;
        idle();
        live.textContent = "Du kannst jetzt einen neuen Code anfordern.";
      },
    });
  }

  button.addEventListener("click", async () => {
    if (sending || button.getAttribute("aria-disabled") === "true") return;
    sending = true;
    button.setAttribute("aria-disabled", "true");
    button.innerHTML = `${icon("loader-circle", { size: 16, className: "spinner" })} Sende …`;
    live.textContent = "";
    try {
      await send();
    } finally {
      sending = false;
      if (!running) idle();
    }
  });

  run(until);

  return {
    restart: run,
    highlight() {
      button.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 480, easing: "ease-out" });
    },
    destroy: () => timer?.stop(),
  };
}
