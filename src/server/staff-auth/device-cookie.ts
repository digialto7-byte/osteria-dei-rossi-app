import { DEVICE_COOKIE_MAX_AGE_SECONDS, DEVICE_COOKIE_NAME, DEVICE_TOKEN_BYTES } from "./constants";

// The enrolled-device credential (ADR-010 decision 3): a random 256-bit token as base64url, kept in a
// __Host- cookie. __Host- needs Secure, Path=/ and no Domain, so no sibling subdomain can set it.
const TOKEN_SHAPE = new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((DEVICE_TOKEN_BYTES * 8) / 6)}}$`);

const FLAGS = ["Path=/", "HttpOnly", "Secure", "SameSite=Strict"];

/** True for a string shaped like a device token (43 base64url characters). */
export function isDeviceToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_SHAPE.test(value);
}

/** The Set-Cookie value that stores a freshly enrolled device's token. */
export function serializeDeviceCookie(token: string): string {
  if (!isDeviceToken(token)) throw new Error("Not a device token");
  return [
    `${DEVICE_COOKIE_NAME}=${token}`,
    ...FLAGS,
    `Max-Age=${DEVICE_COOKIE_MAX_AGE_SECONDS}`,
  ].join("; ");
}

/** The Set-Cookie value that removes the cookie (a revoked or unknown device). */
export function clearDeviceCookie(): string {
  return [`${DEVICE_COOKIE_NAME}=`, ...FLAGS, "Max-Age=0"].join("; ");
}

/** The device token in a Cookie header, or null when absent or malformed. */
export function readDeviceCookieValue(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== DEVICE_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return isDeviceToken(value) ? value : null;
  }
  return null;
}

export function readDeviceToken(request: Request): string | null {
  return readDeviceCookieValue(request.headers.get("cookie"));
}
