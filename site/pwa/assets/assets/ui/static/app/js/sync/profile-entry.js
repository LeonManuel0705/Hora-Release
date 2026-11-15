// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { SyncError } from "./client.js";

export const PROFILE_STREAM = "profile";

const AVATAR = /^(initial|photo|[a-z]{2,12})$/;
const PHOTO = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/;
const isRecord = (record) => Number.isSafeInteger(record?.at) && record.at > 0 && typeof record.device === "string" && record.device.length <= 64;

function cleanProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const name = typeof profile.name === "string" ? profile.name.slice(0, 120) : "";
  const avatar = typeof profile.avatar === "string" && AVATAR.test(profile.avatar) ? profile.avatar : "initial";
  const photo = avatar === "photo" && typeof profile.photo === "string" && PHOTO.test(profile.photo) ? profile.photo : "";
  if (avatar === "photo" && !photo) return null;
  return { name, avatar, ...(photo ? { photo } : {}) };
}

// The profile as one encrypted value: the first name and the picture, with when and on which device they changed last.
// An empty profile is never an entry, so a new device can never wipe the account's.
export function profileEntry({ record, profile }) {
  const value = cleanProfile(profile);
  if (!isRecord(record) || !value) throw new SyncError("invalid_value");
  if (!value.name && value.avatar === "initial") throw new SyncError("empty_profile");
  return { v: 1, record: { at: record.at, device: record.device }, profile: value };
}

export function readProfileEntry(value) {
  if (value?.v !== 1 || !isRecord(value.record)) return null;
  const profile = cleanProfile(value.profile);
  if (!profile || (!profile.name && profile.avatar === "initial")) return null;
  return { v: 1, record: { at: value.record.at, device: value.record.device }, profile };
}

// The later change wins; on the same millisecond the higher device id, so every device picks the same one.
export const newerRecord = (one, other) => !other || one.at > other.at || (one.at === other.at && one.device > other.device);
