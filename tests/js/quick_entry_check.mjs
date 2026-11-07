// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = (name) => pathToFileURL(resolve(here, "../../app/static/app/js", name)).href;

const appData = {
  blocks: [{ n: 1, start: "08:00", end: "09:30" }, { n: 2, start: "09:50", end: "11:20" }],
  subjects: {}, courses: {}, timetable: { A: {}, B: {} }, abReference: "2026-01-12", changes: [], tasks: [], deadlines: [],
  events: [], holidays: [], weather: {}, status: {}, page: { holidays: [], sync: {} },
};
const store = new Map();
const nodes = { appData: { textContent: JSON.stringify(appData) }, appStore: { textContent: "{}" } };
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
globalThis.document = {
  documentElement: { dataset: { brand: "App", motion: "calm" }, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, style: { setProperty() {} } },
  getElementById: (id) => nodes[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: () => ({ content: { childNodes: [] }, set innerHTML(value) {}, style: {}, classList: { add() {}, remove() {} } }),
  hidden: false,
  visibilityState: "visible",
};
globalThis.location = { search: "?datum=2026-10-05&t=10:00", pathname: "/hub/calendar", href: "http://127.0.0.1/hub/calendar" };
globalThis.self = globalThis;
globalThis.window = globalThis;
Object.defineProperty(globalThis, "navigator", { value: { platform: "MacIntel", userAgent: "node" }, configurable: true });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.addEventListener = () => {};
globalThis.dispatchEvent = () => true;
globalThis.ResizeObserver = class { observe() {} };
globalThis.CSS = { escape: (text) => text };

const { params } = await import(script("core.js"));
const { parseNote, cleanTitle } = await import(script("shell.js"));
const { parseEntry } = await import(script("pages/calendar.js"));

const MONDAY = "2026-10-05";
const on = (day) => params.set("datum", day);

const TITLES = ["Zahnarzt", "Elternabend", "Oma anrufen", "Dosenpfand wegbringen", "Treffen mit Sophie", "Mittagessen", "Frisör", "Dienstplan abgeben", "Training"];
const DAYS = [
  ["Do", "2026-10-08"], ["Do.", "2026-10-08"], ["Donnerstag", "2026-10-08"], ["donnerstag", "2026-10-08"],
  ["am Do", "2026-10-08"], ["am do", "2026-10-08"], ["am Donnerstag", "2026-10-08"], ["bis Donnerstag", "2026-10-08"],
  ["nächsten Donnerstag", "2026-10-08"], ["übernächsten Donnerstag", "2026-10-15"], ["Donnerstag nächste Woche", "2026-10-15"],
  ["nächste Woche Donnerstag", "2026-10-15"], ["Donnerstag in einer Woche", "2026-10-15"], ["do", null], ["", null],
];
const CLOCKS = [
  ["15:30–16:15", "15:30", "16:15"], ["15:30-16:15", "15:30", "16:15"], ["15:30 bis 16:15", "15:30", "16:15"],
  ["von 15:30 bis 16:15", "15:30", "16:15"], ["15:30", "15:30", "16:30"], ["um 15:30", "15:30", "16:30"],
  ["15 Uhr", "15:00", "16:00"], ["um 15 Uhr", "15:00", "16:00"], ["15.30 Uhr", "15:30", "16:30"], ["ab 15 Uhr", "15:00", "16:00"], ["", null, null],
];
const ORDERS = [["title", "day", "clock"], ["day", "clock", "title"], ["title", "clock", "day"], ["clock", "day", "title"], ["day", "title", "clock"]];

const bareShort = (words) => /^(?:Mo|Di|Mi|Do|Fr|Sa|So)\.?$/.test(words);

/* What a sentence means: a written short day in front of a name stays text unless a clock stands before it, a short
   day in lower case only counts behind "am". */
function meaning(parts, order) {
  const sequence = order.map((kind) => [kind, parts[kind]]).filter(([, words]) => words);
  const index = sequence.findIndex(([kind]) => kind === "day");
  let [dayWords, day] = [parts.day, parts.date];
  if (index >= 0 && bareShort(dayWords)) {
    const next = sequence[index + 1];
    const previous = sequence[index - 1];
    if (next && next[0] === "title" && !(previous && previous[0] === "clock")) day = null;
  }
  if (dayWords === "do") day = null;
  const title = sequence.filter(([kind]) => kind === "title" || (kind === "day" && !day)).map(([, words]) => words).join(" ");
  return { title, date: day || MONDAY };
}

function* sentences() {
  for (const title of TITLES) {
    for (const [dayWords, date] of DAYS) {
      for (const [clockWords, start, end] of CLOCKS) {
        if (!dayWords && !clockWords) continue;
        for (const order of ORDERS) {
          const parts = { title, day: dayWords, date, clock: clockWords };
          const text = order.map((kind) => parts[kind]).filter(Boolean).join(" ");
          yield { text, meant: { ...meaning(parts, order), start, end } };
        }
      }
    }
  }
}

const read = (text) => {
  const entry = parseEntry(text);
  return { title: entry.title, date: entry.date, start: entry.start, end: entry.end };
};

const tests = {
  "every title with every weekday form and clock form in every position reads as meant"() {
    on(MONDAY);
    const seen = new Set();
    const wrong = [];
    let count = 0;
    for (const { text, meant } of sentences()) {
      if (seen.has(text)) continue;
      seen.add(text);
      count += 1;
      const got = read(text);
      if (JSON.stringify(got) !== JSON.stringify(meant)) wrong.push(`${JSON.stringify(text)} gave ${JSON.stringify(got)}, meant ${JSON.stringify(meant)}`);
    }
    assert.ok(count > 4000, `only ${count} sentences`);
    assert.equal(wrong.length, 0, `${wrong.length} of ${count} read wrongly, the first: ${wrong.slice(0, 8).join("; ")}`);
  },
  "every weekday reads in its short and long form, and the So that opens a sentence stays text"() {
    on(MONDAY);
    const days = [["Mo", "Montag", "2026-10-12"], ["Di", "Dienstag", "2026-10-06"], ["Mi", "Mittwoch", "2026-10-07"], ["Do", "Donnerstag", "2026-10-08"], ["Fr", "Freitag", "2026-10-09"], ["Sa", "Samstag", "2026-10-10"], ["So", "Sonntag", "2026-10-11"]];
    for (const [short, long, date] of days) {
      for (const form of [short, `${short}.`, long, `am ${short}`, `am ${long}`]) {
        assert.deepEqual(read(`Treffen ${form} 18 Uhr`), { title: "Treffen", date, start: "18:00", end: "19:00" }, form);
        assert.deepEqual(read(`Treffen 18 Uhr ${form}`), { title: "Treffen", date, start: "18:00", end: "19:00" }, form);
        const opening = short === "So" && form === "So";
        assert.deepEqual(read(`${form} 18 Uhr Treffen`), { title: "Treffen", date: opening ? MONDAY : date, start: "18:00", end: "19:00" }, form);
      }
    }
  },
  "names, adverbs and content keep their words and get no day"() {
    on(MONDAY);
    const cases = [
      ["Gespräch mit Fr. Müller 15 Uhr", "Gespräch mit Fr. Müller"], ["Termin bei Frau Freitag 15 Uhr", "Termin bei Frau Freitag"],
      ["Treffen mit Di Maria um 15 Uhr", "Treffen mit Di Maria"], ["Mi Amor anrufen um 15 Uhr", "Mi Amor anrufen"],
      ["Lady Di Doku schauen 15 Uhr", "Lady Di Doku schauen"], ["So gegen 15 Uhr Kaffee", "So Kaffee"], ["So 15 Uhr Kaffee", "Kaffee"], ["So viel lernen 15 Uhr", "So viel lernen"],
      ["Stoff von Freitag nachholen 15 Uhr", "Stoff von Freitag nachholen"], ["Jeden Montag Training 15 Uhr", "Jeden Montag Training"],
      ["Montagmorgen Sportzeug 15 Uhr", "Montagmorgen Sportzeug"], ["Rufe den Montag-Kurs an 15 Uhr", "Rufe den Montag-Kurs an"],
      ["Mo-Fr Praktikum 15 Uhr", "Mo-Fr Praktikum"], ["Praktikum Mo - Fr 15 Uhr", "Praktikum Mo - Fr"],
      ["Arzt Montag in fünf Wochen 15 Uhr", "Arzt Montag in fünf Wochen"], ["Letzten Freitag nachholen 15 Uhr", "Letzten Freitag nachholen"],
      ["Guten Morgen Karte schreiben 15 Uhr", "Guten Morgen Karte schreiben"], ["Jeden Morgen lesen 15 Uhr", "Jeden Morgen lesen"],
      ["do it 15 Uhr", "do it"], ["Dosenpfand wegbringen 15 Uhr", "Dosenpfand wegbringen"], ["Sonnencreme kaufen 15 Uhr", "Sonnencreme kaufen"],
      ["Frisör um 15 Uhr", "Frisör"], ["Fr. Dr. Weber anrufen 15 Uhr", "Fr. Dr. Weber anrufen"], ["Feier am Montag, 31.4. 15 Uhr", "Feier am Montag, 31.4."],
    ];
    for (const [text, title] of cases) assert.deepEqual(read(text), { title, date: MONDAY, start: "15:00", end: "16:00" }, text);
  },
  "stretches, deadlines and dates next to a weekday read as in the assistant"() {
    on(MONDAY);
    const cases = [
      ["Praktikum von Montag bis Freitag", "Praktikum", "2026-10-12"],
      ["Freitag bis Montag Zimmer streichen", "Zimmer streichen", "2026-10-09"],
      ["Geschenk für Freitag bis Mittwoch kaufen", "Geschenk für Freitag kaufen", "2026-10-07"],
      ["Stoff vom Freitag bis Mittwoch nachholen", "Stoff vom Freitag nachholen", "2026-10-07"],
      ["Bis Freitag Referat für Montag vorbereiten", "Referat für Montag vorbereiten", "2026-10-09"],
      ["Für Montag Sportzeug packen", "Sportzeug packen", "2026-10-12"],
      ["Klausur Mo 19.10.", "Klausur", "2026-10-19"],
      ["Klausur am Montag, 19.10.", "Klausur", "2026-10-19"],
      ["Klausur am Montag, dem 19.10.", "Klausur", "2026-10-19"],
      ["Klausur am 19.10. (Montag)", "Klausur", "2026-10-19"],
      ["Ausflug So 11.10.", "Ausflug", "2026-10-11"],
      ["Arzt in der nächsten Woche am Mittwoch", "Arzt", "2026-10-14"],
      ["Arzt am Mittwoch der nächsten Woche", "Arzt", "2026-10-14"],
      ["Arzt übernächste Woche Montag", "Arzt", "2026-10-19"],
      ["Referat Freitag in einer Woche", "Referat", "2026-10-16"],
      ["Abgabe Montag in zwei Wochen", "Abgabe", "2026-10-19"],
      ["Mathe nächste Woche", "Mathe", "2026-10-12"],
    ];
    for (const [text, title, date] of cases) assert.deepEqual([read(text).title, read(text).date], [title, date], text);
    assert.deepEqual(read("Zahnarzt am Donnerstag morgen 8 Uhr"), { title: "Zahnarzt", date: "2026-10-08", start: "08:00", end: "09:00" });
    assert.deepEqual(read("Abgabe Fr. 9.10. 12 Uhr"), { title: "Abgabe", date: "2026-10-09", start: "12:00", end: "13:00" });
  },
  "days are counted from the day it is"() {
    const cases = [
      ["2026-10-07", "Mathe am Mittwoch", "2026-10-14"], ["2026-10-07", "Mathe Mi", "2026-10-14"], ["2026-10-07", "Mathe am Freitag", "2026-10-09"],
      ["2026-10-07", "Mathe nächste Woche Montag", "2026-10-12"], ["2026-10-07", "Arzt Montag in einer Woche", "2026-10-19"],
      ["2026-10-11", "Arzt Freitag in einer Woche", "2026-10-23"], ["2026-12-31", "Abgabe am Freitag", "2027-01-01"], ["2026-12-31", "Abgabe Fr", "2027-01-01"],
      ["2026-10-07", "Mathe diese Woche Freitag", "2026-10-09"], ["2026-10-09", "Mathe diese Woche Donnerstag", "2026-10-09"],
    ];
    for (const [today, text, date] of cases) {
      on(today);
      assert.equal(read(text).date, date, `${today} ${text}`);
    }
    on(MONDAY);
  },
  "the other quick fields read the weekday the same way"() {
    on(MONDAY);
    const info = parseNote("Mathe Hausaufgabe Do");
    assert.equal(info.date, "2026-10-08");
    assert.equal(cleanTitle("Mathe Hausaufgabe Do", info), "Mathe Hausaufgabe");
    const later = parseNote("Vokabeln lernen bis Fr.");
    assert.equal(later.date, "2026-10-09");
    assert.equal(cleanTitle("Vokabeln lernen bis Fr.", later), "Vokabeln lernen");
    assert.equal(parseNote("Gespräch mit Fr. Müller vorbereiten").date, undefined);
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n${error.message.slice(0, 3000)}`);
  }
}
process.exit(failed ? 1 : 0);
