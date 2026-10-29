// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";

// UX plan B9 (P1-7, FB1, FB2): a failed load shows the error and not "Caricamento…"; an add confirms with one status
// note that goes away when the form is edited again.
const SUPPLIER_ID = "c0000000-0000-4000-8000-000000000001";
const INGREDIENT = {
  id: "d0000000-0000-4000-8000-000000000001",
  name: "Pomodoro (demo)",
  baseUnit: "kg",
  category: null,
  isStock: true,
  allergens: [],
  allergenStatus: "confirmed",
  allergensConfirmedAt: null,
  defaultShelfLifeDays: null,
  isActive: true,
};
const SUPPLIER = {
  id: SUPPLIER_ID,
  name: "Fornitore Demo Srl",
  vatNumber: null,
  paymentTermsDays: 30,
  isActive: true,
};

type Reply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };
let failLists = false;
let failWrites = false;
let hangLists = false;
const writes: string[] = [];
const ok = (data: unknown, status = 200): Reply => ({ ok: true, status, data });
const apiJson = vi.fn((path: string, init?: { method?: string }): Promise<Reply> => {
  if (path === "/api/me") {
    return Promise.resolve(
      ok({
        user: {
          id: "a0000000-0000-4000-8000-000000000001",
          displayName: "Utente Demo",
          role: "owner",
        },
        tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
      }),
    );
  }
  if (hangLists && path !== "/api/me") return new Promise(() => {});
  if (init?.method === "POST") {
    writes.push(path);
    if (failWrites) {
      return Promise.resolve({
        ok: false,
        status: 422,
        error: { code: "x", message: "Esiste già." },
      });
    }
    return Promise.resolve(ok({}, 201));
  }
  if (failLists) {
    return Promise.resolve({
      ok: false,
      status: 500,
      error: { code: "internal", message: "Errore interno. Riprova tra poco." },
    });
  }
  if (path.startsWith("/api/suppliers/")) return Promise.resolve(ok({ supplier: SUPPLIER }));
  if (path.startsWith("/api/suppliers")) return Promise.resolve(ok({ suppliers: [] }));
  if (path.startsWith("/api/ingredients"))
    return Promise.resolve(ok({ ingredients: [INGREDIENT] }));
  if (path.startsWith("/api/locations")) return Promise.resolve(ok({ locations: [] }));
  if (path.startsWith("/api/supplier-items")) return Promise.resolve(ok({ items: [] }));
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: { method?: string }) => apiJson(path, init),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import IngredientsPage from "@/app/(owner)/anagrafiche/ingredienti/page";
import LocationsPage from "@/app/(owner)/anagrafiche/ubicazioni/page";
import SuppliersPage from "@/app/(owner)/anagrafiche/fornitori/page";
import SupplierPage from "@/app/(owner)/anagrafiche/fornitori/[id]/page";

beforeEach(() => {
  resetMe();
  failLists = false;
  failWrites = false;
  hangLists = false;
  writes.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

const PAGES = [
  {
    name: "Fornitori",
    element: () => createElement(SuppliersPage),
    form: "Nuovo fornitore",
    button: "Aggiungi fornitore",
    done: "Fornitore aggiunto.",
  },
  {
    name: "Ingredienti",
    element: () => createElement(IngredientsPage),
    form: "Nuovo ingrediente",
    button: "Aggiungi ingrediente",
    done: "Ingrediente aggiunto.",
  },
  {
    name: "Ubicazioni",
    element: () => createElement(LocationsPage),
    form: "Nuova ubicazione",
    button: "Aggiungi ubicazione",
    done: "Ubicazione aggiunta.",
  },
] as const;

/** The add form is open for an empty list and behind its button for a list with rows (UX plan C1). */
async function formReady(name: string, button: string) {
  const open = screen.queryByRole("form", { name }) ?? undefined;
  if (open) return open;
  fireEvent.click(await screen.findByRole("button", { name: button }));
  return screen.getByRole("form", { name });
}

describe.each(PAGES)("$name", ({ element, form, button, done }) => {
  it("when the list cannot be loaded: the error, and no Caricamento…", async () => {
    failLists = true;
    render(element());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Errore interno. Riprova tra poco.",
    );
    expect(screen.queryByText("Caricamento…")).toBeNull();
  });

  it("shows Caricamento… while the list is on its way", () => {
    hangLists = true;
    render(element());
    expect(screen.getByText("Caricamento…")).toBeTruthy();
  });

  it("an add shows one status note, closes the form; editing the form again clears the note", async () => {
    render(element());
    await waitFor(() =>
      expect(
        screen.queryByRole("form", { name: form }) ??
          screen.queryByRole("button", { name: button }),
      ).toBeTruthy(),
    );
    const formEl = await formReady(form, button);
    fireEvent.change(formEl.querySelector("input") as HTMLInputElement, {
      target: { value: "Nome Demo" },
    });
    fireEvent.submit(formEl);
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(1));
    expect(screen.getByRole("status").textContent).toBe(done);
    // The save closed the form; reopening it and editing a field clears the note.
    fireEvent.click(await screen.findByRole("button", { name: button }));
    fireEvent.change(
      screen.getByRole("form", { name: form }).querySelector("input") as HTMLInputElement,
      { target: { value: "Altro" } },
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a refused add shows the error and no success note", async () => {
    failWrites = true;
    render(element());
    await waitFor(() =>
      expect(
        screen.queryByRole("form", { name: form }) ??
          screen.queryByRole("button", { name: button }),
      ).toBeTruthy(),
    );
    const formEl = await formReady(form, button);
    fireEvent.change(formEl.querySelector("input") as HTMLInputElement, {
      target: { value: "Nome Demo" },
    });
    fireEvent.submit(formEl);
    expect((await screen.findByRole("alert")).textContent).toBe("Esiste già.");
    expect(screen.queryByRole("status")).toBeNull();
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
  };

  it("adding a product shows 'Prodotto aggiunto.' once, and editing the form clears it", async () => {
    await open();
    const form = await screen.findByRole("form", { name: "Nuovo articolo" });
    await screen.findByRole("option", { name: /Pomodoro/ });
    fireEvent.change(screen.getByRole("combobox", { name: /^Ingrediente/ }), {
      target: { value: INGREDIENT.id },
    });
    fireEvent.change(screen.getByLabelText("Codice articolo"), { target: { value: "POM-1" } });
    fireEvent.change(screen.getByLabelText("Pezzi per confezione"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Quantità per pezzo"), { target: { value: "5" } });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getAllByRole("status")).toHaveLength(1));
    expect(screen.getByRole("status").textContent).toBe("Prodotto aggiunto.");
    fireEvent.change(screen.getByLabelText("Codice articolo"), { target: { value: "POM-2" } });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a failed load shows the error and not Caricamento…", async () => {
    failLists = true;
    await open();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Errore interno. Riprova tra poco.",
    );
    expect(screen.queryByText("Caricamento…")).toBeNull();
  });
});
