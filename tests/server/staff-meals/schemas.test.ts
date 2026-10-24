import { describe, expect, it } from "vitest";
import { confirmBody, ruleBody } from "@/server/staff-meals/schemas";

const KEY = "ec000000-0000-4000-8000-0000000000e1";
const PANE = "1d000000-0000-4000-8000-00000000001d";
const CELLA = "10000000-0000-4000-8000-0000000000a1";

describe("ruleBody", () => {
  it("accepts a recipe rule and keeps isActive optional", () => {
    expect(ruleBody.parse({ recipeKey: KEY, defaultCount: 2 })).toEqual({
      recipeKey: KEY,
      defaultCount: 2,
    });
    expect(ruleBody.parse({ recipeKey: KEY, defaultCount: 2, isActive: false }).isActive).toBe(
      false,
    );
  });

  it("accepts an ingredient rule with its unit and an optional location", () => {
    const parsed = ruleBody.parse({
      ingredientId: PANE,
      defaultCount: 500,
      unit: "g",
      locationId: CELLA,
    });
    expect(parsed).toMatchObject({ ingredientId: PANE, unit: "g", locationId: CELLA });
  });

  it("refuses both targets, neither, and an ingredient without a unit", () => {
    for (const bad of [
      { recipeKey: KEY, ingredientId: PANE, defaultCount: 2, unit: "kg" },
      { defaultCount: 2 },
      { ingredientId: PANE, defaultCount: 2 },
      { recipeKey: KEY, defaultCount: 2, unit: "kg" },
      { recipeKey: KEY, defaultCount: 2, locationId: CELLA },
    ]) {
      expect(ruleBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("bounds the count: > 0, <= 1000, at most 4 decimals", () => {
    for (const defaultCount of [0.0001, 0.5, 1000]) {
      expect(ruleBody.safeParse({ recipeKey: KEY, defaultCount }).success).toBe(true);
    }
    for (const defaultCount of [0, -1, 1000.0001, 1.23456, "2", Number.NaN]) {
      expect(
        ruleBody.safeParse({ recipeKey: KEY, defaultCount }).success,
        String(defaultCount),
      ).toBe(false);
    }
  });

  it("refuses an unknown unit, a bad id and an extra key", () => {
    for (const bad of [
      { ingredientId: PANE, defaultCount: 1, unit: "conf" },
      { ingredientId: "nope", defaultCount: 1, unit: "kg" },
      { recipeKey: KEY, defaultCount: 1, cost: 3 },
    ]) {
      expect(ruleBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("confirmBody", () => {
  it("accepts an empty body or a count of 0 < count <= 1000", () => {
    expect(confirmBody.parse({})).toEqual({});
    expect(confirmBody.parse({ count: 3 }).count).toBe(3);
    expect(confirmBody.parse({ count: 0.5 }).count).toBe(0.5);
  });

  it("refuses 0, negative, over 1000, 5 decimals and an extra key", () => {
    for (const bad of [
      { count: 0 },
      { count: -1 },
      { count: 1001 },
      { count: 1.23456 },
      { x: 1 },
    ]) {
      expect(confirmBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
