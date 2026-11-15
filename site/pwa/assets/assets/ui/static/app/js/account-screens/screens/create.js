// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "../icons.js";
import { esc, sleep } from "../dom.js";
import { pending } from "../flow.js";
import { messageFor, normalizeError } from "../messages.js";
import { emailFieldMarkup, passwordFieldMarkup, mountEmailField, mountPasswordField } from "../ui/fields.js";
import { slotMarkup } from "../ui/notice.js";
import { createFormKit } from "../ui/form-kit.js";

const PRIVACY_PATH = "/datenschutz";

// The privacy policy on the website, linked where the address and the password are asked for. The shells open it in the
// system browser like every other link to a new window.
export function privacyUrl() {
  const site = (document.documentElement.dataset.brandWebsite || "").replace(/\/$/, "");
  return /^https:\/\/[^/]+$/.test(site) ? `${site}${PRIVACY_PATH}` : "";
}

function privacyNote() {
  const url = privacyUrl();
  if (!url) return "";
  return `<p class="form-note">Was mit deinen Daten passiert, steht in der <a class="link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Datenschutzerklärung<span class="visually-hidden">, öffnet im Browser</span></a>.</p>`;
}

export default {
  id: "create",
  title: "Konto erstellen",
  panel: () => ({
    sub: "Mit einem Konto ist dein Stundenplan auf all deinen Geräten gleich.",
    link: { copy: "Schon ein Konto?", label: "Anmelden", go: "signin" },
    guest: true,
    scene: { stage: 2 },
  }),

  render(ctx, params) {
    return {
      html: `
        <div class="head">
          <h1 class="title" tabindex="-1">Konto erstellen <span class="beta-tag">Beta</span></h1>
        </div>
        <form class="form" novalidate>
          ${emailFieldMarkup({ value: params.email || "" })}
          ${passwordFieldMarkup({ id: "password", autocomplete: "new-password", meter: true })}
          ${slotMarkup()}
          <button class="btn btn-primary btn-block" type="submit">Konto anlegen ${icon("arrow-right", { size: 20, className: "icon-nudge" })}</button>
          ${privacyNote()}
        </form>`,
      focus: params.email ? "#password" : "#email",
    };
  },

  mount(root, ctx) {
    const { mascot, auth } = ctx;
    const form = root.querySelector("form");
    mascot.hold(null);
    const email = mountEmailField(root, { mascot, onInput: () => password.update() });
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
        case "weak_password":
          password.error(messageFor(e));
          password.input.focus();
          break;
        case "email_taken":
          kit.notice.show("error", messageFor(e), [
            { label: "Anmelden", run: () => ctx.go("signin", { email: email.value }) },
            { label: "Passwort vergessen", run: () => ctx.go("forgot", { email: email.value }) },
          ]);
          break;
        case "rate_limited":
          kit.notice.show("error", messageFor(e));
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
      if (!password.acceptable()) {
        password.error(password.explain());
        password.input.focus();
        mascot.wince();
        return;
      }
      const address = email.value;
      kit.start("Schlüssel werden berechnet");
      try {
        const result = await auth.signUp(address, password.value);
        pending.write({ email: result?.email || address, purpose: "signup", resendAfter: result?.resendAfter, expiresIn: result?.expiresIn });
        if (!alive) return;
        kit.succeed();
        await sleep(220);
        if (alive) ctx.go("code");
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
