import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import config from "../../next.config";

// M20 plan §3.6.3: /sw.js is served raw, never cached by the browser, as JavaScript; every path keeps the M0 security headers.
async function rules(phase: string = PHASE_DEVELOPMENT_SERVER) {
  const resolved = config(phase);
  return (await resolved.headers!()) as {
    source: string;
    headers: { key: string; value: string }[];
  }[];
}
const value = (headers: { key: string; value: string }[], key: string) =>
  headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

describe("next.config headers", () => {
  it("/sw.js gets Cache-Control: no-cache, max-age=0 and a JavaScript content type", async () => {
    const rule = (await rules()).find((r) => r.source === "/sw.js");
    expect(rule).toBeDefined();
    expect(value(rule!.headers, "Cache-Control")).toBe("no-cache, max-age=0");
    expect(value(rule!.headers, "Content-Type")).toBe("text/javascript; charset=utf-8");
  });

  it("every path keeps the M0 security headers", async () => {
    const all = (await rules()).find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    expect(value(all!.headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(value(all!.headers, "X-Frame-Options")).toBe("DENY");
    const csp = value(all!.headers, "Content-Security-Policy")!;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
  });

  describe("CSP script-src by phase (M25 ADR-028)", () => {
    afterEach(() => vi.unstubAllEnvs());
    const cspOf = async (phase: string) =>
      value(
        (await rules(phase)).find((r) => r.source === "/:path*")!.headers,
        "Content-Security-Policy",
      )!;

    it("next dev allows 'unsafe-eval'", async () => {
      expect(await cspOf(PHASE_DEVELOPMENT_SERVER)).toContain("'unsafe-eval'");
    });

    it("a production build does not, and names the build's Supabase origin", async () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");
      const csp = await cspOf(PHASE_PRODUCTION_BUILD);
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).toContain("frame-src https://abc.supabase.co");
    });
  });

  it("no other path gets a cache-control header", async () => {
    const others = (await rules()).filter((r) => r.source !== "/sw.js");
    expect(
      others.flatMap((r) => r.headers).filter((h) => h.key.toLowerCase() === "cache-control"),
    ).toEqual([]);
  });
});
