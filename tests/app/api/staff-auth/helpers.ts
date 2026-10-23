import { sha256Hex } from "@/server/staff-auth/tokens";

export const PEPPER = "test-pepper-not-a-secret-0123456789abcdef";
export const BASE = "http://localhost:3000";
export const DEVICE_TOKEN = "T".repeat(43);
export const DEVICE_HASH = sha256Hex(DEVICE_TOKEN);
export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";
export const AUTH_SESSION_ID = "44444444-4444-4444-8444-444444444444";
export const AUTH_USER_ID = "66666666-6666-4666-8666-666666666666";
export const AUTH_EMAIL = `staff-${USER_ID}@staff.invalid`;
export const PIN = "4827";

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** An unsigned JWT with the given claims: enough for code that only reads the payload. */
export const fakeJwt = (claims: Record<string, unknown>) =>
  `${b64({ alg: "none" })}.${b64(claims)}.sig`;

export const deviceCookie = (token = DEVICE_TOKEN) => `__Host-odr_device=${token}`;

export function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
