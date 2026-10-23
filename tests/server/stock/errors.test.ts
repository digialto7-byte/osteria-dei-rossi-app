import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapStockDbError } from "@/server/stock/errors";

const map = (code: string, message: string) => mapStockDbError({ code, message });

describe("mapStockDbError", () => {
  // Every P0001 code of the stock functions (plan §3.4): its status and the same code in the API.
  it.each([
    ["lot_empty", 409],
    ["insufficient_stock", 409],
    ["already_reversed", 409],
    ["movement_is_reversal", 409],
    ["movement_not_reversible", 409],
    ["transfer_already_used", 409],
    ["reason_invalid", 422],
    ["unit_mismatch", 422],
    ["qty_invalid", 422],
    ["ingredient_not_stock", 422],
    ["same_location", 422],
    ["location_required", 422],
    ["no_location", 422],
    ["location_not_found", 422],
    ["range_invalid", 422],
    ["range_too_long", 422],
  ])("P0001 %s is %i with the same code and an Italian text", (code, status) => {
    const mapped = map("P0001", code) as ApiError;
    expect(mapped).toBeInstanceOf(ApiError);
    expect(mapped.status).toBe(status);
    expect(mapped.code).toBe(code);
    expect(mapped.message).toMatch(/[a-zà-ù]{3}/i);
    expect(mapped.message).not.toContain(code);
  });

  it("uses the planned Italian wording for the messages the screens show", () => {
    expect(map("P0001", "lot_empty")).toMatchObject({
      message: "Il lotto scelto è vuoto in questa ubicazione.",
    });
    expect(map("P0001", "insufficient_stock")).toMatchObject({
      message: "In magazzino risulta meno di quanto vuoi spostare: fai prima un conteggio.",
    });
    expect(map("P0001", "transfer_already_used")).toMatchObject({
      message: "La merce spostata è già stata usata: non si può annullare lo spostamento.",
    });
    expect(map("P0001", "already_reversed")).toMatchObject({ message: "Movimento già annullato." });
    expect(map("P0001", "unit_mismatch")).toMatchObject({
      message: "Unità non compatibile con l'ingrediente.",
    });
  });

  it("P0001 invalid_request is a 400", () => {
    const mapped = map("P0001", "invalid_request") as ApiError;
    expect([mapped.status, mapped.code]).toEqual([400, "invalid_request"]);
  });

  it("P0002 is a 404 whatever the message, and 42501 a 403", () => {
    for (const message of [
      "ingredient_not_found",
      "lot_not_found",
      "movement_not_found",
      "location_not_found",
    ]) {
      const mapped = map("P0002", message) as ApiError;
      expect([mapped.status, mapped.code]).toEqual([404, "not_found"]);
    }
    const forbidden = map(
      "42501",
      "permission denied: stock needs owner, admin or chef",
    ) as ApiError;
    expect([forbidden.status, forbidden.code]).toEqual([403, "forbidden"]);
    expect(forbidden.message).not.toContain("permission denied");
  });

  it("23505 on stock_movement_reverses_uq is a 409 already_reversed", () => {
    const mapped = map(
      "23505",
      'duplicate key value violates unique constraint "stock_movement_reverses_uq"',
    ) as ApiError;
    expect([mapped.status, mapped.code]).toEqual([409, "already_reversed"]);
  });

  it("never sends the database message, and anything unknown is a plain Error with the SQLSTATE only", () => {
    const secret = "SEGRETO 12,5 kg Manzo";
    for (const [code, message] of [
      ["23505", `other index ${secret}`],
      ["XX000", secret],
      ["P0001", secret],
      ["22012", secret],
    ] as const) {
      const mapped = map(code, message);
      expect(mapped).not.toBeInstanceOf(ApiError);
      expect(mapped.message).toBe(`Unexpected database error ${code}`);
      expect(mapped.message).not.toContain("SEGRETO");
    }
    expect(mapStockDbError({ message: "x" }).message).toBe("Unexpected database error (no code)");
  });
});
