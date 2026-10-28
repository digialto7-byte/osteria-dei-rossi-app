import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Hosts that never leave the machine. WebKit (Safari, Playwright's WebKit) drops Secure cookies
 * set over plain http, even on localhost; Chromium and Firefox accept them. Anything else, such
 * as `localhost.evil.test` or `127.0.0.1.nip.io`, is a different host and does not match.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** True only for plain http to a loopback host, the one case where Secure is dropped. */
export function isInsecureLoopback(protocol: string, hostname: string): boolean {
  return (
    protocol.replace(/:$/, "").toLowerCase() === "http" &&
    LOOPBACK_HOSTS.has(hostname.toLowerCase())
  );
}

/**
 * Session cookie flags (plan §3.11.3). @supabase/ssr defaults to readable-by-script cookies; the
 * app has no browser Supabase client (screens only call /api/*), so the session can be HttpOnly.
 * This is the Secure baseline, also used by scripts and tests that are not browsers.
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const satisfies CookieOptionsWithName;

/**
 * Secure is always on, except for plain-http requests to a loopback host (local development and
 * the CI production build on http://localhost:3000), where WebKit would otherwise drop the
 * cookies. Production is https only, so it stays Secure.
 */
export function sessionCookieOptions(url: URL): CookieOptionsWithName {
  return { ...SESSION_COOKIE_OPTIONS, secure: !isInsecureLoopback(url.protocol, url.hostname) };
}

/** Host without its port: `localhost:3000` -> `localhost`, `[::1]:3000` -> `[::1]`. Null if malformed. */
function hostnameOf(host: string | null): string | null {
  if (!host) return null;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

/**
 * Same rule for code that has no request URL (`headers()` in route handlers). The protocol is the
 * first `x-forwarded-proto` value (Vercel always sends `https`); with no such header the request
 * reached the Next server directly, which only serves plain http. A missing or malformed host
 * stays Secure.
 */
export function sessionCookieOptionsFromHeaders(headers: Headers): CookieOptionsWithName {
  const hostname = hostnameOf(headers.get("host"));
  const protocol = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  return sessionCookieOptions(new URL(`${protocol}://${hostname ?? "invalid.invalid"}`));
}
