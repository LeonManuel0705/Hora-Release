import {
  data, root, variant, flags, platform, esc, icon, luna, storage, now, subject, hueVar, toMin, clock, hm, weekType, isoWeek,
  isoDate, minutesOf, lessonsFor, nextSchoolDay, shortDate, WEEKDAYS, WEEKDAYS_SHORT,
  LOCAL_KEYS, HUES, COURSE_TYPES, NO_TEACHER, MAX_BLOCKS, schoolDefaults, applySchoolEdits, saveBlocks, abWeeks, abAnswered, hasPlan, activeSubjectKeys, motionDefault, slug, teacherLabel, periodWords, BRAND, BRAND_NAMES } from "../core.js";
import { animates, travels, reduced, token, flipKeyed, enterInPlace } from "../motion.js";
import { toast, setTheme, syncTime, renderSync } from "../shell.js";
import { VERSION, KINDS, BODIES, wholeSchool, fileKeys, fileSubjects, fileRecords, fitSchool, recordPlan, planSize, subjectsInUse, summary, contents, offerFile } from "../backup.js";
import { askBackup, importFlow } from "../plan-share.js";
import { platformName } from "../feedback.js";
import { suggestShort, pickHue } from "../setup-data.js";
import { storageNote, safariOnMac } from "../persistence.js";

const $ = (id) => document.getElementById(id);
const page = data?.page || {};
const DAYS = [1, 2, 3, 4, 5];
const PREFS_KEY = "app-settings";
const THEME_KEY = "app-theme-choice";
const KEYS_KEY = "app-single-keys";
const phone = matchMedia("(max-width: 759px)");
const COURSE_GROUPS = [["LK", "Leistungskurse"], ["GK", "Grundkurse"], ["SK", "Seminarkurs"]];
const COURSE_WORDS = { LK: "Leistungskurs", GK: "Grundkurs", SK: "Seminarkurs" };
const GRADES = [5, 6, 7, 8, 9, 10, 11, 12, 13];
const HUE_NAMES = { rose: "Rosa", ochre: "Ocker", olive: "Oliv", moss: "Moos", jade: "Jade", teal: "Petrol", lake: "Seeblau", slate: "Taubenblau", iris: "Iris", orchid: "Orchidee", brick: "Ziegelrot", plum: "Pflaume" };
const TITLES = [["Frau", "Frau"], ["Herr", "Herr"], ["", "Ohne Anrede"]];
const TYPE_ORDER = { LK: 0, GK: 1, SK: 2 };

const clone = (value) => JSON.parse(JSON.stringify(value));
const plural = (count, one, many) => `${count}\u00a0${count === 1 ? one : many}`;
const period = () => periodWords().one;
const minutesText = (minutes) => `${minutes}\u00a0Min.`;
const isClock = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || "");
const joinWords = (words) => (words.length > 1 ? `${words.slice(0, -1).join(", ")} und ${words.at(-1)}` : words.join(""));

function removeKey(key) {
  storage.remove(key);
}

function say(text) {
  const live = $("liveStatus");
  if (!live) return;
  live.textContent = "";
  requestAnimationFrame(() => (live.textContent = text));
}

function keepFocus(container, paint) {
  const active = document.activeElement;
  const id = active && active !== document.body && container.contains(active) ? active.id : "";
  paint();
  if (id && !container.contains(document.activeElement)) $(id)?.focus({ preventScroll: true });
}

function row({ id, label, desc = "", control = "", cls = "", forId = "" }) {
  const name = forId
    ? `<label class="set-row-label" id="${id}Label" for="${forId}">${label}</label>`
    : `<p class="set-row-label" id="${id}Label">${label}</p>`;
  return `<div class="set-row${cls ? ` ${cls}` : ""}" id="${id}"><div class="set-row-text">${name}${desc ? `<p class="set-row-desc" id="${id}Desc">${desc}</p>` : ""}</div><div class="set-row-control">${control}</div></div>`;
}

const switchHtml = (id, on, labelId, { disabled = false, describedBy = "" } = {}) =>
  `<button type="button" class="switch" role="switch" id="${id}" aria-checked="${on}" aria-labelledby="${labelId}"${describedBy ? ` aria-describedby="${describedBy}"` : ""}${disabled ? " disabled" : ""}><span></span></button>`;

const loadingHtml = (title, text) =>
  `<div class="loading-card set-loading" role="status">${luna("laedt", 96)}<div><p class="empty-title">${esc(title)}</p><p class="empty-text">${esc(text)}</p></div></div>`;

const errorHtml = (id, text) => `<p class="field-error" id="${id}"${text ? "" : " hidden"}>${text ? `${icon("circle-alert")}<span>${esc(text)}</span>` : ""}</p>`;

function setError(input, box, text) {
  if (!box) return;
  box.hidden = !text;
  box.innerHTML = text ? `${icon("circle-alert")}<span>${esc(text)}</span>` : "";
  if (!input) return;
  if (text) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

const PASS_NETS = [["Berlin", "Berlin"], ["Brandenburg a.d.H", "Brandenburg an der Havel"], ["Cottbus", "Cottbus"], ["Frankfurt (Oder)", "Frankfurt (Oder)"], ["Potsdam", "Potsdam"]];
const PASS_ZONES = ["AB", "ABC"];
const MAP_APPS = [["auto", "Automatisch", ""], ["apple", "Apple", " Karten"], ["google", "Google", " Maps"]];
const knownPass = (pass) => PASS_NETS.some(([net]) => net === pass?.net) && PASS_ZONES.includes(pass?.zones);
const passLabel = (pass) => `${PASS_NETS.find(([net]) => net === pass.net)[1]} ${pass.zones}`;

function prefDefaults() {
  const notify = page.notifications || {};
  const categories = {};
  (notify.categories || []).forEach((item) => (categories[item.key] = { on: item.on !== false, lead: item.lead ?? null }));
  return {
    school: { grade: page.school?.grade ?? null, state: page.school?.state ?? "", birthday: "" },
    iserv: { connected: page.accounts?.iserv?.connected !== false },
    google: {
      connected: page.accounts?.google?.connected !== false,
      calendars: Object.fromEntries((page.accounts?.google?.calendars || []).map((item) => [item.id, item.on !== false])),
    },
    notify: {
      enabled: notify.enabled !== false,
      sound: notify.sound !== false,
      quiet: { from: notify.quiet?.from || "22:00", to: notify.quiet?.to || "07:00" },
      categories,
    },
    places: { weather: page.places?.weather || "" },
    transit: { deutschlandticket: false, passes: [], maps: "auto" },
  };
}

function loadPrefs() {
  const base = prefDefaults();
  const saved = storage.get(PREFS_KEY);
  if (!saved || typeof saved !== "object") return base;
  const categories = {};
  Object.entries(base.notify.categories).forEach(([key, value]) => (categories[key] = { ...value, ...(saved.notify?.categories?.[key] || {}) }));
  return {
    school: { ...base.school, ...(saved.school || {}) },
    iserv: { ...base.iserv, ...(saved.iserv || {}) },
    google: { ...base.google, ...(saved.google || {}), calendars: { ...base.google.calendars, ...(saved.google?.calendars || {}) } },
    notify: { ...base.notify, ...(saved.notify || {}), quiet: { ...base.notify.quiet, ...(saved.notify?.quiet || {}) }, categories },
    places: { ...base.places, ...(saved.places || {}) },
    transit: { ...base.transit, ...(saved.transit || {}), passes: (Array.isArray(saved.transit?.passes) ? saved.transit.passes : []).filter(knownPass) },
  };
}

function withServerTruth(value) {
  value.iserv.connected = !!page.accounts?.iserv?.connected;
  value.google.connected = !!page.accounts?.google?.connected;
  if (page.school) value.school.state = page.school.state || "";
  if (page.school?.grade) value.school.grade = page.school.grade;
  if (page.school && "birthday" in page.school) value.school.birthday = page.school.birthday || "";
  if (typeof page.places?.weather === "string") value.places.weather = page.places.weather;
  return value;
}

let prefs = withServerTruth(loadPrefs());
const savePrefs = () => storage.set(PREFS_KEY, prefs);

async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {}
  if (!response.ok || payload.success === false) throw new Error(payload.error || payload.message || "");
  return payload;
}

const confirming = { key: null, timer: 0 };

function confirmTwice(key, button, question = "Wirklich trennen?", hint = "Zum Trennen noch einmal drücken") {
  if (confirming.key === key) {
    clearTimeout(confirming.timer);
    confirming.key = null;
    return true;
  }
  confirming.key = key;
  clearTimeout(confirming.timer);
  const label = button.innerHTML;
  button.textContent = question;
  button.classList.add("danger-button");
  confirming.timer = setTimeout(() => {
    confirming.key = null;
    button.innerHTML = label;
    button.classList.remove("danger-button");
  }, 4000);
  say(hint);
  return false;
}

function commitPrefs(mutate, render, message = "", glyph = "check") {
  const before = clone(prefs);
  mutate(prefs);
  savePrefs();
  render();
  if (!message) return;
  toast(message, {
    icon: glyph,
    action: { label: "Rückgängig", undo: true, run: () => {
      prefs = before;
      savePrefs();
      render();
      say("Rückgängig gemacht");
    } },
  });
}

const plan = {
  week: weekType(now()),
  row: 0,
  col: Math.min(4, Math.max(0, (now().getDay() || 1) - 1)),
  editing: null,
  roomTouched: false,
};

const cellKey = (week, dow, n) => `${week}:${dow}:${n}`;
const shownWeeks = () => (abWeeks() ? ["A", "B"] : ["A"]);
const weekTag = (week) => (abWeeks() ? `, ${week}-Woche` : "");
const visibleEdit = (key) => {
  const [week, , n] = key.split(":");
  return shownWeeks().includes(week) && data.blocks.some((block) => block.n === Number(n));
};
const planBlocks = () => [...data.blocks].sort((a, b) => toMin(a.start) - toMin(b.start));
const entryIn = (timetable, week, dow, n) => (timetable?.[week]?.[String(dow)] || []).find((entry) => entry.block === n) || null;
const lessonAt = (week, dow, n) => entryIn(data.timetable, week, dow, n);
const baseLesson = (week, dow, n) => entryIn(schoolDefaults.timetable, week, dow, n);
const sameLesson = (a, b) => (!a && !b) || (!!a && !!b && a.subject === b.subject && (a.room || "") === (b.room || "") && (a.teacher || "") === (b.teacher || ""));
const courseType = (key) => data.subjects[key]?.type || "GK";
const plainName = (text) => String(text || "").replace(/\s+(LK|GK)$/, "");
const sortedTeachers = () => [...data.teachers].sort((a, b) => a.name.localeCompare(b.name, "de") || a.label.localeCompare(b.label, "de"));
// Only a plan that came in from elsewhere has a state to compare against. A plan typed in here is the user's own throughout.
const imported = Object.values(schoolDefaults?.timetable || {}).some((days) => Object.values(days || {}).some((entries) => (entries || []).length));

function readEdits() {
  const value = storage.get(LOCAL_KEYS.lessons);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function writeEdits(edits) {
  if (!abAnswered()) storage.set(LOCAL_KEYS.abWeeks, abWeeks());
  if (Object.keys(edits).length) storage.set(LOCAL_KEYS.lessons, edits);
  else removeKey(LOCAL_KEYS.lessons);
  applySchoolEdits();
}

function setLesson(edits, week, dow, n, value) {
  const key = cellKey(week, dow, n);
  const base = baseLesson(week, dow, n);
  const plain = !!value && !value.teacher && !!base && value.subject === base.subject && (value.room || "") === (base.room || "");
  if (plain || (!value && !base)) delete edits[key];
  else edits[key] = value ? { subject: value.subject, room: value.room, ...(value.teacher ? { teacher: value.teacher } : {}) } : null;
}

function lessonValue(week, dow, n) {
  const entry = lessonAt(week, dow, n);
  if (!entry) return null;
  const own = readEdits()[cellKey(week, dow, n)];
  return { subject: entry.subject, room: entry.room, teacher: own && own.subject === entry.subject && typeof own.teacher === "string" ? own.teacher : "" };
}

function changedCells(before, after) {
  const keys = [];
  shownWeeks().forEach((week) => DAYS.forEach((dow) => planBlocks().forEach((block) => {
    if (!sameLesson(entryIn(before, week, dow, block.n), entryIn(after, week, dow, block.n))) keys.push(cellKey(week, dow, block.n));
  })));
  return keys;
}

function commitPlan(mutate, message, glyph) {
  const snapshot = readEdits();
  const edits = clone(snapshot);
  const before = clone(data.timetable);
  mutate(edits);
  writeEdits(edits);
  const changed = changedCells(before, data.timetable);
  if (!changed.length) {
    writeEdits(snapshot);
    return changed;
  }
  renderPlan({ flash: changed });
  renderCatalog();
  renderDataMeta();
  toast(message(changed), {
    icon: glyph,
    action: { label: "Rückgängig", undo: true, run: () => {
      writeEdits(snapshot);
      renderPlan({ flash: changed });
      renderCatalog();
      renderDataMeta();
      say("Rückgängig gemacht");
    } },
  });
  return changed;
}

function cellLabel(dow, block, entry, edited) {
  const when = `${WEEKDAYS[dow]}, ${block.n}. ${period()}, ${hm(block.start)} bis ${hm(block.end)}`;
  const what = entry ? `${subject(entry.subject).name}${entry.room ? `, Raum ${entry.room}` : ""}` : "frei";
  return `${when}: ${what}${edited ? ", selbst geändert" : ""}`;
}

function cellHtml(week, dow, block, row, col, edits) {
  const key = cellKey(week, dow, block.n);
  const entry = lessonAt(week, dow, block.n);
  const edited = imported && Object.hasOwn(edits, key);
  const classes = ["plan-cell"];
  if (!entry) classes.push("is-free");
  if (edited) classes.push("is-edited");
  if (plan.editing?.key === key) classes.push("is-selected");
  const attrs = `class="${classes.join(" ")}" data-row="${row}" data-col="${col}" data-key="${key}" tabindex="${plan.row === row && plan.col === col ? 0 : -1}" aria-label="${esc(cellLabel(dow, block, entry, edited))}"`;
  const mark = edited ? `<span class="plan-mark" aria-hidden="true"></span>` : "";
  if (!entry) {
    return `<td class="plan-slot"><button type="button" ${attrs}><span class="plan-free" aria-hidden="true">frei</span><span class="plan-add" aria-hidden="true">${icon("plus")}</span>${mark}</button></td>`;
  }
  const info = subject(entry.subject);
  return `<td class="plan-slot"><button type="button" ${attrs} style="--hue:${hueVar(entry.subject)}"><span class="plan-subject" aria-hidden="true" data-full="${esc(info.label)}" data-mid="${esc(info.label.replace(/\s+(LK|GK)$/, ""))}" data-short="${esc(info.short)}">${esc(info.label)}</span><span class="plan-room" aria-hidden="true">${esc(entry.room)}</span>${mark}</button></td>`;
}

function gridHtml() {
  const edits = readEdits();
  const head = DAYS.map((dow) => `<th scope="col" class="plan-day"><span aria-hidden="true">${WEEKDAYS_SHORT[dow]}</span><span class="visually-hidden">${WEEKDAYS[dow]}</span></th>`).join("");
  const word = period();
  const body = planBlocks().map((block, row) => `<tr><th scope="row" class="plan-block"><span class="plan-block-num" aria-hidden="true">${block.n}</span><span class="plan-block-time" aria-hidden="true">${hm(block.start)}<br>${hm(block.end)}</span><span class="visually-hidden">${block.n}. ${word}, ${hm(block.start)} bis ${hm(block.end)}</span></th>${DAYS.map((dow, col) => cellHtml(plan.week, dow, block, row, col, edits)).join("")}</tr>`).join("");
  return `<thead><tr><th scope="col" class="plan-corner"><span class="visually-hidden">${word}</span></th>${head}</tr></thead><tbody>${body}</tbody>`;
}

const currentCell = () => $("planGrid").querySelector(`.plan-cell[data-row="${plan.row}"][data-col="${plan.col}"]`);

function fitLabels() {
  const labels = [...$("planGrid").querySelectorAll(".plan-subject")];
  labels.forEach((node) => {
    if (node.textContent !== node.dataset.full) node.textContent = node.dataset.full;
  });
  ["mid", "short"].forEach((step) => {
    labels.filter((node) => node.scrollWidth > node.clientWidth + 0.5).forEach((node) => {
      if (node.dataset[step] && node.textContent !== node.dataset[step]) node.textContent = node.dataset[step];
    });
  });
}

function flashCell(key) {
  if (!animates()) return;
  const node = $("planGrid").querySelector(`.plan-cell[data-key="${key}"]`);
  if (!node) return;
  node.classList.remove("is-flash");
  void node.offsetWidth;
  node.classList.add("is-flash");
  node.addEventListener("animationend", () => node.classList.remove("is-flash"), { once: true });
}

function renderPlan({ flash = [] } = {}) {
  const grid = $("planGrid");
  const hadFocus = grid.contains(document.activeElement);
  plan.row = Math.min(plan.row, planBlocks().length - 1);
  if (!abWeeks()) plan.week = "A";
  grid.setAttribute("aria-label", abWeeks() ? `Stundenplan der ${plan.week}-Woche` : "Stundenplan");
  grid.innerHTML = gridHtml();
  fitLabels();
  if (hadFocus) currentCell()?.focus({ preventScroll: true });
  flash.filter((key) => key.startsWith(`${plan.week}:`)).forEach(flashCell);
  renderWeeks();
  renderRhythm();
  renderAb();
  renderPlanMeta();
}

function renderAb() {
  const on = abWeeks();
  const top = $("planTop");
  const appears = on && top.hidden;
  top.hidden = !on;
  $("copyWeek").hidden = !on;
  if (appears) enterInPlace(top);
}

function setAbWeeks(on) {
  storage.set(LOCAL_KEYS.abWeeks, on);
  plan.week = on ? weekType(now()) : "A";
  applySchoolEdits();
  renderPlan();
  renderCatalog();
  renderNotify();
  renderDataMeta();
}

function toggleAbWeeks() {
  const before = abWeeks();
  setAbWeeks(!before);
  toast(before ? "A/B-Wochen aus, jede Woche gilt jetzt derselbe Plan" : `A/B-Wochen an, KW\u00a0${isoWeek(now())} ist eine ${weekType(now())}-Woche`, {
    icon: "table-2",
    action: { label: "Rückgängig", undo: true, run: () => {
      setAbWeeks(before);
      say("Rückgängig gemacht");
    } },
  });
}

function renderWeeks() {
  const current = weekType(now());
  const node = $("planWeeks");
  keepFocus(node, () => {
    node.innerHTML = ["A", "B"].map((week) => `<button type="button" id="week-${week}" data-week="${week}" aria-pressed="${plan.week === week}"${week === current ? ` aria-label="${week}-Woche, diese Woche"` : ""}>${week}-Woche${week === current ? `<span class="seg-count" aria-hidden="true">diese Woche</span>` : ""}</button>`).join("");
  });
}

function renderRhythm() {
  const on = abWeeks();
  const today = now();
  const swapped = storage.get(LOCAL_KEYS.abSwap) === true;
  const desc = on
    ? `Zwei Pläne im Wechsel. KW\u00a0${isoWeek(today)} ist eine <b>${weekType(today)}-Woche</b>${swapped ? ", selbst getauscht" : ""}.`
    : "Jede Woche gilt derselbe Plan. Der Plan der B-Woche bleibt gespeichert und ist beim Einschalten wieder da.";
  const card = $("rhythmCard");
  keepFocus(card, () => {
    card.innerHTML = `<div class="set-row" id="rowAb"><div class="set-row-text"><p class="set-row-label" id="rowAbLabel">A/B-Wochen</p><p class="set-row-desc" id="rowAbDesc">${desc}</p>${on ? `<button class="text-button row-action" type="button" id="abSwap">${icon("arrow-left-right")}<span>A und B tauschen</span></button>` : ""}</div><div class="set-row-control">${switchHtml("abToggle", on, "rowAbLabel", { describedBy: "rowAbDesc" })}</div></div>`;
  });
}

function renderPlanMeta() {
  const count = imported ? Object.keys(readEdits()).filter(visibleEdit).length : 0;
  const lessons = shownWeeks().map((week) => Object.values(data.timetable[week] || {}).reduce((all, entries) => all + entries.length, 0));
  const total = lessons.length > 1 ? `${plural(lessons[0], "Stunde", "Stunden")} in der A-Woche, ${lessons[1]} in der B-Woche` : plural(lessons[0], "Stunde", "Stunden");
  $("planMeta").textContent = count ? `${plural(count, "Stunde", "Stunden")} selbst geändert` : lessons.some(Boolean) ? total : "Noch leer";
  $("planLegend").hidden = !count;
  $("resetPlan").hidden = !count;
  const empty = $("planEmpty");
  if (empty) empty.hidden = hasPlan();
}

function swapGrid(direction, paint) {
  const grid = $("planGrid");
  grid.getAnimations().forEach((animation) => animation.cancel());
  if (!animates()) {
    paint();
    return;
  }
  const move = travels();
  const out = grid.animate(
    move ? [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-direction * 10}px)` }] : [{ opacity: 1 }, { opacity: 0 }],
    { duration: 110, easing: "ease-in", fill: "forwards" },
  );
  out.finished.then(() => {
    paint();
    out.cancel();
    grid.animate(
      move ? [{ opacity: 0, transform: `translateX(${direction * 14}px)` }, { opacity: 1, transform: "none" }] : [{ opacity: 0 }, { opacity: 1 }],
      { duration: move ? 260 : 150, easing: token("--ease-out") },
    );
  }, () => {});
}

function setWeek(week, { focus = false, flash = [] } = {}) {
  if (week === plan.week) return;
  const hadFocus = focus || $("planGrid").contains(document.activeElement);
  plan.week = week;
  renderWeeks();
  swapGrid(week === "B" ? 1 : -1, () => {
    renderPlan({ flash });
    if (hadFocus) currentCell()?.focus({ preventScroll: true });
  });
  say(`${week}-Woche`);
}

function focusCell(row, col) {
  const rows = planBlocks().length;
  plan.row = Math.max(0, Math.min(rows - 1, row));
  plan.col = Math.max(0, Math.min(4, col));
  $("planGrid").querySelectorAll(".plan-cell").forEach((node) => (node.tabIndex = -1));
  const target = currentCell();
  if (!target) return;
  target.tabIndex = 0;
  target.focus();
}

function clearCell(row, col) {
  const block = planBlocks()[row];
  const dow = DAYS[col];
  if (!block || !lessonAt(plan.week, dow, block.n)) return;
  plan.row = row;
  plan.col = col;
  const week = plan.week;
  commitPlan(
    (edits) => setLesson(edits, week, dow, block.n, null),
    () => `${WEEKDAYS_SHORT[dow]}., ${block.n}.\u00a0${period()}${weekTag(week)} ist jetzt frei`,
    "eraser",
  );
  currentCell()?.focus({ preventScroll: true });
}

function onGridKey(event) {
  const cell = event.target.closest?.(".plan-cell");
  if (!cell || event.altKey || event.metaKey) return;
  if (event.ctrlKey && !["Home", "End"].includes(event.key)) return;
  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  const rows = planBlocks().length;
  let next = null;
  if (event.key === "ArrowRight") next = [row, col + 1];
  else if (event.key === "ArrowLeft") next = [row, col - 1];
  else if (event.key === "ArrowDown") next = [row + 1, col];
  else if (event.key === "ArrowUp") next = [row - 1, col];
  else if (event.key === "Home") next = [event.ctrlKey ? 0 : row, 0];
  else if (event.key === "End") next = [event.ctrlKey ? rows - 1 : row, 4];
  else if ((event.key === "PageDown" || event.key === "PageUp") && abWeeks()) {
    event.preventDefault();
    setWeek(event.key === "PageDown" ? "B" : "A", { focus: true });
    return;
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    clearCell(row, col);
    return;
  }
  if (!next) return;
  event.preventDefault();
  focusCell(next[0], next[1]);
}

function copyWeek() {
  const changed = commitPlan(
    (edits) => DAYS.forEach((dow) => planBlocks().forEach((block) => setLesson(edits, "B", dow, block.n, lessonValue("A", dow, block.n)))),
    (keys) => `B-Woche wie A-Woche, ${plural(keys.length, "Stunde", "Stunden")} geändert`,
    "copy",
  );
  if (!changed.length) {
    toast("Die B-Woche ist schon wie die A-Woche.", { icon: "copy" });
    return;
  }
  if (plan.week !== "B") setWeek("B", { flash: changed });
}

function resetPlan() {
  const changed = commitPlan(
    (edits) => Object.keys(edits).filter(visibleEdit).forEach((key) => delete edits[key]),
    (keys) => `Stundenplan zurückgesetzt, ${plural(keys.length, "Änderung", "Änderungen")} verworfen`,
    "rotate-ccw",
  );
  if (changed.length) (abWeeks() ? $("copyWeek") : currentCell())?.focus({ preventScroll: true });
}

function setSwap(on) {
  if (on) storage.set(LOCAL_KEYS.abSwap, true);
  else removeKey(LOCAL_KEYS.abSwap);
  applySchoolEdits();
  renderPlan();
  renderDataMeta();
}

function swapWeeks() {
  const before = storage.get(LOCAL_KEYS.abSwap) === true;
  setSwap(!before);
  toast(`Getauscht: KW ${isoWeek(now())} ist jetzt eine ${weekType(now())}-Woche`, {
    icon: "arrow-left-right",
    action: { label: "Rückgängig", undo: true, run: () => {
      setSwap(before);
      say("Rückgängig gemacht");
    } },
  });
}

const sheet = $("cellSheet");
const form = $("cellForm");

function roomsOf(key) {
  const counts = new Map();
  [data.timetable, schoolDefaults.timetable].forEach((table) => Object.values(table).forEach((days) => Object.values(days).forEach((entries) => entries.forEach((entry) => {
    if (entry.subject === key && entry.room) counts.set(entry.room, (counts.get(entry.room) || 0) + 1);
  }))));
  const used = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([room]) => room);
  return [...new Set([data.subjects[key]?.room, ...used].filter(Boolean))].slice(0, 4);
}

function teacherChoices(key, selected) {
  const own = key ? data.subjects[key]?.teacher || NO_TEACHER : "";
  return `<option value="">${key ? `Wie im Fach: ${esc(own)}` : "Wie im Fach"}</option>${sortedTeachers().map((teacher) => `<option value="${esc(teacher.id)}"${teacher.id === selected ? " selected" : ""}>${esc(teacher.label)}</option>`).join("")}`;
}

function subjectGroups() {
  const keys = activeSubjectKeys().sort((a, b) => subject(a).label.localeCompare(subject(b).label, "de"));
  return COURSE_GROUPS
    .map(([type, title]) => ({ title, keys: keys.filter((key) => courseType(key) === type) }))
    .filter((group) => group.keys.length);
}

function editorHtml({ week, dow, block, entry, base, edited }) {
  const chosen = entry?.subject || "";
  const own = readEdits()[cellKey(week, dow, block.n)];
  const override = own && entry && own.subject === entry.subject && data.teachers.some((teacher) => teacher.id === own.teacher) ? own.teacher : "";
  const baseName = base ? `${schoolDefaults.subjects[base.subject]?.label || subject(base.subject).label}${data.subjects[base.subject]?.retired ? ", gelöscht" : ""}` : "";
  const groups = subjectGroups().map((group) => `<fieldset class="pick-group"><legend class="pick-title${group.keys.length === 1 && subject(group.keys[0]).label === group.title ? " visually-hidden" : ""}">${esc(group.title)}</legend><div class="pick-grid">${group.keys.map((key) => `<label class="pick" style="--hue:${hueVar(key)}"><input type="radio" name="subject" value="${esc(key)}"${key === chosen ? " checked" : ""}><i class="subject-dot" aria-hidden="true"></i><span class="pick-name">${esc(subject(key).label)}</span>${icon("check", "pick-tick")}</label>`).join("")}</div></fieldset>`).join("");
  const origin = edited && imported
    ? `<p class="cell-origin">${icon("rotate-ccw")}<span>Vorher: ${base ? `${esc(baseName)}${base.room ? `, ${esc(base.room)}` : ""}` : "frei"}</span><button type="button" class="text-button" data-cell-origin><span>Wiederherstellen</span></button></p>`
    : "";
  const create = `<div class="cell-new"><label class="visually-hidden" for="cellNewSubject">Neues Fach</label><input class="field-control" id="cellNewSubject" maxlength="32" placeholder="${groups ? "Anderes Fach anlegen" : "Fach anlegen, z. B. Mathematik"}" autocomplete="off" enterkeyhint="done" aria-describedby="cellSubjectError"><button type="button" class="btn btn-quiet" data-cell-new>${icon("plus")}Anlegen</button></div>`;
  return `<div class="sheet-head cell-head">
      <div><h2 class="sheet-title" id="cellTitle">${WEEKDAYS[dow]}, ${block.n}.\u00a0${period()}</h2><p class="cell-when">${abWeeks() ? `${week}-Woche, ` : ""}${hm(block.start)} bis ${hm(block.end)}</p></div>
      <button class="icon-button" type="button" data-cell-close aria-label="Schließen">${icon("x")}</button>
    </div>
    <fieldset class="cell-subjects" aria-describedby="cellSubjectError"><legend class="cell-label">Fach</legend>${groups}${create}${errorHtml("cellSubjectError", "")}</fieldset>
    <div class="cell-room">
      <label class="cell-label" for="cellRoom">Raum <small>freiwillig</small></label>
      <div class="cell-room-row"><input class="field-control cell-room-input" id="cellRoom" name="room" value="${esc(entry?.room || "")}" maxlength="12" list="roomOptions" autocomplete="off" spellcheck="false" autocapitalize="characters" enterkeyhint="done" aria-describedby="cellRoomError"><div class="room-picks" id="roomPicks" role="group" aria-label="Räume dieses Fachs"></div></div>
      ${errorHtml("cellRoomError", "")}
    </div>
    <div class="cell-teacher-row">
      <label class="cell-label" for="cellTeacher">Lehrkraft</label>
      <select class="field-control" id="cellTeacher" name="teacher">${teacherChoices(chosen, override)}</select>
    </div>
    ${origin}
    <div class="sheet-actions cell-actions">
      ${entry ? `<button type="button" class="btn btn-quiet cell-clear" data-cell-clear>${icon("eraser")}Leeren</button>` : ""}
      <button type="button" class="btn btn-quiet" data-cell-close>Abbrechen</button>
      <button type="submit" class="btn btn-primary">Übernehmen</button>
    </div>`;
}

const chosenSubject = () => form.querySelector('input[name="subject"]:checked')?.value || "";

function normalizeRoom(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (/^[a-z]{1,3}[ -]?\d/i.test(text)) return text.toUpperCase();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

function syncEditor({ fill = false } = {}) {
  const key = chosenSubject();
  const input = $("cellRoom");
  const rooms = key ? roomsOf(key) : [];
  if (fill && !plan.roomTouched && rooms.length) input.value = rooms[0];
  const current = normalizeRoom(input.value);
  $("roomPicks").innerHTML = rooms.map((room) => `<button type="button" class="pill room-pick" data-room="${esc(room)}" aria-pressed="${room === current}">${esc(room)}</button>`).join("");
  const teacher = $("cellTeacher");
  if (teacher?.options[0]) teacher.options[0].textContent = key ? `Wie im Fach: ${data.subjects[key]?.teacher || NO_TEACHER}` : "Wie im Fach";
}

function rememberRoom(room) {
  if (!room || data.rooms.includes(room)) return;
  const rooms = roomStore();
  addRoom(rooms, room);
  saveStore(LOCAL_KEYS.rooms, rooms, false);
}

function placeEditor(node) {
  if (phone.matches || !node) {
    ["left", "top", "transform-origin"].forEach((name) => sheet.style.removeProperty(name));
    return;
  }
  const box = node.getBoundingClientRect();
  const width = sheet.offsetWidth;
  const height = sheet.offsetHeight;
  let left = box.right + 10;
  let origin = "left top";
  if (left + width > innerWidth - 12) {
    left = box.left - width - 10;
    origin = "right top";
  }
  if (left < 12) {
    left = Math.min(Math.max(12, box.left), innerWidth - width - 12);
    origin = "center top";
  }
  const top = Math.max(12, Math.min(box.top - 8, innerHeight - height - 12));
  sheet.style.left = `${Math.round(left)}px`;
  sheet.style.top = `${Math.round(top)}px`;
  sheet.style.transformOrigin = origin;
}

function openEditor(node) {
  const row = Number(node.dataset.row);
  const col = Number(node.dataset.col);
  const block = planBlocks()[row];
  const dow = DAYS[col];
  const week = plan.week;
  const key = cellKey(week, dow, block.n);
  const entry = lessonAt(week, dow, block.n);
  plan.row = row;
  plan.col = col;
  plan.editing = { key, week, dow, n: block.n };
  plan.roomTouched = false;
  form.innerHTML = editorHtml({ week, dow, block, entry, base: baseLesson(week, dow, block.n), edited: Object.hasOwn(readEdits(), key) });
  syncEditor();
  $("planGrid").querySelectorAll(".plan-cell").forEach((cell) => {
    cell.classList.toggle("is-selected", cell === node);
    cell.tabIndex = cell === node ? 0 : -1;
  });
  if (!sheet.matches(":popover-open")) sheet.showPopover();
  setBackdrop(true);
  placeEditor(node);
  (form.querySelector('input[name="subject"]:checked') || form.querySelector('input[name="subject"]'))?.focus({ preventScroll: true });
}

function closeEditor() {
  if (sheet.matches(":popover-open")) sheet.hidePopover();
}

function setBackdrop(on) {
  const modal = on && phone.matches;
  document.querySelectorAll(".shell, .topbar, .tabbar, .variant-switch").forEach((node) => (node.inert = modal));
  if (modal) sheet.setAttribute("aria-modal", "true");
  else sheet.removeAttribute("aria-modal");
}

function applyEditor(value, message, glyph) {
  const editing = plan.editing;
  if (!editing) return;
  commitPlan((edits) => setLesson(edits, editing.week, editing.dow, editing.n, value), message, glyph);
  closeEditor();
  currentCell()?.focus({ preventScroll: true });
}

function submitEditor() {
  const editing = plan.editing;
  if (!editing) return;
  const key = chosenSubject();
  const input = $("cellRoom");
  const room = normalizeRoom(input.value);
  input.value = room;
  const subjectError = key ? "" : form.querySelector('input[name="subject"]') ? "Wähl ein Fach aus." : "Leg zuerst ein Fach an.";
  setError(null, $("cellSubjectError"), subjectError);
  if (subjectError) {
    (form.querySelector('input[name="subject"]') || $("cellNewSubject"))?.focus();
    say(subjectError);
    return;
  }
  const label = subject(key).label;
  const chosenTeacher = $("cellTeacher")?.value || "";
  const teacher = chosenTeacher && chosenTeacher !== data.subjects[key]?.teacherId ? chosenTeacher : "";
  rememberRoom(room);
  applyEditor({ subject: key, room, teacher }, () => `${WEEKDAYS_SHORT[editing.dow]}., ${editing.n}.\u00a0${period()}${weekTag(editing.week)}: ${esc(label)}${room ? ` in ${esc(room)}` : ""}`, "check");
}

function addSubjectInEditor() {
  const editing = plan.editing;
  const input = $("cellNewSubject");
  if (!editing || !input) return;
  const name = input.value.replace(/\s+/g, " ").trim().slice(0, 32);
  if (!name) {
    setError(input, $("cellSubjectError"), "Gib dem Fach einen Namen, zum Beispiel Mathematik.");
    input.focus();
    return;
  }
  const active = activeSubjectKeys();
  let key = active.find((item) => plainName(data.subjects[item].label).toLowerCase() === name.toLowerCase()) || null;
  if (!key) {
    const hues = active.map((item) => data.subjects[item].hue);
    const shorts = active.map((item) => data.subjects[item].short);
    commitCatalog((draft) => {
      key = uniqueSubjectKey(draft, name);
      draft.subjects.items[key] = { custom: true, name, short: suggestShort(name, shorts), hue: pickHue(HUES[active.length % HUES.length], hues, HUES), type: "GK", teacher: "", room: "" };
    }, `${esc(name)} angelegt`, "plus");
  }
  const block = planBlocks().find((item) => item.n === editing.n);
  const room = $("cellRoom")?.value || "";
  form.innerHTML = editorHtml({ week: editing.week, dow: editing.dow, block, entry: { subject: key, room }, base: baseLesson(editing.week, editing.dow, editing.n), edited: Object.hasOwn(readEdits(), editing.key) });
  if (!lessonAt(editing.week, editing.dow, editing.n)) form.querySelector("[data-cell-clear]")?.remove();
  plan.roomTouched = !!room;
  syncEditor({ fill: true });
  form.querySelector(`input[name="subject"][value="${CSS.escape(key)}"]`)?.focus();
  say(`${name} gewählt`);
}

function bindEditor() {
  if (sheet.parentElement !== document.body) document.body.append(sheet);
  sheet.addEventListener("beforetoggle", (event) => {
    if (event.newState !== "closed") return;
    const hadFocus = sheet.contains(document.activeElement);
    setBackdrop(false);
    plan.editing = null;
    $("planGrid").querySelectorAll(".plan-cell.is-selected").forEach((cell) => cell.classList.remove("is-selected"));
    if (hadFocus) currentCell()?.focus({ preventScroll: true });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitEditor();
  });
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.target.id === "cellNewSubject") {
      event.preventDefault();
      addSubjectInEditor();
      return;
    }
    if (event.target.matches('input[type="radio"]') || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      submitEditor();
    }
  });
  form.addEventListener("change", (event) => {
    if (event.target.name !== "subject") return;
    setError(null, $("cellSubjectError"), "");
    syncEditor({ fill: true });
  });
  form.addEventListener("input", (event) => {
    if (event.target.id !== "cellRoom") return;
    plan.roomTouched = true;
    if (event.target.value.trim()) setError(event.target, $("cellRoomError"), "");
    const current = normalizeRoom(event.target.value);
    form.querySelectorAll(".room-pick").forEach((pick) => pick.setAttribute("aria-pressed", String(pick.dataset.room === current)));
  });
  form.addEventListener("click", (event) => {
    if (event.target.closest("[data-cell-close]")) {
      closeEditor();
      return;
    }
    if (event.target.closest("[data-cell-new]")) {
      addSubjectInEditor();
      return;
    }
    const pick = event.target.closest(".room-pick");
    if (pick) {
      const input = $("cellRoom");
      input.value = pick.dataset.room;
      plan.roomTouched = true;
      setError(input, $("cellRoomError"), "");
      form.querySelectorAll(".room-pick").forEach((node) => node.setAttribute("aria-pressed", String(node === pick)));
      return;
    }
    const editing = plan.editing;
    if (!editing) return;
    if (event.target.closest("[data-cell-clear]")) {
      applyEditor(null, () => `${WEEKDAYS_SHORT[editing.dow]}., ${editing.n}.\u00a0${period()}${weekTag(editing.week)} ist jetzt frei`, "eraser");
    } else if (event.target.closest("[data-cell-origin]")) {
      const base = baseLesson(editing.week, editing.dow, editing.n);
      applyEditor(base ? { subject: base.subject, room: base.room } : null, () => `${WEEKDAYS_SHORT[editing.dow]}., ${editing.n}.\u00a0${period()} wiederhergestellt`, "rotate-ccw");
    }
  });
  let frame = 0;
  const follow = () => {
    frame = 0;
    if (sheet.matches(":popover-open") && plan.editing) placeEditor(currentCell());
  };
  addEventListener("resize", () => (frame ||= requestAnimationFrame(follow)));
  addEventListener("scroll", () => (frame ||= requestAnimationFrame(follow)), { passive: true });
  phone.addEventListener("change", () => {
    if (!sheet.matches(":popover-open")) return;
    setBackdrop(true);
    placeEditor(currentCell());
  });
}

function bindPlan() {
  const grid = $("planGrid");
  grid.addEventListener("click", (event) => {
    const cell = event.target.closest(".plan-cell");
    if (cell) openEditor(cell);
  });
  grid.addEventListener("keydown", onGridKey);
  grid.addEventListener("focusin", (event) => {
    const cell = event.target.closest(".plan-cell");
    if (!cell) return;
    plan.row = Number(cell.dataset.row);
    plan.col = Number(cell.dataset.col);
    grid.querySelectorAll(".plan-cell").forEach((node) => (node.tabIndex = node === cell ? 0 : -1));
  });
  $("planWeeks").addEventListener("click", (event) => {
    const button = event.target.closest("[data-week]");
    if (button) setWeek(button.dataset.week);
  });
  $("rhythmCard").addEventListener("click", (event) => {
    if (event.target.closest("#abSwap")) swapWeeks();
    else if (event.target.closest("#abToggle")) toggleAbWeeks();
  });
  $("copyWeek").addEventListener("click", copyWeek);
  $("resetPlan").addEventListener("click", resetPlan);
  let fitFrame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(fitLabels);
  }).observe($("planFrame"));
  const deleteKey = $("planDeleteKey");
  if (deleteKey && platform.mac) {
    deleteKey.textContent = "⌫";
    deleteKey.setAttribute("aria-label", "Rückschritttaste");
  }
  bindEditor();
}

const raster = { errors: new Map(), blame: new Map(), confirm: false };
const DAY_END = 23 * 60 + 59;
const sortedBlocks = () => [...data.blocks].sort((a, b) => a.n - b.n);
const defaultBlock = (n) => schoolDefaults.blocks.find((block) => block.n === n);
const timeOf = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const blockOfKey = (key) => Number(key.split(":")[2]);

function sameTimes(list, other) {
  return list.length === other.length && list.every((block) => {
    const match = other.find((item) => item.n === block.n);
    return match && match.start === block.start && match.end === block.end;
  });
}

function rawOf(keys) {
  return Object.fromEntries(keys.map((key) => {
    const value = storage.get(key);
    return [key, value == null ? null : JSON.stringify(value)];
  }));
}

function blockLessons(n) {
  return shownWeeks().map((week) => DAYS.filter((dow) => lessonAt(week, dow, n)).length);
}

const blockCount = (n) => blockLessons(n).reduce((sum, count) => sum + count, 0);

function axisHtml(blocks) {
  if (!blocks.length) return "";
  const first = toMin(blocks[0].start);
  const last = toMin(blocks.at(-1).end);
  const from = Math.min(480, Math.floor(first / 60) * 60);
  const step = Math.max(900, last) - from > 600 ? 120 : 60;
  const to = from + Math.ceil((Math.max(900, last) - from) / step) * step;
  const span = to - from;
  const bars = blocks.map((block) => {
    const left = ((toMin(block.start) - from) / span) * 100;
    const width = ((toMin(block.end) - toMin(block.start)) / span) * 100;
    return `<span class="axis-bar" data-flip="axis-${block.n}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%">${block.n}</span>`;
  }).join("");
  const ticks = [];
  for (let minute = from; minute <= to; minute += step) ticks.push(`<span class="axis-tick" style="left:${(((minute - from) / span) * 100).toFixed(3)}%">${minute / 60}</span>`);
  return `<div class="axis-track">${bars}</div><div class="axis-ticks">${ticks.join("")}</div>`;
}

function rasterMeta(blocks) {
  const words = periodWords(blocks);
  if (!blocks.length) return `Noch keine ${words.many}`;
  return `${plural(blocks.length, words.one, words.many)}, ${hm(blocks[0].start)} bis ${hm(blocks.at(-1).end)}`;
}

function pauseText(block, next) {
  if (!next || !isClock(block.end) || !isClock(next.start)) return "";
  const pause = toMin(next.start) - toMin(block.end);
  if (pause < 0) return "";
  return pause ? `${minutesText(pause)} Pause` : "ohne Pause";
}

function rasterRowHtml(block, next) {
  const n = block.n;
  const pause = pauseText(block, next);
  return `<div class="raster-row" role="group" aria-labelledby="rasterName${n}" data-n="${n}">
      <span class="raster-num" aria-hidden="true">${n}</span>
      <span class="visually-hidden" id="rasterName${n}">${n}. ${period()}</span>
      <input class="field-control raster-input" type="time" id="rasterStart${n}" value="${block.start}" data-n="${n}" data-edge="start" aria-label="Beginn" aria-describedby="rasterError${n}" required>
      <span class="raster-to" aria-hidden="true">bis</span>
      <input class="field-control raster-input" type="time" id="rasterEnd${n}" value="${block.end}" data-n="${n}" data-edge="end" aria-label="Ende" aria-describedby="rasterError${n}" required>
      <span class="raster-len"><span id="rasterLen${n}">${minutesText(toMin(block.end) - toMin(block.start))}</span><span class="raster-saved" id="rasterSaved${n}" aria-hidden="true">${icon("check")}</span></span>
      ${errorHtml(`rasterError${n}`, "")}
    </div>${next ? `<p class="raster-pause${pause === "ohne Pause" ? " is-none" : ""}" id="rasterPause${n}">${pause}</p>` : ""}`;
}

function addState(blocks) {
  const words = periodWords(blocks);
  if (blocks.length >= MAX_BLOCKS) return { block: null, hint: `Höchstens ${MAX_BLOCKS}\u00a0${words.many} am Tag.` };
  const last = blocks.at(-1);
  if (!last) return { block: { n: 1, start: "08:00", end: "09:30" }, hint: "" };
  const length = toMin(last.end) - toMin(last.start);
  const gaps = blocks.slice(1).map((block, index) => toMin(block.start) - toMin(blocks[index].end)).filter((gap) => gap >= 0);
  const start = toMin(last.end) + (gaps.length ? Math.min(...gaps) : 10);
  const end = start + length;
  if (end > DAY_END) return { block: null, hint: `Nach ${hm(last.end)} passt ${words.none} ${words.one} mit ${length}\u00a0Minuten mehr in den Tag.` };
  return { block: { n: last.n + 1, start: timeOf(start), end: timeOf(end) }, hint: "" };
}

function removeText(block) {
  const counts = blockLessons(block.n);
  const [a = 0, b = 0] = counts;
  const total = a + b;
  const words = periodWords();
  if (!total) return `${words.inside} ${block.n}.\u00a0${words.one} steht nichts. ${words.it} verschwindet aus Stundenplan, Übersicht und Kalender.`;
  const one = total === 1;
  let where = "";
  if (counts.length > 1) where = a && b ? `, ${a} in der A-Woche und ${b} in der B-Woche` : one ? ` in der ${a ? "A" : "B"}-Woche` : `, alle in der ${a ? "A" : "B"}-Woche`;
  return `${words.inside} ${block.n}.\u00a0${words.one} ${one ? "steht" : "stehen"} ${plural(total, "Eintrag", "Einträge")}${where}. Beim Entfernen ${one ? "wird er" : "werden sie"} gelöscht.`;
}

function rasterFootHtml(blocks) {
  const last = blocks.at(-1);
  const add = addState(blocks);
  if (raster.confirm && blocks.length > 1) {
    return `<div class="form-confirm raster-confirm" id="rasterConfirm" role="alert"><p>${removeText(last)}</p><div class="set-form-actions"><button type="button" class="btn btn-quiet" id="rasterKeep">Behalten</button><button type="button" class="btn btn-quiet danger-button" id="rasterConfirmRemove">${icon("trash-2")}${last.n}.\u00a0${period()} entfernen</button></div></div>`;
  }
  const remove = blocks.length > 1 ? `<button class="btn btn-quiet raster-remove" type="button" id="rasterRemove" aria-expanded="false">${icon("trash-2")}${last.n}.\u00a0${period()} entfernen</button>` : "";
  return `<button class="btn btn-quiet raster-add" type="button" id="rasterAdd"${add.block ? "" : ` aria-disabled="true" aria-describedby="rasterAddHint"`}>${icon("plus")}${period()} hinzufügen</button>${remove}<p class="raster-hint" id="rasterAddHint"${add.hint ? "" : " hidden"}>${add.hint}</p>`;
}

function renderRasterFoot() {
  const foot = $("rasterFoot");
  if (!foot) return;
  keepFocus(foot, () => (foot.innerHTML = rasterFootHtml(sortedBlocks())));
  foot.classList.toggle("is-confirm", raster.confirm);
}

function renderRaster() {
  const card = $("rasterCard");
  const blocks = sortedBlocks();
  const custom = !sameTimes(blocks, schoolDefaults.blocks);
  raster.errors = new Map();
  raster.blame = new Map();
  if (blocks.length < 2) raster.confirm = false;
  keepFocus(card, () => {
    card.innerHTML = `<div class="set-card-head">
        <div><h3 class="set-card-title" id="rasterTitle">Stundenraster</h3><p class="set-card-meta" id="rasterMeta">${rasterMeta(blocks)}</p></div>
        <button class="text-button" type="button" id="rasterReset"${custom ? "" : " disabled"}>${icon("rotate-ccw")}<span>Standardraster</span></button>
      </div>
      <div class="raster-axis" id="rasterAxis" aria-hidden="true">${axisHtml(blocks)}</div>
      <div class="raster-list">${blocks.map((block, index) => rasterRowHtml(block, blocks[index + 1])).join("")}</div>
      <div class="raster-foot${raster.confirm ? " is-confirm" : ""}" id="rasterFoot">${rasterFootHtml(blocks)}</div>`;
  });
}

function refreshRaster() {
  renderRaster();
  renderPlan();
  renderCatalog();
  renderDataMeta();
}

function draftTimes() {
  return sortedBlocks().map((block) => ({ n: block.n, start: $(`rasterStart${block.n}`)?.value || "", end: $(`rasterEnd${block.n}`)?.value || "" }));
}

function timeErrors(list, edited) {
  const errors = new Map();
  const blame = new Map();
  const words = periodWords();
  const put = (n, edge, text) => {
    if (!errors.has(n)) errors.set(n, { edge, text });
  };
  const side = (key, fresh) => {
    const value = raster.blame.get(key) || fresh;
    blame.set(key, value);
    return value;
  };
  list.forEach((block, index) => {
    const prev = list[index - 1];
    const fallback = defaultBlock(block.n);
    if (!isClock(block.start)) put(block.n, "start", `Trag eine Uhrzeit ein, zum Beispiel ${hm(fallback?.start || "08:00")}.`);
    if (!isClock(block.end)) put(block.n, "end", `Trag eine Uhrzeit ein, zum Beispiel ${hm(fallback?.end || "09:30")}.`);
    if (isClock(block.start) && isClock(block.end) && toMin(block.end) <= toMin(block.start)) {
      if (side(`self-${block.n}`, edited?.n === block.n && edited.edge === "start" ? "start" : "end") === "start") put(block.n, "start", `Der Beginn muss vor dem Ende um ${hm(block.end)} liegen.`);
      else put(block.n, "end", `Das Ende muss nach dem Beginn um ${hm(block.start)} liegen.`);
    }
    if (prev && isClock(prev.end) && isClock(block.start) && toMin(block.start) < toMin(prev.end)) {
      if (side(`pair-${prev.n}`, edited?.n === prev.n && edited.edge === "end" ? "prev" : "next") === "prev") put(prev.n, "end", `Überschneidet sich mit ${words.dative} ${block.n}. ${words.one}, ${words.which} um ${hm(block.start)} beginnt.`);
      else put(block.n, "start", `Überschneidet sich mit ${words.dative} ${prev.n}. ${words.one}, ${words.which} bis ${hm(prev.end)} geht.`);
    }
  });
  errors.blame = blame;
  return errors;
}

function showTimeErrors(errors) {
  sortedBlocks().forEach((block) => {
    const error = errors.get(block.n);
    ["start", "end"].forEach((edge) => {
      const input = $(`raster${edge === "start" ? "Start" : "End"}${block.n}`);
      if (!input) return;
      if (error?.edge === edge) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    });
    setError(null, $(`rasterError${block.n}`), error?.text || "");
  });
  raster.errors = errors;
  raster.blame = errors.blame || new Map();
}

function updateRasterDerived(list, { axis = false } = {}) {
  list.forEach((block, index) => {
    const next = list[index + 1];
    const len = $(`rasterLen${block.n}`);
    if (len) len.textContent = isClock(block.start) && isClock(block.end) && toMin(block.end) > toMin(block.start) ? minutesText(toMin(block.end) - toMin(block.start)) : "";
    const pause = $(`rasterPause${block.n}`);
    if (pause) {
      const text = raster.errors.has(block.n) || (next && raster.errors.has(next.n)) ? "" : pauseText(block, next);
      pause.textContent = text;
      pause.classList.toggle("is-none", text === "ohne Pause");
    }
  });
  if (!axis) return;
  const blocks = sortedBlocks();
  $("rasterMeta").textContent = rasterMeta(blocks);
  const reset = $("rasterReset");
  const custom = !sameTimes(blocks, schoolDefaults.blocks);
  if (reset) reset.disabled = !custom;
  renderRasterFoot();
  flipKeyed("#rasterAxis .axis-bar", () => {
    $("rasterAxis").innerHTML = axisHtml(blocks);
  });
}

function savedTick(n) {
  const node = $(`rasterSaved${n}`);
  if (!node || !animates()) return;
  node.getAnimations().forEach((animation) => animation.cancel());
  const frames = travels()
    ? [{ opacity: 0, transform: "scale(0.6)" }, { opacity: 1, transform: "none", offset: 0.18 }, { opacity: 1, transform: "none", offset: 0.75 }, { opacity: 0, transform: "none" }]
    : [{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }];
  node.animate(frames, { duration: 1600, easing: "ease-out" });
}

function storeTimes(list) {
  saveBlocks(list);
  applySchoolEdits();
}

function commitTimes(edited) {
  const list = draftTimes();
  const errors = timeErrors(list, edited);
  const fresh = [...errors.entries()].find(([n, error]) => raster.errors.get(n)?.text !== error.text);
  showTimeErrors(errors);
  updateRasterDerived(list);
  if (errors.size) {
    if (fresh) say(fresh[1].text);
    return;
  }
  if (sameTimes(list, sortedBlocks())) return;
  storeTimes(list);
  updateRasterDerived(list, { axis: true });
  renderPlan();
  renderDataMeta();
  const block = list.find((item) => item.n === edited.n);
  if (block) {
    say(`${block.n}. ${period()}, ${hm(block.start)} bis ${hm(block.end)}, gespeichert`);
    savedTick(block.n);
  }
}

function dropBlockEdits(edits, numbers) {
  Object.keys(edits).forEach((key) => {
    if (numbers.includes(blockOfKey(key))) delete edits[key];
  });
  return edits;
}

function undoRaster(before) {
  restoreRaw(before);
  applySchoolEdits();
  raster.confirm = false;
  refreshRaster();
  say("Rückgängig gemacht");
}

function addBlock({ keyboard = false } = {}) {
  const blocks = sortedBlocks();
  const { block, hint } = addState(blocks);
  if (!block) {
    say(hint);
    return;
  }
  const before = rawOf([LOCAL_KEYS.blocks]);
  saveBlocks([...blocks, block]);
  applySchoolEdits();
  raster.confirm = false;
  refreshRaster();
  const row = $("rasterCard").querySelector(`.raster-row[data-n="${block.n}"]`);
  enterInPlace(row);
  if (keyboard) $(`rasterStart${block.n}`)?.focus();
  const lessons = blockCount(block.n);
  toast(`${block.n}. ${period()} angelegt, ${hm(block.start)} bis ${hm(block.end)}${lessons ? `, mit ${plural(lessons, "Eintrag", "Einträgen")}` : ""}`, {
    icon: "plus",
    action: { label: "Rückgängig", undo: true, run: () => undoRaster(before) },
  });
}

function askRemoveBlock(open) {
  raster.confirm = open;
  renderRasterFoot();
  $(open ? "rasterKeep" : "rasterRemove")?.focus({ preventScroll: true });
}

function removeBlock() {
  const blocks = sortedBlocks();
  if (blocks.length < 2) return;
  const last = blocks.at(-1);
  const lessons = blockCount(last.n);
  const word = period();
  const before = rawOf([LOCAL_KEYS.blocks, LOCAL_KEYS.lessons]);
  const edits = dropBlockEdits(readEdits(), [last.n]);
  saveBlocks(blocks.slice(0, -1));
  writeEdits(edits);
  raster.confirm = false;
  refreshRaster();
  ($("rasterRemove") || $("rasterAdd"))?.focus({ preventScroll: true });
  toast(`${last.n}.\u00a0${word} entfernt${lessons ? `, ${plural(lessons, "Eintrag", "Einträge")} gelöscht` : ""}`, {
    icon: "trash-2",
    action: { label: "Rückgängig", undo: true, run: () => undoRaster(before) },
  });
}

function resetTimes() {
  const extra = sortedBlocks().filter((block) => !defaultBlock(block.n)).map((block) => block.n);
  const lost = extra.reduce((sum, n) => sum + blockCount(n), 0);
  const before = rawOf([LOCAL_KEYS.blocks, LOCAL_KEYS.lessons]);
  removeKey(LOCAL_KEYS.blocks);
  writeEdits(dropBlockEdits(readEdits(), extra));
  raster.confirm = false;
  refreshRaster();
  $(`rasterStart${sortedBlocks()[0].n}`)?.focus({ preventScroll: true });
  const blocks = sortedBlocks();
  const words = periodWords(blocks);
  toast(`Standardraster, ${plural(blocks.length, words.one, words.many)} von ${hm(blocks[0].start)} bis ${hm(blocks.at(-1).end)}${lost ? `, ${plural(lost, "Eintrag", "Einträge")} gelöscht` : ""}`, {
    icon: "rotate-ccw",
    action: { label: "Rückgängig", undo: true, run: () => undoRaster(before) },
  });
}

function bindRaster() {
  const card = $("rasterCard");
  const fieldOf = (input) => ({ n: Number(input.dataset.n), edge: input.dataset.edge });
  card.addEventListener("input", (event) => {
    const input = event.target.closest(".raster-input");
    if (!input) return;
    const list = draftTimes();
    if (raster.errors.size) showTimeErrors(timeErrors(list, fieldOf(input)));
    updateRasterDerived(list);
  });
  card.addEventListener("focusout", (event) => {
    const input = event.target.closest(".raster-input");
    if (!input || event.relatedTarget?.closest?.(`.raster-row[data-n="${input.dataset.n}"]`)) return;
    commitTimes(fieldOf(input));
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && event.target.closest("#rasterConfirm")) {
      event.preventDefault();
      askRemoveBlock(false);
      return;
    }
    const input = event.target.closest(".raster-input");
    if (!input || event.key !== "Enter") return;
    event.preventDefault();
    commitTimes(fieldOf(input));
  });
  card.addEventListener("click", (event) => {
    if (event.target.closest("#rasterReset")) resetTimes();
    else if (event.target.closest("#rasterAdd")) addBlock({ keyboard: event.detail === 0 });
    else if (event.target.closest("#rasterRemove")) askRemoveBlock(true);
    else if (event.target.closest("#rasterKeep")) askRemoveBlock(false);
    else if (event.target.closest("#rasterConfirmRemove")) removeBlock();
  });
}

const school = { loading: null };
const stateName = (code) => (page.states || []).find((item) => item.code === code)?.name || code;

function gradeDesc(grade) {
  if (!grade) return "Daran hängt, ob du Noten oder Punkte bekommst";
  if (grade >= 11) return `${grade === page.school?.grade && page.school?.semester ? `${page.school.semester}, ` : ""}Bewertung in Punkten von 0 bis 15`;
  return "Bewertung in Noten von 1 bis 6";
}

// The server sends no grade while nobody said which class it is. Then only a saved choice counts.
const gradeKnown = () => !!page.school?.grade || Number.isInteger(storage.get(PREFS_KEY)?.school?.grade);

function renderSchool() {
  const card = $("schoolCard");
  const info = page.school || {};
  const grade = gradeKnown() ? Number(prefs.school.grade) : 0;
  const state = school.loading || prefs.school.state;
  const known = (page.states || []).some((item) => item.code === state);
  const rows = [
    info.name || info.town ? row({ id: "rowSchoolName", label: "Schule", desc: info.name ? "Aus deinem IServ-Konto" : "", control: `<span class="set-value">${esc(info.name || "")}<small>${esc(info.town || "")}</small></span>`, cls: "is-stack" }) : "",
    row({ id: "rowGrade", label: "Klassenstufe", forId: "gradeSelect", desc: gradeDesc(grade), control: `<select class="field-control" id="gradeSelect" aria-describedby="rowGradeDesc">${grade ? "" : '<option value="" selected disabled>Bitte wählen</option>'}${GRADES.map((value) => `<option value="${value}"${value === grade ? " selected" : ""}>Klasse ${value}</option>`).join("")}</select>` }),
    row({ id: "rowState", label: "Bundesland", forId: "stateSelect", desc: "Für Ferien und Feiertage im Kalender", control: `<select class="field-control" id="stateSelect" aria-describedby="rowStateDesc"${school.loading ? " disabled" : ""}>${known ? "" : '<option value="" selected disabled>Bitte wählen</option>'}${(page.states || []).map((item) => `<option value="${item.code}"${item.code === state ? " selected" : ""}>${esc(item.name)}</option>`).join("")}</select>`, cls: "is-stack" }),
    school.loading ? loadingHtml(`Lade Ferien und Feiertage für ${stateName(school.loading)}`, "Dauert nur einen Moment.") : "",
    row({ id: "rowBirthday", label: "Geburtstag", forId: "birthdayInput", desc: "Für passende Ticket-Empfehlungen im Fahrplan", cls: "is-stack", control: `<input class="field-control" type="date" id="birthdayInput" value="${esc(prefs.school.birthday || "")}" max="${isoDate(now())}" aria-describedby="rowBirthdayDesc">` }),
  ];
  keepFocus(card, () => (card.innerHTML = rows.join("")));
}

function changeGrade(value) {
  const before = gradeKnown() ? Number(prefs.school.grade) : 0;
  const grade = Number(value);
  if (!grade || grade === before) return;
  const switched = !!before && (before >= 11) !== (grade >= 11);
  commitPrefs(
    (draft) => (draft.school.grade = grade),
    renderSchool,
    switched ? `Klasse ${grade}: ${grade >= 11 ? "Punkte von 0 bis 15" : "Noten von 1 bis 6"}, bisherige Noten bleiben erhalten` : "",
    "graduation-cap",
  );
  if (!switched) say(`Klasse ${grade} gespeichert`);
}

async function changeState(code) {
  const before = prefs.school.state;
  if (!code || code === before) return;
  school.loading = code;
  renderSchool();
  try {
    const result = await request("POST", "/api/hub/bundesland", { bundesland: code });
    school.loading = null;
    prefs.school.state = code;
    savePrefs();
    renderSchool();
    toast(`Ferien und Feiertage für ${esc(stateName(code))} übernommen${result.imported_count ? ` (${result.imported_count} Einträge)` : ""}`, { icon: "calendar-days" });
  } catch (error) {
    school.loading = null;
    renderSchool();
    toast(`Ferien für ${esc(stateName(code))} ließen sich gerade nicht laden. Versuch es später noch einmal.`, { icon: "circle-alert" });
  }
  $("stateSelect")?.focus({ preventScroll: true });
}

function bindSchool() {
  const card = $("schoolCard");
  card.addEventListener("change", (event) => {
    if (event.target.id === "gradeSelect") changeGrade(event.target.value);
    else if (event.target.id === "stateSelect") changeState(event.target.value);
    else if (event.target.id === "birthdayInput") {
      prefs.school.birthday = event.target.value;
      savePrefs();
      say(event.target.value ? "Geburtstag gespeichert" : "Geburtstag entfernt");
    }
  });
}

const accounts = { connecting: null, syncing: false, report: null, formOpen: false };

function iservFormHtml() {
  const field = (name, label, attrs) => `<div class="form-field"><label class="form-label" for="iserv-${name}">${label}</label><input class="field-control" id="iserv-${name}" name="${name}" ${attrs} aria-describedby="iserv-${name}-error">${errorHtml(`iserv-${name}-error`, "")}</div>`;
  return `<form class="set-form" id="iservForm" novalidate>
      <p class="set-form-title">Mit IServ verbinden</p>
      <div class="set-form-grid">
        ${field("server", "Adresse deiner Schule", 'type="text" inputmode="url" placeholder="schule.de" spellcheck="false" autocapitalize="none" autocomplete="url"')}
        ${field("user", "Benutzername", 'type="text" placeholder="vorname.nachname" spellcheck="false" autocapitalize="none" autocomplete="username"')}
        ${field("password", "Passwort", 'type="password" autocomplete="current-password"')}
      </div>
      <p class="set-form-note">${icon("lock")}Das Passwort bleibt verschlüsselt auf diesem Gerät.</p>
      <div class="set-form-actions"><button type="button" class="btn btn-quiet" id="iservCancel">Abbrechen</button><button type="submit" class="btn btn-primary" id="iservSubmit">Verbinden</button></div>
    </form>`;
}

// What IServ gives in this app for sure, as the account card names it. Homework counts only once a sync brought some.
const ISERV_WORDS = { Vertretungsplan: "den Vertretungsplan", "E-Mail": "deine Mails" };

function partSentence(part, answer) {
  if (!answer) return "";
  // A failed part, and also a plan IServ has not or only as PDF, says so in the server's words.
  if (!answer.ok || answer.problem) return answer.message || "";
  const count = answer.count || 0;
  if (part === "plan") return `Der Vertretungsplan hat ${count === 1 ? "eine Seite" : `${count} Seiten`}.`;
  if (part === "homework") return count ? `${count === 1 ? "Eine offene Hausaufgabe" : `${count} offene Hausaufgaben`} aus IServ.` : "In IServ stehen keine offenen Hausaufgaben.";
  return count ? `${count === 1 ? "Eine ungelesene Mail" : `${count} ungelesene Mails`} in IServ.` : "Keine ungelesenen Mails in IServ.";
}

function renderIserv() {
  const card = $("iservCard");
  const info = page.accounts?.iserv || {};
  let html;
  if (accounts.connecting === "iserv") {
    html = loadingHtml("Verbinde mit IServ", "Das dauert ein paar Sekunden.");
  } else if (info.unavailable) {
    html = `<div class="empty-state set-empty">${luna("ruhe", 110)}<p class="empty-title">IServ geht im Browser nicht.</p><p class="empty-text">In der App für Mac, Windows, Linux und Android holt ${BRAND} den Vertretungsplan aus IServ.</p></div>`;
  } else if (prefs.iserv.connected) {
    const offline = flags.offline;
    const stand = syncTime("iserv");
    const status = offline ? `<span class="status is-offline">${icon("wifi-off")}Offline</span>` : `<span class="status is-ok">${icon("circle-check")}Verbunden</span>`;
    const parts = ["plan", "homework", "mail"].map((part) => [part, accounts.report?.[part]]).filter(([, answer]) => answer);
    // When IServ was out of reach, every part says so: once is enough.
    const report = !parts.length ? "" : !parts.some(([, answer]) => answer.ok)
      ? parts[0][1].message || "IServ ist gerade nicht erreichbar."
      : [...new Set(parts.map(([part, answer]) => partSentence(part, answer)).filter(Boolean))].join(" ");
    const detail = offline
      ? `Abgleichen geht erst wieder, wenn ${BRAND} läuft.`
      : `${stand ? `Stand ${stand} Uhr.` : "Noch nicht abgeglichen."}${report ? ` ${report}` : ""}`;
    html = row({
      id: "rowIserv",
      cls: "is-stack",
      label: `IServ ${status}`,
      desc: `Angemeldet als ${esc(info.name || "")}${info.school ? `, ${esc(info.school)}` : ""}. ${esc(detail)}`,
      control: `<button class="icon-button${accounts.syncing ? " is-spinning" : ""}" type="button" id="iservSync" aria-label="Jetzt mit IServ abgleichen" data-tip="Jetzt abgleichen"${offline || accounts.syncing ? " disabled" : ""}>${icon("refresh-cw")}</button><button class="btn btn-quiet" type="button" id="iservDisconnect">Trennen</button>`,
    });
  } else if (accounts.formOpen) {
    html = iservFormHtml();
  } else {
    const gives = (info.features || []).map((word) => ISERV_WORDS[word]).filter(Boolean);
    html = row({
      id: "rowIserv",
      cls: "is-stack",
      label: `IServ <span class="status is-off">Nicht verbunden</span>`,
      desc: gives.length ? `Damit holt ${BRAND} ${joinWords(gives)} von selbst.` : "",
      control: `<button class="btn btn-primary" type="button" id="iservConnect">Verbinden</button>`,
    });
  }
  keepFocus(card, () => (card.innerHTML = html));
  renderAccountsMeta();
}

const googleInfo = () => page.accounts?.google || {};
const schoolUi = { choice: false, busy: false };
const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i;

function standText(stamp) {
  const when = stamp ? new Date(stamp) : null;
  if (!when || Number.isNaN(when.getTime())) return "";
  const time = `${clock(when.getHours() * 60 + when.getMinutes())} Uhr`;
  return isoDate(when) === isoDate(now()) ? time : `${shortDate(when)}, ${time}`;
}

function googleHeader(info) {
  const stand = standText(info.stand);
  const states = {
    ok: [`<span class="status is-ok">${icon("circle-check")}Verbunden</span>`, stand ? `Stand ${stand}.` : "Der erste Abgleich läuft."],
    login: [
      `<span class="status is-warn">${icon("circle-alert")}Abgelaufen</span>`,
      `Die Anmeldung ist abgelaufen${stand ? `, du siehst den Stand von ${stand}` : ""}. ${info.configured ? `Verbinde Google neu, dann gleicht ${BRAND} wieder ab.` : "Neu verbinden geht in dieser Version nicht."}`,
    ],
    offline: [`<span class="status is-offline">${icon("wifi-off")}Offline</span>`, `Google ist gerade nicht erreichbar${stand ? `, du siehst den Stand von ${stand}` : ""}.`],
  };
  const [status, detail] = states[info.state] || states.ok;
  const renew = info.state === "login" && info.configured ? `<button class="btn btn-primary" type="button" id="googleRenew">Neu verbinden</button>` : "";
  return row({
    id: "rowGoogle",
    cls: "is-stack",
    label: `Google-Kalender ${status}`,
    desc: `${info.account ? `Angemeldet als ${esc(info.account)}. ` : ""}${detail}`,
    control: `${renew}<button class="btn btn-quiet" type="button" id="googleDisconnect">Trennen</button>`,
  });
}

function targetRow(info) {
  const writable = (info.calendars || []).filter((item) => item.writable);
  if (prefs.google.write === false || writable.length < 2) return "";
  const chosen = writable.some((item) => item.id === prefs.google.target) ? prefs.google.target : info.target;
  const options = writable.map((item) => `<option value="${esc(item.id)}"${item.id === chosen ? " selected" : ""}>${esc(item.name)}</option>`).join("");
  return row({ id: "rowGoogleTarget", cls: "is-stack", label: "Kalender für neue Termine", forId: "googleTarget", control: `<select class="field-control" id="googleTarget">${options}</select>` });
}

function schoolDesc(info, school) {
  const name = `„${esc(school.name)}“`;
  if (schoolUi.choice) return `Soll der Kalender ${name} in Google bleiben?`;
  if (!school.on) {
    if (school.removing) return `Der Kalender ${name} wird gelöscht, sobald Google erreichbar ist.`;
    if (school.notice === "gone") return `Du hast den Kalender ${name} in Google gelöscht. Schalte das wieder ein, dann legt ${BRAND} ihn neu an.`;
    if (school.notice === "kept") return `Google hat das Löschen abgelehnt. Der Kalender ${name} bleibt in Google, dort kannst du ihn selbst löschen.`;
    if (!info.configured && !info.may_make_calendars) return "Geht in dieser Version nicht.";
    if (info.state === "login") return "Geht wieder, sobald Google neu verbunden ist.";
    return `${BRAND} legt dafür den Kalender ${name} an und trägt die nächsten vier Wochen ein.`;
  }
  if (school.problem === "limit") return `Google bremst gerade. Den Rest trägt ${BRAND} etwas später ein.`;
  if (school.problem === "offline") return `Google ist gerade nicht erreichbar. ${BRAND} versucht es weiter.`;
  if (school.problem === "scope") return "Google erlaubt den eigenen Kalender nicht mehr. Schalte das aus und wieder ein.";
  if (school.busy) return `Wird in ${name} eingetragen …`;
  return `${plural(school.count, "Eintrag", "Einträge")} in ${name}${school.stand ? `, Stand ${standText(school.stand)}` : ""}.`;
}

function schoolRow(info) {
  const school = info.school || { on: false, name: `${BRAND} Schule` };
  const blocked = !school.on && (info.state === "login" || (!info.configured && !info.may_make_calendars));
  const choice = schoolUi.choice
    ? `<div class="set-form-actions"><button type="button" class="btn btn-quiet" id="schoolCancel">Abbrechen</button><button type="button" class="btn btn-quiet danger-button" id="schoolDelete">Löschen</button><button type="button" class="btn btn-primary" id="schoolKeep">Behalten</button></div>`
    : "";
  return row({
    id: "rowGoogleSchool",
    cls: schoolUi.choice ? "is-stack" : "",
    label: "Stundenplan und Tests in Google eintragen",
    desc: schoolDesc(info, school),
    control: choice || switchHtml("googleSchool", !!school.on, "rowGoogleSchoolLabel", { describedBy: "rowGoogleSchoolDesc", disabled: blocked || schoolUi.busy }),
  });
}

function gmailRow(info) {
  if (info.gmail) {
    return row({ id: "rowGmail", label: `Gmail <span class="status is-ok">${icon("circle-check")}Verbunden</span>`, desc: "Deine Mails stehen unter E-Mail." });
  }
  if (!info.configured || info.state === "login") return "";
  return row({
    id: "rowGmail",
    cls: "is-stack",
    label: "Gmail",
    desc: `Lies und schreib deine Gmail-Mails in ${BRAND}. Dafür fragt Google einmal nach.`,
    control: `<button class="btn btn-quiet" type="button" id="gmailAdd">Gmail hinzufügen</button>`,
  });
}

function calendarList(info) {
  const calendars = info.calendars || [];
  if (!calendars.length) return "";
  const swatch = (item) => (SAFE_COLOR.test(item.color || "") ? item.color : "var(--line-strong)");
  return `<div class="set-sub" role="group" aria-label="Kalender">${calendars.map((item) => `<div class="set-row"><span class="cal-swatch" style="--k:${swatch(item)}" aria-hidden="true"></span><span class="set-row-label" id="gcal-${esc(item.id)}-label">${esc(item.name)}</span>${switchHtml(`gcal-${esc(item.id)}`, prefs.google.calendars[item.id] !== false, `gcal-${esc(item.id)}-label`)}</div>`).join("")}</div>`;
}

function renderGoogle() {
  const card = $("googleCard");
  const info = googleInfo();
  let html;
  if (accounts.connecting === "google") {
    html = `${loadingHtml("Warte auf Google", "Melde dich im Browser an. Danach geht es hier von selbst weiter.")}<div class="set-form-actions"><button type="button" class="btn btn-quiet" id="googleCancel">Abbrechen</button></div>`;
  } else if (info.unavailable) {
    html = `<div class="empty-state set-empty">${luna("ruhe", 110)}<p class="empty-title">Google-Kalender gibt es in der App noch nicht.</p><p class="empty-text">Termine, die du hier einträgst, bleiben auf diesem Gerät.</p></div>`;
  } else if (!prefs.google.connected && !info.configured) {
    html = `<div class="empty-state set-empty">${luna("ruhe", 110)}<p class="empty-title">Google-Kalender gibt es in dieser Version nicht.</p><p class="empty-text">Termine, die du in ${BRAND} einträgst, bleiben auf diesem Gerät.</p></div>`;
  } else if (!prefs.google.connected) {
    html = `<div class="empty-state set-empty">${luna("ruhe", 110)}<p class="empty-title">Kein Google-Kalender verbunden.</p><p class="empty-text">Gym, Fahrstunden und private Termine stehen dann neben dem Stundenplan.</p><button type="button" class="empty-action" id="googleConnect">Konto verbinden${icon("chevron-right")}</button></div>`;
  } else {
    html = googleHeader(info) + row({
      id: "rowGoogleWrite",
      label: "Eigene Termine eintragen",
      desc: `Was du in ${BRAND} einträgst oder änderst, steht auch in deinem Google-Kalender.`,
      control: switchHtml("googleWrite", prefs.google.write !== false, "rowGoogleWriteLabel", { describedBy: "rowGoogleWriteDesc" }),
    }) + targetRow(info) + schoolRow(info) + gmailRow(info) + calendarList(info);
  }
  keepFocus(card, () => (card.innerHTML = html));
  renderAccountsMeta();
}

function renderAccountsMeta() {
  const iserv = prefs.iserv.connected;
  const google = prefs.google.connected;
  const offered = google || googleInfo().configured;
  const expired = google && googleInfo().state === "login";
  const text = expired
    ? (iserv ? "IServ verbunden, Google abgelaufen" : "Google abgelaufen, IServ nicht")
    : iserv && google ? "IServ und Google verbunden" : iserv ? (offered ? "IServ verbunden, Google nicht" : "IServ verbunden") : google ? "Google verbunden, IServ nicht" : "Nichts verbunden";
  $("accountsMeta").textContent = text;
}

function validateIserv(formNode) {
  const values = Object.fromEntries(["server", "user", "password"].map((name) => [name, formNode.elements[name].value.trim()]));
  const server = values.server.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const errors = {
    server: !server ? "Trag die Adresse ein, zum Beispiel schule.de." : !/^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+$/u.test(server) ? "Die Adresse braucht einen Punkt, zum Beispiel schule.de." : "",
    user: values.user ? "" : "Trag deinen Benutzernamen ein.",
    password: values.password ? "" : "Trag dein Passwort ein.",
  };
  Object.entries(errors).forEach(([name, text]) => setError(formNode.elements[name], $(`iserv-${name}-error`), text));
  const first = Object.keys(errors).find((name) => errors[name]);
  if (first) {
    formNode.elements[first].focus();
    say(errors[first]);
    return false;
  }
  return true;
}

async function connectIserv(formNode) {
  const server = formNode.elements.server.value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const body = { iserv_url: `https://${server}`, username: formNode.elements.user.value.trim(), password: formNode.elements.password.value };
  accounts.connecting = "iserv";
  renderIserv();
  try {
    const result = await request("POST", "/api/iserv/connect", body);
    accounts.connecting = null;
    accounts.formOpen = false;
    accounts.report = null;
    page.accounts.iserv = { ...(page.accounts.iserv || {}), connected: true, name: result.user?.name || body.username, school: server };
    prefs.iserv.connected = true;
    data.status = { ...(data.status || {}), iserv: true };
    renderIserv();
    toast("Mit IServ verbunden", { icon: "circle-check" });
    $("iservSync")?.focus({ preventScroll: true });
    syncIserv();
  } catch (error) {
    accounts.connecting = null;
    accounts.formOpen = true;
    renderIserv();
    toast(`IServ hat die Anmeldung abgelehnt${error.message ? `: ${esc(error.message)}` : ""}.`, { icon: "circle-alert" });
    $("iserv-password")?.focus();
  }
}

// Fetches what IServ gives here and tells what came of each part. The time is the one the server noted.
async function syncIserv() {
  if (accounts.syncing) return;
  accounts.syncing = true;
  renderIserv();
  let result = null;
  try {
    result = await request("POST", "/api/ui/iserv/sync", {});
  } catch {}
  accounts.syncing = false;
  if (result?.status) {
    data.status = result.status;
    renderSync();
  }
  accounts.report = result?.parts || null;
  renderIserv();
  const reached = Object.values(result?.parts || {}).some((part) => part.ok);
  const stand = syncTime("iserv");
  const text = reached ? `Mit IServ abgeglichen${stand ? `, Stand ${stand} Uhr` : ""}` : "IServ ist gerade nicht erreichbar.";
  toast(text, { icon: reached ? "circle-check" : "wifi-off" });
  say(text);
  $("iservSync")?.focus({ preventScroll: true });
}

async function disconnectIserv() {
  try {
    await request("POST", "/api/iserv/disconnect", {});
    page.accounts.iserv = { ...(page.accounts.iserv || {}), connected: false, name: "", school: "" };
    prefs.iserv.connected = false;
    accounts.report = null;
    data.status = { ...(data.status || {}), iserv: false, synced: { ...(data.status?.synced || {}), iserv: null } };
    renderSync();
    renderIserv();
    toast("IServ getrennt", { icon: "wifi-off" });
    $("iservConnect")?.focus({ preventScroll: true });
  } catch {
    toast("IServ ließ sich gerade nicht trennen.", { icon: "circle-alert" });
  }
}

async function loadGoogleCalendars() {
  const info = googleInfo();
  if (!prefs.google.connected || info.calendars?.length) return;
  try {
    const result = await request("GET", "/api/calendar/google/calendars");
    const school = info.school?.on ? info.school.name : null;
    info.calendars = (result.calendars || []).filter((item) => item.name !== school).map((item) => ({
      id: item.id,
      name: item.name,
      color: item.color,
      primary: !!item.primary,
      writable: item.access_role === "owner" || item.access_role === "writer",
    }));
    renderGoogle();
  } catch {}
}

let googleWait = null;

function stopGoogleWait() {
  clearTimeout(googleWait);
  googleWait = null;
}

function waitForGoogle(state, done) {
  const until = Date.now() + 10 * 60 * 1000;
  const check = async () => {
    googleWait = null;
    if (accounts.connecting !== "google") return;
    let progress = null;
    try {
      progress = await request("GET", `/api/email/google/progress?state=${encodeURIComponent(state)}`);
    } catch {}
    if (accounts.connecting !== "google") return;
    if (!progress?.done && Date.now() < until) {
      googleWait = setTimeout(check, 1500);
    } else if (progress?.ok) {
      granted(done, progress.email);
    } else {
      stopGoogleWait();
      accounts.connecting = null;
      renderGoogle();
      toast(`Google-Anmeldung hat nicht geklappt: ${esc(progress?.error || "Die Anmeldung ist abgelaufen")}.`, { icon: "circle-alert" });
    }
  };
  googleWait = setTimeout(check, 1500);
}

function granted(done, email) {
  stopGoogleWait();
  accounts.connecting = null;
  fetch("/api/ui/google/nudge", { method: "POST", credentials: "same-origin" }).catch(() => {});
  done(email);
}

async function grantGoogle(features, done) {
  stopGoogleWait();
  accounts.connecting = "google";
  renderGoogle();
  try {
    const result = await request("POST", "/api/email/google/auth", { features });
    if (result.granted) {
      granted(done, result.email);
      return;
    }
    if (platform.desktop || !window.open(result.auth_url, "google-login", "width=600,height=700,popup=yes")) location.assign(result.auth_url);
    waitForGoogle(result.state, done);
  } catch (error) {
    accounts.connecting = null;
    renderGoogle();
    toast(`Google-Anmeldung ließ sich nicht starten${error.message ? `: ${esc(error.message)}` : ""}.`, { icon: "circle-alert" });
  }
}

async function reloadGoogle() {
  try {
    const result = await request("GET", "/api/ui/google/account");
    page.accounts.google = result.account;
    prefs.google.connected = !!result.account.connected;
  } catch {}
}

async function googleConnected() {
  const before = googleInfo();
  await reloadGoogle();
  const after = googleInfo();
  const lost = [
    before.gmail && !after.gmail ? "Gmail" : "",
    before.may_make_calendars && !after.may_make_calendars && before.school?.on ? "den Kalender für den Stundenplan" : "",
  ].filter(Boolean);
  renderGoogle();
  toast(lost.length ? `Google-Kalender verbunden, aber ohne ${joinWords(lost)}.` : "Google-Kalender verbunden", { icon: lost.length ? "circle-alert" : "calendar-days" });
  loadGoogleCalendars();
}

async function gmailAdded() {
  await reloadGoogle();
  renderGoogle();
  toast(googleInfo().gmail ? "Gmail ist verbunden" : "Google hat Gmail nicht freigegeben.", { icon: googleInfo().gmail ? "mail" : "circle-alert" });
  $("rowGmail")?.scrollIntoView({ block: "nearest" });
}

function cancelGoogle() {
  stopGoogleWait();
  accounts.connecting = null;
  renderGoogle();
  $("googleConnect")?.focus({ preventScroll: true });
}

addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.data?.type !== "google-oauth-success") return;
  if (accounts.connecting === "google" && !prefs.google.connected) granted(googleConnected, event.data.email);
});

let schoolWatch = null;

function setSchool(school) {
  page.accounts.google = { ...googleInfo(), school };
  renderGoogle();
  clearTimeout(schoolWatch);
  if (school.busy) schoolWatch = setTimeout(watchSchool, 2000);
}

async function watchSchool() {
  try {
    const result = await request("GET", "/api/ui/google/school");
    setSchool(result.school);
  } catch {}
}

async function startSchool() {
  schoolUi.busy = true;
  renderGoogle();
  const response = await fetch("/api/ui/google/school", { method: "POST", credentials: "same-origin" }).catch(() => null);
  const payload = response ? await response.json().catch(() => ({})) : {};
  schoolUi.busy = false;
  if (response?.ok && payload.school) {
    setSchool(payload.school);
    say("Stundenplan und Tests werden in Google eingetragen");
  } else if (payload.needs === "school") {
    grantGoogle(["school"], () => startSchool());
  } else {
    renderGoogle();
    toast(esc(payload.error || "Google ist gerade nicht erreichbar."), { icon: "circle-alert" });
  }
}

async function stopSchool(keep) {
  schoolUi.choice = false;
  schoolUi.busy = true;
  renderGoogle();
  try {
    const result = await request("DELETE", "/api/ui/google/school", { keep });
    if (keep && result.calendar) {
      prefs.google.calendars[result.calendar] = false;
      savePrefs();
    }
    schoolUi.busy = false;
    setSchool(result.school);
    toast(keep ? "Der Kalender bleibt in Google, eingetragen wird nichts mehr." : "Der Kalender wird in Google gelöscht.", { icon: "calendar-days" });
  } catch {
    schoolUi.busy = false;
    renderGoogle();
    toast("Das ließ sich gerade nicht ausschalten.", { icon: "circle-alert" });
  }
  $("googleSchool")?.focus({ preventScroll: true });
}

async function disconnectGoogle() {
  try {
    const result = await request("GET", "/api/email/google/accounts");
    for (const account of result.accounts || []) {
      await request("DELETE", `/api/email/google/remove/${encodeURIComponent(account.email)}`);
    }
    page.accounts.google = { configured: googleInfo().configured, connected: false, calendars: [] };
    prefs.google.connected = false;
    renderGoogle();
    toast("Google-Kalender getrennt", { icon: "calendar-days" });
    $("googleConnect")?.focus({ preventScroll: true });
  } catch {
    toast("Google ließ sich gerade nicht trennen.", { icon: "circle-alert" });
  }
}

function bindAccounts() {
  const iservCard = $("iservCard");
  iservCard.addEventListener("click", (event) => {
    if (event.target.closest("#iservSync")) syncIserv();
    else if (event.target.closest("#iservDisconnect")) {
      if (confirmTwice("iserv", event.target.closest("#iservDisconnect"))) disconnectIserv();
    } else if (event.target.closest("#iservConnect")) {
      accounts.formOpen = true;
      renderIserv();
      $("iserv-server")?.focus();
    } else if (event.target.closest("#iservCancel")) {
      accounts.formOpen = false;
      renderIserv();
      $("iservConnect")?.focus();
    }
  });
  iservCard.addEventListener("submit", (event) => {
    if (event.target.id !== "iservForm") return;
    event.preventDefault();
    if (validateIserv(event.target)) connectIserv(event.target);
  });
  $("googleCard").addEventListener("change", (event) => {
    if (event.target.id !== "googleTarget") return;
    prefs.google.target = event.target.value;
    savePrefs();
    const name = googleInfo().calendars?.find((item) => item.id === event.target.value)?.name || "";
    say(`Neue Termine landen in ${name}`);
  });
  iservCard.addEventListener("input", (event) => {
    const input = event.target.closest("#iservForm .field-control");
    if (input?.getAttribute("aria-invalid") === "true" && input.value.trim()) setError(input, $(`iserv-${input.name}-error`), "");
  });
  const googleCard = $("googleCard");
  googleCard.addEventListener("click", (event) => {
    if (event.target.closest("#googleConnect, #googleRenew")) grantGoogle(["calendar"], googleConnected);
    else if (event.target.closest("#gmailAdd")) grantGoogle(["gmail"], gmailAdded);
    else if (event.target.closest("#googleCancel")) cancelGoogle();
    else if (event.target.closest("#googleDisconnect")) {
      if (confirmTwice("google", event.target.closest("#googleDisconnect"))) disconnectGoogle();
    } else if (event.target.closest("#googleWrite")) {
      prefs.google.write = prefs.google.write === false;
      savePrefs();
      renderGoogle();
      $("googleWrite")?.focus({ preventScroll: true });
      say(prefs.google.write ? "Eigene Termine werden in Google eingetragen" : "Eigene Termine bleiben in der App");
    } else if (event.target.closest("#googleSchool")) {
      if (googleInfo().school?.on) {
        schoolUi.choice = true;
        renderGoogle();
        $("schoolKeep")?.focus({ preventScroll: true });
      } else {
        startSchool();
      }
    } else if (event.target.closest("#schoolKeep, #schoolDelete")) {
      stopSchool(!!event.target.closest("#schoolKeep"));
    } else if (event.target.closest("#schoolCancel")) {
      schoolUi.choice = false;
      renderGoogle();
      $("googleSchool")?.focus({ preventScroll: true });
    } else {
      const toggle = event.target.closest('[role="switch"][id^="gcal-"]');
      if (!toggle) return;
      const id = toggle.id.slice(5);
      prefs.google.calendars[id] = prefs.google.calendars[id] === false;
      savePrefs();
      renderGoogle();
    }
  });
}

function permission() {
  return "Notification" in window ? Notification.permission : "unsupported";
}

function appleDevice() {
  if (page.native || window.hubShell?.nativeNotifications) return null;
  if (/iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || ""))) return "iPad";
  return /iPhone|iPod/.test(navigator.userAgent) ? "iPhone" : null;
}

function onHomeScreen() {
  const views = [window];
  try {
    if (window.top !== window) views.push(window.top);
  } catch {}
  return views.some((view) => {
    try {
      return view.matchMedia("(display-mode: standalone)").matches || view.navigator.standalone === true;
    } catch {
      return false;
    }
  });
}

function unsupportedText() {
  const device = appleDevice();
  if (!device) return "Dieser Browser kann keine Erinnerungen zeigen.";
  if (onHomeScreen()) return `Für Erinnerungen braucht das ${device} iOS 16.4 oder neuer.`;
  return `Auf dem ${device} erinnert ${BRAND} nur vom Home-Bildschirm aus: In Safari auf Teilen tippen, dann „Zum Home-Bildschirm“.`;
}

function permissionRow() {
  const state = permission();
  const native = !!page.native || !!window.hubShell?.nativeNotifications;
  const device = appleDevice();
  const words = {
    granted: [device ? `${BRAND} darf Erinnerungen zeigen, auf dem ${device} aber nur, solange die App geöffnet ist.` : `${BRAND} darf Erinnerungen zeigen.`, `<span class="status is-ok">${icon("circle-check")}Erlaubt</span>`],
    default: [device ? `Das ${device} fragt einmal nach. Erinnerungen kommen nur, solange die App geöffnet ist.` : `${native ? "Das Gerät" : "Der Browser"} fragt einmal nach, danach meldet sich ${BRAND} vor Stunden, Tests und Abgaben.`, `<button class="btn btn-quiet" type="button" id="notifyAllow">${icon("bell")}Erlauben</button>`],
    denied: [native ? `Blockiert. Freigeben kannst du das in den Einstellungen des Geräts unter Mitteilungen für ${BRAND}.` : device ? `Blockiert. Freigeben kannst du das in den Einstellungen des ${device}s unter Mitteilungen für ${BRAND}.` : "Blockiert. Freigeben kannst du das in den Website-Einstellungen des Browsers.", `<span class="status is-warn">Blockiert</span>`],
    unsupported: [native ? "Dieses Gerät kann gerade keine Erinnerungen zeigen." : unsupportedText(), `<span class="status is-off">Nicht verfügbar</span>`],
  }[state];
  return row({ id: "rowPermission", label: native ? "Auf diesem Gerät" : device ? `Auf dem ${device}` : "Im Browser", desc: words[0], control: words[1] });
}

function renderNotify() {
  const card = $("notifyCard");
  const notify = prefs.notify;
  const off = !notify.enabled;
  keepFocus(card, () => {
    card.innerHTML = [
      permissionRow(),
      row({ id: "rowNotifyAll", label: "Erinnerungen", desc: `Alle Erinnerungen von ${BRAND} an oder aus`, control: switchHtml("notifyEnabled", notify.enabled, "rowNotifyAllLabel", { describedBy: "rowNotifyAllDesc" }) }),
      row({ id: "rowNotifySound", label: "Ton", desc: "Kurzer Ton bei jeder Erinnerung", cls: off ? "is-muted" : "", control: switchHtml("notifySound", notify.sound, "rowNotifySoundLabel", { disabled: off, describedBy: "rowNotifySoundDesc" }) }),
      row({ id: "rowQuiet", label: "Ruhezeit", desc: `In dieser Zeit bleibt ${BRAND} still`, cls: off ? "is-stack is-muted" : "is-stack", control: `<input class="field-control" type="time" id="quietFrom" value="${notify.quiet.from}" aria-label="Ruhezeit ab" aria-describedby="quietError"${off ? " disabled" : ""}><span class="set-to" aria-hidden="true">bis</span><input class="field-control" type="time" id="quietTo" value="${notify.quiet.to}" aria-label="Ruhezeit bis" aria-describedby="quietError"${off ? " disabled" : ""}>${errorHtml("quietError", "")}` }),
      row({ id: "rowNotifyTest", label: "Probe-Erinnerung", desc: `So sieht die Erinnerung vor der nächsten Stunde aus: ${esc(nextLessonText())}`, control: `<button class="btn btn-quiet" type="button" id="notifyTest">${icon("bell-ring")}Senden</button>` }),
    ].join("");
  });
  renderKinds();
  renderNotifyMeta();
}

function renderKinds() {
  const card = $("notifyKinds");
  const off = !prefs.notify.enabled;
  const items = page.notifications?.categories || [];
  keepFocus(card, () => {
    card.innerHTML = `<div class="set-card-head kinds-head"><div><h3 class="set-card-title">Erinnern an</h3><p class="set-card-meta">${off ? "Erinnerungen sind aus" : `Wann ${BRAND} sich meldet`}</p></div></div>` + items.map((item) => {
      const state = prefs.notify.categories[item.key] || { on: false };
      const id = `kind-${item.key}`;
      const lead = item.leads ? `<div class="kind-lead"><label class="visually-hidden" for="${id}-lead">${esc(item.label)}, wann</label><select class="field-control" id="${id}-lead"${off || !state.on ? " disabled" : ""}>${item.leads.map(([value, text]) => `<option value="${value}"${Number(state.lead) === value ? " selected" : ""}>${esc(text)}</option>`).join("")}</select></div>` : "";
      return `<div class="set-row kind-row${off || !state.on ? " is-muted" : ""}" id="${id}-row"><div class="set-row-text"><p class="set-row-label" id="${id}-rowLabel">${esc(item.label)}</p><p class="set-row-desc" id="${id}-rowDesc">${esc(item.detail)}</p></div>${lead}<div class="kind-switch">${switchHtml(id, !!state.on, `${id}-rowLabel`, { disabled: off, describedBy: `${id}-rowDesc` })}</div></div>`;
    }).join("");
  });
}

function renderNotifyMeta() {
  const notify = prefs.notify;
  $("notifyMeta").textContent = notify.enabled ? `An, still von ${hm(notify.quiet.from)} bis ${hm(notify.quiet.to)} Uhr` : "Aus";
}

function nextLessonText() {
  const today = now();
  const minute = minutesOf(today);
  const lesson = lessonsFor(today).find((item) => !item.cancelled && item.startMin > minute) || nextSchoolDay(today)?.lessons[0];
  if (!lesson) return "Deutsch um 8:00 in R204.";
  return `${subject(lesson.subject).label} um ${hm(lesson.start)} in ${lesson.room}.`;
}

async function allowNotifications() {
  if (permission() !== "default") return;
  try {
    await Notification.requestPermission();
  } catch {}
  if (permission() === "granted" && !prefs.notify.enabled) {
    prefs.notify.enabled = true;
    savePrefs();
  }
  renderNotify();
  $("notifyTest")?.focus({ preventScroll: true });
  if (permission() === "granted") toast("Erinnerungen sind an.", { icon: "bell" });
}

function sendTest() {
  const state = permission();
  if (state === "unsupported") {
    toast(esc(unsupportedText()), { icon: "bell" });
    return;
  }
  if (state !== "granted") {
    toast(page.native ? "Erlaub Erinnerungen zuerst auf diesem Gerät." : "Erlaub Erinnerungen zuerst im Browser.", { icon: "bell" });
    return;
  }
  try {
    new Notification(BRAND, { body: nextLessonText(), icon: "/static/app/img/hora-favicon.svg", silent: !prefs.notify.sound });
    toast("Probe gesendet", { icon: "bell-ring" });
  } catch {
    toast("Die Probe hat nicht geklappt.", { icon: "bell" });
  }
}

function changeQuiet() {
  const from = $("quietFrom");
  const to = $("quietTo");
  const error = !isClock(from.value) || !isClock(to.value)
    ? "Trag beide Uhrzeiten ein, zum Beispiel 22:00 bis 7:00."
    : from.value === to.value ? "Anfang und Ende dürfen nicht gleich sein." : "";
  setError(!isClock(from.value) ? from : !isClock(to.value) ? to : error ? to : null, $("quietError"), error);
  if (!error) [from, to].forEach((input) => input.removeAttribute("aria-invalid"));
  if (error) {
    say(error);
    return;
  }
  prefs.notify.quiet = { from: from.value, to: to.value };
  savePrefs();
  renderNotifyMeta();
  say(`Ruhezeit von ${hm(from.value)} bis ${hm(to.value)} Uhr gespeichert`);
}

function bindNotify() {
  document.addEventListener("reminders:on", () => {
    prefs.notify.enabled = true;
    renderNotify();
  });
  const card = $("notifyCard");
  card.addEventListener("click", (event) => {
    if (event.target.closest("#notifyAllow")) allowNotifications();
    else if (event.target.closest("#notifyTest")) sendTest();
    else if (event.target.closest("#notifyEnabled")) {
      prefs.notify.enabled = !prefs.notify.enabled;
      savePrefs();
      renderNotify();
      say(prefs.notify.enabled ? "Erinnerungen an" : "Erinnerungen aus");
    } else if (event.target.closest("#notifySound")) {
      prefs.notify.sound = !prefs.notify.sound;
      savePrefs();
      renderNotify();
    }
  });
  card.addEventListener("change", (event) => {
    if (event.target.id === "quietFrom" || event.target.id === "quietTo") changeQuiet();
  });
  const kinds = $("notifyKinds");
  kinds.addEventListener("click", (event) => {
    const toggle = event.target.closest('[role="switch"][id^="kind-"]');
    if (!toggle) return;
    const key = toggle.id.slice(5);
    const state = prefs.notify.categories[key] ||= { on: false, lead: null };
    state.on = !state.on;
    savePrefs();
    renderKinds();
  });
  kinds.addEventListener("change", (event) => {
    const select = event.target.closest('select[id^="kind-"]');
    if (!select) return;
    const key = select.id.slice(5, -5);
    const state = prefs.notify.categories[key] ||= { on: true, lead: null };
    state.lead = Number(select.value);
    savePrefs();
    say(`${select.selectedOptions[0]?.textContent || ""} gespeichert`);
  });
}

const launch = { state: null, busy: false };

function launchDesc(state) {
  if (!state.pending) return `${BRAND} startet nach dem Anmelden von selbst, damit Erinnerungen auch nach einem Neustart kommen.`;
  return systemName() === "Windows"
    ? `Windows hat den Autostart für ${BRAND} abgeschaltet. Schalte ihn in den Einstellungen unter Apps › Autostart wieder ein.`
    : `macOS wartet noch auf deine Erlaubnis. Schalte ${BRAND} in den Systemeinstellungen unter Allgemein › Anmeldeobjekte ein.`;
}

function renderLaunch() {
  const state = launch.state;
  let card = $("launchCard");
  if (!state?.supported) {
    card?.remove();
    return;
  }
  if (!card) {
    card = Object.assign(document.createElement("div"), { className: "set-card", id: "launchCard" });
    $("notifyKinds").after(card);
  }
  const settings = state.pending && typeof window.hubShell?.openLoginItems === "function"
    ? `<button class="text-button row-action" type="button" id="launchSettings">${icon("settings")}<span>${systemName() === "Windows" ? "Einstellungen" : "Systemeinstellungen"} öffnen</span></button>`
    : "";
  keepFocus(card, () => {
    card.innerHTML = `<div class="set-row" id="rowLaunch"><div class="set-row-text"><p class="set-row-label" id="rowLaunchLabel">Beim Anmelden starten</p><p class="set-row-desc" id="rowLaunchDesc">${esc(launchDesc(state))}</p>${settings}</div><div class="set-row-control">${switchHtml("launchToggle", !!state.enabled, "rowLaunchLabel", { disabled: launch.busy, describedBy: "rowLaunchDesc" })}</div></div>`;
  });
}

async function loadLaunch() {
  if (typeof window.hubShell?.startAtLogin !== "function") return;
  try {
    launch.state = await window.hubShell.startAtLogin();
  } catch {
    launch.state = null;
  }
  renderLaunch();
}

async function setLaunch(wanted) {
  launch.busy = true;
  renderLaunch();
  let state = null;
  try {
    state = await window.hubShell.setStartAtLogin(wanted);
  } catch (error) {
    state = { ...launch.state, error: error?.message || "" };
  }
  launch.busy = false;
  launch.state = state?.supported ? state : launch.state;
  renderLaunch();
  if (state?.error) toast(`Das hat nicht geklappt. ${esc(systemName())} meldet: „${esc(state.error)}“`, { icon: "circle-alert", duration: 9000 });
  else if (wanted && state && !state.enabled && !state.pending) toast(`${esc(systemName())} hat den Autostart nicht übernommen.`, { icon: "circle-alert" });
  else if (state) say(state.enabled ? "Beim Anmelden starten an" : "Beim Anmelden starten aus");
}

function bindLaunch() {
  $("benachrichtigungen").addEventListener("click", (event) => {
    if (event.target.closest("#launchToggle") && !launch.busy) setLaunch(!launch.state?.enabled);
    else if (event.target.closest("#launchSettings")) window.hubShell.openLoginItems?.();
  });
  addEventListener("focus", () => launch.state?.pending && loadLaunch());
}

const look = { theme: ["light", "dark"].includes(root.dataset.themeMode) ? root.dataset.themeMode : "auto" };
const systemDark = matchMedia("(prefers-color-scheme: dark)");

function dropThemeParam() {
  const url = new URL(location.href);
  if (!url.searchParams.has("theme")) return;
  url.searchParams.delete("theme");
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function applyTheme(mode, { animate = true } = {}) {
  look.theme = mode;
  dropThemeParam();
  if (animate) {
    setTheme(mode);
    return;
  }
  root.dataset.theme = mode === "auto" ? (systemDark.matches ? "dark" : "light") : mode;
  root.dataset.themeMode = mode;
}

const themeDesc = () => `Automatisch folgt deinem System, gerade ${systemDark.matches ? "dunkel" : "hell"}.`;

const motionReduced = () => root.dataset.motion === "minimal";

function applyMotion(on) {
  if (motionDefault === "minimal") return;
  if (on) storage.set(LOCAL_KEYS.motion, "minimal");
  else removeKey(LOCAL_KEYS.motion);
  const value = on ? "minimal" : motionDefault;
  root.dataset.motion = value;
  variant.motion = value;
}

const singleKeys = () => storage.get(KEYS_KEY) !== false;

function syncSingleKeys() {
  const on = singleKeys();
  const box = $("singleKeys");
  if (box) box.checked = on;
  document.querySelectorAll("[data-single-key]").forEach((node) => node.classList.toggle("is-off", !on));
}

function applySingleKeys(on) {
  if (on) removeKey(KEYS_KEY);
  else storage.set(KEYS_KEY, false);
  syncSingleKeys();
}

function renderLook() {
  const card = $("lookCard");
  const modes = [["light", "Hell", "sun"], ["dark", "Dunkel", "moon"], ["auto", "Automatisch", "sun-moon"]];
  const locked = motionDefault === "minimal";
  const motionDesc = locked
    ? "Die Variante „Wenig Animation“ ist gerade aktiv."
    : reduced()
      ? `Dein System reduziert Bewegung schon, ${BRAND} hält sich daran.`
      : "Übergänge werden kurz, nichts gleitet oder federt.";
  keepFocus(card, () => {
    card.innerHTML = [
      row({ id: "rowTheme", label: "Farbschema", desc: themeDesc(), cls: "is-stack", control: `<div class="segmented look-modes" role="group" aria-labelledby="rowThemeLabel" aria-describedby="rowThemeDesc">${modes.map(([key, text, glyph]) => `<button type="button" id="theme-${key}" data-scheme="${key}" aria-pressed="${look.theme === key}">${icon(glyph)}${text}</button>`).join("")}</div>` }),
      row({ id: "rowMotion", label: "Bewegung reduzieren", desc: motionDesc, control: switchHtml("motionToggle", motionReduced(), "rowMotionLabel", { disabled: locked, describedBy: "rowMotionDesc" }) }),
      `<div class="set-row" id="rowKeys"><div class="set-row-text"><p class="set-row-label" id="rowKeysLabel">Einzeltasten-Kürzel</p><p class="set-row-desc" id="rowKeysDesc">N für eine Notiz, J und K durch Listen, X hakt ab. Aus, wenn du mit Sprachsteuerung arbeitest.</p><button class="text-button row-action" type="button" id="showShortcuts">${icon("keyboard")}<span>Alle Kürzel ansehen</span></button></div><div class="set-row-control">${switchHtml("keysToggle", singleKeys(), "rowKeysLabel", { describedBy: "rowKeysDesc" })}</div></div>`,
    ].join("");
  });
}

function bindLook() {
  const card = $("lookCard");
  card.addEventListener("click", (event) => {
    const mode = event.target.closest("[data-scheme]");
    if (mode) {
      if (mode.dataset.scheme === look.theme) return;
      applyTheme(mode.dataset.scheme);
      renderLook();
      renderDataMeta();
      say(`Farbschema: ${mode.textContent.trim()}`);
    } else if (event.target.closest("#motionToggle")) {
      applyMotion(!motionReduced());
      renderLook();
      renderDataMeta();
      say(motionReduced() ? "Bewegung reduziert" : "Bewegung normal");
    } else if (event.target.closest("#keysToggle")) {
      applySingleKeys(!singleKeys());
      renderLook();
      renderDataMeta();
    } else if (event.target.closest("#showShortcuts")) {
      $("shortcuts")?.showModal();
    }
  });
  $("singleKeys")?.addEventListener("change", () => renderLook());
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", renderLook);
  systemDark.addEventListener("change", () => {
    const desc = $("rowThemeDesc");
    if (desc) desc.textContent = themeDesc();
  });
  new MutationObserver(() => {
    const mode = ["light", "dark"].includes(root.dataset.themeMode) ? root.dataset.themeMode : "auto";
    if (mode === look.theme) return;
    look.theme = mode;
    renderLook();
    renderDataMeta();
  }).observe(root, { attributes: true, attributeFilter: ["data-theme-mode"] });
}

const placeState = { editing: false, place: null, query: "", results: [], searching: false, stale: false, failed: false, timer: 0, ticket: 0 };
const PLACE_WORDS = { home: "Zuhause", school: "Schule" };
const placesCard = () => $("placesCard");
const placeLine = (item) => (item.area && !item.name.includes(item.area) ? `${item.name}, ${item.area}` : item.name);

function placeResultsHtml() {
  if (placeState.results.length) {
    const items = placeState.results.map((item, index) => `<li><button type="button" class="place-pick" data-place-pick="${index}"><span class="place-pick-icon" aria-hidden="true">${icon(item.kind === "stop" ? "train-front" : "map-pin")}</span><span class="place-pick-text"><b>${esc(item.name)}</b>${item.area ? `<small>${esc(item.area)}</small>` : ""}</span></button></li>`).join("");
    return `<ul class="place-results" role="list" aria-label="Treffer">${items}</ul>`;
  }
  if (placeState.query.trim().length < 2) return "";
  if (placeState.searching) return `<p class="set-row-desc">Suche …</p>`;
  return `<p class="set-row-desc">${placeState.failed ? "Die Ortssuche ist gerade nicht erreichbar. Versuch es gleich noch einmal." : "Nichts gefunden. Versuch es mit Straße, Hausnummer und Ort."}</p>`;
}

function renderPlaceResults() {
  const host = $("placeResults");
  if (!host) return;
  const active = document.activeElement?.closest?.("[data-place-pick]");
  const index = active && host.contains(active) ? active.dataset.placePick : null;
  host.innerHTML = placeResultsHtml();
  if (index !== null) (host.querySelector(`[data-place-pick="${index}"]`) || $("placeInput"))?.focus({ preventScroll: true });
}

function renderPlaces() {
  const card = $("placesCard");
  const info = page.places || {};
  const weather = placeState.editing
    ? `<form class="set-row is-stack place-form" id="weatherForm" novalidate>
        <div class="set-row-text"><label class="set-row-label" for="weatherInput">Wetter</label><p class="set-row-desc" id="weatherDesc">Ort für die Vorhersage auf der Übersicht.${homeCountsForWeather() ? " Bleibt das Feld leer, gilt Zuhause." : ""}</p></div>
        <div class="set-row-control"><input class="field-control" id="weatherInput" value="${esc(prefs.places.weather)}" maxlength="40" autocomplete="address-level2" aria-describedby="weatherDesc weatherError"><button class="btn btn-quiet" type="button" id="weatherCancel">Abbrechen</button><button class="btn btn-primary" type="submit">Speichern</button>${errorHtml("weatherError", "")}</div>
      </form>`
    : row({ id: "rowWeather", label: "Wetter", desc: "Ort für die Vorhersage auf der Übersicht", cls: "is-stack", control: `<span class="set-value">${esc(prefs.places.weather || (typeof info.weatherFromHome === "string" ? (info.weatherFromHome ? `${info.weatherFromHome}, wie Zuhause` : "Wie Zuhause") : "Noch nicht festgelegt"))}</span><button class="btn btn-quiet" type="button" id="weatherEdit">${prefs.places.weather ? "Ändern" : "Festlegen"}</button>` });
  const placeRow = (key, id, label, desc) => {
    if (placeState.place === key) {
      return `<form class="set-row is-stack place-form" id="placeForm" data-place="${key}" novalidate autocomplete="off">
        <div class="set-row-text"><label class="set-row-label" for="placeInput">${label}</label><p class="set-row-desc" id="placeDesc">Adresse oder Haltestelle suchen, dann einen Treffer wählen</p></div>
        <div class="set-row-control"><input class="field-control" id="placeInput" value="${esc(placeState.query)}" maxlength="80" autocomplete="off" spellcheck="false" placeholder="Straße, Hausnummer, Ort" aria-describedby="placeDesc">${info[key] ? `<button class="btn btn-quiet" type="button" id="placeRemove">Entfernen</button>` : ""}<button class="btn btn-quiet" type="button" id="placeCancel">Abbrechen</button></div>
        <div class="place-found" id="placeResults" aria-live="polite">${placeResultsHtml()}</div>
      </form>`;
    }
    return row({ id, label, desc, cls: "is-stack", control: `<span class="set-value">${esc(info[key] || "Noch nicht festgelegt")}</span><button class="btn btn-quiet" type="button" data-place-edit="${key}">${info[key] ? "Ändern" : "Festlegen"}</button>` });
  };
  keepFocus(card, () => {
    card.innerHTML = weather
      + placeRow("home", "rowHome", "Zuhause", "Start für Schulweg und Heimweg")
      + placeRow("school", "rowSchoolPlace", "Schule", "Ziel für den Schulweg");
  });
}

async function saveWeatherPlace(value, input) {
  if (placeState.savingWeather) return;
  placeState.savingWeather = true;
  const before = prefs.places.weather;
  try {
    const result = await request("PUT", "/api/ui/weather/place", { name: value });
    const place = value ? result.place || value : "";
    placeState.editing = false;
    page.places = { ...(page.places || {}), weather: place, weatherFromHome: place ? null : result.weatherFromHome ?? null };
    prefs.places.weather = place;
    savePrefs();
    renderPlaces();
    if (place !== before) toast(place ? `Wetter jetzt für ${esc(place)}` : "Das Wetter richtet sich wieder nach Zuhause", { icon: "map-pin" });
    $("weatherEdit")?.focus({ preventScroll: true });
  } catch (error) {
    setError(input, $("weatherError"), error.message || "Diesen Ort finde ich gerade nicht. Versuch es mit dem Namen der Stadt.");
    input.focus();
  } finally {
    placeState.savingWeather = false;
  }
}

async function searchPlaces(query) {
  const ticket = ++placeState.ticket;
  placeState.searching = true;
  placeState.failed = false;
  renderPlaceResults();
  let results = [];
  let failed = false;
  try {
    const response = await fetch(`/api/ui/transit/suche?${new URLSearchParams({ q: query })}`, { credentials: "same-origin" });
    const body = await response.json();
    if (response.ok) results = body.places || [];
    else failed = true;
  } catch {
    failed = true;
  }
  if (ticket !== placeState.ticket) return;
  placeState.searching = false;
  placeState.stale = false;
  placeState.failed = failed;
  placeState.results = results;
  renderPlaceResults();
}

function closePlaceForm(key) {
  clearTimeout(placeState.timer);
  placeState.ticket += 1;
  placeState.place = null;
  placeState.results = [];
  placeState.query = "";
  placeState.searching = false;
  placeState.stale = false;
  renderPlaces();
  placesCard().querySelector(`[data-place-edit="${key}"]`)?.focus({ preventScroll: true });
}

// weatherFromHome is the town the forecast takes from home, "" where the address names none, and null while it does not go by home.
// Only the desktop server knows that rule and says so, in the phone app the weather needs a place of its own.
const followedWeather = (answer) => ({
  ...(answer && "weatherFromHome" in answer ? { weatherFromHome: answer.weatherFromHome } : {}),
  ...(answer && "weatherCanFollowHome" in answer ? { weatherCanFollowHome: answer.weatherCanFollowHome } : {}),
});
const homeCountsForWeather = () => !!page.places?.weatherCanFollowHome;

async function pickPlace(key, item) {
  try {
    const saved = await request("PUT", `/api/ui/places/${key}`, { name: item.name, area: item.area || "", lat: item.lat, lon: item.lon, stop: item.kind === "stop" ? item.id : "" });
    page.places = { ...(page.places || {}), [key]: placeLine(item), ...followedWeather(saved) };
    closePlaceForm(key);
    toast(`${PLACE_WORDS[key]}: ${esc(placeLine(item))}`, { icon: "map-pin" });
  } catch {
    toast("Der Ort ließ sich gerade nicht speichern.", { icon: "circle-alert" });
  }
}

async function removePlace(key) {
  const before = (page.places || {})[key] || "";
  try {
    const result = await request("DELETE", `/api/ui/places/${key}`);
    page.places = { ...(page.places || {}), [key]: "", ...followedWeather(result) };
    closePlaceForm(key);
    const removed = result?.removed;
    toast(`${PLACE_WORDS[key]} entfernt`, {
      icon: "map-pin",
      action: removed && before ? { label: "Rückgängig", undo: true, run: async () => {
        try {
          const restored = await request("PUT", `/api/ui/places/${key}`, removed);
          page.places = { ...(page.places || {}), [key]: before, ...followedWeather(restored) };
          renderPlaces();
        } catch {
          toast("Der Ort ließ sich gerade nicht zurückholen.", { icon: "circle-alert" });
        }
      } } : undefined,
    });
  } catch {
    toast("Der Ort ließ sich gerade nicht entfernen.", { icon: "circle-alert" });
  }
}

const passDraft = { net: PASS_NETS[0][0], zones: PASS_ZONES[0] };

function renderTransit() {
  const card = $("transitCard");
  const transit = prefs.transit;
  const chips = transit.passes.length
    ? `<ul class="room-chips pass-chips" aria-label="Deine Zeitkarten">${transit.passes.map((pass, index) => `<li class="room-chip"><span>${esc(passLabel(pass))}</span><button type="button" class="chip-x" id="pass-remove-${index}" data-remove-pass="${index}" aria-label="${esc(passLabel(pass))} entfernen">${icon("x")}</button></li>`).join("")}</ul>`
    : "";
  const form = `<form class="pass-add" id="passForm" novalidate>
      <label class="visually-hidden" for="passNet">Tarifgebiet</label>
      <select class="field-control" id="passNet">${PASS_NETS.map(([net, name]) => `<option value="${esc(net)}"${net === passDraft.net ? " selected" : ""}>${esc(name)}</option>`).join("")}</select>
      <div class="segmented" role="group" aria-label="Tarifbereich">${PASS_ZONES.map((zones) => `<button type="button" id="pass-zones-${zones}" data-pass-zones="${zones}" aria-pressed="${zones === passDraft.zones}">${zones}</button>`).join("")}</div>
      <button class="btn btn-quiet" type="submit" id="passSubmit">${icon("plus")}Hinzufügen</button>
    </form>`;
  keepFocus(card, () => {
    card.innerHTML = [
      row({ id: "rowGermanyTicket", label: "Deutschlandticket", desc: "Gilt in Bus, Tram, S- und U-Bahn und in Regionalzügen, nicht im Fernverkehr.", control: switchHtml("germanyTicket", transit.deutschlandticket, "rowGermanyTicketLabel", { describedBy: "rowGermanyTicketDesc" }) }),
      row({ id: "rowPasses", label: "Zeitkarten im VBB", desc: "Monatskarte, Abo oder Schülerticket für einen Tarifbereich in Berlin und Brandenburg. Der Fahrplan zeigt dann, ob eine Verbindung damit geht und was sie sonst kostet.", cls: "is-stack pass-row", control: chips + form }),
      row({ id: "rowMaps", label: "Karten-App", desc: `Öffnet Fußwege aus dem Fahrplan. Automatisch nimmt auf diesem Gerät ${platform.mac ? "Apple Karten" : "Google Maps"}.`, cls: "is-stack", control: `<div class="segmented" role="group" aria-labelledby="rowMapsLabel" aria-describedby="rowMapsDesc">${MAP_APPS.map(([key, text, more]) => `<button type="button" id="maps-${key}" data-maps="${key}" aria-pressed="${transit.maps === key}">${text}${more ? `<span class="maps-more">${more}</span>` : ""}</button>`).join("")}</div>` }),
    ].join("");
  });
}

function bindTransit() {
  const card = $("transitCard");
  card.addEventListener("click", (event) => {
    const zones = event.target.closest("[data-pass-zones]");
    const remove = event.target.closest("[data-remove-pass]");
    const maps = event.target.closest("[data-maps]");
    if (event.target.closest("#germanyTicket")) {
      commitPrefs((value) => (value.transit.deutschlandticket = !value.transit.deutschlandticket), renderTransit);
      say(prefs.transit.deutschlandticket ? "Deutschlandticket hinterlegt" : "Deutschlandticket entfernt");
    } else if (zones) {
      passDraft.zones = zones.dataset.passZones;
      renderTransit();
    } else if (remove) {
      const index = Number(remove.dataset.removePass);
      const label = passLabel(prefs.transit.passes[index]);
      commitPrefs((value) => value.transit.passes.splice(index, 1), renderTransit, `Zeitkarte ${esc(label)} entfernt`, "ticket");
      $("passNet")?.focus({ preventScroll: true });
    } else if (maps && maps.dataset.maps !== prefs.transit.maps) {
      commitPrefs((value) => (value.transit.maps = maps.dataset.maps), renderTransit);
      say(`Karten-App: ${maps.textContent.trim()}`);
    }
  });
  card.addEventListener("change", (event) => {
    if (event.target.id === "passNet") passDraft.net = event.target.value;
  });
  card.addEventListener("submit", (event) => {
    event.preventDefault();
    if (prefs.transit.passes.some((pass) => pass.net === passDraft.net && pass.zones === passDraft.zones)) {
      toast(`Die Zeitkarte ${esc(passLabel(passDraft))} ist schon hinterlegt.`, { icon: "ticket" });
      return;
    }
    commitPrefs((value) => value.transit.passes.push({ ...passDraft }), renderTransit, `Zeitkarte ${esc(passLabel(passDraft))} hinterlegt`, "ticket");
  });
}

function bindPlaces() {
  const host = $("placesCard");
  host.addEventListener("input", (event) => {
    if (event.target.id !== "placeInput") return;
    placeState.query = event.target.value;
    clearTimeout(placeState.timer);
    if (placeState.query.trim().length < 2) {
      placeState.ticket += 1;
      placeState.results = [];
      placeState.searching = false;
      placeState.stale = false;
      renderPlaceResults();
      return;
    }
    placeState.stale = true;
    placeState.ticket += 1;
    placeState.timer = setTimeout(() => searchPlaces(placeState.query.trim()), 280);
  });
  host.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-place-edit]");
    if (edit) {
      clearTimeout(placeState.timer);
      placeState.ticket += 1;
      placeState.place = edit.dataset.placeEdit;
      placeState.query = "";
      placeState.results = [];
      placeState.searching = false;
      placeState.stale = false;
      renderPlaces();
      $("placeInput")?.focus();
      return;
    }
    const pick = event.target.closest("[data-place-pick]");
    if (pick) {
      const item = placeState.results[Number(pick.dataset.placePick)];
      if (placeState.place && item) pickPlace(placeState.place, item);
      return;
    }
    if (event.target.closest("#placeRemove")) {
      removePlace(placeState.place);
      return;
    }
    if (event.target.closest("#placeCancel")) {
      closePlaceForm(placeState.place);
      return;
    }
    if (event.target.closest("#weatherEdit")) {
      placeState.editing = true;
      renderPlaces();
      $("weatherInput")?.select();
    } else if (event.target.closest("#weatherCancel")) {
      placeState.editing = false;
      renderPlaces();
      $("weatherEdit")?.focus();
    }
  });
  host.addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.target.id === "placeForm") {
      if (placeState.results.length && !placeState.stale) pickPlace(placeState.place, placeState.results[0]);
      return;
    }
    if (event.target.id !== "weatherForm") return;
    const input = $("weatherInput");
    const value = input.value.replace(/\s+/g, " ").trim();
    if (!value && !homeCountsForWeather()) {
      setError(input, $("weatherError"), "Trag einen Ort ein, zum Beispiel Potsdam.");
      input.focus();
      return;
    }
    saveWeatherPlace(value, input);
  });
  host.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && event.target.id === "weatherInput") {
      event.preventDefault();
      placeState.editing = false;
      renderPlaces();
      $("weatherEdit")?.focus();
      return;
    }
    if (!event.target.closest("#placeForm")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closePlaceForm(placeState.place);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const picks = [...host.querySelectorAll(".place-pick")];
    if (!picks.length) return;
    const index = picks.indexOf(event.target.closest(".place-pick"));
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    event.preventDefault();
    if (next < 0) $("placeInput")?.focus();
    else picks[Math.min(next, picks.length - 1)].focus();
  });
}

const catalog = { subject: null, teacher: null, shortTouched: false };
const CATALOG_KEYS = [LOCAL_KEYS.subjects, LOCAL_KEYS.teachers, LOCAL_KEYS.rooms, LOCAL_KEYS.lessons];
const defaultRooms = new Set();
Object.values(schoolDefaults?.timetable || {}).forEach((days) => Object.values(days).forEach((entries) => entries.forEach((entry) => entry.room && defaultRooms.add(entry.room))));

function readStore(key) {
  const value = storage.get(key);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const listStore = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
const subjectStore = () => {
  const value = readStore(LOCAL_KEYS.subjects);
  return { items: { ...(value.items || {}) }, removed: listStore(value.removed) };
};
const teacherStore = () => {
  const value = readStore(LOCAL_KEYS.teachers);
  return { items: { ...(value.items || {}) }, removed: listStore(value.removed) };
};
function roomStore() {
  const value = readStore(LOCAL_KEYS.rooms);
  return { added: listStore(value.added), removed: listStore(value.removed) };
}

function saveStore(key, value, empty) {
  if (empty) removeKey(key);
  else storage.set(key, value);
}

function addRoom(rooms, room) {
  rooms.removed = rooms.removed.filter((item) => item !== room);
  if (!defaultRooms.has(room) && !rooms.added.includes(room)) rooms.added.push(room);
}

function dropRoom(rooms, room) {
  rooms.added = rooms.added.filter((item) => item !== room);
  if (defaultRooms.has(room) && !rooms.removed.includes(room)) rooms.removed.push(room);
}

function rawValues() {
  return rawOf(CATALOG_KEYS);
}

function restoreRaw(values) {
  Object.entries(values).forEach(([key, value]) => {
    if (value == null) storage.remove(key);
    else storage.set(key, JSON.parse(value));
  });
}

function refreshCatalog() {
  applySchoolEdits();
  renderPlan();
  renderCatalog();
  renderNotify();
  renderDataMeta();
}

function commitCatalog(mutate, message = "", glyph = "check") {
  const before = rawValues();
  const draft = { subjects: subjectStore(), teachers: teacherStore(), rooms: roomStore(), lessons: clone(readEdits()) };
  if (mutate(draft) === false) return false;
  saveStore(LOCAL_KEYS.subjects, draft.subjects, !Object.keys(draft.subjects.items).length && !draft.subjects.removed.length);
  saveStore(LOCAL_KEYS.teachers, draft.teachers, !Object.keys(draft.teachers.items).length && !draft.teachers.removed.length);
  saveStore(LOCAL_KEYS.rooms, draft.rooms, !draft.rooms.added.length && !draft.rooms.removed.length);
  saveStore(LOCAL_KEYS.lessons, draft.lessons, !Object.keys(draft.lessons).length);
  refreshCatalog();
  const text = typeof message === "function" ? message() : message;
  if (text) {
    toast(text, {
      icon: glyph,
      action: { label: "Rückgängig", undo: true, run: () => {
        restoreRaw(before);
        catalog.subject = null;
        catalog.teacher = null;
        refreshCatalog();
        say("Rückgängig gemacht");
      } },
    });
  }
  return true;
}

function cellsOf(key, { all = false } = {}) {
  const cells = [];
  (all ? ["A", "B"] : shownWeeks()).forEach((week) => DAYS.forEach((dow) => (data.timetable[week]?.[String(dow)] || []).forEach((entry) => {
    if (entry.subject === key) cells.push([week, dow, entry.block]);
  })));
  return cells;
}

const byLabel = (a, b) => subject(a).label.localeCompare(subject(b).label, "de");
const retiredKeys = () => Object.keys(data.subjects).filter((key) => data.subjects[key].retired).sort(byLabel);
const sortedSubjectKeys = () => activeSubjectKeys().sort((a, b) => (TYPE_ORDER[courseType(a)] ?? 3) - (TYPE_ORDER[courseType(b)] ?? 3) || subject(a).label.localeCompare(subject(b).label, "de"));

function hueOwners(except) {
  const owners = {};
  Object.entries(data.subjects).forEach(([key, info]) => {
    if (key !== except && !info.retired) (owners[info.hue] ||= []).push(info.label);
  });
  return owners;
}

function teacherOptions(selected) {
  return `<option value="">Noch keine</option>${sortedTeachers().map((teacher) => `<option value="${esc(teacher.id)}"${teacher.id === selected ? " selected" : ""}>${esc(teacher.label)}</option>`).join("")}<option value="__new">Neue Lehrkraft anlegen</option>`;
}

function subjectRowHtml(key) {
  const info = data.subjects[key];
  const count = cellsOf(key).length;
  const details = [COURSE_WORDS[info.type], info.teacher || NO_TEACHER, info.room ? `Raum ${info.room}` : ""].filter(Boolean).join(", ");
  return `<div class="set-row subject-row" id="subject-row-${esc(key)}">
      <div class="set-row-text">
        <p class="set-row-label"><i class="subject-dot" style="--hue:${hueVar(key)}" aria-hidden="true"></i><span>${esc(info.label)}</span><span class="short-tag"><span class="visually-hidden">Kürzel </span>${esc(info.short)}</span></p>
        <p class="set-row-desc">${esc(details)}</p>
      </div>
      <div class="set-row-control"><span class="set-count">${count ? plural(count, "Stunde", "Stunden") : "nicht im Plan"}</span><button class="icon-button" type="button" id="subject-edit-${esc(key)}" data-edit-subject="${esc(key)}" aria-label="${esc(info.label)} bearbeiten" data-tip="Bearbeiten">${icon("pencil")}</button></div>
    </div>`;
}

function subjectFormHtml(key) {
  const creating = key === "new";
  const info = creating ? null : data.subjects[key];
  const owners = hueOwners(key);
  const hue = creating ? HUES.find((item) => !owners[item]) || HUES[0] : info.hue;
  const type = creating ? "GK" : info.type;
  const hues = HUES.map((item) => {
    const text = [HUE_NAMES[item], owners[item] ? `schon bei ${joinWords(owners[item])}` : ""].filter(Boolean).join(", ");
    return `<label class="hue-pick" style="--swatch:var(--hue-${item})" data-tip="${esc(text)}"><input type="radio" name="hue" value="${item}"${item === hue ? " checked" : ""}><span class="visually-hidden">${esc(text)}</span>${icon("check")}</label>`;
  }).join("");
  const types = COURSE_TYPES.map((item) => `<label class="choice"><input type="radio" name="type" value="${item}"${item === type ? " checked" : ""}><span>${COURSE_WORDS[item]}</span></label>`).join("");
  return `<form class="set-form subject-form" id="subjectForm" data-key="${esc(key)}" novalidate aria-labelledby="subjectFormTitle">
      <p class="set-form-title" id="subjectFormTitle">${creating ? "Neues Fach" : `${esc(info.label)} bearbeiten`}</p>
      <div class="set-form-grid">
        <div class="form-field"><label class="form-label" for="subjectName">Name</label><input class="field-control" id="subjectName" name="name" value="${esc(creating ? "" : plainName(info.label))}" maxlength="32" placeholder="z. B. Informatik" autocomplete="off" aria-describedby="subjectNameError">${errorHtml("subjectNameError", "")}</div>
        <div class="form-field"><label class="form-label" for="subjectShort">Kürzel</label><input class="field-control" id="subjectShort" name="short" value="${esc(creating ? "" : info.short)}" maxlength="4" placeholder="z. B. Inf" autocomplete="off" spellcheck="false" aria-describedby="subjectShortError">${errorHtml("subjectShortError", "")}</div>
      </div>
      <fieldset class="form-field"><legend class="form-label">Farbe</legend><div class="hue-picks">${hues}</div></fieldset>
      <fieldset class="form-field"><legend class="form-label">Kursart</legend><div class="choice-group">${types}</div></fieldset>
      <div class="set-form-grid">
        <div class="form-field"><label class="form-label" for="subjectTeacher">Lehrkraft</label><select class="field-control" id="subjectTeacher" name="teacher">${teacherOptions(creating ? "" : info.teacherId)}</select></div>
        <div class="form-field"><label class="form-label" for="subjectRoom">Standardraum</label><input class="field-control" id="subjectRoom" name="room" value="${esc(creating ? "" : info.room)}" maxlength="12" list="roomOptions" placeholder="z. B. R210" autocomplete="off" spellcheck="false" autocapitalize="characters"></div>
      </div>
      <div class="set-form-grid teacher-grid" id="subjectNewTeacher" hidden>
        <div class="form-field"><label class="form-label" for="subjectNewTitle">Anrede</label><select class="field-control" id="subjectNewTitle" name="newTitle">${TITLES.map(([value, text]) => `<option value="${value}">${text}</option>`).join("")}</select></div>
        <div class="form-field"><label class="form-label" for="subjectNewName">Nachname der neuen Lehrkraft</label><input class="field-control" id="subjectNewName" name="newName" maxlength="40" placeholder="z. B. Schulz" autocomplete="off" aria-describedby="subjectNewNameError">${errorHtml("subjectNewNameError", "")}</div>
      </div>
      ${creating ? "" : `<div class="form-confirm" id="subjectConfirm" role="alert" hidden><p id="subjectConfirmText"></p><div class="set-form-actions"><button type="button" class="btn btn-quiet" id="subjectKeep">Behalten</button><button type="button" class="btn btn-quiet danger-button" id="subjectConfirmDelete">${icon("trash-2")}Fach löschen</button></div></div>`}
      <div class="set-form-actions" id="subjectActions">
        ${creating ? "" : `<button type="button" class="btn btn-quiet danger-button form-delete" id="subjectDelete">${icon("trash-2")}Löschen</button>`}
        <button type="button" class="btn btn-quiet" id="subjectCancel">Abbrechen</button>
        <button type="submit" class="btn btn-primary" id="subjectSave">${creating ? "Anlegen" : "Speichern"}</button>
      </div>
    </form>`;
}

function retiredHtml() {
  const keys = retiredKeys();
  if (!keys.length) return "";
  const rows = keys.map((key) => {
    const info = data.subjects[key];
    return `<div class="set-row retired-row" id="retired-row-${esc(key)}">
        <div class="set-row-text"><p class="set-row-label"><i class="subject-dot" style="--hue:${hueVar(key)}" aria-hidden="true"></i><span>${esc(info.label)}</span></p><p class="set-row-desc">Nicht mehr im Stundenplan, die Noten zählen weiter im Schnitt</p></div>
        <div class="set-row-control"><button class="btn btn-quiet" type="button" id="subject-restore-${esc(key)}" data-restore-subject="${esc(key)}" aria-label="${esc(info.label)} wiederherstellen">${icon("rotate-ccw")}Wiederherstellen</button></div>
      </div>`;
  }).join("");
  return `<div class="retired-block" role="group" aria-labelledby="retiredTitle"><p class="retired-title" id="retiredTitle">Gelöscht</p>${rows}</div>`;
}

function renderSubjects() {
  const card = $("subjectsCard");
  $("subjectAdd").disabled = catalog.subject === "new";
  const rows = sortedSubjectKeys().map((key) => (catalog.subject === key ? subjectFormHtml(key) : subjectRowHtml(key))).join("");
  keepFocus(card, () => (card.innerHTML = (catalog.subject === "new" ? subjectFormHtml("new") : "") + rows + retiredHtml()));
}

function renderTeachers() {
  const card = $("teachersCard");
  const taught = (id) => sortedSubjectKeys().filter((key) => data.subjects[key].teacherId === id).map((key) => data.subjects[key].label);
  const formHtml = (teacher) => `<form class="set-form teacher-form" id="teacherForm" data-id="${teacher ? esc(teacher.id) : "new"}" novalidate aria-labelledby="teacherFormTitle">
      <p class="set-form-title" id="teacherFormTitle">${teacher ? `${esc(teacher.label)} bearbeiten` : "Neue Lehrkraft"}</p>
      <div class="set-form-grid teacher-grid">
        <div class="form-field"><label class="form-label" for="teacherTitle">Anrede</label><select class="field-control" id="teacherTitle">${TITLES.map(([value, text]) => `<option value="${value}"${(teacher ? teacher.title : "Frau") === value ? " selected" : ""}>${text}</option>`).join("")}</select></div>
        <div class="form-field"><label class="form-label" for="teacherName">Nachname</label><input class="field-control" id="teacherName" value="${esc(teacher?.name || "")}" maxlength="40" placeholder="z. B. Schulz" autocomplete="off" aria-describedby="teacherNameError">${errorHtml("teacherNameError", "")}</div>
      </div>
      <div class="set-form-actions"><button type="button" class="btn btn-quiet" id="teacherCancel">Abbrechen</button><button type="submit" class="btn btn-primary">${teacher ? "Speichern" : "Hinzufügen"}</button></div>
    </form>`;
  const rows = sortedTeachers().map((teacher) => {
    if (catalog.teacher === teacher.id) return formHtml(teacher);
    const list = taught(teacher.id);
    return `<div class="set-row teacher-row" id="teacher-row-${esc(teacher.id)}">
        <div class="set-row-text"><p class="set-row-label">${esc(teacher.label)}</p><p class="set-row-desc">${esc(list.length ? joinWords(list) : "Noch keinem Fach zugeordnet")}</p></div>
        <div class="set-row-control"><button class="icon-button" type="button" id="teacher-edit-${esc(teacher.id)}" data-edit-teacher="${esc(teacher.id)}" aria-label="${esc(teacher.label)} bearbeiten" data-tip="Bearbeiten">${icon("pencil")}</button><button class="icon-button is-danger" type="button" id="teacher-remove-${esc(teacher.id)}" data-remove-teacher="${esc(teacher.id)}" aria-label="${esc(teacher.label)} entfernen" data-tip="Entfernen">${icon("trash-2")}</button></div>
      </div>`;
  }).join("");
  const head = `<div class="set-card-head catalog-head"><div><h3 class="set-card-title">Lehrkräfte</h3><p class="set-card-meta">Zuordnung über das Fach, pro Stunde im Stundenplan änderbar</p></div><button class="btn btn-quiet" type="button" id="teacherAdd"${catalog.teacher === "new" ? " disabled" : ""}>${icon("plus")}Lehrkraft hinzufügen</button></div>`;
  keepFocus(card, () => (card.innerHTML = head + (catalog.teacher === "new" ? formHtml(null) : "") + rows));
}

function renderRooms() {
  const card = $("roomsCard");
  const usage = new Map();
  shownWeeks().forEach((week) => Object.values(data.timetable[week] || {}).forEach((entries) => entries.forEach((entry) => {
    if (entry.room) usage.set(entry.room, (usage.get(entry.room) || 0) + 1);
  })));
  keepFocus(card, () => {
    card.innerHTML = `<div class="set-card-head catalog-head"><div><h3 class="set-card-title">Räume</h3><p class="set-card-meta">Vorschläge im Stundenplan, neue Räume kommen beim Eintragen dazu</p></div></div>
      <form class="room-add" id="roomForm" novalidate><label class="visually-hidden" for="roomNew">Neuer Raum</label><input class="field-control" id="roomNew" maxlength="12" placeholder="Neuer Raum, z. B. R210" autocomplete="off" spellcheck="false" autocapitalize="characters" aria-describedby="roomError"><button class="btn btn-quiet" type="submit" id="roomSubmit">${icon("plus")}Hinzufügen</button>${errorHtml("roomError", "")}</form>
      <ul class="room-chips" aria-label="Räume">${data.rooms.map((room) => {
        const count = usage.get(room) || 0;
        return `<li class="room-chip" id="room-${slug(room)}"><span>${esc(room)}</span>${count ? `<small aria-hidden="true">${count}</small>` : ""}<button type="button" class="chip-x" id="room-remove-${slug(room)}" data-remove-room="${esc(room)}" aria-label="${esc(room)} entfernen${count ? `, steht in ${plural(count, "Stunde", "Stunden")}` : ""}">${icon("x")}</button></li>`;
      }).join("")}</ul>`;
  });
}

function renderCatalog() {
  $("catalogMeta").textContent = `${plural(activeSubjectKeys().length, "Fach", "Fächer")}, ${plural(data.teachers.length, "Lehrkraft", "Lehrkräfte")}, ${plural(data.rooms.length, "Raum", "Räume")}`;
  $("roomOptions").innerHTML = data.rooms.map((room) => `<option value="${esc(room)}"></option>`).join("");
  renderSubjects();
  renderTeachers();
  renderRooms();
}

function uniqueSubjectKey(draft, text) {
  const base = `x-${slug(text).slice(0, 12) || "fach"}`;
  let key = base;
  for (let index = 2; data.subjects[key] || schoolDefaults.subjects[key] || draft.subjects.items[key]; index += 1) key = `${base}-${index}`;
  return key;
}

function saveSubject(formNode) {
  const key = formNode.dataset.key;
  const creating = key === "new";
  const name = $("subjectName").value.replace(/\s+/g, " ").trim();
  const short = $("subjectShort").value.replace(/\s+/g, "").trim();
  const hue = formNode.querySelector('input[name="hue"]:checked')?.value || HUES[0];
  const type = formNode.querySelector('input[name="type"]:checked')?.value || "GK";
  const teacherChoice = $("subjectTeacher").value;
  const room = normalizeRoom($("subjectRoom").value);
  const newTitle = $("subjectNewTitle").value;
  const newName = $("subjectNewName").value.replace(/\s+/g, " ").trim();
  const others = Object.entries(data.subjects).filter(([other]) => other !== key);
  const nameClash = others.find(([, info]) => plainName(info.label).toLowerCase() === name.toLowerCase() || plainName(info.name).toLowerCase() === name.toLowerCase());
  const shortClash = others.find(([, info]) => !info.retired && info.short.toLowerCase() === short.toLowerCase());
  const teacherClash = teacherChoice === "__new" && data.teachers.find((teacher) => teacher.label.toLowerCase() === teacherLabel({ title: newTitle, name: newName }).toLowerCase());
  const errors = {
    subjectName: !name ? "Gib dem Fach einen Namen, zum Beispiel Informatik." : nameClash ? (nameClash[1].retired ? `${nameClash[1].label} hast du gelöscht, unter „Gelöscht“ holst du es zurück.` : `${nameClash[1].label} gibt es schon.`) : "",
    subjectShort: !short ? "Gib ein Kürzel ein, zum Beispiel Inf." : shortClash ? `Das Kürzel hat schon ${shortClash[1].label}.` : "",
    subjectNewName: teacherChoice !== "__new" ? "" : !newName ? "Trag den Nachnamen der Lehrkraft ein." : teacherClash ? `${teacherClash.label} gibt es schon, wähl sie in der Liste.` : "",
  };
  Object.entries(errors).forEach(([id, text]) => setError($(id), $(`${id}Error`), text));
  const first = Object.keys(errors).find((id) => errors[id]);
  if (first) {
    $(first).focus();
    say(errors[first]);
    return;
  }
  let target = key;
  commitCatalog((draft) => {
    let teacher = teacherChoice;
    if (teacher === "__new") {
      teacher = `t-${Date.now().toString(36)}`;
      draft.teachers.items[teacher] = { custom: true, title: newTitle, name: newName };
    }
    if (room) addRoom(draft.rooms, room);
    if (creating) {
      target = uniqueSubjectKey(draft, short || name);
      draft.subjects.items[target] = { custom: true, name, short, hue, type, teacher, room };
      return;
    }
    const own = { ...(draft.subjects.items[key] || {}) };
    if (name !== plainName(data.subjects[key].label)) own.name = name;
    Object.assign(own, { short, hue, type, teacher, room });
    draft.subjects.items[key] = own;
  }, creating ? `${esc(name)} angelegt` : "", creating ? "plus" : "check");
  catalog.subject = null;
  renderSubjects();
  const button = $(`subject-edit-${target}`);
  button?.focus({ preventScroll: true });
  if (creating) {
    enterInPlace($(`subject-row-${target}`));
    say(`${name} angelegt. Eintragen kannst du es im Stundenplan.`);
  } else {
    say(`${name} gespeichert`);
  }
}

// A subject from the school plan, and an own one that has grades or entries, is only put aside: its grades stay visible and count on.
function keptOnDelete(key) {
  const use = page.subjectUse?.[key];
  return !data.subjects[key]?.custom || !!(use && (use.grades || use.entries));
}

function deleteWarning(key) {
  const info = data.subjects[key];
  const count = cellsOf(key).length;
  const lessonsText = count ? `${esc(info.label)} steht in ${plural(count, "Stunde", "Stunden")} im Stundenplan. Beim Löschen werden sie geleert.` : "";
  const gradesText = keptOnDelete(key) ? `Die Noten ${count ? "" : `von ${esc(info.label)} `}bleiben erhalten und zählen weiter im Schnitt. Tests und Abgaben des Fachs blendet ${BRAND} aus, unter „Gelöscht“ holst du es zurück.` : "";
  return [lessonsText, gradesText].filter(Boolean).join(" ");
}

// What hangs on a subject is counted when the page loads. Before a subject goes it is counted again, so that a grade entered since then is not overlooked.
async function countSubjectUse() {
  if (root.dataset.shell) return;
  try {
    page.subjectUse = (await request("GET", "/api/ui/subjects/use")).use;
  } catch {}
}

async function askDeleteSubject(key) {
  await countSubjectUse();
  if (catalog.subject !== key || !$("subjectConfirm")) return;
  if (data.subjects[key]?.custom && !cellsOf(key).length && !keptOnDelete(key)) {
    deleteSubject(key);
    return;
  }
  $("subjectConfirmText").innerHTML = deleteWarning(key);
  $("subjectConfirm").hidden = false;
  $("subjectActions").hidden = true;
  $("subjectKeep").focus({ preventScroll: true });
}

function deleteSubject(key) {
  const info = data.subjects[key];
  if (!info) return;
  const shown = cellsOf(key).length;
  const iserv = !info.custom;
  const kept = keptOnDelete(key);
  commitCatalog((draft) => {
    cellsOf(key, { all: true }).forEach(([week, dow, n]) => {
      if (iserv && baseLesson(week, dow, n)?.subject === key) delete draft.lessons[cellKey(week, dow, n)];
      else setLesson(draft.lessons, week, dow, n, null);
    });
    if (!kept) delete draft.subjects.items[key];
    else if (!draft.subjects.removed.includes(key)) draft.subjects.removed.push(key);
  }, `${esc(info.label)} gelöscht${shown ? `, ${plural(shown, "Stunde", "Stunden")} geleert` : ""}${kept ? ". Die Noten bleiben im Schnitt." : ""}`, "trash-2");
  catalog.subject = null;
  renderSubjects();
  $("subjectAdd")?.focus({ preventScroll: true });
}

function restoreSubject(key) {
  const info = data.subjects[key];
  if (!info?.retired) return;
  commitCatalog((draft) => {
    draft.subjects.removed = draft.subjects.removed.filter((item) => item !== key);
    Object.keys(draft.lessons).forEach((cell) => {
      const [week, dow, n] = cell.split(":");
      if (draft.lessons[cell] === null && baseLesson(week, Number(dow), Number(n))?.subject === key) delete draft.lessons[cell];
    });
  }, () => {
    const count = cellsOf(key).length;
    return `${esc(subject(key).label)} ist wieder da${count ? `, ${plural(count, "Stunde", "Stunden")} im Stundenplan` : ""}`;
  }, "rotate-ccw");
  const next = retiredKeys()[0];
  ($(next ? `subject-restore-${next}` : `subject-edit-${key}`))?.focus({ preventScroll: true });
  enterInPlace($(`subject-row-${key}`));
}

function openSubjectForm(key) {
  catalog.subject = key;
  catalog.shortTouched = key !== "new";
  renderSubjects();
  $("subjectName")?.focus({ preventScroll: key === "new" });
}

function closeSubjectForm() {
  const key = catalog.subject;
  catalog.subject = null;
  renderSubjects();
  ($(`subject-edit-${key}`) || $("subjectAdd"))?.focus({ preventScroll: true });
}

function saveTeacher(formNode) {
  const id = formNode.dataset.id;
  const title = $("teacherTitle").value;
  const name = $("teacherName").value.replace(/\s+/g, " ").trim();
  const label = teacherLabel({ title, name });
  const clash = data.teachers.find((teacher) => teacher.id !== id && teacher.label.toLowerCase() === label.toLowerCase());
  const error = !name ? "Trag den Nachnamen ein, zum Beispiel Schulz." : clash ? `${clash.label} gibt es schon.` : "";
  setError($("teacherName"), $("teacherNameError"), error);
  if (error) {
    $("teacherName").focus();
    say(error);
    return;
  }
  let target = id;
  commitCatalog((draft) => {
    if (id === "new") {
      target = `t-${Date.now().toString(36)}`;
      draft.teachers.items[target] = { custom: true, title, name };
    } else {
      draft.teachers.items[id] = { ...(draft.teachers.items[id] || {}), title, name };
    }
  }, id === "new" ? `${esc(label)} hinzugefügt` : "", "user");
  catalog.teacher = null;
  renderTeachers();
  $(`teacher-edit-${target}`)?.focus({ preventScroll: true });
  if (id === "new") enterInPlace($(`teacher-row-${target}`));
  else say(`${label} gespeichert`);
}

function removeTeacher(id) {
  const teacher = data.teachers.find((item) => item.id === id);
  if (!teacher) return;
  const order = sortedTeachers().map((item) => item.id);
  const next = order[order.indexOf(id) + 1] || order[order.indexOf(id) - 1];
  const taught = sortedSubjectKeys().filter((key) => data.subjects[key].teacherId === id).map((key) => data.subjects[key].label);
  commitCatalog((draft) => {
    delete draft.teachers.items[id];
    if (!teacher.custom && !draft.teachers.removed.includes(id)) draft.teachers.removed.push(id);
  }, `${esc(teacher.label)} entfernt${taught.length ? `, ${esc(joinWords(taught))} jetzt ${NO_TEACHER}` : ""}`, "trash-2");
  ($(`teacher-remove-${next}`) || $("teacherAdd"))?.focus({ preventScroll: true });
}

function submitRoom() {
  const input = $("roomNew");
  const room = normalizeRoom(input.value);
  const error = !room ? "Trag einen Raum ein, zum Beispiel R210." : data.rooms.includes(room) ? `${room} steht schon in der Liste.` : "";
  setError(input, $("roomError"), error);
  if (error) {
    input.focus();
    say(error);
    return;
  }
  commitCatalog((draft) => addRoom(draft.rooms, room));
  $("roomNew")?.focus({ preventScroll: true });
  enterInPlace($(`room-${slug(room)}`));
  say(`${room} hinzugefügt`);
}

function removeRoom(room) {
  const order = [...data.rooms];
  const next = order[order.indexOf(room) + 1] || order[order.indexOf(room) - 1];
  commitCatalog((draft) => dropRoom(draft.rooms, room), `${esc(room)} aus der Liste entfernt`, "trash-2");
  ($(next ? `room-remove-${slug(next)}` : "roomNew"))?.focus({ preventScroll: true });
}

function bindCatalog() {
  const subjects = $("subjectsCard");
  $("subjectAdd").addEventListener("click", () => openSubjectForm("new"));
  subjects.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-subject]");
    if (edit) openSubjectForm(edit.dataset.editSubject);
    else if (event.target.closest("#subjectCancel")) closeSubjectForm();
    else if (event.target.closest("[data-restore-subject]")) restoreSubject(event.target.closest("[data-restore-subject]").dataset.restoreSubject);
    else if (event.target.closest("#subjectDelete")) askDeleteSubject(catalog.subject);
    else if (event.target.closest("#subjectKeep")) {
      $("subjectConfirm").hidden = true;
      $("subjectActions").hidden = false;
      $("subjectDelete").focus({ preventScroll: true });
    } else if (event.target.closest("#subjectConfirmDelete")) {
      deleteSubject(catalog.subject);
    }
  });
  subjects.addEventListener("submit", (event) => {
    if (event.target.id !== "subjectForm") return;
    event.preventDefault();
    saveSubject(event.target);
  });
  subjects.addEventListener("change", (event) => {
    if (event.target.id !== "subjectTeacher") return;
    const fresh = event.target.value === "__new";
    $("subjectNewTeacher").hidden = !fresh;
    if (fresh) $("subjectNewName").focus();
  });
  subjects.addEventListener("input", (event) => {
    const target = event.target;
    if (target.id === "subjectShort") catalog.shortTouched = true;
    if (target.id === "subjectName" && catalog.subject === "new" && !catalog.shortTouched) {
      const letters = target.value.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 3);
      $("subjectShort").value = letters ? letters[0].toUpperCase() + letters.slice(1).toLowerCase() : "";
    }
    if (["subjectName", "subjectShort", "subjectNewName"].includes(target.id) && target.value.trim()) setError(target, $(`${target.id}Error`), "");
  });
  subjects.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && event.target.closest("#subjectForm")) {
      event.preventDefault();
      closeSubjectForm();
    }
  });

  const teachers = $("teachersCard");
  teachers.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-teacher]");
    const remove = event.target.closest("[data-remove-teacher]");
    if (event.target.closest("#teacherAdd")) {
      catalog.teacher = "new";
      renderTeachers();
      $("teacherName")?.focus();
    } else if (edit) {
      catalog.teacher = edit.dataset.editTeacher;
      renderTeachers();
      $("teacherName")?.focus();
    } else if (remove) {
      removeTeacher(remove.dataset.removeTeacher);
    } else if (event.target.closest("#teacherCancel")) {
      const id = catalog.teacher;
      catalog.teacher = null;
      renderTeachers();
      ($(`teacher-edit-${id}`) || $("teacherAdd"))?.focus({ preventScroll: true });
    }
  });
  teachers.addEventListener("submit", (event) => {
    if (event.target.id !== "teacherForm") return;
    event.preventDefault();
    saveTeacher(event.target);
  });
  teachers.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !event.target.closest("#teacherForm")) return;
    event.preventDefault();
    const id = catalog.teacher;
    catalog.teacher = null;
    renderTeachers();
    ($(`teacher-edit-${id}`) || $("teacherAdd"))?.focus({ preventScroll: true });
  });
  teachers.addEventListener("input", (event) => {
    if (event.target.id === "teacherName" && event.target.value.trim()) setError(event.target, $("teacherNameError"), "");
  });

  const rooms = $("roomsCard");
  rooms.addEventListener("submit", (event) => {
    if (event.target.id !== "roomForm") return;
    event.preventDefault();
    submitRoom();
  });
  rooms.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-room]");
    if (remove) removeRoom(remove.dataset.removeRoom);
  });
  rooms.addEventListener("input", (event) => {
    if (event.target.id === "roomNew" && event.target.value.trim()) setError(event.target, $("roomError"), "");
  });
}

const AREAS = [
  [[LOCAL_KEYS.lessons, LOCAL_KEYS.abSwap, LOCAL_KEYS.abWeeks], "Stundenplan"],
  [[LOCAL_KEYS.subjects, LOCAL_KEYS.teachers, LOCAL_KEYS.rooms], "Fächer"],
  [[LOCAL_KEYS.blocks], "Stundenraster"],
  [[THEME_KEY, LOCAL_KEYS.motion, KEYS_KEY], "Darstellung"],
  [[PREFS_KEY], "Einstellungen"],
];

function localKeys() {
  return storage.keys().filter((key) => /^app-/.test(key)).sort();
}

function snapshot() {
  const values = {};
  localKeys().forEach((key) => {
    const value = storage.get(key);
    if (value != null) values[key] = JSON.stringify(value);
  });
  return values;
}

function restore(values) {
  localKeys().forEach(removeKey);
  Object.entries(values).forEach(([key, value]) => {
    try {
      storage.set(key, JSON.parse(value));
    } catch {}
  });
  reloadState();
}

function reloadState() {
  applySchoolEdits();
  prefs = loadPrefs();
  const theme = storage.get(THEME_KEY);
  applyTheme(theme === "light" || theme === "dark" ? theme : "auto", { animate: false });
  if (motionDefault !== "minimal") {
    const value = storage.get(LOCAL_KEYS.motion) === "minimal" ? "minimal" : motionDefault;
    root.dataset.motion = value;
    variant.motion = value;
  }
  syncSingleKeys();
  if (sheet.matches(":popover-open")) closeEditor();
  plan.editing = null;
  accounts.formOpen = false;
  placeState.editing = false;
  catalog.subject = null;
  catalog.teacher = null;
  raster.confirm = false;
  renderAll();
}

const assistant = { status: null, config: null, busy: false, saving: false, basic: storedBasic() };

function storedBasic() {
  try {
    return Boolean(JSON.parse(document.getElementById("appStore")?.textContent || "{}")["app-assistant-basic"]);
  } catch {
    return false;
  }
}
const AI_SOURCES = [
  ["auto", "Automatisch", "Nimmt das eingebaute Sprachmodell. Fehlt es, kommt Ollama an die Reihe, danach Claude."],
  ["local", "Eingebautes Sprachmodell", "Läuft auf diesem Gerät, auch ohne Internet."],
  ["ollama", "Ollama", "Nutzt ein Modell, das Ollama auf diesem Gerät bereithält."],
  ["claude", "Claude", "Schickt deine Frage und die Schuldaten, die sie braucht, an Anthropic. Dafür brauchst du einen eigenen API-Schlüssel."],
  ["offline", "Ohne Sprachmodell", "Der Assistent beantwortet dann nur Fragen zu Stundenplan, Schule und Mathe."],
];
const AI_NAMES = { local: "das eingebaute Sprachmodell", ollama: "Ollama" };
// Why the chosen source cannot answer right now. Whether a stored key is accepted only shows when a question is asked, so nothing here calls it valid.
const AI_WAITS = {
  local: () => "Es ist noch nicht installiert.",
  ollama: (config) => (config.ollama_running ? "Ollama kennt dieses Modell nicht." : "Ollama läuft auf diesem Gerät gerade nicht."),
  claude: (config) => (config.claude_api_key_set ? "Claude lässt sich auf diesem Gerät gerade nicht ansprechen." : "Es fehlt noch ein Schlüssel."),
};

function aiSourceRows() {
  const config = assistant.config;
  if (!config) return [];
  const chosen = AI_SOURCES.some(([key]) => key === config.preferred_backend) ? config.preferred_backend : "auto";
  const active = config.active || {};
  let state = "";
  if (chosen !== "offline") {
    const model = active.model ? ` (${esc(active.model)})` : "";
    if (chosen !== "auto" && active.backend !== chosen) state = ` ${AI_WAITS[chosen](config)} Bis dahin gibt es nur Antworten ohne Sprachmodell.`;
    else if (active.backend === "claude") state = ` Fragen gehen mit deinem Schlüssel an Claude${model}.`;
    else if (active.available && AI_NAMES[active.backend]) state = ` Gerade antwortet ${AI_NAMES[active.backend]}${model}.`;
    else state = " Gerade ist kein Sprachmodell erreichbar.";
  }
  const options = AI_SOURCES.map(([key, name]) => `<option value="${key}"${key === chosen ? " selected" : ""}>${name}</option>`).join("");
  const rows = [row({
    id: "rowAiSource", label: "Antworten kommen von", forId: "aiSource", desc: AI_SOURCES.find(([key]) => key === chosen)[2] + state,
    control: `<select class="field-control" id="aiSource" aria-describedby="rowAiSourceDesc">${options}</select>`, cls: "is-stack",
  })];
  if (chosen === "ollama") {
    const loaded = config.ollama_models || [];
    const missing = (name) => loaded.length > 0 && !loaded.includes(name) && !loaded.includes(`${name}:latest`);
    const models = [...new Set([config.ollama_model, ...loaded].filter(Boolean))];
    const choices = models.map((name) => `<option value="${esc(name)}"${name === config.ollama_model ? " selected" : ""}>${esc(name)}${missing(name) ? " (fehlt in Ollama)" : ""}</option>`).join("");
    rows.push(row({
      id: "rowAiOllama", label: "Ollama-Modell", forId: "aiOllamaModel",
      desc: loaded.length ? "Zur Wahl stehen die Modelle, die Ollama auf diesem Gerät hat." : config.ollama_running ? "Ollama hat noch kein Modell. Lade dort zuerst eins." : "Ollama läuft auf diesem Gerät gerade nicht.",
      control: `<select class="field-control" id="aiOllamaModel" aria-describedby="rowAiOllamaDesc">${choices}</select>`, cls: "is-stack",
    }));
  }
  if (chosen === "claude") {
    rows.push(config.claude_api_key_set
      ? row({ id: "rowAiKey", label: "API-Schlüssel", desc: `Gespeichert: ${esc(config.claude_api_key_masked)}. Er liegt verschlüsselt auf diesem Gerät.`, control: `<button class="btn btn-quiet" type="button" id="aiKeyRemove">Entfernen</button>` })
      : `<form class="set-row is-stack" id="aiKeyForm" novalidate autocomplete="off">
          <div class="set-row-text"><label class="set-row-label" for="aiKeyInput">API-Schlüssel</label><p class="set-row-desc" id="aiKeyDesc">Aus der Anthropic-Konsole. Er wird verschlüsselt auf diesem Gerät abgelegt.</p></div>
          <div class="set-row-control"><input class="field-control" id="aiKeyInput" type="password" maxlength="300" autocomplete="off" spellcheck="false" aria-describedby="aiKeyDesc aiKeyError"><button class="btn btn-primary" type="submit">Speichern</button>${errorHtml("aiKeyError", "")}</div>
        </form>`);
  }
  return rows;
}

async function saveAiConfig(changes, done = "", focusNext = "") {
  if (assistant.saving) return;
  assistant.saving = true;
  let saved = true;
  try {
    assistant.config = await request("POST", "/api/hub/assistant/config", changes);
  } catch {
    saved = false;
    toast("Das ließ sich gerade nicht speichern. Versuch es gleich noch einmal.", { icon: "circle-alert" });
  }
  assistant.saving = false;
  // A key that could not be saved stays in its field. Everything else is drawn again and so falls back to what is stored.
  if (saved || !("claude_api_key" in changes)) renderAssistant();
  if (!saved) return;
  if (done) toast(done, { icon: "check" });
  if (focusNext) $(focusNext)?.focus({ preventScroll: true });
}
const decimalGb = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const gigabytes = (bytes) => (bytes >= 1e9 ? `${decimalGb.format(bytes / 1e9)}\u00a0GB` : `${Math.max(1, Math.round((bytes || 0) / 1e6))}\u00a0MB`);

function renderAssistant() {
  const card = $("aiSetCard");
  if (!card) return;
  const status = assistant.status;
  const meta = $("aiSetMeta");
  if (!status) {
    meta.textContent = "";
    card.innerHTML = loadingHtml("Prüfe den Assistenten", "Dauert nur einen Moment.");
    return;
  }
  const job = status.job || {};
  const model = status.model || {};
  const open = (text, install = false) => `<a class="btn btn-quiet" href="/hub/assistant${install ? "?installieren=1" : ""}">${icon(install ? "download" : "message-circle")}${text}</a>`;
  let rows;
  if (job.state === "running") {
    meta.textContent = "Wird installiert";
    rows = [row({ id: "rowAiState", label: "Sprachmodell", desc: `${esc(model.name)} wird gerade installiert.`, control: open("Ansehen") })];
  } else if (status.installed) {
    meta.textContent = "Installiert";
    rows = [
      row({ id: "rowAiState", label: "Sprachmodell", desc: `${esc(model.name)} · ${gigabytes(model.size)}. Läuft auf diesem Gerät, auch ohne Internet.`, control: open("Öffnen") }),
    ];
    if (status.runtime?.kind === "python" && status.runtime?.download) {
      rows.push(row({ id: "rowAiUpdate", label: "Neue Laufzeit", desc: `Antwortet schneller und gibt den Arbeitsspeicher nach fünf Minuten Pause wieder frei. Download ${gigabytes(status.runtime.download)}.`, control: `<button class="btn btn-quiet" type="button" id="aiUpdate"${assistant.busy ? " disabled" : ""}>${icon("download")}Aktualisieren</button>` }));
    }
    rows.push(row({ id: "rowAiRemove", label: "Assistent entfernen", desc: `Gibt ${gigabytes(model.size)} frei. Du kannst ihn jederzeit wieder installieren.`, control: `<button class="btn btn-quiet" type="button" id="aiRemove"${assistant.busy ? " disabled" : ""}>${icon("trash-2")}Entfernen</button>` }));
  } else if (!status.supported) {
    meta.textContent = "Nicht verfügbar";
    rows = [row({ id: "rowAiState", label: "Sprachmodell", desc: "Für dieses Gerät gibt es keine passende Laufzeit." })];
  } else {
    meta.textContent = assistant.basic ? "Ohne Sprachmodell" : "Nicht installiert";
    const size = (status.runtime?.download || 0) + (model.download || 0);
    const why = assistant.basic ? "Du nutzt den Assistenten ohne Sprachmodell, deshalb beantwortet er nur Fragen zu Stundenplan, Schule und Mathe." : "Ohne Sprachmodell beantwortet der Assistent nur Fragen zu Stundenplan, Schule und Mathe.";
    rows = [row({ id: "rowAiState", label: "Sprachmodell", desc: `Nicht installiert. ${why} Download ${gigabytes(size)}.`, control: open("Installieren", true) })];
    if (assistant.basic) {
      rows.push(row({ id: "rowAiBasic", label: "Wahl beim Öffnen", desc: "Du hast „Ohne KI öffnen“ gewählt. Der Assistent fragt deshalb nicht mehr nach dem Sprachmodell.", control: `<button class="btn btn-quiet" type="button" id="aiAskAgain"${assistant.busy ? " disabled" : ""}>Wieder fragen</button>` }));
    }
  }
  keepFocus(card, () => (card.innerHTML = [...rows, ...aiSourceRows()].join("")));
}

async function loadAssistant() {
  try {
    assistant.status = await request("GET", "/api/hub/assistant/install");
  } catch {
    assistant.status = null;
    $("aiSetCard").innerHTML = row({ id: "rowAiState", label: "Sprachmodell", desc: "Der Stand lässt sich gerade nicht abfragen." });
    return;
  }
  renderAssistant();
  await loadAiConfig();
}

// Which source answers depends on what is installed, so this is asked again whenever that changes.
async function loadAiConfig() {
  try {
    assistant.config = await request("GET", "/api/hub/assistant/config");
  } catch {
    assistant.config = null;
  }
  renderAssistant();
}

async function removeAssistant(button) {
  if (!confirmTwice("assistant", button, "Wirklich entfernen?", "Zum Entfernen noch einmal drücken")) return;
  const size = assistant.status?.model?.size || 0;
  assistant.busy = true;
  renderAssistant();
  try {
    assistant.status = await request("DELETE", "/api/hub/assistant/install");
    toast(`Assistent entfernt, ${gigabytes(size)} wieder frei`, { icon: "trash-2" });
  } catch {
    toast("Der Assistent ließ sich gerade nicht entfernen. Versuch es gleich noch einmal.", { icon: "circle-alert" });
  } finally {
    assistant.busy = false;
    renderAssistant();
  }
  await loadAiConfig();
}

async function askAgain() {
  assistant.busy = true;
  renderAssistant();
  try {
    const response = await fetch("/api/ui/store/app-assistant-basic", { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) throw new Error(String(response.status));
    assistant.basic = false;
    toast("Beim nächsten Öffnen fragt der Assistent wieder nach dem Sprachmodell.", { icon: "check" });
  } catch {
    toast("Das ließ sich gerade nicht speichern. Versuch es gleich noch einmal.", { icon: "circle-alert" });
  } finally {
    assistant.busy = false;
    renderAssistant();
  }
  $("rowAiState")?.querySelector("a, button")?.focus({ preventScroll: true });
}

async function updateRuntime() {
  assistant.busy = true;
  renderAssistant();
  try {
    await request("POST", "/api/hub/assistant/install");
    location.assign("/hub/assistant");
  } catch {
    assistant.busy = false;
    renderAssistant();
    toast("Die neue Laufzeit ließ sich gerade nicht laden. Versuch es gleich noch einmal.", { icon: "circle-alert" });
  }
}

function bindAssistant() {
  if (root.dataset.shell) {
    $("assistent")?.remove();
    document.querySelector('.set-nav-item[data-section="assistent"]')?.closest("li")?.remove();
    return;
  }
  $("aiSetCard").addEventListener("click", (event) => {
    const button = event.target.closest("#aiRemove");
    if (button && !button.disabled) removeAssistant(button);
    if (event.target.closest("#aiUpdate:not(:disabled)")) updateRuntime();
    if (event.target.closest("#aiAskAgain:not(:disabled)")) askAgain();
    const keyRemove = event.target.closest("#aiKeyRemove");
    if (keyRemove && confirmTwice("ai-key", keyRemove, "Wirklich entfernen?", "Zum Entfernen noch einmal drücken")) saveAiConfig({ claude_api_key: "" }, "Schlüssel entfernt", "aiKeyInput");
  });
  $("aiSetCard").addEventListener("change", (event) => {
    if (event.target.id === "aiSource") saveAiConfig({ preferred_backend: event.target.value });
    else if (event.target.id === "aiOllamaModel") saveAiConfig({ ollama_model: event.target.value });
  });
  $("aiSetCard").addEventListener("submit", (event) => {
    if (event.target.id !== "aiKeyForm") return;
    event.preventDefault();
    const input = $("aiKeyInput");
    const key = input.value.trim();
    const wrong = !key ? "Füg hier deinen Schlüssel ein." : /^sk-ant-\S+$/.test(key) ? "" : "Das sieht nicht nach einem Anthropic-Schlüssel aus. Er beginnt mit sk-ant-.";
    setError(input, $("aiKeyError"), wrong);
    if (wrong) input.focus();
    else saveAiConfig({ claude_api_key: key }, "Schlüssel gespeichert", "aiKeyRemove");
  });
  loadAssistant();
}

function renderDataMeta() {
  const keys = new Set(localKeys());
  const areas = AREAS.filter(([list]) => list.some((key) => keys.has(key))).map(([, name]) => name);
  const node = $("dataMeta");
  if (node) node.textContent = areas.length ? `Auf diesem Gerät: ${joinWords(areas)}` : "Noch nichts geändert";
}

let keptData = null;

function storageManager() {
  try {
    return window.top.navigator.storage || null;
  } catch {
    return navigator.storage || null;
  }
}

function storageRow() {
  const note = storageNote({ shell: root.dataset.shell, persisted: keptData, device: appleDevice(), homeScreen: onHomeScreen(), macSafari: safariOnMac(navigator.userAgent, navigator.maxTouchPoints || 0), brand: BRAND });
  if (!note) return "";
  const control = {
    tab: `<span class="status is-warn">Vorläufig</span>`,
    kept: `<span class="status is-ok">${icon("circle-check")}Dauerhaft</span>`,
    ask: `<button class="btn btn-quiet" type="button" id="dataKeep">${icon("hard-drive")}Dauerhaft speichern</button>`,
  }[note.state];
  return row({ id: "rowStorage", label: "Speicher", desc: note.text, control });
}

async function keepData() {
  let kept = false;
  try {
    kept = await storageManager().persist();
  } catch {}
  keptData = kept;
  renderData();
  if (kept) say("Dauerhaft gespeichert");
  else toast("Der Browser lässt das gerade nicht zu. Sichere deine Einträge ab und zu mit Exportieren.", { icon: "circle-alert" });
}

function renderData() {
  const card = $("dataCard");
  keepFocus(card, () => {
    card.innerHTML = [
      storageRow(),
      row({ id: "rowExport", label: "Sichern", desc: "Stundenplan, Fächer, Noten, Tests, Klausuren, Aufgaben, Termine, Orte und Einstellungen als Datei", control: `<button class="btn btn-quiet" type="button" id="dataExport">${icon("download")}Exportieren</button>` }),
      row({ id: "rowImport", label: "Wiederherstellen", desc: `Übernimmt eine gesicherte Datei von ${BRAND}, auch von einem anderen Gerät. Vorhandene Noten, Aufgaben und Termine bleiben. Stecken Noten oder Aufgaben in der Datei, kannst du vorher wählen, ob nur der Stundenplan kommt.`, control: `<button class="btn btn-quiet" type="button" id="dataImport">${icon("upload")}Importieren</button>` }),
      row({ id: "rowWipe", label: "Alles auf diesem Gerät löschen", desc: "Nimmt alle Änderungen an Stundenplan und Fächern zurück und stellt die Einstellungen wie beim ersten Start.", control: `<button class="btn btn-quiet danger-button" type="button" id="dataWipe">${icon("trash-2")}Löschen</button>` }),
    ].join("");
  });
  renderDataMeta();
}

function portableValues() {
  const values = snapshot();
  if (!schoolDefaults) return values;
  applySchoolEdits();
  const whole = wholeSchool({
    subjects: data.subjects,
    teachers: data.teachers,
    rooms: data.rooms,
    blocks: data.blocks,
    timetable: data.timetable,
    edits: storage.get(LOCAL_KEYS.lessons),
    gone: { teachers: storage.get(LOCAL_KEYS.teachers)?.removed, rooms: storage.get(LOCAL_KEYS.rooms)?.removed },
    weeks: abWeeks(),
  });
  Object.entries(whole).forEach(([key, value]) => (values[key] = JSON.stringify(value)));
  const saved = storage.get(PREFS_KEY);
  const own = saved && typeof saved === "object" ? saved : {};
  const basics = { ...(own.school || {}), grade: prefs.school.grade, state: prefs.school.state, birthday: prefs.school.birthday };
  if (!basics.birthday) delete basics.birthday;
  values[PREFS_KEY] = JSON.stringify({ ...own, school: basics });
  return values;
}

const exported = { records: undefined, pending: null };

function readRecords() {
  const pending = request("GET", "/api/ui/export").then((answer) => answer.data);
  exported.pending = pending;
  pending.then((records) => {
    if (exported.pending === pending) exported.records = records;
  }, () => {});
  return pending;
}

function forgetRecords() {
  exported.records = undefined;
  readRecords();
}

// The records are read before the tap, so that the share sheet still opens inside the click on iPhone and iPad.
async function exportData() {
  let records = exported.records;
  if (records === undefined) records = await (exported.pending || readRecords()).catch(() => null);
  const payload = { app: BRAND, version: VERSION, exportedAt: new Date().toISOString(), values: portableValues() };
  const keys = schoolDefaults ? fileKeys(data.subjects) : new Map();
  if (schoolDefaults) payload.school = { abReference: data.abReference, subjects: fileSubjects(schoolDefaults.subjects, keys) };
  if (records) payload.data = fileRecords(records, keys);
  const name = `${slug(BRAND) || "app"}-sicherung-${isoDate(now())}.json`;
  const missing = payload.data ? "" : ", aber ohne Noten, Aufgaben und Termine. Sie ließen sich gerade nicht lesen.";
  const shell = window.hubShell;
  if (typeof shell?.saveFile === "function") {
    let saved = null;
    try {
      saved = await shell.saveFile(name, JSON.stringify(payload, null, 2));
    } catch {}
    if (saved?.error === "denied") {
      toast(`${BRAND} darf nicht in „Downloads“ speichern. Erlaube es unter Systemeinstellungen › Datenschutz & Sicherheit › Dateien und Ordner.`, { icon: "circle-alert", duration: 12000 });
      return;
    }
    if (saved?.error === "cancelled") return;
    if (saved?.error === "too-large") {
      toast("Die Sicherung ist zu groß, um sie hier zu speichern.", { icon: "circle-alert" });
      return;
    }
    if (!saved?.name) {
      toast("Die Sicherung ließ sich nicht im Ordner „Downloads“ speichern.", { icon: "circle-alert" });
      return;
    }
    const reveal = typeof shell.showFile === "function" && saved.path ? { label: "Im Finder zeigen", run: () => shell.showFile(saved.path) } : undefined;
    const place = saved.folder ? `in „${esc(saved.folder)}“ ` : "";
    toast(`Gesichert ${place}als „${esc(saved.name)}“${missing}`, { icon: missing ? "triangle-alert" : "download", action: reveal });
    return;
  }
  const result = await offerFile(name, JSON.stringify(payload, null, 2));
  if (result === "cancelled") return;
  if (result === "failed") {
    toast("Die Sicherung ließ sich nicht teilen. Versuch es noch einmal.", { icon: "circle-alert" });
    return;
  }
  toast(`Gesichert als „${esc(name)}“${missing}`, { icon: missing ? "triangle-alert" : "download" });
}

const RECORD_NAMES = { deadlines: "deadline", tasks: "task", grades: "grade", notes: "note", events: "event" };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function patient(method, url, body) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    if (response.status === 429 && attempt < 5) {
      await pause(15000);
      continue;
    }
    let answer = {};
    try {
      answer = await response.json();
    } catch {}
    if (!response.ok || answer.success === false) throw new Error(answer.error || "");
    return answer;
  }
}

async function carryRecords(plan) {
  await storage.settled();
  const made = {};
  const undo = [];
  const refs = new Map(plan.deadlines.known.map(([item, twin]) => [item.id, twin.id]));
  let failed = plan.skipped;
  let known = 0;
  for (const kind of KINDS) {
    known += plan[kind].known.length;
    for (const item of plan[kind].fresh) {
      try {
        const saved = (await patient("POST", `/api/ui/${kind}`, BODIES[kind](item, refs)))[RECORD_NAMES[kind]];
        if (kind === "deadlines") refs.set(item.id, saved?.id);
        if (saved?.id) undo.push([kind, saved.id]);
        const word = kind === "deadlines" ? item.kind : kind;
        made[word] = (made[word] || 0) + 1;
      } catch {
        failed += 1;
      }
    }
  }
  for (const [key, body, previous] of plan.places) {
    try {
      const saved = await patient("PUT", `/api/ui/places/${key}`, body);
      page.places = { ...(page.places || {}), [key]: placeLine(body), ...followedWeather(saved) };
      undo.push(["places", key, previous]);
      made.places = (made.places || 0) + 1;
    } catch {
      failed += 1;
    }
  }
  forgetRecords();
  return { made, known, failed, undo };
}

async function dropRecords(undo) {
  let left = 0;
  for (const [kind, id, previous] of [...undo].reverse()) {
    try {
      if (kind !== "places") await patient("DELETE", `/api/ui/${kind}/${encodeURIComponent(id)}`);
      else if (previous) page.places = { ...(page.places || {}), [id]: placeLine(previous), ...followedWeather(await patient("PUT", `/api/ui/places/${id}`, previous)) };
      else page.places = { ...(page.places || {}), [id]: "", ...followedWeather(await patient("DELETE", `/api/ui/places/${id}`)) };
    } catch {
      left += 1;
    }
  }
  forgetRecords();
  return left;
}

async function importData(file) {
  let payload = null;
  try {
    payload = JSON.parse(await file.text());
  } catch {}
  const known = BRAND_NAMES.map((name) => name.toLowerCase());
  const prefix = new RegExp(`^(app|${known.map((name) => slug(name)).filter(Boolean).join("|")})-`);
  const ours = known.includes(String(payload?.app || "").toLowerCase());
  if (ours && payload.kind === "plan") {
    importFlow({ file });
    return;
  }
  const values = ours && payload.values && typeof payload.values === "object" ? payload.values : null;
  const entries = values ? Object.entries(values).filter(([key, value]) => prefix.test(key) && typeof value === "string").map(([key, value]) => [key.replace(prefix, "app-"), value]) : [];
  const records = ours && payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data : null;
  if (!entries.length && !records) {
    toast(`Die Datei ist keine Sicherung von ${BRAND}.`, { icon: "circle-alert" });
    return;
  }
  if (importing) return;
  importing = true;
  const button = $("dataImport");
  if (button) button.disabled = true;
  try {
    const inside = records ? contents(records) : "";
    const choice = inside ? await askBackup(inside, { settings: entries.length > 0 }) : "all";
    if (choice === "plan") importFlow({ backup: payload });
    else if (choice === "all") await takeBackup(file, payload, entries, records);
  } catch {
    toast("Die Sicherung ließ sich nicht ganz übernehmen. Lies die Datei noch einmal ein, schon Übernommenes wird dabei nicht doppelt angelegt.", { icon: "triangle-alert" });
  } finally {
    importing = false;
    if ($("dataImport")) $("dataImport").disabled = false;
  }
}

let importing = false;

async function carryState(wanted) {
  const here = page.school?.state || "";
  if (wanted && wanted !== here && (page.states || []).some((state) => state.code === wanted)) {
    try {
      await request("POST", "/api/hub/bundesland", { bundesland: wanted });
      page.school = { ...(page.school || {}), state: wanted };
    } catch {}
  }
  const settled = page.school?.state || "";
  if (settled && prefs.school.state !== settled) {
    prefs.school.state = settled;
    savePrefs();
  }
  renderSchool();
}

async function takeBackup(file, payload, entries, records) {
  const before = snapshot();
  const stateBefore = page.school?.state || "";
  const schoolBefore = { ...prefs.school };
  let wanted = Object.fromEntries(entries);
  let keys = null;
  let retired = [];
  if (entries.length && payload.school && typeof payload.school === "object" && schoolDefaults) {
    const parsed = {};
    entries.forEach(([key, value]) => {
      try {
        parsed[key] = JSON.parse(value);
      } catch {}
    });
    const own = { subjects: storage.get(LOCAL_KEYS.subjects), teachers: storage.get(LOCAL_KEYS.teachers), rooms: storage.get(LOCAL_KEYS.rooms) };
    const fitted = fitSchool(parsed, payload.school, { ...schoolDefaults, own });
    keys = fitted.keys;
    retired = fitted.retired;
    wanted = Object.fromEntries(Object.entries(fitted.values).map(([key, value]) => [key, JSON.stringify(value)]));
  }
  let plan = null;
  if (records) {
    try {
      const mine = (await request("GET", "/api/ui/export")).data;
      plan = recordPlan(records, mine, keys, { google: !!page.accounts?.google?.connected, synced: (data.events || []).filter((item) => item.synced) });
    } catch {}
  }
  const settled = wanted[LOCAL_KEYS.subjects];
  const used = plan ? subjectsInUse(plan) : new Set();
  const held = retired.filter((key) => used.has(key));
  if (held.length) {
    const draft = JSON.parse(settled);
    wanted[LOCAL_KEYS.subjects] = JSON.stringify({ ...draft, removed: draft.removed.filter((key) => !held.includes(key)) });
  }
  let stateCarried = null;
  if (entries.length) {
    restore(wanted);
    stateCarried = carryState(prefs.school.state);
  }
  const moved = entries.length > 0 && (prefs.school.grade !== schoolBefore.grade || prefs.school.birthday !== schoolBefore.birthday);
  let done = null;
  if (plan) {
    if (planSize(plan) > 12) toast(`Übernehme ${plural(planSize(plan), "Eintrag", "Einträge")} aus „${esc(file.name)}“ …`, { icon: "upload", duration: 600000 });
    done = await carryRecords(plan);
    if (held.length) {
      storage.set(LOCAL_KEYS.subjects, JSON.parse(settled));
      reloadState();
    }
    await countSubjectUse();
    renderPlaces();
  }
  if (stateCarried) await Promise.race([stateCarried, pause(8000)]);
  const text = summary({ settings: entries.length > 0, made: done?.made, known: done?.known, failed: done?.failed, unread: !!records && !plan });
  toast(esc(text), {
    icon: (done?.failed || (records && !plan)) ? "triangle-alert" : "upload",
    action: { label: "Rückgängig", undo: true, run: async () => {
      const left = done ? await dropRecords(done.undo) : 0;
      if (entries.length) {
        restore(before);
        if (moved) savePrefs();
        await carryState(stateBefore);
      }
      await countSubjectUse();
      renderPlaces();
      if (left) toast(`${plural(left, "Eintrag", "Einträge")} ${left === 1 ? "ließ" : "ließen"} sich nicht zurücknehmen.`, { icon: "triangle-alert" });
      else say("Rückgängig gemacht");
    } },
  });
}

async function wipeData() {
  const before = snapshot();
  if (!Object.keys(before).length) {
    toast("Auf diesem Gerät ist nichts gespeichert.", { icon: "trash-2" });
    return;
  }
  // An own subject that still has grades or entries cannot go for good, or they would be hidden. The server puts it aside, and so does the page.
  await countSubjectUse();
  const own = subjectStore().items;
  const used = Object.keys(own).filter((key) => own[key]?.custom && keptOnDelete(key));
  restore(used.length ? { [LOCAL_KEYS.subjects]: JSON.stringify({ items: Object.fromEntries(used.map((key) => [key, own[key]])), removed: used }) } : {});
  $("dataWipe")?.focus({ preventScroll: true });
  toast(used.length ? "Alles auf diesem Gerät gelöscht. Fächer mit Noten oder Einträgen stehen weiter unter „Gelöscht“." : "Alles auf diesem Gerät gelöscht", {
    icon: "trash-2",
    action: { label: "Rückgängig", undo: true, run: () => {
      restore(before);
      say("Rückgängig gemacht");
    } },
  });
}

function bindData() {
  const card = $("dataCard");
  const file = $("importFile");
  readRecords();
  card.addEventListener("pointerdown", (event) => {
    if (event.target.closest("#dataExport")) readRecords();
  });
  card.addEventListener("click", (event) => {
    if (event.target.closest("#dataExport")) exportData();
    else if (event.target.closest("#dataKeep")) keepData();
    else if (event.target.closest("#dataImport")) file.click();
    else if (event.target.closest("#dataWipe")) wipeData();
  });
  file.addEventListener("change", () => {
    const chosen = file.files?.[0];
    file.value = "";
    if (chosen) importData(chosen);
  });
  if (root.dataset.shell === "web" && storageManager()?.persisted) {
    storageManager().persisted().then((kept) => {
      keptData = kept;
      renderData();
    }, () => {});
  }
}

function bindAbout() {
  $("aboutCard").addEventListener("click", async (event) => {
    const button = event.target.closest("#openInBrowser");
    if (!button || button.disabled) return;
    button.disabled = true;
    let opened = false;
    try {
      opened = Boolean(await window.hubShell.openInBrowser());
    } catch {
      opened = false;
    }
    button.disabled = false;
    if (!opened) toast("Der Browser ließ sich gerade nicht öffnen. Versuch es gleich noch einmal.", { icon: "triangle-alert" });
  });
}

function renderAbout() {
  const card = $("aboutCard");
  const about = page.about || {};
  const version = esc(card.dataset.version || about.version || "unbekannt").replace(/^(.+?) (\([^)]*\))$/, `<span class="about-part">$1</span> <span class="about-part">$2</span>`);
  const where = platformName();
  const browser = typeof window.hubShell?.openInBrowser === "function"
    ? `<button class="pill" type="button" id="openInBrowser">${icon("arrow-up-right")}Im Browser öffnen</button>`
    : "";
  const site = String(about.website || "").replace(/\/+$/, "");
  const links = [
    site && [`${site}/nutzungsbedingungen`, "Nutzungsbedingungen", "file-text"],
    site && [`${site}/datenschutz`, "Datenschutz", "lock"],
    about.source && [about.source, "Quellcode", "code"],
  ].filter(Boolean);
  card.innerHTML = `<dl class="about-list">
      <div><dt>Version</dt><dd>${version}</dd></div>
      <div><dt>Plattform</dt><dd>${esc(where)}</dd></div>
      <div><dt>Daten</dt><dd>Lokal auf diesem Gerät</dd></div>
      <div><dt>Lizenz</dt><dd>${esc(about.license || "PolyForm Noncommercial 1.0.0")}</dd></div>
    </dl>
    <div class="about-links"><button class="pill" type="button" data-feedback>${icon("send")}Rückmeldung geben</button><button class="pill" type="button" data-tour-start>${icon("presentation")}Tutorial mit Luna</button>${browser}${links.map(([href, text, glyph]) => `<a class="pill" href="${esc(href)}" target="_blank" rel="noopener">${icon(glyph)}${text}${icon("arrow-up-right", "is-external")}<span class="visually-hidden">, öffnet in einem neuen Tab</span></a>`).join("")}</div>
    <p class="about-note">${BRAND} steht unter der PolyForm Noncommercial License 1.0.0. Du darfst es kostenlos nutzen, ändern und weitergeben, aber nicht damit Geld verdienen. Den vollständigen Quellcode dieser Version findest du über den Link.</p>`;
}

function renderAll() {
  renderPlan();
  renderCatalog();
  renderRaster();
  renderSchool();
  renderIserv();
  renderGoogle();
  renderNotify();
  renderLook();
  renderPlaces();
  renderTransit();
  renderAssistant();
  renderData();
  renderAbout();
}

const navState = { current: "", pending: "", settle: 0, frame: 0, holding: false, release: 0 };

function placeMarker(id, { instant = false } = {}) {
  const node = $("navMarker");
  const link = document.querySelector(`.set-nav-item[data-section="${id}"]`);
  if (!node || !link) return;
  const list = node.parentElement;
  const frame = list.getBoundingClientRect();
  const box = link.getBoundingClientRect();
  if (!box.width) return;
  const x = box.left - frame.left - list.clientLeft + list.scrollLeft;
  const y = box.top - frame.top - list.clientTop + list.scrollTop;
  const radius = Math.min(parseFloat(getComputedStyle(link).borderTopLeftRadius) || 0, box.height / 2);
  const still = instant || node.hidden || !travels();
  node.classList.toggle("is-instant", still);
  node.hidden = false;
  node.style.height = `${box.height}px`;
  node.style.setProperty("--marker-r", `${radius}px`);
  node.style.transform = `translate(${x}px, ${y}px)`;
  const [, mid, end] = node.children;
  mid.style.transform = `translateX(${radius - 0.5}px) scaleX(${Math.max(0, (box.width - 2 * radius + 1) / 100)})`;
  end.style.transform = `translateX(${Math.max(radius, box.width - radius)}px)`;
  if (still) {
    void node.offsetWidth;
    requestAnimationFrame(() => node.classList.remove("is-instant"));
  }
}

function markSection(id, { instant = false } = {}) {
  navState.current = id;
  document.querySelectorAll(".set-nav-item").forEach((link) => {
    if (link.dataset.section === id) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
  placeMarker(id, { instant });
  const list = document.querySelector(".set-nav-list");
  const active = document.querySelector(`.set-nav-item[data-section="${id}"]`);
  if (!list || !active || list.scrollWidth <= list.clientWidth) return;
  const box = active.getBoundingClientRect();
  const frame = list.getBoundingClientRect();
  if (box.left < frame.left + 16 || box.right > frame.right - 16) {
    list.scrollTo({ left: list.scrollLeft + box.left - frame.left - 16, behavior: travels() ? "smooth" : "auto" });
  }
}

function sectionInView() {
  const sections = [...document.querySelectorAll(".set-section")];
  if (!sections.length) return "";
  const line = Math.min(innerHeight * 0.3, 240);
  let current = sections[0];
  sections.forEach((section) => {
    if (section.getBoundingClientRect().top - line <= 0) current = section;
  });
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) current = sections.at(-1);
  return current.id;
}

function settleSpy() {
  clearTimeout(navState.settle);
  navState.pending = "";
  if (navState.holding) return;
  const id = sectionInView();
  if (id && id !== navState.current) markSection(id);
}

function spy() {
  navState.frame = 0;
  if (navState.holding) return;
  navState.pending = "scroll";
  clearTimeout(navState.settle);
  navState.settle = setTimeout(settleSpy, 150);
}

function arrive(section) {
  if (!animates()) return;
  section.querySelectorAll(".plan-board, .set-card").forEach((node) => {
    node.classList.remove("is-arrived");
    void node.offsetWidth;
    node.classList.add("is-arrived");
    node.addEventListener("animationend", () => node.classList.remove("is-arrived"), { once: true });
  });
}

function afterScroll(run) {
  navState.holding = true;
  clearTimeout(navState.release);
  const finish = () => {
    removeEventListener("scrollend", finish);
    clearTimeout(navState.release);
    navState.holding = false;
    run();
  };
  addEventListener("scrollend", finish, { once: true });
  navState.release = setTimeout(finish, 1600);
}

function goTo(id, { smooth = false, focus = false, flash = false } = {}) {
  const section = $(id);
  if (!section?.classList.contains("set-section")) return false;
  const url = new URL(location.href);
  url.hash = id;
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  clearTimeout(navState.settle);
  navState.pending = "";
  markSection(id, { instant: !smooth });
  const glide = smooth && travels();
  const offset = (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) + (parseFloat(getComputedStyle(section).scrollMarginTop) || 0);
  const target = Math.min(Math.max(0, scrollY + section.getBoundingClientRect().top - offset), document.documentElement.scrollHeight - innerHeight);
  const moving = glide && Math.abs(target - scrollY) > 2;
  if (moving) {
    afterScroll(() => flash && arrive(section));
  } else {
    navState.holding = true;
    clearTimeout(navState.release);
    navState.release = setTimeout(() => (navState.holding = false), 160);
  }
  section.scrollIntoView({ block: "start", behavior: glide ? "smooth" : "auto" });
  if (focus) section.querySelector(".section-title")?.focus({ preventScroll: true });
  if (!moving && flash) arrive(section);
  return true;
}

function openHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  return id ? goTo(id, { flash: true }) : false;
}

function bindNav() {
  $("settingsNav").addEventListener("click", (event) => {
    const link = event.target.closest(".set-nav-item");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    goTo(link.dataset.section, { smooth: true, focus: true, flash: true });
  });
  addEventListener("scroll", () => {
    navState.frame ||= requestAnimationFrame(spy);
  }, { passive: true });
  addEventListener("hashchange", openHash);
  new ResizeObserver(() => {
    if (navState.current) placeMarker(navState.current, { instant: true });
  }).observe(document.querySelector(".set-nav-list"));
}

export function init() {
  if (!$("settingsPage") || !data || !schoolDefaults) return;
  bindPlan();
  bindCatalog();
  bindRaster();
  bindSchool();
  bindAccounts();
  bindNotify();
  bindLaunch();
  bindLook();
  bindPlaces();
  bindTransit();
  bindAssistant();
  bindData();
  bindAbout();
  bindNav();
  renderAll();
  loadLaunch();
  if (!openHash()) markSection(sectionInView(), { instant: true });
  document.fonts?.ready.then(() => navState.current && placeMarker(navState.current, { instant: true }));
  loadGoogleCalendars();
}
