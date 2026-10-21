import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readPublicEnv } from "@/lib/env";

const LOGIN_PATH = "/login";
// API routes answer 401 themselves (JSON), so the proxy never redirects them.
const PUBLIC_PREFIXES = [LOGIN_PATH, "/api/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

/**
 * Refreshes the Supabase session cookie on every matched request (per the @supabase/ssr guide)
 * and sends signed-out page visits to the login page.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = readPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
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
    const login = new URL(LOGIN_PATH, request.nextUrl.origin);
    login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    const redirect = NextResponse.redirect(login);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}
