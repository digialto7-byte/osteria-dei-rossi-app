import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
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

/**
 * Refreshes the Supabase session cookie on every matched request (per the @supabase/ssr guide)
 * and sends signed-out page visits to the login page.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = readPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookieOptions: sessionCookieOptions(request.nextUrl),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims() validates the token and refreshes it when needed; do not run code between
  // creating the client and this call (Supabase SSR guide).
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims && !isPublic(request.nextUrl.pathname)) {
    // An enrolled device goes to the PIN screen; anything else to the email login.
    const enrolled = readDeviceToken(request) !== null;
    const login = new URL(enrolled ? PIN_PATH : LOGIN_PATH, request.nextUrl.origin);
    if (!enrolled) {
      login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    }
    const redirect = NextResponse.redirect(login);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}
