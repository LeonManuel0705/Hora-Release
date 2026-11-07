// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const { cases } = JSON.parse(readFileSync(resolve(here, "../ab_weeks.json"), "utf8"));

const sandbox = { window: {}, document: { addEventListener() {} }, console, localStorage: { getItem: () => null, setItem() {} } };
vm.runInNewContext(`${readFileSync(resolve(root, "app/static/js/notifications.js"), "utf8")}\nthis.AppNotifications = AppNotifications;`, sandbox);
const notifications = sandbox.AppNotifications;

const page = readFileSync(resolve(root, "app/templates/hub/school.html"), "utf8");
const start = page.indexOf("function getWeekType(date) {");
const source = page.slice(start, page.indexOf("\n}\n", start) + 2);
const schoolWeek = (reference, swapped, enabled) => new Function("timetableSettings", "REFERENCE_A_WEEK", "AB_SWAP", `${source}\nreturn getWeekType;`)({ has_ab_weeks: enabled }, reference, swapped);

const localDay = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const at = (iso, time) => new Date(`${iso}T${time}:00`);
const other = (letter) => (letter === "A" ? "B" : "A");

function notificationWeek(reference, swapped, enabled) {
  notifications._schoolSettings = { hasAbWeeks: enabled, referenceDate: notifications._localDay(reference), swapped };
  return (date) => notifications._getWeekType(date);
}

const tests = {
  "the clock of this run has summer time, so the grid tests it"() {
    assert.notEqual(new Date(2026, 0, 15).getTimezoneOffset(), new Date(2026, 6, 15).getTimezoneOffset(), "run with TZ=Europe/Berlin");
  },
  "the classic reminders count the weeks like the desktop, before and after summer time"() {
    for (const item of cases) {
      const week = notificationWeek(item.reference, false, true);
      for (const time of ["00:00", "12:00", "23:59"]) assert.equal(week(at(item.day, time)), item.week, `${item.day} ${time} from ${item.reference}`);
    }
  },
  "the classic school page counts the weeks like the desktop, before and after summer time"() {
    for (const item of cases) {
      const week = schoolWeek(localDay(item.reference), false, true);
      for (const time of ["00:00", "12:00", "23:59"]) assert.equal(week(at(item.day, time)), item.week, `${item.day} ${time} from ${item.reference}`);
    }
  },
  "both follow A und B tauschen of the new pages, and A/B switched off means A"() {
    for (const item of cases) {
      assert.equal(notificationWeek(item.reference, true, true)(at(item.day, "12:00")), other(item.week), item.day);
      assert.equal(schoolWeek(localDay(item.reference), true, true)(at(item.day, "12:00")), other(item.week), item.day);
      assert.equal(notificationWeek(item.reference, false, false)(at(item.day, "12:00")), "A");
      assert.equal(schoolWeek(localDay(item.reference), false, false)(at(item.day, "12:00")), "A");
    }
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok - ${name}\n${error.stack}`);
  }
}
process.exit(failed ? 1 : 0);
