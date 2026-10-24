import { describe, expect, it } from "vitest";
import { z } from "zod";
import { staffMealConfirmation, staffMealRule, staffMealRules } from "@/server/staff-meals/output";

const KEY = "ec000000-0000-4000-8000-0000000000e1";
const PANE = "1d000000-0000-4000-8000-00000000001d";
const RULE = "5a000000-0000-4000-8000-0000000000a1";
const RULE2 = "5a000000-0000-4000-8000-0000000000a2";
const CONF = "5c000000-0000-4000-8000-0000000000c1";
const BATCH = "ba000000-0000-4000-8000-0000000000b1";
const CELLA = "10000000-0000-4000-8000-0000000000a1";

function propertyNames(schema: z.ZodType): string[] {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (record.properties && typeof record.properties === "object") {
        names.push(...Object.keys(record.properties));
      }
      Object.values(record).forEach(walk);
    }
  };
  walk(z.toJSONSchema(schema, { io: "output" }));
  return names;
}
const COSTLY = /eur|cost|price|margin|value|amount/i;

const RULES = {
  businessDate: "2026-10-24",
  rules: [
    {
      ruleId: RULE,
      kind: "recipe",
      targetId: KEY,
      name: "Ragù (demo)",
      unit: "porzioni",
      defaultCount: 2,
      locationId: null,
      isActive: true,
      available: 6,
      today: { confirmationId: CONF, count: 2, at: "2026-10-24T10:10:00+00:00", byInitials: "CD" },
    },
    {
      ruleId: RULE2,
      kind: "ingredient",
      targetId: PANE,
      name: "Pane (demo)",
      unit: "kg",
      defaultCount: 0.5,
      locationId: CELLA,
      isActive: false,
      available: null,
      today: null,
    },
  ],
};
const RULE_OUT = {
  ruleId: RULE,
  kind: "recipe",
  targetId: KEY,
  defaultCount: 2,
  locationId: null,
  isActive: true,
};
const CONFIRMATION = {
  confirmationId: CONF,
  ruleId: RULE,
  businessDate: "2026-10-24",
  count: 2,
  movements: [{ batchId: BATCH, portions: 2 }],
  negatives: [],
};

describe("the staff-meal shapes", () => {
  it("accept the planned examples", () => {
    expect(staffMealRules.parse(RULES)).toEqual(RULES);
    expect(staffMealRule.parse(RULE_OUT)).toEqual(RULE_OUT);
    expect(staffMealConfirmation.parse(CONFIRMATION)).toEqual(CONFIRMATION);
    const raw = {
      ...CONFIRMATION,
      movements: [{ ingredientId: PANE, qty: -0.5 }],
      negatives: [{ ingredientId: PANE, locationId: CELLA, onHandQty: -0.5 }],
    };
    expect(staffMealConfirmation.parse(raw)).toEqual(raw);
  });

  it.each([
    ["staffMealRules", staffMealRules],
    ["staffMealRule", staffMealRule],
    ["staffMealConfirmation", staffMealConfirmation],
  ])("%s declares no key that looks like money", (_name, schema) => {
    const names = propertyNames(schema);
    expect(names.length).toBeGreaterThan(4);
    expect(names.filter((n) => COSTLY.test(n))).toEqual([]);
  });

  it("refuse an undeclared key at any depth", () => {
    expect(() => staffMealRules.parse({ ...RULES, extra: 1 })).toThrow();
    expect(() =>
      staffMealRules.parse({ ...RULES, rules: [{ ...RULES.rules[0], unit_cost: 2 }] }),
    ).toThrow();
    expect(() => staffMealRule.parse({ ...RULE_OUT, created: true })).toThrow();
    expect(() => staffMealConfirmation.parse({ ...CONFIRMATION, cost: 1 })).toThrow();
    expect(() =>
      staffMealConfirmation.parse({
        ...CONFIRMATION,
        movements: [{ batchId: BATCH, portions: 2, unitCost: 1 }],
      }),
    ).toThrow();
  });

  it("check the kind", () => {
    expect(() =>
      staffMealRules.parse({ ...RULES, rules: [{ ...RULES.rules[0], kind: "dish" }] }),
    ).toThrow();
  });
});
