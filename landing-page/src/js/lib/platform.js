import { brandName, brandRepository } from "./i18n.js";

const version = "0.5.2";
const release = `${brandRepository}/releases/download/v${version}`;
const macZip = `${brandName}-macOS.zip`;
const windowsSetup = `${brandName}-Setup-${version}.exe`;
const linuxDeb = `${brandName}-${version}.deb`;
const linuxAppImage = `${brandName}-${version}.AppImage`;
const androidApk = `${brandName}-${version}.apk`;

export const PLATFORMS = {
  macos: { id: "macos", name: "macOS", href: `/downloads/${macZip}`, file: macZip, bytes: 23963502, mark: "apple", kind: "zip" },
  windows: { id: "windows", name: "Windows", href: `${release}/${windowsSetup}`, file: windowsSetup, bytes: 187213513, mark: "windows", kind: "exe" },
  linux: {
    id: "linux", name: "Linux", href: `${release}/${linuxDeb}`, file: linuxDeb, bytes: 172318748, mark: "linux", kind: "deb",
    alt: { href: `${release}/${linuxAppImage}`, file: linuxAppImage, bytes: 206080836 },
  },
  android: { id: "android", name: "Android", href: `${release}/${androidApk}`, file: androidApk, bytes: 105843702, mark: "android", kind: "apk" },
  ios: { id: "ios", name: "iPhone und iPad", nameEn: "iPhone and iPad", href: "/pwa/", file: null, bytes: 0, mark: "apple", kind: "pwa" },
  web: { id: "web", name: "Browser", nameEn: "Browser", href: "/pwa/", file: null, bytes: 0, mark: "globe", kind: "pwa" },
};

export const ORDER = ["macos", "windows", "linux", "android", "ios", "web"];

// Where the app fetches homework from IServ today. Add the desktop ids once the desktop backend does it too.
export const ISERV_HOMEWORK = new Set(["android"]);

const ipad = () => /iPad/.test(navigator.userAgent || "") || (/Mac/.test(navigator.userAgentData?.platform || navigator.platform || "") && navigator.maxTouchPoints > 1);

const linux = (ua, platform) => /Linux|X11/i.test(platform) || /Linux/.test(ua);

// Android tablets in Chrome's desktop view send a Linux user agent, so Linux on a touch screen or on ARM could be either.
const tabletLike = () => navigator.maxTouchPoints > 1 || /arm|aarch/i.test(navigator.platform || "");

export function detectPlatform() {
  const ua = navigator.userAgent || "";
  const hints = navigator.userAgentData?.platform || "";
  const platform = hints || navigator.platform || "";
  if (/iPhone|iPod/.test(ua) || ipad()) return "ios";
  if (/Android/i.test(ua) || /Android/i.test(hints)) return "android";
  if (/CrOS/.test(ua) || /Chrome ?OS/i.test(platform)) return "web";
  if (/Mac/i.test(platform) || /Mac OS X/.test(ua)) return "macos";
  if (/Win/i.test(platform) || /Windows/.test(ua)) return "windows";
  if (linux(ua, platform)) return tabletLike() ? null : "linux";
  return null;
}

export function platformChoices() {
  const id = detectPlatform();
  if (id) return [id];
  return linux(navigator.userAgent || "", navigator.userAgentData?.platform || navigator.platform || "") ? ["android", "linux"] : [];
}

export function deviceName(id) {
  if (id === "ios") return ipad() ? "iPad" : "iPhone";
  if (id === "web") return "Chromebook";
  return "";
}

export function megabytes(bytes) {
  return Math.round(bytes / 1e6);
}
