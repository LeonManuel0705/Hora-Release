import { escapeHtml, getLang, t } from "../lib/i18n.js";
import { detectPlatform, deviceName, megabytes, ORDER, platformChoices, PLATFORMS } from "../lib/platform.js";

export const SHORT = { macos: "Mac", windows: "Windows", linux: "Linux", android: "Android", ios: "iPhone", web: "Browser" };

export function listJoin(items) {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${getLang() === "de" ? "und" : "and"} ${items.at(-1)}`;
}

const othersThan = (...ids) => listJoin(ORDER.filter((other) => !ids.includes(other) && other !== "web").map((other) => SHORT[other]));

export function cta() {
  const id = detectPlatform();
  const p = PLATFORMS[id];
  if (!p) {
    const choices = platformChoices();
    if (choices.length > 1) {
      const note = t("start.cta_note_choice", { first: SHORT[choices[0]], second: SHORT[choices[1]], others: othersThan(...choices) });
      return { id, choices, button: `<a class="ap-btn" href="/download" data-install="choice">${escapeHtml(t("start.cta"))}</a>`, note };
    }
    return { id, choices, button: `<a class="ap-btn" href="/download">${escapeHtml(t("start.cta_generic"))}</a>`, note: t("start.cta_note_generic") };
  }
  if (p.kind === "pwa") {
    const sheet = id === "ios" ? ' data-install="ios"' : "";
    const note = t("start.cta_note_web", { device: deviceName(id), others: othersThan(id) });
    return { id, button: `<a class="ap-btn" href="${p.href}"${sheet}>${escapeHtml(t("start.cta_web"))}</a>`, note };
  }
  const note = t("start.cta_note", { platform: SHORT[id], size: megabytes(p.bytes), others: othersThan(id) });
  return { id, button: `<a class="ap-btn" href="${p.href}" download data-install="${id}">${escapeHtml(t("start.cta"))}</a>`, note };
}
