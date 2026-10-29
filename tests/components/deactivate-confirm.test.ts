// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";
import { DeactivateButton } from "@/components/deactivate-button";

// UX plan C2 (P2-2): "Disattiva" asks first. Only "Conferma" sends the PATCH; "Annulla" puts the button back.
// Reactivating needs no question: it undoes nothing and loses nothing.

const SUPPLIER_ID = "c0000000-0000-4000-8000-000000000001";
const SUPPLIER = {
  id: SUPPLIER_ID,
  name: "Fornitore Demo Srl",
  vatNumber: "IT12345678903",
  paymentTermsDays: 30,
  isActive: true,
};
const INGREDIENT = {
  id: "d0000000-0000-4000-8000-000000000001",
  name: "Pomodoro (demo)",
  baseUnit: "kg",
  category: null,
  isStock: true,
  allergens: [],
  allergenStatus: "confirmed",
  allergensConfirmedAt: "2026-10-20T10:00:00Z",
  defaultShelfLifeDays: null,
  isActive: true,
};
const LOCATION = {
  id: "e0000000-0000-4000-8000-000000000001",
  name: "Cella (demo)",
  isActive: true,
};
const ITEM = {
  id: "f0000000-0000-4000-8000-000000000001",
  ingredientId: INGREDIENT.id,
  supplierCode: "POM-1",
  packCount: 1,
  packQty: 5,
  packUnit: "kg",
  packLabel: null,
  baseQtyPerPack: 5,
  baseUnit: "kg",
  isPreferred: false,
  isActive: true,
};

let itemActive = true;
const patches: { path: string; body: unknown }[] = [];
const ok = (data: unknown) => Promise.resolve({ ok: true, status: 200, data });
const apiJson = vi.fn((path: string, init?: { method?: string; body?: unknown }) => {
  if (path === "/api/me") {
    return ok({
      user: {
        id: "a0000000-0000-4000-8000-000000000001",
        displayName: "Utente Demo",
        role: "owner",
      },
      tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
    });
  }
  if (init?.method === "PATCH") {
    patches.push({ path, body: init.body });
    return ok({});
  }
  if (path.startsWith("/api/suppliers/")) return ok({ supplier: SUPPLIER });
  if (path.startsWith("/api/ingredients")) return ok({ ingredients: [INGREDIENT] });
  if (path.startsWith("/api/locations")) return ok({ locations: [LOCATION] });
  if (path.startsWith("/api/supplier-items"))
    return ok({ items: [{ ...ITEM, isActive: itemActive }] });
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: { method?: string; body?: unknown }) => apiJson(path, init),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import IngredientsPage from "@/app/(owner)/anagrafiche/ingredienti/page";
import LocationsPage from "@/app/(owner)/anagrafiche/ubicazioni/page";
import SupplierPage from "@/app/(owner)/anagrafiche/fornitori/[id]/page";

beforeEach(() => {
  resetMe();
  itemActive = true;
  patches.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

describe("DeactivateButton", () => {
  const draw = (isActive: boolean, onToggle = vi.fn()) => {
    render(createElement(DeactivateButton, { name: "Cella", isActive, onToggle }));
    return onToggle;
  };

  it("asks 'Disattivare Cella?' on the first tap and does not toggle yet", () => {
    const onToggle = draw(true);
    fireEvent.click(screen.getByRole("button", { name: "Disattiva" }));
    expect(screen.getByText("Disattivare Cella?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Conferma" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Annulla" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disattiva" })).toBeNull();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("toggles once on 'Conferma' and returns to the button", () => {
    const onToggle = draw(true);
    fireEvent.click(screen.getByRole("button", { name: "Disattiva" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Disattivare Cella?")).toBeNull();
  });

  it("puts the button back on 'Annulla' and never toggles", () => {
    const onToggle = draw(true);
    fireEvent.click(screen.getByRole("button", { name: "Disattiva" }));
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.getByRole("button", { name: "Disattiva" })).toBeTruthy();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("reactivates at once, with no question", () => {
    const onToggle = draw(false);
    fireEvent.click(screen.getByRole("button", { name: "Riattiva" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Disattivare/)).toBeNull();
  });
});

async function confirmFlow(openLabel = "Disattiva") {
  await screen.findByRole("button", { name: openLabel });
  fireEvent.click(screen.getByRole("button", { name: openLabel }));
  expect(patches).toEqual([]);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
  });
}

describe("the three rows", () => {
  it("Ingredienti: Pomodoro (demo) is deactivated only after 'Conferma'", async () => {
    render(createElement(IngredientsPage));
    await confirmFlow();
    expect(patches).toEqual([
      { path: `/api/ingredients/${INGREDIENT.id}`, body: { isActive: false } },
    ]);
  });

  it("Ubicazioni: Cella (demo) is deactivated only after 'Conferma'", async () => {
    render(createElement(LocationsPage));
    await screen.findByText(/Cella/);
    await confirmFlow();
    expect(patches).toEqual([{ path: `/api/locations/${LOCATION.id}`, body: { isActive: false } }]);
  });

  it("a supplier's product: asks with the code and ingredient, sends the PATCH only after 'Conferma'", async () => {
    await act(async () => {
      render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(SupplierPage, { params: Promise.resolve({ id: SUPPLIER_ID }) }),
        ),
      );
    });
    await screen.findByRole("button", { name: "Disattiva" });
    fireEvent.click(screen.getByRole("button", { name: "Disattiva" }));
    expect(screen.getByText("Disattivare POM-1 · Pomodoro (demo)?")).toBeTruthy();
    expect(patches).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    });
    expect(patches).toEqual([
      { path: `/api/supplier-items/${ITEM.id}`, body: { isActive: false } },
    ]);
  });

  it("a supplier's product that is inactive is reactivated with one tap", async () => {
    itemActive = false;
    await act(async () => {
      render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(SupplierPage, { params: Promise.resolve({ id: SUPPLIER_ID }) }),
        ),
      );
    });
    const row = (await screen.findByText(/POM-1/)).closest("li") as HTMLElement;
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "Riattiva" }));
    });
    expect(patches).toEqual([{ path: `/api/supplier-items/${ITEM.id}`, body: { isActive: true } }]);
  });
});
