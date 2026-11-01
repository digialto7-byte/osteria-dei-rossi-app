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

const floor = vi.hoisted(() => ({ ran: vi.fn() }));
// Pass-through that records each floored request, so the suite does not really wait (the helper has its own tests).
vi.mock("@/server/auth/min-duration", () => ({
  withMinDuration:
    <A extends unknown[], R>(handler: (...args: A) => Promise<R>) =>
    (...args: A) => {
      floor.ran();
      return handler(...args);
    },
}));

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
  floor.ran.mockReset();
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
  it("sends a good code, a wrong code, a malformed body and a rate limit through the floor", async () => {
    await verify(OWNER_CLAIMS);
    client = fakeSupabase();
    client.auth.verifyOtp.mockResolvedValueOnce(authError(403, "otp_expired"));
    await post({ email: EMAIL, code: "123456" });
    client = fakeSupabase();
    await post({ email: "nope", code: "1" });
    client = fakeSupabase();
    client.auth.verifyOtp.mockResolvedValueOnce(authError(429, "over_request_rate_limit"));
    await post({ email: EMAIL, code: "123456" });
    expect(floor.ran).toHaveBeenCalledTimes(4);
  });
});
