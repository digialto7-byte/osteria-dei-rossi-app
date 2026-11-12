import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  OWNER_CLAIMS,
  type FakeClaims,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// M25a step 8: GET and POST /api/me/password, the one route for a first, a forgotten and a changed password.
let client: FakeSupabase;
let verifier: FakeSupabase;
const createVerifierClient = vi.fn(() => verifier);
const reportError = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/supabase/verifier", () => ({ createVerifierClient: () => createVerifierClient() }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/me/password/route");

const NOW = Date.parse("2026-11-20T10:00:00Z");
const EMAIL = "titolare.demo@example.test";
const GOOD = "una frase lunga per il locale";
const CURRENT = "la password di prima 42";
const ago = (seconds: number) => NOW / 1000 - seconds;
const claims = (method: string, secondsAgo: number, extra: FakeClaims = {}): FakeClaims => ({
  ...OWNER_CLAIMS,
  email: EMAIL,
  amr: [{ method, timestamp: ago(secondsAgo) }],
  ...extra,
});
const RECENT_LINK = claims("otp", 120);
const OLD_PASSWORD = claims("password", 3 * 86_400);

const get = () => route.GET(new Request("http://localhost:3000/api/me/password"));
const post = (body: unknown) =>
  route.POST(jsonRequest("http://localhost:3000/api/me/password", body));
const authError = (status: number, code: string) => ({
  data: { session: null, user: null },
  error: { status, code, name: "AuthApiError", message: `${code} ${EMAIL} ${GOOD}` },
});
const LIVE = { staff_session_active: [{ data: true, error: null }] };
const order = (spy: { mock: { invocationCallOrder: number[] } }) =>
  spy.mock.invocationCallOrder[0]!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  reportError.mockReset();
  createVerifierClient.mockClear();
  verifier = fakeSupabase();
});
afterEach(() => vi.useRealTimers());

describe("GET /api/me/password", () => {
  it("reports a recent link sign-in", async () => {
    client = fakeSupabase({ claims: RECENT_LINK });
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      signInMethod: "link",
      recentSignIn: true,
      recentUntil: new Date((ago(120) + 600) * 1000).toISOString(),
      minLength: 10,
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("reports an old password sign-in", async () => {
    client = fakeSupabase({ claims: OLD_PASSWORD });
    expect(await (await get()).json()).toEqual({
      signInMethod: "password",
      recentSignIn: false,
      recentUntil: null,
      minLength: 10,
    });
  });

  it("refuses a chef and a PIN session with 403", async () => {
    client = fakeSupabase({ claims: claimsFor("chef") });
    expect((await get()).status).toBe(403);
    client = fakeSupabase({ claims: { ...RECENT_LINK, login: "pin" }, rpc: LIVE });
    const response = await get();
    expect(response.status).toBe(403);
  });

  it("answers 401 without a session", async () => {
    client = fakeSupabase({ claims: null });
    expect((await get()).status).toBe(401);
  });
});

describe("POST /api/me/password, recent sign-in", () => {
  it("updates, signs in again with the new password, then ends the other sessions", async () => {
    client = fakeSupabase({ claims: RECENT_LINK });
    const response = await post({ newPassword: GOOD });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "saved", mfa: "none" });
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: GOOD });
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: GOOD });
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(order(client.auth.updateUser)).toBeLessThan(order(client.auth.signInWithPassword));
    expect(order(client.auth.signInWithPassword)).toBeLessThan(order(client.auth.signOut));
    expect(createVerifierClient).not.toHaveBeenCalled();
  });

  it("a failed re-sign-in is reported and does not undo the saved password", async () => {
    client = fakeSupabase({ claims: RECENT_LINK });
    client.auth.signInWithPassword.mockResolvedValueOnce(authError(500, "unexpected_failure"));
    expect((await post({ newPassword: GOOD })).status).toBe(200);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(String(reportError.mock.calls[0]?.[0])).not.toContain(GOOD);
  });
});

describe("POST /api/me/password, old sign-in", () => {
  it("asks for the current password and calls no Auth method without it", async () => {
    client = fakeSupabase({ claims: OLD_PASSWORD });
    const response = await post({ newPassword: GOOD });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("current_password_required");
    expect(client.auth.updateUser).not.toHaveBeenCalled();
    expect(createVerifierClient).not.toHaveBeenCalled();
  });

  it("a wrong current password gives 422 current_password_invalid and no update", async () => {
    client = fakeSupabase({ claims: OLD_PASSWORD });
    verifier.auth.signInWithPassword.mockResolvedValueOnce(authError(400, "invalid_credentials"));
    const response = await post({ newPassword: GOOD, currentPassword: "sbagliata sbagliata" });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("current_password_invalid");
    expect(verifier.auth.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: "sbagliata sbagliata",
    });
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it("the right current password is checked on the verifier, whose session is ended locally", async () => {
    client = fakeSupabase({ claims: OLD_PASSWORD });
    const response = await post({ newPassword: GOOD, currentPassword: CURRENT });
    expect(response.status).toBe(200);
    expect(verifier.auth.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: CURRENT,
    });
    expect(verifier.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(order(verifier.auth.signOut)).toBeLessThan(order(client.auth.updateUser));
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: GOOD });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "others" });
    // The cookie client never signed in with the current password.
    expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: GOOD });
  });

  it("a failed sign-out of the verifier is reported, without secrets, and the save still succeeds", async () => {
    client = fakeSupabase({ claims: OLD_PASSWORD });
    verifier.auth.signOut.mockResolvedValueOnce({
      error: authError(500, "unexpected_failure").error,
    });
    const response = await post({ newPassword: GOOD, currentPassword: CURRENT });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "saved", mfa: "none" });
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: GOOD });
    expect(reportError).toHaveBeenCalledTimes(1);
    const text = String(reportError.mock.calls[0]?.[0]);
    expect(text).toContain("verifier");
    expect(text).not.toContain(GOOD);
    expect(text).not.toContain(CURRENT);
    expect(text).not.toContain(EMAIL);
  });

  it("a verifier sign-out that throws is reported too, and the save still succeeds", async () => {
    client = fakeSupabase({ claims: OLD_PASSWORD });
    verifier.auth.signOut.mockRejectedValueOnce(new Error(`network ${CURRENT}`));
    const response = await post({ newPassword: GOOD, currentPassword: CURRENT });
    expect(response.status).toBe(200);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(String(reportError.mock.calls[0]?.[0])).not.toContain(CURRENT);
  });

  it("rate limiting while checking the current password gives 429", async () => {
    client = fakeSupabase({ claims: OLD_PASSWORD });
    verifier.auth.signInWithPassword.mockResolvedValueOnce(
      authError(429, "over_request_rate_limit"),
    );
    expect((await post({ newPassword: GOOD, currentPassword: CURRENT })).status).toBe(429);
  });
});

describe("POST /api/me/password, refusals", () => {
  it("a weak password gives 422 password_weak with the reason and calls no Auth method", async () => {
    client = fakeSupabase({ claims: RECENT_LINK });
    const response = await post({ newPassword: "Basketball" });
    expect(response.status).toBe(422);
    const body = (await response.json()).error;
    expect(body.code).toBe("password_weak");
    expect(body.details).toEqual({ reason: "common" });
    expect(client.auth.updateUser).not.toHaveBeenCalled();
    expect(createVerifierClient).not.toHaveBeenCalled();
  });

  it("checks the policy against the account's e-mail", async () => {
    client = fakeSupabase({ claims: RECENT_LINK });
    const response = await post({ newPassword: "titolare.demo2026" });
    expect((await response.json()).error.details).toEqual({ reason: "like_email" });
  });

  it("Auth's weak_password gives 422 password_weak; same_password gives 422 password_same", async () => {
    client = fakeSupabase({ claims: RECENT_LINK });
    client.auth.updateUser.mockResolvedValueOnce(authError(422, "weak_password"));
    const weak = await post({ newPassword: GOOD });
    expect(weak.status).toBe(422);
    expect((await weak.json()).error.code).toBe("password_weak");
    client = fakeSupabase({ claims: RECENT_LINK });
    client.auth.updateUser.mockResolvedValueOnce(authError(422, "same_password"));
    const same = await post({ newPassword: GOOD });
    expect((await same.json()).error.code).toBe("password_same");
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it("maps 429 and 5xx from updateUser", async () => {
    client = fakeSupabase({ claims: RECENT_LINK });
    client.auth.updateUser.mockResolvedValueOnce(authError(429, "over_request_rate_limit"));
    expect((await post({ newPassword: GOOD })).status).toBe(429);
    client = fakeSupabase({ claims: RECENT_LINK });
    client.auth.updateUser.mockResolvedValueOnce(authError(500, "unexpected_failure"));
    expect((await post({ newPassword: GOOD })).status).toBe(502);
  });

  it("refuses a chef and a PIN session with 403 before any Auth call", async () => {
    client = fakeSupabase({ claims: claimsFor("chef") });
    expect((await post({ newPassword: GOOD })).status).toBe(403);
    client = fakeSupabase({ claims: { ...RECENT_LINK, login: "pin" }, rpc: LIVE });
    expect((await post({ newPassword: GOOD })).status).toBe(403);
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });

  it("rejects an unknown key with 400", async () => {
    client = fakeSupabase({ claims: RECENT_LINK });
    expect((await post({ newPassword: GOOD, email: EMAIL })).status).toBe(400);
  });

  it("fails closed when the token carries no e-mail", async () => {
    client = fakeSupabase({ claims: { ...RECENT_LINK, email: undefined } });
    expect((await post({ newPassword: GOOD })).status).toBe(403);
    expect(client.auth.updateUser).not.toHaveBeenCalled();
  });
});

// P2-1 A11: the route signs in again here, which gives a fresh aal1 session. When the account has to pass the code, the reply says so and the screen goes to the code page.
describe("POST /api/me/password and the second factor", () => {
  it("replies mfa: challenge when the fresh session must be challenged (a verified factor, mode not off)", async () => {
    client = fakeSupabase({
      claims: RECENT_LINK,
      rpc: { mfa_gate: [{ data: "challenge", error: null }] },
    });
    const response = await post({ newPassword: GOOD });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "saved", mfa: "challenge" });
    // The question is asked after the new sign-in, on the fresh session.
    expect(order(client.auth.signInWithPassword)).toBeLessThan(
      client.rpc.mock.invocationCallOrder[0] ?? 0,
    );
    expect(client.rpc).toHaveBeenCalledWith("mfa_gate");
  });

  it("replies mfa: none for ok, for enrol and when Postgres cannot answer (the next API call decides)", async () => {
    for (const data of ["ok", "enrol", null]) {
      client = fakeSupabase({ claims: RECENT_LINK, rpc: { mfa_gate: [{ data, error: null }] } });
      expect(await (await post({ newPassword: GOOD })).json()).toEqual({
        status: "saved",
        mfa: "none",
      });
    }
    client = fakeSupabase({
      claims: RECENT_LINK,
      rpc: { mfa_gate: [{ data: null, error: { code: "XX000", message: `detail ${GOOD}` } }] },
    });
    expect(await (await post({ newPassword: GOOD })).json()).toEqual({
      status: "saved",
      mfa: "none",
    });
    expect(String(reportError.mock.calls.at(-1)?.[0])).toContain("XX000");
    expect(String(reportError.mock.calls.at(-1)?.[0])).not.toContain(GOOD);
  });
});
