// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BEEF, CHOICES, INGREDIENT, RECIPE, STEW, SUPPLIER, SUPPLIER_ITEM } from "./rules-fixtures";

type Init = { method?: string; body?: unknown } | undefined;
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

let role = "owner";
let patchReply: Result = { ok: true, status: 200, data: {} };
let ingredientRead: unknown;
const calls: Array<{ path: string; init: Init }> = [];
const apiJson = vi.fn((path: string, init?: Init): Promise<Result> => {
  calls.push({ path, init });
  if (path === "/api/me") {
    return Promise.resolve({ ok: true, status: 200, data: { user: { role } } });
  }
  if (init?.method === "PATCH") return Promise.resolve(patchReply);
  const data: Record<string, unknown> = {
    "/api/rules/ingredients": ingredientRead,
    "/api/rules/suppliers": { items: [SUPPLIER_ITEM] },
    "/api/rules/recipes": { items: [RECIPE] },
  };
  return Promise.resolve({ ok: true, status: 200, data: data[path] });
});
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: Init) => apiJson(path, init),
}));

import IngredientsPage from "@/app/(owner)/riordino/ingredienti/page";
import SuppliersPage from "@/app/(owner)/riordino/fornitori/page";
import RecipesPage from "@/app/(owner)/riordino/ricette/page";

beforeEach(() => {
  role = "owner";
  patchReply = { ok: true, status: 200, data: {} };
  ingredientRead = { today: "2026-11-02", items: [INGREDIENT], supplierItems: CHOICES };
  calls.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

const patches = () => calls.filter((call) => call.init?.method === "PATCH");
const reads = (path: string) => calls.filter((call) => call.path === path && !call.init);

describe("ingredients screen", () => {
  it("saves only the field that changed, then reads the list again and says Salvato.", async () => {
    render(createElement(IngredientsPage));
    const min = await screen.findByLabelText("Minimo");
    fireEvent.change(min, { target: { value: "6,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toEqual({
      path: "/api/rules/ingredients",
      init: { method: "PATCH", body: { ingredientId: BEEF, minLevel: 6.5 } },
    });
    await waitFor(() => expect(reads("/api/rules/ingredients")).toHaveLength(2));
    expect((await screen.findByRole("status")).textContent).toBe("Salvato.");
  });

  it("changing the preferred supplier item and clearing the target are sent as such", async () => {
    render(createElement(IngredientsPage));
    fireEvent.change(await screen.findByLabelText("Obiettivo"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Fornitore preferito"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]!.init!.body).toEqual({
      ingredientId: BEEF,
      targetLevel: null,
      preferredSupplierItemId: null,
    });
  });

  it("a bad number is refused on the card, with no request", async () => {
    render(createElement(IngredientsPage));
    fireEvent.change(await screen.findByLabelText("Minimo"), { target: { value: "1,23456" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Indica una quantità valida, fino a 4 decimali.",
    );
    expect(patches()).toHaveLength(0);
  });

  it("nothing changed sends nothing", async () => {
    render(createElement(IngredientsPage));
    fireEvent.click(await screen.findByRole("button", { name: "Salva" }));
    expect(patches()).toHaveLength(0);
  });

  it("the server's error is shown on the card and no Salvato appears", async () => {
    patchReply = {
      ok: false,
      status: 422,
      error: { code: "levels_invalid", message: "L'obiettivo non può essere inferiore al minimo." },
    };
    render(createElement(IngredientsPage));
    fireEvent.change(await screen.findByLabelText("Obiettivo"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "L'obiettivo non può essere inferiore al minimo.",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("the daily count switch goes to /api/counts/critical", async () => {
    render(createElement(IngredientsPage));
    fireEvent.click(await screen.findByLabelText("Conteggio giornaliero"));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toEqual({
      path: "/api/counts/critical",
      init: { method: "PATCH", body: { ingredientId: BEEF, critical: true } },
    });
  });

  it("the chef sees the values and the switch, with no Salva", async () => {
    role = "chef";
    ingredientRead = { today: "2026-11-02", items: [INGREDIENT] };
    render(createElement(IngredientsPage));
    await screen.findByText("Manzo muscolo (demo)");
    await waitFor(() => expect(calls.some((call) => call.path === "/api/me")).toBe(true));
    expect(screen.queryByRole("button", { name: "Salva" })).toBeNull();
    expect(screen.queryByLabelText("Minimo")).toBeNull();
    expect(screen.getByLabelText("Conteggio giornaliero")).not.toBeNull();
  });

  it("a 403 shows one alert", async () => {
    apiJson.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        error: { code: "forbidden", message: "x" },
      }),
    );
    render(createElement(IngredientsPage));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Il riordino non è disponibile per il tuo ruolo.",
    );
  });

  it("an empty list says so", async () => {
    ingredientRead = { today: "2026-11-02", items: [], supplierItems: [] };
    render(createElement(IngredientsPage));
    expect(await screen.findByText("Nessun ingrediente a magazzino.")).not.toBeNull();
  });
});

describe("suppliers screen", () => {
  it("sends the changed weekdays, sorted, and the cleared cut-off", async () => {
    render(createElement(SuppliersPage));
    fireEvent.click(await screen.findByLabelText("Mar"));
    fireEvent.click(screen.getByLabelText("Lun"));
    fireEvent.change(screen.getByLabelText("Ordine entro le"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toEqual({
      path: "/api/rules/suppliers",
      init: {
        method: "PATCH",
        body: { supplierId: SUPPLIER, deliveryWeekdays: [2, 4], orderCutoffTime: null },
      },
    });
  });

  it("a non-integer lead time is refused with the Italian note, no request", async () => {
    render(createElement(SuppliersPage));
    fireEvent.change(await screen.findByLabelText("Giorni di anticipo"), {
      target: { value: "1,5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Indica un numero intero.");
    expect(patches()).toHaveLength(0);
  });

  it("sends a new lead time", async () => {
    render(createElement(SuppliersPage));
    fireEvent.change(await screen.findByLabelText("Giorni di anticipo"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]!.init!.body).toEqual({ supplierId: SUPPLIER, leadTimeDays: 3 });
  });

  it("the chef reads the supplier as text", async () => {
    role = "chef";
    render(createElement(SuppliersPage));
    await screen.findByText("Macelleria X (demo)");
    await waitFor(() => expect(calls.some((call) => call.path === "/api/me")).toBe(true));
    expect(screen.queryByRole("button", { name: "Salva" })).toBeNull();
    expect(screen.getByText("Lun, Gio")).not.toBeNull();
  });
});

describe("recipes screen", () => {
  it("sends only the changed portions and clears a rule with null", async () => {
    render(createElement(RecipesPage));
    fireEvent.change(await screen.findByLabelText("Porzioni minime"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Tempo di preparazione (min)"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toEqual({
      path: "/api/rules/recipes",
      init: { method: "PATCH", body: { recipeKey: STEW, minPortions: 8, prepTimeMin: null } },
    });
  });

  it("a decimal number of portions is refused, no request", async () => {
    render(createElement(RecipesPage));
    fireEvent.change(await screen.findByLabelText("Porzioni obiettivo"), {
      target: { value: "2,5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Indica un numero intero.");
    expect(patches()).toHaveLength(0);
  });

  it("describes a value from the recipe version, and the hint stays with its field", async () => {
    render(createElement(RecipesPage));
    const target = await screen.findByLabelText("Porzioni obiettivo");
    const hintId = target.getAttribute("aria-describedby")!;
    expect(document.getElementById(hintId)!.textContent).toBe("dalla ricetta v3");
    expect(screen.getByLabelText("Porzioni minime").getAttribute("aria-describedby")).toBeNull();
  });
});
