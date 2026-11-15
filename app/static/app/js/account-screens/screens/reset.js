// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "../icons.js";
import { esc, sleep, reducedMotion, finePointer } from "../dom.js";
import { pending } from "../flow.js";
import { messageFor, normalizeError } from "../messages.js";
import { codeInputMarkup, mountCodeInput } from "../ui/code-input.js";
import { passwordFieldMarkup, mountPasswordField } from "../ui/fields.js";
import { slotMarkup } from "../ui/notice.js";
import { resendMarkup, mountResend } from "../ui/resend.js";
import { createFormKit } from "../ui/form-kit.js";

const lede = (email) => `Wenn zu <strong>${esc(email)}</strong> ein Konto gehört, haben wir einen Code geschickt. Schau auch im Spam-Ordner nach.`;

export default {
  id: "reset",
  title: "Neues Passwort",
  panel: () => ({
    sub: "Gib den Code und ein neues Passwort ein.",
    link: null,
    scene: { stage: 2 },
  }),

  guard() {
    const state = pending.read();
    if (!state || state.purpose !== "reset") return { id: "forgot" };
    return null;
  },

  render() {
    const state = pending.read();
    return {
      html: `
        <div class="sheet-top">
          <button class="back" type="button" data-go="forgot" data-email="${esc(state.email)}">${icon("chevron-left", { size: 20 })}Adresse ändern</button>
        </div>
        <div class="head">
          <h1 class="title" tabindex="-1">Neues Passwort festlegen</h1>
          <p class="lede" id="code-lede" data-lede>${lede(state.email)}</p>
        </div>
        <form class="form" novalidate>
          <div class="field">
            <div class="code-area">
              ${codeInputMarkup({ label: "Sechsstelliger Code aus der Mail", describedBy: "code-lede code-status" })}
              <p class="code-status" id="code-status" aria-live="polite" data-status></p>
            </div>
          </div>
          ${passwordFieldMarkup({ id: "password", label: "Neues Passwort", autocomplete: "new-password", meter: true })}
          ${slotMarkup()}
          <button class="btn btn-primary btn-block" type="submit">Passwort speichern ${icon("arrow-right", { size: 20, className: "icon-nudge" })}</button>
        </form>
        ${resendMarkup("Keinen Code bekommen?")}`,
      focus: "#code",
    };
  },

  mount(root, ctx) {
    const { mascot, auth } = ctx;
    const state = pending.read();
    const email = state.email;
    const form = root.querySelector("form");
    const statusEl = root.querySelector("[data-status]");
    let expireTimer = 0;
    let alive = true;

    mascot.hold("mail");

    const status = (text, kind = "") => {
      statusEl.className = `code-status${kind ? ` is-${kind}` : ""}`;
      statusEl.textContent = text;
    };

    const password = mountPasswordField(root, { mascot, auth, getEmail: () => email });
    const kit = createFormKit(root, ctx, { form, onIdle: () => password.syncCover() });
    const code = mountCodeInput(root, {
      mascot,
      onChange(digits) {
        if (digits.length && statusEl.classList.contains("is-error")) status("");
      },
      onComplete() {
        password.input.focus();
      },
    });

    function scheduleExpiry(at) {
      clearTimeout(expireTimer);
      expireTimer = setTimeout(() => {
        if (!alive) return;
        status("Der Code ist abgelaufen. Hol dir einen neuen.", "error");
        resend.highlight();
      }, Math.max(0, at - Date.now()));
    }

    async function sendAgain() {
      try {
        const result = await auth.requestPasswordReset(email);
        const next = pending.write({ email, purpose: "reset", resendAfter: result?.resendAfter, expiresIn: result?.expiresIn });
        resend.restart(next.resendAt);
        scheduleExpiry(next.expiresAt);
        kit.notice.hide();
        code.clear();
        status("Ein neuer Code ist unterwegs.", "ok");
        if (finePointer()) code.focus();
      } catch (error) {
        const e = normalizeError(error);
        if (e.code === "rate_limited") {
          resend.restart(Date.now() + (e.retryAfter ?? 30) * 1000);
          status("Bitte warte noch kurz, bevor du einen neuen Code anforderst.", "error");
        } else {
          kit.notice.show("error", messageFor(e));
        }
      }
    }

    const resend = mountResend(root, { until: state.resendAt, send: sendAgain });
    scheduleExpiry(state.expiresAt);

    function fail(error, failedCode) {
      const e = normalizeError(error);
      mascot.wince();
      switch (e.code) {
        case "invalid_code":
        case "code_expired":
        case "too_many_attempts":
          code.error();
          status(messageFor(e), "error");
          if (e.code !== "invalid_code") resend.highlight();
          setTimeout(() => {
            if (!alive || code.value !== failedCode) return;
            code.clear();
            code.focus();
          }, reducedMotion() ? 200 : 700);
          break;
        case "weak_password":
          password.error(messageFor(e));
          password.input.focus();
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
      if (code.value.length < 6) {
        status("Gib zuerst den sechsstelligen Code aus der Mail ein.", "error");
        code.focus();
        mascot.wince();
        return;
      }
      if (!password.acceptable()) {
        password.error(password.explain());
        password.input.focus();
        mascot.wince();
        return;
      }
      const submitted = code.value;
      kit.start("Passwort wird gesetzt");
      try {
        const result = await auth.resetPassword(email, submitted, password.value);
        pending.clear();
        ctx.setSession(result.account);
        if (!alive) return;
        kit.succeed();
        await sleep(240);
        if (!alive) return;
        ctx.close({ opened: true, note: "Neues Passwort gesetzt. Du bist angemeldet." });
      } catch (error) {
        if (!alive) return;
        kit.finish();
        fail(error, submitted);
      }
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });

    setTimeout(() => code.focus(), 120);

    return () => {
      alive = false;
      clearTimeout(expireTimer);
      resend.destroy();
      password.destroy();
      kit.destroy();
      mascot.cover(false);
    };
  },
};
