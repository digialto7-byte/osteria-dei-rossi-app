import type { Deployment } from "../env";

export type CspInput = { supabaseOrigin: string; deployment: Deployment; dev: boolean };

/** The origin of an http(s) URL; anything else throws, so a bad build setting never reaches a header. */
function originOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("csp_invalid_origin");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new Error("csp_invalid_origin");
  return parsed.origin;
}

/**
 * The one static Content-Security-Policy (ADR-028): no nonce, so pages stay pre-rendered.
 * script-src keeps 'unsafe-inline' because Next.js's per-page inline scripts cannot be hashed in a build-time header;
 * 'unsafe-eval' only under `next dev`. The browser calls only /api/*, so connect-src is 'self'.
 */
export function buildCsp({ supabaseOrigin, deployment, dev }: CspInput): string {
  const supabase = originOf(supabaseOrigin);
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' ${supabase}`,
    `frame-src ${supabase}`,
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  // On http://localhost it would rewrite the local Storage URLs to https.
  if (deployment === "production" || deployment === "preview")
    directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
