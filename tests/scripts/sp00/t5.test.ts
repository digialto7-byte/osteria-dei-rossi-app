import { describe, expect, it, vi, type Mock } from "vitest";
import type { CaseReport } from "../../../scripts/lib/sp00/report";
import { runT5, type T5Deps } from "../../../scripts/lib/sp00/t5";

const TENANT = "11111111-1111-4111-8111-111111111111";
const refused = (status: number, code: string) => ({ status, code, userId: null });

type Mocked = { [K in keyof T5Deps]: Mock<T5Deps[K]> };

function makeDeps(overrides: Partial<T5Deps> = {}): Mocked {
  const base: T5Deps = {
    signUp: async () => refused(422, "signup_disabled"),
    otpForUnknown: async () => ({ status: 422, code: "otp_disabled", accepted: false }),
    anonymous: async () => ({ status: 422, code: "anonymous_provider_disabled", userId: null }),
    countUsers: async () => 7,
    findUserIdByEmail: async () => null,
    deleteUser: async () => ({ error: null }),
    createTenant: async () => TENANT,
    sendCode: async () => {},
    mailCode: async () => "123456",
    generateCode: async () => "654321",
    verifyCode: async () => ({ status: 200, claims: { tenant_id: TENANT, app_role: "owner" } }),
    newId: () => "a1b2c3d4-0000-4000-8000-123456789012",
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(base).map(([name, fn]) => [name, vi.fn(fn as (...args: never[]) => unknown)]),
  ) as unknown as Mocked;
}

const PREFLIGHT_OK: CaseReport = { id: "preflight", result: "pass", detail: { status: 200 } };
const byId = (cases: CaseReport[], id: string) => cases.find((c) => c.id === id);

describe("runT5", () => {
  it("passes a to e when sign-up, otp and anonymous are refused, the count is equal and the owner signs in", async () => {
    const deps = makeDeps();
    const { cases, cleanup } = await runT5(deps, "local", null);
    expect(cases.map((c) => [c.id, c.result])).toEqual([
      ["a", "pass"],
      ["b", "pass"],
      ["c", "pass"],
      ["d", "pass"],
      ["e", "pass"],
    ]);
    expect(byId(cases, "a")?.detail).toEqual({ status: 422, code: "signup_disabled" });
    expect(cleanup).toEqual({ created: 1, deleted: 0, kept: 1 });
  });

  it("counts users before a-c and after, and a sign-up address is a fresh example.test one", async () => {
    const counts = [7, 7];
    const deps = makeDeps({ countUsers: vi.fn(async () => counts.shift() ?? -1) });
    await runT5(deps, "local", null);
    expect(deps.countUsers).toHaveBeenCalledTimes(2);
    const email = (deps.signUp.mock.calls[0] as unknown as [string, string])[0];
    expect(email).toMatch(/@example\.test$/);
  });

  it("a sign-up that is accepted fails T5 and the created user is deleted at once", async () => {
    const deps = makeDeps({
      signUp: vi.fn(async () => ({ status: 200, code: null, userId: "u-9" })),
    });
    const { cases, cleanup } = await runT5(deps, "local", null);
    expect(byId(cases, "a")?.result).toBe("fail");
    expect(deps.deleteUser).toHaveBeenCalledWith("u-9");
    expect(cleanup).toEqual({ created: 2, deleted: 1, kept: 1 });
  });

  it("an accepted otp for an unknown address fails b and the user found by e-mail is deleted", async () => {
    const deps = makeDeps({
      otpForUnknown: vi.fn(async () => ({ status: 200, code: null, accepted: true })),
      findUserIdByEmail: vi.fn(async () => "u-5"),
    });
    const { cases, cleanup } = await runT5(deps, "local", null);
    expect(byId(cases, "b")?.result).toBe("fail");
    expect(deps.deleteUser).toHaveBeenCalledWith("u-5");
    expect(cleanup.deleted).toBe(1);
  });

  it("an accepted anonymous sign-in fails c and its user is deleted", async () => {
    const deps = makeDeps({
      anonymous: vi.fn(async () => ({ status: 200, code: null, userId: "u-3" })),
    });
    const { cases } = await runT5(deps, "temp", PREFLIGHT_OK);
    expect(byId(cases, "c")?.result).toBe("fail");
    expect(deps.deleteUser).toHaveBeenCalledWith("u-3");
  });

  it("a changed user count fails d with both numbers", async () => {
    const counts = [7, 8];
    const deps = makeDeps({ countUsers: vi.fn(async () => counts.shift() ?? -1) });
    const { cases } = await runT5(deps, "local", null);
    expect(byId(cases, "a")?.result).toBe("pass");
    expect(byId(cases, "d")).toEqual({ id: "d", result: "fail", detail: { before: 7, after: 8 } });
  });

  it("a 429 is inconclusive, not a fail", async () => {
    const deps = makeDeps({ signUp: vi.fn(async () => refused(429, "over_request_rate_limit")) });
    const { cases } = await runT5(deps, "local", null);
    expect(byId(cases, "a")).toEqual({
      id: "a",
      result: "inconclusive",
      detail: { status: 429, code: "over_request_rate_limit" },
    });
  });

  it("a failed preflight makes every case inconclusive and calls nothing", async () => {
    const deps = makeDeps();
    const failed: CaseReport = {
      id: "preflight",
      result: "inconclusive",
      detail: { status: 401, reason: "secret key not injected" },
    };
    const { cases, cleanup } = await runT5(deps, "temp", failed);
    expect(cases.map((c) => [c.id, c.result])).toEqual([
      ["a", "inconclusive"],
      ["b", "inconclusive"],
      ["c", "inconclusive"],
      ["d", "inconclusive"],
      ["e", "inconclusive"],
    ]);
    expect(byId(cases, "e")?.detail).toEqual({ reason: "preflight failed" });
    for (const fn of Object.values(deps))
      if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
    expect(cleanup).toEqual({ created: 0, deleted: 0, kept: 0 });
  });

  it("e makes 'SP0 Test T5' with an IT98 VAT and an example.test owner through createTenant", async () => {
    const deps = makeDeps();
    await runT5(deps, "local", null);
    const [input] = deps.createTenant.mock.calls[0] as unknown as [
      { name: string; vatNumber: string; ownerEmail: string; ownerName: string },
    ];
    expect(input.name).toBe("SP0 Test T5");
    expect(input.vatNumber).toMatch(/^IT98\d{9}$/);
    expect(input.ownerEmail).toMatch(/^[a-z0-9.-]+@example\.test$/);
  });

  it("local sends the code and reads it from the mail fake; temp uses generateLink only", async () => {
    const local = makeDeps();
    await runT5(local, "local", null);
    expect(local.sendCode).toHaveBeenCalledTimes(1);
    expect(local.mailCode).toHaveBeenCalledTimes(1);
    expect(local.generateCode).not.toHaveBeenCalled();
    expect(local.verifyCode.mock.calls[0]?.[1]).toBe("123456");

    const temp = makeDeps();
    await runT5(temp, "temp", PREFLIGHT_OK);
    expect(temp.generateCode).toHaveBeenCalledTimes(1);
    expect(temp.sendCode).not.toHaveBeenCalled();
    expect(temp.mailCode).not.toHaveBeenCalled();
    expect(temp.verifyCode.mock.calls[0]?.[1]).toBe("654321");
  });

  it("e fails when the signed-in token has no tenant claims or another tenant's", async () => {
    for (const claims of [{ aal: "aal1" }, { tenant_id: "22222222-2222-4222-8222-222222222222" }]) {
      const deps = makeDeps({ verifyCode: vi.fn(async () => ({ status: 200, claims })) });
      const { cases } = await runT5(deps, "local", null);
      expect(byId(cases, "e")?.result).toBe("fail");
    }
  });

  it("e fails when verifyOtp is refused, recording the status", async () => {
    const deps = makeDeps({ verifyCode: vi.fn(async () => ({ status: 403, claims: null })) });
    const { cases } = await runT5(deps, "local", null);
    expect(byId(cases, "e")).toEqual({ id: "e", result: "fail", detail: { status: 403 } });
  });

  it("an exception in a case is reported as inconclusive with the error name only, and the later cases still run", async () => {
    const deps = makeDeps({
      anonymous: vi.fn(async () => {
        throw new TypeError("fetch failed for https://x.supabase.co");
      }),
    });
    const { cases } = await runT5(deps, "local", null);
    expect(byId(cases, "c")).toEqual({
      id: "c",
      result: "inconclusive",
      detail: { reason: "request failed", error: "TypeError" },
    });
    expect(byId(cases, "e")?.result).toBe("pass");
  });

  it("a user count that cannot be read makes d inconclusive with the error name, and a to c still run", async () => {
    const deps = makeDeps({
      countUsers: vi.fn(async () => {
        throw new RangeError("boom");
      }),
    });
    const { cases } = await runT5(deps, "local", null);
    expect(byId(cases, "d")).toEqual({
      id: "d",
      result: "inconclusive",
      detail: { reason: "user count unavailable", error: "RangeError" },
    });
    expect(byId(cases, "a")?.result).toBe("pass");
  });

  it("refuses to run on the temporary project without a preflight result", async () => {
    await expect(runT5(makeDeps(), "temp", null)).rejects.toThrow(/preflight/);
  });

  it("a user that cannot be deleted fails the check through a 'cleanup' case", async () => {
    const deps = makeDeps({
      signUp: vi.fn(async () => ({ status: 200, code: null, userId: "u-9" })),
      deleteUser: vi.fn(async () => ({ error: { message: "nope" } })),
    });
    const { cases } = await runT5(deps, "local", null);
    expect(byId(cases, "cleanup")).toEqual({
      id: "cleanup",
      result: "fail",
      detail: { undeleted: 1 },
    });
  });

  it("puts no address, URL or token into any case", async () => {
    const deps = makeDeps();
    const { cases } = await runT5(deps, "local", null);
    expect(JSON.stringify(cases)).not.toMatch(/@|https?:|eyJ/);
  });

  describe("only the codes that mean the feature is off count as refused", () => {
    it.each([
      ["a", "signUp", 400, "email_address_invalid"],
      ["a", "signUp", 422, "validation_failed"],
      ["a", "signUp", 422, "otp_disabled"],
      ["b", "otpForUnknown", 400, "email_address_invalid"],
      ["b", "otpForUnknown", 422, "validation_failed"],
      ["b", "otpForUnknown", 422, "anonymous_provider_disabled"],
      ["c", "anonymous", 400, "validation_failed"],
      ["c", "anonymous", 422, "signup_disabled"],
    ] as const)(
      "case %s with %s answering %i %s is inconclusive and carries the code",
      async (id, dep, status, code) => {
        const answer =
          dep === "otpForUnknown"
            ? { status, code, accepted: false }
            : { status, code, userId: null };
        const deps = makeDeps({ [dep]: async () => answer } as Partial<T5Deps>);
        const { cases } = await runT5(deps, "local", null);
        expect(byId(cases, id)).toEqual({ id, result: "inconclusive", detail: { status, code } });
      },
    );

    it("a refusal with no code at all is inconclusive, not a pass", async () => {
      const deps = makeDeps({ signUp: async () => ({ status: 400, code: null, userId: null }) });
      expect(byId((await runT5(deps, "local", null)).cases, "a")?.result).toBe("inconclusive");
    });

    it.each([
      ["a", "signUp", { status: 422, code: "signup_disabled", userId: null }],
      ["b", "otpForUnknown", { status: 422, code: "signup_disabled", accepted: false }],
      ["b", "otpForUnknown", { status: 422, code: "otp_disabled", accepted: false }],
      ["c", "anonymous", { status: 422, code: "anonymous_provider_disabled", userId: null }],
    ] as const)("case %s passes on its own off-switch code (%j)", async (id, dep, answer) => {
      const deps = makeDeps({ [dep]: async () => answer } as Partial<T5Deps>);
      expect(byId((await runT5(deps, "local", null)).cases, id)?.result).toBe("pass");
    });
  });
});
