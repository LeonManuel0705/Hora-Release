export function safariOnMac(agent, touchPoints) {
  return /Macintosh/.test(agent) && touchPoints < 2 && /Version\/[\d.]+ Safari\//.test(agent) && !/Chrome|Chromium|Edg\/|OPR\/|Firefox/.test(agent);
}

export function storageNote({ shell, persisted, device, homeScreen, macSafari, brand }) {
  if (shell !== "web" || persisted === null) return null;
  if (device && !homeScreen) {
    return { state: "tab", text: `Öffnest du ${brand} sieben Tage lang nicht, darf der Browser alle Einträge löschen. Als App vom Home-Bildschirm passiert das nicht.` };
  }
  if (macSafari && !homeScreen) {
    return { state: "tab", text: `Öffnest du ${brand} in Safari sieben Tage lang nicht, löscht Safari alle Einträge. Sichere sie ab und zu mit Exportieren.` };
  }
  if (persisted) return { state: "kept", text: "Der Browser löscht deine Einträge nicht von sich aus." };
  return { state: "ask", text: "Wird der Speicher knapp, darf der Browser deine Einträge löschen." };
}
