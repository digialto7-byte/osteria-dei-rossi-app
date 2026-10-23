import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeSupabase } from "../../../helpers/fake-supabase";
import { derivePinPassword } from "@/server/staff-auth/derive";
import {
  ATTEMPT_ID,
  AUTH_EMAIL,
  AUTH_SESSION_ID,
  AUTH_USER_ID,
  DEVICE_HASH,
  deviceCookie,
  fakeJwt,
  PEPPER,
  PIN,
  postJson,
  USER_ID,
} from "./helpers";

// M11 acceptance tests 1, 2 and 3 (API half). The privileged module and the Supabase client are
// fakes with spies; what matters is which calls happen, and which must not.
process.env.PIN_PEPPER = PEPPER;
let client: FakeSupabase;
const privileged = vi.hoisted(() => ({
  beginPinLogin: vi.fn(),
  finishPinLogin: vi.fn(),
  redeemEnrolmentCode: vi.fn(),
  deviceStaffList: vi.fn(),
}));
const reportError = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));
vi.mock("@/server/staff-auth/privileged", () => privileged);

const { POST } = await import("@/app/api/auth/pin/route");

const ENDS_AT = "2026-10-25T00:00:00.000Z";
const ME_ROW = {
  id: "a1000000-0000-4000-8000-00000000000a",
  display_name: "Cameriere Demo",
  role: "waiter",
};
const request = (
  body: unknown = { userId: USER_ID, pin: PIN },
  cookie: string | null = deviceCookie(),
) => postJson("/api/auth/pin", body, cookie ? { cookie } : {});
const signIn = () => client.auth.signInWithPassword;

const proceed = { status: "proceed", attemptId: ATTEMPT_ID, authEmail: AUTH_EMAIL };
const session = (
  claims: Record<string, unknown> = { session_id: AUTH_SESSION_ID, sub: AUTH_USER_ID },
) => ({
  data: { session: { access_token: fakeJwt(claims) }, user: {} },
  error: null,
});

beforeEach(() => {
  client = fakeSupabase({ claims: null, meRow: ME_ROW });
  for (const mock of Object.values(privileged)) mock.mockReset();
  reportError.mockReset();
  privileged.beginPinLogin.mockResolvedValue(proceed);
  privileged.finishPinLogin.mockResolvedValue({ status: "ok", endsAt: ENDS_AT });
  signIn().mockResolvedValue(session());
});
afterEach(() => vi.useRealTimers());

const noAuthCall = () => {
  expect(signIn()).not.toHaveBeenCalled();
  expect(privileged.finishPinLogin).not.toHaveBeenCalled();
};

describe("POST /api/auth/pin: nothing reaches Supabase Auth without a valid device (AT2)", () => {
  it("no device cookie -> 401 device_missing, no RPC and no Auth call", async () => {
    const response = await POST(request(undefined, null));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("device_missing");
    expect(privileged.beginPinLogin).not.toHaveBeenCalled();
    noAuthCall();
  });

  it("a malformed device cookie counts as missing", async () => {
    const response = await POST(request(undefined, "__Host-odr_device=short"));
    expect(response.status).toBe(401);
    expect(privileged.beginPinLogin).not.toHaveBeenCalled();
  });

  it.each([
    ["device_unknown", 401],
    ["device_revoked", 401],
  ])("%s -> %i and Auth is never called", async (status, http) => {
    privileged.beginPinLogin.mockResolvedValue({ status });
    const response = await POST(request());
    expect(response.status).toBe(http);
    expect((await response.json()).error.code).toBe(status);
    expect(signIn()).toHaveBeenCalledTimes(0);
    noAuthCall();
  });

  it("device_locked -> 423 and Auth is never called", async () => {
    privileged.beginPinLogin.mockResolvedValue({ status: "device_locked" });
    const response = await POST(request());
    expect(response.status).toBe(423);
    expect((await response.json()).error.code).toBe("device_locked");
    noAuthCall();
  });

  it("begin receives the SHA-256 of the cookie token, never the token", async () => {
    await POST(request());
    expect(privileged.beginPinLogin).toHaveBeenCalledWith(DEVICE_HASH, USER_ID);
  });
});

describe("POST /api/auth/pin: lockouts (AT3)", () => {
  it("user_locked -> 423 with lockedUntil; the 6th attempt, even correct, never reaches Auth", async () => {
    privileged.beginPinLogin.mockResolvedValue({
      status: "user_locked",
      lockedUntil: "2026-10-24T19:15:00Z",
    });
    const response = await POST(request());
    expect(response.status).toBe(423);
    const body = await response.json();
    expect(body.error.code).toBe("user_locked");
    expect(body.error.details).toEqual([{ lockedUntil: "2026-10-24T19:15:00Z" }]);
    noAuthCall();
  });

  it("attempt_in_progress -> 429 and Auth is never called", async () => {
    privileged.beginPinLogin.mockResolvedValue({ status: "attempt_in_progress" });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("attempt_in_progress");
    noAuthCall();
  });

  it("an unknown or inactive user is answered like a wrong PIN, without an Auth call", async () => {
    privileged.beginPinLogin.mockResolvedValue({ status: "pin_invalid" });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("pin_invalid");
    noAuthCall();
  });
});

describe("POST /api/auth/pin: the sign-in (AT1)", () => {
  it("signs in once with the derived password, finishes with the session id, answers 200", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: ME_ROW.id, displayName: "Cameriere Demo", role: "waiter" },
      endsAt: ENDS_AT,
    });
    expect(signIn()).toHaveBeenCalledTimes(1);
    expect(signIn()).toHaveBeenCalledWith({
      email: AUTH_EMAIL,
      password: derivePinPassword(PEPPER, USER_ID, PIN),
    });
    expect(privileged.finishPinLogin).toHaveBeenCalledWith(ATTEMPT_ID, "success", AUTH_SESSION_ID);
    expect(privileged.beginPinLogin.mock.invocationCallOrder[0]).toBeLessThan(
      signIn().mock.invocationCallOrder[0] ?? 0,
    );
    expect(signIn().mock.invocationCallOrder[0]).toBeLessThan(
      privileged.finishPinLogin.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("never puts the PIN or the password in the response", async () => {
    const text = await (await POST(request())).text();
    expect(text).not.toContain(PIN);
    expect(text).not.toContain(derivePinPassword(PEPPER, USER_ID, PIN));
  });

  it("Auth invalid_credentials -> finish failure -> 401 pin_invalid with attemptsLeft", async () => {
    signIn().mockResolvedValue({
      data: { session: null, user: null },
      error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" },
    });
    privileged.finishPinLogin.mockResolvedValue({ status: "pin_invalid", attemptsLeft: 3 });
    const response = await POST(request());
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("pin_invalid");
    expect(body.error.details).toEqual([{ attemptsLeft: 3 }]);
    expect(privileged.finishPinLogin).toHaveBeenCalledWith(ATTEMPT_ID, "failure", null);
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it("the failure that locks the user -> 423 user_locked with lockedUntil", async () => {
    signIn().mockResolvedValue({
      data: { session: null, user: null },
      error: { status: 400, code: "invalid_credentials", message: "x" },
    });
    privileged.finishPinLogin.mockResolvedValue({
      status: "user_locked",
      lockedUntil: "2026-10-24T19:15:00Z",
    });
    const response = await POST(request());
    expect(response.status).toBe(423);
    expect((await response.json()).error.details).toEqual([
      { lockedUntil: "2026-10-24T19:15:00Z" },
    ]);
  });

  it("the failure that locks the device -> 423 device_locked", async () => {
    signIn().mockResolvedValue({
      data: { session: null, user: null },
      error: { status: 400, code: "invalid_credentials", message: "x" },
    });
    privileged.finishPinLogin.mockResolvedValue({ status: "device_locked" });
    const response = await POST(request());
    expect(response.status).toBe(423);
    expect((await response.json()).error.code).toBe("device_locked");
  });

  it("Auth 429 -> finish error -> 429 auth_rate_limited", async () => {
    signIn().mockResolvedValue({
      data: { session: null, user: null },
      error: { status: 429, code: "over_request_rate_limit", message: "x" },
    });
    privileged.finishPinLogin.mockResolvedValue({ status: "auth_error" });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("auth_rate_limited");
    expect(privileged.finishPinLogin).toHaveBeenCalledWith(ATTEMPT_ID, "error", null);
  });

  it("an Auth 5xx -> finish error -> 502 upstream_error", async () => {
    signIn().mockResolvedValue({
      data: { session: null, user: null },
      error: { status: 500, code: "unexpected_failure", message: "x" },
    });
    privileged.finishPinLogin.mockResolvedValue({ status: "auth_error" });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("upstream_error");
    expect(privileged.finishPinLogin).toHaveBeenCalledWith(ATTEMPT_ID, "error", null);
  });

  it("a thrown Auth call -> finish error -> 502", async () => {
    signIn().mockRejectedValue(new Error("fetch failed"));
    privileged.finishPinLogin.mockResolvedValue({ status: "auth_error" });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(privileged.finishPinLogin).toHaveBeenCalledWith(ATTEMPT_ID, "error", null);
  });

  it("an Auth call that hangs is cut at 10 s -> finish error -> 502", async () => {
    vi.useFakeTimers();
    signIn().mockReturnValue(new Promise(() => undefined));
    privileged.finishPinLogin.mockResolvedValue({ status: "auth_error" });
    const pending = POST(request());
    await vi.advanceTimersByTimeAsync(9_999);
    expect(privileged.finishPinLogin).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(response.status).toBe(502);
    expect(privileged.finishPinLogin).toHaveBeenCalledWith(ATTEMPT_ID, "error", null);
  });

  it("a sign-in that succeeds after the 10 s cut is signed out, so no session is left that nobody holds", async () => {
    vi.useFakeTimers();
    let late: (value: unknown) => void = () => undefined;
    signIn().mockReturnValue(new Promise((resolve) => (late = resolve)));
    privileged.finishPinLogin.mockResolvedValue({ status: "auth_error" });
    const pending = POST(request());
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).status).toBe(502);
    const before = client.auth.signOut.mock.calls.length;
    late(session());
    await vi.advanceTimersByTimeAsync(0);
    expect(client.auth.signOut.mock.calls.length).toBe(before + 1);
    expect(client.auth.signOut).toHaveBeenLastCalledWith({ scope: "local" });
  });

  it("a late answer without a session, or a late rejection, signs nothing out and raises nothing", async () => {
    for (const settle of ["error", "reject"] as const) {
      vi.useFakeTimers();
      let finishLate: () => void = () => undefined;
      signIn().mockReturnValue(
        new Promise((resolve, reject) => {
          finishLate =
            settle === "reject"
              ? () => reject(new Error("socket closed"))
              : () => resolve({ data: { session: null, user: null }, error: { status: 500 } });
        }),
      );
      privileged.finishPinLogin.mockResolvedValue({ status: "auth_error" });
      const pending = POST(request());
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;
      const before = client.auth.signOut.mock.calls.length;
      finishLate();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.auth.signOut.mock.calls.length).toBe(before);
      vi.useRealTimers();
    }
  });

  it("finish throwing after a successful sign-in -> local sign-out, 502", async () => {
    privileged.finishPinLogin.mockRejectedValue(new Error("db down"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("upstream_error");
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("finish refusing a signed-in session (device revoked meanwhile) -> signed out, 401", async () => {
    privileged.finishPinLogin.mockResolvedValue({ status: "device_revoked" });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("a token without a session id is reported to the database as an error and signed out", async () => {
    signIn().mockResolvedValue(session({}));
    privileged.finishPinLogin.mockResolvedValue({ status: "auth_error" });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(privileged.finishPinLogin).toHaveBeenCalledWith(ATTEMPT_ID, "error", null);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("a sign-in that answers without a session counts as an error", async () => {
    signIn().mockResolvedValue({ data: { session: null, user: null }, error: null });
    privileged.finishPinLogin.mockResolvedValue({ status: "auth_error" });
    expect((await POST(request())).status).toBe(502);
  });

  it("if the new session cannot read its own profile, it is signed out and the answer is 502", async () => {
    client = fakeSupabase({ claims: null, meRow: null });
    signIn().mockResolvedValue(session());
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

describe("POST /api/auth/pin: input", () => {
  it.each([
    ["a 5-digit PIN", { userId: USER_ID, pin: "12345" }],
    ["a letter in the PIN", { userId: USER_ID, pin: "12a4" }],
    ["a non-uuid user", { userId: "x", pin: PIN }],
    ["an extra key", { userId: USER_ID, pin: PIN, remember: true }],
    ["a missing PIN", { userId: USER_ID }],
  ])("%s -> 400 without the PIN in the message", async (_label, body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain("12345");
    expect(text).not.toContain("12a4");
    expect(text).not.toContain(PIN);
    expect(privileged.beginPinLogin).not.toHaveBeenCalled();
    noAuthCall();
  });

  it("text/plain -> 415", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/auth/pin", {
        method: "POST",
        headers: { "content-type": "text/plain", cookie: deviceCookie() },
        body: "x",
      }),
    );
    expect(response.status).toBe(415);
    noAuthCall();
  });
});
