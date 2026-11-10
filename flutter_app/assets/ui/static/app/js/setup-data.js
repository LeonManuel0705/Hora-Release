// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export const STATES = [
  ["BW", "Baden-Württemberg"], ["BY", "Bayern"], ["BE", "Berlin"], ["BB", "Brandenburg"], ["HB", "Bremen"],
  ["HH", "Hamburg"], ["HE", "Hessen"], ["MV", "Mecklenburg-Vorpommern"], ["NI", "Niedersachsen"],
  ["NW", "Nordrhein-Westfalen"], ["RP", "Rheinland-Pfalz"], ["SL", "Saarland"], ["SN", "Sachsen"],
  ["ST", "Sachsen-Anhalt"], ["SH", "Schleswig-Holstein"], ["TH", "Thüringen"],
];

export const GRADES = [5, 6, 7, 8, 9, 10, 11, 12, 13];
export const upperSchool = (grade) => grade >= 11;
export const scaleText = (grade) => (upperSchool(grade) ? "in Punkten von 0 bis 15" : "in Noten von 1 bis 6");

const subject = (name, short, hue, group, type = "GK") => ({ name, short, hue, group, type });

export const GROUPS = [["lang", "Sprachen und Künste"], ["society", "Gesellschaft"], ["science", "Mathematik und Naturwissenschaften"], ["more", "Weitere"]];

// The courses of the gymnasiale Oberstufe in Brandenburg, plus Ethik, which most other states teach there.
export const UPPER = [
  subject("Deutsch", "Deu", "brick", "lang"), subject("Englisch", "Eng", "rose", "lang"), subject("Französisch", "Fra", "lake", "lang"),
  subject("Spanisch", "Spa", "ochre", "lang"), subject("Latein", "Lat", "olive", "lang"), subject("Russisch", "Rus", "plum", "lang"),
  subject("Polnisch", "Pln", "orchid", "lang"), subject("Kunst", "Kun", "orchid", "lang"), subject("Musik", "Mus", "plum", "lang"),
  subject("Darstellendes Spiel", "DS", "iris", "lang"),
  subject("Geschichte", "Ges", "ochre", "society"), subject("Politische Bildung", "PB", "teal", "society"), subject("Geografie", "Geo", "moss", "society"),
  subject("Wirtschaftswissenschaft", "Wiwi", "olive", "society"), subject("Psychologie", "Psy", "iris", "society"), subject("Philosophie", "Phi", "lake", "society"),
  subject("Recht", "Rec", "slate", "society"), subject("Religion", "Rel", "lake", "society"), subject("Ethik", "Eth", "lake", "society"),
  subject("Mathematik", "Mat", "slate", "science"), subject("Biologie", "Bio", "jade", "science"), subject("Chemie", "Che", "teal", "science"),
  subject("Physik", "Phy", "iris", "science"), subject("Informatik", "Inf", "lake", "science"),
  subject("Sport", "Spo", "moss", "more"), subject("Seminarkurs", "Sem", "olive", "more", "SK"),
];

export const LOWER = [
  subject("Deutsch", "Deu", "brick", "lang"), subject("Englisch", "Eng", "rose", "lang"), subject("Französisch", "Fra", "lake", "lang"),
  subject("Spanisch", "Spa", "ochre", "lang"), subject("Latein", "Lat", "olive", "lang"), subject("Russisch", "Rus", "plum", "lang"),
  subject("Polnisch", "Pln", "orchid", "lang"), subject("Kunst", "Kun", "orchid", "lang"), subject("Musik", "Mus", "plum", "lang"),
  subject("Darstellendes Spiel", "DS", "iris", "lang"),
  subject("Geschichte", "Ges", "ochre", "society"), subject("Politische Bildung", "PB", "teal", "society"), subject("Geografie", "Geo", "moss", "society"),
  subject("Gesellschaftswissenschaften", "GeWi", "ochre", "society"), subject("LER", "LER", "lake", "society"), subject("Religion", "Rel", "lake", "society"),
  subject("Ethik", "Eth", "lake", "society"), subject("Philosophie", "Phi", "lake", "society"),
  subject("Mathematik", "Mat", "slate", "science"), subject("Biologie", "Bio", "jade", "science"), subject("Chemie", "Che", "teal", "science"),
  subject("Physik", "Phy", "iris", "science"), subject("Naturwissenschaften", "NaWi", "jade", "science"), subject("Informatik", "Inf", "lake", "science"),
  subject("WAT", "WAT", "brick", "more"), subject("Sport", "Spo", "moss", "more"),
];

export const catalogFor = (grade) => (upperSchool(grade) ? UPPER : LOWER);

export const plainName = (text) => String(text || "").replace(/\s+(LK|GK)$/, "").trim();
export const sameName = (a, b) => plainName(a).toLocaleLowerCase("de") === plainName(b).toLocaleLowerCase("de");

export function suggestShort(name, taken = []) {
  const known = [...UPPER, ...LOWER].find((item) => sameName(item.name, name));
  const letters = plainName(name).replace(/[^A-Za-zÄÖÜäöüß]/g, "");
  const first = known ? known.short : (letters.charAt(0).toUpperCase() + letters.slice(1, 3)) || "Fach";
  const used = new Set(taken.map((item) => item.toLowerCase()));
  if (!used.has(first.toLowerCase())) return first;
  for (let length = 4; length >= 2; length -= 1) {
    const other = letters.charAt(0).toUpperCase() + letters.slice(1, length);
    if (!used.has(other.toLowerCase())) return other;
  }
  for (let index = 2; index < 10; index += 1) if (!used.has(`${first.slice(0, 3)}${index}`.toLowerCase())) return `${first.slice(0, 3)}${index}`;
  return first;
}

export function pickHue(wanted, used, hues) {
  const taken = new Set(used);
  if (hues.includes(wanted) && !taken.has(wanted)) return wanted;
  return hues.find((hue) => !taken.has(hue)) || (hues.includes(wanted) ? wanted : hues[0]);
}

const pad = (n) => String(n).padStart(2, "0");
export const clockOf = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
export const minutesOfClock = (text) => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text || "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

export const TEMPLATES = {
  45: { length: 45, count: 8, most: 12, small: 5, big: 20 },
  90: { length: 90, count: 4, most: 6, small: 10, big: 20 },
};

// Single periods get a long break after every second one, double periods after the first and a lunch break after the third.
function gapAfter(length, index, small, big) {
  if (length === 90) return index === 1 ? big : index === 3 ? big + 10 : small;
  return index === 2 || index === 4 || index === 6 ? big : small;
}

export function blockTimes({ length, start = "08:00", count, small, big }) {
  const from = minutesOfClock(start);
  if (from == null || !TEMPLATES[length]) return [];
  const blocks = [];
  let at = from;
  for (let n = 1; n <= count; n += 1) {
    if (at + length > 23 * 60 + 59) break;
    blocks.push({ n, start: clockOf(at), end: clockOf(at + length) });
    at += length + gapAfter(length, n, small, big);
  }
  return blocks;
}

export function templateOf(blocks) {
  if (!blocks.length) return null;
  const lengths = new Set(blocks.map((block) => minutesOfClock(block.end) - minutesOfClock(block.start)));
  if (lengths.size !== 1) return null;
  const [length] = lengths;
  return TEMPLATES[length] ? length : null;
}

const mondayOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1 - (date.getDay() || 7));
const dayOf = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export function weekLetter(date, reference) {
  const days = Math.round((mondayOf(date) - dayOf(reference)) / 864e5);
  return Math.floor(days / 7) % 2 === 0 ? "A" : "B";
}

// Whether the stored A/B swap must be on so that the week of `date` is the one the student named.
export const swapFor = (letter, date, reference) => weekLetter(date, reference) !== letter;

export function parseTeacher(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const match = /^(frau|fr\.?|herr|hr\.?)\s+(.+)$/i.exec(clean);
  if (!match) return clean ? { title: "", name: clean.slice(0, 40) } : null;
  return { title: /^f/i.test(match[1]) ? "Frau" : "Herr", name: match[2].slice(0, 40) };
}

export function normalizeRoom(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, 12);
  if (/^[a-z]{1,3}[ -]?\d/i.test(text)) return text.toUpperCase();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

export const cellKey = (week, dow, n) => `${week}:${dow}:${n}`;
const entryIn = (timetable, week, dow, n) => (timetable?.[week]?.[String(dow)] || []).find((entry) => entry.block === n) || null;

// The same rule as the plan editor in the settings: an edit is only kept where it differs from the stored plan.
export function setLesson(edits, base, week, dow, n, value) {
  const key = cellKey(week, dow, n);
  const stored = entryIn(base, week, dow, n);
  const plain = !!value && !value.teacher && !!stored && value.subject === stored.subject && (value.room || "") === (stored.room || "");
  if (plain || (!value && !stored)) delete edits[key];
  else edits[key] = value ? { subject: value.subject, room: value.room || "", ...(value.teacher ? { teacher: value.teacher } : {}) } : null;
  return edits;
}

export function copyWeek(edits, base, timetable, blocks, from = "A", to = "B") {
  for (let dow = 1; dow <= 5; dow += 1) {
    blocks.forEach((block) => {
      const entry = entryIn(timetable, from, dow, block.n);
      const own = edits[cellKey(from, dow, block.n)];
      const teacher = own && entry && own.subject === entry.subject && typeof own.teacher === "string" ? own.teacher : "";
      setLesson(edits, base, to, dow, block.n, entry ? { subject: entry.subject, room: entry.room || "", teacher } : null);
    });
  }
  return edits;
}

export function countLessons(timetable, weeks) {
  return weeks.reduce((sum, week) => sum + Object.values(timetable?.[week] || {}).reduce((count, entries) => count + (entries || []).length, 0), 0);
}
