// Session lifetime and sign-in recency, read from the signed token's `amr` list (ADR-029 decisions 3 and 4).
// Epoch arithmetic only, so daylight-saving changes cannot matter.

export const SESSION_MAX_AGE_DAYS = 30;
export const RECENT_SIGN_IN_MINUTES = 10;

export interface AmrClaims {
  amr?: ReadonlyArray<{ method: string; timestamp: number }>;
}

type Entry = { method: string; timestamp: number };

function entries(claims: AmrClaims): Entry[] {
  if (!Array.isArray(claims.amr)) return [];
  return claims.amr.filter(
    (e): e is Entry =>
      typeof e === "object" &&
      e !== null &&
      Number.isFinite(e.timestamp) &&
      typeof e.method === "string",
  );
}

/** Epoch seconds of the earliest authentication method, or null. */
export function signedInAt(claims: AmrClaims): number | null {
  const list = entries(claims);
  return list.length === 0 ? null : Math.min(...list.map((e) => e.timestamp));
}

/** Epoch seconds of the latest authentication method, or null. */
export function lastAuthAt(claims: AmrClaims): number | null {
  const list = entries(claims);
  return list.length === 0 ? null : Math.max(...list.map((e) => e.timestamp));
}

/** True from 30 days after the sign-in. A missing or empty `amr` counts as expired (fail closed). */
export function isSessionExpired(claims: AmrClaims, nowMs: number): boolean {
  const start = signedInAt(claims);
  if (start === null) return true;
  return nowMs >= (start + SESSION_MAX_AGE_DAYS * 86_400) * 1000;
}

/** True when the latest authentication is strictly under RECENT_SIGN_IN_MINUTES old. */
export function isRecentSignIn(claims: AmrClaims, nowMs: number): boolean {
  const last = lastAuthAt(claims);
  if (last === null) return false;
  return nowMs < (last + RECENT_SIGN_IN_MINUTES * 60) * 1000;
}

const LINK_METHODS = new Set(["otp", "magiclink", "email", "recovery", "invite"]);

/** How the latest authentication happened: "password", "link" (e-mail link or code) or "other". */
export function signInMethod(claims: AmrClaims): "password" | "link" | "other" {
  const list = entries(claims);
  if (list.length === 0) return "other";
  const latest = list.reduce((a, b) => (b.timestamp >= a.timestamp ? b : a));
  if (latest.method === "password") return "password";
  return LINK_METHODS.has(latest.method) ? "link" : "other";
}
