import { PLACES } from "./transit-zones.js";

const NETS = { "Brandenburg a.d.H": "Brandenburg an der Havel" };
const CODES = { Potsdam: "P", Berlin: "B", "Brandenburg a.d.H": "BRB", Cottbus: "CB", "Frankfurt (Oder)": "FF" };
const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

export const MAPS = { apple: "Apple Karten", google: "Google Maps" };
export const price = (amount) => euro.format(amount);
export const rides = (journey) => journey.legs.filter((leg) => leg.category !== "fuss" && leg.category !== "rad");

const netName = (net) => NETS[net] || net;
const passName = (pass) => `${netName(pass.net)} ${pass.zones}`;
const apart = (a, b) => Math.abs(new Date(a) - new Date(b)) / 60000;

export function ownTickets(saved) {
  const passes = Array.isArray(saved?.passes) ? saved.passes.filter((pass) => typeof pass?.net === "string" && /^(AB|ABC)$/.test(pass?.zones)) : [];
  return { germany: saved?.deutschlandticket === true, passes };
}

const placeKey = (name) => name.toLowerCase().replace(/[^\p{L}]/gu, "");
const ZONES = new Map();
for (const line of PLACES.split("\n")) {
  const [name, district, zones] = line.split("|");
  for (const key of [placeKey(name), `${placeKey(name)}|${district}`]) ZONES.set(key, ZONES.has(key) && ZONES.get(key) !== zones ? null : zones);
}

export function placeZones(stop) {
  const name = String(stop || "").replace(/^(?:S\+U|S|U) /, "");
  const district = / \(([A-Z]{2,3})\)/.exec(name)?.[1];
  const bare = district ? name.replace(` (${district})`, "") : name;
  const comma = bare.indexOf(", ");
  const words = bare.replace(/ (?:Bhf|Bahnhof)$/, "").split(" ");
  const tries = comma > 0 ? [bare, bare.slice(0, comma)] : words.map((_, index) => words.slice(0, words.length - index).join(" "));
  for (const place of tries) {
    const zones = ZONES.get(district ? `${placeKey(place)}|${district}` : placeKey(place));
    if (zones !== undefined) return zones;
  }
  return null;
}

const reaches = (pass, zones) => (typeof zones === "string" ? [...pass.zones].includes(zones.split("/").find((part) => part.startsWith(`${CODES[pass.net]}-`))?.slice(-1)) : undefined);

function within(pass, fare) {
  const ends = Array.isArray(fare.stops) && fare.stops.length === 2 ? fare.stops.map((stop) => reaches(pass, placeZones(stop))) : [];
  if (ends.includes(false)) return false;
  return ends.length && ends.every(Boolean) ? true : undefined;
}

const LOCAL = /^(?:Orte mit Stadtlinienverkehr\b|bis [12] Waben?$)/;
const berlinWithC = (pass) => pass.net === "Berlin" && pass.zones === "ABC";
const netSingle = (fare) => fare.net && fare.single.label === `${fare.net} ${fare.zones}`;

export function coveringPass(fare, passes) {
  if (!fare) return null;
  return passes.find((pass) =>
    (fare.zones && pass.net === fare.net && [...fare.zones].every((zone) => pass.zones.includes(zone))) ||
    (berlinWithC(pass) && fare.net === "Potsdam" && (fare.zones === "AB" || within(pass, fare) === true)) ||
    (LOCAL.test(fare.single?.label || "") && within(pass, fare) === true)) || null;
}

export function doubtfulPass(fare, passes) {
  if (fare?.net !== "Potsdam" || fare.zones !== "ABC") return null;
  return passes.find((pass) => berlinWithC(pass) && within(pass, fare) === undefined) || null;
}

export function cheapest(fare) {
  if (fare.short && fare.short.price < fare.single.price) return { ...fare.short, name: `Kurzstrecke ${netName(fare.short.label)}` };
  return { ...fare.single, name: netSingle(fare) ? `Einzelfahrausweis ${netName(fare.net)} ${fare.zones}` : `Einzelfahrausweis (${fare.single.label})` };
}

export function ticketState(journey, own, fare, asked) {
  if (journey.ticket === "fern") return { tone: "fern", text: "Mit Fernverkehr, dafür reicht das Deutschlandticket nicht." };
  if (journey.ticket !== "deutschland") return null;
  if (own.germany) return { tone: "own", text: "Geht mit deinem Deutschlandticket." };
  const pass = coveringPass(fare, own.passes);
  if (pass) return { tone: "own", text: `Geht mit deiner Zeitkarte ${passName(pass)}.` };
  const many = own.passes.length > 1;
  const names = own.passes.map(passName).join(" und ");
  if (fare) {
    const best = cheapest(fare);
    const costs = `Günstigstes Ticket: ${best.name} für ${price(best.price)}${best.reduced ? `, ermäßigt ${price(best.reduced)}` : ""}.`;
    const unsure = doubtfulPass(fare, own.passes);
    if (unsure) return { tone: "pay", price: best.price, text: `Ob deine Zeitkarte ${passName(unsure)} hier reicht, ist nicht sicher, denn Potsdam C liegt nur zum Teil in Berlin C. ${costs}` };
    const mine = names ? `${many ? "Deine Zeitkarten" : "Deine Zeitkarte"} ${names} ${many ? "reichen" : "reicht"} hier nicht. ` : "";
    return { tone: "pay", price: best.price, text: `${mine}${costs}`, hint: !names };
  }
  if (!names) return { tone: "any", text: "Geht mit dem Deutschlandticket.", hint: asked };
  const whether = many ? `Ob deine Zeitkarten ${names} hier gelten` : `Ob deine Zeitkarte ${names} hier gilt`;
  if (!asked) return { tone: "pay", text: `${whether}, wird geprüft.` };
  return { tone: "pay", text: `${whether}, ließ sich ${journey.fare ? "gerade nicht" : "für diese Strecke nicht"} prüfen.` };
}

export function matchFare(journey, options) {
  const list = rides(journey);
  const start = list[0].from.planned || list[0].from.time;
  const end = list.at(-1).to.planned || list.at(-1).to.time;
  return options.find((option) => apart(option.start, start) <= 1 && apart(option.end, end) <= 2) || null;
}

export function usualFare(options) {
  const first = options[0];
  if (!first || options.some((option) => option.single.label !== first.single.label || option.single.price !== first.single.price)) return null;
  return { ...first, short: null };
}

export function mapsApp(saved, apple) {
  return MAPS[saved?.maps] ? saved.maps : apple ? "apple" : "google";
}

const pointOf = (place) => (Number.isFinite(place?.lat) && Number.isFinite(place?.lon) ? `${+place.lat.toFixed(6)},${+place.lon.toFixed(6)}` : "");

export function walkUrl(leg, app, at) {
  const target = pointOf(leg.to);
  if (!target || leg.from.name === leg.to.name) return "";
  const until = (iso) => (new Date(iso) - at) / 60000;
  const underway = until(leg.from.time) <= 15 && until(leg.to.time) >= -15;
  const origin = underway ? "" : pointOf(leg.from);
  if (app === "apple") return `https://maps.apple.com/?${new URLSearchParams({ ...(origin ? { saddr: origin } : {}), daddr: target, dirflg: "w" })}`;
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", ...(origin ? { origin } : {}), destination: target, travelmode: "walking" })}`;
}
