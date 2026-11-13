import { NextResponse, type NextRequest } from "next/server";
import { cspForRequest } from "@/lib/security/csp";
import { createNonce } from "@/lib/security/nonce";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Session refresh for every matched request, and the per-request CSP nonce for pages (ADR-028).
 * Next.js reads the nonce from the forwarded request policy; `x-nonce` is for our own root layout.
 * Incoming values of both are overwritten, so a forged one is never forwarded.
 * `/api/*` gets no nonce: its static policy comes from next.config.ts.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-nonce");
  requestHeaders.delete("content-security-policy");

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return updateSession(request, requestHeaders);
  }

  const nonce = createNonce();
  const csp = cspForRequest(nonce, undefined, request.nextUrl.pathname);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = await updateSession(request, requestHeaders);
  response.headers.set("content-security-policy", csp);
  return response;
}

// sw.js and the manifest are served to signed-out browsers too (M20): the proxy must not redirect them to /login.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|sw\\.js$|manifest\\.webmanifest$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
