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

const request = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));

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

  it("asks for HttpOnly, Secure, SameSite=Lax session cookies", async () => {
    await updateSession(request("/"));
    expect(cookieOptions).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax" });
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
