// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPERTO_READ, DINING_TABLES, IDS } from "../helpers/menu-tables-data";
import { RESERVATION_SETTINGS, TABLE_1, TABLE_BOOKING } from "../helpers/reservations-data";
import { SERVICE_PERIODS } from "../helpers/services-data";

type Init = { method?: string; body?: unknown } | undefined;
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

let tablesReply: Result;
let copertoReply: Result;
let writeReply: Result;
let servicesReply: Result;
let reservationsReply: Result;
let bookingReply: Result;
const calls: Array<{ path: string; init: Init }> = [];
const apiJson = vi.fn((path: string, init?: Init): Promise<Result> => {
  calls.push({ path, init });
  if (init?.method) return Promise.resolve(writeReply);
  if (path === "/api/dining-tables") return Promise.resolve(tablesReply);
  if (path === "/api/settings/coperto") return Promise.resolve(copertoReply);
  if (path === "/api/settings/services") return Promise.resolve(servicesReply);
  if (path === "/api/settings/reservations") return Promise.resolve(reservationsReply);
  if (path === "/api/settings/reservations/tables") return Promise.resolve(bookingReply);
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
  servicesReply = { ok: true, status: 200, data: SERVICE_PERIODS };
  reservationsReply = { ok: true, status: 200, data: RESERVATION_SETTINGS };
  bookingReply = { ok: true, status: 200, data: TABLE_BOOKING };
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

describe("Tavoli · impostazioni page: servizi (M25c step 12)", () => {
  it("reads /api/settings/services once, with the two other reads, and shows the card", async () => {
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Servizi" });
    expect(reads("/api/settings/services")).toHaveLength(1);
    expect(reads("/api/dining-tables")).toHaveLength(1);
    expect(reads("/api/settings/coperto")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Servizi" })).toBeTruthy();
    expect(screen.getByText("Pranzo 11:00–16:00 · Cena 16:00–02:00")).toBeTruthy();
  });

  it("a 403 on the services read renders the existing reserved message and no form", async () => {
    servicesReply = { ok: false, status: 403, error: { code: "forbidden", message: "no" } };
    render(createElement(DiningTablesPage));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "Le impostazioni dei tavoli non sono disponibili per il tuo ruolo.",
    );
    expect(screen.queryByRole("group", { name: "Servizi" })).toBeNull();
  });

  it("saves the list with PATCH /api/settings/services, then reads again and says Salvato.", async () => {
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Servizi" });
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi servizio" }));
    fireEvent.change(screen.getByLabelText("Nome del servizio 3"), {
      target: { value: "Aperitivo" },
    });
    fireEvent.change(screen.getByLabelText("Inizio del servizio 3"), {
      target: { value: "18:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salva servizi" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: "/api/settings/services",
      init: {
        method: "PATCH",
        body: {
          periods: [
            { key: "pranzo", name: "Pranzo", startsAt: "11:00" },
            { key: "cena", name: "Cena", startsAt: "16:00" },
            { key: null, name: "Aperitivo", startsAt: "18:00" },
          ],
        },
      },
    });
    await waitFor(() => expect(reads("/api/settings/services")).toHaveLength(2));
    expect((await screen.findByRole("status")).textContent).toBe("Salvato.");
  });

  it("a 422 from the server shows its message on the services card only", async () => {
    writeReply = {
      ok: false,
      status: 422,
      error: {
        code: "service_periods_invalid",
        message: "Due servizi non possono iniziare alla stessa ora.",
      },
    };
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Servizi" });
    fireEvent.click(screen.getByRole("button", { name: "Salva servizi" }));
    const card = screen.getByRole("group", { name: "Servizi" });
    expect((await within(card).findByRole("alert")).textContent).toBe(
      "Due servizi non possono iniziare alla stessa ora.",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Tavoli · impostazioni page: prenotazioni (reservations A11)", () => {
  it("reads the two reservation endpoints with the three others, in one round, and shows the three cards", async () => {
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Prenotazioni online" });
    expect(screen.getByRole("group", { name: "Tavoli prenotabili" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Gruppi di tavoli" })).toBeTruthy();
    expect(reads("/api/settings/reservations")).toHaveLength(1);
    expect(reads("/api/settings/reservations/tables")).toHaveLength(1);
    // All five reads are issued before any answer is awaited (Promise.all): the order of the calls is the order in the page.
    expect(calls.slice(0, 5).map((call) => call.path)).toEqual([
      "/api/dining-tables",
      "/api/settings/coperto",
      "/api/settings/services",
      "/api/settings/reservations",
      "/api/settings/reservations/tables",
    ]);
  });

  it("a 403 on a reservation read renders the reserved message and no card", async () => {
    reservationsReply = { ok: false, status: 403, error: { code: "forbidden", message: "no" } };
    render(createElement(DiningTablesPage));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Le impostazioni dei tavoli non sono disponibili per il tuo ruolo.",
    );
    expect(screen.queryByRole("group", { name: "Prenotazioni online" })).toBeNull();
  });

  it("saves the edited settings with PATCH /api/settings/reservations, reads again and says Salvato.", async () => {
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Prenotazioni online" });
    fireEvent.change(screen.getByLabelText("Permanenza (minuti)"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva prenotazioni" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: "/api/settings/reservations",
      init: { method: "PATCH", body: { stayMinutes: 90 } },
    });
    await waitFor(() => expect(reads("/api/settings/reservations")).toHaveLength(2));
    expect((await screen.findByRole("status")).textContent).toBe("Salvato.");
  });

  it("the preview uses the page's own origin", async () => {
    reservationsReply = {
      ok: true,
      status: 200,
      data: { ...RESERVATION_SETTINGS, publicSlug: "osteria-demo-a" },
    };
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Prenotazioni online" });
    expect(
      await screen.findByText(`${window.location.origin}/prenota/osteria-demo-a`),
    ).toBeTruthy();
  });

  it("a 422 not-ready answer shows its message on the reservations card only", async () => {
    writeReply = {
      ok: false,
      status: 422,
      error: { code: "reservations_not_ready", message: "Mancano ancora: indirizzo della pagina." },
    };
    reservationsReply = { ok: true, status: 200, data: { ...RESERVATION_SETTINGS, enabled: true } };
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Prenotazioni online" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Accetta prenotazioni online" }));
    fireEvent.click(screen.getByRole("button", { name: "Salva prenotazioni" }));
    const card = screen.getByRole("group", { name: "Prenotazioni online" });
    expect((await within(card).findByRole("alert")).textContent).toBe(
      "Mancano ancora: indirizzo della pagina.",
    );
    expect(
      within(screen.getByRole("group", { name: "Tavoli prenotabili" })).queryByRole("alert"),
    ).toBeNull();
  });

  it("saves the bookable tables with PUT /api/settings/reservations/tables", async () => {
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Tavoli prenotabili" });
    fireEvent.change(screen.getByLabelText("Tavolo 1 (demo): posti"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva tavoli prenotabili" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: "/api/settings/reservations/tables",
      init: { method: "PUT", body: { tables: [{ tableId: TABLE_1, bookable: true, seats: 3 }] } },
    });
  });

  it("creates a group with POST /api/table-groups and deactivates one with POST .../deactivate", async () => {
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Gruppi di tavoli" });
    const card = () => within(screen.getByRole("group", { name: "Gruppi di tavoli" }));
    fireEvent.change(card().getByLabelText("Nome del gruppo"), { target: { value: "Tavoli 2+3" } });
    fireEvent.change(card().getByLabelText("Posti del gruppo"), { target: { value: "8" } });
    fireEvent.click(card().getByRole("checkbox", { name: "Tavolo 2 (demo)" }));
    fireEvent.click(card().getByRole("checkbox", { name: "Tavolo 3 (demo)" }));
    fireEvent.click(card().getByRole("button", { name: "Crea gruppo" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.path).toBe("/api/table-groups");
    expect(writes()[0]!.init).toMatchObject({
      method: "POST",
      body: { name: "Tavoli 2+3", seats: 8 },
    });
    await waitFor(() => expect(reads("/api/settings/reservations/tables")).toHaveLength(2));
    fireEvent.click(card().getByRole("button", { name: "Disattiva il gruppo Tavoli 1+2" }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]!.path).toBe(`/api/table-groups/${TABLE_BOOKING.groups[0]!.id}/deactivate`);
  });

  it("a group error is shown on the new-group form, not on the table add form", async () => {
    writeReply = {
      ok: false,
      status: 422,
      error: { code: "group_invalid", message: "Esiste già un gruppo attivo con questo nome." },
    };
    render(createElement(DiningTablesPage));
    await screen.findByRole("group", { name: "Gruppi di tavoli" });
    const card = within(screen.getByRole("group", { name: "Gruppi di tavoli" }));
    fireEvent.change(card.getByLabelText("Nome del gruppo"), { target: { value: "Tavoli 1+2" } });
    fireEvent.change(card.getByLabelText("Posti del gruppo"), { target: { value: "6" } });
    fireEvent.click(card.getByRole("checkbox", { name: "Tavolo 1 (demo)" }));
    fireEvent.click(card.getByRole("checkbox", { name: "Tavolo 2 (demo)" }));
    fireEvent.click(card.getByRole("button", { name: "Crea gruppo" }));
    expect((await card.findByRole("alert")).textContent).toBe(
      "Esiste già un gruppo attivo con questo nome.",
    );
    expect(
      within(screen.getByRole("group", { name: "Nuovo tavolo" })).queryByRole("alert"),
    ).toBeNull();
  });
});
