// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPERTO_READ, DINING_TABLES, IDS } from "../helpers/menu-tables-data";

type Init = { method?: string; body?: unknown } | undefined;
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

let tablesReply: Result;
let copertoReply: Result;
let writeReply: Result;
const calls: Array<{ path: string; init: Init }> = [];
const apiJson = vi.fn((path: string, init?: Init): Promise<Result> => {
  calls.push({ path, init });
  if (init?.method) return Promise.resolve(writeReply);
  if (path === "/api/dining-tables") return Promise.resolve(tablesReply);
  if (path === "/api/settings/coperto") return Promise.resolve(copertoReply);
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: Init) => apiJson(path, init),
}));

import DiningTablesPage from "@/app/(owner)/tavoli/impostazioni/page";

beforeEach(() => {
  tablesReply = { ok: true, status: 200, data: { tables: DINING_TABLES } };
  copertoReply = { ok: true, status: 200, data: COPERTO_READ };
  writeReply = { ok: true, status: 200, data: {} };
  calls.length = 0;
  apiJson.mockClear();
});
afterEach(cleanup);

const writes = () => calls.filter((call) => call.init?.method);
const reads = (path: string) => calls.filter((call) => call.path === path && !call.init);
const row = (name: string) => screen.getByRole("group", { name });

describe("Tavoli · impostazioni page", () => {
  it("reads both endpoints and lists the tables in the API's order", async () => {
    render(createElement(DiningTablesPage));
    expect(await screen.findByRole("heading", { name: "Tavoli · impostazioni" })).toBeTruthy();
    await screen.findByRole("group", { name: "Tavolo 2 (demo)" });
    const names = screen
      .getAllByRole("group")
      .map((group) => group.getAttribute("aria-label"))
      .filter((name) => name?.startsWith("Tavolo"));
    expect(names).toEqual(["Tavolo 1 (demo)", "Tavolo 2 (demo)"]);
    expect(reads("/api/dining-tables")).toHaveLength(1);
    expect(reads("/api/settings/coperto")).toHaveLength(1);
  });

  it("a 403 renders one error and no form", async () => {
    tablesReply = { ok: false, status: 403, error: { code: "forbidden", message: "no" } };
    copertoReply = tablesReply;
    render(createElement(DiningTablesPage));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "Le impostazioni dei tavoli non sono disponibili per il tuo ruolo.",
    );
    expect(screen.queryByRole("button", { name: "Aggiungi tavolo" })).toBeNull();
  });

  it("adds a table with its name and order, then reads again and says Salvato.", async () => {
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Tavolo 2 (demo)" });
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Tavolo 3 (demo)" } });
    fireEvent.change(screen.getByLabelText("Ordine"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi tavolo" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: "/api/dining-tables",
      init: { method: "POST", body: { name: "Tavolo 3 (demo)", position: 3 } },
    });
    await waitFor(() => expect(reads("/api/dining-tables")).toHaveLength(2));
    expect((await screen.findByRole("status")).textContent).toBe("Salvato.");
  });

  it("a blank name or a bad order is refused on the form with no request", async () => {
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Tavolo 2 (demo)" });
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi tavolo" }));
    expect(await screen.findByText("Il nome è obbligatorio (massimo 40 caratteri).")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("Ordine"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi tavolo" }));
    expect(await screen.findByText("L'ordine è un numero intero da 0 a 9.999.")).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("shows the server's words when the name is taken", async () => {
    writeReply = {
      ok: false,
      status: 409,
      error: { code: "table_name_taken", message: "Esiste già un tavolo con questo nome." },
    };
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Tavolo 2 (demo)" });
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Tavolo 2 (demo)" } });
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi tavolo" }));
    expect(
      (await screen.findByText("Esiste già un tavolo con questo nome.")).textContent,
    ).toBeTruthy();
  });

  it("renames a table: only the name is sent, to /api/dining-tables/:id", async () => {
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Tavolo 2 (demo)" });
    fireEvent.click(within(row("Tavolo 2 (demo)")).getByRole("button", { name: "Rinomina" }));
    const name = within(row("Tavolo 2 (demo)")).getByLabelText("Nome");
    fireEvent.change(name, { target: { value: "Tavolo due (demo)" } });
    fireEvent.click(within(row("Tavolo 2 (demo)")).getByRole("button", { name: "Salva" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: `/api/dining-tables/${IDS.table2}`,
      init: { method: "PATCH", body: { name: "Tavolo due (demo)" } },
    });
  });

  it("the Attivo switch sends active false at once", async () => {
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Tavolo 2 (demo)" });
    fireEvent.click(within(row("Tavolo 2 (demo)")).getByLabelText("Attivo"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: `/api/dining-tables/${IDS.table2}`,
      init: { method: "PATCH", body: { active: false } },
    });
  });

  it("an open table cannot be switched off: the server's words appear on that row only", async () => {
    writeReply = {
      ok: false,
      status: 409,
      error: { code: "table_open", message: "Chiudi prima il tavolo aperto." },
    };
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Tavolo 1 (demo)" });
    fireEvent.click(within(row("Tavolo 1 (demo)")).getByLabelText("Attivo"));
    await within(row("Tavolo 1 (demo)")).findByText("Chiudi prima il tavolo aperto.");
    expect(within(row("Tavolo 2 (demo)")).queryByText("Chiudi prima il tavolo aperto.")).toBeNull();
  });

  it("saves the coperto with both keys; an empty amount clears it", async () => {
    render(createElement(DiningTablesPage));
    const amount = await screen.findByLabelText(/^Coperto a persona/);
    expect((amount as HTMLInputElement).value).toBe("1,50");
    fireEvent.change(amount, { target: { value: "2" } });
    fireEvent.click(
      within(screen.getByRole("group", { name: "Coperto" })).getByRole("button", { name: "Salva" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: "/api/settings/coperto",
      init: { method: "PATCH", body: { copertoAmount: 2, copertoVatRate: 10 } },
    });
    fireEvent.change(amount, { target: { value: "" } });
    fireEvent.click(
      within(screen.getByRole("group", { name: "Coperto" })).getByRole("button", { name: "Salva" }),
    );
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]!.init!.body).toEqual({ copertoAmount: null, copertoVatRate: null });
  });

  it("a bad coperto is refused on the card with no request", async () => {
    render(createElement(DiningTablesPage));
    fireEvent.change(await screen.findByLabelText(/^Coperto a persona/), {
      target: { value: "1,505" },
    });
    fireEvent.click(
      within(screen.getByRole("group", { name: "Coperto" })).getByRole("button", { name: "Salva" }),
    );
    expect(await screen.findByText(/Il coperto va da 0,01/)).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("says there are no tables when the list is empty", async () => {
    tablesReply = { ok: true, status: 200, data: { tables: [] } };
    render(createElement(DiningTablesPage));
    expect(await screen.findByText("Nessun tavolo. Aggiungi il primo.")).toBeTruthy();
  });
});
