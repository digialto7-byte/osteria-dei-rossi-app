import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeSupabase } from "../../../helpers/fake-supabase";
import { derivePinPassword } from "@/server/staff-auth/derive";
import { StaffAuthCallError } from "@/server/staff-auth/errors";
import {
  ATTEMPT_ID,
  AUTH_EMAIL,
  AUTH_SESSION_ID,
  AUTH_USER_ID,
  DEVICE_TOKEN,
  deviceCookie,
  fakeJwt,
  PEPPER,
  PIN,
  postJson,
  USER_ID,
} from "./helpers";

// M11 acceptance test 5 (logs half): over every path of the PIN route, nothing written to the
// console or sent to the error reporter contains the PIN, the derived password or the device token.
process.env.PIN_PEPPER = PEPPER;
let client: FakeSupabase;
const privileged = vi.hoisted(() => ({
  beginPinLogin: vi.fn(),
  finishPinLogin: vi.fn(),
  redeemEnrolmentCode: vi.fn(),
  deviceStaffList: vi.fn(),
}));
const reported: unknown[] = [];
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reported.push(e) }));
vi.mock("@/server/staff-auth/privileged", () => privileged);

const { POST } = await import("@/app/api/auth/pin/route");

const logged: unknown[][] = [];
const PASSWORD = derivePinPassword(PEPPER, USER_ID, PIN);
const ME_ROW = {
  id: "a1000000-0000-4000-8000-00000000000a",
  display_name: "Cameriere Demo",
  role: "waiter",
};
const request = (body: unknown = { userId: USER_ID, pin: PIN }) =>
  postJson("/api/auth/pin", body, { cookie: deviceCookie() });
const signIn = () => client.auth.signInWithPassword;

const everything = (responses: string[]) =>
  JSON.stringify([
    logged,
    reported.map((e) => (e instanceof Error ? [e.name, e.message, e.stack, { ...e }] : e)),
    responses,
  ]);

beforeEach(() => {
  logged.length = 0;
  reported.length = 0;
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => void logged.push(args));
  }
  client = fakeSupabase({ claims: null, meRow: ME_ROW });
  for (const mock of Object.values(privileged)) mock.mockReset();
  privileged.beginPinLogin.mockResolvedValue({
    status: "proceed",
    attemptId: ATTEMPT_ID,
    authEmail: AUTH_EMAIL,
  });
  privileged.finishPinLogin.mockResolvedValue({ status: "ok", endsAt: "2026-10-25T00:00:00Z" });
  signIn().mockResolvedValue({
    data: {
      session: { access_token: fakeJwt({ session_id: AUTH_SESSION_ID, sub: AUTH_USER_ID }) },
    },
    error: null,
  });
});
afterEach(() => vi.restoreAllMocks());

describe("PIN route logging (AT5)", () => {
  it("never leaks the PIN, the password or the device token on any path", async () => {
    const responses: string[] = [];
    const run = async (body?: unknown) => responses.push(await (await POST(request(body))).text());

    await run(); // success

    signIn().mockResolvedValueOnce({
      data: { session: null },
      error: { status: 400, code: "invalid_credentials", message: `bad ${PASSWORD} ${PIN}` },
    });
    privileged.finishPinLogin.mockResolvedValueOnce({ status: "pin_invalid", attemptsLeft: 4 });
    await run(); // wrong PIN

    signIn().mockResolvedValueOnce({
      data: { session: null },
      error: { status: 500, code: "unexpected_failure", message: `boom ${PASSWORD}` },
    });
    privileged.finishPinLogin.mockResolvedValueOnce({ status: "auth_error" });
    await run(); // Auth error

    signIn().mockRejectedValueOnce(new Error(`network ${PASSWORD} ${PIN}`));
    privileged.finishPinLogin.mockResolvedValueOnce({ status: "auth_error" });
    await run(); // thrown Auth call

    privileged.finishPinLogin.mockRejectedValueOnce(
      new StaffAuthCallError("pin_login_finish", "XX000"),
    );
    await run(); // finish error

    // The real module's errors carry no argument value (privileged.test.ts); the route adds none.
    privileged.beginPinLogin.mockRejectedValueOnce(
      new StaffAuthCallError("pin_login_begin", "XX000"),
    );
    await run(); // begin error

    await run({ userId: USER_ID, pin: PIN, extra: PIN }); // Zod error
    await run({ userId: USER_ID, pin: `${PIN}9` }); // Zod error on the value

    const text = everything(responses);
    expect(text).not.toContain(PIN);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(DEVICE_TOKEN);
    // The paths really ran: the success, the failure and two reported 500s.
    expect(responses.length).toBe(8);
    expect(reported.length).toBeGreaterThan(0);
  });
});
