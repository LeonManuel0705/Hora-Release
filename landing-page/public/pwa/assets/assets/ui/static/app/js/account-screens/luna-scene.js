// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { view as shadow, reducedMotion } from "./dom.js";

const C = {
  pine: "#2E3A2F",
  pine2: "#3A4E37",
  pine3: "#4A6347",
  sage: "#86A36F",
  sageD: "#6B7F5B",
  sageL: "#B9CDA5",
  sageP: "#DDE7D1",
  terra: "#C96F4F",
  clay: "#A95A3E",
  terraL: "#E6A285",
  sand: "#E7C694",
  sandD: "#D4AE76",
  sandP: "#F3E4C8",
  chalk: "#F8F6EE",
  white: "#FCFCF9",
  line: "#E4DFD4",
  line2: "#D1CEC1",
  gold: "#B8893B",
  lav: "#8F7FE3",
};

const W = 200;
const H = 300;
const AV = { x: 100, y: 84, r: 33 };
const ROW = { x: 28, w: 144, h: 28 };
const EMAIL_Y = 134;
const PASS_Y = 172;
const BUTTON_Y = 220;
const SEGMENTS = 12;
const BOXES = 6;
const BOX = { w: 20, h: 28, gap: 4.8 };
const BOX_X = (W - (BOXES * BOX.w + (BOXES - 1) * BOX.gap)) / 2;

const LAYOUTS = {
  tall: {
    phone: [240, 474, 0.96],
    blob: [[244, 326, 170]],
    dots: [[86, 196, 7, -0.8], [404, 404, 5.5], [392, 150, 4.5]],
    sparkles: [[116, 238, 6.5, -2.1]],
    sway: [[0, 5.2, -1.2], [2, 4.4, -3.1], [3, 3.8, -0.5]],
    leaves: [
      [170, 470, -34, 236, 84, "a"],
      [146, 476, -58, 150, 60, "b"],
      [316, 470, 30, 214, 80, "b"],
      [338, 476, 62, 128, 52, "a"],
    ],
    gears: [[106, 404, 34, 8], [64, 458, 19, 6]],
    ground: [240, 476, 150],
  },
  wide: {
    phone: [348, 250, 0.64],
    blob: [[326, 154, 104], [104, 214, 50]],
    dots: [[212, 116, 4.5, -0.8], [458, 204, 4], [40, 172, 4]],
    sparkles: [[452, 124, 5.5, -2.1]],
    sway: [[0, 5, -1.3], [2, 4.2, -2.9], [5, 3.6, -0.6]],
    leaves: [
      [310, 250, -36, 150, 52, "a"],
      [292, 252, -62, 92, 38, "b"],
      [388, 250, 32, 136, 48, "b"],
      [402, 252, 64, 80, 32, "a"],
      [92, 254, -40, 104, 40, "b"],
      [104, 254, -6, 122, 44, "a"],
      [118, 254, 34, 88, 34, "b"],
    ],
    gears: [[224, 216, 22, 8], [190, 240, 12.5, 6]],
    ground: [348, 251, 96],
  },
};

const SNAP = "cubic-bezier(0.22, 1, 0.36, 1)";

const typed = { email: 0, pills: [], password: 0, code: 0, face: 0, focus: "" };
const shown = { key: "", mail: "", done: null, progress: "" };
const timers = { face: 0, sync: 0 };
const live = { gears: [] };

function rewind() {
  clearTimeout(timers.face);
  clearTimeout(timers.sync);
  Object.assign(typed, { email: 0, pills: [], password: 0, code: 0, face: 0, focus: "" });
  Object.assign(shown, { key: "", mail: "", done: null, progress: "" });
  live.gears = [];
}

const mix = (seed, index) => {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

const r1 = (value) => Math.round(value * 10) / 10;
const frameNode = () => shadow.root?.querySelector('.scene-frame[data-scene="l-luna"]') ?? null;
const phoneAt = ([cx, bottom, k]) => `translate(${r1(cx - (W / 2) * k)} ${r1(bottom - H * k)}) scale(${k})`;
const onPhone = (l, markup) => `<g class="ll-rig"><g transform="${phoneAt(l.phone)}">${markup}</g></g>`;

function play(element, frames, options) {
  if (!element) return null;
  element.getAnimations().forEach((animation) => animation.cancel());
  return element.animate(frames, options);
}

function blobPart(discs, dots, sparkles) {
  const twinkle = (delay, markup) => (delay === undefined ? markup : `<g class="ll-twinkle" style="--ll-d:${delay}s">${markup}</g>`);
  const specks = dots.map(([x, y, s, delay], i) => twinkle(delay, `<circle cx="${x}" cy="${y}" r="${s}" fill="${i % 2 ? C.sand : C.sageL}"/>`)).join("");
  const stars = sparkles.map(([x, y, s, delay]) => `<g transform="translate(${x} ${y})">${twinkle(delay, `<rect x="${-s}" y="${r1(-s * 0.32)}" width="${2 * s}" height="${r1(s * 0.64)}" rx="${r1(s * 0.32)}" fill="${C.sand}"/><rect x="${r1(-s * 0.32)}" y="${-s}" width="${r1(s * 0.64)}" height="${2 * s}" rx="${r1(s * 0.32)}" fill="${C.sand}"/>`)}</g>`).join("");
  const shapes = discs.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.sand}" opacity=".42"/>
    <circle cx="${r1(cx - r * 0.12)}" cy="${r1(cy - r * 0.14)}" r="${r1(r * 0.82)}" fill="${C.sandP}" opacity=".7"/>`).join("");
  return `${shapes}${specks}${stars}`;
}

function leafPath(length, width) {
  const L = length;
  const w = width / 2;
  const half = (s) => `M0 0C${r1(s * w * 1.3)} ${r1(-L * 0.24)} ${r1(s * w * 1.02)} ${r1(-L * 0.84)} 0 ${-L}V0Z`;
  return { left: half(-1), right: half(1) };
}

const LEAF_TONES = {
  a: [C.sage, C.sageD, C.sageL],
  b: [C.sageL, C.sage, C.sageP],
};

function leafPart([x, y, angle, length, width, tone], sway) {
  const { left, right } = leafPath(length, width);
  const [light, dark, rib] = LEAF_TONES[tone];
  const veins = [0.34, 0.54, 0.72]
    .map((t) => `<path d="M0 ${r1(-length * t)}l${r1(width * 0.24)} ${r1(-length * 0.09)}" stroke="${rib}" stroke-width="2.2" stroke-linecap="round" fill="none" opacity=".7"/>`)
    .join("");
  const body = `<path d="${left}" fill="${light}"/><path d="${right}" fill="${dark}"/>
    <path d="M0 -2V${r1(-length * 0.86)}" stroke="${rib}" stroke-width="2.6" stroke-linecap="round" fill="none"/>${veins}`;
  return `<g transform="translate(${x} ${y}) rotate(${angle})"><g class="ll-leaf">${sway ? `<g class="ll-sway" style="--ll-t:${sway[0]}s;--ll-d:${sway[1]}s">${body}</g>` : body}</g></g>`;
}

function gearPart([x, y, r, teeth], index) {
  const [body, inner] = index ? [C.terraL, C.sand] : [C.terra, C.terraL];
  const tw = r * 0.44;
  const th = r * 0.36;
  const cogs = Array.from({ length: teeth }, (_, i) => `<rect x="${r1(-tw / 2)}" y="${r1(-r - th)}" width="${r1(tw)}" height="${r1(th + 6)}" rx="${r1(tw * 0.4)}" transform="rotate(${r1((i * 360) / teeth)})"/>`).join("");
  return `<g transform="translate(${x} ${y})">
    <circle r="${r1(r * 1.55)}" fill="none" stroke="${C.terra}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0.5 8.5" opacity=".7"/>
    <g class="ll-gear"><g class="ll-spin${index ? " ll-spin-back" : ""}"><g fill="${body}">${cogs}<circle r="${r}"/></g></g></g>
    <circle r="${r1(r * 0.62)}" fill="${C.clay}" opacity=".3" transform="translate(${r1(r * 0.08)} ${r1(r * 0.1)})"/>
    <circle r="${r1(r * 0.56)}" fill="${inner}"/><circle r="${r1(r * 0.24)}" fill="${C.chalk}"/>
  </g>`;
}

function groundPart([cx, y, w]) {
  return `<ellipse cx="${cx}" cy="${y}" rx="${w}" ry="${r1(w * 0.075)}" fill="${C.sandD}" opacity=".35"/>`;
}

function phonePart() {
  return `<rect x="7" y="3" width="${W}" height="${H}" rx="34" fill="${C.pine2}"/>
    <rect x="-3.5" y="80" width="7" height="30" rx="3.5" fill="${C.pine2}"/>
    <rect x="-3.5" y="118" width="7" height="20" rx="3.5" fill="${C.pine2}"/>
    <rect width="${W}" height="${H}" rx="34" fill="${C.pine}"/>
    <path d="M6.5 64V36Q6.5 8 34 7" stroke="${C.pine3}" stroke-width="3.2" stroke-linecap="round" fill="none"/>
    <rect x="11" y="22" width="178" height="264" rx="22" fill="${C.chalk}"/>
    <rect x="82" y="9.5" width="36" height="5" rx="2.5" fill="${C.pine3}"/>
    <circle cx="128" cy="12" r="2.8" fill="${C.pine3}"/>${TEXT_DEFS}`;
}

const HEADER = "M11 44A22 22 0 0 1 33 22H167A22 22 0 0 1 189 44V104H11Z";

function headerPart(tone) {
  const fill = tone === "new" ? C.sandP : C.sageP;
  const dots = tone === "new" ? C.sand : C.sageL;
  return `<path d="${HEADER}" fill="${fill}"/>
    <circle cx="36" cy="40" r="4" fill="${dots}"/><circle cx="48" cy="40" r="4" fill="${dots}" opacity=".6"/>
    <rect x="80" y="276" width="40" height="4" rx="2" fill="${C.line2}"/>`;
}

const FACE_TONES = [C.sage, C.terraL, C.sand, C.sageD, C.sageL];
const HAIR_TONES = [C.pine, C.clay, C.pine3];
const SHOULDERS = "M-21 25.5C-21 12 -11.5 6.5 0 6.5C11.5 6.5 21 12 21 25.5A33 33 0 0 1 -21 25.5Z";
const HAIRS = [
  { back: "", front: "M-12.6 -5C-13.4 -20.5 12.2 -22.5 12.8 -6.5C8.5 -12.5 -4 -14 -12.6 -5Z" },
  { back: '<circle cy="-21.5" r="6.2"/>', front: "M-12.6 -5C-13.4 -20.5 12.2 -22.5 12.8 -6.5C8.5 -12.5 -4 -14 -12.6 -5Z" },
  { back: '<path d="M-13.4 -6C-14.5 -23 14.5 -23 13.4 -6L15 10.5C9 14.5 -9 14.5 -15 10.5Z"/>', front: "M-12.4 -6.5C-11.5 -17 7 -20.5 12.6 -8.5C4 -11.5 -5 -11 -12.4 -6.5Z" },
  { back: '<circle cx="-11.6" cy="-9" r="4.6"/><circle cx="11.6" cy="-9" r="4.6"/>', front: "M-12 -8A6 6 0 0 1 -4.5 -17.5A6.4 6.4 0 0 1 5 -17.5A6 6 0 0 1 12 -8C6 -12.5 -6 -12.5 -12 -8Z" },
];

function faceOf(seed) {
  if (!seed) return { bg: C.sage, hair: -1, ink: C.pine };
  const h = mix(seed, 77);
  return { bg: FACE_TONES[h % FACE_TONES.length], hair: (h >>> 5) % HAIRS.length, ink: HAIR_TONES[(h >>> 9) % HAIR_TONES.length] };
}

function faceInner(face) {
  const hair = HAIRS[face.hair];
  return `<circle r="${AV.r}" fill="${face.bg}"/>
    <circle r="${AV.r}" fill="${C.white}" opacity=".16" transform="translate(-6 -7) scale(.62)"/>
    ${hair ? `<g fill="${face.ink}">${hair.back}</g>` : ""}
    <path d="${SHOULDERS}" fill="${C.chalk}"/>
    <circle cy="-6" r="12.2" fill="${C.chalk}"/>
    ${hair ? `<path d="${hair.front}" fill="${face.ink}"/>` : ""}`;
}

function facePart(seed) {
  return `<g transform="translate(${AV.x} ${AV.y})"><circle r="${AV.r + 5}" fill="${C.chalk}"/>
    <g class="ll-avatar"><g class="ll-face">${faceInner(faceOf(seed))}</g></g></g>`;
}

function arc(index, radius) {
  const span = 360 / SEGMENTS;
  const point = (deg) => [r1(Math.cos((deg * Math.PI) / 180) * radius), r1(Math.sin((deg * Math.PI) / 180) * radius)];
  const [x1, y1] = point(-90 + index * span + 7);
  const [x2, y2] = point(-90 + (index + 1) * span - 7);
  return `M${x1} ${y1}A${radius} ${radius} 0 0 1 ${x2} ${y2}`;
}

const ARCS = Array.from({ length: SEGMENTS }, (_, i) => arc(i, AV.r - 3));

function newAvatarPart(count) {
  const full = count >= SEGMENTS;
  const base = ARCS.map((d) => `<path d="${d}" stroke="${C.sandD}" stroke-width="4.6" stroke-linecap="round" fill="none" opacity=".55"/>`).join("");
  const fills = ARCS.map((d, i) => `<path class="ll-seg" d="${d}" stroke="${C.sage}" stroke-width="5.4" stroke-linecap="round" fill="none" opacity="${i < count ? 1 : 0}"/>`).join("");
  return `<g transform="translate(${AV.x} ${AV.y})"><circle r="${AV.r + 5}" fill="${C.chalk}"/>
    <g class="ll-avatar"><circle r="${AV.r}" fill="${C.white}"/>${base}${fills}
      <g class="ll-plus" opacity="${full ? 0 : 1}"><rect x="-11" y="-3" width="22" height="6" rx="3" fill="${C.sand}"/><rect x="-3" y="-11" width="6" height="22" rx="3" fill="${C.sand}"/>
        <rect x="-11" y="-3" width="22" height="6" rx="3" fill="${C.sandD}" opacity=".5" transform="translate(0 1.4) scale(1 .5)"/></g>
      <g class="ll-born" opacity="${full ? 1 : 0}"><circle cy="-5" r="9.5" fill="${C.sageD}"/><path d="M-15 17C-15 7 -8 3 0 3C8 3 15 7 15 17Z" fill="${C.sageD}"/></g>
    </g></g>`;
}

const PILL = { x: 56, h: 4.5, gap: 1.8, word: 4.8, ring: 3 };
const DOT = { x: 58, step: 9.5, r: 4 };
const TEXT = { left: 53, right: 165 };

function glyphOf(seed, i, hasAt) {
  const h = mix(seed, i);
  const at = !hasAt && i >= 2 && i <= 5 && (i === 5 || (h >>> 7) % 3 === 0);
  const gap = i === 0 ? 0 : !at && (h >>> 12) % 4 === 0 ? PILL.word : PILL.gap;
  return { w: at ? 6 : 3 + (h % 11) * 0.5, gap, at };
}

function addGlyph(seed, i) {
  typed.pills[i] = glyphOf(seed, i, typed.pills.slice(0, i).some((glyph) => glyph.at));
}

function glyphLayout() {
  let x = PILL.x;
  return typed.pills.slice(0, typed.email).map((glyph, i) => {
    x += glyph.gap;
    const left = x;
    x += glyph.w;
    return { x: left, w: glyph.w, ring: glyph.at && typed.email >= i + PILL.ring };
  });
}

function caretX(layout = glyphLayout()) {
  const last = layout[layout.length - 1];
  return last ? last.x + last.w + 2.5 : PILL.x;
}

const emailShift = (layout = glyphLayout()) => Math.max(0, r1(caretX(layout) + 2.4 - TEXT.right));
const dotShift = (count = typed.password) => (count ? Math.max(0, r1(DOT.x + (count - 1) * DOT.step + DOT.r + 3 - TEXT.right)) : 0);

const pillMarkup = (glyph) => `<rect class="ll-pill" x="${r1(glyph.x)}" y="${EMAIL_Y + 14 - PILL.h / 2}" width="${glyph.w}" height="${PILL.h}" rx="${PILL.h / 2}" fill="${C.sageD}" opacity="${glyph.ring ? 0 : 1}"/>`;
const dotMarkup = (i) => `<circle class="ll-dot" cx="${DOT.x + i * DOT.step}" cy="${PASS_Y + 14}" r="${DOT.r}" fill="${C.pine3}" opacity="1"/>`;
const windowed = (offset, row) => `<g clip-path="url(#l-luna-text)"><g class="ll-fade"${offset > 0 ? ' mask="url(#l-luna-fade)"' : ""}><g class="ll-row" transform="translate(${-offset} 0)">${row}</g></g></g>`;

const TEXT_DEFS = `<defs>
    <clipPath id="l-luna-text" clipPathUnits="userSpaceOnUse">
      <rect x="${TEXT.left}" y="${EMAIL_Y + 2}" width="${TEXT.right - TEXT.left + 2}" height="${ROW.h - 4}"/>
      <rect x="${TEXT.left}" y="${PASS_Y + 2}" width="${TEXT.right - TEXT.left + 2}" height="${ROW.h - 4}"/>
    </clipPath>
    <linearGradient id="l-luna-fade-ramp" gradientUnits="userSpaceOnUse" x1="${TEXT.left}" y1="0" x2="${TEXT.left + 13}" y2="0"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>
    <mask id="l-luna-fade" maskUnits="userSpaceOnUse" x="${TEXT.left - 4}" y="${EMAIL_Y}" width="${TEXT.right - TEXT.left + 10}" height="${PASS_Y + ROW.h - EMAIL_Y}">
      <rect x="${TEXT.left - 4}" y="${EMAIL_Y}" width="${TEXT.right - TEXT.left + 10}" height="${PASS_Y + ROW.h - EMAIL_Y}" fill="url(#l-luna-fade-ramp)"/>
    </mask>
  </defs>`;

function fieldShell(y, focused, icon, hint, empty) {
  const ring = (fill, cls, opacity) => `<rect class="${cls}" x="${ROW.x - 3.5}" y="${y - 3.5}" width="${ROW.w + 7}" height="${ROW.h + 7}" rx="${(ROW.h + 7) / 2}" fill="${fill}" opacity="${opacity}"/>`;
  return `${ring(C.sageL, "ll-ring", focused ? 1 : 0)}${ring(C.terra, "ll-flash", 0)}
    <rect x="${ROW.x}" y="${y}" width="${ROW.w}" height="${ROW.h}" rx="${ROW.h / 2}" fill="${C.line}"/>
    <rect class="ll-lit" x="${ROW.x}" y="${y}" width="${ROW.w}" height="${ROW.h}" rx="${ROW.h / 2}" fill="${C.white}" opacity="${focused ? 1 : 0}"/>
    <rect class="ll-flash" x="${ROW.x}" y="${y}" width="${ROW.w}" height="${ROW.h}" rx="${ROW.h / 2}" fill="${C.terraL}" opacity="0"/>
    ${icon}<rect class="ll-hint" x="${PILL.x}" y="${y + 11.5}" width="${hint}" height="5" rx="2.5" fill="${C.line2}" opacity="${empty && !focused ? 1 : 0}"/>`;
}

function emailPart() {
  const y = EMAIL_Y;
  const focused = typed.focus === "email";
  const icon = `<rect x="35" y="${y + 9}" width="15" height="10.5" rx="2.6" fill="${C.sageD}"/><path d="M37.6 ${y + 11.6}L42.5 ${y + 15.2}L47.4 ${y + 11.6}" stroke="${C.chalk}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  const layout = glyphLayout();
  const ring = layout.find((glyph) => glyph.ring);
  const row = `${layout.map(pillMarkup).join("")}
    <circle class="ll-at" cx="${ring ? r1(ring.x + ring.w / 2) : PILL.x}" cy="${y + 14}" r="2.5" fill="none" stroke="${C.sageD}" stroke-width="1.8" opacity="${ring ? 1 : 0}"/>
    <rect class="ll-caret" x="${r1(caretX(layout))}" y="${y + 6.5}" width="2.4" height="15" rx="1.2" fill="${C.sage}" opacity="${focused ? 1 : 0}"/>`;
  return `<g class="ll-field">${fieldShell(y, focused, icon, 70, !typed.email)}${windowed(emailShift(layout), row)}</g>`;
}

function passwordPart(cover) {
  const y = PASS_Y;
  const icon = `<g class="ll-padlock" opacity="${cover ? 0 : 1}"><rect x="36" y="${y + 12.5}" width="13" height="9.5" rx="2.4" fill="${C.sageD}"/><path d="M38.8 ${y + 12.8}V${y + 10.4}A3.7 3.7 0 0 1 46.2 ${y + 10.4}V${y + 12.8}" stroke="${C.sageD}" stroke-width="2.1" fill="none"/></g>`;
  const dots = Array.from({ length: typed.password }, (_, i) => dotMarkup(i)).join("");
  return `<g class="ll-field">${fieldShell(y, cover, icon, 52, !typed.password)}${windowed(dotShift(), dots)}</g>`;
}

function codePart() {
  const y = EMAIL_Y - 2;
  const active = Math.min(typed.code, BOXES - 1);
  return Array.from({ length: BOXES }, (_, i) => {
    const x = BOX_X + i * (BOX.w + BOX.gap);
    const ring = typed.focus === "code" && i === active && typed.code < BOXES ? 1 : 0;
    return `<rect class="ll-box-ring" x="${r1(x - 2.5)}" y="${y - 2.5}" width="${BOX.w + 5}" height="${BOX.h + 5}" rx="9" fill="${C.sageL}" opacity="${ring}"/>
      <rect class="ll-flash" x="${r1(x - 2.5)}" y="${y - 2.5}" width="${BOX.w + 5}" height="${BOX.h + 5}" rx="9" fill="${C.terra}" opacity="0"/>
      <rect x="${r1(x)}" y="${y}" width="${BOX.w}" height="${BOX.h}" rx="7" fill="${C.line}"/>
      <g class="ll-digit" opacity="${i < typed.code ? 1 : 0}"><rect x="${r1(x)}" y="${y}" width="${BOX.w}" height="${BOX.h}" rx="7" fill="${C.white}"/>
        <rect x="${r1(x + BOX.w / 2 - 3.2)}" y="${y + 8}" width="6.4" height="12" rx="3.2" fill="${C.pine3}"/></g>`;
  }).join("");
}

function buttonPart(y, mode) {
  const pressed = mode === "working" || mode === "done";
  const top = pressed ? y + 2.5 : y;
  const lip = pressed ? "" : `<rect x="${ROW.x}" y="${y + 3.5}" width="${ROW.w}" height="${ROW.h}" rx="${ROW.h / 2}" fill="${C.clay}"/>`;
  let label = `<rect x="${W / 2 - 27}" y="${top + 11.5}" width="54" height="5" rx="2.5" fill="${C.chalk}"/>`;
  if (mode === "working") label = [-12, 0, 12].map((dx) => `<circle class="ll-busy" cx="${W / 2 + dx}" cy="${top + 14}" r="3.4" fill="${C.chalk}"/>`).join("");
  if (mode === "done") label = `<path d="M${W / 2 - 7} ${top + 14}L${W / 2 - 2} ${top + 19}L${W / 2 + 8} ${top + 9}" stroke="${C.chalk}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  return `<g class="ll-button">${lip}<rect x="${ROW.x}" y="${top}" width="${ROW.w}" height="${ROW.h}" rx="${ROW.h / 2}" fill="${pressed ? C.clay : C.terra}"/>
    <rect x="${ROW.x + 10}" y="${top + 3}" width="${ROW.w - 20}" height="5" rx="2.5" fill="${C.white}" opacity="${pressed ? 0.08 : 0.16}"/>${label}</g>`;
}

function envelopeArt() {
  return `<rect x="-36" y="-25" width="72" height="50" rx="9" fill="${C.white}"/>
    <path d="M-36 19L-6 -1Q0 -5 6 -1L36 19V16Q36 25 27 25H-27Q-36 25 -36 16Z" fill="${C.line}"/>
    <path d="M-34 -21L-4.5 2.5Q0 6 4.5 2.5L34 -21Q32 -25 27 -25H-27Q-32 -25 -34 -21Z" fill="${C.sand}"/>
    <path d="M-34 -21L-4.5 2.5Q0 6 4.5 2.5L34 -21Q32 -25 27 -25H-27Q-32 -25 -34 -21Z" fill="${C.sandP}" transform="translate(0 -3.5) scale(1 .86)"/>
    <circle cy="3" r="8" fill="${C.terra}"/><circle cy="3" r="3.2" fill="${C.terraL}"/>`;
}

function envelopePart() {
  return `<g transform="translate(${AV.x} 66)"><g class="ll-env">
    ${envelopeArt()}
  </g></g>`;
}

// The scene's envelope on its own, small beside a note about the code that is on its way.
export const envelopeBadge = () => `<svg class="mail-badge" viewBox="-38 -27 76 54" aria-hidden="true" focusable="false">${envelopeArt()}</svg>`;

function checkPart() {
  return `<g transform="translate(${AV.x} 160)"><g class="ll-check"><circle r="27" fill="${C.sageD}"/><circle r="25" cx="-1.4" cy="-2" fill="${C.sage}"/>
    <path d="M-11 0.5L-3.5 8L11.5 -7" stroke="${C.chalk}" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g></g>`;
}

function notePart() {
  return `<rect x="${W / 2 - 46}" y="196" width="92" height="7" rx="3.5" fill="${C.line2}"/><rect x="${W / 2 - 29}" y="209" width="58" height="6" rx="3" fill="${C.line}"/>`;
}

function shieldPart() {
  return `<g transform="translate(42.5 ${PASS_Y + 14})"><g class="ll-shield">
    <path d="M0 -15L12.5 -10.5V0.5C12.5 8.5 6 13 0 15.5C-6 13 -12.5 8.5 -12.5 0.5V-10.5Z" fill="${C.sageD}" stroke="${C.sageD}" stroke-width="3.4" stroke-linejoin="round"/>
    <path d="M0 -15L12.5 -10.5V0.5C12.5 8.5 6 13 0 15.5Z" fill="${C.sage}" stroke="${C.sage}" stroke-width="3.4" stroke-linejoin="round"/>
    <path d="M-5.2 0.4L-1.4 4.2L5.6 -3.2" stroke="${C.chalk}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g></g>`;
}

const DONE_BUTTON_Y = 232;

function penTip(model, mail) {
  if (mail && !model.cover) {
    const i = Math.min(typed.code, BOXES - 1);
    return [BOX_X + i * (BOX.w + BOX.gap) + BOX.w - 5, EMAIL_Y + 15];
  }
  if (model.cover) return [DOT.x + typed.password * DOT.step - 4 - dotShift(), PASS_Y + 18];
  return [caretX() + 1 - emailShift(), EMAIL_Y + 18];
}

function pencilPart(tip, steep) {
  return `<g class="ll-pen-at" transform="translate(${r1(tip[0])} ${r1(tip[1])})"><g class="ll-pen"><g transform="rotate(${steep ? -50 : -24})">
    <path d="M1.5 0L15 -6V6Z" fill="${C.sandP}" stroke="${C.sandP}" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M1.5 0L6.8 -2.3V2.3Z" fill="${C.pine}" stroke="${C.pine}" stroke-width="2.2" stroke-linejoin="round"/>
    <rect x="14" y="-6.6" width="42" height="13.2" rx="2.6" fill="${C.sand}"/>
    <rect x="14" y="1.9" width="42" height="4.7" fill="${C.sandD}"/>
    <rect x="55" y="-7.2" width="8.5" height="14.4" rx="2.2" fill="${C.line2}"/>
    <rect x="61" y="-6.6" width="12.5" height="13.2" rx="5.5" fill="${C.terraL}"/>
  </g></g></g>`;
}

const BADGE = [188, 36];

function badgeArt(open) {
  const [base, face, lit, ink] = open ? [C.sageD, C.sage, C.sageL, C.sageD] : [C.clay, C.terra, C.terraL, C.clay];
  const hinge = open ? ' transform="translate(0 -5.5) rotate(-30 -7.5 -1)"' : "";
  return `<circle r="31" fill="${base}"/><circle r="29.2" cx="-1.4" cy="-1.8" fill="${face}"/>
    <path d="M-20.5 -12.5A23.5 23.5 0 0 1 -8 -22" stroke="${lit}" stroke-width="4" stroke-linecap="round" fill="none"/>
    <g${hinge}><g class="ll-shackle"><path d="M-7.5 -1V-8.5A7.5 7.5 0 0 1 7.5 -8.5V-1" stroke="${C.chalk}" stroke-width="4.8" stroke-linecap="round" fill="none"/></g></g>
    <rect x="-12.5" y="-3" width="25" height="19.5" rx="5.5" fill="${C.chalk}"/>
    <circle cy="5" r="3" fill="${ink}"/><rect x="-1.3" y="5.5" width="2.6" height="6" rx="1.3" fill="${ink}"/>`;
}

function lockPart(open) {
  return `<g transform="translate(${BADGE[0]} ${BADGE[1]})"><g class="ll-bob"><g class="ll-badge">
    ${badgeArt(open)}
  </g></g></g>`;
}

// The scene's terracotta padlock on its own, small beside a note.
export const lockBadge = () => `<svg class="lock-badge" viewBox="-32 -32 64 64" aria-hidden="true" focusable="false">${badgeArt(false)}</svg>`;

const SPARKS = Array.from({ length: 14 }, (_, i) => ({
  angle: -Math.PI / 2 + (i / 14) * Math.PI * 2 + (i % 2 ? 0.2 : 0),
  far: [78, 62, 50][i % 3],
  size: [6.4, 5, 4.2][i % 3],
  color: [C.terra, C.sand, C.sage, C.gold, C.terraL, C.lav, C.sageL][i % 7],
  plus: i % 3 === 1,
}));

function sparkMarkup([cx, cy], cls) {
  return SPARKS.map((s) => {
    const shape = s.plus
      ? `<g class="${cls}" opacity="0"><rect x="-7" y="-2.3" width="14" height="4.6" rx="2.3" fill="${s.color}"/><rect x="-2.3" y="-7" width="4.6" height="14" rx="2.3" fill="${s.color}"/></g>`
      : `<circle class="${cls}" r="${s.size}" fill="${s.color}" opacity="0"/>`;
    return `<g transform="translate(${cx} ${cy})">${shape}</g>`;
  }).join("");
}

const burstPart = () => `${sparkMarkup(BADGE, "ll-spark")}${sparkMarkup([AV.x, 160], "ll-confetti")}`;

function screenOf(model) {
  if (model.done) return "done";
  if (shown.mail) return "mail";
  return model.stage === 2 ? "new" : "known";
}

function track(model) {
  if (model.stage !== 2 || model.done) shown.mail = "";
  else if (model.hold === "mail") shown.mail = "mail";
  else if (model.hold === "progress") shown.mail = shown.mail ? "busy" : "";
  else if (shown.mail !== "busy") shown.mail = "";
  const key = `${model.stage}|${model.done}|${Boolean(shown.mail)}`;
  if (shown.key && shown.key !== key) {
    typed.password = 0;
    typed.code = 0;
    typed.focus = "";
  }
  shown.key = key;
  const working = model.progress === "working";
  if (working !== (shown.progress === "working")) queueMicrotask(() => (working ? spinGears() : settleGears()));
  shown.progress = model.progress;
  if (model.done && shown.done === false) queueMicrotask(() => unlock(false));
  shown.done = model.done;
}

function buttonMode(model) {
  if (model.hold !== "progress") return "idle";
  return model.progress === "done" ? "done" : model.progress === "working" ? "working" : "idle";
}

function partList(model, layout) {
  const l = LAYOUTS[layout];
  const screen = screenOf(model);
  const at = (markup) => onPhone(l, markup);
  const sways = new Map(l.sway.map(([index, period, delay]) => [index, [period, delay]]));
  const leaves = l.leaves.map((leaf, i) => [`leaf-${i}`, "fade", leafPart(leaf, sways.get(i)), "back"]);
  const phone = [
    ["phone", "fade", at(phonePart()), "front"],
    ["head", "fade", at(headerPart(screen === "new" || screen === "mail" ? "new" : "known")), "front"],
  ];
  if (screen === "known" || screen === "done") phone.push(["avatar-1", "flip", at(facePart(typed.face)), "front"]);
  if (screen === "new") phone.push(["avatar-2", "flip", at(newAvatarPart(Math.min(typed.email, SEGMENTS))), "front"]);
  if (screen === "mail") phone.push(["envelope", "mail", at(envelopePart()), "front"], ["code", "slide", at(codePart()), "front"]);
  if (screen === "known" || screen === "new") phone.push(["email", "slide", at(emailPart()), "front"]);
  if (screen === "known" || screen === "new" || (screen === "mail" && (model.cover || typed.password > 0))) phone.push(["pass", "slide", at(passwordPart(model.cover)), "front"]);
  if (screen === "done") phone.push(["check", "pop", at(checkPart()), "front"], ["note", "rise", at(notePart()), "front"]);
  phone.push(["button", "rise", at(buttonPart(screen === "done" ? DONE_BUTTON_Y : BUTTON_Y, buttonMode(model))), "front"]);
  if (model.cover && screen !== "done") phone.push(["shield", "pop", at(shieldPart()), "front"]);
  if (screen === "new" || screen === "mail") phone.push(["pencil", "swoop", at(pencilPart(penTip(model, screen === "mail"), screen === "mail")), "front"]);
  phone.push(["lock", "spin", at(lockPart(screen === "done")), "front"]);
  return [
    ["blob", "rise", blobPart(l.blob, l.dots, l.sparkles), "back"],
    leaves[0],
    ...phone,
    ...leaves.slice(1),
    ["ground", "fade", groundPart(l.ground), "back"],
    ...l.gears.map((gear, i) => [`gear-${i}`, "roll", gearPart(gear, i), "front"]),
    ["burst", "none", at(burstPart()), "front"],
  ];
}

const calm = () => reducedMotion();

const part = (tools, key) => {
  try {
    return tools.part(key);
  } catch {
    return null;
  }
};

const inPart = (key, selector) => frameNode()?.querySelector(`[data-part="${key}"] ${selector}`) ?? null;

function glide(row, offset, animate, delay = 0) {
  if (!row) return;
  const old = Number((row.getAttribute("transform") ?? "").match(/-?[\d.]+/)?.[0] ?? 0);
  const next = -offset;
  if (offset > 0) row.parentNode?.setAttribute("mask", "url(#l-luna-fade)");
  else row.parentNode?.removeAttribute("mask");
  if (Math.abs(old - next) < 0.05) return;
  const extra = animate ? parseFloat(getComputedStyle(row).translate) || 0 : 0;
  row.getAnimations().forEach((animation) => animation.cancel());
  row.setAttribute("transform", `translate(${next} 0)`);
  const from = r1(old + extra - next);
  if (animate && Math.abs(from) > 0.2) row.animate([{ translate: `${from}px 0px` }, { translate: "0px 0px" }], { duration: 120, delay, easing: "ease-out", fill: "backwards" });
}

function paintEmail(tools, animate = false) {
  const view = part(tools, "email");
  const row = view?.querySelector(".ll-row");
  if (!row) return;
  const layout = glyphLayout();
  const have = row.querySelectorAll(".ll-pill").length;
  if (have < layout.length) row.querySelector(".ll-at")?.insertAdjacentHTML("beforebegin", layout.slice(have).map(pillMarkup).join(""));
  row.querySelectorAll(".ll-pill").forEach((pill, i) => {
    const glyph = layout[i];
    if (glyph) {
      pill.setAttribute("x", r1(glyph.x));
      pill.setAttribute("width", glyph.w);
    }
    pill.setAttribute("opacity", glyph && !glyph.ring ? 1 : 0);
  });
  const ring = layout.find((glyph) => glyph.ring);
  const circle = row.querySelector(".ll-at");
  if (circle && ring) circle.setAttribute("cx", r1(ring.x + ring.w / 2));
  circle?.setAttribute("opacity", ring ? 1 : 0);
  row.querySelector(".ll-caret")?.setAttribute("x", r1(caretX(layout)));
  view.querySelector(".ll-hint")?.setAttribute("opacity", !typed.email && typed.focus !== "email" ? 1 : 0);
  glide(row, emailShift(layout), animate && !tools.reduced());
}

function paintPassword(tools, animate = false) {
  const view = part(tools, "pass");
  const row = view?.querySelector(".ll-row");
  if (!row) return;
  const have = row.querySelectorAll(".ll-dot").length;
  if (have < typed.password) row.insertAdjacentHTML("beforeend", Array.from({ length: typed.password - have }, (_, k) => dotMarkup(have + k)).join(""));
  row.querySelectorAll(".ll-dot").forEach((dot, i) => {
    if (i >= typed.password) dot.getAnimations().forEach((animation) => animation.cancel());
    dot.setAttribute("opacity", i < typed.password ? 1 : 0);
  });
  view.querySelector(".ll-hint")?.setAttribute("opacity", typed.password || tools.model.cover ? 0 : 1);
  glide(row, dotShift(), animate && !tools.reduced());
}

function paintSegments(tools, animate) {
  const view = part(tools, "avatar-2");
  if (!view) return;
  const count = Math.min(typed.email, SEGMENTS);
  const segs = [...view.querySelectorAll(".ll-seg")];
  const before = segs.filter((seg) => seg.getAttribute("opacity") === "1").length;
  segs.forEach((seg, i) => seg.setAttribute("opacity", i < count ? 1 : 0));
  const plus = view.querySelector(".ll-plus");
  const born = view.querySelector(".ll-born");
  const full = count >= SEGMENTS;
  const wasFull = born?.getAttribute("opacity") === "1";
  plus?.setAttribute("opacity", full ? 0 : 1);
  born?.setAttribute("opacity", full ? 1 : 0);
  if (!animate) return;
  if (count > before) play(segs[count - 1], [{ opacity: 0, scale: "0.4" }, { opacity: 1, scale: "1.2", offset: 0.6 }, { opacity: 1, scale: "1" }], { duration: 300, easing: SNAP });
  if (full && !wasFull) {
    play(born, [{ scale: "0", rotate: "-40deg" }, { scale: "1.22", rotate: "8deg", offset: 0.6 }, { scale: "1", rotate: "0deg" }], { duration: 560, easing: SNAP });
    play(view.querySelector(".ll-avatar"), [{ scale: "1" }, { scale: "1.14", offset: 0.35 }, { scale: "0.97", offset: 0.7 }, { scale: "1" }], { duration: 520, easing: "ease-out" });
  } else if (!full) play(plus, [{ scale: "1", rotate: "0deg" }, { scale: "0.82", rotate: "45deg", offset: 0.4 }, { scale: "1", rotate: "90deg" }], { duration: 300, easing: "ease-out" });
}

function movePen(tools) {
  const at = part(tools, "pencil")?.querySelector(".ll-pen-at");
  if (!at) return;
  const [x, y] = penTip(tools.model, Boolean(shown.mail));
  const old = (at.getAttribute("transform").match(/-?[\d.]+/g) ?? [x, y]).map(Number);
  at.setAttribute("transform", `translate(${r1(x)} ${r1(y)})`);
  const dx = r1(old[0] - x);
  const dy = r1(old[1] - y);
  if (tools.reduced() || Math.abs(dx) + Math.abs(dy) < 0.5) return;
  play(at.querySelector(".ll-pen"), [
    { translate: `${dx}px ${dy}px`, rotate: "0deg" },
    { translate: `${r1(dx * 0.35)}px ${r1(dy * 0.35 - 6)}px`, rotate: "-9deg", offset: 0.45 },
    { translate: "0px 0px", rotate: "0deg" },
  ], { duration: Math.abs(dy) > 12 ? 420 : 240, easing: "ease-out" });
}

function scribble(tools) {
  const pen = part(tools, "pencil")?.querySelector(".ll-pen");
  if (!pen || tools.reduced() || pen.getAnimations().length) return;
  play(pen, [{ rotate: "0deg", translate: "0px 0px" }, { rotate: "6deg", translate: "0px -3px", offset: 0.4 }, { rotate: "0deg", translate: "0px 0px" }], { duration: 200, easing: "ease-out" });
}

function setFace(tools, seed, animate) {
  if (typed.face === seed) return;
  typed.face = seed;
  const view = part(tools, "avatar-1");
  const face = view?.querySelector(".ll-face");
  const avatar = view?.querySelector(".ll-avatar");
  if (!face || !avatar) return;
  const swap = () => {
    face.innerHTML = faceInner(faceOf(typed.face));
  };
  if (!animate || tools.reduced()) {
    avatar.getAnimations().forEach((animation) => animation.cancel());
    swap();
    return;
  }
  play(avatar, [{ scale: "1 1" }, { scale: "0.02 1" }], { duration: 150, easing: "ease-in" })
    .finished.then(() => {
      swap();
      play(avatar, [
        { scale: "0.02 1", rotate: "0deg" },
        { scale: "1.16 1.06", rotate: "-6deg", offset: 0.55 },
        { scale: "0.97 1", rotate: "2deg", offset: 0.8 },
        { scale: "1 1", rotate: "0deg" },
      ], { duration: 420, easing: "ease-out" });
    })
    .catch(() => {});
}

function typeEmail(tools, length, seed) {
  const before = typed.email;
  const ringBefore = glyphLayout().some((glyph) => glyph.ring);
  if (length > before + 1) {
    typed.pills = [];
    for (let i = 0; i < length; i += 1) addGlyph(seed, i);
  } else if (length === before + 1) addGlyph(seed, length - 1);
  typed.pills.length = length;
  typed.email = length;
  paintEmail(tools, true);
  paintSegments(tools, !tools.reduced());
  movePen(tools);
  const row = part(tools, "email")?.querySelector(".ll-row");
  if (length > before && length > 0 && row && !tools.reduced()) {
    const layout = glyphLayout();
    if (!layout[length - 1].ring) play(row.querySelectorAll(".ll-pill")[length - 1], [{ scale: "0", translate: "0px 4px" }, { scale: "1.35", translate: "0px -2px", offset: 0.55 }, { scale: "1", translate: "0px 0px" }], { duration: 260, easing: SNAP });
    if (!ringBefore && layout.some((glyph) => glyph.ring)) {
      play(row.querySelector(".ll-at"), [{ scale: "0", rotate: "-120deg" }, { scale: "1.5", rotate: "20deg", offset: 0.6 }, { scale: "1", rotate: "0deg" }], { duration: 380, easing: SNAP });
    }
    if (length === before + 1) scribble(tools);
  }
  clearTimeout(timers.face);
  if (length < 4) setFace(tools, 0, false);
  else timers.face = setTimeout(() => setFace(tools, seed, true), 420);
}

function typePassword(tools, length) {
  const before = typed.password;
  typed.password = length;
  paintPassword(tools, true);
  movePen(tools);
  const dots = part(tools, "pass")?.querySelectorAll(".ll-dot") ?? [];
  if (length > before && length > 0 && !tools.reduced()) {
    play(dots[length - 1], [{ scale: "0", translate: "0px -7px" }, { scale: "1.45", translate: "0px 1px", offset: 0.55 }, { scale: "1", translate: "0px 0px" }], { duration: 250, easing: SNAP });
    play(inPart("shield", ".ll-shield"), [{ scale: "1" }, { scale: "1.18", offset: 0.4 }, { scale: "1" }], { duration: 220, easing: "ease-out" });
    if (length === before + 1) scribble(tools);
  }
}

function typeCode(tools, length) {
  const before = typed.code;
  typed.code = Math.min(length, BOXES);
  const view = part(tools, "code");
  if (!view) return;
  const digits = view.querySelectorAll(".ll-digit");
  digits.forEach((digit, i) => digit.setAttribute("opacity", i < typed.code ? 1 : 0));
  paintFocus(tools);
  movePen(tools);
  if (typed.code <= before || tools.reduced()) return;
  play(digits[typed.code - 1], [{ translate: "0px -12px", opacity: 0 }, { translate: "0px 2px", opacity: 1, offset: 0.6 }, { translate: "0px 0px", opacity: 1 }], { duration: 300, easing: SNAP });
  if (typed.code === BOXES) {
    digits.forEach((digit, i) => {
      if (i < BOXES - 1) play(digit, [{ translate: "0px 0px" }, { translate: "0px -6px", offset: 0.4 }, { translate: "0px 0px" }], { duration: 320, delay: 160 + i * 45, easing: "ease-out" });
    });
    play(inPart("envelope", ".ll-env"), [{ scale: "1", rotate: "0deg" }, { scale: "1.12", rotate: "-5deg", offset: 0.4 }, { scale: "1", rotate: "0deg" }], { duration: 480, delay: 360, easing: "ease-out" });
  }
}

function paintFocus(tools) {
  const email = part(tools, "email");
  if (email) {
    const on = typed.focus === "email";
    const ring = email.querySelector(".ll-ring");
    const was = ring?.getAttribute("opacity") === "1";
    [".ll-ring", ".ll-lit", ".ll-caret"].forEach((selector) => email.querySelector(selector)?.setAttribute("opacity", on ? 1 : 0));
    email.querySelector(".ll-hint")?.setAttribute("opacity", !on && !typed.email ? 1 : 0);
    if (on && !was && !tools.reduced()) play(ring, [{ opacity: 0, scale: "0.94" }, { opacity: 1, scale: "1" }], { duration: 220, easing: SNAP });
  }
  const code = part(tools, "code");
  if (code) {
    const active = Math.min(typed.code, BOXES - 1);
    code.querySelectorAll(".ll-box-ring").forEach((ring, i) => ring.setAttribute("opacity", typed.focus === "code" && i === active && typed.code < BOXES ? 1 : 0));
  }
}

function spinGears() {
  if (calm()) return;
  play(inPart("button", ".ll-button"), [{ scale: "1" }, { scale: "0.93 0.88", offset: 0.35 }, { scale: "1.02" , offset: 0.7 }, { scale: "1" }], { duration: 340, easing: "ease-out" });
  frameNode()?.querySelectorAll('[data-part="button"] .ll-busy').forEach((dot, i) => dot.animate(
    [{ opacity: 0.35, translate: "0px 0px" }, { opacity: 1, translate: "0px -3px", offset: 0.4 }, { opacity: 0.35, translate: "0px 0px" }],
    { duration: 720, delay: i * 140, iterations: 6, easing: "ease-in-out", fill: "backwards" },
  ));
  const gears = [...(frameNode()?.querySelectorAll('[data-part^="gear-"] .ll-gear') ?? [])];
  live.gears = gears.map((gear, i) => gear.animate(
    [{ rotate: "0deg", easing: "ease-in" }, { rotate: `${i ? -120 : 90}deg`, offset: 0.08, easing: "linear" }, { rotate: `${i ? -2880 : 2160}deg` }],
    { duration: 6000 },
  ));
}

function settleGears() {
  live.gears.forEach((animation, i) => {
    const gear = animation.effect?.target;
    if (!gear || animation.playState !== "running") return;
    const angle = parseFloat(getComputedStyle(gear).rotate) || 0;
    const step = i ? 60 : 45;
    const target = i ? Math.floor((angle - 50) / step) * step : Math.ceil((angle + 40) / step) * step;
    animation.cancel();
    gear.animate([{ rotate: `${r1(angle)}deg` }, { rotate: `${target}deg` }], { duration: 560, easing: "cubic-bezier(0.25, 0.9, 0.35, 1.25)" });
  });
  live.gears = [];
}

function burst(selector, delay, reach) {
  const nodes = frameNode()?.querySelectorAll(`[data-part="burst"] ${selector}`) ?? [];
  nodes.forEach((node, i) => {
    const { angle, far } = SPARKS[i];
    const to = (k) => `${r1(Math.cos(angle) * far * reach * k)}px ${r1(Math.sin(angle) * far * reach * k)}px`;
    play(node, [
      { translate: to(0.15), scale: "0.3", opacity: 0, rotate: "0deg" },
      { translate: to(0.72), scale: "1.3", opacity: 1, rotate: "60deg", offset: 0.32 },
      { translate: to(0.94), scale: "1", opacity: 1, rotate: "110deg", offset: 0.66 },
      { translate: to(1.06), scale: "0.2", opacity: 0, rotate: "160deg" },
    ], { duration: 1000, delay: delay + (i % 4) * 45, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" });
  });
}

function unlock(big) {
  if (calm()) return;
  play(inPart("lock", ".ll-shackle"), [
    { translate: "-2.75px 4.76px", rotate: "30deg" },
    { translate: "-2.75px 4.76px", rotate: "30deg", offset: 0.28, easing: "cubic-bezier(0.3, 1.6, 0.5, 1)" },
    { translate: "0px 0px", rotate: "0deg" },
  ], { duration: 820, delay: big ? 260 : 120, fill: "backwards" });
  play(inPart("lock", ".ll-badge"), [
    { scale: "1", rotate: "0deg" },
    { scale: "1.28", rotate: "-10deg", offset: 0.4 },
    { scale: "0.94", rotate: "4deg", offset: 0.72 },
    { scale: "1", rotate: "0deg" },
  ], { duration: 760, delay: big ? 420 : 300, easing: "ease-out" });
  burst(".ll-spark", big ? 480 : 380, big ? 1.15 : 0.85);
}

function rigs() {
  return [...(frameNode()?.querySelectorAll(".ll-rig") ?? [])];
}

function wince(tools) {
  if (tools.reduced()) return;
  rigs().forEach((rig) => play(rig, [
    { translate: "0px 0px" },
    { translate: "-13px 0px", offset: 0.14 },
    { translate: "11px 0px", offset: 0.3 },
    { translate: "-8px 0px", offset: 0.46 },
    { translate: "5px 0px", offset: 0.62 },
    { translate: "-2px 0px", offset: 0.8 },
    { translate: "0px 0px" },
  ], { duration: 560, easing: "ease-out" }));
  const key = shown.mail && !tools.model.cover ? "code" : tools.model.cover || typed.password || typed.email ? "pass" : "email";
  const flashes = part(tools, key)?.querySelectorAll(".ll-flash") ?? [];
  flashes.forEach((flash) => play(flash, [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0.35, offset: 0.4 }, { opacity: 0.9, offset: 0.6 }, { opacity: 0 }], { duration: 760, easing: "ease-out" }));
  if (key === "pass") {
    part(tools, "pass")?.querySelectorAll(".ll-dot").forEach((dot, i) => {
      if (i < typed.password) play(dot, [{ translate: "0px 0px" }, { translate: `0px ${i % 2 ? -4 : 4}px`, offset: 0.3 }, { translate: "0px 0px" }], { duration: 300, delay: i * 18, easing: "ease-out" });
    });
  }
  clearTimeout(timers.sync);
  timers.sync = setTimeout(() => dropDots(tools), 460);
}

function dropDots(tools) {
  const input = shadow.root?.getElementById("password");
  const length = input ? input.value.length : typed.password;
  if (length >= typed.password) return;
  const view = part(tools, "pass");
  const row = view?.querySelector(".ll-row");
  const dots = row?.querySelectorAll(".ll-dot") ?? [];
  const before = typed.password;
  typed.password = length;
  dots.forEach((dot, i) => {
    if (i < length || i >= before) return;
    dot.setAttribute("opacity", 0);
    if (!tools.reduced()) play(dot, [{ translate: "0px 0px", opacity: 1 }, { translate: `0px ${14 + (i % 3) * 4}px`, opacity: 0 }], { duration: 360, delay: Math.min(i - length, 14) * 22, easing: "cubic-bezier(0.5, 0, 0.9, 0.5)", fill: "backwards" });
  });
  view?.querySelector(".ll-hint")?.setAttribute("opacity", length || tools.model.cover ? 0 : 1);
  glide(row, dotShift(), !tools.reduced(), 420);
  movePen(tools);
}

function celebrate(tools) {
  if (tools.reduced()) return;
  unlock(true);
  play(inPart("check", ".ll-check"), [{ scale: "1", rotate: "0deg" }, { scale: "1.32", rotate: "-12deg", offset: 0.35 }, { scale: "0.92", rotate: "4deg", offset: 0.7 }, { scale: "1", rotate: "0deg" }], { duration: 640, delay: 520, easing: "ease-out" });
  burst(".ll-confetti", 600, 1.35);
  rigs().forEach((rig) => play(rig, [
    { translate: "0px 0px" },
    { translate: "0px -20px", offset: 0.3 },
    { translate: "0px 4px", offset: 0.62 },
    { translate: "0px 0px" },
  ], { duration: 820, delay: 440, easing: "cubic-bezier(0.3, 0.8, 0.4, 1)" }));
}

function wave(tools) {
  if (tools.reduced()) return;
  play(inPart("avatar-1", ".ll-avatar") ?? inPart("avatar-2", ".ll-avatar"), [
    { translate: "0px 0px", rotate: "0deg" },
    { translate: "0px -8px", rotate: "-9deg", offset: 0.3 },
    { translate: "0px 0px", rotate: "7deg", offset: 0.6 },
    { translate: "0px 0px", rotate: "0deg" },
  ], { duration: 680, delay: 140, easing: "ease-in-out" });
  play(inPart("lock", ".ll-badge"), [{ rotate: "0deg" }, { rotate: "-14deg", offset: 0.3 }, { rotate: "9deg", offset: 0.6 }, { rotate: "0deg" }], { duration: 620, delay: 260, easing: "ease-in-out" });
}

function arrive(tools) {
  if (tools.reduced()) return;
  rigs().forEach((rig) => play(rig, [
    { opacity: 0, translate: "0px 190px", rotate: "-9deg", easing: "cubic-bezier(0.2, 0.75, 0.3, 1)" },
    { opacity: 1, translate: "0px -16px", rotate: "2deg", offset: 0.6, easing: "ease-in-out" },
    { opacity: 1, translate: "0px 3px", rotate: "-0.5deg", offset: 0.82, easing: "ease-in-out" },
    { opacity: 1, translate: "0px 0px", rotate: "0deg" },
  ], { duration: 1000, delay: 12, fill: "backwards" }));
  play(inPart("lock", ".ll-shackle"), [
    { translate: "0px -5.5px", rotate: "-30deg" },
    { translate: "0px -5.5px", rotate: "-30deg", offset: 0.55, easing: "cubic-bezier(0.5, 0, 0.75, 0)" },
    { translate: "0px 1.5px", rotate: "0deg", offset: 0.8, easing: "ease-out" },
    { translate: "0px 0px", rotate: "0deg" },
  ], { duration: 900, delay: 700, fill: "backwards" });
  play(inPart("lock", ".ll-badge"), [{ scale: "1" }, { scale: "0.86 0.92", offset: 0.35 }, { scale: "1.08", offset: 0.7 }, { scale: "1" }], { duration: 380, delay: 1430, easing: "ease-out" });
  burst(".ll-spark", 1450, 0.62);
  frameNode()?.querySelectorAll('[data-part^="leaf-"] .ll-leaf').forEach((leaf, i) => play(leaf, [
    { scale: "0.05", rotate: `${i % 2 ? 30 : -30}deg` },
    { scale: "1.08", rotate: `${i % 2 ? -5 : 5}deg`, offset: 0.62 },
    { scale: "1", rotate: "0deg" },
  ], { duration: 900, delay: i ? 400 + i * 56 : 20, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)", fill: "backwards" }));
}

function repaint(tools) {
  paintEmail(tools);
  paintSegments(tools, false);
  paintFocus(tools);
  paintPassword(tools);
  part(tools, "code")?.querySelectorAll(".ll-digit").forEach((digit, i) => digit.setAttribute("opacity", i < typed.code ? 1 : 0));
  const face = part(tools, "avatar-1")?.querySelector(".ll-face");
  if (face) face.innerHTML = faceInner(faceOf(typed.face));
  movePen(tools);
}

function forget(tools, all) {
  clearTimeout(timers.face);
  clearTimeout(timers.sync);
  if (all) {
    typed.email = 0;
    typed.pills = [];
    typed.face = 0;
  }
  typed.password = 0;
  typed.code = 0;
  typed.focus = "";
  repaint(tools);
}

export default {
  id: "l-luna",
  mascot: true,
  rewind,
  first: ["blob", "leaf-0", "phone"],
  drift: { blob: 4, leaf: 18, ground: 0, phone: 0, head: 0, avatar: 0, envelope: 0, code: 0, email: 0, pass: 0, check: 0, note: 0, button: 0, shield: 0, pencil: 9, lock: 5, gear: 12, burst: 0 },
  enters: {
    flip: { frames: [{ opacity: 0, scale: "0 1" }, { opacity: 1, scale: "1.14 1", offset: 0.6 }, { opacity: 1, scale: "1 1" }], duration: 540, easing: SNAP },
    slide: { frames: [{ opacity: 0, translate: "-24px 0" }, { opacity: 1, translate: "3px 0", offset: 0.7 }, { opacity: 1, translate: "0 0" }], duration: 540, easing: SNAP },
    mail: { frames: [{ opacity: 0, translate: "120px -130px", rotate: "30deg", scale: "0.5" }, { opacity: 1, translate: "-6px 8px", rotate: "-8deg", scale: "1.06", offset: 0.68 }, { opacity: 1, translate: "0 0", rotate: "0deg", scale: "1" }], duration: 920, easing: "cubic-bezier(0.25, 0.8, 0.35, 1)" },
    swoop: { frames: [{ opacity: 0, translate: "90px -60px", rotate: "40deg" }, { opacity: 1, translate: "-4px 3px", rotate: "-6deg", offset: 0.7 }, { opacity: 1, translate: "0 0", rotate: "0deg" }], duration: 780, easing: SNAP },
    spin: { frames: [{ scale: "0", rotate: "-160deg" }, { scale: "1.2", rotate: "12deg", offset: 0.62 }, { scale: "1", rotate: "0deg" }], duration: 800, easing: "cubic-bezier(0.3, 0.8, 0.4, 1)" },
    roll: { frames: [{ opacity: 0, translate: "-90px 0", rotate: "-240deg" }, { opacity: 1, translate: "5px 0", rotate: "10deg", offset: 0.72 }, { opacity: 1, translate: "0 0", rotate: "0deg" }], duration: 960, easing: "cubic-bezier(0.25, 0.8, 0.35, 1)" },
    none: { frames: [{ opacity: 1 }, { opacity: 1 }], duration: 1, easing: "linear" },
  },

  parts(model, layout) {
    track(model);
    return partList(model, layout);
  },

  react(moment, args, tools) {
    if (moment === "type") {
      const [field, length, seed] = args;
      if (field === "email") typeEmail(tools, length, seed);
      if (field === "password") typePassword(tools, length);
      if (field === "code") typeCode(tools, length);
      return undefined;
    }
    if (moment === "look") {
      const focus = args[1] > 0.5 ? (shown.mail ? "code" : "email") : "";
      if (focus === typed.focus) return undefined;
      typed.focus = focus;
      paintFocus(tools);
      movePen(tools);
      return undefined;
    }
    if (moment === "talk") {
      if (typed.password || typed.code) forget(tools, false);
      return [];
    }
    if (moment === "wince") queueMicrotask(() => wince(tools));
    if (moment === "wave") wave(tools);
    if (moment === "celebrate") celebrate(tools);
    if (moment === "arrive") {
      forget(tools, true);
      arrive(tools);
    }
    if (moment === "reset" || moment === "preview") forget(tools, true);
    return undefined;
  },
};
