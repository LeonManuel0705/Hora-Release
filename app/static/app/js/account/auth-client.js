// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { checkPassword } from "./password-check.js";
import { deriveCipherKey } from "../sync/client.js";

const ITERATIONS = 600000;
const encoder = new TextEncoder();

export const CLIENT_HEADER = "X-Account-Client";

export class AuthError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "AuthError";
    this.code = code;
    Object.assign(this, details);
  }
}

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
export const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();

async function deriveKeys(password, salt, iterations) {
  // NFKC so the same password typed on different keyboards yields the same bytes
  const bytes = encoder.encode(password.normalize("NFKC"));
  const material = await crypto.subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveBits"]);
  const master = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256);
  const root = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveBits"]);
  const expand = (info) =>
    crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: encoder.encode(info) }, root, 256);
  const [authKey, dataKey] = await Promise.all([expand("hora-auth-v1"), expand("hora-data-v1")]);
  return { authKey: toBase64(authKey), entryKey: await deriveCipherKey(dataKey) };
}

// The app keeps no cookie, since its pages run on another origin than the account service: it marks itself, takes its
// session as a token from the answer and sends it back as a bearer. A 401 to a call with the token means the session is gone.
export function appFetch({ token = () => null, onSessionEnded = () => {}, fetchImpl = (...parameters) => fetch(...parameters) } = {}) {
  return async (url, options = {}, { bearer = true } = {}) => {
    const session = bearer ? token() : null;
    const response = await fetchImpl(url, {
      ...options,
      credentials: "omit",
      cache: "no-store",
      headers: { ...options.headers, [CLIENT_HEADER]: "app", ...(session ? { Authorization: `Bearer ${session}` } : {}) },
    });
    if (session && response.status === 401) onSessionEnded(session);
    return response;
  };
}

export function createAuthClient({ baseUrl, fetchImpl }) {
  let pendingKey = null;

  async function call(path, body, { method = "POST", bearer = false, token } = {}) {
    let response;
    try {
      const headers = { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      response = await fetchImpl(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined }, { bearer: bearer && !token });
    } catch {
      throw new AuthError("network");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const { error, ...details } = payload;
      throw new AuthError(error || "server", { status: response.status, ...details });
    }
    return payload;
  }

  function opened(result, key) {
    const { account, token } = result;
    if (typeof token !== "string" || !account || typeof account.id !== "string" || typeof account.email !== "string") throw new AuthError("server");
    return { account, token, key };
  }

  async function freshCredentials(email, password) {
    if (!checkPassword(password, email).acceptable) throw new AuthError("weak_password");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keys = await deriveKeys(password, salt, ITERATIONS);
    return { keys, fields: { salt: toBase64(salt), iterations: ITERATIONS, authKey: keys.authKey } };
  }

  return {
    checkPassword,

    session() {
      return call("/api/session", null, { method: "GET", bearer: true });
    },

    async signUp(email, password) {
      const address = normalizeEmail(email);
      const { keys, fields } = await freshCredentials(address, password);
      const result = await call("/api/signup", { email: address, ...fields });
      pendingKey = { email: address, key: keys.entryKey };
      return result;
    },

    async verifyEmail(email, code) {
      const address = normalizeEmail(email);
      const result = await call("/api/verify", { email: address, code: String(code).trim() });
      const key = pendingKey?.email === address ? pendingKey.key : null;
      pendingKey = null;
      return opened(result, key);
    },

    resendCode(email) {
      return call("/api/resend", { email: normalizeEmail(email) });
    },

    async signIn(email, password) {
      const address = normalizeEmail(email);
      const parameters = await call("/api/prelogin", { email: address });
      const keys = await deriveKeys(password, fromBase64(parameters.salt), parameters.iterations);
      let result;
      try {
        result = await call("/api/login", { email: address, authKey: keys.authKey });
      } catch (error) {
        // Only this answer proves the password right, and the code screen that follows needs the key.
        if (error.code === "email_not_verified") pendingKey = { email: address, key: keys.entryKey };
        throw error;
      }
      pendingKey = null;
      return opened(result, keys.entryKey);
    },

    endSession(token) {
      return call("/api/logout", {}, { token });
    },

    requestPasswordReset(email) {
      return call("/api/reset/request", { email: normalizeEmail(email) });
    },

    async resetPassword(email, code, newPassword) {
      const address = normalizeEmail(email);
      const { keys, fields } = await freshCredentials(address, newPassword);
      const result = await call("/api/reset/confirm", { email: address, code: String(code).trim(), ...fields });
      pendingKey = null;
      return opened(result, keys.entryKey);
    },
  };
}
