import { describe, expect, it } from "vitest";
import { PAYABLE_REASON_MAX } from "@/server/payables/constants";
import { idParams, patchPayableBody } from "@/server/payables/schemas";

const parse = (body: unknown) => patchPayableBody.safeParse(body);

describe("patchPayableBody", () => {
  it("accepts each status on its own", () => {
    for (const status of ["open", "scheduled", "paid", "disputed"]) {
      expect(
        parse({ status, ...(status === "paid" ? { paidOn: "2026-10-20" } : {}) }).success,
      ).toBe(true);
    }
  });

  it("is strict: an unknown key is refused", () => {
    expect(parse({ status: "open", amount: 10 }).success).toBe(false);
  });

  it("refuses an unknown status", () => {
    expect(parse({ status: "cancelled" }).success).toBe(false);
  });

  it("refuses a paid date that is not an ISO calendar date", () => {
    for (const paidOn of ["20/10/2026", "2026-10-20T10:00:00Z", "2026-02-31", "", 5]) {
      expect(parse({ status: "paid", paidOn }).success).toBe(false);
    }
  });

  it("accepts a reason of 1 to 200 characters and refuses 201", () => {
    expect(parse({ status: "disputed", reason: "x" }).success).toBe(true);
    expect(parse({ status: "disputed", reason: "x".repeat(PAYABLE_REASON_MAX) }).success).toBe(
      true,
    );
    expect(parse({ status: "disputed", reason: "x".repeat(PAYABLE_REASON_MAX + 1) }).success).toBe(
      false,
    );
  });

  it("refuses an empty or blank reason", () => {
    expect(parse({ status: "disputed", reason: "" }).success).toBe(false);
    expect(parse({ status: "disputed", reason: "   " }).success).toBe(false);
  });

  it("trims the reason", () => {
    const parsed = parse({ status: "disputed", reason: "  Merce rovinata  " });
    expect(parsed.success && parsed.data.reason).toBe("Merce rovinata");
  });

  describe("reversal", () => {
    it("is accepted for status open with a reason", () => {
      expect(
        parse({ status: "open", reversal: true, reason: "Errore di registrazione" }).success,
      ).toBe(true);
    });

    it("needs a reason", () => {
      expect(parse({ status: "open", reversal: true }).success).toBe(false);
    });

    it("needs status open", () => {
      for (const status of ["scheduled", "paid", "disputed"]) {
        expect(parse({ status, reversal: true, reason: "Errore" }).success).toBe(false);
      }
    });

    it("can only be true", () => {
      expect(parse({ status: "open", reversal: false, reason: "Errore" }).success).toBe(false);
    });
  });
});

describe("idParams", () => {
  it("accepts a uuid and refuses anything else", () => {
    expect(idParams.safeParse({ id: "90000000-0000-4000-8000-000000000001" }).success).toBe(true);
    expect(idParams.safeParse({ id: "not-a-uuid" }).success).toBe(false);
    expect(idParams.safeParse({}).success).toBe(false);
  });
});
