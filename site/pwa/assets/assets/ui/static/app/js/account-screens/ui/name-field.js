// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "../icons.js";
import { esc } from "../dom.js";

// Luna asks for the first name: an optional field, Weiter and a quiet Überspringen.
export function nameFormMarkup({ label = "Vorname", placeholder = "", submit = "Weiter" } = {}) {
  return `
    <form class="form" data-name-form novalidate autocomplete="off">
      <div class="field" data-field="name">
        <label class="field-label" for="given-name">${esc(label)}</label>
        <div class="control">
          ${icon("user", { size: 20 })}
          <input id="given-name" name="given-name" type="text" maxlength="40" autocomplete="given-name" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="done"${placeholder ? ` placeholder="${esc(placeholder)}"` : ""}>
        </div>
      </div>
      <button class="btn btn-primary btn-block" type="submit" data-continue>${esc(submit)} ${icon("arrow-right", { size: 20, className: "icon-nudge" })}</button>
    </form>
    <p class="view-switch"><button class="link" type="button" data-skip>Überspringen</button></p>`;
}

export function mountNameForm(root, ctx, done) {
  const form = root.querySelector("[data-name-form]");
  const input = form.querySelector("input");
  let answered = false;
  const answer = (value) => {
    if (answered) return;
    answered = true;
    ctx.profile.answer(value);
    done();
  };
  input.addEventListener("focus", () => ctx.mascot.look(0, 0.9));
  input.addEventListener("blur", () => ctx.mascot.look(0, 0));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    answer(input.value);
  });
  root.querySelector("[data-skip]").addEventListener("click", () => answer(""));
  return () => {
    if (answered) return;
    answered = true;
    ctx.profile.answer("");
  };
}
