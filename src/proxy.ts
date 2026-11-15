import { NextResponse, type NextRequest } from "next/server";
import { readConsoleHost } from "@/lib/env";
import { consolePagePath, hostKind, type HostKind, servedOnHost } from "@/lib/platform/host";
import { cspForRequest } from "@/lib/security/csp";
import { createNonce } from "@/lib/security/nonce";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Host rules first (plan §3.5): a path the host does not serve answers 404, and every answer on the console host is noindex.
 * A console-host page is rewritten to `/console/<p>` (Q-P11); its CSP is built from the visible path.
 * Then session refresh for every matched request, and the per-request CSP nonce for pages (ADR-028).
 * Next.js reads the nonce from the forwarded request policy; `x-nonce` is for our own root layout.
 * Incoming values of both are overwritten, so a forged one is never forwarded.
 * `/api/*` gets no nonce: its static policy comes from next.config.ts.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const kind = hostKind(request.headers.get("host"), readConsoleHost());
  const response = servedOnHost(kind, request.nextUrl.pathname)
    ? await render(request, kind)
    : new NextResponse(null, { status: 404 });
  if (kind === "console") response.headers.set("x-robots-tag", "noindex");
  return response;
}

async function render(request: NextRequest, kind: HostKind): Promise<NextResponse> {
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

  // On the console host the page is served from /console/<p> (Q-P11). The CSP above and the sign-in redirect use the visible path.
  const rewriteTo = request.nextUrl.clone();
  rewriteTo.pathname = consolePagePath(request.nextUrl.pathname);
  const response = await updateSession(
    request,
    requestHeaders,
    kind === "console" ? rewriteTo : undefined,
    kind,
  );
  response.headers.set("content-security-policy", csp);
  return response;
}

// sw.js and the manifest are served to signed-out browsers too (M20): the proxy must not redirect them to /login. The same goes for the
// brand images (everything in public/ is sw.js or under brand/): they are the only static files, so no image extension skips the proxy.
// next.config.ts gives the skipped paths their static CSP and tests/config/next-config-headers.test.ts checks the two are complements.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|brand/|favicon\\.ico|sw\\.js$|manifest\\.webmanifest$).*)",
  ],
};
