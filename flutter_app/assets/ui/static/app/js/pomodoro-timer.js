const KEY = "app-pomodoro";
const OUTBOX = "app-pomodoro-outbox";
export const MINUTE = 60000;
const FRESH = 2 * MINUTE;
const OUTBOX_LIMIT = 40;
const RETRY = 30000;
const LONGEST_WAIT = 2147483647;

export const LIMITS = {
  work: { min: 1, max: 60, step: 5, base: 25 },
  break: { min: 1, max: 30, step: 1, base: 5 },
};

const whole = (value, limits) => {
  const usable = typeof value === "number" || (typeof value === "string" && value.trim() !== "");
  const number = usable ? Math.round(Number(value)) : NaN;
  return Number.isFinite(number) ? Math.min(limits.max, Math.max(limits.min, number)) : limits.base;
};

export function blank(minutes) {
  const given = minutes && typeof minutes === "object" ? minutes : {};
  const work = whole(given.work, LIMITS.work);
  const rest = whole(given.break, LIMITS.break);
  return { v: 1, minutes: { work, break: rest }, subject: null, phase: "work", status: "idle", id: "", total: work * MINUTE, endsAt: 0, left: 0, ended: null };
}

const finite = (value) => typeof value === "number" && Number.isFinite(value);

function endedOf(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !finite(raw.at)) return null;
  if (raw.phase !== "work" && raw.phase !== "break") return null;
  return {
    id: raw.id,
    phase: raw.phase,
    minutes: whole(raw.minutes, LIMITS[raw.phase]),
    next: whole(raw.next, LIMITS[raw.phase === "work" ? "break" : "work"]),
    subject: typeof raw.subject === "string" && raw.subject ? raw.subject : null,
    at: raw.at,
  };
}

export function normalize(raw) {
  if (!raw || typeof raw !== "object") return blank();
  const state = blank(raw.minutes);
  state.phase = raw.phase === "break" ? "break" : "work";
  state.subject = typeof raw.subject === "string" && raw.subject ? raw.subject : null;
  state.ended = endedOf(raw.ended);
  state.total = state.minutes[state.phase] * MINUTE;
  const total = finite(raw.total) && raw.total >= MINUTE && raw.total <= 60 * MINUTE ? raw.total : state.total;
  if (raw.status === "running" && finite(raw.endsAt) && raw.endsAt > 0 && typeof raw.id === "string" && raw.id) {
    return { ...state, status: "running", id: raw.id, total, endsAt: raw.endsAt };
  }
  if (raw.status === "paused" && finite(raw.left) && raw.left >= 0 && raw.left <= total && typeof raw.id === "string" && raw.id) {
    return { ...state, status: "paused", id: raw.id, total, left: raw.left };
  }
  return state;
}

export function remaining(state, at) {
  if (state.status === "running") return Math.max(0, state.endsAt - at);
  if (state.status === "paused") return state.left;
  return state.total;
}

const runId = (at) => `${at.toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function start(state, at) {
  if (state.status === "running") return state;
  if (state.status === "paused") return { ...state, status: "running", endsAt: at + state.left, left: 0 };
  const total = state.minutes[state.phase] * MINUTE;
  return { ...state, status: "running", id: runId(at), total, endsAt: at + total, left: 0, ended: null };
}

export function pause(state, at) {
  if (state.status !== "running") return state;
  return { ...state, status: "paused", left: Math.max(0, state.endsAt - at), endsAt: 0 };
}

export function reset(state) {
  return { ...blank(state.minutes), subject: state.subject };
}

export function setMinutes(state, kind, value) {
  if (state.status !== "idle" && state.phase === kind) return state;
  const minutes = { ...state.minutes, [kind]: whole(value, LIMITS[kind]) };
  return { ...state, minutes, total: state.status === "idle" ? minutes[state.phase] * MINUTE : state.total };
}

export const setSubject = (state, subject) => ({ ...state, subject: subject || null });

export function settle(state, at) {
  if (state.status !== "running" || state.endsAt > at) return { state, finished: null };
  const phase = state.phase;
  const other = phase === "work" ? "break" : "work";
  const finished = {
    id: state.id,
    phase,
    minutes: Math.round(state.total / MINUTE),
    next: state.minutes[other],
    subject: phase === "work" ? state.subject : null,
    at: state.endsAt,
  };
  const upcoming = phase === "work" && at - state.endsAt >= state.minutes.break * MINUTE ? "work" : other;
  return {
    state: { ...state, phase: upcoming, status: "idle", id: "", total: state.minutes[upcoming] * MINUTE, endsAt: 0, left: 0, ended: finished },
    finished,
  };
}

export const endNotice = (state, at) => (state.ended && at - state.ended.at >= 0 && at - state.ended.at < FRESH ? state.ended : null);

const listeners = new Set();
let memory = null;
let memoryOutbox = [];
let timer = 0;
let retry = 0;
let flushing = null;
let watching = false;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(event) {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch {}
  });
}

function stored(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return undefined;
  }
}

function classic() {
  try {
    const old = JSON.parse(localStorage.getItem("hub_pomodoro"));
    return { ...blank({ work: old?.workDuration, break: old?.breakDuration }), subject: localStorage.getItem("pomodoro_subject") || null };
  } catch {
    return blank();
  }
}

export function read() {
  const raw = stored(KEY);
  if (raw === undefined) return memory || blank();
  return raw === null ? classic() : normalize(raw);
}

function save(state) {
  memory = state;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

function queued() {
  const list = stored(OUTBOX);
  if (list === undefined) return memoryOutbox;
  return Array.isArray(list) ? list.filter((item) => item && typeof item.id === "string" && finite(item.at) && finite(item.minutes)) : [];
}

function queue(list) {
  memoryOutbox = list;
  try {
    if (list.length) localStorage.setItem(OUTBOX, JSON.stringify(list));
    else localStorage.removeItem(OUTBOX);
  } catch {}
}

function enqueue(finished) {
  const list = queued();
  if (list.some((item) => item.id === finished.id)) return;
  queue([...list, { id: finished.id, subject: finished.subject, minutes: finished.minutes, at: finished.at }].slice(-OUTBOX_LIMIT));
}

async function post(item) {
  const response = await fetch("/api/pomodoro/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject_id: item.subject, duration: item.minutes, session_type: "work", ended_at: item.at }),
    credentials: "same-origin",
    keepalive: true,
  });
  if (response.ok) return true;
  if (response.status >= 400 && response.status < 500 && ![401, 408, 429].includes(response.status)) return false;
  throw new Error(String(response.status));
}

export function flush() {
  if (flushing) return flushing;
  if (!queued().length) return Promise.resolve(0);
  flushing = (async () => {
    const done = new Set();
    let failed = false;
    for (const item of queued()) {
      try {
        await post(item);
        done.add(item.id);
      } catch {
        failed = true;
        break;
      }
    }
    if (done.size) queue(queued().filter((item) => !done.has(item.id)));
    clearTimeout(retry);
    retry = 0;
    if (failed) {
      retry = setTimeout(flush, RETRY);
      notify({ type: "unsaved", waiting: queued().length });
    }
    if (done.size) notify({ type: "saved", count: done.size });
    return done.size;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

export const waiting = () => queued().length;

function arm() {
  clearTimeout(timer);
  timer = 0;
  const state = read();
  if (state.status !== "running") return;
  timer = setTimeout(check, Math.min(Math.max(state.endsAt - Date.now(), 0) + 30, LONGEST_WAIT));
}

function commit(state, finished) {
  save(state);
  if (finished?.phase === "work") enqueue(finished);
  if (finished) notify({ type: "end", state, finished });
  notify({ type: "change", state });
  if (finished) flush();
}

export function check() {
  const outcome = settle(read(), Date.now());
  if (outcome.finished) commit(outcome.state, outcome.finished);
  arm();
  return outcome.finished;
}

function act(change) {
  const at = Date.now();
  const outcome = settle(read(), at);
  commit(change(outcome.state, at), outcome.finished);
  arm();
  return read();
}

export const actions = {
  start: () => act(start),
  pause: () => act(pause),
  reset: () => act(reset),
  minutes: (kind, value) => act((state) => setMinutes(state, kind, value)),
  subject: (key) => act((state) => setSubject(state, key)),
};

export function initPomodoro() {
  if (watching || typeof document === "undefined") return;
  watching = true;
  addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== KEY && event.key !== OUTBOX) return;
    notify({ type: "change", state: read() });
    arm();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) check();
  });
  addEventListener("pageshow", (event) => {
    if (event.persisted) check();
  });
  addEventListener("online", () => flush());
  check();
  flush();
}
