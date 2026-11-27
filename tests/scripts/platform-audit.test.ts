import { describe, expect, it, vi } from "vitest";
import {
  AUDIT_NOT_WRITTEN,
  AuditNotWrittenError,
  recordScriptRun,
} from "../../scripts/lib/platform-audit";

// SP3 step 5 (plan 3.9.2): the helper every state-changing script calls after its own change succeeded. It calls platform_record_script_run once and never reports a raw error.
const TENANT = "11111111-1111-4111-8111-111111111111";

function admin(answer: { data: unknown; error: { message: string; code?: string } | null }) {
  return { rpc: vi.fn(async (..._a: unknown[]) => answer) };
}

describe("recordScriptRun", () => {
  it("calls platform_record_script_run once with the action, the tenant and the detail", async () => {
    const a = admin({ data: 41, error: null });
    await recordScriptRun(a, "script.create_tenant", TENANT, { tenantId: TENANT });
    expect(a.rpc).toHaveBeenCalledTimes(1);
    expect(a.rpc).toHaveBeenCalledWith("platform_record_script_run", {
      p_action: "script.create_tenant",
      p_tenant: TENANT,
      p_detail: { tenantId: TENANT },
    });
  });

  it("passes a null tenant for a platform-wide row", async () => {
    const a = admin({ data: 1, error: null });
    await recordScriptRun(a, "script.mfa_reset", null, { appUserId: TENANT });
    expect(a.rpc).toHaveBeenCalledWith("platform_record_script_run", {
      p_action: "script.mfa_reset",
      p_tenant: null,
      p_detail: { appUserId: TENANT },
    });
  });

  it("throws AuditNotWrittenError with the fixed text and the code only, never the raw message or the detail", async () => {
    const a = admin({
      data: null,
      error: { message: "boom someone@example.test", code: "23514" },
    });
    const failure = await recordScriptRun(a, "script.create_tenant", TENANT, {
      tenantId: TENANT,
    }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AuditNotWrittenError);
    const message = (failure as Error).message;
    expect(message).toBe(`${AUDIT_NOT_WRITTEN} (23514)`);
    expect(message).not.toContain("@");
    expect(message).not.toContain(TENANT);
  });

  it("shows one of our own fixed error names as it is", async () => {
    const a = admin({ data: null, error: { message: "invalid_script_action", code: "22023" } });
    await expect(recordScriptRun(a, "script.x", null, {})).rejects.toThrow(
      `${AUDIT_NOT_WRITTEN} (invalid_script_action)`,
    );
  });

  it("an answer that is not a row id is refused, not accepted", async () => {
    for (const data of [null, "x", 1.5, 0, -3, { id: 1 }]) {
      const a = admin({ data, error: null });
      await expect(recordScriptRun(a, "script.create_tenant", null, {})).rejects.toThrow(
        `${AUDIT_NOT_WRITTEN} (unexpected_answer)`,
      );
    }
  });

  it("an error without a code is reported as unknown_error", async () => {
    const a = admin({ data: null, error: { message: "Some Raw Message" } });
    await expect(recordScriptRun(a, "script.create_tenant", null, {})).rejects.toThrow(
      `${AUDIT_NOT_WRITTEN} (unknown_error)`,
    );
  });

  it("a client that throws instead of answering is reported with the fixed text only", async () => {
    const a = {
      rpc: vi.fn(async (..._a: unknown[]) => {
        throw new Error("network down for someone@example.test");
      }),
    };
    const failure = await recordScriptRun(a, "script.create_tenant", null, {}).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(AuditNotWrittenError);
    expect((failure as Error).message).toBe(`${AUDIT_NOT_WRITTEN} (unreachable)`);
  });
});
