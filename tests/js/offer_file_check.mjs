// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { offerFile } = await import(pathToFileURL(resolve(here, "../../app/static/app/js/backup.js")).href);

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15";
const PIXEL = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

const links = [];
const delays = [];
globalThis.document = {
  createElement: () => {
    const link = { clicked: 0, removed: false, click() { this.clicked += 1; }, remove() { this.removed = true; } };
    links.push(link);
    return link;
  },
  body: { append: () => {} },
};
globalThis.setTimeout = (run, ms) => delays.push(ms);

function device({ agent, touch = 0, platform = "", share }) {
  const shared = [];
  const navigator = { userAgent: agent, maxTouchPoints: touch, platform };
  if (share) {
    navigator.canShare = (data) => Array.isArray(data.files) && data.files.length > 0;
    navigator.share = async (data) => {
      shared.push(data.files[0]);
      if (share !== true) throw Object.assign(new Error(share), { name: share });
    };
  }
  Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true });
  links.length = 0;
  delays.length = 0;
  return shared;
}

let shared = device({ agent: IPHONE, platform: "iPhone", touch: 5, share: true });
assert.equal(await offerFile("app-sicherung.json", '{"a":1}'), "shared", "the iPhone gets the share sheet");
assert.equal(shared.length, 1);
assert.equal(shared[0].name, "app-sicherung.json");
assert.equal(shared[0].type, "application/json");
assert.equal(await shared[0].text(), '{"a":1}');
assert.equal(links.length, 0, "and no download link");

shared = device({ agent: IPAD, platform: "MacIntel", touch: 5, share: true });
assert.equal(await offerFile("x.json", "{}"), "shared", "an iPad that calls itself a Mac also gets the share sheet");

device({ agent: IPHONE, platform: "iPhone", touch: 5, share: "AbortError" });
assert.equal(await offerFile("x.json", "{}"), "cancelled", "closing the share sheet saves nothing and says nothing");
assert.equal(links.length, 0);

device({ agent: IPHONE, platform: "iPhone", touch: 5, share: "NotAllowedError" });
assert.equal(await offerFile("x.json", "{}"), "saved", "a refused share sheet falls back to the download");
assert.equal(links.length, 1);

for (const phone of [{ agent: PIXEL, platform: "Linux armv8l", touch: 5, share: true }, { agent: IPHONE, platform: "iPhone", touch: 5 }]) {
  shared = device(phone);
  assert.equal(await offerFile("plan.json", "{}"), "saved");
  assert.equal(shared.length, 0, "Android and older iPhones download the file");
  assert.equal(links.length, 1);
  assert.equal(links[0].download, "plan.json");
  assert.match(links[0].href, /^blob:/);
  assert.equal(links[0].clicked, 1);
  assert.ok(links[0].removed);
  assert.ok(delays.every((ms) => ms >= 60000), "the file stays reachable while the browser still asks where to save it");
}

console.log("offer file: ok");
