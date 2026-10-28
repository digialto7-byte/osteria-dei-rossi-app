// @vitest-environment jsdom
import { createElement, Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";

// UX plan B11 (P3): the supplier product's number fields are text with the Italian comma, like every other decimal field.
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
const ok = (data: unknown, status = 200) => Promise.resolve({ ok: true, status, data });
const posts: { path: string; body: Record<string, unknown> }[] = [];
const apiJson = vi.fn(
  (path: string, init?: { method?: string; body?: Record<string, unknown> }) => {
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
    if (init?.method === "POST") {
      posts.push({ path, body: init.body ?? {} });
      return ok({}, 201);
    }
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
    if (path.startsWith("/api/ingredients")) return ok({ ingredients: [INGREDIENT] });
    if (path.startsWith("/api/supplier-items")) return ok({ items: [] });
    return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
  },
);
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: { method?: string; body?: Record<string, unknown> }) =>
    apiJson(path, init),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import SupplierPage from "@/app/(owner)/anagrafiche/fornitori/[id]/page";

beforeEach(() => {
  resetMe();
  posts.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

async function open() {
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
  await screen.findByRole("option", { name: /Pomodoro/ });
  fireEvent.change(screen.getByRole("combobox", { name: /^Ingrediente/ }), {
    target: { value: INGREDIENT.id },
  });
  fireEvent.change(screen.getByLabelText("Codice articolo"), { target: { value: "POM-1" } });
  return form;
}
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("the supplier product's number fields", () => {
  it.each(["Pezzi per confezione", "Quantità per pezzo"])(
    "%s is a text field with the decimal keypad, not type=number",
    async (label) => {
      await open();
      const input = screen.getByLabelText(label);
      expect(input.getAttribute("type")).toBe("text");
      expect(input.getAttribute("inputmode")).toBe("decimal");
    },
  );

  it("sends 1,5 typed with a comma as 1.5", async () => {
    const form = await open();
    fill("Pezzi per confezione", "6");
    fill("Quantità per pezzo", "1,5");
    fireEvent.submit(form);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.path).toBe("/api/supplier-items");
    expect(posts[0]!.body).toMatchObject({ packCount: 6, packQty: 1.5, supplierCode: "POM-1" });
  });

  it("accepts a dot as well", async () => {
    const form = await open();
    fill("Pezzi per confezione", "1");
    fill("Quantità per pezzo", "0.75");
    fireEvent.submit(form);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({ packQty: 0.75 });
  });

  it.each(["abc", "1,2,3", "-4", "1e3"])(
    "%s: shows the field error and sends nothing",
    async (bad) => {
      const form = await open();
      fill("Pezzi per confezione", "1");
      fill("Quantità per pezzo", bad);
      fireEvent.submit(form);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Quantità per pezzo");
      expect(alert.textContent).toContain("numero");
      expect(posts).toHaveLength(0);
    },
  );

  it("an empty number is an error too, and names the field", async () => {
    const form = await open();
    fill("Pezzi per confezione", "");
    fill("Quantità per pezzo", "2");
    fireEvent.submit(form);
    expect((await screen.findByRole("alert")).textContent).toContain("Pezzi per confezione");
    expect(posts).toHaveLength(0);
  });

  it("the pack preview follows the comma", async () => {
    await open();
    fill("Pezzi per confezione", "6");
    fill("Quantità per pezzo", "1,5");
    expect((await screen.findByTestId("pack-preview")).textContent).toContain("1,5");
  });

  it("the number error goes away when the form is edited again", async () => {
    const form = await open();
    fill("Pezzi per confezione", "1");
    fill("Quantità per pezzo", "abc");
    fireEvent.submit(form);
    expect((await screen.findByRole("alert")).textContent).toContain("Quantità per pezzo");
    fill("Quantità per pezzo", "1,5");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
