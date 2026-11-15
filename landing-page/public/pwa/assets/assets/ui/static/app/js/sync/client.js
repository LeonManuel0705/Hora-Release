// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

const FORMAT = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PADDING = 1024;
const SPACE = 0x20;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const MAX_ENTRY_BYTES = 64 * 1024;

export class SyncError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "SyncError";
    this.code = code;
    Object.assign(this, details);
  }
}

export async function deriveCipherKey(dataKey) {
  const root = await crypto.subtle.importKey("raw", dataKey, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: encoder.encode("hora-entries-v1") },
    root,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64(bytes) {
  let text = "";
  for (let start = 0; start < bytes.length; start += 0x8000) text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(text);
}

const fromBase64 = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
const boundTo = (account, stream) => encoder.encode(JSON.stringify(["hora-entry", FORMAT, account, stream]));

async function seal(key, account, stream, value) {
  const text = value == null ? undefined : JSON.stringify(value);
  if (typeof text !== "string") throw new SyncError("invalid_value");
  const bytes = encoder.encode(text);
  // Trailing spaces round the length up, so the size the server sees says little about how much is in the plan.
  const plain = new Uint8Array(Math.ceil(bytes.length / PADDING) * PADDING).fill(SPACE);
  plain.set(bytes);
  if (1 + IV_BYTES + plain.length + TAG_BYTES > MAX_ENTRY_BYTES) throw new SyncError("entry_too_large", { limit: MAX_ENTRY_BYTES });
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: boundTo(account, stream) }, key, plain);
  const entry = new Uint8Array(1 + IV_BYTES + sealed.byteLength);
  entry[0] = FORMAT;
  entry.set(iv, 1);
  entry.set(new Uint8Array(sealed), 1 + IV_BYTES);
  return toBase64(entry);
}

async function open(key, account, stream, data) {
  const entry = fromBase64(data);
  if (entry[0] !== FORMAT || entry.length < 1 + IV_BYTES + TAG_BYTES) throw new SyncError("unknown_format");
  const iv = entry.subarray(1, 1 + IV_BYTES);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: boundTo(account, stream) }, key, entry.subarray(1 + IV_BYTES));
  return JSON.parse(decoder.decode(plain));
}

export function createSyncClient({ key, account, baseUrl = "", fetchImpl = (...parameters) => fetch(...parameters) }) {
  async function call(path, body) {
    let response;
    try {
      response = await fetchImpl(baseUrl + path, {
        method: body ? "POST" : "GET",
        credentials: "same-origin",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new SyncError("network");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const { error, ...details } = payload;
      throw new SyncError(error || "server", details);
    }
    return payload;
  }

  return {
    account,

    async push(stream, value) {
      const data = await seal(key, account, stream, value);
      return (await call("/api/entries", { stream, data })).seq;
    },

    async pull(stream, after = 0) {
      const entries = [];
      const unreadable = [];
      let cursor = after;
      let latest = after;
      for (;;) {
        const page = await call(`/api/entries?${new URLSearchParams({ stream, after: String(cursor) })}`);
        for (const { seq, data } of page.entries) {
          try {
            entries.push({ seq, value: await open(key, account, stream, data) });
          } catch {
            unreadable.push(seq);
          }
          cursor = seq;
        }
        latest = page.latest;
        if (!page.more || !page.entries.length) break;
      }
      return { entries, unreadable, latest };
    },
  };
}
