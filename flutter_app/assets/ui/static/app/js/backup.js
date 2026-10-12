export const VERSION = 2;
export const KINDS = ["deadlines", "tasks", "grades", "notes", "events"];
export const PLACES = ["home", "school"];

const WEEKS = ["A", "B"];
const DAYS = ["1", "2", "3", "4", "5"];
const COURSES = ["LK", "GK", "SK"];
const TITLES = ["Frau", "Herr"];
const KEYS = {
  lessons: "app-timetable-edits",
  blocks: "app-block-times",
  swap: "app-ab-swap",
  weeks: "app-ab-weeks",
  subjects: "app-subjects",
  teachers: "app-teachers",
  rooms: "app-rooms",
};
const DEADLINE_WORDS = { Hausaufgabe: ["Hausaufgabe", "Hausaufgaben"], Test: ["Test", "Tests"], Klausur: ["Klausur", "Klausuren"], Vortrag: ["Vortrag", "Vorträge"] };
const KIND_WORDS = { tasks: ["Aufgabe", "Aufgaben"], grades: ["Note", "Noten"], notes: ["Notiz", "Notizen"], events: ["Termin", "Termine"], places: ["Ort", "Orte"] };

const record = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const records = (value) => (Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : []);
const words = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
const text = (value) => (typeof value === "string" ? value : "");
const norm = (name) => text(name).trim().toLowerCase().replace(/\s+(lk|gk|sk)$/, "");
const plain = (name) => text(name).replace(/\s+(LK|GK)$/, "");
const slug = (name) => text(name).toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const numeric = (key) => /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(key);
const count = (number, [one, many]) => `${number}\u00a0${number === 1 ? one : many}`;
const list = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} und ${parts.at(-1)}` : parts.join(""));

function eachEntry(timetable, visit) {
  Object.values(record(timetable)).forEach((days) => Object.values(record(days)).forEach((entries) => records(entries).forEach(visit)));
}

export function fileKeys(subjects) {
  const keys = new Map();
  const used = new Set(Object.keys(subjects).filter((key) => !numeric(key)));
  Object.entries(subjects).forEach(([key, info]) => {
    if (!numeric(key)) {
      keys.set(key, key);
      return;
    }
    const stem = `s-${slug(norm(info.name)) || "fach"}`;
    let fresh = stem;
    for (let n = 2; used.has(fresh); n += 1) fresh = `${stem}-${n}`;
    used.add(fresh);
    keys.set(key, fresh);
  });
  return keys;
}

export function fileSubjects(base, keys) {
  return Object.fromEntries(Object.entries(base).map(([key, info]) => [keys.get(key) || key, info.name]));
}

export function fileRecords(data, keys) {
  const moved = (item) => (keys.has(item.subject) ? { ...item, subject: keys.get(item.subject) } : item);
  return { ...data, tasks: records(data.tasks).map(moved), deadlines: records(data.deadlines).map(moved), grades: records(data.grades).map(moved) };
}

export function wholeSchool({ subjects, teachers, rooms, blocks, timetable, edits, gone, weeks }) {
  const people = new Set(teachers.map((teacher) => teacher.id));
  const keys = fileKeys(subjects);
  const own = record(edits);
  const items = {};
  const retired = [];
  Object.entries(subjects).forEach(([key, info]) => {
    items[keys.get(key)] = {
      custom: true,
      name: info.type === "LK" ? info.name.replace(/\s+LK$/, "") : info.name,
      short: info.short,
      hue: info.hue,
      type: info.type,
      teacher: info.teacherId || "",
      room: info.room || "",
    };
    if (info.retired) retired.push(keys.get(key));
  });
  const cells = {};
  WEEKS.forEach((week) => DAYS.forEach((dow) => blocks.forEach(({ n }) => {
    const cell = `${week}:${dow}:${n}`;
    const entry = (timetable[week]?.[dow] || []).find((item) => item.block === n);
    if (!entry) {
      cells[cell] = null;
      return;
    }
    const chosen = record(own[cell]).subject === entry.subject ? own[cell].teacher : "";
    const teacher = people.has(chosen) && chosen !== subjects[entry.subject]?.teacherId ? chosen : "";
    cells[cell] = { subject: keys.get(entry.subject) || entry.subject, room: entry.room || "", ...(teacher ? { teacher } : {}) };
  })));
  return {
    [KEYS.subjects]: { items, removed: retired },
    [KEYS.teachers]: { items: Object.fromEntries(teachers.map((teacher) => [teacher.id, { title: teacher.title || "", name: teacher.name, custom: true }])), removed: words(gone?.teachers) },
    [KEYS.rooms]: { added: [...rooms], removed: words(gone?.rooms) },
    [KEYS.blocks]: { v: 2, blocks: blocks.map(({ n, start, end }) => ({ n, start, end })) },
    [KEYS.lessons]: cells,
    [KEYS.weeks]: weeks !== false,
  };
}

function baseSchool(target) {
  const subjects = record(target.subjects);
  const teachers = new Map();
  const firstTeacher = new Map();
  const roomCounts = new Map();
  const rooms = new Set();
  eachEntry(target.timetable, (entry) => {
    if (entry.teacher) {
      const id = `t-${slug(entry.teacher)}`;
      if (!teachers.has(id)) {
        const match = /^(Frau|Herr)\s+(.+)$/.exec(entry.teacher);
        teachers.set(id, { title: match ? match[1] : "", name: match ? match[2] : entry.teacher });
      }
      if (!firstTeacher.has(entry.subject)) firstTeacher.set(entry.subject, id);
    }
    if (entry.room) {
      rooms.add(entry.room);
      const counts = roomCounts.get(entry.subject) || new Map();
      counts.set(entry.room, (counts.get(entry.room) || 0) + 1);
      roomCounts.set(entry.subject, counts);
    }
  });
  const typeOf = (key) => {
    const type = record(target.courses)[key]?.type;
    if (COURSES.includes(type)) return type;
    return /\sLK$/.test(subjects[key].label || subjects[key].name || "") ? "LK" : "GK";
  };
  const info = (key) => ({
    name: text(subjects[key].name),
    short: subjects[key].short,
    hue: subjects[key].hue,
    type: typeOf(key),
    teacher: firstTeacher.get(key) || "",
    room: [...(roomCounts.get(key) || new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "",
  });
  return { subjects, teachers, rooms, info };
}

function subjectKeys(items, base, origin, own) {
  const there = (key) => (base.subjects[key] ? base.info(key) : own[key] || null);
  const open = new Map();
  [...Object.keys(base.subjects), ...Object.keys(own)].forEach((key) => {
    const name = norm(there(key).name);
    open.set(name, [...(open.get(name) || []), key]);
  });
  const keys = new Map();
  const used = new Set();
  const take = (from, key) => {
    keys.set(from, key);
    used.add(key);
  };
  const waiting = Object.keys(items).filter((key) => text(record(items[key]).name).trim());
  const names = (key) => [items[key].name, origin[key]].filter((name) => text(name).trim()).map(norm);
  waiting.forEach((key) => {
    if (there(key) && names(key).includes(norm(there(key).name))) take(key, key);
  });
  waiting.forEach((key) => {
    if (keys.has(key)) return;
    const same = names(key).flatMap((name) => open.get(name) || []).filter((candidate) => !used.has(candidate));
    const match = same.find((candidate) => there(candidate).type === items[key].type) || same[0];
    if (match) take(key, match);
  });
  waiting.forEach((key) => {
    if (keys.has(key)) return;
    let fresh = key;
    if (there(fresh) || used.has(fresh) || numeric(fresh)) {
      const stem = `s-${slug(items[key].name) || "fach"}`;
      fresh = stem;
      for (let n = 2; there(fresh) || used.has(fresh); n += 1) fresh = `${stem}-${n}`;
    }
    take(key, fresh);
  });
  return keys;
}

function fittedSubject(own, base) {
  const item = {};
  const type = COURSES.includes(own.type) ? own.type : base.type;
  const wanted = `${text(own.name).trim()}${type === "LK" ? " LK" : ""}`;
  const unnamed = type === base.type ? base.name : `${plain(base.name)}${type === "LK" ? " LK" : ""}`;
  if (wanted !== unnamed) item.name = text(own.name).trim();
  if (type !== base.type) item.type = type;
  if (text(own.short).trim() && own.short !== base.short) item.short = own.short;
  if (own.hue !== base.hue) item.hue = own.hue;
  if (typeof own.teacher === "string" && own.teacher !== base.teacher) item.teacher = own.teacher;
  if (typeof own.room === "string" && own.room !== base.room) item.room = own.room;
  return item;
}

const weekAt = (reference, probe) => {
  const [year, month, day] = String(reference).split("-").map(Number);
  const days = Math.round((probe - Date.UTC(year, month - 1, day)) / 864e5);
  return Math.abs(Math.floor(days / 7) % 2);
};

export function fitSchool(values, source, target) {
  const base = baseSchool(target);
  const result = { ...values };
  const saved = record(values[KEYS.subjects]);
  const sourceItems = record(saved.items);
  const mine = record(record(target.own).subjects);
  const ownItems = Object.fromEntries(Object.entries(record(mine.items)).filter(([key, item]) => !base.subjects[key] && item?.custom && text(item.name).trim()));
  const keys = subjectKeys(sourceItems, base, record(source?.subjects), ownItems);
  const taken = new Set(keys.values());

  const items = {};
  keys.forEach((key, from) => {
    const item = base.subjects[key] ? fittedSubject(sourceItems[from], base.info(key)) : { ...sourceItems[from], custom: true };
    if (Object.keys(item).length) items[key] = item;
  });
  Object.entries(ownItems).forEach(([key, item]) => {
    if (!taken.has(key)) items[key] = item;
  });
  const retired = [...words(saved.removed).map((key) => keys.get(key)).filter(Boolean), ...words(mine.removed).filter((key) => !taken.has(key))];
  if (Object.keys(items).length || retired.length) result[KEYS.subjects] = { items, removed: retired };
  else delete result[KEYS.subjects];

  const savedTeachers = record(values[KEYS.teachers]);
  const people = {};
  Object.entries(record(savedTeachers.items)).forEach(([id, value]) => {
    if (!value || typeof value.name !== "string" || !value.name.trim()) return;
    const title = TITLES.includes(value.title) ? value.title : "";
    const known = base.teachers.get(id);
    if (!known) people[id] = { title, name: value.name, custom: true };
    else if (known.title !== title || known.name !== value.name) people[id] = { title, name: value.name };
  });
  Object.entries(record(record(record(target.own).teachers).items)).forEach(([id, value]) => {
    if (!record(savedTeachers.items)[id] && !base.teachers.has(id) && value?.custom) people[id] = value;
  });
  const goneTeachers = words(savedTeachers.removed);
  if (Object.keys(people).length || goneTeachers.length) result[KEYS.teachers] = { items: people, removed: goneTeachers };
  else delete result[KEYS.teachers];

  const savedRooms = record(values[KEYS.rooms]);
  const added = [...new Set([...words(savedRooms.added), ...words(record(record(target.own).rooms).added)])].filter((room) => !base.rooms.has(room));
  const goneRooms = words(savedRooms.removed);
  if (added.length || goneRooms.length) result[KEYS.rooms] = { added, removed: goneRooms };
  else delete result[KEYS.rooms];

  const savedBlocks = record(values[KEYS.blocks]);
  const blocks = savedBlocks.v === 2 && Array.isArray(savedBlocks.blocks) && savedBlocks.blocks.length ? savedBlocks.blocks : null;
  const baseBlocks = Array.isArray(target.blocks) ? target.blocks : [];
  const sameBlocks = blocks && blocks.length === baseBlocks.length && blocks.every((block, index) => block?.n === baseBlocks[index].n && block.start === baseBlocks[index].start && block.end === baseBlocks[index].end);
  if (!blocks || sameBlocks) delete result[KEYS.blocks];
  const visible = new Set((blocks && !sameBlocks ? blocks : baseBlocks).map((block) => block?.n));

  const lost = new Set(retired);
  const active = (key) => (!!base.subjects[key] || !!items[key]?.custom) && !lost.has(key);
  const cells = {};
  Object.entries(record(values[KEYS.lessons])).forEach(([cell, value]) => {
    const match = /^([AB]):([1-5]):(\d{1,2})$/.exec(cell);
    if (!match || !visible.has(Number(match[3]))) return;
    const there = records(record(record(target.timetable)[match[1]])[match[2]]).find((entry) => entry.block === Number(match[3]) && active(entry.subject));
    if (value === null) {
      if (there) cells[cell] = null;
      return;
    }
    const subject = keys.get(record(value).subject);
    if (!subject || !active(subject)) {
      if (there) cells[cell] = null;
      return;
    }
    const room = text(value.room).trim().slice(0, 12);
    const teacher = text(value.teacher);
    if (there && there.subject === subject && text(there.room).trim().slice(0, 12) === room && !teacher) return;
    cells[cell] = { subject, room, ...(teacher ? { teacher } : {}) };
  });
  if (Object.keys(cells).length) result[KEYS.lessons] = cells;
  else delete result[KEYS.lessons];

  if (values[KEYS.weeks] === false) result[KEYS.weeks] = false;
  else delete result[KEYS.weeks];

  const probe = Date.UTC(2026, 0, 5);
  const shifted = /^\d{4}-\d{2}-\d{2}$/.test(source?.abReference || "") && /^\d{4}-\d{2}-\d{2}$/.test(target.abReference || "")
    && weekAt(source.abReference, probe) !== weekAt(target.abReference, probe);
  if (shifted) result[KEYS.swap] = true;
  else delete result[KEYS.swap];

  return { values: result, keys, retired };
}

const MARKS = {
  tasks: (item) => [item.title, item.subject || "", item.date || "", item.dueTime || "", item.someday ? 1 : 0],
  deadlines: (item) => [item.kind, item.title, item.subject || "", item.date, item.time || ""],
  grades: (item) => [item.subject, item.points, item.type, item.semester, item.date, item.title || ""],
  notes: (item) => [item.type === "idea" ? "idea" : "note", item.title, text(item.details).slice(0, 200)],
  events: (item) => [item.title, item.date, item.start || ""],
};

const mark = (kind, item) => JSON.stringify(MARKS[kind](item));
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(text(value));
const titled = (item) => !!text(item.title).trim();

const USABLE = {
  tasks: (item) => titled(item) && !item.done,
  deadlines: (item) => titled(item) && isDay(item.date) && Object.hasOwn(DEADLINE_WORDS, item.kind),
  grades: (item) => !!item.subject && Number.isInteger(item.points) && item.points >= 0 && item.points <= 15 && isDay(item.date),
  notes: titled,
  events: (item) => titled(item) && isDay(item.date),
};

export const BODIES = {
  deadlines: (item) => ({
    kind: item.kind,
    title: item.title,
    subject: item.subject || "",
    date: item.date,
    detail: text(item.detail),
    ...(item.kind === "Hausaufgabe" ? { status: item.status === "abgegeben" ? "abgegeben" : "offen" } : item.time ? { time: item.time } : {}),
  }),
  tasks: (item, refs) => ({
    title: item.title,
    subject: item.subject || null,
    date: item.someday ? null : item.date || null,
    someday: !!item.someday,
    ...(item.dueTime ? { dueTime: item.dueTime } : {}),
    ...(Number.isInteger(item.minutes) ? { minutes: item.minutes } : {}),
    priority: !!item.priority,
    ...(item.repeat ? { repeat: item.repeat } : {}),
    notes: text(item.notes),
    ...(refs?.get(item.deadline) ? { deadline: refs.get(item.deadline) } : {}),
    source: item.source === "iserv" ? "iserv" : "own",
  }),
  grades: (item) => ({ subject: item.subject, points: item.points, type: item.type, date: item.date, title: text(item.title), semester: text(item.semester) }),
  notes: (item) => ({ title: item.title, details: text(item.details), type: item.type === "idea" ? "idea" : "note", ...(item.created ? { created: item.created } : {}) }),
  events: (item) => ({
    title: item.title,
    date: item.date,
    ...(isDay(item.endDate) ? { endDate: item.endDate } : {}),
    ...(item.start ? { start: item.start } : {}),
    ...(item.end ? { end: item.end } : {}),
    place: text(item.place),
    notes: text(item.notes),
    kind: item.kind || "private",
  }),
};

function placeBody(value) {
  const place = record(value);
  if (!text(place.name).trim() || typeof place.lat !== "number" || typeof place.lon !== "number") return null;
  return { name: place.name, area: text(place.area), lat: place.lat, lon: place.lon, stop: text(place.stop) };
}

const placeLine = (place) => (place.area && !place.name.includes(place.area) ? `${place.name}, ${place.area}` : place.name);
const samePlace = (one, other) => one.lat === other.lat && one.lon === other.lon && one.stop === other.stop && (!!one.stop || placeLine(one) === placeLine(other));

export function recordPlan(file, mine, keys, { google = false, synced = [] } = {}) {
  const theirs = record(file);
  const here = record(mine);
  const moved = (item) => {
    if (!item.subject) return item;
    const subject = keys ? keys.get(item.subject) : item.subject;
    return { ...item, subject: subject || null };
  };
  const plan = { skipped: 0, places: [] };
  KINDS.forEach((kind) => {
    const have = new Map();
    const existing = kind === "events" ? [...records(here.events), ...records(synced)] : records(here[kind]);
    existing.forEach((item) => {
      const key = mark(kind, item);
      have.set(key, [...(have.get(key) || []), item]);
    });
    const fresh = [];
    const known = [];
    records(theirs[kind]).forEach((raw) => {
      if (!USABLE[kind](raw)) return;
      if (kind === "events" && raw.google && google) return;
      const item = ["notes", "events"].includes(kind) ? raw : moved(raw);
      if (kind === "grades" && !item.subject) {
        plan.skipped += 1;
        return;
      }
      const pile = have.get(mark(kind, item));
      if (pile?.length) known.push([item, pile.shift()]);
      else fresh.push(item);
    });
    plan[kind] = { fresh, known };
  });
  PLACES.forEach((key) => {
    const wanted = placeBody(record(theirs.places)[key]);
    if (!wanted) return;
    const current = placeBody(record(here.places)[key]);
    if (current && samePlace(current, wanted)) return;
    plan.places.push([key, wanted, current]);
  });
  return plan;
}

export function planSize(plan) {
  return KINDS.reduce((sum, kind) => sum + plan[kind].fresh.length, plan.places.length);
}

export function subjectsInUse(plan) {
  const used = new Set();
  ["deadlines", "tasks", "grades"].forEach((kind) => plan[kind].fresh.forEach((item) => item.subject && used.add(item.subject)));
  return used;
}

export function summary({ settings = false, made = {}, known = 0, failed = 0, unread = false } = {}) {
  const parts = [];
  if (settings) parts.push("Stundenplan und Einstellungen");
  if (made.grades) parts.push(count(made.grades, KIND_WORDS.grades));
  Object.entries(DEADLINE_WORDS).forEach(([kind, forms]) => {
    if (made[kind]) parts.push(count(made[kind], forms));
  });
  ["tasks", "notes", "events", "places"].forEach((kind) => {
    if (made[kind]) parts.push(count(made[kind], KIND_WORDS[kind]));
  });
  const sentences = [parts.length ? `Übernommen: ${list(parts)}.` : "Nichts Neues übernommen."];
  if (known) sentences.push(known === 1 ? "1\u00a0Eintrag war schon da." : `${known}\u00a0Einträge waren schon da.`);
  if (failed) sentences.push(failed === 1 ? "1\u00a0Eintrag ließ sich nicht übernehmen." : `${failed}\u00a0Einträge ließen sich nicht übernehmen.`);
  if (unread) sentences.push("Noten, Aufgaben und Termine ließen sich gerade nicht übernehmen.");
  return sentences.join(" ");
}
