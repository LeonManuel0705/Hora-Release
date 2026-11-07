// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export const FREQUENCIES = ["daily", "weekly", "monthly", "yearly"];
const LIMIT = 1000;
const DAY = 864e5;

const pad = (value) => String(value).padStart(2, "0");
const isoOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dayOf = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const validIso = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && isoOf(dayOf(value)) === value;
const daysBetween = (from, to) => Math.round((dayOf(to) - dayOf(from)) / DAY);
const shifted = (iso, days) => {
  const date = dayOf(iso);
  return isoOf(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
};

/* The rule as it is stored, or null: { freq, interval, until, count, exceptions }. */
export function normalizeRecurrence(value) {
  if (!value || typeof value !== "object" || !FREQUENCIES.includes(value.freq)) return null;
  const interval = Math.min(12, Math.max(1, Math.round(Number(value.interval) || 1)));
  const count = Number.isFinite(Number(value.count)) && Number(value.count) >= 1 ? Math.min(LIMIT, Math.round(Number(value.count))) : null;
  const until = !count && validIso(value.until) ? value.until : null;
  const exceptions = [...new Set((Array.isArray(value.exceptions) ? value.exceptions : []).filter(validIso))].sort();
  return { freq: value.freq, interval, until, count, exceptions };
}

/* The day of the n-th time the rule comes round, or null when that day does not exist (the 31st in April,
   the 29th of February in a common year). Google skips those days too. */
function nth(start, rule, index) {
  const first = dayOf(start);
  const step = index * rule.interval;
  if (rule.freq === "daily" || rule.freq === "weekly") {
    return isoOf(new Date(first.getFullYear(), first.getMonth(), first.getDate() + step * (rule.freq === "weekly" ? 7 : 1)));
  }
  const months = rule.freq === "monthly" ? step : step * 12;
  const date = new Date(first.getFullYear(), first.getMonth() + months, first.getDate());
  return date.getDate() === first.getDate() ? isoOf(date) : null;
}

/* The start days of an event's occurrences that touch the days from `from` to `to`. An exception still counts
   towards a limit of n times, as in RFC 5545. */
export function occurrenceDates(item, from, to) {
  const rule = normalizeRecurrence(item.recurrence);
  const span = item.endDate && item.endDate > item.date ? daysBetween(item.date, item.endDate) : 0;
  if (!rule) return item.date <= to && shifted(item.date, span) >= from ? [item.date] : [];
  const skip = new Set(rule.exceptions);
  const dates = [];
  let index = 0;
  if (!rule.count && (rule.freq === "daily" || rule.freq === "weekly")) {
    const step = rule.interval * (rule.freq === "weekly" ? 7 : 1);
    index = Math.max(0, Math.floor((daysBetween(item.date, from) - span) / step));
  }
  let produced = 0;
  for (let guard = 0; guard < 20000; guard += 1, index += 1) {
    if (rule.count && produced >= rule.count) break;
    const date = nth(item.date, rule, index);
    if (date === null) continue;
    produced += 1;
    if (date > to || (rule.until && date > rule.until)) break;
    if (shifted(date, span) >= from && !skip.has(date)) dates.push(date);
  }
  return dates;
}

export const occurrenceId = (series, date) => `${series}~${date}`;

export function splitOccurrence(id) {
  const match = /^(.*)~(\d{4}-\d{2}-\d{2})$/.exec(String(id || ""));
  return match ? { series: match[1], date: match[2] } : null;
}

/* One entry per occurrence for the days from `from` to `to`. Events that do not repeat stay as they are. */
export function expandEvents(list, from, to) {
  const result = [];
  for (const item of list || []) {
    if (!normalizeRecurrence(item.recurrence)) {
      result.push(item);
      continue;
    }
    const span = item.endDate && item.endDate > item.date ? daysBetween(item.date, item.endDate) : 0;
    for (const date of occurrenceDates(item, from, to)) {
      result.push({ ...item, id: occurrenceId(item.id, date), date, endDate: span ? shifted(date, span) : item.endDate, series: item.id, occurrence: date });
    }
  }
  return result;
}

/* The rule in words for the event sheet: "Jede Woche", "Alle 2 Wochen, 10 Mal". */
export function ruleText(value, longDate = (iso) => iso) {
  const rule = normalizeRecurrence(value);
  if (!rule) return "";
  const every = {
    daily: rule.interval === 1 ? "Jeden Tag" : `Alle ${rule.interval} Tage`,
    weekly: rule.interval === 1 ? "Jede Woche" : `Alle ${rule.interval} Wochen`,
    monthly: rule.interval === 1 ? "Jeden Monat" : `Alle ${rule.interval} Monate`,
    yearly: rule.interval === 1 ? "Jedes Jahr" : `Alle ${rule.interval} Jahre`,
  }[rule.freq];
  const end = rule.count ? `, ${rule.count} Mal` : rule.until ? `, bis ${longDate(rule.until)}` : "";
  return `${every}${end}`;
}
