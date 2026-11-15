// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { reducedMotion } from "./dom.js";

const NS = "http://www.w3.org/2000/svg";
const LAYER_NAMES = ["back", "front"];

export const SIZES = { tall: [480, 560], wide: [480, 320] };

export function timeOfDay(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
  if (hour < 5 || hour >= 21) return "night";
  if (hour < 7.5) return "dawn";
  if (hour < 17.5) return "day";
  return "dusk";
}

const SPRING = "cubic-bezier(0.22, 1, 0.36, 1)";
const SWAY = "cubic-bezier(0.45, 0, 0.55, 1)";

const ENTERS = {
  fade: { frames: [{ opacity: 0 }, { opacity: 1 }], duration: 360, easing: "ease-out" },
  drop: { frames: [{ opacity: 0, translate: "0 -22px" }, { opacity: 1, translate: "0 0" }], duration: 520, easing: SPRING },
  rise: { frames: [{ opacity: 0, scale: "0.86" }, { opacity: 1, scale: "1" }], duration: 520, easing: SPRING },
  pop: { frames: [{ scale: "0" }, { scale: "1" }], duration: 600, easing: SPRING },
};

const FADE_IN = [{ opacity: 0 }, { opacity: 1 }];
const FADE_OUT = [{ opacity: 1 }, { opacity: 0 }];

const hash = (text) => {
  let value = 5381;
  for (let index = 0; index < text.length; index += 1) value = ((value << 5) + value + text.charCodeAt(index)) | 0;
  return (value >>> 0).toString(36);
};

const wrap = ([key, enter, markup]) => `<g data-part="${key}" data-enter="${enter}" data-sig="${hash(markup)}">${markup}</g>`;

export function createScene(host, pack) {
  pack.rewind?.();
  const enters = { ...ENTERS, ...pack.enters };
  const weights = pack.drift ?? {};
  const state = { cover: false, hold: null, progress: "" };
  let layout = "tall";
  let order = [];
  let base = null;
  const layers = {};
  for (const name of LAYER_NAMES) {
    const stage = document.createElement("div");
    stage.className = name === "front" ? "scene-art scene-front" : "scene-art";
    layers[name] = { stage, svg: null };
  }
  host.prepend(layers.back.stage);
  (host.querySelector(".mascot") ?? layers.back.stage).after(layers.front.stage);
  host.dataset.scene = pack.id;
  host.dataset.mascot = pack.mascot ? "on" : "off";

  const entries = () => pack.parts({ ...base, ...state }, layout);

  function mount() {
    const [width, height] = SIZES[layout];
    const list = entries();
    order = list.map(([key]) => key);
    for (const name of LAYER_NAMES) {
      const own = list.filter((entry) => entry[3] === name);
      layers[name].stage.innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">${own.map(wrap).join("")}</svg>`;
      layers[name].svg = layers[name].stage.firstElementChild;
    }
  }

  function enter(node, delay, track, reduced) {
    const kind = enters[node.dataset.enter] ?? ENTERS.fade;
    const options = reduced ? { duration: 140, easing: "ease-out", fill: "backwards" } : { duration: kind.duration, delay, easing: kind.easing, fill: "backwards" };
    track?.(node.animate(reduced ? FADE_IN : kind.frames, options));
  }

  const nodes = () => new Map(LAYER_NAMES.flatMap((name) => [...layers[name].svg.querySelectorAll("[data-part]")].map((node) => [node.dataset.part, node])));

  function renderLayer(name, list, { animate, reduced, track, cleanup }) {
    const svg = layers[name].svg;
    const holder = document.createElementNS(NS, "svg");
    holder.innerHTML = list.filter((entry) => entry[3] === name).map(wrap).join("");
    const current = new Map([...svg.children].filter((node) => node.dataset.part).map((node) => [node.dataset.part, node]));
    const wanted = new Set();
    let anchor = null;
    for (const node of [...holder.children]) {
      const key = node.dataset.part;
      wanted.add(key);
      const old = current.get(key);
      if (old && old.dataset.sig === node.dataset.sig) {
        anchor = old;
        continue;
      }
      if (anchor) anchor.after(node);
      else svg.prepend(node);
      if (old && animate) {
        old.removeAttribute("data-part");
        track?.(node.animate(FADE_IN, { duration: 240, easing: "ease-out", fill: "backwards" }));
        track?.(old.animate(FADE_OUT, { duration: 240, easing: "ease-out", fill: "forwards" }));
        cleanup?.(() => old.remove());
      } else if (old) old.remove();
      else if (animate) enter(node, 0, track, reduced);
      anchor = node;
    }
    current.forEach((node, key) => {
      if (wanted.has(key)) return;
      if (!animate) {
        node.remove();
        return;
      }
      node.removeAttribute("data-part");
      track?.(node.animate(FADE_OUT, { duration: 220, easing: "ease-out", fill: "forwards" }));
      cleanup?.(() => node.remove());
    });
  }

  function update(options) {
    const list = entries();
    order = list.map(([key]) => key);
    for (const name of LAYER_NAMES) renderLayer(name, list, options);
  }

  const tools = {
    get layout() {
      return layout;
    },
    get model() {
      return { ...base, ...state };
    },
    part: (key) => nodes().get(key) ?? null,
    reduced: reducedMotion,
  };

  return {
    id: pack.id,
    hasMascot: Boolean(pack.mascot),
    first: pack.first ?? [],

    get layout() {
      return layout;
    },

    render(next, options = {}) {
      base = next;
      if (!layers.back.svg) {
        mount();
        return;
      }
      update({ animate: false, reduced: false, ...options });
    },

    setLayout(name, next) {
      base = next;
      if (name === layout && layers.back.svg) return;
      layout = name;
      host.dataset.layout = name;
      mount();
    },

    set(key, value) {
      if (state[key] === value) return;
      state[key] = value;
      if (!layers.back.svg || !base) return;
      const animations = [];
      const cleanups = [];
      update({ animate: true, reduced: reducedMotion(), track: (animation) => animation && animations.push(animation), cleanup: (fn) => cleanups.push(fn) });
      Promise.all(animations.map((animation) => animation.finished.catch(() => {}))).then(() => cleanups.forEach((fn) => fn()));
    },

    react(moment, ...args) {
      return pack.react?.(moment, args, tools);
    },

    assemble({ delay = 0, stagger = 48, track, first = [] }) {
      const found = nodes();
      const keys = [...first.filter((key) => found.has(key)), ...order.filter((key) => found.has(key) && !first.includes(key))];
      keys.forEach((key, index) => enter(found.get(key), delay + index * stagger, track, false));
    },

    drift({ axis, direction, delay = 0, duration = 760, track }) {
      const at = (distance) => (axis === "y" ? `0 ${distance}px` : `${distance}px 0`);
      const found = nodes();
      order.forEach((key, index) => {
        const node = found.get(key);
        if (!node) return;
        const weight = weights[key.replace(/-\d+$/, "")] ?? 12;
        if (!weight) return;
        const frames = [
          { translate: "0 0", easing: SWAY },
          { translate: at(-direction * weight), offset: 0.42, easing: SWAY },
          { translate: at(direction * weight * 0.2), offset: 0.8, easing: SWAY },
          { translate: "0 0" },
        ];
        track?.(node.animate(frames, { duration, delay: delay + index * 14, composite: "add" }));
      });
    },
  };
}
