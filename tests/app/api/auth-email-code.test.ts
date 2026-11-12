import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  OWNER_CLAIMS,
  type FakeClaims,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// M25a step 7: POST /api/auth/email-code verifies the 6-digit code of the sign-in e-mail, typed in the app.
let client: FakeSupabase;
const reportError = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));
vi.mock("@/lib/auth/mfa-constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/mfa-constants")>()),
  // The offer page is built in PR 2; these tests exercise the redirect as it will be once it exists.
  MFA_OFFER_PAGE_READY: true,
}));

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

const route = await import("@/app/api/auth/email-code/route");

const EMAIL = "titolare.demo@example.test";
const post = (body: unknown) =>
  route.POST(jsonRequest("http://localhost:3000/api/auth/email-code", body));
const verify = (claims: FakeClaims, extra: Record<string, unknown> = {}) => {
  client = fakeSupabase({ claims });
  return post({ email: EMAIL, code: "123456", ...extra });
};
const authError = (status: number, code: string) => ({
  data: { session: null, user: null },
  error: { status, code, name: "AuthApiError", message: `${code} ${EMAIL} 123456` },
});

let logs: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  reportError.mockReset();
  floor.sleeps.length = 0;
  logs = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/auth/email-code success", () => {
  it("calls verifyOtp with the e-mail, the code and type email", async () => {
    await verify(OWNER_CLAIMS);
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({
      email: EMAIL,
      token: "123456",
      type: "email",
    });
  });

  it("offers an owner the password page first, remembering where they were going", async () => {
    expect(await (await verify(OWNER_CLAIMS)).json()).toEqual({ redirect: "/password?dopo=%2F" });
    expect(await (await verify(OWNER_CLAIMS, { next: "/password" })).json()).toEqual({
      redirect: "/password",
    });
    expect(await (await verify(claimsFor("admin"), { next: "/report" })).json()).toEqual({
      redirect: "/password?dopo=%2Freport",
    });
  });

  it("ignores an unsafe next", async () => {
    expect(await (await verify(OWNER_CLAIMS, { next: "https://evil.test" })).json()).toEqual({
      redirect: "/password?dopo=%2F",
    });
  });

  it("sends a waiter to the tables and a person without a tenant to /", async () => {
    expect(await (await verify(claimsFor("waiter"))).json()).toEqual({ redirect: "/tavoli" });
    expect(await (await verify({ sub: OWNER_CLAIMS.sub })).json()).toEqual({ redirect: "/" });
  });
});

describe("POST /api/auth/email-code refusals", () => {
  it("maps an expired code to 422 code_invalid", async () => {
    client = fakeSupabase();
    client.auth.verifyOtp.mockResolvedValueOnce(authError(403, "otp_expired"));
    const response = await post({ email: EMAIL, code: "123456" });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("code_invalid");
    expect(body.error.message).toBe("Codice non valido o scaduto. Chiedine uno nuovo.");
  });

  it("maps 429 to rate_limited and a 5xx to 502", async () => {
    client = fakeSupabase();
    client.auth.verifyOtp.mockResolvedValueOnce(authError(429, "over_request_rate_limit"));
    const limited = await post({ email: EMAIL, code: "123456" });
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("rate_limited");
    client = fakeSupabase();
    client.auth.verifyOtp.mockResolvedValueOnce(authError(500, "unexpected_failure"));
    expect((await post({ email: EMAIL, code: "123456" })).status).toBe(502);
  });

  it.each(["12345", "1234567", "12a456", " 123456", "123 456"])(
    "rejects the code %j with 400 before any Auth call",
    async (code) => {
      client = fakeSupabase();
      expect((await post({ email: EMAIL, code })).status).toBe(400);
      expect(client.auth.verifyOtp).not.toHaveBeenCalled();
    },
  );

  it("never logs the code or the address", async () => {
    client = fakeSupabase();
    client.auth.verifyOtp.mockResolvedValueOnce(authError(500, "unexpected_failure"));
    await post({ email: EMAIL, code: "123456" });
    const seen = JSON.stringify([
      ...logs.flatMap((spy) => spy.mock.calls),
      ...reportError.mock.calls.map(([e]) => String(e)),
    ]);
    expect(seen).not.toContain(EMAIL);
    expect(seen).not.toContain("123456");
  });
});

describe("POST /api/auth/email-code response time", () => {
  it("pads a good code and a wrong code by the same floor", async () => {
    expect((await verify(OWNER_CLAIMS)).status).toBe(200);
    client = fakeSupabase();
    client.auth.verifyOtp.mockResolvedValueOnce(authError(403, "otp_expired"));
    expect((await post({ email: EMAIL, code: "123456" })).status).toBe(422);
    expect(floor.sleeps).toEqual([800, 800]);
  });

  it("does not pad a malformed body or a rate limit", async () => {
    client = fakeSupabase();
    expect((await post({ email: "nope", code: "1" })).status).toBe(400);
    client = fakeSupabase();
    client.auth.verifyOtp.mockResolvedValueOnce(authError(429, "over_request_rate_limit"));
    expect((await post({ email: EMAIL, code: "123456" })).status).toBe(429);
    expect(floor.sleeps).toEqual([]);
  });
});

// P2-1 A11: the e-mail code is a first factor only; the code step still follows, and the /password offer comes after it.
describe("POST /api/auth/email-code and the second factor (the fallback cannot bypass it, AT-T4)", () => {
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
  const verifyAt = (
    rpc: Record<string, ReturnType<typeof mfaStatus>>,
    claims: FakeClaims = OWNER_CLAIMS,
    extra: Record<string, unknown> = {},
  ) => {
    client = fakeSupabase({ claims: { ...claims, aal: "aal1" }, rpc });
    return post({ email: EMAIL, code: "123456", ...extra });
  };

  it("an owner with a factor goes to the code page, and the /password offer is carried as the way on", async () => {
    const response = await verifyAt(
      { mfa_status: mfaStatus({ hasVerifiedFactor: true, gate: "challenge" }) },
      OWNER_CLAIMS,
      { next: "/fatture" },
    );
    expect(await response.json()).toEqual({
      redirect: `/login/codice?next=${encodeURIComponent("/password?dopo=%2Ffatture")}`,
    });
  });

  it("an admin under required without a factor goes to the forced enrolment", async () => {
    const response = await verifyAt(
      { mfa_status: mfaStatus({ role: "admin", mode: "required", gate: "enrol" }) },
      claimsFor("admin"),
    );
    expect(await response.json()).toEqual({
      redirect: `/login/attiva-codice?next=${encodeURIComponent("/password?dopo=%2F")}`,
    });
  });

  it("an owner without a factor is offered it, then the password offer", async () => {
    const response = await verifyAt({ mfa_status: mfaStatus() });
    expect(await response.json()).toEqual({
      redirect: `/login/offerta-codice?next=${encodeURIComponent("/password?dopo=%2F")}`,
    });
  });

  it("mode off keeps today's redirect (the /password offer)", async () => {
    const response = await verifyAt({ mfa_status: mfaStatus({ mode: "off" }) });
    expect(await response.json()).toEqual({ redirect: "/password?dopo=%2F" });
  });

  it("a chef after an e-mail code is unchanged and makes no RPC", async () => {
    const response = await verifyAt({ mfa_status: mfaStatus() }, claimsFor("chef"));
    expect((await response.json()).redirect).toBe("/");
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
