// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { data, esc, icon, accountStore, profileStore, HUES } from "./core.js";
import { lunaPortrait } from "./luna.js";

const NAME_MAX = 40;

export const LUNA_LOOKS = [
  { id: "stift", label: "Stift", hue: "iris", pose: "pencil", face: "open" },
  { id: "juhu", label: "Juhu", hue: "rose", pose: "cheer", face: "happy" },
  { id: "muede", label: "Müde", hue: "lake", pose: "rest", face: "closed", wear: "cap" },
  { id: "brille", label: "Brille", hue: "jade", pose: "wave", face: "open", wear: "glasses" },
  { id: "musik", label: "Musik", hue: "ochre", pose: "rest", face: "happy", wear: "headphones" },
  { id: "abi", label: "Abi", hue: "plum", pose: "pencil", face: "wink", wear: "mortarboard" },
];
const LOOKS = new Map(LUNA_LOOKS.map((look) => [look.id, look]));

const listeners = new Set();
let account = null;

export function cleanName(value) {
  if (typeof value !== "string") return "";
  const flat = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return [...flat].slice(0, NAME_MAX).join("").trim();
}

// The first name and the avatar live on this device alone, in a device-only value like the account: no backup,
// export or plan share takes them. Syncing them comes later with the personal settings.
export function readProfile() {
  const value = profileStore.get();
  const stored = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    name: cleanName(stored.name),
    avatar: LOOKS.has(stored.avatar) ? stored.avatar : "initial",
    asked: stored.asked === true,
  };
}

export const profileName = () => readProfile().name || null;

function keep(next) {
  const value = {
    ...(next.name ? { name: next.name } : {}),
    ...(LOOKS.has(next.avatar) ? { avatar: next.avatar } : {}),
    ...(next.asked ? { asked: true } : {}),
  };
  profileStore.set(Object.keys(value).length ? value : null);
  const kept = readProfile();
  listeners.forEach((listener) => listener(kept));
  if (typeof dispatchEvent === "function") dispatchEvent(new CustomEvent("app:profile", { detail: kept }));
  return kept;
}

export function setProfileName(value) {
  const current = readProfile();
  const name = cleanName(value);
  if (name === current.name) return current;
  return keep({ ...current, name });
}

export function setAvatar(choice) {
  const current = readProfile();
  const avatar = LOOKS.has(choice) ? choice : "initial";
  if (avatar === current.avatar) return current;
  return keep({ ...current, avatar });
}

// The question for the first name is asked once, whatever the answer.
export function answerName(value) {
  const current = readProfile();
  const name = cleanName(value) || current.name;
  return keep({ ...current, name, asked: true });
}

export function wantsName(planned) {
  const { name, asked } = readProfile();
  return Boolean(planned) && !name && !asked;
}

export function replaceProfile(value) {
  profileStore.set(value && typeof value === "object" ? value : null);
  return keep(readProfile());
}

export function onProfile(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The account as the profile shows it: nothing without an account service, the stored session until the core says more.
export function profileAccount() {
  if (!data?.accountService) return null;
  if (account) return account;
  const stored = accountStore.get();
  const email = typeof stored?.token === "string" && typeof stored?.account?.email === "string" ? stored.account.email : null;
  return { available: true, ready: false, signedIn: Boolean(email), email, needsPassword: false, guest: stored?.guest === true };
}

export function noteAccount(state) {
  account = state?.available ? state : account;
}

// What the profile sheet shows of the account: nothing without a service, signing in or creating one when signed out
// or a guest, the sync with signing out when signed in, and the password step when the key is missing here.
export function accountPart(state) {
  if (!state?.available) return null;
  if (!state.signedIn) return "out";
  return state.needsPassword ? "password" : "in";
}

function hashOf(text) {
  let hash = 0x811c9dc5;
  for (const char of text) hash = Math.imul(hash ^ char.codePointAt(0), 0x01000193);
  return hash >>> 0;
}

export const hueOf = (text) => HUES[hashOf(String(text).trim().toLowerCase()) % HUES.length];

function firstLetter(text) {
  const letter = String(text || "").match(/[\p{L}\p{N}]/u)?.[0];
  return letter ? [...letter.toLocaleUpperCase("de")][0] : "";
}

// The avatar: a chosen Luna, else the first letter of the first name, else of the email, else a neutral figure.
export function avatarModel(profile = readProfile(), email = profileAccount()?.signedIn ? profileAccount().email : null) {
  const look = LOOKS.get(profile.avatar);
  if (look) return { kind: "luna", look: look.id, hue: look.hue, label: look.label };
  const source = [profile.name, email].find((text) => firstLetter(text));
  if (!source) return { kind: "blank" };
  return { kind: "initial", letter: firstLetter(source), hue: hueOf(source) };
}

export function avatarInner(model) {
  if (model.kind === "luna") return lunaPortrait(LOOKS.get(model.look));
  if (model.kind === "initial") return `<span class="avatar-letter">${esc(model.letter)}</span>`;
  return icon("user");
}

export function avatarHtml(model = avatarModel()) {
  const hue = model.hue ? ` style="--hue: var(--hue-${model.hue})"` : "";
  const look = model.look ? ` data-look="${model.look}"` : "";
  return `<span class="avatar is-${model.kind}"${hue}${look} aria-hidden="true">${avatarInner(model)}</span>`;
}

const signature = (model) => `${model.kind}:${model.look || model.letter || ""}:${model.hue || ""}`;

export function paintAvatar(node, model = avatarModel()) {
  const key = signature(model);
  if (node.dataset.painted === key) return;
  node.dataset.painted = key;
  node.className = `avatar is-${model.kind}`;
  if (model.hue) node.style.setProperty("--hue", `var(--hue-${model.hue})`);
  else node.style.removeProperty("--hue");
  if (model.look) node.dataset.look = model.look;
  else delete node.dataset.look;
  node.innerHTML = avatarInner(model);
}

export function paintAvatars(scope = document) {
  const model = avatarModel();
  scope.querySelectorAll?.("[data-avatar]").forEach((node) => paintAvatar(node, model));
  return model;
}
