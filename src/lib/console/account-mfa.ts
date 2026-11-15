import type { z } from "zod";
import type { accountMfaGetResponseSchema, MfaFactor } from "@/lib/platform/api";

// Presentation helpers for the platform account's second factor (/api/auth/mfa/account*). Pure: they choose which screen applies
// and decide nothing about access (the routes and Postgres do).

export type AccountFactor = MfaFactor;
export type AccountMfaStatus = z.infer<typeof accountMfaGetResponseSchema>;

const SLOT_ORDER = ["principale", "riserva", "altro"] as const;

/** The verified factors, main device first. An unverified one cannot answer a challenge. */
export function accountVerifiedFactors(factors: readonly AccountFactor[]): AccountFactor[] {
  return SLOT_ORDER.flatMap((slot) =>
    factors.filter((f) => f.status === "verified" && f.slot === slot),
  );
}

/** What the person has to do next: nothing (aal2), enrol a first factor, or answer a code. */
export function accountGate(s: AccountMfaStatus): "ok" | "challenge" | "enrol" {
  if (s.currentLevel === "aal2") return "ok";
  return accountVerifiedFactors(s.factors).length === 0 ? "enrol" : "challenge";
}

/**
 * True when a failed `GET /api/me/mfa` means "this session has no venue" (a platform account on the venue host), which is the only
 * case where the venue's code page reads the account pair instead.
 */
export function usesAccountFallback(r: { status: number; error: { code: string } }): boolean {
  return (
    (r.status === 403 && r.error.code === "no_tenant") ||
    (r.status === 409 && r.error.code === "tenant_selection_required")
  );
}
