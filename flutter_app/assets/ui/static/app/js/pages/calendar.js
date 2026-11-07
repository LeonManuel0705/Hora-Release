import {
  root, data, flags, params, esc, icon, luna, now, pinnedTime, toMin, clock, hm, startOfDay, addDays, isoDate, parseDate, dayDiff, minutesOf,
  weekType, abWeeks, isoWeek, subject, hueVar, blockOf, lessonsFor, inDays, duration, shortDate, longDate, storage, ASSESSMENTS, isAssessment, isOverdue, assessmentCount,
  WEEKDAYS, WEEKDAYS_SHORT, MONTHS, MONTHS_SHORT, BRAND } from "../core.js";
import { animates, travels, flipKeyed, exitInPlace, crossfade, token, ms } from "../motion.js";
import { toast, parseNote, cleanTitle, phraseAt, typing, shortcutsEnabled, overlayOpen, registerSearch, pageUrl, placeNear, clampSheet } from "../shell.js";
import { events as eventApi, debounced, serverId } from "../api.js";
import { expandEvents, normalizeRecurrence, splitOccurrence, occurrenceId, ruleText } from "../recurrence.js";
import { readPrefs, eventMinutes } from "../reminders.js";

const typedBefore = new Map();
const saveText = debounced(700, (key, id, changes) => {
  const sent = eventApi.update(id, changes);
  const before = typedBefore.get(key);
  typedBefore.delete(key);
  if (!before) return;
  sent.catch(() => {
    const item = state.events.find((entry) => entry.id === id);
    if (!item) return;
    Object.assign(item, before);
    render();
    if (state.selected === id) renderPanel();
    toast(`Die Änderung an „${esc(item.title)}“ kam nicht im Google-Kalender an.`, { icon: "wifi-off" });
  });
});

const $ = (id) => document.getElementById(id);
const extra = data.page || {};
const VIEWS = ["woche", "monat", "liste"];
const DUE_KINDS = [...Object.keys(ASSESSMENTS), "Abgabe"];
const LIST_DAYS = 14;
const NARROW = 440;
const FLOATING = matchMedia("(max-width: 1359px)");
const DRAWER = matchMedia("(max-width: 1359px) and (min-width: 760px)");
const LANE_MIN = 42;
const SNAP = 15;
const MOVE_AFTER = 5;
const REMINDERS = [[-1, "Keine"], [0, "Zu Beginn"], [5, "5 Min. vorher"], [10, "10 Min. vorher"], [15, "15 Min. vorher"], [30, "30 Min. vorher"], [60, "1 Std. vorher"], [1440, "1 Tag vorher"]];
const REPEATS = [["", "Nie", null], ["daily", "Täglich", { freq: "daily" }], ["weekly", "Jede Woche", { freq: "weekly" }], ["biweekly", "Alle 2 Wochen", { freq: "weekly", interval: 2 }], ["monthly", "Jeden Monat", { freq: "monthly" }], ["yearly", "Jedes Jahr", { freq: "yearly" }]];
const RESPONSES = { accepted: ["zugesagt", " is-yes"], declined: ["abgesagt", " is-no"], tentative: ["vielleicht", ""], needsAction: ["offen", ""] };
const tasksLink = () => `href="${esc(pageUrl("tasks"))}" data-page="tasks"`;
const KINDS = {
  school: { label: "Schule", icon: "graduation-cap" },
  training: { label: "Training", icon: "dumbbell" },
  private: { label: "Privat", icon: "user" },
};
const NAV_WORDS = {
  woche: ["Vorherige Woche", "Nächste Woche"],
  monat: ["Vorheriger Monat", "Nächster Monat"],
  liste: ["Zwei Wochen zurück", "Zwei Wochen weiter"],
};
const ONLINE = /discord|zoom|teams|videocall|video|online|jitsi|webex|meet|https?:/i;
const TRAINING_WORDS = /\b(gym|training|schwimm\w*|laufen|joggen|fu(ß|ss)ball|tennis|kletter\w*|sport|yoga|workout|volleyball|basketball|handball|tanzen|radtour)\b/i;
const PRIVATE_WORDS = /\b(nachhilfe|arzt|zahnarzt|geburtstag|kino|party|essen|friseur|fahrstunde|konzert)\b/i;
const SCHOOL_WORDS = /\b(schule|referat\w*|abikasse|abiball|klausur|test|elternabend|konferenz|infoabend|kurs\w*|lerngruppe|projektwoche|wandertag|exkursion|studien\w*|uni|hpi)\b/i;

const holidays = (extra.holidays || []).map((item) => ({ ...item, endDate: item.endDate || item.date }));
const deadlines = flags.empty ? [] : data.deadlines.filter((item) => DUE_KINDS.includes(item.kind) && item.status !== "abgegeben");
const prepTasks = (id) => [...(data.tasks || []), ...(data.taskPool || [])].filter((task) => task.deadline === id && !task.done);

function initialView() {
  const asked = params.get("ansicht");
  if (VIEWS.includes(asked)) return asked;
  const saved = storage.get("app-cal-view");
  return VIEWS.includes(saved) ? saved : "woche";
}

const state = {
  view: initialView(),
  anchor: startOfDay(now()),
  focus: isoDate(now()),
  picked: false,
  events: [],
  shown: [],
  loading: false,
  selected: null,
  narrow: false,
  fresh: null,
  draft: null,
  dayOpen: false,
  scroll: "auto",
  range: null,
  scope: "one",
  confirm: null,
  dragged: false,
  pending: null,
  monthRow: 118,
};

const sync = { source: extra.sync?.source || null, write: !!extra.sync?.write, window: extra.sync?.window || null, ranges: [], busy: false };
const removed = new Set();
const sourceWord = () => (sync.source === "google" ? "dem Google-Kalender" : "dem verbundenen Kalender");

function load() {
  const notes = extra.notes || {};
  const seen = new Set();
  const source = flags.empty ? [] : [...data.events, ...(extra.events || [])];
  state.events = source
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .map((item) => ({ ...item, kind: KINDS[item.kind] ? item.kind : "private", notes: item.notes || notes[item.id] || "", synced: !!item.synced }));
}

const todayIso = () => isoDate(now());
const nowMin = () => minutesOf(now());
const mondayOf = (date) => addDays(startOfDay(date), 1 - (date.getDay() || 7));
// An event that ends at 0:00 of the next day belongs to the day before.
const endsAtMidnight = (item) => !!item.start && item.end === "00:00" && !!item.endDate && item.endDate > item.date;
const lastDay = (item) => (endsAtMidnight(item) ? isoDate(addDays(parseDate(item.endDate), -1)) : item.endDate || item.date);
const covers = (item, iso) => item.date <= iso && iso <= lastDay(item);
const kindVar = (kind) => `var(--kind-${kind})`;
const startOf = (item) => toMin(item.start);
const endOf = (item) => (item.end ? Math.max(toMin(item.end), startOf(item) + 15) : startOf(item) + 60);
const holidaysOn = (iso) => holidays.filter((item) => covers(item, iso));
const lessonsOn = (date) => (holidaysOn(isoDate(date)).length ? [] : lessonsFor(date));
const visibleEvents = () => state.shown.filter((item) => !state.loading || !item.synced);
const eventsAt = (iso) => visibleEvents().filter((item) => covers(item, iso));
const colorOf = (item) => (item.synced && /^#[0-9a-f]{6}$/i.test(item.color || "") ? item.color : kindVar(item.kind));
const editable = (item) => !item.synced || item.editable === true;
const spanDays = (item) => (item.endDate && item.endDate > item.date ? dayDiff(parseDate(item.date), item.endDate) : 0);
const overnight = (item) => !!item.start && spanDays(item) > 0;
const endMinute = (item) => (endsAtMidnight(item) ? 1440 : overnight(item) ? toMin(item.end || "00:00") : endOf(item));
// Like Google: an event of a day or more lies in the row of whole days, a shorter one over midnight is split.
const longTimed = (item) => overnight(item) && spanDays(item) * 1440 + toMin(item.end || item.start) - startOf(item) >= 1440;
const timedAt = (iso) => eventsAt(iso).filter((item) => item.start && !longTimed(item)).sort((a, b) => (a.date === iso ? startOf(a) : -1) - (b.date === iso ? startOf(b) : -1));
const allDayAt = (iso) => eventsAt(iso).filter((item) => !item.start || longTimed(item));

function refreshShown() {
  const span = period();
  const monday = mondayOf(now());
  const from = addDays(span.start < monday ? mondayOf(span.start) : monday, -7);
  const to = addDays(span.end > addDays(monday, 6) ? span.end : addDays(monday, 6), 62);
  state.shown = expandEvents(state.events, isoDate(from), isoDate(to));
}

/* The part of an event that lies on one day, in minutes of that day. */
function segmentOf(item, iso) {
  const head = item.date === iso;
  const tail = lastDay(item) === iso || !overnight(item);
  const s = head ? startOf(item) : 0;
  const e = tail ? endMinute(item) : 1440;
  if (!head && e <= 0) return null;
  return { item, s, e: Math.max(e, s + 15), head, tail };
}

const segmentsOn = (iso) => timedAt(iso).map((item) => segmentOf(item, iso)).filter(Boolean);
const dueAt = (iso) => deadlines.filter((item) => item.date === iso).sort((a, b) => Number(isAssessment(b)) - Number(isAssessment(a)));
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const monthShort = (index) => `${MONTHS_SHORT[index]}${MONTHS_SHORT[index].length < MONTHS[index].length ? "." : ""}`;
const subjectName = (key) => subject(key).name.replace(/ LK$/, "");

function isPast(item) {
  const today = todayIso();
  const last = lastDay(item);
  if (last < today) return true;
  if (last > today || !item.start) return false;
  return endMinute(item) <= nowMin();
}

function timeText(item) {
  if (!item.start) return "ganztägig";
  if (!item.end) return `ab ${hm(item.start)}`;
  if (overnight(item) && lastDay(item) > item.date) return `${hm(item.start)} bis ${WEEKDAYS_SHORT[parseDate(item.endDate).getDay()]}. ${hm(item.end)}`;
  return `${hm(item.start)} bis ${hm(item.end)}`;
}

const sourceLabel = (item) => (item.synced ? item.calendarName || "" : KINDS[item.kind].label);

function dueTime(item) {
  const block = item.block ? blockOf(item.block) : null;
  return block ? `${block.n}. Block, ${hm(block.start)} bis ${hm(block.end)}` : "ganztägig";
}

function findEntry(id) {
  if (state.draft && id === state.draft.id) return { type: "event", item: state.draft };
  const event = state.shown.find((item) => item.id === id) || state.events.find((item) => item.id === id) || occurrenceOf(id);
  if (event) return { type: "event", item: event };
  const due = deadlines.find((item) => item.id === id);
  if (due) return { type: "due", item: due };
  const holiday = holidays.find((item) => item.id === id);
  return holiday ? { type: "holiday", item: holiday } : null;
}

function occurrenceOf(id) {
  const parts = splitOccurrence(id);
  const series = parts && state.events.find((item) => item.id === parts.series);
  return series ? expandEvents([series], parts.date, parts.date).find((item) => item.id === id) || null : null;
}

function period(view = state.view, anchor = state.anchor) {
  if (view === "woche") {
    const start = mondayOf(anchor);
    return { start, end: addDays(start, 6) };
  }
  if (view === "monat") {
    return { start: new Date(anchor.getFullYear(), anchor.getMonth(), 1), end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0) };
  }
  const start = startOfDay(anchor);
  return { start, end: addDays(start, LIST_DAYS - 1) };
}

const inPeriod = (iso, span = period()) => iso >= isoDate(span.start) && iso <= isoDate(span.end);

function schoolLine(date) {
  const iso = isoDate(date);
  const free = holidaysOn(iso)[0];
  if (free) return free.type === "ferien" ? free.title : `${free.title}, schulfrei`;
  const lessons = lessonsFor(date);
  if (!lessons.length) return "";
  const active = lessons.filter((lesson) => !lesson.cancelled);
  const cancelled = lessons.filter((lesson) => lesson.cancelled);
  if (!active.length) return "Unterricht entfällt";
  const hours = active[0].startMin === 480 ? `Schule bis ${hm(active[active.length - 1].end)}` : `Schule ${hm(active[0].start)} bis ${hm(active[active.length - 1].end)}`;
  return cancelled.length ? `${cancelled.map((lesson) => `${lesson.block}.`).join(" und ")} Block entfällt, ${hours}` : hours;
}

function countLine() {
  if (state.loading) return "Termine werden geladen";
  const today = todayIso();
  const monday = mondayOf(now());
  const week = Array.from({ length: 7 }, (_, index) => isoDate(addDays(monday, index)));
  const todayCount = eventsAt(today).length;
  const weekCount = visibleEvents().filter((item) => week.some((iso) => covers(item, iso))).length;
  if (!todayCount && !weekCount) return "Diese Woche keine Termine";
  const first = todayCount ? `${plural(todayCount, "Termin", "Termine")} heute` : "Heute keine Termine";
  return `${first}, ${weekCount} diese Woche`;
}

function rangeText() {
  const span = period();
  const { start, end } = span;
  const year = now().getFullYear();
  if (state.view === "monat") return { text: `${MONTHS[start.getMonth()]} ${start.getFullYear()}`, meta: monthMeta(span) };
  const sameMonth = start.getMonth() === end.getMonth();
  const tail = end.getFullYear() !== year ? ` ${end.getFullYear()}` : "";
  const text = sameMonth
    ? `${start.getDate()}. bis ${end.getDate()}. ${MONTHS[end.getMonth()]}${tail}`
    : `${start.getDate()}. ${monthShort(start.getMonth())} bis ${end.getDate()}. ${monthShort(end.getMonth())}${tail}`;
  if (state.view === "woche") {
    const ferien = holidays.find((item) => item.type === "ferien" && item.date <= isoDate(end) && item.endDate >= isoDate(start));
    return { text, meta: [`KW ${isoWeek(start)}`, ferien ? ferien.title : abWeeks() ? `${weekType(start)}-Woche` : ""].filter(Boolean).join(", ") };
  }
  const count = listEntries(span).reduce((sum, group) => sum + group.items.filter((entry) => entry.type === "event").length, 0);
  return { text, meta: count ? plural(count, "Termin", "Termine") : "" };
}

function monthMeta(span) {
  const first = isoDate(span.start);
  const last = isoDate(span.end);
  const events = visibleEvents().filter((item) => item.date <= last && lastDay(item) >= first).length;
  const tests = assessmentCount(deadlines.filter((item) => item.date >= first && item.date <= last));
  return [events ? plural(events, "Termin", "Termine") : "", tests].filter(Boolean).join(", ");
}

function hourRange(days) {
  if (!state.narrow) return { start: 0, end: 1440, hours: 24 };
  let first = days.some((date) => lessonsOn(date).length) ? 480 : 600;
  let last = 1320;
  const today = todayIso();
  days.forEach((date) => {
    const iso = isoDate(date);
    lessonsOn(date).forEach((lesson) => {
      first = Math.min(first, lesson.startMin);
      last = Math.max(last, lesson.endMin);
    });
    segmentsOn(iso).forEach((segment) => {
      first = Math.min(first, segment.s);
      last = Math.max(last, segment.e);
    });
    if (state.draft?.start && state.draft.date === iso) {
      first = Math.min(first, startOf(state.draft));
      last = Math.max(last, endOf(state.draft));
    }
    const minute = nowMin();
    if (iso === today && minute >= 360 && minute <= 1380) {
      first = Math.min(first, minute - 20);
      last = Math.max(last, minute + 20);
    }
  });
  const start = Math.max(0, Math.floor(first / 60) * 60);
  const end = Math.min(1440, Math.ceil(last / 60) * 60);
  return { start, end, hours: (end - start) / 60 };
}

/* Overlapping events side by side, each at least LANE_MIN wide. What does not fit waits behind "+n" in the last
   lane. Events that start half an hour or more apart overlap like cards instead, each a little further in. */
function layoutLanes(segments, columns) {
  const sorted = segments.map((segment) => ({ ...segment, lane: 0, lanes: 1, indent: 0 })).sort((a, b) => a.s - b.s || b.e - a.e);
  const shown = [];
  const more = [];
  let group = [];
  let groupEnd = -1;
  const settle = () => {
    const staggered = group.every((entry, index) => index === 0 || entry.s - group[index - 1].s >= 30);
    if (staggered) {
      group.forEach((entry, index) => {
        const under = group.slice(0, index).filter((other) => other.e > entry.s);
        entry.indent = under.length ? Math.min(3, Math.max(...under.map((other) => other.indent)) + 1) : 0;
      });
      shown.push(...group);
      return;
    }
    const lanes = [];
    group.forEach((entry) => {
      let lane = lanes.findIndex((end) => end <= entry.s);
      if (lane < 0) {
        lane = lanes.length;
        lanes.push(entry.e);
      } else {
        lanes[lane] = entry.e;
      }
      entry.lane = lane;
    });
    if (lanes.length <= columns) {
      group.forEach((entry) => (entry.lanes = lanes.length));
      shown.push(...group);
      return;
    }
    const keep = Math.max(1, columns - 1);
    const width = columns > 1 ? columns : 1;
    let block = null;
    group.forEach((entry) => {
      if (entry.lane < keep) {
        entry.lanes = width;
        shown.push(entry);
      } else if (block && entry.s < block.e) {
        block.e = Math.max(block.e, entry.e);
        block.items.push(entry.item);
      } else {
        block = { s: entry.s, e: entry.e, items: [entry.item], lane: columns > 1 ? columns - 1 : 0, lanes: width, strip: columns <= 1 };
        more.push(block);
      }
    });
  };
  sorted.forEach((entry) => {
    if (group.length && entry.s >= groupEnd) {
      settle();
      group = [];
    }
    group.push(entry);
    groupEnd = group.length === 1 ? entry.e : Math.max(groupEnd, entry.e);
  });
  if (group.length) settle();
  return { shown, more };
}

function laneColumns() {
  const stage = $("calStage")?.getBoundingClientRect().width || 0;
  const width = state.narrow ? stage - 58 : (stage - 58) / 7;
  return Math.max(1, Math.floor((width - 6) / LANE_MIN));
}

function dueLabel(item, { long = false } = {}) {
  const name = subject(item.subject);
  if (long) return `${item.kind} ${subjectName(item.subject)}: ${item.title}`;
  return `<span class="label-full">${esc(name.label)}</span><span class="label-short">${esc(name.short)}</span>`;
}

const dueIcon = (item) => ASSESSMENTS[item.kind]?.icon || "list-checks";

function dueTone(item) {
  const overdue = isOverdue(item, todayIso());
  if (overdue) return " is-overdue";
  return isAssessment(item) ? " is-test" : " is-due";
}

function chipHtml(entry, isos) {
  const { item, type } = entry;
  const from = state.narrow ? 0 : isos.indexOf(entry.from);
  const to = state.narrow ? 0 : isos.indexOf(entry.to);
  const column = state.narrow ? "2 / -1" : `${from + 2} / span ${to - from + 1}`;
  const selected = state.selected === item.id ? " is-selected" : "";
  const order = `data-order="${entry.from}|0|${type === "holiday" ? "0" : type === "due" ? "1" : "2"}"`;
  if (type === "holiday") {
    const days = dayDiff(parseDate(item.date), item.endDate) + 1;
    const label = `${item.title}, ${days > 1 ? `${shortDate(parseDate(item.date))} bis ${shortDate(parseDate(item.endDate))}` : longDate(parseDate(item.date))}`;
    const tip = state.narrow ? "" : ` data-tip="${esc(`<b>${esc(item.title)}</b>${days > 1 ? `<br>${esc(shortDate(parseDate(item.date)))} bis ${esc(shortDate(parseDate(item.endDate)))}` : ""}`)}"`;
    return `<button type="button" class="cw-chip is-holiday${selected}" style="grid-column:${column}" data-id="${esc(item.id)}" data-key="chip:${esc(item.id)}"${tip} ${order} aria-label="${esc(label)}">${icon("sun")}<span class="cw-chip-text">${esc(item.title)}</span></button>`;
  }
  if (type === "due") {
    const overdue = isOverdue(item, todayIso());
    const label = `${dueLabel(item, { long: true })}, ${dueTime(item)}${overdue ? ", überfällig" : ""}`;
    const text = state.narrow ? `<span class="cw-chip-text">${esc(item.kind)} ${esc(subjectName(item.subject))}: ${esc(item.title)}</span>` : `<span class="cw-chip-text">${dueLabel(item)}</span>`;
    return `<button type="button" class="cw-chip${dueTone(item)}${selected}" style="grid-column:${column};--hue:${hueVar(item.subject)}" data-id="${esc(item.id)}" data-key="chip:${esc(item.id)}" data-tip="${esc(`<b>${esc(item.kind)} ${esc(subjectName(item.subject))}</b>: ${esc(item.title)}${item.block ? `, ${item.block}. Block` : ""}${overdue ? "<br>überfällig" : ""}`)}" ${order} aria-label="${esc(label)}">${icon(dueIcon(item))}${text}</button>`;
  }
  const past = isPast(item) ? " is-past" : "";
  const when = item.start ? timeText(item) : "ganztägig";
  const tip = state.narrow ? "" : ` data-tip="${esc(`<b>${esc(item.title)}</b><br>${esc(when)}${item.place ? `, ${esc(item.place)}` : ""}`)}"`;
  const lead = item.start && entry.from === item.date ? `<span class="ev-time">${hm(item.start)}</span>` : "";
  return `<button type="button" class="cw-chip is-event${past}${selected}" style="grid-column:${column};--k:${esc(colorOf(item))}" data-id="${esc(item.id)}" data-key="chip:${esc(item.id)}" data-flip="chip:${esc(item.id)}"${tip} ${order} aria-label="${esc(`${item.title}, ${when}${item.place ? `, ${item.place}` : ""}`)}">${lead}<span class="cw-chip-text" data-title-of="${esc(item.series || item.id)}">${esc(item.title)}</span></button>`;
}

function allDayEntries(isos) {
  const first = isos[0];
  const last = isos[isos.length - 1];
  const clip = (item) => ({ from: item.date < first ? first : item.date, to: lastDay(item) > last ? last : lastDay(item) });
  return [
    ...holidays.filter((item) => item.date <= last && item.endDate >= first).map((item) => ({ type: "holiday", item, ...clip(item) })),
    ...deadlines.filter((item) => item.date >= first && item.date <= last).sort((a, b) => Number(isAssessment(b)) - Number(isAssessment(a))).map((item) => ({ type: "due", item, from: item.date, to: item.date })),
    ...visibleEvents().filter((item) => (!item.start || longTimed(item)) && item.date <= last && lastDay(item) >= first).map((item) => ({ type: "event", item, ...clip(item) })),
  ];
}

function dayHead(date) {
  const iso = isoDate(date);
  const today = iso === todayIso();
  const focus = iso === state.focus;
  const count = eventsAt(iso).length;
  const tests = assessmentCount(dueAt(iso));
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const label = `${longDate(date)}${today ? ", heute" : ""}, ${count ? plural(count, "Termin", "Termine") : "keine Termine"}${tests ? `, ${tests}` : ""}`;
  const shown = focus && (state.picked || state.narrow);
  const dots = state.narrow ? `<span class="cw-dots" aria-hidden="true">${dotsFor(iso, 3)}</span>` : "";
  return `<button type="button" class="cw-day${today ? " is-today" : ""}${shown ? " is-focus" : ""}${weekend ? " is-weekend" : ""}" data-day="${iso}" data-key="day:${iso}" tabindex="${focus ? 0 : -1}" aria-pressed="${shown}" aria-label="${esc(label)}"${today ? ' aria-current="date"' : ""}>
    <span class="cw-dow" aria-hidden="true">${WEEKDAYS_SHORT[date.getDay()]}</span><span class="cw-num" aria-hidden="true">${date.getDate()}</span>${dots}
  </button>`;
}

function dotsFor(iso, limit) {
  const dots = [
    ...dueAt(iso).map((item) => `<i class="cal-dot${item.date < todayIso() || isAssessment(item) ? " is-urgent" : ""}" style="--k:${hueVar(item.subject)}"></i>`),
    ...eventsAt(iso).sort((a, b) => (a.start || "").localeCompare(b.start || "")).map((item) => `<i class="cal-dot is-event" style="--k:${esc(colorOf(item))}"></i>`),
  ];
  return dots.slice(0, limit).join("");
}

function lessonBand(lesson, date, pos, len) {
  const info = subject(lesson.subject);
  const iso = isoDate(date);
  const test = deadlines.find((item) => isAssessment(item) && item.date === iso && item.block === lesson.block);
  const tip = `${lesson.block}. Block, ${hm(lesson.start)} bis ${hm(lesson.end)}: <b>${esc(info.name)}</b> in ${esc(lesson.room)}${lesson.movedFrom ? ` statt ${esc(lesson.movedFrom)}` : ""}, ${esc(lesson.teacher)}${test ? `<br>${esc(test.kind)}: ${esc(test.title)}` : ""}${lesson.cancelled ? "<br>Entfällt" : ""}`;
  const room = lesson.cancelled ? "entfällt" : `${esc(lesson.room)}${state.narrow ? `, ${esc(lesson.teacher)}` : ""}`;
  return `<div class="cw-lesson${lesson.cancelled ? " is-cancelled" : ""}${lesson.movedFrom ? " is-moved" : ""}" style="--top:${pos(lesson.startMin)};--len:${len(lesson.startMin, lesson.endMin)};--hue:${hueVar(lesson.subject)}" data-tip="${esc(tip)}" aria-hidden="true">
    <span class="cw-lesson-label"><span class="label-full">${esc(info.label)}</span><span class="label-short">${esc(info.short)}</span></span>
    <span class="cw-lesson-room">${room}</span>${test ? `<span class="cw-lesson-flag">${esc(test.kind)}</span>` : ""}
  </div>`;
}

function eventCard(entry, pos, len) {
  const { item, s, e, head, tail, iso } = entry;
  const size = e - s < 50 ? "is-short" : e - s < 90 ? "is-medium" : "";
  const label = [`${item.title}, ${timeText(item)}`, item.place, sourceLabel(item)].filter(Boolean).join(", ");
  const clock = head ? hm(item.start) : item.end ? `bis ${hm(item.end)}` : "";
  const detail = state.narrow ? `${head ? timeText(item) : clock}${item.place ? `, ${esc(item.place)}` : ""}` : clock;
  const place = !state.narrow && !size && item.place ? `<span class="ev-place">${esc(item.place)}</span>` : "";
  const tip = state.narrow ? "" : ` data-tip="${esc(`<b>${esc(item.title)}</b><br>${esc(timeText(item))}${item.place ? `, ${esc(item.place)}` : ""}`)}"`;
  const fit = state.narrow ? (e - s < 55 ? "is-short" : e - s < 80 ? "is-medium" : "is-wrap") : size || "is-tall";
  const part = head ? "" : `:${iso}`;
  const movable = editable(item) && !state.loading;
  const classes = ["ev", isPast(item) ? "is-past" : "", fit, entry.indent ? "is-stacked" : "", head ? "" : "is-continued", tail ? "" : "is-continuing", state.selected === item.id ? "is-selected" : ""].filter(Boolean).join(" ");
  return `<button type="button" class="${classes}" data-id="${esc(item.id)}" data-key="ev:${esc(item.id)}${part}" data-flip="ev:${esc(item.id)}${part}" data-order="${iso}|1|${hhmm(s)}"${movable ? " data-movable" : ""} style="--top:${pos(s)};--len:${len(s, e)};--lane:${entry.lane};--lanes:${entry.lanes};--indent:${entry.indent};--k:${esc(colorOf(item))}"${tip} aria-label="${esc(label)}">
    <span class="ev-title" data-title-of="${esc(item.series || item.id)}">${esc(item.title)}</span><span class="ev-time">${detail}</span>${place}${movable && head && tail && !state.narrow ? `<span class="ev-grip" data-grip aria-hidden="true"></span>` : ""}
  </button>`;
}

function moreChip(block, iso, pos, len) {
  const count = block.items.length;
  const label = `${plural(count, "weiterer Termin", "weitere Termine")} von ${hm(hhmm(block.s))} bis ${hm(hhmm(Math.min(1439, block.e)))}`;
  return `<button type="button" class="cw-more${block.strip ? " is-strip" : ""}" data-more="${iso}|${block.s}" data-key="more:${iso}|${block.s}" data-order="${iso}|1|${hhmm(block.s)}" style="--top:${pos(block.s)};--len:${len(block.s, block.e)};--lane:${block.lane};--lanes:${block.lanes}" aria-label="${esc(label)}" data-tip="${esc(label)}">+${count}</button>`;
}

function draftCard(pos, len) {
  const draft = state.draft;
  const s = startOf(draft);
  const e = endOf(draft);
  return `<div class="ev is-draft ${e - s < 50 ? "is-short" : "is-tall"}" data-draft style="--top:${pos(s)};--len:${len(s, e)};--lane:0;--lanes:1;--indent:0;--k:${kindVar(draft.kind)}" aria-hidden="true">
    <span class="ev-title">${esc(draft.title)}</span><span class="ev-time">${hm(draft.start)} bis ${hm(draft.end)}</span>
  </div>`;
}

function schoolSummary(date, lessons) {
  const line = schoolLine(date);
  if (!lessons.length) return line || "Kein Unterricht";
  const names = lessons.filter((lesson) => !lesson.cancelled).map((lesson) => `${lesson.block}. Block ${subject(lesson.subject).name}`).join(", ");
  return `${line}. ${names}`;
}

const blocks = new Map();

function weekColumn(date, range, columns) {
  const iso = isoDate(date);
  const today = iso === todayIso();
  const pos = (minute) => ((minute - range.start) / 60).toFixed(4);
  const len = (from, to) => ((to - from) / 60).toFixed(4);
  const lessons = lessonsOn(date);
  const { shown, more } = layoutLanes(segmentsOn(iso).map((segment) => ({ ...segment, iso })), columns);
  more.forEach((block) => blocks.set(`${iso}|${block.s}`, block.items));
  const minute = nowMin();
  const line = today && minute >= range.start && minute <= range.end ? `<div class="cw-now" style="--top:${pos(minute)}" aria-hidden="true"></div>` : "";
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const draft = state.draft?.start && state.draft.date === iso ? draftCard(pos, len) : "";
  return `<div class="cw-col${today ? " is-today" : ""}${weekend ? " is-weekend" : ""}" data-day="${iso}" role="group" aria-label="${esc(longDate(date))}${today ? ", heute" : ""}">
    <p class="visually-hidden">${esc(schoolSummary(date, lessons))}</p>
    ${lessons.map((lesson) => lessonBand(lesson, date, pos, len)).join("")}
    ${shown.map((entry) => eventCard(entry, pos, len)).join("")}${more.map((block) => moreChip(block, iso, pos, len)).join("")}${draft}${line}
  </div>`;
}

function ownSource(item) {
  if (sync.source !== "google" || (!item.google && !sync.write)) return `Eigener Termin in ${BRAND}`;
  if (item.elsewhere) return "Eigener Termin, sein Gegenstück liegt in einem anderen Google-Konto";
  if (item.google && !item.pending) return "Eigener Termin, steht auch im Google-Kalender";
  return sync.write ? "Eigener Termin, wird in den Google-Kalender übertragen" : `Eigener Termin, die Änderung bleibt in ${BRAND}`;
}

function loadingHtml(inline = false) {
  return `<div class="loading-card cal-loading${inline ? " is-inline" : ""}" role="status">${luna("laedt", 96)}<div><p class="empty-title">Hole Termine aus ${sourceWord()}</p><p class="empty-text">Dauert nur einen Moment.</p></div></div>`;
}

function nextEntryAfter(iso) {
  const candidates = [
    ...visibleEvents().filter((item) => item.date > iso),
    ...deadlines.filter((item) => item.date > iso),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return candidates[0] || null;
}

function emptyHtml(title, span) {
  const next = nextEntryAfter(isoDate(span.end));
  const hour = minutesOf(now()) / 60;
  const kind = hour >= 21 || hour < 5 ? "schlaeft" : "ruhe";
  const action = next
    ? `<button type="button" class="empty-action" data-jump="${next.date}">Nächster Termin am ${esc(shortDate(parseDate(next.date)))}${icon("chevron-right")}</button>`
    : `<p class="empty-text">Neue Termine legst du oben an.</p>`;
  return `<div class="empty-state cal-empty">${luna(kind)}<p class="empty-title">${esc(title)}</p>${action}</div>`;
}

function renderWeek() {
  const span = period();
  const days = Array.from({ length: 7 }, (_, index) => addDays(span.start, index));
  const isos = days.map(isoDate);
  const shownDays = state.narrow ? days.filter((date) => isoDate(date) === state.focus) : days;
  const range = hourRange(shownDays);
  state.range = range;
  blocks.clear();
  const entries = allDayEntries(isos).filter((entry) => !state.narrow || (entry.from <= state.focus && entry.to >= state.focus));
  const busy = isos.some((iso) => eventsAt(iso).length || dueAt(iso).length);
  const head = `<div class="cw-head" role="group" aria-label="Tage der Woche"><span class="cw-gutter" aria-hidden="true"></span>${days.map(dayHead).join("")}</div>`;
  const allDay = entries.length ? `<div class="cw-allday" role="group" aria-label="Ganztägig">${entries.map((entry) => chipHtml(entry, isos)).join("")}</div>` : "";
  const minute = nowMin();
  const todayShown = shownDays.some((date) => isoDate(date) === todayIso()) && minute >= range.start && minute <= range.end;
  const hours = Array.from({ length: range.hours + 1 }, (_, index) => range.start + index * 60);
  const labels = hours.map((value, index) => `<li style="--i:${index}"${todayShown && Math.abs(value - minute) < 20 ? ' class="is-covered"' : ""}>${clock(value === 1440 ? 0 : value)}</li>`).join("");
  const nowLabel = todayShown ? `<li class="cw-now-label" style="--i:${((minute - range.start) / 60).toFixed(4)}">${clock(minute)}</li>` : "";
  const columns = laneColumns();
  let empty = "";
  if (!busy && !state.loading) {
    const ferien = holidays.find((item) => item.type === "ferien" && item.date <= isos[6] && item.endDate >= isos[0]);
    const next = nextEntryAfter(isos[6]);
    const jump = next ? `<button type="button" class="empty-action" data-jump="${next.date}">Nächster Termin am ${esc(shortDate(parseDate(next.date)))}${icon("chevron-right")}</button>` : "";
    const hint = root.classList.contains("is-touch") ? "Tipp auf eine freie Stunde für einen neuen Termin." : "Klick in eine freie Stunde für einen neuen Termin.";
    empty = `<p class="cw-empty"><span>${esc(ferien ? `${ferien.title}, keine Termine.` : "Keine Termine in dieser Woche.")} ${hint}</span>${jump}</p>`;
  }
  return `<div class="cw${state.narrow ? " is-narrow" : ""}" style="--hours:${range.hours}">
    ${state.loading ? loadingHtml() : ""}${head}${allDay}
    <div class="cw-scroll" tabindex="-1">
      <div class="cw-body">
        <ol class="cw-hours" aria-hidden="true">${labels}${nowLabel}</ol>
        ${shownDays.map((date) => weekColumn(date, range, columns)).join("")}
      </div>
    </div>
  </div>${empty}`;
}

/* The week shows the whole day in a pane of its own that ends at the bottom of the window. It opens at the hour
   that matters: now when the week holds today, else the first lesson or event of the week. */
function placeWeek() {
  const scroller = $("calView").querySelector(".cw-scroll");
  if (!scroller || state.narrow) {
    $("calView").style.removeProperty("--cw-max");
    $("calView").style.removeProperty("--sbw");
    return;
  }
  const top = scroller.getBoundingClientRect().top + scrollY;
  $("calView").style.setProperty("--cw-max", `${Math.max(320, Math.round(innerHeight - top - 28))}px`);
  $("calView").style.setProperty("--sbw", `${scroller.offsetWidth - scroller.clientWidth}px`);
  if (state.scroll == null) return;
  const hour = parseFloat(getComputedStyle(scroller).getPropertyValue("--hour-h")) || 44;
  let minute = state.scroll;
  if (minute === "auto") {
    const span = period();
    const isos = Array.from({ length: 7 }, (_, index) => isoDate(addDays(span.start, index)));
    if (isos.includes(todayIso())) {
      minute = nowMin() - 90;
    } else {
      const starts = isos.flatMap((iso) => [...lessonsOn(parseDate(iso)).map((lesson) => lesson.startMin), ...segmentsOn(iso).map((segment) => segment.s)]);
      minute = (starts.length ? Math.min(...starts) : 480) - 30;
    }
  }
  scroller.scrollTop = Math.max(0, (minute / 60) * hour);
  state.scroll = null;
}

function monthItems(iso, date) {
  const items = [];
  holidaysOn(iso).forEach((item) => {
    if (item.type === "feiertag" || item.date === iso || date.getDay() === 1) items.push({ type: "holiday", item });
  });
  dueAt(iso).forEach((item) => items.push({ type: "due", item }));
  allDayAt(iso).forEach((item) => items.push({ type: "event", item }));
  timedAt(iso).forEach((item) => items.push({ type: "event", item }));
  return items;
}

function monthItemHtml({ type, item }, iso, { wrap = false, focusable = false } = {}) {
  const tab = focusable ? "" : ' tabindex="-1"';
  const wrapped = wrap ? " is-wrap" : "";
  if (type === "holiday") return `<span class="cm-item is-holiday" data-tip="${esc(`<b>${esc(item.title)}</b>`)}">${esc(item.title)}</span>`;
  if (type === "due") {
    const tip = `<b>${esc(item.kind)} ${esc(subjectName(item.subject))}</b>: ${esc(item.title)}${item.block ? `, ${item.block}. Block` : ""}`;
    return `<button type="button" class="cm-item${dueTone(item)}${wrapped}${state.selected === item.id ? " is-selected" : ""}" data-item="${esc(item.id)}"${tab} data-tip="${esc(tip)}" style="--hue:${hueVar(item.subject)}">${icon(dueIcon(item))}<span class="cm-text">${esc(subject(item.subject).label)}${focusable ? `: ${esc(item.title)}` : ""}</span></button>`;
  }
  const bar = !item.start || longTimed(item);
  const clock = item.start && !longTimed(item) ? (item.date === iso ? hm(item.start) : item.end ? `bis ${hm(item.end)}` : "") : "";
  const tip = `<b>${esc(item.title)}</b><br>${esc(timeText(item))}${item.place ? `, ${esc(item.place)}` : ""}`;
  return `<button type="button" class="cm-item is-event${bar ? " is-bar" : ""}${wrapped}${isPast(item) ? " is-past" : ""}${state.selected === item.id ? " is-selected" : ""}" data-item="${esc(item.id)}"${tab} data-flip="cm:${esc(item.id)}:${iso}" data-tip="${esc(tip)}" style="--k:${esc(colorOf(item))}" aria-label="${esc(`${item.title}, ${timeText(item)}`)}"><span class="cm-line">${bar ? "" : '<i class="cal-dot"></i>'}${clock ? `<span class="cm-time">${clock}</span> ` : ""}<span class="cm-text" data-title-of="${esc(item.series || item.id)}">${esc(item.title)}</span></span></button>`;
}

function monthLabel(date, iso, items) {
  const parts = [longDate(date)];
  if (iso === todayIso()) parts.push("heute");
  holidaysOn(iso).forEach((item) => parts.push(item.title));
  const events = eventsAt(iso);
  const due = dueAt(iso);
  due.forEach((item) => parts.push(`${item.kind} ${subjectName(item.subject)}`));
  if (events.length) parts.push(`${plural(events.length, "Termin", "Termine")}: ${events.map((item) => `${item.start ? `${hm(item.start)} ` : ""}${item.title}`).join(", ")}`);
  else if (!due.length && !items.length) parts.push("keine Termine");
  return parts.join(", ");
}

function renderMonth() {
  const span = period();
  const start = mondayOf(span.start);
  const weeks = Math.ceil((dayDiff(start, isoDate(span.end)) + 1) / 7);
  const month = span.start.getMonth();
  const lines = Math.max(2, Math.floor((state.monthRow - 34) / 21));
  let rows = "";
  for (let week = 0; week < weeks; week += 1) {
    let cells = "";
    for (let day = 0; day < 7; day += 1) {
      const date = addDays(start, week * 7 + day);
      const iso = isoDate(date);
      const items = monthItems(iso, date);
      const today = iso === todayIso();
      const focus = iso === state.focus;
      const free = holidaysOn(iso).length > 0;
      const outside = date.getMonth() !== month;
      const dayButton = (inner) => `<button type="button" class="cm-day${today ? " is-today" : ""}${focus && state.picked ? " is-focus" : ""}" data-day="${iso}" data-key="day:${iso}" data-order="${iso}" tabindex="${focus ? 0 : -1}" aria-pressed="${focus && state.picked}" aria-label="${esc(monthLabel(date, iso, items))}"${today ? ' aria-current="date"' : ""}>${inner}</button>`;
      let body;
      if (state.narrow) {
        body = dayButton(`<span class="cm-num" aria-hidden="true">${date.getDate()}</span><span class="cm-body" aria-hidden="true"><span class="cm-dots">${dotsFor(iso, 3)}</span></span>`);
      } else {
        const crowded = items.length > lines;
        const listed = crowded ? items.slice(0, lines - 1) : items;
        let spare = lines - listed.length - (crowded ? 1 : 0);
        const html = listed.map((entry) => {
          const long = entry.type === "event" && entry.item.title.length > 12 && spare > 0;
          if (long) spare -= 1;
          return monthItemHtml(entry, iso, { wrap: long });
        }).join("");
        const more = crowded ? `<button type="button" class="cm-more" data-more-day="${iso}" tabindex="-1">${items.length - listed.length} weitere</button>` : "";
        body = `<div class="cm-box">${dayButton(`<span class="cm-num" aria-hidden="true">${date.getDate()}</span>`)}<div class="cm-items">${html}${more}</div></div>`;
      }
      cells += `<td class="cm-cell${outside ? " is-outside" : ""}${free ? " is-free" : ""}${day >= 5 ? " is-weekend" : ""}${state.narrow ? "" : " is-pickable"}" data-cell="${iso}">${body}</td>`;
    }
    rows += `<tr>${cells}</tr>`;
  }
  const head = [1, 2, 3, 4, 5, 6, 0].map((dow) => `<th scope="col" abbr="${WEEKDAYS[dow]}">${WEEKDAYS_SHORT[dow]}</th>`).join("");
  return `<div class="cm-wrap">${state.loading ? loadingHtml() : ""}<table class="cm${state.narrow ? " is-narrow" : ""}" style="--cm-row:${state.monthRow}px" aria-label="${MONTHS[month]} ${span.start.getFullYear()}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* Month rows share the height of the window, so a tall window shows more of each day. True when that height changed. */
function placeMonth() {
  const table = $("calView").querySelector(".cm:not(.is-narrow)");
  if (!table) return false;
  const weeks = table.tBodies[0].rows.length;
  const top = table.getBoundingClientRect().top + scrollY + table.tHead.getBoundingClientRect().height;
  const row = Math.max(118, Math.floor((innerHeight - top - 28) / weeks));
  if (Math.abs(row - state.monthRow) < 4) return false;
  state.monthRow = row;
  return true;
}

function openMore(anchor, title, entries, iso) {
  const sheet = $("calMore");
  sheet.innerHTML = `<div class="cal-more-head"><h3 class="cal-more-title" id="calMoreTitle">${esc(title)}</h3><button class="icon-button" type="button" data-more-close aria-label="Schließen">${icon("x")}</button></div>
    <div class="cal-more-list">${entries.map((entry) => monthItemHtml(entry, iso, { focusable: true, wrap: true })).join("")}</div>`;
  if (!sheet.matches(":popover-open")) sheet.showPopover();
  placeNear(sheet, anchor, "left");
  clampSheet(sheet);
  sheet.querySelector("[data-item]")?.focus({ preventScroll: true });
}

function closeMore() {
  const sheet = $("calMore");
  if (sheet.matches(":popover-open")) sheet.hidePopover();
}

function listEntries(span) {
  const groups = [];
  const first = isoDate(span.start);
  for (let index = 0; index < LIST_DAYS; index += 1) {
    const date = addDays(span.start, index);
    const iso = isoDate(date);
    const items = [
      ...holidaysOn(iso).filter((item) => item.date === iso || iso === first).map((item) => ({ type: "holiday", item })),
      ...dueAt(iso).map((item) => ({ type: "due", item })),
      ...eventsAt(iso).filter((item) => (!item.start || longTimed(item)) && (item.date === iso || iso === first)).map((item) => ({ type: "event", item })),
      ...timedAt(iso).map((item) => ({ type: "event", item })),
    ];
    if (items.length) groups.push({ date, iso, items });
  }
  return groups;
}

function groupTitle(date) {
  const diff = dayDiff(startOfDay(now()), isoDate(date));
  const meta = `${date.getDate()}.${date.getMonth() + 1}.`;
  if (diff === 0) return { title: "Heute", meta: shortDate(date) };
  if (diff === 1) return { title: "Morgen", meta: shortDate(date) };
  if (diff === -1) return { title: "Gestern", meta: shortDate(date) };
  return { title: WEEKDAYS[date.getDay()], meta };
}

function listRow({ type, item }, iso) {
  const selected = state.selected === item.id ? " is-selected" : "";
  const base = `data-id="${esc(item.id)}" data-key="row:${esc(item.id)}" data-flip="row:${esc(item.id)}" data-order="${item.date}"`;
  if (type === "holiday") {
    const days = dayDiff(parseDate(item.date), item.endDate) + 1;
    const meta = days > 1 ? `bis ${shortDate(parseDate(item.endDate))}, ${plural(days, "Tag", "Tage")}` : "schulfrei";
    return `<li><button type="button" class="cl-row is-holiday${selected}" ${base}>
      <span class="cl-time"><span class="cl-icon">${icon("sun")}</span></span>
      <span class="cl-main"><span class="cl-title">${esc(item.title)}</span><span class="cl-meta">${esc(meta)}</span></span>${icon("chevron-right", "chev-end")}
    </button></li>`;
  }
  if (type === "due") {
    const block = item.block ? blockOf(item.block) : null;
    const overdue = isOverdue(item, todayIso());
    const lesson = item.block ? lessonsFor(parseDate(item.date)).find((entry) => entry.block === item.block) : null;
    const meta = [`<i class="subject-dot" style="--hue:${hueVar(item.subject)}"></i>${esc(subject(item.subject).label)}`, block ? `${block.n}. Block` : "", lesson ? esc(lesson.room) : "", overdue ? `<span class="cl-urgent">überfällig</span>` : ""].filter(Boolean).join(", ");
    return `<li><button type="button" class="cl-row is-due${isAssessment(item) ? " is-test" : ""}${selected}" ${base}>
      <span class="cl-time">${block ? `<b>${hm(block.start)}</b><small>${hm(block.end)}</small>` : `<span class="cl-icon">${icon(dueIcon(item))}</span>`}</span>
      <span class="cl-main"><span class="cl-title">${isAssessment(item) ? icon(dueIcon(item)) : ""}<span class="cl-text">${esc(item.kind)}: ${esc(item.title)}</span></span><span class="cl-meta">${meta}</span></span>${icon("chevron-right", "chev-end")}
    </button></li>`;
  }
  const meta = `<i class="cal-dot" style="--k:${esc(colorOf(item))}"></i>${[sourceLabel(item), item.recurrence ? ruleText(item.recurrence) : "", item.place].filter(Boolean).map(esc).join(", ")}`;
  const later = item.start && !longTimed(item) && item.date !== iso;
  const times = !item.start || longTimed(item) ? `<small>${item.start ? esc(timeText(item)) : "ganztägig"}</small>` : later ? `<small>bis</small><b>${hm(item.end)}</b>` : `<b>${hm(item.start)}</b>${item.end ? `<small>${hm(item.end)}</small>` : ""}`;
  return `<li><button type="button" class="cl-row is-event${isPast(item) ? " is-past" : ""}${selected}" ${base.replaceAll(`row:${esc(item.id)}"`, `row:${esc(item.id)}:${iso}"`)} style="--k:${esc(colorOf(item))}">
    <span class="cl-time">${times}</span>
    <span class="cl-main"><span class="cl-title" data-title-of="${esc(item.series || item.id)}">${esc(item.title)}</span><span class="cl-meta">${meta}</span></span>${icon("chevron-right", "chev-end")}
  </button></li>`;
}

function renderList() {
  const span = period();
  const groups = listEntries(span);
  const loading = state.loading ? loadingHtml(true) : "";
  if (!groups.length) return loading + (state.loading ? "" : emptyHtml(`Keine Termine bis ${shortDate(span.end)}`, span));
  return `${loading}<div class="cl">${groups.map((group) => {
    const label = groupTitle(group.date);
    const school = schoolLine(group.date);
    return `<section class="cl-group" aria-labelledby="cl-${group.iso}">
      <h3 class="group-head" id="cl-${group.iso}" data-flip="head:${group.iso}"><span>${esc(label.title)}</span><small>${esc(label.meta)}</small>${school ? `<small class="group-effort">${esc(school)}</small>` : ""}</h3>
      <ul class="cl-rows">${group.items.map((entry) => listRow(entry, group.iso)).join("")}</ul>
    </section>`;
  }).join("")}</div>`;
}

function viewHtml() {
  if (state.view === "monat") return renderMonth();
  if (state.view === "liste") return renderList();
  return renderWeek();
}

function agendaItem({ type, item }, iso) {
  const selected = state.selected === item.id ? " is-selected" : "";
  if (type === "holiday") {
    return `<li><button type="button" class="cal-agenda-item is-holiday${selected}" data-id="${esc(item.id)}" data-key="ag:${esc(item.id)}"><span class="cal-agenda-time">${icon("sun")}</span><span class="cal-agenda-main"><span class="cal-agenda-title">${esc(item.title)}</span></span></button></li>`;
  }
  if (type === "due") {
    const block = item.block ? blockOf(item.block) : null;
    return `<li><button type="button" class="cal-agenda-item is-due${isAssessment(item) ? " is-test" : ""}${selected}" data-id="${esc(item.id)}" data-key="ag:${esc(item.id)}"><span class="cal-agenda-time">${block ? hm(block.start) : icon(dueIcon(item))}</span><span class="cal-agenda-main"><span class="cal-agenda-title">${esc(item.kind)} ${esc(subjectName(item.subject))}</span><span class="cal-agenda-meta">${esc(item.title)}</span></span></button></li>`;
  }
  const time = !item.start || longTimed(item) ? "ganztägig" : item.date === iso ? hm(item.start) : `bis ${hm(item.end)}`;
  return `<li><button type="button" class="cal-agenda-item${isPast(item) ? " is-past" : ""}${selected}" data-id="${esc(item.id)}" data-key="ag:${esc(item.id)}" style="--k:${esc(colorOf(item))}"><span class="cal-agenda-time">${time}</span><span class="cal-agenda-main"><span class="cal-agenda-title"><i class="cal-dot"></i><span data-title-of="${esc(item.series || item.id)}">${esc(item.title)}</span></span>${item.place ? `<span class="cal-agenda-meta">${esc(item.place)}</span>` : ""}</span></button></li>`;
}

function nextTest() {
  const today = todayIso();
  return deadlines.filter((item) => isAssessment(item) && item.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

function renderOverview() {
  const iso = state.picked ? state.focus : todayIso();
  const date = parseDate(iso);
  const diff = dayDiff(startOfDay(now()), iso);
  const near = Math.abs(diff) <= 1;
  const title = diff === 0 ? "Heute" : diff === 1 ? "Morgen" : diff === -1 ? "Gestern" : longDate(date);
  const meta = [near ? shortDate(date) : "", schoolLine(date)].filter(Boolean).join(", ");
  const items = [
    ...holidaysOn(iso).map((item) => ({ type: "holiday", item })),
    ...dueAt(iso).map((item) => ({ type: "due", item })),
    ...allDayAt(iso).map((item) => ({ type: "event", item })),
    ...timedAt(iso).map((item) => ({ type: "event", item })),
  ];
  const agenda = state.loading && !items.length
    ? `<p class="cal-agenda-empty">Termine werden geladen.</p>`
    : items.length ? `<ol class="cal-agenda">${items.map((entry) => agendaItem(entry, iso)).join("")}</ol>` : `<p class="cal-agenda-empty">${diff === 0 ? "Heute stehen keine Termine an." : "Keine Termine an diesem Tag."}</p>`;
  const back = diff !== 0 ? `<button type="button" class="text-button cal-back" data-back-today>${icon("calendar-days")}<span>Zurück zu heute</span></button>` : "";
  const test = nextTest();
  let testHtml = "";
  if (test) {
    const block = test.block ? `, ${test.block}. Block` : "";
    const open = prepTasks(test.id).length;
    testHtml = `<div class="cal-next">
      <h3 class="cal-next-label">${esc(ASSESSMENTS[test.kind].next)}</h3>
      <button type="button" class="cal-next-card${state.selected === test.id ? " is-selected" : ""}" data-id="${esc(test.id)}" data-key="next:${esc(test.id)}">
        <span class="cal-next-title"><i class="subject-dot" style="--hue:${hueVar(test.subject)}"></i>${esc(subjectName(test.subject))}</span>
        <span class="cal-next-topic">${esc(test.title)}</span>
        <span class="cal-next-when">${esc(shortDate(parseDate(test.date)))}${block}, ${esc(inDays(dayDiff(startOfDay(now()), test.date)))}</span>
      </button>
      ${open ? `<a class="cal-next-prep" ${tasksLink()}>${plural(open, "Aufgabe", "Aufgaben")} zur Vorbereitung offen${icon("chevron-right")}</a>` : ""}
    </div>`;
  }
  const close = `<button class="icon-button cal-overview-close" type="button" data-day-close aria-label="Tagesübersicht schließen">${icon("x")}</button>`;
  $("calOverview").innerHTML = `<div class="cal-overview-body"><div class="cal-overview-day">${close}<h2 class="side-title" id="calOverviewTitle">${esc(title)}</h2>
    ${meta ? `<p class="side-meta">${esc(meta)}</p>` : ""}${agenda}${back}</div>${testHtml}</div>`;
}

function routeLink(place) {
  if (!place || ONLINE.test(place)) return "";
  return `<a class="cal-route" id="calRoute" href="${esc(pageUrl("vbb", `/hub/vbb?nach=${encodeURIComponent(place)}`))}" data-page="vbb">${icon("route")}Route planen</a>`;
}

const outLink = (href, glyph, text, extra = "") => `<a class="cal-route${extra}" href="${esc(href)}" target="_blank" rel="noopener">${icon(glyph)}${text}${icon("arrow-up-right", "is-external")}<span class="visually-hidden">, öffnet in einem neuen Tab</span></a>`;

function whenNote(item) {
  if (!item.start) return "";
  if (!item.end) return `Ab ${hm(item.start)}, Ende offen`;
  const minutes = overnight(item) ? spanDays(item) * 1440 + toMin(item.end) - startOf(item) : endOf(item) - startOf(item);
  return `${duration(minutes).replace(/\u00a0/g, " ")}${overnight(item) && lastDay(item) > item.date ? `, endet ${shortDate(parseDate(item.endDate))}` : ""}`;
}

function normalizeTime(value) {
  const match = value.trim().match(/^(\d{1,2})(?:[:.]?(\d{2}))?(?:\s*uhr)?$/i);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  if (hours > 23 || minutes > 59) return undefined;
  return `${pad(hours)}:${pad(minutes)}`;
}

function reminderText(minutes) {
  const known = REMINDERS.find(([value]) => value === minutes);
  if (known) return known[1];
  if (minutes % 1440 === 0) return `${minutes / 1440} Tage vorher`;
  if (minutes % 60 === 0) return `${minutes / 60} Std. vorher`;
  return `${minutes} Min. vorher`;
}

/* Google keeps descriptions as HTML. The sheet shows them as text with their web links, nothing else. */
function plainText(value) {
  const text = String(value || "");
  if (!/<[a-z!/]/i.test(text)) return text;
  const doc = new DOMParser().parseFromString(text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n"), "text/html");
  doc.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const label = link.textContent.trim();
    if (/^https?:\/\//i.test(href) && label !== href) link.textContent = label ? `${label} (${href})` : href;
  });
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

const formatted = (value) => /<[a-z!/]/i.test(String(value || ""));
const linked = (text) => String(text).split(/(https:\/\/[^\s<>"')]+)/g).map((part, index) => (index % 2 ? `<a href="${esc(part)}" target="_blank" rel="noopener">${esc(part)}</a>` : esc(part))).join("");

function panelHead(markClass, markIcon, title, { editable = false, deletable = false, style = "", draft = false } = {}) {
  const heading = editable
    ? `<textarea class="panel-title" id="calPanelTitle" rows="1" aria-label="Titel"${draft ? ' placeholder="Titel"' : ""}>${esc(title)}</textarea>`
    : `<h2 class="panel-title is-static" id="calPanelTitle">${esc(title)}</h2>`;
  return `<div class="panel-head">
    <span class="cal-mark ${markClass}"${style}>${icon(markIcon)}</span>
    ${heading}
    <div class="panel-tools">
      ${draft ? `<button class="icon-button" type="button" data-draft-save aria-label="Termin anlegen" data-tip="Anlegen">${icon("check")}</button>` : ""}
      ${deletable ? `<button class="icon-button is-danger" type="button" data-panel-delete aria-label="Termin löschen" data-tip="Löschen">${icon("trash-2")}</button>` : ""}
      <button class="icon-button" type="button" data-panel-close aria-label="${draft ? "Neuen Termin verwerfen" : "Details schließen"}" data-tip="${draft ? "Verwerfen" : "Schließen"}">${icon("x")}</button>
    </div>
  </div>`;
}

function guestsHtml(item) {
  const guests = item.attendees || [];
  if (!guests.length) return "";
  const rest = (item.attendeeTotal || guests.length) - guests.length;
  const rows = guests.map((guest) => {
    const name = guest.name || guest.email;
    const [word, tone] = guest.organizer ? ["lädt ein", ""] : RESPONSES[guest.status] || RESPONSES.needsAction;
    return `<li class="cal-guest"><span class="cal-guest-mark" aria-hidden="true">${esc(name.slice(0, 1).toUpperCase())}</span><span class="cal-guest-name" title="${esc(guest.email)}">${esc(name)}${guest.self ? " (du)" : ""}</span><span class="cal-guest-state${tone}">${word}</span></li>`;
  }).join("");
  return `<div class="field"><span class="field-label">${plural(item.attendeeTotal || guests.length, "Gast", "Gäste")}</span><ul class="cal-guests">${rows}</ul>${rest > 0 ? `<p class="cal-hint">und ${rest} weitere</p>` : ""}</div>`;
}

function linksHtml(item) {
  const links = [item.meetLink ? outLink(item.meetLink, "video", "Mit Google Meet teilnehmen", " cal-meet") : "", item.htmlLink ? outLink(item.htmlLink, "calendar-days", "In Google öffnen") : ""].filter(Boolean);
  return links.length ? `<div class="cal-links">${links.join("")}</div>` : "";
}

const calendarLine = (item) => (item.calendarName ? `<span class="cal-calendar"><i class="cal-dot" style="--k:${esc(colorOf(item))}"></i>${esc(item.calendarName)}</span>` : "");

function repeatHtml(item) {
  const rule = normalizeRecurrence(item.recurrence);
  const key = !rule ? "" : rule.freq === "weekly" && rule.interval === 2 ? "biweekly" : rule.interval === 1 ? rule.freq : "custom";
  const options = REPEATS.map(([value, label]) => `<option value="${value}"${value === key ? " selected" : ""}>${label}</option>`).join("") + (key === "custom" ? `<option value="custom" selected>${esc(ruleText(rule))}</option>` : "");
  const ends = rule ? (rule.count ? "count" : rule.until ? "until" : "never") : "never";
  const endControls = !rule ? "" : `<select class="field-control cal-select" id="calPanelEnds" aria-label="Ende der Wiederholung">
      <option value="never"${ends === "never" ? " selected" : ""}>ohne Ende</option><option value="until"${ends === "until" ? " selected" : ""}>bis zum</option><option value="count"${ends === "count" ? " selected" : ""}>Anzahl</option>
    </select>${ends === "until" ? `<input class="field-control cal-select" type="date" id="calPanelUntil" value="${esc(rule.until)}" min="${esc(item.series ? state.events.find((entry) => entry.id === item.series)?.date || item.date : item.date)}" aria-label="Letzter Tag">` : ""}${ends === "count" ? `<input class="field-control cal-count" type="number" id="calPanelCount" min="1" max="1000" value="${rule.count}" inputmode="numeric" aria-label="Anzahl der Termine"><span class="cal-hint">Mal</span>` : ""}`;
  return `<div class="field"><label class="field-label" for="calPanelRepeat">Wiederholen</label><div class="cal-row"><select class="field-control cal-select" id="calPanelRepeat">${options}</select>${endControls}</div></div>`;
}

function reminderHtml(item) {
  const prefs = readPrefs();
  const fallback = prefs.categories.events.on ? reminderText(Number(prefs.categories.events.lead) || 15) : "aus";
  const value = item.reminderMinutes ?? "";
  const known = value === "" || REMINDERS.some(([minutes]) => minutes === value);
  const options = [`<option value=""${value === "" ? " selected" : ""}>Standard (${fallback})</option>`, ...REMINDERS.map(([minutes, label]) => `<option value="${minutes}"${minutes === value ? " selected" : ""}>${label}</option>`), known ? "" : `<option value="${value}" selected>${reminderText(value)}</option>`].join("");
  const note = prefs.enabled ? "" : `<p class="cal-hint">Erinnerungen sind in den Einstellungen aus.</p>`;
  return `<div class="field"><label class="field-label" for="calPanelReminder">Erinnerung</label><select class="field-control cal-select" id="calPanelReminder">${options}</select>${note}</div>`;
}

function scopeHtml(item) {
  if (!item.series || item.draft) return "";
  const button = (value, label) => `<button type="button" data-scope="${value}" aria-pressed="${state.scope === value}">${label}</button>`;
  return `<div class="cal-scope"><span class="cal-hint" id="calScopeLabel">${esc(ruleText(item.recurrence))}. Ändern für</span><div class="segmented" role="group" aria-labelledby="calScopeLabel">${button("one", "Diesen Termin")}${button("all", "Alle Termine")}</div></div>`;
}

function confirmHtml(item) {
  if (state.confirm !== item.id) return "";
  const what = item.series && state.scope === "all" ? "Alle Termine dieser Reihe löschen?" : item.synced ? "Auch im Google-Kalender löschen?" : "Termin löschen?";
  return `<div class="cal-confirm" role="alert"><span>${what}</span><button class="btn btn-quiet" type="button" data-confirm-cancel>Behalten</button><button class="btn btn-primary" type="button" data-confirm-delete>Löschen</button></div>`;
}

function panelEdit(item) {
  const own = !item.synced;
  const draft = !!item.draft;
  const mark = own ? KINDS[item.kind].icon : "calendar-days";
  const series = own && (!item.series || state.scope === "all");
  return `${panelHead("is-event", mark, item.title, { editable: true, deletable: !draft, draft, style: ` style="--k:${esc(colorOf(item))}"` })}
    ${scopeHtml(item)}${confirmHtml(item)}
    <div class="panel-fields">
      <div class="field">
        <span class="field-label" id="calTimeLabel">Zeit</span>
        <div class="cal-when" role="group" aria-labelledby="calTimeLabel">
          <button type="button" class="pill cal-date-pill" data-date-pick aria-label="Datum ändern, ${esc(longDate(parseDate(item.date)))}">${icon("calendar-days")}<span id="calDateText">${esc(shortDate(parseDate(item.date)))}</span></button>
          <input class="date-proxy" type="date" id="calPanelDate" value="${esc(item.date)}" tabindex="-1" aria-hidden="true">
          <button type="button" class="pill cal-allday" data-allday aria-pressed="${!item.start}">Ganztägig</button>
          <span class="cal-when-times">
            <input class="field-control cal-time" id="calPanelStart" value="${item.start ? hm(item.start) : ""}" placeholder="ganztägig" inputmode="numeric" maxlength="5" autocomplete="off" aria-label="Beginn, zum Beispiel 16:30" aria-describedby="calWhenNote">
            <span class="cal-when-to" aria-hidden="true">bis</span>
            <input class="field-control cal-time" id="calPanelEnd" value="${item.end ? hm(item.end) : ""}" placeholder="offen" inputmode="numeric" maxlength="5" autocomplete="off" aria-label="Ende, zum Beispiel 17:45"${item.start ? "" : " disabled"}>
          </span>
        </div>
        <p class="cal-when-note" id="calWhenNote" aria-live="polite">${esc(whenNote(item))}</p>
      </div>
      ${series ? repeatHtml(item) : ""}${own && item.start ? reminderHtml(item) : ""}
      ${own ? "" : `<div class="field"><span class="field-label">Kalender</span>${calendarLine(item)}</div>`}
      <div class="field">
        <label class="field-label" for="calPanelPlace">Ort</label>
        <input class="field-control" id="calPanelPlace" value="${esc(item.place || "")}" placeholder="Wo findet es statt?" autocomplete="off">
        <div class="cal-route-slot" id="calRouteSlot">${routeLink(item.place)}</div>
      </div>
      ${own ? `<div class="field">
        <span class="field-label" id="calKindLabel">Art</span>
        <div class="field-body" role="group" aria-labelledby="calKindLabel">${Object.entries(KINDS).map(([key, kind]) => `<button type="button" class="pill cal-kind" data-kind="${key}" aria-pressed="${item.kind === key}" style="--k:${kindVar(key)}"><i class="cal-dot"></i>${kind.label}</button>`).join("")}</div>
      </div>` : ""}
      <label class="field"><span class="field-label">${own ? "Notizen" : "Beschreibung"}</span><textarea class="field-control" id="calPanelNotes" rows="3" placeholder="${own ? "Was du mitbringen oder vorbereiten willst" : "Was dazu im Kalender stehen soll"}">${esc(own ? item.notes || "" : plainText(item.notes))}</textarea>${!own && formatted(item.notes) ? '<span class="cal-hint">Beim Ändern geht die Formatierung verloren, Links bleiben als Adresse.</span>' : ""}</label>
      ${own ? "" : `${guestsHtml(item)}${linksHtml(item) ? `<div class="field">${linksHtml(item)}</div>` : ""}`}
      ${draft ? `<div class="cal-save"><button class="btn btn-quiet" type="button" data-draft-cancel>Abbrechen</button><button class="btn btn-primary" type="button" data-draft-save>${icon("check")}Anlegen</button></div>` : `<p class="panel-source">${icon("calendar-days")}${own ? ownSource(item) : "Aus dem Google-Kalender, Änderungen gehen dorthin"}</p>`}
    </div>`;
}

function panelRead(item) {
  const facts = [
    ["Zeit", `<span class="cal-when-text">${esc(longDate(parseDate(item.date)))}${item.start ? `, ${esc(timeText(item))}` : item.endDate ? ` bis ${esc(longDate(parseDate(item.endDate)))}` : ", ganztägig"}</span>`],
    item.calendarName ? ["Kalender", calendarLine(item)] : null,
    item.place ? ["Ort", `${esc(item.place)}${routeLink(item.place) ? `<div class="cal-route-slot">${routeLink(item.place)}</div>` : ""}`] : null,
    item.notes ? ["Beschreibung", `<span class="cal-notes-text">${linked(plainText(item.notes))}</span>`] : null,
    item.start && item.reminderMinutes != null ? ["Erinnerung", esc(reminderText(eventMinutes(item, readPrefs().categories.events)))] : null,
  ];
  return `${panelHead("is-event", "calendar-days", item.title, { style: ` style="--k:${esc(colorOf(item))}"` })}
    ${factsHtml(facts)}${guestsHtml(item)}${linksHtml(item)}
    <p class="panel-source">${icon("calendar-days")}${item.source === "IServ" ? "Aus IServ" : `Aus ${esc(item.source || "einem verbundenen Kalender")}${item.inSeries ? ", gehört zu einer Reihe" : ""}`}</p>`;
}

function panelEvent(item) {
  return item.draft || editable(item) ? panelEdit(item) : panelRead(item);
}

function panelDue(item) {
  const date = parseDate(item.date);
  const lesson = item.block ? lessonsFor(date).find((entry) => entry.block === item.block) : null;
  const open = prepTasks(item.id);
  const overdue = isOverdue(item, todayIso());
  const tone = overdue || isAssessment(item) ? " is-urgent" : "";
  const facts = [
    ["Art", `<i class="subject-dot" style="--hue:${hueVar(item.subject)}"></i>${esc(item.kind)}, ${esc(subject(item.subject).name)}`],
    ["Zeit", `${esc(longDate(date))}${item.block ? `<br>${esc(dueTime(item))}` : ""}${overdue ? `<br><b class="cal-urgent">überfällig seit ${esc(shortDate(date))}</b>` : ""}`],
    lesson ? ["Raum", `${esc(lesson.room)}, ${esc(lesson.teacher)}`] : null,
    item.detail ? ["Hinweis", `<span class="cal-detail">${esc(item.detail)}</span>`] : null,
    open.length ? ["Vorbereitung", `<a class="cal-link" ${tasksLink()}>${plural(open.length, "Aufgabe", "Aufgaben")} offen${icon("chevron-right")}</a>`] : null,
  ];
  return `${panelHead(`is-due${tone}`, dueIcon(item), item.title)}
    ${factsHtml(facts)}
    <p class="panel-source">${icon("graduation-cap")}Unter Schule eingetragen</p>`;
}

function factsHtml(facts) {
  return `<dl class="cal-facts">${facts.filter(Boolean).map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

function panelHoliday(item) {
  const days = dayDiff(parseDate(item.date), item.endDate) + 1;
  const when = days > 1 ? `${shortDate(parseDate(item.date))} bis ${shortDate(parseDate(item.endDate))}, ${plural(days, "Tag", "Tage")}` : longDate(parseDate(item.date));
  return `${panelHead("is-holiday", "sun", item.title)}
    ${factsHtml([["Zeit", esc(when)], ["Schule", "unterrichtsfrei"]])}
    <p class="panel-source">${icon("calendar-days")}${item.type === "ferien" ? "Schulferien" : "Feiertage"} ${esc(extra.region || "")}</p>`;
}

function renderPanel() {
  const entry = findEntry(state.selected);
  const panel = $("calPanel");
  if (!entry) return;
  panel.setAttribute("aria-label", entry.item.title);
  panel.innerHTML = entry.type === "event" ? panelEvent(entry.item) : entry.type === "due" ? panelDue(entry.item) : panelHoliday(entry.item);
}

function markSelected() {
  document.querySelectorAll("#calView [data-id], #calView [data-item], #calOverview [data-id]").forEach((node) => {
    node.classList.toggle("is-selected", (node.dataset.id || node.dataset.item) === state.selected);
  });
}

function openItem(id, { keyboard = false, reveal = false } = {}) {
  const entry = findEntry(id);
  if (!entry) return;
  if (state.draft && id !== state.draft.id) dropDraft();
  if (reveal && !inPeriod(entry.item.date)) {
    revealDate(entry.item.date);
    state.scroll = entry.item.start ? Math.max(0, startOf(entry.item) - 60) : "auto";
    render({ fade: true });
  }
  const opening = state.selected == null;
  if (state.selected !== id) {
    state.scope = "one";
    state.confirm = null;
  }
  state.selected = id;
  renderPanel();
  const panel = $("calPanel");
  panel.hidden = false;
  $("calendarPage").classList.add("has-panel");
  syncOverview();
  markSelected();
  if (opening && animates()) {
    const sheet = matchMedia("(max-width: 1100px)").matches;
    const frames = travels()
      ? [{ opacity: 0, transform: sheet ? "translateY(16px)" : "translateX(12px)" }, { opacity: 1, transform: "none" }]
      : [{ opacity: 0 }, { opacity: 1 }];
    panel.animate(frames, { duration: sheet ? ms("--dur-sheet-in") || 240 : 240, easing: token("--ease-out") });
  }
  if (keyboard) panel.focus({ preventScroll: true });
}

function closePanel({ refocus = false } = {}) {
  const id = state.selected;
  if (state.draft) {
    dropDraft();
    render();
  }
  state.selected = null;
  state.confirm = null;
  $("calPanel").hidden = true;
  $("calendarPage").classList.remove("has-panel");
  syncOverview();
  markSelected();
  if (refocus && id) {
    const date = findEntry(id)?.item.date;
    const target = document.querySelector(`#calView [data-id="${CSS.escape(id)}"], #calOverview [data-id="${CSS.escape(id)}"]`) || (date && document.querySelector(`#calView [data-key="day:${date}"]`));
    target?.focus({ preventScroll: true });
  }
}

function syncOverview() {
  $("calendarPage").classList.toggle("has-day", state.dayOpen && DRAWER.matches);
  $("calOverview").hidden = state.selected != null && !FLOATING.matches;
}

function holdFocus(paint) {
  const active = document.activeElement;
  const key = active?.closest?.("[data-key]")?.dataset.key;
  paint();
  if (!key || active.isConnected) return;
  document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}

function renderChrome() {
  $("calViews").querySelectorAll("[data-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.view === state.view)));
  const range = rangeText();
  $("calRangeText").textContent = range.text;
  $("calRangeMeta").textContent = range.meta;
  const [back, forward] = NAV_WORDS[state.view];
  $("calPrev").setAttribute("aria-label", back);
  $("calPrev").dataset.tip = back;
  $("calNext").setAttribute("aria-label", forward);
  $("calNext").dataset.tip = forward;
  $("calCount").textContent = countLine();
  $("calToday").setAttribute("aria-label", `Heute, ${longDate(now())}`);
}

function slideIn(direction) {
  const view = $("calView");
  if (!animates()) return;
  const frames = travels()
    ? [{ opacity: 0, transform: `translateX(${direction * 20}px)` }, { opacity: 1, transform: "none" }]
    : [{ opacity: 0 }, { opacity: 1 }];
  view.animate(frames, { duration: travels() ? 280 : 150, easing: token("--ease-out") });
}

function fitTitles() {
  document.querySelectorAll("#calView .ev.is-tall").forEach((card) => {
    const title = card.querySelector(".ev-title");
    card.classList.remove("is-clip", "is-cramped");
    card.classList.toggle("is-clip", title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1);
    card.classList.toggle("is-cramped", card.scrollHeight > card.clientHeight + 1);
  });
}

function popFresh() {
  if (!state.fresh) return;
  const id = state.fresh;
  state.fresh = null;
  document.querySelectorAll(`#calView [data-id="${CSS.escape(id)}"], #calView [data-item="${CSS.escape(id)}"]`).forEach((node) => {
    node.classList.add("is-new");
    node.addEventListener("animationend", () => node.classList.remove("is-new"), { once: true });
    if (!animates()) return;
    const frames = travels() ? [{ opacity: 0, transform: "scale(0.92)" }, { opacity: 1, transform: "none" }] : [{ opacity: 0 }, { opacity: 1 }];
    node.animate(frames, { duration: travels() ? ms("--spring-tactile-dur") : 150, easing: travels() ? token("--spring-tactile") : "ease-out" });
  });
}

function render({ slide = 0, fade = false, flip = false } = {}) {
  refreshShown();
  const kept = $("calView").querySelector(".cw-scroll")?.scrollTop;
  const paint = () => holdFocus(() => {
    const view = $("calView");
    view.dataset.view = state.view;
    view.innerHTML = viewHtml();
    if (state.view === "monat" && placeMonth()) view.innerHTML = viewHtml();
    const scroller = view.querySelector(".cw-scroll");
    if (scroller && kept != null && state.scroll == null) scroller.scrollTop = kept;
    placeWeek();
    fitTitles();
    renderOverview();
  });
  if (flip) flipKeyed("#calView [data-flip]", paint);
  else paint();
  renderChrome();
  markSelected();
  if (slide) slideIn(slide);
  else if (fade) crossfade($("calView"), 160);
  popFresh();
  ensureRange();
}

function announce() {
  const range = rangeText();
  const live = $("liveStatus");
  if (live) live.textContent = `${range.text}${range.meta ? `, ${range.meta}` : ""}`;
}

function revealDate(iso) {
  const date = parseDate(iso);
  if (!inPeriod(iso)) {
    if (state.view === "liste") {
      const offset = dayDiff(startOfDay(now()), iso);
      state.anchor = offset >= 0 && offset < LIST_DAYS ? startOfDay(now()) : date;
    } else {
      state.anchor = date;
    }
  }
  state.focus = iso;
}

function keepFocusInView(paint) {
  const inside = $("calView").contains(document.activeElement);
  paint();
  if (inside && !$("calView").contains(document.activeElement)) $("calView").querySelector('[tabindex="0"], [data-id]')?.focus({ preventScroll: true });
}

function step(direction) {
  const focus = parseDate(state.focus);
  if (state.view === "woche") {
    state.anchor = addDays(mondayOf(state.anchor), 7 * direction);
    state.focus = isoDate(addDays(focus, 7 * direction));
  } else if (state.view === "monat") {
    const month = new Date(state.anchor.getFullYear(), state.anchor.getMonth() + direction, 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    state.anchor = month;
    state.focus = isoDate(new Date(month.getFullYear(), month.getMonth(), Math.min(focus.getDate(), last)));
  } else {
    state.anchor = addDays(startOfDay(state.anchor), LIST_DAYS * direction);
    state.focus = isoDate(state.anchor);
  }
  if (!state.picked && inPeriod(todayIso())) state.focus = todayIso();
  state.scroll = "auto";
  keepFocusInView(() => render({ slide: direction }));
  announce();
}

function goToday() {
  const today = todayIso();
  const span = period();
  const direction = today < isoDate(span.start) ? -1 : today > isoDate(span.end) ? 1 : 0;
  state.anchor = startOfDay(now());
  state.focus = today;
  state.picked = false;
  state.dayOpen = false;
  state.scroll = "auto";
  syncOverview();
  keepFocusInView(() => render({ slide: direction, fade: !direction }));
  announce();
}

function setView(view) {
  if (!VIEWS.includes(view) || view === state.view) return;
  state.view = view;
  storage.set("app-cal-view", view);
  state.anchor = parseDate(state.focus);
  state.scroll = "auto";
  closeMore();
  keepFocusInView(() => render({ fade: true }));
  announce();
}

function focusDay(iso, { keyboard = false } = {}) {
  const span = period();
  const direction = iso < isoDate(span.start) ? -1 : iso > isoDate(span.end) ? 1 : 0;
  state.focus = iso;
  state.picked = true;
  state.dayOpen = DRAWER.matches;
  if (direction) {
    state.anchor = parseDate(iso);
    state.scroll = "auto";
  }
  syncOverview();
  render({ slide: direction, fade: !direction && state.narrow && state.view === "woche" });
  if (keyboard) document.querySelector(`#calView [data-key="day:${iso}"]`)?.focus({ preventScroll: true });
  if (direction) announce();
}

function onDayKeys(event) {
  const button = event.target.closest?.(".cw-day, .cm-day");
  if (!button || event.altKey || event.ctrlKey || event.metaKey) return false;
  const date = parseDate(button.dataset.day);
  const month = state.view === "monat";
  const dow = date.getDay() || 7;
  const moves = {
    ArrowLeft: () => addDays(date, -1),
    ArrowRight: () => addDays(date, 1),
    ArrowUp: month ? () => addDays(date, -7) : null,
    ArrowDown: month ? () => addDays(date, 7) : null,
    Home: () => addDays(date, 1 - dow),
    End: () => addDays(date, 7 - dow),
    PageUp: month ? () => new Date(date.getFullYear(), date.getMonth() - 1, Math.min(date.getDate(), new Date(date.getFullYear(), date.getMonth(), 0).getDate())) : () => addDays(date, -7),
    PageDown: month ? () => new Date(date.getFullYear(), date.getMonth() + 1, Math.min(date.getDate(), new Date(date.getFullYear(), date.getMonth() + 2, 0).getDate())) : () => addDays(date, 7),
  };
  const move = moves[event.key];
  if (!move) return false;
  event.preventDefault();
  focusDay(isoDate(move()), { keyboard: true });
  return true;
}

function orderedTargets() {
  const view = $("calView");
  if (state.view === "monat") return [...view.querySelectorAll(".cm-day")].filter((node) => node.closest("td")?.querySelector(".cm-item, .cal-dot"));
  return [...view.querySelectorAll("[data-id]")].sort((a, b) => (a.dataset.order || "").localeCompare(b.dataset.order || ""));
}

function moveItemFocus(direction) {
  const targets = orderedTargets();
  if (!targets.length) return;
  const current = targets.indexOf(document.activeElement);
  const next = current < 0 ? (direction > 0 ? 0 : targets.length - 1) : Math.min(targets.length - 1, Math.max(0, current + direction));
  const target = targets[next];
  if (state.view === "monat" && target.dataset.day !== state.focus) {
    focusDay(target.dataset.day, { keyboard: true });
    return;
  }
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest" });
}

const PAGE_NOISE = /\b(S\.|Seite|Nr\.|Nummer|Aufgabe|Aufg\.|Unit|Kapitel)\s*\d+[a-z]?(\s*(f\.|ff\.|bis\s*\d+))?/gi;
const TIME_RANGE = /(?:\bvon\s+)?\b([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(?:uhr\s*)?(?:-|–|bis)\s*([01]?\d|2[0-3])(?:[:.]([0-5]\d))?(?:\s*uhr)?\b/i;
const TIME_SINGLE = [
  /(?:\b(?:um|ab|gegen|so)\s+)?\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*uhr)?\b/i,
  /\b(?:um|ab|gegen)\s+([01]?\d|2[0-3])(?:\s*uhr)?\b/i,
  /(?:\bso\s+)?\b([01]?\d|2[0-3])\s*uhr\b/i,
];
const pad = (value) => String(value).padStart(2, "0");
const hhmm = (minute) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

function cut(text, phrase) {
  if (!phrase) return text;
  const index = phraseAt(text, phrase);
  return index < 0 ? text : `${text.slice(0, index)} ${text.slice(index + phrase.length)}`;
}

// The time of day the date came with ("Do Abend 8 Uhr") moves the hour as in the assistant (spoken_time.py, _later).
function later(hour, part) {
  const value = Number(hour);
  if (!part) return value;
  if (/^(?:nachmittag|abend)/.test(part) && value >= 1 && value < 12) return value + 12;
  if (part.startsWith("nacht")) return value === 12 ? 0 : value >= 9 && value < 12 ? value + 12 : value;
  if (part.startsWith("mittag") && value >= 1 && value <= 4) return value + 12;
  return value;
}

function parseTime(text, part = null) {
  const clean = text.replace(PAGE_NOISE, (match) => " ".repeat(match.length));
  const range = clean.match(TIME_RANGE);
  if (range && (range[2] || range[4] || /uhr|von/i.test(range[0]))) {
    const start = `${pad(later(range[1], part))}:${range[2] || "00"}`;
    const end = `${pad(later(range[3], part))}:${range[4] || "00"}`;
    if (toMin(end) > toMin(start)) return { start, end, phrase: text.substr(range.index, range[0].length) };
  }
  for (const pattern of TIME_SINGLE) {
    const match = clean.match(pattern);
    if (match) {
      const start = `${pad(later(match[1], part))}:${match[2] || "00"}`;
      return { start, end: null, phrase: text.substr(match.index, match[0].length) };
    }
  }
  return null;
}

function defaultDay() {
  return state.picked ? state.focus : todayIso();
}

export function parseEntry(text) {
  const info = parseNote(text);
  const date = info.date || null;
  const time = parseTime(cut(text, info.phrases.date), info.part);
  let start = time?.start || null;
  let end = time?.end || null;
  if (!start && info.block) {
    const block = blockOf(info.block);
    start = block.start;
    end = block.end;
  }
  if (start && !end) end = hhmm(Math.min(1439, toMin(start) + 60));
  const title = cleanTitle(cut(text, time?.phrase), info).replace(/\s+(um|am|von|ab)$/i, "").trim();
  let kind = "private";
  if (TRAINING_WORDS.test(text)) kind = "training";
  else if (PRIVATE_WORDS.test(text)) kind = "private";
  else if (SCHOOL_WORDS.test(text) || info.subject) kind = "school";
  return { title, date: date || defaultDay(), start, end, kind };
}

function renderQuickChips() {
  const text = $("calQuickInput").value;
  const chips = [];
  if (text.trim()) {
    const entry = parseEntry(text);
    chips.push(`<span class="chip">${icon("calendar-days")}${esc(shortDate(parseDate(entry.date)))}</span>`);
    chips.push(`<span class="chip">${icon("clock")}${entry.start ? `${hm(entry.start)} bis ${hm(entry.end)}` : "ganztägig"}</span>`);
    chips.push(`<span class="chip cal-kind-chip" style="--k:${kindVar(entry.kind)}"><i class="cal-dot"></i>${KINDS[entry.kind].label}</span>`);
  }
  const host = $("calQuickChips");
  const markup = chips.join("");
  if (host.dataset.markup !== markup) {
    host.dataset.markup = markup;
    host.innerHTML = markup;
  }
  $("calQuick").classList.toggle("has-chips", chips.length > 0);
}

function shareEvents() {
  if (data && !flags.empty) data.events = state.events.filter((item) => !item.draft);
}

function addEvent(fields, { quiet = false } = {}) {
  const item = { place: "", kind: "private", notes: "", ...fields, id: `neu-${Date.now()}`, synced: false };
  delete item.draft;
  if (!item.recurrence) delete item.recurrence;
  if (item.reminderMinutes == null) delete item.reminderMinutes;
  state.events.push(item);
  eventApi.create(item);
  shareEvents();
  const before = period();
  revealDate(item.date);
  const after = period();
  const direction = isoDate(after.start) > isoDate(before.start) ? 1 : isoDate(after.start) < isoDate(before.start) ? -1 : 0;
  state.fresh = item.id;
  if (direction) state.scroll = item.start ? Math.max(0, startOf(item) - 60) : "auto";
  render({ slide: direction });
  if (direction) announce();
  if (!quiet) {
    toast(`Angelegt: „${esc(item.title)}“, ${esc(shortDate(parseDate(item.date)))}${item.start ? `, ${hm(item.start)}` : ""}`, {
      icon: "check",
      action: { label: "Rückgängig", undo: true, run: () => removeEvent(item.id, { silent: true }) },
    });
  }
  return item;
}

function createEvent(text) {
  const entry = parseEntry(text);
  if (!entry.title) return;
  addEvent({ date: entry.date, start: entry.start, end: entry.end, title: entry.title, kind: entry.kind });
}

/* A new event that is not saved yet: it shows in the grid while its sheet asks for a title. */
function openDraft(fields) {
  if (state.draft) dropDraft();
  state.selected = null;
  state.draft = { id: "draft", title: "", place: "", kind: "private", notes: "", start: null, end: null, ...fields, draft: true, synced: false };
  state.dayOpen = false;
  render();
  openItem("draft");
  const title = $("calPanelTitle");
  title?.focus({ preventScroll: true });
}

function dropDraft() {
  if (!state.draft) return;
  if (state.selected === state.draft.id) state.selected = null;
  state.draft = null;
}

function saveDraft() {
  const draft = state.draft;
  if (!draft) return;
  const title = ($("calPanelTitle")?.value || draft.title).replace(/\s+/g, " ").trim();
  if (!title) {
    $("calPanelTitle")?.focus();
    toast("Gib dem Termin noch einen Titel.", { icon: "pencil" });
    return;
  }
  state.draft = null;
  state.selected = null;
  $("calPanel").hidden = true;
  $("calendarPage").classList.remove("has-panel");
  syncOverview();
  addEvent({ ...draft, title });
}

function removeEvent(id, { silent = false } = {}) {
  const item = findEntry(id)?.item;
  if (!item || item.draft) return;
  if (!editable(item)) {
    toast(`Dieser Termin kommt aus ${esc(item.source || "einem verbundenen Kalender")}. Lösch ihn dort.`, { icon: "calendar-days" });
    return;
  }
  const nodes = [...document.querySelectorAll(`#calView [data-id="${CSS.escape(id)}"], #calView [data-item="${CSS.escape(id)}"], #calOverview [data-id="${CSS.escape(id)}"]`)];
  const hadFocus = nodes.some((node) => node.contains(document.activeElement)) || $("calPanel").contains(document.activeElement);
  const leave = () => {
    if (state.selected === id) closePanel();
    Promise.all(nodes.map((node) => exitInPlace(node))).then(() => {
      render({ flip: true });
      if (hadFocus) $("calQuickInput").focus({ preventScroll: true });
    });
  };
  const series = seriesOf(item);
  if (series && state.scope !== "all") {
    const previous = series.recurrence;
    const rule = normalizeRecurrence(previous);
    saveChanges(series, { recurrence: { ...rule, exceptions: [...rule.exceptions, item.occurrence] } });
    leave();
    if (!silent) {
      toast(`Gelöscht: „${esc(item.title)}“ am ${esc(shortDate(parseDate(item.occurrence)))}`, {
        icon: "trash-2",
        action: { label: "Rückgängig", undo: true, run: () => {
          saveChanges(series, { recurrence: previous });
          render();
        } },
      });
    }
    return;
  }
  const base = series || item;
  const index = state.events.indexOf(base);
  if (index < 0) return;
  state.events.splice(index, 1);
  removed.add(base.synced ? base.id : serverId(base.id) || base.id);
  const sent = eventApi.remove(base.id);
  shareEvents();
  leave();
  if (base.synced) {
    sent.then(() => {
      if (!silent) toast(`Gelöscht: „${esc(base.title)}“, auch im Google-Kalender`, { icon: "trash-2" });
    }, () => {
      state.events.splice(Math.min(index, state.events.length), 0, base);
      removed.delete(base.id);
      shareEvents();
      render();
      toast(`„${esc(base.title)}“ ließ sich im Google-Kalender nicht löschen.`, { icon: "wifi-off" });
    });
    return;
  }
  if (silent) return;
  toast(`Gelöscht: „${esc(base.title)}“${series ? " mit allen Terminen der Reihe" : ""}`, {
    icon: "trash-2",
    action: { label: "Rückgängig", undo: true, run: () => {
      state.events.splice(Math.min(index, state.events.length), 0, base);
      eventApi.restore(base);
      shareEvents();
      revealDate(base.date);
      state.fresh = base.id;
      render();
    } },
  });
}

const seriesOf = (item) => (item?.series ? state.events.find((entry) => entry.id === item.series) || null : null);

/* What a change from the open sheet applies to. One occurrence of a series becomes an event of its own and is left
   out of the series; for all of them the series itself changes, its days moved by as much as this one. */
function targetFor(item, changes) {
  if (item.draft || !item.series) return { target: item, changes };
  const series = seriesOf(item);
  if (!series) return { target: item, changes };
  if (state.scope === "all") {
    const moved = { ...changes };
    if (changes.date) {
      const shift = dayDiff(parseDate(item.date), changes.date);
      const rule = normalizeRecurrence(series.recurrence);
      const by = (iso) => isoDate(addDays(parseDate(iso), shift));
      moved.date = by(series.date);
      if (series.endDate) moved.endDate = by(series.endDate);
      if (rule) moved.recurrence = { ...rule, exceptions: rule.exceptions.map(by), until: rule.until ? by(rule.until) : null };
    }
    // The sheet shows one occurrence, so its last day counts from that occurrence and not from the first of the series.
    if ("endDate" in changes) {
      const span = changes.endDate ? dayDiff(parseDate(changes.date || item.date), changes.endDate) : 0;
      moved.endDate = span > 0 ? isoDate(addDays(parseDate(moved.date || series.date), span)) : null;
    }
    return { target: series, changes: moved };
  }
  const rule = normalizeRecurrence(series.recurrence);
  saveChanges(series, { recurrence: { ...rule, exceptions: [...rule.exceptions, item.occurrence] } });
  const single = { title: item.title, date: item.date, endDate: item.endDate, start: item.start, end: item.end, place: item.place, kind: item.kind, notes: item.notes, reminderMinutes: item.reminderMinutes };
  const copy = addEvent({ ...single, ...changes }, { quiet: true });
  if (state.selected === item.id) state.selected = copy.id;
  return { target: copy, changes: {} };
}

function saveChanges(item, changes) {
  if (!Object.keys(changes).length) return;
  if (item.draft) {
    Object.assign(item, changes);
    return;
  }
  const before = Object.fromEntries(Object.keys(changes).map((key) => [key, item[key]]));
  Object.assign(item, changes);
  if (!changes.recurrence && "recurrence" in changes) delete item.recurrence;
  const sent = eventApi.update(item.id, changes);
  if (item.synced) {
    sent.catch(() => {
      Object.assign(item, before);
      render();
      toast(`Die Änderung an „${esc(item.title)}“ kam nicht im Google-Kalender an.`, { icon: "wifi-off" });
    });
  }
  shareEvents();
}

function updateEvent(changes, { flip = true } = {}) {
  const item = findEntry(state.selected)?.item;
  if (!item || !(item.draft || editable(item))) return null;
  const { target, changes: applied } = targetFor(item, changes);
  saveChanges(target, applied);
  const day = applied.date && target.id === state.selected ? applied.date : changes.date;
  if (day && !inPeriod(day)) {
    revealDate(day);
    render({ fade: true });
  } else {
    render({ flip });
  }
  return findEntry(state.selected)?.item || target;
}

const panelItem = () => findEntry(state.selected)?.item || null;

/* A typed change: on one occurrence of a series it first turns that one into an event of its own. */
function typed(field, value) {
  const item = panelItem();
  if (!item || !(item.draft || editable(item))) return null;
  if (item.draft) {
    item[field] = value;
    return null;
  }
  if (item.series && state.scope !== "all") {
    targetFor(item, { [field]: value });
    return null;
  }
  const target = item.series ? seriesOf(item) || item : item;
  if (target.synced && !typedBefore.has(`${target.id}:${field}`)) typedBefore.set(`${target.id}:${field}`, { [field]: target[field] });
  target[field] = value;
  return target;
}

function rule(changes) {
  const item = panelItem();
  const base = item?.series ? seriesOf(item) : item;
  const current = normalizeRecurrence(base?.recurrence) || { freq: "weekly", interval: 1, until: null, count: null, exceptions: [] };
  return { ...current, ...changes };
}

/* After a change to the rule the open occurrence may no longer exist: the sheet stays on the series. */
function changeRule(recurrence) {
  const item = panelItem();
  const base = item?.series ? seriesOf(item) || item : item;
  if (!base) return;
  updateEvent({ recurrence });
  state.scope = "all";
  state.selected = [state.selected, occurrenceId(base.id, base.date), base.id].find((id) => findEntry(id));
  renderPanel();
  markSelected();
}

function bindPanel() {
  const panel = $("calPanel");
  panel.addEventListener("click", (event) => {
    const item = panelItem();
    if (event.target.closest("[data-panel-close], [data-draft-cancel]")) closePanel({ refocus: true });
    else if (event.target.closest("[data-draft-save]")) saveDraft();
    else if (event.target.closest("[data-panel-delete]")) {
      if (item && (item.synced || (item.series && state.scope === "all"))) {
        state.confirm = item.id;
        renderPanel();
        panel.querySelector("[data-confirm-delete]")?.focus({ preventScroll: true });
      } else {
        removeEvent(state.selected);
      }
    } else if (event.target.closest("[data-confirm-delete]")) {
      state.confirm = null;
      removeEvent(state.selected);
    } else if (event.target.closest("[data-confirm-cancel]")) {
      state.confirm = null;
      renderPanel();
      panel.querySelector("[data-panel-delete]")?.focus({ preventScroll: true });
    } else if (event.target.closest("[data-scope]")) {
      state.scope = event.target.closest("[data-scope]").dataset.scope;
      state.confirm = null;
      renderPanel();
      panel.querySelector(`[data-scope="${state.scope}"]`)?.focus({ preventScroll: true });
    } else if (event.target.closest("[data-allday]")) {
      if (!item) return;
      const start = item.start ? null : hhmm(Math.min(1380, Math.ceil((nowMin() + 1) / 60) * 60));
      updateEvent(start ? { start, end: hhmm(toMin(start) + 60), endDate: null } : { start: null, end: null, endDate: null });
      renderPanel();
      panel.querySelector("[data-allday]")?.focus({ preventScroll: true });
    } else if (event.target.closest("[data-date-pick]")) {
      const input = $("calPanelDate");
      try { input.showPicker(); } catch { input.focus(); }
    } else if (event.target.closest("[data-kind]")) {
      const key = event.target.closest("[data-kind]").dataset.kind;
      updateEvent({ kind: key });
      panel.querySelectorAll("[data-kind]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.kind === key)));
      const mark = panel.querySelector(".cal-mark");
      if (mark) {
        mark.style.setProperty("--k", kindVar(key));
        mark.innerHTML = icon(KINDS[key].icon);
      }
    }
  });
  panel.addEventListener("change", (event) => {
    const item = panelItem();
    if (!item) return;
    const target = event.target;
    if (target.id === "calPanelDate" && target.value) {
      const span = spanDays(item);
      const moved = updateEvent({ date: target.value, ...(span ? { endDate: isoDate(addDays(parseDate(target.value), span)) } : {}) }) || item;
      $("calDateText").textContent = shortDate(parseDate(moved.date));
      panel.querySelector("[data-date-pick]").setAttribute("aria-label", `Datum ändern, ${longDate(parseDate(moved.date))}`);
      panel.querySelector("[data-date-pick]").focus({ preventScroll: true });
    }
    if (target.id === "calPanelStart") {
      const value = target.value.trim() ? normalizeTime(target.value) : null;
      if (value === undefined) {
        target.value = item.start ? hm(item.start) : "";
      } else {
        const span = item.start && item.end && !overnight(item) ? toMin(item.end) - toMin(item.start) : 60;
        const end = value ? hhmm(Math.min(1439, toMin(value) + span)) : null;
        updateEvent({ start: value, end, endDate: null });
        renderPanel();
      }
    }
    if (target.id === "calPanelEnd") {
      const value = target.value.trim() ? normalizeTime(target.value) : null;
      if (value === undefined || !item.start || value === item.start) {
        target.value = item.end ? hm(item.end) : "";
      } else {
        const later = value && toMin(value) < toMin(item.start) ? isoDate(addDays(parseDate(item.date), 1)) : null;
        updateEvent({ end: value, endDate: later });
        renderPanel();
      }
    }
    if (target.id === "calPanelRepeat") {
      const choice = REPEATS.find(([value]) => value === target.value);
      changeRule(choice?.[2] ? rule({ ...choice[2], interval: choice[2].interval || 1 }) : null);
      $("calPanelRepeat")?.focus({ preventScroll: true });
    }
    if (target.id === "calPanelEnds") {
      const choice = target.value;
      changeRule(rule({ count: choice === "count" ? 10 : null, until: choice === "until" ? isoDate(addDays(parseDate(panelItem().date), 90)) : null }));
      $(choice === "count" ? "calPanelCount" : choice === "until" ? "calPanelUntil" : "calPanelEnds")?.focus({ preventScroll: true });
    }
    if (target.id === "calPanelUntil" && target.value) changeRule(rule({ until: target.value, count: null }));
    if (target.id === "calPanelCount") {
      const count = Math.round(Number(target.value));
      if (count >= 1 && count <= 1000) changeRule(rule({ count, until: null }));
      else target.value = rule({}).count || 10;
    }
    if (target.id === "calPanelReminder") updateEvent({ reminderMinutes: target.value === "" ? null : Number(target.value) });
    const note = $("calWhenNote");
    if (note && panelItem()) note.textContent = whenNote(panelItem());
  });
  panel.addEventListener("input", (event) => {
    const target = event.target;
    if (target.id === "calPanelNotes") {
      const saved = typed("notes", target.value);
      if (saved) saveText(`${saved.id}:notes`, saved.id, { notes: saved.notes });
    }
    if (target.id === "calPanelPlace") {
      $("calRouteSlot").innerHTML = routeLink(target.value.trim());
      const saved = typed("place", target.value);
      if (saved) saveText(`${saved.id}:place`, saved.id, { place: saved.place.trim() });
    }
    if (target.id === "calPanelTitle") {
      const title = target.value.replace(/\s+/g, " ").trimStart();
      const saved = typed("title", title);
      if (saved && title.trim()) saveText(`${saved.id}:title`, saved.id, { title: title.trim() });
      const item = panelItem();
      const key = item?.series || item?.id;
      if (key) document.querySelectorAll(`[data-title-of="${CSS.escape(key)}"]`).forEach((node) => (node.textContent = title));
      if (item?.draft) document.querySelectorAll("#calView [data-draft] .ev-title").forEach((node) => (node.textContent = title));
      panel.setAttribute("aria-label", title || "Neuer Termin");
    }
  });
  panel.addEventListener("focusout", (event) => {
    if ((event.target.id === "calPanelTitle" || event.target.id === "calPanelPlace") && !state.draft) render();
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !["calPanelTitle", "calPanelPlace", "calPanelStart", "calPanelEnd", "calPanelCount"].includes(event.target.id)) return;
    event.preventDefault();
    if (state.draft && event.target.id !== "calPanelStart" && event.target.id !== "calPanelEnd") {
      event.target.dispatchEvent(new Event("change", { bubbles: true }));
      saveDraft();
      return;
    }
    event.target.blur();
  });
}

const syncKey = (item) => `${item.title}|${item.date}|${item.start || ""}`;
const shaped = (item, synced) => ({ ...item, kind: KINDS[item.kind] ? item.kind : "private", notes: item.notes || "", synced });

function mergeOwn(list) {
  const current = state.events.filter((item) => !item.synced);
  if (!Array.isArray(list)) return current;
  const fresh = new Map(list.filter((item) => !removed.has(item.id)).map((item) => [item.id, item]));
  const result = [];
  current.forEach((item) => {
    const id = serverId(item.id) || item.id;
    const server = fresh.get(id);
    fresh.delete(id);
    if (item.id === state.selected || (!server && item.id.startsWith("neu-"))) result.push(item);
    else if (server) result.push({ ...shaped(server, false), id: item.id });
  });
  fresh.forEach((item) => result.push(shaped(item, false)));
  return result;
}

function applySynced(payload, span = null) {
  const before = JSON.stringify(state.events);
  if (payload.window) sync.window = payload.window;
  if ("source" in payload) sync.source = payload.source;
  const own = mergeOwn(payload.own);
  const taken = new Set(own.map(syncKey));
  const fresh = (payload.events || []).filter((item) => !taken.has(syncKey(item)) && !removed.has(item.id)).map((item) => shaped(item, true));
  const range = span || (sync.source === "google" ? sync.window : null);
  const ids = new Set(fresh.map((item) => item.id));
  const others = state.events.filter((item) => item.synced && range && (item.date < range.start || item.date > range.end) && !ids.has(item.id));
  state.events = [...own, ...others, ...fresh];
  shareEvents();
  return JSON.stringify(state.events) !== before;
}

async function fetchSynced(query) {
  const response = await fetch(`/api/ui/events/synced?${new URLSearchParams(query)}`, { credentials: "same-origin", cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || payload.success === false) throw new Error(payload.error || "");
  return payload;
}

function ensureRange() {
  if (sync.source !== "google" || !sync.window || sync.busy) return;
  const span = period();
  const start = isoDate(span.start);
  const end = isoDate(span.end);
  if (start >= sync.window.start && end <= sync.window.end) return;
  const key = `${start}:${end}`;
  if (sync.ranges.includes(key)) return;
  sync.ranges.push(key);
  fetchSynced({ start, end })
    .then((payload) => {
      if (applySynced(payload, { start, end })) render();
    })
    .catch(() => {
      sync.ranges = sync.ranges.filter((item) => item !== key);
    });
}

async function startSync({ first = false, manual = false } = {}) {
  if (sync.busy) return;
  sync.busy = true;
  state.loading = sync.source === "google" && !state.events.some((item) => item.synced) && !extra.sync?.stand;
  const button = $("calSync");
  button.classList.add("is-spinning");
  button.setAttribute("aria-busy", "true");
  if (state.loading) render();
  let payload = null;
  try {
    payload = await fetchSynced({ frisch: manual ? "alles" : "1" });
  } catch {}
  const finish = () => {
    let changed = state.loading;
    sync.busy = false;
    state.loading = false;
    button.classList.remove("is-spinning");
    button.removeAttribute("aria-busy");
    if (payload) {
      changed = applySynced(payload) || changed;
      if (payload.problem === "login") {
        toast(esc(payload.message), { icon: "circle-alert", action: { label: "Einstellungen", run: () => location.assign(pageUrl("settings", "/hub/settings#konten")) } });
      } else if (payload.problem && manual) {
        toast(esc(payload.message), { icon: "wifi-off" });
      }
    } else if (!first) {
      toast("Die verbundenen Kalender sind gerade nicht erreichbar.", { icon: "wifi-off" });
    }
    if (changed) {
      render();
      revealSynced();
    }
    ensureRange();
  };
  const card = document.querySelector("#calView .cal-loading");
  if (card) exitInPlace(card).then(finish);
  else finish();
}

function revealSynced() {
  if (!animates()) return;
  const nodes = [...document.querySelectorAll("#calView .ev, #calView .cw-chip.is-event, #calView .cm-item.is-event, #calView .cal-dot.is-event, #calView .cl-row.is-event, #calOverview .cal-agenda-item")];
  const move = travels();
  nodes.slice(0, 32).forEach((node, index) => {
    node.animate(
      move ? [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }] : [{ opacity: 0 }, { opacity: 1 }],
      { duration: move ? ms("--dur-enter") || 320 : 150, delay: move ? Math.min(index, 14) * (ms("--stagger") || 40) : 0, easing: token("--ease-out"), fill: "backwards" },
    );
  });
}

function measure() {
  const width = $("calStage").getBoundingClientRect().width;
  return width > 0 && width < NARROW;
}

function scheduleTick() {
  if (pinnedTime()) return;
  const date = new Date();
  const wait = (60 - date.getSeconds()) * 1000 - date.getMilliseconds() + 50;
  setTimeout(() => {
    if (!document.hidden && !state.loading) render();
    scheduleTick();
  }, wait);
}

const floorTo = (minute, step) => Math.floor(minute / step) * step;
const withinDay = (minute) => Math.max(0, Math.min(1440, minute));

function minuteAt(col, y) {
  const box = col.getBoundingClientRect();
  return state.range.start + ((y - box.top) / box.height) * (state.range.end - state.range.start);
}

function nextHour() {
  return hhmm(Math.min(1380, Math.ceil((nowMin() + 1) / 60) * 60));
}

function swallowClick() {
  state.dragged = true;
  setTimeout(() => (state.dragged = false));
}

/* A click on a free slot makes a one-hour event there, dragging makes the dragged span. Touch only taps,
   so a swipe still scrolls. */
function pickSlot(event, col) {
  const origin = withinDay(minuteAt(col, event.clientY));
  const touch = event.pointerType === "touch";
  const startX = event.clientX;
  const startY = event.clientY;
  let ghost = null;
  let wandered = false;
  let from = origin;
  let to = origin;
  const move = (moved) => {
    if (Math.hypot(moved.clientX - startX, moved.clientY - startY) >= MOVE_AFTER) wandered = true;
    if (touch || (!ghost && Math.abs(moved.clientY - startY) < MOVE_AFTER)) return;
    const current = withinDay(minuteAt(col, moved.clientY));
    from = floorTo(Math.min(origin, current), SNAP);
    to = Math.max(from + SNAP, Math.ceil(Math.max(origin, current) / SNAP) * SNAP);
    if (!ghost) {
      ghost = document.createElement("div");
      ghost.className = "ev is-draft is-short";
      ghost.setAttribute("aria-hidden", "true");
      ghost.style.cssText = "--lane:0;--lanes:1;--indent:0;--k:var(--kind-private)";
      ghost.innerHTML = '<span class="ev-time"></span>';
      col.append(ghost);
      col.classList.add("is-picking");
    }
    ghost.classList.toggle("is-short", to - from < 50);
    ghost.style.setProperty("--top", ((from - state.range.start) / 60).toFixed(4));
    ghost.style.setProperty("--len", ((to - from) / 60).toFixed(4));
    ghost.firstChild.textContent = `${hm(hhmm(from))} bis ${hm(hhmm(Math.min(to, 1439)))}`;
  };
  const up = (released) => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", up);
    ghost?.remove();
    col.classList.remove("is-picking");
    if (released.type === "pointercancel" || (touch && wandered)) return;
    const start = ghost ? from : Math.min(1380, floorTo(origin, 30));
    const end = ghost ? to : start + 60;
    // The click that follows would land on the sheet that opens under the finger, so the sheet waits for it.
    const slot = { date: col.dataset.day, start: hhmm(start), end: hhmm(Math.min(end, 1439)) };
    state.pending = slot;
    setTimeout(() => {
      if (state.pending !== slot) return;
      state.pending = null;
      openDraft(slot);
    }, 350);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
}

/* Dragging an event moves it, across days too; its lower edge changes the end. A click without moving opens it. */
function holdCard(event, card, col) {
  const id = card.dataset.id;
  const item = findEntry(id)?.item;
  if (!item?.start) return;
  const resizing = !!event.target.closest("[data-grip]");
  const startX = event.clientX;
  const startY = event.clientY;
  const hour = col.getBoundingClientRect().height / ((state.range.end - state.range.start) / 60);
  const cols = [...$("calView").querySelectorAll(".cw-col")];
  const top = parseFloat(card.style.getPropertyValue("--top"));
  const length = parseFloat(card.style.getPropertyValue("--len"));
  let active = false;
  let shift = 0;
  let over = col;
  const move = (moved) => {
    if (!active && Math.hypot(moved.clientX - startX, moved.clientY - startY) < MOVE_AFTER) return;
    if (!active) {
      active = true;
      card.classList.add("is-dragging");
      card.removeAttribute("data-tip");
    }
    shift = Math.round((((moved.clientY - startY) / hour) * 60) / SNAP) * SNAP;
    if (resizing) {
      card.style.setProperty("--len", Math.max(SNAP / 60, length + shift / 60).toFixed(4));
      return;
    }
    const target = cols.find((other) => {
      const box = other.getBoundingClientRect();
      return moved.clientX >= box.left && moved.clientX < box.right;
    });
    if (target && target !== over) {
      target.append(card);
      over = target;
    }
    card.style.setProperty("--top", (top + shift / 60).toFixed(4));
  };
  const up = (released) => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", up);
    if (!active) return;
    swallowClick();
    card.classList.remove("is-dragging");
    if (released.type === "pointercancel") {
      render();
      return;
    }
    if (resizing) {
      const end = Math.min(1439, Math.max(startOf(item) + SNAP, endOf(item) + shift));
      moveEvent(item, { end: hhmm(end) });
      return;
    }
    const days = dayDiff(parseDate(col.dataset.day), over.dataset.day);
    const length = overnight(item) ? spanDays(item) * 1440 + toMin(item.end) - startOf(item) : item.end ? endOf(item) - startOf(item) : null;
    const begin = Math.max(-1440, startOf(item) + shift);
    const day = addDays(parseDate(item.date), days + Math.floor(begin / 1440));
    const start = ((begin % 1440) + 1440) % 1440;
    const finish = length == null ? null : start + length;
    moveEvent(item, {
      date: isoDate(day),
      start: hhmm(start),
      end: finish == null ? null : hhmm(finish % 1440),
      endDate: finish != null && finish >= 1440 ? isoDate(addDays(day, Math.floor(finish / 1440))) : null,
    });
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
}

function moveEvent(item, changes) {
  const scope = state.scope;
  state.scope = "one";
  const series = seriesOf(item);
  const previous = series ? series.recurrence : null;
  const before = Object.fromEntries(Object.keys(changes).map((key) => [key, item[key] ?? null]));
  const { target, changes: applied } = targetFor(item, changes);
  state.scope = scope;
  saveChanges(target, applied);
  if (state.selected === item.id) state.selected = target.id;
  render();
  if (state.selected === target.id) renderPanel();
  const moved = findEntry(target.id)?.item || target;
  toast(`Verschoben: „${esc(moved.title)}“, ${esc(shortDate(parseDate(moved.date)))}, ${hm(moved.start)}${moved.end ? ` bis ${hm(moved.end)}` : ""}`, {
    icon: "check",
    action: { label: "Rückgängig", undo: true, run: () => {
      if (series) {
        removeEvent(target.id, { silent: true });
        saveChanges(series, { recurrence: previous });
      } else {
        saveChanges(target, before);
      }
      render();
    } },
  });
}

function bindGrid(view) {
  view.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || state.view !== "woche" || state.loading || event.target.closest(".cw-more")) return;
    const col = event.target.closest(".cw-col");
    if (!col || !state.range) return;
    const card = event.target.closest(".ev");
    if (card) {
      if (card.hasAttribute("data-movable") && event.pointerType !== "touch") holdCard(event, card, col);
      return;
    }
    pickSlot(event, col);
  });
}

function moreAt(button) {
  if (button.dataset.moreDay) {
    const iso = button.dataset.moreDay;
    openMore(button, longDate(parseDate(iso)), monthItems(iso, parseDate(iso)), iso);
    return;
  }
  const [iso, minute] = button.dataset.more.split("|");
  const items = blocks.get(button.dataset.more) || [];
  openMore(button, `${shortDate(parseDate(iso))}, ab ${hm(hhmm(Number(minute)))}`, items.map((item) => ({ type: "event", item })), iso);
}

function bind() {
  const view = $("calView");
  bindGrid(view);
  view.addEventListener("click", (event) => {
    if (state.pending) {
      const slot = state.pending;
      state.pending = null;
      event.preventDefault();
      openDraft(slot);
      return;
    }
    if (state.dragged) return;
    const jump = event.target.closest("[data-jump]");
    if (jump) {
      focusDay(jump.dataset.jump);
      return;
    }
    const more = event.target.closest("[data-more], [data-more-day]");
    if (more) {
      moreAt(more);
      return;
    }
    const item = event.target.closest("[data-item]");
    if (item) {
      const id = item.dataset.item;
      if (state.selected === id) closePanel();
      else openItem(id);
      return;
    }
    const day = event.target.closest(".cw-day, .cm-day");
    if (day) {
      focusDay(day.dataset.day, { keyboard: event.detail === 0 });
      return;
    }
    const cell = !state.narrow && event.target.closest(".cm-cell[data-cell]");
    if (cell) {
      openDraft({ date: cell.dataset.cell });
      return;
    }
    const target = event.target.closest("[data-id]");
    if (!target) return;
    if (state.selected === target.dataset.id) closePanel();
    else openItem(target.dataset.id, { keyboard: event.detail === 0 });
  });
  document.addEventListener("pointerdown", (event) => {
    if (!state.dayOpen || !DRAWER.matches || event.target.closest("#calOverview, .cw-day, .cm-day, #calPanel")) return;
    state.dayOpen = false;
    syncOverview();
  });
  $("calMore").addEventListener("click", (event) => {
    if (event.target.closest("[data-more-close]")) {
      closeMore();
      return;
    }
    const item = event.target.closest("[data-item]");
    if (!item) return;
    closeMore();
    openItem(item.dataset.item, { keyboard: event.detail === 0 });
  });
  $("calJump").addEventListener("click", () => {
    const input = $("calJumpDate");
    input.value = state.focus;
    try { input.showPicker(); } catch { input.focus(); }
  });
  $("calJumpDate").addEventListener("change", (event) => {
    if (!event.target.value) return;
    const before = period();
    revealDate(event.target.value);
    state.picked = true;
    state.scroll = "auto";
    const direction = isoDate(period().start) > isoDate(before.start) ? 1 : isoDate(period().start) < isoDate(before.start) ? -1 : 0;
    render({ slide: direction, fade: !direction });
    announce();
  });
  view.addEventListener("keydown", (event) => {
    if (onDayKeys(event)) event.stopPropagation();
  });
  $("calOverview").addEventListener("click", (event) => {
    if (event.target.closest("[data-back-today]")) {
      goToday();
      return;
    }
    if (event.target.closest("[data-day-close]")) {
      state.dayOpen = false;
      syncOverview();
      document.querySelector(`#calView [data-key="day:${state.focus}"]`)?.focus({ preventScroll: true });
      return;
    }
    const target = event.target.closest("[data-id]");
    if (!target) return;
    openItem(target.dataset.id, { keyboard: event.detail === 0, reveal: true });
  });
  $("calViews").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (button) setView(button.dataset.view);
  });
  $("calPrev").addEventListener("click", () => step(-1));
  $("calNext").addEventListener("click", () => step(1));
  $("calToday").addEventListener("click", goToday);
  $("calSync").addEventListener("click", () => startSync({ manual: true }));
  $("calNew").addEventListener("click", () => openDraft({ date: defaultDay(), start: nextHour(), end: hhmm(Math.min(1439, toMin(nextHour()) + 60)) }));
  $("calQuickInput").addEventListener("input", renderQuickChips);
  $("calQuickInput").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.target.value = "";
      renderQuickChips();
      event.target.blur();
    }
  });
  $("calQuick").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("calQuickInput");
    if (!input.value.trim()) return;
    createEvent(input.value);
    input.value = "";
    renderQuickChips();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.selected && !overlayOpen()) {
      closePanel({ refocus: true });
      return;
    }
    if (event.key === "Escape" && state.dayOpen && DRAWER.matches && !overlayOpen()) {
      state.dayOpen = false;
      syncOverview();
      return;
    }
    if (typing(event.target) || event.ctrlKey || event.metaKey || event.altKey || overlayOpen()) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (event.target.closest?.(".cw-day, .cm-day, .cal-panel")) return;
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (!shortcutsEnabled()) return;
    const key = event.key.toLowerCase();
    if (key === "j" || key === "k") {
      event.preventDefault();
      moveItemFocus(key === "j" ? 1 : -1);
    } else if (key === "t") {
      event.preventDefault();
      goToday();
    } else if (key === "w" || key === "m" || key === "l") {
      event.preventDefault();
      setView({ w: "woche", m: "monat", l: "liste" }[key]);
    }
  });
  let columns = laneColumns();
  new ResizeObserver(() => {
    const narrow = measure();
    const now = laneColumns();
    if (narrow === state.narrow && now === columns) return;
    state.narrow = narrow;
    columns = now;
    render();
  }).observe($("calStage"));
  let frame = 0;
  addEventListener("resize", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (state.view === "monat" && placeMonth()) render();
      else placeWeek();
    });
  });
  registerSearch(() => {
    const query = $("paletteInput")?.value.trim();
    if (!query) return [];
    return state.events.map((item) => ({
      group: "Termine",
      label: item.title,
      icon: "calendar-clock",
      keywords: `${item.place || ""} ${KINDS[item.kind].label}`,
      hint: `${shortDate(parseDate(item.date))}${item.start ? `, ${hm(item.start)}` : ""}`,
      run: () => openItem(item.id, { reveal: true }),
    }));
  });
  bindPanel();
}

function syncPlaceholder(query) {
  $("calQuickInput").placeholder = query.matches ? "Neuer Termin: „Gym morgen 16:30“" : "Neuer Termin, zum Beispiel „Gym morgen 16:30“";
}

export function init() {
  if (!$("calendarPage")) return;
  load();
  state.narrow = measure();
  const small = matchMedia("(max-width: 640px)");
  syncPlaceholder(small);
  small.addEventListener("change", syncPlaceholder);
  FLOATING.addEventListener("change", syncOverview);
  DRAWER.addEventListener("change", syncOverview);
  bind();
  render();
  startSync({ first: true });
  scheduleTick();
}
