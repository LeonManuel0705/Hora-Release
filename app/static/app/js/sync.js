// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { data, storage, planMeta, planRevert, planAdopt, onPlanChange, syncStore, schoolDefaults, applySchoolEdits, abWeeks, hasPlan, LOCAL_KEYS } from "./core.js";
import { wholeSchool, fitSchool, fileKeys, fileSubjects } from "./backup.js";
import { PLAN_KEYS, changedKeys, writeValues, sameValue } from "./plan-format.js";
import { SyncError } from "./sync/client.js";
import { TIMETABLE_STREAM, timetableEntry, readTimetableEntry } from "./sync/timetable-entry.js";
import { refreshPlan } from "./plan-refresh.js";

const HISTORY = 20;
const PUSH_DELAY = 1500;
const SESSION_KEY = "app-sync-pulled";

let connection = null;
let chain = Promise.resolve();
let timer = 0;
let status = { connected: false, ready: false, busy: false, error: null, unreadable: 0 };

const session = {
  get(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {}
  },
  remove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {}
  },
};

const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isSeq = (value) => Number.isSafeInteger(value) && value > 0;
const sameRecord = (one, other) => !!one && !!other && one.at === other.at && one.origin === other.origin && one.device === other.device;

// The newest own edit wins, an import or a shared plan only where no device has an own edit. Equal times go to the
// higher device id, and the same record twice to its later entry.
function compare(one, other) {
  if (!one || !other) return one ? 1 : other ? -1 : 0;
  const edit = (record) => (record.origin === "edit" ? 1 : 0);
  if (edit(one) !== edit(other)) return edit(one) - edit(other);
  if (one.at !== other.at) return one.at - other.at;
  if (one.device !== other.device) return String(one.device ?? "") > String(other.device ?? "") ? 1 : -1;
  return isSeq(one.seq) && isSeq(other.seq) ? one.seq - other.seq : 0;
}

const bestOf = (entries) => entries.reduce((best, entry) => (compare(entry, best) > 0 ? entry : best), null);

function freshState(account) {
  return { account, cursor: 0, latest: 0, entries: [], unreadable: [] };
}

function readState(saved, account) {
  if (!saved || saved.account !== account) return null;
  const number = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
  const entries = Array.isArray(saved.entries)
    ? saved.entries.filter((item) => isSeq(item?.seq) && Number.isSafeInteger(item.at) && ["edit", "import", "share"].includes(item.origin) && typeof item.device === "string")
      .map(({ seq, at, origin, device }) => ({ seq, at, origin, device }))
    : [];
  return { account, cursor: number(saved.cursor), latest: number(saved.latest), entries, unreadable: Array.isArray(saved.unreadable) ? saved.unreadable.filter(isSeq) : [] };
}

function report(patch) {
  const next = { ...status, ...patch };
  if (sameValue(next, status)) return;
  status = next;
  dispatchEvent(new CustomEvent("app:sync", { detail: { ...status } }));
}

export const syncConnected = () => connection !== null;
export const syncStatus = () => ({ ...status });

function keep(current) {
  const { account, cursor, latest, entries, unreadable } = current.state;
  syncStore.set({ account, cursor, latest, entries, unreadable });
}

function serial(current, task) {
  const run = chain.then(async () => {
    if (connection !== current) return;
    report({ busy: true });
    try {
      await task();
      if (connection === current) report({ error: null });
    } catch (error) {
      if (connection === current) report({ error: error instanceof SyncError ? error.code : "failed" });
    } finally {
      if (connection === current) report({ busy: false });
    }
  });
  chain = run;
  return run.then(() => syncStatus());
}

// The plan as a backup freezes it, so that a device with other school defaults or another IServ ends up with the same lessons.
function frozenPlan() {
  applySchoolEdits();
  const plan = wholeSchool({
    subjects: data.subjects,
    teachers: data.teachers,
    rooms: data.rooms,
    blocks: data.blocks,
    timetable: data.timetable,
    edits: storage.get(LOCAL_KEYS.lessons),
    gone: { teachers: storage.get(LOCAL_KEYS.teachers)?.removed, rooms: storage.get(LOCAL_KEYS.rooms)?.removed },
    weeks: abWeeks(),
  });
  return { ...plan, [LOCAL_KEYS.abSwap]: storage.get(LOCAL_KEYS.abSwap) === true ? true : null };
}

// The A/B reference comes as the sending device counts it and is turned into this device's swap, as with a backup.
function fittedPlan(entry) {
  const own = { subjects: storage.get(LOCAL_KEYS.subjects), teachers: storage.get(LOCAL_KEYS.teachers), rooms: storage.get(LOCAL_KEYS.rooms) };
  const plan = Object.fromEntries(Object.entries(entry.plan).filter(([, value]) => value != null));
  const { values } = fitSchool(plan, { abReference: entry.abReference, subjects: entry.subjects }, { ...schoolDefaults, own });
  const weeks = entry.plan[LOCAL_KEYS.abWeeks];
  return Object.fromEntries(PLAN_KEYS.map((key) => [key, key === LOCAL_KEYS.abWeeks && typeof weeks === "boolean" ? weeks : values[key] ?? null]));
}

async function written(values, keys, apply) {
  let failed = false;
  const note = (event) => {
    if (PLAN_KEYS.includes(event.detail?.key)) failed = true;
  };
  addEventListener("app:save-failed", note);
  apply(() => writeValues(storage, values, keys));
  await storage.settled();
  removeEventListener("app:save-failed", note);
  return !failed;
}

const held = (state, record) => state.entries.some((entry) => sameRecord(entry, record));

function prune(state) {
  const floor = state.latest - HISTORY;
  state.entries = state.entries.filter((entry) => entry.seq > floor);
  state.unreadable = state.unreadable.filter((seq) => seq > floor);
}

async function push(current, record) {
  const plan = frozenPlan();
  const entry = timetableEntry({
    record,
    plan,
    abReference: isDay(data.abReference) ? data.abReference : null,
    subjects: fileSubjects(schoolDefaults.subjects, fileKeys(data.subjects)),
  });
  const seq = await current.client.push(TIMETABLE_STREAM, entry);
  if (connection !== current) return;
  const { state } = current;
  if (seq === state.cursor + 1) state.cursor = seq;
  state.latest = Math.max(state.latest, seq);
  state.entries = [...state.entries.filter((item) => item.seq !== seq), { seq, ...entry.record }];
  prune(state);
  current.pushed = { record: entry.record, plan };
  keep(current);
}

// After an own change: this device's newest record goes up unless the server already holds it with this very plan.
async function pushOwn(current) {
  const local = planMeta();
  if (!current.ready || !local || local.device !== data.device) return;
  const moved = sameRecord(current.pushed?.record, local) && !sameValue(current.pushed.plan, frozenPlan());
  if (held(current.state, local) && !moved) return;
  await push(current, local);
}

async function refetch(current, seq) {
  const result = await current.client.pull(TIMETABLE_STREAM, seq - 1);
  const hit = result.entries.find((item) => item.seq === seq);
  return hit ? readTimetableEntry(hit.value) : null;
}

async function takeOver(current, entry) {
  const before = Object.fromEntries(PLAN_KEYS.map((key) => [key, storage.get(key)]));
  const meta = planMeta();
  const values = fittedPlan(entry);
  const keys = changedKeys(before, values);
  if (!(await written(values, keys, (write) => planRevert(entry.record, write)))) {
    await written(before, keys, (write) => planRevert(meta, write));
    applySchoolEdits();
    throw new SyncError("not_saved");
  }
  applySchoolEdits();
  current.pushed = null;
  if (keys.length && dispatchEvent(new CustomEvent("app:plan-synced", { cancelable: true, detail: { record: entry.record } }))) refreshPlan();
}

async function settle(current, fetched) {
  for (let turn = 0; turn < 3 && connection === current; turn += 1) {
    const local = planMeta();
    const best = bestOf(current.state.entries);
    if (best && compare(best, local) > 0) {
      const entry = fetched.get(best.seq) || (await refetch(current, best.seq));
      if (connection !== current) return;
      if (compare(best, planMeta()) <= 0) continue;
      if (entry && sameRecord(entry.record, best)) {
        await takeOver(current, entry);
        return;
      }
      current.state.entries = current.state.entries.filter((item) => item.seq !== best.seq);
      keep(current);
      continue;
    }
    // The plan here wins, but the server does not hold it: the first push of this device, or the last own edit was pushed out of the history.
    if (local && !held(current.state, local)) await push(current, local);
    else if (!local && !best && hasPlan()) await push(current, planAdopt("import"));
    return;
  }
}

async function pull(current, whole) {
  const { state } = current;
  const after = whole ? 0 : state.cursor;
  const result = await current.client.pull(TIMETABLE_STREAM, after);
  if (connection !== current) return;
  if (!whole && result.latest < after) return pull(current, true);
  const fetched = new Map();
  const entries = whole ? [] : [...state.entries];
  result.entries.forEach(({ seq, value }) => {
    const entry = readTimetableEntry(value);
    if (!entry) return;
    fetched.set(seq, entry);
    if (!entries.some((item) => item.seq === seq)) entries.push({ seq, ...entry.record });
  });
  state.entries = entries;
  state.unreadable = [...new Set([...(whole ? [] : state.unreadable), ...result.unreadable])];
  state.latest = result.latest;
  state.cursor = Math.max(after, result.latest);
  prune(state);
  current.ready = true;
  keep(current);
  if (whole) session.set(SESSION_KEY, current.account);
  report({ ready: true, unreadable: state.unreadable.length });
  await settle(current, fetched);
}

function pullSoon(current) {
  if (current.pulling) return;
  current.pulling = true;
  serial(current, () => {
    current.pulling = false;
    return pull(current, !current.ready);
  });
}

function pushSoon(current) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = 0;
    serial(current, () => pushOwn(current));
  }, PUSH_DELAY);
}

export function flushSync() {
  const current = connection;
  if (!current) return Promise.resolve(syncStatus());
  if (!timer) return chain.then(() => syncStatus());
  clearTimeout(timer);
  timer = 0;
  return serial(current, () => pushOwn(current));
}

function listen(current) {
  const shown = () => (document.visibilityState === "visible" ? pullSoon(current) : flushSync());
  const online = () => pullSoon(current);
  const leave = () => flushSync();
  document.addEventListener("visibilitychange", shown);
  addEventListener("online", online);
  addEventListener("pagehide", leave);
  const quiet = onPlanChange(() => pushSoon(current));
  return () => {
    document.removeEventListener("visibilitychange", shown);
    removeEventListener("online", online);
    removeEventListener("pagehide", leave);
    quiet();
  };
}

function close() {
  if (!connection) return;
  connection.off();
  clearTimeout(timer);
  timer = 0;
  connection = null;
}

// The account screens call this with the client of openSync() on every page, and with signedIn after signing in, verifying
// or resetting the password. A device pulls the whole history and resolves it before it pushes anything, once per start
// of the app and after every sign in. Other pages only send what is still waiting.
export function connectSync(client, { signedIn = false } = {}) {
  if (typeof client?.pull !== "function" || typeof client?.push !== "function") throw new TypeError("connectSync needs a sync client");
  close();
  if (!data?.device || !schoolDefaults) {
    report({ connected: false, ready: false, error: "unavailable" });
    return Promise.resolve(syncStatus());
  }
  const account = typeof client.account === "string" ? client.account : "";
  const saved = readState(syncStore.get(), account);
  const current = { client, account, state: saved || freshState(account), ready: false, pushed: null, pulling: false };
  current.off = listen(current);
  connection = current;
  keep(current);
  report({ connected: true, ready: false, error: null, unreadable: current.state.unreadable.length });
  if (saved && !signedIn && session.get(SESSION_KEY) === account) {
    return serial(current, () => {
      current.ready = true;
      report({ ready: true });
      return pushOwn(current);
    });
  }
  return serial(current, () => pull(current, true));
}

// Signing out: the plan stays on this device, the cursor and what was taken over go.
export function disconnectSync() {
  close();
  syncStore.set(null);
  session.remove(SESSION_KEY);
  report({ connected: false, ready: false, busy: false, error: null, unreadable: 0 });
}
