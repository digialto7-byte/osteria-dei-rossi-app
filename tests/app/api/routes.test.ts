import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeSupabase,
  jsonRequest,
  OWNER_CLAIMS,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const health = await import("@/app/api/health/route");
const me = await import("@/app/api/me/route");
const magicLink = await import("@/app/api/auth/magic-link/route");
const callback = await import("@/app/api/auth/callback/route");
const logout = await import("@/app/api/auth/logout/route");

const BASE = "http://localhost:3000";
const ME_ROW = {
  id: "a1000000-0000-4000-8000-00000000000a",
  display_name: "Titolare Demo",
  role: "owner",
  tenant: { id: OWNER_CLAIMS.tenant_id, name: "Osteria Demo", is_demo: false },
};

beforeEach(() => {
  client = fakeSupabase({ claims: OWNER_CLAIMS, meRow: ME_ROW });
});

describe("GET /api/health", () => {
  it("returns ok and no data", async () => {
    client = fakeSupabase({ claims: null });
    const response = await health.GET(new Request(`${BASE}/api/health`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe("GET /api/me", () => {
  it("returns the signed-in user, role and tenant", async () => {
    const response = await me.GET(new Request(`${BASE}/api/me`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: ME_ROW.id, displayName: "Titolare Demo", role: "owner" },
      tenant: { id: OWNER_CLAIMS.tenant_id, name: "Osteria Demo", isDemo: false },
    });
    expect(client.query.eq).toHaveBeenCalledWith("auth_id", OWNER_CLAIMS.sub);
  });

  it("reports isDemo true for a demo tenant, and reads the flag with the tenant", async () => {
    client = fakeSupabase({
      claims: OWNER_CLAIMS,
      meRow: { ...ME_ROW, tenant: { ...ME_ROW.tenant, is_demo: true } },
    });
    const json = await (await me.GET(new Request(`${BASE}/api/me`))).json();
    expect(json.tenant.isDemo).toBe(true);
    expect(client.query.select).toHaveBeenCalledWith(expect.stringContaining("is_demo"));
  });

  it("returns 403 for an auth user without an app_user (no tenant claim)", async () => {
    client = fakeSupabase({ claims: { sub: "d0000000-0000-4000-8000-00000000000d" } });
    const response = await me.GET(new Request(`${BASE}/api/me`));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("no_tenant");
  });

  it("returns 403 when the app_user row is no longer visible (deactivated since the token)", async () => {
    client = fakeSupabase({ claims: OWNER_CLAIMS, meRow: null });
    const response = await me.GET(new Request(`${BASE}/api/me`));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("no_tenant");
  });

  it("returns 401 without a session", async () => {
    client = fakeSupabase({ claims: null });
    expect((await me.GET(new Request(`${BASE}/api/me`))).status).toBe(401);
  });

  it("is available to every role, waiter included", async () => {
    client = fakeSupabase({ claims: { ...OWNER_CLAIMS, app_role: "waiter" }, meRow: ME_ROW });
    expect((await me.GET(new Request(`${BASE}/api/me`))).status).toBe(200);
  });
});

describe("POST /api/auth/magic-link", () => {
  it("sends a link that returns to the callback, never creating users", async () => {
    const response = await magicLink.POST(
      jsonRequest(`${BASE}/api/auth/magic-link`, { email: "owner@example.test", next: "/fatture" }),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "sent" });
    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "owner@example.test",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${BASE}/api/auth/callback?next=%2Ffatture`,
      },
    });
  });

  it("does not reveal whether the address exists", async () => {
    client.auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { status: 422, code: "otp_disabled", message: "Signups not allowed for otp" },
    });
    const response = await magicLink.POST(
      jsonRequest(`${BASE}/api/auth/magic-link`, { email: "stranger@example.test" }),
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "sent" });
  });

  it("logs an unexpected rejection by code only, still answering 202", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    client.auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: {
        status: 400,
        code: "email_address_invalid",
        message: "owner@example.test is invalid",
      },
    });
    const response = await magicLink.POST(
      jsonRequest(`${BASE}/api/auth/magic-link`, { email: "owner@example.test" }),
    );
    expect(response.status).toBe(202);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("email_address_invalid");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("owner@example.test");
    warn.mockRestore();
  });

  it("does not log the expected answer for an unknown address", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    client.auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { status: 422, code: "otp_disabled", message: "Signups not allowed for otp" },
    });
    await magicLink.POST(jsonRequest(`${BASE}/api/auth/magic-link`, { email: "x@example.test" }));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("drops an off-site next before building the link", async () => {
    await magicLink.POST(
      jsonRequest(`${BASE}/api/auth/magic-link`, {
        email: "owner@example.test",
        next: "https://evil.example",
      }),
    );
    expect(client.auth.signInWithOtp.mock.calls[0]?.[0].options.emailRedirectTo).toBe(
      `${BASE}/api/auth/callback?next=%2F`,
    );
  });

  it("passes rate limiting through as 429", async () => {
    client.auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { status: 429, code: "over_email_send_rate_limit", message: "rate limited" },
    });
    const response = await magicLink.POST(
      jsonRequest(`${BASE}/api/auth/magic-link`, { email: "owner@example.test" }),
    );
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("rate_limited");
  });

  it("reports an auth-server failure as 502 instead of pretending the mail went out", async () => {
    client.auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { status: 500, code: "unexpected_failure", message: "smtp down" },
    });
    const response = await magicLink.POST(
      jsonRequest(`${BASE}/api/auth/magic-link`, { email: "owner@example.test" }),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("upstream_error");
  });

  it("rejects an invalid email and unknown fields", async () => {
    const bad = await magicLink.POST(jsonRequest(`${BASE}/api/auth/magic-link`, { email: "nope" }));
    expect(bad.status).toBe(400);
    const extra = await magicLink.POST(
      jsonRequest(`${BASE}/api/auth/magic-link`, { email: "owner@example.test", role: "admin" }),
    );
    expect(extra.status).toBe(400);
    expect(client.auth.signInWithOtp).not.toHaveBeenCalled();
  });
});

describe("GET /api/auth/callback", () => {
  async function redirectFor(query: string) {
    const response = await callback.GET(new Request(`${BASE}/api/auth/callback?${query}`));
    return { status: response.status, location: response.headers.get("location") };
  }

  it("exchanges the PKCE code and follows a same-origin next", async () => {
    expect(await redirectFor("code=abc&next=%2Ffatture")).toEqual({
      status: 303,
      location: `${BASE}/fatture`,
    });
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
  });

  it.each(["next=https://evil.example", "next=//evil.example", "next=%2F%2Fevil.example"])(
    "redirects %s to / (only same-origin relative paths are followed)",
    async (next) => {
      expect(await redirectFor(`code=abc&${next}`)).toEqual({ status: 303, location: `${BASE}/` });
    },
  );

  it("refuses token_hash links, which are not bound to the requesting browser (login CSRF)", async () => {
    expect((await redirectFor("token_hash=h1&type=magiclink")).location).toBe(
      `${BASE}/login?errore=link`,
    );
    expect(client.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("sends an expired or invalid link back to the login page", async () => {
    client.auth.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { status: 400, message: "invalid" },
    });
    expect(await redirectFor("code=old&next=%2Ffatture")).toEqual({
      status: 303,
      location: `${BASE}/login?errore=link`,
    });
  });

  it("sends a link without code or token back to the login page", async () => {
    expect((await redirectFor("next=%2F")).location).toBe(`${BASE}/login?errore=link`);
  });
});

describe("POST /api/auth/logout", () => {
  it("signs out and returns 204", async () => {
    const response = await logout.POST(jsonRequest(`${BASE}/api/auth/logout`, {}));
    expect(response.status).toBe(204);
    // Local scope: leaving on one phone must not sign the owner out everywhere else.
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("requires a session", async () => {
    client = fakeSupabase({ claims: null });
    const response = await logout.POST(jsonRequest(`${BASE}/api/auth/logout`, {}));
    expect(response.status).toBe(401);
  });

  it("works for a signed-in user without a tenant, so they can still leave", async () => {
    client = fakeSupabase({ claims: { sub: "d0000000-0000-4000-8000-00000000000d" } });
    const response = await logout.POST(jsonRequest(`${BASE}/api/auth/logout`, {}));
    expect(response.status).toBe(204);
  });

  it("requires a JSON request (CSRF guard)", async () => {
    const response = await logout.POST(new Request(`${BASE}/api/auth/logout`, { method: "POST" }));
    expect(response.status).toBe(415);
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });
});
