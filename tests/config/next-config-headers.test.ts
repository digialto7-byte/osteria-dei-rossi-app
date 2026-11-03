import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import config from "../../next.config";
import { buildCsp } from "@/lib/security/csp";

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

  it("every path keeps the M0 security headers and carries no CSP", async () => {
    const all = (await rules()).find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    expect(value(all!.headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(value(all!.headers, "X-Frame-Options")).toBe("DENY");
    expect(value(all!.headers, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(value(all!.headers, "Content-Security-Policy")).toBeUndefined();
  });

  describe("static CSP for non-pages (M25 ADR-028)", () => {
    afterEach(() => vi.unstubAllEnvs());
    const STATIC_SOURCES = ["/api/:path*", "/sw.js", "/manifest.webmanifest"];
    const cspOf = async (phase: string, source: string) => {
      const matching = (await rules(phase)).filter((r) => r.source === source);
      expect(matching).toHaveLength(1);
      const csps = matching[0]!.headers.filter(
        (h) => h.key.toLowerCase() === "content-security-policy",
      );
      expect(csps).toHaveLength(1);
      return csps[0]!.value;
    };
    const scriptSrc = (csp: string) =>
      csp
        .split(";")
        .map((d) => d.trim())
        .find((d) => d.startsWith("script-src "))!;

    it("/api/*, /sw.js and the manifest each carry exactly one CSP, equal to the static policy", async () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      for (const source of STATIC_SOURCES) {
        expect(await cspOf(PHASE_DEVELOPMENT_SERVER, source)).toBe(
          buildCsp({
            supabaseOrigin: "http://127.0.0.1:54321",
            deployment: "development",
            dev: true,
            nonce: null,
          }),
        );
      }
    });

    it("a production build: script-src is exactly 'self' and Supabase's origin is named", async () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");
      for (const source of STATIC_SOURCES) {
        const csp = await cspOf(PHASE_PRODUCTION_BUILD, source);
        expect(scriptSrc(csp)).toBe("script-src 'self'");
        expect(csp).toContain("frame-src https://abc.supabase.co");
      }
    });

    it("next dev: script-src is 'self' 'unsafe-eval'", async () => {
      for (const source of STATIC_SOURCES) {
        expect(scriptSrc(await cspOf(PHASE_DEVELOPMENT_SERVER, source))).toBe(
          "script-src 'self' 'unsafe-eval'",
        );
      }
    });

    it("no rule's script-src has 'unsafe-inline'", async () => {
      for (const rule of await rules()) {
        const csp = value(rule.headers, "Content-Security-Policy");
        if (csp) expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
      }
    });
  });

  it("no other path gets a cache-control header", async () => {
    const others = (await rules()).filter((r) => r.source !== "/sw.js");
    expect(
      others.flatMap((r) => r.headers).filter((h) => h.key.toLowerCase() === "cache-control"),
    ).toEqual([]);
  });
});
