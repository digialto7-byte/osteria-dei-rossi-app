import { describe, expect, it } from "vitest";
import { securityHeaders, staticCspHeader } from "@/lib/security-headers";
import { buildCsp } from "@/lib/security/csp";

const CSP = { supabaseOrigin: "https://abc.supabase.co", dev: false };

function asMap(headers: { key: string; value: string }[]) {
  return Object.fromEntries(headers.map(({ key, value }) => [key.toLowerCase(), value]));
}

describe("securityHeaders", () => {
  it("sets nosniff, referrer policy and forbids framing", () => {
    const headers = asMap(securityHeaders("development"));
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"]).toBe("DENY");
  });

  it("sends no Content-Security-Policy: the proxy and three static rules send it (ADR-028)", () => {
    for (const deployment of ["production", "preview", "development"] as const) {
      expect(asMap(securityHeaders(deployment))["content-security-policy"]).toBeUndefined();
    }
  });

  it("sends HSTS only in production", () => {
    expect(asMap(securityHeaders("production"))["strict-transport-security"]).toBe(
      "max-age=63072000; includeSubDomains",
    );
    expect(asMap(securityHeaders("preview"))["strict-transport-security"]).toBeUndefined();
    expect(asMap(securityHeaders("development"))["strict-transport-security"]).toBeUndefined();
  });
});

describe("staticCspHeader", () => {
  it("is the nonce-less policy built by buildCsp", () => {
    for (const deployment of ["production", "preview", "development"] as const) {
      expect(staticCspHeader(deployment, CSP)).toEqual({
        key: "Content-Security-Policy",
        value: buildCsp({ ...CSP, deployment, nonce: null }),
      });
    }
  });
});
