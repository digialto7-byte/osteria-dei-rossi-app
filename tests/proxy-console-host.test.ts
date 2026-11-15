import { NextRequest, NextResponse } from "next/server";
import { cspForRequest } from "@/lib/security/csp";
import { NONCE_PATTERN, nonceFromCsp } from "@/lib/security/nonce";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SP3 step 16 (plan §3.5): the proxy's host rules. updateSession is mocked: it records the headers it is given and passes on.
let seen: { headers: Headers | undefined; rewriteTo?: URL }[];
vi.mock("@/lib/supabase/proxy", () => ({
  updateSession: async (_request: NextRequest, headers?: Headers, rewriteTo?: URL) => {
    seen.push({ headers: headers ? new Headers(headers) : undefined, rewriteTo });
    return rewriteTo ? NextResponse.rewrite(rewriteTo) : NextResponse.next();
  },
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-key";
const { proxy } = await import("@/proxy");

const APP = "localhost:3000";
const CONSOLE = "127.0.0.1:3000";
// The Host header decides, not request.nextUrl.host: Next.js rewrites 127.0.0.1 to localhost inside NextURL, which would make the
// two local hosts one.
const request = (host: string, path: string) =>
  new NextRequest(new URL(path, `http://${host}`), { headers: { host } });

beforeEach(() => {
  seen = [];
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("CONSOLE_HOST", CONSOLE);
});
afterEach(() => vi.unstubAllEnvs());

describe("proxy host rules: the app host", () => {
  it("tells 127.0.0.1:3000 from localhost:3000, which nextUrl.host cannot (Next.js turns the first into the second)", async () => {
    const response = await proxy(request(CONSOLE, "/registro"));
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect((await proxy(request(APP, "/registro"))).headers.get("x-robots-tag")).toBeNull();
  });

  it("a request with no Host header is the app host", async () => {
    const bare = new NextRequest(new URL("/console/locali", "http://localhost:3000"));
    expect((await proxy(bare)).status).toBe(404);
  });

  it("a /console/locali path on the app host answers 404", async () => {
    const response = await proxy(request(APP, "/console/locali"));
    expect(response.status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it.each(["/console", "/console/", "/console/registro", "/api/platform/tenants", "/api/platform"])(
    "answers 404 for %s without touching the session",
    async (path) => {
      const response = await proxy(request(APP, path));
      expect(response.status).toBe(404);
      expect(response.headers.get("x-robots-tag")).toBeNull();
      expect(seen).toHaveLength(0);
    },
  );

  it.each(["/", "/tavoli", "/login", "/api/menu", "/api/auth/mfa/account", "/api/health"])(
    "passes %s on, with no noindex",
    async (path) => {
      const response = await proxy(request(APP, path));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-robots-tag")).toBeNull();
      expect(seen).toHaveLength(1);
    },
  );
});

describe("proxy host rules: CONSOLE_HOST unset means no console anywhere (Q-P12)", () => {
  beforeEach(() => vi.stubEnv("CONSOLE_HOST", ""));

  it.each([APP, CONSOLE])("%s: every console path is 404", async (host) => {
    for (const path of ["/console", "/console/locali", "/api/platform/tenants"]) {
      expect((await proxy(request(host, path))).status, `${host}${path}`).toBe(404);
    }
    expect(seen).toHaveLength(0);
  });

  it("the venue app is unchanged", async () => {
    expect((await proxy(request(CONSOLE, "/tavoli"))).status).toBe(200);
    expect((await proxy(request(CONSOLE, "/api/menu"))).status).toBe(200);
  });
});

describe("proxy host rules: a bad CONSOLE_HOST fails loudly", () => {
  it("throws ConfigError rather than guessing", async () => {
    vi.stubEnv("CONSOLE_HOST", "https://console.example.com");
    await expect(proxy(request(APP, "/tavoli"))).rejects.toThrow(/CONSOLE_HOST/);
  });
});

describe("proxy host rules: the console host, API", () => {
  it.each([
    "/api/platform/tenants",
    "/api/auth/mfa/account",
    "/api/auth/mfa/account/factors",
    "/api/auth/mfa/account/factors/abc/verify",
    "/api/health",
  ])("passes %s on, with noindex and no nonce", async (path) => {
    const response = await proxy(request(CONSOLE, path));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers!.get("x-nonce")).toBeNull();
  });

  it.each([
    "/api/menu",
    "/api/auth/pin",
    "/api/auth/device",
    "/api/cron/x",
    "/api/auth/mfa/challenge",
  ])("answers 404 for %s, with noindex", async (path) => {
    const response = await proxy(request(CONSOLE, path));
    expect(response.status).toBe(404);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(seen).toHaveLength(0);
  });
});

describe("proxy host rules: the console host, pages", () => {
  it("every page answer carries noindex", async () => {
    const response = await proxy(request(CONSOLE, "/registro"));
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("keeps the nonce and the policy on the request and the response", async () => {
    const response = await proxy(request(CONSOLE, "/registro"));
    const forwarded = seen[0]!.headers!;
    expect(forwarded.get("x-nonce")).toMatch(NONCE_PATTERN);
    expect(forwarded.get("content-security-policy")).toBe(
      response.headers.get("content-security-policy"),
    );
    expect(nonceFromCsp(response.headers.get("content-security-policy"))).toBe(
      forwarded.get("x-nonce"),
    );
  });

  it("the page policy is connect-src 'self' with no wss: (no Realtime in the console, §3.10)", async () => {
    const csp = (await proxy(request(CONSOLE, "/locali/abc"))).headers.get(
      "content-security-policy",
    )!;
    expect(csp).toContain("connect-src 'self';");
    expect(csp).not.toContain("wss:");
    expect(csp).not.toContain("ws:");
  });

  it("builds the policy from the visible path: data: images only on /login/attiva-codice", async () => {
    const img = async (path: string) =>
      (await proxy(request(CONSOLE, path))).headers
        .get("content-security-policy")!
        .split("; ")
        .find((d) => d.startsWith("img-src "))!;
    expect(await img("/login/attiva-codice")).toContain(" data:");
    expect(await img("/login")).not.toContain("data:");
    expect(await img("/")).not.toContain("data:");
  });
});

describe("proxy host rules: the Q-P11 rewrite on the console host", () => {
  const rewritten = async (path: string) => {
    seen = [];
    const response = await proxy(request(CONSOLE, path));
    return { response, to: seen[0]?.rewriteTo };
  };

  it.each([
    ["/", "/console"],
    ["/login", "/console/login"],
    ["/login/codice", "/console/login/codice"],
    ["/login/attiva-codice", "/console/login/attiva-codice"],
    ["/locali/abc", "/console/locali/abc"],
    ["/registro", "/console/registro"],
    ["/avvisi", "/console/avvisi"],
    ["/tavoli", "/console/tavoli"],
  ])("rewrites the visible path %s to %s", async (visible, internal) => {
    const { response, to } = await rewritten(visible);
    expect(response.status).toBe(200);
    expect(to?.pathname).toBe(internal);
    expect(to?.host).toBe("localhost:3000");
    expect(response.headers.get("x-middleware-rewrite")).toBe(to!.toString());
  });

  it("keeps the query string", async () => {
    const { to } = await rewritten("/registro?dal=2025-03-01&al=2025-03-31");
    expect(to?.pathname).toBe("/console/registro");
    expect(to?.search).toBe("?dal=2025-03-01&al=2025-03-31");
  });

  it.each(["/console", "/console/", "/console/registro", "/console/console/registro"])(
    "a typed %s is 404, with noindex, and is never rewritten",
    async (path) => {
      const { response, to } = await rewritten(path);
      expect(response.status).toBe(404);
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      expect(to).toBeUndefined();
      expect(seen).toHaveLength(0);
    },
  );

  it("a look-alike such as /consolle is a page like any other, rewritten", async () => {
    expect((await rewritten("/consolle")).to?.pathname).toBe("/console/consolle");
  });

  it("never rewrites an API path", async () => {
    for (const path of ["/api/platform/me", "/api/health", "/api/auth/mfa/account"]) {
      expect((await rewritten(path)).to, path).toBeUndefined();
    }
  });

  it("never rewrites on the app host", async () => {
    seen = [];
    await proxy(request(APP, "/registro"));
    expect(seen[0]!.rewriteTo).toBeUndefined();
  });

  it("keeps the nonce and the policy on the request and the response after the rewrite", async () => {
    const { response } = await rewritten("/registro");
    const forwarded = seen[0]!.headers!;
    expect(forwarded.get("x-nonce")).toMatch(NONCE_PATTERN);
    expect(nonceFromCsp(forwarded.get("content-security-policy"))).toBe(forwarded.get("x-nonce"));
    expect(response.headers.get("content-security-policy")).toBe(
      forwarded.get("content-security-policy"),
    );
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("builds the policy from the visible path, not the rewritten one", async () => {
    const { response } = await rewritten("/login/attiva-codice");
    const nonce = seen[0]!.headers!.get("x-nonce")!;
    expect(response.headers.get("content-security-policy")).toBe(
      cspForRequest(nonce, undefined, "/login/attiva-codice"),
    );
    expect(response.headers.get("content-security-policy")).not.toBe(
      cspForRequest(nonce, undefined, "/console/login/attiva-codice"),
    );
  });
});
