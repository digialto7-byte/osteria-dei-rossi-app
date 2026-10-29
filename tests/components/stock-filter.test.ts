// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";

// UX plan C6 (P2-6): /magazzino and Anagrafiche › Ingredienti have a name filter. It ignores case and accents, says
// "Nessun risultato per «…»" with a "Cancella" button when nothing matches, and is absent when the list is empty.

const stockItem = (n: number, name: string) => ({
  ingredientId: `1a000000-0000-4000-8000-00000000000${n}`,
  name,
  baseUnit: "kg",
  isActive: true,
  onHandQty: n,
  negative: false,
  locations: [],
});
const masterIngredient = (n: number, name: string) => ({
  id: `1a000000-0000-4000-8000-00000000000${n}`,
  name,
  baseUnit: "kg",
  category: null,
  isStock: true,
  allergens: [],
  allergenStatus: "confirmed",
  allergensConfirmedAt: "2026-10-20T10:00:00Z",
  defaultShelfLifeDays: null,
  isActive: true,
});
const NAMES = ["Pomodoro San Marzano (demo)", "Crème fraîche (demo)", "Farina 00 (demo)"];

let empty = false;
const ok = (data: unknown) => Promise.resolve({ ok: true, status: 200, data });
const apiJson = vi.fn((path: string) => {
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
  if (path.startsWith("/api/locations")) return ok({ locations: [] });
  if (path.startsWith("/api/stock"))
    return ok({ asOf: "2026-11-02", items: empty ? [] : NAMES.map((n, i) => stockItem(i + 1, n)) });
  if (path.startsWith("/api/ingredients"))
    return ok({ ingredients: empty ? [] : NAMES.map((n, i) => masterIngredient(i + 1, n)) });
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({ apiJson: (path: string) => apiJson(path) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import StockPage from "@/app/(owner)/magazzino/page";
import IngredientsPage from "@/app/(owner)/anagrafiche/ingredienti/page";

beforeEach(() => {
  resetMe();
  empty = false;
});
afterEach(cleanup);

describe.each([
  { name: "Magazzino", page: () => createElement(StockPage) },
  { name: "Ingredienti", page: () => createElement(IngredientsPage) },
])("$name filter", ({ page }) => {
  const field = () => screen.getByRole("searchbox", { name: "Cerca per nome" });
  const shown = () => NAMES.filter((name) => screen.queryByText(name, { exact: false }));

  it("lists everything until something is typed", async () => {
    render(page());
    await screen.findByText(/Pomodoro/);
    expect(shown()).toEqual(NAMES);
  });

  it("narrows the list ignoring case: 'pomodoro' finds 'Pomodoro San Marzano (demo)'", async () => {
    render(page());
    await screen.findByText(/Pomodoro/);
    fireEvent.change(field(), { target: { value: "pomodoro" } });
    expect(shown()).toEqual(["Pomodoro San Marzano (demo)"]);
  });

  it("ignores accents: 'creme' finds 'Crème fraîche (demo)'", async () => {
    render(page());
    await screen.findByText(/Pomodoro/);
    fireEvent.change(field(), { target: { value: "CREME" } });
    expect(shown()).toEqual(["Crème fraîche (demo)"]);
  });

  it("with no match says 'Nessun risultato per «…»' and 'Cancella' brings the list back", async () => {
    render(page());
    await screen.findByText(/Pomodoro/);
    fireEvent.change(field(), { target: { value: "zafferano" } });
    expect(screen.getByText("Nessun risultato per «zafferano»")).toBeTruthy();
    expect(shown()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Cancella" }));
    expect(shown()).toEqual(NAMES);
    expect((field() as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/Nessun risultato/)).toBeNull();
  });

  it("keeps the filter field when nothing matches, so the query can be edited", async () => {
    render(page());
    await screen.findByText(/Pomodoro/);
    fireEvent.change(field(), { target: { value: "zafferano" } });
    expect(field()).toBeTruthy();
  });

  it("is not shown when the list is empty", async () => {
    empty = true;
    render(page());
    await screen.findByText(/Nessun elemento|Nessuna|magazzino/i);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
