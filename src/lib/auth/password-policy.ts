import { COMMON_PASSWORDS } from "@/lib/auth/common-passwords";

// Local password rules for owner and admin (ADR-029 decision 3). Length plus a few refusals, no composition
// rules: a sentence is a good password. Supabase's own minimum length is the second check.

export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt, which Supabase Auth uses, ignores everything after 72 bytes. */
export const PASSWORD_MAX_BYTES = 72;

export type PasswordRejection =
  "too_short" | "too_long" | "like_email" | "like_venue" | "repetitive" | "sequence" | "common";

const SEQUENCES = [
  "01234567890",
  "09876543210",
  "abcdefghijklmnopqrstuvwxyz",
  "qwertyuiopasdfghjklzxcvbnm",
];
const MIN_LOCAL_PART_FOR_CONTAINS = 4;

function likeEmail(lower: string, email: string): boolean {
  const address = email.trim().toLowerCase();
  const local = address.split("@")[0] ?? "";
  if (lower === address || (local !== "" && lower === local)) return true;
  return local.length >= MIN_LOCAL_PART_FOR_CONTAINS && lower.includes(local);
}

/** NFKC (full-width letters), accents removed, all format characters (\p{Cf}: zero-width, soft hyphen, word joiner...) removed. Case is kept for word splitting. */
function normaliseForVenue(text: string): string {
  return text
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\p{Cf}/gu, "");
}

/** Words split at non-letters and at each lower-to-upper boundary ("LaRossi" -> La, Rossi), then lower-cased. */
function wordsOf(normalised: string): string[] {
  return normalised
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .split(/[^\p{L}]+/u)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
}

const MIN_VENUE_WORD = 4;

/**
 * What a password may not contain, from one business name (SP1 plan §3.6 H32): every word of 4 or more letters (refused as a whole
 * word), the joins of every run of 2 or more consecutive words, and the first and last significant word joined in both orders (refused
 * anywhere in the letters of the password). A join shorter than 4 letters is not refused, the same floor as a word (lead, #187):
 * 'B&B Rossi' would otherwise refuse "bb" anywhere.
 */
function venueTerms(name: string): { words: Set<string>; joins: Set<string> } {
  const all = wordsOf(normaliseForVenue(name));
  const significant = all.filter((word) => [...word].length >= MIN_VENUE_WORD);
  const joins = new Set<string>();
  for (let start = 0; start < all.length; start++) {
    for (let end = start + 2; end <= all.length; end++) {
      const join = all.slice(start, end).join("");
      if ([...join].length >= MIN_VENUE_WORD) joins.add(join);
    }
  }
  if (significant.length >= 2) {
    const first = significant[0]!;
    const last = significant[significant.length - 1]!;
    joins.add(first + last);
    joins.add(last + first);
  }
  return { words: new Set(significant), joins };
}

function likeVenue(password: string, venueNames: readonly string[]): boolean {
  const text = normaliseForVenue(password);
  const passwordWords = wordsOf(text);
  const letters = text.toLowerCase().replace(/[^\p{L}]/gu, "");
  return venueNames.some((name) => {
    const terms = venueTerms(name);
    return (
      passwordWords.some((word) => terms.words.has(word)) ||
      [...terms.joins].some((join) => letters.includes(join))
    );
  });
}

/** Checks a new password. Rules run in a fixed order and the first that fails is the reason. */
export function checkNewPassword(
  password: string,
  context: { email: string; venueNames: readonly string[] },
): { ok: true } | { ok: false; reason: PasswordRejection } {
  const fail = (reason: PasswordRejection) => ({ ok: false as const, reason });
  const lower = password.toLowerCase();

  if ([...password].length < PASSWORD_MIN_LENGTH) return fail("too_short");
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return fail("too_long");
  if (likeEmail(lower, context.email)) return fail("like_email");
  if (likeVenue(password, context.venueNames)) return fail("like_venue");
  if (new Set(password).size <= 2) return fail("repetitive");
  if (SEQUENCES.some((sequence) => sequence.includes(lower))) return fail("sequence");
  if (COMMON_PASSWORDS.has(lower)) return fail("common");
  return { ok: true };
}

/** The i18n key of the message for a rejection. */
export function passwordRejectionKey(
  reason: PasswordRejection,
): `password.reject.${PasswordRejection}` {
  return `password.reject.${reason}`;
}
