// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
  POSES,
  LEG_WIDTHS,
  HAND_WIDTHS,
  COVER_HAND_WIDTHS,
  LEG_SIDES,
  SEAT,
  FX_Y,
  frame,
  outline,
  suckers,
  tip,
  lerp,
  lerpPose,
  clamp01,
  ease,
} from "./geometry.js";
import { characterMarkup } from "./art.js";
import { TIMELINES } from "./timelines.js";
import { reducedMotion } from "../dom.js";

const NAMES = ["g1", "g2", "g3", "g4", "hl", "hr"];
const HANDS = ["hl", "hr"];
const clonePose = (pose) => Object.fromEntries(Object.entries(pose).map(([name, points]) => [name, points.map((p) => [p[0], p[1]])]));
const px = (value) => `${value.toFixed(2)}px`;

export function motionAllowed() {
  return !reducedMotion();
}

export class Mascot {
  constructor(host) {
    this.host = host;
    host.innerHTML = `<svg class="m-svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false" data-face="normal">${characterMarkup()}</svg>`;
    this.svg = host.firstElementChild;
    this.collect();
    this.pose = clonePose(POSES.rest);
    this.widths = { ...LEG_WIDTHS, hl: HAND_WIDTHS.slice(), hr: HAND_WIDTHS.slice() };
    this.runner = null;
    this.tweenRunner = null;
    this.want = { cover: false, card: null };
    this.lookTimer = 0;
    this.pointerQueued = false;
    this.pointerHandler = null;
    this.onPoke = () => this.poke();
    this.pokeWrap.addEventListener("click", this.onPoke);
    this.pokeWrap.addEventListener("animationend", () => this.pokeWrap.classList.remove("is-poked"));
    this.renderAll();
    this.settleDom();
  }

  collect() {
    const svg = this.svg;
    this.arms = {};
    for (const el of svg.querySelectorAll("[data-arm]")) {
      const name = el.dataset.arm;
      this.arms[name] = { el, dots: [...svg.querySelectorAll(`[data-s="${name}"]`)] };
    }
    this.tips = Object.fromEntries([...svg.querySelectorAll("[data-tip]")].map((el) => [el.dataset.tip, el]));
    this.shades = Object.fromEntries([...svg.querySelectorAll("[data-shade]")].map((el) => [el.dataset.shade, el]));
    this.shadeTips = Object.fromEntries([...svg.querySelectorAll("[data-shade-tip]")].map((el) => [el.dataset.shadeTip, el]));
    this.palms = Object.fromEntries([...svg.querySelectorAll("[data-palm]")].map((el) => [el.dataset.palm, el]));
    this.pokeWrap = svg.querySelector(".m-pokewrap");
    this.bodyEl = svg.querySelector(".m-body");
    this.mantleEl = svg.querySelector(".m-mantle");
    this.browsEl = svg.querySelector(".m-brows");
    this.lookEl = svg.querySelector(".m-look");
    this.eyeEls = [...svg.querySelectorAll(".m-eye")].map((el) => ({ el, cx: +el.dataset.cx, cy: +el.dataset.cy }));
    this.blushEl = svg.querySelector(".m-blush-wrap");
    this.shadowEl = svg.querySelector(".m-shadow");
    this.splatEl = svg.querySelector(".m-splat");
    this.rippleEls = [...svg.querySelectorAll(".m-ripple")];
    this.dropEl = svg.querySelector(".m-drop");
    this.dropletEls = [...svg.querySelectorAll(".m-droplet")];
    this.badgeEl = svg.querySelector(".m-badge");
    this.checkEl = svg.querySelector(".m-badge-check");
    this.checkLength = 16;
    try {
      this.checkLength = this.checkEl.getTotalLength();
    } catch {
      this.checkLength = 16;
    }
    this.checkEl.style.strokeDasharray = String(this.checkLength);
  }

  renderAll() {
    for (const name of NAMES) this.arm(name, this.pose[name], this.widths[name]);
  }

  arm(name, points, widths) {
    const part = this.arms[name];
    if (!part) return;
    this.pose[name] = points;
    this.widths[name] = widths;
    const samples = frame(points, widths[0], widths[1]);
    part.el.setAttribute("d", outline(samples));
    if (part.dots.length) {
      suckers(samples, LEG_SIDES[name]).forEach(([x, y, r], i) => {
        const dot = part.dots[i];
        dot.setAttribute("cx", x.toFixed(2));
        dot.setAttribute("cy", y.toFixed(2));
        dot.setAttribute("r", r.toFixed(2));
      });
    }
    if (HANDS.includes(name)) {
      const end = tip(samples);
      const cap = this.tips[name];
      cap.setAttribute("cx", end.x.toFixed(2));
      cap.setAttribute("cy", end.y.toFixed(2));
      cap.setAttribute("r", Math.max(0, end.r).toFixed(2));
      this.shades[name].setAttribute("d", outline(samples));
      const shadeTip = this.shadeTips[name];
      shadeTip.setAttribute("cx", end.x.toFixed(2));
      shadeTip.setAttribute("cy", end.y.toFixed(2));
      shadeTip.setAttribute("r", Math.max(0, end.r).toFixed(2));
      this.palms[name].setAttribute("transform", `translate(${end.x.toFixed(2)} ${end.y.toFixed(2)}) scale(${(end.r / 5.25).toFixed(3)})`);
    }
  }

  body(ty, sx, sy, opacity = 1, seat = 1) {
    this.bodyEl.style.transform = `translate(0px,${px(ty)}) translate(60px,101px) scale(${sx.toFixed(4)},${sy.toFixed(4)}) translate(-60px,-101px) translate(0px,${px(seat * SEAT)})`;
    this.bodyEl.style.opacity = opacity;
  }

  mantle(rotation, stretch) {
    this.mantleEl.style.transform = `translate(60px,71px) rotate(${rotation.toFixed(2)}deg) scale(${(1 - stretch * 0.6).toFixed(4)},${(1 + stretch).toFixed(4)}) translate(-60px,-71px)`;
  }

  brows(dy) {
    this.browsEl.style.transform = `translate(0px,${px(dy)})`;
  }

  eyeScale(scale) {
    for (const eye of this.eyeEls) {
      eye.el.style.transform = scale === 1 ? "" : `translate(${eye.cx}px,${eye.cy}px) scale(1,${scale.toFixed(3)}) translate(${-eye.cx}px,${-eye.cy}px)`;
    }
  }

  face(state) {
    if (this.svg.dataset.face !== state) this.svg.dataset.face = state;
  }

  blush(opacity) {
    this.blushEl.style.opacity = opacity;
  }

  shadow(scale, opacity) {
    this.shadowEl.style.transform = `translate(60px,${FX_Y + 2.5}px) scale(${scale.toFixed(3)}) translate(-60px,${-(FX_Y + 2.5)}px)`;
    this.shadowEl.style.opacity = opacity.toFixed(3);
  }

  splat(sx, sy, opacity) {
    this.splatEl.style.transform = `translate(60px,${FX_Y + 1}px) scale(${sx.toFixed(3)},${sy.toFixed(3)}) translate(-60px,${-(FX_Y + 1)}px)`;
    this.splatEl.style.opacity = opacity.toFixed(3);
  }

  ripple(index, rx, ry, opacity) {
    const el = this.rippleEls[index];
    el.setAttribute("rx", rx.toFixed(2));
    el.setAttribute("ry", ry.toFixed(2));
    el.style.opacity = opacity.toFixed(3);
  }

  drop(x, y, sx, sy, opacity) {
    this.dropEl.style.transform = `translate(${px(x)},${px(y)}) scale(${sx.toFixed(3)},${sy.toFixed(3)})`;
    this.dropEl.style.opacity = opacity.toFixed(3);
  }

  droplet(index, x, y, sx, sy, radius, color, opacity) {
    const el = this.dropletEls[index];
    if (!el) return;
    el.style.transform = `translate(${px(x)},${px(y)}) scale(${sx.toFixed(3)},${sy.toFixed(3)})`;
    el.setAttribute("r", radius.toFixed(2));
    el.style.fill = color;
    el.style.opacity = opacity.toFixed(3);
  }

  badge(scale, check, seat = 1) {
    this.badgeEl.style.transform = `translate(96px,${px(25 + seat * SEAT)}) scale(${Math.max(scale, 0.0001).toFixed(3)})`;
    this.badgeEl.style.opacity = scale > 0.001 ? 1 : 0;
    this.checkEl.style.strokeDashoffset = String(this.checkLength * (1 - clamp01(check)));
  }

  clearEffects({ keepSplat = false } = {}) {
    this.drop(60, -200, 1, 1, 0);
    for (let i = 0; i < this.dropletEls.length; i++) this.dropletEls[i].style.opacity = 0;
    for (let i = 0; i < this.rippleEls.length; i++) this.ripple(i, 10, 2, 0);
    this.badge(0, 0);
    if (!keepSplat) this.splat(1, 1, 1);
  }

  settleDom() {
    this.bodyEl.style.transform = `translate(0px,${px(SEAT)})`;
    this.bodyEl.style.opacity = "";
    this.mantleEl.style.transform = "";
    this.browsEl.style.transform = "";
    this.blushEl.style.opacity = "";
    this.shadowEl.style.transform = "";
    this.shadowEl.style.opacity = "";
    this.eyeScale(1);
  }

  stopRunners() {
    if (this.runner) {
      this.runner.cancel();
      this.runner = null;
    }
    if (this.tweenRunner) {
      this.tweenRunner.cancel();
      this.tweenRunner = null;
    }
  }

  rest() {
    this.stopRunners();
    this.settleDom();
    this.clearEffects();
    this.want = { cover: false, card: null };
    this.svg.dataset.card = "";
    this.svg.dataset.cover = "";
    this.face("normal");
    const next = clonePose(POSES.rest);
    for (const name of NAMES) this.arm(name, next[name], name.startsWith("h") ? HAND_WIDTHS : LEG_WIDTHS[name]);
    this.host.classList.remove("is-working");
  }

  reset() {
    this.stopRunners();
    this.settleDom();
    this.clearEffects();
    this.applyWant(true);
  }

  get busy() {
    return Boolean(this.runner);
  }

  play(name, options = {}) {
    const timeline = TIMELINES[name];
    this.stopRunners();
    if (timeline.fresh) this.clearEffects({ keepSplat: name !== "arrive" });
    timeline.before?.(this, options);
    timeline.render(this, 0);
    return new Promise((resolve) => {
      let frameId = 0;
      const started = performance.now();
      const runner = {
        cancel: () => {
          cancelAnimationFrame(frameId);
          resolve(false);
        },
      };
      this.runner = runner;
      const step = (now) => {
        const t = (now - started) / 1000;
        if (t >= timeline.duration) {
          timeline.render(this, timeline.duration);
          this.runner = null;
          this.finish(timeline);
          resolve(true);
          return;
        }
        timeline.render(this, t);
        frameId = requestAnimationFrame(step);
      };
      frameId = requestAnimationFrame(step);
    });
  }

  preview(name, t, options = {}) {
    const timeline = TIMELINES[name];
    this.stopRunners();
    if (timeline.fresh) this.clearEffects({ keepSplat: name !== "arrive" });
    timeline.before?.(this, options);
    timeline.render(this, t);
  }

  finish(timeline) {
    this.settleDom();
    timeline.after?.(this);
    this.applyWant(true);
  }

  async arrive() {
    if (!motionAllowed()) {
      this.rest();
      this.splat(1, 1, 1);
      return true;
    }
    return this.play("arrive", { fallFrom: this.fallStart() });
  }

  async celebrate() {
    if (!motionAllowed()) {
      this.stopRunners();
      this.settleDom();
      this.badge(1, 1);
      this.face("happy");
      this.brows(-2.4);
      return true;
    }
    return this.play("celebrate");
  }

  async wave() {
    if (!motionAllowed() || this.busy || this.want.cover || this.want.card) return false;
    return this.play("wave");
  }

  async wince() {
    if (!motionAllowed() || this.busy) return false;
    return this.play("wince");
  }

  poke() {
    if (!motionAllowed() || this.busy) return;
    this.pokeWrap.classList.remove("is-poked");
    void this.pokeWrap.getBoundingClientRect();
    this.pokeWrap.classList.add("is-poked");
    this.wave();
  }

  impactPoint() {
    const rect = this.svg.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + (rect.height * 101) / 120 };
  }

  fallStart() {
    const rect = this.svg.getBoundingClientRect();
    const unit = rect.width / 120 || 1;
    return -(rect.top / unit) - 26;
  }

  cover(on) {
    this.want.cover = on;
    this.applyWant();
  }

  hold(kind) {
    this.want.card = kind;
    this.applyWant();
  }

  progress(state) {
    this.svg.dataset.progress = state || "";
  }

  applyWant(immediate = false) {
    if (this.runner) return;
    const { cover, card } = this.want;
    const handPose = cover ? POSES.cover : card ? POSES.card : POSES.rest;
    const handWidths = cover ? COVER_HAND_WIDTHS : HAND_WIDTHS;
    this.svg.dataset.card = !cover && card ? card : "";
    this.svg.dataset.cover = cover ? "1" : "";
    this.face(cover ? "closed" : "normal");
    const target = { g1: POSES.rest.g1, g2: POSES.rest.g2, g3: POSES.rest.g3, g4: POSES.rest.g4, hl: handPose.hl, hr: handPose.hr };
    const widthTarget = { hl: handWidths, hr: handWidths };
    for (const name of ["g1", "g2", "g3", "g4"]) widthTarget[name] = LEG_WIDTHS[name];
    if (immediate || !motionAllowed()) {
      for (const name of NAMES) this.arm(name, target[name], widthTarget[name]);
      return;
    }
    this.tween(target, widthTarget, cover ? 360 : 420);
  }

  tween(target, widthTarget, duration) {
    if (this.tweenRunner) this.tweenRunner.cancel();
    const from = clonePose(this.pose);
    const fromWidths = Object.fromEntries(NAMES.map((name) => [name, this.widths[name].slice()]));
    const started = performance.now();
    let frameId = 0;
    const runner = {
      cancel: () => cancelAnimationFrame(frameId),
    };
    this.tweenRunner = runner;
    const step = (now) => {
      const t = clamp01((now - started) / duration);
      const k = ease.out(t);
      for (const name of NAMES) {
        const widths = [lerp(fromWidths[name][0], widthTarget[name][0], k), lerp(fromWidths[name][1], widthTarget[name][1], k)];
        this.arm(name, lerpPose(from[name], target[name], k), widths);
      }
      if (t < 1) frameId = requestAnimationFrame(step);
      else if (this.tweenRunner === runner) this.tweenRunner = null;
    };
    frameId = requestAnimationFrame(step);
  }

  look(x, y) {
    this.lookEl.style.transform = `translate(${(x * 2.2).toFixed(2)}px,${(y * 1.8).toFixed(2)}px)`;
  }

  blink() {
    if (!motionAllowed() || this.svg.dataset.face !== "normal") return;
    for (const eye of this.eyeEls) {
      const at = (scale) => `translate(${eye.cx}px,${eye.cy}px) scale(1,${scale}) translate(${-eye.cx}px,${-eye.cy}px)`;
      eye.el.animate([{ transform: at(1) }, { transform: at(0.1), offset: 0.45 }, { transform: at(1) }], { duration: 170, easing: "ease-in-out" });
    }
  }

  enter(delay = 0) {
    if (!motionAllowed()) return null;
    const smooth = "cubic-bezier(0.22, 1, 0.36, 1)";
    return this.svg.animate(
      [
        { opacity: 0, transform: "translateY(-16%) scale(0.95, 1.05)", easing: smooth },
        { opacity: 1, transform: "translateY(0) scale(1.05, 0.92)", offset: 0.5, easing: smooth },
        { opacity: 1, transform: "translateY(0) scale(1, 1)" },
      ],
      { duration: 620, delay, fill: "backwards" },
    );
  }

  talk(duration = 560, delay = 0) {
    if (!motionAllowed() || this.svg.dataset.face !== "normal") return [];
    const open = this.svg.querySelector(".m-mouth-open");
    const closed = this.svg.querySelector(".m-mouth");
    const beats = [0, 0.16, 0.32, 0.48, 0.64, 0.8, 1];
    const flap = (opened) => beats.map((offset, index) => ({ offset, opacity: (index % 2 === 1) === opened ? 1 : 0 }));
    return [open.animate(flap(true), { duration, delay, fill: "backwards" }), closed.animate(flap(false), { duration, delay, fill: "backwards" })];
  }

  trackPointer(enabled) {
    if (enabled && !this.pointerHandler) {
      this.pointerHandler = (event) => {
        if (this.pointerQueued || this.runner) return;
        this.pointerQueued = true;
        const { clientX, clientY } = event;
        requestAnimationFrame(() => {
          this.pointerQueued = false;
          if (this.svg.dataset.face !== "normal") return;
          const box = this.svg.getBoundingClientRect();
          const dx = clientX - (box.left + box.width / 2);
          const dy = clientY - (box.top + box.height * 0.45);
          const distance = Math.hypot(dx, dy) || 1;
          const strength = Math.min(1, distance / 260);
          this.look((dx / distance) * strength, (dy / distance) * strength);
        });
      };
      addEventListener("pointermove", this.pointerHandler, { passive: true });
    } else if (!enabled && this.pointerHandler) {
      removeEventListener("pointermove", this.pointerHandler);
      this.pointerHandler = null;
    }
  }

  destroy() {
    this.stopRunners();
    this.trackPointer(false);
    this.pokeWrap.removeEventListener("click", this.onPoke);
  }
}
