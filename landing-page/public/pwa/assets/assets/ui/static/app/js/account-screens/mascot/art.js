// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { POSES, LEG_WIDTHS, HAND_WIDTHS, LEG_SIDES, FX_Y, frame, outline, suckers, mulberry32, r2 } from "./geometry.js";

const MANTLE = "M32 50C32 29 44 16 60 16C76 16 88 29 88 50C88 62 77 71 60 71C43 71 32 62 32 50Z";

const DROP_PATH = "M0 -30C2.5 -22 9 -17 9 -9A9 9 0 0 1 -9 -9C-9 -17 -2.5 -22 0 -30Z";
const CHECK_PATH = "M-5.2 0.4L-1.6 4.2L5.6 -3.6";

function eyeMarkup(x1, x2, y, s) {
  const rx = 3.9 * s;
  const ry = 4.9 * s;
  const open = (x) =>
    `<g class="m-eye" data-cx="${x}" data-cy="${y}"><ellipse cx="${x}" cy="${y}" rx="${r2(rx)}" ry="${r2(ry)}"/>` +
    `<circle class="m-white" cx="${r2(x + 1.3 * s)}" cy="${r2(y - 1.8 * s)}" r="${r2(1.55 * s)}"/>` +
    `<circle class="m-white" cx="${r2(x - 1.3 * s)}" cy="${r2(y + 2 * s)}" r="${r2(0.75 * s)}"/></g>`;
  const arc = (x, happy) =>
    `M${r2(x - 4 * s)} ${r2(y + (happy ? 1.4 : 0.6) * s)}q${r2(4 * s)} ${r2((happy ? -5 : 3.8) * s)} ${r2(8 * s)} 0`;
  return (
    `<g class="m-look">${open(x1)}${open(x2)}` +
    `<path class="m-eye-happy" d="${arc(x1, true)}"/><path class="m-eye-happy" d="${arc(x2, true)}"/>` +
    `<path class="m-eye-closed" d="${arc(x1, false)}"/><path class="m-eye-closed" d="${arc(x2, false)}"/></g>`
  );
}

function faceMarkup() {
  return (
    `<g class="m-brows"><g class="m-brows-n"><path class="m-brow" d="M44.6 38.2q5.2 -3.4 10.4 -1"/>` +
    `<path class="m-brow" d="M65 37.2q5.2 -2.4 10.4 1"/></g>` +
    `<g class="m-brows-w"><path class="m-brow" d="M44.6 40.2q5.2 -1.2 10.4 -4.6"/>` +
    `<path class="m-brow" d="M65 35.6q5.2 3.4 10.4 4.6"/></g></g>` +
    eyeMarkup(50, 70, 47, 1.05) +
    `<g class="m-blush-wrap"><ellipse class="m-blush" cx="42.5" cy="55.5" rx="4.6" ry="2.7"/>` +
    `<ellipse class="m-blush" cx="77.5" cy="55.5" rx="4.6" ry="2.7"/></g>` +
    `<path class="m-mouth" d="M53.6 56.6q6.4 5.6 12.8 0"/>` +
    `<path class="m-mouth-open" d="M53.4 56.2q6.6 10 13.2 0z"/>` +
    `<path class="m-mouth-worried" d="M54.2 59.6q5.8 -4.6 11.6 0"/>`
  );
}

function armMarkup(name, points, widths, side) {
  const samples = frame(points, widths[0], widths[1]);
  const dots = side
    ? suckers(samples, side)
        .map(([x, y, r]) => `<circle class="m-sucker" data-s="${name}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}"/>`)
        .join("")
    : "";
  return `<path class="m-lav" data-arm="${name}" d="${outline(samples)}"/>${dots}`;
}

function splatMarkup() {
  const random = mulberry32(7);
  const cx = 60;
  const cy = FX_Y + 1;
  const rx = 22;
  const ry = 6;
  const count = 18;
  const phaseA = random() * 6;
  const phaseB = random() * 6;
  const points = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    let radius = 1 + 0.13 * Math.sin(3 * angle + phaseA) + 0.09 * Math.sin(5 * angle + phaseB);
    const sideways = Math.abs(Math.cos(angle));
    if (i % 3 === 1 && sideways > 0.55) radius += 0.22 + random() * 0.22;
    else radius += (random() - 0.5) * 0.14;
    points.push([cx + rx * radius * Math.cos(angle), cy + ry * radius * Math.sin(angle)]);
  }
  let d = `M${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 0; i < count; i++) {
    const p0 = points[(i - 1 + count) % count];
    const p1 = points[i];
    const p2 = points[(i + 1) % count];
    const p3 = points[(i + 2) % count];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  d += "Z";
  let drops = "";
  for (let i = 0; i < 9; i++) {
    const side = i % 2 ? 1 : -1;
    const x = cx + side * (rx * (0.95 + random() * 0.4));
    const y = cy + (random() - 0.5) * ry * 1.6;
    const w = 1.2 + random() * 3;
    drops += `<ellipse class="${i % 3 === 0 ? "m-splat-dark" : ""}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" rx="${w.toFixed(2)}" ry="${(w * 0.34).toFixed(2)}"/>`;
  }
  return `<path d="${d}"/>${drops}`;
}

const SPLAT = splatMarkup();
const PALM = '<circle cx="-1.9" cy="-1.5" r="1"/><circle cx="1.8" cy="-1.7" r="1"/><circle cx="0" cy="1.9" r="1"/>';
const DROPLET_COUNT = 24;

let counter = 0;

export function characterMarkup() {
  const id = ++counter;
  const legs = ["g1", "g2", "g3", "g4"]
    .map((name) => armMarkup(name, POSES.rest[name], LEG_WIDTHS[name], LEG_SIDES[name]))
    .join("");
  const hands = armMarkup("hl", POSES.rest.hl, HAND_WIDTHS, 0) + armMarkup("hr", POSES.rest.hr, HAND_WIDTHS, 0);
  let droplets = "";
  for (let i = 0; i < DROPLET_COUNT; i++) droplets += '<circle class="m-fx m-droplet" cx="0" cy="0" r="1" opacity="0"/>';
  return (
    `<defs><clipPath id="m-clip-${id}"><path d="${MANTLE}"/></clipPath></defs>` +
    `<g class="m-ground"><g class="m-splat-wrap"><g class="m-fx m-splat">${SPLAT}</g></g><ellipse class="m-shadow" cx="60" cy="${FX_Y + 2.5}" rx="27" ry="3.4"/></g>` +
    `<ellipse class="m-fx m-ripple" cx="60" cy="${FX_Y}" rx="10" ry="2" opacity="0"/>` +
    `<ellipse class="m-fx m-ripple" cx="60" cy="${FX_Y}" rx="10" ry="2" opacity="0"/>` +
    `<g class="m-pokewrap"><g class="m-body"><g class="m-legs">${legs}</g>` +
    `<g class="m-mantle"><path class="m-lav" d="${MANTLE}"/>` +
    `<g clip-path="url(#m-clip-${id})"><ellipse class="m-lav-s" cx="60" cy="71" rx="32" ry="10" opacity="0.55"/></g>` +
    `<ellipse class="m-lav-h" cx="46" cy="29" rx="8.5" ry="4.5" transform="rotate(-30 46 29)" opacity="0.85"/>` +
    `<circle class="m-mint" cx="72" cy="27" r="2.4"/><circle class="m-mint" cx="78" cy="36" r="1.6"/><circle class="m-mint" cx="43" cy="42" r="1.3"/>` +
    faceMarkup() +
    `</g>` +
    `<g class="m-card"><rect class="m-card-body" x="36" y="61" width="48" height="24" rx="5"/>` +
    `<g class="m-mail m-mail-big" transform="translate(60 71.6) scale(1.2)"><rect class="m-env" x="-6.5" y="-4.6" width="13" height="9.2" rx="1.6"/><path class="m-ink-s m-thin" d="M-5.6 -3.6L0 .9 5.6 -3.6"/></g>` +
    `<g class="m-mail m-mail-small" transform="translate(73 69.4) scale(0.62)"><rect class="m-env" x="-6.5" y="-4.6" width="13" height="9.2" rx="1.6"/><path class="m-ink-s m-thin" d="M-5.6 -3.6L0 .9 5.6 -3.6"/></g>` +
    `<rect class="m-track" x="41" y="76" width="38" height="4.2" rx="2.1"/><rect class="m-fill" x="41" y="76" width="38" height="4.2" rx="2.1"/></g>` +
    `<g class="m-hands"><g class="m-cover-shade" transform="translate(0.9 1.7)"><path data-shade="hl"/><circle data-shade-tip="hl"/><path data-shade="hr"/><circle data-shade-tip="hr"/></g>${hands}` +
    `<circle class="m-lav m-tip" data-tip="hl" cx="0" cy="0" r="0"/><circle class="m-lav m-tip" data-tip="hr" cx="0" cy="0" r="0"/>` +
    `<g class="m-palm" data-palm="hl">${PALM}</g><g class="m-palm" data-palm="hr">${PALM}</g></g>` +
    `</g></g>` +
    `<g class="m-fx m-badge" opacity="0"><circle class="m-badge-ring" r="15.5"/><circle class="m-badge-disc" r="12.6"/><path class="m-badge-check" d="${CHECK_PATH}"/></g>` +
    `<g class="m-drops">${droplets}</g>` +
    `<path class="m-fx m-drop" d="${DROP_PATH}" opacity="0"/>`
  );
}

export function sleepingMarkup() {
  const sleepPoses = {
    g1: [[40, 64], [37, 76], [33, 87], [31, 96], [33.5, 101], [37.5, 100], [36.5, 96.5]],
    g2: [[50, 68], [49, 80], [47, 91], [46.5, 100], [49, 104.5], [52.5, 103], [51, 100]],
  };
  const mirrored = (points) => points.map(([x, y]) => [120 - x, y]);
  const handRight = [[81, 58], [88, 62], [91, 68], [89, 73], [85, 73.5]];
  const legs =
    armMarkup("g1", sleepPoses.g1, LEG_WIDTHS.g1, 1) +
    armMarkup("g2", sleepPoses.g2, LEG_WIDTHS.g2, 1) +
    armMarkup("g3", mirrored(sleepPoses.g2), LEG_WIDTHS.g3, -1) +
    armMarkup("g4", mirrored(sleepPoses.g1), LEG_WIDTHS.g4, -1);
  const hands = armMarkup("hr", handRight, HAND_WIDTHS, 0) + armMarkup("hl", mirrored(handRight), HAND_WIDTHS, 0);
  const closed = (x) => `<path class="m-eye-closed m-shown" d="M${x - 4.2} 47.6q4.2 4 8.4 0"/>`;
  return (
    `<defs><clipPath id="m-sleep-clip"><path d="${MANTLE}"/></clipPath></defs>` +
    `<g>${legs}${hands}<g><path class="m-lav" d="${MANTLE}"/>` +
    `<g clip-path="url(#m-sleep-clip)"><ellipse class="m-lav-s" cx="60" cy="71" rx="32" ry="10" opacity="0.55"/></g>` +
    `<ellipse class="m-lav-h" cx="46" cy="29" rx="8.5" ry="4.5" transform="rotate(-30 46 29)" opacity="0.85"/>` +
    `<circle class="m-mint" cx="72" cy="27" r="2.4"/><circle class="m-mint" cx="78" cy="36" r="1.6"/><circle class="m-mint" cx="43" cy="42" r="1.3"/>` +
    `<path class="m-brow" d="M44.6 38.8q5.2 -2.4 10.4 -0.6"/><path class="m-brow" d="M65 38.2q5.2 -1.8 10.4 0.6"/>` +
    closed(50) + closed(70) +
    `<ellipse class="m-blush" cx="42.5" cy="55.5" rx="4.6" ry="2.7"/><ellipse class="m-blush" cx="77.5" cy="55.5" rx="4.6" ry="2.7"/>` +
    `<path class="m-mouth" d="M55.6 57.6q4.4 3 8.8 0"/>` +
    `<path class="m-cap" d="M38 31C39.5 17 51 8 64.5 8.6C78 9.2 88 17.5 94.5 31.5C90.5 28.8 86.5 27.3 82.5 27.6C82 29 81.6 30 81.4 31Z"/>` +
    `<path class="m-cap-band" d="M36.5 32C43 26.6 77 26.6 83.5 32C84.6 33.2 83.6 35.2 82 34.6C74.5 31.2 45.5 31.2 38 34.6C36.4 35.2 35.4 33.2 36.5 32Z"/>` +
    `<circle class="m-cap-band" cx="96" cy="33.5" r="4.3"/>` +
    `</g></g>`
  );
}
