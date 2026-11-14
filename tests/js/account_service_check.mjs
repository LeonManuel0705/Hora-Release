// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The app's account client against the real account service, the demo worker under wrangler dev. The app signs up from
// its own loopback origin with a token, the demo page's own client (loaded from the worker) signs in to the same
// account with its cookie, and each opens the timetable entries of the other. Without a service on the port it skips.

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const BASE = process.env.ACCOUNT_SERVICE_URL || "http://127.0.0.1:8794";
const ORIGIN = "http://127.0.0.1:5050";
const PASSWORD = "Stadtpark-im-Herbst-27";
const here = dirname(fileURLToPath(import.meta.url));
const script = (name) => pathToFileURL(resolve(here, "../../app/static/app/js", name)).href;

async function reachable() {
  try {
    const response = await fetch(`${BASE}/api/session`, { signal: AbortSignal.timeout(3000) });
    return response.status === 401 && (await response.json()).error === "no_session";
  } catch {
    return false;
  }
}

if (!(await reachable())) {
  console.log(`skip: no account service answers on ${BASE}`);
  process.exit(0);
}

// The demo page's own client as the worker serves it, in a folder of its own.
async function demoClient() {
  const folder = await mkdtemp(join(tmpdir(), "account-demo-client-"));
  await writeFile(join(folder, "package.json"), '{"type":"module"}');
  for (const name of ["auth-client.js", "key-store.js", "password-check.js", "sync-client.js", "timetable-entry.js"]) {
    const response = await fetch(`${BASE}/js/${name}`);
    assert.equal(response.status, 200, name);
    await writeFile(join(folder, name), await response.text());
  }
  const load = (name) => import(pathToFileURL(join(folder, name)).href);
  return { ...(await load("auth-client.js")), ...(await load("key-store.js")), ...(await load("timetable-entry.js")) };
}

const demo = await demoClient();
const { createAuthClient, appFetch } = await import(script("account/auth-client.js"));
const { createSyncClient } = await import(script("sync/client.js"));
const { timetableEntry, readTimetableEntry } = await import(script("sync/timetable-entry.js"));

const email = `compat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.org`;
const held = { token: null };
const answers = [];
const fromApp = (url, options = {}) =>
  fetch(url, { ...options, headers: { ...options.headers, Origin: ORIGIN } }).then((response) => {
    answers.push({ url, status: response.status, allowed: response.headers.get("access-control-allow-origin"), cookies: response.headers.getSetCookie() });
    return response;
  });
const request = appFetch({ token: () => held.token, fetchImpl: fromApp });
const app = createAuthClient({ baseUrl: BASE, fetchImpl: request });

let jar = "";
const withCookie = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { ...options.headers, ...(jar ? { Cookie: jar } : {}) } });
  for (const line of response.headers.getSetCookie()) jar = line.split(";")[0].endsWith("=") ? "" : line.split(";")[0];
  return response;
};
const page = demo.createAuthClient({ baseUrl: BASE, fetchImpl: withCookie, keyStore: demo.memoryKeyStore() });
const codeFor = async (address) => (await page.demo.listMail()).find((mail) => mail.to === address)?.code;

const plan = (subject, device) =>
  timetableEntry({
    record: { at: Date.now(), origin: "edit", device },
    plan: { "app-subjects": { items: { [subject.toLowerCase()]: { name: subject, hue: "lake", type: "GK" } } }, "app-ab-weeks": false },
    abReference: "2026-09-07",
  });

await app.signUp(email, PASSWORD);
const verified = await app.verifyEmail(email, await codeFor(email));
held.token = verified.token;
assert.equal(verified.account.email, email);
assert.ok(verified.key, "the app keeps the key of its own sign up");
assert.ok(answers.every((answer) => answer.allowed === ORIGIN), "every answer allows the app's origin");
assert.deepEqual(answers.flatMap((answer) => answer.cookies), [], "and sets no cookie");

const appSync = createSyncClient({ key: verified.key, account: verified.account.id, baseUrl: BASE, fetchImpl: request });
const fromAppPlan = plan("Mathe", "a".repeat(32));
assert.equal(await appSync.push("timetable", fromAppPlan), 1);

await page.auth.signIn(email, PASSWORD);
const pageSync = await page.auth.openSync();
const seenByPage = await pageSync.pull("timetable");
assert.deepEqual(seenByPage.unreadable, []);
assert.deepEqual(demo.readTimetableEntry(seenByPage.entries[0].value), fromAppPlan, "the demo page opens the entry of the app");
const fromPagePlan = demo.timetableEntry({ record: { at: Date.now(), origin: "edit", device: "b".repeat(32) }, plan: { "app-ab-weeks": true }, abReference: null });
assert.equal(await pageSync.push("timetable", fromPagePlan), 2);

const again = await app.signIn(email, PASSWORD);
const previous = held.token;
held.token = again.token;
assert.notEqual(again.token, previous);
const seenByApp = await createSyncClient({ key: again.key, account: again.account.id, baseUrl: BASE, fetchImpl: request }).pull("timetable");
assert.deepEqual([seenByApp.unreadable, seenByApp.entries.map((entry) => entry.value)], [[], [fromAppPlan, fromPagePlan]], "the app opens both");
assert.deepEqual(readTimetableEntry(seenByApp.entries[1].value).record, fromPagePlan.record, "and reads the page's entry as a timetable entry");

assert.equal((await app.session()).account.id, verified.account.id);
await app.endSession(held.token);
await assert.rejects(app.session(), (error) => error.code === "no_session");
assert.equal((await page.auth.getSession()).account.email, email, "the page's cookie session stays");
await app.endSession(previous);
await page.auth.signOut();
console.log("ok   the app and the demo page share one account and open each other's entries");

await page.auth.signIn(email, PASSWORD);
held.token = (await app.signIn(email, PASSWORD)).token;
await assert.rejects(app.deleteAccount(email, "Falsch-geraten-im-Herbst"), (error) => error.code === "invalid_credentials" && error.status === 403);
assert.equal((await app.session()).account.email, email, "a wrong password deletes nothing and ends no session");
assert.deepEqual(await app.deleteAccount(email, PASSWORD), {});
await assert.rejects(app.session(), (error) => error.code === "no_session" && error.status === 401);
assert.equal(await page.auth.getSession(), null, "the page's cookie session on the account ends too");
await assert.rejects(app.signIn(email, PASSWORD), (error) => error.code === "invalid_credentials");
console.log("ok   the app deletes the account on the real service with its password");
