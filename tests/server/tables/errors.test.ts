import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapTablesDbError } from "@/server/tables/errors";

const map = (code: string, message: string, details?: string | null) =>
  mapTablesDbError({ code, message, details });

const SESSION = {
  id: "5e000000-0000-4000-8000-000000000001",
  tableId: "7a000000-0000-4000-8000-000000000001",
  tableName: "Tavolo 1 (demo)",
  covers: 4,
  openedAt: "2026-11-02T19:15:00.123456+00:00",
  businessDate: "2026-11-02",
  waiter: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Cameriere Demo" },
  billRequested: false,
  coperto: { perPerson: 1.5, vatRate: 10, total: 6 },
};

describe("mapTablesDbError", () => {
  it.each([
    ["table_name_taken", 409],
    ["table_open", 409],
    ["session_id_conflict", 409],
    ["session_closed", 409],
    ["table_already_open", 409],
    ["table_inactive", 422],
    ["covers_invalid", 422],
    ["coperto_invalid", 422],
    ["vat_rate_invalid", 422],
    ["name_invalid", 422],
    ["position_invalid", 422],
  ])("P0001 %s is a %i with the same code and an Italian text", (code, status) => {
    const mapped = map("P0001", code) as ApiError;
    expect(mapped).toBeInstanceOf(ApiError);
    expect([mapped.status, mapped.code]).toEqual([status, code]);
    expect(mapped.message).toMatch(/[a-zà-ù]{3}/i);
    expect(mapped.message).not.toContain(code);
  });

  it("uses the texts of the screens", () => {
    expect(map("P0001", "table_open")).toMatchObject({ message: "Chiudi prima il tavolo aperto." });
    expect(map("P0001", "table_name_taken")).toMatchObject({
      message: "Esiste già un tavolo con questo nome.",
    });
    expect(map("P0001", "covers_invalid")).toMatchObject({ message: "I coperti vanno da 1 a 99." });
  });

  it("table_already_open carries the open session as details.session and names the waiter", () => {
    const mapped = map("P0001", "table_already_open", JSON.stringify(SESSION)) as ApiError;
    expect([mapped.status, mapped.code]).toEqual([409, "table_already_open"]);
    expect(mapped.details).toEqual({ session: SESSION });
    expect(mapped.message).toBe("Il tavolo è già aperto da Cameriere Demo.");
  });

  it.each([
    ["no detail", null],
    ["an empty object", "{}"],
    ["text that is not JSON", "not json"],
    ["a session with an extra key", JSON.stringify({ ...SESSION, unit_cost: 3 })],
    ["a session without a waiter", JSON.stringify({ ...SESSION, waiter: undefined })],
  ])("table_already_open with %s still answers 409, without details", (_name, details) => {
    const mapped = map("P0001", "table_already_open", details) as ApiError;
    expect([mapped.status, mapped.code]).toEqual([409, "table_already_open"]);
    expect(mapped.details).toBeUndefined();
    expect(mapped.message).toBe("Il tavolo è già aperto.");
  });

  it("session_id_conflict never carries details, whatever the database sent", () => {
    const mapped = map("P0001", "session_id_conflict", JSON.stringify(SESSION)) as ApiError;
    expect(mapped.details).toBeUndefined();
  });

  it("P0002 is a 404 not_found that names the kind of record", () => {
    for (const message of ["table_not_found", "session_not_found", "other"]) {
      const mapped = map("P0002", message) as ApiError;
      expect([mapped.status, mapped.code]).toEqual([404, "not_found"]);
    }
    expect(map("P0002", "table_not_found")).toMatchObject({ message: "Tavolo non trovato." });
    expect(map("P0002", "session_not_found")).toMatchObject({ message: "Sessione non trovata." });
  });

  it("22023 is a 400 and 42501 a 403 without the database text", () => {
    expect(map("22023", "invalid_request")).toMatchObject({ status: 400, code: "invalid_request" });
    const forbidden = map("42501", "permission denied for the chef") as ApiError;
    expect([forbidden.status, forbidden.code]).toEqual([403, "forbidden"]);
    expect(forbidden.message).not.toContain("chef");
  });

  it("anything else is a plain Error that names the SQLSTATE only", () => {
    for (const [code, message] of [
      ["XX000", "boom Tavolo 1 (demo)"],
      ["P0001", "something_unknown"],
      ["P0001", "menu_item_name_taken"],
      ["23505", "table_session_open_uq"],
    ] as const) {
      const mapped = map(code, message);
      expect(mapped).not.toBeInstanceOf(ApiError);
      expect(mapped.message).toBe(`Unexpected database error ${code}`);
    }
  });
});
