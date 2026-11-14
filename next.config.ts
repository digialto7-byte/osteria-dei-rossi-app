import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { readServerEnv } from "./src/lib/env";
import { SANDBOX_CSP, securityHeaders, staticCspHeader } from "./src/lib/security-headers";

// Requests that `src/proxy.ts` skips (its matcher) never get the proxy's nonce policy, so they get the static one from here
// (ADR-028 decision 3). Keep IMAGE_EXTENSIONS equal to the extension list in the matcher; tests/config/next-config-headers.test.ts
// fails when they differ. Each source below is the exact complement of the others (no path gets two policies):
// the prefixes are `_next/static`, `_next/image` and `favicon.ico` (a prefix match, as in the matcher), the images are any
// other path ending in an extension, and `api/` is left to its own rule.
const IMAGE_EXTENSIONS = "svg|png|jpg|jpeg|gif|webp|ico";
const SKIPPED_PREFIXES = "_next/static|_next/image|favicon\\.ico";
const SKIPPED_PREFIX_SOURCE = `/:path((?:${SKIPPED_PREFIXES}).*)`;
const SKIPPED_IMAGE_SOURCE = `/:path((?!api/|${SKIPPED_PREFIXES}).*\\.(?:${IMAGE_EXTENSIONS}))`;

export default function config(phase: string): NextConfig {
  // Next.js inlines NEXT_PUBLIC_* at build time, so a build without them fails here, naming the
  // missing variable, instead of shipping an app that cannot reach Supabase.
  const env = phase === PHASE_PRODUCTION_BUILD ? readServerEnv() : undefined;
  const deployment = env?.deployment ?? "development";
  // A production build has the variable (readServerEnv above); other phases fall back to the local stack.
  const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
  const staticCsp = staticCspHeader(deployment, {
    supabaseOrigin,
    dev: phase === PHASE_DEVELOPMENT_SERVER,
  });

  const originalCsp = { key: staticCsp.key, value: SANDBOX_CSP };

  return {
    poweredByHeader: false,
    // The service worker's version (M20): a new deploy gives a new script URL, so a new install. "dev" locally.
    env: { NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
    async headers() {
      return [
        // No CSP on this rule: pages get theirs from the proxy (nonce per request), the rules below a static one (ADR-028).
        { source: "/:path*", headers: securityHeaders(deployment) },
        { source: "/api/:path*", headers: [staticCsp] },
        // The e-invoice original is a stored supplier file served as an attachment: its policy is the sandbox one, and only that.
        // It must be set here, after the rule above: Next applies the rules in order (a later one replaces the same key) and keeps
        // this value over the handler's own header, so a CSP set only in the route would lose to the static one (ADR-028, ADR-044).
        { source: "/api/invoices/:id/original", headers: [originalCsp] },
        { source: "/manifest.webmanifest", headers: [staticCsp] },
        // Paths the proxy skips (its matcher): a missing /foo.png is a 404 that must still carry a policy.
        { source: SKIPPED_PREFIX_SOURCE, headers: [staticCsp] },
        { source: SKIPPED_IMAGE_SOURCE, headers: [staticCsp] },
        // The service worker is served raw and re-checked on every load (M20): the browser must never keep an old copy.
        {
          source: "/sw.js",
          headers: [
            { key: "Cache-Control", value: "no-cache, max-age=0" },
            { key: "Content-Type", value: "text/javascript; charset=utf-8" },
            staticCsp,
          ],
        },
      ];
    },
  };
}
