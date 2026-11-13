// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export function createActor(mascot, scene) {
  const live = scene.hasMascot;
  const tell = (moment, ...args) => scene.react(moment, ...args);
  mascot.trackPointer(live);

  return {
    hold(kind) {
      if (live) mascot.hold(kind);
      scene.set("hold", kind);
    },

    cover(on) {
      if (live) mascot.cover(on);
      scene.set("cover", on);
    },

    progress(state) {
      if (live) mascot.progress(state);
      scene.set("progress", state);
    },

    look(x, y) {
      if (live) mascot.look(x, y);
      tell("look", x, y);
    },

    type(field, length, seed = 0) {
      tell("type", field, length, seed);
    },

    wince() {
      tell("wince");
      return live ? mascot.wince() : Promise.resolve(false);
    },

    wave() {
      tell("wave");
      return live ? mascot.wave() : Promise.resolve(false);
    },

    celebrate() {
      const own = tell("celebrate");
      return live ? mascot.celebrate() : Promise.resolve(own ?? true);
    },

    arrive() {
      const own = tell("arrive");
      return live ? mascot.arrive() : Promise.resolve(own ?? true);
    },

    preview(name, t, options) {
      if (live) mascot.preview(name, t, options);
      else tell("preview", name);
    },

    fallStart: () => (live ? mascot.fallStart() : 0),

    rest() {
      if (live) mascot.rest();
      scene.set("hold", null);
      scene.set("cover", false);
      scene.set("progress", "");
      tell("rest");
    },

    reset() {
      if (live) mascot.reset();
      tell("reset");
    },

    blink() {
      if (live) mascot.blink();
    },

    talk(duration, delay) {
      const own = tell("talk", duration, delay) ?? [];
      return live ? [...mascot.talk(duration, delay), ...own] : own;
    },

    enter: (delay) => (live ? mascot.enter(delay) : null),
  };
}
