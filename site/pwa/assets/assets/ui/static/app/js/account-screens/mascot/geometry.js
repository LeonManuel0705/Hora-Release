// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export const TAU = Math.PI * 2;
export const SEAT = 15;
export const FX_Y = 94;
export const SPREAD = 0.46;

export const r2 = (value) => Math.round(value * 100) / 100;
export const clamp01 = (value) => Math.min(1, Math.max(0, value));
export const lerp = (from, to, amount) => from + (to - from) * amount;

export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  return (x) => {
    let t = x;
    for (let i = 0; i < 6; i++) {
      const slope = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(slope) < 1e-6) break;
      t -= (((ax * t + bx) * t + cx) * t - x) / slope;
    }
    t = clamp01(t);
    return ((ay * t + by) * t + cy) * t;
  };
}

export const ease = {
  linear: (x) => x,
  inOut: bezier(0.42, 0, 0.58, 1),
  out: bezier(0.16, 1, 0.3, 1),
  gravity: (x) => x * x,
  back: (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2),
};

export function track(keys, values, time, fn = ease.inOut) {
  if (time <= keys[0]) return values[0];
  const last = keys.length - 1;
  if (time >= keys[last]) return values[last];
  let k = 0;
  while (k < last - 1 && time >= keys[k + 1]) k++;
  const span = keys[k + 1] - keys[k] || 1;
  const curve = Array.isArray(fn) ? fn[k] || ease.inOut : fn;
  return lerp(values[k], values[k + 1], curve(clamp01((time - keys[k]) / span)));
}

export function trackPose(keys, poses, time, fn = ease.inOut) {
  if (time <= keys[0]) return poses[0];
  const last = keys.length - 1;
  if (time >= keys[last]) return poses[last];
  let k = 0;
  while (k < last - 1 && time >= keys[k + 1]) k++;
  const span = keys[k + 1] - keys[k] || 1;
  return lerpPose(poses[k], poses[k + 1], fn(clamp01((time - keys[k]) / span)));
}

export const lerpPose = (from, to, amount) =>
  from.map((point, i) => [lerp(point[0], to[i][0], amount), lerp(point[1], to[i][1], amount)]);

export const mirror = (points) => points.map(([x, y]) => [r2(120 - x), y]);

export function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLES = 30;

function spline(points, count) {
  const segments = points.length - 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * segments;
    const k = Math.min(Math.floor(t), segments - 1);
    const u = t - k;
    const p0 = points[Math.max(k - 1, 0)];
    const p1 = points[k];
    const p2 = points[k + 1];
    const p3 = points[Math.min(k + 2, segments)];
    const axis = (j) =>
      0.5 *
      (2 * p1[j] +
        (p2[j] - p0[j]) * u +
        (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u * u +
        (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * u * u * u);
    out.push([axis(0), axis(1)]);
  }
  return out;
}

export function frame(points, widthStart, widthEnd) {
  const curve = spline(points, SAMPLES);
  const out = [];
  for (let i = 0; i < SAMPLES; i++) {
    const a = curve[Math.max(i - 1, 0)];
    const b = curve[Math.min(i + 1, SAMPLES - 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    out.push({
      p: curve[i],
      n: [-dy, dx],
      w: (widthStart + (widthEnd - widthStart) * Math.pow(i / (SAMPLES - 1), 0.8)) / 2,
    });
  }
  return out;
}

export function outline(samples) {
  let left = "";
  let right = "";
  for (let i = 0; i < samples.length; i++) {
    const q = samples[i];
    left += (i ? "L" : "M") + (q.p[0] + q.n[0] * q.w).toFixed(2) + " " + (q.p[1] + q.n[1] * q.w).toFixed(2);
  }
  for (let i = samples.length - 1; i >= 0; i--) {
    const q = samples[i];
    right += "L" + (q.p[0] - q.n[0] * q.w).toFixed(2) + " " + (q.p[1] - q.n[1] * q.w).toFixed(2);
  }
  return left + right + "Z";
}

const SUCKER_AT = [0.36, 0.54, 0.7];

export function suckers(samples, side) {
  return SUCKER_AT.map((t) => {
    const q = samples[Math.round(t * (SAMPLES - 1))];
    const offset = side * q.w * 0.32;
    return [q.p[0] + q.n[0] * offset, q.p[1] + q.n[1] * offset, q.w * 0.42];
  });
}

export function tip(samples) {
  const q = samples[SAMPLES - 1];
  return { x: q.p[0], y: q.p[1], r: q.w };
}

const BASE = {
  g1: [[40, 64], [36, 76], [28, 87], [18, 92], [11, 89], [11, 84], [15, 83.5]],
  g2: [[50, 68], [48, 81], [43, 93], [35, 99], [29, 98], [29.5, 94.5], [32.5, 94.8]],
  g1sq: [[40, 64], [35.5, 74], [29, 82], [22, 86], [17.5, 84], [18, 80], [21.5, 80.5]],
  g1up: [[40, 64], [39, 77], [37, 90], [34, 101], [30.5, 105], [28.5, 102], [30.5, 99.5]],
  g1pk: [[40, 64], [32, 71], [22, 76], [13, 75], [8.5, 70], [11, 66], [15, 67.5]],
  g1ld: [[40, 64], [35, 77], [25, 89], [14, 94.5], [7, 92.5], [7.5, 87.5], [11.5, 87.5]],
  g1tuck: [[40, 64], [38, 72], [34.5, 79], [30, 83], [26.5, 81.5], [27, 78], [30, 78.5]],
  g2sq: [[50, 68], [47.5, 78], [43, 86], [37, 90], [32.5, 88.5], [33, 85], [36, 85.5]],
  g2up: [[50, 68], [50, 82], [49, 95], [47, 106], [44, 110], [42, 107.5], [44, 105]],
  g2pk: [[50, 68], [45, 78], [38, 84], [30, 86], [25.5, 83], [27, 79], [30.5, 80]],
  g2ld: [[50, 68], [47.5, 82], [41, 95], [32, 101], [26, 100], [26.5, 96], [29.5, 96.5]],
  g2tuck: [[50, 68], [48.5, 76], [45, 82], [40.5, 85.5], [37, 84], [37.5, 80.5], [40.5, 81]],
  hl: [[39, 58], [31, 58.5], [25.5, 54], [23.5, 47.5], [25.5, 43]],
  hlup: [[39, 58], [31, 51], [27, 41], [26.5, 31], [30, 25]],
  hlwv: [[39, 58], [30, 52], [24.5, 43], [22, 33], [24, 26.5]],
  hlcard: [[44, 66], [38, 66], [34.5, 70], [36, 75], [40, 76.5]],
  hlfold: [[39, 58], [32, 62], [29, 68], [31, 73], [35, 73.5]],
  hlcover: [[39, 60], [41, 55], [44, 51], [47, 48.5], [50, 47]],
  hrwaveA: [[81, 58], [90, 55], [97, 48], [100, 40], [97.5, 35.5]],
  hrwaveB: [[81, 58], [90, 54.5], [98, 47.5], [102.5, 40.5], [102, 35]],
};

export const POSES = {
  rest: {
    g1: BASE.g1tuck,
    g2: BASE.g2tuck,
    g3: mirror(BASE.g2tuck),
    g4: mirror(BASE.g1tuck),
    hl: BASE.hlfold,
    hr: mirror(BASE.hlfold),
  },
  stand: {
    g1: BASE.g1,
    g2: BASE.g2,
    g3: mirror(BASE.g2),
    g4: mirror(BASE.g1),
    hl: BASE.hl,
    hr: mirror(BASE.hl),
  },
  crouch: {
    g1: BASE.g1sq,
    g2: BASE.g2sq,
    g3: mirror(BASE.g2sq),
    g4: mirror(BASE.g1sq),
    hl: BASE.hlfold,
    hr: mirror(BASE.hlfold),
  },
  stretch: {
    g1: BASE.g1up,
    g2: BASE.g2up,
    g3: mirror(BASE.g2up),
    g4: mirror(BASE.g1up),
    hl: BASE.hlup,
    hr: mirror(BASE.hlup),
  },
  apex: {
    g1: BASE.g1pk,
    g2: BASE.g2pk,
    g3: mirror(BASE.g2pk),
    g4: mirror(BASE.g1pk),
    hl: BASE.hlwv,
    hr: mirror(BASE.hlwv),
  },
  landing: {
    g1: BASE.g1ld,
    g2: BASE.g2ld,
    g3: mirror(BASE.g2ld),
    g4: mirror(BASE.g1ld),
    hl: BASE.hlup,
    hr: mirror(BASE.hlup),
  },
  cover: {
    hl: BASE.hlcover,
    hr: mirror(BASE.hlcover),
  },
  card: {
    hl: BASE.hlcard,
    hr: mirror(BASE.hlcard),
  },
  cheerLeft: { hl: BASE.hlup, hr: mirror(BASE.hlwv) },
  cheerRight: { hl: BASE.hlwv, hr: mirror(BASE.hlup) },
  waveA: { hr: BASE.hrwaveA },
  waveB: { hr: BASE.hrwaveB },
};

export const LEG_WIDTHS = { g1: [9, 2], g2: [9.5, 2], g3: [9.5, 2], g4: [9, 2] };
export const HAND_WIDTHS = [7.5, 2.4];
export const COVER_HAND_WIDTHS = [7, 11];
export const LEG_SIDES = { g1: 1, g2: 1, g3: -1, g4: -1 };
