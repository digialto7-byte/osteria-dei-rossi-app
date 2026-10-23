import { createHash, createHmac, randomBytes } from "node:crypto";
import { DEVICE_TOKEN_BYTES, ENROLMENT_CODE_ALPHABET, ENROLMENT_CODE_LENGTH } from "./constants";

/** A source of random bytes; tests inject a fixed one. */
export type RandomBytes = (size: number) => Uint8Array;

const systemRandom: RandomBytes = (size) => randomBytes(size);

/**
 * A new enrolment code: 8 symbols of the Crockford alphabet (40 bits). 256 is a multiple of 32, so taking
 * the low 5 bits of each random byte is unbiased.
 */
export function generateEnrolmentCode(random: RandomBytes = systemRandom): string {
  const bytes = random(ENROLMENT_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < ENROLMENT_CODE_LENGTH; i += 1) {
    code += ENROLMENT_CODE_ALPHABET[(bytes[i] ?? 0) & 31];
  }
  return code;
}

/** K7M2QX9P -> K7M2-QX9P. */
export function displayCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** What a person typed -> the stored form: upper case, no spaces or dashes, I and L read as 1, O as 0. */
export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * What the database stores for an enrolment code: an HMAC with the pepper over the normalised code. The
 * code has only 40 bits, so a plain SHA-256 of a leaked table could be brute-forced; without the pepper
 * the hash cannot be. The `code:` prefix keeps it apart from the IP hash.
 */
export function hashEnrolmentCode(pepper: string, code: string): string {
  return createHmac("sha256", pepper).update(`code:${code}`).digest("hex");
}

/** A 256-bit device token as base64url; only its SHA-256 is stored. */
export function generateDeviceToken(random: RandomBytes = systemRandom): string {
  return Buffer.from(random(DEVICE_TOKEN_BYTES)).toString("base64url");
}

/** The client address as the enrolment rate limit sees it: an HMAC with the pepper, never the address. */
export function hashIp(pepper: string, ip: string): string {
  return createHmac("sha256", pepper).update(`ip:${ip}`).digest("hex");
}
