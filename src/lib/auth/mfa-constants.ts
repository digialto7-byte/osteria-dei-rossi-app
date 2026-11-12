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

/**
 * Whether a sign-in may send an owner or admin who has no factor yet to the offer page /login/offerta-codice (T-11). The page is built in PR 2 (step B4); until it
 * exists, sending everyone there would break every owner sign-in, so PR 1 keeps this false and the plan's promise holds: "for users nothing changes until PR 2".
 * Step B4 sets it to true together with the page. The challenge and forced-enrolment redirects are not behind it: only an account that already has a factor, or an
 * admin the founder put under `required`, can reach them, and neither happens before PR 2 is deployed (rollout steps M-2 and M-5).
 */
export const MFA_OFFER_PAGE_READY = false;
