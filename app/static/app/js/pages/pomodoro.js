import { BRAND, activeSubjectKeys, data, duration, esc, hueVar, subject, luna } from "../core.js";
import { animates, token, travels } from "../motion.js";
import { sceneParts, playIntro } from "../desk.js";
import { readPrefs } from "../reminders.js";
import { toast } from "../shell.js";
import { LIMITS, actions, flush, read, remaining, subscribe, waiting } from "../pomodoro-timer.js";
import { onPlanRefresh } from "../plan-refresh.js";

const $ = (id) => document.getElementById(id);
const pad = (value) => String(value).padStart(2, "0");

const RANGES = ["today", "week", "month"];
const MAX_ROUNDS = 8;
const SLOTS = 4;
const CHEER_MS = 4600;
const DIAL = { x: 402, y: 56, outer: 31, face: 26, wedge: 24 };

const PHASE = {
  ready: { icon: "timer", text: "Bereit" },
  work: { icon: "pencil", text: "Arbeitsphase" },
  paused: { icon: "pause", text: "Angehalten" },
  rest: { icon: "coffee", text: "Pause" },
  done: { icon: "circle-check", text: "Geschafft" },
  cheer: { icon: "circle-check", text: "Geschafft" },
  back: { icon: "check", text: "Pause vorbei" },
};

const SCENE_LABEL = {
  ready: "Luna wartet am Schreibtisch",
  work: "Luna arbeitet am Schreibtisch",
  paused: "Luna hat den Stift kurz abgelegt",
  rest: "Luna macht Pause",
  done: "Luna ruht sich aus",
  cheer: "Luna freut sich",
  back: "Luna ist wieder bereit",
};

const view = {
  stats: {},
  range: "today",
  stage: "",
  scene: "",
  books: 0,
  luna: "",
  cheering: false,
  cheerTimer: 0,
  tick: 0,
  counted: "",
  fresh: null,
  baseTitle: document.title,
  introduced: false,
};

const statsOf = (raw) => ({
  total_sessions: Math.max(0, Number(raw?.total_sessions) || 0),
  total_minutes: Math.max(0, Number(raw?.total_minutes) || 0),
  by_subject: (Array.isArray(raw?.by_subject) ? raw.by_subject : [])
    .map((row) => ({ subject_id: row?.subject_id || null, sessions: Math.max(0, Number(row?.sessions) || 0), minutes: Math.max(0, Number(row?.minutes) || 0) }))
    .filter((row) => row.sessions > 0),
});

const known = (key) => !!key && Object.hasOwn(data.subjects || {}, key);
const nameOf = (key) => (known(key) ? subject(key).label : key ? "Anderes Fach" : "Ohne Fach");
const hueOf = (key) => (known(key) ? hueVar(key) : "var(--line-strong)");
const sessionsWord = (count) => `${count}\u00a0${count === 1 ? "Sitzung" : "Sitzungen"}`;
const minutesWord = (count) => `${count} ${count === 1 ? "Minute" : "Minuten"}`;
const clockText = (left) => {
  const seconds = Math.ceil(left / 1000);
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
};
const spoken = (left) => {
  const seconds = Math.ceil(left / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}\u00a0${minutes === 1 ? "Minute" : "Minuten"} ${seconds % 60}\u00a0${seconds % 60 === 1 ? "Sekunde" : "Sekunden"}`;
};
const wall = (at) => {
  const date = new Date(at);
  return `${date.getHours()}:${pad(date.getMinutes())}`;
};

function timeOfDay(date) {
  const hour = date.getHours() + date.getMinutes() / 60;
  return hour < 5 || hour >= 21 ? "night" : hour < 7.5 ? "dawn" : hour < 17.5 ? "day" : "dusk";
}

function say(text) {
  const live = $("liveStatus");
  if (live) live.textContent = text;
}

function moodOf(state) {
  if (view.cheering) return "cheer";
  if (state.status === "paused") return "paused";
  if (state.phase === "break") return state.status === "running" ? "rest" : "done";
  if (state.status === "running") return "work";
  return state.ended?.phase === "break" ? "back" : "ready";
}

function stageLine(state) {
  const { work, break: rest } = state.minutes;
  const today = view.stats.today.total_sessions;
  switch (moodOf(state)) {
    case "work":
      return `Fertig um <b>${wall(state.endsAt)} Uhr</b>, danach ${rest}\u00a0Min. Pause`;
    case "rest":
      return `Fertig um <b>${wall(state.endsAt)} Uhr</b>, danach Arbeitsphase`;
    case "paused":
      return "Angehalten. Mit Weiter läuft der Rest ab.";
    case "done":
    case "cheer": {
      const ended = state.ended;
      const prefix = ended?.phase === "work" ? `Sitzung ${today} heute, ${ended.minutes}\u00a0Min.` : "Sitzung gespeichert.";
      const wait = waiting() ? " Noch nicht gespeichert, die App versucht es gleich noch einmal." : "";
      return `${prefix} Jetzt ${rest}\u00a0Min. Pause?${wait}`;
    }
    case "back":
      return `Nächste Runde: <b>${work}\u00a0Min.</b> arbeiten, danach ${rest}\u00a0Min. Pause`;
    default:
      return `<b>${work}\u00a0Min.</b> arbeiten, danach ${rest}\u00a0Min. Pause`;
  }
}

function wedge(fraction) {
  const r = DIAL.wedge;
  if (fraction >= 0.999) return `M0 ${-r}A${r} ${r} 0 1 1 0 ${r}A${r} ${r} 0 1 1 0 ${-r}Z`;
  if (fraction <= 0.001) return "";
  const from = 2 * Math.PI * (1 - fraction);
  return `M0 0L${(r * Math.sin(from)).toFixed(2)} ${(-r * Math.cos(from)).toFixed(2)}A${r} ${r} 0 ${fraction > 0.5 ? 1 : 0} 1 0 ${-r}Z`;
}

function dialMarkup(state, at) {
  const tone = state.status === "paused" ? "f-sand3" : state.phase === "break" ? "f-salbei-l" : "f-gold";
  const left = state.total ? remaining(state, at) / state.total : 1;
  const ticks = [0, 90, 180, 270].map((angle) => `<rect x="-1.4" y="-${DIAL.face - 1}" width="2.8" height="5" rx="1.4" class="f-tanne" opacity=".4" transform="rotate(${angle})"/>`).join("");
  return `<g transform="translate(${DIAL.x} ${DIAL.y})">
    <circle r="${DIAL.outer}" class="f-tanne"/>
    <circle r="${DIAL.face}" class="f-kreide"/>
    <path class="pomo-wedge ${tone}" d="${wedge(left)}"/>
    ${ticks}
    <circle r="2.8" class="f-tanne"/>
  </g>`;
}

const wrap = ([key, enter, markup]) => `<g data-part="${key}" data-enter="${enter}">${markup}</g>`;

function sceneMarkup(state, mood, at) {
  const date = new Date(at);
  const time = timeOfDay(date);
  const working = mood === "work" || mood === "paused";
  const resting = mood === "rest" || mood === "done" || mood === "cheer";
  const books = Math.min(4, view.stats.today.total_sessions);
  const parts = sceneParts({
    time,
    minute: date.getHours() * 60 + date.getMinutes(),
    notes: 0,
    lamp: true,
    lampOn: working || time === "night" || time === "dusk",
    papers: false,
    books,
    screen: mood === "rest" ? "closed" : "slides",
    bloom: false,
  }).filter(([key]) => key !== "mug" || resting)
    .map(([key, enter, markup]) => (key === "clock" ? ["dial", "fade", dialMarkup(state, at)] : [key, enter, markup]));
  return `<svg viewBox="0 0 480 320" role="img" aria-label="${SCENE_LABEL[mood]}" focusable="false">${parts.map(wrap).join("")}</svg>`;
}

function paintScene(state, mood, at) {
  const host = $("pomoScene");
  const key = `${mood}|${timeOfDay(new Date(at))}|${Math.min(4, view.stats.today.total_sessions)}|${state.phase}`;
  if (key === view.scene) return;
  const first = !view.scene;
  view.scene = key;
  const old = host.querySelector(":scope > svg");
  const fresh = document.createElement("template");
  fresh.innerHTML = sceneMarkup(state, mood, at);
  const svg = fresh.content.firstElementChild;
  if (old) old.replaceWith(svg);
  else host.prepend(svg);
  const books = Math.min(4, view.stats.today.total_sessions);
  const added = !first && books > view.books ? svg.querySelector(`[data-part="book-${books - 1}"]`) : null;
  view.books = books;
  if (first || !animates()) return;
  svg.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 220, easing: token("--ease-out") });
  if (added && travels()) added.animate([{ opacity: 0, translate: "0 -24px" }, { opacity: 1, translate: "0 0" }], { duration: 560, delay: 120, easing: token("--spring-tactile"), fill: "backwards" });
}

function paintLuna(mood, delay = 0) {
  const kind = mood === "cheer" ? "geschafft" : mood === "rest" ? "schlaeft" : "ruhe";
  if (kind === view.luna) return;
  const first = !view.luna;
  view.luna = kind;
  const host = $("pomoLuna");
  host.innerHTML = luna(kind, 240);
  if (!animates()) return;
  host.firstElementChild.animate(
    travels() ? [{ opacity: 0, transform: "translateY(6%) scale(0.94)" }, { opacity: 1, transform: "none" }] : [{ opacity: 0 }, { opacity: 1 }],
    { duration: travels() ? 460 : 150, delay: first ? delay : 0, easing: token("--spring-tactile") || "ease-out", fill: "backwards" },
  );
}

function roundsOf(state) {
  const items = [];
  view.stats.today.by_subject.forEach((row) => {
    for (let count = 0; count < Math.min(row.sessions, 40); count += 1) items.push({ hue: hueOf(row.subject_id), key: row.subject_id || "" });
  });
  const live = state.phase === "work" && state.status !== "idle";
  const room = MAX_ROUNDS - (live ? 1 : 0);
  const list = items.slice(0, room);
  const extra = view.stats.today.total_sessions - list.length;
  return { list, extra: Math.max(0, extra), live };
}

function paintRounds(state) {
  const host = $("pomoRounds");
  const { list, extra, live } = roundsOf(state);
  const fresh = view.fresh;
  view.fresh = null;
  let mark = -1;
  if (fresh !== null) list.forEach((item, index) => (item.key === fresh ? (mark = index) : 0));
  const ghosts = Math.max(0, SLOTS - list.length - extra - (live ? 1 : 0));
  host.innerHTML = '<li class="pomo-rounds-label">Heute</li>'
    + list.map((item, index) => `<li class="pomo-round${index === mark ? " is-new" : ""}" style="--hue:${item.hue}"></li>`).join("")
    + (extra ? `<li class="pomo-more">+${extra}</li>` : "")
    + (live ? '<li class="pomo-round is-live" id="pomoLive"><i></i></li>' : "")
    + '<li class="pomo-round is-ghost"></li>'.repeat(ghosts);
}

function paintControls(state, mood) {
  const running = state.status === "running";
  const rest = state.phase === "break";
  const main = $("pomoMain");
  const [iconName, text] = running ? ["pause", "Anhalten"] : state.status === "paused" ? ["play", "Weiter"] : rest ? ["coffee", "Pause starten"] : ["play", "Starten"];
  main.dataset.icon = iconName;
  main.querySelector("use").setAttribute("href", `#i-${iconName}`);
  main.querySelector("span").textContent = text;
  const side = $("pomoSide");
  const worth = state.status !== "idle" || rest || !!state.ended;
  const active = document.activeElement === side;
  side.hidden = !worth;
  if (!worth && active) main.focus({ preventScroll: true });
  side.querySelector("use").setAttribute("href", rest ? "#i-skip-forward" : "#i-rotate-ccw");
  side.querySelector("span").textContent = rest ? "Pause überspringen" : "Zurücksetzen";
  const { icon: phaseIcon, text: phaseText } = PHASE[mood];
  $("pomoPhaseText").textContent = phaseText;
  $("pomoPhase").querySelector("use").setAttribute("href", `#i-${phaseIcon}`);
}

function paintSubject(state) {
  const select = $("pomoSubject");
  const keys = activeSubjectKeys();
  const wanted = keys.includes(state.subject) ? state.subject : "";
  if (select.dataset.keys !== keys.join("|")) {
    select.dataset.keys = keys.join("|");
    select.innerHTML = `<option value="">Kein Fach</option>${keys.map((key) => `<option value="${esc(key)}">${esc(subject(key).label)}</option>`).join("")}`;
  }
  select.value = wanted;
  $("pomoSubjectBox").hidden = !keys.length;
  $("pomoSubjectName").textContent = wanted ? subject(wanted).label : "Kein Fach";
  $("pomoSubjectBox").style.setProperty("--hue", wanted ? hueVar(wanted) : "var(--line-strong)");
}

function paintHeader() {
  const today = view.stats.today;
  $("pomoToday").textContent = today.total_sessions ? `${sessionsWord(today.total_sessions)} heute, ${duration(today.total_minutes)}` : "Heute noch keine Sitzung";
}

function paintRhythm(state) {
  const locked = state.status !== "idle";
  ["work", "break"].forEach((kind) => {
    const group = document.querySelector(`.stepper[data-kind="${kind}"]`);
    const input = group.querySelector("input");
    const off = locked && state.phase === kind;
    if (document.activeElement !== input) input.value = state.minutes[kind];
    group.classList.toggle("is-locked", off);
    group.querySelectorAll("button, input").forEach((control) => (control.disabled = off));
  });
  $("cycleWork").style.flexGrow = state.minutes.work;
  $("cycleBreak").style.flexGrow = state.minutes.break;
  $("rhythmMeta").textContent = `${state.minutes.work} + ${state.minutes.break}\u00a0Min.`;
  const hint = $("rhythmHint");
  hint.hidden = !locked;
  if (locked) hint.textContent = `Die Länge der laufenden ${state.phase === "work" ? "Arbeitsphase" : "Pause"} ist gesperrt, bis sie vorbei ist oder du zurücksetzt.`;
}

function paintNotice() {
  const text = $("pomoNoticeText");
  const link = $("pomoNoticeLink");
  let words;
  let settings = true;
  if (!("Notification" in window)) {
    words = "Dieser Browser kann keine Erinnerungen zeigen. Das Ende siehst du nur auf dieser Seite.";
    settings = false;
  } else if (Notification.permission === "denied") {
    words = "Meldungen sind im Browser blockiert. Das Ende siehst du nur auf dieser Seite.";
    settings = false;
  } else if (Notification.permission === "default") {
    words = "Ohne Erinnerungen siehst du das Ende nur auf dieser Seite.";
    settings = false;
  } else {
    const prefs = readPrefs();
    words = prefs.enabled && prefs.categories.pomodoro.on
      ? `Am Ende jeder Phase meldet sich ${BRAND}, auch von anderen Seiten aus.`
      : "Meldungen am Ende einer Phase sind aus. In den Einstellungen kannst du sie anschalten.";
  }
  text.textContent = words;
  link.hidden = !settings;
}

function paintStats() {
  const stats = view.stats[view.range];
  const none = !stats.total_sessions;
  const minutes = stats.total_minutes;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const time = hours ? `<b>${hours}</b><small>Std.</small>${rest ? `<b>${rest}</b><small>Min.</small>` : ""}` : `<b>${rest}</b><small>Min.</small>`;
  $("pomoFigures").classList.toggle("is-empty", none);
  $("pomoFigures").innerHTML = `<div class="pomo-figure"><p class="pomo-number"><b>${stats.total_sessions}</b></p><span>${stats.total_sessions === 1 ? "Sitzung" : "Sitzungen"}</span></div>
    <div class="pomo-figure"><p class="pomo-number">${time}</p><span>Lernzeit</span></div>`;
  const split = $("pomoSplit");
  split.hidden = none;
  split.innerHTML = stats.by_subject.map((row, index) => {
    const share = minutes ? Math.max(0.04, row.minutes / minutes) : 0;
    return `<li class="pomo-row" style="--hue:${hueOf(row.subject_id)};--share:${share.toFixed(3)};--i:${index}">
      <span class="pomo-row-name"><i class="subject-dot" aria-hidden="true"></i><span class="pomo-row-label">${esc(nameOf(row.subject_id))}</span></span>
      <span class="pomo-row-meta">${sessionsWord(row.sessions)}</span>
      <span class="pomo-row-time">${duration(row.minutes)}</span>
      <span class="pomo-row-bar" aria-hidden="true"><i></i></span>
    </li>`;
  }).join("");
  const empty = $("pomoEmpty");
  empty.hidden = !none;
  empty.textContent = view.range === "today"
    ? "Heute noch keine Sitzung. Die erste zählt, sobald eine Arbeitsphase zu Ende ist."
    : `In den letzten ${view.range === "week" ? 7 : 30} Tagen gibt es noch keine Sitzung.`;
  document.querySelectorAll("#pomoRange button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.range === view.range)));
}

function showTime(text) {
  const host = $("pomoDigits");
  const before = host.dataset.value;
  host.dataset.value = text;
  if (before === undefined || before.length !== text.length) {
    host.innerHTML = [...text].map((char) => `<span class="digit"><span>${char}</span></span>`).join("");
    return;
  }
  [...text].forEach((char, index) => {
    if (before[index] === char) return;
    const face = host.children[index].firstElementChild;
    face.textContent = char;
    if (!animates() || document.hidden) return;
    face.animate(
      travels() ? [{ opacity: 0, translate: "0 0.1em" }, { opacity: 1, translate: "0 0" }] : [{ opacity: 0 }, { opacity: 1 }],
      { duration: travels() ? 260 : 150, easing: token("--ease-out") || "ease-out" },
    );
  });
}

function paintClock(state, at) {
  const left = remaining(state, at);
  const text = clockText(left);
  showTime(text);
  $("pomoSpoken").textContent = spoken(left);
  const wedgePath = $("pomoScene").querySelector(".pomo-wedge");
  if (wedgePath) {
    const fraction = state.total ? left / state.total : 1;
    wedgePath.setAttribute("d", wedge(fraction));
  }
  const live = $("pomoLive");
  if (live) live.style.setProperty("--p", (state.total ? 1 - left / state.total : 0).toFixed(4));
  const running = state.status !== "idle";
  document.title = running ? `${text} ${state.phase === "work" ? "Arbeitsphase" : "Pause"} · ${BRAND}` : view.baseTitle;
}

function render() {
  const state = read();
  const at = Date.now();
  const mood = moodOf(state);
  const key = [state.phase, state.status, state.id, mood, state.ended?.id, state.minutes.work, state.minutes.break, state.subject, view.stats.today.total_sessions, waiting()].join("|");
  const stage = $("pomoStage");
  if (key !== view.stage) {
    view.stage = key;
    stage.dataset.mood = mood;
    $("pomoMeta").innerHTML = stageLine(state);
    paintControls(state, mood);
    paintSubject(state);
    paintRounds(state);
    paintRhythm(state);
    paintHeader();
    paintScene(state, mood, at);
    paintLuna(mood, view.introduced ? 0 : 700);
  } else {
    paintScene(state, mood, at);
  }
  paintClock(state, at);
  schedule();
}

function schedule() {
  clearTimeout(view.tick);
  const state = read();
  if (state.status !== "running") return;
  const left = state.endsAt - Date.now();
  view.tick = setTimeout(() => {
    if (!document.hidden) render();
    else {
      const current = read();
      if (current.status === "running") document.title = `${clockText(remaining(current, Date.now()))} ${current.phase === "work" ? "Arbeitsphase" : "Pause"} · ${BRAND}`;
      schedule();
    }
  }, Math.max(40, (left % 1000 || 1000) + 6));
}

function count(finished) {
  if (finished.phase !== "work" || view.counted === finished.id) return;
  view.counted = finished.id;
  view.fresh = finished.subject || "";
  Object.values(view.stats).forEach((stats) => {
    stats.total_sessions += 1;
    stats.total_minutes += finished.minutes;
    const key = finished.subject || null;
    const row = stats.by_subject.find((item) => item.subject_id === key);
    if (row) {
      row.sessions += 1;
      row.minutes += finished.minutes;
    } else {
      stats.by_subject.push({ subject_id: key, sessions: 1, minutes: finished.minutes });
    }
    stats.by_subject.sort((a, b) => b.minutes - a.minutes);
  });
  paintStats();
}

function celebrate(finished) {
  if (document.hidden || Date.now() - finished.at > 15000) return;
  view.cheering = finished.phase === "work";
  clearTimeout(view.cheerTimer);
  if (!view.cheering) return;
  view.cheerTimer = setTimeout(() => {
    view.cheering = false;
    render();
  }, CHEER_MS);
}

function onEnd(finished) {
  count(finished);
  celebrate(finished);
  const state = read();
  say(finished.phase === "work" ? `Arbeitsphase vorbei. ${minutesWord(finished.minutes)} gearbeitet. Jetzt ${minutesWord(state.minutes.break)} Pause.` : "Pause vorbei. Die nächste Runde kann starten.");
}

async function refreshStats() {
  try {
    const entries = await Promise.all(RANGES.map(async (range) => {
      const response = await fetch(`/api/pomodoro/stats?range=${range}`, { credentials: "same-origin", headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      return [range, statsOf(await response.json())];
    }));
    view.stats = Object.fromEntries(entries);
    paintStats();
    view.stage = "";
    render();
  } catch {}
}

let warned = false;

function handle(event) {
  if (event.type === "end") onEnd(event.finished);
  else if (event.type === "saved") refreshStats();
  else if (event.type === "refused") {
    refreshStats();
    toast("Eine Sitzung ließ sich nicht speichern.", { icon: "circle-alert" });
  }
  else if (event.type === "unsaved" && !warned) {
    warned = true;
    toast("Die Sitzung ist noch nicht gespeichert. Die App versucht es gleich noch einmal.", { icon: "circle-alert" });
  }
  if (event.type === "saved") warned = false;
  if (event.type === "change") {
    const state = read();
    if (state.ended?.phase === "work" && state.ended.id !== view.counted) {
      count(state.ended);
      setTimeout(refreshStats, 1800);
    }
  }
  render();
}

function nudgeLuna() {
  const art = $("pomoLuna").querySelector("svg.luna-art[data-st=idle]");
  if (art && travels()) art.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function nudge(kind, direction, current) {
  const { step, min, max } = LIMITS[kind];
  const value = direction > 0 ? (Math.floor(current / step) + 1) * step : (Math.ceil(current / step) - 1) * step;
  return Math.min(max, Math.max(min, value));
}

function bind() {
  $("pomoMain").addEventListener("click", () => {
    const state = read();
    if (state.status === "running") {
      actions.pause();
      say("Angehalten.");
    } else {
      view.cheering = false;
      clearTimeout(view.cheerTimer);
      actions.start();
      const next = read();
      say(state.status === "paused" ? "Weiter." : `${next.phase === "work" ? "Arbeitsphase" : "Pause"} gestartet, ${minutesWord(next.minutes[next.phase])}.`);
      nudgeLuna();
    }
  });
  $("pomoSide").addEventListener("click", () => {
    const state = read();
    view.cheering = false;
    clearTimeout(view.cheerTimer);
    actions.reset();
    say(state.phase === "break" ? "Pause übersprungen." : "Zurückgesetzt.");
    $("pomoMain").focus({ preventScroll: true });
    if (state.phase === "work" && state.status !== "idle") {
      toast("Arbeitsphase zurückgesetzt.", { icon: "rotate-ccw", action: { label: "Rückgängig", undo: true, run: () => actions.restore(state) } });
    }
  });
  $("pomoSubject").addEventListener("change", (event) => actions.subject(event.target.value));
  document.querySelectorAll(".stepper").forEach((group) => {
    const kind = group.dataset.kind;
    const input = group.querySelector("input");
    group.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => actions.minutes(kind, nudge(kind, Number(button.dataset.step), Number(input.value) || read().minutes[kind]))));
    input.addEventListener("change", () => {
      if (input.value.trim() !== "") actions.minutes(kind, input.value);
      input.value = read().minutes[kind];
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
    });
  });
  $("pomoRange").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-range]");
    if (!button || button.dataset.range === view.range) return;
    view.range = button.dataset.range;
    paintStats();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) render();
  });
  document.addEventListener("reminders:on", paintNotice);
  addEventListener("pageshow", () => render());
}

export function init() {
  view.stats = Object.fromEntries(RANGES.map((range) => [range, statsOf(data.page?.stats?.[range])]));
  view.counted = read().ended?.id || "";
  bind();
  paintStats();
  paintNotice();
  render();
  subscribe(handle);
  flush();
  onPlanRefresh(() => paintSubject(read()), () => document.activeElement === $("pomoSubject"));
  if (!view.introduced) {
    view.introduced = true;
    if (animates()) playIntro($("pomoScene"));
  }
}
