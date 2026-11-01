import { COMMON_PASSWORDS } from "@/lib/auth/common-passwords";

// Local password rules for owner and admin (ADR-029 decision 3). Length plus a few refusals, no composition
// rules: a sentence is a good password. Supabase's own minimum length is the second check.

export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt, which Supabase Auth uses, ignores everything after 72 bytes. */
export const PASSWORD_MAX_BYTES = 72;

export type PasswordRejection =
  "too_short" | "too_long" | "like_email" | "like_venue" | "repetitive" | "sequence" | "common";

/** The approved trading name (docs/client-facts.md): refused as a whole word, or as the full name joined (after Unicode and accent normalisation). */
const VENUE_WORDS = ["osteria", "rossi", "deirossi", "osteriadeirossi"];
// The full name in the orders a person might type, joined without separators.
const VENUE_JOINS = ["osteriadeirossi", "osteriarossi", "rossiosteria"];
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

/** NFKC (full-width letters), accents removed, zero-width characters removed. Case is kept for word splitting. */
function normaliseForVenue(password: string): string {
  return password
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
}

function likeVenue(password: string): boolean {
  const text = normaliseForVenue(password);
  // Words split at non-letters and at each lower-to-upper boundary ("LaRossi" -> La, Rossi), then lower-cased.
  const words = text
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .split(/[^\p{L}]+/u)
    .map((word) => word.toLowerCase());
  if (words.some((word) => VENUE_WORDS.includes(word))) return true;
  const letters = text.toLowerCase().replace(/[^\p{L}]/gu, "");
  return VENUE_JOINS.some((join) => letters.includes(join));
}

/** Checks a new password. Rules run in a fixed order and the first that fails is the reason. */
export function checkNewPassword(
  password: string,
  context: { email: string },
): { ok: true } | { ok: false; reason: PasswordRejection } {
  const fail = (reason: PasswordRejection) => ({ ok: false as const, reason });
  const lower = password.toLowerCase();

  if ([...password].length < PASSWORD_MIN_LENGTH) return fail("too_short");
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return fail("too_long");
  if (likeEmail(lower, context.email)) return fail("like_email");
  if (likeVenue(password)) return fail("like_venue");
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
