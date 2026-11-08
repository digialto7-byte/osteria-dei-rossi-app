// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GROUP_1,
  PENDING_COUNT,
  RESERVATION_DETAIL,
  RESERVATIONS_DAY,
  ROW_ACCEPTED,
  SESSION_1,
  SUGGESTION,
  TABLE_1,
  TABLE_2,
  TABLE_BOOKING,
  WAITER_RESERVATIONS_DAY,
  RESERVATION_1,
  RESERVATION_2,
} from "../helpers/reservations-data";

type Init = { method?: string; body?: unknown } | undefined;
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

const state = vi.hoisted(() => ({ role: "owner" as string, search: "" }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/components/use-me", () => ({
  useMe: () => ({ me: { user: { role: state.role } }, status: "ok" }),
}));

let dayReply: Result;
let writeReply: Result;
let detailReply: Result;
let tablesReply: Result;
const calls: Array<{ path: string; init: Init }> = [];
const apiJson = vi.fn((path: string, init?: Init): Promise<Result> => {
  calls.push({ path, init });
  if (init?.method) return Promise.resolve(writeReply);
  if (path.startsWith("/api/reservations/pending-count")) {
    return Promise.resolve({ ok: true, status: 200, data: PENDING_COUNT });
  }
  if (path.startsWith("/api/reservations?") || path === "/api/reservations")
    return Promise.resolve(dayReply);
  if (path.startsWith("/api/reservations/")) return Promise.resolve(detailReply);
  if (path === "/api/settings/reservations/tables") {
    return Promise.resolve({ ok: true, status: 200, data: TABLE_BOOKING });
  }
  if (path === "/api/tables") return Promise.resolve(tablesReply);
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: Init) => apiJson(path, init),
}));

import ReservationsPage from "@/app/(owner)/prenotazioni/page";

const ok = (data: unknown): Result => ({ ok: true, status: 200, data });
const fail = (status: number, code: string, message: string): Result => ({
  ok: false,
  status,
  error: { code, message },
});

beforeEach(() => {
  state.role = "owner";
  state.search = "";
  dayReply = ok(RESERVATIONS_DAY);
  writeReply = ok({});
  detailReply = ok(RESERVATION_DETAIL);
  tablesReply = ok({
    businessDate: "2026-11-20",
    tables: [
      { id: TABLE_1, name: "Tavolo 1 (demo)", position: 1, status: "free", session: null },
      { id: TABLE_2, name: "Tavolo 2 (demo)", position: 2, status: "open", session: null },
    ],
  });
  calls.length = 0;
  apiJson.mockClear();
  router.push.mockClear();
  router.replace.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const writes = () => calls.filter((call) => call.init?.method);
const dayReads = () =>
  calls
    .filter(
      (call) => call.path.startsWith("/api/reservations?") || call.path === "/api/reservations",
    )
    .filter((call) => !call.init);
const rowOf = (id: string) =>
  document.querySelector(`[data-reservation-id="${id}"]`) as HTMLElement;
const draw = async () => {
  render(createElement(ReservationsPage));
  await screen.findByRole("heading", { name: "Prenotazioni" });
  await waitFor(() => expect(document.querySelector("[data-reservation-id]")).not.toBeNull());
};
const buttons = (row: HTMLElement) =>
  within(row)
    .queryAllByRole("button")
    .map((b) => b.textContent);

describe("the day", () => {
  it("renders one section per service with the database's counts in the heading", async () => {
    await draw();
    const sections = screen.getAllByRole("region");
    expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual(["Pranzo", "Cena"]);
    expect(
      within(sections[1]!).getByText("2 prenotazioni · 10 coperti · 1 da confermare"),
    ).toBeTruthy();
    expect(within(sections[0]!).getByText("0 prenotazioni · 0 coperti")).toBeTruthy();
    expect(within(sections[0]!).getByText("Nessuna prenotazione.")).toBeTruthy();
  });

  it("reads /api/reservations and, for the owner, the number of requests to answer", async () => {
    await draw();
    expect(dayReads()[0]!.path).toBe("/api/reservations");
    expect(calls.some((c) => c.path === "/api/reservations/pending-count")).toBe(true);
    expect(await screen.findByText("3 richieste da confermare")).toBeTruthy();
  });

  it("?data= asks for that day", async () => {
    state.search = "data=2026-11-20";
    await draw();
    expect(dayReads()[0]!.path).toBe("/api/reservations?date=2026-11-20");
  });

  it("an invalid ?data= falls back to today's business day", async () => {
    state.search = "data=2026-13-40";
    await draw();
    expect(dayReads()[0]!.path).toBe("/api/reservations");
  });

  it("rows are found by data-reservation-id and read time, party, name and tables", async () => {
    await draw();
    expect(within(rowOf(RESERVATION_1)).getByText("20:00 · 4 persone · Cliente Demo")).toBeTruthy();
    expect(
      within(rowOf(RESERVATION_2)).getByText("20:30 · 6 persone · Cliente Due Demo"),
    ).toBeTruthy();
    expect(
      within(rowOf(RESERVATION_2)).getByText("Tavolo 1 (demo) + Tavolo 2 (demo)"),
    ).toBeTruthy();
  });

  it("joinedTo renders 'unito a Tavolo 1 (demo)'", async () => {
    await draw();
    expect(
      within(rowOf(RESERVATION_2)).getByText("Tavolo 2 (demo): unito a Tavolo 1 (demo)"),
    ).toBeTruthy();
  });

  it("the phone is a tel: link and the status is a word in a badge", async () => {
    await draw();
    const link = within(rowOf(RESERVATION_1)).getByRole("link", { name: "390000000001" });
    expect(link.getAttribute("href")).toBe("tel:390000000001");
    expect(within(rowOf(RESERVATION_1)).getByText("Da confermare")).toBeTruthy();
    expect(within(rowOf(RESERVATION_2)).getByText("Confermata")).toBeTruthy();
  });

  it("an erased contact shows Dati cancellati and no phone link", async () => {
    dayReply = ok({
      ...RESERVATIONS_DAY,
      services: RESERVATIONS_DAY.services.map((s) => ({
        ...s,
        reservations: s.reservations.map((r) =>
          r.id === RESERVATION_1 ? { ...r, name: null, phone: null, email: null, actions: [] } : r,
        ),
      })),
    });
    await draw();
    expect(
      within(rowOf(RESERVATION_1)).getByText("20:00 · 4 persone · Dati cancellati"),
    ).toBeTruthy();
    expect(within(rowOf(RESERVATION_1)).queryByRole("link")).toBeNull();
  });

  it("the buttons are exactly the actions of the reply", async () => {
    await draw();
    expect(buttons(rowOf(RESERVATION_1))).toEqual([
      "Accetta",
      "Rifiuta",
      "Sposta",
      "Cancella dati cliente",
    ]);
    expect(buttons(rowOf(RESERVATION_2))).toEqual([
      "Rifiuta",
      "Sposta",
      "Cambia tavoli",
      "Arrivati",
      "Apri tavolo",
      "Cancella dati cliente",
    ]);
  });

  it("the waiter's reply has no Accetta; the waiter reads no request count", async () => {
    state.role = "waiter";
    dayReply = ok(WAITER_RESERVATIONS_DAY);
    await draw();
    expect(buttons(rowOf(RESERVATION_2))).toEqual(["Arrivati", "Apri tavolo"]);
    expect(screen.queryByRole("button", { name: "Accetta" })).toBeNull();
    expect(calls.some((c) => c.path === "/api/reservations/pending-count")).toBe(false);
    // The waiter can type a booking taken by phone.
    expect(screen.getByRole("button", { name: "Nuova prenotazione" })).toBeTruthy();
  });

  it("a 403 renders one notice and no day", async () => {
    dayReply = fail(403, "forbidden", "no");
    render(createElement(ReservationsPage));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Le prenotazioni non sono disponibili per il tuo ruolo.",
    );
    expect(document.querySelector("[data-reservation-id]")).toBeNull();
  });

  it("the date bar: Oggi clears the day, the arrows step one day from the reply's day, the picker asks for its date", async () => {
    state.search = "data=2026-11-20";
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "Oggi" }));
    expect(router.replace).toHaveBeenLastCalledWith("/prenotazioni");
    fireEvent.click(screen.getByRole("button", { name: "Giorno prima" }));
    expect(router.replace).toHaveBeenLastCalledWith("/prenotazioni?data=2026-11-19");
    fireEvent.click(screen.getByRole("button", { name: "Giorno dopo" }));
    expect(router.replace).toHaveBeenLastCalledWith("/prenotazioni?data=2026-11-21");
    fireEvent.change(screen.getByLabelText("Giorno"), { target: { value: "2026-12-24" } });
    expect(router.replace).toHaveBeenLastCalledWith("/prenotazioni?data=2026-12-24");
    expect(screen.getByText("ven 20/11/2026")).toBeTruthy();
  });

  it("every control is at least 44 px (min-h-tap) and nothing carries an inline style", async () => {
    await draw();
    for (const button of document.querySelectorAll("button"))
      expect(button.className).toContain("min-h-tap");
    expect(document.querySelector("[style]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/€|costo|prezzo/i);
  });
});

describe("Accetta", () => {
  async function openAccept() {
    await draw();
    fireEvent.click(within(rowOf(RESERVATION_1)).getByRole("button", { name: "Accetta" }));
    await screen.findByText("Consigliato: Tavolo 2 (demo), 4 posti");
  }

  it("reads the detail and the room's tables, and preselects the suggestion", async () => {
    await openAccept();
    expect(calls.some((c) => c.path === `/api/reservations/${RESERVATION_1}`)).toBe(true);
    expect(
      (
        screen.getByRole("radio", {
          name: "Consigliato: Tavolo 2 (demo), 4 posti",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      screen.getByRole("radio", { name: "Tavoli 1+2: Tavolo 1 (demo) + Tavolo 2 (demo), 6 posti" }),
    ).toBeTruthy();
  });

  it("Conferma sends the suggestion as { tableIds, groupId }, closes the sheet and reads the day again", async () => {
    await openAccept();
    const reads = dayReads().length;
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: `/api/reservations/${RESERVATION_1}/accept`,
      init: { method: "POST", body: { tableIds: [TABLE_2], groupId: null } },
    });
    await waitFor(() => expect(dayReads().length).toBe(reads + 1));
    expect(screen.queryByRole("group", { name: "Accetta la richiesta" })).toBeNull();
  });

  it("an alternative that is a group sends its tables and its group", async () => {
    await openAccept();
    fireEvent.click(
      screen.getByRole("radio", { name: "Tavoli 1+2: Tavolo 1 (demo) + Tavolo 2 (demo), 6 posti" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.init!.body).toEqual({ tableIds: [TABLE_1, TABLE_2], groupId: GROUP_1 });
  });

  it("Senza tavolo sends { tableIds: null, groupId: null }", async () => {
    await openAccept();
    fireEvent.click(screen.getByRole("radio", { name: "Senza tavolo" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.init!.body).toEqual({ tableIds: null, groupId: null });
  });

  it("Scegli tavoli lists the room and sends the ticked tables with no group; none ticked is refused", async () => {
    await openAccept();
    fireEvent.click(screen.getByRole("radio", { name: "Scegli tavoli" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    expect(screen.getByText("Scegli almeno un tavolo.")).toBeTruthy();
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox", { name: "Tavolo 3 (demo)" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.init!.body).toEqual({
      tableIds: [TABLE_BOOKING.tables[2]!.tableId],
      groupId: null,
    });
  });

  it("with no suggestion the choice starts on Senza tavolo and says no table fits", async () => {
    detailReply = ok({ ...RESERVATION_DETAIL, suggestion: { suggested: null, alternatives: [] } });
    await draw();
    fireEvent.click(within(rowOf(RESERVATION_1)).getByRole("button", { name: "Accetta" }));
    expect(await screen.findByText("Nessun tavolo libero adatto.")).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Senza tavolo" }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("a 409 table_taken puts its message in an aria-live region and reads nothing again", async () => {
    await openAccept();
    writeReply = fail(
      409,
      "table_taken",
      "Questo tavolo è già assegnato a un'altra prenotazione in quell'orario.",
    );
    const reads = dayReads().length;
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    const message = await screen.findByText(
      "Questo tavolo è già assegnato a un'altra prenotazione in quell'orario.",
    );
    expect(message.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
    expect(dayReads().length).toBe(reads);
    expect(screen.getByRole("group", { name: "Accetta la richiesta" })).toBeTruthy();
  });

  it("Annulla closes the sheet with no write", async () => {
    await openAccept();
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(screen.queryByRole("group", { name: "Accetta la richiesta" })).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it("Cambia tavoli on an accepted booking posts to /tables", async () => {
    detailReply = ok({
      ...RESERVATION_DETAIL,
      ...ROW_ACCEPTED,
      events: [],
      suggestion: SUGGESTION,
    });
    await draw();
    fireEvent.click(within(rowOf(RESERVATION_2)).getByRole("button", { name: "Cambia tavoli" }));
    await screen.findByText("Consigliato: Tavolo 2 (demo), 4 posti");
    fireEvent.click(screen.getByRole("button", { name: "Conferma" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.path).toBe(`/api/reservations/${RESERVATION_2}/tables`);
  });
});

const moveSubmit = () =>
  within(screen.getByRole("group", { name: "Sposta la prenotazione" })).getByRole("button", {
    name: "Sposta",
  });

describe("Rifiuta, Sposta, Arrivati, Separa tavoli, Cancella dati", () => {
  it("Rifiuta offers three reasons and one tap declines", async () => {
    await draw();
    fireEvent.click(within(rowOf(RESERVATION_1)).getByRole("button", { name: "Rifiuta" }));
    const sheet = within(screen.getByRole("group", { name: "Rifiuta la prenotazione" }));
    expect(sheet.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Siamo al completo",
      "Siamo chiusi",
      "Altro motivo",
      "Annulla",
    ]);
    fireEvent.click(sheet.getByRole("button", { name: "Siamo chiusi" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: `/api/reservations/${RESERVATION_1}/decline`,
      init: { method: "POST", body: { reason: "closed" } },
    });
  });

  it("Sposta asks for date, time, service and party, prefilled, and sends them", async () => {
    await draw();
    fireEvent.click(within(rowOf(RESERVATION_1)).getByRole("button", { name: "Sposta" }));
    expect((screen.getByLabelText("Data") as HTMLInputElement).value).toBe("2026-11-20");
    expect((screen.getByLabelText("Ora") as HTMLInputElement).value).toBe("20:00");
    expect((screen.getByLabelText("Persone") as HTMLInputElement).value).toBe("4");
    expect((screen.getByLabelText("Servizio") as HTMLSelectElement).value).toBe("cena");
    fireEvent.change(screen.getByLabelText("Ora"), { target: { value: "21:15" } });
    fireEvent.change(screen.getByLabelText("Persone"), { target: { value: "12" } });
    fireEvent.click(moveSubmit());
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: `/api/reservations/${RESERVATION_1}/move`,
      init: {
        method: "POST",
        body: { date: "2026-11-20", time: "21:15", serviceKey: "cena", party: 12 },
      },
    });
  });

  it.each([
    ["Persone", "0"],
    ["Persone", "100"],
    ["Persone", "x"],
    ["Ora", ""],
  ])("Sposta with %s = %j is refused with no request", async (label, value) => {
    await draw();
    fireEvent.click(within(rowOf(RESERVATION_1)).getByRole("button", { name: "Sposta" }));
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(moveSubmit());
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("a 422 slot_unavailable shows its message on the sheet", async () => {
    await draw();
    fireEvent.click(within(rowOf(RESERVATION_1)).getByRole("button", { name: "Sposta" }));
    writeReply = fail(422, "slot_unavailable", "Quell'orario è al completo.");
    fireEvent.click(moveSubmit());
    expect(await screen.findByText("Quell'orario è al completo.")).toBeTruthy();
  });

  it("Arrivati posts { mark: 'arrived' } at once and reads the day again", async () => {
    await draw();
    const reads = dayReads().length;
    fireEvent.click(within(rowOf(RESERVATION_2)).getByRole("button", { name: "Arrivati" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: `/api/reservations/${RESERVATION_2}/mark`,
      init: { method: "POST", body: { mark: "arrived" } },
    });
    await waitFor(() => expect(dayReads().length).toBe(reads + 1));
  });

  it("an error of a direct action shows on that row only", async () => {
    await draw();
    writeReply = fail(409, "too_early", "Troppo presto.");
    fireEvent.click(within(rowOf(RESERVATION_2)).getByRole("button", { name: "Arrivati" }));
    expect(await within(rowOf(RESERVATION_2)).findByText("Troppo presto.")).toBeTruthy();
    expect(within(rowOf(RESERVATION_1)).queryByText("Troppo presto.")).toBeNull();
  });

  it("Separa tavoli appears on a seated row from its actions and posts to /split", async () => {
    dayReply = ok({
      ...RESERVATIONS_DAY,
      services: RESERVATIONS_DAY.services.map((s) => ({
        ...s,
        reservations: s.reservations.map((r) =>
          r.id === RESERVATION_2
            ? { ...r, status: "seated", sessionId: SESSION_1, actions: ["split", "erase"] }
            : r,
        ),
      })),
    });
    await draw();
    expect(buttons(rowOf(RESERVATION_2))).toEqual(["Separa tavoli", "Cancella dati cliente"]);
    fireEvent.click(within(rowOf(RESERVATION_2)).getByRole("button", { name: "Separa tavoli" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: `/api/reservations/${RESERVATION_2}/split`,
      init: { method: "POST", body: {} },
    });
  });

  it("Cancella dati cliente asks first, then posts to /erase-contact", async () => {
    await draw();
    fireEvent.click(
      within(rowOf(RESERVATION_1)).getByRole("button", { name: "Cancella dati cliente" }),
    );
    expect(screen.getByText(/Non si può annullare/)).toBeTruthy();
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancella i dati" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: `/api/reservations/${RESERVATION_1}/erase-contact`,
      init: { method: "POST", body: {} },
    });
  });
});

describe("Apri tavolo", () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("posts { sessionId: <uuid v4>, covers: party } and goes to the comanda of the session on 200", async () => {
    writeReply = ok({ sessionId: SESSION_1, created: true });
    await draw();
    fireEvent.click(within(rowOf(RESERVATION_2)).getByRole("button", { name: "Apri tavolo" }));
    expect((screen.getByLabelText("Coperti") as HTMLInputElement).value).toBe("6");
    // The booking has a lead table: there is no table to choose.
    expect(screen.queryByLabelText("Tavolo")).toBeNull();
    fireEvent.click(
      within(screen.getByRole("group", { name: "Apri tavolo" })).getByRole("button", {
        name: "Apri tavolo",
      }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    const write = writes()[0]!;
    expect(write.path).toBe(`/api/reservations/${RESERVATION_2}/seat`);
    const body = write.init!.body as { sessionId: string; covers: number };
    expect(Object.keys(body).sort()).toEqual(["covers", "sessionId"]);
    expect(body.sessionId).toMatch(UUID_V4);
    expect(body.covers).toBe(6);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/tavoli/comanda?s=${SESSION_1}`));
  });

  it("the covers can be edited before opening", async () => {
    writeReply = ok({ sessionId: SESSION_1, created: true });
    await draw();
    fireEvent.click(within(rowOf(RESERVATION_2)).getByRole("button", { name: "Apri tavolo" }));
    fireEvent.change(screen.getByLabelText("Coperti"), { target: { value: "5" } });
    fireEvent.click(
      within(screen.getByRole("group", { name: "Apri tavolo" })).getByRole("button", {
        name: "Apri tavolo",
      }),
    );
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect((writes()[0]!.init!.body as { covers: number }).covers).toBe(5);
  });

  it("a retry after a failure sends the same session id", async () => {
    writeReply = fail(409, "table_already_open", "Il tavolo è già aperto.");
    await draw();
    fireEvent.click(within(rowOf(RESERVATION_2)).getByRole("button", { name: "Apri tavolo" }));
    const open = () =>
      fireEvent.click(
        within(screen.getByRole("group", { name: "Apri tavolo" })).getByRole("button", {
          name: "Apri tavolo",
        }),
      );
    open();
    expect(await screen.findByText("Il tavolo è già aperto.")).toBeTruthy();
    open();
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect((writes()[0]!.init!.body as { sessionId: string }).sessionId).toBe(
      (writes()[1]!.init!.body as { sessionId: string }).sessionId,
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  it("a booking with no assigned table asks for one of the free tables and sends it", async () => {
    dayReply = ok({
      ...RESERVATIONS_DAY,
      services: RESERVATIONS_DAY.services.map((s) => ({
        ...s,
        reservations: s.reservations.map((r) =>
          r.id === RESERVATION_2 ? { ...r, tables: [], leadTable: null, groupName: null } : r,
        ),
      })),
    });
    writeReply = ok({ sessionId: SESSION_1, created: true });
    await draw();
    fireEvent.click(within(rowOf(RESERVATION_2)).getByRole("button", { name: "Apri tavolo" }));
    const select = (await screen.findByLabelText("Tavolo")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Scegli il tavolo",
      "Tavolo 1 (demo)",
    ]);
    const open = () =>
      fireEvent.click(
        within(screen.getByRole("group", { name: "Apri tavolo" })).getByRole("button", {
          name: "Apri tavolo",
        }),
      );
    open();
    expect(screen.getByText("Scegli il tavolo da aprire.")).toBeTruthy();
    expect(writes()).toHaveLength(0);
    fireEvent.change(select, { target: { value: TABLE_1 } });
    open();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect((writes()[0]!.init!.body as { tableId: string }).tableId).toBe(TABLE_1);
  });
});

describe("Nuova prenotazione", () => {
  const open = async () => {
    state.search = "data=2026-11-20";
    await draw();
    fireEvent.click(screen.getByRole("button", { name: "Nuova prenotazione" }));
  };
  const sheet = () => within(screen.getByRole("group", { name: "Nuova prenotazione" }));
  const fill = (over: Record<string, string> = {}) => {
    const values: Record<string, string> = {
      Nome: "Cliente Demo",
      Telefono: "+39 000 0000001",
      Persone: "12",
      Ora: "13:05",
      ...over,
    };
    for (const [label, value] of Object.entries(values))
      fireEvent.change(sheet().getByLabelText(label), { target: { value } });
  };

  it("starts on the viewed day with the party at 2, and sends exactly the typed fields (no e-mail key when empty)", async () => {
    writeReply = ok({});
    await open();
    expect((sheet().getByLabelText("Data") as HTMLInputElement).value).toBe("2026-11-20");
    expect((sheet().getByLabelText("Persone") as HTMLInputElement).value).toBe("2");
    fireEvent.change(sheet().getByLabelText("Servizio"), { target: { value: "pranzo" } });
    fill();
    fireEvent.click(sheet().getByRole("button", { name: "Salva prenotazione" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: "/api/reservations",
      init: {
        method: "POST",
        body: {
          date: "2026-11-20",
          time: "13:05",
          serviceKey: "pranzo",
          party: 12,
          name: "Cliente Demo",
          phone: "+39 000 0000001",
        },
      },
    });
  });

  it("an e-mail is sent when typed; there is no note field", async () => {
    await open();
    fill();
    fireEvent.change(sheet().getByLabelText("E-mail (facoltativa)"), {
      target: { value: "cliente.demo@example.com" },
    });
    expect(sheet().queryByLabelText(/nota|allergi/i)).toBeNull();
    fireEvent.click(sheet().getByRole("button", { name: "Salva prenotazione" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect((writes()[0]!.init!.body as { email: string }).email).toBe("cliente.demo@example.com");
  });

  it.each([
    ["Nome", "", "Il nome è obbligatorio (massimo 80 caratteri)."],
    ["Telefono", "abc", "Il telefono non è valido (da 6 a 15 cifre)."],
    ["Persone", "0", "Le persone vanno da 1 a 99."],
    ["Persone", "100", "Le persone vanno da 1 a 99."],
    ["Ora", "", "L'ora non è valida: usa il formato 20:00."],
    ["Data", "", "La data non è valida."],
    ["E-mail (facoltativa)", "x", "L'e-mail non è valida."],
  ])("%s = %j is refused on the sheet with no request", async (label, value, message) => {
    await open();
    fill();
    fireEvent.change(sheet().getByLabelText(label), { target: { value } });
    fireEvent.click(sheet().getByRole("button", { name: "Salva prenotazione" }));
    expect(sheet().getByText(message)).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("a server error (table taken, date in the past, service) stays on the sheet", async () => {
    await open();
    fill();
    writeReply = fail(422, "date_past", "La data è già passata.");
    fireEvent.click(sheet().getByRole("button", { name: "Salva prenotazione" }));
    const message = await sheet().findByText("La data è già passata.");
    expect(message.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
  });

  it("on success the sheet closes and the day is read again", async () => {
    await open();
    fill();
    const reads = dayReads().length;
    fireEvent.click(sheet().getByRole("button", { name: "Salva prenotazione" }));
    await waitFor(() => expect(dayReads().length).toBe(reads + 1));
    expect(screen.queryByRole("group", { name: "Nuova prenotazione" })).toBeNull();
  });
});

describe("polling", () => {
  const setVisibility = (value: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { value, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  afterEach(() => setVisibility("visible"));

  it("reads the day and the request count every 60 s while visible, and not at all while hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await draw();
    const start = dayReads().length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(dayReads().length).toBe(start + 1);
    expect(calls.filter((c) => c.path === "/api/reservations/pending-count")).toHaveLength(
      start + 1,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(dayReads().length).toBe(start + 1);

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const hiddenAt = dayReads().length;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(180_000);
    });
    expect(dayReads().length).toBe(hiddenAt);

    // Back on screen: one read at once.
    await act(async () => {
      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(dayReads().length).toBe(hiddenAt + 1);
  });
});
