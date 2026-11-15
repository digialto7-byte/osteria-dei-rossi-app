import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeSupabase } from "../../helpers/fake-supabase";

// SP3 step 9 (plan 3.3.5, 3.4.3): src/server/auth/account-mfa.ts calls the platform_mfa_* procedures where the venue's code calls mfa_*, and nothing else differs. These tests
// drive the module directly (the routes have their own file) and pin which procedure names it uses, in which order, and that the venue's defaults are untouched.
const report = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/observability/report", () => report);

const { getAccountMfa, challengeAccount, verifyAccountEnrolment, startAccountEnrolment } =
  await import("@/server/auth/account-mfa");
const { verifyEnrolment, assertAttemptAllowed } = await import("@/server/auth/mfa");

const F1 = "f0000000-0000-4000-8000-000000000001";
const CODE = "123456";
type Script = Record<string, { data: unknown; error: { code?: string; message: string } | null }[]>;
const ok = (data: unknown = null) => [{ data, error: null }];
const ALLOWED = { allowed: true, retryAfterSeconds: 0 };
let client: FakeSupabase;
const calls = () => client.rpc.mock.calls.map((c) => c[0]);
const sb = () => client as never;
const make = (rpc: Script) => {
  client = fakeSupabase({
    claims: { sub: "a6000000-0000-4000-8000-000000000001", aal: "aal1" },
    rpc,
  });
};
const verified = () => ({ data: { id: F1 }, error: null });

beforeEach(() => report.reportError.mockReset());

describe("account-mfa uses the platform procedures", () => {
  it("getAccountMfa asks platform_mfa_attempt_allowed first and nothing of the venue's", async () => {
    make({ platform_mfa_attempt_allowed: ok(ALLOWED) });
    const view = await getAccountMfa(sb());
    expect(view).toEqual({
      factors: [],
      currentLevel: "aal2",
      canAddFactor: true,
      lockedUntil: null,
    });
    expect(calls()).toEqual(["platform_mfa_attempt_allowed"]);
  });

  it("challengeAccount: the platform lock, one code check, the platform failure record at stage login", async () => {
    make({ platform_mfa_attempt_allowed: ok(ALLOWED), platform_mfa_record_failure: ok() });
    client.auth.mfa.challengeAndVerify.mockResolvedValue({
      data: null,
      error: { name: "AuthApiError", status: 400, code: "mfa_verification_failed", message: "x" },
    });
    await expect(challengeAccount(sb(), { factorId: F1, code: CODE })).rejects.toMatchObject({
      status: 422,
      code: "mfa_code_invalid",
    });
    expect(calls()).toEqual(["platform_mfa_attempt_allowed", "platform_mfa_record_failure"]);
    expect(client.rpc).toHaveBeenLastCalledWith("platform_mfa_record_failure", {
      p_stage: "login",
    });
  });

  it("challengeAccount refuses before any Auth call when the lock holds", async () => {
    make({ platform_mfa_attempt_allowed: ok({ allowed: false, retryAfterSeconds: 30 }) });
    await expect(challengeAccount(sb(), { factorId: F1, code: CODE })).rejects.toMatchObject({
      status: 429,
      code: "mfa_locked",
    });
    expect(client.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("verifyAccountEnrolment records platform_mfa_record_enrolled after the code check", async () => {
    make({ platform_mfa_attempt_allowed: ok(ALLOWED), platform_mfa_record_enrolled: ok(true) });
    client.auth.mfa.challengeAndVerify.mockResolvedValue(verified());
    const result = await verifyAccountEnrolment(sb(), F1, CODE);
    expect(result.currentLevel).toBe("aal2");
    expect(calls()).toEqual(["platform_mfa_attempt_allowed", "platform_mfa_record_enrolled"]);
  });

  it("startAccountEnrolment is the venue's enrolment with mfa_enrol_check answering for staff", async () => {
    make({ mfa_enrol_check: ok({ issuer: "Costì", friendlyName: "Principale" }) });
    client.auth.mfa.enroll.mockResolvedValue({
      data: {
        id: F1,
        totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg"/>', secret: "JBSWY3DPEHPK3PXP" },
      },
      error: null,
    });
    const reply = await startAccountEnrolment(sb(), "principale");
    expect(reply.factorId).toBe(F1);
    expect(client.auth.mfa.enroll).toHaveBeenCalledWith({
      factorType: "totp",
      friendlyName: "Principale",
      issuer: "Costì",
    });
    expect(calls()).toEqual(["mfa_enrol_check"]);
  });
});

describe("the venue's defaults are unchanged", () => {
  it("verifyEnrolment and assertAttemptAllowed still call the mfa_* procedures when no set is given", async () => {
    make({ mfa_attempt_allowed: ok(ALLOWED), mfa_record_enrolled: ok(true) });
    client.auth.mfa.challengeAndVerify.mockResolvedValue(verified());
    await assertAttemptAllowed(sb());
    await verifyEnrolment(sb(), F1, CODE);
    expect(calls()).toEqual(["mfa_attempt_allowed", "mfa_attempt_allowed", "mfa_record_enrolled"]);
  });
});
