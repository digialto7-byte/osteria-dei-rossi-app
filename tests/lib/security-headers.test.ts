import { describe, expect, it } from "vitest";
import { securityHeaders } from "@/lib/security-headers";
import { buildCsp } from "@/lib/security/csp";

const CSP = { supabaseOrigin: "https://abc.supabase.co", dev: false };

function asMap(headers: { key: string; value: string }[]) {
  return Object.fromEntries(headers.map(({ key, value }) => [key.toLowerCase(), value]));
}

describe("securityHeaders", () => {
  it("sets nosniff, referrer policy and forbids framing", () => {
    const headers = asMap(securityHeaders("development", CSP));
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
  });

  it("sends the full static CSP built by buildCsp", () => {
    for (const deployment of ["production", "preview", "development"] as const) {
      expect(asMap(securityHeaders(deployment, CSP))["content-security-policy"]).toBe(
        buildCsp({ ...CSP, deployment }),
      );
    }
  });

  it("sends HSTS only in production", () => {
    expect(asMap(securityHeaders("production", CSP))["strict-transport-security"]).toBe(
      "max-age=63072000; includeSubDomains",
    );
    expect(asMap(securityHeaders("preview", CSP))["strict-transport-security"]).toBeUndefined();
    expect(asMap(securityHeaders("development", CSP))["strict-transport-security"]).toBeUndefined();
  });
});
