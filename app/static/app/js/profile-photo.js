// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// An own picture is read on the device and drawn anew through a canvas, so nothing of the file, such as the camera, the
// place or the time it was taken, is ever kept or sent.

export const ZOOM_MAX = 4;
export const PHOTO_SIDE = 256;
export const PHOTO_TARGET = 24 * 1024;
export const PHOTO_CAP = 32 * 1024;
export const PHOTO_UNREADABLE = "Dieses Bild kann ich nicht öffnen. Nimm am besten ein JPG oder PNG.";

const SIDES = [PHOTO_SIDE, 208, 160];
const QUALITIES = [0.86, 0.8, 0.72, 0.64, 0.56, 0.48];
const FILE_MAX = 40 * 1024 * 1024;
const WORK_SIDE = PHOTO_SIDE * ZOOM_MAX;

export class PhotoError extends Error {}

export const clampZoom = (zoom) => Math.min(ZOOM_MAX, Math.max(1, Number.isFinite(zoom) ? zoom : 1));

// The part of the picture inside the circle. At zoom 1 the shorter side fills the circle; x and y move the picture, in
// diameters of the circle from its middle, and never so far that the circle shows a gap.
export function cropView({ width, height, zoom = 1, x = 0, y = 0 }) {
  const level = clampZoom(zoom);
  const side = Math.min(width, height) / level;
  const roomX = Math.max(0, (width / side - 1) / 2);
  const roomY = Math.max(0, (height / side - 1) / 2);
  const left = Math.min(roomX, Math.max(-roomX, Number.isFinite(x) ? x : 0));
  const top = Math.min(roomY, Math.max(-roomY, Number.isFinite(y) ? y : 0));
  return { zoom: level, x: left, y: top, side, sx: width / 2 - (left + 0.5) * side, sy: height / 2 - (top + 0.5) * side };
}

// Zooming keeps the spot under the fingers or the pointer where it is; px and py count from the middle of the circle.
export function zoomAt(view, size, zoom, px = 0, py = 0) {
  const level = clampZoom(zoom);
  const grow = level / view.zoom;
  return cropView({ ...size, zoom: level, x: px - (px - view.x) * grow, y: py - (py - view.y) * grow });
}

const blobOf = (canvas, type, quality) => new Promise((done) => canvas.toBlob(done, type, quality));

// WebP where the engine really writes it, an engine without that encoder hands back a PNG, else JPEG; as small as it
// takes to stay near the target and never above the cap, at a smaller size when even the lowest quality is too big.
export async function encodePhoto(source, view, { canvas = () => document.createElement("canvas") } = {}) {
  let type = "image/webp";
  for (const side of SIDES) {
    const out = canvas();
    out.width = side;
    out.height = side;
    const paint = out.getContext("2d");
    paint.fillStyle = "#FFFFFF";
    paint.fillRect(0, 0, side, side);
    paint.imageSmoothingEnabled = true;
    paint.imageSmoothingQuality = "high";
    paint.drawImage(source, view.sx, view.sy, view.side, view.side, 0, 0, side, side);
    let best = null;
    for (const quality of QUALITIES) {
      let blob = await blobOf(out, type, quality);
      if (type === "image/webp" && blob?.type !== type) {
        type = "image/jpeg";
        blob = await blobOf(out, type, quality);
      }
      if (!blob || blob.type !== type) throw new PhotoError("encode");
      if (!best || blob.size < best.blob.size) best = { blob, type, side, quality };
      if (blob.size <= PHOTO_TARGET) return best;
    }
    if (best.blob.size <= PHOTO_CAP) return best;
  }
  throw new PhotoError("too_large");
}

const META_CHUNKS = new Set(["EXIF", "XMP ", "ICCP"]);
const META_FLAGS = 0x20 | 0x08 | 0x04;
const fourcc = (bytes, at) => String.fromCharCode(...bytes.subarray(at, at + 4));

function bareJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new PhotoError("encode");
  const kept = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) throw new PhotoError("encode");
    const marker = bytes[at + 1];
    if (marker === 0xda) {
      kept.push(bytes.subarray(at));
      return kept;
    }
    const end = at + 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
    if (end > bytes.length) throw new PhotoError("encode");
    if (!((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) kept.push(bytes.subarray(at, end));
    at = end;
  }
  throw new PhotoError("encode");
}

function bareWebp(bytes) {
  if (fourcc(bytes, 0) !== "RIFF" || fourcc(bytes, 8) !== "WEBP") throw new PhotoError("encode");
  const kept = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const size = bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16) | (bytes[at + 7] << 24);
    const end = at + 8 + size + (size % 2);
    if (end > bytes.length) throw new PhotoError("encode");
    const name = fourcc(bytes, at);
    if (name === "VP8X") {
      const chunk = bytes.slice(at, end);
      chunk[8] &= ~META_FLAGS;
      kept.push(chunk);
    } else if (!META_CHUNKS.has(name)) kept.push(bytes.subarray(at, end));
    at = end;
  }
  const length = kept.reduce((sum, chunk) => sum + chunk.length, 4);
  const head = new Uint8Array(12);
  head.set([0x52, 0x49, 0x46, 0x46, length & 0xff, (length >> 8) & 0xff, (length >> 16) & 0xff, (length >>> 24) & 0xff, 0x57, 0x45, 0x42, 0x50]);
  return [head, ...kept];
}

// The encoders add tags of their own, such as an Exif and a Photoshop block in a JPEG from Safari or a colour profile
// in a WebP from Chrome. Only the picture itself is kept.
export function bareImage(bytes, type) {
  const parts = type === "image/jpeg" ? bareJpeg(bytes) : type === "image/webp" ? bareWebp(bytes) : null;
  if (!parts) throw new PhotoError("encode");
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((at, part) => {
    out.set(part, at);
    return at + part.length;
  }, 0);
  return out;
}

export async function barePhoto(blob) {
  return new Blob([bareImage(new Uint8Array(await blob.arrayBuffer()), blob.type)], { type: blob.type });
}

export function dataUrlOf(blob) {
  return new Promise((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result));
    reader.onerror = () => fail(new PhotoError("read"));
    reader.readAsDataURL(blob);
  });
}

// An engine without createImageBitmap for files reads it as an image from a data address, which the page policy allows
// where it would block a blob address.
async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {}
  }
  const image = new Image();
  image.src = await dataUrlOf(file);
  await image.decode();
  return image;
}

// The picked file as a working copy just big enough for the sharpest crop at the highest zoom; formats the engine can
// not read, like HEIC on most of them, end here.
export async function readPhoto(file) {
  if (!file || !file.size || file.size > FILE_MAX) throw new PhotoError("file");
  let picture;
  try {
    picture = await decode(file);
  } catch {
    throw new PhotoError("decode");
  }
  const width = picture.naturalWidth || picture.width;
  const height = picture.naturalHeight || picture.height;
  if (!width || !height) throw new PhotoError("decode");
  const scale = Math.min(1, WORK_SIDE / Math.min(width, height));
  const work = document.createElement("canvas");
  work.width = Math.max(1, Math.round(width * scale));
  work.height = Math.max(1, Math.round(height * scale));
  const paint = work.getContext("2d");
  paint.imageSmoothingEnabled = true;
  paint.imageSmoothingQuality = "high";
  paint.drawImage(picture, 0, 0, work.width, work.height);
  picture.close?.();
  return work;
}
