// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { dayDiff, isoDate, isAssessment, isOverdue, toMin } from "./core.js";

export const WRITTEN_DAYS = 14;
export const DUE_DAYS = 14;
export const HOME_BEFORE_EVENT = 45;

export function dueItems(date, deadlines, upcoming) {
  const all = deadlines.map((item) => ({ ...item, source: "deadline", diff: dayDiff(date, item.date) }));
  const own = upcoming.map((task) => ({
    id: task.id, kind: "Aufgabe", title: task.title, subject: task.subject, date: task.date, block: task.block, source: "task", diff: dayDiff(date, task.date),
  }));
  const today = isoDate(date);
  const overdue = all.filter((item) => isOverdue(item, today)).sort((a, b) => a.diff - b.diff);
  const written = all.filter((item) => item.diff < 0 && item.diff >= -WRITTEN_DAYS && isAssessment(item)).sort((a, b) => b.diff - a.diff);
  const soon = [
    ...all.filter((item) => item.diff >= 0 && item.diff <= DUE_DAYS && !item.pinned && item.status !== "abgegeben"),
    ...own.filter((item) => item.diff <= DUE_DAYS),
  ].sort((a, b) => a.diff - b.diff || Number(isAssessment(b)) - Number(isAssessment(a)));
  const pinned = all.filter((item) => item.pinned && item.diff >= 0);
  return { overdue, soon, pinned, written };
}

// The server finds the lesson of an entry only in the stored plan, so one entered in the settings or the setup is looked up here, as on the school page.
export function blockIn(item, lessons) {
  if (item.block && lessons.some((lesson) => lesson.block === item.block && lesson.subject === item.subject)) return item.block;
  return lessons.find((lesson) => lesson.subject === item.subject)?.block || null;
}

export function testAhead(deadlines, day) {
  const iso = isoDate(day.date);
  const endOf = (block) => day.lessons.find((lesson) => lesson.block === block)?.endMin ?? Infinity;
  return deadlines
    .filter((item) => isAssessment(item) && item.date === iso)
    .map((item) => ({ ...item, block: blockIn(item, day.lessons) }))
    .filter((item) => day.nowMin < endOf(item.block))
    .sort((a, b) => (a.block || 99) - (b.block || 99))[0] || null;
}

// Right after school the ride home comes first, unless an event starts within the next 45 minutes or before the bus leaves.
export function homeFirst(bus, event, nowMin) {
  if (!bus) return false;
  if (!event) return true;
  const start = toMin(event.start);
  return start - nowMin > HOME_BEFORE_EVENT && toMin(bus.time) < start;
}
