import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { ownTickets, placeZones, placeName, coveringPass, doubtfulPass, cheapest, ticketState, matchFare, usualFare, mapsApp, walkUrl } = await import(pathToFileURL(resolve(here, "../../app/static/app/js/transit-rules.js")).href);

const fare = (net, zones, single, short = null) => ({ start: "2026-10-12T08:00:00+02:00", end: "2026-10-12T08:20:00+02:00", net, zones, single: { label: net ? `${net} ${zones}` : "Regionaltarif über 25 bis 35 km", price: single, reduced: null }, short });
const pass = (net, zones) => ({ net, zones });
const local = (stops, label = "Orte mit Stadtlinienverkehr Typ I") => ({ ...fare(null, null, 2), single: { label, price: 2, reduced: 1.6 }, stops });
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
  "berlin with zone c reaches into the town of potsdam and maybe further"() {
    const mine = [pass("Berlin", "ABC")];
    assert.equal(coveringPass(fare("Potsdam", "AB", 3), mine), mine[0]);
    assert.equal(coveringPass(fare("Potsdam", "ABC", 3.7), mine), null);
    assert.equal(doubtfulPass(fare("Potsdam", "ABC", 3.7), mine), mine[0]);
    assert.equal(coveringPass(fare("Potsdam", "AB", 3), [pass("Berlin", "AB")]), null);
    assert.equal(doubtfulPass(fare("Potsdam", "ABC", 3.7), [pass("Berlin", "AB"), pass("Cottbus", "ABC")]), null);
    assert.equal(doubtfulPass(fare("Berlin", "ABC", 5), mine), null);
    assert.equal(ticketState(regional, ownTickets({ passes: mine }), fare("Potsdam", "ABC", 3.7), true).text, "Ob deine Zeitkarte Berlin ABC hier reicht, ist nicht sicher, denn Potsdam C liegt nur zum Teil in Berlin C. Günstigstes Ticket: Einzelfahrausweis Potsdam ABC für 3,70 €.");
  },
  "a ride from michendorf to potsdam goes with a pass for potsdam abc"() {
    const potsdam = ownTickets({ passes: [pass("Potsdam", "ABC")] });
    assert.deepEqual(ticketState(regional, potsdam, fare("Potsdam", "ABC", 3.7), true), { tone: "own", text: "Geht mit deiner Zeitkarte Potsdam ABC." });
    assert.deepEqual(ticketState(regional, potsdam, fare("Potsdam", "AB", 3, { label: "Potsdam", price: 2.1, reduced: 1.6 }), true), { tone: "own", text: "Geht mit deiner Zeitkarte Potsdam ABC." });
  },
  "an answer without a fare makes no claim about a pass"() {
    const potsdam = ownTickets({ passes: [pass("Potsdam", "ABC")] });
    const older = { ticket: "deutschland", legs: [] };
    for (const [journey, asked] of [[older, true], [abroad, true], [regional, true], [regional, false]]) {
      const note = ticketState(journey, potsdam, undefined, asked);
      assert.equal(/reicht|reichen|gilt hier nicht/.test(note.text), false, note.text);
      assert.equal(note.price, undefined);
    }
    assert.equal(ticketState(older, potsdam, undefined, true).text, "Ob deine Zeitkarte Potsdam ABC hier gilt, ließ sich für diese Strecke nicht prüfen.");
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
    assert.equal(ticketState(regional, potsdam, berlin, true).text, "Deine Zeitkarte Potsdam ABC reicht hier nicht. Günstigstes Ticket: Einzelfahrausweis Berlin ABC für 5,00 €, ermäßigt 3,50 €.");
    assert.equal(ticketState(regional, potsdam, berlin, true).hint, false);
    assert.equal(ticketState(regional, ownTickets({ passes: [pass("Potsdam", "AB")] }), fare("Potsdam", "ABC", 3.7), true).text, "Deine Zeitkarte Potsdam AB reicht hier nicht. Günstigstes Ticket: Einzelfahrausweis Potsdam ABC für 3,70 €.");
    assert.equal(ticketState(regional, potsdam, fare(null, null, 8.1), true).text, "Deine Zeitkarte Potsdam ABC reicht hier nicht. Günstigstes Ticket: Einzelfahrausweis (Regionaltarif über 25 bis 35 km) für 8,10 €.");
    const both = ownTickets({ passes: [pass("Potsdam", "AB"), pass("Cottbus", "AB")] });
    assert.equal(ticketState(regional, both, berlin, true).text.startsWith("Deine Zeitkarten Potsdam AB und Cottbus AB reichen hier nicht. "), true);
  },
  "without a price the note stays with what is certain"() {
    assert.deepEqual(ticketState(regional, none, undefined, false), { tone: "any", text: "Geht mit dem Deutschlandticket.", hint: false });
    assert.deepEqual(ticketState(regional, none, null, true), { tone: "any", text: "Geht mit dem Deutschlandticket.", hint: true });
    assert.deepEqual(ticketState(abroad, none, undefined, true), { tone: "any", text: "Geht mit dem Deutschlandticket.", hint: true });
    const potsdam = ownTickets({ passes: [pass("Potsdam", "ABC")] });
    assert.deepEqual(ticketState(regional, potsdam, undefined, false), { tone: "pay", text: "Ob deine Zeitkarte Potsdam ABC hier gilt, wird geprüft." });
    assert.equal(ticketState(regional, potsdam, null, true).text, "Ob deine Zeitkarte Potsdam ABC hier gilt, ließ sich gerade nicht prüfen.");
    assert.equal(ticketState(abroad, potsdam, undefined, true).text, "Ob deine Zeitkarte Potsdam ABC hier gilt, ließ sich für diese Strecke nicht prüfen.");
    const both = ownTickets({ passes: [pass("Potsdam", "AB"), pass("Cottbus", "AB")] });
    assert.equal(ticketState(regional, both, null, true).text, "Ob deine Zeitkarten Potsdam AB und Cottbus AB hier gelten, ließ sich gerade nicht prüfen.");
    assert.equal(ticketState({ ticket: "fern" }, potsdam, undefined, true).tone, "fern");
    assert.equal(ticketState({ ticket: "fuss" }, none, undefined, true), null);
  },
  "a stop is placed in the zones the vbb register gives its town"() {
    assert.equal(placeZones("Michendorf, Bahnhof"), "P-C/B-C");
    assert.equal(placeZones("Fresdorf, Kirche"), "P-C");
    assert.equal(placeZones("Ketzin (Havel), Am Markt"), "P-C");
    assert.equal(placeZones("Seddin (PM), Bahnhof"), "P-C/B-C");
    assert.equal(placeZones("S Potsdam Hauptbahnhof"), "P-A/B-C");
    assert.equal(placeZones("S Lehnitz (Oranienburg)"), "B-C");
    assert.equal(placeZones("Ruhlsdorf (PM), Kirche"), "P-C/B-C");
    assert.equal(placeZones("Ruhlsdorf (TF), Kirche"), "");
    assert.equal(placeZones("Ruhlsdorf, Dorf"), null);
    assert.equal(placeZones("Beelitz, Bahnhof"), "");
    assert.equal(placeZones("S Wannsee Bhf (Berlin)"), "B-B");
    assert.equal(placeZones(undefined), null);
    assert.equal(placeName("Ruhlsdorf (PM), Kirche"), "Ruhlsdorf");
    assert.equal(placeName("S Oranienburg Bhf"), "Oranienburg");
  },
  "a ride inside michendorf goes with a pass for potsdam abc"() {
    const potsdam = ownTickets({ passes: [pass("Potsdam", "ABC")] });
    const town = local(["Michendorf, Bahnhof", "Michendorf, Am Wolkenberg"]);
    assert.deepEqual(ticketState(regional, potsdam, town, true), { tone: "own", text: "Geht mit deiner Zeitkarte Potsdam ABC." });
    assert.equal(ticketState(regional, ownTickets({ passes: [pass("Potsdam", "AB")] }), town, true).text, "Deine Zeitkarte Potsdam AB reicht hier nicht, die Fahrt beginnt in Michendorf. Günstigstes Ticket: Einzelfahrausweis (Orte mit Stadtlinienverkehr Typ I) für 2,00 €, ermäßigt 1,60 €.");
    assert.equal(coveringPass(local(["Fresdorf, Kirche", "Michendorf, Bahnhof"]), potsdam.passes), potsdam.passes[0]);
    assert.equal(coveringPass(local(["Ruhlsdorf (PM), Dorf", "Michendorf, Bahnhof"]), potsdam.passes), potsdam.passes[0]);
    assert.equal(coveringPass(local(["Michendorf, Bahnhof", "Beelitz, Bahnhof"]), potsdam.passes), null);
    assert.equal(coveringPass(local(["Ruhlsdorf (TF), Kirche", "Ruhlsdorf (TF), Dorf"]), potsdam.passes), null);
    assert.equal(coveringPass(local(["Ruhlsdorf, Dorf", "Michendorf, Bahnhof"]), potsdam.passes), null);
    assert.equal(doubtfulPass(local(["Ruhlsdorf, Dorf", "Michendorf, Bahnhof"]), potsdam.passes), potsdam.passes[0]);
    assert.equal(coveringPass({ ...town, stops: undefined }, potsdam.passes), null);
    assert.equal(doubtfulPass({ ...town, stops: undefined }, potsdam.passes), potsdam.passes[0]);
    assert.equal(coveringPass({ ...fare(null, null, 8.1), stops: ["Michendorf, Bahnhof", "Teltow, Bahnhof"] }, potsdam.passes), null);
  },
  "a local ride in a place of berlin c goes with a pass for berlin abc"() {
    const berlin = [pass("Berlin", "ABC")];
    assert.equal(coveringPass(local(["S Oranienburg Bhf", "Oranienburg, Schloss"]), berlin), berlin[0]);
    assert.equal(coveringPass(local(["Falkensee, Bahnhof", "Falkensee, Falkenhagener Anger"], "Orte mit Stadtlinienverkehr Typ II"), berlin), berlin[0]);
    assert.equal(coveringPass(local(["Michendorf, Bahnhof", "Michendorf, Am Wolkenberg"]), berlin), berlin[0]);
    assert.equal(coveringPass(local(["Fresdorf, Kirche", "Michendorf, Bahnhof"]), berlin), null);
    assert.equal(coveringPass(local(["S Oranienburg Bhf", "Oranienburg, Schloss"]), [pass("Berlin", "AB"), pass("Potsdam", "ABC")]), null);
  },
  "a ride priced in waben still goes with the pass its other fare names"() {
    const michendorf = { ...fare("Potsdam", "ABC", 3.7), single: { label: "bis 2 Waben", price: 2.2, reduced: 1.8 }, stops: ["Michendorf, Bahnhof", "Michendorf, Bahnhof/Bahnstr."] };
    assert.deepEqual(ticketState(regional, ownTickets({ passes: [pass("Potsdam", "ABC")] }), michendorf, true), { tone: "own", text: "Geht mit deiner Zeitkarte Potsdam ABC." });
    assert.equal(ticketState(regional, none, michendorf, true).text, "Günstigstes Ticket: Einzelfahrausweis (bis 2 Waben) für 2,20 €, ermäßigt 1,80 €.");
    assert.equal(coveringPass({ ...michendorf, net: null, zones: null }, [pass("Potsdam", "ABC")]).net, "Potsdam");
    assert.equal(coveringPass(michendorf, [pass("Potsdam", "AB")]), null);
  },
  "berlin abc settles potsdam c where both ends lie in berlin c"() {
    const berlin = ownTickets({ passes: [pass("Berlin", "ABC")] });
    const ride = (stops) => ({ ...fare("Potsdam", "ABC", 3.7), stops });
    assert.deepEqual(ticketState(regional, berlin, ride(["Michendorf, Bahnhof", "S Potsdam Hauptbahnhof"]), true), { tone: "own", text: "Geht mit deiner Zeitkarte Berlin ABC." });
    assert.equal(ticketState(regional, berlin, ride(["Fresdorf, Kirche", "S Potsdam Hauptbahnhof"]), true).text, "Deine Zeitkarte Berlin ABC reicht hier nicht, die Fahrt beginnt in Fresdorf. Günstigstes Ticket: Einzelfahrausweis Potsdam ABC für 3,70 €.");
    assert.equal(doubtfulPass(ride(["Seehof, Dorf", "S Potsdam Hauptbahnhof"]), berlin.passes), berlin.passes[0]);
    assert.equal(doubtfulPass(ride(["Fresdorf, Kirche", "Seehof, Dorf"]), berlin.passes), null);
  },
  "a pass counts only where every stop of the ride lies in its zones"() {
    const bus = local(["Michendorf, Bahnhof", "Michendorf, Am Wolkenberg", "Wildenbruch (PM), Kirche", "Wildenbruch (PM), Dorf", "Langerwisch, Dorf", "Langerwisch, Kirche"]);
    const potsdam = ownTickets({ passes: [pass("Potsdam", "ABC")] });
    const berlin = ownTickets({ passes: [pass("Berlin", "ABC")] });
    assert.deepEqual(ticketState(regional, potsdam, bus, true), { tone: "own", text: "Geht mit deiner Zeitkarte Potsdam ABC." });
    assert.equal(ticketState(regional, berlin, bus, true).text, "Deine Zeitkarte Berlin ABC reicht hier nicht, die Fahrt führt durch Wildenbruch. Günstigstes Ticket: Einzelfahrausweis (Orte mit Stadtlinienverkehr Typ I) für 2,00 €, ermäßigt 1,60 €.");
    const around = { ...fare("Potsdam", "ABC", 3.7), stops: ["Michendorf, Bahnhof", "Langerwisch, Dorf", "Wilhelmshorst, Bahnhof", "Potsdam, Rehbrücke Bhf", "Potsdam, Brauhausberg", "S Potsdam Hauptbahnhof"] };
    assert.deepEqual(ticketState(regional, berlin, around, true), { tone: "own", text: "Geht mit deiner Zeitkarte Berlin ABC." });
    assert.equal(ticketState(regional, potsdam, local(["Michendorf, Bahnhof", "Beelitz, Bahnhof"]), true).text.startsWith("Deine Zeitkarte Potsdam ABC reicht hier nicht, die Fahrt endet in Beelitz. "), true);
    assert.equal(ticketState(regional, potsdam, local(["Michendorf, Bahnhof", "Seehof, Dorf", "Michendorf, Am Wolkenberg"]), true).text, "Ob deine Zeitkarte Potsdam ABC in Seehof gilt, ist nicht sicher. Günstigstes Ticket: Einzelfahrausweis (Orte mit Stadtlinienverkehr Typ I) für 2,00 €, ermäßigt 1,60 €.");
    assert.equal(ticketState(regional, potsdam, { ...bus, stops: null }, true).text.startsWith("Ob deine Zeitkarte Potsdam ABC hier reicht, ist nicht sicher. "), true);
    const waben = { ...fare("Potsdam", "ABC", 3.7), single: { label: "bis 2 Waben", price: 2.2, reduced: null }, stops: null };
    assert.equal(ticketState(regional, ownTickets({ passes: [pass("Cottbus", "ABC")] }), waben, true).text, "Ob deine Zeitkarte Cottbus ABC hier reicht, ist nicht sicher. Günstigstes Ticket: Einzelfahrausweis (bis 2 Waben) für 2,20 €.");
    assert.equal(ticketState(regional, ownTickets({ passes: [pass("Berlin", "ABC"), pass("Cottbus", "ABC")] }), bus, true).text.startsWith("Deine Zeitkarten Berlin ABC und Cottbus ABC reichen hier nicht. "), true);
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
