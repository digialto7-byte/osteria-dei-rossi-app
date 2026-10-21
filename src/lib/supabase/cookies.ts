import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Session cookie flags (plan §3.11.3). @supabase/ssr defaults to readable-by-script cookies; the
 * app has no browser Supabase client (screens only call /api/*), so the session can be HttpOnly.
 * Browsers accept Secure cookies on http://localhost, so local development keeps working.
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const satisfies CookieOptionsWithName;
