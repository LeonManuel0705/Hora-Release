// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

const COMMON = new Set([
  "password", "passwort", "passwort1", "passwort123", "password123", "1234567890", "0987654321", "123456789a",
  "qwertz1234", "qwertzuiop", "qwertyuiop", "hallo12345", "iloveyou12", "schule1234", "abcdefghij", "fussball123",
  "ichliebedich", "passwort12", "password12", "qwertz123456", "asdfghjkl1", "1q2w3e4r5t", "q1w2e3r4t5",
]);

const WORDS = new Set([
  "passwort", "password", "hallo", "hello", "schule", "fussball", "iloveyou", "ichliebedich", "liebe", "schatz",
  "sommer", "winter", "geheim", "willkommen", "welcome", "hora", "admin", "login", "test", "dragon", "monkey",
  "letmein", "master", "berlin", "potsdam", "hamburg", "deutschland", "handy", "computer", "iserv", "schalke",
  "bayern", "borussia", "qwertz", "qwerty", "asdf", "abc", "abcdef",
]);

const ROWS = ["abcdefghijklmnopqrstuvwxyz", "01234567890", "qwertzuiopü", "asdfghjklöä", "yxcvbnm", "qwertyuiop", "zxcvbnm"];

const neighbours = (a, b) => ROWS.some((row) => {
  const at = row.indexOf(a);
  return at !== -1 && (row[at + 1] === b || row[at - 1] === b);
});

function runs(lower) {
  const found = [];
  let start = 0;
  for (let index = 1; index <= lower.length; index += 1) {
    if (index < lower.length && neighbours(lower[index - 1], lower[index])) continue;
    if (index - start >= 3) found.push(index - start);
    start = index;
  }
  return found;
}

export function checkPassword(password, email = "") {
  const lower = password.toLowerCase();
  const local = email.split("@")[0].trim().toLowerCase();
  const letters = lower.replace(/[^a-zäöüß]/g, "");
  const sequences = runs(lower);
  const covered = sequences.reduce((sum, length) => sum + length, 0);
  const problems = [];
  if (password.length < 10) problems.push("too_short");
  if (COMMON.has(lower)) problems.push("too_common");
  else if (password.length > 0 && !letters) problems.push("no_letters");
  else if (WORDS.has(letters)) problems.push("common_word");
  if (password.length > 0 && (new Set(lower).size <= 3 || /^(.{1,4})\1{2,}.{0,3}$/.test(lower))) problems.push("repeated");
  if (password.length > 0 && covered >= lower.length * 0.6) problems.push("sequence");
  if (local.length >= 3 && lower.includes(local)) problems.push("contains_email");
  const classes = [/[a-zäöüß]/, /[A-ZÄÖÜ]/, /\d/, /[^A-Za-zÄÖÜäöüß0-9]/].filter((pattern) => pattern.test(password)).length;
  const penalties = [
    /(19|20)\d\d/.test(password),
    sequences.some((length) => length >= 4),
    [...WORDS].some((word) => word.length >= 4 && letters.includes(word)),
    new Set(lower).size < lower.length / 2,
  ].filter(Boolean).length;
  let score = password.length >= 6 ? 1 : 0;
  if (problems.length === 0) {
    let base = 2;
    if ((password.length >= 12 && classes >= 2) || (password.length >= 10 && classes >= 4) || password.length >= 15) base = 3;
    if ((password.length >= 16 && classes >= 3) || password.length >= 20) base = 4;
    score = Math.max(2, base - penalties);
  }
  return { score, acceptable: problems.length === 0, problems };
}
