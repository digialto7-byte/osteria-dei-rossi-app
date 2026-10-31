import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapKitchenDbError } from "@/server/kitchen/errors";

describe("mapKitchenDbError (M19)", () => {
  it("42501 is a 403 with the Italian text of the screen", () => {
    const mapped = mapKitchenDbError({
      code: "42501",
      message: "permission denied: x",
    }) as ApiError;
    expect(mapped).toBeInstanceOf(ApiError);
    expect([mapped.status, mapped.code]).toEqual([403, "forbidden"]);
    expect(mapped.message).toBe("La lista della cucina non è disponibile per il tuo ruolo.");
  });

  it("anything else is a plain Error naming only the SQLSTATE", () => {
    for (const [code, message] of [
      ["XX000", "boom Zuppa del giorno (demo) 9,00 €"],
      ["P0001", "something"],
      ["P0002", "session_not_found"],
    ] as const) {
      const mapped = mapKitchenDbError({ code, message });
      expect(mapped).not.toBeInstanceOf(ApiError);
      expect(mapped.message).toBe(`Unexpected database error ${code}`);
    }
  });
});

describe("mapKitchenDbError, the write procedures (M19b)", () => {
  it("P0002 line_not_found and ticket_not_found are 404 with their own code and an Italian text", () => {
    const line = mapKitchenDbError({ code: "P0002", message: "line_not_found" }) as ApiError;
    expect([line.status, line.code]).toEqual([404, "line_not_found"]);
    expect(line.message).toBe("Questa comanda non c'è più: aggiorno la lista.");
    const ticket = mapKitchenDbError({ code: "P0002", message: "ticket_not_found" }) as ApiError;
    expect([ticket.status, ticket.code]).toEqual([404, "ticket_not_found"]);
    expect(ticket.message).toBe("Questa comanda non c'è più: aggiorno la lista.");
  });

  it("P0001 session_closed is a 409", () => {
    const mapped = mapKitchenDbError({ code: "P0001", message: "session_closed" }) as ApiError;
    expect([mapped.status, mapped.code]).toEqual([409, "session_closed"]);
    expect(mapped.message).toBe("Il tavolo è stato chiuso: la comanda non è più in cucina.");
  });

  it("22023 is a 400 invalid_request", () => {
    const mapped = mapKitchenDbError({ code: "22023", message: "invalid_request" }) as ApiError;
    expect([mapped.status, mapped.code]).toEqual([400, "invalid_request"]);
  });

  it("never sends the database message or detail", () => {
    const mapped = mapKitchenDbError({
      code: "P0001",
      message: "session_closed",
      details: "secret 9,00 €",
    }) as ApiError;
    expect(JSON.stringify(mapped)).not.toContain("secret");
    expect(mapped.details).toBeUndefined();
  });
});
