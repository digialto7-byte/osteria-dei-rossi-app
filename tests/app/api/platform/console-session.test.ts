import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consoleResponseSchema,
  logoutResponseSchema,
  passwordSignInResponseSchema,
} from "@/lib/platform/api";
import {
  dataRpcCalls,
  fakeSupabase,
  jsonRequest,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

// SP3 step 17 (docs/plans/2026-11-15-sp3-console.md §3.4.4, §3.6): the console's sign-in, the switch into console mode and the logout. Every 200 reply is parsed
// with the schema of src/lib/platform/api.ts, so routes and screens cannot drift.
let client: FakeSupabase;
const reportError = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));
vi.mock("@/server/auth/min-duration", () => ({
  withMinDuration: (handler: (r: Request) => Promise<Response>) => handler,
}));

const password = await import("@/app/api/platform/auth/password/route");
const consoleMode = await import("@/app/api/platform/console/route");
const logout = await import("@/app/api/platform/logout/route");

const STAFF = "a7000000-0000-4000-8000-000000000001";
const SESSION = "c7000000-0000-4000-8000-000000000001";
const AUTHENTICATED = { sub: STAFF, role: "authenticated", session_id: SESSION, aal: "aal2" };
const CONSOLE = { ...AUTHENTICATED, role: "platform_staff" };
const URL_BASE = "http://127.0.0.1:3000/api/platform";
const codeOf = async (response: Response) => (await response.json()).error.code as string;
const verifiedFactor = {
  id: "f0000000-0000-4000-8000-00000000000f",
  factor_type: "totp",
  status: "verified",
  friendly_name: "Principale",
};

beforeEach(() => reportError.mockReset());

describe("POST /api/platform/auth/password", () => {
  const signIn = (body: unknown) => password.POST(jsonRequest(`${URL_BASE}/auth/password`, body));
  const credentials = { email: "platform-admin@example.test", password: "test-password" };

  it("the platform admin with a verified factor goes to the code page", async () => {
    client = fakeSupabase({
      claims: null,
      rpc: {
        platform_mfa_attempt_allowed: [
          { data: { allowed: true, retryAfterSeconds: 0 }, error: null },
        ],
      },
    });
    client.auth.mfa.listFactors.mockResolvedValue({
      data: { all: [verifiedFactor], totp: [verifiedFactor] },
      error: null,
    });
    const response = await signIn(credentials);
    expect(response.status).toBe(200);
    expect(passwordSignInResponseSchema.parse(await response.json())).toEqual({
      redirect: "/login/codice",
    });
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith(credentials);
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it("without a verified factor (first sign-in after the bootstrap) it goes to the enrolment page", async () => {
    client = fakeSupabase({
      claims: null,
      rpc: {
        platform_mfa_attempt_allowed: [
          { data: { allowed: true, retryAfterSeconds: 0 }, error: null },
        ],
      },
    });
    const unverified = { ...verifiedFactor, status: "unverified" };
    client.auth.mfa.listFactors.mockResolvedValue({
      data: { all: [unverified], totp: [] },
      error: null,
    });
    expect(await (await signIn(credentials)).json()).toEqual({ redirect: "/login/attiva-codice" });
  });

  it("an account that is not platform staff is signed out at once: 403 not_console_account (Q-P4)", async () => {
    client = fakeSupabase({
      claims: null,
      rpc: {
        platform_mfa_attempt_allowed: [
          { data: null, error: { code: "42501", message: "insufficient_privilege" } },
        ],
      },
    });
    const response = await signIn({ email: "owner-a@example.test", password: "test-password" });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("not_console_account");
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(client.auth.mfa.listFactors).not.toHaveBeenCalled();
  });

  it("a wrong password is 401 login_invalid, and nothing else runs", async () => {
    client = fakeSupabase({ claims: null });
    client.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" },
    });
    const response = await signIn(credentials);
    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("login_invalid");
    expect(dataRpcCalls(client, 0)).toEqual([]);
  });

  it("an Auth rate limit is 429 rate_limited; another Auth failure is 502 upstream_error, reported by code only", async () => {
    client = fakeSupabase({ claims: null });
    client.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { status: 429, code: "over_request_rate_limit", message: "rate" },
    });
    expect((await signIn(credentials)).status).toBe(429);
    client = fakeSupabase({ claims: null });
    client.auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: {
        status: 500,
        code: "unexpected_failure",
        message: "platform-admin@example.test failed",
      },
    });
    const response = await signIn(credentials);
    expect(response.status).toBe(502);
    expect(await codeOf(response)).toBe("upstream_error");
    expect(String(reportError.mock.calls[0]?.[0])).not.toContain("@");
  });

  it("a body with an unknown key, a bad address or an empty password is 400 invalid_request", async () => {
    client = fakeSupabase({ claims: null });
    for (const body of [
      { ...credentials, next: "/" },
      { ...credentials, email: "not-an-address" },
      { ...credentials, password: "" },
    ]) {
      const response = await signIn(body);
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("invalid_request");
    }
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("no reply holds an @", async () => {
    client = fakeSupabase({
      claims: null,
      rpc: {
        platform_mfa_attempt_allowed: [{ data: null, error: { code: "42501", message: "x" } }],
      },
    });
    expect(await (await signIn(credentials)).text()).not.toContain("@");
  });
});

describe("POST /api/platform/console", () => {
  const post = (body: unknown = {}) => consoleMode.POST(jsonRequest(`${URL_BASE}/console`, body));

  it("calls select_console, then one refreshSession on the same client, and answers 200 only when the new claims carry role = platform_staff", async () => {
    client = fakeSupabase({
      claims: AUTHENTICATED,
      rpc: { select_console: [{ data: { changed: true }, error: null }] },
    });
    client.auth.getClaims
      .mockResolvedValueOnce({
        data: {
          claims: {
            ...AUTHENTICATED,
            amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { claims: CONSOLE }, error: null });
    const response = await post();
    expect(response.status).toBe(200);
    expect(consoleResponseSchema.parse(await response.json())).toEqual({ mode: "console" });
    expect(dataRpcCalls(client, 0)).toEqual([["select_console"]]);
    expect(client.auth.refreshSession).toHaveBeenCalledTimes(1);
    const rpcOrder = client.rpc.mock.invocationCallOrder[0]!;
    expect(client.auth.refreshSession.mock.invocationCallOrder[0]!).toBeGreaterThan(rpcOrder);
  });

  it("the refreshed token without role platform_staff is 503 console_switch_failed", async () => {
    client = fakeSupabase({
      claims: AUTHENTICATED,
      rpc: { select_console: [{ data: { changed: true }, error: null }] },
    });
    const response = await post();
    expect(response.status).toBe(503);
    expect(await codeOf(response)).toBe("console_switch_failed");
  });

  it("a failed refresh is 503 console_switch_failed too, reported by code only", async () => {
    client = fakeSupabase({
      claims: AUTHENTICATED,
      rpc: { select_console: [{ data: { changed: true }, error: null }] },
    });
    client.auth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: { status: 500, code: "unexpected_failure", message: "x" },
    });
    const response = await post();
    expect(response.status).toBe(503);
    expect(await codeOf(response)).toBe("console_switch_failed");
  });

  it("already in console mode: 200 with no RPC and no refresh", async () => {
    client = fakeSupabase({ claims: CONSOLE });
    const response = await post();
    expect(response.status).toBe(200);
    expect(dataRpcCalls(client, 0)).toEqual([]);
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
  });

  it.each([
    ["42501", "not_platform_staff", 403, "forbidden"],
    ["P0001", "mfa_factor_required", 403, "mfa_factor_required"],
    ["P0001", "mfa_required", 403, "mfa_required"],
    ["P0001", "session_missing", 401, "unauthenticated"],
  ])("select_console's %s %s is %i %s, with no refresh", async (code, message, status, apiCode) => {
    client = fakeSupabase({
      claims: AUTHENTICATED,
      rpc: { select_console: [{ data: null, error: { code, message } }] },
    });
    const response = await post();
    expect(response.status).toBe(status);
    expect(await codeOf(response)).toBe(apiCode);
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
  });

  it("an unexpected database error is 500, reported by code only", async () => {
    client = fakeSupabase({
      claims: AUTHENTICATED,
      rpc: { select_console: [{ data: null, error: { code: "XX000", message: "secret detail" } }] },
    });
    expect((await post()).status).toBe(500);
    expect(String(reportError.mock.calls[0]?.[0])).toContain("XX000");
    expect(String(reportError.mock.calls[0]?.[0])).not.toContain("secret");
  });

  it("signed out is 401; a body with a key is 400", async () => {
    client = fakeSupabase({ claims: null });
    expect((await post()).status).toBe(401);
    client = fakeSupabase({ claims: AUTHENTICATED });
    expect((await post({ mode: "console" })).status).toBe(400);
  });
});

describe("POST /api/platform/logout", () => {
  const post = () => logout.POST(jsonRequest(`${URL_BASE}/logout`, {}));

  it("a console session leaves console mode, then signs out: 200 { ok: true }", async () => {
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_leave_console: [{ data: { changed: true }, error: null }] },
    });
    const response = await post();
    expect(response.status).toBe(200);
    expect(logoutResponseSchema.parse(await response.json())).toEqual({ ok: true });
    expect(dataRpcCalls(client, 0)).toEqual([["platform_leave_console"]]);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(client.auth.signOut.mock.invocationCallOrder[0]!).toBeGreaterThan(
      client.rpc.mock.invocationCallOrder[0]!,
    );
  });

  it("a failed leave is reported by code only and the sign-out still runs", async () => {
    client = fakeSupabase({
      claims: CONSOLE,
      rpc: { platform_leave_console: [{ data: null, error: { code: "XX000", message: "x" } }] },
    });
    expect((await post()).status).toBe(200);
    expect(client.auth.signOut).toHaveBeenCalled();
    expect(String(reportError.mock.calls[0]?.[0])).toContain("XX000");
  });

  it("a session not in console mode (the code page) only signs out", async () => {
    client = fakeSupabase({ claims: { ...AUTHENTICATED, aal: "aal1" } });
    expect((await post()).status).toBe(200);
    expect(dataRpcCalls(client, 0)).toEqual([]);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("signed out is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await post()).status).toBe(401);
  });
});
