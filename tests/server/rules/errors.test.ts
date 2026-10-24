import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapRulesDbError } from "@/server/rules/errors";

const map = (code: string, message: string) => mapRulesDbError({ code, message });

describe("mapRulesDbError", () => {
  it.each([
    ["levels_invalid", "L'obiettivo non può essere inferiore al minimo."],
    ["ingredient_not_stock", null],
    ["supplier_item_inactive", null],
    ["lead_time_invalid", null],
    ["weekdays_invalid", "Indica i giorni di consegna da lunedì a domenica."],
    ["cutoff_invalid", "Orario non valido (HH:MM)."],
    ["recipe_not_batch", null],
    ["portions_invalid", null],
    ["prep_time_invalid", null],
  ])("P0001 %s is a 422 with the same code and an Italian text", (code, text) => {
    const mapped = map("P0001", code) as ApiError;
    expect(mapped).toBeInstanceOf(ApiError);
    expect([mapped.status, mapped.code]).toEqual([422, code]);
    expect(mapped.message).toMatch(/[a-zà-ù]{3}/i);
    expect(mapped.message).not.toContain(code);
    if (text) expect(mapped.message).toBe(text);
  });

  it("22023 is a 400 invalid_request", () => {
    const mapped = map("22023", "invalid_request") as ApiError;
    expect([mapped.status, mapped.code]).toEqual([400, "invalid_request"]);
  });

  it("P0002 is a 404 not_found whatever the message, with a text that names the kind", () => {
    for (const message of [
      "ingredient_not_found",
      "supplier_item_not_found",
      "supplier_not_found",
      "recipe_not_found",
      "other",
    ]) {
      const mapped = map("P0002", message) as ApiError;
      expect([mapped.status, mapped.code]).toEqual([404, "not_found"]);
    }
    expect(map("P0002", "supplier_not_found")).toMatchObject({ message: "Fornitore non trovato." });
    expect(map("P0002", "recipe_not_found")).toMatchObject({ message: "Ricetta non trovata." });
    expect(map("P0002", "ingredient_not_found")).toMatchObject({
      message: "Ingrediente non trovato.",
    });
  });

  it("42501 is a 403 that does not echo the database text", () => {
    const mapped = map(
      "42501",
      "permission denied: rules settings need owner or admin",
    ) as ApiError;
    expect([mapped.status, mapped.code]).toEqual([403, "forbidden"]);
    expect(mapped.message).not.toContain("rules");
  });

  it("anything else is a plain Error that names the SQLSTATE only", () => {
    for (const [code, message] of [
      ["XX000", "boom with Manzo muscolo (demo) 12,50 €"],
      ["P0001", "something_unknown"],
      ["23514", "violates check constraint"],
    ] as const) {
      const mapped = map(code, message);
      expect(mapped).not.toBeInstanceOf(ApiError);
      expect(mapped.message).toBe(`Unexpected database error ${code}`);
    }
  });
});
