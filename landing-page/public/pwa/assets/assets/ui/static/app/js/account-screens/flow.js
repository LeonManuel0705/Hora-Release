// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The code screens follow the form before them in the same page: the key from signing up lives only in memory, so the
// address waiting for its code does too.
let held = null;

export const pending = {
  read: () => (held ? { ...held } : null),
  write({ email, purpose, resendAfter, expiresIn }) {
    const now = Date.now();
    held = {
      email,
      purpose,
      resendAt: now + (resendAfter ?? 60) * 1000,
      expiresAt: now + (expiresIn ?? 600) * 1000,
    };
    return { ...held };
  },
  clear: () => (held = null),
};
