import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapCountDbError } from "@/server/counts/errors";
import { mapAuditDbError } from "@/server/audit/errors";

const map = (code: string, message: string) => mapCountDbError({ code, message });

describe("mapCountDbError", () => {
  // Every P0001 code of the count functions (plan §3.4): its status and the same code in the API.
  it.each([
    ["count_closed", 409],
    ["count_cancelled", 409],
    ["count_open_exists", 409],
    ["count_not_closed", 409],
    ["count_empty", 422],
    ["no_critical_ingredients", 422],
    ["duplicate_line", 422],
    ["type_invalid", 422],
    ["qty_invalid", 422],
    ["unit_mismatch", 422],
    ["ingredient_not_stock", 422],
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

  it("uses the planned Italian wording", () => {
    expect(map("P0001", "count_closed")).toMatchObject({ message: "Il conteggio è già chiuso." });
    expect(map("P0001", "count_empty")).toMatchObject({
      message: "Inserisci almeno una quantità prima di chiudere.",
    });
    expect(map("P0001", "count_open_exists")).toMatchObject({
      message: "C'è già un conteggio in corso in questa ubicazione.",
    });
    expect(map("P0001", "no_critical_ingredients")).toMatchObject({
      message: "Nessun ingrediente critico: scegli prima quali contare ogni giorno.",
    });
  });

  it("22023 invalid_request is a 400", () => {
    const mapped = map("22023", "invalid_request") as ApiError;
    expect([mapped.status, mapped.code]).toEqual([400, "invalid_request"]);
  });

  it("P0002 is a 404 whatever the message, and 42501 a 403", () => {
    for (const message of [
      "count_not_found",
      "count_line_not_found",
      "ingredient_not_found",
      "anything",
    ]) {
      const mapped = map("P0002", message) as ApiError;
      expect([mapped.status, mapped.code]).toEqual([404, "not_found"]);
    }
    expect(map("P0002", "count_not_found")).toMatchObject({ message: "Conteggio non trovato." });
    const forbidden = map("42501", "permission denied: costs need owner or admin") as ApiError;
    expect([forbidden.status, forbidden.code]).toEqual([403, "forbidden"]);
    expect(forbidden.message).not.toContain("costs");
  });

  it("anything else is a plain Error that names the SQLSTATE only", () => {
    for (const [code, message] of [
      ["XX000", "boom with Manzo muscolo (demo) 12,50 €"],
      ["P0001", "something_unknown"],
      ["23505", "duplicate key value violates unique constraint"],
    ] as const) {
      const mapped = map(code, message);
      expect(mapped).not.toBeInstanceOf(ApiError);
      expect(mapped.message).toBe(`Unexpected database error ${code}`);
    }
  });
});

describe("mapAuditDbError", () => {
  it("maps the audit log codes", () => {
    expect(mapAuditDbError({ code: "42501", message: "x" })).toMatchObject({ status: 403 });
    expect(mapAuditDbError({ code: "P0001", message: "range_invalid" })).toMatchObject({
      status: 422,
      code: "range_invalid",
    });
    expect(mapAuditDbError({ code: "P0001", message: "range_too_long" })).toMatchObject({
      status: 422,
      code: "range_too_long",
    });
    expect(mapAuditDbError({ code: "22023", message: "invalid_request" })).toMatchObject({
      status: 400,
    });
  });
  it("anything else is a plain Error with the SQLSTATE only", () => {
    const mapped = mapAuditDbError({ code: "XX000", message: "Chef Demo" });
    expect(mapped).not.toBeInstanceOf(ApiError);
    expect(mapped.message).toBe("Unexpected database error XX000");
  });
});
