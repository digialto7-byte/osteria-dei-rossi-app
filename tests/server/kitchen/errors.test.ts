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
    ] as const) {
      const mapped = mapKitchenDbError({ code, message });
      expect(mapped).not.toBeInstanceOf(ApiError);
      expect(mapped.message).toBe(`Unexpected database error ${code}`);
    }
  });
});
