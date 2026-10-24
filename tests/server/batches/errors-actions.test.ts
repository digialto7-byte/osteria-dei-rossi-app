import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapBatchDbError } from "@/server/batches/errors";

const map = (code: string, message: string) => mapBatchDbError({ code, message });

describe("mapBatchDbError, the M15 codes (plan §3.4)", () => {
  it.each([
    ["portions_insufficient", 409],
    ["batch_expired", 409],
    ["count_invalid", 422],
    ["reason_invalid", 422],
    ["portions_invalid", 422],
    ["shelf_life_invalid", 422],
    ["location_not_found", 422],
    ["location_required", 422],
    ["no_location", 422],
  ])("P0001 %s is %i with the same code and an Italian text", (code, status) => {
    const mapped = map("P0001", code) as ApiError;
    expect(mapped).toBeInstanceOf(ApiError);
    expect([mapped.status, mapped.code]).toEqual([status, code]);
    expect(mapped.message).toMatch(/[a-zà-ù]{3}/i);
    expect(mapped.message).not.toContain(code);
  });

  it("words the two messages the action forms show", () => {
    expect(map("P0001", "portions_insufficient")).toMatchObject({
      message: "Non ci sono abbastanza porzioni in questo lotto.",
    });
    expect(map("P0001", "batch_expired")).toMatchObject({
      message: "Il lotto è scaduto: non si può dividere.",
    });
  });

  it("P0002 batch_not_found is a 404 not_found", () => {
    const mapped = map("P0002", "batch_not_found") as ApiError;
    expect([mapped.status, mapped.code]).toEqual([404, "not_found"]);
  });

  it("23505 batch_lot_code_uq is still a 409 lot_code_conflict", () => {
    const mapped = map("23505", 'violates unique constraint "batch_lot_code_uq"') as ApiError;
    expect([mapped.status, mapped.code]).toEqual([409, "lot_code_conflict"]);
  });

  it("a code of the staff-meal functions is not a batch code", () => {
    const mapped = map("P0001", "staff_meal_already_confirmed");
    expect(mapped).not.toBeInstanceOf(ApiError);
    expect(mapped.message).toBe("Unexpected database error P0001");
  });
});
