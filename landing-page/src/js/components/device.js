import { escapeHtml } from "../lib/i18n.js";

const EMPTY = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const PHONE = "(max-width: 734px)";
const WIDE = "(min-width: 735px)";

const skipOn = (media, img) => `<picture><source media="${media}" srcset="${EMPTY}">${img}</picture>`;

export function macHTML(screens, { eager = false, phone = "", phoneAlt = "" } = {}) {
  const shots = screens.map((screen, i) => {
    const img = `<img class="mac-shot${i === 0 ? " is-on" : ""}" data-screen="${screen.id}" src="/screens/${screen.id}.webp" width="2880" height="1800" alt="${escapeHtml(screen.alt)}"${i === 0 ? "" : ' aria-hidden="true"'} decoding="async"${eager && i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'}>`;
    return phone ? skipOn(PHONE, img) : img;
  }).join("");
  const mac = `<figure class="mac${phone ? " is-wide-only" : ""}">
    <div class="mac-lid">
      <span class="mac-cam" aria-hidden="true"></span>
      <div class="mac-screen">${shots}</div>
    </div>
    <div class="mac-base" aria-hidden="true"><span class="mac-groove"></span></div>
  </figure>`;
  return phone ? mac + iphoneHTML(`/screens/${phone}.webp`, phoneAlt || screens[0].alt, { only: "phone", eager }) : mac;
}

export function iphoneHTML(src, alt, { dark = false, only = "", eager = false } = {}) {
  const load = eager ? ' fetchpriority="high"' : ' loading="lazy"';
  const wrap = (img) => (only === "phone" ? skipOn(WIDE, img) : img);
  return `<figure class="iphone${dark ? " is-dark" : ""}${only === "phone" ? " is-phone-only" : ""}">
    <div class="iphone-body">
      <div class="iphone-screen">${wrap(`<img src="${src}" width="1170" height="2532" alt="${escapeHtml(alt)}"${load} decoding="async">`)}${wrap(`<img class="iphone-tabbar" src="${src}" width="1170" height="2532" alt=""${load} decoding="async">`)}</div>
      <span class="iphone-island" aria-hidden="true"></span>
    </div>
  </figure>`;
}

export function showScreen(root, id) {
  let found = false;
  for (const shot of root.querySelectorAll(".mac-shot")) {
    const on = shot.dataset.screen === id;
    found ||= on;
    shot.classList.toggle("is-on", on);
    if (on) shot.removeAttribute("aria-hidden");
    else shot.setAttribute("aria-hidden", "true");
  }
  return found;
}
