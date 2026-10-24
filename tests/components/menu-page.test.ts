// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDS, MANAGE_MENU, MAPPED_ITEM, UNMAPPED_ITEM } from "../helpers/menu-tables-data";

type Init = { method?: string; body?: unknown } | undefined;
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

let itemsReply: Result;
let writeReply: Result;
const calls: Array<{ path: string; init: Init }> = [];
const apiJson = vi.fn((path: string, init?: Init): Promise<Result> => {
  calls.push({ path, init });
  if (init?.method) return Promise.resolve(writeReply);
  if (path === "/api/menu/items") return Promise.resolve(itemsReply);
  if (path.startsWith("/api/recipes")) {
    return Promise.resolve({
      ok: true,
      status: 200,
      data: {
        recipes: [
          { key: IDS.recipeKey, name: "Spezzatino con polenta (demo)" },
          { key: "ec000000-0000-4000-8000-0000000000e2", name: "Tagliata (demo)" },
        ],
      },
    });
  }
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: Init) => apiJson(path, init),
}));

import MenuPage from "@/app/(owner)/menu/page";

beforeEach(() => {
  itemsReply = { ok: true, status: 200, data: MANAGE_MENU };
  writeReply = { ok: true, status: 200, data: { item: MAPPED_ITEM } };
  calls.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

const writes = () => calls.filter((call) => call.init?.method);
const reads = (path: string) => calls.filter((call) => call.path === path && !call.init);
const card = (name: string) => screen.getByRole("group", { name });

describe("Menu page", () => {
  it("reads /api/menu/items and the active plates, and shows the items by category", async () => {
    render(createElement(MenuPage));
    expect(await screen.findByRole("heading", { name: "Menu" })).toBeTruthy();
    await screen.findByRole("group", { name: "Acqua (demo)" });
    expect(reads("/api/menu/items")).toHaveLength(1);
    expect(reads("/api/recipes?type=plate&active=true")).toHaveLength(1);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Secondi", "Bevande"]);
  });

  it("flags only the unmapped item with Senza ricetta (AT5)", async () => {
    render(createElement(MenuPage));
    await screen.findByRole("group", { name: "Acqua (demo)" });
    expect(within(card("Acqua (demo)")).getByText("Senza ricetta")).toBeTruthy();
    expect(within(card("Spezzatino con polenta (demo)")).queryByText("Senza ricetta")).toBeNull();
  });

  it("a 403 renders one error and no list, no form", async () => {
    itemsReply = { ok: false, status: 403, error: { code: "forbidden", message: "no" } };
    render(createElement(MenuPage));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Il menu non è modificabile con il tuo ruolo.");
    expect(screen.queryByRole("button", { name: "Nuovo piatto" })).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("another failure shows the server's message", async () => {
    itemsReply = {
      ok: false,
      status: 500,
      error: { code: "internal", message: "Errore interno." },
    };
    render(createElement(MenuPage));
    expect((await screen.findByRole("alert")).textContent).toBe("Errore interno.");
  });

  it("an empty menu says so", async () => {
    itemsReply = { ok: true, status: 200, data: { ...MANAGE_MENU, items: [], categories: [] } };
    render(createElement(MenuPage));
    expect(await screen.findByText("Il menu è vuoto. Aggiungi il primo piatto.")).toBeTruthy();
  });

  it("creates an item without a recipe: the body as the API wants it, then a fresh read and Salvato.", async () => {
    render(createElement(MenuPage));
    fireEvent.click(await screen.findByRole("button", { name: "Nuovo piatto" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Caffè (demo)" } });
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "Bevande" } });
    fireEvent.change(screen.getByLabelText("Portata"), { target: { value: "bevande" } });
    fireEvent.change(screen.getByLabelText("Prezzo (IVA inclusa)"), { target: { value: "1,20" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: "/api/menu/items",
      init: {
        method: "POST",
        body: {
          name: "Caffè (demo)",
          category: "Bevande",
          course: "bevande",
          recipeKey: null,
          price: 1.2,
          vatRate: 10,
          available: true,
        },
      },
    });
    await waitFor(() => expect(reads("/api/menu/items")).toHaveLength(2));
    expect((await screen.findByRole("status")).textContent).toBe("Salvato.");
    expect(screen.queryByRole("button", { name: "Annulla" })).toBeNull();
  });

  it("sends the chosen plate as recipeKey", async () => {
    render(createElement(MenuPage));
    fireEvent.click(await screen.findByRole("button", { name: "Nuovo piatto" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Tagliata (demo)" } });
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "Secondi" } });
    fireEvent.change(await screen.findByLabelText("Ricetta"), {
      target: { value: "ec000000-0000-4000-8000-0000000000e2" },
    });
    fireEvent.change(screen.getByLabelText("Prezzo (IVA inclusa)"), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect((writes()[0]!.init!.body as { recipeKey: string }).recipeKey).toBe(
      "ec000000-0000-4000-8000-0000000000e2",
    );
  });

  it("a bad price is refused on the form, with no request", async () => {
    render(createElement(MenuPage));
    fireEvent.click(await screen.findByRole("button", { name: "Nuovo piatto" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Caffè (demo)" } });
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "Bevande" } });
    fireEvent.change(screen.getByLabelText("Prezzo (IVA inclusa)"), { target: { value: "1,205" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect(await screen.findByText("Prezzo non valido.")).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("shows the server's words for a refused save and keeps the form open", async () => {
    writeReply = {
      ok: false,
      status: 409,
      error: { code: "menu_item_name_taken", message: "Esiste già un piatto con questo nome." },
    };
    render(createElement(MenuPage));
    fireEvent.click(await screen.findByRole("button", { name: "Nuovo piatto" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Acqua (demo)" } });
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "Bevande" } });
    fireEvent.change(screen.getByLabelText("Prezzo (IVA inclusa)"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Esiste già un piatto con questo nome.",
    );
    expect(screen.getByRole("button", { name: "Annulla" })).toBeTruthy();
    expect(reads("/api/menu/items")).toHaveLength(1);
  });

  it("edits one item: the form is filled, only the changed field is sent to /api/menu/:id", async () => {
    render(createElement(MenuPage));
    await screen.findByRole("group", { name: "Acqua (demo)" });
    fireEvent.click(within(card("Acqua (demo)")).getByRole("button", { name: "Modifica" }));
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Acqua (demo)");
    expect((screen.getByLabelText("Prezzo (IVA inclusa)") as HTMLInputElement).value).toBe("2,00");
    fireEvent.change(screen.getByLabelText("Prezzo (IVA inclusa)"), { target: { value: "2,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: `/api/menu/${UNMAPPED_ITEM.id}`,
      init: { method: "PATCH", body: { price: 2.5 } },
    });
  });

  it("saving an edit without a change sends nothing and closes the form", async () => {
    render(createElement(MenuPage));
    await screen.findByRole("group", { name: "Acqua (demo)" });
    fireEvent.click(within(card("Acqua (demo)")).getByRole("button", { name: "Modifica" }));
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Annulla" })).toBeNull());
    expect(writes()).toHaveLength(0);
  });

  it("deactivating from the edit form sends active false", async () => {
    render(createElement(MenuPage));
    await screen.findByRole("group", { name: "Acqua (demo)" });
    fireEvent.click(within(card("Acqua (demo)")).getByRole("button", { name: "Modifica" }));
    fireEvent.click(screen.getByLabelText("Attivo"));
    fireEvent.click(screen.getByRole("button", { name: "Salva" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.init!.body).toEqual({ active: false });
  });

  it("Annulla closes the form without a request", async () => {
    render(createElement(MenuPage));
    fireEvent.click(await screen.findByRole("button", { name: "Nuovo piatto" }));
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.queryByLabelText("Prezzo (IVA inclusa)")).toBeNull();
    expect(writes()).toHaveLength(0);
  });
});
