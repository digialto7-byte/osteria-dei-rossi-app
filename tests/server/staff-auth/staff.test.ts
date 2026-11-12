import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeSupabase } from "../../helpers/fake-supabase";
import { derivePinPassword } from "@/server/staff-auth/derive";
import { StaffAuthCallError } from "@/server/staff-auth/errors";

// P2-1 A5 (F13, docs/plans/2026-11-12-p2-1-totp.md section 3.10): setStaffPin closes the PIN-change window. After the Auth call it tells Postgres how it ended
// (finish_pin_change success or failure), so an old-PIN session is ended and a failed change is recorded as failed.
const PEPPER = "test-pepper-not-a-secret-0123456789abcdef";
const ID = "11111111-1111-4111-8111-111111111111";
const AUTH = "22222222-2222-4222-8222-222222222222";
const privileged = vi.hoisted(() => ({
  createStaffAuthUser: vi.fn(),
  setStaffAuthPassword: vi.fn(),
  deleteOrphanStaffAuthUser: vi.fn(),
}));
const report = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/server/staff-auth/privileged", () => privileged);
vi.mock("@/lib/observability/report", () => report);

const { setStaffPin } = await import("@/server/staff-auth/staff");

const ok = (data: unknown = null) => [{ data, error: null }];
const fail = (code: string, message = "x") => [{ data: null, error: { code, message } }];
type Script = Record<string, { data: unknown; error: { code?: string; message: string } | null }[]>;
const FULL: Script = {
  prepare_pin_change: ok({ authId: AUTH }),
  record_pin_change: ok(),
  finish_pin_change: ok(),
};
let client: FakeSupabase;
const make = (script: Script) => {
  client = fakeSupabase({ claims: null, rpc: script });
};
const callNames = () => client.rpc.mock.calls.map((c) => c[0]);

beforeEach(() => {
  privileged.setStaffAuthPassword.mockReset();
  privileged.setStaffAuthPassword.mockResolvedValue(undefined);
  report.reportError.mockReset();
});

describe("setStaffPin and the PIN-change window (F13)", () => {
  it("calls finish_pin_change('success') after a good Auth call, and only then", async () => {
    make(FULL);
    await setStaffPin(client as never, ID, "7046", PEPPER);
    expect(callNames()).toEqual(["prepare_pin_change", "record_pin_change", "finish_pin_change"]);
    expect(client.rpc).toHaveBeenLastCalledWith("finish_pin_change", {
      p_user: ID,
      p_outcome: "success",
    });
    expect(privileged.setStaffAuthPassword).toHaveBeenCalledWith(
      AUTH,
      derivePinPassword(PEPPER, ID, "7046"),
    );
    expect(privileged.setStaffAuthPassword.mock.invocationCallOrder[0]).toBeLessThan(
      client.rpc.mock.invocationCallOrder[2] ?? 0,
    );
    expect(report.reportError).not.toHaveBeenCalled();
  });

  it("a failed Auth call: finish_pin_change('failure'), then the error (502) is thrown unchanged", async () => {
    make(FULL);
    privileged.setStaffAuthPassword.mockRejectedValue(
      new StaffAuthCallError("s", "unexpected_failure", 500),
    );
    await expect(setStaffPin(client as never, ID, "7046", PEPPER)).rejects.toMatchObject({
      status: 502,
    });
    expect(callNames()).toEqual(["prepare_pin_change", "record_pin_change", "finish_pin_change"]);
    expect(client.rpc).toHaveBeenLastCalledWith("finish_pin_change", {
      p_user: ID,
      p_outcome: "failure",
    });
  });

  it("a failing finish call after a failed Auth call is reported (code only) and the 502 is still thrown", async () => {
    make({ ...FULL, finish_pin_change: fail("XX000", "secret-looking detail 7046") });
    privileged.setStaffAuthPassword.mockRejectedValue(
      new StaffAuthCallError("s", "unexpected_failure", 500),
    );
    await expect(setStaffPin(client as never, ID, "7046", PEPPER)).rejects.toMatchObject({
      status: 502,
    });
    expect(report.reportError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(report.reportError.mock.calls)).not.toContain("7046");
    expect(JSON.stringify(report.reportError.mock.calls)).not.toContain("secret-looking");
  });

  it("a failing finish call after a good Auth call is reported (code only) and the change still succeeds", async () => {
    make({ ...FULL, finish_pin_change: fail("XX000", "secret-looking detail 7046") });
    await expect(setStaffPin(client as never, ID, "7046", PEPPER)).resolves.toBeUndefined();
    expect(report.reportError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(report.reportError.mock.calls)).not.toContain("7046");
    expect(JSON.stringify(report.reportError.mock.calls)).not.toContain("secret-looking");
  });

  it("record_pin_change failing: no Auth call and no finish call (nothing to close)", async () => {
    make({ ...FULL, record_pin_change: fail("XX000", "boom") });
    await expect(setStaffPin(client as never, ID, "7046", PEPPER)).rejects.toBeDefined();
    expect(callNames()).toEqual(["prepare_pin_change", "record_pin_change"]);
    expect(privileged.setStaffAuthPassword).not.toHaveBeenCalled();
  });

  it("a trivial PIN is refused before any call", async () => {
    make(FULL);
    await expect(setStaffPin(client as never, ID, "1234", PEPPER)).rejects.toBeDefined();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
