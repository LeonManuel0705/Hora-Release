// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "../icons.js";
import { esc, sleep, reducedMotion, finePointer } from "../dom.js";
import { pending } from "../flow.js";
import { messageFor, normalizeError, formatDuration } from "../messages.js";
import { codeInputMarkup, mountCodeInput } from "../ui/code-input.js";
import { slotMarkup, createNotice } from "../ui/notice.js";
import { resendMarkup, mountResend } from "../ui/resend.js";

const lede = (email, expiresAt) =>
  `Wir haben einen Code an <strong>${esc(email)}</strong> geschickt. Er gilt noch ${formatDuration(Math.max(30, Math.round((expiresAt - Date.now()) / 1000)))}.`;

export default {
  id: "code",
  title: "Code eingeben",
  panel: () => ({
    sub: "Gib den Code aus deinem Postfach ein.",
    link: null,
    scene: { stage: 2 },
  }),

  guard() {
    const state = pending.read();
    if (!state || state.purpose !== "signup") return { id: "create" };
    return null;
  },

  render() {
    const state = pending.read();
    return {
      html: `
        <div class="sheet-top">
          <button class="back" type="button" data-go="create" data-email="${esc(state.email)}">${icon("chevron-left", { size: 20 })}Adresse ändern</button>
        </div>
        <div class="head">
          <h1 class="title" tabindex="-1">Code eingeben</h1>
          <p class="lede" id="code-lede" data-lede>${lede(state.email, state.expiresAt)}</p>
        </div>
        <div class="code-area">
          ${codeInputMarkup({ describedBy: "code-lede code-status" })}
          <p class="code-status" id="code-status" aria-live="polite" data-status></p>
        </div>
        ${slotMarkup()}
        ${resendMarkup()}`,
      focus: "#code",
    };
  },

  mount(root, ctx, params) {
    const { mascot, auth } = ctx;
    const state = pending.read();
    const email = state.email;
    const statusEl = root.querySelector("[data-status]");
    const ledeEl = root.querySelector("[data-lede]");
    const notice = createNotice(root);
    let verifying = false;
    let expireTimer = 0;
    let alive = true;

    mascot.hold("mail");

    const status = (text, kind = "", busy = false) => {
      statusEl.className = `code-status${kind ? ` is-${kind}` : ""}`;
      statusEl.innerHTML = busy ? `${icon("loader-circle", { size: 18, className: "spinner" })}<span>${esc(text)}</span>` : esc(text);
    };

    const code = mountCodeInput(root, {
      mascot,
      onChange(digits) {
        if (digits.length && statusEl.classList.contains("is-error")) status("");
        notice.hide();
      },
      onComplete: verify,
    });

    function scheduleExpiry(at) {
      clearTimeout(expireTimer);
      const wait = Math.max(0, at - Date.now());
      expireTimer = setTimeout(() => {
        if (!alive) return;
        ledeEl.innerHTML = `Wir haben einen Code an <strong>${esc(email)}</strong> geschickt. Er ist abgelaufen.`;
        status("Der Code ist abgelaufen. Hol dir einen neuen.", "error");
        resend.highlight();
      }, wait);
    }

    async function sendAgain() {
      try {
        const result = await auth.resendCode(email);
        const next = pending.write({ email, purpose: "signup", resendAfter: result?.resendAfter, expiresIn: result?.expiresIn });
        resend.restart(next.resendAt);
        scheduleExpiry(next.expiresAt);
        ledeEl.innerHTML = lede(email, next.expiresAt);
        notice.hide();
        code.clear();
        status("Ein neuer Code ist unterwegs.", "ok");
        if (finePointer()) code.focus();
      } catch (error) {
        const e = normalizeError(error);
        if (e.code === "rate_limited") {
          resend.restart(Date.now() + (e.retryAfter ?? 30) * 1000);
          status("Bitte warte noch kurz, bevor du einen neuen Code anforderst.", "error");
        } else {
          notice.show("error", messageFor(e));
        }
      }
    }

    const resend = mountResend(root, { until: state.resendAt, send: sendAgain });
    scheduleExpiry(state.expiresAt);

    async function verify(value) {
      if (verifying) return;
      verifying = true;
      code.lock(true);
      notice.hide();
      status("Code wird geprüft", "", true);
      try {
        const result = await auth.verifyEmail(email, value);
        code.ok();
        status("Bestätigt.", "ok");
        pending.clear();
        ctx.setSession(result.account);
        await sleep(reducedMotion() ? 120 : 620);
        if (alive) ctx.go("success");
      } catch (error) {
        verifying = false;
        code.lock(false);
        const e = normalizeError(error);
        mascot.wince();
        code.error();
        if (e.code === "network" || e.code === "server") {
          status("");
          notice.show("error", messageFor(e), [{ label: "Erneut versuchen", run: () => verify(value) }]);
          return;
        }
        status(messageFor(e), "error");
        if (e.code === "code_expired" || e.code === "too_many_attempts") resend.highlight();
        setTimeout(() => {
          if (!alive || code.value !== value) return;
          code.clear();
          if (finePointer()) code.focus();
        }, reducedMotion() ? 200 : 700);
      }
    }

    if (params.unverified) notice.show("mail", messageFor("email_not_verified"), [], { strong: "Wir haben dir einen neuen Code geschickt." });
    setTimeout(() => code.focus(), 120);

    return () => {
      alive = false;
      clearTimeout(expireTimer);
      resend.destroy();
    };
  },
};
