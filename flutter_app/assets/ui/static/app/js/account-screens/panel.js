// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { timeOfDay } from "./scene.js";
import { view } from "./dom.js";

export const PHONE = "(max-width: 599px)";
export const STACKED = `${PHONE}, (orientation: portrait)`;

export const isPhone = () => matchMedia(PHONE).matches;
export const isVertical = () => matchMedia(STACKED).matches;

function sceneModel(spec) {
  const now = new Date();
  return {
    time: timeOfDay(now),
    minute: now.getHours() * 60 + now.getMinutes(),
    stage: spec.scene?.stage ?? 1,
    done: Boolean(spec.scene?.done),
  };
}

export function createPanel({ frame, scene }) {
  let spec = { scene: {} };
  const layout = () => (isVertical() ? "wide" : "tall");

  matchMedia(STACKED).addEventListener("change", () => scene.setLayout(layout(), sceneModel(spec)), { signal: view.signal });

  return {
    get spec() {
      return spec;
    },

    apply(next, options = {}) {
      const first = !frame.querySelector(".scene-art svg");
      spec = next;
      const model = sceneModel(next);
      if (first) scene.setLayout(layout(), model);
      else scene.render(model, options);
    },
  };
}
