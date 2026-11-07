// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => import(pathToFileURL(resolve(here, "../../app/static/app/js", name)).href);
const share = await load("plan-format.js");
const { wholeSchool, fileKeys, fileSubjects } = await load("backup.js");
const qrcodegen = (await load("qrcodegen.js")).default;
const { planOf, packPlan, unpackPlan, encodePlan, decodePlan, payloadOf, linkOf, planFile, planOfFile, planOfValues, describePlan, fitPlan, sameValue, changedKeys, writeValues, crc32, PlanError, FORMAT, PLAN_KEYS } = share;

const clone = (value) => JSON.parse(JSON.stringify(value));
const days = (filled = {}) => Object.fromEntries(["1", "2", "3", "4", "5"].map((dow) => [dow, filled[dow] || []]));
const twoBlocks = [{ n: 1, start: "08:00", end: "09:30" }, { n: 2, start: "09:50", end: "11:20" }];
const WEBSITE = "https://example.netlify.app";

const base = {
  subjects: {
    m: { name: "Mathe LK", label: "Mathe LK", short: "Mat", hue: "slate" },
    d: { name: "Deutsch", label: "Deutsch", short: "Deu", hue: "brick" },
  },
  courses: { m: { type: "LK" }, d: { type: "GK" } },
  blocks: twoBlocks,
  timetable: {
    A: days({ 1: [{ block: 1, subject: "m", room: "R1", teacher: "Frau Lang" }], 2: [{ block: 2, subject: "d", room: "R2", teacher: "Herr Kurz" }] }),
    B: days({ 1: [{ block: 1, subject: "m", room: "R1", teacher: "Frau Lang" }] }),
  },
  abReference: "2026-01-12",
};

const state = (overrides = {}) => ({
  subjects: {
    m: { name: "Mathe LK", short: "Mat", hue: "slate", type: "LK", teacherId: "t-frau-lang", room: "R1", custom: false },
    d: { name: "Deutsch", short: "Deu", hue: "brick", type: "GK", teacherId: "t-herr-kurz", room: "R2", custom: false },
  },
  teachers: [{ id: "t-frau-lang", title: "Frau", name: "Lang" }, { id: "t-herr-kurz", title: "Herr", name: "Kurz" }],
  rooms: ["R1", "R2"],
  blocks: twoBlocks,
  timetable: clone(base.timetable),
  edits: null,
  gone: {},
  weeks: true,
  abReference: "2026-01-12",
  ...overrides,
});

const empty = { subjects: {}, courses: {}, blocks: [...twoBlocks, { n: 3, start: "11:30", end: "13:00" }, { n: 4, start: "13:30", end: "15:00" }], timetable: { A: days(), B: days() }, abReference: "2026-01-12" };
const emptyState = () => ({ subjects: {}, teachers: [], rooms: [], blocks: clone(empty.blocks), timetable: clone(empty.timetable), edits: null, gone: {}, weeks: true, abReference: "2026-01-12" });

const NAMES = ["Mathematik", "Deutsch", "Englisch", "Physik", "Chemie", "Biologie", "Geschichte", "Politische Bildung", "Geografie", "Informatik", "Sport", "Musik", "Seminarkurs", "Psychologie"];
const SHORTS = ["Ma", "De", "En", "Ph", "Ch", "Bio", "Ge", "PB", "Geo", "Inf", "Sp", "Mu", "SK", "Psy"];
const TEACHERS = ["Müller", "Schulz", "Wagner", "Becker", "Hoffmann", "Schäfer", "Koch", "Richter", "Klein", "Wolf", "Neumann", "Schwarz", "Zimmermann", "Krüger"];
const HUES = ["slate", "brick", "ochre", "iris", "jade", "moss", "plum", "teal", "olive", "lake", "rose", "orchid", "ochre", "rose"];
const ROOMS = ["R101", "R204", "R112", "N201", "N104", "N110", "R008", "R009", "R010", "R301", "Halle", "Aula", "R101", "R215"];

function oberstufe({ blocks = 10 } = {}) {
  const subjects = {};
  NAMES.forEach((name, index) => {
    const type = index < 2 ? "LK" : index === 12 ? "SK" : "GK";
    subjects[`s${index}`] = { name: type === "LK" ? `${name} LK` : name, short: SHORTS[index], hue: HUES[index], type, teacherId: `t-${index % 2 ? "herr" : "frau"}-${TEACHERS[index].toLowerCase().replace("ü", "ue").replace("ä", "ae")}`, room: ROOMS[index], custom: true };
  });
  const teachers = TEACHERS.map((name, index) => ({ id: subjects[`s${index}`].teacherId, title: index % 2 ? "Herr" : "Frau", name }));
  const times = [];
  for (let n = 1, start = 8 * 60; n <= blocks; n += 1, start += n % 2 ? 50 : 50) times.push({ n, start: `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`, end: `${String(Math.floor((start + 45) / 60)).padStart(2, "0")}:${String((start + 45) % 60).padStart(2, "0")}` });
  const rows = [[0, 0, 1, 1, 2, 2, 6, 6], [3, 3, 0, 0, 9, 9, 10, 10], [1, 1, 4, 4, 5, 5, 7, 7, 13, 13], [0, 0, 2, 2, 8, 8, 11, 11], [1, 1, 3, 3, 12, 12, 10, 10]];
  const timetable = { A: {}, B: {} };
  ["A", "B"].forEach((week) => ["1", "2", "3", "4", "5"].forEach((dow, dayIndex) => {
    const row = rows[dayIndex].slice(0, blocks);
    if (week === "B" && dayIndex === 0) row.splice(8, 2, 5, 5);
    if (week === "B" && dayIndex === 2) row.splice(8, 2);
    timetable[week][dow] = row.map((index, slot) => ({ block: slot + 1, subject: `s${index}`, room: dayIndex === 4 && index === 10 ? "Halle 2" : ROOMS[index], teacher: "" })).filter((entry) => entry.block <= blocks);
  }));
  return { subjects, teachers, rooms: [...new Set([...ROOMS, "Halle 2"])], blocks: times, timetable, edits: null, gone: {}, weeks: true, abReference: "2026-09-07" };
}

const reason = async (run) => {
  try {
    await run();
  } catch (error) {
    if (error instanceof PlanError) return error.reason;
    throw error;
  }
  return "none";
};

const tests = {
  "the checksum is the usual CRC-32"() {
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  },
  "a plan names its subjects, teachers, blocks, weeks and lessons and nothing else"() {
    const model = planOf(state());
    assert.deepEqual(Object.keys(model).sort(), ["blocks", "lessons", "reference", "subjects", "teachers", "weeks"]);
    assert.deepEqual(model.subjects, [
      { name: "Mathe", short: "Mat", type: "LK", hue: "slate", teacher: 0, room: "R1" },
      { name: "Deutsch", short: "Deu", type: "GK", hue: "brick", teacher: 1, room: "R2" },
    ]);
    assert.deepEqual(model.teachers, [{ title: "Frau", name: "Lang" }, { title: "Herr", name: "Kurz" }]);
    assert.deepEqual(model.lessons, [
      { week: "A", day: 1, block: 1, subject: 0, room: "R1", teacher: null },
      { week: "A", day: 2, block: 2, subject: 1, room: "R2", teacher: null },
      { week: "B", day: 1, block: 1, subject: 0, room: "R1", teacher: null },
    ]);
    assert.equal(model.reference, "2026-01-12");
    const single = planOf(state({ weeks: false }));
    assert.equal(single.weeks, false);
    assert.equal(single.reference, null);
    assert.deepEqual(single.lessons.map((lesson) => lesson.week), ["A", "A"]);
  },
  "a subject without lessons or one put aside stays at home"() {
    const own = state();
    own.subjects.k = { name: "Kunst", short: "Kun", hue: "rose", type: "GK", teacherId: "", room: "", custom: true };
    own.subjects.x = { name: "Latein", short: "Lat", hue: "olive", type: "GK", teacherId: "", room: "", custom: true, retired: true };
    own.timetable.A["3"] = [{ block: 1, subject: "x", room: "R9", teacher: "" }];
    assert.deepEqual(planOf(own).subjects.map((item) => item.name), ["Mathe", "Deutsch"]);
  },
  "a lesson only names a teacher where it is not the one of its subject"() {
    const own = state({ edits: { "A:2:2": { subject: "d", room: "R2", teacher: "t-frau-lang" } } });
    const lesson = planOf(own).lessons.find((item) => item.day === 2);
    assert.equal(lesson.teacher, 0);
  },
  async "a plan comes back from its link exactly as it went in"() {
    const model = planOf(oberstufe());
    const payload = await encodePlan(model);
    assert.match(payload, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(await decodePlan(payload), model);
    assert.deepEqual(await decodePlan(payloadOf(linkOf(WEBSITE, payload))), model);
    assert.equal(linkOf(`${WEBSITE}/`, "abc"), `${WEBSITE}/pwa/#plan=abc`);
  },
  async "the link carries no grade, task, note, place or account"() {
    const payload = await encodePlan(planOf(oberstufe()));
    const bytes = Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(new Uint8Array(await new Response(new Blob([bytes.subarray(5)]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()));
    assert.equal(bytes[0], FORMAT);
    assert.doesNotMatch(json, /grade|points|deadline|task|note|place|iserv|google|mail|token|password/i);
    const backup = { "app-settings": { school: { grade: 12 } }, ...wholeSchool(oberstufe()) };
    const fromBackup = planOfValues(backup, { abReference: "2026-09-07" });
    assert.doesNotMatch(JSON.stringify(packPlan(fromBackup)), /grade|settings/i);
  },
  async "a changed or cut off link is refused instead of read wrongly"() {
    const payload = await encodePlan(planOf(state()));
    const flip = (index) => payload.slice(0, index) + (payload[index] === "A" ? "B" : "A") + payload.slice(index + 1);
    assert.equal(await reason(() => decodePlan(flip(3))), "damaged");
    assert.equal(await reason(() => decodePlan(flip(payload.length - 2))), "damaged");
    assert.equal(await reason(() => decodePlan(payload.slice(0, -6))), "damaged");
    assert.equal(await reason(() => decodePlan("not+base64!")), "damaged");
    assert.equal(await reason(() => decodePlan("")), "damaged");
  },
  async "a plan from a newer version says so"() {
    const payload = await encodePlan(planOf(state()));
    const bytes = Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
    bytes[0] = FORMAT + 1;
    const newer = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    assert.equal(await reason(() => decodePlan(newer)), "newer");
    bytes[0] = 0;
    assert.equal(await reason(() => decodePlan(btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""))), "damaged");
    assert.equal(await reason(async () => planOfFile({ kind: "plan", version: FORMAT + 1, plan: {} })), "newer");
  },
  "the code is found in a link, in a message around it or on its own"() {
    const code = "AQAAAAB_x-YzMDE2NzM4OTk5OTk5OTk5";
    assert.equal(payloadOf(`${WEBSITE}/pwa/#plan=${code}`), code);
    assert.equal(payloadOf(`Hier ist unser Plan: ${WEBSITE}/pwa/#plan=${code} viel Spaß`), code);
    assert.equal(payloadOf(`  ${code}\n`), code);
    assert.equal(payloadOf("plan=" + code), code);
    assert.equal(payloadOf("Hallo"), "");
    assert.equal(payloadOf(`${WEBSITE}/pwa/`), "");
  },
  "values a plan cannot have are refused"() {
    const good = packPlan(planOf(state()));
    assert.deepEqual(unpackPlan(clone(good)), planOf(state()));
    const broken = [
      (plan) => (plan[0][0][3] = 12),
      (plan) => (plan[0][0][2] = 3),
      (plan) => (plan[0][0][4] = 9),
      (plan) => (plan[0][0][0] = "x".repeat(33)),
      (plan) => (plan[0][0][5] = "R".repeat(13)),
      (plan) => (plan[1][0][0] = 3),
      (plan) => (plan[2] = [600, 0]),
      (plan) => (plan[2] = [1400, 60]),
      (plan) => (plan[2] = [480, -5]),
      (plan) => (plan[2] = [480, 90, 20]),
      (plan) => (plan[3] = "12.01.2026"),
      (plan) => (plan[4][0][0] = 3),
      (plan) => (plan[4][0][0] = [1, "R1", 7]),
      (plan) => (plan[4][0] = [1]),
      (plan) => plan[4].pop(),
      (plan) => plan.pop(),
      (plan) => (plan[0] = []),
    ];
    broken.forEach((change, index) => {
      const plan = clone(good);
      change(plan);
      assert.throws(() => unpackPlan(plan), PlanError, `case ${index}`);
    });
    const none = clone(good);
    none[4] = none[4].map((day) => day.map(() => 0));
    none[5] = none[5].map((day) => day.map(() => 0));
    assert.throws(() => unpackPlan(none), (error) => error.reason === "empty");
  },
  "a file of the plan reads back as the same plan"() {
    const model = planOf(oberstufe());
    const file = JSON.parse(JSON.stringify(planFile(model, "App", "2026-11-07T08:00:00.000Z")));
    assert.deepEqual(Object.keys(file).sort(), ["app", "exportedAt", "kind", "plan", "version"]);
    assert.deepEqual(planOfFile(file), model);
    assert.equal(planOfFile({ app: "App", version: 2, values: {} }), null);
    assert.throws(() => planOfFile({ kind: "plan", version: 1, plan: { subjects: [{ name: "<b>", hue: "red", type: "GK" }], teachers: [], blocks: [], lessons: [] } }), PlanError);
  },
  "a full backup gives just the plan it holds"() {
    const own = oberstufe();
    const keys = fileKeys(own.subjects);
    const values = wholeSchool(own);
    const model = planOfValues(values, { abReference: own.abReference, subjects: fileSubjects({}, keys) });
    assert.deepEqual(model, planOf(own));
    assert.equal(planOfValues({}, {}), null);
  },
  "the summary counts subjects and the lessons of each week"() {
    const model = planOf(oberstufe());
    assert.deepEqual(describePlan(model), { subjects: 14, lessons: 42, lessonsB: 42, weeks: true, blocks: 10 });
    assert.equal(describePlan(model, [0]).subjects, 13);
    assert.equal(describePlan(model, [0]).lessons, 36);
  },
  "read back on the device it came from, a plan changes nothing"() {
    const fitted = fitPlan(planOf(state()), { mine: state(), defaults: base });
    assert.deepEqual(fitted.values, {});
    const merged = fitPlan(planOf(state()), { mine: state(), defaults: base }, { mode: "merge" });
    assert.deepEqual(merged.values, {});
    assert.deepEqual([merged.filled, merged.kept, merged.changed], [0, 2, false]);
  },
  "on a device without a plan the shared plan arrives whole"() {
    const fitted = fitPlan(planOf(state()), { mine: emptyState(), defaults: empty });
    const subjects = fitted.values["app-subjects"].items;
    assert.deepEqual(Object.keys(subjects).sort(), ["s-deutsch", "s-mathe-lk"]);
    assert.deepEqual(subjects["s-mathe-lk"], { custom: true, name: "Mathe", short: "Mat", hue: "slate", type: "LK", teacher: "t-frau-lang", room: "R1" });
    assert.deepEqual(fitted.values["app-timetable-edits"], { "A:1:1": { subject: "s-mathe-lk", room: "R1" }, "A:2:2": { subject: "s-deutsch", room: "R2" }, "B:1:1": { subject: "s-mathe-lk", room: "R1" } });
    assert.deepEqual(fitted.values["app-block-times"], { v: 2, blocks: twoBlocks });
    assert.deepEqual(fitted.values["app-teachers"].items["t-herr-kurz"], { title: "Herr", name: "Kurz", custom: true });
    assert.deepEqual(fitted.values["app-rooms"].added, ["R1", "R2"]);
    assert.equal(fitted.added, 2);
    assert.equal(fitted.filled, 2);
  },
  "replacing takes the grid, the blocks and the weeks and keeps own subjects with their colours"() {
    const mine = emptyState();
    mine.subjects = { 5: { name: "Mathe LK", short: "M", hue: "jade", type: "LK", teacherId: "", room: "", custom: false }, 9: { name: "Chor", short: "Cho", hue: "teal", type: "GK", teacherId: "", room: "", custom: true } };
    mine.timetable.A["3"] = [{ block: 4, subject: "9", room: "Aula", teacher: "" }];
    const defaults = { ...empty, subjects: { 5: { name: "Mathe LK", label: "Mathe LK", short: "M", hue: "jade" } }, courses: { 5: { type: "LK" } } };
    const own = { subjects: { items: { 9: { custom: true, name: "Chor", short: "Cho", hue: "teal", type: "GK", teacher: "", room: "" } }, removed: [] } };
    const fitted = fitPlan(planOf(state({ weeks: false })), { mine, defaults, own });
    const items = fitted.values["app-subjects"].items;
    assert.deepEqual(items[5], { teacher: "t-frau-lang", room: "R1" });
    assert.deepEqual(items[9], own.subjects.items[9]);
    assert.equal(items["s-deutsch"].custom, true);
    assert.equal(fitted.values["app-ab-weeks"], false);
    assert.equal(fitted.values["app-timetable-edits"]["A:3:4"], undefined);
    assert.deepEqual(fitted.values["app-timetable-edits"]["B:1:1"], { subject: "5", room: "R1" });
    assert.deepEqual(fitted.values["app-block-times"], { v: 2, blocks: twoBlocks });
  },
  "an LK is not the GK of the same name"() {
    const mine = state();
    mine.subjects.m = { ...mine.subjects.m, name: "Mathe", type: "GK" };
    const fitted = fitPlan(planOf(state()), { mine, defaults: { ...base, courses: { m: { type: "GK" }, d: { type: "GK" } }, subjects: { ...base.subjects, m: { name: "Mathe", label: "Mathe", short: "Mat", hue: "slate" } } } });
    assert.equal(fitted.values["app-subjects"].items["s-mathe-lk"].type, "LK");
    assert.deepEqual(fitted.values["app-timetable-edits"]["A:1:1"], { subject: "s-mathe-lk", room: "R1" });
    assert.equal(fitted.added, 1);
  },
  "merging fills only free lessons and keeps the own ones"() {
    const theirs = state();
    theirs.timetable.A["1"].push({ block: 2, subject: "d", room: "R7", teacher: "" });
    theirs.timetable.A["3"] = [{ block: 1, subject: "m", room: "R1", teacher: "" }];
    const mine = state();
    mine.timetable.A["3"] = [{ block: 1, subject: "d", room: "R2", teacher: "" }];
    mine.edits = { "A:3:1": { subject: "d", room: "R2" } };
    const fitted = fitPlan(planOf(theirs), { mine, defaults: base }, { mode: "merge" });
    assert.deepEqual(fitted.values["app-timetable-edits"], { "A:1:2": { subject: "d", room: "R7" }, "A:3:1": { subject: "d", room: "R2" } });
    assert.deepEqual([fitted.filled, fitted.kept, fitted.dropped], [1, 3, 0]);
    assert.equal("app-block-times" in fitted.values, false);
  },
  "merging puts each lesson in the calendar week it belongs to"() {
    const theirs = state({ abReference: "2026-01-19" });
    theirs.timetable.B["4"] = [{ block: 2, subject: "d", room: "R2", teacher: "" }];
    const mine = state();
    mine.timetable = { A: days(), B: days() };
    const fitted = fitPlan(planOf(theirs), { mine, defaults: { ...base, timetable: { A: days(), B: days() } } }, { mode: "merge" });
    const cells = fitted.values["app-timetable-edits"];
    assert.deepEqual(cells["A:4:2"], { subject: "d", room: "R2" });
    assert.deepEqual(cells["B:1:1"], { subject: "m", room: "R1" });
    assert.deepEqual(cells["A:1:1"], { subject: "m", room: "R1" });
    assert.equal("app-ab-swap" in fitted.values, false);
    const replaced = fitPlan(planOf(theirs), { mine, defaults: { ...base, timetable: { A: days(), B: days() } } });
    assert.equal(replaced.values["app-ab-swap"], true);
  },
  "left out subjects bring no lessons"() {
    const fitted = fitPlan(planOf(state()), { mine: emptyState(), defaults: empty }, { skip: [1] });
    assert.deepEqual(Object.keys(fitted.values["app-subjects"].items), ["s-mathe-lk"]);
    assert.deepEqual(Object.keys(fitted.values["app-timetable-edits"]).sort(), ["A:1:1", "B:1:1"]);
  },
  "lessons beyond the blocks this app shows are counted, not refused"() {
    const fitted = fitPlan(planOf(oberstufe()), { mine: emptyState(), defaults: empty }, { maxBlocks: 8 });
    assert.equal(fitted.values["app-block-times"].blocks.length, 8);
    assert.deepEqual([fitted.filled, fitted.dropped], [40, 2]);
    assert.equal(Object.keys(fitted.values["app-timetable-edits"]).some((key) => Number(key.split(":")[2]) > 8), false);
  },
  "a plan ends at its last block with a lesson"() {
    const tall = state({ blocks: [...twoBlocks, ...Array.from({ length: 8 }, (_, index) => ({ n: index + 3, start: `${12 + index}:00`, end: `${12 + index}:45` }))] });
    assert.equal(planOf(tall).blocks.length, 2);
    assert.equal(fitPlan(planOf(tall), { mine: emptyState(), defaults: empty }, { maxBlocks: 8 }).dropped, 0);
  },
  "merging needs the same start and end, so a double lesson does not land in a short period"() {
    const short = [{ n: 1, start: "08:00", end: "08:45" }, { n: 2, start: "08:50", end: "09:35" }];
    const fitted = fitPlan(planOf(state()), { mine: { ...emptyState(), blocks: short }, defaults: { ...empty, blocks: short } }, { mode: "merge" });
    assert.deepEqual([fitted.filled, fitted.dropped, fitted.changed], [0, 2, false]);
  },
  "merging into a plan without A/B counts the B lessons it cannot hold"() {
    const theirs = state();
    theirs.timetable.B["3"] = [{ block: 2, subject: "d", room: "R2" }];
    const mine = { ...emptyState(), blocks: clone(twoBlocks), weeks: false };
    const fitted = fitPlan(planOf(theirs), { mine, defaults: { ...empty, blocks: twoBlocks } }, { mode: "merge" });
    assert.deepEqual([fitted.filled, fitted.dropped], [2, 1]);
  },
  "a merge keeps the stored lessons of a subject that was put aside"() {
    const mine = state();
    mine.subjects.x = { name: "Latein", short: "Lat", hue: "olive", type: "GK", teacherId: "", room: "", custom: true, retired: true };
    mine.edits = { "A:3:1": { subject: "x", room: "R9" } };
    const theirs = state();
    theirs.timetable.A["3"] = [{ block: 1, subject: "d", room: "R2" }];
    const fitted = fitPlan(planOf(theirs), { mine, defaults: base, own: { subjects: { items: { x: { custom: true, name: "Latein", short: "Lat", hue: "olive", type: "GK" } }, removed: ["x"] } } }, { mode: "merge" });
    assert.deepEqual(fitted.values["app-timetable-edits"]["A:3:1"], { subject: "x", room: "R9" });
    assert.equal(fitted.kept, 3);
  },
  "names that objects already know make no subject"() {
    const values = {
      "app-subjects": JSON.parse('{"items":{"s-a":{"custom":true,"name":"A","hue":"slate","type":"GK"},"__proto__":{"custom":true,"name":"Evil","hue":"slate","type":"GK"}},"removed":[]}'),
      "app-block-times": { v: 2, blocks: [{ n: 1, start: "08:00", end: "09:30" }] },
      "app-timetable-edits": { "A:1:1": { subject: "s-a", room: "R" }, "A:2:1": { subject: "toString", room: "R" }, "A:3:1": { subject: "constructor", room: "R" }, "A:4:1": { subject: "hasOwnProperty", room: "R" } },
    };
    const model = planOfValues(values, { abReference: "2026-01-12" });
    assert.deepEqual(model.subjects.map((item) => item.name), ["A"]);
    assert.equal(model.lessons.filter((lesson) => lesson.week === "A").length, 1);
    assert.equal({}.custom, undefined);
  },
  "numbers as keys on a phone are matched by name"() {
    const phone = { ...empty, subjects: { 4: { name: "Deutsch", label: "Deutsch", short: "Deu", hue: "brick" } }, courses: { 4: { type: "GK" } } };
    const mine = emptyState();
    mine.subjects = { 4: { name: "Deutsch", short: "Deu", hue: "brick", type: "GK", teacherId: "", room: "", custom: false } };
    const fitted = fitPlan(planOf(state()), { mine, defaults: phone });
    assert.deepEqual(fitted.values["app-timetable-edits"]["A:2:2"], { subject: "4", room: "R2" });
    assert.equal(fitted.added, 1);
  },
  "merging goes by clock time and counts what does not fit"() {
    const mine = emptyState();
    mine.subjects = { c: { name: "Chor", short: "Cho", hue: "teal", type: "GK", teacherId: "", room: "Aula", custom: true } };
    mine.timetable.A["1"] = [{ block: 1, subject: "c", room: "Aula", teacher: "" }];
    const short = planOf({ ...state(), blocks: [{ n: 1, start: "08:00", end: "09:30" }, { n: 2, start: "09:30", end: "09:45" }, { n: 3, start: "09:50", end: "11:20" }], timetable: { A: days({ 2: [{ block: 1, subject: "m", room: "R1" }, { block: 2, subject: "d", room: "R2" }, { block: 3, subject: "d", room: "R2" }] }), B: days() } });
    const fitted = fitPlan(short, { mine, defaults: empty }, { mode: "merge" });
    assert.deepEqual([fitted.filled, fitted.kept, fitted.dropped], [2, 0, 1]);
    assert.deepEqual(fitted.values["app-timetable-edits"]["A:2:1"], { subject: "s-mathe-lk", room: "R1" });
    assert.deepEqual(fitted.values["app-timetable-edits"]["A:2:2"], { subject: "s-deutsch", room: "R2" });
    const late = planOf({ ...state(), blocks: [{ n: 1, start: "07:30", end: "08:15" }, { n: 2, start: "08:20", end: "09:05" }] });
    const none = fitPlan(late, { mine, defaults: empty }, { mode: "merge" });
    assert.deepEqual([none.filled, none.dropped, none.changed], [0, 2, false]);
    assert.deepEqual(Object.keys(none.values["app-subjects"]?.items || {}), ["c"]);
    assert.equal(Object.keys(none.values["app-teachers"]?.items || {}).length, 0);
  },
  "a merge only creates what a placed lesson needs"() {
    const theirs = state();
    theirs.subjects.k = { name: "Kunst", short: "Kun", hue: "rose", type: "GK", teacherId: "t-herr-kurz", room: "Atelier", custom: true };
    theirs.subjects.m = { ...theirs.subjects.m, teacherId: "t-frau-neu" };
    theirs.teachers.push({ id: "t-frau-neu", title: "Frau", name: "Neu" });
    theirs.timetable.A["1"] = [{ block: 1, subject: "k", room: "Atelier", teacher: "" }];
    theirs.timetable.A["4"] = [{ block: 1, subject: "m", room: "R1", teacher: "" }];
    const mine = state();
    mine.timetable = { A: days({ 1: [{ block: 1, subject: "d", room: "R2", teacher: "" }] }), B: days() };
    const fitted = fitPlan(planOf(theirs), { mine, defaults: { ...base, timetable: { A: days(), B: days() } } }, { mode: "merge" });
    assert.equal(fitted.values["app-subjects"]?.items?.["s-kunst"], undefined);
    assert.equal(fitted.values["app-teachers"]?.items?.["t-frau-neu"], undefined);
    assert.deepEqual(fitted.values["app-timetable-edits"]["A:4:1"], { subject: "m", room: "R1" });
    assert.equal(fitted.added, 0);
  },
  "lessons are counted per week, not for A and B together"() {
    const twice = state({ timetable: { A: days({ 1: [{ block: 1, subject: "m", room: "R1" }], 2: [{ block: 2, subject: "d", room: "R2" }] }), B: days({ 1: [{ block: 1, subject: "m", room: "R1" }], 2: [{ block: 2, subject: "d", room: "R2" }] }) } });
    assert.equal(fitPlan(planOf(twice), { mine: emptyState(), defaults: empty }).filled, 2);
    const merged = fitPlan(planOf(twice), { mine: { ...emptyState(), blocks: clone(twoBlocks) }, defaults: { ...empty, blocks: twoBlocks } }, { mode: "merge" });
    assert.equal(merged.filled, 2);
    assert.deepEqual(describePlan(planOf(twice)), { subjects: 2, lessons: 2, lessonsB: 2, weeks: true, blocks: 2 });
  },
  async "an overlong code is refused before it is unpacked, and no such link is made"() {
    assert.equal(await reason(() => decodePlan("A".repeat(8193))), "damaged");
    let seed = 7;
    const noise = (length) => Array.from({ length }, () => String.fromCharCode(0x4e00 + (Math.floor((seed = (seed * 1103515245 + 12345) % 2147483648) / 65536) % 4096))).join("");
    const big = {
      subjects: Array.from({ length: 40 }, (_, index) => ({ name: noise(32), short: noise(4), type: "GK", hue: "slate", teacher: index, room: noise(12) })),
      teachers: Array.from({ length: 60 }, () => ({ title: "Frau", name: noise(40) })),
      blocks: Array.from({ length: 16 }, (_, index) => ({ start: `${String(7 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`, end: `${String(7 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "55" : "25"}` })),
      weeks: true,
      reference: "2026-01-12",
      lessons: ["A", "B"].flatMap((week) => [1, 2, 3, 4, 5].flatMap((day) => Array.from({ length: 16 }, (_, index) => ({ week, day, block: index + 1, subject: (day * 16 + index) % 40, room: noise(12), teacher: (day * 7 + index) % 60 })))),
    };
    assert.equal(await reason(() => encodePlan(unpackPlan(packPlan(big)))), "long");
  },
  "undo puts every plan key back exactly as it was"() {
    const initial = { "app-subjects": { items: { m: { hue: "jade" } }, removed: [] }, "app-ab-weeks": false, "app-timetable-edits": { "A:1:1": null } };
    const map = new Map(Object.entries(clone(initial)));
    const store = { get: (key) => (map.has(key) ? clone(map.get(key)) : null), set: (key, value) => map.set(key, clone(value)), remove: (key) => map.delete(key) };
    const before = Object.fromEntries(PLAN_KEYS.map((key) => [key, store.get(key)]));
    const fitted = fitPlan(planOf(state({ abReference: "2026-01-19" })), { mine: emptyState(), defaults: empty });
    const keys = changedKeys(before, fitted.values);
    assert.deepEqual([...keys].sort(), [...PLAN_KEYS].sort());
    writeValues(store, fitted.values, keys);
    PLAN_KEYS.forEach((key) => assert.ok(sameValue(store.get(key), fitted.values[key] ?? null), key));
    writeValues(store, before, keys);
    assert.deepEqual(Object.fromEntries(map), initial);
  },
  "values that equal in all but their order are the same"() {
    assert.ok(sameValue({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }));
    assert.ok(!sameValue({ a: [1, 2] }, { a: [2, 1] }));
    assert.ok(sameValue(undefined, null));
  },
  async "a full upper school plan fits a QR code phones still read"() {
    const { QrCode, QrSegment } = qrcodegen;
    const measure = async (label, model) => {
      const link = linkOf(WEBSITE, await encodePlan(model));
      const low = QrCode.encodeSegments(QrSegment.makeSegments(link), QrCode.Ecc.LOW, 1, 40, -1, true);
      const medium = QrCode.encodeSegments(QrSegment.makeSegments(link), QrCode.Ecc.MEDIUM, 1, 40, -1, false);
      console.log(`      ${label}: link ${link.length} characters, QR version ${low.version} (${low.size} modules, level ${"LMQH"[low.errorCorrectionLevel.ordinal]}), at level M version ${medium.version}`);
      return low;
    };
    const full = await measure("14 subjects, 14 teachers, 10 blocks, A/B", planOf(oberstufe()));
    const eight = await measure("14 subjects, 8 blocks, A/B", planOf(oberstufe({ blocks: 8 })));
    const plain = oberstufe({ blocks: 8 });
    plain.teachers = [];
    Object.values(plain.subjects).forEach((info) => (info.teacherId = ""));
    await measure("14 subjects, no teachers, 8 blocks, A/B", planOf(plain));
    await measure("same without A/B", planOf({ ...plain, weeks: false }));
    assert.ok(full.version <= 20, `version ${full.version}`);
    assert.ok(eight.version <= full.version);
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    await run();
    console.log(`ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${String(error?.stack || error).split("\n").join("\n      ")}`);
  }
}
if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
