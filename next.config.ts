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
    async headers() {
      return [{ source: "/:path*", headers: securityHeaders(deployment) }];
    },
  };
}
