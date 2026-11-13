import { describe, expect, it } from "vitest";
import { buildCsp, cspForRequest } from "@/lib/security/csp";

const ORIGIN = "https://abc.supabase.co";
const N = "AAAAAAAAAAAAAAAAAAAAAA==";
const directives = (csp: string) => csp.split(";").map((d) => d.trim());
const get = (csp: string, name: string) =>
  directives(csp).find((d) => d === name || d.startsWith(`${name} `));
const page = (over: Partial<Parameters<typeof buildCsp>[0]> = {}) =>
  buildCsp({ supabaseOrigin: ORIGIN, deployment: "production", dev: false, nonce: N, ...over });

describe("buildCsp (page policy, ADR-028)", () => {
  const prod = page();

  it("has exactly the 14 directives of ADR-028, in order, upgrade-insecure-requests last", () => {
    expect(directives(prod)).toEqual([
      "default-src 'self'",
      `script-src 'self' 'nonce-${N}' 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' ${ORIGIN}`,
      `frame-src ${ORIGIN}`,
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ]);
  });

  it("script-src never has unsafe-inline, unsafe-eval, a hash or a host", () => {
    for (const csp of [prod, page({ nonce: null }), page({ deployment: "preview" })]) {
      const script = get(csp, "script-src")!;
      expect(script).not.toContain("'unsafe-inline'");
      expect(script).not.toContain("'unsafe-eval'");
      expect(script).not.toContain("sha256-");
      expect(script).not.toMatch(/https?:/);
    }
  });

  it("nonce null is the static policy: script-src is exactly 'self', the other 13 are identical", () => {
    const stat = page({ nonce: null });
    expect(get(stat, "script-src")).toBe("script-src 'self'");
    expect(directives(stat).filter((d) => !d.startsWith("script-src"))).toEqual(
      directives(prod).filter((d) => !d.startsWith("script-src")),
    );
  });

  it("dev adds 'unsafe-eval' to script-src only, in both forms", () => {
    const dev = page({ dev: true });
    expect(get(dev, "script-src")).toBe(
      `script-src 'self' 'nonce-${N}' 'strict-dynamic' 'unsafe-eval'`,
    );
    expect(directives(dev).filter((d) => !d.startsWith("script-src"))).toEqual(
      directives(prod).filter((d) => !d.startsWith("script-src")),
    );
    expect(get(page({ dev: true, nonce: null }), "script-src")).toBe(
      "script-src 'self' 'unsafe-eval'",
    );
  });

  it("upgrade-insecure-requests on preview, not on development (13 directives)", () => {
    expect(directives(page({ deployment: "preview" }))).toContain("upgrade-insecure-requests");
    const local = page({ deployment: "development" });
    expect(local).not.toContain("upgrade-insecure-requests");
    expect(directives(local)).toHaveLength(13);
  });

  it("reduces a local URL to its origin, in img-src and frame-src only", () => {
    const csp = page({ supabaseOrigin: "http://127.0.0.1:54321/", deployment: "development" });
    expect(get(csp, "img-src")).toBe("img-src 'self' http://127.0.0.1:54321");
    expect(get(csp, "frame-src")).toBe("frame-src http://127.0.0.1:54321");
    expect(directives(csp).filter((d) => d.includes("127.0.0.1"))).toHaveLength(2);
  });

  it("throws csp_invalid_origin on a non-http(s) origin", () => {
    for (const bad of ["javascript:x", "ftp://x.test", "not a url", ""]) {
      expect(() => page({ supabaseOrigin: bad })).toThrow("csp_invalid_origin");
    }
  });

  it("throws csp_invalid_nonce on a nonce that could inject into the header", () => {
    for (const bad of [
      "x' 'unsafe-inline",
      "AAAA",
      "AAAAAAAAAAAAAAAAAAAAAA",
      "AAAAAAAAAAAAAAAA",
      "",
    ]) {
      expect(() => page({ nonce: bad })).toThrow("csp_invalid_nonce");
    }
  });
});

describe("cspForRequest", () => {
  const base = {
    NEXT_PUBLIC_SUPABASE_URL: ORIGIN,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-key",
  };

  it("production: upgrade-insecure-requests, no eval", () => {
    const csp = cspForRequest(N, { ...base, VERCEL_ENV: "production", NODE_ENV: "production" });
    expect(directives(csp)).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(get(csp, "script-src")).toBe(`script-src 'self' 'nonce-${N}' 'strict-dynamic'`);
    expect(get(csp, "frame-src")).toBe(`frame-src ${ORIGIN}`);
  });

  it("NODE_ENV development adds 'unsafe-eval'", () => {
    const csp = cspForRequest(N, { ...base, NODE_ENV: "development" });
    expect(get(csp, "script-src")).toContain("'unsafe-eval'");
  });

  it("VERCEL_ENV unset: no upgrade-insecure-requests", () => {
    const csp = cspForRequest(N, { ...base, NODE_ENV: "production" });
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("VERCEL_ENV bogus throws", () => {
    expect(() => cspForRequest(N, { ...base, VERCEL_ENV: "bogus" })).toThrow();
  });
});

describe("cspForRequest per path (P2-1 T-12): data: images on the two enrolment pages only", () => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: ORIGIN,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-key",
    NODE_ENV: "production",
    VERCEL_ENV: "production",
  };
  const withData = ["/login/attiva-codice", "/doppia-verifica"];
  const without = [
    "/",
    "/login",
    "/login/codice",
    "/login/offerta-codice",
    "/oggi",
    "/doppia-verifica-x",
    "/doppia-verifica/x",
    "/login/attiva-codice-x",
  ];

  it.each(withData)("%s has img-src 'self' <supabase> data:", (path) => {
    expect(get(cspForRequest(N, env, path), "img-src")).toBe(`img-src 'self' ${ORIGIN} data:`);
  });

  it.each(without)("%s keeps img-src without data:", (path) => {
    expect(get(cspForRequest(N, env, path), "img-src")).toBe(`img-src 'self' ${ORIGIN}`);
  });

  it("no path argument is today's policy", () => {
    expect(cspForRequest(N, env)).toBe(cspForRequest(N, env, "/"));
  });

  it("every other directive is identical on the enrolment pages (snapshot)", () => {
    const base = directives(cspForRequest(N, env, "/oggi")).filter((d) => !d.startsWith("img-src"));
    for (const path of withData) {
      expect(
        directives(cspForRequest(N, env, path)).filter((d) => !d.startsWith("img-src")),
      ).toEqual(base);
    }
    expect(base).toMatchInlineSnapshot(`
      [
        "default-src 'self'",
        "script-src 'self' 'nonce-AAAAAAAAAAAAAAAAAAAAAA==' 'strict-dynamic'",
        "style-src 'self' 'unsafe-inline'",
        "frame-src https://abc.supabase.co",
        "font-src 'self'",
        "connect-src 'self'",
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
      ]
    `);
  });

  it("the /api/* static policy (nonce null) never allows data:", () => {
    expect(page({ nonce: null })).not.toContain("data:");
    expect(page()).not.toContain("data:");
  });
});
