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
const { parseNote, cleanTitle, parseEntry, repeatWords, suggestedType } = await import(script("shell.js"));
const calendar = await import(script("pages/calendar.js"));

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

/* What a sentence means: a written short day in front of a name stays text unless a clock stands before it, or it
   opens the sentence with a dot or with a time somewhere in it. A short day in lower case only counts behind "am". */
function meaning(parts, order) {
  const sequence = order.map((kind) => [kind, parts[kind]]).filter(([, words]) => words);
  const index = sequence.findIndex(([kind]) => kind === "day");
  let [dayWords, day] = [parts.day, parts.date];
  if (index >= 0 && bareShort(dayWords)) {
    const next = sequence[index + 1];
    const previous = sequence[index - 1];
    const opening = index === 0 && (dayWords.endsWith(".") || !!parts.clock);
    if (next && next[0] === "title" && !(previous && previous[0] === "clock") && !opening) day = null;
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
  "every weekday reads in its short and long form wherever it stands"() {
    on(MONDAY);
    const days = [["Mo", "Montag", "2026-10-12"], ["Di", "Dienstag", "2026-10-06"], ["Mi", "Mittwoch", "2026-10-07"], ["Do", "Donnerstag", "2026-10-08"], ["Fr", "Freitag", "2026-10-09"], ["Sa", "Samstag", "2026-10-10"], ["So", "Sonntag", "2026-10-11"]];
    for (const [short, long, date] of days) {
      for (const form of [short, `${short}.`, long, `am ${short}`, `am ${long}`]) {
        assert.deepEqual(read(`Treffen ${form} 18 Uhr`), { title: "Treffen", date, start: "18:00", end: "19:00" }, form);
        assert.deepEqual(read(`Treffen 18 Uhr ${form}`), { title: "Treffen", date, start: "18:00", end: "19:00" }, form);
        assert.deepEqual(read(`${form} 18 Uhr Treffen`), { title: "Treffen", date, start: "18:00", end: "19:00" }, form);
      }
    }
  },
  "a short day that opens a sentence counts with a dot, a time or a time of day, and never before a comma"() {
    on(MONDAY);
    const cases = [
      ["Do Zahnarzt 15:30–16:15", "Zahnarzt", "2026-10-08", "15:30", "16:15"], ["Do. Zahnarzt 15:30", "Zahnarzt", "2026-10-08", "15:30", "16:30"],
      ["Mo Training 18 Uhr", "Training", "2026-10-12", "18:00", "19:00"], ["Do. Zahnarzt", "Zahnarzt", "2026-10-08", null, null],
      ["Sa nachmittags Fußball", "Fußball", "2026-10-10", null, null], ["Mi Training abends", "Training abends", "2026-10-07", null, null],
      ["So 15 Uhr Kaffee", "Kaffee", "2026-10-11", "15:00", "16:00"], ["So gegen 15 Uhr Kaffee", "Kaffee", "2026-10-11", "15:00", "16:00"],
      ["Mo bis Fr Praktikum", "Praktikum", "2026-10-12", null, null], ["Mi Amor anrufen um 15 Uhr", "Amor anrufen", "2026-10-07", "15:00", "16:00"],
      ["Do Zahnarzt", "Do Zahnarzt", MONDAY, null, null], ["So ein Tag", "So ein Tag", MONDAY, null, null],
      ["So, noch Mathe lernen 15 Uhr", "So, noch Mathe lernen", MONDAY, "15:00", "16:00"], ["Do, Zahnarzt 15 Uhr", "Do, Zahnarzt", MONDAY, "15:00", "16:00"],
      ["So bei Oma 15 Uhr", "bei Oma", "2026-10-11", "15:00", "16:00"], ["So im Kino 20 Uhr", "im Kino", "2026-10-11", "20:00", "21:00"],
      ["Mo früh Zahnarzt", "Zahnarzt", "2026-10-12", null, null], ["So lange lernen 15 Uhr", "So lange lernen", MONDAY, "15:00", "16:00"],
      ["So viel lernen 15 Uhr", "So viel lernen", MONDAY, "15:00", "16:00"], ["So früh wie möglich anrufen", "So früh wie möglich anrufen", MONDAY, null, null],
      ["Fr Müller anrufen 15 Uhr", "Fr Müller anrufen", MONDAY, "15:00", "16:00"],
    ];
    for (const [text, title, date, start, end] of cases) assert.deepEqual(read(text), { title, date, start, end }, text);
  },
  "a short day before a time of day keeps it, and the time of day moves the hour"() {
    on(MONDAY);
    const cases = [
      ["Kino Do Abend", "Kino", "2026-10-08", null, null], ["Kino Do Abend 8 Uhr", "Kino", "2026-10-08", "20:00", "21:00"],
      ["Do Abend 7 bis 9 Uhr Kino", "Kino", "2026-10-08", "19:00", "21:00"], ["Zahnarzt Freitag Nachmittag um 3", "Zahnarzt", "2026-10-09", "15:00", "16:00"],
      ["Kino heute Abend 8 Uhr", "Kino", MONDAY, "20:00", "21:00"], ["Joggen morgen früh 7 Uhr", "Joggen", "2026-10-06", "07:00", "08:00"],
      ["Kino Fr Abend 20 Uhr", "Kino", "2026-10-09", "20:00", "21:00"],
    ];
    for (const [text, title, date, start, end] of cases) assert.deepEqual(read(text), { title, date, start, end }, text);
  },
  "days after mit, in a list, or after Frau and Herr name no day, and Mo bis Fr is a stretch"() {
    on(MONDAY);
    const cases = [
      ["Treffen mit Mo um 19 Uhr", "Treffen mit Mo", MONDAY, "19:00", "20:00"], ["Pizza mit Sa", "Pizza mit Sa", MONDAY, null, null],
      ["Gym Mo, Mi, Fr 7 Uhr", "Gym Mo, Mi, Fr", MONDAY, "07:00", "08:00"], ["Training Mo und Mi 18 Uhr", "Training Mo und Mi", MONDAY, "18:00", "19:00"],
      ["Training Montag und Mittwoch 18 Uhr", "Training Montag und Mittwoch", MONDAY, "18:00", "19:00"], ["Lauftreff Di oder Do 18 Uhr", "Lauftreff Di oder Do", MONDAY, "18:00", "19:00"],
      ["Frau Freitag anrufen 15 Uhr", "Frau Freitag anrufen", MONDAY, "15:00", "16:00"], ["Herr Montag kommt 15 Uhr", "Herr Montag kommt", MONDAY, "15:00", "16:00"],
      ["Mo bis Fr Praktikum", "Praktikum", "2026-10-12", null, null], ["Praktikum Mo bis Fr", "Praktikum", "2026-10-12", null, null],
      ["Praktikum Mo bis Freitag 8 Uhr", "Praktikum", "2026-10-12", "08:00", "09:00"], ["Treffen Freitag und so", "Treffen und so", "2026-10-09", null, null],
      ["Pizza mit Lea und Mo um 19 Uhr", "Pizza mit Lea und Mo", MONDAY, "19:00", "20:00"], ["Kino mit Lea & Mo", "Kino mit Lea & Mo", MONDAY, null, null],
      ["Essen mit Lea, Ben und Mo 18 Uhr", "Essen mit Lea, Ben und Mo", MONDAY, "18:00", "19:00"], ["Gym Mo Mi Fr 7 Uhr", "Gym Mo Mi Fr", MONDAY, "07:00", "08:00"],
      ["Gym Montag Mittwoch 7 Uhr", "Gym Montag Mittwoch", MONDAY, "07:00", "08:00"],
    ];
    for (const [text, title, date, start, end] of cases) assert.deepEqual(read(text), { title, date, start, end }, text);
  },
  "names, adverbs and content keep their words and get no day"() {
    on(MONDAY);
    const cases = [
      ["Gespräch mit Fr. Müller 15 Uhr", "Gespräch mit Fr. Müller"], ["Termin bei Frau Freitag 15 Uhr", "Termin bei Frau Freitag"],
      ["Treffen mit Di Maria um 15 Uhr", "Treffen mit Di Maria"], ["Anruf bei Mi Amor 15 Uhr", "Anruf bei Mi Amor"],
      ["Lady Di Doku schauen 15 Uhr", "Lady Di Doku schauen"], ["So viel lernen 15 Uhr", "So viel lernen"],
      ["Stoff von Freitag nachholen 15 Uhr", "Stoff von Freitag nachholen"],
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
    assert.deepEqual(read("Mathe Mo 2. Block"), { title: "Mathe", date: "2026-10-12", start: "09:50", end: "11:20" });
    assert.deepEqual(read("Mathe Mo 3. Block"), { title: "Mathe 3. Block", date: "2026-10-12", start: null, end: null });
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

const WEEKLY = { freq: "weekly", interval: 1, until: null, count: null, exceptions: [] };
const rule = (freq, interval = 1) => ({ ...WEEKLY, freq, interval });

Object.assign(tests, {
  "the calendar page and the sheet Neu read with the same parser"() {
    assert.equal(calendar.parseEntry, undefined, "the calendar keeps no parser of its own");
  },
  "a rhythm makes a series, starts on its weekday with today included, and leaves the title"() {
    on(MONDAY);
    const cases = [
      ["Training jeden Dienstag 18:00", "Training", "2026-10-06", "18:00", "19:00", rule("weekly")],
      ["Training jeden Di 18 Uhr", "Training", "2026-10-06", "18:00", "19:00", rule("weekly")],
      ["Training jeden Di. 18 Uhr", "Training", "2026-10-06", "18:00", "19:00", rule("weekly")],
      ["Jeden Montag Training 15 Uhr", "Training", MONDAY, "15:00", "16:00", rule("weekly")],
      ["Training dienstags 18 Uhr", "Training", "2026-10-06", "18:00", "19:00", rule("weekly")],
      ["Chor immer donnerstags 17:30", "Chor", "2026-10-08", "17:30", "18:30", rule("weekly")],
      ["Training jeden Dienstag abends 7 Uhr", "Training", "2026-10-06", "19:00", "20:00", rule("weekly")],
      ["Nachhilfe wöchentlich Do 16 Uhr", "Nachhilfe", "2026-10-08", "16:00", "17:00", rule("weekly")],
      ["Lerngruppe jede Woche 16 Uhr", "Lerngruppe", MONDAY, "16:00", "17:00", rule("weekly")],
      ["Mathe-Nachhilfe alle 2 Wochen Freitag 15 Uhr", "Mathe-Nachhilfe", "2026-10-09", "15:00", "16:00", rule("weekly", 2)],
      ["Orchester alle zwei Wochen 19 Uhr", "Orchester", MONDAY, "19:00", "20:00", rule("weekly", 2)],
      ["Lerngruppe jeden zweiten Mittwoch 16 Uhr", "Lerngruppe", "2026-10-07", "16:00", "17:00", rule("weekly", 2)],
      ["Putzen alle 14 Tage Sa", "Putzen", "2026-10-10", null, null, rule("weekly", 2)],
      ["Lauftreff 14-tägig Mi 18 Uhr", "Lauftreff", "2026-10-07", "18:00", "19:00", rule("weekly", 2)],
      ["Vokabeln täglich 7 Uhr", "Vokabeln", MONDAY, "07:00", "08:00", rule("daily")],
      ["Vokabeln jeden Tag 7 Uhr", "Vokabeln", MONDAY, "07:00", "08:00", rule("daily")],
      ["Blumen gießen alle 3 Tage", "Blumen gießen", MONDAY, null, null, rule("daily", 3)],
      ["Taschengeld jeden Monat am 1.11.", "Taschengeld", "2026-11-01", null, null, rule("monthly")],
      ["Oma anrufen monatlich", "Oma anrufen", MONDAY, null, null, rule("monthly")],
      ["Geburtstag Lea jedes Jahr 14.12.", "Geburtstag Lea", "2026-12-14", null, null, rule("yearly")],
      ["Dosenpfand wegbringen jeden Do 15 Uhr", "Dosenpfand wegbringen", "2026-10-08", "15:00", "16:00", rule("weekly")],
      ["Lesen, also jeden Sonntag 10 Uhr", "Lesen, also", "2026-10-11", "10:00", "11:00", rule("weekly")],
      ["Training jeden Montag, so 18 Uhr", "Training", MONDAY, "18:00", "19:00", rule("weekly")],
      ["Gitarre jeden Mittwochabend 17 Uhr", "Gitarre", "2026-10-07", "17:00", "18:00", rule("weekly")],
      ["Gitarre jeden Mittwochabend 7 Uhr", "Gitarre", "2026-10-07", "19:00", "20:00", rule("weekly")],
      ["Gitarre mittwochabends 7 Uhr", "Gitarre", "2026-10-07", "19:00", "20:00", rule("weekly")],
      ["Joggen jeden Samstagmorgen 8 Uhr", "Joggen", "2026-10-10", "08:00", "09:00", rule("weekly")],
    ];
    for (const [text, title, date, start, end, recurrence] of cases) {
      assert.deepEqual(parseEntry(text), { title, date, start, end, kind: parseEntry(text).kind, recurrence }, text);
    }
    assert.equal(parseEntry("Training jeden Dienstag 18:00").kind, "training");
  },
  "a weekday rhythm counts from the day the calendar has open"() {
    on(MONDAY);
    assert.equal(parseEntry("Training jeden Dienstag 18:00", "2026-10-21").date, "2026-10-27");
    assert.equal(parseEntry("Training jeden Mittwoch 18:00", "2026-10-21").date, "2026-10-21");
    assert.equal(parseEntry("Training wöchentlich 18:00", "2026-10-21").date, "2026-10-21");
  },
  "several weekdays, a second rhythm or other words for jeden make no series and keep their words"() {
    on(MONDAY);
    const cases = [
      ["Training jeden Mo und Mi 18 Uhr", "Training jeden Mo und Mi", MONDAY, "18:00"],
      ["Training montags und mittwochs 18 Uhr", "Training montags und mittwochs", MONDAY, "18:00"],
      ["Training jeden Montag bis Freitag 18 Uhr", null, null, "18:00"],
      ["Gym jeden Mo, Mi, Fr 7 Uhr", "Gym jeden Mo, Mi, Fr", MONDAY, "07:00"],
      ["Jeden Morgen lesen 15 Uhr", "Jeden Morgen lesen", MONDAY, "15:00"],
      ["Training jeden Dienstag monatlich", null, null, null],
      ["Dienstags-Treff 18 Uhr", "Dienstags-Treff", MONDAY, "18:00"],
      ["So viel lernen jeden so 15 Uhr", null, null, "15:00"],
      ["Training jeden Mo 18 Uhr und Mi 19 Uhr", "Training jeden Mo und Mi 19 Uhr", MONDAY, "18:00"],
      ["Training jeden Montag 18 Uhr, Mittwoch 19 Uhr", "Training jeden Montag , Mittwoch 19 Uhr", MONDAY, "18:00"],
      ["Training montags 18 Uhr, mittwochs 19 Uhr", "Training montags , mittwochs 19 Uhr", MONDAY, "18:00"],
      ["Training jeden Montagabend und Mittwochabend 18 Uhr", "Training jeden Montagabend und Mittwochabend", MONDAY, "18:00"],
      ["Training Mo und jeden Mi 18 Uhr", "Training Mo und jeden Mi", MONDAY, "18:00"],
      ["Training jeden mo und mi 18 Uhr", "Training jeden mo und mi", MONDAY, "18:00"],
      ["training jeden di und do 17 uhr", "training jeden di und do", MONDAY, "17:00"],
      ["Training jeden Mo und mi 18 Uhr", "Training jeden Mo und mi", MONDAY, "18:00"],
      ["Training mo und jeden mi 18 Uhr", "Training mo und jeden mi", MONDAY, "18:00"],
      ["Training jeden Mo 18 Uhr und mi 19 Uhr", "Training jeden Mo und mi 19 Uhr", MONDAY, "18:00"],
      ["Training jeden mo 18 Uhr und mi 19 Uhr", "Training jeden mo und mi 19 Uhr", MONDAY, "18:00"],
      ["Training jeden Montag 18 Uhr, mi 19 Uhr", "Training jeden Montag , mi 19 Uhr", MONDAY, "18:00"],
      ["Training jeden MO und MI 18 Uhr", "Training jeden MO und MI", MONDAY, "18:00"],
      ["Training MO und jeden Mi 18 Uhr", "Training MO und jeden Mi", MONDAY, "18:00"],
    ];
    for (const [text, title, date, start] of cases) {
      const entry = parseEntry(text);
      assert.equal(entry.recurrence, undefined, text);
      if (title) assert.equal(entry.title, title, text);
      if (date) assert.equal(entry.date, date, text);
      assert.equal(entry.start, start, text);
    }
  },
  "the chips name the rhythm"() {
    assert.equal(repeatWords({ date: "2026-10-06", recurrence: rule("weekly") }), "Jeden Dienstag");
    assert.equal(repeatWords({ date: "2026-10-06", recurrence: rule("weekly", 2) }), "Alle 2 Wochen");
    assert.equal(repeatWords({ date: "2026-10-06", recurrence: rule("daily") }), "Jeden Tag");
    assert.equal(repeatWords({ date: "2026-10-06" }), "");
  },
  "the sheet Neu picks an event for a time and keeps the rest as before"() {
    on(MONDAY);
    const cases = [
      ["Zahnarzt Do 15:30–16:15", "event"], ["Zahnarzt Do 15:30-16:15", "event"], ["Kino um 17 Uhr", "event"], ["Kino 20 Uhr", "event"],
      ["Training jeden Dienstag 18:00", "event"], ["Treffen morgen 9.30 Uhr", "event"],
      ["Mathe Vektoren S. 38 Nr. 4 bis Freitag", "task"], ["Vokabeln lernen", "task"], ["Mathe Mo 2. Block", "task"], ["Abgabe am 12.11.", "task"],
      ["Mathe Aufgabe 3 bis 5 machen", "task"], ["Kapitel 12.5 lesen", "task"], ["Mathe lernen bis 18 Uhr", "task"], ["Referat fertig bis 17:00", "task"],
      ["Kino von 20 bis 22 Uhr", "event"],
      ["Hausaufgabe Mathe bis 17 Uhr", "homework"], ["Idee: Kino um 20 Uhr", "idea"],
    ];
    for (const [text, type] of cases) assert.equal(suggestedType(text), type, text);
  },
});

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
