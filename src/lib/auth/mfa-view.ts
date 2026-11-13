import type { ApiErrorBody } from "@/lib/api/client";
import { t, tn } from "@/lib/i18n";

// Presentation helpers for the second-factor screens (P2-1, plan section 3.13). Pure: they format what the API sent and choose words. They make no API call and
// decide nothing about who may enrol or sign in (Postgres and the routes do). The secret passes through here only to be grouped for display; nothing is stored.

const GROUP = 4;
const SECONDS_PER_MINUTE = 60;

/** The manual-entry key in groups of four ("JBSW Y3DP EHPK 3PXP"); spaces already in it are dropped, letters upper-cased. */
export function groupSecret(secret: string): string {
  const compact = secret.replace(/\s+/g, "").toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < compact.length; i += GROUP) groups.push(compact.slice(i, i + GROUP));
  return groups.join(" ");
}

/** Whole minutes to wait, rounded up and at least one, from the seconds the API sent. */
export function lockMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / SECONDS_PER_MINUTE));
}

function retryAfterSeconds(details: unknown): number | null {
  if (details === null || typeof details !== "object" || Array.isArray(details)) return null;
  const value = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The sentence under a code field for an API error: the three of section 3.13 from the catalogue, anything else as the server worded it. */
export function mfaErrorMessage(error: ApiErrorBody): string {
  if (error.code === "mfa_code_invalid") return t("authError.mfa_code_invalid");
  if (error.code === "mfa_challenge_expired") return t("authError.mfa_challenge_expired");
  if (error.code === "mfa_locked") {
    const seconds = retryAfterSeconds(error.details);
    if (seconds !== null) return tn("mfa.locked", lockMinutes(seconds));
  }
  return error.message;
}
