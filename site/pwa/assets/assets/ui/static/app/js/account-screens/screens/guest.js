// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "../icons.js";

// Before going on without an account, Luna says what that means for the plan.
export default {
  id: "guest",
  title: "Ohne Konto weiter",
  back: "create",

  panel: () => ({
    link: null,
    scene: { stage: 1 },
  }),

  render() {
    return {
      html: `
        <div class="head">
          <h1 class="title luna-line" tabindex="-1">Alles klar! Dann bleibt dein Stundenplan nur auf diesem Gerät. Auf deinen anderen Geräten siehst du ihn nicht.</h1>
          <p class="lede">Ein Konto kannst du später in den Einstellungen anlegen.</p>
        </div>
        <div class="actions">
          <button class="btn btn-primary btn-block" type="button" data-understood>Verstanden ${icon("check", { size: 20, className: "icon-nudge" })}</button>
        </div>
        <p class="view-switch"><button class="link" type="button" data-go="create">Doch ein Konto erstellen</button></p>`,
      focus: "[data-understood]",
    };
  },

  mount(root, ctx) {
    ctx.mascot.hold(null);
    const wave = setTimeout(() => ctx.mascot.wave(), 380);
    const button = root.querySelector("[data-understood]");
    button.addEventListener("click", async () => {
      if (button.getAttribute("aria-disabled") === "true") return;
      button.setAttribute("aria-disabled", "true");
      try {
        await ctx.auth.continueWithoutAccount();
      } catch {}
      if (ctx.profile.wanted()) ctx.go("name");
      else ctx.close({ guest: true });
    });
    return () => clearTimeout(wave);
  },
};
