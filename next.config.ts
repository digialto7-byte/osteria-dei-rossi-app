import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { readServerEnv } from "./src/lib/env";
import { securityHeaders } from "./src/lib/security-headers";

export default function config(phase: string): NextConfig {
  // Next.js inlines NEXT_PUBLIC_* at build time, so a build without them fails here, naming the
  // missing variable, instead of shipping an app that cannot reach Supabase.
  const env = phase === PHASE_PRODUCTION_BUILD ? readServerEnv() : undefined;
  const deployment = env?.deployment ?? "development";

  return {
    poweredByHeader: false,
    // The service worker's version (M20): a new deploy gives a new script URL, so a new install. "dev" locally.
    env: { NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
    async headers() {
      return [
        { source: "/:path*", headers: securityHeaders(deployment) },
        // The service worker is served raw and re-checked on every load (M20): the browser must never keep an old copy.
        {
          source: "/sw.js",
          headers: [
            { key: "Cache-Control", value: "no-cache, max-age=0" },
            { key: "Content-Type", value: "text/javascript; charset=utf-8" },
          ],
        },
      ];
    },
  };
}
