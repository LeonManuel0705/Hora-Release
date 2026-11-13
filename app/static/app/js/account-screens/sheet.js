// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { PHONE, isPhone } from "./panel.js";
import { reducedMotion, view } from "./dom.js";
import { play, spring } from "./anim.js";

const ROWS = ".sheet-top, .head > *, .form > *, .code-area > *, .layer > .slot, .resend, .view-switch, .view-guest";

export function createSheet(sheet, { onTop } = {}) {
  const body = sheet.querySelector(".layers");
  let moving = [];
  let top = null;
  let height = null;
  let quiet = false;

  const shift = () => new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42;

  function natural() {
    const style = getComputedStyle(sheet);
    return body.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  }

  function stop() {
    moving.forEach((animation) => animation.cancel());
    moving = [];
  }

  function note() {
    top = sheet.offsetTop;
    height = natural();
    onTop?.(top);
  }

  function glide(from) {
    top = sheet.offsetTop;
    onTop?.(top);
    const delta = from - top;
    if (Math.abs(delta) < 1 || reducedMotion()) return;
    moving = [play(sheet, [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0px)" }], { duration: 560, easing: spring() })];
  }

  function grow(from) {
    height = sheet.offsetHeight;
    onTop?.(sheet.offsetTop);
    if (Math.abs(from.height - height) < 1 || reducedMotion()) return;
    const timing = { duration: 560, easing: spring() };
    moving = [play(sheet, [{ height: `${from.height}px` }, { height: `${height}px` }], timing)];
    const delta = from.top - sheet.getBoundingClientRect().top;
    if (Math.abs(delta) >= 1) moving.push(play(sheet, [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0px)" }], timing));
  }

  function resize(change) {
    if (quiet) {
      change();
      note();
      return;
    }
    if (isPhone()) {
      const from = sheet.offsetTop + shift();
      stop();
      change();
      glide(from);
      return;
    }
    const from = sheet.getBoundingClientRect();
    stop();
    change();
    grow(from);
  }

  const edge = new ResizeObserver(() => {
    if (quiet || top === null) {
      top = sheet.offsetTop;
      onTop?.(top);
      return;
    }
    if (Math.abs(sheet.offsetTop - top) < 1) return;
    const from = top + (moving.length ? shift() : 0);
    stop();
    glide(from);
  });

  const float = new ResizeObserver(() => {
    if (quiet || height === null) {
      height = natural();
      return;
    }
    if (Math.abs(natural() - height) < 1) return;
    const from = sheet.getBoundingClientRect();
    stop();
    grow(from);
  });

  function watch() {
    edge.disconnect();
    float.disconnect();
    stop();
    top = null;
    height = null;
    if (isPhone()) edge.observe(sheet);
    else float.observe(body);
  }

  matchMedia(PHONE).addEventListener("change", watch, { signal: view.signal });
  view.signal?.addEventListener("abort", () => {
    edge.disconnect();
    float.disconnect();
    stop();
  });
  watch();

  return {
    resize,

    quiet(on) {
      quiet = on;
      if (on) stop();
      note();
    },

    relayout(change) {
      const layer = sheet.querySelector(".layer:not(.is-outgoing)");
      if (!layer || reducedMotion()) {
        resize(change);
        return;
      }
      const items = [...layer.querySelectorAll(ROWS)];
      const before = new Map(items.map((item) => [item, { top: item.offsetTop, height: item.offsetHeight, shown: item.offsetParent !== null }]));
      resize(change);
      items.forEach((item) => {
        const was = before.get(item);
        if (item.offsetParent === null) return;
        if (!was.shown) {
          play(item, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 160, easing: "ease-out", fill: "backwards" });
          return;
        }
        const dy = was.top - item.offsetTop;
        const ratio = item.classList.contains("title") && item.offsetHeight ? was.height / item.offsetHeight : 1;
        if (Math.abs(dy) < 0.5 && Math.abs(ratio - 1) < 0.01) return;
        play(item, [{ transform: `translateY(${dy}px) scale(${ratio})` }, { transform: "none" }], { duration: 560, easing: spring() });
      });
    },
  };
}
