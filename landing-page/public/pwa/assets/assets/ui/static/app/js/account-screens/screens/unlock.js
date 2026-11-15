// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "../icons.js";
import { esc, sleep } from "../dom.js";
import { messageFor, normalizeError } from "../messages.js";
import { passwordFieldMarkup, mountPasswordField, seedOf } from "../ui/fields.js";
import { slotMarkup } from "../ui/notice.js";
import { createFormKit } from "../ui/form-kit.js";

// The session is still valid, but the key to the data is gone from this device. The password brings it back.
export default {
  id: "unlock",
  title: "Passwort eingeben",
  guard: (ctx) => (ctx.session ? null : { id: "signin" }),

  panel: () => ({
    sub: "Dann öffnet dieses Gerät deinen Stundenplan wieder.",
    link: null,
    scene: { stage: 1 },
  }),

  render(ctx) {
    const email = ctx.session.email;
    return {
      html: `
        <div class="head">
          <h1 class="title" tabindex="-1">Passwort eingeben</h1>
          <p class="lede">Angemeldet als <strong>${esc(email)}</strong>.</p>
        </div>
        <form class="form" novalidate>
          <input class="visually-hidden" type="email" name="email" autocomplete="username" value="${esc(email)}" tabindex="-1" aria-hidden="true" readonly>
          ${passwordFieldMarkup({ id: "password", autocomplete: "current-password" })}
          <div class="row-links"><button class="link" type="button" data-go="forgot" data-email="${esc(email)}">Passwort vergessen?</button></div>
          ${slotMarkup()}
          <button class="btn btn-primary btn-block" type="submit">Weiter ${icon("arrow-right", { size: 20, className: "icon-nudge" })}</button>
        </form>`,
      focus: "#password",
    };
  },

  mount(root, ctx) {
    const { mascot, auth } = ctx;
    const form = root.querySelector("form");
    const email = ctx.session.email;
    mascot.hold(null);
    mascot.type("email", email.length, seedOf(email.toLowerCase()));
    const password = mountPasswordField(root, { mascot, auth, getEmail: () => email });
    const kit = createFormKit(root, ctx, { form, onIdle: () => password.syncCover() });
    let alive = true;

    function fail(error) {
      const e = normalizeError(error);
      mascot.wince();
      switch (e.code) {
        case "invalid_credentials":
          kit.notice.show("error", "Das Passwort stimmt nicht. Versuch es noch einmal.");
          password.input.value = "";
          password.update();
          password.input.focus();
          break;
        case "no_session":
          kit.notice.show("error", messageFor(e), [{ label: "Anmelden", run: () => ctx.go("signin", { email }) }]);
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
      if (!password.value) {
        password.error("Gib dein Passwort ein.");
        password.input.focus();
        mascot.wince();
        return;
      }
      kit.start("Schlüssel werden berechnet");
      try {
        await auth.unlock(password.value);
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
