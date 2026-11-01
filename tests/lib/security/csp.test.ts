import { describe, expect, it } from "vitest";
import { buildCsp } from "@/lib/security/csp";

const ORIGIN = "https://abc.supabase.co";
const directives = (csp: string) => csp.split(";").map((d) => d.trim());
const get = (csp: string, name: string) =>
  directives(csp).find((d) => d === name || d.startsWith(`${name} `));

describe("buildCsp", () => {
  const prod = buildCsp({ supabaseOrigin: ORIGIN, deployment: "production", dev: false });

  it("has exactly the 14 directives of ADR-028, in order, upgrade-insecure-requests last", () => {
    expect(directives(prod)).toEqual([
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
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

  it("script-src has no eval, nonce, hash or host", () => {
    const script = get(prod, "script-src")!;
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).not.toContain("'nonce-");
    expect(script).not.toContain("sha256-");
    expect(script).not.toMatch(/https?:/);
  });

  it("dev adds 'unsafe-eval' to script-src and changes nothing else", () => {
    const dev = buildCsp({ supabaseOrigin: ORIGIN, deployment: "production", dev: true });
    expect(get(dev, "script-src")).toBe("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(directives(dev).filter((d) => !d.startsWith("script-src"))).toEqual(
      directives(prod).filter((d) => !d.startsWith("script-src")),
    );
  });

  it("upgrade-insecure-requests on preview, not on development", () => {
    expect(
      directives(buildCsp({ supabaseOrigin: ORIGIN, deployment: "preview", dev: false })),
    ).toContain("upgrade-insecure-requests");
    const local = buildCsp({ supabaseOrigin: ORIGIN, deployment: "development", dev: false });
    expect(local).not.toContain("upgrade-insecure-requests");
    expect(directives(local)).toHaveLength(13);
  });

  it("reduces a local URL to its origin, in img-src and frame-src only", () => {
    const csp = buildCsp({
      supabaseOrigin: "http://127.0.0.1:54321/",
      deployment: "development",
      dev: false,
    });
    expect(get(csp, "img-src")).toBe("img-src 'self' http://127.0.0.1:54321");
    expect(get(csp, "frame-src")).toBe("frame-src http://127.0.0.1:54321");
    expect(directives(csp).filter((d) => d.includes("127.0.0.1"))).toHaveLength(2);
  });

  it("throws on a non-http(s) origin", () => {
    for (const bad of ["javascript:x", "ftp://x.test", "not a url", ""]) {
      expect(() =>
        buildCsp({ supabaseOrigin: bad, deployment: "production", dev: false }),
      ).toThrow();
    }
  });
});
