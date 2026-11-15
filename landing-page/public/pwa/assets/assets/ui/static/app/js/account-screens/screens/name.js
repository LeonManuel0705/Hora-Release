// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { nameFormMarkup, mountNameForm } from "../ui/name-field.js";

// After going on without an account, Luna asks once for the first name.
export default {
  id: "name",
  title: "Wie soll ich dich nennen?",

  panel: () => ({
    link: null,
    scene: { stage: 1 },
  }),

  render() {
    return {
      html: `
        <div class="head">
          <h1 class="title luna-line" tabindex="-1">Wie soll ich dich nennen?</h1>
          <p class="lede">Dein Vorname bleibt auf diesem Gerät.</p>
        </div>
        ${nameFormMarkup()}`,
      focus: "#given-name",
    };
  },

  mount(root, ctx) {
    ctx.mascot.hold(null);
    const wave = setTimeout(() => ctx.mascot.wave(), 380);
    const stop = mountNameForm(root, ctx, () => ctx.close({ guest: true }));
    return () => {
      clearTimeout(wave);
      stop();
    };
  },
};
