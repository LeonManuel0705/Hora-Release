// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { icon } from "./core.js";
import { cropView, zoomAt, ZOOM_MAX } from "./profile-photo.js";

const SIZES = [[64, "Profil"], [40, "Leiste"], [28, "klein"]];
const KEY_STEP = 0.04;
const KEY_ZOOM = 1.12;

export function cropHtml() {
  const ratio = Math.min(3, Math.max(1, Math.round(globalThis.devicePixelRatio || 1)));
  return `<div class="profile-view" data-view="crop">
    <div class="profile-pick-head"><button class="icon-button" type="button" data-crop-back aria-label="Zurück">${icon("chevron-left")}</button><h2 class="sheet-title" id="profileCropTitle" tabindex="-1">Bild zuschneiden</h2></div>
    <div class="crop-row">
      <div class="crop-stage" data-crop-stage tabindex="0" aria-label="Bildausschnitt. Mit den Pfeiltasten verschieben." aria-describedby="profileCropHint"></div>
      <div class="crop-sizes" aria-hidden="true">${SIZES.map(([size, label]) => `<span class="avatar crop-size" style="--size: ${size}px"><canvas width="${size * ratio}" height="${size * ratio}"></canvas></span><small>${label}</small>`).join("")}</div>
    </div>
    <div class="crop-zoom">${icon("minus")}<input type="range" min="1" max="${ZOOM_MAX}" step="0.01" value="1" aria-label="Zoom" data-crop-zoom>${icon("plus")}</div>
    <p class="crop-hint" id="profileCropHint">Zum Verschieben ziehen, zum Zoomen den Regler oder zwei Finger.</p>
    <p class="profile-photo-error" role="alert" data-photo-error hidden></p>
    <p class="crop-other"><button class="text-button" type="button" data-crop-other><span>Anderes Bild wählen</span></button></p>
    <div class="crop-actions"><button class="btn btn-quiet" type="button" data-crop-cancel>Abbrechen</button><button class="btn btn-primary" type="button" data-crop-apply>Übernehmen</button></div>
  </div>`;
}

// Moves and zooms the picture inside the circle by finger, mouse, wheel, slider and keys, and draws it at the sizes the
// avatar takes. Nothing runs while nobody touches it.
export function mountCrop(view, work, start = {}) {
  const stage = view.querySelector("[data-crop-stage]");
  const slider = view.querySelector("[data-crop-zoom]");
  const previews = [...view.querySelectorAll(".crop-size canvas")];
  const size = { width: work.width, height: work.height };
  const stop = new AbortController();
  const { signal } = stop;
  const pointers = new Map();
  let current = cropView({ ...size, ...start });
  let pinch = null;
  let frame = 0;

  work.classList.add("crop-picture");
  stage.replaceChildren(work);

  function paint() {
    frame = 0;
    const diameter = stage.clientWidth;
    if (!diameter) return;
    const scale = diameter / current.side;
    work.style.transform = `matrix(${scale}, 0, 0, ${scale}, ${-current.sx * scale}, ${-current.sy * scale})`;
    slider.value = String(current.zoom);
    previews.forEach((canvas) => {
      const paintSmall = canvas.getContext("2d");
      paintSmall.imageSmoothingEnabled = true;
      paintSmall.imageSmoothingQuality = "high";
      paintSmall.drawImage(work, current.sx, current.sy, current.side, current.side, 0, 0, canvas.width, canvas.height);
    });
  }

  const set = (next) => {
    current = next;
    frame ||= requestAnimationFrame(paint);
  };

  const spot = (clientX, clientY) => {
    const box = stage.getBoundingClientRect();
    return { x: (clientX - box.left) / box.width - 0.5, y: (clientY - box.top) / box.height - 0.5 };
  };

  const middle = () => {
    const [one, two] = [...pointers.values()];
    return { x: (one.x + two.x) / 2, y: (one.y + two.y) / 2, spread: Math.hypot(one.x - two.x, one.y - two.y) || 1 };
  };

  stage.addEventListener("pointerdown", (event) => {
    if (event.button > 0 || pointers.size >= 2) return;
    stage.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stage.classList.add("is-dragging");
    if (pointers.size === 2) pinch = { ...middle(), zoom: current.zoom };
  }, { signal });

  stage.addEventListener("pointermove", (event) => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const diameter = stage.clientWidth || 1;
    if (pinch && pointers.size === 2) {
      const now = middle();
      const moved = cropView({ ...size, zoom: current.zoom, x: current.x + (now.x - pinch.x) / diameter, y: current.y + (now.y - pinch.y) / diameter });
      const at = spot(now.x, now.y);
      set(zoomAt(moved, size, (pinch.zoom * now.spread) / pinch.spread, at.x, at.y));
      pinch = { ...pinch, x: now.x, y: now.y };
      return;
    }
    set(cropView({ ...size, zoom: current.zoom, x: current.x + (event.clientX - last.x) / diameter, y: current.y + (event.clientY - last.y) / diameter }));
  }, { signal });

  const release = (event) => {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) stage.classList.remove("is-dragging");
  };
  stage.addEventListener("pointerup", release, { signal });
  stage.addEventListener("pointercancel", release, { signal });

  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const at = spot(event.clientX, event.clientY);
    set(zoomAt(current, size, current.zoom * Math.exp((-event.deltaY * lines) / (event.ctrlKey ? 100 : 400)), at.x, at.y));
  }, { signal, passive: false });

  slider.addEventListener("input", () => set(zoomAt(current, size, Number(slider.value))), { signal });

  stage.addEventListener("keydown", (event) => {
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = KEY_STEP * (event.shiftKey ? 4 : 1);
    if (moves[event.key]) set(cropView({ ...size, zoom: current.zoom, x: current.x + moves[event.key][0] * step, y: current.y + moves[event.key][1] * step }));
    else if (event.key === "+" || event.key === "=") set(zoomAt(current, size, current.zoom * KEY_ZOOM));
    else if (event.key === "-") set(zoomAt(current, size, current.zoom / KEY_ZOOM));
    else return;
    event.preventDefault();
  }, { signal });

  const sized = typeof ResizeObserver === "function" ? new ResizeObserver(() => set(current)) : null;
  sized?.observe(stage);
  paint();

  return {
    view: () => ({ ...current }),
    stop() {
      stop.abort();
      sized?.disconnect();
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
