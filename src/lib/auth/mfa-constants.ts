// P2-1 (docs/plans/2026-11-12-p2-1-totp.md T-7, T-9): the constants of the second factor. The SQL twins are app.mfa_lock_failures(), app.mfa_lock_minutes() and
// app.mfa_max_factors() in 20261201100100_mfa_self.sql and the slot names of public.mfa_enrol_check; tests/parity/mfa-constants.test.ts keeps them equal.

/** Wrong codes in the window that lock the code entry of an account. */
export const MFA_LOCK_FAILURES = 5;
/** The window, and the time the lock lasts from the oldest failure in it. */
export const MFA_LOCK_MINUTES = 15;
/** Verified TOTP factors per account: a main one and a backup. */
export const MFA_MAX_FACTORS = 2;

/** The two fixed slots (T-7): no free-text device names, so nothing personal is typed. */
export const MFA_SLOTS = ["principale", "riserva"] as const;
export type MfaSlot = (typeof MFA_SLOTS)[number];

/** The friendly name Supabase stores for each slot. */
export const MFA_SLOT_NAMES: Record<MfaSlot, string> = {
  principale: "Principale",
  riserva: "Riserva",
};

/** The slot of a stored friendly name; a name set outside the app (a direct call to Supabase) is "altro". */
export function slotOfFriendlyName(name: string | null | undefined): MfaSlot | "altro" {
  for (const slot of MFA_SLOTS) if (MFA_SLOT_NAMES[slot] === name) return slot;
  return "altro";
}
