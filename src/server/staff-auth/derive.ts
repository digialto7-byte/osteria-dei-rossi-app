import { createHmac } from "node:crypto";

/**
 * The Supabase Auth password of a PIN account: base64url(HMAC-SHA256(pepper, userId + ":" + pin)), 43
 * characters. It exists only in the memory of one request: it is never stored, logged or sent to Postgres.
 * Without the pepper (server env only) the 10 000 PINs cannot be tried against Supabase Auth directly.
 */
export function derivePinPassword(pepper: string, appUserId: string, pin: string): string {
  if (!pepper || !appUserId || !pin)
    throw new Error("Cannot derive a PIN password from empty input");
  return createHmac("sha256", pepper).update(`${appUserId}:${pin}`).digest("base64url");
}
