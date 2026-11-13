import { createHmac } from "node:crypto";

// P2-1 A14 (docs/plans/2026-11-12-p2-1-totp.md section 3.9): the TOTP generator of the end-to-end tests. RFC 6238 (HMAC-SHA1, 30 second steps, 6 digits) and RFC 4648
// base32, on node:crypto alone. `otpauth` and `otplib` were considered and not adopted: a few lines do the job and no dependency or licence review is needed. The
// secrets passed here are the ones the local test stack generates or the RFC's own; none is a real credential.

export const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decodes a base32 key as an authenticator shows it: upper or lower case, in groups with spaces, with or without `=` padding. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/\s+/g, "").replace(/=+$/, "").toUpperCase();
  if (clean.length === 0) throw new Error("Empty base32 key");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** The code of the step that contains `unixSeconds`. */
export function totpAt(secretBase32: string, unixSeconds: number): string {
  const counter = Math.floor(unixSeconds / STEP_SECONDS);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(message).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

interface Clock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}
const REAL_CLOCK: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
/** A margin past the step boundary, so the server's clock is also in the new step. */
const BOUNDARY_MARGIN_MS = 500;

/**
 * A code for the current step, never one whose step was already used for this factor (Supabase refuses a code reused for the same factor): when the current step is
 * `lastStepUsed` or older than it, waits for the next step. Returns the code and its step number, which the caller keeps as the next `lastStepUsed`.
 */
export async function freshCode(
  secretBase32: string,
  lastStepUsed: number | null,
  clock: Clock = REAL_CLOCK,
): Promise<{ code: string; step: number }> {
  for (;;) {
    const nowMs = clock.now();
    const step = Math.floor(nowMs / 1000 / STEP_SECONDS);
    if (lastStepUsed === null || step > lastStepUsed) {
      return { code: totpAt(secretBase32, step * STEP_SECONDS), step };
    }
    await clock.sleep((step + 1) * STEP_SECONDS * 1000 - nowMs + BOUNDARY_MARGIN_MS);
  }
}
