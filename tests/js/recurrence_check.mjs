// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { normalizeRecurrence, occurrenceDates, expandEvents, splitOccurrence, occurrenceId, ruleText } = await import(pathToFileURL(resolve(here, "../../app/static/app/js/recurrence.js")).href);

const event = (recurrence, extra = {}) => ({ id: "loc-1", title: "Klavier", date: "2026-11-04", start: "15:00", end: "15:45", recurrence, ...extra });
const dates = (recurrence, from, to, extra) => occurrenceDates(event(recurrence, extra), from, to);

const tests = {
  "a rule is kept only in the shape it is stored in"() {
    assert.equal(normalizeRecurrence(null), null);
    assert.equal(normalizeRecurrence({ freq: "hourly" }), null);
    assert.deepEqual(normalizeRecurrence({ freq: "weekly" }), { freq: "weekly", interval: 1, until: null, count: null, exceptions: [] });
    assert.deepEqual(normalizeRecurrence({ freq: "weekly", interval: "2", until: "2026-12-31", exceptions: ["2026-11-18", "2026-11-18", "bad", "2026-02-30"] }), { freq: "weekly", interval: 2, until: "2026-12-31", count: null, exceptions: ["2026-11-18"] });
    assert.deepEqual(normalizeRecurrence({ freq: "daily", count: 3, until: "2026-12-31" }), { freq: "daily", interval: 1, until: null, count: 3, exceptions: [] });
  },
  "an event that does not repeat is there on its days only"() {
    assert.deepEqual(dates(null, "2026-11-01", "2026-11-30"), ["2026-11-04"]);
    assert.deepEqual(dates(null, "2026-11-05", "2026-11-30"), []);
    assert.deepEqual(dates(null, "2026-11-05", "2026-11-30", { endDate: "2026-11-06" }), ["2026-11-04"]);
  },
  "daily, weekly, every two weeks, monthly and yearly come round on their days"() {
    assert.deepEqual(dates({ freq: "daily" }, "2026-11-04", "2026-11-07"), ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    assert.deepEqual(dates({ freq: "weekly" }, "2026-11-01", "2026-11-30"), ["2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"]);
    assert.deepEqual(dates({ freq: "weekly", interval: 2 }, "2026-11-01", "2026-12-31"), ["2026-11-04", "2026-11-18", "2026-12-02", "2026-12-16", "2026-12-30"]);
    assert.deepEqual(dates({ freq: "monthly" }, "2026-11-01", "2027-02-28"), ["2026-11-04", "2026-12-04", "2027-01-04", "2027-02-04"]);
    assert.deepEqual(dates({ freq: "yearly" }, "2026-01-01", "2029-12-31"), ["2026-11-04", "2027-11-04", "2028-11-04", "2029-11-04"]);
  },
  "a series ends on its last day or after its number of times"() {
    assert.deepEqual(dates({ freq: "weekly", until: "2026-11-18" }, "2026-11-01", "2026-12-31"), ["2026-11-04", "2026-11-11", "2026-11-18"]);
    assert.deepEqual(dates({ freq: "weekly", count: 3 }, "2026-11-01", "2026-12-31"), ["2026-11-04", "2026-11-11", "2026-11-18"]);
    assert.deepEqual(dates({ freq: "weekly", count: 3 }, "2026-11-12", "2026-12-31"), ["2026-11-18"]);
  },
  "a skipped day stays away and still counts towards the number of times"() {
    assert.deepEqual(dates({ freq: "weekly", exceptions: ["2026-11-11"] }, "2026-11-01", "2026-11-30"), ["2026-11-04", "2026-11-18", "2026-11-25"]);
    assert.deepEqual(dates({ freq: "weekly", count: 3, exceptions: ["2026-11-11"] }, "2026-11-01", "2026-12-31"), ["2026-11-04", "2026-11-18"]);
  },
  "the 31st and the 29th of February come round only where they exist, as in Google"() {
    assert.deepEqual(occurrenceDates({ date: "2026-01-31", recurrence: { freq: "monthly" } }, "2026-01-01", "2026-06-30"), ["2026-01-31", "2026-03-31", "2026-05-31"]);
    assert.deepEqual(occurrenceDates({ date: "2028-02-29", recurrence: { freq: "yearly" } }, "2028-01-01", "2036-12-31"), ["2028-02-29", "2032-02-29", "2036-02-29"]);
  },
  "a series that started long ago is counted from far away without walking every day"() {
    assert.deepEqual(occurrenceDates({ date: "2020-01-06", recurrence: { freq: "weekly" } }, "2026-11-09", "2026-11-15"), ["2026-11-09"]);
    assert.deepEqual(occurrenceDates({ date: "2020-01-01", recurrence: { freq: "daily" } }, "2026-11-09", "2026-11-10"), ["2026-11-09", "2026-11-10"]);
  },
  "an occurrence of an event over midnight also touches the day it ends"() {
    const night = { id: "loc-2", date: "2026-11-06", endDate: "2026-11-07", start: "20:00", end: "10:00", recurrence: { freq: "weekly" } };
    assert.deepEqual(occurrenceDates(night, "2026-11-14", "2026-11-14"), ["2026-11-13"]);
    const [one] = expandEvents([night], "2026-11-14", "2026-11-14");
    assert.deepEqual([one.id, one.date, one.endDate, one.series, one.occurrence], ["loc-2~2026-11-13", "2026-11-13", "2026-11-14", "loc-2", "2026-11-13"]);
  },
  "every occurrence has an id of its own that leads back to the series"() {
    const list = expandEvents([event({ freq: "weekly" }), { id: "loc-9", date: "2026-11-05" }], "2026-11-01", "2026-11-14");
    assert.deepEqual(list.map((item) => item.id), ["loc-1~2026-11-04", "loc-1~2026-11-11", "loc-9"]);
    assert.deepEqual(splitOccurrence(occurrenceId("loc-1", "2026-11-11")), { series: "loc-1", date: "2026-11-11" });
    assert.equal(splitOccurrence("loc-9"), null);
  },
  "the rule reads in words"() {
    assert.equal(ruleText({ freq: "weekly" }), "Jede Woche");
    assert.equal(ruleText({ freq: "weekly", interval: 2, count: 10 }), "Alle 2 Wochen, 10 Mal");
    assert.equal(ruleText({ freq: "monthly", until: "2027-06-30" }, (iso) => `am ${iso}`), "Jeden Monat, bis am 2027-06-30");
    assert.equal(ruleText(null), "");
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n${error.stack}`);
  }
}
process.exit(failed ? 1 : 0);
