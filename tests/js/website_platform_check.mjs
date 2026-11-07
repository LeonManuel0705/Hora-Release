// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, "../../landing-page/src");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const de = json(resolve(site, "content/i18n-de.json"));
const en = json(resolve(site, "content/i18n-en.json"));
const brand = json(resolve(here, "../../brand/brand.json"));
const content = { company: { name: brand.name, repository: brand.repository, website: brand.website, websiteHost: new URL(brand.website).host, email: "" }, i18n_de: de, i18n_en: en };

globalThis.document = { getElementById: () => ({ textContent: JSON.stringify(content) }), documentElement: {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const device = { userAgent: "", platform: "", maxTouchPoints: 0, userAgentData: undefined };
Object.defineProperty(globalThis, "navigator", { value: device, configurable: true, writable: true });

const { detectPlatform, deviceName, ISERV_HOMEWORK } = await import(pathToFileURL(resolve(site, "js/lib/platform.js")).href);
const { cta } = await import(pathToFileURL(resolve(site, "js/components/cta.js")).href);

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const CROS_UA = "Mozilla/5.0 (X11; CrOS x86_64 16181.61.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const DEVICES = {
  iphone: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone", maxTouchPoints: 5 },
  ipad: { userAgent: MAC_UA, platform: "MacIntel", maxTouchPoints: 5 },
  mac: { userAgent: MAC_UA, platform: "MacIntel", maxTouchPoints: 0 },
  android: { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36", platform: "Linux armv81", maxTouchPoints: 5 },
  chromebook: { userAgent: CROS_UA, platform: "Linux x86_64", maxTouchPoints: 0, userAgentData: { platform: "Chrome OS" } },
  oldChromebook: { userAgent: CROS_UA, platform: "Linux x86_64", maxTouchPoints: 0 },
  windows: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", platform: "Win32", maxTouchPoints: 0, userAgentData: { platform: "Windows" } },
  linux: { userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0", platform: "Linux x86_64", maxTouchPoints: 0 },
  unknown: { userAgent: "", platform: "", maxTouchPoints: 0 },
};
const use = (name) => Object.assign(device, { userAgentData: undefined }, DEVICES[name]);

const strings = (value) => (typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === "object" ? Object.values(value).flatMap(strings) : []);
const shape = (value) => (Array.isArray(value) ? value.map(shape) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)])) : typeof value);

const tests = {
  "every device lands on its own download or on the web app"() {
    const expected = { iphone: "ios", ipad: "ios", mac: "macos", android: "android", chromebook: "web", oldChromebook: "web", windows: "windows", linux: "linux", unknown: null };
    for (const [name, id] of Object.entries(expected)) {
      use(name);
      assert.equal(detectPlatform(), id, name);
    }
  },
  "the web app note names the device the visitor holds"() {
    use("iphone");
    assert.equal(deviceName("ios"), "iPhone");
    use("ipad");
    assert.equal(deviceName("ios"), "iPad");
    use("chromebook");
    assert.equal(deviceName("web"), "Chromebook");
  },
  "a download button opens the sheet first and points at the renamed repository"() {
    use("windows");
    const { id, button, note } = cta();
    assert.equal(id, "windows");
    assert.match(button, /data-install="windows"/);
    assert.match(button, / download /);
    assert.ok(button.includes(`href="${brand.repository}/releases/download/v`), button);
    assert.equal(note, "Für Windows, 187 MB. Auch für Mac, Linux, Android und iPhone.");
  },
  "iphone and ipad get the home screen sheet, chromebooks go straight to the web app"() {
    use("iphone");
    let result = cta();
    assert.match(result.button, /href="\/pwa\/" data-install="ios"/);
    assert.equal(result.note, `Auf dem iPhone läuft {{BRAND_NAME}} als Web-App. Auch für Mac, Windows, Linux und Android.`);
    use("ipad");
    assert.equal(cta().note, `Auf dem iPad läuft {{BRAND_NAME}} als Web-App. Auch für Mac, Windows, Linux und Android.`);
    use("chromebook");
    result = cta();
    assert.doesNotMatch(result.button, /data-install/);
    assert.match(result.button, /href="\/pwa\/"/);
    assert.equal(result.note, `Auf dem Chromebook läuft {{BRAND_NAME}} als Web-App. Auch für Mac, Windows, Linux, Android und iPhone.`);
    use("unknown");
    assert.match(cta().button, /href="\/download"/);
  },
  "only platforms that fetch homework from iserv get the iserv line"() {
    assert.deepEqual([...ISERV_HOMEWORK], ["android"]);
    for (const lang of [de, en]) {
      assert.match(lang.start.lede, /IServ/);
      assert.doesNotMatch(lang.start.lede_plain, /IServ|¹/);
      assert.match(lang.start.footnote_iserv_web, /\{device\}/);
    }
  },
  "both languages carry the same new keys"() {
    for (const key of ["install", "steps", "platforms"]) assert.deepEqual(shape(en[key]), shape(de[key]), key);
    assert.deepEqual(Object.keys(en.meta.desc), Object.keys(de.meta.desc));
    assert.deepEqual(shape(en.download_page.faq), shape(de.download_page.faq));
  },
  "the iphone steps mark where the share symbol goes, once"() {
    for (const lang of [de, en]) {
      assert.equal(lang.steps.ios.length, 3);
      assert.equal(lang.steps.ios.join(" ").split("{share}").length - 1, 1);
      assert.match(lang.steps.ios[1], /\{share\}/);
    }
  },
  "new copy has no dashes inside sentences and no hardcoded name"() {
    for (const lang of [de, en]) {
      const added = strings([lang.install, lang.steps, lang.meta.desc, lang.start.lede_plain, lang.start.footnote_iserv, lang.start.footnote_iserv_web, lang.download_page.faq, lang.privacy_policy, lang.terms]);
      for (const text of added) {
        assert.doesNotMatch(text, /—| – /, text);
        assert.doesNotMatch(text, new RegExp(`\\b${brand.name}\\b`), text);
      }
    }
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
