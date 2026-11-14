// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BRAND, esc, icon, clock, isoDate, now, shortDate } from "./core.js";

const OFFLINE_CODES = new Set(["network"]);
const TROUBLE = {
  rate_limited: "Gerade kommen zu viele Abgleiche, gleich geht es weiter.",
  entry_too_large: "Dein Stundenplan ist zu groß für das Konto.",
  not_saved: "Ein Stundenplan aus dem Konto ließ sich hier nicht speichern.",
};

function stand(stamp) {
  const when = Number.isFinite(stamp) ? new Date(stamp) : null;
  if (!when || Number.isNaN(when.getTime())) return "";
  const time = `${clock(when.getHours() * 60 + when.getMinutes())} Uhr`;
  return isoDate(when) === isoDate(now()) ? time : `${shortDate(when)}, ${time}`;
}

// What the card says about the sync: last time, waiting, offline or an error, in the words of the IServ and Google cards.
export function syncLine(state) {
  const sync = state.sync || {};
  const time = stand(sync.syncedAt);
  if (state.needsPassword) {
    return {
      status: `<span class="status is-warn">${icon("circle-alert")}Passwort fehlt</span>`,
      text: `Auf diesem Gerät fehlt der Schlüssel zu deinen Daten. Gib dein Passwort ein, dann gleicht ${BRAND} wieder ab.`,
    };
  }
  if (state.offline || OFFLINE_CODES.has(sync.error)) {
    return {
      status: `<span class="status is-offline">${icon("wifi-off")}Offline</span>`,
      text: `Gerade keine Verbindung${time ? `, abgeglichen um ${time}` : ""}. Sobald du wieder online bist, gleicht ${BRAND} ab.`,
    };
  }
  if (sync.error) {
    return {
      status: `<span class="status is-warn">${icon("circle-alert")}Nicht abgeglichen</span>`,
      text: `${TROUBLE[sync.error] || "Der letzte Abgleich hat nicht geklappt."} ${time ? `Zuletzt abgeglichen um ${time}.` : `${BRAND} versucht es wieder, wenn du die App öffnest.`}`,
    };
  }
  if (state.checking || sync.busy || (sync.connected && !sync.ready)) {
    return { status: `<span class="status is-ok">${icon("refresh-cw")}Gleicht ab</span>`, text: "Dein Stundenplan wird gerade abgeglichen." };
  }
  return {
    status: `<span class="status is-ok">${icon("circle-check")}Angemeldet</span>`,
    text: time ? `Stundenplan abgeglichen um ${time}.` : "Dein Stundenplan wird beim nächsten Öffnen abgeglichen.",
  };
}

export const UNREADABLE_NOTE = "Ältere Stände ließen sich nicht öffnen, weil dein Passwort auf einem anderen Gerät geändert wurde.";

export const BETA_TAG = '<span class="beta-tag">Beta</span>';

export const deleteButtonHtml = (cls = "") =>
  `<button class="text-button is-danger${cls ? ` ${cls}` : ""}" type="button" data-account-open="delete">${icon("trash-2")}<span>Konto löschen</span></button>`;

// The profile in the accounts section, built with the row of the settings page so it looks like IServ and Google.
export function accountCardHtml(state, row) {
  const label = `${esc(BRAND)}-Konto ${BETA_TAG}`;
  if (!state?.signedIn) {
    return row({
      id: "rowAccount",
      cls: "is-stack",
      label: `${label} <span class="status is-off">Nicht angemeldet</span>`,
      desc: "Mit einem Konto ist dein Stundenplan auf all deinen Geräten gleich.",
      control: '<button class="btn btn-quiet" type="button" data-account-open="signin">Anmelden</button><button class="btn btn-primary" type="button" data-account-open="create">Konto erstellen</button>',
    });
  }
  const line = syncLine(state);
  const unreadable = state.sync?.unreadable > 0 ? `<p class="set-row-desc account-note" id="rowAccountNote">${icon("info")}<span>${UNREADABLE_NOTE}</span></p>` : "";
  const unlock = state.needsPassword ? '<button class="btn btn-primary" type="button" data-account-open="unlock">Passwort eingeben</button>' : "";
  return row({
    id: "rowAccount",
    cls: "is-stack",
    label: `${label} ${line.status}`,
    desc: `Angemeldet als ${esc(state.email || "")}. ${esc(line.text)}`,
    after: `${unreadable}${deleteButtonHtml("row-action")}`,
    control: `${unlock}<button class="btn btn-quiet" type="button" id="accountSignOut">Abmelden</button>`,
  });
}

// Deleting everything on this device signs out here first: the account keeps its entries, and a device that stayed
// signed in would get the plan straight back at the next sync.
export async function signOutForWipe(api) {
  if (!api?.accountState().signedIn) return false;
  await api.signOut();
  return true;
}

// The line above the accounts names the signed in account first, in the words the line uses for IServ and Google.
export function withAccount(text) {
  const own = `${BRAND}-Konto`;
  if (text === "Nichts verbunden") return `${own} verbunden`;
  if (text.startsWith("IServ und Google")) return `${own}, ${text}`;
  if (/^(IServ|Google) verbunden/.test(text)) return `${own} und ${text}`;
  return `${own} verbunden, ${text}`;
}
