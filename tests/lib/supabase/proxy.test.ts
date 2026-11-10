import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let claims: Record<string, unknown> | null;
let refreshedCookie: { name: string; value: string } | null;
let cookieOptions: Record<string, unknown> | undefined;
const signOut = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookieOptions?: Record<string, unknown>;
      cookies: { setAll: (c: { name: string; value: string; options: object }[]) => void };
    },
  ) => {
    cookieOptions = options.cookieOptions;
    return {
      auth: {
        signOut: async (args: unknown) => {
          signOut(args);
          options.cookies.setAll([
            { name: "sb-127-auth-token", value: "", options: { maxAge: 0 } },
          ]);
          return { error: null };
        },
        getClaims: async () => {
          if (refreshedCookie)
            options.cookies.setAll([{ ...refreshedCookie, options: { path: "/" } }]);
          return claims ? { data: { claims }, error: null } : { data: null, error: null };
        },
      },
    };
  },
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fake";
const { updateSession } = await import("@/lib/supabase/proxy");
const { config } = await import("@/proxy");

const request = (path: string, cookie?: string, origin = "http://localhost:3000") =>
  new NextRequest(new URL(path, origin), {
    headers: cookie ? { cookie } : undefined,
  });
const DEVICE_COOKIE = `__Host-odr_device=${"A".repeat(43)}`;

// M25a: a session carries its sign-in time in `amr`; the proxy ends it 30 days later. Existing tests keep
// a fresh password sign-in so they stay about what they were written for.
const NOW = Date.parse("2026-11-20T10:00:00Z");
const DAY = 86_400;
const signedInDaysAgo = (days: number) => ({
  sub: "a0000000-0000-4000-8000-00000000000a",
  amr: [{ method: "password", timestamp: NOW / 1000 - days * DAY }],
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  claims = signedInDaysAgo(1);
  refreshedCookie = null;
  signOut.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("updateSession (proxy)", () => {
  it("lets a signed-in user through", async () => {
    const response = await updateSession(request("/"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects a signed-out page request to /login, keeping where they were going", async () => {
    claims = null;
    const response = await updateSession(request("/fatture?stato=review"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Ffatture%3Fstato%3Dreview",
    );
  });

  it.each(["/login", "/api/me", "/api/health"])(
    "lets %s through without a session",
    async (path) => {
      claims = null;
      const response = await updateSession(request(path));
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it("asks for HttpOnly, Secure, SameSite=Lax session cookies over https", async () => {
    await updateSession(request("/", undefined, "https://osteria.example.test"));
    expect(cookieOptions).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
  });

  it("drops only Secure on plain-http loopback (WebKit rejects Secure cookies there)", async () => {
    await updateSession(request("/"));
    expect(cookieOptions).toMatchObject({ httpOnly: true, secure: false, sameSite: "lax" });
  });

  it("keeps Secure on plain http to a non-loopback host", async () => {
    await updateSession(request("/", undefined, "http://localhost.evil.test"));
    expect(cookieOptions).toMatchObject({ secure: true });
  });

  it("copies refreshed session cookies onto the response", async () => {
    refreshedCookie = { name: "sb-127-auth-token", value: "refreshed" };
    const response = await updateSession(request("/"));
    expect(response.cookies.get("sb-127-auth-token")?.value).toBe("refreshed");
  });

  it("copies refreshed cookies onto a redirect too", async () => {
    claims = null;
    refreshedCookie = { name: "sb-127-auth-token", value: "" };
    const response = await updateSession(request("/"));
    expect(response.cookies.get("sb-127-auth-token")).toBeDefined();
  });
});

describe("updateSession forwards the nonce headers (ADR-028, M25)", () => {
  const forwarded = () => {
    const h = new Headers({ "x-nonce": "AAAAAAAAAAAAAAAAAAAAAA==", "x-other": "1" });
    h.set("content-security-policy", "script-src 'self' 'nonce-AAAAAAAAAAAAAAAAAAAAAA=='");
    return h;
  };

  it("builds every NextResponse.next with the forwarded headers, the one after a cookie refresh included", async () => {
    refreshedCookie = { name: "sb-127-auth-token", value: "refreshed" };
    const next = vi.spyOn(NextResponse, "next");
    const headers = forwarded();
    await updateSession(request("/"), headers);
    expect(next.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [init] of next.mock.calls) {
      const sent = init?.request?.headers as Headers;
      expect(sent.get("x-nonce")).toBe("AAAAAAAAAAAAAAAAAAAAAA==");
      expect(sent.get("content-security-policy")).toBe(headers.get("content-security-policy"));
    }
    next.mockRestore();
  });

  it("the refreshed session cookie is in the forwarded cookie header, so the render sees it", async () => {
    refreshedCookie = { name: "sb-127-auth-token", value: "refreshed" };
    const headers = forwarded();
    await updateSession(request("/", "a=1"), headers);
    expect(headers.get("cookie")).toContain("sb-127-auth-token=refreshed");
  });

  it("redirects and expiry behave as without headers", async () => {
    claims = null;
    const response = await updateSession(request("/fatture"), forwarded());
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?next=%2Ffatture");
  });
});

describe("staff PIN pages (M11)", () => {
  it.each(["/pin", "/dispositivo"])("%s is public", async (path) => {
    claims = null;
    expect((await updateSession(request(path))).headers.get("location")).toBeNull();
    expect((await updateSession(request(`${path}?x=1`))).headers.get("location")).toBeNull();
  });

  it("a signed-out page visit with the device cookie goes to /login, without next (M25a)", async () => {
    claims = null;
    const response = await updateSession(request("/", DEVICE_COOKIE));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("without the device cookie it still goes to /login with next", async () => {
    claims = null;
    const response = await updateSession(request("/fatture", "a=1"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?next=%2Ffatture");
  });

  it("a malformed device cookie does not count", async () => {
    claims = null;
    const response = await updateSession(request("/", "__Host-odr_device=x"));
    expect(response.headers.get("location")).toContain("/login");
  });

  it("a signed-in visitor is not redirected, cookie or not", async () => {
    expect((await updateSession(request("/", DEVICE_COOKIE))).headers.get("location")).toBeNull();
  });

  it("only the exact pages are public, not look-alike paths", async () => {
    claims = null;
    for (const path of ["/pinot", "/dispositivo-x", "/loginx"]) {
      expect((await updateSession(request(path))).headers.get("location"), path).not.toBeNull();
    }
  });
});

describe("public booking pages (reservations B11)", () => {
  it("lets a signed-out visitor reach /prenota/<slug> and its cancel page, with a query", async () => {
    claims = null;
    for (const path of [
      "/prenota/osteria-demo-a",
      "/prenota/osteria-demo-a?lang=en",
      "/prenota/osteria-demo-a/annulla?t=c1.x",
    ]) {
      expect((await updateSession(request(path))).headers.get("location"), path).toBeNull();
    }
  });

  it("keeps the staff page /prenotazioni protected: the prefix ends at the slash", async () => {
    claims = null;
    for (const path of [
      "/prenotazioni",
      "/prenotazioni?data=2026-11-20",
      "/prenotazioni/x",
      "/prenotaxyz",
    ]) {
      const response = await updateSession(request(path));
      expect(new URL(response.headers.get("location") ?? "http://x/").pathname, path).toBe(
        "/login",
      );
    }
  });
});

describe("30-day session cap (M25a)", () => {
  it("an expired session on a page is signed out and sent to /login?errore=sessione, with the cleared cookies", async () => {
    claims = signedInDaysAgo(31);
    const response = await updateSession(request("/fatture"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?errore=sessione");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.cookies.get("sb-127-auth-token")?.value).toBe("");
  });

  it("an expired session on /login is not redirected", async () => {
    claims = signedInDaysAgo(31);
    expect((await updateSession(request("/login"))).headers.get("location")).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("an expired session on an API route is left to withApi", async () => {
    claims = signedInDaysAgo(31);
    expect((await updateSession(request("/api/me"))).headers.get("location")).toBeNull();
  });

  it("a session without amr counts as expired", async () => {
    claims = { sub: "a0000000-0000-4000-8000-00000000000a" };
    const response = await updateSession(request("/"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?errore=sessione");
  });

  it("a valid 29-day session passes", async () => {
    claims = signedInDaysAgo(29);
    const response = await updateSession(request("/fatture"));
    expect(response.headers.get("location")).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("proxy matcher", () => {
  it("skips static assets", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test("/_next/static/chunks/main.js")).toBe(false);
    expect(matcher.test("/_next/image")).toBe(false);
    expect(matcher.test("/favicon.ico")).toBe(false);
    expect(matcher.test("/fatture")).toBe(true);
    expect(matcher.test("/api/me")).toBe(true);
  });
});
