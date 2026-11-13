// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export const SETTLE = "cubic-bezier(0.16, 1, 0.3, 1)";
const GLIDE = "cubic-bezier(0.22, 1, 0.36, 1)";
const SPRING = "linear(0, 0.0014 0.7%, 0.0068 1.5%, 0.0139 2.2%, 0.0258 3%, 0.0407 3.8%, 0.0582 4.7%, 0.0781 5.5%, 0.1047 6.5%, 0.1489 8%, 0.2083 9.8%, 0.2713 11.7%, 0.4529 16.8%, 0.5093 18.5%, 0.558 20%, 0.6096 21.7%, 0.6582 23.3%, 0.7034 25%, 0.7412 26.5%, 0.7762 28%, 0.8084 29.5%, 0.8378 31%, 0.8673 32.7%, 0.8911 34.2%, 0.9146 35.8%, 0.9352 37.5%, 0.953 39.2%, 0.97 41%, 0.984 42.8%, 0.9956 44.7%, 1.0058 46.7%, 1.0136 48.7%, 1.0198 50.8%, 1.0272 55.7%, 1.0284 59.3%, 1.0269 63.5%, 1.0083 84.2%, 1)";

const linear = (() => {
  try {
    return CSS.supports("transition-timing-function", "linear(0, 1)");
  } catch {
    return false;
  }
})();

export const spring = () => (linear ? SPRING : GLIDE);

export const play = (element, frames, options) => (element ? element.animate(frames, options) : null);

export const done = (animation) => (animation ? animation.finished.then(() => true, () => false) : Promise.resolve(true));

export function timer(ms) {
  const animation = new Animation(new KeyframeEffect(null, [], Math.max(0, ms)), document.timeline);
  animation.play();
  return animation;
}
