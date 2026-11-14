import { data, flags, icon, esc, safeMarkup, root, subject, hueVar, now, addDays, startOfDay, isoDate, parseDate, shortDate, dayDiff, clock, minutesOf, pinnedTime, platform, storage, homeworkDate, stretchOf, BRAND, periodWords, blockOf, toMin, hm, WEEKDAYS } from "./core.js";
import { animates, travels, rich } from "./motion.js";
import { tasks as taskApi, deadlines as deadlineApi, notes as noteApi, events as eventApi } from "./api.js";
import { normalizeRecurrence, ruleText } from "./recurrence.js";
import { switchRemindersOn } from "./reminders.js";

const $ = (id) => document.getElementById(id);

const pageNames = {
  home: "Übersicht", tasks: "Aufgaben", calendar: "Kalender", school: "Schule", vbb: "Fahrplan", email: "E-Mail",
  assistant: "Assistent", pomodoro: "Pomodoro", bookmarks: "Lesezeichen", settings: "Einstellungen",
};

const pageIcons = {
  home: "house", tasks: "list-checks", calendar: "calendar-days", school: "graduation-cap", vbb: "train-front", email: "mail",
  assistant: "message-circle", pomodoro: "timer", bookmarks: "bookmark", settings: "settings",
};

const keyGlyphs = {
  mod: platform.mac ? { svg: "command", label: "Befehlstaste" } : { text: "Strg" },
  shift: platform.mac ? { svg: "arrow-big-up", label: "Umschalttaste" } : { text: "Umschalt" },
  enter: platform.mac ? { svg: "corner-down-left", label: "Eingabetaste" } : { text: "Enter" },
  alt: platform.mac ? { text: "⌥" } : { text: "Alt" },
};

export const modWord = platform.mac ? "⌘" : "Strg+";

function renderKeys(scope = document) {
  scope.querySelectorAll("kbd[data-key]").forEach((node) => {
    const glyph = keyGlyphs[node.dataset.key];
    if (!glyph) return;
    if (glyph.svg) {
      node.innerHTML = icon(glyph.svg);
      node.setAttribute("aria-label", glyph.label);
    } else {
      node.textContent = glyph.text;
    }
  });
  document.querySelectorAll("[data-electron-only]").forEach((node) => (node.hidden = !platform.electron));
}

export const shortcutsEnabled = () => storage.get("app-single-keys") !== false;

function syncShortcutToggle() {
  const toggle = $("singleKeys");
  if (toggle) toggle.checked = shortcutsEnabled();
  document.querySelectorAll("[data-single-key]").forEach((node) => node.classList.toggle("is-off", !shortcutsEnabled()));
}

$("singleKeys")?.addEventListener("change", (event) => {
  storage.set("app-single-keys", event.target.checked);
  syncShortcutToggle();
});

let undoAction = null;
let undoTimer;

function setUndo(run) {
  undoAction = run;
  clearTimeout(undoTimer);
  if (run) undoTimer = setTimeout(() => (undoAction = null), 60000);
}

function toastArea() {
  const host = $("toasts");
  if (!host || !host.children.length) return null;
  return host.getBoundingClientRect();
}

function syncToastSpace() {
  const area = toastArea();
  root.style.setProperty("--toast-space", area ? `${Math.ceil(area.height) + 16}px` : "0px");
}

export function keepFocusClear(target = document.activeElement) {
  const area = toastArea();
  if (!area || !target || target === document.body || target.closest?.(".toast") || !target.matches?.(":focus-visible")) return;
  const box = target.getBoundingClientRect();
  const crosses = box.right > area.left && box.left < area.right && box.bottom > area.top - 8 && box.top < area.bottom;
  if (crosses) scrollBy({ top: box.bottom - area.top + 16, behavior: travels() ? "smooth" : "auto" });
}

document.addEventListener("focusin", (event) => requestAnimationFrame(() => keepFocusClear(event.target)));

function runUndo() {
  if (!undoAction) return false;
  const run = undoAction;
  setUndo(null);
  run();
  return true;
}

export function toast(message, options = {}) {
  const host = $("toasts");
  const node = document.createElement("div");
  node.className = "toast";
  node.setAttribute("role", "status");
  node.innerHTML = `${icon(options.icon || "check")}<span class="toast-text"></span>`;
  node.querySelector(".toast-text").append(safeMarkup(message));
  const hold = options.action ? 10000 : options.duration || 5000;
  const action = options.action;
  let used = false;
  const run = () => {
    if (used) return;
    used = true;
    if (undoAction === run) setUndo(null);
    action.run();
    dismiss();
  };
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.innerHTML = `${esc(action.label)}${action.undo ? `<span class="toast-key" aria-hidden="true">${modWord}Z</span>` : ""}`;
    if (action.undo) button.setAttribute("aria-keyshortcuts", platform.mac ? "Meta+Z" : "Control+Z");
    button.addEventListener("click", run);
    node.append(button);
    setUndo(action.undo ? run : null);
  }
  host.replaceChildren(node);
  syncToastSpace();
  requestAnimationFrame(() => keepFocusClear());
  let timer = setTimeout(dismiss, hold);
  let inside = 0;
  const pause = () => {
    inside += 1;
    clearTimeout(timer);
  };
  const resume = () => {
    inside = Math.max(0, inside - 1);
    if (!inside) timer = setTimeout(dismiss, hold);
  };
  node.addEventListener("pointerenter", pause);
  node.addEventListener("pointerleave", resume);
  node.addEventListener("focusin", pause);
  node.addEventListener("focusout", resume);
  function dismiss() {
    clearTimeout(timer);
    if (!node.isConnected) return;
    if (undoAction === run) setUndo(null);
    const hadFocus = node.contains(document.activeElement);
    const finish = () => {
      node.remove();
      syncToastSpace();
      if (hadFocus) options.returnFocus?.();
    };
    if (!animates()) {
      finish();
      return;
    }
    node.classList.add("is-leaving");
    node.addEventListener("animationend", finish, { once: true });
  }
  return { node, dismiss };
}

const ROUTES = { home: "/hub", tasks: "/hub/tasks", calendar: "/hub/calendar", school: "/hub/school", vbb: "/hub/vbb", email: "/hub/email", bookmarks: "/hub/bookmarks", settings: "/hub/settings" };
const CARRIED = ["variante", "theme", "datum", "t", "clean"];

export function pageUrl(page, href = ROUTES[page]) {
  const url = new URL(href, location.href);
  const current = new URLSearchParams(location.search);
  CARRIED.forEach((key) => {
    if (current.has(key) && !url.searchParams.has(key)) url.searchParams.set(key, current.get(key));
  });
  return `${url.pathname}${url.search}${url.hash}`;
}

export function openPage(page, href) {
  location.assign(ROUTES[page] ? pageUrl(page, href || ROUTES[page]) : `/hub/${page}`);
}

const tooltip = $("tooltip");
let tooltipWarm = false;
let warmTimer;
let showTimer;
let hideTimer;
let tipTarget = null;

function placeTip(target) {
  tooltip.replaceChildren(safeMarkup(target.dataset.tip));
  tooltip.classList.toggle("on-hero", !!target.closest(".today:not(.is-desk)"));
  const box = target.getBoundingClientRect();
  const width = tooltip.offsetWidth;
  const left = Math.min(Math.max(12, box.left + box.width / 2 - width / 2), innerWidth - width - 12);
  const above = box.top - tooltip.offsetHeight - 8;
  const below = box.bottom + 8;
  const preferBelow = target.dataset.tipSide === "below" && below + tooltip.offsetHeight < innerHeight - 8;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${preferBelow || above <= 8 ? below : above}px`;
}

function showTip(target, instant = false) {
  if (!target?.dataset.tip) return;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  const reveal = () => {
    tipTarget = target;
    tooltip.classList.toggle("is-instant", tooltipWarm || instant);
    placeTip(target);
    tooltip.classList.add("is-on");
    tooltipWarm = true;
    clearTimeout(warmTimer);
  };
  if (tooltipWarm || instant) reveal();
  else showTimer = setTimeout(reveal, 450);
}

function hideTip(delay = 0) {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  const hide = () => {
    tooltip.classList.remove("is-on");
    tipTarget = null;
    clearTimeout(warmTimer);
    warmTimer = setTimeout(() => (tooltipWarm = false), 600);
  };
  if (delay) hideTimer = setTimeout(hide, delay);
  else hide();
}

document.addEventListener("pointerover", (event) => {
  if (event.pointerType === "touch") return;
  const target = event.target.closest("[data-tip]");
  if (target && target !== tipTarget) showTip(target);
});
document.addEventListener("pointerout", (event) => {
  const from = event.target.closest("[data-tip]");
  if (!from) return;
  const to = event.relatedTarget;
  if (to && (from.contains(to) || tooltip.contains(to))) return;
  hideTip(120);
});
tooltip?.addEventListener("pointerenter", () => clearTimeout(hideTimer));
tooltip?.addEventListener("pointerleave", (event) => {
  if (tipTarget && tipTarget.contains(event.relatedTarget)) return;
  hideTip(120);
});
document.addEventListener("focusin", (event) => {
  const target = event.target.closest?.("[data-tip]");
  if (target && event.target.matches(":focus-visible")) showTip(target, true);
});
document.addEventListener("focusout", (event) => {
  if (event.target.closest?.("[data-tip]")) hideTip();
});
addEventListener("scroll", () => tooltip.classList.contains("is-on") && hideTip(), { passive: true });

const nav = $("nav");
const indicator = $("navIndicator");
const more = $("navMore");
const drawer = $("navDrawer");

function placeIndicator(instant = false) {
  if (!nav || !indicator) return;
  const sidebar = indicator.parentElement;
  const active = sidebar.querySelector('.nav-item[aria-current="page"]');
  if (!active || !sidebar.offsetWidth) {
    indicator.style.opacity = "0";
    return;
  }
  const hiddenInDrawer = drawer.contains(active) && drawer.hidden;
  const anchor = hiddenInDrawer ? more : active;
  const box = anchor.getBoundingClientRect();
  const frame = sidebar.getBoundingClientRect();
  indicator.classList.toggle("is-instant", instant || !travels());
  indicator.style.opacity = "1";
  indicator.style.setProperty("--indicator-x", `${box.left - frame.left - sidebar.clientLeft}px`);
  indicator.style.setProperty("--indicator-y", `${box.top - frame.top - sidebar.clientTop + sidebar.scrollTop}px`);
  indicator.style.width = `${box.width}px`;
  indicator.style.height = `${box.height}px`;
  if (instant) requestAnimationFrame(() => indicator.classList.remove("is-instant"));
}

function setDrawer(open) {
  more.setAttribute("aria-expanded", String(open));
  drawer.hidden = !open;
  if (open && rich() && travels()) {
    [...drawer.children].forEach((node, index) => node.style.setProperty("--i", index));
    drawer.classList.add("is-entering");
    setTimeout(() => drawer.classList.remove("is-entering"), 600);
  }
  placeIndicator(true);
}

more?.addEventListener("click", () => setDrawer(more.getAttribute("aria-expanded") !== "true"));

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-page]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const page = link.dataset.page;
  const sheet = link.closest("[popover]");
  if (ROUTES[page]) {
    event.preventDefault();
    const own = new URL(link.href, location.href);
    const target = pageUrl(page, own.pathname === ROUTES[page] ? `${own.pathname}${own.search}${own.hash}` : ROUTES[page]);
    if (sheet?.matches(":popover-open")) sheet.hidePopover();
    if (target === `${location.pathname}${location.search}${location.hash}`) return;
    location.assign(target);
    return;
  }
  event.preventDefault();
  if (sheet?.matches(":popover-open")) sheet.hidePopover();
  location.assign(`/hub/${page}`);
});

function renderCounts() {
  const counts = { mail: flags.empty ? 0 : data.mailUnread };
  document.querySelectorAll("[data-count]").forEach((node) => {
    const value = counts[node.dataset.count];
    node.textContent = value || "";
    if (value) node.setAttribute("aria-label", `${value} ungelesen`);
    else node.removeAttribute("aria-label");
  });
}

// IServ counts first: the school data comes from there. Google only shows when IServ has not synced.
export const syncSource = () => (data?.status?.iserv && data.status.synced?.iserv ? "iserv" : data?.status?.synced?.google ? "google" : null);

// When the shown data is from: the last sync of a connected source, or offline the time this copy of the page was made.
// "7:36", "gestern, 7:36" or "Do., 5.11. 7:36", and empty while nothing has synced.
export function syncTime(source = syncSource()) {
  const stamp = flags.offline ? data?.status?.rendered : source ? data.status.synced?.[source] : null;
  const date = stamp ? new Date(stamp) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  if (pinnedTime()) return clock(Math.max(0, minutesOf(now()) - 4));
  const time = clock(minutesOf(date));
  const diff = dayDiff(now(), isoDate(date));
  return diff === 0 ? time : diff === -1 ? `gestern, ${time}` : `${shortDate(date)} ${time}`;
}

export function renderSync() {
  const source = syncSource();
  const time = syncTime(source);
  const text = flags.offline ? (time ? `Offline, Stand ${time} Uhr` : "Offline") : time ? `${source === "google" ? "Google" : "IServ"}, Stand ${time} Uhr` : "";
  const line = $("syncLine");
  if (line) {
    line.hidden = !text;
    line.classList.toggle("is-offline", flags.offline);
    line.querySelector("span").textContent = text;
    line.querySelector("use").setAttribute("href", flags.offline ? "#i-wifi-off" : "#i-refresh-cw");
  }
  document.querySelectorAll("[data-sync-mirror]").forEach((node) => {
    node.hidden = !text;
    node.classList.toggle("is-offline", flags.offline);
    node.querySelector("span").textContent = text;
  });
  const head = $("headSync");
  if (head) {
    head.textContent = flags.offline ? (time ? `offline, Stand ${time}` : "offline") : time ? `Stand ${time}` : "";
    head.classList.toggle("is-offline", flags.offline);
  }
  if (flags.offline) {
    const alert = $("headAlert");
    if (alert) {
      alert.hidden = false;
      $("headAlertText").textContent = `Keine Verbindung zu ${BRAND}. ${time ? `Das ist die Übersicht vom Stand ${time} Uhr. ` : ""}Änderungen lassen sich gerade nicht speichern.`;
    }
  }
}

const notifyWords = {
  off: "Erinnerungen aktivieren",
  on: "Erinnerungen an",
  blocked: "Erinnerungen blockiert",
  unsupported: "Erinnerungen nicht verfügbar",
};

function notifyState() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "on";
  if (Notification.permission === "denied") return "blocked";
  return "off";
}

function renderNotify() {
  const state = notifyState();
  document.querySelectorAll("[data-notify]").forEach((button) => {
    button.querySelector("[data-notify-text]").textContent = notifyWords[state];
    button.hidden = state !== "off";
  });
}

document.querySelectorAll("[data-notify]").forEach((button) =>
  button.addEventListener("click", async () => {
    if (notifyState() !== "off") return;
    await Notification.requestPermission();
    renderNotify();
    if (notifyState() !== "on") return;
    switchRemindersOn();
    toast(`Erinnerungen sind an. ${BRAND} meldet sich vor Tests und Abgaben.`, { icon: "bell" });
  }),
);

let lastInvoker = null;
let byFinger = false;
const invokerSelector = "[popovertarget], [data-open-note], [data-open-weather]";
const pressable = "a, button, summary, label, [role='button'], [role='option'], [role='tab'], [role='switch']";
document.addEventListener("pointerdown", (event) => {
  byFinger = event.pointerType !== "mouse";
  const trigger = event.target.closest(invokerSelector);
  if (trigger) lastInvoker = trigger;
});
document.addEventListener("touchstart", () => {}, { passive: true });
document.addEventListener("click", (event) => {
  if (!byFinger || !event.target.closest) return;
  const pressed = [event.target.closest(pressable), event.target.closest(".is-interactive")]
    .filter((node) => node && !node.matches(":disabled, [aria-disabled='true']"));
  pressed.forEach((node) => node.classList.add("is-pressed"));
  setTimeout(() => pressed.forEach((node) => node.classList.remove("is-pressed")), 180);
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const trigger = event.target.closest?.(invokerSelector);
  if (trigger) lastInvoker = trigger;
});

function onScreen(node) {
  if (!node || !node.offsetParent) return false;
  const box = node.getBoundingClientRect();
  return box.width > 0 && box.bottom > 0 && box.top < innerHeight;
}

export function placeNear(sheet, source, align = "right") {
  if (!source || !onScreen(source)) {
    sheet.style.top = "20px";
    sheet.style.right = "20px";
    sheet.style.left = "auto";
    return;
  }
  const box = source.getBoundingClientRect();
  sheet.style.top = `${Math.round(box.bottom + 8)}px`;
  if (align === "right") {
    sheet.style.right = `${Math.max(12, Math.round(innerWidth - box.right))}px`;
    sheet.style.left = "auto";
  } else {
    // A sheet about to open has no layout yet, but its width as styled keeps its right edge on a narrow screen.
    const width = sheet.offsetWidth || parseFloat(getComputedStyle(sheet).width) || 0;
    sheet.style.left = `${Math.max(12, Math.min(Math.round(box.left), innerWidth - width - 12))}px`;
    sheet.style.right = "auto";
  }
}

export function clampSheet(sheet) {
  const top = parseFloat(sheet.style.top) || 20;
  const limit = innerHeight - sheet.offsetHeight - 12;
  if (top > limit) sheet.style.top = `${Math.max(12, Math.round(limit))}px`;
}

const noteSheet = $("noteSheet");
const noteForm = $("noteForm");
const noteInput = $("noteInput");
const noteChips = $("noteChips");
const notePreview = $("notePreview");
const noteSave = $("noteSave");
const segmented = noteForm?.querySelector(".segmented");
let typeTouched = false;
let parsed = { phrases: {} };
let dismissed = new Set();
let lastRecognized = null;

export function openNote({ instant = false, source = null } = {}) {
  if (!noteSheet) return;
  lastInvoker = source || lastInvoker;
  noteSheet.classList.toggle("is-instant", instant);
  if (noteSheet.matches(":popover-open")) {
    noteInput.focus();
    return;
  }
  noteSheet.showPopover();
}

document.querySelectorAll("[data-open-note]").forEach((button) =>
  button.addEventListener("click", () => openNote({ source: button })),
);

noteSheet?.addEventListener("beforetoggle", (event) => {
  if (event.newState !== "open") return;
  const source = [lastInvoker?.closest?.("[data-open-note]"), $("noteButton"), document.querySelector(".topbar [data-open-note]")].find(onScreen);
  placeNear(noteSheet, source, "right");
  noteForm.reset();
  typeTouched = false;
  parsed = { phrases: {} };
  dismissed = new Set();
  lastRecognized = null;
  noteChips.replaceChildren();
  noteChips.dataset.markup = "";
  notePreview.hidden = true;
  syncType();
  noteSave.disabled = true;
});

noteSheet?.addEventListener("toggle", (event) => {
  if (event.newState === "open") {
    segmented.classList.add("is-still");
    syncType();
    requestAnimationFrame(() => segmented.classList.remove("is-still"));
    clampSheet(noteSheet);
    noteInput.focus();
  } else {
    noteSheet.classList.remove("is-instant");
  }
});

const noteType = () => noteForm.querySelector("input[name='type']:checked")?.value || "task";

// The labels differ in length, so the thumb takes the place and width of the chosen one.
function syncType() {
  const label = noteForm.querySelector("input[name='type']:checked")?.closest("label");
  if (!label || !segmented.offsetWidth) return;
  segmented.style.setProperty("--seg-x", `${label.offsetLeft - 3}px`);
  segmented.style.setProperty("--seg-w", `${label.offsetWidth}px`);
}

function pickType(type) {
  const target = noteForm.querySelector(`input[name='type'][value='${type}']`);
  if (!target || target.checked) return;
  target.checked = true;
  syncType();
}

noteForm?.addEventListener("change", (event) => {
  if (event.target.name === "type") {
    typeTouched = true;
    syncType();
    renderChips();
  }
});

const SUBJECT_SYNONYMS = [
  ["mathe", "mathematik"], ["geo", "geografie", "geographie", "erdkunde"], ["pb", "politik", "politische bildung"],
  ["psycho", "psychologie"], ["bio", "biologie"], ["info", "informatik"], ["reli", "religion"], ["franz", "französisch"],
  ["englisch", "english"], ["wat", "wirtschaft"], ["seminarkurs", "seminararbeit", "seminar"], ["deutsch"], ["physik"],
  ["chemie"], ["geschichte"], ["musik"], ["kunst"], ["sport"], ["latein"], ["spanisch"], ["ethik"],
];

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function subjectAliases() {
  const list = [];
  Object.entries(data?.subjects || {}).forEach(([key, info]) => {
    if (info.retired) return;
    const plain = (text) => String(text || "").replace(/\s+(LK|GK|SK)$/i, "").trim().toLowerCase();
    const base = plain(info.name);
    const words = new Set([base, plain(info.label), plain(info.short)].filter((word) => word.length >= 2));
    SUBJECT_SYNONYMS.forEach((group) => {
      if (group.some((word) => words.has(word) || base.startsWith(word))) group.forEach((word) => words.add(word));
    });
    words.forEach((word) => list.push([new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(word)}(?![\\p{L}\\p{N}])`, "iu"), key, word.length]));
  });
  return list.sort((a, b) => b[2] - a[2]);
}

const DAY_NAMES = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
const DAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const DAY_ANY = `(?:${DAY_NAMES.join("|")}|${DAY_SHORT.join("|")})`;
const MONTH_WORDS = "januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember";
const PARTS = "abends?|nachmittags?|vormittags?|mittags?|morgens?|nachts?|früh";
// "morgen" is left out here: "So, morgen ..." names no day.
const DAYTIME = "abends?|nachmittags?|vormittags?|mittags?|morgens|nachts?|früh";
const DAY_WORD = new RegExp(`(?<![\\p{L}\\p{N}.\\-–/])(${DAY_NAMES.join("|")}|${DAY_SHORT.join("|")})(?![\\p{L}\\p{N}\\-])`, "giu");
const DAY_LEADS = /(?<![\p{L}\p{N}])((?:(?:am|bis|zum|ab|für|den|nächsten|kommenden|diesen|übernächsten|spätestens)\s+)+)$/iu;
const DAY_NOT_AFTER = /(?<![\p{L}\p{N}])(?:von|vom|seit|über|letzte[nmrs]?|vergangene[nmrs]?|jeden|jedem|herr|frau|hr\.|fr\.|dr\.|prof\.)\s*$/iu;
const DAY_RANGE = new RegExp(`^\\s+bis\\s+(?:(?:zum|einschließlich)\\s+)?${DAY_ANY}(?![\\p{L}])`, "iu");
const DAY_LIST = /^\s*[-–/]\s*(?:mo|di|mi|do|fr|sa|so)(?![\p{L}])/iu;
const LIST_AFTER = new RegExp(`^\\.?(?:\\s*(?:,|&|und|oder)\\s*|\\s+)(${DAY_ANY})(?![\\p{L}])`, "iu");
const LIST_BEFORE = new RegExp(`(?<![\\p{L}])(${DAY_ANY})\\.?(?:\\s*(?:,|&|und|oder)\\s*|\\s+)$`, "iu");
const WITH_BEFORE = /(?<![\p{L}])mit\s+(?:\p{L}[\p{L}.\-]*\s*(?:,|&|und)\s*)*$/iu;
const PART_AFTER = new RegExp(`^\\s+(${PARTS})(?![\\p{L}])`, "iu");
const DAYTIME_AFTER = new RegExp(`^\\s+(?:${DAYTIME})(?![\\p{L}])`, "iu");
const ANY_DAYTIME = new RegExp(`(?<![\\p{L}])(?:${DAYTIME})(?![\\p{L}])`, "iu");
const ANY_CLOCK = /(?<![\p{N}.:])(?:(?:[01]?\d|2[0-3]):[0-5]\d|(?:[01]?\d|2[0-3])(?:\.[0-5]\d)?\s*uhr(?![\p{L}]))|(?<![\p{L}])(?:um|ab|gegen)\s+(?:[01]?\d|2[0-3])(?![\p{N}])/iu;
const SO_WORD = /^\s+(?:viel|wie|lange|dass|ein|eine|einen|einem|einer|gut|oft|sehr|schnell|spät|bald|früh|weit)(?![\p{L}])/u;
const WEEK_BEFORE = /(?<![\p{L}\p{N}])((?:in\s+)?(?:der\s+)?(nächste[nr]?|kommende[nr]?|übernächste[nr]?|diese[nr]?)\s+woche\s+(?:am\s+)?)$/iu;
const WEEK_AFTER = /^\s+(?:(?:in\s+)?der\s+)?(nächste[nr]?|kommende[nr]?|übernächste[nr]?)\s+woche(?![\p{L}])/iu;
const WEEKS_AHEAD = /^\s+in\s+(\S+)\s+wochen?(?![\p{L}])/iu;
const WEEK_COUNTS = { einer: 1, 1: 1, zwei: 2, 2: 2, drei: 3, 3: 3, vier: 4, 4: 4 };
const DATE_AFTER = new RegExp(`^\\s*[,(–-]?\\s*(?:de[nmr]\\s+)?\\d{1,2}\\.\\s?(?:\\d{1,2}\\.|(?:${MONTH_WORDS})(?![\\p{L}]))`, "iu");
const CLOCK_BEFORE = /(?:\d|uhr|früh|morgens|vormittags|mittags|nachmittags|abends|nachts)\s*[,.]?\s*$/iu;
const RELATIVE = new RegExp(`(?<![\\p{L}\\p{N}])((?:(?:bis|für|am|ab)\\s+)?)(übermorgen|morgen|heute)(?:\\s+(${PARTS}))?(?![\\p{L}\\p{N}])`, "giu");
const NOT_TOMORROW_AFTER = new RegExp(`(?<![\\p{L}\\p{N}])(?:am|jeden|jedem|guten|gestern|heute|frühen|nächsten|das|der|den|dem|diesen|diesem|einen|einem|${DAY_NAMES.join("|")}|${DAY_SHORT.join("|")}\\.?)\\s+$`, "iu");

const DAY_BEFORE_DATE = new RegExp(`(?<![\\p{L}\\p{N}])(?:(?:bis|am|zum|ab)\\s+)?(${DAY_NAMES.join("|")}|${DAY_SHORT.join("|")})\\.?\\s*,?\\s*(?:de[nm]\\s+)?$`, "iu");
const DAY_AFTER_DATE = new RegExp(`^\\s*(?:\\(\\s*(?:${DAY_NAMES.join("|")})\\s*\\)|,\\s*(?:${DAY_NAMES.join("|")})(?=\\s*(?:$|[,.;!?]|(?:um|ab|gegen)(?![\\p{L}])|\\d)))`, "iu");
const weekShift = (word) => (/^über/i.test(word) ? 2 : /^diese/i.test(word) ? 0 : 1);
const nextOf = (base, dow) => (dow - base.getDay() + 7) % 7 || 7;

const isDay = (word) => word.length > 2 || DAY_SHORT.includes(word);

function listed(before, after) {
  const next = after.match(LIST_AFTER);
  const previous = before.match(LIST_BEFORE);
  return (next && isDay(next[1])) || (previous && isDay(previous[1]));
}

/* A wrong day is worse than none. Days in a list ("Mo, Mi und Fr") name a rhythm, so none of them counts. A short
   name without "am" or "bis" counts only as written ("Do"), not after "mit", not in front of a name ("Fr. Müller"),
   and at the start of a sentence only with a dot, a time or a time of day and without a comma behind it ("So, ..."
   and "So ein Tag", where "So" is the adverb, stay text). The assistant reads days by the same rules (spoken_time.py). */
function shortDay(word, text, before, after, dotted, range) {
  if (word !== `${word[0].toUpperCase()}${word[1].toLowerCase()}` || WITH_BEFORE.test(before)) return false;
  const opening = !before.trim();
  if (opening && word === "So" && !dotted && SO_WORD.test(after)) return false;
  if (DAYTIME_AFTER.test(after)) return true;
  const named = /^\s*[,.]?\s*\p{Lu}/u.test(after);
  if (!opening) return !named || (word !== "Fr" && CLOCK_BEFORE.test(before));
  if (/^\s*,/.test(after) || (named && word === "Fr")) return false;
  return dotted || !!range || ANY_CLOCK.test(text) || ANY_DAYTIME.test(text);
}

function weekdayOf(text, base) {
  const found = [];
  let covered = -1;
  for (const match of text.matchAll(DAY_WORD)) {
    if (match.index < covered) continue;
    const word = match[1];
    const short = word.length === 2;
    const dotted = short && text[match.index + 2] === ".";
    let start = match.index;
    let end = start + word.length + (dotted ? 1 : 0);
    const before = text.slice(0, start);
    const after = text.slice(end);
    const lead = before.match(DAY_LEADS);
    const leadWords = lead ? lead[1].trim().toLowerCase().split(/\s+/) : [];
    const content = before.slice(0, lead ? lead.index : start).match(DAY_NOT_AFTER);
    const range = leadWords.includes("für") || (content && (leadWords.length || !/^von\s*$/i.test(content[0]))) ? null : after.match(DAY_RANGE);
    if (content && !range) continue;
    if (DAY_LIST.test(after) || /[-–/]\s*$/.test(before) || DATE_AFTER.test(after) || listed(before, after)) continue;
    if (short && !leadWords.some((item) => ["am", "bis", "zum", "ab", "spätestens"].includes(item)) && !shortDay(word, text, before, after, dotted, range)) continue;
    const dow = short ? DAY_SHORT.indexOf(`${word[0].toUpperCase()}${word[1].toLowerCase()}`) : DAY_NAMES.indexOf(word.toLowerCase());
    if (content) start = content.index;
    else if (lead) start = lead.index;
    const weekBefore = text.slice(0, start).match(WEEK_BEFORE);
    const weekAfter = range ? null : after.match(WEEK_AFTER);
    const weeks = range || weekAfter ? null : after.match(WEEKS_AHEAD);
    let date;
    if (weekBefore || weekAfter) {
      const monday = addDays(base, 1 - (base.getDay() || 7) + 7 * weekShift((weekBefore || weekAfter)[weekBefore ? 2 : 1]));
      date = addDays(monday, (dow + 6) % 7);
      if (date < base) continue;
      if (weekBefore) start = weekBefore.index;
      if (weekAfter) end += weekAfter[0].length;
    } else if (weeks) {
      if (!WEEK_COUNTS[weeks[1].toLowerCase()]) continue;
      date = addDays(base, ((dow - base.getDay() + 7) % 7) + 7 * WEEK_COUNTS[weeks[1].toLowerCase()]);
      end += weeks[0].length;
    } else {
      date = addDays(base, nextOf(base, dow) + (leadWords.includes("übernächsten") ? 7 : 0));
    }
    if (range) {
      end += range[0].length;
      covered = end;
    }
    const part = text.slice(end).match(PART_AFTER);
    if (part) end += part[0].length;
    const rank = range ? 2 : leadWords.includes("bis") || leadWords.includes("spätestens") ? 0 : leadWords.includes("für") ? 3 : 2;
    found.push({ date, start, end, rank, part: part ? part[1].toLowerCase() : null });
  }
  return found.sort((a, b) => a.rank - b.rank || a.start - b.start)[0] || null;
}

const STRETCH = /(?<![\p{L}\p{N}.])(?:(?:vom|von)\s+)?(?<d1>\d{1,2})\.(?:(?<m1>\d{1,2})\.(?<y1>\d{2,4})?)?\s*(?<tail>(?:bis(?:\s+zum)?|-|–)\s*(?<d2>\d{1,2})\.(?<m2>\d{1,2})\.(?<y2>\d{2,4})?)(?!\d)/iu;
const DATED_THING = /(?:protokoll|mitschrift|notizen|hefteintrag|tafelbild|blatt|hausaufgaben?|aufgaben?|übung(?:en)?|zusammenfassung|brief|mail|nachricht|rechnung|quelle|text|artikel|zeitung|bericht|aufsatz|test|klausur|arbeit|stunde|unterricht|sitzung|besprechung|vortrag|präsentation|folien|video|aufnahme|fotos?|stoff)\s*$/i;

export function parseNote(text) {
  const result = { phrases: {} };
  const clean = text.replace(/\b(S\.|Seite|Nr\.|Nummer|Aufgabe|Aufg\.|Unit|Kapitel)\s*\d+[a-z]?(\s*(f\.|ff\.|bis\s*\d+(?!\d|\.\d)))?/gi, (match) => " ".repeat(match.length));
  for (const [pattern, key] of subjectAliases()) {
    if (data?.subjects?.[key] && !data.subjects[key].retired && pattern.test(clean)) {
      result.subject = key;
      break;
    }
  }
  const base = startOfDay(now());
  let date = null;
  let phrase = null;
  const relative = [...clean.matchAll(RELATIVE)].find((match) => match[2].toLowerCase() !== "morgen" || !NOT_TOMORROW_AFTER.test(clean.slice(0, match.index + match[1].length)));
  if (relative) {
    const word = relative[2].toLowerCase();
    date = addDays(base, word === "übermorgen" ? 2 : word === "morgen" ? 1 : 0);
    phrase = relative[0];
    if (relative[3]) result.part = relative[3].toLowerCase();
  }
  const inDaysMatch = clean.match(/\b(?:bis\s+)?in\s+(\d{1,2})\s+tag(?:en)?\b/i);
  if (!date && inDaysMatch) {
    date = addDays(base, Number(inDaysMatch[1]));
    phrase = inDaysMatch[0];
  }
  const stretch = clean.match(STRETCH);
  if (!date && stretch) {
    const last = [Number(stretch.groups.d2), Number(stretch.groups.m2) - 1];
    const first = [Number(stretch.groups.d1), stretch.groups.m1 ? Number(stretch.groups.m1) - 1 : last[1]];
    const found = stretchOf(first, last, base, stretch.groups.y1 || stretch.groups.y2 ? Number(stretch.groups.y1 || stretch.groups.y2) : null);
    if (found && found.begun && DATED_THING.test(clean.slice(0, stretch.index))) {
      date = found.end;
      phrase = stretch.groups.tail.trim();
    } else if (found) {
      date = found.date;
      phrase = stretch[0];
    }
  }
  const explicit = clean.match(/\b(?:(?:bis|am|zum|ab)\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?!\d)/i);
  if (!date && explicit) {
    const day = Number(explicit[1]);
    const month = Number(explicit[2]) - 1;
    let year = explicit[3] ? Number(explicit[3]) : base.getFullYear();
    if (year < 100) year += 2000;
    const candidate = new Date(year, month, day);
    if (candidate.getMonth() === month && day >= 1) {
      date = candidate < base && !explicit[3] ? new Date(year + 1, month, day) : candidate;
      const end = explicit.index + explicit[0].length;
      const named = clean.slice(0, explicit.index).match(DAY_BEFORE_DATE);
      const start = named && (named[1].length > 2 || /^[A-Z][a-z]$/.test(named[1]) || named[0].trim().split(/\s+/).length > 1) ? named.index : explicit.index;
      phrase = clean.slice(start, end + (clean.slice(end).match(DAY_AFTER_DATE)?.[0].length || 0));
    }
  }
  if (!date) {
    const weekday = weekdayOf(clean, base);
    if (weekday) {
      date = weekday.date;
      phrase = clean.slice(weekday.start, weekday.end);
      if (weekday.part) result.part = weekday.part;
    }
  }
  const nextWeek = clean.match(/\b(?:bis\s+)?nächste(?:n)?\s+woche\b/i);
  if (!date && nextWeek) {
    date = addDays(base, 8 - (base.getDay() || 7));
    phrase = nextWeek[0];
  }
  if (date) {
    result.date = isoDate(date);
    result.phrases.date = phrase;
  }
  const block = clean.match(/\b(?:(?:im|zum|vor dem|bis zum)\s+)?([1-4])\.\s*block\b/i);
  if (block) {
    result.block = Number(block[1]);
    result.phrases.block = block[0];
  }
  const leadingType = clean.match(/^\s*(hausaufgabe|ha|hausi)\b:?/i);
  if (leadingType || /\b(hausaufgabe|hausi)\b/i.test(clean)) {
    result.type = "homework";
    if (leadingType) result.phrases.type = leadingType[0].trim();
  } else if (/^\s*idee\b/i.test(clean)) {
    result.type = "idea";
    result.phrases.type = clean.match(/^\s*idee\b:?/i)[0].trim();
  }
  return result;
}

function effective() {
  const result = { ...parsed, phrases: { ...parsed.phrases } };
  ["subject", "date", "block"].forEach((kind) => {
    if (!dismissed.has(kind)) return;
    delete result[kind];
    delete result.phrases[kind];
  });
  return result;
}

const WORDLY = /[\p{L}\p{N}]/u;

// The first place that is not inside a longer word, so "Do" is never cut out of "Dosenpfand".
export function phraseAt(text, phrase) {
  const low = text.toLowerCase();
  const wanted = phrase.toLowerCase();
  const first = low.indexOf(wanted);
  for (let index = first; index >= 0; index = low.indexOf(wanted, index + 1)) {
    const glued = (WORDLY.test(phrase[0]) && WORDLY.test(text[index - 1] || "")) || (WORDLY.test(phrase[phrase.length - 1]) && WORDLY.test(text[index + phrase.length] || ""));
    if (!glued) return index;
  }
  return first;
}

export function cleanTitle(text, info) {
  let title = text;
  ["date", "block", "type"].forEach((kind) => {
    const phrase = info.phrases?.[kind];
    if (!phrase) return;
    const index = phraseAt(title, phrase);
    if (index >= 0) title = `${title.slice(0, index)} ${title.slice(index + phrase.length)}`;
  });
  return title.replace(/\s{2,}/g, " ").replace(/^[\s,:;-]+|[\s,:;-]+$/g, "").trim() || text.trim();
}

const PAGE_NOISE = /\b(S\.|Seite|Nr\.|Nummer|Aufgabe|Aufg\.|Unit|Kapitel)\s*\d+[a-z]?(\s*(f\.|ff\.|bis\s*\d+))?/gi;
const TIME_RANGE = /(?:\bvon\s+)?\b([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(?:uhr\s*)?(?:-|–|bis)\s*([01]?\d|2[0-3])(?:[:.]([0-5]\d))?(?:\s*uhr)?\b/i;
const TIME_SINGLE = [
  /(?:\b(?:um|ab|gegen|so)\s+)?\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*uhr)?\b/i,
  /\b(?:um|ab|gegen)\s+([01]?\d|2[0-3])(?:\s*uhr)?\b/i,
  /(?:\bso\s+)?\b([01]?\d|2[0-3])\s*uhr\b/i,
];
const TRAINING_WORDS = /\b(gym|training|schwimm\w*|laufen|joggen|fu(ß|ss)ball|tennis|kletter\w*|sport|yoga|workout|volleyball|basketball|handball|tanzen|radtour)\b/i;
const PRIVATE_WORDS = /\b(nachhilfe|arzt|zahnarzt|geburtstag|kino|party|essen|friseur|fahrstunde|konzert)\b/i;
const SCHOOL_WORDS = /\b(schule|referat\w*|abikasse|abiball|klausur|test|elternabend|konferenz|infoabend|kurs\w*|lerngruppe|projektwoche|wandertag|exkursion|studien\w*|uni|hpi)\b/i;
const pad = (value) => String(value).padStart(2, "0");
const hhmm = (minute) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

const COUNTS = { 2: 2, zwei: 2, 3: 3, drei: 3, 4: 4, vier: 4, 5: 5, fünf: 5, 6: 6, sechs: 6, 7: 7, sieben: 7, 8: 8, acht: 8, 9: 9, neun: 9, 10: 10, zehn: 10, 11: 11, elf: 11, 12: 12, zwölf: 12 };
const ORDINAL = "(zweite[nmns]?|dritte[nmns]?|vierte[nmns]?|[234]\\.)";
const UNITS = { tag: "daily", woche: "weekly", monat: "monthly", jahr: "yearly", tage: "daily", wochen: "weekly", monate: "monthly", jahre: "yearly" };
const DAY_PART = "(abend|morgen|vormittag|nachmittag|mittag|nacht)";
// Every name in either case except a lone "so", which is a word of its own ("so gegen 18 Uhr").
const CASED_NAMES = DAY_NAMES.map((name) => `[${name[0]}${name[0].toUpperCase()}]${name.slice(1)}`).join("|");
const CASED_SHORT = DAY_SHORT.map(([first, second]) => `${first === "S" && second === "o" ? "S" : `[${first}${first.toLowerCase()}]`}[${second}${second.toUpperCase()}]`).join("|");
const CASED_PART = DAY_PART.slice(1, -1).split("|").map((word) => `[${word[0]}${word[0].toUpperCase()}]${word.slice(1)}s?|${word.toUpperCase()}S?`).join("|");
const AND_OR = "[Uu][Nn][Dd]|[Oo][Dd][Ee][Rr]";
const LISTED_SHORT = new RegExp(`((?:,|&|(?<![\\p{L}])(?:${AND_OR})(?![\\p{L}]))\\s*(?:jede[nm]?\\s+)?)(${CASED_SHORT})(\\.?)(?![\\p{L}\\p{N}]|-(?!\\s*(?:${CASED_SHORT}|${CASED_PART})(?![\\p{L}])))`, "gu");
const frau = (day, after) => /^fr\.?$/i.test(day) && /^\s*\p{Lu}/u.test(after) && !PART_AFTER.test(after);
// A short day after a separator lists a second day, unless it belongs to people ("mit Ben und Mo") or is Frau ("Fr. Lange").
const listedShort = (body) => [...body.matchAll(LISTED_SHORT)].some((match) => {
  const at = match.index + match[1].length;
  const after = body.slice(at + match[2].length + match[3].length);
  return !WITH_BEFORE.test(body.slice(0, at)) && !frau(match[2], after);
});
const CASED_DAY = `(?:(?:${CASED_NAMES})(?:${DAY_PART.slice(1, -1)})?s?|(?:${CASED_SHORT})\\.?)`;
const EVERY_DAY = new RegExp(`(?<![\\p{L}\\p{N}])(?:immer\\s+)?jede[nm]?\\s+(?:${ORDINAL}\\s+)?(?:(${DAY_NAMES.join("|")})${DAY_PART}?|(${DAY_SHORT.join("|")}))(\\.)?(?![\\p{L}\\p{N}])(?:\\s+(${PARTS})(?![\\p{L}]))?`, "iu");
const DAYS_ADVERB = new RegExp(`(?<![\\p{L}\\p{N}])(?:immer\\s+)?(${DAY_NAMES.join("|")})${DAY_PART}?s(?![\\p{L}\\p{N}\\-])(?:\\s+(${PARTS})(?![\\p{L}]))?`, "iu");
const MORE_DAYS = new RegExp(`^\\s*(,|&|(?:${AND_OR})(?![\\p{L}])|bis|-|–)\\s*(?:jede[nm]?\\s+)?(${CASED_DAY})(?![\\p{L}]|-(?!\\s*(?:${CASED_SHORT}|${CASED_PART})(?![\\p{L}])))`, "u");
const DAYS_BEFORE = new RegExp(`(?<![\\p{L}\\p{N}])${CASED_DAY}(?:\\s*[,&]|\\s+(?:${AND_OR}))\\s*$`, "u");
const LONG_DAY = new RegExp(`(?<![\\p{L}\\p{N}])(?:${DAY_NAMES.join("|")})${DAY_PART}?s?(?![\\p{L}\\p{N}])`, "iu");
const NAMES_DAY = new RegExp(`(?<![\\p{L}\\p{N}])(?:${DAY_NAMES.join("|")}|${DAY_SHORT.join("|")})(?![\\p{L}])`, "iu");
const EVERY_UNIT = new RegExp(`(?<![\\p{L}\\p{N}])jede[nmrs]?\\s+(?:${ORDINAL}\\s+)?(tag|woche|monat|jahr)(?![\\p{L}\\p{N}])`, "iu");
const ALL_UNITS = /(?<![\p{L}\p{N}])alle\s+(\d{1,2}|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)\s+(tage|wochen|monate|jahre)(?![\p{L}\p{N}])/iu;
const RHYTHM_WORDS = /(?<![\p{L}\p{N}])(täglich|wöchentlich|zweiwöchentlich|monatlich|jährlich|(?:14|vierzehn)[-\s]?tägig|(?:14|vierzehn)[-\s]?täglich)(?![\p{L}\p{N}])/iu;
const RHYTHMS = { täglich: ["daily", 1], wöchentlich: ["weekly", 1], zweiwöchentlich: ["weekly", 2], monatlich: ["monthly", 1], jährlich: ["yearly", 1] };
const step = (word) => (word ? Number(word.match(/\d/)?.[0]) || { zweite: 2, dritte: 3, vierte: 4 }[word.toLowerCase().slice(0, 6)] : 1);

function rhythmOf(text) {
  const every = text.match(EVERY_UNIT);
  if (every) return { freq: UNITS[every[2].toLowerCase()], interval: step(every[1]), index: every.index, length: every[0].length };
  const all = text.match(ALL_UNITS);
  if (all) {
    const count = COUNTS[all[1].toLowerCase()];
    const unit = all[2].toLowerCase();
    if (unit === "tage" && all[1] === "14") return { freq: "weekly", interval: 2, index: all.index, length: all[0].length };
    return count ? { freq: UNITS[unit], interval: count, index: all.index, length: all[0].length } : null;
  }
  const word = text.match(RHYTHM_WORDS);
  if (!word) return null;
  const [freq, interval] = RHYTHMS[word[1].toLowerCase()] || ["weekly", 2];
  return { freq, interval, index: word.index, length: word[0].length };
}

function weekdayRhythm(text) {
  const every = text.match(EVERY_DAY);
  const adverb = every ? null : text.match(DAYS_ADVERB);
  const found = every || adverb;
  if (!found) return null;
  const word = every ? every[2] || every[4] : adverb[1];
  if (every && word === "so" && !every[5]) return null;
  const end = found.index + found[0].length;
  const more = text.slice(end).match(MORE_DAYS);
  if ((more && (["bis", "-", "–"].includes(more[1]) || !(more[2].endsWith(".") && frau(more[2], text.slice(end + more[0].length))))) || DAYS_BEFORE.test(text.slice(0, found.index))) return { listed: true };
  const dow = word.length === 2 ? DAY_SHORT.findIndex((day) => day.toLowerCase() === word.toLowerCase()) : DAY_NAMES.indexOf(word.toLowerCase());
  const part = every ? every[3] || every[6] : adverb[2] || adverb[3];
  return { dow, interval: every ? step(every[1]) : 1, part: part?.toLowerCase() || null, index: found.index, length: found[0].length };
}

/* How often an event comes round, read from the words for it. Several weekdays ("jeden Mo und Mi") or a weekday with a
   rhythm other than weeks name nothing a single series can hold, so then nothing is read and the words stay in the title. */
export function repeatOf(text) {
  const day = weekdayRhythm(text);
  if (day?.listed) return null;
  const rhythm = rhythmOf(text);
  if (day && rhythm && rhythm.freq !== "weekly") return null;
  if (!day && !rhythm) return null;
  const spans = [day, rhythm].filter(Boolean).map(({ index, length }) => [index, index + length]);
  const interval = day && rhythm ? Math.max(day.interval, rhythm.interval) : (day || rhythm).interval;
  return { rule: normalizeRecurrence({ freq: day ? "weekly" : rhythm.freq, interval }), dow: day ? day.dow : null, part: day?.part || null, spans };
}

function cutPhrase(text, phrase) {
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

/* An event as the quick fields read it. The calendar's field and the sheet "Neu" share it, so both make the same event.
   A weekday rhythm ("jeden Dienstag") starts on that weekday, today included. */
export function parseEntry(text, day = isoDate(now())) {
  let repeat = repeatOf(text);
  let body = repeat ? repeat.spans.sort((a, b) => b[0] - a[0]).reduce((rest, [from, to]) => `${rest.slice(0, from)} ${rest.slice(to)}`, text) : text;
  let info = parseNote(body);
  // Another weekday beside "jeden Montag" ("und Mi 19 Uhr", "mittwochs") asks for a second series: none is read, and no day.
  if (weekdayRhythm(text)?.listed || (repeat?.dow != null && (LONG_DAY.test(body) || listedShort(body) || NAMES_DAY.test(info.phrases.date || "")))) {
    repeat = null;
    body = text;
    info = parseNote(text);
    if (NAMES_DAY.test(info.phrases.date || "")) info = { ...info, date: undefined, part: undefined, phrases: { ...info.phrases, date: undefined } };
  }
  let date = info.date || day;
  if (repeat?.dow != null) {
    const first = parseDate(date);
    date = isoDate(addDays(first, (repeat.dow - first.getDay() + 7) % 7));
  }
  const time = parseTime(cutPhrase(body, info.phrases.date), info.part || repeat?.part || null);
  let start = time?.start || null;
  let end = time?.end || null;
  const block = info.block ? blockOf(info.block) : null;
  if (block && !start) {
    start = block.start;
    end = block.end;
  }
  if (start && !end) end = hhmm(Math.min(1439, toMin(start) + 60));
  const words = info.block && !block ? { ...info, phrases: { ...info.phrases, block: undefined } } : info;
  const title = cleanTitle(cutPhrase(body, time?.phrase), words).replace(/\s+(um|am|von|ab)$/i, "").trim();
  let kind = "private";
  if (TRAINING_WORDS.test(text)) kind = "training";
  else if (PRIVATE_WORDS.test(text)) kind = "private";
  else if (SCHOOL_WORDS.test(text) || info.subject) kind = "school";
  return { title, date, start, end, kind, ...(repeat ? { recurrence: repeat.rule } : {}) };
}

/* What the sheet "Neu" picks while nobody chose by hand: a leading word for homework or an idea, a time for an event
   ("15:30–16:15", "um 17 Uhr"), else a task. A lesson ("2. Block") or a time to finish by ("bis 18 Uhr") names no event. */
export function suggestedType(text, info = parseNote(text)) {
  if (info.type) return info.type;
  const rest = cutPhrase(text, info.phrases.date);
  const time = parseTime(rest);
  if (!time) return "task";
  return !time.end && /(?<![\p{L}])bis\s*$/iu.test(rest.slice(0, phraseAt(rest, time.phrase))) ? "task" : "event";
}

export function repeatWords(entry) {
  const rule = normalizeRecurrence(entry.recurrence);
  if (!rule) return "";
  return rule.freq === "weekly" && rule.interval === 1 ? `Jeden ${WEEKDAYS[parseDate(entry.date).getDay()]}` : ruleText(rule);
}

export function eventChips(entry) {
  return [
    `<span class="chip">${icon("calendar-days")}${esc(shortDate(parseDate(entry.date)))}</span>`,
    `<span class="chip">${icon("clock")}${entry.start ? `${hm(entry.start)} bis ${hm(entry.end)}` : "ganztägig"}</span>`,
    entry.recurrence ? `<span class="chip">${icon("repeat")}${esc(repeatWords(entry))}</span>` : "",
  ].join("");
}

const chipWords = { subject: "Fach", date: "Datum", block: "Block" };

function chipButton(kind, content, text, extra = "", style = "") {
  return `<button type="button" class="chip${extra}" data-chip="${kind}"${style} aria-label="${chipWords[kind]} ${esc(text)} entfernen">${content}<span class="chip-x" aria-hidden="true">${icon("x")}</span></button>`;
}

function renderEventChips() {
  const raw = noteInput.value.trim();
  const entry = raw ? parseEntry(raw) : null;
  const markup = entry ? eventChips(entry) : "";
  if (noteChips.dataset.markup !== markup) {
    noteChips.dataset.markup = markup;
    noteChips.innerHTML = markup;
  }
  const note = !entry ? "" : !entry.title ? "Gib dem Termin noch einen Titel." : entry.title !== raw ? `Wird gespeichert als „${entry.title}“` : "";
  notePreview.hidden = !note;
  notePreview.textContent = note;
}

function renderChips() {
  if (noteType() === "event") {
    renderEventChips();
    return;
  }
  const info = effective();
  const chips = [];
  if (info.subject) {
    const label = subject(info.subject).label;
    chips.push(chipButton("subject", esc(label), label, " subject-chip", ` style="--hue:${hueVar(info.subject)}"`));
  }
  if (info.date) {
    const text = shortDate(new Date(`${info.date}T12:00:00`));
    chips.push(chipButton("date", `${icon("calendar-days")}${esc(text)}`, text));
  }
  if (info.block) chips.push(chipButton("block", `${icon("nx-block")}${info.block}. ${periodWords().one}`, `${info.block}. ${periodWords().one}`));
  const markup = chips.join("");
  if (noteChips.dataset.markup !== markup) {
    noteChips.dataset.markup = markup;
    noteChips.innerHTML = markup;
  }
  const raw = noteInput.value.trim();
  const title = cleanTitle(raw, info);
  const changed = raw && title !== raw;
  notePreview.hidden = !changed;
  if (changed) notePreview.textContent = `Wird gespeichert als „${title}“`;
}

noteChips?.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-chip]");
  if (!chip) return;
  dismissed.add(chip.dataset.chip);
  lastRecognized = null;
  renderChips();
  noteInput.focus();
});

noteInput?.addEventListener("input", () => {
  noteSave.disabled = !noteInput.value.trim();
  if (!noteInput.value.trim()) dismissed = new Set();
  const before = effective();
  parsed = parseNote(noteInput.value);
  const after = effective();
  lastRecognized = ["date", "block", "subject"].find((kind) => after[kind] && after[kind] !== before[kind]) || null;
  if (!typeTouched) pickType(suggestedType(noteInput.value, parsed));
  renderChips();
});

noteInput?.addEventListener("keydown", (event) => {
  const atEnd = noteInput.selectionStart === noteInput.value.length && noteInput.selectionEnd === noteInput.value.length;
  if (event.key === "Backspace" && lastRecognized && atEnd && noteType() !== "event") {
    event.preventDefault();
    dismissed.add(lastRecognized);
    lastRecognized = null;
    renderChips();
    return;
  }
  if (!["Shift", "Control", "Meta", "Alt"].includes(event.key)) lastRecognized = null;
});

noteForm?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    noteForm.requestSubmit();
  }
});

noteForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const raw = noteInput.value.trim();
  if (!raw) return;
  const type = noteType();
  const info = effective();
  const details = noteForm.querySelector("textarea[name='details']")?.value.trim() || "";
  const detail = type === "event" ? { type, ...parseEntry(raw), details } : { type, title: cleanTitle(raw, info), subject: info.subject, date: info.date, block: info.block, details };
  if (!detail.title) {
    noteInput.focus();
    return;
  }
  noteSheet.hidePopover();
  const handled = !window.dispatchEvent(new CustomEvent("app:note", { detail, cancelable: true }));
  if (!handled) saveNote(detail);
});

let lastSaveWarning = 0;

addEventListener("app:save-failed", () => {
  if (performance.now() - lastSaveWarning < 4000) return;
  lastSaveWarning = performance.now();
  toast("Das hat nicht geklappt. Die Änderung ist noch nicht gespeichert.", { icon: "circle-alert" });
});

function saveEvent(detail) {
  const { type, details, ...entry } = detail;
  const item = { id: `neu-${Date.now()}`, place: "", notes: details || "", ...entry };
  eventApi.create(item).then((saved) => {
    if (saved && data && !flags.empty) data.events = [...(data.events || []), saved];
    const when = `${shortDate(parseDate(item.date))}${item.start ? `, ${hm(item.start)}` : ""}`;
    const rhythm = item.recurrence ? repeatWords(item) : "";
    toast(`Termin angelegt: „${esc(item.title)}“, ${esc(when)}${rhythm ? `, ${esc(rhythm[0].toLowerCase() + rhythm.slice(1))}` : ""}`, {
      icon: "check",
      action: { label: "Anzeigen", run: () => openPage("calendar", `${ROUTES.calendar}#tag=${item.date}`) },
    });
  }).catch(() => {});
}

function saveNote(detail) {
  if (detail.type === "event") {
    saveEvent(detail);
    return;
  }
  const words = { task: "Aufgabe", homework: "Hausaufgabe", note: "Notiz", idea: "Idee" };
  const today = isoDate(now());
  let job;
  let when = "";
  if (detail.type === "task") {
    job = taskApi.create({ id: `new-${Date.now()}`, title: detail.title, subject: detail.subject, date: detail.date && detail.date > today ? detail.date : null, minutes: 20, notes: detail.details || "", done: false });
  } else if (detail.type === "homework") {
    const date = detail.date || homeworkDate(detail.subject);
    when = ` für ${shortDate(parseDate(date))}`;
    job = deadlineApi.create({ id: `hw-new-${Date.now()}`, kind: "Hausaufgabe", title: detail.title, subject: detail.subject || null, date, detail: detail.details });
  } else {
    job = noteApi.create({ type: detail.type, title: detail.title, details: detail.details });
  }
  job.then((saved) => {
    const listed = (detail.type === "note" || detail.type === "idea") && !!saved?.id && !!saved.title;
    const action = listed && !document.getElementById("notesList") ? { label: "Anzeigen", run: () => openPage("tasks", `${ROUTES.tasks}#notizen`) } : undefined;
    toast(`${words[detail.type]}${when} angelegt: „${esc(detail.title)}“`, { icon: "check", action });
    if (listed) document.dispatchEvent(new CustomEvent("app:note-created", { detail: saved }));
  }).catch(() => {});
}

const weatherSheet = $("weatherSheet");
weatherSheet?.addEventListener("beforetoggle", (event) => {
  if (event.newState !== "open") return;
  const source = [lastInvoker?.closest?.("[data-open-weather]"), document.querySelector("[data-open-weather]")].find(onScreen);
  placeNear(weatherSheet, source, "left");
  window.dispatchEvent(new CustomEvent("app:weather-open"));
});
weatherSheet?.addEventListener("toggle", (event) => {
  if (event.newState === "open") clampSheet(weatherSheet);
});

export function openWeather(source) {
  lastInvoker = source || lastInvoker;
  if (!weatherSheet.matches(":popover-open")) weatherSheet.showPopover();
}

const variantMenu = $("variantMenu");
variantMenu?.addEventListener("beforetoggle", (event) => {
  if (event.newState !== "open") return;
  const button = document.querySelector(".variant-button");
  const box = button.getBoundingClientRect();
  variantMenu.style.right = `${Math.round(innerWidth - box.right)}px`;
  variantMenu.style.bottom = `${Math.round(innerHeight - box.top + 8)}px`;
  variantMenu.style.top = "auto";
  variantMenu.style.left = "auto";
});

const palette = $("palette");
const paletteInput = $("paletteInput");
const paletteResults = $("paletteResults");
const paletteStatus = $("paletteStatus");
let paletteItems = [];
let paletteIndex = 0;
const searchProviders = [];

export function registerSearch(provider) {
  searchProviders.push(provider);
}

export function setTheme(theme) {
  const mode = theme === "light" || theme === "dark" ? theme : "auto";
  storage.set("app-theme-choice", mode);
  const apply = () => {
    root.dataset.theme = mode === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : mode;
    root.dataset.themeMode = mode;
  };
  if (travels() && document.startViewTransition) document.startViewTransition(apply);
  else apply();
}

function baseCommands() {
  const theme = root.dataset.theme;
  const single = shortcutsEnabled();
  const noteHint = platform.electron ? `${modWord}${platform.mac ? "⌥" : "Alt+"}N` : single ? "N" : "";
  const commands = [
    { group: "Aktionen", label: "Aufgabe für heute anlegen", icon: "plus", hint: single ? "A" : "", run: () => window.dispatchEvent(new CustomEvent("app:add-task")) },
    { group: "Aktionen", label: "Schnelle Notiz", icon: "pen-tool", hint: noteHint, run: () => openNote({ instant: true }) },
    { group: "Aktionen", label: "Wetter und Heimweg", icon: "cloud", run: () => openWeather(document.querySelector("[data-open-weather]")) },
    { group: "Aktionen", label: theme === "dark" ? "Helle Darstellung" : "Dunkle Darstellung", icon: theme === "dark" ? "sun" : "moon", run: () => setTheme(theme === "dark" ? "light" : "dark") },
    { group: "Aktionen", label: "Tastaturkürzel", icon: "keyboard", hint: single ? "?" : "", run: () => $("shortcuts").showModal() },
    { group: "Aktionen", label: "Rückmeldung geben", icon: "send", keywords: "Fehler melden Feedback Kontakt", run: () => window.dispatchEvent(new CustomEvent("app:feedback")) },
  ];
  Object.entries(pageNames).forEach(([key, label]) => {
    if (key === "home") return;
    commands.push({ group: "Seiten", label, icon: pageIcons[key], run: () => openPage(key) });
  });
  return commands;
}

function renderPalette() {
  const query = paletteInput.value.trim().toLowerCase();
  const all = [...baseCommands(), ...searchProviders.flatMap((provider) => provider())];
  const matched = query
    ? all.filter((item) => `${item.label} ${item.keywords || ""}`.toLowerCase().includes(query))
    : all.filter((item) => item.group !== "Aufgaben" && item.group !== "Fällig");
  paletteItems = matched.slice(0, 14);
  paletteIndex = Math.min(paletteIndex, Math.max(paletteItems.length - 1, 0));
  if (paletteStatus) paletteStatus.textContent = query ? (paletteItems.length ? `${paletteItems.length} Treffer` : "Keine Treffer") : "";
  if (!paletteItems.length) {
    paletteResults.innerHTML = `<p class="palette-empty">Nichts gefunden für „${esc(paletteInput.value)}“.</p>`;
    paletteInput.removeAttribute("aria-activedescendant");
    return;
  }
  const groups = [];
  paletteItems.forEach((item, index) => {
    let group = groups[groups.length - 1];
    if (!group || group.name !== item.group) {
      group = { name: item.group, items: [] };
      groups.push(group);
    }
    group.items.push(`<div class="palette-item" role="option" id="pal-${index}" data-index="${index}" aria-selected="${index === paletteIndex}">${icon(item.icon)}<span>${esc(item.label)}</span>${item.hint ? `<small>${esc(item.hint)}</small>` : ""}</div>`);
  });
  paletteResults.innerHTML = groups
    .map((group, index) => `<div role="group" aria-labelledby="pal-group-${index}"><p class="palette-group" id="pal-group-${index}">${esc(group.name)}</p>${group.items.join("")}</div>`)
    .join("");
  paletteInput.setAttribute("aria-activedescendant", `pal-${paletteIndex}`);
  paletteResults.querySelector(`[data-index="${paletteIndex}"]`)?.scrollIntoView({ block: "nearest" });
}

export function openPalette() {
  if (palette.open) return;
  paletteInput.value = "";
  paletteIndex = 0;
  renderPalette();
  palette.showModal();
  paletteInput.focus();
}

function runPalette(index) {
  const item = paletteItems[index];
  if (!item) return;
  palette.close();
  item.run();
}

paletteInput?.addEventListener("input", () => {
  paletteIndex = 0;
  renderPalette();
});

paletteInput?.addEventListener("keydown", (event) => {
  if (!paletteItems.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    paletteIndex = (paletteIndex + 1) % paletteItems.length;
    renderPalette();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    paletteIndex = (paletteIndex - 1 + paletteItems.length) % paletteItems.length;
    renderPalette();
  } else if (event.key === "Enter") {
    event.preventDefault();
    runPalette(paletteIndex);
  }
});

paletteResults?.addEventListener("click", (event) => {
  const item = event.target.closest(".palette-item");
  if (item) runPalette(Number(item.dataset.index));
});

palette?.addEventListener("click", (event) => {
  if (event.target === palette) palette.close();
});

document.querySelectorAll("[data-open-palette]").forEach((button) => button.addEventListener("click", openPalette));

document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
$("shortcuts")?.addEventListener("click", (event) => {
  if (event.target === $("shortcuts")) $("shortcuts").close();
});

export const typing = (target) => target.closest?.("input, textarea, select, [contenteditable='true']");

export function keepOneLine(field) {
  if (!/[\r\n]/.test(field.value)) return;
  const flat = (text) => text.replace(/\s*[\r\n]+\s*/g, " ");
  const caret = flat(field.value.slice(0, field.selectionStart)).length;
  field.value = flat(field.value);
  field.setSelectionRange(caret, caret);
}

const NO_TEXT = ["checkbox", "radio", "range", "button", "submit", "reset", "file", "color", "image"];

function takesText(target) {
  const field = target.closest?.("input, textarea, [contenteditable='true']");
  if (!field) return false;
  if (field.isContentEditable) return true;
  return !field.readOnly && !field.disabled && !NO_TEXT.includes(field.type);
}

export const overlayOpen = () => !!document.querySelector("dialog[open], [popover]:popover-open:not(.variant-menu)");

document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (event.key === "Escape" && tooltip.classList.contains("is-on")) hideTip();
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === "k") {
    event.preventDefault();
    if (palette.open) palette.close();
    else openPalette();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && ((event.shiftKey && key === "n") || (event.altKey && event.code === "KeyN"))) {
    event.preventDefault();
    openNote({ instant: true, source: $("noteButton") });
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === "z" && !typing(event.target)) {
    if (runUndo()) event.preventDefault();
    return;
  }
  // WebKit views go back a page on Backspace wherever it does not delete text
  if (event.key === "Backspace" && !event.ctrlKey && !event.metaKey && !event.altKey && !takesText(event.target)) event.preventDefault();
  if (typing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!shortcutsEnabled() || overlayOpen()) return;
  if (event.key === "?") {
    event.preventDefault();
    $("shortcuts").showModal();
  } else if (key === "n" && !event.shiftKey) {
    event.preventDefault();
    openNote({ instant: true, source: $("noteButton") });
  }
});

addEventListener("resize", () => placeIndicator(true));
for (const type of ["pageswap", "pagereveal"]) {
  addEventListener(type, (event) => {
    if (event.viewTransition && !travels()) event.viewTransition.skipTransition();
  });
}

export function initShell() {
  root.classList.toggle("is-touch", matchMedia("(pointer: coarse)").matches || matchMedia("(hover: none)").matches);
  renderKeys();
  syncShortcutToggle();
  renderCounts();
  renderSync();
  renderNotify();
  placeIndicator(true);
  document.fonts?.ready.then(() => placeIndicator(true));
  if (document.body.dataset.serverBehind === "1") toast(`${BRAND} wurde aktualisiert. Beende ${BRAND} und öffne es neu, damit alles zusammenpasst.`, { icon: "refresh-cw", duration: 12000 });
}
