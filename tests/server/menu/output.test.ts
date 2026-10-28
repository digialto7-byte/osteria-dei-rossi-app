import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createMenuItemOutput,
  manageMenuOutput,
  menuItemOutput,
  serviceMenuItem,
  serviceMenuOutput,
  updateMenuItemOutput,
} from "@/server/menu/output";

const ID = "3e000000-0000-4000-8000-000000000001";
const KEY = "ec000000-0000-4000-8000-0000000000e1";

// Every property name of a schema, at any depth, through its JSON Schema.
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

// AT4: what a waiter may never see in the menu (plan §5 step 11). Sale prices are allowed, costs are not.
const WAITER_FORBIDDEN = /cost|margin|gp|food|eur$|recipe|vat/i;

// M18: eleven item keys and a top-level `pinned` list (the pushed items, which stay in their category too).
const SERVICE_ITEM = {
  id: ID,
  name: "Spezzatino con polenta (demo)",
  category: "Secondi",
  course: "secondi",
  price: 14,
  available: true,
  unavailableReason: null,
  portionsLeft: 3,
  lowStock: true,
  pushed: true,
  pushPrice: 12.5,
};
const SERVICE = {
  pinned: [SERVICE_ITEM],
  categories: [{ name: "Secondi", items: [SERVICE_ITEM] }],
};
const ITEM = {
  id: ID,
  name: "Spezzatino con polenta (demo)",
  category: "Secondi",
  course: "secondi",
  position: 0,
  recipeKey: KEY,
  recipeName: "Spezzatino con polenta (demo)",
  recipeActive: true,
  unmapped: false,
  price: 14,
  vatRate: 10,
  priceValidFrom: "2026-11-02T10:00:00.123456+00:00",
  available: true,
  active: true,
  pushUntil: null,
  pushPrice: null,
};
const UNMAPPED = {
  ...ITEM,
  recipeKey: null,
  recipeName: null,
  recipeActive: null,
  unmapped: true,
  pushUntil: "2026-11-02T20:00:00+00:00",
  pushPrice: 12,
};

describe("serviceMenuOutput (the waiter's menu)", () => {
  it("parses the database shape", () => {
    expect(serviceMenuOutput.parse(SERVICE)).toEqual(SERVICE);
    expect(serviceMenuOutput.parse({ pinned: [], categories: [] })).toEqual({
      pinned: [],
      categories: [],
    });
  });

  it("has exactly the eleven item keys of the plan (§3.1.9)", () => {
    expect(Object.keys(serviceMenuItem.shape).sort()).toEqual(
      [
        "available",
        "category",
        "course",
        "id",
        "lowStock",
        "name",
        "portionsLeft",
        "price",
        "pushPrice",
        "pushed",
        "unavailableReason",
      ].sort(),
    );
  });

  it("needs the pinned list", () => {
    expect(serviceMenuOutput.safeParse({ categories: [] }).success).toBe(false);
  });

  it.each([
    ["a manual switch", { available: false, unavailableReason: "manual", portionsLeft: 2 }],
    ["an empty batch", { available: false, unavailableReason: "no_portions", portionsLeft: 0 }],
    ["an inactive item", { available: false, unavailableReason: "inactive", portionsLeft: null }],
    ["half a portion", { portionsLeft: 0.5 }],
    ["no stock limit", { portionsLeft: null, lowStock: false }],
  ])("accepts an item with %s", (_name, extra) => {
    const item = { ...SERVICE_ITEM, ...extra };
    expect(
      serviceMenuOutput.safeParse({ pinned: [], categories: [{ name: "x", items: [item] }] })
        .success,
    ).toBe(true);
  });

  it("refuses an unknown unavailable reason", () => {
    const item = { ...SERVICE_ITEM, unavailableReason: "sold_out" };
    expect(
      serviceMenuOutput.safeParse({ pinned: [], categories: [{ name: "x", items: [item] }] })
        .success,
    ).toBe(false);
  });

  it("applies the strict item shape to the pinned list too", () => {
    const leaky = { ...SERVICE_ITEM, unit_cost: 3 };
    expect(serviceMenuOutput.safeParse({ pinned: [leaky], categories: [] }).success).toBe(false);
  });

  it("accepts a null push price for an item that is not pushed", () => {
    const item = { ...SERVICE_ITEM, pushed: false, pushPrice: null };
    expect(
      serviceMenuOutput.safeParse({ pinned: [], categories: [{ name: "Secondi", items: [item] }] })
        .success,
    ).toBe(true);
  });

  it.each([
    ["a cost", { unit_cost: 3 }],
    ["a margin", { margin_eur: 9 }],
    ["a recipe key", { recipeKey: KEY }],
    ["a VAT rate", { vatRate: 10 }],
    ["a stray key", { position: 1 }],
  ])("refuses an item that carries %s (strict: never a leak)", (_name, extra) => {
    const item = { ...SERVICE_ITEM, ...extra };
    expect(
      serviceMenuOutput.safeParse({ pinned: [], categories: [{ name: "Secondi", items: [item] }] })
        .success,
    ).toBe(false);
  });

  it("refuses an unknown course and a stray top-level key", () => {
    const item = { ...SERVICE_ITEM, course: "contorni" };
    expect(
      serviceMenuOutput.safeParse({ pinned: [], categories: [{ name: "x", items: [item] }] })
        .success,
    ).toBe(false);
    expect(serviceMenuOutput.safeParse({ ...SERVICE, totalCost: 1 }).success).toBe(false);
  });

  it("has no cost, margin, GP, food cost, EUR or recipe key anywhere (AT4)", () => {
    const names = propertyNames(serviceMenuOutput);
    expect(names.length).toBeGreaterThan(8);
    expect(names.filter((name) => WAITER_FORBIDDEN.test(name))).toEqual([]);
  });

  it("matches the committed JSON Schema (a change is deliberate)", () => {
    expect(z.toJSONSchema(serviceMenuOutput, { io: "output" })).toMatchSnapshot();
  });
});

describe("manage shapes (owner and admin)", () => {
  it("parses a mapped and an unmapped item", () => {
    expect(menuItemOutput.parse(ITEM)).toEqual(ITEM);
    expect(menuItemOutput.parse(UNMAPPED)).toEqual(UNMAPPED);
  });

  it("has the 16 keys of the database item", () => {
    expect(Object.keys(menuItemOutput.shape)).toHaveLength(16);
  });

  it("parses the list with its form data", () => {
    const body = {
      defaults: { vatRate: 10 },
      vatRates: [0, 4, 5, 10, 22],
      courses: ["antipasti", "primi", "secondi", "dolci", "bevande"],
      categories: ["Bevande", "Secondi"],
      items: [ITEM, UNMAPPED],
    };
    expect(manageMenuOutput.parse(body)).toEqual(body);
    expect(manageMenuOutput.safeParse({ ...body, defaults: { vatRate: null } }).success).toBe(true);
  });

  it("wraps the create and update replies", () => {
    expect(createMenuItemOutput.parse({ item: ITEM })).toEqual({ item: ITEM });
    expect(updateMenuItemOutput.parse({ changed: false, item: ITEM })).toEqual({
      changed: false,
      item: ITEM,
    });
    expect(updateMenuItemOutput.safeParse({ item: ITEM }).success).toBe(false);
  });

  it("refuses a cost key on an item", () => {
    expect(menuItemOutput.safeParse({ ...ITEM, unit_cost: 3 }).success).toBe(false);
    expect(menuItemOutput.safeParse({ ...ITEM, gp_pct: 60 }).success).toBe(false);
  });

  it("has no cost, margin, GP or food-cost key either", () => {
    const names = [manageMenuOutput, createMenuItemOutput, updateMenuItemOutput].flatMap((schema) =>
      propertyNames(schema),
    );
    expect(names.filter((name) => /cost|margin|gp|food|eur$/i.test(name))).toEqual([]);
  });
});
