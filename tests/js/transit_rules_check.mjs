import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { ownTickets, coveringPass, cheapest, ticketState, matchFare, usualFare, mapsApp, walkUrl } = await import(pathToFileURL(resolve(here, "../../app/static/app/js/transit-rules.js")).href);

const fare = (net, zones, single, short = null) => ({ start: "2026-10-12T08:00:00+02:00", end: "2026-10-12T08:20:00+02:00", net, zones, single: { label: net ? `${net} ${zones}` : "Regionaltarif über 25 bis 35 km", price: single, reduced: null }, short });
const pass = (net, zones) => ({ net, zones });
const none = ownTickets(undefined);
const regional = { ticket: "deutschland", fare: { from: "900230999", to: "900100003", time: "2026-10-12T06:00:00Z" }, legs: [] };
const abroad = { ticket: "deutschland", fare: null, legs: [] };

const tests = {
  "only passes for a known zone and a real Deutschlandticket count as owned"() {
    assert.deepEqual(ownTickets({ deutschlandticket: "ja", passes: [pass("Potsdam", "ABC"), pass("Berlin", "BC"), { zones: "AB" }, null] }), { germany: false, passes: [pass("Potsdam", "ABC")] });
    assert.deepEqual(ownTickets({ deutschlandticket: true, passes: "x" }), { germany: true, passes: [] });
  },
  "a pass covers the zones of its own town it was bought for"() {
    const mine = [pass("Potsdam", "ABC")];
    assert.equal(coveringPass(fare("Potsdam", "AB", 3), mine), mine[0]);
    assert.equal(coveringPass(fare("Potsdam", "ABC", 3.7), mine), mine[0]);
    assert.equal(coveringPass(fare("Berlin", "ABC", 5), mine), null);
    assert.equal(coveringPass(fare("Potsdam", "ABC", 3.7), [pass("Potsdam", "AB")]), null);
    assert.equal(coveringPass(fare(null, null, 8.1), mine), null);
    assert.equal(coveringPass(undefined, mine), null);
  },
  "berlin with zone c reaches into the town of potsdam and no further"() {
    const mine = [pass("Berlin", "ABC")];
    assert.equal(coveringPass(fare("Potsdam", "AB", 3), mine), mine[0]);
    assert.equal(coveringPass(fare("Potsdam", "ABC", 3.7), mine), null);
    assert.equal(coveringPass(fare("Potsdam", "AB", 3), [pass("Berlin", "AB")]), null);
  },
  "the cheapest ticket is the short trip where one is offered"() {
    assert.deepEqual(cheapest(fare("Berlin", "AB", 4, { label: "Berlin", price: 2.8, reduced: 2.1 })), { label: "Berlin", price: 2.8, reduced: 2.1, name: "Kurzstrecke Berlin" });
    assert.equal(cheapest(fare("Brandenburg a.d.H", "AB", 2.7)).name, "Einzelfahrausweis Brandenburg an der Havel AB");
    assert.equal(cheapest(fare(null, null, 8.1)).name, "Einzelfahrausweis (Regionaltarif über 25 bis 35 km)");
  },
  "the note says what a ride costs and whether an own ticket covers it"() {
    const berlin = fare("Berlin", "ABC", 5);
    berlin.single.reduced = 3.5;
    assert.deepEqual(ticketState(regional, none, berlin, true), { tone: "pay", price: 5, text: "Günstigstes Ticket: Einzelfahrausweis Berlin ABC für 5,00 €, ermäßigt 3,50 €.", hint: true });
    assert.deepEqual(ticketState(regional, ownTickets({ deutschlandticket: true }), berlin, true), { tone: "own", text: "Geht mit deinem Deutschlandticket." });
    assert.deepEqual(ticketState(regional, ownTickets({ passes: [pass("Berlin", "ABC")] }), berlin, true), { tone: "own", text: "Geht mit deiner Zeitkarte Berlin ABC." });
    const potsdam = ownTickets({ passes: [pass("Potsdam", "ABC")] });
    assert.equal(ticketState(regional, potsdam, berlin, true).text, "Deine Zeitkarte Potsdam ABC gilt hier nicht. Günstigstes Ticket: Einzelfahrausweis Berlin ABC für 5,00 €, ermäßigt 3,50 €.");
    assert.equal(ticketState(regional, potsdam, berlin, true).hint, false);
    const both = ownTickets({ passes: [pass("Potsdam", "AB"), pass("Cottbus", "AB")] });
    assert.equal(ticketState(regional, both, berlin, true).text.startsWith("Deine Zeitkarten Potsdam AB und Cottbus AB gelten hier nicht. "), true);
  },
  "without a price the note stays with what is certain"() {
    assert.deepEqual(ticketState(regional, none, undefined, false), { tone: "any", text: "Geht mit dem Deutschlandticket.", hint: false });
    assert.deepEqual(ticketState(regional, none, null, true), { tone: "any", text: "Geht mit dem Deutschlandticket.", hint: true });
    assert.deepEqual(ticketState(abroad, none, undefined, true), { tone: "any", text: "Geht mit dem Deutschlandticket.", hint: true });
    const potsdam = ownTickets({ passes: [pass("Potsdam", "ABC")] });
    assert.equal(ticketState(regional, potsdam, undefined, false).text, "Geht mit dem Deutschlandticket.");
    assert.equal(ticketState(regional, potsdam, null, true).text, "Ob deine Zeitkarte hier gilt, ließ sich gerade nicht prüfen. Mit dem Deutschlandticket geht es.");
    assert.equal(ticketState(abroad, potsdam, undefined, true).text, "Deine Zeitkarte Potsdam ABC gilt hier nicht. Mit dem Deutschlandticket geht es.");
    assert.equal(ticketState({ ticket: "fern" }, potsdam, undefined, true).tone, "fern");
    assert.equal(ticketState({ ticket: "fuss" }, none, undefined, true), null);
  },
  "a price belongs to the ride that leaves and arrives at the same minutes"() {
    const ride = (start, end) => ({ legs: [{ category: "fuss", from: {}, to: {} }, { category: "sbahn", from: { planned: start, time: "2026-10-12T06:03:00Z" }, to: { planned: end, time: end } }] });
    const options = [fare("Berlin", "ABC", 5), { ...fare("Berlin", "ABC", 5), start: "2026-10-12T08:20:00+02:00", end: "2026-10-12T08:55:00+02:00", short: { label: "Berlin", price: 2.8, reduced: null } }];
    assert.equal(matchFare(ride("2026-10-12T06:00:00Z", "2026-10-12T06:21:00Z"), options), options[0]);
    assert.equal(matchFare(ride("2026-10-12T06:20:00Z", "2026-10-12T06:55:00Z"), options), options[1]);
    assert.equal(matchFare(ride("2026-10-12T06:40:00Z", "2026-10-12T07:15:00Z"), options), null);
    assert.deepEqual(usualFare(options), { ...options[0], short: null });
    assert.equal(usualFare([...options, fare("Potsdam", "ABC", 3.7)]), null);
    assert.equal(usualFare([]), null);
  },
  "a walk opens in the chosen maps app with its end filled in"() {
    const at = new Date("2026-10-12T06:00:00Z");
    const later = { from: { name: "S Potsdam Hauptbahnhof", lat: 52.39176649, lon: 13.066755, time: "2026-10-12T07:00:00Z" }, to: { name: "END", lat: 52.4, lon: 13.05, time: "2026-10-12T07:06:00Z" } };
    assert.equal(walkUrl(later, "apple", at), "https://maps.apple.com/?saddr=52.391766%2C13.066755&daddr=52.4%2C13.05&dirflg=w");
    assert.equal(walkUrl(later, "google", at), "https://www.google.com/maps/dir/?api=1&origin=52.391766%2C13.066755&destination=52.4%2C13.05&travelmode=walking");
    const soon = { ...later, from: { ...later.from, time: "2026-10-12T06:10:00Z" }, to: { ...later.to, time: "2026-10-12T06:16:00Z" } };
    assert.equal(walkUrl(soon, "apple", at), "https://maps.apple.com/?daddr=52.4%2C13.05&dirflg=w");
    assert.equal(walkUrl(soon, "google", at), "https://www.google.com/maps/dir/?api=1&destination=52.4%2C13.05&travelmode=walking");
    assert.equal(walkUrl({ ...later, to: { ...later.to, name: later.from.name } }, "apple", at), "");
    assert.equal(walkUrl({ ...later, to: { name: "END", lat: null, lon: 13 } }, "apple", at), "");
  },
  "the maps app follows the device until one is chosen"() {
    assert.equal(mapsApp(undefined, true), "apple");
    assert.equal(mapsApp({ maps: "auto" }, false), "google");
    assert.equal(mapsApp({ maps: "google" }, true), "google");
    assert.equal(mapsApp({ maps: "apple" }, false), "apple");
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
