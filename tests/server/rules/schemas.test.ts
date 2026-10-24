import { describe, expect, it } from "vitest";
import { ingredientRulesBody, recipeRulesBody, supplierRulesBody } from "@/server/rules/schemas";

const ING = "1a000000-0000-4000-8000-00000000001a";
const ITEM = "5e000000-0000-4000-8000-000000000001";
const SUP = "5a000000-0000-4000-8000-000000000001";
const KEY = "4b000000-0000-4000-8000-000000000001";

describe("ingredientRulesBody", () => {
  it("takes the id and at least one rule field", () => {
    expect(ingredientRulesBody.safeParse({ ingredientId: ING, minLevel: 5 }).success).toBe(true);
    expect(
      ingredientRulesBody.safeParse({
        ingredientId: ING,
        minLevel: 5,
        targetLevel: 12,
        preferredSupplierItemId: ITEM,
      }).success,
    ).toBe(true);
  });
  it("null clears a field", () => {
    const parsed = ingredientRulesBody.safeParse({
      ingredientId: ING,
      minLevel: null,
      targetLevel: null,
      preferredSupplierItemId: null,
    });
    expect(parsed.success).toBe(true);
  });
  it("refuses an empty patch, an unknown key and a cost key", () => {
    expect(ingredientRulesBody.safeParse({ ingredientId: ING }).success).toBe(false);
    expect(ingredientRulesBody.safeParse({ ingredientId: ING, minLevel: 1, x: 1 }).success).toBe(
      false,
    );
    expect(
      ingredientRulesBody.safeParse({ ingredientId: ING, minLevel: 1, lastPrice: 2 }).success,
    ).toBe(false);
  });
  it("refuses a bad uuid, negative, too large and 5-decimal levels", () => {
    expect(ingredientRulesBody.safeParse({ ingredientId: "x", minLevel: 1 }).success).toBe(false);
    expect(
      ingredientRulesBody.safeParse({ ingredientId: ING, preferredSupplierItemId: "x" }).success,
    ).toBe(false);
    for (const minLevel of [-1, 100_001, 1.12345, "5", Number.NaN]) {
      expect(
        ingredientRulesBody.safeParse({ ingredientId: ING, minLevel }).success,
        `${minLevel}`,
      ).toBe(false);
    }
    expect(ingredientRulesBody.safeParse({ ingredientId: ING, minLevel: 1.1234 }).success).toBe(
      true,
    );
    expect(ingredientRulesBody.safeParse({ ingredientId: ING, targetLevel: 100_000 }).success).toBe(
      true,
    );
  });
});

describe("supplierRulesBody", () => {
  it("takes lead time, weekdays and cut-off", () => {
    const parsed = supplierRulesBody.safeParse({
      supplierId: SUP,
      leadTimeDays: 2,
      deliveryWeekdays: [4, 1],
      orderCutoffTime: "11:00",
    });
    expect(parsed.success).toBe(true);
  });
  it("accepts [] for weekdays and null to clear lead time and cut-off, but not null weekdays", () => {
    expect(supplierRulesBody.safeParse({ supplierId: SUP, deliveryWeekdays: [] }).success).toBe(
      true,
    );
    expect(
      supplierRulesBody.safeParse({ supplierId: SUP, leadTimeDays: null, orderCutoffTime: null })
        .success,
    ).toBe(true);
    expect(supplierRulesBody.safeParse({ supplierId: SUP, deliveryWeekdays: null }).success).toBe(
      false,
    );
  });
  it("refuses weekdays outside 1-7, duplicates, non-integers and more than seven", () => {
    for (const deliveryWeekdays of [[0], [8], [1, 1], [1.5], ["1"], [1, 2, 3, 4, 5, 6, 7, 1]]) {
      expect(
        supplierRulesBody.safeParse({ supplierId: SUP, deliveryWeekdays }).success,
        JSON.stringify(deliveryWeekdays),
      ).toBe(false);
    }
    expect(
      supplierRulesBody.safeParse({ supplierId: SUP, deliveryWeekdays: [1, 2, 3, 4, 5, 6, 7] })
        .success,
    ).toBe(true);
  });
  it("lead time is a whole number 0 to 365", () => {
    for (const leadTimeDays of [-1, 366, 1.5, "2"]) {
      expect(supplierRulesBody.safeParse({ supplierId: SUP, leadTimeDays }).success).toBe(false);
    }
    for (const leadTimeDays of [0, 365]) {
      expect(supplierRulesBody.safeParse({ supplierId: SUP, leadTimeDays }).success).toBe(true);
    }
  });
  it("cut-off is HH:MM", () => {
    for (const orderCutoffTime of ["24:00", "11:0", "1100", "11:60", "11:00:00", " 11:00", 11]) {
      expect(
        supplierRulesBody.safeParse({ supplierId: SUP, orderCutoffTime }).success,
        String(orderCutoffTime),
      ).toBe(false);
    }
    for (const orderCutoffTime of ["00:00", "09:30", "23:59"]) {
      expect(supplierRulesBody.safeParse({ supplierId: SUP, orderCutoffTime }).success).toBe(true);
    }
  });
  it("refuses an empty patch and an unknown key", () => {
    expect(supplierRulesBody.safeParse({ supplierId: SUP }).success).toBe(false);
    expect(
      supplierRulesBody.safeParse({ supplierId: SUP, leadTimeDays: 1, name: "x" }).success,
    ).toBe(false);
  });
});

describe("recipeRulesBody", () => {
  it("takes portions and prep time", () => {
    expect(
      recipeRulesBody.safeParse({
        recipeKey: KEY,
        minPortions: 5,
        targetPortions: 30,
        prepTimeMin: 180,
      }).success,
    ).toBe(true);
    expect(
      recipeRulesBody.safeParse({ recipeKey: KEY, minPortions: null, prepTimeMin: null }).success,
    ).toBe(true);
  });
  it("bounds: portions 0-10000, prep 0-1440, whole numbers", () => {
    for (const body of [
      { minPortions: -1 },
      { minPortions: 10_001 },
      { targetPortions: 1.5 },
      { prepTimeMin: 1441 },
      { prepTimeMin: -1 },
      { prepTimeMin: "x" },
    ]) {
      expect(
        recipeRulesBody.safeParse({ recipeKey: KEY, ...body }).success,
        JSON.stringify(body),
      ).toBe(false);
    }
    expect(
      recipeRulesBody.safeParse({
        recipeKey: KEY,
        minPortions: 0,
        targetPortions: 10_000,
        prepTimeMin: 1440,
      }).success,
    ).toBe(true);
  });
  it("refuses an empty patch, an unknown key and a bad key", () => {
    expect(recipeRulesBody.safeParse({ recipeKey: KEY }).success).toBe(false);
    expect(recipeRulesBody.safeParse({ recipeKey: KEY, minPortions: 1, price: 1 }).success).toBe(
      false,
    );
    expect(recipeRulesBody.safeParse({ recipeKey: "x", minPortions: 1 }).success).toBe(false);
  });
});
