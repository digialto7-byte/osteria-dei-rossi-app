import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let claims: Record<string, unknown> | null;
let refreshedCookie: { name: string; value: string } | null;
let cookieOptions: Record<string, unknown> | undefined;

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

beforeEach(() => {
  claims = { sub: "a0000000-0000-4000-8000-00000000000a" };
  refreshedCookie = null;
});

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

describe("staff PIN pages (M11)", () => {
  it.each(["/pin", "/dispositivo"])("%s is public", async (path) => {
    claims = null;
    expect((await updateSession(request(path))).headers.get("location")).toBeNull();
    expect((await updateSession(request(`${path}?x=1`))).headers.get("location")).toBeNull();
  });

  it("a signed-out page visit with the device cookie goes to /pin", async () => {
    claims = null;
    const response = await updateSession(request("/", DEVICE_COOKIE));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/pin");
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
