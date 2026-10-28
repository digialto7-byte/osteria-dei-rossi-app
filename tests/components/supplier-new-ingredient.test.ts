// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";

const SUPPLIER_ID = "c0000000-0000-4000-8000-000000000001";
const NEW_ID = "d0000000-0000-4000-8000-0000000000aa";
const ok = (data: unknown, status = 200) => Promise.resolve({ ok: true, status, data });
const ing = (id: string, name: string) => ({
  id,
  name,
  baseUnit: "kg",
  category: null,
  isStock: true,
  allergens: [],
  allergenStatus: "confirmed",
  allergensConfirmedAt: null,
  defaultShelfLifeDays: null,
  isActive: true,
});
let ingredients = [ing("d0000000-0000-4000-8000-000000000001", "Pomodoro (demo)")];
const apiJson = vi.fn((path: string, _init?: unknown) => {
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
  if (
    path === "/api/ingredients" &&
    (_init as { method?: string } | undefined)?.method === "POST"
  ) {
    ingredients = [...ingredients, ing(NEW_ID, "Farina 00")];
    return ok({ ingredient: ing(NEW_ID, "Farina 00") }, 201);
  }
  if (path.startsWith("/api/ingredients")) return ok({ ingredients });
  if (path.startsWith("/api/suppliers/"))
    return ok({
      supplier: {
        id: SUPPLIER_ID,
        name: "Fornitore Demo Srl",
        vatNumber: null,
        paymentTermsDays: 30,
        isActive: true,
      },
    });
  if (path.startsWith("/api/supplier-items")) return ok({ items: [] });
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: unknown) => apiJson(path, init),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import SupplierPage from "@/app/(owner)/anagrafiche/fornitori/[id]/page";

beforeEach(() => {
  resetMe();
  apiJson.mockClear();
  ingredients = [ing("d0000000-0000-4000-8000-000000000001", "Pomodoro (demo)")];
});
afterEach(cleanup);

describe("a supplier's product form can create the ingredient it needs (E7)", () => {
  it("makes the ingredient, offers it in the list and selects it", async () => {
    await act(async () => {
      render(
        createElement(
          Suspense,
          { fallback: null },
          createElement(SupplierPage, { params: Promise.resolve({ id: SUPPLIER_ID }) }),
        ),
      );
    });
    const form = await screen.findByRole("form", { name: "Nuovo articolo" });
    fireEvent.click(screen.getByRole("button", { name: "Nuovo ingrediente" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Farina 00" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea ingrediente" }));
    const select = (await screen.findByRole("combobox", {
      name: /^Ingrediente/,
    })) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(NEW_ID));
    expect(form.contains(select)).toBe(true);
    expect(screen.queryByRole("group", { name: "Nuovo ingrediente" })).toBeNull();
  });
});
