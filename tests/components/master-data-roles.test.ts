// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";

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

let role = "owner";
const paths: string[] = [];
const ok = (data: unknown) => Promise.resolve({ ok: true, status: 200, data });
const apiJson = vi.fn((path: string) => {
  paths.push(path);
  if (path === "/api/me") {
    return ok({
      user: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Utente Demo", role },
      tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
    });
  }
  if (path.startsWith("/api/suppliers/")) return ok({ supplier: SUPPLIER });
  if (path.startsWith("/api/suppliers")) return ok({ suppliers: [SUPPLIER] });
  if (path.startsWith("/api/ingredients")) return ok({ ingredients: [INGREDIENT] });
  if (path.startsWith("/api/locations")) return ok({ locations: [LOCATION] });
  if (path.startsWith("/api/supplier-items")) return ok({ items: [ITEM] });
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import IngredientsPage from "@/app/(owner)/anagrafiche/ingredienti/page";
import LocationsPage from "@/app/(owner)/anagrafiche/ubicazioni/page";
import SuppliersPage from "@/app/(owner)/anagrafiche/fornitori/page";
import SupplierPage from "@/app/(owner)/anagrafiche/fornitori/[id]/page";

beforeEach(() => {
  resetMe();
  role = "owner";
  paths.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

/** Lets /api/me answer and React render the answer, so an absence below is an absence for a known role. */
async function roleKnown() {
  await waitFor(() => expect(paths).toContain("/api/me"));
  const index = paths.indexOf("/api/me");
  // The answer itself, then React's rendering of it: no guessing with a timer.
  await act(async () => {
    await apiJson.mock.results[index]!.value;
  });
}

const PAGES = [
  {
    name: "Fornitori",
    element: () => createElement(SuppliersPage),
    row: "Fornitore Demo Srl",
    form: "Nuovo fornitore",
    button: "Aggiungi fornitore",
  },
  {
    name: "Ingredienti",
    element: () => createElement(IngredientsPage),
    row: "Pomodoro (demo)",
    form: "Nuovo ingrediente",
    button: "Aggiungi ingrediente",
  },
  {
    name: "Ubicazioni",
    element: () => createElement(LocationsPage),
    row: "Cella (demo)",
    form: "Nuova ubicazione",
    button: "Aggiungi ubicazione",
  },
] as const;

describe.each(PAGES)("$name, read-only for the chef", ({ element, row, form, button }) => {
  it("shows the chef the list and no add form", async () => {
    role = "chef";
    render(element());
    await screen.findByText(new RegExp(row.replace(/[()]/g, "\\$&")));
    await roleKnown();
    expect(screen.queryByRole("form", { name: form })).toBeNull();
    expect(screen.queryByRole("button", { name: "Aggiungi" })).toBeNull();
  });

  it("shows the chef no Disattiva button either (the API refuses the PATCH)", async () => {
    role = "chef";
    render(element());
    await screen.findByText(new RegExp(row.replace(/[()]/g, "\\$&")));
    await roleKnown();
    expect(screen.queryByRole("button", { name: "Disattiva" })).toBeNull();
  });

  // UX plan C1: the list has rows, so the form sits behind its "Aggiungi …" button until the owner or admin taps it.
  it.each(["owner", "admin"])(
    "shows the %s the add button, and the form after a tap",
    async (who) => {
      role = who;
      render(element());
      fireEvent.click(await screen.findByRole("button", { name: button }));
      expect(screen.getByRole("form", { name: form })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Aggiungi" })).toBeTruthy();
    },
  );
});

describe("Ingredienti, the owner's buttons", () => {
  it("keeps Disattiva for the owner", async () => {
    render(createElement(IngredientsPage));
    expect(await screen.findByRole("button", { name: "Disattiva" })).toBeTruthy();
  });
});

describe("Ubicazioni and Fornitori, the owner's buttons", () => {
  it("keep Disattiva for the owner on Ubicazioni", async () => {
    render(createElement(LocationsPage));
    expect(await screen.findByRole("button", { name: "Disattiva" })).toBeTruthy();
  });
});

describe("a supplier's page", () => {
  const open = async () => {
    await act(async () => {
      render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(SupplierPage, { params: Promise.resolve({ id: SUPPLIER_ID }) }),
        ),
      );
    });
    await screen.findByRole("heading", { name: "Fornitore Demo Srl" });
  };

  it("shows the chef the products and neither the new-item form nor the item buttons", async () => {
    role = "chef";
    await open();
    await screen.findByText(/POM-1/);
    await roleKnown();
    expect(screen.queryByRole("form", { name: "Nuovo articolo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Aggiungi" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disattiva" })).toBeNull();
    expect(screen.queryByRole("button", { name: /preferito/i })).toBeNull();
  });

  it.each(["owner", "admin"])("shows the %s the form and the item buttons", async (who) => {
    role = who;
    await open();
    expect(await screen.findByRole("form", { name: "Nuovo articolo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disattiva" })).toBeTruthy();
  });

  it("reads /api/me once, through the shared hook", async () => {
    await open();
    await roleKnown();
    expect(paths.filter((p) => p === "/api/me")).toHaveLength(1);
  });
});
