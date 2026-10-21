import type { Deployment } from "@/lib/env";

const TWO_YEARS_SECONDS = 63_072_000;

/**
 * Baseline headers for every response (plan §3.11.6). The full nonce-based CSP lands with the
 * go-live hardening (M25); M0 sets the framing rule so clickjacking is closed from day one.
 */
export function securityHeaders(deployment: Deployment): { key: string; value: string }[] {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
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
