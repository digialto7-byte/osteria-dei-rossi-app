import { describe, expect, it } from "vitest";
import { securityHeaders } from "@/lib/security-headers";

function asMap(headers: { key: string; value: string }[]) {
  return Object.fromEntries(headers.map(({ key, value }) => [key.toLowerCase(), value]));
}

describe("securityHeaders", () => {
  it("sets nosniff, referrer policy and forbids framing", () => {
    const headers = asMap(securityHeaders("development"));
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
  });

  it("sends HSTS only in production", () => {
    expect(asMap(securityHeaders("production"))["strict-transport-security"]).toMatch(
      /max-age=\d+; includeSubDomains/,
    );
    expect(asMap(securityHeaders("preview"))["strict-transport-security"]).toBeUndefined();
    expect(asMap(securityHeaders("development"))["strict-transport-security"]).toBeUndefined();
  });
});
