// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDS, TABLES_LIST } from "../helpers/menu-tables-data";
import { addDraft } from "../helpers/sync-data";

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
  window.localStorage.clear();
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
  it("ends with the 'Alto contrasto' toggle, which sets the device's contrast on the page", async () => {
    render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
    const root = document.querySelector("[data-sala]") as HTMLElement;
    const buttons = within(root).getAllByRole("button");
    const last = buttons[buttons.length - 1]!;
    expect(last.textContent).toBe("Alto contrasto");
    expect(root.getAttribute("data-contrast")).toBeNull();
    fireEvent.click(last);
    expect(root.getAttribute("data-contrast")).toBe("high");
    expect(window.localStorage.getItem("kitchen.contrast")).toBe("high");
    expect(last.getAttribute("aria-pressed")).toBe("true");
  });

  it("reads /api/tables once and shows a tile per table with its status word", async () => {
    render(createElement(TablesPage));
    await screen.findByRole("heading", { name: "Tavoli" });
    await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
    expect(reads()).toHaveLength(1);
    expect(within(tile(IDS.table1)).getByText("Aperto")).toBeTruthy();
    expect(within(tile(IDS.table2)).getByText("Libero")).toBeTruthy();
    expect(within(tile(IDS.table3)).getByText("Conto richiesto")).toBeTruthy();
  });

  it("a table joined to a seated booking reads 'Unito a Tavolo 1 (demo)' and a tap on it opens nothing", async () => {
    const joined = {
      ...TABLES_LIST,
      tables: TABLES_LIST.tables.map((table) =>
        table.id === IDS.table2
          ? {
              ...table,
              status: "joined",
              session: null,
              joinedTo: { id: IDS.table1, name: "Tavolo 1 (demo)" },
            }
          : table,
      ),
    };
    listReply = { ok: true, status: 200, data: joined };
    render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table2)).not.toBeNull());
    expect(within(tile(IDS.table2)).getByText("Unito a Tavolo 1 (demo)")).toBeTruthy();
    fireEvent.click(tile(IDS.table2));
    expect(screen.queryByRole("group", { name: "Apri Tavolo 2 (demo)" })).toBeNull();
    expect(screen.queryByLabelText("Coperti")).toBeNull();
  });

  it("when a colleague opens the table whose sheet is up, the sheet goes and focus lands on that table's tile (P2c-5)", async () => {
    render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table2)).not.toBeNull());
    fireEvent.click(tile(IDS.table2));
    const title = await screen.findByRole("heading", { name: "Apri Tavolo 2 (demo)" });
    expect(document.activeElement).toBe(title);
    // The next read says Tavolo 2 is open now.
    listReply = {
      ok: true,
      status: 200,
      data: {
        ...TABLES_LIST,
        tables: TABLES_LIST.tables.map((table) =>
          table.id === IDS.table2
            ? { ...table, status: "open", session: { ...TABLES_LIST.tables[0]!.session! } }
            : table,
        ),
      },
    };
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tile(IDS.table2).tagName).toBe("A");
    expect(document.activeElement).toBe(tile(IDS.table2));
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
    // The role is known once /api/me has answered and React has applied it, so the missing link below is a real absence.
    await waitFor(() => expect(calls.some((call) => call.path === "/api/me")).toBe(true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("link", { name: "Impostazioni" })).toBeNull();
  });

  it("no role gets an Esci inside the page: it lives in the header band, on every screen (QW6)", async () => {
    for (const who of ["waiter", "owner", "admin"]) {
      resetMe();
      role = who;
      const view = render(createElement(TablesPage));
      await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
      await waitFor(() => expect(calls.some((call) => call.path === "/api/me")).toBe(true));
      await act(async () => {
        await Promise.resolve();
      });
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

  it("an occupied tile is a link to its comanda: a tap shows no panel and makes no write", async () => {
    render(createElement(TablesPage));
    await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
    expect(tile(IDS.table1).getAttribute("href")).toBe(`/tavoli/comanda?s=${IDS.session1}`);
    // Next's link navigates from a click handler; the test only needs the page's own reaction to the tap.
    tile(IDS.table1).addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(tile(IDS.table1));
    expect(screen.queryByRole("group", { name: "Tavolo 1 (demo)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Conto richiesto" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Modifica coperti" })).toBeNull();
    expect(screen.queryByLabelText("Coperti")).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  describe("the grid's scroll position (P2b-7)", () => {
    const scrollTo = vi.fn();
    beforeEach(() => {
      scrollTo.mockClear();
      window.sessionStorage.clear();
      Object.defineProperty(window, "scrollTo", { value: scrollTo, configurable: true });
      Object.defineProperty(window, "scrollY", { value: 312, configurable: true });
    });

    it("a tap on an occupied tile saves the offset for the way back", async () => {
      render(createElement(TablesPage));
      await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
      tile(IDS.table1).addEventListener("click", (event) => event.preventDefault());
      fireEvent.click(tile(IDS.table1));
      expect(window.sessionStorage.getItem("tavoli.scroll")).toBe("312");
    });

    it("with an offset stored, the page scrolls to it once, after the first list render", async () => {
      window.sessionStorage.setItem("tavoli.scroll", "312");
      render(createElement(TablesPage));
      expect(scrollTo).not.toHaveBeenCalled();
      await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
      await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1));
      expect(scrollTo).toHaveBeenCalledWith(0, 312);
      // A later read of the list does not scroll again.
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() => expect(reads()).toHaveLength(2));
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(window.sessionStorage.getItem("tavoli.scroll")).toBeNull();
    });

    it("with nothing stored the grid is not scrolled", async () => {
      render(createElement(TablesPage));
      await waitFor(() => expect(tile(IDS.table1)).not.toBeNull());
      expect(scrollTo).not.toHaveBeenCalled();
    });
  });

  describe("W2: a read when the outbox shrinks (P2b-9)", () => {
    const add = (n: number) => bridge.runtime!.outbox.enqueue(addDraft(n));

    it("reads /api/tables once more, with no timer advance, when the queue goes from 2 ops to 1", async () => {
      render(createElement(TablesPage));
      await waitFor(() => expect(reads()).toHaveLength(1));
      const first = await add(1);
      await add(2);
      await waitFor(() => expect(bridge.runtime!.getSnapshot().pending).toBe(2));
      expect(reads()).toHaveLength(1);
      await bridge.runtime!.outbox.settle([{ opId: first.opId, status: "applied", settledAt: 1 }]);
      await waitFor(() => expect(reads()).toHaveLength(2));
    });

    it("does not read again while the ops are unchanged, or when one is added", async () => {
      render(createElement(TablesPage));
      await waitFor(() => expect(reads()).toHaveLength(1));
      await add(1);
      await waitFor(() => expect(bridge.runtime!.getSnapshot().pending).toBe(1));
      await act(async () => {
        await Promise.resolve();
      });
      expect(reads()).toHaveLength(1);
    });

    it("does not read while the page is hidden", async () => {
      render(createElement(TablesPage));
      await waitFor(() => expect(reads()).toHaveLength(1));
      const op = await add(1);
      await waitFor(() => expect(bridge.runtime!.getSnapshot().pending).toBe(1));
      const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      await bridge.runtime!.outbox.settle([{ opId: op.opId, status: "applied", settledAt: 1 }]);
      await waitFor(() => expect(bridge.runtime!.getSnapshot().pending).toBe(0));
      await act(async () => {
        await Promise.resolve();
      });
      expect(reads()).toHaveLength(1);
      hidden.mockRestore();
    });
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
