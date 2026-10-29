// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";
import { CHOICES, INGREDIENT, SUPPLIER, SUPPLIER_ITEM } from "./rules-fixtures";

// UX plan C4 (P2-4, L7): the screens that show one ingredient or supplier link to its other screens, for the roles
// that may open them. The chef never gets a link to Costi.

const BEEF = INGREDIENT.ingredientId;
const MASTER_INGREDIENT = {
  id: BEEF,
  name: "Manzo muscolo (demo)",
  baseUnit: "kg",
  category: null,
  isStock: true,
  allergens: [],
  allergenStatus: "confirmed",
  allergensConfirmedAt: "2026-10-20T10:00:00Z",
  defaultShelfLifeDays: null,
  isActive: true,
};
const SUPPLIER_RECORD = {
  id: SUPPLIER,
  name: "Macelleria X (demo)",
  vatNumber: "IT12345678903",
  paymentTermsDays: 30,
  isActive: true,
};
const COST = {
  id: BEEF,
  name: "Manzo muscolo (demo)",
  baseUnit: "kg",
  isActive: true,
  basis: "moving_average",
  unitCostEur: 9,
  avgEur: 9,
  lastEur: 9,
  maxEur: 9,
  purchasesUsed: 1,
  lastPurchaseOn: "2026-10-20",
};

let role = "owner";
let masterIngredient = MASTER_INGREDIENT;
const ok = (data: unknown) => Promise.resolve({ ok: true, status: 200, data });
const apiJson = vi.fn((path: string) => {
  if (path === "/api/me") {
    return ok({
      user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role },
      tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
    });
  }
  if (path.startsWith("/api/rules/ingredients"))
    return ok({ today: "2026-11-02", items: [INGREDIENT], supplierItems: CHOICES });
  if (path.startsWith("/api/rules/suppliers")) return ok({ items: [SUPPLIER_ITEM] });
  if (path.startsWith("/api/costs/ingredients"))
    return ok({ at: null, avgCostN: 5, ingredients: [COST] });
  if (path.startsWith("/api/ingredients")) return ok({ ingredients: [masterIngredient] });
  if (path.startsWith("/api/suppliers/")) return ok({ supplier: SUPPLIER_RECORD });
  if (path.startsWith("/api/supplier-items")) return ok({ items: [] });
  if (path.startsWith("/api/stock/lots"))
    return ok({
      ingredient: { id: BEEF, name: "Manzo muscolo (demo)", baseUnit: "kg" },
      today: "2026-11-02",
      units: ["kg", "g"],
      locations: [],
      lots: [],
    });
  if (path.startsWith("/api/stock/movements")) return ok({ operations: [], nextCursor: null });
  if (path.startsWith("/api/stock"))
    return ok({
      items: [
        {
          ingredientId: BEEF,
          name: "Manzo muscolo (demo)",
          baseUnit: "kg",
          isActive: true,
          onHandQty: 9,
          negative: false,
          locations: [],
        },
      ],
    });
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import MasterIngredientsPage from "@/app/(owner)/anagrafiche/ingredienti/page";
import SupplierPage from "@/app/(owner)/anagrafiche/fornitori/[id]/page";
import RuleIngredientsPage from "@/app/(owner)/riordino/ingredienti/page";
import RuleSuppliersPage from "@/app/(owner)/riordino/fornitori/page";
import IngredientCostsPage from "@/app/(owner)/costi/ingredienti/page";
import StockDetailPage from "@/app/(owner)/magazzino/[ingredientId]/page";

beforeEach(() => {
  resetMe();
  role = "owner";
  masterIngredient = MASTER_INGREDIENT;
  apiJson.mockClear();
});
afterEach(cleanup);

/** The facet links inside the row/group/page that names `anchor`, as "label -> href". */
const linksIn = (scope: HTMLElement) =>
  within(scope)
    .queryAllByRole("link")
    .map((link) => `${link.textContent} -> ${link.getAttribute("href")}`);

const suspended = (page: typeof StockDetailPage | typeof SupplierPage, params: object) =>
  createElement(
    Suspense,
    { fallback: null },
    createElement(page as never, { params: Promise.resolve(params) }),
  );

describe("Anagrafiche › Ingredienti", () => {
  it("links an ingredient row to Magazzino, Riordino and Costi for the owner", async () => {
    render(createElement(MasterIngredientsPage));
    const row = (await screen.findByText("Manzo muscolo (demo)")).closest("li") as HTMLElement;
    await within(row).findByRole("link", { name: "Costi" });
    expect(linksIn(row)).toEqual([
      `Magazzino -> /magazzino/${BEEF}`,
      `Riordino -> /riordino/ingredienti#rule-ingredient-${BEEF}`,
      `Costi -> /costi/ingredienti#ingredient-cost-${BEEF}`,
    ]);
  });

  it("gives the chef Magazzino and Riordino and no Costi", async () => {
    role = "chef";
    render(createElement(MasterIngredientsPage));
    const row = (await screen.findByText("Manzo muscolo (demo)")).closest("li") as HTMLElement;
    await within(row).findByRole("link", { name: "Riordino" });
    expect(linksIn(row)).toEqual([
      `Magazzino -> /magazzino/${BEEF}`,
      `Riordino -> /riordino/ingredienti#rule-ingredient-${BEEF}`,
    ]);
  });

  it("offers an ingredient that is not kept in stock only the cost link, to the owner", async () => {
    masterIngredient = { ...MASTER_INGREDIENT, isStock: false };
    render(createElement(MasterIngredientsPage));
    const row = (await screen.findByText("Manzo muscolo (demo)")).closest("li") as HTMLElement;
    await within(row).findByRole("link", { name: "Costi" });
    expect(linksIn(row)).toEqual([`Costi -> /costi/ingredienti#ingredient-cost-${BEEF}`]);
  });
});

describe("Riordino › Ingredienti", () => {
  it("links a card to the record, the stock and the cost for the owner", async () => {
    render(createElement(RuleIngredientsPage));
    const card = await screen.findByRole("group", { name: "Manzo muscolo (demo)" });
    await within(card).findByRole("link", { name: "Costi" });
    expect(linksIn(card)).toEqual([
      `Anagrafica -> /anagrafiche/ingredienti#ingredient-${BEEF}`,
      `Magazzino -> /magazzino/${BEEF}`,
      `Costi -> /costi/ingredienti#ingredient-cost-${BEEF}`,
    ]);
  });

  it("gives the chef the record and the stock, never Costi", async () => {
    role = "chef";
    render(createElement(RuleIngredientsPage));
    const card = await screen.findByRole("group", { name: "Manzo muscolo (demo)" });
    await within(card).findByRole("link", { name: "Magazzino" });
    expect(linksIn(card)).toEqual([
      `Anagrafica -> /anagrafiche/ingredienti#ingredient-${BEEF}`,
      `Magazzino -> /magazzino/${BEEF}`,
    ]);
  });

  it("marks the card with the anchor the other screens link to", async () => {
    render(createElement(RuleIngredientsPage));
    await screen.findByRole("group", { name: "Manzo muscolo (demo)" });
    expect(document.getElementById(`rule-ingredient-${BEEF}`)).toBeTruthy();
  });
});

describe("Costi › Ingredienti", () => {
  it("links a cost row to the record, the stock and the reorder rules", async () => {
    render(createElement(IngredientCostsPage));
    const row = (await screen.findByText("Manzo muscolo (demo)")).closest("li") as HTMLElement;
    await within(row).findByRole("link", { name: "Riordino" });
    expect(linksIn(row)).toEqual([
      `Anagrafica -> /anagrafiche/ingredienti#ingredient-${BEEF}`,
      `Magazzino -> /magazzino/${BEEF}`,
      `Riordino -> /riordino/ingredienti#rule-ingredient-${BEEF}`,
    ]);
    expect(document.getElementById(`ingredient-cost-${BEEF}`)).toBeTruthy();
  });
});

describe("Magazzino › one ingredient", () => {
  const open = async () => {
    await act(async () => {
      render(suspended(StockDetailPage, { ingredientId: BEEF }));
    });
    await screen.findByRole("heading", { name: "Manzo muscolo (demo)" });
  };
  const main = () => document.body;

  it("links the owner to the record, the reorder rules and the cost", async () => {
    await open();
    await screen.findByRole("link", { name: "Costi" });
    expect(linksIn(main()).filter((l) => !l.endsWith("-> /magazzino"))).toEqual([
      `Anagrafica -> /anagrafiche/ingredienti#ingredient-${BEEF}`,
      `Riordino -> /riordino/ingredienti#rule-ingredient-${BEEF}`,
      `Costi -> /costi/ingredienti#ingredient-cost-${BEEF}`,
    ]);
  });

  it("gives the chef the record and the reorder rules, never Costi", async () => {
    role = "chef";
    await open();
    await screen.findByRole("link", { name: "Riordino" });
    expect(screen.queryByRole("link", { name: "Costi" })).toBeNull();
    expect(screen.getByRole("link", { name: "Anagrafica" })).toBeTruthy();
  });
});

describe("a supplier", () => {
  it("record -> Riordino (its delivery rules), for the owner and the chef", async () => {
    for (const who of ["owner", "chef"]) {
      resetMe();
      role = who;
      await act(async () => {
        render(suspended(SupplierPage, { id: SUPPLIER }));
      });
      const link = await screen.findByRole("link", { name: "Riordino" });
      expect(link.getAttribute("href")).toBe(`/riordino/fornitori#rule-supplier-${SUPPLIER}`);
      cleanup();
    }
  });

  it("Riordino › Fornitori: a card links to the supplier's record, and carries its anchor", async () => {
    render(createElement(RuleSuppliersPage));
    const card = await screen.findByRole("group", { name: /Macelleria X/ });
    const link = await within(card).findByRole("link", { name: "Anagrafica" });
    expect(link.getAttribute("href")).toBe(`/anagrafiche/fornitori/${SUPPLIER}`);
    expect(document.getElementById(`rule-supplier-${SUPPLIER}`)).toBeTruthy();
  });
});
