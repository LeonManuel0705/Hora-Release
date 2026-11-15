// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "../icons.js";
import { esc } from "../dom.js";
import { BRAND } from "../../core.js";
import { nameFormMarkup, mountNameForm } from "../ui/name-field.js";

export default {
  id: "success",
  title: "Konto bereit",
  guard: (ctx) => (ctx.session ? null : { id: "signin" }),
  final: true,

  panel: () => ({
    sub: `Geschafft! Drück auf Weiter zu ${BRAND}.`,
    link: null,
    scene: { stage: 3, done: true },
  }),

  render(ctx) {
    const asking = !ctx.profile.name();
    return {
      html: `
        <div class="head">
          <h1 class="title" tabindex="-1">Dein Konto ist bereit.</h1>
          <p class="lede">Angemeldet als <strong>${esc(ctx.session.email)}</strong>.</p>
        </div>
        ${asking ? nameFormMarkup({ label: "Wie soll ich dich nennen?", placeholder: "Vorname" }) : `<div class="actions">
          <button class="btn btn-primary btn-block" type="button" data-continue>Weiter zu ${esc(BRAND)} ${icon("arrow-right", { size: 20, className: "icon-nudge" })}</button>
        </div>`}`,
      focus: asking ? "#given-name" : "[data-continue]",
    };
  },

  mount(root, ctx) {
    ctx.mascot.hold(null);
    ctx.mascot.celebrate();
    const opened = () => ctx.close({ opened: true });
    const stop = root.querySelector("[data-name-form]") ? mountNameForm(root, ctx, opened) : null;
    if (!stop) root.querySelector("[data-continue]").addEventListener("click", opened);
    return () => {
      stop?.();
      ctx.mascot.reset();
    };
  },
};
