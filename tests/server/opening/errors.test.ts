import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapOpeningDbError } from "@/server/opening/errors";

// Opening stock step 13 (plan §3.9 error map): every SQL code to its status and an Italian message; the database message
// never reaches the client.
const map = (code: string, message: string, details: string | null = null) =>
  mapOpeningDbError({ code, message, details });

describe("mapOpeningDbError", () => {
  it.each([
    "opening_draft_changed",
    "opening_location_counted",
    "opening_count_open",
    "opening_draft_not_empty",
    "already_reversed",
    "opening_request_reused",
  ])("%s is a 409", (code) => {
    const e = map("P0001", code, code === "opening_location_counted" ? "2026-12-15" : null);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(409);
    expect((e as ApiError).code).toBe(code);
    expect((e as ApiError).message).not.toContain(code);
  });

  it.each([
    "opening_qty_invalid",
    "opening_cost_invalid",
    "opening_line_duplicate",
    "opening_draft_full",
    "opening_date_in_future",
    "opening_date_too_old",
    "opening_date_after_receipt",
    "opening_reason_invalid",
    "ingredient_not_stock",
    "location_not_found",
  ])("%s is a 422", (code) => {
    const e = map("P0001", code, code === "opening_date_after_receipt" ? "2026-12-03" : null);
    expect((e as ApiError).status).toBe(422);
    expect((e as ApiError).code).toBe(code);
  });

  it("passes the SQL detail date through as details.date, and words it in the message (AT4)", () => {
    const e = map("P0001", "opening_date_after_receipt", "2026-12-03") as ApiError;
    expect(e.details).toEqual({ date: "2026-12-03" });
    expect(e.message).toBe("La data deve essere prima della prima fattura ricevuta (3 dic).");
    const c = map("P0001", "opening_location_counted", "2026-12-15") as ApiError;
    expect(c.details).toEqual({ date: "2026-12-15" });
    expect(c.message).toContain("15 dic");
  });

  it("names the duplicated ingredient", () => {
    const e = map(
      "P0001",
      "opening_line_duplicate",
      "1a000000-0000-4000-8000-000000000001",
    ) as ApiError;
    expect(e.details).toEqual({ ingredientId: "1a000000-0000-4000-8000-000000000001" });
  });

  it("42501 is a 403, 22023 a 400, P0002 a 404", () => {
    expect(
      (map("42501", "permission denied: opening stock needs owner or admin") as ApiError).status,
    ).toBe(403);
    expect((map("22023", "invalid_request") as ApiError).status).toBe(400);
    expect((map("P0002", "opening_not_found") as ApiError).status).toBe(404);
    expect((map("P0002", "ingredient_not_found") as ApiError).status).toBe(404);
  });

  it("anything else is a plain Error naming the SQLSTATE only", () => {
    const e = map("23505", "duplicate key value violates unique constraint secret_name");
    expect(e).not.toBeInstanceOf(ApiError);
    expect(e.message).toBe("Unexpected database error 23505");
    expect((map("P0001", "something_new") as Error).message).toBe(
      "Unexpected database error P0001",
    );
  });
});
