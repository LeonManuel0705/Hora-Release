// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "../icons.js";
import { sleep } from "../dom.js";
import { pending } from "../flow.js";
import { messageFor, normalizeError } from "../messages.js";
import { emailFieldMarkup, mountEmailField } from "../ui/fields.js";
import { slotMarkup } from "../ui/notice.js";
import { createFormKit } from "../ui/form-kit.js";
import { lockBadge } from "../luna-scene.js";

export default {
  id: "forgot",
  title: "Passwort vergessen",
  panel: () => ({
    sub: "Gib die E-Mail deines Kontos ein.",
    link: null,
    scene: { stage: 1 },
  }),

  render(ctx, params) {
    return {
      html: `
        <div class="sheet-top">
          <button class="back" type="button" data-go="signin" data-carry>${icon("chevron-left", { size: 20 })}Zur Anmeldung</button>
        </div>
        <div class="head">
          <h1 class="title" tabindex="-1">Passwort vergessen?</h1>
        </div>
        <form class="form" novalidate>
          ${emailFieldMarkup({ value: params.email || "" })}
          <div class="notice-lock notice-static">${lockBadge()}<p>Deine Daten im Konto sind mit deinem Passwort verschlüsselt. <strong>Nach dem Zurücksetzen lassen sie sich nicht mehr öffnen.</strong> Was auf deinen Geräten liegt, bleibt erhalten.</p></div>
          ${slotMarkup()}
          <button class="btn btn-primary btn-block" type="submit">Code senden ${icon("arrow-right", { size: 20, className: "icon-nudge" })}</button>
        </form>`,
      focus: "#email",
    };
  },

  mount(root, ctx) {
    const { mascot, auth } = ctx;
    const form = root.querySelector("form");
    mascot.hold(null);
    const email = mountEmailField(root, { mascot });
    const kit = createFormKit(root, ctx, { form });
    let alive = true;

    async function submit() {
      if (kit.busy || kit.cooling) return;
      kit.notice.hide();
      if (!email.valid()) {
        email.error(email.input.value.trim() ? messageFor("invalid_email") : "Gib deine E-Mail-Adresse ein.");
        email.input.focus();
        mascot.wince();
        return;
      }
      const address = email.value;
      kit.start("Code wird gesendet");
      try {
        const result = await auth.requestPasswordReset(address);
        pending.write({ email: result?.email || address, purpose: "reset", resendAfter: result?.resendAfter, expiresIn: result?.expiresIn });
        if (!alive) return;
        kit.succeed();
        await sleep(200);
        if (alive) ctx.go("reset");
      } catch (error) {
        if (!alive) return;
        kit.finish();
        const e = normalizeError(error);
        mascot.wince();
        if (e.code === "invalid_email") {
          email.error(messageFor(e));
          email.input.focus();
        } else if (e.code === "rate_limited") {
          kit.notice.show("error", messageFor(e));
          kit.cooldown(e.retryAfter ?? 30);
        } else {
          kit.notice.show("error", messageFor(e), e.code === "network" ? [{ label: "Erneut versuchen", run: () => submit() }] : []);
        }
      }
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });

    return () => {
      alive = false;
      kit.destroy();
    };
  },
};
