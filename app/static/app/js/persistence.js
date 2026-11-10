// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export function safariOnMac(agent, touchPoints) {
  return /Macintosh/.test(agent) && touchPoints < 2 && /Version\/[\d.]+ Safari\//.test(agent) && !/Chrome|Chromium|Edg\/|OPR\/|Firefox/.test(agent);
}

const OTHER_BROWSERS = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|Ddg\/|DuckDuckGo/;
const IN_APP = /GSA\/|FBAN|FBAV|FB_IAB|Instagram|musical_ly|BytedanceWebview|Snapchat|LinkedInApp|Line\/|Pinterest/;

export function tabName(agent) {
  return /Safari\//.test(agent) && !OTHER_BROWSERS.test(agent) && !IN_APP.test(agent) ? "Safari" : "Browser";
}

export function tabReminderNote({ agent, brand }) {
  return `Im ${tabName(agent)}-Tab gibt es keine Erinnerungen. Legst du ${brand} über Teilen auf den Home-Bildschirm, erinnert dich die App dort, solange sie geöffnet ist.`;
}

export function storageNote({ shell, persisted, device, homeScreen, macSafari, brand }) {
  if (shell !== "web" || persisted === null) return null;
  if (device && !homeScreen) {
    return { state: "tab", text: `Öffnest du ${brand} etwa eine Woche lang nicht, kann der Browser alle Einträge löschen. Als App vom Home-Bildschirm passiert das nicht.` };
  }
  if (macSafari && !homeScreen) {
    return { state: "tab", text: `Öffnest du ${brand} in Safari sieben Tage lang nicht, löscht Safari alle Einträge. Sichere sie ab und zu mit Exportieren.` };
  }
  if (persisted) return { state: "kept", text: "Der Browser löscht deine Einträge nicht von sich aus." };
  return { state: "ask", text: "Wird der Speicher knapp, darf der Browser deine Einträge löschen." };
}
