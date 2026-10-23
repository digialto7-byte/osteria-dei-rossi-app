import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapBatchDbError } from "@/server/batches/errors";

const map = (code: string, message: string, details?: string | null) =>
  mapBatchDbError({ code, message, details });
const BEEF = "1a000000-0000-4000-8000-00000000001a";
const ONION = "1b000000-0000-4000-8000-00000000001b";

describe("mapBatchDbError", () => {
  // Every P0001 code of the batch functions (plan §3.4): its status and the same code in the API.
  it.each([
    ["recipe_version_stale", 409],
    ["lot_empty", 409],
    ["recipe_not_batch", 422],
    ["recipe_inactive", 422],
    ["recipe_not_producible", 422],
    ["output_invalid", 422],
    ["portions_invalid", 422],
    ["shelf_life_invalid", 422],
    ["inputs_invalid", 422],
    ["input_duplicate", 422],
    ["input_not_in_recipe", 422],
    ["input_missing", 422],
    ["inputs_empty", 422],
    ["unit_mismatch", 422],
    ["qty_invalid", 422],
    ["ingredient_not_stock", 422],
    ["location_required", 422],
    ["no_location", 422],
    ["location_not_found", 422],
  ])("P0001 %s is %i with the same code and an Italian text", (code, status) => {
    const mapped = map("P0001", code) as ApiError;
    expect(mapped).toBeInstanceOf(ApiError);
    expect(mapped.status).toBe(status);
    expect(mapped.code).toBe(code);
    expect(mapped.message).toMatch(/[a-zà-ù]{3}/i);
    expect(mapped.message).not.toContain(code);
  });

  it("uses the planned Italian wording for the messages the form shows", () => {
    expect(map("P0001", "recipe_version_stale")).toMatchObject({
      message: "La ricetta è stata modificata: ricalcola la proposta.",
    });
    expect(map("P0001", "lot_empty")).toMatchObject({
      message: "Il lotto scelto è vuoto in questa ubicazione.",
    });
    for (const code of ["input_missing", "input_not_in_recipe"]) {
      expect(map("P0001", code)).toMatchObject({
        message: "Gli ingredienti non corrispondono alla ricetta: ricalcola la proposta.",
      });
    }
    expect(map("P0001", "inputs_empty")).toMatchObject({
      message: "Indica almeno un ingrediente usato.",
    });
    expect(map("P0001", "portions_invalid")).toMatchObject({
      message: "Indica un numero di porzioni da 1 a 10.000.",
    });
    expect(map("P0001", "unit_mismatch")).toMatchObject({
      message: "Unità non compatibile con l'ingrediente.",
    });
  });

  it("passes the ingredient ids of the detail through, and nothing else", () => {
    const details = JSON.stringify([
      { ingredientId: BEEF, secret: "12,5 kg" },
      { ingredientId: ONION },
      { other: "x" },
      { ingredientId: "not-a-uuid" },
    ]);
    const mapped = map("P0001", "input_missing", details) as ApiError;
    expect(mapped.details).toEqual([{ ingredientId: BEEF }, { ingredientId: ONION }]);
    expect(JSON.stringify(mapped.details)).not.toContain("secret");
  });

  it("ignores a detail that is not the planned JSON", () => {
    for (const details of [null, undefined, "", "not json", '{"ingredientId":"x"}', "[1,2]"]) {
      expect((map("P0001", "lot_empty", details) as ApiError).details).toBeUndefined();
    }
  });

  it("P0001 invalid_request is a 400", () => {
    const mapped = map("P0001", "invalid_request") as ApiError;
    expect([mapped.status, mapped.code]).toEqual([400, "invalid_request"]);
  });

  it.each([
    ["recipe_not_found", "Ricetta non trovata."],
    ["batch_not_found", "Produzione non trovata."],
    ["ingredient_not_found", "Ingrediente non trovato."],
    ["lot_not_found", "Lotto non trovato."],
    ["something_else", "Risorsa non trovata."],
  ])("P0002 %s says what was not found", (message, text) => {
    const mapped = map("P0002", message) as ApiError;
    expect([mapped.status, mapped.code, mapped.message]).toEqual([404, "not_found", text]);
  });

  it.each(["ingredient_not_found", "lot_not_found"])(
    "P0002 %s keeps the ingredient id so the form can mark the row",
    (message) => {
      const mapped = map("P0002", message, JSON.stringify([{ ingredientId: BEEF }])) as ApiError;
      expect(mapped.details).toEqual([{ ingredientId: BEEF }]);
    },
  );

  it("P0002 drops a detail that is not an ingredient id", () => {
    const mapped = map(
      "P0002",
      "lot_not_found",
      JSON.stringify([{ ingredientId: "not-a-uuid", secret: "x" }]),
    ) as ApiError;
    expect(mapped.details).toBeUndefined();
  });

  it("P0002 is a 404 not_found whatever the message, and 42501 a 403", () => {
    for (const message of [
      "recipe_not_found",
      "batch_not_found",
      "ingredient_not_found",
      "lot_not_found",
    ]) {
      const mapped = map("P0002", message) as ApiError;
      expect([mapped.status, mapped.code]).toEqual([404, "not_found"]);
    }
    const forbidden = map(
      "42501",
      "permission denied: production needs owner, admin or chef",
    ) as ApiError;
    expect([forbidden.status, forbidden.code]).toEqual([403, "forbidden"]);
    expect(forbidden.message).not.toContain("permission denied");
  });

  it("23505 on batch_lot_code_uq is a 409 lot_code_conflict", () => {
    const mapped = map(
      "23505",
      'duplicate key value violates unique constraint "batch_lot_code_uq"',
    ) as ApiError;
    expect([mapped.status, mapped.code]).toEqual([409, "lot_code_conflict"]);
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
    expect(mapBatchDbError({ message: "x" }).message).toBe("Unexpected database error (no code)");
  });
});
