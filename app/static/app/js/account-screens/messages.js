// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AuthError } from "../account.js";

export function normalizeError(error) {
  if (error instanceof AuthError) return error;
  return new AuthError("server");
}

export function formatDuration(seconds) {
  if (seconds >= 120) return `${Math.round(seconds / 60)} Minuten`;
  if (seconds >= 60) return "1 Minute";
  return `${Math.max(1, Math.round(seconds))} Sekunden`;
}

export function formatClock(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

const COPY = {
  invalid_email: "Diese E-Mail-Adresse sieht nicht richtig aus. Prüf sie noch einmal.",
  weak_password: "Dieses Passwort ist noch zu schwach. Nimm mindestens 10 Zeichen und nichts, was jeder errät.",
  email_taken: "Zu dieser Adresse gibt es schon ein Konto.",
  invalid_credentials: "Das hat nicht geklappt. Prüf E-Mail-Adresse und Passwort und versuch es noch einmal.",
  email_not_verified: "Diese Adresse ist noch nicht bestätigt. Wir haben dir einen neuen Code geschickt.",
  invalid_code: "Dieser Code stimmt nicht. Prüf die Ziffern in der Mail.",
  code_expired: "Dieser Code ist abgelaufen. Hol dir einen neuen.",
  too_many_attempts: "Zu viele Fehlversuche. Dieser Code ist gesperrt, fordere einen neuen an.",
  rate_limited: "Bitte warte kurz, bevor du es noch einmal versuchst.",
  network: "Keine Verbindung zum Server. Prüf dein Netz und versuch es noch einmal.",
  server: "Beim Server ist etwas schiefgelaufen. Das liegt nicht an dir. Versuch es gleich noch einmal.",
  unavailable: "Anmelden geht in dieser Version nicht.",
  no_session: "Du bist auf diesem Gerät nicht mehr angemeldet. Melde dich neu an.",
};

export function messageFor(error) {
  const code = typeof error === "string" ? error : error instanceof AuthError ? error.code : "server";
  return COPY[code] || COPY.server;
}
