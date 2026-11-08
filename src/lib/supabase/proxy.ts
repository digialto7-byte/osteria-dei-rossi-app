import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSessionExpired } from "@/lib/auth/session-age";
import { readPublicEnv } from "@/lib/env";
import { readDeviceToken } from "@/server/staff-auth/device-cookie";
import { sessionCookieOptions } from "./cookies";

const LOGIN_PATH = "/login";
// Staff PIN login and device enrolment (M11) are reachable signed out.
const PIN_PATH = "/pin";
const ENROL_PATH = "/dispositivo";
// API routes answer 401 themselves (JSON), so the proxy never redirects them.
const PUBLIC_PREFIXES = [LOGIN_PATH, PIN_PATH, ENROL_PATH, "/api/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => {
    const directory = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return pathname === prefix || pathname.startsWith(directory);
  });
}

function redirectTo(url: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

/**
 * Refreshes the Supabase session cookie on every matched request (per the @supabase/ssr guide)
 * and sends signed-out page visits to the login page.
 *
 * `requestHeaders` are the headers to forward to the render (the proxy's nonce and policy, ADR-028). Every
 * `NextResponse.next` is built with them, the one after a cookie refresh included, or the nonce would be lost.
 */
export async function updateSession(
  request: NextRequest,
  requestHeaders?: Headers,
): Promise<NextResponse> {
  const env = readPublicEnv();
  const forward = () =>
    NextResponse.next(requestHeaders ? { request: { headers: requestHeaders } } : { request });
  let response = forward();

  const supabase = createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookieOptions: sessionCookieOptions(request.nextUrl),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        // The forwarded headers were copied before the refresh: hand the render the refreshed cookies.
        if (requestHeaders) requestHeaders.set("cookie", request.headers.get("cookie") ?? "");
        response = forward();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims() validates the token and refreshes it when needed; do not run code between
  // creating the client and this call (Supabase SSR guide).
  const { data } = await supabase.auth.getClaims();
  const page = !isPublic(request.nextUrl.pathname);

  // A session older than 30 days ends here too, on every plan (ADR-029 decision 4). The cleared cookies
  // that signOut sets are copied to the redirect.
  if (data?.claims && page && isSessionExpired(data.claims, Date.now())) {
    await supabase.auth.signOut({ scope: "local" });
    return redirectTo(new URL(`${LOGIN_PATH}?errore=sessione`, request.nextUrl.origin), response);
  }

  if (!data?.claims && page) {
    // /login shows the staff PIN screen on an enrolled device (the device cookie), the owner form otherwise.
    const enrolled = readDeviceToken(request) !== null;
    const login = new URL(LOGIN_PATH, request.nextUrl.origin);
    if (!enrolled) {
      login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    }
    return redirectTo(login, response);
  }
  return response;
}
