// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
  POSES,
  LEG_WIDTHS,
  HAND_WIDTHS,
  TAU,
  SEAT,
  FX_Y,
  SPREAD,
  clamp01,
  lerp,
  lerpPose,
  ease,
  track,
  trackPose,
  mulberry32,
} from "./geometry.js";

const LEGS = ["g1", "g2", "g3", "g4"];
const INK = ["#b7a6f6", "#9f8cef", "#8fe0c0", "#e7c694", "#86a36f", "#b7a6f6", "#f2a5c4", "#62c9a1", "#e7c694", "#9f8cef", "#2e3a2f", "#8fe0c0"];

function wobble(points, t, amplitude, period, phase) {
  const last = points.length - 1;
  return points.map((point, i) => {
    if (!i) return point;
    const weight = Math.pow(i / last, 1.4);
    return [
      point[0] + amplitude * weight * Math.sin((TAU * t) / period + phase - i * 0.8),
      point[1] + amplitude * 0.7 * weight * Math.cos((TAU * t) / (period * 1.13) + phase - i * 0.7),
    ];
  });
}

function envelope(t, inEnd, outStart, outEnd) {
  if (t <= 0) return 0;
  if (t < inEnd) return ease.inOut(t / inEnd);
  if (t < outStart) return 1;
  if (t < outEnd) return ease.inOut(1 - (t - outStart) / (outEnd - outStart));
  return 0;
}

const legPhases = [0.4, 2.1, 3.7, 5.3];

const SPLASH = (() => {
  const random = mulberry32(21);
  return Array.from({ length: 12 }, (_, i) => {
    const angle = -Math.PI * (0.1 + (0.8 * (i + random() * 0.8)) / 12);
    const speed = 52 + random() * 64;
    return {
      vx: Math.cos(angle) * speed * 1.2,
      vy: Math.sin(angle) * speed,
      radius: 1.2 + random() * 1.7,
      color: INK[i % 5],
    };
  });
})();

const ARRIVE = { impact: 0.62, rise: 0.7, open: 1.26, wave: 1.58 };

const arrive = {
  duration: 2.75,
  fresh: true,
  before(rig, options) {
    rig.fallFrom = options.fallFrom ?? -130;
  },
  render(rig, t) {
    const { impact, rise, open, wave } = ARRIVE;

    const fall = clamp01(t / impact);
    const squash = clamp01((t - impact) / 0.09);
    const dropY = lerp(rig.fallFrom, FX_Y, ease.gravity(fall));
    if (t < impact + 0.1) {
      const sx = fall < 1 ? 1 - 0.1 * fall : lerp(0.9, 2.2, squash);
      const sy = fall < 1 ? 1 + 0.32 * fall : lerp(1.32, 0.05, squash);
      rig.drop(60, dropY, sx, sy, t < impact ? 1 : 1 - squash);
    } else {
      rig.drop(60, FX_Y, 1, 1, 0);
    }

    const near = clamp01((t - (impact - 0.32)) / 0.32);
    const settled = clamp01((t - impact) / 0.45);
    rig.shadow(0.3 + 0.7 * Math.max(near * 0.6, settled), Math.max(near * 0.55, settled));

    const splatU = ease.back(clamp01((t - impact) / 0.36));
    rig.splat(lerp(0.1, 1, splatU), lerp(0.1, 1, splatU), t >= impact ? 1 : 0);

    const ring = clamp01((t - impact) / 0.55);
    rig.ripple(0, lerp(4, 30, ease.out(ring)), lerp(1.2, 4.6, ease.out(ring)), t >= impact && ring < 1 ? 0.6 * (1 - ring) : 0);

    SPLASH.forEach((p, i) => {
      const tau = t - impact;
      const landing = (-2 * p.vy) / 380;
      if (tau < 0 || tau > landing) {
        rig.droplet(i, 60, FX_Y, 1, 1, p.radius, p.color, 0);
        return;
      }
      const x = 60 + p.vx * SPREAD * tau;
      const y = FX_Y + p.vy * tau + 0.5 * 380 * tau * tau;
      const fade = clamp01((landing - tau) / 0.12);
      rig.droplet(i, x, y, 1, 1, p.radius, p.color, fade);
    });

    const rising = t - rise;
    const bodyOn = t >= rise;
    const keys = [rise, 0.98, 1.1, 1.22, 1.38];
    const sy = track(keys, [0.02, 1.14, 0.93, 1.035, 1], t, [ease.out, ease.inOut, ease.inOut, ease.inOut]);
    const sx = track(keys, [1.9, 0.9, 1.07, 0.98, 1], t, [ease.out, ease.inOut, ease.inOut, ease.inOut]);
    const hop = -8 * Math.sin(Math.PI * clamp01((t - wave) / 0.42));
    rig.body(hop, sx, sy, bodyOn ? 1 : 0);

    const swing = bodyOn ? 5.5 * Math.exp(-3.4 * rising) * Math.sin((TAU * rising) / 0.46) : 0;
    rig.mantle(swing, 0);

    const legU = ease.out(clamp01(rising / 0.75));
    const jiggle = bodyOn ? 2.6 * Math.exp(-2.6 * rising) : 0;
    LEGS.forEach((name, i) => {
      const base = lerpPose(POSES.crouch[name], POSES.rest[name], legU);
      rig.arm(name, wobble(base, t, jiggle, 0.9 + i * 0.07, legPhases[i]), LEG_WIDTHS[name]);
    });

    const handLeft = POSES.rest.hl;
    const handRight = POSES.rest.hr;
    const waving = envelope(t - wave, 0.3, 0.8, 1.2);
    const stroke = lerpPose(POSES.waveA.hr, POSES.waveB.hr, 0.5 + 0.5 * Math.sin((TAU * (t - wave - 0.3)) / 0.5));
    rig.arm("hl", wobble(handLeft, t, jiggle * 0.5, 1.1, 1.3), HAND_WIDTHS);
    rig.arm("hr", lerpPose(wobble(handRight, t, jiggle * 0.5, 1.2, 2.2), stroke, waving), HAND_WIDTHS);

    const eyesShut = t < open;
    const happy = t >= wave && t < wave + 1.2;
    rig.face(eyesShut ? "closed" : happy ? "happy" : "normal");
    rig.eyeScale(t >= open && t < open + 0.18 ? track([open, open + 0.08, open + 0.18], [0.1, 1.18, 1], t, ease.out) : 1);
    rig.blush(clamp01((t - 1.0) / 0.3));
    rig.brows(-1.7 * envelope(t - open, 0.12, wave + 1.2 - open, wave + 1.6 - open));
  },
  after(rig) {
    rig.clearEffects({ keepSplat: true });
    rig.splat(1, 1, 1);
  },
};

const CELEBRATE_SPOUT = (() => {
  const random = mulberry32(5);
  return Array.from({ length: 24 }, (_, i) => ({
    spawn: 0.46 + i * 0.011,
    sourceJitter: (random() - 0.5) * 7,
    vx: (random() - 0.5) * 76 * 0.62,
    vy: -(105 + random() * 80),
    ground: FX_Y + random() * 6,
    radius: 1.7 + random() * 2.1,
    color: INK[(i * 5) % INK.length],
  }));
})();

const BODY_TIMES = {
  y: [0, 0.26, 0.62, 0.7, 1.0, 1.28, 1.43, 1.58, 1.8],
  yValues: [0, 0, -21, -21, 0, 0, -9, 0, 0],
  yEase: [ease.inOut, ease.out, ease.linear, ease.gravity, ease.inOut, ease.out, ease.gravity, ease.inOut],
  squash: [0, 0.26, 0.36, 0.62, 0.7, 1.0, 1.04, 1.2, 1.28, 1.43, 1.58, 1.66, 1.8],
  sy: [1, 0.84, 1.14, 1.12, 1.06, 0.96, 0.82, 1.05, 1.0, 1.07, 0.9, 0.96, 1],
  sx: [1, 1.1, 0.92, 0.93, 0.96, 1.03, 1.14, 0.97, 1.0, 0.96, 1.1, 1.02, 1],
};

const bodyY = (time) => track(BODY_TIMES.y, BODY_TIMES.yValues, time, BODY_TIMES.yEase);
const bodyScaleY = (time) => track(BODY_TIMES.squash, BODY_TIMES.sy, time);

const LEG_KEYS = [0, 0.26, 0.4, 0.62, 0.7, 1.0, 1.2, 1.28, 1.43, 1.58, 1.8];
const LEG_POSES = [POSES.rest, POSES.crouch, POSES.stretch, POSES.apex, POSES.apex, POSES.landing, POSES.stand, POSES.crouch, POSES.stretch, POSES.landing, POSES.rest];
const SEAT_VALUES = [1, 0.55, 0, 0, 0, 0, 0, 0.55, 0, 0, 1];
const seatAt = (time) => track(LEG_KEYS, SEAT_VALUES, time);
const HAND_KEYS = [0, 0.26, 0.4, 0.62, 1.2];
const HAND_POSES = [POSES.rest, POSES.crouch, POSES.stretch, POSES.stretch, POSES.stretch];

const celebrate = {
  duration: 3.0,
  fresh: true,
  render(rig, t) {
    const ty = bodyY(t);
    rig.body(ty, track(BODY_TIMES.squash, BODY_TIMES.sx, t), bodyScaleY(t), 1, seatAt(t));

    const jump = clamp01(-ty / 21);
    rig.shadow(1 - 0.38 * jump, 1 - 0.45 * jump);

    const sway = t > 1.7 ? 3.2 * Math.exp(-1.4 * (t - 1.7)) * Math.sin((TAU * (t - 1.7)) / 0.62) : 0;
    rig.mantle(sway, 0);

    for (const name of LEGS) {
      const pose = trackPose(LEG_KEYS, LEG_POSES.map((p) => p[name]), t);
      rig.arm(name, pose, LEG_WIDTHS[name]);
    }

    const cheer = 0.5 + 0.5 * Math.sin((TAU * (t - 1.2)) / 0.5);
    for (const hand of ["hl", "hr"]) {
      let pose;
      if (t < 1.2) {
        pose = trackPose(HAND_KEYS, HAND_POSES.map((p) => p[hand]), t);
      } else {
        const swing = lerpPose(POSES.cheerLeft[hand], POSES.cheerRight[hand], hand === "hl" ? cheer : 1 - cheer);
        pose = lerpPose(POSES.stretch[hand], swing, ease.out(clamp01((t - 1.2) / 0.18)));
        if (t > 2.55) pose = lerpPose(pose, POSES.rest[hand], ease.out(clamp01((t - 2.55) / 0.4)));
      }
      rig.arm(hand, pose, HAND_WIDTHS);
    }

    rig.face(t >= 0.3 && t < 2.85 ? "happy" : "normal");
    rig.brows(-2.6 * clamp01((t - 0.3) / 0.12) * (1 - clamp01((t - 2.7) / 0.2)));

    CELEBRATE_SPOUT.forEach((p, i) => {
      const tau = t - p.spawn;
      if (tau < 0) {
        rig.droplet(i, 60, 0, 1, 1, p.radius, p.color, 0);
        return;
      }
      const spawnSy = bodyScaleY(p.spawn);
      const sourceY = 101 - 85 * spawnSy + bodyY(p.spawn) + SEAT * seatAt(p.spawn);
      const sourceX = 60 + p.sourceJitter * 0.35;
      const gravity = 330;
      const landing = (-p.vy + Math.sqrt(p.vy * p.vy - 2 * gravity * (sourceY - p.ground))) / gravity;
      const landedX = sourceX + p.vx * landing;
      if (tau < landing) {
        rig.droplet(i, sourceX + p.vx * tau, sourceY + p.vy * tau + 0.5 * gravity * tau * tau, 1, 1, p.radius, p.color, 1);
      } else {
        const splat = ease.out(clamp01((tau - landing) / 0.12));
        rig.droplet(i, landedX, p.ground, lerp(1.1, 2.7, splat), lerp(1.1, 0.6, splat), p.radius, p.color, 0.92);
      }
    });

    const ripple = (index, start) => {
      const u = clamp01((t - start) / 0.5);
      rig.ripple(index, lerp(5, 30, ease.out(u)), lerp(1.5, 4.6, ease.out(u)), t >= start && u < 1 ? 0.55 * (1 - u) : 0);
    };
    ripple(0, 1.0);
    ripple(1, 1.58);

    const pop = track([1.06, 1.18, 1.32, 1.46], [0, 1.22, 0.94, 1], t, ease.out);
    rig.badge(pop, (t - 1.22) / 0.3, seatAt(t));
  },
};

const wave = {
  duration: 1.3,
  render(rig, t) {
    const amount = envelope(t, 0.3, 0.85, 1.25);
    const stroke = lerpPose(POSES.waveA.hr, POSES.waveB.hr, 0.5 + 0.5 * Math.sin((TAU * (t - 0.25)) / 0.5));
    rig.arm("hr", lerpPose(POSES.rest.hr, stroke, amount), HAND_WIDTHS);
    rig.face(amount > 0.35 ? "happy" : "normal");
    rig.brows(-1.7 * amount);
  },
};

const wince = {
  duration: 0.8,
  render(rig, t) {
    const shake = 5.5 * Math.exp(-5 * t) * Math.sin((TAU * t) / 0.18);
    rig.body(0, 1, 1, 1);
    rig.bodyEl.style.transform = `translate(60px,101px) rotate(${shake.toFixed(2)}deg) translate(-60px,-101px) translate(0px,${SEAT}px)`;
    rig.face(t < 0.7 ? "worried" : "normal");
  },
};

export const TIMELINES = { arrive, celebrate, wave, wince };
