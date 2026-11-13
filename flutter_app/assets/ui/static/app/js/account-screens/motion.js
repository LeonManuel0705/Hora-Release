// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { isVertical } from "./panel.js";
import { reducedMotion } from "./dom.js";
import { play, spring, done, timer, SETTLE } from "./anim.js";

const DROP = "cubic-bezier(0.55, 0, 0.85, 0.36)";

const rowsOf = (layer) =>
  [...layer.children]
    .flatMap((element) => (element.tagName === "FORM" || element.classList.contains("head") ? [...element.children] : [element]))
    .filter((element) => element.getClientRects().length);

const stageOf = (spec) => `${spec.scene?.stage ?? 1}:${Boolean(spec.scene?.done)}`;

const SINK = [
  { opacity: 1, transform: "none" },
  { opacity: 1, transform: "scale(1.06) translateY(10px)", offset: 0.5 },
  { opacity: 0, transform: "scale(1.1) translateY(26px)" },
];

export function createMotion({ app, hero, sheet, topbar, sheetMotion, look, mascot, panel, scene }) {
  let active = null;

  function begin() {
    finish();
    const run = {
      core: [],
      cleanups: [],
      outgoing: null,
      end() {
        for (const animation of run.core) animation.cancel();
        for (const cleanup of run.cleanups) cleanup();
        run.outgoing?.remove();
      },
    };
    active = run;
    return run;
  }

  function settleWhenDone(run) {
    Promise.all(run.core.map((animation) => animation.finished.catch(() => {}))).then(() => {
      if (active === run) {
        active = null;
        run.end();
      }
    });
  }

  function finish() {
    if (!active) return;
    const run = active;
    active = null;
    run.end();
  }

  const track = (run) => (animation) => {
    if (animation) run.core.push(animation);
  };

  const away = (on) => app.toggleAttribute("data-away", on);

  function hush(run) {
    sheetMotion.quiet(true);
    run.cleanups.push(() => sheetMotion.quiet(false));
  }

  function arrive() {
    app.setAttribute("data-arriving", "");
    mascot.preview("arrive", 0, { fallFrom: mascot.fallStart() });
    mascot.arrive().then((landed) => {
      if (landed) setTimeout(() => app.removeAttribute("data-arriving"), 700);
    });
  }

  function below(percent) {
    const gap = parseFloat(getComputedStyle(sheet).bottom) || 0;
    return gap ? `calc(${percent}% + ${gap}px)` : `${percent}%`;
  }

  function sheetIn(push, delay) {
    if (isVertical()) {
      push(play(sheet, [{ transform: `translateY(${below(105)})` }, { transform: "translateY(0px)" }], { duration: 640, delay, easing: spring(), fill: "backwards" }));
      return;
    }
    push(play(sheet, [{ transform: "translateY(84px)" }, { transform: "translateY(0px)" }], { duration: 720, delay, easing: spring(), fill: "backwards" }));
    push(play(sheet, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay, easing: "ease-out", fill: "backwards" }));
  }

  function sheetOut(push) {
    if (isVertical()) {
      push(play(sheet, [{ transform: "translateY(0px)" }, { transform: `translateY(${below(108)})` }], { duration: 430, delay: 110, easing: DROP, fill: "forwards" }));
      return;
    }
    push(play(sheet, [{ transform: "translateY(0px)" }, { transform: "translateY(64px)" }], { duration: 400, delay: 110, easing: DROP, fill: "forwards" }));
    push(play(sheet, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 170, easing: "ease-in", fill: "forwards" }));
  }

  function rise({ spec, incoming, arrival }) {
    const run = begin();
    const push = track(run);
    const back = false;
    const delay = 0;
    away(false);
    look.setStep("auth");
    hush(run);
    panel.apply(spec, { animate: false });
    if (reducedMotion()) {
      [hero, topbar, sheet].forEach((node) => push(play(node, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay, easing: "ease-out", fill: "backwards" })));
      settleWhenDone(run);
      return;
    }
    push(play(hero, [{ opacity: 0, transform: "scale(0.9) translateY(16px)" }, { opacity: 1, transform: "none" }], { duration: back ? 620 : 760, delay: delay + 40, easing: SETTLE, fill: "backwards" }));
    push(play(topbar, [{ opacity: 0, transform: "translateX(-12px)" }, { opacity: 1, transform: "none" }], { duration: 520, delay: delay + 300, easing: SETTLE, fill: "backwards" }));
    sheetIn(push, delay + 60);
    rowsOf(incoming).forEach((row, index) => {
      push(play(row, [{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "none" }], { duration: 460, delay: delay + 230 + index * 60, easing: SETTLE, fill: "backwards" }));
    });
    if (back) {
      mascot.reset();
      push(mascot.enter(delay + 380));
    } else {
      scene.assemble({ delay: 120, stagger: 52, first: scene.first, track: push });
      arrive();
    }
    mascot.talk(560, arrival ? 2400 : delay + 1300).forEach(push);
    settleWhenDone(run);
  }

  function swap({ spec, outgoing, incoming, direction }) {
    const run = begin();
    run.outgoing = outgoing;
    const push = track(run);
    const moved = stageOf(spec) !== stageOf(panel.spec);
    panel.apply(spec, { animate: true, track: push, cleanup: (fn) => run.cleanups.push(fn) });
    const dx = 36 * direction;
    push(play(outgoing, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-dx}px)` }], { duration: 170, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }));
    push(play(incoming, [{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: "none" }], { duration: 400, delay: 120, easing: SETTLE, fill: "backwards" }));
    if (moved) scene.drift({ axis: "x", direction, delay: 40, duration: 720, track: push });
    mascot.talk(560, 200).forEach(push);
    settleWhenDone(run);
  }

  function fade({ spec, outgoing, incoming }) {
    const run = begin();
    outgoing?.remove();
    panel.apply(spec, { animate: false });
    run.core.push(incoming.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: "ease-out" }));
    settleWhenDone(run);
  }

  // Closing returns to the page it came from: after an account was opened Luna celebrates first, then the sheet drops,
  // the hero sinks and the bar fades.
  async function leave({ spec, layer, celebrate }) {
    const run = begin();
    const push = track(run);
    const calm = reducedMotion();
    const pause = (ms) => {
      const wait = timer(ms);
      run.core.push(wait);
      return done(wait);
    };
    hush(run);
    if (celebrate && stageOf(spec) !== stageOf(panel.spec)) {
      panel.apply(spec, { animate: true, track: push, cleanup: (fn) => run.cleanups.push(fn) });
      mascot.hold(null);
      mascot.celebrate();
      if (!(await pause(calm ? 500 : 1150))) return false;
    }
    push(play(layer, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(10px)" }], { duration: 170, easing: "ease-in", fill: "forwards" }));
    if (calm) push(play(sheet, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, delay: 80, fill: "forwards" }));
    else sheetOut(push);
    push(play(hero, calm ? [{ opacity: 1 }, { opacity: 0 }] : SINK, { duration: calm ? 240 : 980, delay: calm ? 60 : 160, easing: "cubic-bezier(0.45, 0, 0.55, 1)", fill: "forwards" }));
    push(play(topbar, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: 120, easing: "ease-in", fill: "forwards" }));
    look.setStep("away");
    return pause(calm ? 260 : 760);
  }

  return { rise, swap, fade, leave, finish };
}
