import { BRAND, LOCAL_KEYS, activeSubjectKeys, addDays, data, dayDiff, hasPlan, hm, isoDate, lessonsFor, minutesOf, startOfDay, storage, subject, toMin } from "./core.js";
import { expandEvents } from "./recurrence.js";
import { endNotice, read as readPomodoro, subscribe } from "./pomodoro-timer.js";

const SHOWN_KEY = "app-reminders-shown";
const ASKED_KEY = "app-reminders-asked";
const TICK = 30000;
const GRACE = 5;
const KEEP_DAYS = 3;
const MORNING = 7 * 60;
const NOTE_LIMIT = 160;

export const CATEGORY_DEFAULTS = {
  lessons: { on: true, lead: 10 },
  tests: { on: true, lead: 1 },
  homework: { on: true, lead: 1 },
  events: { on: true, lead: 15 },
  tasks: { on: true },
  pomodoro: { on: true },
};

export function readPrefs(saved = storage.get(LOCAL_KEYS.prefs)) {
  const notify = saved?.notify || {};
  const categories = Object.fromEntries(
    Object.entries(CATEGORY_DEFAULTS).map(([key, base]) => [key, { ...base, ...(notify.categories?.[key] || {}) }]),
  );
  return {
    enabled: notify.enabled === true,
    sound: notify.sound !== false,
    quiet: { from: notify.quiet?.from || "22:00", to: notify.quiet?.to || "07:00" },
    categories,
  };
}

export function switchRemindersOn() {
  const saved = storage.get(LOCAL_KEYS.prefs) || {};
  if (saved.notify?.enabled === true) return;
  storage.set(LOCAL_KEYS.prefs, { ...saved, notify: { ...(saved.notify || {}), enabled: true } });
  document.dispatchEvent(new CustomEvent("reminders:on"));
}

const looksNew = () => !!data && !hasPlan() && !activeSubjectKeys().length && ![data.tasks, data.taskPool, data.deadlines, data.events].some((list) => list?.length);

// Reminders start on for someone new. The choice is stored right away, so it does not change once their data comes in,
// and whoever used the app before keeps reminders off until they turn them on.
export function adoptDefault() {
  const saved = storage.get(LOCAL_KEYS.prefs);
  if (saved?.notify && "enabled" in saved.notify) return;
  if (looksNew()) switchRemindersOn();
}

export const canAsk = () => "Notification" in window && Notification.permission === "default" && readPrefs().enabled;

export async function askPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") return "Notification" in window ? Notification.permission : "unsupported";
  try {
    localStorage.setItem(ASKED_KEY, String(Date.now()));
  } catch {}
  let answer = "default";
  try {
    answer = await Notification.requestPermission();
  } catch {}
  document.dispatchEvent(new CustomEvent("reminders:permission", { detail: { state: answer } }));
  return answer;
}

// Asked once, right when the first test or homework is saved, while the click still counts as the user's own.
export function askAtFirstEntry() {
  if (!canAsk()) return;
  try {
    if (localStorage.getItem(ASKED_KEY)) return;
  } catch {
    return;
  }
  askPermission();
}

export function isQuiet(minute, quiet) {
  const from = toMin(quiet.from);
  const to = toMin(quiet.to);
  if (from === to) return false;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

const dueAt = (minute, target) => minute >= target && minute < target + GRACE;
const whenText = (days) => (days === 0 ? "heute" : days === 1 ? "morgen" : `in ${days} Tagen`);
const capitalized = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const courseOf = (key) => (key ? `, ${subject(key).label}` : "");

function noteOf(item) {
  const lines = String(item.detail || "").split("\n").map((line) => line.replace(/^\s*[-\u2013\u2022*]\s+/, "").trim().replace(/[,;]$/, "")).filter(Boolean);
  if (!lines.length) return "";
  const text = lines.reduce((all, line) => `${all}${/[.:!?]$/.test(all) ? " " : ", "}${line}`);
  const word = item.kind === "Test" || item.kind === "Klausur" ? "Lernstoff" : "Notiz";
  return `\n${word}: ${text.length > NOTE_LIMIT ? `${text.slice(0, NOTE_LIMIT - 1).replace(/[\uD800-\uDBFF]$/, "").trimEnd()}…` : text}`;
}

function lessonReminders(prefs, day, minute) {
  const lead = Number(prefs.categories.lessons.lead) || CATEGORY_DEFAULTS.lessons.lead;
  return lessonsFor(day)
    .filter((lesson) => !lesson.cancelled && dueAt(minute, lesson.startMin - lead))
    .map((lesson) => ({
      key: `lesson:${isoDate(day)}:${lesson.block}`,
      title: BRAND,
      body: `${subject(lesson.subject).label} um ${hm(lesson.start)}${lesson.room ? ` in ${lesson.room}` : ""}.`,
    }));
}

function deadlineReminders(prefs, day) {
  const reminders = [];
  for (const item of data.deadlines || []) {
    const homework = item.kind === "Hausaufgabe";
    const category = prefs.categories[homework ? "homework" : "tests"];
    const days = dayDiff(day, item.date);
    if (!category.on || days < 0 || days > (Number(category.lead) || 1)) continue;
    if (homework && item.status === "abgegeben") continue;
    reminders.push({
      key: `deadline:${item.id}:${isoDate(day)}`,
      title: `${item.kind}: ${item.title}`,
      body: homework
        ? `Fällig ${whenText(days)}${courseOf(item.subject)}`
        : `${capitalized(whenText(days))}${item.time ? ` um ${hm(item.time)}` : ""}${courseOf(item.subject)}${noteOf(item)}`,
    });
  }
  return reminders;
}

/* How many minutes before its start an event reminds, -1 for never. The Android reminders keep the same rules:
   - an event without a start time never reminds, so the calendar offers no choice for an all-day event;
   - an own event reminds as it says itself ("reminderMinutes", -1 for never), even with "Termine" off, because
     someone chose that for this one event; without a choice of its own it follows "Termine";
   - an event from Google follows "Termine": switched off it never reminds, switched on its own pop-up from
     Google counts (-1 when Google shows none), otherwise the lead time of the settings. */
export function eventMinutes(event, category) {
  if (!event.start) return -1;
  const lead = Number(category.lead) || CATEGORY_DEFAULTS.events.lead;
  if (event.synced) return category.on ? event.reminderMinutes ?? lead : -1;
  return event.reminderMinutes ?? (category.on ? lead : -1);
}

function eventReminders(prefs, day, minute) {
  const category = prefs.categories.events;
  const today = isoDate(day);
  const reminders = [];
  for (const event of expandEvents(data.events || [], today, isoDate(addDays(day, 28)))) {
    const ahead = dayDiff(day, event.date);
    const minutes = eventMinutes(event, category);
    if (ahead < 0 || minutes < 0 || !dueAt(minute, ahead * 1440 + toMin(event.start) - minutes)) continue;
    const when = ahead === 0 ? (minutes === 0 ? "Jetzt" : `Um ${hm(event.start)}`) : `${capitalized(whenText(ahead))} um ${hm(event.start)}`;
    reminders.push({ key: `event:${event.id}:${event.date}`, title: event.title, body: `${when}${event.place ? ` in ${event.place}` : ""}` });
  }
  return reminders;
}

function taskReminders(day, minute) {
  const today = isoDate(day);
  const open = (data.tasks || []).filter((task) => !task.done);
  const dueToday = open.filter((task) => !task.date || task.date === today);
  const overdue = open.filter((task) => task.date && task.date < today).sort((a, b) => a.date.localeCompare(b.date));
  const reminders = dueToday
    .filter((task) => task.dueTime && dueAt(minute, toMin(task.dueTime)))
    .map((task) => ({ key: `task:${task.id}:${today}`, title: task.title, body: `Fällig um ${task.dueTime}` }));
  const morning = [...overdue, ...dueToday.filter((task) => !task.dueTime)];
  if (morning.length && minute >= MORNING) {
    const count = `${morning.length} Aufgaben`;
    let title = morning.length === 1 ? "Heute fällig" : `${count} heute fällig`;
    if (overdue.length === morning.length) title = morning.length === 1 ? "Überfällig" : `${count} überfällig`;
    else if (overdue.length) title = `${count} für heute, ${overdue.length} davon überfällig`;
    reminders.push({ key: `tasks:${today}`, title, body: morning.slice(0, 3).map((task) => task.title).join(", ") });
  }
  return reminders;
}

function pomodoroReminders(date) {
  const ended = endNotice(readPomodoro(), date.getTime());
  if (!ended) return [];
  const key = `pomodoro:${ended.id}`;
  const url = "/hub/pomodoro";
  if (ended.phase === "break") return [{ key, url, title: "Pause vorbei", body: `Weiter mit der nächsten Runde, ${ended.next} Min.` }];
  const course = ended.subject && Object.hasOwn(data.subjects || {}, ended.subject) ? `${subject(ended.subject).label}, ` : "";
  return [{ key, url, title: "Arbeitsphase vorbei", body: `${course}${ended.minutes} Min. gearbeitet. Jetzt ${ended.next} Min. Pause.` }];
}

export function dueReminders(prefs, date) {
  const day = startOfDay(date);
  const minute = minutesOf(date);
  if (!prefs.enabled) return [];
  const timer = prefs.categories.pomodoro.on ? pomodoroReminders(date) : [];
  if (isQuiet(minute, prefs.quiet)) return timer;
  return [
    ...(prefs.categories.lessons.on ? lessonReminders(prefs, day, minute) : []),
    ...deadlineReminders(prefs, day),
    ...eventReminders(prefs, day, minute),
    ...(prefs.categories.tasks.on ? taskReminders(day, minute) : []),
    ...timer,
  ];
}

function claim(key, stamp) {
  let shown = {};
  try {
    shown = JSON.parse(localStorage.getItem(SHOWN_KEY)) || {};
  } catch {
    shown = {};
  }
  if (shown[key]) return false;
  const oldest = stamp - KEEP_DAYS * 864e5;
  for (const [known, at] of Object.entries(shown)) if (at < oldest) delete shown[known];
  shown[key] = stamp;
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
  } catch {
    return false;
  }
  return true;
}

function tick() {
  if (!data || Notification.permission !== "granted") return;
  const date = new Date();
  const prefs = readPrefs();
  const icon = document.querySelector('link[rel~="icon"]')?.href;
  for (const reminder of dueReminders(prefs, date)) {
    if (!claim(reminder.key, date.getTime())) continue;
    try {
      const notice = new Notification(reminder.title, { body: reminder.body, icon, tag: reminder.key, silent: !prefs.sound });
      if (reminder.url) {
        notice.onclick = () => {
          window.focus();
          notice.close();
          if (location.pathname !== reminder.url) location.assign(reminder.url);
        };
      }
    } catch {}
  }
}

export function initReminders() {
  adoptDefault();
  if (!("Notification" in window) || !data) return;
  window.addEventListener("app:note", (event) => {
    if (event.detail?.type === "homework") askAtFirstEntry();
  });
  tick();
  setInterval(tick, TICK);
  subscribe((event) => {
    if (event.type === "end") tick();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });
}
