import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { wholeSchool, fileKeys, fileSubjects, fileRecords, fitSchool, recordPlan, planSize, subjectsInUse, summary, contents, BODIES } = await import(pathToFileURL(resolve(here, "../../app/static/app/js/backup.js")).href);

const nb = String.fromCharCode(160);
const clone = (value) => JSON.parse(JSON.stringify(value));
const days = (filled = {}) => Object.fromEntries(["1", "2", "3", "4", "5"].map((dow) => [dow, filled[dow] || []]));
const twoBlocks = [{ n: 1, start: "08:00", end: "09:30" }, { n: 2, start: "09:50", end: "11:20" }];
const fourBlocks = [...twoBlocks, { n: 3, start: "11:30", end: "13:00" }, { n: 4, start: "13:30", end: "15:00" }];

const mac = {
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

const shown = (overrides = {}) => ({
  subjects: {
    m: { name: "Mathe LK", short: "Mat", hue: "slate", type: "LK", teacherId: "t-frau-lang", room: "R1", custom: false },
    d: { name: "Deutsch", short: "Deu", hue: "brick", type: "GK", teacherId: "t-herr-kurz", room: "R2", custom: false },
  },
  teachers: [{ id: "t-frau-lang", title: "Frau", name: "Lang" }, { id: "t-herr-kurz", title: "Herr", name: "Kurz" }],
  rooms: ["R1", "R2"],
  blocks: twoBlocks,
  timetable: clone(mac.timetable),
  edits: null,
  gone: {},
  weeks: true,
  ...overrides,
});

const empty = { subjects: {}, courses: {}, blocks: fourBlocks, timetable: { A: days(), B: days() }, abReference: "2026-01-12" };
const from = { abReference: "2026-01-12", subjects: { m: "Mathe LK", d: "Deutsch" } };

const tests = {
  "a backup spells out every subject, teacher and cell of the plan"() {
    const whole = wholeSchool(shown());
    assert.deepEqual(whole["app-subjects"], {
      items: {
        m: { custom: true, name: "Mathe", short: "Mat", hue: "slate", type: "LK", teacher: "t-frau-lang", room: "R1" },
        d: { custom: true, name: "Deutsch", short: "Deu", hue: "brick", type: "GK", teacher: "t-herr-kurz", room: "R2" },
      },
      removed: [],
    });
    assert.deepEqual(whole["app-teachers"].items["t-frau-lang"], { title: "Frau", name: "Lang", custom: true });
    assert.deepEqual(whole["app-rooms"], { added: ["R1", "R2"], removed: [] });
    assert.deepEqual(whole["app-block-times"], { v: 2, blocks: twoBlocks });
    assert.equal(Object.keys(whole["app-timetable-edits"]).length, 20);
    assert.deepEqual(whole["app-timetable-edits"]["A:1:1"], { subject: "m", room: "R1" });
    assert.equal(whole["app-timetable-edits"]["A:1:2"], null);
    assert.equal(whole["app-ab-weeks"], true);
    assert.equal(wholeSchool(shown({ weeks: false }))["app-ab-weeks"], false);
  },
  "a lesson only names its teacher where it is not the one of the subject"() {
    const timetable = clone(mac.timetable);
    timetable.A["3"] = [{ block: 1, subject: "d", room: "R9", teacher: "Frau Lang" }];
    timetable.A["4"] = [{ block: 1, subject: "d", room: "R9", teacher: "Herr Kurz" }];
    const edits = { "A:3:1": { subject: "d", room: "R9", teacher: "t-frau-lang" }, "A:4:1": { subject: "d", room: "R9", teacher: "t-herr-kurz" }, "A:1:1": { subject: "d", room: "R1", teacher: "t-herr-kurz" } };
    const cells = wholeSchool(shown({ timetable, edits }))["app-timetable-edits"];
    assert.deepEqual(cells["A:3:1"], { subject: "d", room: "R9", teacher: "t-frau-lang" });
    assert.deepEqual(cells["A:4:1"], { subject: "d", room: "R9" });
    assert.deepEqual(cells["A:1:1"], { subject: "m", room: "R1" });
  },
  "a subject that was deleted but kept comes along as put aside"() {
    const state = shown();
    state.subjects.x = { name: "Kunst", short: "Kun", hue: "rose", type: "GK", teacherId: "", room: "", custom: true, retired: true };
    assert.deepEqual(wholeSchool(state)["app-subjects"].removed, ["x"]);
    const fitted = fitSchool(wholeSchool(state), from, mac);
    assert.deepEqual(fitted.values["app-subjects"], { items: { x: { custom: true, name: "Kunst", short: "Kun", hue: "rose", type: "GK", teacher: "", room: "" } }, removed: ["x"] });
    assert.deepEqual(fitted.retired, ["x"]);
  },
  "read back on the device it came from, a backup leaves nothing to store"() {
    const fitted = fitSchool(wholeSchool(shown()), from, mac);
    assert.deepEqual(fitted.values, {});
    assert.deepEqual([...fitted.keys], [["m", "m"], ["d", "d"]]);
  },
  "what was changed by hand is all that is stored again"() {
    const state = shown();
    state.subjects.d = { ...state.subjects.d, name: "Deutsch LK", type: "LK", hue: "jade", teacherId: "" };
    state.teachers.push({ id: "t-neu", title: "", name: "Neu" });
    state.rooms.push("Aula");
    state.timetable.A["2"] = [];
    state.timetable.B["5"] = [{ block: 2, subject: "m", room: "Aula", teacher: "Neu" }];
    state.edits = { "B:5:2": { subject: "m", room: "Aula", teacher: "t-neu" } };
    const values = fitSchool(wholeSchool(state), from, mac).values;
    assert.deepEqual(values["app-subjects"], { items: { d: { type: "LK", hue: "jade", teacher: "" } }, removed: [] });
    assert.deepEqual(values["app-teachers"], { items: { "t-neu": { title: "", name: "Neu", custom: true } }, removed: [] });
    assert.deepEqual(values["app-rooms"], { added: ["Aula"], removed: [] });
    assert.deepEqual(values["app-timetable-edits"], { "A:2:2": null, "B:5:2": { subject: "m", room: "Aula", teacher: "t-neu" } });
    assert.equal("app-block-times" in values, false);
  },
  "a renamed subject keeps its new name and a base teacher a new title"() {
    const state = shown();
    state.subjects.m = { ...state.subjects.m, name: "Mathematik LK" };
    state.teachers[0] = { id: "t-frau-lang", title: "Herr", name: "Lang" };
    const values = fitSchool(wholeSchool(state), from, mac).values;
    assert.deepEqual(values["app-subjects"].items, { m: { name: "Mathematik" } });
    assert.deepEqual(values["app-teachers"].items, { "t-frau-lang": { title: "Herr", name: "Lang" } });
    const phone = { ...empty, subjects: { 4: { name: "Mathe LK", label: "Mathe LK", short: "Mat", hue: "slate" } }, courses: { 4: { type: "LK" } } };
    assert.equal(fitSchool(wholeSchool(state), from, phone).keys.get("m"), "4");
    assert.equal(fitSchool(wholeSchool(state), { abReference: from.abReference }, phone).keys.get("m"), "m");
  },
  "on a device that knows nothing the whole plan arrives as its own"() {
    const fitted = fitSchool(wholeSchool(shown()), from, empty);
    assert.deepEqual(Object.keys(fitted.values["app-subjects"].items), ["m", "d"]);
    assert.equal(fitted.values["app-subjects"].items.m.custom, true);
    assert.deepEqual(fitted.values["app-timetable-edits"], { "A:1:1": { subject: "m", room: "R1" }, "A:2:2": { subject: "d", room: "R2" }, "B:1:1": { subject: "m", room: "R1" } });
    assert.deepEqual(fitted.values["app-block-times"], { v: 2, blocks: twoBlocks });
    assert.deepEqual(fitted.values["app-rooms"].added, ["R1", "R2"]);
    assert.equal(fitted.values["app-teachers"].items["t-herr-kurz"].custom, true);
  },
  "a subject the other device has under the same name is that subject"() {
    const phone = {
      subjects: { 1: { name: "Deutsch", label: "Deutsch", short: "Deu", hue: "brick" }, 2: { name: "Mathe LK", label: "Mathe LK", short: "Mat", hue: "iris" }, 3: { name: "Sport", label: "Sport", short: "Spo", hue: "moss" } },
      courses: { 1: { type: "GK" }, 2: { type: "LK" }, 3: { type: "GK" } },
      blocks: twoBlocks,
      timetable: {
        A: days({ 1: [{ block: 1, subject: "2", room: "R1", teacher: "" }], 3: [{ block: 1, subject: "3", room: "Halle", teacher: "" }] }),
        B: days({ 1: [{ block: 1, subject: "2", room: "R5", teacher: "" }] }),
      },
      abReference: "2026-01-12",
    };
    const fitted = fitSchool(wholeSchool(shown()), from, phone);
    assert.deepEqual([...fitted.keys], [["m", "2"], ["d", "1"]]);
    assert.deepEqual(fitted.values["app-subjects"].items, { 2: { hue: "slate", teacher: "t-frau-lang" }, 1: { teacher: "t-herr-kurz", room: "R2" } });
    assert.deepEqual(fitted.values["app-timetable-edits"], { "A:2:2": { subject: "1", room: "R2" }, "A:3:1": null, "B:1:1": { subject: "2", room: "R1" } });
  },
  "of two subjects with one name the one with the same course type is meant"() {
    const state = shown();
    state.subjects.e = { name: "Englisch", short: "Eng", hue: "ochre", type: "GK", teacherId: "", room: "", custom: false };
    state.subjects.el = { name: "Englisch LK", short: "Eng", hue: "ochre", type: "LK", teacherId: "", room: "", custom: false };
    const phone = { ...empty, subjects: { 7: { name: "Englisch LK", label: "Englisch LK", short: "Eng", hue: "ochre" }, 8: { name: "Englisch", label: "Englisch", short: "Eng", hue: "ochre" } }, courses: { 7: { type: "LK" }, 8: { type: "GK" } } };
    const keys = fitSchool(wholeSchool(state), from, phone).keys;
    assert.equal(keys.get("e"), "8");
    assert.equal(keys.get("el"), "7");
  },
  "a key that means another subject there is not taken over"() {
    const state = shown();
    state.subjects = { phy: { name: "Physik", short: "Phy", hue: "iris", type: "GK", teacherId: "", room: "", custom: false }, ag: { name: "Physik AG", short: "Phy", hue: "iris", type: "GK", teacherId: "", room: "", custom: false } };
    state.timetable = { A: days({ 1: [{ block: 1, subject: "phy", room: "", teacher: "" }] }), B: days() };
    const phone = { ...empty, subjects: { phy: { name: "Mathe", label: "Mathe", short: "Mat", hue: "slate" }, "s-physik": { name: "Chemie", label: "Chemie", short: "Che", hue: "jade" } }, courses: {} };
    const fitted = fitSchool(wholeSchool(state), from, phone);
    assert.equal(fitted.keys.get("phy"), "s-physik-2");
    assert.equal(fitted.keys.get("ag"), "ag");
    assert.deepEqual(fitted.values["app-timetable-edits"], { "A:1:1": { subject: "s-physik-2", room: "" } });
    assert.equal(fitted.values["app-subjects"].items["s-physik-2"].name, "Physik");
  },
  "own subjects of the reading device stay, and one with the same name is the same subject"() {
    const state = shown();
    state.subjects.k = { name: "Kunst", short: "Kun", hue: "rose", type: "GK", teacherId: "", room: "", custom: true };
    const own = {
      subjects: { items: { art: { custom: true, name: "Kunst", short: "Kun", hue: "plum", type: "GK", teacher: "t-eigen", room: "" }, chor: { custom: true, name: "Chor", short: "Cho", hue: "teal", type: "GK", teacher: "", room: "" }, alt: { custom: true, name: "Latein", short: "Lat", hue: "olive", type: "GK", teacher: "", room: "" }, m: { hue: "moss" } }, removed: ["alt"] },
      teachers: { items: { "t-eigen": { title: "Frau", name: "Eigen", custom: true }, "t-frau-lang": { title: "Frau", name: "Kurzlang" } }, removed: [] },
      rooms: { added: ["Atelier"], removed: [] },
    };
    const fitted = fitSchool(wholeSchool(state), from, { ...mac, own });
    assert.equal(fitted.keys.get("k"), "art");
    assert.deepEqual(Object.keys(fitted.values["app-subjects"].items).sort(), ["alt", "art", "chor"]);
    assert.equal(fitted.values["app-subjects"].items.art.hue, "rose");
    assert.deepEqual(fitted.values["app-subjects"].items.chor, own.subjects.items.chor);
    assert.deepEqual(fitted.values["app-subjects"].removed, ["alt"]);
    assert.deepEqual(fitted.values["app-teachers"].items, { "t-eigen": { title: "Frau", name: "Eigen", custom: true } });
    assert.deepEqual(fitted.values["app-rooms"].added, ["Atelier"]);
    const second = fitSchool(wholeSchool(state), from, { ...empty, own: { subjects: { items: { k: { custom: true, name: "Kunst", short: "Kun", hue: "plum", type: "GK" }, m: { custom: true, name: "Mathe", short: "Mat", hue: "slate", type: "LK" }, d: { custom: true, name: "Deutsch", short: "Deu", hue: "brick", type: "GK" } }, removed: [] } } });
    assert.deepEqual([...second.keys], [["m", "m"], ["d", "d"], ["k", "k"]]);
  },
  "a key that a database would read as a number never leaves the device"() {
    const state = shown();
    state.subjects = {
      "2e939669": { name: "Geografie", short: "Geo", hue: "jade", type: "GK", teacherId: "", room: "R3", custom: false },
      "0042": { name: "Geografie LK", short: "Geo", hue: "moss", type: "LK", teacherId: "", room: "", custom: true, retired: true },
      7: { name: "Kunst", short: "Kun", hue: "rose", type: "GK", teacherId: "", room: "", custom: false },
      "2e40f0f3": { name: "Mathe", short: "Mat", hue: "slate", type: "GK", teacherId: "", room: "", custom: false },
      "s-kunst": { name: "Kunst AG", short: "Kun", hue: "plum", type: "GK", teacherId: "", room: "", custom: true },
    };
    state.timetable = { A: days({ 1: [{ block: 1, subject: "2e939669", room: "R3", teacher: "" }], 2: [{ block: 1, subject: "7", room: "", teacher: "" }] }), B: days() };
    state.teachers = [];
    state.rooms = ["R3"];
    const keys = fileKeys(state.subjects);
    assert.deepEqual([...keys], [["7", "s-kunst-2"], ["2e939669", "s-geografie"], ["0042", "s-geografie-2"], ["2e40f0f3", "2e40f0f3"], ["s-kunst", "s-kunst"]]);
    const whole = wholeSchool(state);
    assert.deepEqual(Object.keys(whole["app-subjects"].items).sort(), ["2e40f0f3", "s-geografie", "s-geografie-2", "s-kunst", "s-kunst-2"]);
    assert.deepEqual(whole["app-subjects"].removed, ["s-geografie-2"]);
    assert.deepEqual(whole["app-timetable-edits"]["A:1:1"], { subject: "s-geografie", room: "R3" });
    assert.deepEqual(whole["app-timetable-edits"]["A:2:1"], { subject: "s-kunst-2", room: "" });
    const data = fileRecords({ grades: [{ id: "g-1", subject: "2e939669", points: 11 }], deadlines: [{ id: "test-1", subject: "7" }], tasks: [{ id: "1", subject: null }, { id: "2", subject: "s-kunst" }], notes: [{ id: "n" }], places: {} }, keys);
    assert.deepEqual([data.grades[0].subject, data.deadlines[0].subject, data.tasks[0].subject, data.tasks[1].subject], ["s-geografie", "s-kunst-2", null, "s-kunst"]);
    assert.deepEqual(data.notes, [{ id: "n" }]);
    const base = {
      subjects: { "2e939669": { name: "Geografie", label: "Geografie", short: "Geo", hue: "jade" }, 7: { name: "Kunst", label: "Kunst", short: "Kun", hue: "rose" }, "2e40f0f3": { name: "Mathe", label: "Mathe", short: "Mat", hue: "slate" } },
      courses: {},
      blocks: twoBlocks,
      timetable: clone(state.timetable),
      abReference: "2026-01-12",
    };
    assert.deepEqual(fileSubjects(base.subjects, keys), { "s-kunst-2": "Kunst", "s-geografie": "Geografie", "2e40f0f3": "Mathe" });
    const own = { subjects: { items: { "0042": { custom: true, name: "Geografie", short: "Geo", hue: "moss", type: "LK", teacher: "", room: "" }, "s-kunst": { custom: true, name: "Kunst AG", short: "Kun", hue: "plum", type: "GK", teacher: "", room: "" } }, removed: ["0042"] } };
    const back = fitSchool(whole, { abReference: "2026-01-12", subjects: fileSubjects(base.subjects, keys) }, { ...base, own });
    assert.deepEqual([...back.keys].sort(), [["2e40f0f3", "2e40f0f3"], ["s-geografie", "2e939669"], ["s-geografie-2", "0042"], ["s-kunst", "s-kunst"], ["s-kunst-2", "7"]]);
    assert.deepEqual(back.values, { "app-subjects": own.subjects });
    const phone = fitSchool({ "app-subjects": { items: { "12e3": { custom: true, name: "Musik", short: "Mus", hue: "teal", type: "GK", teacher: "", room: "" } }, removed: [] } }, from, empty);
    assert.deepEqual([...phone.keys], [["12e3", "s-musik"]]);
  },
  "a and b are swapped exactly when the two devices count the weeks differently"() {
    const whole = wholeSchool(shown());
    assert.equal("app-ab-swap" in fitSchool(whole, { abReference: "2026-03-08" }, mac).values, false);
    assert.equal(fitSchool(whole, { abReference: "2026-03-08" }, { ...mac, abReference: "2026-01-05" }).values["app-ab-swap"], true);
    assert.equal(fitSchool(whole, { abReference: "2026-10-12" }, { ...mac, abReference: "2026-10-05" }).values["app-ab-swap"], true);
    assert.equal("app-ab-swap" in fitSchool({ ...whole, "app-ab-swap": true }, { abReference: "2026-10-12" }, { ...mac, abReference: "2026-09-28" }).values, false);
    assert.equal(fitSchool(wholeSchool(shown({ weeks: false })), from, mac).values["app-ab-weeks"], false);
  },
  "other settings pass through untouched"() {
    const values = fitSchool({ ...wholeSchool(shown()), "app-settings": { transit: { deutschlandticket: true } }, "app-cal-view": "week" }, from, mac).values;
    assert.deepEqual(values, { "app-settings": { transit: { deutschlandticket: true } }, "app-cal-view": "week" });
  },
  "entries are taken once, however often the file is read"() {
    const grade = (points, title = "") => ({ id: `g-${points}${title}`, subject: "m", points, type: "klausur", semester: "Q1", date: "2026-09-01", title });
    const file = {
      grades: [grade(12), grade(12), grade(9, "Analysis")],
      deadlines: [{ id: "test-a", kind: "Test", title: "Vokabeln", subject: "d", date: "2026-10-20", detail: "Unit 3", status: "offen" }],
      tasks: [{ id: "5", title: "Lesen", subject: "d", date: "2026-10-15", minutes: 20, deadline: "test-a" }, { id: "6", title: "Fertig", done: true }],
      notes: [{ id: "n", type: "idea", title: "Idee", details: "x" }],
      events: [{ id: "loc-1", title: "Training", date: "2026-10-13", start: "17:00", kind: "training" }, { id: "loc-2", title: "Arzt", date: "2026-10-14", start: null, kind: "private", google: true }],
      places: { home: { name: "Hauptstraße 1", area: "Musterstadt", lat: 52.4, lon: 13.1, stop: "" } },
    };
    const keys = new Map([["m", "2"], ["d", "1"]]);
    const first = recordPlan(file, { grades: [], deadlines: [], tasks: [], notes: [], events: [], places: {} }, keys);
    assert.equal(planSize(first), 9);
    assert.deepEqual(first.grades.fresh.map((item) => item.subject), ["2", "2", "2"]);
    assert.deepEqual([...subjectsInUse(first)].sort(), ["1", "2"]);
    assert.equal(first.tasks.fresh.length, 1);
    const mine = {
      grades: [{ ...grade(12), id: "g-x", subject: "2" }],
      deadlines: [{ id: "test-z", kind: "Test", title: "Vokabeln", subject: "1", date: "2026-10-20", detail: "", status: "offen" }],
      tasks: [{ id: "9", title: "Lesen", subject: "1", date: "2026-10-15", done: true }],
      notes: [{ id: "q", type: "idea", title: "Idee", details: "x" }],
      events: [{ id: "loc-7", title: "Training", date: "2026-10-13", start: "17:00" }],
      places: { home: { name: "Hauptstraße 1", area: "Musterstadt", lat: 52.4, lon: 13.1, stop: "" } },
    };
    const again = recordPlan(file, mine, keys);
    assert.equal(again.grades.fresh.length, 2);
    assert.equal(again.grades.known.length, 1);
    assert.deepEqual(again.deadlines.known.map(([item, twin]) => [item.id, twin.id]), [["test-a", "test-z"]]);
    assert.equal(again.tasks.fresh.length + again.notes.fresh.length + again.places.length, 0);
    assert.deepEqual(again.events.fresh.map((item) => item.title), ["Arzt"]);
    assert.equal(recordPlan(file, mine, keys, { google: true }).events.fresh.length, 0);
    assert.equal(recordPlan(file, { ...mine, events: [] }, keys, { synced: [{ title: "Training", date: "2026-10-13", start: "17:00", synced: true }] }).events.fresh.length, 1);
  },
  "a grade without its subject is not taken, an entry without one loses only the subject"() {
    const file = {
      grades: [{ id: "g-1", subject: "gone", points: 11, type: "test", semester: "Q1", date: "2026-09-01", title: "" }, { id: "g-2", subject: "m", points: 16, type: "test", semester: "Q1", date: "2026-09-01" }],
      deadlines: [{ id: "exam-1", kind: "Klausur", title: "Analysis", subject: "gone", date: "2026-11-02" }, { id: "x", kind: "Fest", title: "Feier", date: "2026-11-02" }],
    };
    const plan = recordPlan(file, {}, new Map([["m", "m"]]));
    assert.equal(plan.skipped, 1);
    assert.equal(plan.grades.fresh.length, 0);
    assert.deepEqual(plan.deadlines.fresh.map((item) => item.subject), [null]);
    assert.deepEqual(recordPlan({ grades: [file.grades[0]] }, {}, null).grades.fresh.map((item) => item.subject), ["gone"]);
  },
  "a place is only written where it differs"() {
    const home = { name: "Hauptstraße 1", area: "Musterstadt", lat: 52.4, lon: 13.1, stop: "" };
    const plan = recordPlan({ places: { home, school: { name: "Schule", lat: "x", lon: 13 } } }, { places: { home: { ...home, lat: 52.5 } } }, null);
    assert.deepEqual(plan.places, [["home", home, { ...home, lat: 52.5 }]]);
    const stop = { name: "Musterstadt Hbf", area: "Musterstadt", lat: 52.39, lon: 13.06, stop: "de-VBB_1" };
    const merged = { places: { home: { ...home, name: "Hauptstraße 1, Musterstadt", area: "" }, school: { ...stop, area: "" } } };
    assert.deepEqual(recordPlan({ places: { home, school: stop } }, merged, null).places, []);
    assert.equal(recordPlan({ places: { home: { ...home, name: "Nebenstraße 2" } } }, merged, null).places.length, 1);
  },
  "what is sent to the device is what its pages would send"() {
    const refs = new Map([["test-a", "test-9"]]);
    assert.deepEqual(BODIES.tasks({ title: "Lesen", subject: "1", date: "2026-10-15", minutes: 30, priority: true, deadline: "test-a", repeat: "weekly", dueTime: "9:05", notes: "S. 12", source: "iserv" }, refs), { title: "Lesen", subject: "1", date: "2026-10-15", someday: false, dueTime: "9:05", minutes: 30, priority: true, repeat: "weekly", notes: "S. 12", deadline: "test-9", source: "iserv" });
    assert.deepEqual(BODIES.tasks({ title: "Irgendwann", someday: true, date: "2026-10-15", deadline: "test-x" }, refs), { title: "Irgendwann", subject: null, date: null, someday: true, priority: false, notes: "", source: "own" });
    assert.deepEqual(BODIES.deadlines({ kind: "Hausaufgabe", title: "S. 12", subject: "1", date: "2026-10-15", detail: "", status: "abgegeben", time: "08:00" }), { kind: "Hausaufgabe", title: "S. 12", subject: "1", date: "2026-10-15", detail: "", status: "abgegeben" });
    assert.deepEqual(BODIES.deadlines({ kind: "Klausur", title: "Analysis", subject: null, date: "2026-11-02", detail: "Kap. 3", time: "08:00" }), { kind: "Klausur", title: "Analysis", subject: "", date: "2026-11-02", detail: "Kap. 3", time: "08:00" });
    assert.deepEqual(BODIES.grades({ subject: "2", points: 12, type: "klausur", semester: "Q1", date: "2026-09-01" }), { subject: "2", points: 12, type: "klausur", date: "2026-09-01", title: "", semester: "Q1" });
    assert.deepEqual(BODIES.events({ title: "Fahrt", date: "2026-10-13", endDate: "2026-10-15", start: null, end: null, place: "Hafen", notes: "", kind: "school" }), { title: "Fahrt", date: "2026-10-13", endDate: "2026-10-15", place: "Hafen", notes: "", kind: "school" });
    assert.deepEqual(BODIES.notes({ title: "Idee", details: "x", type: "idea", created: "2026-10-01T10:00:00" }), { title: "Idee", details: "x", type: "idea", created: "2026-10-01T10:00:00" });
  },
  "a backup names what it holds before anything is taken over"() {
    const file = {
      grades: [{ subject: "m", points: 12, type: "klausur", date: "2026-10-01", semester: "Q3" }, { subject: "", points: 9, date: "2026-10-02" }],
      deadlines: [{ kind: "Test", title: "Vektoren", date: "2026-11-12" }, { kind: "Hausaufgabe", title: "S. 40", date: "2026-11-10" }, { kind: "Hausaufgabe", title: "S. 41", date: "2026-11-11" }],
      tasks: [{ title: "Referat" }, { title: "Erledigt", done: true }],
      notes: [],
      events: [{ title: "Elternabend", date: "2026-11-20" }],
      places: { home: { name: "Lindenallee", lat: 52.52, lon: 13.4 }, school: { name: "" } },
    };
    assert.equal(contents(file), `1${nb}Note, 2${nb}Hausaufgaben, 1${nb}Test, 1${nb}Aufgabe, 1${nb}Termin und 1${nb}Ort`);
    assert.equal(contents({ grades: [{ subject: "m", points: 3, date: "2026-10-01" }] }), `1${nb}Note`);
    assert.equal(contents({}), "");
    assert.equal(contents(null), "");
  },
  "the closing line says what came, what was there and what failed"() {
    assert.equal(summary({ settings: true, made: { grades: 84, Test: 15, Klausur: 1, tasks: 2, events: 13, places: 2 }, known: 0, failed: 0 }), `Übernommen: Stundenplan und Einstellungen, 84${nb}Noten, 15${nb}Tests, 1${nb}Klausur, 2${nb}Aufgaben, 13${nb}Termine und 2${nb}Orte.`);
    assert.equal(summary({ settings: true, made: {}, known: 124, failed: 1 }), `Übernommen: Stundenplan und Einstellungen. 124${nb}Einträge waren schon da. 1${nb}Eintrag ließ sich nicht übernehmen.`);
    assert.equal(summary({ made: {}, known: 1 }), `Nichts Neues übernommen. 1${nb}Eintrag war schon da.`);
    assert.equal(summary({ settings: true, unread: true }), "Übernommen: Stundenplan und Einstellungen. Noten, Aufgaben und Termine ließen sich gerade nicht übernehmen.");
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    run();
    console.log(`ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${String(error?.message || error).split("\n").join("\n      ")}`);
  }
}
if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
