import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapMenuDbError } from "@/server/menu/errors";

const map = (code: string, message: string) => mapMenuDbError({ code, message });

describe("mapMenuDbError", () => {
  it.each([
    ["menu_item_name_taken", 409, "Esiste già un piatto con questo nome."],
    ["recipe_already_on_menu", 409, "Questa ricetta è già nel menu."],
    ["recipe_not_plate", 422, "Scegli una ricetta di tipo piatto."],
    ["recipe_inactive", 422, null],
    ["price_invalid", 422, "Prezzo non valido."],
    ["vat_rate_invalid", 422, "Aliquota IVA non ammessa."],
    ["position_invalid", 422, null],
    ["name_invalid", 422, null],
    ["category_invalid", 422, null],
  ])("P0001 %s is a %i with the same code and an Italian text", (code, status, text) => {
    const mapped = map("P0001", code) as ApiError;
    expect(mapped).toBeInstanceOf(ApiError);
    expect([mapped.status, mapped.code]).toEqual([status, code]);
    expect(mapped.message).toMatch(/[a-zà-ù]{3}/i);
    expect(mapped.message).not.toContain(code);
    if (text) expect(mapped.message).toBe(text);
  });

  it("P0002 is a 404 not_found that names the kind of record", () => {
    for (const message of ["menu_item_not_found", "recipe_not_found", "other"]) {
      const mapped = map("P0002", message) as ApiError;
      expect([mapped.status, mapped.code]).toEqual([404, "not_found"]);
    }
    expect(map("P0002", "menu_item_not_found")).toMatchObject({ message: "Piatto non trovato." });
    expect(map("P0002", "recipe_not_found")).toMatchObject({ message: "Ricetta non trovata." });
  });

  it("22023 is a 400 invalid_request", () => {
    const mapped = map("22023", "invalid_request") as ApiError;
    expect([mapped.status, mapped.code]).toEqual([400, "invalid_request"]);
  });

  it("42501 is a 403 that does not echo the database text", () => {
    const mapped = map("42501", "permission denied: menu needs owner or admin") as ApiError;
    expect([mapped.status, mapped.code]).toEqual([403, "forbidden"]);
    expect(mapped.message).not.toContain("menu needs");
  });

  it("anything else is a plain Error that names the SQLSTATE only", () => {
    for (const [code, message] of [
      ["XX000", "boom with Acqua (demo) 2,00 €"],
      ["P0001", "something_unknown"],
      ["P0001", "table_open"],
      ["23505", "duplicate key menu_item_name_uq"],
    ] as const) {
      const mapped = map(code, message);
      expect(mapped).not.toBeInstanceOf(ApiError);
      expect(mapped.message).toBe(`Unexpected database error ${code}`);
    }
  });
});
