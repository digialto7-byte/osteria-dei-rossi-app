import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import config from "../../next.config";
import { config as proxyConfig } from "@/proxy";
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

  // ADR-028 decision 3: a request the proxy skips gets the static policy from next.config.ts, so a not-found under a
  // skipped path (GET /missing.png) is a 404 with a policy instead of a response with none.
  describe("static CSP for paths the proxy skips (M25 ADR-028)", () => {
    const MATCHER = proxyConfig.matcher[0]!;
    const proxyMatcher = new RegExp(`^${MATCHER}$`);
    const cspRulesFor = async (path: string) =>
      (await rules()).filter(
        (r) =>
          getPathMatch(r.source)(path) !== false &&
          r.headers.some((h) => h.key.toLowerCase() === "content-security-policy"),
      );
    const cspCount = async (path: string) =>
      (await cspRulesFor(path)).reduce(
        (n, r) =>
          n + r.headers.filter((h) => h.key.toLowerCase() === "content-security-policy").length,
        0,
      );

    it.each([
      "/missing.png",
      "/nope/missing.svg",
      "/a/b/c.svg",
      "/x.jpeg",
      "/x.gif",
      "/x.webp",
      "/x.ico",
      "/favicon.ico",
      "/favicon.icox",
      "/_next/static/x.js",
      "/_next/static/media/font.png",
      "/_next/static",
      "/_next/image",
      "/_next/imagefoo.png",
      "/api/x.png",
      "/api/health",
      "/sw.js",
      "/manifest.webmanifest",
    ])("%s gets exactly one CSP", async (path) => {
      expect(await cspCount(path)).toBe(1);
    });

    it.each(["/", "/login", "/tavoli", "/tavoli/comanda", "/pin", "/fatture", "/sw.json", "/png"])(
      "%s (the proxy sets its CSP) gets none from next.config",
      async (path) => {
        expect(proxyMatcher.test(path)).toBe(true);
        expect(await cspCount(path)).toBe(0);
      },
    );

    it("the one CSP of a skipped path is the static policy, with no nonce and no 'unsafe-inline' in script-src", async () => {
      const [rule] = await cspRulesFor("/missing.png");
      const csp = value(rule!.headers, "Content-Security-Policy")!;
      const [apiRule] = await cspRulesFor("/api/health");
      expect(csp).toBe(value(apiRule!.headers, "Content-Security-Policy"));
      expect(csp).not.toContain("'nonce-");
      const script = csp
        .split(";")
        .map((d) => d.trim())
        .find((d) => d.startsWith("script-src "))!;
      expect(script).not.toContain("'unsafe-inline'");
    });

    it("never two CSP headers, and exactly the complement of the proxy: every path is covered the same way as the matcher says", async () => {
      const paths = [
        "/",
        "/login",
        "/tavoli",
        "/api/health",
        "/api/sync",
        "/api/x.png",
        "/missing.png",
        "/nope/missing.svg",
        "/a/b/c.ico",
        "/favicon.ico",
        "/favicon.icoX",
        "/_next/static/chunks/a.js",
        "/_next/static/media/a.webp",
        "/_next/image",
        "/_next/image/x",
        "/sw.js",
        "/manifest.webmanifest",
        "/sw.json",
        "/sw.js/extra",
        "/manifest.webmanifest.bak",
        "/x.png/y",
        "/x.pngg",
      ];
      for (const path of paths) {
        const count = await cspCount(path);
        expect(count, path).toBeLessThanOrEqual(1);
        // Skipped by the proxy => next.config must give it a policy. Matched => only /api/* (the proxy adds no nonce there).
        const expected = !proxyMatcher.test(path) || path.startsWith("/api/") ? 1 : 0;
        expect(count, path).toBe(expected);
      }
    });

    it("the image extensions in next.config are the ones in the proxy matcher", async () => {
      const fromMatcher = /\\\.\(\?:([a-z|]+)\)\$/.exec(MATCHER)?.[1];
      expect(fromMatcher).toBeDefined();
      const rule = (await rules()).find((r) => r.source.includes("\\.(?:"))!;
      expect(rule).toBeDefined();
      const fromConfig = /\\\.\(\?:([a-z|]+)\)\)/.exec(rule.source)?.[1];
      expect(fromConfig).toBe(fromMatcher);
    });
  });

  it("no other path gets a cache-control header", async () => {
    const others = (await rules()).filter((r) => r.source !== "/sw.js");
    expect(
      others.flatMap((r) => r.headers).filter((h) => h.key.toLowerCase() === "cache-control"),
    ).toEqual([]);
  });
});
