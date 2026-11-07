// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { storageNote, safariOnMac } = await import(pathToFileURL(resolve(here, "../../app/static/app/js/persistence.js")).href);

const SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15";
const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const FIREFOX_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0";
const brand = "App";
const note = (fields) => storageNote({ shell: "web", persisted: false, device: null, homeScreen: false, macSafari: false, brand, ...fields });

assert.equal(storageNote({ shell: "mobile", persisted: false, brand }), null, "the apps keep their data on disk and need no row");
assert.equal(note({ persisted: null }), null, "nothing is said before the browser answered");

const tab = note({ device: "iPhone" });
assert.equal(tab.state, "tab", "an iPhone tab is only kept for now");
assert.match(tab.text, /sieben Tage/);
assert.match(tab.text, /Home-Bildschirm/);
assert.doesNotMatch(tab.text, /Safari/, "Chrome or Firefox on the iPhone are not called Safari");
assert.equal(note({ device: "iPad", persisted: true }).state, "tab", "lasting storage does not lift the seven day rule of a tab");

assert.equal(note({ device: "iPhone", homeScreen: true, persisted: true }).state, "kept", "the home screen app keeps what it was granted");
assert.equal(note({ device: "iPhone", homeScreen: true }).state, "ask", "and may ask again");

const mac = note({ macSafari: true });
assert.equal(mac.state, "tab", "Safari on the Mac deletes after seven days too");
assert.match(mac.text, /Safari/);
assert.match(mac.text, /Exportieren/);

assert.equal(note({ persisted: true }).state, "kept");
assert.equal(note({}).state, "ask");

for (const result of [tab, mac, note({ persisted: true }), note({})]) {
  assert.doesNotMatch(result.text, /[—–]/, "no dashes in the copy");
}

assert.equal(safariOnMac(SAFARI_MAC, 0), true);
assert.equal(safariOnMac(SAFARI_MAC, 5), false, "an iPad that calls itself a Mac is an iPad");
assert.equal(safariOnMac(CHROME_MAC, 0), false);
assert.equal(safariOnMac(FIREFOX_MAC, 0), false);

console.log("persistence: ok");
