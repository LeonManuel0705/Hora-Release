// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
  data, esc, icon, luna, now, storage, planChange, LOCAL_KEYS, HUES, MAX_BLOCKS, schoolDefaults, applySchoolEdits, saveBlocks, abWeeks, abAnswered, abSettled,
  activeSubjectKeys, subject, hueVar, slug, teacherId, teacherLabel, periodWords, weekType, WEEKDAYS, WEEKDAYS_SHORT, MONTHS, isoWeek, hm, addDays, startOfDay, BRAND,
} from "./core.js";
import { animates, travels, token } from "./motion.js";
import { askPermission, readPrefs, switchRemindersOn } from "./reminders.js";
import { pageUrl } from "./shell.js";
import { tabReminderNote } from "./persistence.js";
import * as plan from "./setup-data.js";

const STEPS = [
  { id: "start" },
  { id: "school", label: "Schule" },
  { id: "times", label: "Zeiten" },
  { id: "weeks", label: "Wochen" },
  { id: "subjects", label: "Fächer" },
  { id: "details", label: "Lehrkräfte" },
  { id: "grid", label: "Stunden" },
  { id: "done" },
];
const COUNTED = STEPS.filter((step) => step.label);
const DAYS = [1, 2, 3, 4, 5];
const plural = (count, one, many) => `${count}\u00a0${count === 1 ? one : many}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const same = (one, other) => JSON.stringify(one ?? null) === JSON.stringify(other ?? null);
const listOf = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
const tidy = (text) => String(text || "").replace(/\s+/g, " ").trim();
const lower = (text) => String(text || "").toLocaleLowerCase("de");
const shareFlow = () => (typeof window.AppPlanShare?.importFlow === "function" ? window.AppPlanShare.importFlow : null);

const flow = { dialog: null, stage: null, step: 0, dirty: false, busy: false };

function savedPrefs() {
  const value = storage.get(LOCAL_KEYS.prefs);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readObject(key) {
  const value = storage.get(key);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const sortedBlocks = () => [...data.blocks].sort((a, b) => a.n - b.n);
const usedBlocks = () => Math.max(0, ...["A", "B"].flatMap((week) => DAYS.flatMap((dow) => (data.timetable[week]?.[String(dow)] || []).map((entry) => entry.block))));
const DEFAULT_TIMES = plan.blockTimes(plan.TEMPLATES[90]);
const sameTimes = (one, other) => one.length === other.length && one.every((block, index) => block.start === other[index].start && block.end === other[index].end);
const ownTimes = () => storage.get(LOCAL_KEYS.blocks) != null || !sameTimes(schoolDefaults?.blocks || [], DEFAULT_TIMES);

// On a weekend the question is about the coming week, the next one the plan is needed for.
function askedMonday() {
  const day = now().getDay();
  return day === 0 || day === 6 ? addDays(startOfDay(now()), day === 6 ? 2 : 1) : null;
}
const askedDay = () => askedMonday() || now();

function weekQuestion() {
  const monday = askedMonday();
  return monday ? `Ist die Woche ab Montag, dem ${monday.getDate()}.\u00a0${MONTHS[monday.getMonth()]}, eine A-Woche?` : `Ist diese Woche, KW\u00a0${isoWeek(now())}, eine A-Woche?`;
}

function pickOf(key) {
  const info = data.subjects[key];
  return { key, name: plan.plainName(info.label), short: info.short, hue: info.hue, type: info.type || "GK", teacher: info.teacher || "", room: info.room || "", existing: true };
}

function initial() {
  const prefs = savedPrefs();
  const grade = Number.isInteger(data.user?.grade) ? data.user.grade : Number.isInteger(prefs.school?.grade) ? prefs.school.grade : null;
  const blocks = sortedBlocks();
  const length = plan.templateOf(blocks);
  const keep = ownTimes() || usedBlocks() > 0;
  const template = length ? plan.TEMPLATES[length] : plan.TEMPLATES[45];
  const order = { LK: 0, GK: 1, SK: 2 };
  const picks = activeSubjectKeys().map(pickOf).sort((a, b) => (order[a.type] ?? 3) - (order[b.type] ?? 3) || a.name.localeCompare(b.name, "de"));
  return {
    state: data.user?.state || "",
    stateStatus: "",
    grade,
    times: keep ? "keep" : null,
    template: { length: template.length, start: blocks[0]?.start || "08:00", count: keep && length ? blocks.length : template.count, small: template.small, big: template.big },
    ab: abAnswered() || keep ? (abWeeks() ? "yes" : "no") : null,
    letter: (abAnswered() || keep) && abWeeks() ? weekType(askedDay()) : null,
    picks,
    week: "A",
    brush: picks[0]?.key || null,
    history: [],
    cursor: { row: 0, col: 0 },
  };
}

let model = null;

function shell() {
  const dialog = document.createElement("dialog");
  dialog.className = "setup";
  dialog.id = "setupDialog";
  dialog.setAttribute("aria-labelledby", "setupTitle");
  dialog.innerHTML = `<div class="setup-frame">
      <header class="setup-top">
        <div class="setup-progress" id="setupProgress"></div>
        <button class="icon-button setup-close" type="button" data-setup-close aria-label="Einrichtung schließen">${icon("x")}</button>
      </header>
      <div class="setup-stage" id="setupStage"></div>
      <footer class="setup-foot" id="setupFoot"></footer>
    </div>`;
  document.body.append(dialog);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("click", onClick);
  dialog.addEventListener("change", onChange);
  dialog.addEventListener("input", onInput);
  dialog.addEventListener("keydown", onKey);
  flow.stage = dialog.querySelector("#setupStage");
  return dialog;
}

export function open(options = {}) {
  flow.dialog ||= shell();
  if (flow.dialog.open) return;
  model = initial();
  flow.from = options.from || "";
  flow.dirty = false;
  flow.step = 0;
  render({ enter: true });
  flow.dialog.showModal();
  document.documentElement.classList.add("setup-open");
  if (travels()) flow.dialog.querySelector(".setup-frame").animate([{ opacity: 0, transform: "translateY(18px) scale(0.98)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: token("--spring-delight") || "ease-out" });
  focusFirst();
}

// Closing keeps what the open step holds, as Weiter would. Weeks only count once answered, times only once the start,
// the count or a break was changed, never for a length that was only tapped to look at it.
function commitOpenStep() {
  const id = current();
  if (id === "subjects" || id === "details") commitSubjects();
  else if (id === "weeks" && VIEWS.weeks.ready()) leaveStep(id);
  else if (id === "times" && model.timesEdited && VIEWS.times.ready()) leaveStep(id);
}

async function close({ to = "" } = {}) {
  if (!flow.dialog?.open) return;
  commitOpenStep();
  const leave = () => {
    flow.dialog.close();
    document.documentElement.classList.remove("setup-open");
  };
  if (to || flow.dirty) {
    flow.busy = true;
    paintFoot();
    await storage.settled();
    if (to) location.assign(to);
    else location.reload();
    return;
  }
  if (!animates()) {
    leave();
    return;
  }
  const frames = travels() ? [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(12px) scale(0.98)" }] : [{ opacity: 1 }, { opacity: 0 }];
  const fade = flow.dialog.querySelector(".setup-frame").animate(frames, { duration: 180, easing: "ease-in", fill: "forwards" });
  const done = () => {
    leave();
    fade.cancel();
  };
  fade.finished.then(done, done);
}

const current = () => STEPS[flow.step].id;

function go(delta) {
  const next = Math.max(0, Math.min(STEPS.length - 1, flow.step + delta));
  if (next === flow.step) return;
  if (delta > 0 && !leaveStep(current())) return;
  flow.step = next;
  render({ direction: Math.sign(delta) });
  focusFirst();
}

function focusFirst() {
  requestAnimationFrame(() => {
    const target = flow.stage.querySelector("[data-autofocus]") || flow.stage.querySelector("h2");
    target?.focus({ preventScroll: true });
  });
}

function paintProgress() {
  const host = flow.dialog.querySelector("#setupProgress");
  const index = COUNTED.findIndex((step) => step.id === current());
  host.hidden = index < 0;
  if (index < 0) return;
  host.innerHTML = `<ol class="setup-steps" aria-label="Schritt ${index + 1} von ${COUNTED.length}">${COUNTED.map((step, at) => `<li class="${at < index ? "is-past" : at === index ? "is-now" : ""}"${at === index ? ' aria-current="step"' : ""}><i aria-hidden="true"></i><span>${esc(step.label)}</span></li>`).join("")}</ol>`;
}

const FOCUS_KEYS = ["week", "copy-week", "undo", "count", "setup-next", "setup-back"];

// What identifies a control across a repaint: its data attribute, or else its id.
function focusKey(node) {
  if (!node?.getAttribute) return "";
  for (const name of FOCUS_KEYS) {
    const value = node.getAttribute(`data-${name}`);
    if (value !== null) return value ? `[data-${name}="${CSS.escape(value)}"]` : `[data-${name}]`;
  }
  return node.id ? `#${CSS.escape(node.id)}` : "";
}

const focusIn = (host) => (host?.contains(document.activeElement) ? focusKey(document.activeElement) : "");

function refocus(host, key, fallback) {
  if (!key) return;
  const found = host.querySelector(key);
  (found && !found.disabled ? found : fallback?.())?.focus({ preventScroll: true });
}

function paintFoot() {
  const foot = flow.dialog.querySelector("#setupFoot");
  const focused = focusIn(foot);
  const id = current();
  const step = VIEWS[id];
  const back = flow.step > 0 && id !== "done" ? `<button class="btn btn-quiet setup-back" type="button" data-setup-back>${icon("chevron-left")}Zurück</button>` : "";
  const ready = !step.ready || step.ready();
  const label = step.next ? step.next() : "Weiter";
  const hint = step.hint ? `<p class="setup-hint" id="setupHint">${step.hint()}</p>` : "";
  foot.innerHTML = `${back}${hint}<button class="btn btn-primary setup-next" type="button" data-setup-next${ready && !flow.busy ? "" : " disabled"}${hint ? ' aria-describedby="setupHint"' : ""}>${esc(label)}${id === "done" ? "" : icon("chevron-right")}</button>`;
  refocus(foot, focused);
}

function render({ direction = 0, enter = false } = {}) {
  const id = current();
  const view = VIEWS[id];
  const paint = () => {
    flow.stage.innerHTML = `<section class="setup-step is-${id}" data-step="${id}">${view.html()}</section>`;
    flow.stage.scrollTop = 0;
    view.after?.();
    paintProgress();
    paintFoot();
  };
  if (enter || !direction || !travels()) {
    paint();
    if (!enter && animates()) flow.stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
    return;
  }
  paint();
  flow.stage.firstElementChild.animate([{ opacity: 0, transform: `translateX(${direction * 28}px)` }, { opacity: 1, transform: "none" }], { duration: 380, easing: token("--spring-critical") || "ease-out" });
}

function bubble(text, sub = "", { size = 64, kind = "ruhe" } = {}) {
  return `<div class="setup-guide">${luna(kind, size)}<div class="setup-say"><h2 class="setup-title" id="setupTitle" tabindex="-1">${text}</h2>${sub ? `<p class="setup-sub">${sub}</p>` : ""}</div></div>`;
}

const radio = (name, value, checked, body, cls = "") => `<label class="setup-option${cls ? ` ${cls}` : ""}"><input type="radio" name="${name}" value="${esc(value)}"${checked ? " checked" : ""}>${body}${icon("check", "setup-tick")}</label>`;

function stateNote() {
  const name = plan.STATES.find(([code]) => code === model.state)?.[1] || "";
  return {
    loading: `Lade Ferien und Feiertage für ${name}.`,
    done: `Ferien und Feiertage für ${name} sind im Kalender.`,
    failed: `Gespeichert. Die Ferien ließen sich gerade nicht laden, das geht später unter Einstellungen, Schule.`,
  }[model.stateStatus] || "Für Ferien und Feiertage im Kalender.";
}

function gradeNote() {
  return model.grade ? `Bewertung ${plan.scaleText(model.grade)}.` : "Daran hängt, ob du Noten oder Punkte bekommst.";
}

const motif = (count) => `<span class="setup-motif" aria-hidden="true">${Array.from({ length: count }, () => "<i></i>").join("")}</span>`;

function timesCount() {
  const template = plan.TEMPLATES[model.template.length];
  return { least: Math.max(1, usedBlocks()), most: Math.min(MAX_BLOCKS, template.most) };
}

function draftBlocks() {
  if (model.times === "keep") return sortedBlocks();
  return plan.blockTimes(model.template);
}

function timelineHtml(blocks) {
  if (!blocks.length) return "";
  const from = plan.minutesOfClock(blocks[0].start);
  const to = plan.minutesOfClock(blocks.at(-1).end);
  const span = Math.max(1, to - from);
  return `<div class="setup-timeline" aria-hidden="true">${blocks.map((block) => {
    const left = ((plan.minutesOfClock(block.start) - from) / span) * 100;
    const width = ((plan.minutesOfClock(block.end) - plan.minutesOfClock(block.start)) / span) * 100;
    return `<i style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"><span>${block.n}</span></i>`;
  }).join("")}</div>`;
}

function timesNote(blocks) {
  if (!blocks.length) return "";
  const words = periodWords(blocks);
  const what = plural(blocks.length, words.one, words.many);
  return `${what} von ${hm(blocks[0].start)} bis ${hm(blocks.at(-1).end)}. Einzelne Zeiten änderst du später unter Einstellungen, Stundenraster.`;
}

const pauses = (id, value, options, label) => `<label class="setup-field is-small"><span class="setup-label">${label}</span><select class="field-control" id="${id}">${options.map((minutes) => `<option value="${minutes}"${minutes === value ? " selected" : ""}>${minutes ? `${minutes}\u00a0Min.` : "keine"}</option>`).join("")}</select></label>`;

function timesDetail() {
  if (!model.times || model.times === "keep") return "";
  const { least, most } = timesCount();
  const word = model.template.length === 90 ? "Blöcke am Tag" : "Stunden am Tag";
  return `<div class="setup-times">
      <label class="setup-field is-small"><span class="setup-label">Erste Stunde</span><input class="field-control" type="time" id="setupStart" value="${esc(model.template.start)}" required></label>
      <div class="setup-field is-small"><span class="setup-label" id="setupCountLabel">${word}</span><div class="setup-stepper" role="group" aria-labelledby="setupCountLabel"><button type="button" class="icon-button" data-count="-1" aria-label="Eine weniger"${model.template.count <= least ? " disabled" : ""}>${icon("minus")}</button><output id="setupCount" aria-live="polite">${model.template.count}</output><button type="button" class="icon-button" data-count="1" aria-label="Eine mehr"${model.template.count >= most ? " disabled" : ""}>${icon("plus")}</button></div></div>
      ${pauses("setupSmall", model.template.small, [0, 5, 10, 15], "Kurze Pause")}
      ${pauses("setupBig", model.template.big, [10, 15, 20, 25, 30, 45], "Große Pause")}
    </div>`;
}

const VIEWS = {
  start: {
    html() {
      const lessons = plan.countLessons(data.timetable, abWeeks() ? ["A", "B"] : ["A"]);
      const text = lessons
        ? `In deinem Plan stehen schon ${plural(lessons, "Stunde", "Stunden")}. Hier gehst du alles noch einmal durch und ergänzt, was fehlt.`
        : "Ich frag dich kurz nach deiner Schule und deinen Fächern. Danach tippst du deine Stunden ins Raster, das dauert etwa fünf Minuten.";
      const share = shareFlow() ? `<button class="text-button setup-share" type="button" data-setup-share>${icon("download")}<span>Plan von Mitschülern übernehmen</span></button>` : "";
      return `<div class="setup-hello">${luna("ruhe", 128)}<h2 class="setup-title is-big" id="setupTitle" tabindex="-1">${lessons ? "Stundenplan durchgehen" : "Stundenplan eintragen"}</h2><p class="setup-lead">${text}</p>${share}</div>`;
    },
    next: () => "Los geht’s",
  },
  school: {
    html() {
      const options = plan.STATES.map(([code, name]) => `<option value="${code}"${code === model.state ? " selected" : ""}>${esc(name)}</option>`).join("");
      const grades = plan.GRADES.map((grade) => radio("grade", grade, grade === model.grade, `<span>${grade}</span>`, "is-grade")).join("");
      return `${bubble("Wo gehst du zur Schule und in welche Klasse?")}
        <div class="setup-fields">
          <div class="setup-field"><label class="setup-label" for="setupState">Bundesland</label><select class="field-control" id="setupState" data-autofocus aria-describedby="setupStateNote">${model.state ? "" : '<option value="" selected disabled>Bitte wählen</option>'}${options}</select><span class="setup-note" id="setupStateNote" aria-live="polite">${esc(stateNote())}</span></div>
          <fieldset class="setup-field" aria-describedby="setupGradeNote"><legend class="setup-label">Klasse</legend><div class="setup-grades">${grades}</div><span class="setup-note" id="setupGradeNote" aria-live="polite">${gradeNote()}</span></fieldset>
        </div>`;
    },
    ready: () => !!model.state && !!model.grade,
  },
  times: {
    html() {
      const keep = ownTimes() || usedBlocks() > 0;
      const stored = sortedBlocks();
      const words = periodWords(stored);
      const cards = [
        keep ? radio("times", "keep", model.times === "keep", `${motif(stored.length)}<b>So wie jetzt</b><small>${plural(stored.length, words.one, words.many)}, ${hm(stored[0].start)} bis ${hm(stored.at(-1).end)}</small>`, "is-card") : "",
        radio("times", "45", model.times === "45", `${motif(8)}<b>45 Minuten</b><small>Einzelstunden</small>`, "is-card"),
        radio("times", "90", model.times === "90", `${motif(4)}<b>90 Minuten</b><small>Doppelstunden</small>`, "is-card is-double"),
      ].join("");
      const blocks = draftBlocks();
      return `${bubble("Wie lang ist eine Stunde bei dir?")}
        <div class="setup-cards" role="radiogroup" aria-label="Länge einer Stunde">${cards}</div>
        <div class="setup-times-host" id="setupTimesHost">${timesDetail()}${model.times ? `${timelineHtml(blocks)}<p class="setup-note" id="setupTimesNote">${timesNote(blocks)}</p>` : ""}</div>`;
    },
    ready: () => !!model.times && draftBlocks().length > 0,
  },
  weeks: {
    html() {
      const answer = [radio("ab", "yes", model.ab === "yes", "<b>Ja</b><small>Zwei Pläne im Wechsel</small>", "is-card"), radio("ab", "no", model.ab === "no", "<b>Nein</b><small>Jede Woche gleich</small>", "is-card")].join("");
      const letter = `<fieldset class="setup-followup" id="setupLetter"${model.ab === "yes" ? "" : " hidden"}><legend class="setup-label">${weekQuestion()}</legend><div class="setup-cards is-pair">${radio("letter", "A", model.letter === "A", "<b>Ja, A-Woche</b>", "is-card")}${radio("letter", "B", model.letter === "B", "<b>Nein, B-Woche</b>", "is-card")}</div></fieldset>`;
      return `${bubble("Hat deine Schule A- und B-Wochen?")}<div class="setup-cards is-pair" role="radiogroup" aria-label="A- und B-Wochen">${answer}</div>${letter}`;
    },
    ready: () => model.ab === "no" || (model.ab === "yes" && !!model.letter),
  },
};

const pickNamed = (name) => model.picks.find((pick) => plan.sameName(pick.name, name));

function subjectChip(item) {
  const pick = pickNamed(item.name);
  const hue = pick?.hue || item.hue;
  const locked = !!pick?.existing;
  return `<button type="button" class="setup-chip is-subject${locked ? " is-locked" : ""}" data-pick="${esc(item.name)}" aria-pressed="${!!pick}" style="--hue:var(--hue-${hue})"><i class="setup-dot" aria-hidden="true"></i><span>${esc(item.name)}</span>${icon("check", "setup-tick")}</button>`;
}

function addPick(item) {
  const hue = plan.pickHue(item.hue, model.picks.map((pick) => pick.hue), HUES);
  const short = plan.suggestShort(item.name, model.picks.map((pick) => pick.short));
  const pick = { key: null, name: item.name, short, hue, type: item.type || "GK", teacher: "", room: "", existing: false };
  model.picks.push(pick);
  return pick;
}

function togglePick(name) {
  const pick = pickNamed(name);
  if (pick?.existing) return "locked";
  if (pick) {
    model.picks = model.picks.filter((item) => item !== pick);
    if (pick.key) (model.dropped ||= []).push(pick.key);
    if (model.brush === pick.key) model.brush = model.picks[0]?.key || null;
    return "off";
  }
  const item = [...plan.catalogFor(model.grade || 12), ...plan.UPPER, ...plan.LOWER].find((entry) => plan.sameName(entry.name, name)) || { name, hue: HUES[0] };
  addPick(item);
  return "on";
}

function addCustom(text) {
  const name = String(text || "").replace(/\s+/g, " ").trim().slice(0, 32);
  if (!name) return null;
  const known = pickNamed(name);
  if (known) return known;
  const fromList = [...plan.UPPER, ...plan.LOWER].find((entry) => plan.sameName(entry.name, name));
  return addPick(fromList || { name, hue: HUES[model.picks.length % HUES.length] });
}

function uniqueKey(name, items) {
  const base = `x-${slug(name).slice(0, 12) || "fach"}`;
  let key = base;
  for (let index = 2; data.subjects[key] || schoolDefaults.subjects[key] || items[key]; index += 1) key = `${base}-${index}`;
  return key;
}

// A name is looked up as it was written before it is read as Frau or Herr, so "Fr. Krüger" stays the teacher the plan already has.
function teacherOf(text, teachers) {
  const typed = tidy(text);
  if (!typed) return "";
  const written = data.teachers.find((teacher) => lower(teacher.label) === lower(typed));
  if (written) return written.id;
  const parsed = plan.parseTeacher(typed);
  const label = teacherLabel(parsed);
  const read = data.teachers.find((teacher) => lower(teacherLabel(plan.parseTeacher(teacher.label))) === lower(label));
  if (read) return read.id;
  const id = teacherId(label);
  teachers.items[id] ||= { custom: true, title: parsed.title, name: parsed.name };
  teachers.removed = teachers.removed.filter((item) => item !== id);
  return id;
}

function roomOf(text, rooms) {
  const typed = tidy(text).slice(0, 12);
  if (!typed) return "";
  const room = plan.normalizeRoom(typed);
  const matches = (item) => lower(item) === lower(typed) || lower(item) === lower(room);
  const known = [...data.rooms, ...rooms.added].find(matches);
  if (known) return known;
  const removed = rooms.removed.find(matches);
  if (removed) {
    rooms.removed = rooms.removed.filter((item) => item !== removed);
    return removed;
  }
  rooms.added.push(room);
  return room;
}

// Writes a store only when its content changed, so going through the setup without typing leaves every store as it was.
function saveStore(key, saved, before, after, empty) {
  if (same(before, after)) return false;
  if (empty) storage.remove(key);
  else storage.set(key, { ...saved, ...after });
  return true;
}

function commitSubjects() {
  const subjectStore = readObject(LOCAL_KEYS.subjects);
  const teacherStore = readObject(LOCAL_KEYS.teachers);
  const roomStore = readObject(LOCAL_KEYS.rooms);
  const before = {
    subjects: { items: subjectStore.items || {}, removed: listOf(subjectStore.removed) },
    teachers: { items: teacherStore.items || {}, removed: listOf(teacherStore.removed) },
    rooms: { added: listOf(roomStore.added), removed: listOf(roomStore.removed) },
    lessons: readObject(LOCAL_KEYS.lessons),
  };
  const next = clone(before);
  const { items } = next.subjects;
  (model.dropped || []).forEach((key) => {
    if (items[key]?.custom) delete items[key];
    Object.keys(next.lessons).forEach((cell) => next.lessons[cell]?.subject === key && delete next.lessons[cell]);
  });
  model.dropped = [];
  model.picks.forEach((pick) => {
    const touched = pick.touched || new Set();
    const info = pick.key ? data.subjects[pick.key] : null;
    const teacher = !pick.existing || touched.has("teacher") ? teacherOf(pick.teacher, next.teachers) : info?.teacherId || "";
    const room = !pick.existing || touched.has("room") ? roomOf(pick.room, next.rooms) : info?.room || "";
    if (!pick.key) pick.key = uniqueKey(pick.short || pick.name, items);
    if (!pick.existing) {
      items[pick.key] = { custom: true, name: pick.name, short: pick.short, hue: pick.hue, type: pick.type, teacher, room };
      return;
    }
    if (!info) return;
    const own = { ...(items[pick.key] || {}) };
    if (touched.has("type") && pick.type !== info.type) own.type = pick.type;
    if (touched.has("teacher") && teacher !== info.teacherId) own.teacher = teacher;
    if (touched.has("room") && room !== info.room) own.room = room;
    if (Object.keys(own).length) items[pick.key] = own;
  });
  const changes = [
    saveStore(LOCAL_KEYS.subjects, subjectStore, before.subjects, next.subjects, !Object.keys(items).length && !next.subjects.removed.length),
    saveStore(LOCAL_KEYS.teachers, teacherStore, before.teachers, next.teachers, !Object.keys(next.teachers.items).length && !next.teachers.removed.length),
    saveStore(LOCAL_KEYS.rooms, roomStore, before.rooms, next.rooms, !next.rooms.added.length && !next.rooms.removed.length),
    saveStore(LOCAL_KEYS.lessons, {}, before.lessons, next.lessons, !Object.keys(next.lessons).length),
  ];
  if (changes.some(Boolean)) {
    applySchoolEdits();
    flow.dirty = true;
  }
  model.picks.forEach((pick) => {
    const info = data.subjects[pick.key];
    if (!info) return;
    pick.teacher = info.teacher || "";
    pick.room = info.room || "";
  });
  if (!model.brush || !data.subjects[model.brush]) model.brush = model.picks[0]?.key || null;
}

function detailRow(pick) {
  const upper = plan.upperSchool(model.grade || 12) && pick.type !== "SK";
  const id = esc(pick.name);
  const type = upper
    ? `<div class="setup-type" role="radiogroup" aria-label="Kursart ${id}">${["GK", "LK"].map((value) => `<label><input type="radio" name="type:${id}" value="${value}" data-type="${id}"${pick.type === value ? " checked" : ""}><span>${value}</span></label>`).join("")}</div>`
    : "";
  return `<div class="setup-row" style="--hue:var(--hue-${pick.hue})">
      <p class="setup-row-name"><i class="subject-dot" aria-hidden="true"></i><span>${id}</span></p>
      ${type}
      <input class="field-control setup-row-teacher" data-teacher="${id}" value="${esc(pick.teacher)}" maxlength="48" placeholder="Lehrkraft" aria-label="Lehrkraft für ${id}" autocomplete="off" spellcheck="false" enterkeyhint="next">
      <input class="field-control setup-row-room" data-room="${id}" value="${esc(pick.room)}" maxlength="12" placeholder="Raum" aria-label="Raum für ${id}" autocomplete="off" spellcheck="false" autocapitalize="characters" enterkeyhint="next">
    </div>`;
}

function pickGroups() {
  const list = plan.catalogFor(model.grade || 12);
  const groups = plan.GROUPS.map(([group, title]) => `<fieldset class="setup-group"><legend class="setup-label">${title}</legend><div class="setup-chips">${list.filter((item) => item.group === group).map(subjectChip).join("")}</div></fieldset>`).join("");
  const others = model.picks.filter((pick) => !list.some((item) => plan.sameName(item.name, pick.name)));
  return others.length ? `${groups}<fieldset class="setup-group"><legend class="setup-label">Eigene</legend><div class="setup-chips">${others.map((pick) => subjectChip({ name: pick.name, hue: pick.hue })).join("")}</div></fieldset>` : groups;
}

Object.assign(VIEWS, {
  subjects: {
    html() {
      return `${bubble("Welche Fächer hast du?", "Tipp alle an, die in deinem Stundenplan stehen.")}
        <div class="setup-groups" id="setupPicks">${pickGroups()}</div>
          <form class="setup-custom" data-setup-custom novalidate><label class="visually-hidden" for="setupCustom">Anderes Fach</label><input class="field-control" id="setupCustom" maxlength="32" placeholder="Anderes Fach, zum Beispiel Astronomie" autocomplete="off" enterkeyhint="done"><button class="btn btn-quiet" type="submit">${icon("plus")}Hinzufügen</button></form>
          <p class="setup-note" id="setupPickNote" aria-live="polite"></p>`;
    },
    ready: () => model.picks.length > 0,
    hint: () => (model.picks.length ? `${plural(model.picks.length, "Fach", "Fächer")} gewählt` : ""),
  },
  details: {
    html() {
      return `${bubble("Lehrkräfte und Räume", "Freiwillig. Was hier steht, zeigt die Übersicht bei jeder Stunde.")}<div class="setup-rows">${model.picks.map(detailRow).join("")}</div>`;
    },
    after() {
      flow.stage.querySelector(".setup-row-teacher")?.setAttribute("data-autofocus", "");
    },
  },
});

const shownWeeks = () => (abWeeks() ? ["A", "B"] : ["A"]);
const entryAt = (week, dow, n) => (data.timetable[week]?.[String(dow)] || []).find((entry) => entry.block === n) || null;
const weekCount = (week) => plan.countLessons(data.timetable, [week]);

function cellHtml(dow, block, row, col) {
  const entry = entryAt(model.week, dow, block.n);
  const when = `${WEEKDAYS[dow]}, ${block.n}. ${periodWords().one}, ${hm(block.start)}`;
  const focus = model.cursor.row === row && model.cursor.col === col ? 0 : -1;
  const attrs = `type="button" data-cell="${dow}:${block.n}" data-row="${row}" data-col="${col}" tabindex="${focus}"`;
  if (!entry) return `<td><button class="setup-cell is-free" ${attrs} aria-label="${esc(when)}: frei">${icon("plus")}</button></td>`;
  const info = subject(entry.subject);
  return `<td><button class="setup-cell" ${attrs} style="--hue:${hueVar(entry.subject)}" aria-label="${esc(`${when}: ${info.label}`)}"><span class="setup-cell-full">${esc(info.label)}</span><span class="setup-cell-short" aria-hidden="true">${esc(info.short)}</span></button></td>`;
}

function gridHtml() {
  const blocks = sortedBlocks();
  const head = DAYS.map((dow) => `<th scope="col"><span aria-hidden="true">${WEEKDAYS_SHORT[dow]}</span><span class="visually-hidden">${WEEKDAYS[dow]}</span></th>`).join("");
  const rows = blocks.map((block, row) => `<tr><th scope="row"><b>${block.n}</b><small>${hm(block.start)}</small></th>${DAYS.map((dow, col) => cellHtml(dow, block, row, col)).join("")}</tr>`).join("");
  return `<thead><tr><td></td>${head}</tr></thead><tbody>${rows}</tbody>`;
}

function brushesHtml() {
  const chips = model.picks.filter((pick) => data.subjects[pick.key]).map((pick, index) => `<label class="setup-brush" style="--hue:var(--hue-${pick.hue})"><input type="radio" name="brush" value="${esc(pick.key)}"${model.brush === pick.key ? " checked" : ""}${index < 9 ? ` aria-keyshortcuts="${index + 1}"` : ""}><i class="setup-dot" aria-hidden="true"></i><span class="setup-brush-full">${esc(subject(pick.key).label)}</span><span class="setup-brush-short" aria-hidden="true">${esc(subject(pick.key).short)}</span></label>`).join("");
  const erase = `<label class="setup-brush is-erase"><input type="radio" name="brush" value="erase"${model.brush === "erase" ? " checked" : ""}>${icon("eraser")}<span>Leeren</span></label>`;
  const add = model.adding
    ? `<form class="setup-brush-new" data-brush-new novalidate><label class="visually-hidden" for="setupBrushNew">Neues Fach</label><input class="field-control" id="setupBrushNew" maxlength="32" placeholder="Neues Fach" autocomplete="off" enterkeyhint="done"><button class="icon-button" type="submit" aria-label="Fach anlegen">${icon("check")}</button></form>`
    : `<button class="setup-brush is-add" type="button" data-brush-add>${icon("plus")}<span>Fach</span></button>`;
  return `<div class="setup-brushes" role="radiogroup" aria-label="Fach zum Eintragen">${chips}${erase}${add}</div>`;
}

function boardHead() {
  const weeks = abWeeks()
    ? `<div class="segmented setup-weeks" role="group" aria-label="Woche">${["A", "B"].map((week) => `<button type="button" data-week="${week}" aria-pressed="${model.week === week}">${week}-Woche<span class="seg-count">${weekCount(week) || ""}</span></button>`).join("")}</div>`
    : "";
  const copy = abWeeks() && model.week === "B" ? `<button class="btn ${weekCount("B") ? "btn-quiet" : "btn-primary"} setup-copy" type="button" data-copy-week>${icon("copy")}Wie die A-Woche</button>` : "";
  const undo = `<button class="text-button setup-undo" type="button" data-undo${model.history.length ? "" : " disabled"}>${icon("undo-2")}<span>Rückgängig</span></button>`;
  return `<div class="setup-board-head">${weeks}${copy}${undo}</div>`;
}

function fitCells() {
  const cells = [...flow.stage.querySelectorAll(".setup-cell:not(.is-free)")];
  const range = document.createRange();
  cells.forEach((cell) => cell.classList.remove("is-short"));
  cells.filter((cell) => {
    const full = cell.querySelector(".setup-cell-full");
    if (!full?.offsetParent) return false;
    range.selectNodeContents(full);
    return range.getBoundingClientRect().width > full.getBoundingClientRect().width + 0.05;
  }).forEach((cell) => cell.classList.add("is-short"));
}

function paintBoard({ grid = true } = {}) {
  const head = flow.stage.querySelector("#setupBoardHead");
  const table = flow.stage.querySelector("#setupGrid");
  const focused = focusIn(head);
  const inGrid = !!table?.contains(document.activeElement);
  if (head) head.innerHTML = boardHead();
  if (table && grid) {
    table.setAttribute("aria-label", abWeeks() ? `Stundenplan der ${model.week}-Woche` : "Stundenplan");
    table.innerHTML = gridHtml();
    fitCells();
    if (inGrid) table.querySelector('[tabindex="0"]')?.focus({ preventScroll: true });
  }
  if (head) refocus(head, focused, () => table?.querySelector('[tabindex="0"]'));
  paintFoot();
}

function gridHint() {
  const lessons = shownWeeks().map((week) => weekCount(week));
  if (!lessons.some(Boolean)) return "Noch keine Stunde eingetragen";
  return abWeeks() ? `${lessons[0]} in A, ${lessons[1]} in B` : plural(lessons[0], "Stunde", "Stunden");
}

function writeEdits(edits) {
  if (!abAnswered()) planChange(null, () => storage.set(LOCAL_KEYS.abWeeks, abWeeks()));
  saveStore(LOCAL_KEYS.lessons, {}, readObject(LOCAL_KEYS.lessons), edits, !Object.keys(edits).length);
  applySchoolEdits();
  flow.dirty = true;
}

function remember() {
  model.history.push(JSON.stringify(readObject(LOCAL_KEYS.lessons)));
  if (model.history.length > 80) model.history.shift();
}

function paintCell(dow, n) {
  if (!model.brush) return;
  const before = entryAt(model.week, dow, n);
  const clear = model.brush === "erase" || before?.subject === model.brush;
  if (clear && !before) return;
  remember();
  const edits = clone(readObject(LOCAL_KEYS.lessons));
  plan.setLesson(edits, schoolDefaults.timetable, model.week, dow, n, clear ? null : { subject: model.brush, room: data.subjects[model.brush]?.room || "" });
  writeEdits(edits);
  paintBoard();
  const cell = flow.stage.querySelector(`[data-cell="${dow}:${n}"]`);
  if (cell && travels()) cell.animate([{ transform: "scale(0.9)" }, { transform: "none" }], { duration: 320, easing: token("--spring-tactile") || "ease-out" });
}

function undo() {
  const last = model.history.pop();
  if (last == null) return;
  writeEdits(JSON.parse(last));
  paintBoard();
}

function copyWeek() {
  remember();
  const edits = plan.copyWeek(clone(readObject(LOCAL_KEYS.lessons)), schoolDefaults.timetable, data.timetable, sortedBlocks());
  writeEdits(edits);
  model.week = "B";
  paintBoard();
  if (travels()) flow.stage.querySelector("#setupGrid")?.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
}

function moveCursor(row, col) {
  const rows = sortedBlocks().length;
  model.cursor = { row: Math.max(0, Math.min(rows - 1, row)), col: Math.max(0, Math.min(4, col)) };
  const table = flow.stage.querySelector("#setupGrid");
  table.querySelectorAll(".setup-cell").forEach((node) => (node.tabIndex = -1));
  const target = table.querySelector(`.setup-cell[data-row="${model.cursor.row}"][data-col="${model.cursor.col}"]`);
  if (!target) return;
  target.tabIndex = 0;
  target.focus();
}

Object.assign(VIEWS, {
  grid: {
    html() {
      const sub = abWeeks() ? "Tipp ein Fach an und dann die Stunden, in denen es dran ist. Danach machst du die B-Woche." : "Tipp ein Fach an und dann die Stunden, in denen es dran ist.";
      return `${bubble("Jetzt deine Stunden", sub, { size: 52 })}
        <div class="setup-board">
          <div id="setupBoardHead">${boardHead()}</div>
          ${brushesHtml()}
          <div class="setup-grid-frame"><table class="setup-grid" id="setupGrid" aria-label="${abWeeks() ? `Stundenplan der ${model.week}-Woche` : "Stundenplan"}">${gridHtml()}</table></div>
        </div>`;
    },
    after: fitCells,
    hint: gridHint,
    ready: () => shownWeeks().some((week) => weekCount(week) > 0),
  },
});

function appleTab() {
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || ""));
  const views = [window];
  try {
    if (window.top !== window) views.push(window.top);
  } catch {}
  const standalone = views.some((view) => {
    try {
      return view.matchMedia("(display-mode: standalone)").matches || view.navigator.standalone === true;
    } catch {
      return false;
    }
  });
  return apple && !window.hubShell && !standalone;
}

function reminderRow() {
  const supported = "Notification" in window;
  const state = supported ? Notification.permission : "unsupported";
  if (!supported) {
    return appleTab()
      ? `<div class="setup-extra"><span class="setup-extra-icon">${icon("bell")}</span><p><b>Erinnerungen</b><small>${esc(tabReminderNote({ agent: navigator.userAgent, brand: BRAND }))} Deinen Plan nimmst du über Einstellungen › Daten mit.</small></p></div>`
      : "";
  }
  const what = "vor jeder Stunde und am Vortag eines Tests";
  // The desktop app always reports the permission as granted, so only the saved switch tells whether reminders are on.
  const on = state === "granted" && readPrefs().enabled;
  const text = on
    ? `Sind an. Ich melde mich ${what}.`
    : state === "granted"
      ? `Sind aus. Schalte sie ein, dann melde ich mich ${what}.`
      : state === "denied"
        ? "Sind blockiert. Freigeben kannst du sie in den Einstellungen des Geräts oder Browsers."
        : `Ich melde mich ${what}.`;
  const control = on
    ? `<span class="setup-extra-ok">${icon("circle-check")}</span>`
    : state === "granted"
      ? `<button class="btn btn-quiet" type="button" data-setup-remind-on>${icon("bell")}Einschalten</button>`
      : state === "default" ? `<button class="btn btn-quiet" type="button" data-setup-remind>${icon("bell")}Erlauben</button>` : "";
  return `<div class="setup-extra" id="setupRemind" tabindex="-1"><span class="setup-extra-icon">${icon("bell")}</span><p><b>Erinnerungen</b><small>${text}</small></p>${control}</div>`;
}

function repaintReminder() {
  const row = flow.stage.querySelector("#setupRemind");
  if (!row) return;
  const focused = row.contains(document.activeElement);
  row.outerHTML = reminderRow();
  if (focused) flow.stage.querySelector("#setupRemind")?.focus({ preventScroll: true });
}

function iservRow() {
  const kind = data.user?.iserv;
  if (!kind || data.status?.iserv) return "";
  const text = kind === "android" ? "Hausaufgaben und Vertretungsplan kommen dann aus IServ dazu." : "Vertretungsplan und Mails kommen dann aus IServ dazu.";
  return `<div class="setup-extra"><span class="setup-extra-icon">${icon("graduation-cap")}</span><p><b>IServ verbinden</b><small>${text}</small></p><button class="btn btn-quiet" type="button" data-setup-go="/hub/settings#konten">Verbinden</button></div>`;
}

Object.assign(VIEWS, {
  done: {
    html() {
      const counts = shownWeeks().map(weekCount);
      const lessons = abWeeks() ? `${counts[0]} Stunden in der A-Woche und ${counts[1]} in der B-Woche` : `${plural(counts[0], "Stunde", "Stunden")} pro Woche`;
      return `<div class="setup-hello is-done">${luna("ruhe", 112)}<h2 class="setup-title is-big" id="setupTitle" tabindex="-1">Dein Plan steht</h2><p class="setup-lead">${lessons}, ${plural(activeSubjectKeys().length, "Fach", "Fächer")}. Die Übersicht zeigt dir ab jetzt, was gerade dran ist.</p></div>
        <div class="setup-extras">
          ${reminderRow()}
          <div class="setup-extra"><span class="setup-extra-icon">${icon("map-pin")}</span><p><b>Zuhause und Schule</b><small>Dann zeigt der Fahrplan deinen Schulweg und den Heimweg.</small></p><button class="btn btn-quiet" type="button" data-setup-go="/hub/settings#orte">Festlegen</button></div>
          ${iservRow()}
        </div>`;
    },
    after() {
      if (!travels()) return;
      flow.stage.querySelectorAll(".setup-extra").forEach((node, index) => node.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 360, delay: 160 + index * 70, easing: token("--ease-out") || "ease-out", fill: "backwards" }));
    },
    next: () => "Zur Übersicht",
  },
});

async function saveState(code) {
  model.state = code;
  model.stateStatus = "loading";
  flow.dirty = true;
  const note = () => {
    const node = flow.stage.querySelector("#setupStateNote");
    if (node) node.textContent = stateNote();
  };
  note();
  paintFoot();
  try {
    const response = await fetch("/api/hub/bundesland", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bundesland: code }), credentials: "same-origin" });
    const answer = await response.json().catch(() => ({}));
    model.stateStatus = response.ok && answer.success !== false && !answer.errors ? "done" : "failed";
  } catch {
    model.stateStatus = "failed";
  }
  if (model.state === code) note();
}

function saveGrade(grade) {
  model.grade = grade;
  const prefs = savedPrefs();
  if (prefs.school?.grade !== grade) {
    storage.set(LOCAL_KEYS.prefs, { ...prefs, school: { ...(prefs.school || {}), grade } });
    flow.dirty = true;
  }
  const note = flow.stage.querySelector("#setupGradeNote");
  if (note) note.textContent = gradeNote();
  paintFoot();
}

function leaveStep(id) {
  if (id === "times" && (model.times === "45" || model.times === "90")) {
    const blocks = plan.blockTimes(model.template);
    if (!blocks.length) return false;
    if (!sameTimes(blocks, sortedBlocks())) {
      saveBlocks(blocks);
      applySchoolEdits();
      flow.dirty = true;
    }
  }
  if (id === "weeks") {
    const wanted = model.ab === "yes";
    let changed = false;
    if (!abSettled() || abWeeks() !== wanted) {
      storage.set(LOCAL_KEYS.abWeeks, wanted);
      changed = true;
    }
    const swap = wanted && plan.swapFor(model.letter, askedDay(), schoolDefaults.abReference);
    if (wanted && swap !== (storage.get(LOCAL_KEYS.abSwap) === true)) {
      if (swap) storage.set(LOCAL_KEYS.abSwap, true);
      else storage.remove(LOCAL_KEYS.abSwap);
      changed = true;
    }
    if (changed) {
      applySchoolEdits();
      flow.dirty = true;
    }
    model.week = "A";
  }
  if (id === "subjects" || id === "details") commitSubjects();
  return true;
}

function refreshTimes() {
  const host = flow.stage.querySelector("#setupTimesHost");
  if (!host) return;
  const blocks = draftBlocks();
  const focused = focusIn(host);
  host.innerHTML = `${timesDetail()}${model.times ? `${timelineHtml(blocks)}<p class="setup-note" id="setupTimesNote">${timesNote(blocks)}</p>` : ""}`;
  refocus(host, focused, () => host.querySelector("[data-count]:not(:disabled)") || host.querySelector("#setupStart"));
  paintFoot();
}

function popChip(node) {
  if (node && travels()) node.animate([{ transform: "scale(0.92)" }, { transform: "none" }], { duration: 300, easing: token("--spring-tactile") || "ease-out" });
}

function repaintSubjects(name) {
  const host = flow.stage.querySelector("#setupPicks");
  if (host) host.innerHTML = pickGroups();
  paintFoot();
  const chip = [...flow.stage.querySelectorAll("[data-pick]")].find((node) => node.dataset.pick === name);
  chip?.focus({ preventScroll: true });
  popChip(chip);
}

async function startShare() {
  const run = shareFlow();
  if (!run) return;
  flow.dialog.close();
  document.documentElement.classList.remove("setup-open");
  try {
    await run();
  } catch {}
}

function onClick(event) {
  const target = event.target;
  if (target.closest("[data-setup-close]")) return close();
  if (target.closest("[data-setup-back]")) return go(-1);
  if (target.closest("[data-setup-next]")) {
    if (current() === "done") return close({ to: pageUrl("home") });
    return go(1);
  }
  if (target.closest("[data-setup-share]")) return startShare();
  const goTo = target.closest("[data-setup-go]");
  if (goTo) return close({ to: pageUrl("settings", goTo.dataset.setupGo) });
  if (target.closest("[data-setup-remind]")) {
    switchRemindersOn();
    askPermission().then(repaintReminder);
    return;
  }
  if (target.closest("[data-setup-remind-on]")) {
    switchRemindersOn();
    repaintReminder();
    return;
  }
  const pick = target.closest("[data-pick]");
  if (pick) {
    const name = pick.dataset.pick;
    const result = togglePick(name);
    if (result === "locked") {
      const note = flow.stage.querySelector("#setupPickNote");
      if (note) note.textContent = `${name} steht schon in deinem Plan. Löschen kannst du es unter Einstellungen, Fächer.`;
      return;
    }
    repaintSubjects(name);
    return;
  }
  const count = target.closest("[data-count]");
  if (count && !count.disabled) {
    const { least, most } = timesCount();
    model.template.count = Math.max(least, Math.min(most, model.template.count + Number(count.dataset.count)));
    model.timesEdited = true;
    refreshTimes();
    return;
  }
  const cell = target.closest("[data-cell]");
  if (cell) {
    const [dow, n] = cell.dataset.cell.split(":").map(Number);
    model.cursor = { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
    paintCell(dow, n);
    return;
  }
  const week = target.closest("[data-week]");
  if (week) {
    if (model.week === week.dataset.week) return;
    model.week = week.dataset.week;
    paintBoard();
    if (travels()) flow.stage.querySelector("#setupGrid")?.animate([{ opacity: 0, transform: `translateX(${model.week === "B" ? 14 : -14}px)` }, { opacity: 1, transform: "none" }], { duration: 260, easing: token("--ease-out") || "ease-out" });
    return;
  }
  if (target.closest("[data-copy-week]")) return copyWeek();
  if (target.closest("[data-undo]")) return undo();
  if (target.closest("[data-brush-add]")) {
    model.adding = true;
    flow.stage.querySelector(".setup-brushes").outerHTML = brushesHtml();
    flow.stage.querySelector("#setupBrushNew")?.focus();
  }
}

function onChange(event) {
  const target = event.target;
  if (target.id === "setupState" && target.value) return saveState(target.value);
  if (target.name === "grade") return saveGrade(Number(target.value));
  if (target.name === "times") {
    model.times = target.value;
    if (model.times !== "keep") {
      const template = plan.TEMPLATES[model.times];
      const same = model.template.length === template.length;
      model.template = { ...model.template, length: template.length, count: same ? model.template.count : Math.max(template.count, usedBlocks()), small: same ? model.template.small : template.small, big: same ? model.template.big : template.big };
    }
    refreshTimes();
    return;
  }
  if (target.id === "setupStart") {
    if (plan.minutesOfClock(target.value) != null) model.template.start = target.value;
    model.timesEdited = true;
    refreshTimes();
    return;
  }
  if (target.id === "setupSmall" || target.id === "setupBig") {
    model.template[target.id === "setupSmall" ? "small" : "big"] = Number(target.value);
    model.timesEdited = true;
    refreshTimes();
    return;
  }
  if (target.name === "ab") {
    model.ab = target.value;
    const followup = flow.stage.querySelector("#setupLetter");
    if (followup) followup.hidden = model.ab !== "yes";
    if (followup && model.ab === "yes" && travels()) followup.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: token("--ease-out") || "ease-out" });
    paintFoot();
    return;
  }
  if (target.name === "letter") {
    model.letter = target.value;
    paintFoot();
    return;
  }
  if (target.dataset.type) {
    const pick = pickNamed(target.dataset.type);
    if (!pick) return;
    pick.type = target.value;
    (pick.touched ||= new Set()).add("type");
    return;
  }
  if (target.name === "brush") {
    model.brush = target.value;
    popChip(target.closest(".setup-brush"));
  }
}

function onInput(event) {
  const target = event.target;
  const field = target.dataset.teacher ? "teacher" : target.dataset.room ? "room" : "";
  const pick = field && pickNamed(target.dataset[field]);
  if (!pick) return;
  pick[field] = target.value;
  (pick.touched ||= new Set()).add(field);
}

function submitCustom(form) {
  const input = form.querySelector("input");
  if (form.matches("[data-setup-custom]")) {
    const pick = addCustom(input.value);
    if (!pick) return input.focus();
    repaintSubjects(pick.name);
    input.value = "";
    input.focus();
    return;
  }
  const pick = addCustom(input.value);
  if (!pick) return input.focus();
  commitSubjects();
  model.brush = pick.key;
  model.adding = false;
  flow.stage.querySelector(".setup-brushes").outerHTML = brushesHtml();
  flow.stage.querySelector(`input[name="brush"][value="${CSS.escape(pick.key)}"]`)?.focus();
}

function onKey(event) {
  const target = event.target;
  const key = event.key.toLowerCase();
  // The page behind keeps its own shortcuts for undo, search and notes. Inside the setup they would act on what is hidden.
  if ((event.ctrlKey || event.metaKey) && ["z", "k", "n"].includes(key)) {
    event.stopPropagation();
    if (key === "z" && !event.shiftKey && current() === "grid" && !target.matches("input:not([type='radio']), select")) {
      event.preventDefault();
      undo();
    }
    return;
  }
  if (event.key === "Escape" && model?.adding) {
    event.preventDefault();
    model.adding = false;
    flow.stage.querySelector(".setup-brushes").outerHTML = brushesHtml();
    return;
  }
  if (current() !== "grid") return;
  if (/^[1-9]$/.test(event.key) && !target.matches("input:not([type='radio']), select")) {
    const pick = model.picks.filter((item) => data.subjects[item.key])[Number(event.key) - 1];
    if (!pick) return;
    model.brush = pick.key;
    const radioNode = flow.stage.querySelector(`input[name="brush"][value="${CSS.escape(pick.key)}"]`);
    if (radioNode) radioNode.checked = true;
    return;
  }
  const cell = target.closest?.(".setup-cell");
  if (!cell) return;
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  const moves = { ArrowRight: [row, col + 1], ArrowLeft: [row, col - 1], ArrowDown: [row + 1, col], ArrowUp: [row - 1, col] };
  if (moves[event.key]) {
    event.preventDefault();
    moveCursor(...moves[event.key]);
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    const [dow, n] = cell.dataset.cell.split(":").map(Number);
    if (!entryAt(model.week, dow, n)) return;
    const brush = model.brush;
    model.brush = "erase";
    paintCell(dow, n);
    model.brush = brush;
  }
}

document.addEventListener("submit", (event) => {
  const form = event.target.closest?.("form[data-setup-custom], form[data-brush-new]");
  if (!form || !flow.dialog?.contains(form)) return;
  event.preventDefault();
  submitCustom(form);
});
