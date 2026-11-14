import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { NodeNextRequest, NodeNextResponse } from "next/dist/server/base-http/node";
import { sendResponse } from "next/dist/server/send-response";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import config from "../../next.config";
import { config as proxyConfig } from "@/proxy";
import { buildCsp } from "@/lib/security/csp";

// Next compiles the proxy matcher with this function; it is exported at runtime but not in Next's type declarations.
const { getMiddlewareMatchers } = createRequire(import.meta.url)(
  "next/dist/build/analysis/get-page-static-info",
) as { getMiddlewareMatchers: (matcher: string, config: object) => { regexp: string }[] };

// M20 plan §3.6.3: /sw.js is served raw, never cached by the browser, as JavaScript; every path keeps the M0 security headers.
async function rules(phase: string = PHASE_DEVELOPMENT_SERVER) {
  const resolved = config(phase);
  return (await resolved.headers!()) as {
    source: string;
    headers: { key: string; value: string }[];
  }[];
}
const ORIGINAL_PATH = "/api/invoices/1b000000-0000-4000-8000-0000000000b1/original";
const SANDBOX_CSP = "sandbox; default-src 'none'";
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
        // The original's sandbox policy has no script-src: default-src 'none' blocks scripts.
        if (csp && csp !== SANDBOX_CSP) expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
      }
    });
  });

  // ADR-028 decision 3: a request the proxy skips gets the static policy from next.config.ts, so a not-found under a
  // skipped path (GET /missing.png) is a 404 with a policy instead of a response with none.
  describe("static CSP for paths the proxy skips (M25 ADR-028)", () => {
    const MATCHER = proxyConfig.matcher[0]!;
    // Next's own compiled form of the matcher (what the proxy really skips), not a hand-built RegExp: a hand-built one hid
    // an unescaped "." in favicon.ico (/faviconXico skipped the proxy and got no policy).
    const proxyMatcher = new RegExp(getMiddlewareMatchers(MATCHER, {})[0]!.regexp);
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
        "/faviconXico",
        "/favicon-ico",
        "/favicon_ico/anything",
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

  // ADR-028 / ADR-044: Next applies the matching rules in order, a later rule setting the same key replaces the earlier value
  // (resolve-routes.js: `resHeaders[key] = value`), and keeps the first value of a header against the handler's own
  // (send-response.js). So the original's sandbox CSP must come from a later rule, and the handler's copy never wins by itself.
  describe("the e-invoice original's sandbox CSP", () => {
    // Next's own application of the rules: in order, exact key as written (case-sensitive), a later value replaces.
    const resHeadersFor = async (path: string) => {
      const out: Record<string, string> = {};
      for (const rule of await rules()) {
        if (getPathMatch(rule.source)(path) === false) continue;
        for (const h of rule.headers) out[h.key] = h.value;
      }
      return out;
    };
    const cspsOf = (headers: Record<string, string>) =>
      Object.entries(headers)
        .filter(([k]) => k.toLowerCase() === "content-security-policy")
        .map(([, v]) => v);
    const staticPolicy = async () =>
      value(
        (await rules()).find((r) => r.source === "/api/:path*")!.headers,
        "Content-Security-Policy",
      );

    it("gets exactly one CSP, the sandbox one", async () => {
      expect(cspsOf(await resHeadersFor(ORIGINAL_PATH))).toEqual([SANDBOX_CSP]);
    });

    // Every route file under src/app/api, as the URL it serves: [param] -> a sample value, (group) folders dropped.
    const routePaths = (
      dir: string = join(process.cwd(), "src/app/api"),
      base = "/api",
    ): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isFile()) return entry.name === "route.ts" ? [base] : [];
        if (!entry.isDirectory()) return [];
        const segment = /^\(.*\)$/.test(entry.name)
          ? ""
          : "/" + entry.name.replace(/^\[{1,2}(?:\.{3})?([^\]]+)\]{1,2}$/, "sample-$1"); // [id], [...all], [[...all]]
        return routePaths(join(dir, entry.name), base + segment);
      });

    it("every other /api route, a look-alike or a sample page still gets exactly the static policy (pages none: the proxy's)", async () => {
      const staticCsp = await staticPolicy();
      expect(staticCsp).toBeDefined();
      const routes = routePaths();
      expect(routes.length).toBeGreaterThan(50);
      const originalRoute = "/api/invoices/sample-id/original";
      expect(routes).toContain(originalRoute);
      for (const path of routes.filter((r) => r !== originalRoute)) {
        expect(cspsOf(await resHeadersFor(path)), path).toEqual([staticCsp]);
      }
      expect(cspsOf(await resHeadersFor(originalRoute))).toEqual([SANDBOX_CSP]);
      for (const path of [
        "/api",
        "/api/invoices/x/original/extra",
        "/api/x/invoices/x/original",
        "/api/invoices/x/originals",
      ]) {
        expect(cspsOf(await resHeadersFor(path)), path).toEqual([staticCsp]);
      }
      expect(cspsOf(await resHeadersFor("/tavoli"))).toEqual([]);
    });

    it("no path gets two CSP headers", async () => {
      for (const path of [
        ORIGINAL_PATH,
        "/api/health",
        "/",
        "/sw.js",
        "/manifest.webmanifest",
        "/x.png",
      ]) {
        expect(cspsOf(await resHeadersFor(path)).length, path).toBeLessThanOrEqual(1);
      }
    });

    it("the original keeps the security headers, X-Content-Type-Options once", async () => {
      const headers = await resHeadersFor(ORIGINAL_PATH);
      expect(
        Object.keys(headers).filter((k) => k.toLowerCase() === "x-content-type-options"),
      ).toEqual(["X-Content-Type-Options"]);
      expect(headers["X-Frame-Options"]).toBe("DENY");
    });

    // The real pipeline: the rules' headers go on the response first, then Next's own sendResponse copies the handler's headers.
    it("through Next's own sendResponse the browser sees the sandbox CSP once", async () => {
      const server = createServer(async (req, res) => {
        for (const [k, v] of Object.entries(await resHeadersFor(req.url!))) res.setHeader(k, v);
        const handler = new Response("x", {
          headers: {
            "content-type": "application/octet-stream",
            "content-security-policy": SANDBOX_CSP,
            "x-content-type-options": "nosniff",
          },
        });
        await sendResponse(new NodeNextRequest(req), new NodeNextResponse(res), handler);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const original = await fetch(base + ORIGINAL_PATH);
        expect(original.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
        expect(original.headers.get("x-content-type-options")).toBe("nosniff");
        // Control: another API path keeps the static policy, whatever the handler sets.
        const other = await fetch(base + "/api/health");
        expect(other.headers.get("content-security-policy")).toBe(await staticPolicy());
      } finally {
        server.close();
      }
    });
  });
});
