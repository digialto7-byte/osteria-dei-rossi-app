import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapCostDbError } from "@/server/costing/errors";

function mapped(error: Parameters<typeof mapCostDbError>[0]): ApiError {
  const result = mapCostDbError(error);
  expect(result).toBeInstanceOf(ApiError);
  return result as ApiError;
}

describe("mapCostDbError", () => {
  it("42501 is a 403", () => {
    const error = mapped({ code: "42501", message: "permission denied" });
    expect(error.status).toBe(403);
    expect(error.code).toBe("forbidden");
  });

  it("P0002 is a 404, with its own text when the recipe did not exist yet", () => {
    expect(mapped({ code: "P0002", message: "not_found" }).code).toBe("not_found");
    const old = mapped({ code: "P0002", message: "recipe_not_in_force" });
    expect(old.status).toBe(404);
    expect(old.code).toBe("recipe_not_in_force");
    expect(old.message).toBe("In quella data la ricetta non esisteva ancora.");
  });

  it("date_in_future is a 422 with the Italian text", () => {
    const error = mapped({ code: "P0001", message: "date_in_future" });
    expect(error.status).toBe(422);
    expect(error.code).toBe("date_in_future");
    expect(error.message).toBe("Scegli una data non successiva a oggi.");
  });

  it("settings_invalid is a 422 naming the API field, never the database text", () => {
    const error = mapped({
      code: "P0001",
      message: "settings_invalid",
      details: JSON.stringify([{ field: "price_variance_pct", code: "out_of_range" }]),
    });
    expect(error.status).toBe(422);
    expect(error.code).toBe("settings_invalid");
    expect(error.message).toBe("Valore non valido: priceVariancePct.");
    expect(error.details).toEqual([{ field: "priceVariancePct", code: "out_of_range" }]);
  });

  it("fixed_cost_invalid is a 422 with the API field names", () => {
    const error = mapped({
      code: "P0001",
      message: "fixed_cost_invalid",
      details: JSON.stringify([
        { field: "month", code: "month_not_first_day" },
        { field: "labour", code: "out_of_range" },
      ]),
    });
    expect(error.status).toBe(422);
    expect(error.code).toBe("fixed_cost_invalid");
    expect(error.message).toBe("Mese o importi non validi.");
    expect(error.details).toEqual([
      { field: "month", code: "month_not_first_day" },
      { field: "labourEur", code: "out_of_range" },
    ]);
  });

  it("an unknown detail field is kept as is, an unreadable detail is dropped", () => {
    const odd = mapped({
      code: "P0001",
      message: "settings_invalid",
      details: JSON.stringify([{ field: "other", code: "unknown_field" }]),
    });
    expect(odd.details).toEqual([{ field: "other", code: "unknown_field" }]);
    const broken = mapped({ code: "P0001", message: "settings_invalid", details: "not json" });
    expect(broken.details).toBeUndefined();
    expect(broken.message).toBe("Valore non valido.");
  });

  it("basis_invalid is a 400", () => {
    expect(mapped({ code: "P0001", message: "basis_invalid" }).status).toBe(400);
  });

  it("anything else is a plain Error naming only the SQLSTATE", () => {
    const result = mapCostDbError({ code: "XX000", message: "secret: Manzo muscolo 10,00" });
    expect(result).not.toBeInstanceOf(ApiError);
    expect(result.message).toBe("Unexpected database error XX000");
    expect(mapCostDbError({ message: "x" }).message).toBe("Unexpected database error (no code)");
    expect(mapCostDbError({ code: "P0001", message: "who_knows" }).message).toBe(
      "Unexpected database error P0001",
    );
  });
});
