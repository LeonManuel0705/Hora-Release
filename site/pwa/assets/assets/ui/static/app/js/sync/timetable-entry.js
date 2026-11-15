// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { SyncError } from "./client.js";

export const TIMETABLE_STREAM = "timetable";
export const TIMETABLE_VERSION = 1;
export const TIMETABLE_KEYS = ["app-subjects", "app-teachers", "app-rooms", "app-block-times", "app-timetable-edits", "app-ab-weeks", "app-ab-swap"];
const ORIGINS = ["edit", "import", "share"];

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const planOf = (plan) => Object.fromEntries(TIMETABLE_KEYS.map((key) => [key, plan[key] ?? null]));
const isNames = (value) => isObject(value) && Object.values(value).every((name) => typeof name === "string" && name.length <= 200);

function readRecord(record) {
  if (!isObject(record)) return null;
  const { at, origin, device } = record;
  const valid = Number.isSafeInteger(at) && at > 0 && ORIGINS.includes(origin) && typeof device === "string" && device.length > 0 && device.length <= 64;
  return valid ? { at, origin, device } : null;
}

// subjects names the school's own subjects of the sending device by their keys in the plan, as a backup does, so a
// device with the same school finds a renamed subject again. It is optional, and a reader without it still reads the entry.
export function timetableEntry({ record, plan, abReference = null, subjects = null }) {
  const stamp = readRecord(record);
  if (!stamp) throw new SyncError("invalid_entry", { field: "record" });
  if (!isObject(plan)) throw new SyncError("invalid_entry", { field: "plan" });
  const values = planOf(plan);
  if (Object.values(values).every((value) => value === null)) throw new SyncError("invalid_entry", { field: "plan" });
  if (abReference !== null && !isDay(abReference)) throw new SyncError("invalid_entry", { field: "abReference" });
  if (subjects !== null && !isNames(subjects)) throw new SyncError("invalid_entry", { field: "subjects" });
  return { v: TIMETABLE_VERSION, record: stamp, plan: values, abReference, ...(subjects ? { subjects } : {}) };
}

export function readTimetableEntry(value) {
  if (!isObject(value) || value.v !== TIMETABLE_VERSION || !isObject(value.plan)) return null;
  const record = readRecord(value.record);
  const abReference = value.abReference ?? null;
  if (!record || (abReference !== null && !isDay(abReference))) return null;
  return { v: TIMETABLE_VERSION, record, plan: planOf(value.plan), abReference, subjects: isNames(value.subjects) ? value.subjects : {} };
}
