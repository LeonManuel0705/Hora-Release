import { data, esc, icon, luna, isoDate, parseDate, addDays, startOfDay, dayDiff, shortDate, relativeDay, now, minutesOf, subject, hueVar, glue, nextRepeatDate, homeworkDate, followLinks, ASSESSMENTS, isAssessment, WEEKDAYS, WEEKDAYS_SHORT, storage } from "./core.js";
import { animates, travels, flipKeyed, exitInPlace, enterInPlace, token } from "./motion.js";
import { toast, parseNote, cleanTitle, typing, shortcutsEnabled, overlayOpen, keepOneLine, renderSync } from "./shell.js";
import { tasks as taskApi, deadlines as deadlineApi, debounced, serverId } from "./api.js";
import { initNoteList } from "./notes.js";
import { onPlanRefresh } from "./plan-refresh.js";

const saveText = debounced(700, (key, id, changes) => taskApi.update(id, changes));

const $ = (id) => document.getElementById(id);
const widow = (text) => text.replace(/ (\S{1,12})$/, " $1");
const today = () => isoDate(now());
const effort = (min) => {
  if (min < 60) return `${min} Min.`;
  const halves = Math.round(min / 30);
  return `${Math.floor(halves / 2)}${halves % 2 ? "½" : ""} Std.`;
};

const REPEAT_WORDS = { daily: "täglich", weekly: "wöchentlich", monthly: "monatlich" };
const FILTER_WORDS = { heute: "Heute", woche: "Woche", alle: "Alle" };
const TASK_LIMITS = { title: 300, notes: 5000 };

const state = {
  tasks: [],
  homework: [],
  filter: ["heute", "woche", "alle"].includes(storage.get("app-task-filter")) ? storage.get("app-task-filter") : "heute",
  subject: null,
  selected: null,
  draft: null,
  parked: null,
  doneOpen: false,
  loading: false,
  pending: new Set(),
};

const settle = { timer: 0, pointerInside: false, lastCheck: 0 };

const homeworkTask = (item) => ({ id: `iserv-${item.id}`, title: item.title, subject: item.subject, date: item.date, minutes: 30, source: item.origin === "iserv" ? "iserv" : "homework", synced: true, kind: item.kind, detail: item.detail, notes: item.origin === "iserv" ? "" : item.detail || "", done: false });
const listedHomework = (item, linked) => ["Hausaufgabe", "Abgabe"].includes(item.kind) && !item.pinned && !linked.has(item.id) && item.status !== "abgegeben";

function load() {
  const day = today();
  state.tasks = [...data.tasks, ...(data.taskPool || [])].map((task) => ({
    ...task,
    date: task.someday ? null : task.date || day,
    source: task.source || "own",
    notes: task.notes || "",
  }));
  const linked = new Set(state.tasks.map((task) => task.deadline).filter(Boolean));
  state.homework = data.deadlines.filter((item) => listedHomework(item, linked)).map(homeworkTask);
}

const deadlineOf = (task) => data.deadlines.find((item) => item.id === task.deadline);

function bucketOf(task) {
  if (!task.date) return "none";
  const diff = dayDiff(startOfDay(now()), task.date);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff <= 6) return `day:${task.date}`;
  return "later";
}

const inFilter = (task, filter = state.filter) => {
  const bucket = bucketOf(task);
  if (filter === "heute") return bucket === "overdue" || bucket === "today";
  if (filter === "woche") return bucket !== "later" && bucket !== "none";
  return true;
};

const shown = (task) => (!task.done || state.pending.has(task.id)) && inFilter(task) && (!state.subject || task.subject === state.subject);
const openCount = (filter) => state.tasks.filter((task) => !task.done && inFilter(task, filter) && (!state.subject || task.subject === state.subject)).length;

function groupLabel(bucket) {
  if (bucket === "overdue") return { title: "Überfällig", tone: "is-urgent" };
  if (bucket === "today") return { title: "Heute", meta: shortDate(now()) };
  if (bucket === "tomorrow") return { title: "Morgen", meta: shortDate(addDays(startOfDay(now()), 1)) };
  if (bucket === "later") return { title: "Später" };
  if (bucket === "none") return { title: "Ohne Datum" };
  const date = parseDate(bucket.slice(4));
  return { title: WEEKDAYS[date.getDay()], meta: `${date.getDate()}.${date.getMonth() + 1}.` };
}

function groupOrder(bucket) {
  if (bucket === "overdue") return "0";
  if (bucket === "today") return "1";
  if (bucket === "tomorrow") return "2";
  if (bucket.startsWith("day:")) return `3${bucket.slice(4)}`;
  if (bucket === "later") return "4";
  return "5";
}

function metaFor(task) {
  const parts = [];
  if (task.subject) {
    parts.push(`<button type="button" class="subject subject-filter" data-subject="${esc(task.subject)}" aria-label="Nur ${esc(subject(task.subject).name)} zeigen"><i class="subject-dot" style="--hue:${hueVar(task.subject)}"></i>${esc(subject(task.subject).label)}</button>`);
  }
  const bucket = bucketOf(task);
  if (bucket === "overdue" && !task.done) {
    const diff = -dayDiff(startOfDay(now()), task.date);
    parts.push(`<span class="row-note is-urgent">${diff === 1 ? "seit gestern" : `seit ${diff} Tagen`}</span>`);
  } else if (task.anchor && bucket === "today") {
    parts.push(glue(esc(task.anchor)));
  } else if (bucket === "later") {
    parts.push(esc(shortDate(parseDate(task.date))));
  }
  const badges = [];
  if (task.source === "iserv") badges.push(`<span class="badge">${icon("graduation-cap")}IServ</span>`);
  if (task.repeat) badges.push(`<span class="badge">${icon("repeat")}${REPEAT_WORDS[task.repeat]}</span>`);
  const linked = deadlineOf(task);
  if (isAssessment(linked)) {
    const diff = dayDiff(startOfDay(now()), linked.date);
    badges.push(`<span class="badge is-test">${icon(ASSESSMENTS[linked.kind].icon)}${esc(linked.kind)} ${esc(diff <= 1 ? relativeDay(diff, parseDate(linked.date)) : WEEKDAYS_SHORT[parseDate(linked.date).getDay()] + ".")}</span>`);
  }
  return `${parts.join(", ")}${badges.length ? `<span class="badges${parts.length ? "" : " is-first"}">${badges.join("")}</span>` : ""}`;
}

function rowHtml(task) {
  const title = esc(task.title);
  return `<li class="row task is-interactive${task.done ? " is-done" : ""}${state.selected === task.id ? " is-selected" : ""}" data-id="${esc(task.id)}" tabindex="-1">
    <button class="check" type="button" role="checkbox" aria-checked="${task.done}" aria-label="${title}">${icon("check")}</button>
    <div class="row-main">
      <p class="row-title"><button type="button" class="row-open" aria-label="Details: ${title}">${widow(glue(title))}</button></p>
      <p class="row-meta">${metaFor(task)}</p>
    </div>
    <div class="row-trailing">
      <div class="row-actions">
        ${task.done || task.source === "iserv" ? "" : `<button class="icon-button" type="button" data-act="later" aria-label="Auf morgen: ${title}" data-tip="Auf morgen">${icon("calendar-plus")}</button>`}
        <button class="icon-button" type="button" data-act="delete" aria-label="Löschen: ${title}" data-tip="Löschen">${icon("trash-2")}</button>
      </div>
      ${task.priority && !task.done ? `<span class="flag" data-tip="Wichtig" role="img" aria-label="Wichtig">${icon("flag")}</span>` : ""}
    </div>
  </li>`;
}

function emptyHtml() {
  const hour = minutesOf(now()) / 60;
  if (state.subject) {
    const name = subject(state.subject).name;
    return `<div class="empty-state">${luna("ruhe")}<p class="empty-title">In ${esc(name)} ist gerade nichts offen.</p><button type="button" class="empty-action" data-clear-subject>Alle Fächer zeigen${icon("chevron-right")}</button></div>`;
  }
  if (state.filter === "heute") {
    const doneToday = state.tasks.some((task) => task.done && bucketOf(task) === "today");
    const tomorrow = state.tasks.filter((task) => !task.done && bucketOf(task) === "tomorrow").length;
    const next = tomorrow ? `<button type="button" class="empty-action" data-filter-to="woche">${tomorrow === 1 ? "1 Aufgabe für morgen ansehen" : `${tomorrow} Aufgaben für morgen ansehen`}${icon("chevron-right")}</button>` : "";
    if (doneToday) {
      const kind = hour >= 21 || hour < 5 ? "schlaeft" : "geschafft";
      return `<div class="empty-state">${luna(kind)}<p class="empty-title">Alles für heute erledigt.</p>${next}</div>`;
    }
    return `<div class="empty-state">${luna("ruhe")}<p class="empty-title">Für heute ist nichts geplant.</p>${next}</div>`;
  }
  return `<div class="empty-state">${luna("ruhe")}<p class="empty-title">Keine offenen Aufgaben.</p><p class="empty-text">Neue legst du oben an.</p></div>`;
}

function loadingHtml() {
  return `<div class="loading-card" role="status">${luna("laedt", 96)}<div><p class="empty-title">Hole Hausaufgaben aus IServ</p><p class="empty-text">Dauert nur einen Moment.</p></div></div>`;
}

function groupsHtml() {
  const visible = state.tasks.filter(shown);
  const groups = new Map();
  visible.forEach((task) => {
    const bucket = bucketOf(task);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(task);
  });
  const ordered = [...groups.entries()].sort((a, b) => groupOrder(a[0]).localeCompare(groupOrder(b[0])));
  const loading = state.loading ? loadingHtml() : "";
  if (!ordered.length) return loading + emptyHtml();
  return loading + ordered.map(([bucket, list]) => {
    const label = groupLabel(bucket);
    const sorted = [...list].sort((a, b) => Number(!!b.priority) - Number(!!a.priority));
    const minutes = list.filter((task) => !task.done).reduce((sum, task) => sum + (task.minutes || 0), 0);
    return `<section class="task-group" data-group="${esc(bucket)}">
      <h2 class="group-head ${label.tone || ""}" data-flip="head:${esc(bucket)}"><span>${esc(label.title)}</span>${label.meta ? `<small>${esc(label.meta)}</small>` : ""}${minutes ? `<small class="group-effort">etwa ${effort(minutes)}</small>` : ""}</h2>
      <ul class="rows" data-bucket="${esc(bucket)}">${sorted.map(rowHtml).join("")}</ul>
    </section>`;
  }).join("");
}

function holdFocus(paint) {
  const active = document.activeElement;
  const row = active?.closest?.("#taskGroups .row[data-id], #tasksDoneList .row[data-id]");
  const part = !row || active === row ? "" : active.matches(".check") ? ".check" : active.matches(".row-open") ? ".row-open" : active.dataset.act ? `[data-act="${active.dataset.act}"]` : "";
  const id = row?.dataset.id;
  paint();
  if (!id || row.isConnected || (document.activeElement && document.activeElement !== document.body)) return;
  const fresh = document.querySelector(`#taskGroups .row[data-id="${CSS.escape(id)}"], #tasksDoneList .row[data-id="${CSS.escape(id)}"]`);
  if (fresh) ((part && fresh.querySelector(part)) || fresh).focus({ preventScroll: true });
}

function renderCounts() {
  const open = state.tasks.filter((task) => !task.done);
  const overdue = open.filter((task) => bucketOf(task) === "overdue").length;
  $("tasksCount").textContent = `${open.length} offen${overdue ? `, ${overdue} überfällig` : ""}`;
  $("taskFilter").querySelectorAll("[data-filter]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.filter === state.filter));
    button.querySelector(".seg-count").textContent = String(openCount(button.dataset.filter) || "");
  });
  const chips = $("filterChips");
  chips.innerHTML = state.subject
    ? `<button type="button" class="chip subject-chip" data-clear-subject style="--hue:${hueVar(state.subject)}" aria-label="Filter ${esc(subject(state.subject).name)} entfernen">${esc(subject(state.subject).label)}<span class="chip-x" aria-hidden="true">${icon("x")}</span></button>`
    : "";
}

function renderDone() {
  const done = state.tasks.filter((task) => task.done && !state.pending.has(task.id) && inFilter(task) && (!state.subject || task.subject === state.subject));
  const toggle = $("tasksDoneToggle");
  toggle.hidden = !done.length;
  $("tasksDoneLabel").textContent = `${done.length} erledigt`;
  toggle.setAttribute("aria-expanded", String(state.doneOpen && !!done.length));
  const list = $("tasksDoneList");
  list.hidden = !(state.doneOpen && done.length);
  list.innerHTML = done.map(rowHtml).join("");
}

function renderWeek() {
  const start = startOfDay(now());
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const open = state.tasks.filter((task) => !task.done && task.date);
  const overdue = open.filter((task) => bucketOf(task) === "overdue");
  const perDay = days.map((day, index) => open.filter((task) => task.date === isoDate(day) || (index === 0 && overdue.includes(task))));
  const minutes = perDay.map((list) => list.reduce((sum, task) => sum + (task.minutes || 0), 0));
  const max = Math.max(90, ...minutes);
  const total = minutes.reduce((sum, value) => sum + value, 0);
  const count = perDay.reduce((sum, list) => sum + list.length, 0);
  $("weekLoad").innerHTML = `<h2 class="side-title" id="weekLoadTitle">Die nächsten 7 Tage</h2>
    <p class="side-meta">${count} ${count === 1 ? "Aufgabe" : "Aufgaben"}, etwa ${effort(total)}</p>
    <ol class="load-bars">${days.map((day, index) => `<li class="${index === 0 ? "is-today" : ""}${minutes[index] ? "" : " is-empty"}" aria-label="${esc(WEEKDAYS[day.getDay()])}: ${perDay[index].length} ${perDay[index].length === 1 ? "Aufgabe" : "Aufgaben"}">
      <span class="load-num">${perDay[index].length || ""}</span>
      <span class="load-bar"><i style="--h:${(minutes[index] / max).toFixed(3)}"></i></span>
      <span class="load-day">${esc(WEEKDAYS_SHORT[day.getDay()])}</span>
    </li>`).join("")}</ol>
    <p class="side-hint">Balkenhöhe nach geschätzter Arbeitszeit.</p>`;
}

function render({ flip = false } = {}) {
  const paint = () => holdFocus(() => {
    $("taskGroups").innerHTML = groupsHtml();
    renderDone();
  });
  if (flip) flipKeyed("#taskGroups .row, #taskGroups .group-head, #taskGroups .empty-state, #tasksDoneToggle", paint);
  else paint();
  renderCounts();
  renderWeek();
  if (state.selected && !state.tasks.some((task) => task.id === state.selected)) closePanel();
}

const findTask = (id) => state.tasks.find((task) => task.id === id);
const rowOf = (id) => document.querySelector(`#taskGroups .row[data-id="${CSS.escape(id)}"], #tasksDoneList .row[data-id="${CSS.escape(id)}"]`);

function scheduleSettle(delay) {
  clearTimeout(settle.timer);
  settle.timer = setTimeout(flushSettle, delay);
}

function settleSoon() {
  if (state.pending.size) scheduleSettle(Math.max(0, settle.lastCheck + 380 - performance.now()));
}

function listInUse() {
  const active = document.activeElement;
  return settle.pointerInside || ($("taskGroups").contains(active) && active.matches(":focus-visible"));
}

const visibleOpen = () => state.tasks.some((task) => !task.done && shown(task));

function flushSettle() {
  clearTimeout(settle.timer);
  if (!state.pending.size || (visibleOpen() && listInUse())) return;
  state.pending.clear();
  render({ flip: true });
}

const savedId = (task) => String(serverId(task.id) || task.id);

function restoreSaved(task) {
  const before = savedId(task);
  taskApi.restore(task).then(() => followLinks.rename(before, savedId(task)), () => {});
}

function dropFollow(task) {
  const linked = task.follow || followLinks.get(savedId(task));
  task.follow = null;
  followLinks.drop(savedId(task));
  const follow = linked && state.tasks.find((item) => !item.done && (item.id === linked || savedId(item) === String(linked)));
  if (!follow) return;
  state.tasks = state.tasks.filter((item) => item !== follow);
  taskApi.remove(follow.id);
}

// An occurrence that is already there is used as it is and never taken back by undo:
// it may belong to a second copy of the task or was entered by hand. Only what this tick created is.
function followUp(task, date, extra = {}) {
  const twin = state.tasks.find((item) => item !== task && item.title === task.title && (item.subject || null) === (task.subject || null) && item.repeat === task.repeat && item.date === date);
  if (twin) {
    task.follow = null;
    followLinks.drop(savedId(task));
    return twin;
  }
  const follow = { ...task, ...extra, id: `${task.id}-${Date.now()}`, done: false, follow: null, date };
  state.tasks.push(follow);
  task.follow = follow.id;
  taskApi.create(follow).then((saved) => followLinks.set(savedId(task), saved.id), () => {});
  return follow;
}

function toggleTask(id, { via = "keyboard" } = {}) {
  const task = findTask(id);
  if (!task) return;
  task.done = !task.done;
  taskApi.done(id, task.done);
  if (!task.done) dropFollow(task);
  const row = rowOf(id);
  if (row) {
    row.classList.toggle("is-done", task.done);
    row.querySelector(".check").setAttribute("aria-checked", String(task.done));
  }
  if (task.done) {
    state.pending.add(id);
    settle.lastCheck = performance.now();
    if (via === "mouse") settle.pointerInside = true;
    let follow = null;
    const next = task.repeat && task.date ? nextRepeatDate(task.date, task.repeat) : null;
    if (next) follow = followUp(task, next);
    toast(follow ? `Erledigt. Nächste am ${esc(shortDate(parseDate(follow.date)))}` : `Erledigt: „${esc(task.title)}“`, {
      icon: "check",
      action: { label: "Rückgängig", undo: true, run: () => {
        if (task.done) toggleTask(id);
      } },
    });
    clearTimeout(settle.timer);
    if (!visibleOpen()) scheduleSettle(800);
    else if (via === "touch" || via === "pen") scheduleSettle(3000);
    renderCounts();
    renderWeek();
    if (state.selected === id) renderPanel();
    return;
  }
  if (state.pending.delete(id)) {
    settleSoon();
    renderCounts();
    renderWeek();
    return;
  }
  render({ flip: true });
  enterInPlace(rowOf(id));
}

function removeTask(id, kind) {
  const index = state.tasks.findIndex((task) => task.id === id);
  if (index < 0) return;
  const task = state.tasks[index];
  if (kind === "later" && task.source === "iserv") return;
  const row = rowOf(id);
  const hadFocus = row?.contains(document.activeElement);
  if (kind === "later") {
    const before = task.date;
    const beforeSomeday = !!task.someday;
    task.date = isoDate(addDays(startOfDay(now()), 1));
    task.someday = false;
    taskApi.update(id, { date: task.date, someday: false });
    toast(`Auf morgen verschoben: „${esc(task.title)}“`, { icon: "calendar-plus", action: { label: "Rückgängig", undo: true, run: () => {
      task.date = before;
      task.someday = beforeSomeday;
      taskApi.update(id, { date: before, someday: beforeSomeday });
      render({ flip: true });
    } } });
  } else {
    state.tasks.splice(index, 1);
    saveText.cancel(`${id}:notes`);
    saveText.cancel(`${id}:title`);
    taskApi.remove(id);
    if (state.selected === id) closePanel();
    toast(`Gelöscht: „${esc(task.title)}“`, { icon: "trash-2", action: { label: "Rückgängig", undo: true, run: () => {
      state.tasks.splice(Math.min(index, state.tasks.length), 0, task);
      restoreSaved(task);
      render({ flip: true });
      enterInPlace(rowOf(id));
    } } });
  }
  exitInPlace(row).then(() => {
    if (row) row.dataset.flip = "leaving";
    render({ flip: true });
    if (hadFocus) (document.querySelector("#taskGroups .row .check") || $("quickInput")).focus({ preventScroll: true });
  });
}

function createTask(text) {
  const info = parseNote(text);
  const title = cleanTitle(text, info);
  if (!title) return;
  addTask({
    id: `new-${Date.now()}`,
    title,
    subject: info.subject,
    date: info.date || today(),
    anchor: info.block ? `vor dem ${info.block}. Block` : "",
    minutes: 20,
    source: "own",
    notes: "",
    done: false,
  });
}

function addTask(task, { tell = true } = {}) {
  state.tasks.push(task);
  const saved = task.synced
    ? deadlineApi.create({ id: task.id.slice(6), kind: "Hausaufgabe", title: task.title, subject: task.subject || null, date: task.date, detail: task.detail || "" })
    : taskApi.create(task);
  document.dispatchEvent(new CustomEvent("app:task-created", { detail: { id: task.id, title: task.title, saved } }));
  if (!inFilter(task)) {
    state.filter = "alle";
    storage.set("app-task-filter", "alle");
  }
  if (state.subject && task.subject !== state.subject) state.subject = null;
  render({ flip: true });
  const row = rowOf(task.id);
  enterInPlace(row);
  row?.classList.add("is-flash");
  if (tell) toast(`Angelegt: „${esc(task.title)}“`, { icon: "check", action: { label: "Rückgängig", undo: true, run: () => removeTask(task.id, "delete") } });
  return saved;
}

function renderChips() {
  const text = $("quickInput").value;
  const info = text.trim() ? parseNote(text) : {};
  const chips = [];
  if (info.subject) chips.push(`<span class="chip subject-chip" style="--hue:${hueVar(info.subject)}">${esc(subject(info.subject).label)}</span>`);
  if (info.date) chips.push(`<span class="chip">${icon("calendar-days")}${esc(shortDate(parseDate(info.date)))}</span>`);
  if (info.block) chips.push(`<span class="chip">${icon("nx-block")}${info.block}. Block</span>`);
  $("quickChips").innerHTML = chips.join("");
  $("quickAdd").classList.toggle("has-chips", chips.length > 0);
}

function subjectOptions(current) {
  const keys = Object.keys(data.subjects).filter((key) => !data.subjects[key].retired || key === current);
  return `<option value="">Kein Fach</option>${keys.map((key) => `<option value="${esc(key)}"${key === current ? " selected" : ""}>${esc(subject(key).name)}</option>`).join("")}`;
}

function dueChoices() {
  const start = startOfDay(now());
  return [
    ["today", "Heute", today()],
    ["tomorrow", "Morgen", isoDate(addDays(start, 1))],
    ["nextweek", "Nächste Woche", isoDate(addDays(start, 8 - (start.getDay() || 7)))],
    ["none", "Ohne Datum", null],
  ];
}

function dueField(item, dates, fixed = "") {
  const custom = !!item.date && !dates.some(([, , value]) => value === item.date);
  return `<div class="field"><span class="field-label" id="panelDateLabel">Fällig</span>
        <div class="field-body" role="group" aria-labelledby="panelDateLabel">
          ${dates.map(([key, text, value]) => `<button type="button" class="pill" data-date="${key}" aria-pressed="${item.date === value}"${fixed}>${text}</button>`).join("")}
          <button type="button" class="pill" data-date="pick" aria-pressed="${custom}"${fixed}>${icon("calendar-days")}${custom ? esc(shortDate(parseDate(item.date))) : "Datum wählen"}</button>
          <input class="date-proxy" type="date" id="panelDate" value="${esc(item.date || "")}" tabindex="-1" aria-hidden="true">
        </div>
      </div>`;
}

function priorityField(item) {
  return `<div class="field is-inline"><span class="field-label" id="panelPrioLabel">Wichtig</span><button type="button" class="switch" role="switch" id="panelPriority" aria-checked="${!!item.priority}" aria-labelledby="panelPrioLabel"><span></span></button></div>`;
}

function repeatField(item) {
  return `<label class="field"><span class="field-label">Wiederholen</span><select class="field-control" id="panelRepeat">
        <option value="">Nie</option>${Object.entries(REPEAT_WORDS).map(([key, word]) => `<option value="${key}"${item.repeat === key ? " selected" : ""}>${word[0].toUpperCase()}${word.slice(1)}</option>`).join("")}
      </select></label>`;
}

function renderPanel() {
  const task = findTask(state.selected);
  const panel = $("taskPanel");
  if (!task) return;
  const linked = deadlineOf(task);
  const dates = dueChoices();
  const homework = !!task.synced;
  const fixed = task.source === "iserv" ? " disabled" : "";
  if (homework) dates.pop();
  panel.setAttribute("aria-label", "Aufgabe bearbeiten");
  panel.innerHTML = `<div class="panel-head">
      <button class="check" type="button" role="checkbox" aria-checked="${task.done}" aria-label="Erledigt: ${esc(task.title)}" data-panel-check>${icon("check")}</button>
      <textarea class="panel-title" id="panelTitle" rows="2" maxlength="${TASK_LIMITS.title}" aria-label="Titel"${fixed ? " readonly" : ""}>${esc(task.title)}</textarea>
      <div class="panel-tools">
        <button class="icon-button is-danger" type="button" data-panel-delete aria-label="Aufgabe löschen" data-tip="Löschen">${icon("trash-2")}</button>
        <button class="icon-button" type="button" data-panel-close aria-label="Details schließen" data-tip="Schließen">${icon("x")}</button>
      </div>
    </div>
    <div class="panel-fields">
      <label class="field"><span class="field-label">Fach</span><select class="field-control" id="panelSubject"${fixed}>${subjectOptions(task.subject)}</select></label>
      ${dueField(task, dates, fixed)}
      ${homework ? "" : `${priorityField(task)}
      ${repeatField(task)}`}
      ${task.source === "iserv" ? "" : `<label class="field"><span class="field-label">Notizen</span><textarea class="field-control" id="panelNotes" rows="3" maxlength="${TASK_LIMITS.notes}" placeholder="Seiten, Links, was du nicht vergessen willst">${esc(task.notes || "")}</textarea></label>`}
      ${linked ? `<div class="field"><span class="field-label">Gehört zu</span><span class="field-value">${icon(ASSESSMENTS[linked.kind]?.icon || "calendar-days")}${esc(linked.kind)}: ${esc(linked.title)}, ${esc(shortDate(parseDate(linked.date)))}</span></div>` : ""}
      ${task.source === "iserv" ? `<p class="panel-source">${icon("graduation-cap")}Aus IServ${task.detail ? `, ${esc(task.detail)}` : ""}</p>` : homework ? `<p class="panel-source">${icon("notebook-pen")}Hausaufgabe, steht auch unter Schule</p>` : ""}
    </div>`;
}

function renderDraft() {
  const draft = state.draft;
  const panel = $("taskPanel");
  panel.setAttribute("aria-label", "Neue Aufgabe");
  panel.innerHTML = `<form id="taskForm" class="task-form" autocomplete="off" novalidate>
    <div class="panel-head">
      <div class="panel-heading"><h2 class="panel-name">Neue Aufgabe</h2></div>
      <div class="panel-tools"><button class="icon-button" type="button" data-panel-close aria-label="Schließen" data-tip="Schließen">${icon("x")}</button></div>
    </div>
    <div class="panel-fields">
      <label class="field"><span class="field-label">Titel</span><textarea class="field-control is-line" id="draftTitle" rows="1" maxlength="${TASK_LIMITS.title}" enterkeyhint="done" aria-required="true" placeholder="z. B. Vokabeln Unit 3 lernen">${esc(draft.title)}</textarea></label>
      <div class="field-pair">
        <label class="field"><span class="field-label">Fach</span><select class="field-control" id="panelSubject">${subjectOptions(draft.subject)}</select></label>
        ${repeatField(draft)}
      </div>
      ${dueField(draft, dueChoices())}
      ${priorityField(draft)}
      <label class="field"><span class="field-label">Notizen</span><textarea class="field-control" id="draftNotes" rows="2" maxlength="${TASK_LIMITS.notes}" placeholder="Seiten, Links, was du nicht vergessen willst">${esc(draft.notes)}</textarea></label>
    </div>
    <div class="panel-actions"><button type="button" class="btn btn-quiet" data-panel-close>Abbrechen</button><button type="submit" class="btn btn-primary" id="draftSave"${draft.title.trim() ? "" : " disabled"}>Anlegen</button></div>
  </form>`;
}

function showPanel(opening) {
  const panel = $("taskPanel");
  panel.hidden = false;
  $("weekLoad").hidden = true;
  $("tasksPage").classList.add("has-panel");
  $("newTask").setAttribute("aria-expanded", String(!!state.draft));
  if (opening && animates()) panel.animate(travels() ? [{ opacity: 0, transform: "translateX(12px)" }, { opacity: 1, transform: "none" }] : [{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: token("--ease-out") });
}

function openPanel(id) {
  const opening = state.selected == null && !state.draft;
  if (state.draft) state.parked = state.draft;
  state.draft = null;
  state.selected = id;
  document.querySelectorAll("#taskGroups .row.is-selected, #tasksDoneList .row.is-selected").forEach((row) => row.classList.remove("is-selected"));
  rowOf(id)?.classList.add("is-selected");
  renderPanel();
  showPanel(opening);
}

function openDraft() {
  if (state.draft) {
    $("draftTitle").focus();
    return;
  }
  const opening = state.selected == null;
  const input = $("quickInput");
  const text = input.value.trim();
  const info = text ? parseNote(text) : {};
  const fresh = {
    title: text ? cleanTitle(text, info) : "",
    subject: info.subject || state.subject || undefined,
    date: info.date || today(),
    someday: false,
    anchor: info.block ? `vor dem ${info.block}. Block` : "",
    priority: false,
    repeat: undefined,
    notes: "",
  };
  state.draft = text || !state.parked ? fresh : state.parked;
  state.parked = null;
  state.selected = null;
  document.querySelectorAll(".row.is-selected").forEach((row) => row.classList.remove("is-selected"));
  if (text) {
    input.value = "";
    renderChips();
  }
  renderDraft();
  showPanel(opening);
  const title = $("draftTitle");
  title.focus();
  title.setSelectionRange(title.value.length, title.value.length);
}

function submitDraft() {
  const draft = state.draft;
  if (!draft) return;
  const title = draft.title.replace(/\s+/g, " ").trim();
  if (!title) {
    $("draftTitle").focus();
    return;
  }
  closePanel({ refocus: true });
  addTask({
    id: `new-${Date.now()}`,
    title,
    subject: draft.subject,
    date: draft.date,
    someday: draft.date == null,
    anchor: draft.anchor,
    minutes: 20,
    source: "own",
    notes: draft.notes.trim(),
    priority: draft.priority,
    repeat: draft.repeat,
    done: false,
  });
}

function closePanel({ refocus = false } = {}) {
  const id = state.selected;
  const drafting = !!state.draft;
  state.selected = null;
  state.draft = null;
  $("taskPanel").hidden = true;
  $("weekLoad").hidden = false;
  $("tasksPage").classList.remove("has-panel");
  $("newTask").setAttribute("aria-expanded", "false");
  document.querySelectorAll(".row.is-selected").forEach((row) => row.classList.remove("is-selected"));
  if (!refocus) return;
  if (drafting) $("newTask").focus({ preventScroll: true });
  else if (id) rowOf(id)?.querySelector(".row-open")?.focus({ preventScroll: true });
}

const edited = () => state.draft || findTask(state.selected);
const repaint = () => (state.draft ? renderDraft() : renderPanel());

function updateTask(changes) {
  if (state.draft) {
    Object.assign(state.draft, changes);
    return;
  }
  const task = findTask(state.selected);
  if (!task || task.source === "iserv") return;
  Object.assign(task, changes);
  taskApi.update(task.id, changes);
  render({ flip: true });
  rowOf(task.id)?.classList.add("is-selected");
}

function bindPanel() {
  const panel = $("taskPanel");
  panel.addEventListener("click", (event) => {
    if (event.target.closest("[data-panel-close]")) closePanel({ refocus: true });
    else if (event.target.closest("[data-panel-check]")) toggleTask(state.selected, { via: event.pointerType || "keyboard" });
    else if (event.target.closest("[data-panel-delete]")) removeTask(state.selected, "delete");
    else if (event.target.closest("#panelPriority")) {
      updateTask({ priority: !edited().priority });
      repaint();
      $("panelPriority").focus();
    } else if (event.target.closest("[data-date=pick]")) {
      const input = $("panelDate");
      try { input.showPicker(); } catch { input.focus(); }
    } else if (event.target.closest("[data-date]")) {
      const key = event.target.closest("[data-date]").dataset.date;
      const value = dueChoices().find(([name]) => name === key)[2];
      updateTask({ date: value, someday: value == null });
      repaint();
      panel.querySelector(`[data-date="${key}"]`)?.focus();
    }
  });
  panel.addEventListener("change", (event) => {
    if (event.target.id === "panelSubject") updateTask({ subject: event.target.value || undefined });
    if (event.target.id === "panelRepeat") updateTask({ repeat: event.target.value || undefined });
    if (event.target.id === "panelDate" && event.target.value) {
      updateTask({ date: event.target.value, someday: false });
      repaint();
      panel.querySelector("[data-date=pick]")?.focus();
    }
  });
  panel.addEventListener("submit", (event) => {
    event.preventDefault();
    submitDraft();
  });
  panel.addEventListener("beforeinput", (event) => {
    if (event.target.id !== "draftTitle" || event.isComposing || !["insertLineBreak", "insertParagraph"].includes(event.inputType)) return;
    event.preventDefault();
    if (document.documentElement.classList.contains("is-touch")) event.target.blur();
    else event.target.form.requestSubmit();
  });
  panel.addEventListener("input", (event) => {
    if (state.draft) {
      if (event.target.id === "draftTitle") {
        keepOneLine(event.target);
        state.draft.title = event.target.value;
        $("draftSave").disabled = !state.draft.title.trim();
      } else if (event.target.id === "draftNotes") {
        state.draft.notes = event.target.value;
      }
      return;
    }
    const task = findTask(state.selected);
    if (!task || task.source === "iserv") return;
    if (event.target.id === "panelNotes") {
      task.notes = event.target.value;
      saveText(`${task.id}:notes`, task.id, { notes: task.notes });
    }
    if (event.target.id === "panelTitle") {
      task.title = event.target.value.replace(/\s+/g, " ").trimStart();
      const title = rowOf(task.id)?.querySelector(".row-open");
      if (title) title.textContent = task.title;
      if (task.title.trim()) saveText(`${task.id}:title`, task.id, { title: task.title.trim() });
    }
  });
  panel.addEventListener("keydown", (event) => {
    if (event.target.id === "panelTitle" && event.key === "Enter") {
      event.preventDefault();
      event.target.blur();
    } else if (event.target.id === "draftNotes" && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.target.form.requestSubmit();
    }
  });
}

// IServ homework exists in the apps with an IServ account. The browser has none, so the button stays hidden there.
const canSync = () => !!data.status?.iserv && data.status?.iservAvailable !== false;

function syncText(result) {
  if (!result) return "IServ ist gerade nicht erreichbar.";
  if (!result.ok) return result.message || "IServ ist gerade nicht erreichbar.";
  if (!result.count) return "In IServ stehen keine offenen Hausaufgaben.";
  return `${result.count === 1 ? "Eine offene Hausaufgabe" : `${result.count} offene Hausaufgaben`} aus IServ`;
}

async function startSync() {
  if (state.loading || !canSync()) return;
  state.loading = true;
  $("syncButton").classList.add("is-spinning");
  render();
  let result = null;
  try {
    const response = await fetch("/api/ui/iserv/homework", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
    result = await response.json();
    if (!response.ok || result?.success === false) result = null;
  } catch {
    result = null;
  }
  state.loading = false;
  $("syncButton").classList.remove("is-spinning");
  if (result) {
    const views = result.deadlines || [];
    const linked = new Set(state.tasks.map((task) => task.deadline).filter(Boolean));
    data.deadlines = [...data.deadlines.filter((item) => item.origin !== "iserv"), ...views];
    state.tasks = [...state.tasks.filter((task) => task.source !== "iserv"), ...views.filter((item) => listedHomework(item, linked)).map(homeworkTask)];
    if (result.status) {
      data.status = result.status;
      renderSync();
    }
  }
  render({ flip: true });
  toast(esc(syncText(result)), { icon: result?.ok ? "check" : "wifi-off" });
}

function interactiveRows() {
  return [...document.querySelectorAll("#taskGroups .row.is-interactive, #tasksDoneList:not([hidden]) .row.is-interactive")];
}

let keyRow = null;

document.addEventListener("pointerdown", () => {
  keyRow = null;
}, true);

function focusRow(row) {
  if (!row) return;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: "nearest" });
}

function bind() {
  const groups = $("taskGroups");
  groups.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") settle.pointerInside = true;
  });
  groups.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "mouse") return;
    settle.pointerInside = false;
    settleSoon();
  });
  groups.addEventListener("focusout", (event) => {
    if (!groups.contains(event.relatedTarget)) settleSoon();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!groups.contains(event.target)) settleSoon();
  }, true);

  const onList = (event) => {
    const filterTo = event.target.closest("[data-filter-to]");
    if (filterTo) {
      setFilter(filterTo.dataset.filterTo);
      return;
    }
    if (event.target.closest("[data-clear-subject]")) {
      state.subject = null;
      render({ flip: true });
      return;
    }
    const subjectButton = event.target.closest("[data-subject]");
    if (subjectButton) {
      state.subject = subjectButton.dataset.subject;
      render({ flip: true });
      return;
    }
    const row = event.target.closest(".row[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    if (event.target.closest(".check")) {
      toggleTask(id, { via: event.pointerType || "keyboard" });
      return;
    }
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act) {
      removeTask(id, act);
      return;
    }
    if (state.selected === id) closePanel();
    else openPanel(id);
  };
  groups.addEventListener("click", onList);
  $("tasksDoneList").addEventListener("click", onList);
  $("filterChips").addEventListener("click", onList);

  $("tasksDoneToggle").addEventListener("click", () => {
    state.doneOpen = !state.doneOpen;
    renderDone();
  });
  $("taskFilter").addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (button) setFilter(button.dataset.filter);
  });
  $("quickInput").addEventListener("input", renderChips);
  $("quickInput").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.target.value = "";
      renderChips();
      event.target.blur();
    }
  });
  $("quickAdd").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("quickInput");
    if (!input.value.trim()) return;
    createTask(input.value);
    input.value = "";
    renderChips();
  });
  $("newTask").addEventListener("click", openDraft);
  $("syncButton").addEventListener("click", startSync);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (state.selected || state.draft) && !overlayOpen()) {
      closePanel({ refocus: true });
      return;
    }
    if (!shortcutsEnabled() || typing(event.target) || event.ctrlKey || event.metaKey || event.altKey || overlayOpen()) return;
    const key = event.key.toLowerCase();
    const rows = interactiveRows();
    const current = document.activeElement?.closest?.(".row.is-interactive[data-id]");
    const index = rows.indexOf(current);
    if (key === "j" || key === "k") {
      event.preventDefault();
      const target = rows[key === "j" ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1)] || rows[0];
      focusRow(target);
      keyRow = target?.dataset.id || null;
    } else if (key === "x" && current) {
      event.preventDefault();
      toggleTask(current.dataset.id);
    } else if ((key === "backspace" || key === "delete") && event.target === current) {
      event.preventDefault();
      if (!event.shiftKey && !event.repeat && keyRow === current.dataset.id) removeTask(current.dataset.id, "delete");
    } else if (key === "enter" && event.target === current) {
      event.preventDefault();
      openPanel(current.dataset.id);
    } else if (key === "n") {
      event.preventDefault();
      $("quickInput").focus();
    }
  });
  bindPanel();
}

function setFilter(filter) {
  if (!FILTER_WORDS[filter]) return;
  state.filter = filter;
  storage.set("app-task-filter", filter);
  render({ flip: true });
}

function bindNotes() {
  window.addEventListener("app:note", (event) => {
    const detail = event.detail;
    if (detail.type !== "task" && detail.type !== "homework") return;
    event.preventDefault();
    const base = { title: detail.title, subject: detail.subject, notes: detail.details || "", done: false };
    if (detail.type === "task") {
      addTask({ ...base, id: `new-${Date.now()}`, date: detail.date || today(), anchor: detail.block ? `vor dem ${detail.block}. Block` : "", minutes: 20, source: "own" });
    } else {
      addTask({ ...base, id: `iserv-hw-new-${Date.now()}`, date: detail.date || homeworkDate(detail.subject), minutes: 30, source: "homework", synced: true, kind: "Hausaufgabe", detail: detail.details || "" });
    }
  });
}

function taskFromNote(note) {
  const task = { id: `new-${Date.now()}`, title: note.title, subject: null, date: today(), anchor: "", minutes: 20, source: "own", notes: note.details || "", done: false };
  const saved = addTask(task, { tell: false });
  const undo = () => {
    const index = state.tasks.indexOf(task);
    if (index < 0) return;
    state.tasks.splice(index, 1);
    saveText.cancel(`${task.id}:notes`);
    saveText.cancel(`${task.id}:title`);
    taskApi.remove(task.id);
    if (state.selected === task.id) closePanel();
    render({ flip: true });
  };
  return { saved, undo };
}

export function initTasks() {
  if (!$("tasksPage")) return;
  $("syncButton").hidden = !canSync();
  load();
  state.tasks.push(...state.homework.map((task) => ({ ...task })));
  bind();
  bindNotes();
  render();
  initNoteList({ toTask: taskFromNote });
  onPlanRefresh(() => {
    render();
    renderChips();
  }, overlayOpen);
}
