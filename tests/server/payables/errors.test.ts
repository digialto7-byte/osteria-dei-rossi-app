import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapPayableDbError } from "@/server/payables/errors";

const map = (code: string, message: string) => mapPayableDbError({ code, message });

describe("mapPayableDbError", () => {
  it.each([
    ["payable_paid_locked", 409],
    ["payable_not_paid", 409],
    ["payable_transition_invalid", 409],
    ["paid_on_required", 422],
    ["paid_on_not_allowed", 422],
    ["paid_on_future", 422],
    ["reason_required", 422],
    ["reversal_target_invalid", 422],
  ])("P0001 %s is %i with the same code and an Italian text", (code, status) => {
    const mapped = map("P0001", code) as ApiError;
    expect(mapped).toBeInstanceOf(ApiError);
    expect(mapped.status).toBe(status);
    expect(mapped.code).toBe(code);
    expect(mapped.message).toMatch(/[a-zà-ù]{3}/i);
    expect(mapped.message).not.toContain(code);
  });

  it("P0001 invalid_request is a 400", () => {
    const mapped = map("P0001", "invalid_request") as ApiError;
    expect([mapped.status, mapped.code]).toEqual([400, "invalid_request"]);
  });

  it("42501 is 403 and P0002 is 404", () => {
    expect((map("42501", "insufficient_privilege") as ApiError).status).toBe(403);
    expect((map("P0002", "not_found") as ApiError).status).toBe(404);
  });

  it("anything else is a plain Error naming only the SQLSTATE", () => {
    const secret = "Merce non conforme 1234,50";
    for (const [code, message] of [
      ["P0001", secret],
      ["23514", secret],
      ["XX000", secret],
    ]) {
      const mapped = map(code!, message!);
      expect(mapped).not.toBeInstanceOf(ApiError);
      expect(mapped.message).toBe(`Unexpected database error ${code}`);
      expect(mapped.message).not.toContain("Merce");
    }
    expect(mapPayableDbError({ message: "x" }).message).toBe("Unexpected database error (no code)");
  });
});
