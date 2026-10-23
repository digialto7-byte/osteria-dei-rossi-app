import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ADR-010 D1-A: the one module outside cron that holds the secret-key client. These tests pin its
// export list (a change needs a matching edit here), its argument validation, and that it never
// logs or returns an argument value.

const admin = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: {
    admin: {
      createUser: vi.fn(),
      updateUserById: vi.fn(),
      getUserById: vi.fn(),
      deleteUser: vi.fn(),
    },
  },
}));

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => admin }));

import * as privileged from "@/server/staff-auth/privileged";

const HASH = "a".repeat(64);
const HASH2 = "b".repeat(64);
const USER = "11111111-1111-4111-8111-111111111111";
const AUTH = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const PASSWORD = "p".repeat(43);
const EMAIL = `staff-${USER}@staff.invalid`;

const EXPORTS = [
  "beginPinLogin",
  "finishPinLogin",
  "redeemEnrolmentCode",
  "deviceStaffList",
  "createStaffAuthUser",
  "setStaffAuthPassword",
  "deleteOrphanStaffAuthUser",
];

const logs: unknown[][] = [];
beforeEach(() => {
  logs.length = 0;
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => void logs.push(args));
  }
  admin.rpc.mockReset().mockResolvedValue({ data: { status: "ok" }, error: null });
  admin.auth.admin.createUser
    .mockReset()
    .mockResolvedValue({ data: { user: { id: AUTH } }, error: null });
  admin.auth.admin.updateUserById.mockReset().mockResolvedValue({ data: {}, error: null });
  admin.auth.admin.getUserById
    .mockReset()
    .mockResolvedValue({ data: { user: { id: AUTH, email: EMAIL } }, error: null });
  admin.auth.admin.deleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
});
afterEach(() => vi.restoreAllMocks());

const untouched = () => {
  expect(admin.rpc).not.toHaveBeenCalled();
  for (const method of Object.values(admin.auth.admin)) expect(method).not.toHaveBeenCalled();
};

describe("export list (ADR-010 condition 1 and 3)", () => {
  it("exports exactly the seven planned functions and nothing else", () => {
    expect(Object.keys(privileged).sort()).toEqual([...EXPORTS].sort());
    for (const name of EXPORTS) {
      expect(typeof (privileged as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("the source declares the same exports (a type, class, default or re-export fails here)", () => {
    const source = readFileSync("src/server/staff-auth/privileged.ts", "utf8");
    const declared = [...source.matchAll(/^export\s+(.*)$/gm)].map((match) => match[1] ?? "");
    expect(declared.every((text) => /^async function \w+/.test(text))).toBe(true);
    expect(declared.map((text) => /^async function (\w+)/.exec(text)?.[1]).sort()).toEqual(
      [...EXPORTS].sort(),
    );
    expect(source).not.toMatch(/export\s*\{|export\s*\*|export\s+default/);
  });

  it("imports server-only and never logs", () => {
    const source = readFileSync("src/server/staff-auth/privileged.ts", "utf8");
    expect(source).toMatch(/^import "server-only";/m);
    expect(source).not.toMatch(/console\.|reportError|process\.env/);
  });
});

describe("pre-login procedures", () => {
  it("beginPinLogin calls pin_login_begin once with the token hash and user", async () => {
    admin.rpc.mockResolvedValue({
      data: { status: "proceed", attemptId: ATTEMPT, authEmail: EMAIL },
      error: null,
    });
    await expect(privileged.beginPinLogin(HASH, USER)).resolves.toEqual({
      status: "proceed",
      attemptId: ATTEMPT,
      authEmail: EMAIL,
    });
    expect(admin.rpc.mock.calls).toEqual([
      ["pin_login_begin", { p_token_hash: HASH, p_user: USER }],
    ]);
  });

  it("finishPinLogin passes the outcome and the auth session (null unless success)", async () => {
    await privileged.finishPinLogin(ATTEMPT, "success", SESSION);
    await privileged.finishPinLogin(ATTEMPT, "failure", null);
    await privileged.finishPinLogin(ATTEMPT, "error", null);
    expect(admin.rpc.mock.calls).toEqual([
      ["pin_login_finish", { p_attempt: ATTEMPT, p_outcome: "success", p_auth_session: SESSION }],
      ["pin_login_finish", { p_attempt: ATTEMPT, p_outcome: "failure", p_auth_session: null }],
      ["pin_login_finish", { p_attempt: ATTEMPT, p_outcome: "error", p_auth_session: null }],
    ]);
  });

  it("redeemEnrolmentCode and deviceStaffList call their procedure once", async () => {
    await privileged.redeemEnrolmentCode(HASH, HASH2, "c".repeat(64));
    await privileged.deviceStaffList(HASH);
    expect(admin.rpc.mock.calls).toEqual([
      [
        "redeem_enrolment_code",
        { p_code_hash: HASH, p_token_hash: HASH2, p_ip_hash: "c".repeat(64) },
      ],
      ["device_staff_list", { p_token_hash: HASH }],
    ]);
  });

  it.each([
    ["a short token hash", () => privileged.beginPinLogin("abc", USER)],
    ["an upper-case token hash", () => privileged.beginPinLogin("A".repeat(64), USER)],
    ["a non-uuid user", () => privileged.beginPinLogin(HASH, "not-a-uuid")],
    ["a non-uuid attempt", () => privileged.finishPinLogin("x", "failure", null)],
    ["an unknown outcome", () => privileged.finishPinLogin(ATTEMPT, "pending" as never, null)],
    ["a success without a session", () => privileged.finishPinLogin(ATTEMPT, "success", null)],
    ["a session on a failure", () => privileged.finishPinLogin(ATTEMPT, "failure", SESSION)],
    ["a bad code hash", () => privileged.redeemEnrolmentCode("zz", HASH, HASH)],
    ["a bad ip hash", () => privileged.redeemEnrolmentCode(HASH, HASH, "unknown")],
    ["a bad device hash", () => privileged.deviceStaffList("nope")],
  ])("%s throws before any call", async (_label, call) => {
    await expect(call()).rejects.toThrow();
    untouched();
  });

  it("a procedure error becomes a value-free error with the SQLSTATE", async () => {
    admin.rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: `bad value ${HASH} ${USER}` },
    });
    const error = await privileged.beginPinLogin(HASH, USER).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe("22023");
    expect(String((error as Error).message)).not.toContain(HASH);
    expect(String((error as Error).message)).not.toContain(USER);
  });

  it("a rejected call (network) is reported without the cause's text", async () => {
    admin.rpc.mockRejectedValue(new Error(`fetch failed for ${HASH}`));
    const error = await privileged.deviceStaffList(HASH).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain(HASH);
  });
});

describe("Auth admin calls", () => {
  it("createStaffAuthUser creates a confirmed synthetic user with no metadata", async () => {
    await expect(privileged.createStaffAuthUser(USER, PASSWORD)).resolves.toEqual({ authId: AUTH });
    expect(admin.auth.admin.createUser.mock.calls).toEqual([
      [{ email: EMAIL, password: PASSWORD, email_confirm: true }],
    ]);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("createStaffAuthUser rejects a bad id or a password that is not a derived value", async () => {
    await expect(privileged.createStaffAuthUser("nope", PASSWORD)).rejects.toThrow();
    await expect(privileged.createStaffAuthUser(USER, "4827")).rejects.toThrow();
    await expect(privileged.createStaffAuthUser(USER, "")).rejects.toThrow();
    untouched();
  });

  it("createStaffAuthUser: an Auth error carries status and code only", async () => {
    admin.auth.admin.createUser.mockResolvedValue({
      data: { user: null },
      error: { status: 422, code: "email_exists", message: `dup ${EMAIL} ${PASSWORD}` },
    });
    const error = await privileged.createStaffAuthUser(USER, PASSWORD).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 422, code: "email_exists" });
    expect(JSON.stringify(error)).not.toContain(PASSWORD);
    expect(String((error as Error).message)).not.toContain(PASSWORD);
    expect(String((error as Error).message)).not.toContain(EMAIL);
    expect(logs).toEqual([]);
  });

  it("createStaffAuthUser fails when Auth answers without a user", async () => {
    admin.auth.admin.createUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(privileged.createStaffAuthUser(USER, PASSWORD)).rejects.toThrow();
  });

  it("setStaffAuthPassword updates only the password", async () => {
    await privileged.setStaffAuthPassword(AUTH, PASSWORD);
    expect(admin.auth.admin.updateUserById.mock.calls).toEqual([[AUTH, { password: PASSWORD }]]);
  });

  it("setStaffAuthPassword validates its input and reports errors without values", async () => {
    await expect(privileged.setStaffAuthPassword("nope", PASSWORD)).rejects.toThrow();
    await expect(privileged.setStaffAuthPassword(AUTH, "1234")).rejects.toThrow();
    untouched();
    admin.auth.admin.updateUserById.mockResolvedValue({
      data: {},
      error: { status: 500, code: "unexpected_failure", message: PASSWORD },
    });
    const error = await privileged.setStaffAuthPassword(AUTH, PASSWORD).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 500, code: "unexpected_failure" });
    expect(String((error as Error).message)).not.toContain(PASSWORD);
    expect(logs).toEqual([]);
  });

  it("deleteOrphanStaffAuthUser deletes a synthetic staff user", async () => {
    await expect(privileged.deleteOrphanStaffAuthUser(AUTH)).resolves.toBe(true);
    expect(admin.auth.admin.getUserById.mock.calls).toEqual([[AUTH]]);
    expect(admin.auth.admin.deleteUser.mock.calls).toEqual([[AUTH]]);
  });

  it.each([["owner@example.com"], ["staffer@staff.invalid"], ["staff-x@example.com"], [null]])(
    "deleteOrphanStaffAuthUser refuses %s and deletes nothing",
    async (email) => {
      admin.auth.admin.getUserById.mockResolvedValue({
        data: { user: { id: AUTH, email } },
        error: null,
      });
      await expect(privileged.deleteOrphanStaffAuthUser(AUTH)).resolves.toBe(false);
      expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    },
  );

  it("deleteOrphanStaffAuthUser: unknown user -> false; a bad id throws before any call", async () => {
    admin.auth.admin.getUserById.mockResolvedValue({
      data: { user: null },
      error: { status: 404, code: "user_not_found", message: "x" },
    });
    await expect(privileged.deleteOrphanStaffAuthUser(AUTH)).resolves.toBe(false);
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    admin.auth.admin.getUserById.mockClear();
    await expect(privileged.deleteOrphanStaffAuthUser("nope")).rejects.toThrow();
    expect(admin.auth.admin.getUserById).not.toHaveBeenCalled();
  });

  it("deleteOrphanStaffAuthUser: a failing delete or lookup throws a value-free error", async () => {
    admin.auth.admin.deleteUser.mockResolvedValue({
      data: {},
      error: { status: 500, code: "unexpected_failure", message: EMAIL },
    });
    const error = await privileged.deleteOrphanStaffAuthUser(AUTH).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 500, code: "unexpected_failure" });
    expect(String((error as Error).message)).not.toContain(EMAIL);
    admin.auth.admin.getUserById.mockResolvedValue({
      data: { user: null },
      error: { status: 500, code: "unexpected_failure", message: "x" },
    });
    await expect(privileged.deleteOrphanStaffAuthUser(AUTH)).rejects.toMatchObject({ status: 500 });
  });

  it("never logs an argument value, on success or on a thrown admin error", async () => {
    await privileged.createStaffAuthUser(USER, PASSWORD);
    await privileged.setStaffAuthPassword(AUTH, PASSWORD);
    await privileged.beginPinLogin(HASH, USER);
    admin.auth.admin.createUser.mockRejectedValue(new Error(PASSWORD));
    await privileged.createStaffAuthUser(USER, PASSWORD).catch(() => undefined);
    expect(logs).toEqual([]);
  });
});
