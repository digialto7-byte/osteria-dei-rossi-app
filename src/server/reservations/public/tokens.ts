import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// The cancel link and the form token (ADR-032 decision 5). Both are HMAC-SHA256 under RESERVATION_LINK_KEY with their own purpose prefix, so one cannot stand in for the other.
// The token holds an id or a time and a MAC, nothing personal. Verification needs no database call.

export interface LinkKeys {
  current: string;
  /** The key before a rotation; its tokens verify until it is removed. */
  previous?: string | undefined;
}

/** The form must have been open this long before it is sent (a script posts faster). */
export const FORM_MIN_AGE_MS = 3000;
/** A form older than this is expired. */
export const FORM_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KID = /^[0-9a-f]{8}$/;
const MAC = /^[0-9a-f]{64}$/;
const DIGITS = /^[0-9]{1,15}$/;

/** The first 8 hex characters of the key's SHA-256: names a key in a token without revealing it. */
export function keyId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

const mac = (key: string, message: string) =>
  createHmac("sha256", key).update(message).digest("hex");
const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant time, on digests of equal length. */
function sameMac(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

/** The key a token's kid names, or undefined. */
function keyFor(keys: LinkKeys, kid: string): string | undefined {
  return [keys.current, keys.previous].find((key) => key !== undefined && keyId(key) === kid);
}

const cancelMessage = (reservationId: string, exp: number) =>
  `resv-cancel|c1|${reservationId}|${exp}`;
const formMessage = (slug: string, issuedAtMs: number) => `resv-form|f1|${slug}|${issuedAtMs}`;

/** `c1.<kid>.<reservationId>.<exp>.<mac>`; `exp` is epoch seconds (the booked start minus cancel_until_minutes). */
export function signCancelToken(keys: LinkKeys, reservationId: string, exp: number): string {
  return [
    "c1",
    keyId(keys.current),
    reservationId,
    String(exp),
    mac(keys.current, cancelMessage(reservationId, exp)),
  ].join(".");
}

/** The id and `exp` of a genuine, unexpired token; null for anything else (the reason is never told). The MAC is checked before anything else is trusted. */
export function verifyCancelToken(
  keys: LinkKeys,
  token: string,
  nowSec: number,
): { reservationId: string; exp: number } | null {
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [version, kid, reservationId, expText, provided] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (version !== "c1" || !KID.test(kid) || !UUID.test(reservationId)) return null;
  if (!DIGITS.test(expText) || !MAC.test(provided)) return null;
  const key = keyFor(keys, kid);
  if (key === undefined) return null;
  const exp = Number(expText);
  if (!sameMac(provided, mac(key, cancelMessage(reservationId, exp)))) return null;
  return nowSec < exp ? { reservationId, exp } : null;
}

/** `f1.<kid>.<issuedAtMs>.<mac>`: the page hands it out, the request hands it back. */
export function signFormToken(keys: LinkKeys, slug: string, issuedAtMs: number): string {
  return [
    "f1",
    keyId(keys.current),
    String(issuedAtMs),
    mac(keys.current, formMessage(slug, issuedAtMs)),
  ].join(".");
}

export type FormCheck = "ok" | "too_fast" | "expired" | "invalid";

/** Checks the MAC, then the age: under 3 s (or from the future) is too fast, over 2 h expired. */
export function checkFormToken(
  keys: LinkKeys,
  slug: string,
  token: string,
  nowMs: number,
): FormCheck {
  const parts = token.split(".");
  if (parts.length !== 4) return "invalid";
  const [version, kid, issuedText, provided] = parts as [string, string, string, string];
  if (
    version !== "f1" ||
    !KID.test(kid) ||
    !/^[0-9]{1,16}$/.test(issuedText) ||
    !MAC.test(provided)
  ) {
    return "invalid";
  }
  const key = keyFor(keys, kid);
  if (key === undefined) return "invalid";
  const issuedAt = Number(issuedText);
  if (!sameMac(provided, mac(key, formMessage(slug, issuedAt)))) return "invalid";
  const age = nowMs - issuedAt;
  if (age < FORM_MIN_AGE_MS) return "too_fast";
  return age > FORM_MAX_AGE_MS ? "expired" : "ok";
}
