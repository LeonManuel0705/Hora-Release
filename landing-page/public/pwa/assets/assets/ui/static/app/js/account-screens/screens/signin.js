// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "../icons.js";
import { sleep } from "../dom.js";
import { pending } from "../flow.js";
import { messageFor, normalizeError } from "../messages.js";
import { emailFieldMarkup, passwordFieldMarkup, mountEmailField, mountPasswordField } from "../ui/fields.js";
import { slotMarkup } from "../ui/notice.js";
import { createFormKit } from "../ui/form-kit.js";

export default {
  id: "signin",
  title: "Anmelden",
  panel: () => ({
    sub: "Gib deine E-Mail und dein Passwort ein.",
    link: { copy: "Neu hier?", label: "Konto erstellen", go: "create" },
    guest: true,
    scene: { stage: 1 },
  }),

  render(ctx, params) {
    return {
      html: `
        <div class="head">
          <h1 class="title" tabindex="-1">Anmelden</h1>
        </div>
        <form class="form" novalidate>
          ${emailFieldMarkup({ value: params.email || "" })}
          ${passwordFieldMarkup({ id: "password", autocomplete: "current-password" })}
          <div class="row-links"><button class="link" type="button" data-go="forgot" data-carry>Passwort vergessen?</button></div>
          ${slotMarkup()}
          <button class="btn btn-primary btn-block" type="submit">Anmelden ${icon("arrow-right", { size: 20, className: "icon-nudge" })}</button>
        </form>`,
      focus: params.email ? "#password" : "#email",
    };
  },

  mount(root, ctx) {
    const { mascot, auth } = ctx;
    const form = root.querySelector("form");
    mascot.hold(null);
    const email = mountEmailField(root, { mascot });
    const password = mountPasswordField(root, { mascot, auth, getEmail: () => email.value });
    const kit = createFormKit(root, ctx, { form, onIdle: () => password.syncCover() });
    let alive = true;

    function fail(error) {
      const e = normalizeError(error);
      mascot.wince();
      switch (e.code) {
        case "invalid_email":
          email.error(messageFor(e));
          email.input.focus();
          break;
        case "invalid_credentials":
          kit.notice.show("error", messageFor(e));
          password.input.value = "";
          password.update();
          password.input.focus();
          break;
        case "email_not_verified":
          pending.write({ email: email.value, purpose: "signup", resendAfter: e.resendAfter, expiresIn: e.expiresIn });
          ctx.go("code", { unverified: true });
          break;
        case "rate_limited":
          kit.notice.show("error", "Zu viele Versuche. Probier es gleich noch einmal.");
          kit.cooldown(e.retryAfter ?? 30);
          break;
        case "network":
          kit.notice.show("error", messageFor(e), [{ label: "Erneut versuchen", run: () => submit() }]);
          break;
        default:
          kit.notice.show("error", messageFor(e));
      }
    }

    async function submit() {
      if (kit.busy || kit.cooling) return;
      kit.notice.hide();
      if (!email.valid()) {
        email.error(email.input.value.trim() ? messageFor("invalid_email") : "Gib deine E-Mail-Adresse ein.");
        email.input.focus();
        mascot.wince();
        return;
      }
      if (!password.value) {
        password.error("Gib dein Passwort ein.");
        password.input.focus();
        mascot.wince();
        return;
      }
      kit.start("Anmeldung läuft");
      try {
        const result = await auth.signIn(email.value, password.value);
        ctx.setSession(result.account);
        if (!alive) return;
        kit.succeed();
        await sleep(220);
        if (alive) ctx.close({ opened: true });
      } catch (error) {
        if (!alive) return;
        kit.finish();
        fail(error);
      }
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });

    return () => {
      alive = false;
      password.destroy();
      kit.destroy();
      mascot.cover(false);
    };
  },
};
