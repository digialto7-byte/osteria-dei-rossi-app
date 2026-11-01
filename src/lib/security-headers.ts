import type { Deployment } from "./env";
import { buildCsp } from "./security/csp";

const TWO_YEARS_SECONDS = 63_072_000;

/**
 * Security headers for every response (plan §3.11.6). The CSP is the static policy of ADR-028 (M25).
 */
export function securityHeaders(
  deployment: Deployment,
  csp: { supabaseOrigin: string; dev: boolean },
): { key: string; value: string }[] {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Content-Security-Policy", value: buildCsp({ ...csp, deployment }) },
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
