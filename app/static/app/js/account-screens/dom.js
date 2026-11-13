// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { travels } from "../motion.js";

// The scene lives in a shadow root of its own, so the page's styles stay out of it; lookups go there, not to the document.
export const view = { root: null, signal: null };

export const $ = (selector, root = view.root) => root.querySelector(selector);

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]);

export const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const reducedMotion = () => !travels();

export const finePointer = () => matchMedia("(pointer: fine)").matches;

export const focused = () => view.root?.activeElement ?? null;

export async function settle(animation) {
  try {
    await animation.finished;
  } catch {
    return false;
  }
  return true;
}
