import { describe, expect, it } from "vitest";
import { convert, toBase, toIngredientBase, UnitError } from "@/lib/units";

const CASSA_6_X_1KG = { count: 6, size: 1, unit: "kg" } as const;

function unitErrorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof UnitError) return error.code;
    throw error;
  }
  return undefined;
}

describe("toBase (M1 acceptance test 1)", () => {
  it("1 cassa of 6 × 1 kg is 6 kg", () => {
    expect(toBase(1, "conf", CASSA_6_X_1KG)).toEqual({ qty: 6, unit: "kg" });
  });

  it("500 g is 0.5 kg", () => {
    expect(toBase(500, "g")).toEqual({ qty: 0.5, unit: "kg" });
  });

  it("250 ml is 0.25 l, and pieces stay pieces", () => {
    expect(toBase(250, "ml")).toEqual({ qty: 0.25, unit: "l" });
    expect(toBase(3, "pz")).toEqual({ qty: 3, unit: "pz" });
  });

  it("2 packs of 12 × 500 g are 12 kg", () => {
    expect(toBase(2, "conf", { count: 12, size: 500, unit: "g" })).toEqual({ qty: 12, unit: "kg" });
  });

  it("rounds half-up to 4 decimals, like numeric(12,4)", () => {
    expect(toBase(0.1, "g")).toEqual({ qty: 0.0001, unit: "kg" });
    expect(toBase(0.05, "g")).toEqual({ qty: 0.0001, unit: "kg" });
    expect(toBase(0.04, "g")).toEqual({ qty: 0, unit: "kg" });
  });

  it("needs a pack spec for 'conf'", () => {
    expect(unitErrorCode(() => toBase(1, "conf"))).toBe("invalid_pack");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a pack count or size of %s",
    (bad) => {
      expect(unitErrorCode(() => toBase(1, "conf", { count: bad, size: 1, unit: "kg" }))).toBe(
        "invalid_pack",
      );
      expect(unitErrorCode(() => toBase(1, "conf", { count: 6, size: bad, unit: "kg" }))).toBe(
        "invalid_pack",
      );
    },
  );

  it("rejects a quantity that is not a finite number", () => {
    expect(unitErrorCode(() => toBase(Number.NaN, "kg"))).toBe("invalid_quantity");
  });
});

describe("convert", () => {
  it("converts within a dimension", () => {
    expect(convert(1.5, "kg", "g")).toBe(1500);
    expect(convert(750, "ml", "l")).toBe(0.75);
  });

  it("kg → pz is incompatible_units", () => {
    expect(unitErrorCode(() => convert(1, "kg", "pz"))).toBe("incompatible_units");
    expect(unitErrorCode(() => convert(1, "l", "kg"))).toBe("incompatible_units");
  });
});

describe("toIngredientBase", () => {
  it("accepts a pack in the ingredient's dimension", () => {
    expect(toIngredientBase(1, "conf", "kg", CASSA_6_X_1KG)).toEqual({ qty: 6, unit: "kg" });
  });

  it("a kg pack for an ingredient counted in pieces is incompatible_units", () => {
    expect(unitErrorCode(() => toIngredientBase(1, "conf", "pz", CASSA_6_X_1KG))).toBe(
      "incompatible_units",
    );
  });
});
