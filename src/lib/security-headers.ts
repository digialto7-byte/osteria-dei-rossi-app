import type { Deployment } from "./env";
import { buildCsp } from "./security/csp";

const TWO_YEARS_SECONDS = 63_072_000;

/** The one policy the e-invoice original carries instead of the static one: a stored supplier file is never a page (ADR-044). */
export const SANDBOX_CSP = "sandbox; default-src 'none'";

/**
 * Security headers for every response (plan §3.11.6). No CSP here: pages get theirs from the proxy (a nonce per
 * request) and the three non-page sources from `staticCspHeader`, so no response has two policies (ADR-028, M25).
 */
export function securityHeaders(deployment: Deployment): { key: string; value: string }[] {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
  ];
  if (deployment === "production") {
    headers.push({
      key: "Strict-Transport-Security",
      value: `max-age=${TWO_YEARS_SECONDS}; includeSubDomains`,
    });
  }
  return headers;
}

/** The nonce-less policy for `/api/*`, `/sw.js` and `/manifest.webmanifest`. */
export function staticCspHeader(
  deployment: Deployment,
  csp: { supabaseOrigin: string; dev: boolean },
): { key: "Content-Security-Policy"; value: string } {
  return {
    key: "Content-Security-Policy",
    value: buildCsp({ ...csp, deployment, nonce: null }),
  };
}
