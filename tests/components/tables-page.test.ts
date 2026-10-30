// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDS, TABLES_LIST } from "../helpers/menu-tables-data";

type Init = { method?: string; body?: unknown } | undefined;
type Result =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

let role = "waiter";
let listReply: Result;
let writeReply: Result;
const calls: Array<{ path: string; init: Init }> = [];
const apiJson = vi.fn((path: string, init?: Init): Promise<Result> => {
  calls.push({ path, init });
  if (path === "/api/me") {
    return Promise.resolve({ ok: true, status: 200, data: { user: { role } } });
  }
  if (init?.method) return Promise.resolve(writeReply);
  if (path === "/api/tables") return Promise.resolve(listReply);
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", () => ({
  apiJson: (path: string, init?: Init) => apiJson(path, init),
}));

vi.mock("@/pwa/use-outbox", async () => (await import("../helpers/sync-runtime")).useOutboxMock());

import TablesPage from "@/app/(owner)/tavoli/page";
import { resetMe } from "@/components/use-me";
import { bridge, startRuntime, stopRuntime } from "../helpers/sync-runtime";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push }) }));

beforeEach(async () => {
  // useMe keeps one /api/me answer per session; every case (and every render that changes role) starts anew.
  resetMe();
  await startRuntime();
  role = "waiter";
  listReply = { ok: true, status: 200, data: TABLES_LIST };
  writeReply = { ok: true, status: 200, data: {} };
  calls.length = 0;
  apiJson.mockClear();
  push.mockClear();
});
afterEach(() => {
  cleanup();
  stopRuntime();
  vi.useRealTimers();
});

const writes = () => calls.filter((call) => call.init?.method);
const reads = () => calls.filter((call) => call.path === "/api/tables" && !call.init);
const tile = (id: string) => document.querySelector(`[data-table-id="${id}"]`) as HTMLElement;

describe("Tavoli page", () => {
  it("reads /api/tables once and shows a tile per table with its status word", async () => {
    render(createElement(TablesPage));
    await screen.findByRole("heading", { name: "Tavoli" });
    await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
    expect(reads()).toHaveLength(1);
    expect(within(tile(IDS.table1)).getByText("Aperto")).toBeTruthy();
    expect(within(tile(IDS.table2)).getByText("Libero")).toBeTruthy();
    expect(within(tile(IDS.table3)).getByText("Conto richiesto")).toBeTruthy();
  });

  it("the markup of the waiter's page has no cost, margin, GP or food cost", async () => {
    render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
    expect(document.body.textContent).not.toMatch(/Costo|Margine|Food cost|\bGP\b/);
  });

  it("the chef (403) sees one error and no tile", async () => {
    listReply = { ok: false, status: 403, error: { code: "forbidden", message: "no" } };
    role = "chef";
    render(createElement(TablesPage));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("I tavoli non sono disponibili per il tuo ruolo.");
    expect(document.querySelector("[data-table-id]")).toBeNull();
    expect(document.body.textContent).not.toContain("€");
  });

  it("owner and admin get a link to the settings; the waiter does not", async () => {
    role = "owner";
    const { unmount } = render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
    const link = await screen.findByRole("link", { name: "Impostazioni" });
    expect(link.getAttribute("href")).toBe("/tavoli/impostazioni");
    unmount();
    resetMe();
    role = "waiter";
    render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
    // The waiter's own "Esci" shows once the role is known, so the missing link below is a real absence.
    await screen.findByRole("button", { name: "Esci" });
    expect(screen.queryByRole("link", { name: "Impostazioni" })).toBeNull();
  });

  it("only the waiter gets Esci on this page; the others have it on Oggi and in the sidebar", async () => {
    role = "waiter";
    const { unmount } = render(createElement(TablesPage));
    const button = await screen.findByRole("button", { name: "Esci" });
    expect(button.parentElement?.className).toContain("lg:hidden");
    unmount();
    for (const other of ["owner", "admin"]) {
      resetMe();
      role = other;
      const view = render(createElement(TablesPage));
      await screen.findByRole("link", { name: "Impostazioni" });
      expect(screen.queryByRole("button", { name: "Esci" })).toBeNull();
      view.unmount();
    }
  });

  it("a free table opens through the dialog: an open_table op with a session id and the covers is queued, then the comanda of that session", async () => {
    render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table2)).not.toBeNull());
    fireEvent.click(tile(IDS.table2));
    fireEvent.change(await screen.findByLabelText("Coperti"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Apri tavolo" }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const [op] = await bridge.runtime!.outbox.pending();
    expect(op).toMatchObject({
      kind: "open_table",
      payload: {
        tableId: IDS.table2,
        sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        covers: 4,
      },
      label: { tableName: "Tavolo 2 (demo)" },
    });
    // B8: the page goes straight to the comanda of the session it just made, instead of closing the card and reading again.
    expect(push).toHaveBeenCalledWith(
      `/tavoli/comanda?s=${(op!.payload as { sessionId: string }).sessionId}`,
    );
    expect(writes()).toHaveLength(0);
  });

  it("it never calls the open endpoint (fetch spy)", async () => {
    render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table2)).not.toBeNull());
    fireEvent.click(tile(IDS.table2));
    fireEvent.click(await screen.findByRole("button", { name: "Apri tavolo" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(calls.filter((c) => c.path.startsWith("/api/tables/") || c.init?.method)).toEqual([]);
  });

  it("warms the worker's copy of the menu once while there is a connection, so the comanda opens offline with its dishes", async () => {
    render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
    expect(calls.filter((c) => c.path === "/api/menu")).toHaveLength(1);
  });

  it("a table opened on this phone and not yet sent shows as open, so it is not opened twice", async () => {
    render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table2)).not.toBeNull());
    expect(within(tile(IDS.table2)).getByText("Libero")).toBeTruthy();
    await bridge.runtime!.queue.queueOpenTable({
      tableId: IDS.table2,
      tableName: "Tavolo 2 (demo)",
      sessionId: "5e000000-0000-4000-8000-0000000000e2",
      covers: 3,
    });
    await waitFor(() => expect(within(tile(IDS.table2)).getByText("Aperto")).toBeTruthy());
  });

  it("a conflict decided later (the table was already open) shows as a notice naming the table and the dishes", async () => {
    render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table2)).not.toBeNull());
    const open = await bridge.runtime!.outbox.enqueue({
      kind: "open_table",
      clientTs: "2026-11-02T19:30:00.000Z",
      userId: "a0000000-0000-4000-8000-000000000001",
      payload: {
        tableId: IDS.table2,
        sessionId: "5e000000-0000-4000-8000-0000000000e2",
        covers: 2,
      },
      scope: { sessionId: "5e000000-0000-4000-8000-0000000000e2" },
      label: { tableName: "Tavolo 3 (demo)" },
      queuedBy: { id: "a0000000-0000-4000-8000-000000000001", displayName: "Cameriere Demo" },
    });
    await bridge.runtime!.outbox.settle([
      {
        opId: open.opId,
        status: "conflict",
        settledAt: 1,
        conflict: { reason: "table_already_open" },
      },
    ]);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Tavolo 3 (demo) era già aperto da un collega.");
    fireEvent.click(within(alert).getByRole("button", { name: "Ho capito" }));
    await waitFor(() => expect(screen.queryByText(/era già aperto da un collega/)).toBeNull());
  });

  it("offline, covers and 'Conto richiesto' are off and say 'Serve la connessione'", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
    fireEvent.click(tile(IDS.table1));
    const bill = (await screen.findByRole("button", {
      name: "Conto richiesto",
    })) as HTMLButtonElement;
    expect(bill.disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Modifica coperti" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("Serve la connessione")).toBeTruthy();
    expect(screen.getByText(/^Sei offline\./)).toBeTruthy();
    online.mockRestore();
  });

  it("an open table shows the panel; Conto richiesto sends billRequested to /api/table-sessions/:id", async () => {
    render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
    fireEvent.click(tile(IDS.table1));
    fireEvent.click(await screen.findByRole("button", { name: "Conto richiesto" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: `/api/table-sessions/${IDS.session1}`,
      init: { method: "PATCH", body: { billRequested: true } },
    });
    await waitFor(() => expect(reads()).toHaveLength(2));
  });

  it("changing the covers sends them to the session", async () => {
    render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
    fireEvent.click(tile(IDS.table1));
    fireEvent.click(await screen.findByRole("button", { name: "Modifica coperti" }));
    fireEvent.change(screen.getByLabelText("Coperti"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva coperti" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.init!.body).toEqual({ covers: 6 });
  });

  it("refetches every 15 seconds while the page is visible", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(createElement(TablesPage));
    await waitFor(() => expect(reads()).toHaveLength(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(reads()).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(reads()).toHaveLength(3);
  });

  it("says so when there are no tables", async () => {
    listReply = { ok: true, status: 200, data: { businessDate: "2026-11-02", tables: [] } };
    render(createElement(TablesPage));
    expect(
      await screen.findByText(
        "Non ci sono ancora tavoli. Il titolare li aggiunge nelle impostazioni.",
      ),
    ).toBeTruthy();
  });
});
