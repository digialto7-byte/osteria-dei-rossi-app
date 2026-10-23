import { mapStaffAuthStatus } from "./errors";
import { redeemEnrolmentCode } from "./privileged";
import { generateDeviceToken, hashIp, normaliseCode, sha256Hex } from "./tokens";

export interface EnrolInput {
  /** What the person typed. */
  code: string;
  /** The client address as the first x-forwarded-for entry, or null. */
  ip: string | null;
  pepper: string;
}

/** The first x-forwarded-for entry. Whether Vercel overwrites a client-sent header is open (plan T4). */
export function clientIp(request: Request): string | null {
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || null;
}

/**
 * Redeems an enrolment code for a new device. The code and the device token are hashed here; only hashes
 * (and an IP hash, never the address) reach the database. Returns the raw token for the cookie.
 */
export async function enrolDevice(input: EnrolInput): Promise<{ label: string; token: string }> {
  const token = generateDeviceToken();
  const result = await redeemEnrolmentCode(
    sha256Hex(normaliseCode(input.code)),
    sha256Hex(token),
    hashIp(input.pepper, input.ip ?? "unknown"),
  );
  if (result.status !== "ok") throw mapStaffAuthStatus(result.status);
  return { label: result.label, token };
}
