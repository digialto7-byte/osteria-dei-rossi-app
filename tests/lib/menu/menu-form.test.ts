import { describe, expect, it } from "vitest";
import {
  bodyFromForm,
  emptyMenuForm,
  formFromItem,
  parsePrice,
  patchFromForm,
  type MenuFormState,
} from "@/lib/menu/menu-form";
import type { MenuItem } from "@/server/menu/output";

const KEY = "ec000000-0000-4000-8000-0000000000e1";
const ITEM: MenuItem = {
  id: "3e000000-0000-4000-8000-000000000001",
  name: "Spezzatino con polenta (demo)",
  category: "Secondi",
  course: "secondi",
  position: 2,
  recipeKey: KEY,
  recipeName: "Spezzatino con polenta (demo)",
  recipeActive: true,
  unmapped: false,
  price: 14,
  vatRate: 10,
  priceValidFrom: "2026-11-02T10:00:00+00:00",
  available: true,
  active: true,
  pushUntil: null,
  pushPrice: null,
};
const FILLED: MenuFormState = {
  name: "Acqua (demo)",
  category: "Bevande",
  course: "bevande",
  recipeKey: "",
  price: "2,00",
  vatRate: "10",
  position: "",
  available: true,
  active: true,
};

describe("parsePrice", () => {
  it("reads a decimal comma or dot with up to 2 decimals", () => {
    expect(parsePrice("14,00")).toEqual({ ok: true, value: 14 });
    expect(parsePrice("14.5")).toEqual({ ok: true, value: 14.5 });
    expect(parsePrice(" 2 ")).toEqual({ ok: true, value: 2 });
    expect(parsePrice("0")).toEqual({ ok: true, value: 0 });
    expect(parsePrice("10000,00")).toEqual({ ok: true, value: 10000 });
  });
  it.each(["14,005", "", "  ", "abc", "-1", "1e3", "10000,01", "1.234,50", "14,"])(
    "refuses %j",
    (text) => {
      expect(parsePrice(text).ok).toBe(false);
    },
  );
});

describe("emptyMenuForm", () => {
  it("is pre-filled with the default VAT rate only", () => {
    expect(emptyMenuForm(10)).toMatchObject({ vatRate: "10", recipeKey: "", course: "secondi" });
    expect(emptyMenuForm(null).vatRate).toBe("");
  });
});

describe("formFromItem", () => {
  it("shows the price with a decimal comma and the recipe key", () => {
    expect(formFromItem(ITEM)).toEqual({
      name: ITEM.name,
      category: "Secondi",
      course: "secondi",
      recipeKey: KEY,
      price: "14,00",
      vatRate: "10",
      position: "2",
      available: true,
      active: true,
    });
  });
  it("an unmapped item has an empty recipe", () => {
    expect(formFromItem({ ...ITEM, recipeKey: null }).recipeKey).toBe("");
  });
});

describe("bodyFromForm", () => {
  it("turns 'Nessuna ricetta' into recipeKey null and a comma price into a number", () => {
    expect(bodyFromForm(FILLED)).toEqual({
      ok: true,
      body: {
        name: "Acqua (demo)",
        category: "Bevande",
        course: "bevande",
        recipeKey: null,
        price: 2,
        vatRate: 10,
        available: true,
      },
    });
  });
  it("sends the recipe key and the position when given", () => {
    const result = bodyFromForm({ ...FILLED, recipeKey: KEY, position: "3" });
    expect(result).toMatchObject({ ok: true, body: { recipeKey: KEY, position: 3 } });
  });
  it("reports every problem in Italian, by field", () => {
    const result = bodyFromForm({
      ...FILLED,
      name: " ",
      category: "",
      price: "14,005",
      vatRate: "",
      position: "x",
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        name: expect.stringMatching(/nome/i),
        category: expect.stringMatching(/categoria/i),
        price: "Prezzo non valido.",
        vatRate: "Aliquota IVA non ammessa.",
        position: expect.stringMatching(/ordine/i),
      },
    });
  });
  it("an empty price is an error, not zero", () => {
    expect(bodyFromForm({ ...FILLED, price: "" })).toMatchObject({ ok: false });
  });
  it("refuses a name or category over the limit", () => {
    expect(bodyFromForm({ ...FILLED, name: "x".repeat(81) }).ok).toBe(false);
    expect(bodyFromForm({ ...FILLED, category: "x".repeat(41) }).ok).toBe(false);
    expect(bodyFromForm({ ...FILLED, name: "x".repeat(80), category: "y".repeat(40) }).ok).toBe(
      true,
    );
  });
  it("refuses a position outside 0 to 9999", () => {
    expect(bodyFromForm({ ...FILLED, position: "10000" }).ok).toBe(false);
    expect(bodyFromForm({ ...FILLED, position: "9999" }).ok).toBe(true);
  });
});

describe("patchFromForm", () => {
  it("sends only what changed, so a rename alone does not touch the price", () => {
    const state = { ...formFromItem(ITEM), name: "Spezzatino (demo)" };
    expect(patchFromForm(state, ITEM)).toEqual({ ok: true, patch: { name: "Spezzatino (demo)" } });
  });
  it("a price written differently but equal is no change", () => {
    const state = { ...formFromItem(ITEM), price: "14" };
    expect(patchFromForm(state, ITEM)).toEqual({ ok: true, patch: {} });
  });
  it("sends the price, the VAT rate, the recipe and active when they change", () => {
    const state = {
      ...formFromItem(ITEM),
      price: "15,50",
      vatRate: "22",
      recipeKey: "",
      active: false,
      available: false,
      course: "primi",
      category: "Primi",
      position: "0",
    };
    expect(patchFromForm(state, ITEM)).toEqual({
      ok: true,
      patch: {
        category: "Primi",
        course: "primi",
        recipeKey: null,
        price: 15.5,
        vatRate: 22,
        position: 0,
        available: false,
        active: false,
      },
    });
  });
  it("reports a bad price", () => {
    expect(patchFromForm({ ...formFromItem(ITEM), price: "14,005" }, ITEM)).toMatchObject({
      ok: false,
      errors: { price: "Prezzo non valido." },
    });
  });
});
