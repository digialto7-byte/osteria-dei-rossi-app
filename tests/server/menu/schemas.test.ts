import { describe, expect, it } from "vitest";
import { createMenuItemBody, idParams, updateMenuItemBody } from "@/server/menu/schemas";

const KEY = "ec000000-0000-4000-8000-0000000000e1";
const BODY = {
  name: "Spezzatino con polenta (demo)",
  category: "Secondi",
  course: "secondi",
  recipeKey: KEY,
  price: 14,
  vatRate: 10,
};

describe("createMenuItemBody", () => {
  it("accepts the required keys and the optional position and available", () => {
    expect(createMenuItemBody.safeParse(BODY).success).toBe(true);
    expect(createMenuItemBody.safeParse({ ...BODY, position: 3, available: false }).success).toBe(
      true,
    );
    expect(createMenuItemBody.safeParse({ ...BODY, recipeKey: null }).success).toBe(true);
  });

  it.each(["name", "category", "course", "recipeKey", "price", "vatRate"])(
    "requires %s (there is no implicit default)",
    (key) => {
      const { [key]: _omitted, ...rest } = BODY as Record<string, unknown>;
      void _omitted;
      expect(createMenuItemBody.safeParse(rest).success).toBe(false);
    },
  );

  it.each([
    ["an unknown key", { ...BODY, pushUntil: "2026-11-01T10:00:00Z" }],
    ["a cost key", { ...BODY, unit_cost: 3 }],
    ["an empty name", { ...BODY, name: "" }],
    ["a blank name", { ...BODY, name: "   " }],
    ["a name of 81 characters", { ...BODY, name: "x".repeat(81) }],
    ["an empty category", { ...BODY, category: "" }],
    ["a category of 41 characters", { ...BODY, category: "x".repeat(41) }],
    ["an unknown course", { ...BODY, course: "contorni" }],
    ["a malformed recipe key", { ...BODY, recipeKey: "x" }],
    ["a price with 3 decimals", { ...BODY, price: 14.005 }],
    ["a negative price", { ...BODY, price: -0.01 }],
    ["a price above 10 000", { ...BODY, price: 10000.01 }],
    ["a price given as text", { ...BODY, price: "14" }],
    ["a VAT rate that is not allowed", { ...BODY, vatRate: 12 }],
    ["a position of 10 000", { ...BODY, position: 10000 }],
    ["a fractional position", { ...BODY, position: 1.5 }],
    ["available as text", { ...BODY, available: "yes" }],
  ])("refuses %s", (_name, body) => {
    expect(createMenuItemBody.safeParse(body).success).toBe(false);
  });

  it("accepts the bounds: 0 and 10 000, every allowed VAT rate", () => {
    for (const price of [0, 0.01, 10000]) {
      expect(createMenuItemBody.safeParse({ ...BODY, price }).success, String(price)).toBe(true);
    }
    for (const vatRate of [0, 4, 5, 10, 22]) {
      expect(createMenuItemBody.safeParse({ ...BODY, vatRate }).success, String(vatRate)).toBe(
        true,
      );
    }
  });

  it("does not take floating point noise for a third decimal", () => {
    expect(createMenuItemBody.safeParse({ ...BODY, price: 0.1 + 0.2 }).success).toBe(false);
    expect(createMenuItemBody.safeParse({ ...BODY, price: 1.15 }).success).toBe(true);
  });
});

describe("updateMenuItemBody", () => {
  it("accepts any one key, active included", () => {
    for (const patch of [
      { name: "Acqua (demo)" },
      { category: "Bevande" },
      { course: "bevande" },
      { recipeKey: null },
      { price: 2 },
      { vatRate: 22 },
      { position: 0 },
      { available: false },
      { active: false },
    ]) {
      expect(updateMenuItemBody.safeParse(patch).success, JSON.stringify(patch)).toBe(true);
    }
  });

  it("refuses an empty patch, an unknown key and the push keys", () => {
    for (const patch of [{}, { pushUntil: null }, { pushPrice: 1 }, { id: KEY }]) {
      expect(updateMenuItemBody.safeParse(patch).success, JSON.stringify(patch)).toBe(false);
    }
  });

  it("applies the same bounds as the creation body", () => {
    expect(updateMenuItemBody.safeParse({ price: 14.005 }).success).toBe(false);
    expect(updateMenuItemBody.safeParse({ vatRate: 12 }).success).toBe(false);
    expect(updateMenuItemBody.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("idParams", () => {
  it("takes a uuid only", () => {
    expect(idParams.safeParse({ id: KEY }).success).toBe(true);
    expect(idParams.safeParse({ id: "x" }).success).toBe(false);
  });
});
