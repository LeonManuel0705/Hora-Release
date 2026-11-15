// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { reducedMotion, sleep, focused } from "../dom.js";

const layer = (className, hidden = false) =>
  `<span class="${className}" data-face="blank"${hidden ? " hidden" : ""}><span class="tile-glyph"></span></span>`;

const tileMarkup = () =>
  `<span class="tile" aria-hidden="true">${layer("tile-half tile-top")}${layer("tile-half tile-bottom")}${layer("tile-flap tile-flap-top", true)}${layer("tile-flap tile-flap-bottom", true)}</span>`;

function paint(el, char, face) {
  el.dataset.face = face;
  el.firstElementChild.textContent = char;
}

class Tile {
  constructor(el) {
    this.el = el;
    [this.top, this.bottom, this.flapTop, this.flapBottom] = el.children;
    this.char = "";
    this.face = "blank";
    this.run = 0;
    el.dataset.empty = "";
  }

  show(char, face) {
    paint(this.top, char, face);
    paint(this.bottom, char, face);
    this.flapTop.hidden = true;
    this.flapBottom.hidden = true;
  }

  async set(char, face) {
    if (char === this.char && face === this.face) return;
    const before = { char: this.char, face: this.face };
    this.char = char;
    this.face = face;
    if (char) delete this.el.dataset.empty;
    else this.el.dataset.empty = "";
    const run = ++this.run;
    for (const animation of this.el.getAnimations({ subtree: true })) animation.cancel();
    if (reducedMotion()) {
      this.show(char, face);
      return;
    }
    paint(this.top, char, face);
    paint(this.bottom, before.char, before.face);
    paint(this.flapTop, before.char, before.face);
    paint(this.flapBottom, char, face);
    this.flapTop.hidden = false;
    this.flapBottom.hidden = true;
    const first = this.flapTop.animate([{ transform: "rotateX(0deg)" }, { transform: "rotateX(-90deg)" }], { duration: 70, easing: "ease-in", fill: "forwards" });
    try {
      await first.finished;
    } catch {
      return;
    }
    if (run !== this.run) return;
    this.flapTop.hidden = true;
    this.flapBottom.hidden = false;
    const second = this.flapBottom.animate([{ transform: "rotateX(90deg)" }, { transform: "rotateX(0deg)" }], { duration: 130, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.25)", fill: "forwards" });
    try {
      await second.finished;
    } catch {
      return;
    }
    if (run !== this.run) return;
    this.show(char, face);
  }
}

export function codeInputMarkup({ id = "code", label = "Sechsstelliger Code", describedBy = "" } = {}) {
  return `<div class="tiles" data-tiles>
    ${Array.from({ length: 6 }, tileMarkup).join("")}
    <input id="${id}" name="code" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" autocapitalize="none" autocorrect="off" spellcheck="false" aria-label="${label}"${describedBy ? ` aria-describedby="${describedBy}"` : ""}>
  </div>`;
}

export function mountCodeInput(root, { mascot, onComplete, onChange }) {
  const host = root.querySelector("[data-tiles]");
  const input = host.querySelector("input");
  const tiles = [...host.querySelectorAll(".tile")].map((el) => new Tile(el));
  let locked = false;
  let heldValue = "";
  let state = "idle";

  const digitsOf = (text) => {
    const all = text.replace(/\D/g, "");
    return host.classList.contains("is-error") && all.length > 6 ? all.slice(6, 12) : all.slice(0, 6);
  };

  function render(digits, { stagger = 0 } = {}) {
    tiles.forEach((tile, index) => {
      const char = digits[index] || "";
      const face = state === "ok" ? "ok" : char ? "digit" : "blank";
      if (stagger) setTimeout(() => tile.set(char, face), index * stagger);
      else tile.set(char, face);
    });
    markActive(digits.length);
  }

  function markActive(length) {
    const here = focused() === input;
    tiles.forEach((tile, index) => tile.el.classList.toggle("is-active", here && !locked && index === Math.min(length, 5) && state !== "ok"));
  }

  function toEnd() {
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }

  async function apply(raw) {
    const digits = digitsOf(raw);
    if (input.value !== digits) input.value = digits;
    host.classList.remove("is-error");
    render(digits);
    mascot.type("code", digits.length);
    onChange?.(digits);
    if (digits.length === 6) {
      if (!reducedMotion()) await sleep(260);
      if (input.value === digits && !locked) onComplete?.(digits);
    }
  }

  input.addEventListener("input", () => {
    if (locked) {
      input.value = heldValue;
      return;
    }
    apply(input.value);
  });
  input.addEventListener("focus", () => {
    mascot.look(0, 0.9);
    markActive(input.value.length);
    toEnd();
  });
  input.addEventListener("blur", () => {
    mascot.look(0, 0);
    markActive(input.value.length);
  });
  input.addEventListener("click", toEnd);
  input.addEventListener("select", toEnd);

  return {
    input,
    get value() {
      return input.value;
    },
    setValue(code) {
      input.value = "";
      return apply(code);
    },
    focus: () => input.focus({ preventScroll: true }),
    lock(on) {
      locked = on;
      heldValue = input.value;
      markActive(input.value.length);
    },
    clear() {
      state = "idle";
      input.value = "";
      host.classList.remove("is-error");
      render("", { stagger: 28 });
    },
    error() {
      host.classList.add("is-error", "is-shaking");
      setTimeout(() => host.classList.remove("is-shaking"), 460);
    },
    ok() {
      state = "ok";
      render(input.value, { stagger: 45 });
    },
  };
}
