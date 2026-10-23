import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase/cookies";
import { DEVICE_COOKIE_NAME } from "@/server/staff-auth/constants";
import type { StackEnv } from "./stack";

/** An in-memory browser cookie store for the Supabase session cookies (one jar = one browser). */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  getAll(): { name: string; value: string }[] {
    return [...this.cookies].map(([name, value]) => ({ name, value }));
  }

  setAll(items: { name: string; value: string; options?: { maxAge?: number } }[]): void {
    for (const { name, value, options } of items) {
      if (value === "" || options?.maxAge === 0) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  clear(): void {
    this.cookies.clear();
  }
}

/**
 * The server client the way production builds it per request (publishable key + cookies), but over a jar
 * and an optional fetch, so a test can count what reaches Supabase Auth.
 */
export function createJarClient(
  env: StackEnv,
  jar: CookieJar,
  fetchImpl?: typeof fetch,
): SupabaseClient {
  return createServerClient(env.url, env.publishableKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: { getAll: () => jar.getAll(), setAll: (items) => jar.setAll(items) },
    global: fetchImpl ? { fetch: fetchImpl } : undefined,
  });
}

/** `__Host-odr_device=<token>` from a response's Set-Cookie, as a Cookie header value, or null. */
export function deviceCookieFrom(response: Response): string | null {
  const header = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${DEVICE_COOKIE_NAME}=([A-Za-z0-9_-]+)`).exec(header);
  return match ? `${DEVICE_COOKIE_NAME}=${match[1]}` : null;
}

/** A fetch wrapper that counts requests to Supabase Auth's token endpoint (sign-in and refresh). */
export function countingFetch(inner: typeof fetch = fetch) {
  const counter = {
    tokenRequests: 0,
    reset: () => {
      counter.tokenRequests = 0;
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/auth/v1/token")) counter.tokenRequests += 1;
      return inner(input, init);
    }) as typeof fetch,
  };
  return counter;
}
