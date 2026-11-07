// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { wholeSchool, fileKeys, fileSubjects, fitSchool } from "./backup.js";

export const FORMAT = 1;
export const PLAN_KEYS = ["app-subjects", "app-teachers", "app-rooms", "app-block-times", "app-timetable-edits", "app-ab-weeks", "app-ab-swap"];

const HUES = ["rose", "ochre", "olive", "moss", "jade", "teal", "lake", "slate", "iris", "orchid", "brick", "plum"];
const TYPES = ["GK", "LK", "SK"];
const TITLES = ["", "Frau", "Herr"];
const DAYS = [1, 2, 3, 4, 5];
const LIMIT = { subjects: 40, teachers: 60, blocks: 16, name: 32, short: 4, room: 12, teacher: 40, json: 65536, payload: 8192 };
const KEYS = { subjects: "app-subjects", teachers: "app-teachers", rooms: "app-rooms", blocks: "app-block-times", lessons: "app-timetable-edits", weeks: "app-ab-weeks" };

export class PlanError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

const record = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const text = (value) => (typeof value === "string" ? value : "");
const norm = (name) => text(name).trim().toLowerCase().replace(/\s+(lk|gk|sk)$/, "");
const plain = (name) => text(name).replace(/\s+(LK|GK)$/, "");
const slug = (name) => text(name).toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const isClock = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(text(value));
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const minutes = (clock) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const clockOf = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const label = (teacher) => [teacher.title, teacher.name].filter(Boolean).join(" ");
const teacherKey = (teacher) => `t-${slug(label(teacher))}`;
const fail = (reason = "damaged") => {
  throw new PlanError(reason);
};

export function planOf({ subjects, teachers, blocks, timetable, edits, weeks, abReference }) {
  const order = [...blocks].sort((a, b) => a.n - b.n);
  const shown = weeks ? ["A", "B"] : ["A"];
  const own = record(edits);
  const people = new Map((teachers || []).map((teacher) => [teacher.id, teacher]));
  const active = (key) => typeof key === "string" && Object.hasOwn(subjects, key) && !subjects[key].retired;
  const used = [];
  shown.forEach((week) => DAYS.forEach((day) => order.forEach(({ n }) => {
    const entry = (timetable?.[week]?.[String(day)] || []).find((item) => item.block === n);
    if (entry && active(entry.subject) && !used.includes(entry.subject)) used.push(entry.subject);
  })));
  const rank = { LK: 0, GK: 1, SK: 2 };
  used.sort((a, b) => (rank[subjects[a].type] ?? 1) - (rank[subjects[b].type] ?? 1) || plain(subjects[a].name).localeCompare(plain(subjects[b].name), "de"));
  const staff = [];
  const staffIndex = (id) => {
    const teacher = people.get(id);
    if (!teacher) return null;
    if (!staff.includes(id)) staff.push(id);
    return staff.indexOf(id);
  };
  const list = used.map((key) => {
    const info = subjects[key];
    return {
      name: (plain(info.name).trim() || text(info.short).trim() || "Fach").slice(0, LIMIT.name).trim(),
      short: text(info.short).trim().slice(0, LIMIT.short).trim(),
      type: TYPES.includes(info.type) ? info.type : "GK",
      hue: HUES.includes(info.hue) ? info.hue : "slate",
      teacher: staffIndex(info.teacherId),
      room: text(info.room).trim().slice(0, LIMIT.room).trim(),
    };
  });
  const lessons = [];
  shown.forEach((week) => DAYS.forEach((day) => order.forEach(({ n }, index) => {
    const entry = (timetable?.[week]?.[String(day)] || []).find((item) => item.block === n);
    const subject = entry ? used.indexOf(entry.subject) : -1;
    if (subject < 0) return;
    const cell = record(own[`${week}:${day}:${n}`]);
    const chosen = cell.subject === entry.subject && cell.teacher !== subjects[entry.subject].teacherId ? staffIndex(cell.teacher) : null;
    lessons.push({ week, day, block: index + 1, subject, room: text(entry.room).trim().slice(0, LIMIT.room).trim(), teacher: chosen });
  })));
  return {
    subjects: list,
    teachers: staff.map((id) => ({ title: TITLES.includes(people.get(id).title) ? people.get(id).title : "", name: text(people.get(id).name).trim().slice(0, LIMIT.teacher).trim() || "?" })),
    blocks: order.slice(0, Math.max(1, ...lessons.map((lesson) => lesson.block))).map(({ start, end }) => ({ start, end })),
    weeks: !!weeks,
    reference: weeks && isDay(abReference) ? abReference : null,
    lessons,
  };
}

export function packPlan(model) {
  const slots = (week) => DAYS.map((day) => model.blocks.map((_, index) => {
    const lesson = model.lessons.find((item) => item.week === week && item.day === day && item.block === index + 1);
    if (!lesson) return 0;
    const room = lesson.room === model.subjects[lesson.subject].room ? null : lesson.room;
    if (lesson.teacher != null) return [lesson.subject + 1, room, lesson.teacher + 1];
    return room == null ? lesson.subject + 1 : [lesson.subject + 1, room];
  }));
  return [
    model.subjects.map((item) => [item.name, item.short, TYPES.indexOf(item.type), HUES.indexOf(item.hue), item.teacher == null ? 0 : item.teacher + 1, item.room]),
    model.teachers.map((item) => [TITLES.indexOf(item.title), item.name]),
    model.blocks.flatMap((block, index) => [minutes(block.start) - (index ? minutes(model.blocks[index - 1].end) : 0), minutes(block.end) - minutes(block.start)]),
    model.weeks ? model.reference || 0 : 0,
    slots("A"),
    ...(model.weeks ? [slots("B")] : []),
  ];
}

const whole = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
const bounded = (value, low, high) => typeof value === "string" && value.trim().length >= low && value.trim().length <= high;

export function unpackPlan(packed) {
  if (!Array.isArray(packed) || packed.length < 5 || packed.length > 6) fail();
  const [subjects, teachers, times, reference, ...weeks] = packed;
  if (!Array.isArray(teachers) || teachers.length > LIMIT.teachers) fail();
  const staff = teachers.map((item) => {
    if (!Array.isArray(item) || item.length !== 2 || !whole(item[0], 0, 2) || !bounded(item[1], 1, LIMIT.teacher)) fail();
    return { title: TITLES[item[0]], name: item[1].trim() };
  });
  if (!Array.isArray(subjects) || !subjects.length || subjects.length > LIMIT.subjects) fail();
  const list = subjects.map((item) => {
    if (!Array.isArray(item) || item.length !== 6) fail();
    const [name, short, type, hue, teacher, room] = item;
    if (!bounded(name, 1, LIMIT.name) || !bounded(short, 0, LIMIT.short) || !whole(type, 0, 2) || !whole(hue, 0, 11) || !whole(teacher, 0, staff.length) || !bounded(room, 0, LIMIT.room)) fail();
    return { name: name.trim(), short: short.trim(), type: TYPES[type], hue: HUES[hue], teacher: teacher ? teacher - 1 : null, room: room.trim() };
  });
  if (!Array.isArray(times) || times.length < 2 || times.length % 2 || times.length > LIMIT.blocks * 2 || !times.every((value) => whole(value, 0, 1439))) fail();
  const blocks = [];
  for (let index = 0, at = 0; index < times.length; index += 2) {
    const start = at + times[index];
    at = start + times[index + 1];
    if (!times[index + 1] || at > 1439) fail();
    blocks.push({ start: clockOf(start), end: clockOf(at) });
  }
  const ab = reference !== 0;
  if (ab && !isDay(reference)) fail();
  if (weeks.length !== (ab ? 2 : 1)) fail();
  const lessons = [];
  weeks.forEach((days, weekIndex) => {
    if (!Array.isArray(days) || days.length !== DAYS.length) fail();
    days.forEach((slots, dayIndex) => {
      if (!Array.isArray(slots) || slots.length !== blocks.length) fail();
      slots.forEach((slot, blockIndex) => {
        if (slot === 0) return;
        const [subject, room = null, teacher = 0] = Array.isArray(slot) ? slot : [slot];
        if (Array.isArray(slot) && (slot.length < 2 || slot.length > 3)) fail();
        if (!whole(subject, 1, list.length) || (room !== null && !bounded(room, 0, LIMIT.room)) || !whole(teacher, 0, staff.length)) fail();
        lessons.push({ week: weekIndex ? "B" : "A", day: DAYS[dayIndex], block: blockIndex + 1, subject: subject - 1, room: room === null ? list[subject - 1].room : room.trim(), teacher: teacher ? teacher - 1 : null });
      });
    });
  });
  if (!lessons.length) fail("empty");
  return { subjects: list, teachers: staff, blocks, weeks: ab, reference: ab ? reference : null, lessons };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function toBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) fail();
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function streamed(bytes, transform, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(transform).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      reader.cancel().catch(() => {});
      fail();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  chunks.forEach((chunk) => {
    out.set(chunk, at);
    at += chunk.length;
  });
  return out;
}

export async function encodePlan(model) {
  if (typeof CompressionStream !== "function") fail("unsupported");
  const json = new TextEncoder().encode(JSON.stringify(packPlan(model)));
  const packed = await streamed(json, new CompressionStream("deflate-raw"));
  const envelope = new Uint8Array(5 + packed.length);
  envelope[0] = FORMAT;
  new DataView(envelope.buffer).setUint32(1, crc32(json));
  envelope.set(packed, 5);
  const payload = toBase64Url(envelope);
  if (payload.length > LIMIT.payload) fail("long");
  return payload;
}

export async function decodePlan(payload) {
  if (typeof DecompressionStream !== "function") fail("unsupported");
  if (typeof payload !== "string" || payload.length > LIMIT.payload) fail();
  const envelope = fromBase64Url(payload);
  if (envelope.length < 6) fail();
  if (envelope[0] > FORMAT) fail("newer");
  if (envelope[0] !== FORMAT) fail();
  let json;
  try {
    json = await streamed(envelope.subarray(5), new DecompressionStream("deflate-raw"), LIMIT.json);
  } catch (error) {
    if (error instanceof PlanError) throw error;
    fail();
  }
  if (new DataView(envelope.buffer, envelope.byteOffset).getUint32(1) !== crc32(json)) fail();
  let packed;
  try {
    packed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch {
    fail();
  }
  return unpackPlan(packed);
}

export function payloadOf(value) {
  const found = /(?:^|[#&?\s])plan=([A-Za-z0-9_-]+)/.exec(text(value));
  if (found) return found[1];
  const bare = text(value).trim();
  return /^[A-Za-z0-9_-]{24,}$/.test(bare) ? bare : "";
}

export const linkOf = (website, payload) => `${text(website).replace(/\/+$/, "")}/pwa/#plan=${payload}`;

export function planFile(model, app, exportedAt) {
  return { app, kind: "plan", version: FORMAT, exportedAt, plan: model };
}

export function planOfFile(payload) {
  const file = record(payload);
  if (file.kind !== "plan") return null;
  if (!Number.isInteger(file.version) || file.version > FORMAT) fail(file.version > FORMAT ? "newer" : "damaged");
  const model = record(file.plan);
  if (!Array.isArray(model.subjects) || !Array.isArray(model.teachers) || !Array.isArray(model.blocks) || !Array.isArray(model.lessons)) fail();
  if (!model.blocks.every((block) => isClock(block?.start) && isClock(block?.end))) fail();
  if (!model.subjects.every((item) => HUES.includes(item?.hue) && TYPES.includes(item?.type))) fail();
  if (!model.teachers.every((item) => TITLES.includes(item?.title))) fail();
  return unpackPlan(packPlan({
    subjects: model.subjects.map((item) => ({ ...item, short: text(item.short), room: text(item.room), teacher: Number.isInteger(item.teacher) ? item.teacher : null })),
    teachers: model.teachers.map((item) => ({ title: item.title, name: text(item.name) })),
    blocks: model.blocks,
    weeks: model.weeks === true,
    reference: model.weeks === true ? model.reference : null,
    lessons: model.lessons.filter((lesson) => lesson && typeof lesson === "object" && ["A", "B"].includes(lesson.week) && DAYS.includes(lesson.day) && Number.isInteger(lesson.block) && Number.isInteger(lesson.subject) && model.subjects[lesson.subject])
      .map((lesson) => ({ ...lesson, room: text(lesson.room), teacher: Number.isInteger(lesson.teacher) ? lesson.teacher : null })),
  }));
}

export function planOfValues(values, school) {
  const saved = record(values?.[KEYS.subjects]);
  const removed = new Set(Array.isArray(saved.removed) ? saved.removed : []);
  const times = record(values?.[KEYS.blocks]);
  const blocks = times.v === 2 && Array.isArray(times.blocks) ? times.blocks.filter((block) => Number.isInteger(block?.n) && isClock(block.start) && isClock(block.end)).sort((a, b) => a.n - b.n) : [];
  const cells = record(values?.[KEYS.lessons]);
  if (!blocks.length || !Object.keys(cells).length) return null;
  const teachers = Object.entries(record(record(values[KEYS.teachers]).items))
    .filter(([, teacher]) => bounded(teacher?.name, 1, LIMIT.teacher))
    .map(([id, teacher]) => ({ id, title: TITLES.includes(teacher.title) ? teacher.title : "", name: teacher.name.trim() }));
  const subjects = Object.create(null);
  Object.entries(record(saved.items)).forEach(([key, item]) => {
    if (!item?.custom || !bounded(item.name, 1, LIMIT.name) || !HUES.includes(item.hue)) return;
    const type = TYPES.includes(item.type) ? item.type : "GK";
    subjects[key] = { name: `${item.name.trim()}${type === "LK" ? " LK" : ""}`, short: text(item.short).slice(0, LIMIT.short), hue: item.hue, type, teacherId: text(item.teacher), room: text(item.room).slice(0, LIMIT.room), retired: removed.has(key) };
  });
  const timetable = {};
  ["A", "B"].forEach((week) => {
    timetable[week] = {};
    DAYS.forEach((day) => {
      timetable[week][String(day)] = blocks.flatMap(({ n }) => {
        const cell = record(cells[`${week}:${day}:${n}`]);
        return typeof cell.subject === "string" && Object.hasOwn(subjects, cell.subject) ? [{ block: n, subject: cell.subject, room: text(cell.room).slice(0, LIMIT.room) }] : [];
      });
    });
  });
  const model = planOf({ subjects, teachers, blocks, timetable, edits: cells, weeks: values[KEYS.weeks] !== false, abReference: school?.abReference });
  return model.lessons.length ? model : null;
}

export function describePlan(model, skip = []) {
  const left = new Set(skip);
  const lessons = model.lessons.filter((lesson) => !left.has(lesson.subject));
  const count = (week) => lessons.filter((lesson) => lesson.week === week).length;
  return {
    subjects: model.subjects.filter((_, index) => !left.has(index) && lessons.some((lesson) => lesson.subject === index)).length,
    lessons: count("A"),
    lessonsB: model.weeks ? count("B") : null,
    weeks: model.weeks,
    blocks: model.blocks.length,
  };
}

const weekParity = (reference) => {
  const [year, month, day] = reference.split("-").map(Number);
  return Math.abs(Math.floor(Math.round((Date.UTC(2026, 0, 5) - Date.UTC(year, month - 1, day)) / 864e5) / 7) % 2);
};

export function fitPlan(model, { mine, defaults, own = {} }, { mode = "replace", skip = [], maxBlocks = LIMIT.blocks } = {}) {
  const replace = mode !== "merge";
  const left = new Set(skip);
  const keys = fileKeys(mine.subjects);
  const values = wholeSchool(mine);
  const items = values[KEYS.subjects].items;
  const retired = new Set(values[KEYS.subjects].removed);
  const people = values[KEYS.teachers].items;
  const goneTeachers = new Set(values[KEYS.teachers].removed);
  const rooms = new Set(values[KEYS.rooms].added);
  const goneRooms = new Set(values[KEYS.rooms].removed);
  const cells = values[KEYS.lessons];
  const taken = new Set([...Object.keys(items), ...Object.keys(mine.subjects), ...Object.keys(defaults.subjects), ...Object.keys(record(record(own.subjects).items))]);
  const count = { A: { filled: 0, kept: 0, dropped: 0 }, B: { filled: 0, kept: 0, dropped: 0 } };
  const placed = [];
  const chosen = model.lessons.filter((lesson) => !left.has(lesson.subject));
  const aside = new Set(Object.entries(record(mine.edits)).filter(([, cell]) => typeof cell?.subject === "string" && Object.hasOwn(mine.subjects, cell.subject) && mine.subjects[cell.subject].retired).map(([key]) => key));
  if (replace) {
    const fits = Math.min(model.blocks.length, maxBlocks);
    Object.keys(cells).forEach((key) => delete cells[key]);
    ["A", "B"].forEach((week) => DAYS.forEach((day) => model.blocks.slice(0, fits).forEach((_, index) => (cells[`${week}:${day}:${index + 1}`] = null))));
    chosen.forEach((lesson) => (model.weeks ? [lesson.week] : ["A", "B"]).forEach((week) => {
      if (lesson.block > fits) {
        count[week].dropped += 1;
        return;
      }
      placed.push([lesson, `${week}:${lesson.day}:${lesson.block}`]);
      count[week].filled += 1;
    }));
    values[KEYS.blocks] = { v: 2, blocks: model.blocks.slice(0, fits).map((block, index) => ({ n: index + 1, start: block.start, end: block.end })) };
    values[KEYS.weeks] = model.weeks;
  } else {
    const slots = new Map(mine.blocks.map((block) => [`${block.start}-${block.end}`, block.n]));
    const twinInA = (lesson) => model.lessons.some((other) => other.week === "A" && other.day === lesson.day && other.block === lesson.block && other.subject === lesson.subject && other.room === lesson.room);
    const shifted = model.weeks && mine.weeks && isDay(model.reference) && isDay(mine.abReference) && weekParity(model.reference) !== weekParity(mine.abReference);
    const flip = (week) => (week === "A" ? "B" : "A");
    chosen.forEach((lesson) => {
      if (!mine.weeks && lesson.week === "B") {
        if (!twinInA(lesson)) count.A.dropped += 1;
        return;
      }
      const weeks = !mine.weeks || !model.weeks ? (mine.weeks ? ["A", "B"] : ["A"]) : [shifted ? flip(lesson.week) : lesson.week];
      const block = model.blocks[lesson.block - 1];
      const n = block ? slots.get(`${block.start}-${block.end}`) : undefined;
      weeks.forEach((week) => {
        const key = `${week}:${lesson.day}:${n}`;
        if (n == null) count[week].dropped += 1;
        else if (cells[key] || aside.has(key) || placed.some(([, other]) => other === key)) count[week].kept += 1;
        else {
          placed.push([lesson, key]);
          count[week].filled += 1;
        }
      });
    });
  }
  const room = (name) => {
    if (!name) return name;
    rooms.add(name);
    goneRooms.delete(name);
    return name;
  };
  const teacher = (index) => {
    if (index == null) return "";
    const id = teacherKey(model.teachers[index]);
    goneTeachers.delete(id);
    if (!people[id]) people[id] = { title: model.teachers[index].title, name: model.teachers[index].name, custom: true };
    return id;
  };
  const matchOf = (subject) => {
    const same = Object.entries(mine.subjects).filter(([, info]) => norm(info.name) === norm(subject.name) && (TYPES.includes(info.type) ? info.type : "GK") === subject.type);
    const pick = same.find(([, info]) => !info.retired) || same[0];
    return pick ? keys.get(pick[0]) : null;
  };
  const freshKey = (subject) => {
    const stem = `s-${slug(subject.name) || "fach"}${subject.type === "LK" ? "-lk" : ""}`;
    let key = stem;
    for (let n = 2; taken.has(key); n += 1) key = `${stem}-${n}`;
    taken.add(key);
    return key;
  };
  const subjectKey = new Map();
  let added = 0;
  [...new Set(placed.map(([lesson]) => lesson.subject))].sort((a, b) => a - b).forEach((index) => {
    const subject = model.subjects[index];
    const match = matchOf(subject);
    if (match) {
      const item = items[match];
      if (subject.teacher != null && (replace || !item.teacher)) item.teacher = teacher(subject.teacher);
      if (subject.room && (replace || !item.room)) item.room = room(subject.room);
      retired.delete(match);
      subjectKey.set(index, match);
      return;
    }
    const key = freshKey(subject);
    items[key] = { custom: true, name: subject.name, short: subject.short || subject.name.slice(0, 3), hue: subject.hue, type: subject.type, teacher: teacher(subject.teacher), room: room(subject.room) };
    subjectKey.set(index, key);
    added += 1;
  });
  placed.forEach(([lesson, key]) => {
    const subject = subjectKey.get(lesson.subject);
    const own = lesson.teacher == null ? "" : teacherKey(model.teachers[lesson.teacher]);
    const who = own && own !== items[subject].teacher ? teacher(lesson.teacher) : "";
    cells[key] = { subject, room: room(lesson.room), ...(who ? { teacher: who } : {}) };
  });
  values[KEYS.subjects] = { items, removed: [...retired] };
  values[KEYS.teachers] = { items: people, removed: [...goneTeachers] };
  values[KEYS.rooms] = { added: [...rooms], removed: [...goneRooms] };
  const source = { abReference: replace && model.weeks && model.reference ? model.reference : mine.abReference, subjects: fileSubjects(defaults.subjects, keys) };
  const most = (field) => Math.max(count.A[field], count.B[field]);
  const result = fitSchool(values, source, { ...defaults, own }).values;
  if (!replace && aside.size) result[KEYS.lessons] = { ...record(result[KEYS.lessons]), ...Object.fromEntries([...aside].map((key) => [key, mine.edits[key]])) };
  return { added, subjects: subjectKey.size, filled: most("filled"), kept: most("kept"), dropped: most("dropped"), changed: replace || placed.length > 0, values: result };
}

export const changedKeys = (before, after) => PLAN_KEYS.filter((key) => !sameValue(before[key], after[key]));

export function writeValues(store, values, keys) {
  keys.forEach((key) => (values[key] == null ? store.remove(key) : store.set(key, values[key])));
}

const sorted = (value) => (Array.isArray(value) ? value.map(sorted) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value);

export const sameValue = (one, other) => JSON.stringify(sorted(one ?? null)) === JSON.stringify(sorted(other ?? null));
