import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import {
  ingredientRulesChange,
  ingredientRulesChefResponse,
  ingredientRulesResponse,
  recipeRulesChange,
  recipeRulesResponse,
  supplierRulesChange,
  supplierRulesResponse,
} from "@/server/rules/output";

const MONEY = /eur|cost|price|margin|amount|total|value/i;
const ID = "1a000000-0000-4000-8000-00000000001a";

// Every key an output schema declares, at any depth.
function keysOf(schema: unknown, seen = new Set<unknown>()): string[] {
  if (!schema || typeof schema !== "object" || seen.has(schema)) return [];
  seen.add(schema);
  const def = (schema as { def?: Record<string, unknown> }).def;
  if (!def) return [];
  const out: string[] = [];
  const shape = (schema as { shape?: Record<string, unknown> }).shape;
  if (shape) {
    for (const [key, child] of Object.entries(shape)) out.push(key, ...keysOf(child, seen));
  }
  for (const child of [
    def.element,
    def.innerType,
    ...(Array.isArray(def.options) ? def.options : []),
  ]) {
    out.push(...keysOf(child, seen));
  }
  return out;
}

const ingredientItem = {
  ingredientId: ID,
  name: "Manzo muscolo (demo)",
  baseUnit: "kg",
  isCritical: false,
  minLevel: 5,
  targetLevel: 12,
  onHandQty: 9,
  preferred: {
    supplierItemId: ID,
    supplierId: ID,
    supplierName: "Macelleria X (demo)",
    packQty: 5,
    packLabel: "5 kg",
  },
  nextWindow: { deliveryDate: "2026-11-05", orderByAt: "2026-11-03T10:00:00Z" },
  status: "ok",
  reasons: [],
};

describe("rules output schemas", () => {
  it("declare no money-like key at any depth", () => {
    const all: ZodType[] = [
      ingredientRulesResponse,
      ingredientRulesChefResponse,
      ingredientRulesChange,
      supplierRulesResponse,
      supplierRulesChange,
      recipeRulesResponse,
      recipeRulesChange,
    ];
    for (const schema of all) {
      const keys = keysOf(schema);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(key, key).not.toMatch(MONEY);
    }
  });

  it("the owner shape has supplierItems; the chef shape has none and refuses it", () => {
    const body = { today: "2026-11-02", items: [ingredientItem] };
    const supplierItems = [
      {
        supplierItemId: ID,
        ingredientId: ID,
        supplierId: ID,
        supplierName: "M",
        packQty: 5,
        packLabel: "5 kg",
      },
    ];
    expect(ingredientRulesResponse.safeParse({ ...body, supplierItems }).success).toBe(true);
    expect(ingredientRulesChefResponse.safeParse(body).success).toBe(true);
    expect(ingredientRulesChefResponse.safeParse({ ...body, supplierItems }).success).toBe(false);
    expect(Object.keys(ingredientRulesChefResponse.shape)).not.toContain("supplierItems");
  });

  it("refuses an undeclared key, such as a price, at any level", () => {
    const body = { today: "2026-11-02", items: [{ ...ingredientItem, last_price: 4.2 }] };
    expect(ingredientRulesChefResponse.safeParse(body).success).toBe(false);
    expect(
      ingredientRulesChefResponse.safeParse({
        today: "2026-11-02",
        items: [{ ...ingredientItem, preferred: { ...ingredientItem.preferred, unitPrice: 1 } }],
      }).success,
    ).toBe(false);
  });

  it("accepts null levels, a null preferred and a null window (an off ingredient)", () => {
    const off = {
      ...ingredientItem,
      minLevel: null,
      targetLevel: null,
      preferred: null,
      nextWindow: null,
      status: "off",
    };
    expect(
      ingredientRulesChefResponse.safeParse({ today: "2026-11-02", items: [off] }).success,
    ).toBe(true);
  });

  it("a supplier item and a recipe item parse; unknown status or source is refused", () => {
    expect(
      supplierRulesResponse.safeParse({
        items: [
          {
            supplierId: ID,
            name: "Macelleria X (demo)",
            leadTimeDays: 2,
            deliveryWeekdays: [1, 4],
            orderCutoffTime: "11:00",
            nextWindow: null,
          },
        ],
      }).success,
    ).toBe(true);
    const recipe = {
      recipeKey: ID,
      name: "Spezzatino (demo)",
      version: 3,
      portionsPerBatch: 30,
      minPortions: 5,
      targetPortions: 30,
      prepTimeMin: 180,
      sources: { min: "rule", target: "version", prep: null },
      remainingPortions: 4,
    };
    expect(recipeRulesResponse.safeParse({ items: [recipe] }).success).toBe(true);
    expect(
      recipeRulesResponse.safeParse({
        items: [{ ...recipe, sources: { ...recipe.sources, min: "x" } }],
      }).success,
    ).toBe(false);
    expect(
      ingredientRulesChefResponse.safeParse({
        today: "2026-11-02",
        items: [{ ...ingredientItem, status: "weird" }],
      }).success,
    ).toBe(false);
  });
});
