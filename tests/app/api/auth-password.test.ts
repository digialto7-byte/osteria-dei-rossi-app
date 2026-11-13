import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  OWNER_CLAIMS,
  type FakeClaims,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// M25a step 6: POST /api/auth/password signs an owner or admin in with Supabase Auth's e-mail/password.
let client: FakeSupabase;
const reportError = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));
const policy = vi.hoisted(() => ({ checkNewPassword: vi.fn() }));
vi.mock("@/lib/auth/password-policy", () => policy);
const floor = vi.hoisted(() => ({ sleeps: [] as number[] }));
// The real helper with a fake clock that records each wait instead of sleeping: no wall clock in this suite.
vi.mock("@/server/auth/min-duration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/min-duration")>();
  const clock = {
    now: () => 0,
    sleep: async (ms: number) => {
      floor.sleeps.push(ms);
    },
  };
  return {
    ...actual,
    withMinDuration: (handler: Parameters<typeof actual.withMinDuration>[0]) =>
      actual.withMinDuration(handler, actual.AUTH_MIN_DURATION_MS, clock),
  };
});

const route = await import("@/app/api/auth/password/route");

const EMAIL = "titolare.demo@example.test";
const PASSWORD = "una frase lunga per il locale";
const post = (body: unknown, init?: RequestInit) =>
  route.POST(jsonRequest("http://localhost:3000/api/auth/password", body, init));
const signIn = (claims: FakeClaims | null, next?: string) => {
  client = fakeSupabase({ claims });
  return post({ email: EMAIL, password: PASSWORD, ...(next ? { next } : {}) });
};
const authError = (status: number, code: string) => ({
  data: { session: null, user: null },
  error: { status, code, name: "AuthApiError", message: `${code} for ${EMAIL} ${PASSWORD}` },
});

let logs: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  reportError.mockReset();
  floor.sleeps.length = 0;
  logs = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("POST /api/auth/password success", () => {
  it("sends an owner to Oggi", async () => {
    const response = await signIn(OWNER_CLAIMS);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redirect: "/" });
  });

  it("calls signInWithPassword with exactly the e-mail and the password, and no policy check", async () => {
    await signIn(OWNER_CLAIMS);
    expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
    });
    expect(policy.checkNewPassword).not.toHaveBeenCalled();
  });

  it("follows a safe next, ignores an unsafe one", async () => {
    expect(await (await signIn(OWNER_CLAIMS, "/fatture")).json()).toEqual({ redirect: "/fatture" });
    expect(await (await signIn(OWNER_CLAIMS, "https://evil.test/")).json()).toEqual({
      redirect: "/",
    });
    expect(await (await signIn(OWNER_CLAIMS, "//evil.test")).json()).toEqual({ redirect: "/" });
  });

  it("sends a waiter to the tables and an account without a tenant to /", async () => {
    expect(await (await signIn(claimsFor("waiter"))).json()).toEqual({ redirect: "/tavoli" });
    expect(await (await signIn({ sub: OWNER_CLAIMS.sub })).json()).toEqual({ redirect: "/" });
  });

  it("is never cached", async () => {
    expect((await signIn(OWNER_CLAIMS)).headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /api/auth/password refusals", () => {
  it("answers 401 login_invalid, with the same body for an unknown address and a wrong password", async () => {
    client = fakeSupabase();
    client.auth.signInWithPassword.mockResolvedValueOnce(authError(400, "invalid_credentials"));
    const wrong = await post({ email: EMAIL, password: PASSWORD });
    client = fakeSupabase();
    client.auth.signInWithPassword.mockResolvedValueOnce(authError(400, "invalid_credentials"));
    const unknown = await post({ email: "nessuno@example.test", password: "altra password lunga" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const a = await wrong.text();
    expect(a).toBe(await unknown.text());
    const body = JSON.parse(a);
    expect(body.error.code).toBe("login_invalid");
    expect(body.error.message).toBe("Email o password non corretti.");
  });

  it("maps Auth's 429 to rate_limited", async () => {
    client = fakeSupabase();
    client.auth.signInWithPassword.mockResolvedValueOnce(authError(429, "over_request_rate_limit"));
    const response = await post({ email: EMAIL, password: PASSWORD });
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("rate_limited");
  });

  it("maps a 5xx and a thrown fetch error to 502 upstream_error", async () => {
    client = fakeSupabase();
    client.auth.signInWithPassword.mockResolvedValueOnce(authError(500, "unexpected_failure"));
    expect((await post({ email: EMAIL, password: PASSWORD })).status).toBe(502);
    client = fakeSupabase();
    client.auth.signInWithPassword.mockRejectedValueOnce(new TypeError("fetch failed"));
    const response = await post({ email: EMAIL, password: PASSWORD });
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("upstream_error");
  });

  it("gives up after 10 seconds with 502", async () => {
    vi.useFakeTimers();
    client = fakeSupabase();
    client.auth.signInWithPassword.mockReturnValueOnce(new Promise(() => undefined));
    const pending = post({ email: EMAIL, password: PASSWORD });
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;
    expect(response.status).toBe(502);
  });

  it("rejects an extra key with 400, naming the key and not echoing values", async () => {
    client = fakeSupabase();
    const response = await post({ email: EMAIL, password: PASSWORD, role: "owner" });
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain("role");
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(EMAIL);
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects a bad e-mail, an empty password and a too long one with 400", async () => {
    client = fakeSupabase();
    expect((await post({ email: "nope", password: PASSWORD })).status).toBe(400);
    expect((await post({ email: EMAIL, password: "" })).status).toBe(400);
    expect((await post({ email: EMAIL, password: "x".repeat(201) })).status).toBe(400);
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON content type with 415", async () => {
    client = fakeSupabase();
    const response = await route.POST(
      new Request("http://localhost:3000/api/auth/password", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(415);
  });
});

describe("POST /api/auth/password logging", () => {
  it("never logs the address or the password", async () => {
    client = fakeSupabase();
    client.auth.signInWithPassword.mockResolvedValueOnce(authError(500, "unexpected_failure"));
    await post({ email: EMAIL, password: PASSWORD });
    client = fakeSupabase();
    client.auth.signInWithPassword.mockResolvedValueOnce(authError(400, "invalid_credentials"));
    await post({ email: EMAIL, password: PASSWORD });
    const seen = JSON.stringify([
      ...logs.flatMap((spy) => spy.mock.calls),
      ...reportError.mock.calls.map(([e]) => String(e)),
    ]);
    expect(seen).not.toContain(EMAIL);
    expect(seen).not.toContain(PASSWORD);
  });
});

describe("POST /api/auth/password response time", () => {
  it("pads an unknown address and a wrong password by the same floor", async () => {
    client = fakeSupabase();
    client.auth.signInWithPassword.mockResolvedValueOnce(authError(400, "invalid_credentials"));
    expect(
      (await post({ email: "nessuno@example.test", password: "altra password lunga" })).status,
    ).toBe(401);
    client = fakeSupabase();
    client.auth.signInWithPassword.mockResolvedValueOnce(authError(400, "invalid_credentials"));
    expect((await post({ email: EMAIL, password: PASSWORD })).status).toBe(401);
    expect(floor.sleeps).toEqual([800, 800]);
  });

  it("pads a success and a 502", async () => {
    await signIn(OWNER_CLAIMS);
    client = fakeSupabase();
    client.auth.signInWithPassword.mockResolvedValueOnce(authError(500, "unexpected_failure"));
    expect((await post({ email: EMAIL, password: PASSWORD })).status).toBe(502);
    expect(floor.sleeps).toEqual([800, 800]);
  });

  it("does not pad a malformed body, a wrong content type or a rate limit", async () => {
    client = fakeSupabase();
    expect((await post({ email: "nope", password: PASSWORD })).status).toBe(400);
    const wrongType = await route.POST(
      new Request("http://localhost:3000/api/auth/password", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      }),
    );
    expect(wrongType.status).toBe(415);
    client = fakeSupabase();
    client.auth.signInWithPassword.mockResolvedValueOnce(authError(429, "over_request_rate_limit"));
    expect((await post({ email: EMAIL, password: PASSWORD })).status).toBe(429);
    expect(floor.sleeps).toEqual([]);
  });
});

// P2-1 A11: after a good password the owner or admin goes to the next step of the second factor.
describe("POST /api/auth/password and the second factor", () => {
  const mfaStatus = (over: Record<string, unknown> = {}) => [
    {
      data: {
        role: "owner",
        mode: "enrolled",
        hasVerifiedFactor: false,
        gate: "ok",
        issuer: "Osteria Demo A",
        ...over,
      },
      error: null,
    },
  ];
  const signInAt = (
    aal: string,
    rpc: Record<string, ReturnType<typeof mfaStatus>>,
    claims: FakeClaims = OWNER_CLAIMS,
    next?: string,
  ) => {
    client = fakeSupabase({ claims: { ...claims, aal }, rpc });
    return post({ email: EMAIL, password: PASSWORD, ...(next ? { next } : {}) });
  };

  it("an owner with a factor goes to the code page, with the way on", async () => {
    const response = await signInAt(
      "aal1",
      { mfa_status: mfaStatus({ hasVerifiedFactor: true, gate: "challenge" }) },
      OWNER_CLAIMS,
      "/fatture",
    );
    expect(await response.json()).toEqual({ redirect: "/login/codice?next=%2Ffatture" });
    expect(client.rpc).toHaveBeenCalledWith("mfa_status");
  });

  it("an admin under required without a factor goes to the forced enrolment", async () => {
    const response = await signInAt(
      "aal1",
      { mfa_status: mfaStatus({ role: "admin", mode: "required", gate: "enrol" }) },
      claimsFor("admin"),
    );
    expect(await response.json()).toEqual({ redirect: "/login/attiva-codice?next=%2F" });
  });

  it("an owner without a factor is offered it", async () => {
    const response = await signInAt("aal1", { mfa_status: mfaStatus() });
    expect(await response.json()).toEqual({ redirect: "/login/offerta-codice?next=%2F" });
  });

  it("mode off, or a waiter: today's redirect (a waiter makes no RPC)", async () => {
    expect(
      await (await signInAt("aal1", { mfa_status: mfaStatus({ mode: "off" }) })).json(),
    ).toEqual({ redirect: "/" });
    const waiter = await signInAt("aal1", { mfa_status: mfaStatus() }, claimsFor("waiter"));
    expect(await waiter.json()).toEqual({ redirect: "/tavoli" });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("the way on is always a safe path", async () => {
    const response = await signInAt(
      "aal1",
      { mfa_status: mfaStatus({ hasVerifiedFactor: true, gate: "challenge" }) },
      OWNER_CLAIMS,
      "https://evil.test/",
    );
    expect(await response.json()).toEqual({ redirect: "/login/codice?next=%2F" });
  });

  it("the 800 ms floor still wraps the route on the new path", async () => {
    await signInAt("aal1", {
      mfa_status: mfaStatus({ hasVerifiedFactor: true, gate: "challenge" }),
    });
    expect(floor.sleeps).toHaveLength(1);
  });
});
