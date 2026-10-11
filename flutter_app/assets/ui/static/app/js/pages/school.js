import {
  data, flags, params, esc, icon, tinte, now, pinnedTime, toMin, clock, hm, startOfDay, addDays, isoDate, parseDate, dayDiff, minutesOf,
  weekType, isoWeek, subject, hueVar, blockOf, glue, relativeDay, inDays, duration, shortDate, WEEKDAYS, WEEKDAYS_SHORT, MONTHS, MONTHS_SHORT,
  abWeeks, gradeScale, activeSubjectKeys, ASSESSMENTS, isAssessment, assessmentCount, pastText, pastWord, homeworkDate,
} from "../core.js";
import { animates, travels, token, ms } from "../motion.js";
import { toast, registerSearch, syncTime, typing, overlayOpen, pageUrl } from "../shell.js";
import { deadlines as deadlineApi, grades as gradeApi } from "../api.js";

const $ = (id) => document.getElementById(id);
const page = data?.page || {};
const narrow = matchMedia("(max-width: 1100px)");
const compact = matchMedia("(max-width: 560px)");

const KIND_ORDER = { Klausur: 0, Test: 1, Vortrag: 2, Abgabe: 3, Hausaufgabe: 4 };
const FLAG_WORDS = { Klausur: "Klausur", Test: "Test", Vortrag: "Vortrag", Abgabe: "Abgabe", Hausaufgabe: "HA" };
const FLAG_ICONS = { ...Object.fromEntries(Object.entries(ASSESSMENTS).map(([kind, info]) => [kind, info.icon])), Abgabe: "file-text", Hausaufgabe: "notebook-pen" };
const NOTE_HINTS = { Vortrag: "z. B. Dauer, Gruppe, Handout", Abgabe: "z. B. Seite und Nummer", Hausaufgabe: "z. B. Seite und Nummer" };
const GRADE_TYPES = { klausur: "Klausur", test: "Test", muendlich: "Mündlich", vortrag: "Vortrag", sonstiges: "Sonstiges" };
const COURSE_WORDS = { LK: "Leistungskurs", GK: "Grundkurs", SK: "Seminarkurs" };
const POINT_NOTES = ["6", "5\u2212", "5", "5+", "4\u2212", "4", "4+", "3\u2212", "3", "3+", "2\u2212", "2", "2+", "1\u2212", "1", "1+"];
const RATINGS = [[13, "Sehr gut"], [10, "Gut"], [7, "Befriedigend"], [4, "Ausreichend"], [1, "Mangelhaft"], [0, "Ungenügend"]];
const CALC_TOOLS = [["ziel", "Zielnote"], ["fach", "Fachnote"], ["umrechnen", "Umrechnen"]];
const CALC_SYSTEMS = [["points", "Punkte"], ["grades", "Noten"]];
const MARKS = [6, 5.3, 5, 4.7, 4.3, 4, 3.7, 3.3, 3, 2.7, 2.3, 2, 1.7, 1.3, 1, 0.7];
const SEMESTER = page.semester || "Q3";
const SEMESTERS = (() => {
  const earlier = new Set(Object.values(page.history || {}).flatMap((terms) => Object.keys(terms || {})));
  const upper = /^Q([1-4])$/.exec(SEMESTER);
  for (let number = 1; upper && number < Number(upper[1]); number += 1) earlier.add(`Q${number}`);
  earlier.delete(SEMESTER);
  return [...[...earlier].sort((a, b) => a.localeCompare(b, "de", { numeric: true })), SEMESTER];
})();

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const widow = (text) => text.replace(/ (\S{1,12})$/, "\u00a0$1");
const decimal = (value, digits = 1) => value.toFixed(digits).replace(".", ",");
const ratingOf = (points) => RATINGS.find(([min]) => points >= min)[1];
const readNumber = (text) => {
  const value = parseFloat(String(text ?? "").trim().replace(",", "."));
  return Number.isFinite(value) ? value : null;
};
const markOfPoints = (points) => MARKS[Math.max(0, Math.min(15, Math.round(points)))];
const pointsOfMark = (mark) => MARKS.reduce((best, value, points) => (Math.abs(value - mark) < Math.abs(MARKS[best] - mark) ? points : best), 0);
const markExact = (mark) => Math.abs(MARKS[pointsOfMark(mark)] - mark) < 0.05;
const markRating = (mark) => (mark <= 1.3 ? "Sehr gut" : mark <= 2.3 ? "Gut" : mark <= 3.3 ? "Befriedigend" : mark <= 4.3 ? "Ausreichend" : mark <= 5.3 ? "Mangelhaft" : "Ungenügend");
const plainNote = (note) => note.replace("\u2212", "-");

function readValue(token, system) {
  const text = String(token ?? "").trim().replace("\u2212", "-");
  if (!text) return null;
  if (system === "grades") {
    const index = POINT_NOTES.findIndex((note) => plainNote(note) === text);
    if (index >= 0) return MARKS[index];
    const value = readNumber(text);
    return value != null && value >= 0.7 && value <= 6 ? value : null;
  }
  const value = readNumber(text);
  return value != null && value >= 0 && value <= 15 ? value : null;
}

const readList = (text, system = "points") => String(text ?? "")
  .replace(/,\s+/g, " ")
  .split(/[;\s]+/)
  .flatMap((token) => ((token.match(/,/g) || []).length > 1 ? token.split(",") : [token]))
  .map((token) => readValue(token, system))
  .filter((value) => value != null);
const isHomework = (item) => item.kind === "Hausaufgabe" || item.kind === "Abgabe";
const byDate = (a, b) => a.date.localeCompare(b.date) || (a.block || 0) - (b.block || 0);
const cellKey = (iso, block) => `${iso}:${block}`;
const plural = (count, one, many) => `${count}\u00a0${count === 1 ? one : many}`;

const tasks = flags.empty ? [] : [...(data.tasks || []), ...(data.taskPool || [])];
const retiredKey = (key) => !!data.subjects?.[key]?.retired;
const activeKey = (key) => !!data.subjects?.[key] && !data.subjects[key].retired;
const visibleItem = (item) => !item.subject || activeKey(item.subject);

const state = {
  week: 0,
  items: [],
  grades: [],
  selection: null,
  returnTo: null,
  draft: null,
  gradeForm: false,
  gradeSemester: SEMESTER,
  calc: { open: false, table: false, tool: "ziel", system: null, subject: null, average: "", count: "", target: "", exams: ["", "", "", ""], other: "", points: 12, mark: 2 },
  vplan: { loaded: false, loading: false, stand: null, files: [], problem: null, message: "", supported: true, page: 0, zoomed: false },
  writtenOpen: false,
  openNotes: new Set(),
  signature: "",
  tick: 0,
  fresh: new Set(),
  focusCell: null,
};

function clockState() {
  const date = now();
  return { date, iso: isoDate(date), min: minutesOf(date) };
}

const mondayOf = (date) => addDays(startOfDay(date), 1 - (date.getDay() || 7));

function changesOn(date) {
  if (!flags.change || !state.vplan.loaded) return [];
  const iso = isoDate(date);
  const byBlock = new Map();
  [...(data.changes || []), ...(page.changes || [])].forEach((change) => {
    if (change.date === iso && !byBlock.has(change.block)) byBlock.set(change.block, change);
  });
  return [...byBlock.values()];
}

const blockList = () => [...(data.blocks || [])].sort((a, b) => toMin(a.start) - toMin(b.start));

function lessonsOn(date) {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return [];
  const iso = isoDate(date);
  const changes = changesOn(date);
  return (data.timetable?.[weekType(date)]?.[String(dow)] || [])
    .filter((entry) => blockOf(entry.block) && activeKey(entry.subject))
    .map((entry) => {
      const block = blockOf(entry.block);
      const change = changes.find((item) => item.block === entry.block) || null;
      return {
        subject: entry.subject,
        teacher: entry.teacher,
        block: entry.block,
        date: startOfDay(date),
        iso,
        start: block.start,
        end: block.end,
        startMin: toMin(block.start),
        endMin: toMin(block.end),
        room: change?.type === "raum" ? change.room : entry.room,
        movedFrom: change?.type === "raum" ? entry.room : null,
        cancelled: change?.type === "entfall",
        note: change?.note || null,
        changed: !!change,
      };
    })
    .sort((a, b) => a.startMin - b.startMin);
}

const lessonAt = (iso, block) => lessonsOn(parseDate(iso)).find((lesson) => lesson.block === block) || null;

function phaseOf(lesson, time) {
  if (lesson.iso < time.iso) return "past";
  if (lesson.iso > time.iso) return "future";
  if (lesson.endMin <= time.min) return "past";
  if (lesson.startMin <= time.min) return "now";
  return "future";
}

function currentLesson(time) {
  return lessonsOn(time.date).find((lesson) => !lesson.cancelled && lesson.startMin <= time.min && lesson.endMin > time.min) || null;
}

function upcoming(time, match = () => true, count = 1, horizon = 28) {
  const found = [];
  for (let offset = 0; offset < horizon && found.length < count; offset += 1) {
    const day = addDays(startOfDay(time.date), offset);
    lessonsOn(day).forEach((lesson) => {
      if (found.length >= count || lesson.cancelled || !match(lesson)) return;
      if (offset === 0 && lesson.startMin <= time.min) return;
      found.push(lesson);
    });
  }
  return found;
}

function baseMonday() {
  const time = clockState();
  const dow = time.date.getDay();
  const monday = mondayOf(time.date);
  if (dow === 0 || dow === 6) return addDays(monday, 7);
  if (dow === 5) {
    const active = lessonsOn(time.date).filter((lesson) => !lesson.cancelled);
    if (!active.length || time.min >= active[active.length - 1].endMin) return addDays(monday, 7);
  }
  return monday;
}

const shownMonday = () => addDays(baseMonday(), state.week * 7);

function weekRange(monday) {
  const friday = addDays(monday, 4);
  return monday.getMonth() === friday.getMonth()
    ? `${monday.getDate()}.–${friday.getDate()}.${friday.getMonth() + 1}.`
    : `${monday.getDate()}.${monday.getMonth() + 1}.–${friday.getDate()}.${friday.getMonth() + 1}.`;
}

function weekSpoken(monday) {
  const friday = addDays(monday, 4);
  return monday.getMonth() === friday.getMonth()
    ? `${monday.getDate()}. bis ${friday.getDate()}. ${MONTHS[friday.getMonth()]}`
    : `${monday.getDate()}. ${MONTHS[monday.getMonth()]} bis ${friday.getDate()}. ${MONTHS[friday.getMonth()]}`;
}

function weekIndexOf(iso) {
  const base = baseMonday();
  for (let index = 0; index < 2; index += 1) {
    const monday = addDays(base, index * 7);
    if (iso >= isoDate(monday) && iso <= isoDate(addDays(monday, 4))) return index;
  }
  return null;
}

function teacherOf(key) {
  for (const week of ["A", "B"]) {
    for (const entries of Object.values(data.timetable?.[week] || {})) {
      const hit = entries.find((entry) => entry.subject === key);
      if (hit) return hit.teacher;
    }
  }
  return "";
}

function slotsOf(key) {
  const result = { A: [], B: [] };
  ["A", "B"].forEach((week) => {
    Object.entries(data.timetable?.[week] || {}).forEach(([dow, entries]) => {
      entries.filter((entry) => entry.subject === key).forEach((entry) => result[week].push({ dow: Number(dow), block: entry.block, room: entry.room }));
    });
    result[week].sort((a, b) => a.dow - b.dow || a.block - b.block);
  });
  return result;
}

function itemBlock(item) {
  const lessons = lessonsOn(parseDate(item.date));
  if (item.block && lessons.some((entry) => entry.block === item.block && entry.subject === item.subject)) return item.block;
  return lessons.find((entry) => entry.subject === item.subject)?.block || null;
}

function prepOf(item) {
  const linked = tasks.filter((task) => task.deadline === item.id);
  return { total: linked.length, open: linked.filter((task) => !task.done).length };
}

function itemsByCell(monday) {
  const map = new Map();
  const from = isoDate(monday);
  const to = isoDate(addDays(monday, 4));
  state.items.forEach((item) => {
    if (item.date < from || item.date > to || item.pinned || item.status === "abgegeben") return;
    const block = itemBlock(item);
    if (!block) return;
    const key = cellKey(item.date, block);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  map.forEach((list) => list.sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)));
  return map;
}

function overdueText(diff, target) {
  if (diff === -1) return "seit gestern überfällig";
  if (diff > -7) return `seit ${-diff}\u00a0Tagen überfällig`;
  return `seit ${WEEKDAYS_SHORT[target.getDay()]}., ${target.getDate()}.${target.getMonth() + 1}. überfällig`;
}

function leaf(target, cls = "") {
  const base = now();
  const other = target.getMonth() !== base.getMonth() || target.getFullYear() !== base.getFullYear();
  const top = other ? MONTHS_SHORT[target.getMonth()] : WEEKDAYS_SHORT[target.getDay()];
  return `<div class="leaf ${cls}${other ? " is-month" : ""}" aria-hidden="true"><span class="leaf-day">${top}</span><span class="leaf-date">${target.getDate()}</span></div>`;
}

const subjectTag = (key) => `<span class="subject"><i class="subject-dot" style="--hue:${hueVar(key)}"></i>${esc(subject(key).label)}</span>`;

function slotLabel(lesson, time) {
  const diff = dayDiff(time.date, lesson.iso);
  const day = diff === 0 ? "Heute" : diff === 1 ? "Morgen" : `${WEEKDAYS_SHORT[lesson.date.getDay()]}., ${lesson.date.getDate()}.${lesson.date.getMonth() + 1}.`;
  return `${day}, ${lesson.block}.\u00a0Block`;
}

const slotText = (date, block) => `${WEEKDAYS_SHORT[date.getDay()]}., ${date.getDate()}.${date.getMonth() + 1}.${block ? `, ${block}.\u00a0Block` : ""}`;

function gradesFor(key, semester = SEMESTER) {
  return state.grades.filter((grade) => grade.subject === key && (grade.semester || SEMESTER) === semester).sort((a, b) => b.date.localeCompare(a.date));
}

function subjectAverage(list) {
  if (!list.length) return null;
  const mean = (part) => part.reduce((sum, grade) => sum + grade.points, 0) / part.length;
  const exams = list.filter((grade) => grade.type === "klausur");
  const other = list.filter((grade) => grade.type !== "klausur");
  if (!exams.length) return mean(other);
  if (!other.length) return mean(exams);
  return mean(exams) / 3 + (mean(other) * 2) / 3;
}

const weightOf = (key) => (page.courses?.[key]?.type === "LK" ? 2 : 1);

function semesterRows(semester) {
  const history = flags.empty ? {} : page.history || {};
  return Object.keys(data.subjects).map((key) => {
    if (semester === SEMESTER) {
      const list = gradesFor(key, semester);
      return { key, value: subjectAverage(list), count: list.length };
    }
    const value = history[key]?.[semester];
    return { key, value: value ?? null, count: value == null ? 0 : 1 };
  });
}

function overallOf(rows) {
  const scored = rows.filter((row) => row.value != null);
  if (!scored.length) return null;
  const weight = scored.reduce((sum, row) => sum + weightOf(row.key), 0);
  return scored.reduce((sum, row) => sum + row.value * weightOf(row.key), 0) / weight;
}

function sortedSubjects(rows) {
  return [...rows].sort((a, b) => Number(retiredKey(a.key)) - Number(retiredKey(b.key)) || weightOf(b.key) - weightOf(a.key) || subject(a.key).label.localeCompare(subject(b.key).label, "de"));
}

function focusKeyOf(node) {
  if (!node || node === document.body) return null;
  for (const attr of ["data-cell", "data-open-item", "data-open-lesson", "data-open-subject", "data-open-grades", "data-edit-item", "data-delete-item", "data-done-item", "data-note-more", "data-delete-grade", "data-week", "data-semester", "data-slot", "data-kind", "data-calc-tool", "data-calc-system", "data-calc", "data-calc-for"]) {
    if (node.hasAttribute?.(attr)) return `[${attr}="${CSS.escape(node.getAttribute(attr))}"]`;
  }
  return node.id ? `#${CSS.escape(node.id)}` : null;
}

function keepFocus(container, paint) {
  const active = document.activeElement;
  const key = active && container.contains(active) ? focusKeyOf(active) : null;
  paint();
  if (!key || container.contains(document.activeElement)) return;
  (container.querySelector(key) || container.querySelector("#panelTitle"))?.focus({ preventScroll: true });
}

function say(text) {
  const live = $("liveStatus");
  if (!live) return;
  live.textContent = "";
  requestAnimationFrame(() => (live.textContent = text));
}

function renderHead() {
  const time = clockState();
  const base = baseMonday();
  const rolled = base > time.date;
  const letters = abWeeks();
  $("schoolWeek").textContent = rolled
    ? `Nächste Woche${letters ? `: ${weekType(base)}-Woche` : ""}, KW ${isoWeek(base)}`
    : `${letters ? `${weekType(time.date)}-Woche, ` : ""}KW ${isoWeek(time.date)}`;
}

function renderWeekSwitch() {
  const switcher = $("weekSwitch");
  switcher.hidden = !abWeeks();
  if (switcher.hidden) {
    state.week = 0;
    switcher.replaceChildren();
    return;
  }
  const base = baseMonday();
  $("weekSwitch").innerHTML = [0, 1].map((index) => {
    const monday = addDays(base, index * 7);
    return `<button type="button" data-week="${index}" aria-pressed="${state.week === index}" aria-label="${weekType(monday)}-Woche, ${esc(weekSpoken(monday))}">${weekType(monday)}-Woche<span class="seg-range">${esc(weekRange(monday))}</span></button>`;
  }).join("");
}

function flagHtml(item, overdue) {
  const tone = isAssessment(item) || overdue ? " is-urgent" : "";
  return `<span class="lesson-flag${tone}">${icon(FLAG_ICONS[item.kind] || "notebook-pen")}${esc(FLAG_WORDS[item.kind] || item.kind)}</span>`;
}

function lessonLabel(lesson, phase, items, context) {
  const info = subject(lesson.subject);
  const parts = [`${WEEKDAYS[lesson.date.getDay()]}, ${lesson.block}. Block, ${hm(lesson.start)} bis ${hm(lesson.end)}: ${info.name}`];
  if (lesson.cancelled) parts.push(`entfällt${lesson.note ? `, Grund: ${lesson.note}` : ""}`);
  else if (lesson.movedFrom) parts.push(`heute in Raum ${lesson.room} statt ${lesson.movedFrom}`);
  else parts.push(`Raum ${lesson.room}`);
  parts.push(lesson.teacher);
  items.forEach((item) => parts.push(`${item.kind}: ${item.title}`));
  if (phase === "now") parts.push(`läuft, noch ${lesson.endMin - context.time.min} Minuten`);
  else if (context.isNext(lesson)) parts.push("als Nächstes");
  else if (phase === "past") parts.push("vorbei");
  return parts.join(", ");
}

function cellHtml(lesson, block, row, col, context) {
  const pos = `${row}:${col}`;
  if (!lesson) return `<td class="slot"><span class="free-slot" data-cell="${pos}" tabindex="-1">frei</span></td>`;
  const phase = phaseOf(lesson, context.time);
  const items = context.items.get(cellKey(lesson.iso, block.n)) || [];
  const top = items[0];
  const overdue = !!top && isHomework(top) && lesson.iso < context.time.iso;
  const classes = ["lesson", `is-${phase}`];
  if (lesson.cancelled) classes.push("is-cancelled");
  if (lesson.movedFrom) classes.push("is-moved");
  if (lesson.changed) classes.push("is-changed");
  if (context.isNext(lesson)) classes.push("is-next");
  if (isSelectedCell(lesson.iso, block.n)) classes.push("is-selected");
  if (state.fresh.has(cellKey(lesson.iso, block.n))) classes.push("is-fresh");
  const info = subject(lesson.subject);
  const progress = phase === "now" ? (context.time.min - lesson.startMin) / (lesson.endMin - lesson.startMin) : 0;
  const room = lesson.movedFrom
    ? `<span class="lesson-room is-moved">${icon("nx-room")}<b>${esc(lesson.room)}</b><s>${esc(lesson.movedFrom)}</s></span>`
    : `<span class="lesson-room">${esc(lesson.room)}</span>`;
  const flag = lesson.cancelled ? `<span class="lesson-flag is-urgent">${icon("calendar-x-2")}Entfall</span>` : top ? flagHtml(top, overdue) : "";
  return `<td class="slot"><button type="button" class="${classes.join(" ")}" data-cell="${pos}" data-iso="${lesson.iso}" data-block="${block.n}" tabindex="-1" style="--hue:${hueVar(lesson.subject)};--p:${progress.toFixed(4)}" aria-label="${esc(lessonLabel(lesson, phase, items, context))}">${phase === "now" ? `<span class="lesson-fill" aria-hidden="true"></span>` : ""}<span class="lesson-subject" data-full="${esc(info.label)}" data-mid="${esc(info.label.replace(/\s+(LK|GK)$/, ""))}" data-short="${esc(info.short)}">${esc(info.label)}</span>${room}${flag}</button></td>`;
}

function boardContext(monday) {
  const time = clockState();
  const next = upcoming(time)[0] || null;
  return {
    time,
    items: itemsByCell(monday),
    isNext: (lesson) => !!next && next.iso === lesson.iso && next.block === lesson.block && phaseOf(lesson, time) !== "now",
  };
}

function tableHtml() {
  const monday = shownMonday();
  const context = boardContext(monday);
  const days = Array.from({ length: 5 }, (_, index) => addDays(monday, index));
  const lessons = days.map(lessonsOn);
  const head = days.map((day) => {
    const iso = isoDate(day);
    const cls = iso === context.time.iso ? " is-today" : iso < context.time.iso ? " is-past" : "";
    return `<th scope="col" class="tt-day${cls}"${iso === context.time.iso ? ' aria-current="date"' : ""}><span class="tt-day-head" aria-hidden="true"><span class="tt-day-name">${WEEKDAYS_SHORT[day.getDay()]}</span><span class="tt-day-date">${day.getDate()}.${day.getMonth() + 1}.</span></span><span class="visually-hidden">${WEEKDAYS[day.getDay()]}, ${day.getDate()}. ${MONTHS[day.getMonth()]}${iso === context.time.iso ? ", heute" : ""}</span></th>`;
  }).join("");
  const rows = blockList().map((block, row) => `<tr><th scope="row" class="block"><span class="block-visual" aria-hidden="true"><span class="block-num">${block.n}</span><span class="block-time">${hm(block.start)}<br>${hm(block.end)}</span></span><span class="visually-hidden">${block.n}. Block, ${hm(block.start)} bis ${hm(block.end)}</span></th>${days.map((day, col) => cellHtml(lessons[col].find((lesson) => lesson.block === block.n), block, row, col, context)).join("")}</tr>`).join("");
  return `<thead><tr><th scope="col" class="corner"><span class="visually-hidden">Block</span></th>${head}</tr></thead><tbody>${rows}</tbody>`;
}

function anchorCell(table) {
  const kept = state.focusCell && table.querySelector(`[data-cell="${state.focusCell}"]`);
  if (kept) return kept;
  const preferred = table.querySelector(".lesson.is-selected, .lesson.is-now") || table.querySelector(".lesson.is-next");
  if (preferred) return preferred;
  const today = [...table.querySelectorAll("thead .tt-day")].findIndex((node) => node.classList.contains("is-today"));
  return table.querySelector(`[data-cell="0:${Math.max(0, today)}"]`) || table.querySelector("[data-cell]");
}

function renderBoard() {
  const table = $("timetable");
  const monday = shownMonday();
  table.setAttribute("aria-label", `Stundenplan${abWeeks() ? ` ${weekType(monday)}-Woche` : ""}, ${weekSpoken(monday)}`);
  keepFocus(table, () => {
    table.innerHTML = tableHtml();
    const anchor = anchorCell(table);
    if (anchor) anchor.tabIndex = 0;
  });
  fitLabels();
}

function fitLabels() {
  const labels = [...document.querySelectorAll("#timetable .lesson-subject")];
  if (!labels.length) return;
  labels.forEach((node) => {
    if (node.textContent !== node.dataset.full) node.textContent = node.dataset.full;
  });
  ["mid", "short"].forEach((step) => {
    const tight = labels.filter((node) => node.scrollWidth > node.clientWidth + 0.5);
    tight.forEach((node) => {
      if (node.dataset[step] && node.textContent !== node.dataset[step]) node.textContent = node.dataset[step];
    });
  });
}

let fitFrame = 0;
function scheduleFit() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(fitLabels);
}

function growNow() {
  if (!travels()) return;
  const fill = document.querySelector("#timetable .lesson.is-now .lesson-fill");
  if (!fill) return;
  let seen = false;
  try { seen = sessionStorage.getItem("app-school-fill") === "1"; } catch {}
  try { sessionStorage.setItem("app-school-fill", "1"); } catch {}
  if (seen) return;
  const value = getComputedStyle(fill.parentElement).getPropertyValue("--p").trim() || "0";
  fill.animate([{ transform: "scaleX(0)" }, { transform: `scaleX(${value})` }], { duration: 760, delay: 140, easing: token("--ease-out"), fill: "backwards" });
}

function scrollToToday() {
  if (!compact.matches) return;
  const scroller = $("boardScroll");
  const table = $("timetable");
  const today = table.querySelector("thead .tt-day.is-today");
  const corner = table.querySelector("thead .corner");
  const target = today || table.querySelector("thead .tt-day");
  if (!target || !corner) return;
  scroller.scrollLeft = Math.max(0, target.offsetLeft - corner.offsetWidth - 6);
  markScrolled();
}

function markScrolled() {
  const scroller = $("boardScroll");
  scroller.classList.toggle("is-scrolled", scroller.scrollLeft > 2);
}

function swapBoard(direction, paint) {
  const table = $("timetable");
  table.getAnimations().forEach((animation) => animation.cancel());
  if (!animates()) {
    paint();
    return;
  }
  const move = travels();
  const out = table.animate(
    move ? [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-direction * 10}px)` }] : [{ opacity: 1 }, { opacity: 0 }],
    { duration: 110, easing: "ease-in", fill: "forwards" },
  );
  out.finished.then(() => {
    paint();
    out.cancel();
    table.animate(
      move ? [{ opacity: 0, transform: `translateX(${direction * 14}px)` }, { opacity: 1, transform: "none" }] : [{ opacity: 0 }, { opacity: 1 }],
      { duration: move ? 260 : 150, easing: token("--ease-out") },
    );
  }, () => {});
}

function setWeek(week, { keepCell = false } = {}) {
  if (!abWeeks() || week === state.week || week < 0 || week > 1) return;
  const direction = week > state.week ? 1 : -1;
  const hadFocus = $("timetable").contains(document.activeElement);
  const cell = document.activeElement?.dataset?.cell;
  state.week = week;
  if (keepCell && cell) state.focusCell = cell;
  renderWeekSwitch();
  swapBoard(direction, () => {
    renderBoard();
    scrollToToday();
    if (hadFocus && keepCell && cell) $("timetable").querySelector(`[data-cell="${cell}"]`)?.focus({ preventScroll: true });
  });
}

function focusCell(row, col) {
  const table = $("timetable");
  const target = table.querySelector(`[data-cell="${row}:${col}"]`);
  if (!target) return;
  table.querySelectorAll("[data-cell]").forEach((node) => (node.tabIndex = -1));
  target.tabIndex = 0;
  state.focusCell = `${row}:${col}`;
  target.focus();
}

function onGridKey(event) {
  const cell = event.target.closest?.("[data-cell]");
  if (!cell || event.altKey || event.metaKey) return;
  const [row, col] = cell.dataset.cell.split(":").map(Number);
  const rows = blockList().length;
  let next = null;
  if (event.key === "ArrowRight") next = [row, Math.min(4, col + 1)];
  else if (event.key === "ArrowLeft") next = [row, Math.max(0, col - 1)];
  else if (event.key === "ArrowDown") next = [Math.min(rows - 1, row + 1), col];
  else if (event.key === "ArrowUp") next = [Math.max(0, row - 1), col];
  else if (event.key === "Home") next = [event.ctrlKey ? 0 : row, 0];
  else if (event.key === "End") next = [event.ctrlKey ? rows - 1 : row, 4];
  else if ((event.key === "PageDown" || event.key === "PageUp") && abWeeks()) {
    event.preventDefault();
    setWeek(event.key === "PageDown" ? 1 : 0, { keepCell: true });
    return;
  }
  if (!next) return;
  event.preventDefault();
  focusCell(next[0], next[1]);
}

function changeDays() {
  const time = clockState();
  const days = [];
  const today = startOfDay(time.date);
  if (lessonsOn(today).length) days.push(today);
  for (let offset = 1; offset <= 10; offset += 1) {
    const day = addDays(today, offset);
    if (lessonsOn(day).length) {
      days.push(day);
      break;
    }
  }
  return days;
}

function changeRow(lesson) {
  const info = subject(lesson.subject);
  const title = lesson.cancelled
    ? `${lesson.block}.\u00a0Block ${info.label} entfällt`
    : `${lesson.block}.\u00a0Block ${info.label} in ${lesson.room}`;
  const detail = lesson.cancelled
    ? `${hm(lesson.start)} bis ${hm(lesson.end)}, ${lesson.teacher}${lesson.note ? `, Grund: ${lesson.note}` : ""}`
    : `statt ${lesson.movedFrom}, ${hm(lesson.start)} bis ${hm(lesson.end)}`;
  return `<li><button type="button" class="change-row" data-open-lesson="${cellKey(lesson.iso, lesson.block)}">
    <span class="change-icon${lesson.cancelled ? " is-cancel" : ""}" aria-hidden="true">${icon(lesson.cancelled ? "calendar-x-2" : "nx-room")}</span>
    <span class="change-text"><b>${esc(title)}</b><small>${esc(detail)}</small></span>
  </button></li>`;
}

function planStand() {
  const stamp = state.vplan.stand;
  if (!stamp) return "";
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return "";
  const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  const diff = dayDiff(clockState().date, isoDate(date));
  if (diff === 0) return `Stand ${time} Uhr`;
  if (diff === -1) return `Stand gestern, ${time} Uhr`;
  return `Stand ${shortDate(date)} ${time} Uhr`;
}

function changesHtml(head) {
  const time = clockState();
  const stand = flags.offline
    ? `<p class="side-meta is-offline">${icon("wifi-off")}Offline, Stand ${esc(syncTime())} Uhr</p>`
    : `<p class="side-meta">Stand ${esc(syncTime())} Uhr</p>`;
  const days = changeDays();
  const groups = days.map((day) => {
    const changed = lessonsOn(day).filter((lesson) => lesson.changed);
    return { day, changed };
  });
  const names = days.map((day) => {
    const offset = dayDiff(time.date, isoDate(day));
    return offset === 0 ? "heute" : offset === 1 ? "morgen" : WEEKDAYS[day.getDay()];
  });
  if (!groups.some((group) => group.changed.length)) {
    const span = names.length ? names.join(" und ") : "die nächsten Tage";
    return `${head}${stand}<p class="ov-calm">${icon("circle-check")}<span>Keine Änderungen für ${esc(span)}.</span></p>`;
  }
  const lists = groups.map((group, index) => {
    const label = cap(names[index]);
    const body = group.changed.length ? `<ul class="change-list">${group.changed.map(changeRow).join("")}</ul>` : `<p class="ov-none">Keine Änderungen.</p>`;
    return `<div class="change-group"><h3 class="ov-label">${esc(label)}</h3>${body}</div>`;
  }).join("");
  return `${head}${stand}${lists}`;
}

function vplanHtml() {
  const plan = state.vplan;
  const title = `<h2 class="side-title" id="vplanTitle">Vertretungsplan</h2>`;
  if (!data.status?.iserv) {
    return `<div class="ov-head">${title}</div><p class="ov-calm is-quiet">${icon("graduation-cap")}<span>Verbinde IServ unter <a class="inline-link" href="${esc(pageUrl("settings", "/hub/settings#konten"))}" data-page="settings">Einstellungen, Konten</a>, dann erscheint hier der Vertretungsplan.</span></p>`;
  }
  const tools = `<button class="icon-button${plan.loading ? " is-spinning" : ""}" type="button" id="vplanRefresh" aria-label="Vertretungsplan aus IServ neu laden" data-tip="Neu laden">${icon("refresh-cw")}</button>`;
  const head = `<div class="ov-head">${title}${tools}</div>`;
  if ((data.changes || []).length || (page.changes || []).length) return changesHtml(head);
  if (!plan.supported) {
    return `<div class="ov-head">${title}</div><p class="ov-calm is-quiet">${icon("graduation-cap")}<span>Der Vertretungsplan kommt als Datei aus IServ. Änderungen siehst du dort.</span></p>`;
  }
  if (!plan.files.length) {
    if (plan.loading || !plan.loaded) {
      return `${head}<div class="ov-loading" role="status">${tinte("laedt", 84)}<div><p class="empty-title">Hole Vertretungsplan aus IServ</p><p class="empty-text">Dauert nur einen Moment.</p></div></div>`;
    }
    return `${head}<p class="ov-calm is-quiet">${icon("graduation-cap")}<span>${esc(plan.message || "IServ zeigt gerade keinen Vertretungsplan.")}</span></p>`;
  }
  const unreachable = plan.problem === "offline" || plan.problem === "login";
  const note = [plan.problem ? plan.message : "", planStand()].filter(Boolean).join(" ");
  const stand = `<p class="side-meta${unreachable ? " is-offline" : ""}">${unreachable ? icon("wifi-off") : ""}<span>${esc(note)}</span></p>`;
  const first = plan.files[0];
  const thumb = first.type === "image"
    ? `<button type="button" class="plan-thumb" data-plan-open="0" aria-label="Vertretungsplan groß ansehen" data-tip="Groß ansehen"><img src="${esc(first.url)}" alt="" decoding="async"></button>`
    : `<button type="button" class="plan-thumb is-file" data-plan-open="0">${icon("file-text")}<span>Vertretungsplan öffnen</span></button>`;
  const pages = plan.files.length > 1
    ? `<div class="plan-pages" role="group" aria-label="Seiten">${plan.files.map((file, index) => `<button type="button" class="pill" data-plan-open="${index}">Seite ${index + 1}</button>`).join("")}</div>`
    : "";
  return `${head}${stand}${thumb}${pages}`;
}

function renderPlanViewer() {
  const plan = state.vplan;
  plan.page = Math.max(0, Math.min(plan.page, plan.files.length - 1));
  const file = plan.files[plan.page];
  const stage = $("planStage");
  if (!file || !stage) return;
  const tabs = $("planTabs");
  tabs.hidden = plan.files.length < 2;
  tabs.innerHTML = plan.files.map((entry, index) => `<button type="button" data-plan-page="${index}" aria-pressed="${index === plan.page}">Seite ${index + 1}</button>`).join("");
  $("planViewerMeta").textContent = planStand();
  const label = `Vertretungsplan, Seite ${plan.page + 1}`;
  stage.classList.toggle("is-zoomed", plan.zoomed && file.type === "image");
  stage.innerHTML = file.type === "image"
    ? `<img class="plan-sheet" src="${esc(file.url)}" alt="${label}">`
    : `<iframe class="plan-frame" src="${esc(file.url)}" title="${label}"></iframe>`;
  stage.scrollTo(0, 0);
}

function openPlan(index) {
  const dialog = $("planViewer");
  if (!dialog || !state.vplan.files.length) return;
  state.vplan.page = Math.max(0, Math.min(index, state.vplan.files.length - 1));
  state.vplan.zoomed = false;
  renderPlanViewer();
  if (!dialog.open) dialog.showModal();
}

function zoomPlan(event) {
  const stage = $("planStage");
  const sheet = stage.querySelector(".plan-sheet");
  const before = sheet.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (event.clientX - before.left) / before.width));
  const y = Math.min(1, Math.max(0, (event.clientY - before.top) / before.height));
  state.vplan.zoomed = !state.vplan.zoomed;
  stage.classList.toggle("is-zoomed", state.vplan.zoomed);
  const after = sheet.getBoundingClientRect();
  stage.scrollLeft += after.left + x * after.width - event.clientX;
  stage.scrollTop += after.top + y * after.height - event.clientY;
}

function nextTestHtml() {
  const time = clockState();
  const next = state.items.filter((item) => isAssessment(item) && item.date >= time.iso).sort(byDate)[0];
  if (!next) {
    return `<h2 class="side-title">Tests, Klausuren und Vorträge</h2><p class="ov-calm is-quiet">${icon("circle-check")}<span>Keine angekündigt.</span></p>`;
  }
  const target = parseDate(next.date);
  const diff = dayDiff(time.date, next.date);
  const block = itemBlock(next);
  const lesson = block ? lessonAt(next.date, block) : null;
  const where = [block ? `${block}.\u00a0Block` : "", lesson ? lesson.room : ""].filter(Boolean).join(", ");
  const soon = diff <= 1 ? " is-soon" : "";
  return `<h2 class="side-title" id="nextTestTitle">${esc(ASSESSMENTS[next.kind].next)}</h2>
    <button type="button" class="ov-item" data-open-item="${esc(next.id)}" aria-describedby="nextTestTitle">
      ${leaf(target, soon)}
      <span class="ov-item-text"><b>${esc(subject(next.subject).label)}${where ? `, ${esc(where)}` : ""}</b><span class="ov-item-title">${widow(glue(esc(next.title)))}</span><small class="due-when${diff <= 1 ? " is-urgent" : ""}">${esc(diff <= 1 ? cap(relativeDay(diff, target)) : cap(inDays(diff)))}</small></span>
      ${icon("chevron-right", "chev-end")}
    </button>`;
}

function gradesSummaryHtml() {
  const rows = semesterRows(SEMESTER);
  const value = overallOf(rows);
  const count = rows.reduce((sum, row) => sum + row.count, 0);
  const previous = overallOf(semesterRows(SEMESTERS[SEMESTERS.indexOf(SEMESTER) - 1] || ""));
  const trend = value != null && previous != null ? `${SEMESTERS[SEMESTERS.indexOf(SEMESTER) - 1]}: ${decimal(previous)}` : "";
  return `<button type="button" class="ov-item ov-grades" data-open-grades="1" aria-label="Noten ${SEMESTER}${value != null ? `, Schnitt ${decimal(value)} Punkte` : ", noch keine Noten"}">
    <span class="ov-item-text"><span class="side-title">Noten ${SEMESTER}</span><small>${value != null ? `${plural(count, "Note", "Noten")}${trend ? `, ${esc(trend)}` : ""}` : "Noch keine Noten eingetragen"}</small></span>
    ${value != null ? `<span class="ov-number num">${decimal(value)}</span>` : ""}
    ${icon("chevron-right", "chev-end")}
  </button>`;
}

function renderOverview() {
  const node = $("overview");
  keepFocus(node, () => {
    node.innerHTML = `<div class="ov-block ov-vplan">${vplanHtml()}</div><div class="ov-block ov-next">${nextTestHtml()}</div><div class="ov-block">${gradesSummaryHtml()}</div>`;
  });
}

function dueMeta(item, time) {
  const target = parseDate(item.date);
  const diff = dayDiff(time.date, item.date);
  const block = itemBlock(item);
  const kind = `<span class="kind${isAssessment(item) ? " is-test" : ""}">${isAssessment(item) ? icon(FLAG_ICONS[item.kind]) : ""}${esc(item.kind)}</span>`;
  const tag = item.subject ? `${subjectTag(item.subject)}, ` : "";
  const prep = prepOf(item);
  const written = diff < 0 && isAssessment(item);
  let when;
  if (written) when = `<span class="row-note is-ready">${icon("check")}${esc(pastText(diff, target, item.kind))}</span>`;
  else if (diff < 0) when = `<span class="due-when is-urgent">${overdueText(diff, target)}</span>`;
  else if (diff <= 1) when = `<span class="due-when${prep.total && !prep.open ? "" : " is-urgent"}">${relativeDay(diff, target)}</span>`;
  else when = `<span class="due-when">${inDays(diff)}</span>`;
  const blockText = block && diff >= 0 ? `, ${block}.\u00a0Block` : "";
  let prepText = "";
  if (prep.total && !written) prepText = prep.open ? `, ${plural(prep.open, "Aufgabe offen", "Aufgaben offen")}` : `, <span class="row-note is-ready">${icon("check")}vorbereitet</span>`;
  return `${kind} ${tag}${when}${blockText}${prepText}`;
}

function dueRow(item, time) {
  const diff = dayDiff(time.date, item.date);
  const prep = prepOf(item);
  const written = diff < 0 && isAssessment(item);
  const leafClass = written ? "is-done" : diff < 0 ? "is-overdue" : diff <= 1 && !(prep.total && !prep.open) ? "is-soon" : "";
  return `<li class="row due is-interactive${written ? " is-written" : ""}" data-row="${esc(item.id)}">
    ${leaf(parseDate(item.date), leafClass)}
    <div class="row-main">
      <p class="row-title"><button type="button" class="row-link" data-open-item="${esc(item.id)}"><span class="row-text">${widow(glue(esc(item.title)))}</span></button></p>
      <p class="row-meta">${dueMeta(item, time)}</p>
    </div>
    ${icon("chevron-right", "chev-end")}
  </li>`;
}

function renderTests() {
  const time = clockState();
  const list = state.items.filter((item) => isAssessment(item) && item.date >= time.iso).sort(byDate);
  const written = state.items.filter((item) => isAssessment(item) && item.date < time.iso).sort((a, b) => byDate(b, a));
  $("testsMeta").textContent = assessmentCount(list);
  const body = $("testsBody");
  const open = state.writtenOpen && written.length > 0;
  const word = pastWord(written);
  const past = written.length
    ? `<button class="done-toggle" type="button" id="writtenToggle" aria-expanded="${open}" aria-controls="writtenList">${icon("chevron-right")}<span>${written.length} ${word}</span></button>
      <ul class="rows done-list" id="writtenList" aria-label="${cap(word)}"${open ? "" : " hidden"}>${open ? written.map((item) => dueRow(item, time)).join("") : ""}</ul>`
    : "";
  keepFocus(body, () => {
    if (!list.length) {
      const hour = time.min / 60;
      const kind = hour >= 21 || hour < 5 ? "schlaeft" : "ruhe";
      body.innerHTML = `<div class="empty-state">${tinte(kind)}<p class="empty-title">Keine Tests in Sicht.</p><p class="empty-text">Angekündigte Tests, Klausuren und Vorträge trägst du hier ein.</p><button type="button" class="empty-action" data-new-test="">Test eintragen${icon("chevron-right")}</button></div>${past}`;
      return;
    }
    body.innerHTML = `<ul class="rows" aria-labelledby="testsTitle">${list.map((item) => dueRow(item, time)).join("")}</ul>${past}`;
  });
}

function renderHomework() {
  const time = clockState();
  const list = state.items
    .filter((item) => isHomework(item) && !item.pinned && item.status !== "abgegeben")
    .sort((a, b) => Number(b.date < time.iso) - Number(a.date < time.iso) || byDate(a, b));
  const overdue = list.filter((item) => item.date < time.iso).length;
  $("homeworkMeta").textContent = list.length ? `${list.length} offen${overdue ? `, ${overdue} überfällig` : ""}` : "";
  const body = $("homeworkBody");
  keepFocus(body, () => {
    body.innerHTML = list.length
      ? `<ul class="rows" aria-labelledby="homeworkTitle">${list.map((item) => dueRow(item, time)).join("")}</ul>`
      : `<p class="empty-line">Keine offenen Hausaufgaben.<small>Neue kommen automatisch aus IServ.</small></p>`;
  });
}

function seminarTitle(item) {
  const quoted = item.title.match(/„([^“]+)“/);
  return quoted ? quoted[1] : item.title;
}

function renderSeminar() {
  const section = $("seminarSection");
  const seminar = page.seminar;
  const item = seminar && state.items.find((entry) => entry.id === seminar.deadline);
  if (!item) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const time = clockState();
  const diff = dayDiff(time.date, item.date);
  const target = parseDate(item.date);
  const chapters = seminar.chapters || [];
  const done = chapters.filter((chapter) => chapter.state === "done").length;
  const draft = chapters.findIndex((chapter) => chapter.state === "draft");
  const words = { done: "fertig", draft: "im Entwurf", open: "offen" };
  const doneText = done ? `Kapitel ${Array.from({ length: done }, (_, index) => index + 1).join(" und ").replace(/ und (?=.* und )/g, ", ")} fertig` : "";
  const draftText = draft >= 0 ? `Kapitel ${draft + 1} im Entwurf` : "";
  const nextTask = tasks.filter((task) => task.deadline === item.id && !task.done).sort((a, b) => (a.date || "").localeCompare(b.date || ""))[0];
  const nextText = nextTask ? `<span class="seminar-next">Als Nächstes: <a class="inline-link" href="/hub/tasks" data-page="tasks">${esc(nextTask.title.replace(/^Seminararbeit:\s*/, ""))}</a>${nextTask.date && nextTask.date > time.iso ? `, ${esc(relativeDay(dayDiff(time.date, nextTask.date), parseDate(nextTask.date)))}` : nextTask.anchor ? `, ${esc(nextTask.anchor)}` : ", heute"}</span>` : "";
  const course = [seminar.course, seminar.share ? `${seminar.share}\u00a0% der Kursnote` : ""].filter(Boolean).join(", ");
  const status = [doneText, draftText].filter(Boolean).join(", ");
  const foot = [status ? `${esc(status)}.` : "", nextText].filter(Boolean).join(" ");
  $("seminarMeta").textContent = `Abgabe ${shortDate(target)}`;
  const body = $("seminarBody");
  const due = diff > 1
    ? { main: plural(diff, "Tag", "Tage"), sub: "bis zur Abgabe" }
    : diff >= 0
      ? { main: diff === 1 ? "Morgen" : "Heute", sub: "ist Abgabe" }
      : { main: "Überfällig", sub: `Abgabe war ${shortDate(target)}` };
  keepFocus(body, () => {
    body.innerHTML = `<div class="seminar-card" style="--hue:${hueVar(item.subject)}">
      <div class="seminar-top">
        <button type="button" class="seminar-open" data-open-subject="${esc(item.subject)}">
          <span class="seminar-kicker">${esc(course)}</span>
          <span class="seminar-title">${esc(seminarTitle(item))}</span>
        </button>
        <p class="seminar-due${diff < 0 ? " is-late" : ""}"><b class="num">${esc(due.main)}</b><small>${esc(due.sub)}</small></p>
      </div>
      <ol class="chapters" aria-label="Kapitel">${chapters.map((chapter, index) => `<li class="chapter is-${chapter.state}"><span class="chapter-bar" aria-hidden="true"></span><span class="chapter-name"><span class="chapter-num">${index + 1}</span> ${esc(chapter.title)}</span><span class="visually-hidden">, ${words[chapter.state] || chapter.state}</span></li>`).join("")}</ol>
      ${foot ? `<p class="seminar-foot">${foot}</p>` : ""}
    </div>`;
  });
}

function renderLists() {
  renderTests();
  renderHomework();
  renderSeminar();
}

function isSelectedCell(iso, block) {
  const selection = state.selection;
  if (selection?.type === "lesson") return selection.iso === iso && selection.block === block;
  if (selection?.type === "test") return state.draft?.date === iso && state.draft?.block === block;
  return false;
}

function markSelection() {
  document.querySelectorAll("#timetable .lesson").forEach((node) => node.classList.toggle("is-selected", isSelectedCell(node.dataset.iso, Number(node.dataset.block))));
  const selection = state.selection;
  document.querySelectorAll("[data-row].is-selected").forEach((node) => node.classList.remove("is-selected"));
  if (selection?.item) document.querySelector(`[data-row="${CSS.escape(selection.item)}"]`)?.classList.add("is-selected");
}

function panelHead(title, sub = "", key = null) {
  return `<div class="panel-head school-panel-head">
    ${key ? `<span class="panel-dot" style="--hue:${hueVar(key)}" aria-hidden="true"></span>` : ""}
    <div class="panel-heading"><h2 class="panel-name" id="panelTitle" tabindex="-1">${esc(title)}</h2>${sub ? `<p class="panel-sub">${sub}</p>` : ""}</div>
    <div class="panel-tools"><button class="icon-button" type="button" data-panel-close aria-label="Details schließen" data-tip="Schließen">${icon("x")}</button></div>
  </div>`;
}

const remote = (item) => item.origin === "iserv";
const editable = (item) => !item.pinned && /^(hw|test|exam|talk|new)-/.test(item.id);
const changeable = (item) => editable(item) && !remote(item);

function itemTools(item) {
  if (!editable(item)) return "";
  const title = esc(item.title);
  const done = isHomework(item) && item.status !== "abgegeben"
    ? `<button class="icon-button" type="button" data-done-item="${esc(item.id)}" aria-label="Erledigt: ${title}" data-tip="Erledigt">${icon("check")}</button>`
    : "";
  const edit = !changeable(item)
    ? ""
    : `<button class="icon-button" type="button" data-edit-item="${esc(item.id)}" aria-label="Bearbeiten: ${title}" data-tip="Bearbeiten">${icon("pencil")}</button>`;
  return `<span class="note-tools">${done}${edit}<button class="icon-button is-danger" type="button" data-delete-item="${esc(item.id)}" aria-label="Löschen: ${title}" data-tip="Löschen">${icon("trash-2")}</button></span>`;
}

function itemNote(item) {
  const test = isAssessment(item);
  const done = item.status === "abgegeben" ? `<small>Erledigt</small>` : "";
  return `<div class="lesson-note${test ? " is-test" : ""}">${icon(FLAG_ICONS[item.kind] || "notebook-pen")}<span class="note-text"><b>${esc(item.kind)}:</b> ${esc(item.title)}${item.detail ? detailHtml(item) : ""}${done}</span>${itemTools(item)}</div>`;
}

function detailHtml(item) {
  const open = state.openNotes.has(item.id);
  return `<small class="note-detail${open ? " is-open" : ""}">${esc(item.detail)}</small><button type="button" class="text-button note-more" data-note-more="${esc(item.id)}" aria-expanded="${open}" hidden><span>${open ? "Weniger anzeigen" : "Mehr anzeigen"}</span></button>`;
}

function fitNotes() {
  document.querySelectorAll("#schoolPanel .note-more").forEach((button) => {
    const text = button.previousElementSibling;
    const open = text.classList.contains("is-open");
    text.classList.remove("is-open");
    button.hidden = text.scrollHeight <= text.clientHeight + 1;
    text.classList.toggle("is-open", open);
  });
}

function itemBox(item, time) {
  const target = parseDate(item.date);
  const diff = dayDiff(time.date, item.date);
  const written = diff < 0 && isAssessment(item);
  const status = written ? pastText(diff, target, item.kind) : diff < 0 ? overdueText(diff, target) : inDays(diff);
  return `<div class="lesson-box is-${diff < 0 ? "past" : "future"}">
    <p class="lesson-box-when"><b>${esc(slotText(target, itemBlock(item)))}</b></p>
    <p class="lesson-box-status">${esc(cap(status))}</p>
    ${itemNote(item)}
  </div>`;
}

function lessonBox(lesson, time) {
  const phase = phaseOf(lesson, time);
  const diff = dayDiff(time.date, lesson.iso);
  const items = state.items.filter((item) => item.date === lesson.iso && itemBlock(item) === lesson.block && item.subject === lesson.subject && !item.pinned);
  const lines = [];
  if (lesson.cancelled) lines.push(`<p class="lesson-note is-urgent">${icon("calendar-x-2")}<span>Entfällt${lesson.note ? `, Grund: ${esc(lesson.note)}` : ""}</span></p>`);
  else if (lesson.movedFrom) lines.push(`<p class="lesson-note is-urgent">${icon("nx-room")}<span>In <b>${esc(lesson.room)}</b> statt ${esc(lesson.movedFrom)}</span></p>`);
  items.forEach((item) => lines.push(itemNote(item)));
  let status;
  if (lesson.cancelled) status = phase === "past" ? "Vorbei" : cap(relativeDay(diff, lesson.date));
  else if (phase === "now") status = `Läuft, noch <b data-remaining>${lesson.endMin - time.min}</b>\u00a0Min.`;
  else if (phase === "past") status = diff === 0 ? "Heute vorbei" : "Vorbei";
  else if (diff === 0) status = `Heute, in ${duration(lesson.startMin - time.min)}`;
  else status = cap(inDays(diff));
  const progress = phase === "now" && !lesson.cancelled ? (time.min - lesson.startMin) / (lesson.endMin - lesson.startMin) : null;
  return `<div class="lesson-box is-${phase}${lesson.cancelled ? " is-cancelled" : ""}">
    <p class="lesson-box-when"><b>${esc(slotText(lesson.date, lesson.block))}</b><span class="num">${hm(lesson.start)} bis ${hm(lesson.end)}</span></p>
    <p class="lesson-box-status">${status}${lesson.cancelled || lesson.movedFrom ? "" : `, ${esc(lesson.room)}`}</p>
    ${progress != null ? `<span class="lesson-box-bar" aria-hidden="true"><i style="--p:${progress.toFixed(4)}"></i></span>` : ""}
    ${lines.join("")}
  </div>`;
}

function slotsHtml(key) {
  const slots = slotsOf(key);
  const line = (list) => list.length ? list.map((slot) => `${WEEKDAYS_SHORT[slot.dow % 7]}.\u00a0${slot.block}.\u00a0Block`).join(", ") : "keine Stunde";
  if (!abWeeks()) return `<ul class="slot-list"><li><span>${esc(line(slots.A))}</span></li></ul>`;
  return `<ul class="slot-list">${["A", "B"].map((week) => `<li><span class="week-badge" aria-label="${week}-Woche">${week}</span><span>${esc(line(slots[week]))}</span></li>`).join("")}</ul>`;
}

function upcomingFor(key, time, excludeLesson = null) {
  return state.items
    .filter((item) => item.subject === key && item.status !== "abgegeben" && (item.date >= time.iso || isHomework(item)))
    .filter((item) => !excludeLesson || !(item.date === excludeLesson.iso && itemBlock(item) === excludeLesson.block))
    .sort(byDate);
}

function miniDueHtml(item, time) {
  const target = parseDate(item.date);
  const diff = dayDiff(time.date, item.date);
  const block = itemBlock(item);
  const when = diff < 0 ? overdueText(diff, target) : `${slotText(target, block)}, ${inDays(diff)}`;
  const test = isAssessment(item);
  return `<li><button type="button" class="mini-due${test ? " is-test" : ""}" data-open-item="${esc(item.id)}">
    ${icon(FLAG_ICONS[item.kind] || "notebook-pen", "mini-icon")}
    <span class="mini-text"><span class="mini-title"><b>${esc(item.kind)}:</b> ${widow(glue(esc(item.title)))}</span><small class="${diff < 0 ? "is-urgent" : ""}">${esc(when)}</small></span>
  </button></li>`;
}

function gradeListHtml(key) {
  const list = gradesFor(key);
  const average = subjectAverage(list);
  const history = flags.empty ? {} : page.history?.[key] || {};
  const past = SEMESTERS.filter((semester) => semester !== SEMESTER && history[semester] != null).map((semester) => `${semester}: ${history[semester]}`);
  const rows = list.map((grade) => {
    const date = parseDate(grade.date);
    const type = GRADE_TYPES[grade.type] || grade.type;
    const what = grade.title || type;
    const when = `${date.getDate()}.${date.getMonth() + 1}.`;
    return `<li class="grade-row"><span class="grade-points num" aria-label="${grade.points} Punkte">${grade.points}</span><span class="grade-what">${esc(what)}<small>${esc(what === type ? when : `${type}, ${when}`)}</small></span><button class="icon-button is-danger grade-remove" type="button" data-delete-grade="${esc(grade.id)}" aria-label="Note löschen: ${esc(what)}, ${grade.points} Punkte" data-tip="Löschen">${icon("trash-2")}</button></li>`;
  }).join("");
  const form = state.gradeForm
    ? gradeFormHtml()
    : `<div class="grade-actions"><button type="button" class="text-button grade-add" data-grade-form>${icon("plus")}<span>Note eintragen</span></button>${list.length ? `<button type="button" class="text-button" data-calc-for="${esc(key)}"><span>Zielnote berechnen</span></button>` : ""}</div>`;
  return `<div class="field panel-grades">
    <div class="field-split"><span class="field-label" id="gradesLabel">Noten ${SEMESTER}</span>${average != null ? `<span class="grade-average">Schnitt <b class="num">${decimal(average)}</b></span>` : ""}</div>
    ${list.length ? `<ul class="grade-list" aria-labelledby="gradesLabel">${rows}</ul>` : `<p class="field-empty">Noch keine Note in ${SEMESTER}.</p>`}
    ${past.length ? `<p class="grade-history">${esc(past.join(", "))} Punkte</p>` : ""}
    ${form}
  </div>`;
}

function gradeFormHtml({ pick = false } = {}) {
  const options = Array.from({ length: 16 }, (_, index) => 15 - index).map((value) => `<option value="${value}"${value === 12 ? " selected" : ""}>${value} ${value === 1 ? "Punkt" : "Punkte"}</option>`).join("");
  const preset = pick ? defaultSubject() : null;
  const subjects = pick
    ? `<label class="mini-field is-wide"><span class="field-label">Fach</span><select class="field-control" name="subject" id="gradeSubject">${activeSubjectKeys().map((key) => `<option value="${esc(key)}"${key === preset ? " selected" : ""}>${esc(subject(key).name)}</option>`).join("")}</select></label>`
    : "";
  return `<form class="grade-form" id="gradeForm" autocomplete="off">
    ${subjects}
    <label class="mini-field"><span class="field-label">Punkte</span><select class="field-control" name="points" id="gradePoints">${options}</select></label>
    <label class="mini-field"><span class="field-label">Art</span><select class="field-control" name="kind">${Object.entries(GRADE_TYPES).map(([value, word]) => `<option value="${value}"${value === "test" ? " selected" : ""}>${word}</option>`).join("")}</select></label>
    <label class="mini-field is-wide"><span class="field-label">Wofür</span><input class="field-control" name="title" placeholder="z. B. Stundenarbeit" maxlength="80"></label>
    <div class="form-actions"><button type="button" class="btn btn-quiet" data-grade-cancel>Abbrechen</button><button type="submit" class="btn btn-primary">Eintragen</button></div>
  </form>`;
}

function subjectPanelHtml(key, lesson = null) {
  const time = clockState();
  const info = subject(key);
  const course = page.courses?.[key] || {};
  const teacher = lesson?.teacher || teacherOf(key);
  const courseWord = course.type && course.type !== "SK" ? COURSE_WORDS[course.type] : "";
  const sub = [teacher, courseWord].filter(Boolean).map(esc).join(", ");
  const slots = slotsOf(key);
  const rooms = [...new Set([...slots.A, ...slots.B].map((slot) => slot.room))];
  const next = upcoming(time, (entry) => entry.subject === key)[0] || null;
  const showNext = next && !(lesson && next.iso === lesson.iso && next.block === lesson.block);
  const picked = !lesson && state.selection?.item ? state.items.find((item) => item.id === state.selection.item) : null;
  const due = upcomingFor(key, time, lesson).filter((item) => item !== picked);
  const fields = [];
  if (showNext) {
    const diff = dayDiff(time.date, next.iso);
    fields.push(`<div class="field is-row"><span class="field-label">Nächste Stunde</span><span class="field-value"><button type="button" class="link-button" data-open-lesson="${cellKey(next.iso, next.block)}">${esc(slotText(next.date, next.block))}</button><small>${esc(diff === 0 ? `heute um ${hm(next.start)}` : inDays(diff))}, ${esc(next.room)}</small></span></div>`);
  }
  fields.push(`<div class="field is-row"><span class="field-label">Stunden</span><span class="field-value">${slotsHtml(key)}</span></div>`);
  fields.push(`<div class="field is-row"><span class="field-label">${rooms.length === 1 ? "Raum" : "Räume"}</span><span class="field-value num">${esc(rooms.join(", "))}</span></div>`);
  if (course.topic) fields.push(`<div class="field is-row"><span class="field-label">Thema</span><span class="field-value">${esc(course.topic)}</span></div>`);
  fields.push(`<div class="field"><span class="field-label" id="dueLabel">Anstehend</span>${due.length ? `<ul class="mini-list" aria-labelledby="dueLabel">${due.map((item) => miniDueHtml(item, time)).join("")}</ul>` : `<p class="field-empty">Nichts angekündigt.</p>`}</div>`);
  fields.push(gradeListHtml(key));
  return `${panelHead(info.name, sub, key)}
    ${lesson ? lessonBox(lesson, time) : picked ? itemBox(picked, time) : ""}
    <div class="panel-fields school-fields">${fields.join("")}</div>
    <div class="panel-actions"><button type="button" class="btn btn-quiet" data-new-test="${esc(key)}">${icon("plus")}Test eintragen</button></div>`;
}

function gradesPanelHtml() {
  const semester = state.gradeSemester;
  const rows = semesterRows(semester);
  const value = overallOf(rows);
  const scored = sortedSubjects(rows.filter((row) => row.value != null));
  const missing = sortedSubjects(rows.filter((row) => row.value == null && !retiredKey(row.key)));
  const switcher = SEMESTERS.length > 1
    ? `<div class="segmented grade-switch" role="group" aria-label="Halbjahr">${SEMESTERS.map((item) => `<button type="button" data-semester="${esc(item)}" aria-pressed="${item === semester}">${esc(item)}</button>`).join("")}</div>`
    : "";
  const bars = scored.map((row) => {
    const info = subject(row.key);
    const gone = retiredKey(row.key);
    const inner = `<span class="gb-name">${esc(info.label)}</span>
      <span class="gb-track" aria-hidden="true"><i></i></span>
      <span class="gb-value num">${decimal(row.value)}</span>${gone ? `<small class="gb-hint">nicht mehr im Plan</small>` : ""}`;
    const style = `--hue:${hueVar(row.key)};--w:${(row.value / 15).toFixed(4)}`;
    if (gone) return `<li><div class="grade-bar is-retired" style="${style}">${inner}</div></li>`;
    return `<li><button type="button" class="grade-bar" data-open-subject="${esc(row.key)}" style="${style}" aria-label="${esc(info.name)}: ${decimal(row.value)} Punkte${semester === SEMESTER ? `, ${plural(row.count, "Note", "Noten")}` : ""}">${inner}</button></li>`;
  }).join("");
  const note = semester === SEMESTER
    ? missing.length ? `Noch ohne Note: ${missing.map((row) => `<button type="button" class="inline-link" data-open-subject="${esc(row.key)}">${esc(subject(row.key).label)}</button>`).join(", ")}.` : ""
    : "Kursnoten am Ende des Halbjahres.";
  let entry = "";
  if (semester === SEMESTER) {
    if (!activeSubjectKeys().length) entry = `<p class="side-hint">Noten trägst du ein, sobald dein Stundenplan Fächer hat.</p>`;
    else entry = `<div class="grades-entry">${state.gradeForm ? gradeFormHtml({ pick: true }) : `<div class="grade-actions"><button type="button" class="text-button grade-add" data-grade-form>${icon("plus")}<span>Note eintragen</span></button></div>`}</div>`;
  }
  return `${panelHead("Noten", "Punkte, Leistungskurse zählen doppelt")}
    ${switcher}
    ${value != null ? `<p class="grades-total"><b class="grades-number num">${decimal(value)}</b><span>Punkte im Schnitt${semester === SEMESTER ? `, ${plural(rows.reduce((sum, row) => sum + row.count, 0), "Note", "Noten")} bisher` : ""}</span></p>` : `<p class="field-empty">Für ${esc(semester)} sind noch keine Noten eingetragen.</p>`}
    ${entry}
    ${bars ? `<ol class="grade-bars" aria-label="Schnitt je Fach">${bars}</ol>` : ""}
    ${note ? `<p class="side-hint">${note}</p>` : ""}
    ${calculatorHtml()}
    ${scaleHtml(overallOf(semesterRows(SEMESTER)))}`;
}

const calcSystem = () => state.calc.system || gradeScale();

function scoredKeys() {
  return sortedSubjects(semesterRows(SEMESTER).filter((row) => row.count && activeKey(row.key))).map((row) => row.key);
}

function clearCalc() {
  Object.assign(state.calc, { average: "", count: "", target: "", exams: ["", "", "", ""], other: "" });
}

function prefillCalc(key) {
  const calc = state.calc;
  const list = key ? gradesFor(key) : [];
  calc.subject = key || "";
  if (!list.length) return;
  if (calcSystem() === "grades") {
    const marks = list.map((grade) => markOfPoints(grade.points));
    const average = marks.reduce((sum, value) => sum + value, 0) / marks.length;
    const best = (average * marks.length + 0.7) / (marks.length + 1);
    const better = Math.max(0.7, Math.round((average - 0.3) * 10) / 10);
    calc.average = decimal(average);
    calc.count = String(marks.length);
    calc.target = decimal(better >= best ? better : Math.round(average * 10) / 10);
    calc.exams = ["", "", "", ""];
    calc.other = marks.map((mark) => decimal(mark)).join("; ");
    return;
  }
  const average = subjectAverage(list);
  const exams = list.filter((grade) => grade.type === "klausur");
  const best = (average * list.length + 15) / (list.length + 1);
  const up = Math.floor(average) + 1;
  calc.average = decimal(average);
  calc.count = String(list.length);
  calc.target = decimal(Math.min(15, up <= best ? up : Math.floor(average)));
  calc.exams = [0, 1, 2, 3].map((index) => (exams[index] ? String(exams[index].points) : ""));
  calc.other = list.filter((grade) => grade.type !== "klausur").map((grade) => grade.points).join(", ");
}

function switchCalcSystem(system) {
  if (!CALC_SYSTEMS.some(([key]) => key === system) || system === calcSystem()) return;
  state.calc.system = system;
  if (state.calc.subject) prefillCalc(state.calc.subject);
  else clearCalc();
}

function calcSubjectSelect() {
  const keys = scoredKeys();
  const current = state.calc.subject || "";
  return `<label class="mini-field is-wide"><span class="field-label">Werte aus</span><select class="field-control" data-calc="subject">
    <option value=""${current ? "" : " selected"}>Eigene Werte</option>
    ${keys.map((key) => `<option value="${esc(key)}"${key === current ? " selected" : ""}>${esc(subject(key).name)}</option>`).join("")}
  </select></label>`;
}

function calcToolHtml() {
  const calc = state.calc;
  const grades = calcSystem() === "grades";
  const output = `<output class="calc-result" id="calcResult" aria-live="polite">${calcResultHtml()}</output>`;
  if (calc.tool === "umrechnen") {
    if (grades) {
      return `<label class="mini-field is-wide calc-slider"><span class="field-label">Note</span><input type="range" min="0.7" max="6" step="0.1" value="${calc.mark}" data-calc="mark" aria-valuetext="Note ${decimal(calc.mark)}"></label>${output}`;
    }
    return `<label class="mini-field is-wide calc-slider"><span class="field-label">Punkte</span><input type="range" min="0" max="15" step="1" value="${calc.points}" data-calc="points" aria-valuetext="${calc.points} Punkte"></label>${output}`;
  }
  if (calc.tool === "fach") {
    if (grades) {
      return `${calcSubjectSelect()}
        <label class="mini-field is-wide"><span class="field-label">Noten, einfacher Durchschnitt</span><input class="field-control" data-calc="other" value="${esc(calc.other)}" inputmode="decimal" autocomplete="off" placeholder="z. B. 2,3; 1,7; 3,0"></label>
        ${output}`;
    }
    const exams = calc.exams.map((value, index) => `<input class="field-control" data-calc="exam-${index}" value="${esc(value)}" inputmode="decimal" autocomplete="off" aria-label="Klausur ${index + 1}" placeholder="K${index + 1}">`).join("");
    return `${calcSubjectSelect()}
      <fieldset class="calc-exams"><legend class="field-label">Klausuren, zählen ein Drittel</legend><div class="calc-exam-row">${exams}</div></fieldset>
      <label class="mini-field is-wide"><span class="field-label">Sonstige Noten, zählen zwei Drittel</span><input class="field-control" data-calc="other" value="${esc(calc.other)}" inputmode="decimal" autocomplete="off" placeholder="z. B. 12, 11, 13"></label>
      ${output}`;
  }
  const hint = grades ? ["2,3", "4", "2,0"] : ["11,5", "4", "12,0"];
  return `${calcSubjectSelect()}
    <div class="calc-row">
      <label class="mini-field"><span class="field-label">Schnitt jetzt</span><input class="field-control" data-calc="average" value="${esc(calc.average)}" inputmode="decimal" autocomplete="off" placeholder="${hint[0]}"></label>
      <label class="mini-field"><span class="field-label">Noten bisher</span><input class="field-control" data-calc="count" value="${esc(calc.count)}" inputmode="numeric" autocomplete="off" placeholder="${hint[1]}"></label>
      <label class="mini-field"><span class="field-label">Ziel</span><input class="field-control" data-calc="target" value="${esc(calc.target)}" inputmode="decimal" autocomplete="off" placeholder="${hint[2]}"></label>
    </div>
    ${output}`;
}

function calculatorHtml() {
  const calc = state.calc;
  const system = calcSystem();
  const tools = CALC_TOOLS.map(([key, label]) => `<button type="button" data-calc-tool="${key}" aria-pressed="${calc.tool === key}">${label}</button>`).join("");
  const systems = CALC_SYSTEMS.map(([key, label]) => `<button type="button" class="pill" data-calc-system="${key}" aria-pressed="${system === key}">${label}</button>`).join("");
  return `<details class="calc" id="calcBox"${calc.open ? " open" : ""}>
    <summary class="calc-summary"><span>Notenrechner</span>${icon("chevron-down", "calc-chev")}</summary>
    <div class="calc-body">
      <div class="segmented calc-switch" role="group" aria-label="Rechner">${tools}</div>
      <div class="calc-system"><span class="field-label" id="calcSystemLabel">Rechnen in</span><div class="calc-system-pills" role="group" aria-labelledby="calcSystemLabel">${systems}</div></div>
      ${calcToolHtml()}
    </div>
  </details>`;
}

function resultCard(big, text, detail = "", tone = "") {
  return `<span class="calc-card${tone ? ` is-${tone}` : ""}"><b class="calc-big num">${big}</b><span class="calc-text">${text}</span>${detail ? `<small class="calc-detail">${detail}</small>` : ""}</span>`;
}

const calcHint = (text) => `<span class="calc-hint">${text}</span>`;
const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;

function convertResult(grades) {
  const calc = state.calc;
  if (grades) {
    const mark = Math.max(0.7, Math.min(6, Math.round(calc.mark * 10) / 10));
    const exact = markExact(mark);
    return resultCard(decimal(mark), `ist ${exact ? "eine" : "etwa eine"} <b>${POINT_NOTES[pointsOfMark(mark)]}</b>, ${markRating(mark).toLowerCase()}.`, `In Punkten ${exact ? "" : "etwa "}${pointsOfMark(mark)}.`);
  }
  const points = Math.max(0, Math.min(15, Math.round(calc.points)));
  return resultCard(points, `${points === 1 ? "Punkt ist" : "Punkte sind"} eine <b>${POINT_NOTES[points]}</b>, ${ratingOf(points).toLowerCase()}.`, `Als Note ${decimal(MARKS[points])}.`);
}

function subjectResult(grades) {
  const calc = state.calc;
  if (grades) {
    const marks = readList(calc.other, "grades");
    if (!marks.length) return calcHint("Trag deine Noten ein, zum Beispiel 2,3; 1,7; 3,0.");
    const value = mean(marks);
    const rounded = Math.min(6, Math.max(1, Math.round(value)));
    return resultCard(decimal(value, 2), `im Schnitt, gerundet eine <b>${rounded}</b> (${markRating(rounded).toLowerCase()}).`, `${plural(marks.length, "Note", "Noten")}, einfacher Durchschnitt wie in der Mittelstufe.`);
  }
  const exams = calc.exams.map((value) => readValue(value, "points")).filter((value) => value != null);
  const others = readList(calc.other, "points");
  const examAvg = exams.length ? mean(exams) : null;
  const otherAvg = others.length ? mean(others) : null;
  if (examAvg == null && otherAvg == null) return calcHint("Trag mindestens eine Klausur oder eine sonstige Note ein.");
  const value = examAvg != null && otherAvg != null ? examAvg / 3 + (otherAvg * 2) / 3 : examAvg ?? otherAvg;
  const rounded = Math.round(value);
  let detail;
  if (examAvg != null && otherAvg != null) detail = `Klausuren ${decimal(examAvg)} mal ein Drittel, sonstige Noten ${decimal(otherAvg)} mal zwei Drittel.`;
  else if (examAvg != null) detail = `Nur Klausuren, Schnitt ${decimal(examAvg)}.`;
  else detail = `Nur sonstige Noten, Schnitt ${decimal(otherAvg)}.`;
  return resultCard(decimal(value, 2), `Punkte Fachnote, im Zeugnis <b>${rounded}</b> (${POINT_NOTES[rounded]}).`, detail);
}

function targetResult(grades) {
  const calc = state.calc;
  const average = readNumber(calc.average);
  const count = readNumber(calc.count);
  const target = readNumber(calc.target);
  if (average == null || count == null || target == null) return calcHint("Trag Schnitt, Anzahl und Ziel ein.");
  const [low, high] = grades ? [0.7, 6] : [0, 15];
  if (count < 1 || average < low || average > high || target < low || target > high) {
    return calcHint(grades ? "Schnitt und Ziel liegen zwischen 0,7 und 6,0, mindestens eine Note." : "Schnitt und Ziel liegen zwischen 0 und 15, mindestens eine Note.");
  }
  const whole = Math.round(count);
  const needed = target * (whole + 1) - average * whole;
  if (grades) {
    if (needed < 0.7 - 1e-9) {
      const best = (average * whole + 0.7) / (whole + 1);
      return resultCard(decimal(needed), "bräuchtest du, besser als eine 1+ geht nicht.", `Mit einer 1+ kommst du auf ${decimal(best, 2)}.`, "bad");
    }
    if (needed >= 6) {
      const worst = (average * whole + 6) / (whole + 1);
      return resultCard("6", "reicht schon, das Ziel ist erreicht.", `Selbst mit einer 6 bleibt ein Schnitt von ${decimal(worst, 2)}.`, "good");
    }
    const mark = MARKS.filter((value) => value <= needed + 1e-9).sort((a, b) => b - a)[0];
    return resultCard(POINT_NOTES[pointsOfMark(mark)], `brauchst du mindestens in der nächsten Arbeit, also ${decimal(mark)} oder besser.`, `Genau ${decimal(needed, 2)} für ${decimal(target)} im Schnitt.`);
  }
  if (needed > 15) {
    const best = (average * whole + 15) / (whole + 1);
    return resultCard(decimal(needed), "Punkte bräuchtest du, mehr als 15 gibt es nicht.", `Mit 15 Punkten kommst du auf ${decimal(best, 2)}.`, "bad");
  }
  if (needed <= 0) {
    const worst = (average * whole) / (whole + 1);
    return resultCard("0", "Punkte reichen schon, das Ziel ist erreicht.", `Selbst mit 0 Punkten bleibt ein Schnitt von ${decimal(worst, 2)}.`, "good");
  }
  const points = Math.min(15, Math.ceil(needed - 1e-9));
  return resultCard(points, `Punkte brauchst du mindestens in der nächsten Note, das ist eine <b>${POINT_NOTES[points]}</b>.`, `Genau ${decimal(needed, 2)} Punkte für ${decimal(target)} im Schnitt.`);
}

function calcResultHtml() {
  const grades = calcSystem() === "grades";
  if (state.calc.tool === "umrechnen") return convertResult(grades);
  if (state.calc.tool === "fach") return subjectResult(grades);
  return targetResult(grades);
}

function scaleHtml(overall) {
  const grades = calcSystem() === "grades";
  const mine = overall != null ? Math.round(overall) : null;
  const rows = RATINGS.map(([min, word], index) => {
    const top = index === 0 ? 15 : RATINGS[index - 1][0] - 1;
    const cells = [];
    for (let points = top; points >= min; points -= 1) {
      const face = grades ? `<b>${POINT_NOTES[points]}</b><span class="num">${decimal(MARKS[points])}</span>` : `<b class="num">${points}</b><span>${POINT_NOTES[points]}</span>`;
      cells.push(`<td class="${points === mine ? "is-mine" : ""}">${face}${points === mine ? `<span class="visually-hidden">, dein Schnitt</span>` : ""}</td>`);
    }
    while (cells.length < 3) cells.push("<td class=\"is-empty\"></td>");
    return `<tr><th scope="row">${word}</th>${cells.join("")}</tr>`;
  }).join("");
  const title = grades ? "Noten und Bewertung" : "Punkte und Noten";
  const label = grades ? "Noten der Mittelstufe mit Wert und Bewertung" : "Punkte und Noten in der Oberstufe";
  const hint = mine == null ? "" : grades ? `Umrandet: dein Schnitt in ${SEMESTER} als Note.` : `Umrandet: dein Schnitt in ${SEMESTER}, gerundet.`;
  return `<details class="calc scale-box"${state.calc.table ? " open" : ""}>
    <summary class="calc-summary"><span>${title}</span>${icon("chevron-down", "calc-chev")}</summary>
    <table class="scale${grades ? " is-grades" : ""}" aria-label="${label}"><tbody>${rows}</tbody></table>
    ${hint ? `<p class="side-hint">${hint}</p>` : ""}
  </details>`;
}

function updateCalcResult() {
  const output = $("calcResult");
  if (output) output.innerHTML = calcResultHtml();
}

function openGrades(trigger, { form = false } = {}) {
  if (state.calc.subject == null) prefillCalc(scoredKeys()[0] || "");
  state.gradeSemester = SEMESTER;
  openPanel({ type: "grades" }, { trigger, form });
}

function openGradeForm(trigger) {
  if (state.selection?.type !== "grades" || !state.gradeForm || state.gradeSemester !== SEMESTER) openGrades(trigger, { form: true });
  requestAnimationFrame(() => $("gradeSubject")?.focus({ preventScroll: true }));
}

function openCalculator(key, trigger) {
  prefillCalc(key);
  state.calc.open = true;
  state.calc.tool = "ziel";
  state.gradeSemester = SEMESTER;
  openPanel({ type: "grades" }, { trigger });
  requestAnimationFrame(() => {
    const box = $("calcBox");
    revealInPanel(box);
    box?.querySelector('[data-calc="target"]')?.focus({ preventScroll: true });
  });
}

function revealInPanel(node) {
  const container = narrow.matches ? $("schoolPanel") : $("schoolSide");
  if (!node || !container || container.scrollHeight <= container.clientHeight) return;
  const box = node.getBoundingClientRect();
  const frame = container.getBoundingClientRect();
  const bottom = Math.min(box.bottom, box.top + frame.height - 24);
  const shift = bottom > frame.bottom - 12 ? bottom - frame.bottom + 12 : box.top < frame.top ? box.top - frame.top - 12 : 0;
  if (shift) container.scrollBy({ top: shift, behavior: travels() ? "smooth" : "auto" });
}

function testSlots(key) {
  return upcoming(clockState(), (lesson) => lesson.subject === key, 4, 35);
}

const TEXT_LIMITS = { title: 300, detail: 2000 };

function countHtml(field, text) {
  const limit = TEXT_LIMITS[field];
  return `<small class="field-count${text.length >= limit ? " is-full" : ""}" data-count="${field}"${text.length < limit * 0.9 ? " hidden" : ""}>${text.length} von ${limit} Zeichen</small>`;
}

function showCount(field, text) {
  const node = document.querySelector(`#schoolPanel [data-count="${field}"]`);
  if (node) node.outerHTML = countHtml(field, text);
}

function keepOneLine(field) {
  if (!/[\r\n]/.test(field.value)) return;
  const flat = (text) => text.replace(/\s*[\r\n]+\s*/g, " ");
  const caret = flat(field.value.slice(0, field.selectionStart)).length;
  field.value = flat(field.value);
  field.setSelectionRange(caret, caret);
}

function testFormHtml() {
  const draft = state.draft;
  const editing = !!draft.id;
  const homework = isHomework(draft);
  const slots = draft.subject ? testSlots(draft.subject) : [];
  const custom = draft.date && !slots.some((slot) => slot.iso === draft.date && slot.block === draft.block);
  const keys = activeSubjectKeys();
  if (draft.subject && !keys.includes(draft.subject) && data.subjects[draft.subject]) keys.push(draft.subject);
  const none = homework ? `<option value=""${draft.subject ? "" : " selected"}>Kein Fach</option>` : "";
  const options = none + keys.map((key) => `<option value="${esc(key)}"${key === draft.subject ? " selected" : ""}>${esc(subject(key).name)}</option>`).join("");
  const time = clockState();
  const pills = slots.map((slot) => `<button type="button" class="pill" data-slot="${cellKey(slot.iso, slot.block)}" aria-pressed="${draft.date === slot.iso && draft.block === slot.block}">${esc(slotLabel(slot, time))}</button>`).join("");
  const customLabel = custom ? esc(slotText(parseDate(draft.date), draft.block)) : "Anderer Tag";
  const head = editing ? panelHead(`${draft.kind} bearbeiten`) : panelHead(`${draft.kind} eintragen`, "Wähle die Stunde hier oder direkt im Stundenplan.");
  const kinds = homework
    ? ""
    : `<div class="field"><span class="field-label" id="testKindLabel">Art</span>
        <div class="field-body" role="group" aria-labelledby="testKindLabel">${Object.keys(ASSESSMENTS).map((kind) => `<button type="button" class="pill" data-kind="${kind}" aria-pressed="${draft.kind === kind}">${kind}</button>`).join("")}</div>
      </div>`;
  const ready = draft.date && (homework || draft.subject);
  return `<form id="testForm" class="test-form" autocomplete="off" novalidate>
    ${head}
    <div class="panel-fields school-fields">
      <label class="field"><span class="field-label">Fach</span><select class="field-control" id="testSubject">${options}</select></label>
      <div class="field"><span class="field-label" id="testWhenLabel">${homework ? "Fällig" : "Wann"}</span>
        <div class="field-body" role="group" aria-labelledby="testWhenLabel">${pills}<button type="button" class="pill" data-slot="pick" aria-pressed="${custom}">${icon("calendar-days")}${customLabel}</button><input class="date-proxy" type="date" id="testDate" value="${esc(draft.date || "")}"${editing ? "" : ` min="${esc(time.iso)}"`} tabindex="-1" aria-hidden="true"></div>
      </div>
      ${kinds}
      <label class="field"><span class="field-label">${homework ? "Aufgabe" : "Thema"}</span><textarea class="field-control is-line" id="testTitle" rows="1" maxlength="${TEXT_LIMITS.title}" enterkeyhint="done" placeholder="${homework ? "z. B. Arbeitsblatt Nr. 3" : "z. B. Vektoren im Raum"}">${esc(draft.title)}</textarea>${countHtml("title", draft.title)}</label>
      <label class="field"><span class="field-label">${NOTE_HINTS[draft.kind] ? "Notiz" : "Lernstoff"}</span><textarea class="field-control" id="testDetail" rows="2" maxlength="${TEXT_LIMITS.detail}" placeholder="${NOTE_HINTS[draft.kind] || "z. B. Seiten, Themen, Hilfsmittel"}">${esc(draft.detail || "")}</textarea>${countHtml("detail", draft.detail || "")}</label>
    </div>
    <div class="panel-actions">${editing ? `<button type="button" class="btn btn-quiet panel-delete" data-delete-item="${esc(draft.id)}">${icon("trash-2")}Löschen</button>` : ""}<button type="button" class="btn btn-quiet" data-panel-close>Abbrechen</button><button type="submit" class="btn btn-primary" id="testSave"${ready ? "" : " disabled"}>${editing ? "Speichern" : "Eintragen"}</button></div>
  </form>`;
}

function renderPanel() {
  const panel = $("schoolPanel");
  const selection = state.selection;
  if (!selection) return;
  keepFocus(panel, () => {
    if (selection.type === "lesson") {
      const lesson = lessonAt(selection.iso, selection.block);
      panel.innerHTML = lesson ? subjectPanelHtml(lesson.subject, lesson) : subjectPanelHtml(selection.subject || activeSubjectKeys()[0]);
    } else if (selection.type === "subject") {
      panel.innerHTML = subjectPanelHtml(selection.key);
    } else if (selection.type === "grades") {
      panel.innerHTML = gradesPanelHtml();
    } else if (selection.type === "test" && state.draft) {
      panel.innerHTML = testFormHtml();
    } else if (selection.type === "item") {
      const item = state.items.find((entry) => entry.id === selection.item);
      panel.innerHTML = item ? `${panelHead(item.kind)}${itemBox(item, clockState())}` : "";
    }
    fitNotes();
  });
  panel.setAttribute("aria-labelledby", "panelTitle");
}

function growBars() {
  if (!travels()) return;
  document.querySelectorAll("#schoolPanel .gb-track i").forEach((bar, index) => {
    bar.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(var(--w))" }], { duration: 520, delay: 60 + index * 26, easing: token("--ease-out"), fill: "backwards" });
  });
}

function openPanel(selection, { trigger = null, form = false } = {}) {
  if (selection.type === "subject" && !activeKey(selection.key)) return;
  const panel = $("schoolPanel");
  const opening = !state.selection;
  const same = !opening && state.selection.type === selection.type && JSON.stringify(state.selection) === JSON.stringify(selection);
  state.selection = selection;
  state.gradeForm = form;
  if (trigger && !panel.contains(trigger)) state.returnTo = focusKeyOf(trigger);
  renderPanel();
  panel.hidden = false;
  fitNotes();
  $("schoolPage").classList.add("has-panel");
  markSelection();
  if (opening && animates()) {
    const sheet = narrow.matches;
    panel.getAnimations().forEach((animation) => animation.cancel());
    panel.animate(
      travels() ? [{ opacity: 0, transform: sheet ? "translateY(28px)" : "translateX(12px)" }, { opacity: 1, transform: "none" }] : [{ opacity: 0 }, { opacity: 1 }],
      { duration: sheet ? ms("--dur-sheet-in") || 380 : 240, easing: token(sheet ? "--ease-drawer" : "--ease-out") },
    );
  } else if (!same && animates()) {
    panel.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 180, easing: token("--ease-out") });
  }
  if (selection.type === "grades" && !same) growBars();
  if (narrow.matches && opening) panel.scrollTop = 0;
}

function closePanel({ refocus = false } = {}) {
  if (!state.selection) return;
  const panel = $("schoolPanel");
  const back = state.returnTo;
  state.selection = null;
  state.draft = null;
  state.gradeForm = false;
  const finish = () => {
    if (state.selection) return;
    panel.hidden = true;
    panel.replaceChildren();
    $("schoolPage").classList.remove("has-panel");
  };
  markSelection();
  if (narrow.matches && animates()) {
    panel.getAnimations().forEach((animation) => animation.cancel());
    const out = panel.animate(
      travels() ? [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(24px)" }] : [{ opacity: 1 }, { opacity: 0 }],
      { duration: ms("--dur-sheet-out") || 200, easing: "ease-in", fill: "forwards" },
    );
    out.finished.then(() => {
      finish();
      out.cancel();
    }, finish);
  } else {
    finish();
  }
  if (refocus && back) document.querySelector(back)?.focus({ preventScroll: false });
}

function openLesson(iso, block, trigger) {
  const lesson = lessonAt(iso, block);
  if (!lesson) return;
  if (isSelectedCell(iso, block) && trigger?.closest?.("#timetable")) {
    closePanel();
    return;
  }
  const index = abWeeks() ? weekIndexOf(iso) : null;
  openPanel({ type: "lesson", iso, block }, { trigger });
  if (index != null && index !== state.week) {
    const direction = index > state.week ? 1 : -1;
    state.week = index;
    renderWeekSwitch();
    swapBoard(direction, () => {
      renderBoard();
      scrollToToday();
      revealCell(iso, block);
    });
    return;
  }
  revealCell(iso, block);
}

function revealCell(iso, block) {
  const node = document.querySelector(`#timetable .lesson[data-iso="${iso}"][data-block="${block}"]`);
  if (!node) return;
  if (compact.matches) node.scrollIntoView({ block: "nearest", inline: "center", behavior: travels() ? "smooth" : "auto" });
}

function openItem(id, trigger) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  if (!item.subject || !activeKey(item.subject)) {
    if (changeable(item)) openEditForm(id, trigger);
    else openPanel({ type: "item", item: id }, { trigger });
    return;
  }
  const block = itemBlock(item);
  if (block && lessonAt(item.date, block)) {
    openLesson(item.date, block, trigger);
    if (state.selection) state.selection.item = id;
    markSelection();
    return;
  }
  openPanel({ type: "subject", key: item.subject, item: id }, { trigger });
  markSelection();
}

function defaultSubject() {
  const time = clockState();
  const current = currentLesson(time);
  if (current) return current.subject;
  const earlier = lessonsOn(time.date).filter((lesson) => !lesson.cancelled && lesson.endMin <= time.min);
  if (earlier.length) return earlier[earlier.length - 1].subject;
  return upcoming(time)[0]?.subject || activeSubjectKeys()[0];
}

function openTestForm(key, trigger, kind = "Test") {
  const begun = state.selection?.type === "test" && state.draft && !state.draft.id ? state.draft : null;
  if (begun && !key && begun.kind !== kind) {
    updateDraft({ kind });
    $("schoolPanel").querySelector('[data-kind][aria-pressed="true"]')?.focus({ preventScroll: true });
    return;
  }
  state.draft = { subject: key || defaultSubject(), date: null, block: null, kind, title: "", detail: "" };
  openPanel({ type: "test" }, { trigger });
  requestAnimationFrame(() => $("testSubject")?.focus({ preventScroll: true }));
}

function openEditForm(id, trigger) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item || !changeable(item)) return;
  state.draft = { id, subject: item.subject || "", date: item.date, block: itemBlock(item), kind: item.kind, title: item.title, detail: item.detail || "" };
  openPanel({ type: "test", item: id }, { trigger });
  requestAnimationFrame(() => $("testTitle")?.focus({ preventScroll: true }));
}

function updateDraft(changes) {
  Object.assign(state.draft, changes);
  renderPanel();
  markSelection();
}

function flashRow(id) {
  const row = document.querySelector(`[data-row="${CSS.escape(id)}"]`);
  if (!row) return;
  row.classList.remove("is-flash");
  void row.offsetWidth;
  row.classList.add("is-flash");
}

function popCell(iso, block) {
  const node = document.querySelector(`#timetable .lesson[data-iso="${iso}"][data-block="${block}"] .lesson-flag`);
  if (!node || !travels()) return;
  node.animate([{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "none" }], { duration: ms("--spring-tactile-dur") || 340, easing: token("--spring-tactile"), fill: "backwards" });
}

function showItem(item) {
  const block = itemBlock(item);
  if (!item.subject || !activeKey(item.subject)) openPanel({ type: "item", item: item.id });
  else if (block && lessonAt(item.date, block)) openPanel({ type: "lesson", iso: item.date, block, item: item.id });
  else openPanel({ type: "subject", key: item.subject, item: item.id });
  markSelection();
  flashRow(item.id);
}

function saveTest() {
  const draft = state.draft;
  const homework = !!draft && isHomework(draft);
  if (!draft?.date || (!homework && !draft.subject)) return;
  const title = draft.title.trim() || (homework ? "Hausaufgabe" : `${draft.kind} in ${subject(draft.subject).label}`);
  const detail = (draft.detail || "").trim();
  if (draft.id) {
    updateItem(draft, title, detail);
    return;
  }
  const item = { id: `new-${Date.now()}`, kind: draft.kind, title, subject: draft.subject, date: draft.date, detail, status: "offen" };
  if (draft.block) item.block = draft.block;
  state.items.push(item);
  deadlineApi.create(item);
  const index = abWeeks() ? weekIndexOf(item.date) : null;
  if (index != null) state.week = index;
  renderWeekSwitch();
  renderAll();
  state.draft = null;
  showItem(item);
  if (item.block) popCell(item.date, item.block);
  $("panelTitle")?.focus({ preventScroll: true });
  toast(`Eingetragen: ${esc(item.kind)} ${esc(subject(item.subject).label)}, ${esc(shortDate(parseDate(item.date)))}`, {
    icon: FLAG_ICONS[item.kind],
    action: { label: "Rückgängig", undo: true, run: () => removeItem(item.id) },
  });
}

function updateItem(draft, title, detail) {
  const index = state.items.findIndex((entry) => entry.id === draft.id);
  if (index < 0) return;
  const item = state.items[index];
  if (remote(item)) return;
  const changes = { title, subject: draft.subject || null, date: draft.date, detail };
  state.draft = null;
  if (draft.kind !== item.kind) {
    const moved = { ...item, ...changes, id: `new-${Date.now()}`, kind: draft.kind, status: "offen" };
    if (draft.block) moved.block = draft.block;
    else delete moved.block;
    const swap = (from, to) => {
      const at = state.items.findIndex((entry) => entry.id === from.id);
      if (at < 0) return false;
      state.items.splice(at, 1, to);
      deadlineApi.remove(from.id);
      deadlineApi.create(to);
      renderAll();
      return true;
    };
    swap(item, moved);
    showItem(moved);
    $("panelTitle")?.focus({ preventScroll: true });
    toast(`Gespeichert: ${esc(moved.kind)} „${esc(moved.title)}“`, {
      icon: "check",
      action: { label: "Rückgängig", undo: true, run: () => {
        const back = { ...item, id: `new-${Date.now()}` };
        if (swap(moved, back) && state.selection?.type !== "test") showItem(back);
      } },
    });
    return;
  }
  const before = { title: item.title, subject: item.subject || null, date: item.date, detail: item.detail || "" };
  const apply = (values) => {
    Object.assign(item, values);
    item.block = itemBlock({ ...item, block: null }) || undefined;
    deadlineApi.update(item.id, values);
    renderAll();
  };
  apply(changes);
  showItem(item);
  $("panelTitle")?.focus({ preventScroll: true });
  toast(`Gespeichert: ${esc(item.kind)} „${esc(item.title)}“`, {
    icon: "check",
    action: { label: "Rückgängig", undo: true, run: () => {
      apply(before);
      if (state.selection?.type !== "test") showItem(item);
    } },
  });
}

function removeItem(id) {
  const index = state.items.findIndex((item) => item.id === id);
  if (index < 0) return;
  state.items.splice(index, 1);
  deadlineApi.remove(id);
  if (state.selection?.type === "item" && state.selection.item === id) closePanel({ refocus: true });
  if (state.selection?.item === id) delete state.selection.item;
  renderAll();
  if (state.selection) renderPanel();
}

function deleteItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  if (state.selection?.type === "test" && state.draft?.id === id) closePanel({ refocus: true });
  removeItem(id);
  if (document.activeElement === document.body) (document.querySelector("#overview [data-open-item]") || $("newTest"))?.focus({ preventScroll: true });
  toast(`Gelöscht: ${esc(item.kind)} „${esc(item.title)}“`, {
    icon: "trash-2",
    action: { label: "Rückgängig", undo: true, run: () => {
      const back = remote(item) ? item : { ...item, id: `new-${Date.now()}` };
      state.items.push(back);
      if (remote(item)) {
        deadlineApi.update(item.id, { hidden: false, status: item.status === "abgegeben" ? "abgegeben" : "offen" });
      } else {
        deadlineApi.create(back);
        if (back.status === "abgegeben") deadlineApi.update(back.id, { status: "abgegeben" });
      }
      renderAll();
      if (state.selection) renderPanel();
      flashRow(back.id);
    } },
  });
}

function completeItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  const mark = (status) => {
    item.status = status;
    deadlineApi.update(id, { status });
    renderAll();
    if (state.selection) renderPanel();
  };
  mark("abgegeben");
  toast(`Erledigt: „${esc(item.title)}“`, { icon: "check", action: { label: "Rückgängig", undo: true, run: () => mark("offen") } });
}

function deleteGrade(id) {
  const index = state.grades.findIndex((grade) => grade.id === id);
  if (index < 0) return;
  const grade = state.grades[index];
  const repaint = () => {
    if (state.selection) renderPanel();
    renderOverview();
  };
  state.grades.splice(index, 1);
  gradeApi.remove(id);
  repaint();
  toast(`Note gelöscht: ${plural(grade.points, "Punkt", "Punkte")} in ${esc(subject(grade.subject).label)}`, {
    icon: "trash-2",
    action: { label: "Rückgängig", undo: true, run: () => {
      const back = { ...grade, id: `g-new-${Date.now()}` };
      state.grades.push(back);
      gradeApi.create(back);
      repaint();
    } },
  });
}

function saveGrade(form) {
  const key = form.elements.subject?.value || currentPanelSubject();
  if (!key || !data.subjects[key]) return;
  const points = Number(form.elements.points.value);
  const kind = form.elements.kind.value;
  const title = form.elements.title.value.trim();
  const grade = { id: `g-new-${Date.now()}`, subject: key, points, type: kind, semester: SEMESTER, date: clockState().iso, title: title || GRADE_TYPES[kind] };
  state.grades.push(grade);
  gradeApi.create(grade);
  state.gradeForm = false;
  renderPanel();
  renderOverview();
  const row = document.querySelector("#schoolPanel .grade-row") || document.querySelector(`#schoolPanel .grade-bar[data-open-subject="${CSS.escape(key)}"]`);
  if (row && travels()) row.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: token("--ease-out") });
  document.querySelector("#schoolPanel [data-grade-form]")?.focus({ preventScroll: true });
  toast(`${plural(points, "Punkt", "Punkte")} in ${esc(subject(key).label)} eingetragen`, {
    icon: "check",
    action: { label: "Rückgängig", undo: true, run: () => {
      state.grades = state.grades.filter((item) => item.id !== grade.id);
      gradeApi.remove(grade.id);
      if (state.selection) renderPanel();
      renderOverview();
    } },
  });
}

function currentPanelSubject() {
  const selection = state.selection;
  if (!selection) return null;
  if (selection.type === "subject") return selection.key;
  if (selection.type === "lesson") return lessonAt(selection.iso, selection.block)?.subject || null;
  return null;
}

function bindPanel() {
  const panel = $("schoolPanel");
  panel.addEventListener("click", (event) => {
    const target = event.target;
    if (target.closest("[data-panel-close]")) {
      closePanel({ refocus: true });
      return;
    }
    const editButton = target.closest("[data-edit-item]");
    if (editButton) {
      openEditForm(editButton.dataset.editItem, editButton);
      return;
    }
    const deleteButton = target.closest("[data-delete-item]");
    if (deleteButton) {
      deleteItem(deleteButton.dataset.deleteItem);
      return;
    }
    const doneButton = target.closest("[data-done-item]");
    if (doneButton) {
      completeItem(doneButton.dataset.doneItem);
      return;
    }
    const moreButton = target.closest("[data-note-more]");
    if (moreButton) {
      const id = moreButton.dataset.noteMore;
      if (!state.openNotes.delete(id)) state.openNotes.add(id);
      renderPanel();
      return;
    }
    const gradeButton = target.closest("[data-delete-grade]");
    if (gradeButton) {
      deleteGrade(gradeButton.dataset.deleteGrade);
      return;
    }
    const lessonButton = target.closest("[data-open-lesson]");
    if (lessonButton) {
      const [iso, block] = lessonButton.dataset.openLesson.split(":");
      openLesson(iso, Number(block), lessonButton);
      return;
    }
    const itemButton = target.closest("[data-open-item]");
    if (itemButton) {
      openItem(itemButton.dataset.openItem, itemButton);
      return;
    }
    const subjectButton = target.closest("[data-open-subject]");
    if (subjectButton) {
      openPanel({ type: "subject", key: subjectButton.dataset.openSubject }, { trigger: subjectButton });
      return;
    }
    const system = target.closest("[data-calc-system]");
    if (system) {
      switchCalcSystem(system.dataset.calcSystem);
      renderPanel();
      return;
    }
    const tool = target.closest("[data-calc-tool]");
    if (tool) {
      state.calc.tool = tool.dataset.calcTool;
      renderPanel();
      return;
    }
    const calcFor = target.closest("[data-calc-for]");
    if (calcFor) {
      openCalculator(calcFor.dataset.calcFor, calcFor);
      return;
    }
    const semester = target.closest("[data-semester]");
    if (semester) {
      state.gradeSemester = semester.dataset.semester;
      renderPanel();
      growBars();
      return;
    }
    if (target.closest("[data-grade-form]")) {
      state.gradeForm = true;
      renderPanel();
      ($("gradeSubject") || $("gradePoints"))?.focus();
      return;
    }
    if (target.closest("[data-grade-cancel]")) {
      state.gradeForm = false;
      renderPanel();
      panel.querySelector("[data-grade-form]")?.focus();
      return;
    }
    const newTest = target.closest("[data-new-test]");
    if (newTest) {
      openTestForm(newTest.dataset.newTest || null, newTest);
      return;
    }
    const slot = target.closest("[data-slot]");
    if (slot && state.draft) {
      if (slot.dataset.slot === "pick") {
        const input = $("testDate");
        try { input.showPicker(); } catch { input.focus(); }
        return;
      }
      const [iso, block] = slot.dataset.slot.split(":");
      updateDraft({ date: iso, block: Number(block) });
      return;
    }
    const kind = target.closest("[data-kind]");
    if (kind && state.draft) updateDraft({ kind: kind.dataset.kind });
  });
  panel.addEventListener("change", (event) => {
    if (event.target.dataset.calc === "subject") {
      prefillCalc(event.target.value);
      renderPanel();
      return;
    }
    if (event.target.id === "testSubject" && state.draft) {
      const key = event.target.value;
      if (state.draft.id) updateDraft({ subject: key, block: lessonsOn(parseDate(state.draft.date)).find((entry) => entry.subject === key)?.block || null });
      else updateDraft({ subject: key, date: null, block: null });
    }
    if (event.target.id === "testDate" && state.draft && event.target.value) {
      const lesson = lessonsOn(parseDate(event.target.value)).find((entry) => entry.subject === state.draft.subject);
      updateDraft({ date: event.target.value, block: lesson?.block || null });
      panel.querySelector('[data-slot="pick"]')?.focus();
    }
  });
  panel.addEventListener("beforeinput", (event) => {
    if (event.target.id !== "testTitle" || event.isComposing || !["insertLineBreak", "insertParagraph"].includes(event.inputType)) return;
    event.preventDefault();
    event.target.form.requestSubmit();
  });
  panel.addEventListener("input", (event) => {
    if (event.target.id === "testTitle" && state.draft) {
      keepOneLine(event.target);
      state.draft.title = event.target.value;
      showCount("title", state.draft.title);
    }
    if (event.target.id === "testDetail" && state.draft) {
      state.draft.detail = event.target.value;
      showCount("detail", state.draft.detail);
    }
    const field = event.target.dataset.calc;
    if (!field || field === "subject") return;
    if (field === "points") {
      state.calc.points = Number(event.target.value);
      event.target.setAttribute("aria-valuetext", `${state.calc.points} Punkte`);
    } else if (field === "mark") {
      state.calc.mark = Number(event.target.value);
      event.target.setAttribute("aria-valuetext", `Note ${decimal(state.calc.mark)}`);
    } else if (field.startsWith("exam-")) {
      state.calc.exams[Number(field.slice(5))] = event.target.value;
    } else {
      state.calc[field] = event.target.value;
    }
    updateCalcResult();
  });
  panel.addEventListener("toggle", (event) => {
    const box = event.target;
    if (!box.matches?.("details.calc")) return;
    if (box.id === "calcBox") state.calc.open = box.open;
    else state.calc.table = box.open;
    if (box.open && travels()) {
      const body = box.querySelector(".calc-body, .scale");
      body?.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: token("--ease-out") });
    }
    if (box.open) revealInPanel(box);
  }, true);
  panel.addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.target.id === "testForm") saveTest();
    if (event.target.id === "gradeForm") saveGrade(event.target);
  });
}

function onBoardClick(event) {
  const lesson = event.target.closest(".lesson");
  if (!lesson) return;
  const iso = lesson.dataset.iso;
  const block = Number(lesson.dataset.block);
  state.focusCell = lesson.dataset.cell;
  $("timetable").querySelectorAll("[data-cell]").forEach((node) => (node.tabIndex = -1));
  lesson.tabIndex = 0;
  if (state.selection?.type === "test" && state.draft) {
    const entry = lessonAt(iso, block);
    if (entry && !entry.cancelled && phaseOf(entry, clockState()) === "future") {
      updateDraft({ subject: entry.subject, date: iso, block });
      const chosen = $("schoolPanel").querySelector('[data-slot][aria-pressed="true"]');
      if (chosen && travels()) chosen.animate([{ transform: "scale(0.92)" }, { transform: "none" }], { duration: ms("--spring-tactile-dur") || 340, easing: token("--spring-tactile") });
    } else {
      toast("Wähle eine kommende Stunde.", { icon: "info", duration: 3000 });
    }
    return;
  }
  openLesson(iso, block, lesson);
}

function bind() {
  const table = $("timetable");
  table.addEventListener("click", onBoardClick);
  table.addEventListener("keydown", onGridKey);
  table.addEventListener("focusin", (event) => {
    const cell = event.target.closest?.("[data-cell]");
    if (!cell) return;
    table.querySelectorAll("[data-cell]").forEach((node) => {
      if (node !== cell) node.tabIndex = -1;
    });
    cell.tabIndex = 0;
    state.focusCell = cell.dataset.cell;
  });
  $("weekSwitch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-week]");
    if (button) setWeek(Number(button.dataset.week));
  });
  $("newTest").addEventListener("click", (event) => openTestForm(null, event.currentTarget));
  $("newTalk").addEventListener("click", (event) => openTestForm(null, event.currentTarget, "Vortrag"));
  $("newGrade").addEventListener("click", (event) => openGradeForm(event.currentTarget));
  const lists = $("schoolLists");
  lists.addEventListener("click", (event) => {
    if (event.target.closest("#writtenToggle")) {
      state.writtenOpen = !state.writtenOpen;
      renderTests();
      if (state.writtenOpen && travels()) [...$("writtenList").children].forEach((node, index) => node.animate([{ opacity: 0, translate: "0 -4px" }, { opacity: 1, translate: "0 0" }], { duration: 240, delay: index * 30, easing: token("--ease-out"), fill: "backwards" }));
      return;
    }
    const item = event.target.closest("[data-open-item]");
    if (item) {
      openItem(item.dataset.openItem, item);
      return;
    }
    const subjectButton = event.target.closest("[data-open-subject]");
    if (subjectButton) {
      openPanel({ type: "subject", key: subjectButton.dataset.openSubject }, { trigger: subjectButton });
      return;
    }
    const newTest = event.target.closest("[data-new-test]");
    if (newTest) openTestForm(null, newTest);
  });
  $("overview").addEventListener("click", (event) => {
    if (event.target.closest("#vplanRefresh")) {
      startVplan({ manual: true });
      return;
    }
    const planButton = event.target.closest("[data-plan-open]");
    if (planButton) {
      openPlan(Number(planButton.dataset.planOpen));
      return;
    }
    const change = event.target.closest("[data-open-lesson]");
    if (change) {
      const [iso, block] = change.dataset.openLesson.split(":");
      openLesson(iso, Number(block), change);
      return;
    }
    const item = event.target.closest("[data-open-item]");
    if (item) {
      openItem(item.dataset.openItem, item);
      return;
    }
    const grades = event.target.closest("[data-open-grades]");
    if (grades) openGrades(grades);
  });
  bindPanel();
  $("planViewer")?.addEventListener("close", () => document.querySelector("#overview [data-plan-open]")?.focus({ preventScroll: true }));
  $("planViewer")?.addEventListener("click", (event) => {
    const dialog = event.currentTarget;
    const tab = event.target.closest("[data-plan-page]");
    if (tab) {
      state.vplan.page = Number(tab.dataset.planPage);
      state.vplan.zoomed = false;
      renderPlanViewer();
      dialog.querySelector('[aria-pressed="true"]')?.focus();
    } else if (event.target.closest(".plan-sheet")) {
      zoomPlan(event);
    } else if (event.target === dialog) {
      dialog.close();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.selection || overlayOpen()) return;
    if (typing(event.target) && event.target.closest("#gradeForm")) {
      state.gradeForm = false;
      renderPanel();
      $("schoolPanel").querySelector("[data-grade-form]")?.focus();
      return;
    }
    closePanel({ refocus: true });
  });
  document.addEventListener("pointerdown", (event) => {
    if (!state.selection || !narrow.matches) return;
    const target = event.target;
    if (target.closest("#schoolPanel, .lesson, #weekSwitch, [data-open-item], [data-open-lesson], [data-open-subject], [data-open-grades], [data-new-test], #newTest, #newTalk, #newGrade, .toast, [popover], dialog, .tabbar, .topbar, .variant-switch")) return;
    closePanel();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshTime();
  });
  compact.addEventListener("change", scrollToToday);
  $("boardScroll").addEventListener("scroll", markScrolled, { passive: true });
  if ("ResizeObserver" in window) new ResizeObserver(scheduleFit).observe($("boardScroll"));
  document.fonts?.ready.then(fitLabels);
}

const PLAN_FRESH = 15 * 60 * 1000;

async function fetchPlan(fresh) {
  const response = await fetch(`/api/ui/vplan${fresh ? "?frisch=1" : ""}`, { credentials: "same-origin", cache: "no-store" });
  if (response.status === 404) return null;
  const body = await response.json();
  if (!response.ok || body.success === false) throw new Error(body.error || "");
  return body;
}

function applyPlan(body) {
  const plan = state.vplan;
  plan.files = body.files || [];
  plan.stand = body.cachedAt || null;
  plan.problem = body.problem || null;
  plan.message = body.message || "";
  plan.loaded = true;
}

async function startVplan({ manual = false } = {}) {
  const plan = state.vplan;
  if (!data.status?.iserv || plan.loading || flags.empty || (data.changes || []).length || (page.changes || []).length) {
    if (manual && !plan.loading) location.reload();
    return;
  }
  plan.loading = true;
  renderOverview();
  const pages = () => plan.files.map((file) => file.url).join(" ");
  let shown = pages();
  try {
    let body = manual ? null : await fetchPlan(false);
    if (!manual && body === null) {
      plan.supported = false;
      return;
    }
    if (body) {
      applyPlan(body);
      renderOverview();
      shown = pages();
    }
    const age = body?.cachedAt ? Date.now() - new Date(body.cachedAt).getTime() : Infinity;
    if (manual || !body.files.length || !(age < PLAN_FRESH)) {
      body = await fetchPlan(true);
      if (body === null) plan.supported = false;
      else applyPlan(body);
    }
  } catch {
    plan.problem = "offline";
    plan.message = "IServ ist gerade nicht erreichbar.";
  } finally {
    plan.loading = false;
    plan.loaded = true;
    renderOverview();
    const viewer = $("planViewer");
    if (viewer?.open && !plan.files.length) viewer.close();
    else if (viewer?.open && pages() !== shown) renderPlanViewer();
    else if (viewer?.open) $("planViewerMeta").textContent = planStand();
  }
}

function changedKeys() {
  if (!flags.change || !state.vplan.loaded) return [];
  return changeDays().flatMap((day) => lessonsOn(day).filter((lesson) => lesson.changed).map((lesson) => cellKey(lesson.iso, lesson.block)));
}

function timeSignature() {
  const time = clockState();
  const current = currentLesson(time);
  const next = upcoming(time)[0];
  return [time.iso, current ? cellKey(current.iso, current.block) : "", next ? cellKey(next.iso, next.block) : "", isoDate(baseMonday())].join("|");
}

function refreshTime() {
  const signature = timeSignature();
  if (signature !== state.signature) {
    state.signature = signature;
    renderHead();
    renderWeekSwitch();
    renderBoard();
    renderOverview();
    renderLists();
    if (state.selection && state.selection.type !== "test" && !state.gradeForm && !$("schoolPanel").contains(document.activeElement)) renderPanel();
    return;
  }
  const time = clockState();
  const cell = document.querySelector("#timetable .lesson.is-now");
  const lesson = cell && lessonAt(cell.dataset.iso, Number(cell.dataset.block));
  if (!lesson) return;
  cell.style.setProperty("--p", ((time.min - lesson.startMin) / (lesson.endMin - lesson.startMin)).toFixed(4));
  const remaining = document.querySelector("#schoolPanel [data-remaining]");
  if (remaining) remaining.textContent = String(lesson.endMin - time.min);
}

function scheduleTick() {
  if (pinnedTime()) return;
  clearTimeout(state.tick);
  const date = new Date();
  const wait = (60 - date.getSeconds()) * 1000 - date.getMilliseconds() + 40;
  state.tick = setTimeout(() => {
    if (!document.hidden) refreshTime();
    scheduleTick();
  }, wait);
}

function renderAll() {
  renderHead();
  renderBoard();
  renderOverview();
  renderLists();
}

function registerPalette() {
  registerSearch(() => [
    ...activeSubjectKeys().map((key) => ({
      group: "Fächer",
      label: subject(key).name,
      icon: "graduation-cap",
      keywords: `${subject(key).label} ${teacherOf(key)}`,
      run: () => openPanel({ type: "subject", key }),
    })),
    ...state.items.filter(isAssessment).filter((item) => item.date >= clockState().iso).map((item) => ({
      group: "Tests, Klausuren und Vorträge",
      label: `${item.kind} ${subject(item.subject).label}: ${item.title}`,
      icon: FLAG_ICONS[item.kind],
      hint: shortDate(parseDate(item.date)),
      run: () => openItem(item.id),
    })),
    { group: "Schule", label: "Test eintragen", icon: "plus", keywords: "klausur", run: () => openTestForm(null) },
    { group: "Schule", label: "Vortrag eintragen", icon: "plus", keywords: "referat präsentation", run: () => openTestForm(null, null, "Vortrag") },
    { group: "Schule", label: "Note eintragen", icon: "plus", keywords: "punkte bewertung", run: () => openGradeForm() },
    { group: "Schule", label: "Noten ansehen", icon: "graduation-cap", keywords: "schnitt punkte", run: () => openGrades() },
    { group: "Schule", label: "Notenrechner", icon: "graduation-cap", keywords: "zielnote fachnote punkte umrechnen", run: () => openCalculator(state.calc.subject || scoredKeys()[0] || "") },
  ]);
}

function bindNotes() {
  window.addEventListener("app:note", (event) => {
    const detail = event.detail;
    if (detail.type !== "homework") return;
    event.preventDefault();
    const item = { id: `hw-new-${Date.now()}`, kind: "Hausaufgabe", title: detail.title, subject: detail.subject || null, date: detail.date || homeworkDate(detail.subject), detail: detail.details || "", status: "offen" };
    state.items.push(item);
    deadlineApi.create(item);
    renderAll();
    flashRow(item.id);
    toast(`Hausaufgabe für ${esc(shortDate(parseDate(item.date)))} angelegt: „${esc(item.title)}“`, {
      icon: "check",
      action: { label: "Rückgängig", undo: true, run: () => removeItem(item.id) },
    });
  });
}

export function init() {
  if (!$("schoolPage") || !data) return;
  state.items = flags.empty ? [] : [...(data.deadlines || []), ...(page.exams || [])].filter(visibleItem).map((item) => ({ ...item }));
  state.grades = flags.empty ? [] : (page.grades || []).map((grade) => ({ ...grade }));
  state.vplan.loaded = !!((data.changes || []).length || (page.changes || []).length);
  state.signature = timeSignature();
  const edit = $("editTimetable");
  if (edit) edit.href = settingsHref();
  renderWeekSwitch();
  renderAll();
  bind();
  bindNotes();
  registerPalette();
  scrollToToday();
  growNow();
  openFromUrl();
  startVplan();
  scheduleTick();
}

function settingsHref() {
  const href = pageUrl("settings", "/hub/settings#stundenplan");
  return href.includes("#") ? href : `${href}#stundenplan`;
}

function openFromUrl() {
  const item = params.get("eintrag");
  const key = params.get("fach");
  if (item && state.items.some((entry) => entry.id === item)) openItem(item);
  else if (key && activeKey(key)) openPanel({ type: "subject", key });
}
