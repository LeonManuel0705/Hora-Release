// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "../icons.js";
import { esc, focused } from "../dom.js";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailFieldMarkup({ id = "email", value = "", label = "E-Mail-Adresse" } = {}) {
  return `<div class="field" data-field="email">
    <label class="field-label" for="${id}">${esc(label)}</label>
    <div class="control">
      ${icon("mail", { size: 20 })}
      <input id="${id}" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="name@beispiel.de" value="${esc(value)}" aria-describedby="${id}-message" required>
    </div>
    <p class="field-message" id="${id}-message" aria-live="polite"></p>
  </div>`;
}

export function passwordFieldMarkup({ id = "password", label = "Passwort", autocomplete = "current-password", meter = false } = {}) {
  const describedBy = meter ? `${id}-message ${id}-meter` : `${id}-message`;
  return `<div class="field" data-field="password">
    <label class="field-label" for="${id}">${esc(label)}</label>
    <div class="control">
      ${icon("lock", { size: 20 })}
      <input id="${id}" name="password" type="password" autocomplete="${autocomplete}" autocapitalize="none" autocorrect="off" spellcheck="false" aria-describedby="${describedBy}" required>
      <button type="button" class="control-button" data-toggle aria-label="Passwort anzeigen" aria-pressed="false" aria-controls="${id}">${icon("eye", { size: 20 })}</button>
    </div>
    <p class="field-message" id="${id}-message" aria-live="polite"></p>
    ${meter ? `<div class="meter" id="${id}-meter" data-tone="idle"><div class="meter-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></div><p class="meter-text" data-meter-text>Mindestens 10 Zeichen</p><p class="visually-hidden" aria-live="polite" data-meter-live></p></div>` : ""}
  </div>`;
}

export function seedOf(text) {
  let hash = 0x811c9dc5;
  for (const char of text) hash = Math.imul(hash ^ char.codePointAt(0), 0x01000193);
  return hash >>> 0;
}

function setError(field, message) {
  const control = field.querySelector(".control");
  const input = field.querySelector("input");
  const text = field.querySelector(".field-message");
  control.classList.toggle("has-error", Boolean(message));
  if (message) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
  text.classList.toggle("is-error", Boolean(message));
  text.textContent = message || "";
}

export function mountEmailField(root, { mascot, onInput }) {
  const field = root.querySelector('[data-field="email"]');
  const input = field.querySelector("input");

  input.addEventListener("focus", () => mascot.look(0, 0.9));
  input.addEventListener("blur", () => mascot.look(0, 0));
  input.addEventListener("input", () => {
    const along = Math.min(1, input.value.length / 24);
    mascot.look(along * 1.6 - 0.8, 0.9);
    mascot.type("email", input.value.length, seedOf(input.value.trim().toLowerCase()));
    if (input.getAttribute("aria-invalid")) setError(field, "");
    onInput?.();
  });

  return {
    input,
    get value() {
      return input.value.trim();
    },
    valid: () => EMAIL_PATTERN.test(input.value.trim()),
    error: (message) => setError(field, message),
    clearError: () => setError(field, ""),
  };
}

const STRENGTH = { 2: "Geht so. Drei Wörter wären sicherer.", 3: "Gut", 4: "Stark" };

const PATTERNS = [
  ["contains_email", "Das enthält deine E-Mail-Adresse. Nimm etwas anderes."],
  ["too_common", "Dieses Passwort benutzen viele. Nimm ein eigenes."],
  ["common_word", "Ein bekanntes Wort mit Zahlen ist schnell erraten. Nimm mehrere Wörter."],
  ["sequence", "Folgen wie 12345 oder qwertz sind schnell erraten."],
  ["repeated", "Das wiederholt sich zu sehr und ist leicht zu erraten."],
  ["no_letters", "Nur Ziffern sind schnell erraten. Nimm Wörter dazu."],
];

function describeStrength({ score, acceptable, problems }, value) {
  if (!value) return { level: 0, tone: "idle", text: "Mindestens 10 Zeichen", fix: "Gib ein Passwort mit mindestens 10 Zeichen ein.", key: "empty" };
  if (acceptable) {
    const level = Math.min(4, Math.max(2, score));
    return { level, tone: "ok", text: STRENGTH[level], fix: "", key: `ok${level}` };
  }
  const pattern = value.length >= 8 && PATTERNS.find(([code]) => problems.includes(code));
  if (pattern) return { level: 1, tone: "bad", text: pattern[1], fix: pattern[1], key: pattern[0] };
  const missing = Math.max(1, 10 - value.length);
  return {
    level: value.length >= 6 ? 1 : 0,
    tone: "idle",
    text: `Noch ${missing} Zeichen`,
    fix: `Das Passwort braucht mindestens 10 Zeichen, dir fehlen noch ${missing}.`,
    key: "short",
  };
}

export function mountPasswordField(root, { mascot, auth, getEmail = () => "", onChange }) {
  const field = root.querySelector('[data-field="password"]');
  const input = field.querySelector("input");
  const toggle = field.querySelector("[data-toggle]");
  const meter = field.querySelector(".meter");
  const bars = meter ? [...meter.querySelectorAll(".meter-bars i")] : [];
  const meterText = meter?.querySelector("[data-meter-text]");
  const meterLive = meter?.querySelector("[data-meter-live]");
  let visible = false;
  let lastKey = "empty";
  let liveTimer = 0;

  const syncCover = () => mascot.cover(focused() === input && !visible);

  input.addEventListener("focus", () => {
    mascot.look(0, 0);
    syncCover();
  });
  input.addEventListener("blur", () => mascot.cover(false));
  toggle.addEventListener("mousedown", (event) => event.preventDefault());
  toggle.addEventListener("click", () => {
    visible = !visible;
    input.type = visible ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(visible));
    toggle.setAttribute("aria-label", visible ? "Passwort verbergen" : "Passwort anzeigen");
    toggle.innerHTML = icon(visible ? "eye-off" : "eye", { size: 20 });
    input.focus();
    syncCover();
  });

  function check() {
    return auth.checkPassword(input.value, getEmail());
  }

  function update() {
    if (!meter) return;
    const state = describeStrength(check(), input.value);
    bars.forEach((bar, index) => bar.classList.toggle("on", index < state.level));
    meter.dataset.tone = state.tone;
    meterText.textContent = state.text;
    if (state.key !== lastKey) {
      lastKey = state.key;
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => {
        meterLive.textContent = state.tone === "idle" ? "" : state.text;
      }, 700);
    }
  }

  input.addEventListener("input", () => {
    mascot.type("password", input.value.length);
    if (input.getAttribute("aria-invalid")) setError(field, "");
    update();
    onChange?.();
  });

  return {
    input,
    check,
    update,
    get value() {
      return input.value;
    },
    acceptable: () => check().acceptable,
    explain: () => describeStrength(check(), input.value).fix,
    syncCover,
    error: (message) => setError(field, message),
    clearError: () => setError(field, ""),
    destroy: () => clearTimeout(liveTimer),
  };
}
