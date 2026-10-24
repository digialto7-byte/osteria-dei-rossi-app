import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapOrderDbError } from "@/server/orders/errors";
import { LINE_STEW, OIDS } from "../../helpers/orders-data";

const map = (code: string, message: string, details?: string | null) =>
  mapOrderDbError({ code, message, details });

describe("mapOrderDbError", () => {
  it("42501 is a 403 and 22023 a 400", () => {
    expect(map("42501", "x")).toMatchObject({ status: 403, code: "forbidden" });
    expect(map("22023", "invalid_request")).toMatchObject({ status: 400, code: "invalid_request" });
  });

  it.each([
    ["session_not_found", "Sessione non trovata."],
    ["menu_item_not_found", "Piatto non trovato."],
    ["line_not_found", "Riga non trovata."],
  ])("P0002 %s is a 404 not_found naming the kind of record", (message, text) => {
    expect(map("P0002", message)).toMatchObject({ status: 404, code: "not_found", message: text });
  });

  it("an unknown P0002 message is still a 404 with a neutral text", () => {
    expect(map("P0002", "something")).toMatchObject({ status: 404, code: "not_found" });
  });

  it.each([
    ["qty_invalid", 422],
    ["note_invalid", 422],
    ["course_invalid", 422],
    ["client_time_invalid", 422],
    ["price_missing", 422],
    ["session_closed", 409],
    ["line_id_conflict", 409],
  ])("P0001 %s is a %i with the same code and an Italian text", (code, status) => {
    const mapped = map("P0001", code) as ApiError;
    expect(mapped).toBeInstanceOf(ApiError);
    expect([mapped.status, mapped.code]).toEqual([status, code]);
    expect(mapped.message).toMatch(/[a-zà-ù]{3}/i);
    expect(mapped.message).not.toContain(code);
    expect(mapped.details).toBeUndefined();
  });

  it("uses the texts of the screen", () => {
    expect(map("P0001", "client_time_invalid")).toMatchObject({
      message: "Controlla data e ora del telefono.",
    });
    expect(map("P0001", "session_closed")).toMatchObject({ message: "Il tavolo è stato chiuso." });
  });

  it("line_id_conflict drops whatever the detail says", () => {
    const mapped = map(
      "P0001",
      "line_id_conflict",
      JSON.stringify({ tenant: "other" }),
    ) as ApiError;
    expect(mapped.details).toBeUndefined();
  });

  describe("conflict", () => {
    const detail = (reason: string, line: object = LINE_STEW) => JSON.stringify({ reason, line });

    it.each(["stale", "fired", "voided", "session_closed"])(
      "%s carries the current line",
      (reason) => {
        const mapped = map("P0001", "conflict", detail(reason)) as ApiError;
        expect([mapped.status, mapped.code]).toEqual([409, "conflict"]);
        expect(mapped.details).toEqual({ reason, line: LINE_STEW });
      },
    );

    it("names the colleague and the time (Europe/Rome) for a stale line", () => {
      const line = {
        ...LINE_STEW,
        updatedAt: "2026-11-02T19:31:00+00:00",
        updatedBy: { id: OIDS.waiterB, displayName: "Cameriere Due Demo" },
      };
      const mapped = map("P0001", "conflict", detail("stale", line)) as ApiError;
      expect(mapped.message).toBe(
        "Questa riga è stata cambiata da Cameriere Due Demo alle 20:31: ecco la versione attuale.",
      );
    });

    it("has a message for each irreversible reason", () => {
      const fired = (map("P0001", "conflict", detail("fired")) as ApiError).message;
      const voided = (map("P0001", "conflict", detail("voided")) as ApiError).message;
      const closed = (map("P0001", "conflict", detail("session_closed")) as ApiError).message;
      expect(new Set([fired, voided, closed]).size).toBe(3);
      expect(closed).toBe("Il tavolo è stato chiuso.");
    });

    it("drops an extra key of the SQL detail (strict) and so sends no details at all", () => {
      const mapped = map(
        "P0001",
        "conflict",
        JSON.stringify({ reason: "stale", line: LINE_STEW, unit_cost: 3 }),
      ) as ApiError;
      expect(mapped.status).toBe(409);
      expect(mapped.details).toBeUndefined();
      expect(JSON.stringify(mapped)).not.toContain("unit_cost");
    });

    it.each([
      ["no detail", null],
      ["text that is not JSON", "not json"],
      ["an unknown reason", detail("later")],
      ["a line with a cost key", detail("stale", { ...LINE_STEW, unit_cost: 3 })],
    ])("a conflict with %s is a 409 without details", (_name, raw) => {
      const mapped = map("P0001", "conflict", raw) as ApiError;
      expect([mapped.status, mapped.code]).toEqual([409, "conflict"]);
      expect(mapped.details).toBeUndefined();
    });
  });

  describe("item_unavailable", () => {
    it("carries {menuItemId, reason, portionsLeft} and says the dish is out", () => {
      const detail = { menuItemId: OIDS.item, reason: "no_portions", portionsLeft: 0 };
      const mapped = map("P0001", "item_unavailable", JSON.stringify(detail)) as ApiError;
      expect([mapped.status, mapped.code]).toEqual([409, "item_unavailable"]);
      expect(mapped.details).toEqual(detail);
      expect(mapped.message).toBe("Il piatto è esaurito.");
    });

    it("drops a detail with an extra key", () => {
      const detail = { menuItemId: OIDS.item, reason: "manual", portionsLeft: null, cost: 1 };
      const mapped = map("P0001", "item_unavailable", JSON.stringify(detail)) as ApiError;
      expect(mapped.status).toBe(409);
      expect(mapped.details).toBeUndefined();
    });
  });

  it("an unknown P0001, an unknown SQLSTATE and a constraint error are plain Errors naming only the SQLSTATE", () => {
    for (const [code, message] of [
      ["P0001", "something_new"],
      ["XX000", "boom Zuppa del giorno (demo) 9,00 €"],
      ["23514", 'new row violates check constraint "order_line_note_ck" senza cipolla'],
    ] as const) {
      const mapped = map(code, message);
      expect(mapped).not.toBeInstanceOf(ApiError);
      expect(mapped.message).toBe(`Unexpected database error ${code}`);
    }
  });
});
