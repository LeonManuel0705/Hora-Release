import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = pathToFileURL(resolve(here, "../../app/static/app/js/pomodoro-timer.js")).href;

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

let clock = Date.UTC(2026, 9, 6, 13, 0, 0);
Date.now = () => clock;

const calls = [];
let response = () => ({ ok: true, status: 200 });
globalThis.fetch = async (url, options) => {
  calls.push({ url, body: JSON.parse(options.body) });
  return response();
};

const settled = () => new Promise((done) => setTimeout(done, 5));
const timer = await import(source);
const { MINUTE } = timer;

function fresh() {
  store.clear();
  calls.length = 0;
  response = () => ({ ok: true, status: 200 });
}

const tests = {
  async "a new timer is idle on the work phase with 25 and 5 minutes"() {
    const state = timer.blank();
    assert.equal(state.phase, "work");
    assert.equal(state.status, "idle");
    assert.deepEqual(state.minutes, { work: 25, break: 5 });
    assert.equal(timer.remaining(state, clock), 25 * MINUTE);
  },

  async "starting, pausing and resuming keep the remaining time"() {
    const idle = timer.blank();
    const running = timer.start(idle, clock);
    assert.equal(running.endsAt, clock + 25 * MINUTE);
    const later = clock + 10 * MINUTE;
    const paused = timer.pause(running, later);
    assert.equal(paused.status, "paused");
    assert.equal(timer.remaining(paused, later + 99 * MINUTE), 15 * MINUTE);
    const resumed = timer.start(paused, later + 99 * MINUTE);
    assert.equal(resumed.endsAt, later + 99 * MINUTE + 15 * MINUTE);
    assert.equal(resumed.id, running.id);
  },

  async "a finished work phase is reported once and moves on to the break"() {
    const running = timer.start(timer.blank(), clock);
    const end = running.endsAt;
    assert.equal(timer.settle(running, end - 1).finished, null);
    const outcome = timer.settle(running, end);
    assert.equal(outcome.finished.phase, "work");
    assert.equal(outcome.finished.minutes, 25);
    assert.equal(outcome.finished.at, end);
    assert.equal(outcome.finished.next, 5);
    assert.equal(outcome.state.phase, "break");
    assert.equal(outcome.state.status, "idle");
    assert.equal(timer.settle(outcome.state, end + 1000).finished, null);
  },

  async "a break that is already over by then is skipped"() {
    const running = timer.start(timer.blank(), clock);
    const outcome = timer.settle(running, running.endsAt + 6 * MINUTE);
    assert.equal(outcome.finished.phase, "work");
    assert.equal(outcome.state.phase, "work");
    assert.equal(outcome.state.status, "idle");
  },

  async "a finished break returns to the work phase and is not a session"() {
    const work = timer.settle(timer.start(timer.blank(), clock), clock + 25 * MINUTE).state;
    const running = timer.start(work, clock + 25 * MINUTE);
    const outcome = timer.settle(running, running.endsAt);
    assert.equal(outcome.finished.phase, "break");
    assert.equal(outcome.state.phase, "work");
  },

  async "the length of the running phase is locked while the other one can change"() {
    const running = timer.start(timer.blank(), clock);
    assert.equal(timer.setMinutes(running, "work", 40), running);
    const other = timer.setMinutes(running, "break", 10);
    assert.equal(other.minutes.break, 10);
    assert.equal(other.total, 25 * MINUTE);
    const idle = timer.setMinutes(timer.blank(), "work", 45);
    assert.equal(idle.total, 45 * MINUTE);
    assert.equal(timer.setMinutes(idle, "work", 500).minutes.work, 60);
    assert.equal(timer.setMinutes(idle, "work", -3).minutes.work, 1);
    assert.equal(timer.setMinutes(idle, "break", "abc").minutes.break, 5);
    assert.equal(timer.setMinutes(idle, "break", "").minutes.break, 5);
    assert.equal(timer.setMinutes(idle, "break", null).minutes.break, 5);
    assert.equal(timer.setMinutes(idle, "work", "35").minutes.work, 35);
    assert.deepEqual(timer.blank({ work: "", break: true }).minutes, { work: 25, break: 5 });
  },

  async "damaged saved data falls back to safe values"() {
    for (const raw of [null, "x", 7, [], { status: "running" }, { status: "running", endsAt: "soon", id: "a" }, { status: "paused", left: 1e12, id: "a" }, { minutes: null, phase: 3 }]) {
      const state = timer.normalize(raw);
      assert.equal(state.status, "idle");
      assert.ok(state.minutes.work >= 1 && state.minutes.break >= 1);
    }
    const kept = timer.normalize({ minutes: { work: 50, break: 10 }, phase: "break", status: "running", id: "r1", endsAt: clock + 1000, total: 600000, subject: "mathe" });
    assert.equal(kept.status, "running");
    assert.equal(kept.phase, "break");
    assert.equal(kept.subject, "mathe");
  },

  async "a phase that ends while another page is open is saved exactly once"() {
    fresh();
    timer.actions.subject("mathe");
    timer.actions.start();
    const end = timer.read().endsAt;
    clock = end - 1000;
    assert.equal(timer.check(), null);
    assert.equal(calls.length, 0);
    clock = end + 400;
    const events = [];
    const stop = timer.subscribe((event) => events.push(event.type));
    const finished = timer.check();
    assert.equal(finished.phase, "work");
    assert.equal(timer.check(), null);
    timer.check();
    await settled();
    stop();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/pomodoro/session");
    assert.deepEqual(calls[0].body, { subject_id: "mathe", duration: 25, session_type: "work", ended_at: end });
    assert.equal(events.filter((type) => type === "end").length, 1);
    assert.equal(timer.waiting(), 0);
    assert.equal(timer.read().phase, "break");
    assert.equal(timer.endNotice(timer.read(), clock).id, finished.id);
    assert.equal(timer.endNotice(timer.read(), clock + 3 * MINUTE), null);
  },

  async "two pages sharing one storage settle one phase once"() {
    fresh();
    const other = await import(`${source}?second`);
    timer.actions.start();
    const end = timer.read().endsAt;
    clock = end + 50;
    const first = timer.check();
    const second = other.check();
    await settled();
    assert.ok(first);
    assert.equal(second, null);
    assert.equal(calls.length, 1);
  },

  async "a session that could not be sent waits and is sent later without duplicates"() {
    fresh();
    response = () => ({ ok: false, status: 503 });
    timer.actions.start();
    clock = timer.read().endsAt + 10;
    timer.check();
    await settled();
    assert.equal(calls.length, 1);
    assert.equal(timer.waiting(), 1);
    response = () => ({ ok: true, status: 200 });
    await timer.flush();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.ended_at, calls[1].body.ended_at);
    assert.equal(timer.waiting(), 0);
    await timer.flush();
    assert.equal(calls.length, 2);
  },

  async "a rejected session is dropped instead of retried forever"() {
    fresh();
    response = () => ({ ok: false, status: 400 });
    timer.actions.start();
    clock = timer.read().endsAt + 10;
    timer.check();
    await settled();
    assert.equal(timer.waiting(), 0);
  },

  async "a break is never sent to the server"() {
    fresh();
    timer.actions.start();
    clock = timer.read().endsAt + 10;
    timer.check();
    await settled();
    calls.length = 0;
    timer.actions.start();
    clock = timer.read().endsAt + 10;
    assert.equal(timer.check().phase, "break");
    await settled();
    assert.equal(calls.length, 0);
  },

  async "the old classic settings are picked up once"() {
    fresh();
    store.set("hub_pomodoro", JSON.stringify({ workDuration: 50, breakDuration: 10, todaySessions: 3 }));
    store.set("pomodoro_subject", "physik");
    const state = timer.read();
    assert.deepEqual(state.minutes, { work: 50, break: 10 });
    assert.equal(state.subject, "physik");
    timer.actions.minutes("break", 15);
    assert.equal(timer.read().minutes.work, 50);
    assert.equal(timer.read().minutes.break, 15);
  },

  async "reset keeps the settings and the subject"() {
    fresh();
    timer.actions.minutes("work", 30);
    timer.actions.subject("deutsch");
    timer.actions.start();
    timer.actions.reset();
    const state = timer.read();
    assert.equal(state.status, "idle");
    assert.equal(state.minutes.work, 30);
    assert.equal(state.subject, "deutsch");
    assert.equal(timer.waiting(), 0);
  },
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  clock = Date.UTC(2026, 9, 6, 13, 0, 0);
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n${error.stack}`);
  }
}
process.exit(failed ? 1 : 0);
