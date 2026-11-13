import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NONCE_PATTERN, nonceFromCsp } from "@/lib/security/nonce";
import { cspForRequest } from "@/lib/security/csp";

// The proxy sets the per-request nonce (ADR-028). updateSession is mocked: it records the headers it is given
// and answers with a pass-through or a 307 to /login.
let seen: { headers: Headers | undefined }[];
let redirect: boolean;
vi.mock("@/lib/supabase/proxy", () => ({
  updateSession: async (request: NextRequest, headers?: Headers) => {
    seen.push({ headers: headers ? new Headers(headers) : undefined });
    return redirect
      ? NextResponse.redirect(new URL("/login", request.nextUrl.origin))
      : NextResponse.next();
  },
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-key";
const { proxy } = await import("@/proxy");

const request = (path: string, headers?: Record<string, string>) =>
  new NextRequest(new URL(path, "http://localhost:3000"), { headers });

beforeEach(() => {
  seen = [];
  redirect = false;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
});
afterEach(() => vi.unstubAllEnvs());

describe("proxy nonce (pages)", () => {
  it("forwards x-nonce and the page policy, and sets the same policy on the response", async () => {
    const response = await proxy(request("/tavoli"));
    expect(seen).toHaveLength(1);
    const forwarded = seen[0]!.headers!;
    const nonce = forwarded.get("x-nonce")!;
    expect(nonce).toMatch(NONCE_PATTERN);
    expect(forwarded.get("content-security-policy")).toBe(cspForRequest(nonce));
    expect(response.headers.get("content-security-policy")).toBe(cspForRequest(nonce));
    expect(nonceFromCsp(response.headers.get("content-security-policy"))).toBe(nonce);
  });

  it("gives the two enrolment pages data: images, from the request path (P2-1 T-12)", async () => {
    for (const path of ["/login/attiva-codice", "/doppia-verifica"]) {
      seen = [];
      const response = await proxy(request(path));
      const nonce = seen[0]!.headers!.get("x-nonce")!;
      expect(response.headers.get("content-security-policy")).toBe(
        cspForRequest(nonce, undefined, path),
      );
      expect(response.headers.get("content-security-policy")).toContain(" data:");
    }
    const other = await proxy(request("/login/codice"));
    expect(other.headers.get("content-security-policy")).not.toContain("data:");
  });

  it("makes a different nonce for every request", async () => {
    await proxy(request("/tavoli"));
    await proxy(request("/tavoli"));
    expect(seen[0]!.headers!.get("x-nonce")).not.toBe(seen[1]!.headers!.get("x-nonce"));
  });

  it("overwrites a forged incoming x-nonce and content-security-policy", async () => {
    const response = await proxy(
      request("/tavoli", {
        "x-nonce": "evil",
        "content-security-policy": "script-src 'unsafe-inline'",
      }),
    );
    const forwarded = seen[0]!.headers!;
    expect(forwarded.get("x-nonce")).toMatch(NONCE_PATTERN);
    expect(forwarded.get("content-security-policy")).not.toContain("script-src 'unsafe-inline'");
    expect(forwarded.get("content-security-policy")).toBe(cspForRequest(forwarded.get("x-nonce")!));
    expect(response.headers.get("content-security-policy")).toBe(
      cspForRequest(forwarded.get("x-nonce")!),
    );
  });

  it("keeps the other incoming headers", async () => {
    await proxy(request("/tavoli", { "x-keep": "1" }));
    expect(seen[0]!.headers!.get("x-keep")).toBe("1");
  });

  it("a redirect to /login carries the policy with its nonce", async () => {
    redirect = true;
    const response = await proxy(request("/tavoli"));
    expect(response.status).toBe(307);
    const nonce = seen[0]!.headers!.get("x-nonce")!;
    expect(response.headers.get("content-security-policy")).toBe(cspForRequest(nonce));
  });

  it("'unsafe-eval' only under next dev", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const dev = await proxy(request("/tavoli"));
    expect(dev.headers.get("content-security-policy")).toContain("'unsafe-eval'");
    vi.stubEnv("NODE_ENV", "production");
    const prod = await proxy(request("/tavoli"));
    expect(prod.headers.get("content-security-policy")).not.toContain("'unsafe-eval'");
  });
});

describe("proxy on /api/*", () => {
  it("forwards no nonce (a forged one is removed) and sets no CSP on the response", async () => {
    const response = await proxy(
      request("/api/me", { "x-nonce": "evil", "content-security-policy": "script-src *" }),
    );
    expect(seen).toHaveLength(1);
    const forwarded = seen[0]!.headers!;
    expect(forwarded.get("x-nonce")).toBeNull();
    expect(forwarded.get("content-security-policy")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeNull();
  });
});
