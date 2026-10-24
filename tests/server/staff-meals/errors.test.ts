import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapStaffMealDbError } from "@/server/staff-meals/errors";

const map = (code: string, message: string) => mapStaffMealDbError({ code, message });

describe("mapStaffMealDbError (plan §3.4)", () => {
  it.each([
    ["staff_meal_already_confirmed", 409],
    ["staff_meal_rule_inactive", 409],
    ["rules_limit", 409],
    ["portions_insufficient", 409],
    ["count_invalid", 422],
    ["staff_meal_target_invalid", 422],
    ["unit_mismatch", 422],
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

  it("words the already confirmed message as the screen shows it", () => {
    expect(map("P0001", "staff_meal_already_confirmed")).toMatchObject({
      message: "Già confermato per oggi.",
    });
  });

  it("23505 on the day key is the same 409 as the pre-check", () => {
    const mapped = map(
      "23505",
      'duplicate key value violates unique constraint "staff_meal_confirmation_day_uq"',
    ) as ApiError;
    expect([mapped.status, mapped.code]).toEqual([409, "staff_meal_already_confirmed"]);
    expect(mapped.message).toBe("Già confermato per oggi.");
  });

  it("P0002 staff_meal_rule_not_found is a 404 not_found; any other P0002 too", () => {
    const rule = map("P0002", "staff_meal_rule_not_found") as ApiError;
    expect([rule.status, rule.code, rule.message]).toEqual([
      404,
      "not_found",
      "Regola non trovata.",
    ]);
    const other = map("P0002", "whatever") as ApiError;
    expect([other.status, other.code]).toEqual([404, "not_found"]);
  });

  it("42501 is a 403 and invalid_request a 400, without the database text", () => {
    const forbidden = map("42501", "permission denied: needs owner") as ApiError;
    expect([forbidden.status, forbidden.code]).toEqual([403, "forbidden"]);
    expect(forbidden.message).not.toContain("permission denied");
    const bad = map("P0001", "invalid_request") as ApiError;
    expect([bad.status, bad.code]).toEqual([400, "invalid_request"]);
  });

  it("anything unknown is a plain Error with the SQLSTATE only", () => {
    const secret = "SEGRETO Ragù";
    for (const [code, message] of [
      ["23505", `other index ${secret}`],
      ["XX000", secret],
      ["P0001", secret],
    ] as const) {
      const mapped = map(code, message);
      expect(mapped).not.toBeInstanceOf(ApiError);
      expect(mapped.message).toBe(`Unexpected database error ${code}`);
    }
    expect(mapStaffMealDbError({ message: "x" }).message).toBe(
      "Unexpected database error (no code)",
    );
  });
});
