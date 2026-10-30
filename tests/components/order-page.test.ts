// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMe } from "@/components/use-me";
import type { ServiceMenu } from "@/server/menu/output";
import type { OrderView } from "@/server/orders/output";
import { MENU, PASTA_ITEM, SOUP_ITEM, STEW_ITEM } from "../helpers/order-components";
import { LINE_SOUP, LINE_STEW, OIDS, ORDER_VIEW, STEW } from "../helpers/orders-data";
import { BILL, BILL_BY_COVERS, BILL_BY_ITEMS, BILL_CLOSED, TOKEN } from "../helpers/bill-data";
import { assignLine, initialSplitForm, splitBodyFrom } from "@/lib/bill/split-form";
import { bridge, startRuntime, stopRuntime } from "../helpers/sync-runtime";
import { addDraft, DEMO, DUE } from "../helpers/sync-data";

// The Comanda page after M20 (plan step 20): the page READS /api/menu and /api/table-sessions/:id/lines and WRITES only into the outbox. Here
// apiJson answers the reads and records every call, a real runtime (memory outbox, the real queue and overlay) stands behind the
// `@/pwa/use-outbox` hooks, and nothing is ever sent.
type Init = { method?: string; body?: unknown } | undefined;
type Result =
  | { ok: true; status: number; data: unknown; cachedAt?: string }
  | { ok: false; status: number; error: { code: string; message: string; details?: unknown } };

let menuReply: Result;
let viewReply: Result;
/** The bill replies by path (M21): `/bill`, `/bill?parts=n`, `/bill/split` and `/close`. */
let billReply: (path: string, init: Init) => Result;
let query = "";
const calls: Array<{ path: string; init: Init }> = [];
const ok = (data: unknown, cachedAt?: string): Result => ({
  ok: true,
  status: 200,
  data,
  ...(cachedAt ? { cachedAt } : {}),
});
const apiJson = vi.fn((path: string, init?: Init): Promise<Result> => {
  calls.push({ path, init });
  if (path === "/api/me") {
    return Promise.resolve(
      ok({
        user: { id: DEMO.id, displayName: DEMO.displayName, role: "waiter" },
        tenant: { id: "b0000000-0000-4000-8000-000000000001", name: "Osteria Demo" },
      }),
    );
  }
  if (path === "/api/menu") return Promise.resolve(menuReply);
  if (path === `/api/table-sessions/${OIDS.session}/lines`) return Promise.resolve(viewReply);
  if (
    path.startsWith(`/api/table-sessions/${OIDS.session}/bill`) ||
    path === `/api/table-sessions/${OIDS.session}/close`
  ) {
    return Promise.resolve(billReply(path, init));
  }
  return Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "x" } });
});
vi.mock("@/lib/api/client", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client")),
  apiJson: (path: string, init?: Init) => apiJson(path, init),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(`s=${OIDS.session}${query}`),
}));
vi.mock("@/pwa/use-outbox", async () => (await import("../helpers/sync-runtime")).useOutboxMock());

import OrderPage from "@/app/(owner)/tavoli/comanda/page";

beforeEach(async () => {
  resetMe();
  menuReply = ok(MENU);
  viewReply = ok(ORDER_VIEW);
  billReply = () => ok(BILL_HERE);
  query = "";
  calls.length = 0;
  apiJson.mockClear();
  await startRuntime();
});
afterEach(() => {
  cleanup();
  stopRuntime();
  vi.useRealTimers();
});

// The M21 fixtures, on this page's session (the order view's covers are 4).
const BILL_HERE = { ...BILL, sessionId: OIDS.session, covers: 4 };
const BILL_PATH = `/api/table-sessions/${OIDS.session}/bill`;
const CLOSE_PATH = `/api/table-sessions/${OIDS.session}/close`;
const SPLIT_PATH = `${BILL_PATH}/split`;
const writes = () => calls.filter((c) => c.init?.method);
const reads = (path: string) => calls.filter((c) => c.path === path && !c.init?.method);
const LINES = `/api/table-sessions/${OIDS.session}/lines`;
const pending = () => bridge.runtime!.outbox.pending();
const item = (id: string) =>
  document.querySelector(`[data-menu-item-id="${id}"]:not([data-pinned])`) as HTMLElement;
const row = (id: string) => document.querySelector(`[data-line-id="${id}"]`) as HTMLElement;
const open = async () => {
  render(createElement(OrderPage));
  await screen.findByRole("heading", { name: "Tavolo 1 (demo)" });
  await waitFor(() => expect(item(SOUP_ITEM.id)).not.toBeNull());
};
const openSheet = () => fireEvent.click(screen.getByRole("button", { name: /^Comanda/ }));
const queued = async (n: number) => {
  await waitFor(async () => expect(await pending()).toHaveLength(n));
  return pending();
};

describe("Comanda page: reading", () => {
  it("reads the menu and the order once each and shows the table, the covers and the status", async () => {
    await open();
    expect(reads("/api/menu")).toHaveLength(1);
    expect(reads(LINES)).toHaveLength(1);
    expect(screen.getByText("4 coperti")).toBeTruthy();
    expect(screen.getByText("Aperto")).toBeTruthy();
    expect(screen.getByRole("link", { name: "← Tavoli" }).getAttribute("href")).toBe("/tavoli");
  });

  it("the waiter's markup has no cost, margin, GP or food cost", async () => {
    await open();
    openSheet();
    expect(document.body.textContent).not.toMatch(/Costo|Margine|Food cost|\bGP\b/);
  });

  it("starts on the first course, with the pinned strip before the menu", async () => {
    await open();
    expect(screen.getByRole("tab", { name: /^Antipasti/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    const first = document.querySelector("[data-menu-item-id]") as HTMLElement;
    expect(first.getAttribute("data-pinned")).toBe("true");
    expect(first.getAttribute("data-menu-item-id")).toBe(OIDS.item3);
  });

  it("counts the order's lines on the tabs and on the bar", async () => {
    await open();
    expect(screen.getByRole("tab", { name: "Primi · 1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Secondi · 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Comanda · 2 righe" })).toBeTruthy();
  });

  it("the chef (403) sees one message and no menu, and no euro sign in it", async () => {
    const denied: Result = { ok: false, status: 403, error: { code: "forbidden", message: "no" } };
    menuReply = denied;
    viewReply = denied;
    render(createElement(OrderPage));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("La comanda non è disponibile per il tuo ruolo.");
    expect(alert.textContent).not.toContain("€");
    expect(document.querySelector("[data-menu-item-id]")).toBeNull();
  });

  it("an unknown session (and nothing queued for it) says so", async () => {
    viewReply = {
      ok: false,
      status: 404,
      error: { code: "not_found", message: "Sessione non trovata." },
    };
    render(createElement(OrderPage));
    expect((await screen.findByRole("alert")).textContent).toBe("Sessione non trovata.");
  });

  it("a closed table says so and offers no menu", async () => {
    const closed: OrderView = {
      ...ORDER_VIEW,
      session: { ...ORDER_VIEW.session, closed: true, status: "closed" },
    };
    viewReply = ok(closed);
    render(createElement(OrderPage));
    await screen.findByRole("heading", { name: "Tavolo 1 (demo)" });
    expect(await screen.findByText("Il tavolo è stato chiuso.")).toBeTruthy();
    expect(document.querySelector("[data-menu-item-id]")).toBeNull();
  });

  it("reads the menu and the order again when the page becomes visible", async () => {
    await open();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(reads("/api/menu")).toHaveLength(2));
    expect(reads(LINES)).toHaveLength(2);
  });

  it("a menu that changed shows the dish greyed after the next read", async () => {
    await open();
    const out: ServiceMenu = {
      ...MENU,
      categories: MENU.categories.map((c) => ({
        ...c,
        items: c.items.map((i) =>
          i.id === STEW_ITEM.id
            ? {
                ...i,
                available: false,
                unavailableReason: "no_portions" as const,
                portionsLeft: 0,
                lowStock: false,
              }
            : i,
        ),
      })),
    };
    menuReply = ok(out);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    fireEvent.click(screen.getByRole("tab", { name: /^Secondi/ }));
    await waitFor(() => expect(item(STEW_ITEM.id).getAttribute("aria-disabled")).toBe("true"));
  });

  it("reads the order again as soon as queued operations leave the outbox (the server has them)", async () => {
    await open();
    const op = await bridge.runtime!.outbox.enqueue(addDraft(9));
    await waitFor(() => expect(bridge.runtime!.getSnapshot().pending).toBe(1));
    const before = reads(LINES).length;
    await bridge.runtime!.outbox.settle([{ opId: op.opId, status: "applied", settledAt: 1 }]);
    await waitFor(() => expect(reads(LINES).length).toBe(before + 1));
  });
});

describe("Comanda page: writing goes into the outbox, never to the endpoints", () => {
  it("a tap on a dish enqueues one add_line (fresh line id, stamp, dish and price) and shows 'In coda' at once", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: /^Primi/ }));
    fireEvent.click(item(SOUP_ITEM.id));
    const [op] = await queued(1);
    expect(op).toMatchObject({
      kind: "add_line",
      userId: DEMO.id,
      payload: {
        sessionId: OIDS.session,
        lineId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        menuItemId: SOUP_ITEM.id,
        course: "primi",
      },
      label: { tableName: "Tavolo 1 (demo)", dishName: SOUP_ITEM.name, unitPrice: 9 },
    });
    expect(op!.clientTs).toMatch(/Z$/);
    openSheet();
    const line = await waitFor(() => {
      const found = row((op!.payload as { lineId: string }).lineId);
      expect(found).not.toBeNull();
      return found;
    });
    expect(within(line).getByText("In coda")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Comanda · 3 righe" })).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("an unavailable dish adds nothing", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: /^Primi/ }));
    fireEvent.click(item(PASTA_ITEM.id));
    expect(await pending()).toHaveLength(0);
  });

  it("two taps are two lines with two ids", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: /^Primi/ }));
    fireEvent.click(item(SOUP_ITEM.id));
    fireEvent.click(item(SOUP_ITEM.id));
    const ops = await queued(2);
    const ids = ops.map((op) => (op.payload as { lineId: string }).lineId);
    expect(new Set(ids).size).toBe(2);
    expect(ops.map((op) => op.seq)).toEqual([1, 2]);
  });

  describe("'Scarta' and 'Rimuovi' on a queued add", () => {
    async function tapSoup() {
      await open();
      openSheet();
      fireEvent.click(screen.getByRole("tab", { name: /^Primi/ }));
      fireEvent.click(item(SOUP_ITEM.id));
      const [op] = await queued(1);
      await waitFor(() => expect(row((op!.payload as { lineId: string }).lineId)).not.toBeNull());
      return op!;
    }

    it("'Scarta' on an add that was never sent deletes it from the outbox; the sheet loses the line; nothing is queued instead", async () => {
      const op = await tapSoup();
      fireEvent.click(screen.getByRole("button", { name: "Scarta" }));
      await waitFor(async () => expect(await pending()).toHaveLength(0));
      expect(row((op.payload as { lineId: string }).lineId)).toBeNull();
      expect(await bridge.runtime!.outbox.outcomes()).toEqual([]);
    });

    it("'Scarta' on an add that was already tried queues a removal after it (the add replays, then voids)", async () => {
      const op = await tapSoup();
      await bridge.runtime!.outbox.markAttempt(op.opId, 5_000);
      fireEvent.click(await screen.findByRole("button", { name: "Scarta" }));
      const after = await queued(2);
      expect(after.map((o) => o.kind)).toEqual(["add_line", "remove_line"]);
      expect(after[1]!.payload).toEqual({ lineId: (op.payload as { lineId: string }).lineId });
    });

    it("'Rimuovi' in the editor of a queued add throws it away as well", async () => {
      const op = await tapSoup();
      fireEvent.click(
        within(row((op.payload as { lineId: string }).lineId)).getByRole("button", {
          name: /^Modifica/,
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Rimuovi" }));
      await waitFor(async () => expect(await pending()).toHaveLength(0));
      expect(row((op.payload as { lineId: string }).lineId)).toBeNull();
    });
  });

  describe("editing a line", () => {
    const edit = async () => {
      await open();
      openSheet();
      fireEvent.click(screen.getByRole("button", { name: /^Modifica 2 × Spezzatino/ }));
    };

    it("a change enqueues one edit_line with only that field, stamped after the line's own, and the line says 'In coda'", async () => {
      await edit();
      fireEvent.click(screen.getByRole("button", { name: "Più una porzione" }));
      const [op] = await queued(1);
      expect(op).toMatchObject({
        kind: "edit_line",
        payload: { lineId: OIDS.line1, qty: 3 },
        scope: { sessionId: OIDS.session, lineId: OIDS.line1 },
      });
      expect(Date.parse(op!.clientTs)).toBeGreaterThan(Date.parse(LINE_STEW.clientUpdatedAt));
      await waitFor(() =>
        expect(within(row(OIDS.line1)).getByText("3 × Spezzatino con polenta (demo)")).toBeTruthy(),
      );
      expect(within(row(OIDS.line1)).getByText("In coda")).toBeTruthy();
      expect(writes()).toHaveLength(0);
    });

    it("a second change is stamped after the first one's stamp", async () => {
      await edit();
      fireEvent.click(screen.getByRole("button", { name: "Più una porzione" }));
      await queued(1);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Più una porzione" })).toBeTruthy(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Più una porzione" }));
      const ops = await queued(2);
      expect(Date.parse(ops[1]!.clientTs)).toBeGreaterThan(Date.parse(ops[0]!.clientTs));
      expect(ops[1]!.payload).toEqual({ lineId: OIDS.line1, qty: 4 });
    });

    it("moving to another course sends the course", async () => {
      await edit();
      fireEvent.change(screen.getByRole("combobox", { name: /^Portata/ }), {
        target: { value: "dolci" },
      });
      const [op] = await queued(1);
      expect(op!.payload).toEqual({ lineId: OIDS.line1, course: "dolci" });
      await waitFor(() => expect(screen.getByRole("tab", { name: "Dolci · 1" })).toBeTruthy());
    });

    it("a note unchanged queues nothing", async () => {
      await edit();
      fireEvent.blur(screen.getByRole("textbox", { name: /^Nota/ }));
      expect(await pending()).toHaveLength(0);
    });

    it("Rimuovi on a line the server holds queues a removal, and the line leaves the sheet at once", async () => {
      await edit();
      fireEvent.click(screen.getByRole("button", { name: "Rimuovi" }));
      const [op] = await queued(1);
      expect(op).toMatchObject({ kind: "remove_line", payload: { lineId: OIDS.line1 } });
      await waitFor(() => expect(row(OIDS.line1)).toBeNull());
      expect(screen.getByRole("button", { name: "Comanda · 1 riga" })).toBeTruthy();
      expect(writes()).toHaveLength(0);
    });

    it("Fatto closes the editor", async () => {
      await edit();
      fireEvent.click(screen.getByRole("button", { name: "Fatto" }));
      expect(screen.queryByRole("button", { name: "Fatto" })).toBeNull();
    });
  });

  describe("offline: the session only this phone knows", () => {
    it("a 404 read with a queued open_table shows the table from the op, takes orders, and shows no error", async () => {
      viewReply = {
        ok: false,
        status: 0,
        error: { code: "network", message: "Connessione assente." },
      };
      await bridge.runtime!.queue.queueOpenTable({
        tableId: OIDS.table,
        tableName: "Tavolo 3 (demo)",
        sessionId: OIDS.session,
        covers: 2,
      });
      render(createElement(OrderPage));
      await screen.findByRole("heading", { name: "Tavolo 3 (demo)" });
      expect(screen.getByText("2 coperti")).toBeTruthy();
      await waitFor(() => expect(item(SOUP_ITEM.id)).not.toBeNull());
      expect(screen.queryByText("Connessione assente.")).toBeNull();
      // ...and the banner says what offline means.
      expect(screen.getByText(/^Sei offline\./)).toBeTruthy();
      fireEvent.click(screen.getByRole("tab", { name: /^Primi/ }));
      fireEvent.click(item(SOUP_ITEM.id));
      const ops = await queued(2);
      expect(ops.map((o) => o.kind)).toEqual(["open_table", "add_line"]);
    });

    it("a read answered from the worker's copy shows the offline banner with the time", async () => {
      viewReply = ok(ORDER_VIEW, "2026-11-02T19:31:00.000Z");
      await open();
      expect(screen.getByText(/^Sei offline\./)).toBeTruthy();
      expect(screen.getByText("Dati delle 20:31")).toBeTruthy();
    });

    it("online and live there is no offline banner", async () => {
      await open();
      expect(screen.queryByText(/^Sei offline\./)).toBeNull();
    });
  });

  describe("sending a course", () => {
    const sendStew = () =>
      fireEvent.click(screen.getByRole("button", { name: "Invia in cucina: Secondi, 1 piatto" }));

    it("enqueues one fire with exactly the ids of the group, and the line says 'In coda per la cucina' - never 'In cucina'", async () => {
      await open();
      openSheet();
      sendStew();
      const [op] = await queued(1);
      expect(op).toMatchObject({
        kind: "fire",
        payload: { sessionId: OIDS.session, lineIds: [LINE_STEW.id] },
      });
      await waitFor(() =>
        expect(within(row(LINE_STEW.id)).getByText("In coda per la cucina")).toBeTruthy(),
      );
      expect(within(row(LINE_STEW.id)).queryByText("In cucina")).toBeNull();
      // The soup is a draft of another course and stays editable; the stew has no second send button.
      expect(within(row(LINE_SOUP.id)).getByRole("button", { name: /^Modifica/ })).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Invia in cucina: Secondi, 1 piatto" }),
      ).toBeNull();
      expect(writes()).toHaveLength(0);
    });

    it("pressing again after the first press queues nothing more", async () => {
      await open();
      openSheet();
      sendStew();
      await queued(1);
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Invia in cucina: Secondi, 1 piatto" }),
        ).toBeNull(),
      );
      expect(await pending()).toHaveLength(1);
    });

    it("the segue button queues the segue line alone", async () => {
      await open();
      openSheet();
      fireEvent.click(
        screen.getByRole("button", { name: "Invia in cucina: Primi a seguire, 1 piatto" }),
      );
      const [op] = await queued(1);
      expect(op!.payload).toEqual({ sessionId: OIDS.session, lineIds: [LINE_SOUP.id] });
    });

    it("more than 50 drafts in one course are several fire ops of at most 50 ids, in order, none lost", async () => {
      const manyIds = Array.from(
        { length: 51 },
        (_, i) => `30000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      );
      viewReply = ok({ ...ORDER_VIEW, lines: manyIds.map((id) => ({ ...LINE_STEW, id })) });
      await open();
      openSheet();
      fireEvent.click(await screen.findByRole("button", { name: /^Invia in cucina: Secondi, 51/ }));
      const ops = await queued(2);
      expect(ops.map((o) => (o.payload.lineIds as string[]).length)).toEqual([50, 1]);
      expect(ops.flatMap((o) => o.payload.lineIds as string[])).toEqual(manyIds);
    });

    it("the fire is queued behind the adds it depends on: a new dish sent at once goes add, then fire", async () => {
      await open();
      openSheet();
      fireEvent.click(screen.getByRole("tab", { name: /^Secondi/ }));
      fireEvent.click(item(STEW_ITEM.id));
      await queued(1);
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Invia in cucina: Secondi, 2 piatti" }),
        ).toBeTruthy(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Invia in cucina: Secondi, 2 piatti" }));
      const ops = await queued(2);
      expect(ops.map((o) => o.kind)).toEqual(["add_line", "fire"]);
      const added = (ops[0]!.payload as { lineId: string }).lineId;
      expect(ops[1]!.payload.lineIds as string[]).toContain(added);
    });

    it("the markup has no cost, margin or food cost", async () => {
      await open();
      openSheet();
      sendStew();
      await queued(1);
      expect(document.body.textContent).not.toMatch(/Costo|Margine|Food cost/);
    });
  });

  describe("voiding a sent line", () => {
    const FIRED_STEW = { ...LINE_STEW, state: "fired" as const };
    const openDialog = async () => {
      viewReply = ok({ ...ORDER_VIEW, lines: [FIRED_STEW, LINE_SOUP] });
      await open();
      openSheet();
      fireEvent.click(within(row(LINE_STEW.id)).getByRole("button", { name: /^Storna/ }));
    };
    const choose = (reason: string) =>
      fireEvent.change(screen.getByRole("combobox", { name: /^Motivo/ }), {
        target: { value: reason },
      });

    it("opens the dialog in place and queues {lineId, reason}; the line says 'Storno in coda'", async () => {
      await openDialog();
      expect(within(row(LINE_STEW.id)).getByRole("combobox", { name: /^Motivo/ })).toBeTruthy();
      choose("kitchen_error");
      fireEvent.click(screen.getByRole("button", { name: "Storna piatto" }));
      const [op] = await queued(1);
      expect(op).toMatchObject({
        kind: "void_line",
        payload: { lineId: LINE_STEW.id, reason: "kitchen_error" },
      });
      expect(Date.parse(op!.clientTs)).toBeGreaterThan(Date.parse(FIRED_STEW.clientUpdatedAt));
      await waitFor(() =>
        expect(within(row(LINE_STEW.id)).getByText("Storno in coda")).toBeTruthy(),
      );
      expect(screen.queryByRole("combobox", { name: /^Motivo/ })).toBeNull();
      expect(writes()).toHaveLength(0);
    });

    it("'Annulla' closes the dialog and queues nothing", async () => {
      await openDialog();
      fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
      expect(screen.queryByRole("combobox", { name: /^Motivo/ })).toBeNull();
      expect(await pending()).toHaveLength(0);
    });
  });
});

describe("Comanda page: what the server decided later", () => {
  async function settledConflict(
    over: Partial<Parameters<typeof addDraft>> | null = null,
    session = OIDS.session,
  ) {
    void over;
    const draft = {
      ...addDraft(5, "s1", DEMO),
      kind: "edit_line" as const,
      payload: { lineId: LINE_STEW.id, qty: 9 },
      scope: { sessionId: session, lineId: LINE_STEW.id },
    };
    const op = await bridge.runtime!.outbox.enqueue(draft);
    await bridge.runtime!.outbox.settle([
      {
        opId: op.opId,
        status: "conflict",
        settledAt: 1,
        conflict: { reason: "fired", line: { ...LINE_STEW, state: "fired" } },
      },
    ]);
    return op;
  }

  it("a conflict from the replay shows as a notice naming the dish, with 'Ho capito' that marks it seen", async () => {
    await open();
    const op = await settledConflict();
    const alert = await waitFor(() => {
      const found = document.querySelector(`[data-op-id="${op.opId}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(alert.textContent).toContain(
      "«Spezzatino con polenta (demo)» era già in cucina: la tua modifica non è stata applicata.",
    );
    fireEvent.click(within(alert).getByRole("button", { name: "Ho capito" }));
    await waitFor(() => expect(document.querySelector(`[data-op-id="${op.opId}"]`)).toBeNull());
    expect((await bridge.runtime!.outbox.outcomes())[0]!.seen).toBe(true);
  });

  it("a table this phone opened but a colleague had already opened: the dead comanda still shows the notice (no view, no page body)", async () => {
    // The session never existed on the server: the read says 404, and the open_table came back as table_already_open.
    viewReply = {
      ok: false,
      status: 404,
      error: { code: "not_found", message: "Sessione non trovata." },
    };
    const outbox = bridge.runtime!.outbox;
    const open = await outbox.enqueue({
      ...addDraft(1, "s1", DEMO),
      kind: "open_table",
      payload: { tableId: OIDS.table, sessionId: OIDS.session, covers: 2 },
      scope: { sessionId: OIDS.session },
      label: { tableName: "Tavolo 1 (demo)" },
    });
    const add = await outbox.enqueue({
      ...addDraft(2, "s1", DEMO),
      scope: { sessionId: OIDS.session, lineId: LINE_STEW.id },
      label: { tableName: "Tavolo 1 (demo)", dishName: "Acqua (demo)" },
    });
    await outbox.settle([
      {
        opId: open.opId,
        status: "conflict",
        settledAt: 1,
        conflict: { reason: "table_already_open", sessionId: OIDS.session },
      },
    ]);
    await outbox.pruneDead(() => ({
      rewrites: [],
      drops: [{ opId: add.opId, reason: "session_not_created", settledAt: 2 }],
    }));
    render(createElement(OrderPage));
    const alert = await screen.findByText(/era già aperto da un collega/);
    expect(alert.textContent).toBe(
      "Tavolo 1 (demo) era già aperto da un collega. Questi piatti non sono stati registrati: Acqua (demo). Inseriscili sul tavolo aperto.",
    );
    expect(alert.closest("[role=alert]")).not.toBeNull();
    fireEvent.click(
      within(alert.closest("[role=alert]") as HTMLElement).getByRole("button", {
        name: "Ho capito",
      }),
    );
    await waitFor(() => expect(screen.queryByText(/era già aperto da un collega/)).toBeNull());
  });

  it("waiter B whose older edit lost (stale) is told who changed the line, with the memory outbox a phone with blocked storage uses", async () => {
    expect(bridge.runtime!.outbox.memoryOnly).toBe(true); // the test runtime IS the memory fallback
    const op = await bridge.runtime!.outbox.enqueue({
      ...addDraft(5, "s1", DEMO),
      kind: "edit_line",
      payload: { lineId: LINE_STEW.id, qty: 3 },
      scope: { sessionId: OIDS.session, lineId: LINE_STEW.id },
      label: { tableName: "Tavolo 1 (demo)", dishName: STEW },
    });
    await bridge.runtime!.outbox.settle([
      {
        opId: op.opId,
        status: "conflict",
        settledAt: 1,
        conflict: {
          reason: "stale",
          line: {
            ...LINE_STEW,
            updatedAt: "2026-11-02T19:31:00.000Z",
            updatedBy: { id: DUE.id, displayName: DUE.displayName },
          },
        },
      },
    ]);
    await open();
    const alert = await waitFor(() => {
      const found = document.querySelector(`[data-op-id="${op.opId}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toMatch(
      new RegExp(
        `^«${STEW.replace(/[()]/g, "\\$&")}»: Questa riga è stata cambiata da Cameriere Due Demo alle \\d{2}:\\d{2}: ecco la versione attuale\\.Ho capito$`,
      ),
    );
  });

  it("notices of another table do not show on this comanda", async () => {
    await open();
    const other = await settledConflict(null, "5e000000-0000-4000-8000-0000000000ff");
    await act(async () => {
      await bridge.runtime!.refresh();
    });
    expect(document.querySelector(`[data-op-id="${other.opId}"]`)).toBeNull();
  });

  it("a colleague's later change after my applied edit shows 'ha cambiato ... dopo di te'", async () => {
    viewReply = ok({
      ...ORDER_VIEW,
      lines: [
        {
          ...LINE_STEW,
          clientUpdatedAt: "2099-01-01T10:00:00.000Z",
          updatedAt: "2026-11-02T19:31:00.000Z",
          updatedBy: { id: DUE.id, displayName: DUE.displayName },
        },
        LINE_SOUP,
      ],
    });
    const op = await bridge.runtime!.outbox.enqueue({
      ...addDraft(5, "s1", DEMO),
      kind: "edit_line",
      payload: { lineId: LINE_STEW.id, qty: 3 },
      scope: { sessionId: OIDS.session, lineId: LINE_STEW.id },
    });
    await bridge.runtime!.outbox.settle([{ opId: op.opId, status: "applied", settledAt: 1 }]);
    await open();
    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "Cameriere Due Demo ha cambiato «Spezzatino con polenta (demo)» dopo di te, alle 20:31.",
      ),
    );
  });
});

describe("Comanda page: no direct writes (fetch spy)", () => {
  it("a whole service of taps, edits, removals, sends and voids calls no write endpoint", async () => {
    viewReply = ok({
      ...ORDER_VIEW,
      lines: [{ ...LINE_STEW, state: "fired" as const }, LINE_SOUP],
    });
    await open();
    openSheet();
    fireEvent.click(screen.getByRole("tab", { name: /^Primi/ }));
    fireEvent.click(item(SOUP_ITEM.id));
    fireEvent.click(await screen.findByRole("button", { name: /^Invia in cucina: Primi/ }));
    fireEvent.click(within(row(LINE_STEW.id)).getByRole("button", { name: /^Storna/ }));
    fireEvent.change(screen.getByRole("combobox", { name: /^Motivo/ }), {
      target: { value: "comp" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Storna piatto" }));
    await queued(3);
    const forbidden = calls.filter(
      (c) =>
        c.init?.method ||
        /\/(fire|void|remove|open)$/.test(c.path) ||
        c.path.startsWith("/api/order-lines") ||
        c.path.startsWith("/api/tables/"),
    );
    expect(forbidden).toEqual([]);
    expect(STEW).toContain("(demo)");
  });
});

describe("Comanda page: the Conto tab (M21)", () => {
  const openBill = async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: "Conto" }));
    await screen.findByText("Totale (IVA inclusa)");
  };
  const total = () =>
    (screen.getByText("Totale (IVA inclusa)").parentElement as HTMLElement).textContent ?? "";
  const money = (text: string) => new RegExp(text.replace(/ /g, "\\s+").replace(/\./g, "\\."));

  it("offers 'Comanda' and 'Conto' as tabs, 'Comanda' selected and the bill not read yet", async () => {
    await open();
    expect(screen.getByRole("tab", { name: "Comanda" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Conto" }).getAttribute("aria-selected")).toBe("false");
    expect(reads(BILL_PATH)).toHaveLength(0);
  });

  it("'Conto' reads /bill and shows the total from the server", async () => {
    await openBill();
    expect(reads(BILL_PATH)).toHaveLength(1);
    expect(total()).toMatch(money("100,00 €"));
    expect(document.querySelectorAll("[data-line-id]").length).toBeGreaterThan(0);
  });

  it("?vista=conto opens on the bill", async () => {
    query = "&vista=conto";
    render(createElement(OrderPage));
    await screen.findByText("Totale (IVA inclusa)");
    expect(screen.getByRole("tab", { name: "Conto" }).getAttribute("aria-selected")).toBe("true");
  });

  it("a closed table opens on the bill with the receipt summary", async () => {
    viewReply = ok({
      ...ORDER_VIEW,
      session: { ...ORDER_VIEW.session, closed: true, status: "closed" },
    });
    billReply = () => ok({ ...BILL_CLOSED, sessionId: OIDS.session });
    render(createElement(OrderPage));
    expect(await screen.findByText("Tavolo chiuso · Scontrino 0012-0034 · Carta")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Chiudi tavolo" })).toBeNull();
  });

  it("the way back from the unsent warning is the order tab", async () => {
    billReply = () => ok({ ...BILL_HERE, unsentLineIds: [LINE_STEW.id] });
    await openBill();
    fireEvent.click(screen.getByRole("button", { name: "Torna alla comanda" }));
    expect(screen.getByRole("tab", { name: "Comanda" }).getAttribute("aria-selected")).toBe("true");
  });

  it("offline, the bill says it needs a connection and nothing is computed locally", async () => {
    await open();
    billReply = () => ({ ok: false, status: 0, error: { code: "network", message: "offline" } });
    fireEvent.click(screen.getByRole("tab", { name: "Conto" }));
    expect(await screen.findByText("Serve la connessione per vedere il conto.")).toBeTruthy();
    expect(screen.queryByText("Totale (IVA inclusa)")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d,\d\d\s€/);
  });

  describe("splitting", () => {
    it("by covers: the stepper asks for ?parts=n and shows the server's parts", async () => {
      billReply = (path) =>
        ok(
          path.includes("parts=")
            ? { ...BILL_BY_COVERS, sessionId: OIDS.session, covers: 4 }
            : BILL_HERE,
        );
      await openBill();
      fireEvent.click(screen.getByRole("button", { name: "Dividi il conto" }));
      await screen.findByRole("heading", { name: "Dividi il conto" });
      expect(screen.getByLabelText("Numero di quote").textContent).toBe("4");
      fireEvent.click(screen.getByRole("button", { name: "Meno quote" }));
      await waitFor(() => expect(reads(`${BILL_PATH}?parts=3`)).toHaveLength(1));
      const first = await waitFor(() => {
        const row = document.querySelector('[data-part-index="1"]') as HTMLElement;
        expect(row).not.toBeNull();
        return row;
      });
      expect(first.textContent).toMatch(money("Quota 1 · 33,34 €"));
    });

    it("by dishes: 'Calcola' posts the ids the waiter assigned, and shows the server's bills", async () => {
      billReply = (path) =>
        path === SPLIT_PATH
          ? ok({ ...BILL_BY_ITEMS, sessionId: OIDS.session, covers: 4 })
          : ok(BILL_HERE);
      await openBill();
      fireEvent.click(screen.getByRole("button", { name: "Dividi il conto" }));
      fireEvent.click(await screen.findByRole("button", { name: "Per piatti" }));
      const lineId = BILL.lines[1]!.id;
      fireEvent.click(document.querySelector(`[data-line-id="${lineId}"] button`) as HTMLElement);
      fireEvent.click(screen.getByRole("button", { name: "Calcola" }));
      await waitFor(() => expect(writes().filter((c) => c.path === SPLIT_PATH)).toHaveLength(1));
      const posted = writes().find((c) => c.path === SPLIT_PATH)!;
      expect(posted.init?.method).toBe("POST");
      expect(posted.init?.body).toEqual(splitBodyFrom(assignLine(initialSplitForm(4), lineId, 0)));
      const part = await waitFor(() => {
        const row = document.querySelector('[data-part-index="1"]') as HTMLElement;
        expect(row).not.toBeNull();
        return row;
      });
      expect(part.textContent).toMatch(money("Conto 1 · 43,42 €"));
    });

    it("a refused split says why in words", async () => {
      billReply = (path) =>
        path === SPLIT_PATH
          ? {
              ok: false,
              status: 422,
              error: {
                code: "split_invalid",
                message: "x",
                details: { reason: "covers_mismatch" },
              },
            }
          : ok(BILL_HERE);
      await openBill();
      fireEvent.click(screen.getByRole("button", { name: "Dividi il conto" }));
      fireEvent.click(await screen.findByRole("button", { name: "Per piatti" }));
      fireEvent.click(screen.getByRole("button", { name: "Calcola" }));
      expect((await screen.findByRole("alert")).textContent).toBe(
        "I coperti dei conti devono essere 4",
      );
    });
  });

  describe("closing", () => {
    const fill = async (number?: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Chiudi tavolo" }));
      await screen.findByRole("radio", { name: "Scontrino" });
      fireEvent.click(screen.getByRole("radio", { name: "Scontrino" }));
      fireEvent.click(screen.getByRole("radio", { name: "Carta" }));
      if (number !== undefined)
        fireEvent.change(screen.getByLabelText(/^Numero/), { target: { value: number } });
    };
    const closeCalls = () => writes().filter((c) => c.path === CLOSE_PATH);

    it("posts the type, the number (null when empty), the payment and the token of the last read", async () => {
      billReply = (path) =>
        path === CLOSE_PATH
          ? ok({ changed: true, bill: { ...BILL_CLOSED, sessionId: OIDS.session } })
          : ok(BILL_HERE);
      await openBill();
      await fill();
      const buttons = screen.getAllByRole("button", { name: "Chiudi senza numero" });
      fireEvent.click(buttons[buttons.length - 1]!);
      await waitFor(() => expect(closeCalls()).toHaveLength(1));
      expect(closeCalls()[0]!.init?.body).toEqual({
        receiptType: "scontrino",
        receiptNumber: null,
        paymentType: "card",
        billToken: TOKEN,
      });
      expect(await screen.findByText("Tavolo chiuso · Scontrino 0012-0034 · Carta")).toBeTruthy();
    });

    it("with a number the button says 'Chiudi tavolo' and the number is sent trimmed", async () => {
      billReply = (path) =>
        path === CLOSE_PATH
          ? ok({ changed: true, bill: { ...BILL_CLOSED, sessionId: OIDS.session } })
          : ok(BILL_HERE);
      await openBill();
      await fill(" 0012-0034 ");
      const buttons = screen.getAllByRole("button", { name: "Chiudi tavolo" });
      fireEvent.click(buttons[buttons.length - 1]!);
      await waitFor(() => expect(closeCalls()).toHaveLength(1));
      expect((closeCalls()[0]!.init?.body as { receiptNumber: string }).receiptNumber).toBe(
        "0012-0034",
      );
    });

    it("bill_changed says so and reads the bill once more", async () => {
      billReply = (path) =>
        path === CLOSE_PATH
          ? {
              ok: false,
              status: 409,
              error: {
                code: "bill_changed",
                message: "Il conto è cambiato: controlla il nuovo totale.",
              },
            }
          : ok(BILL_HERE);
      await openBill();
      await fill("1");
      const before = reads(BILL_PATH).length;
      const buttons = screen.getAllByRole("button", { name: "Chiudi tavolo" });
      fireEvent.click(buttons[buttons.length - 1]!);
      expect((await screen.findByRole("alert")).textContent).toBe(
        "Il conto è cambiato: controlla il nuovo totale.",
      );
      await waitFor(() => expect(reads(BILL_PATH).length).toBe(before + 1));
    });

    it("unsent_lines shows the warning after a fresh read", async () => {
      let unsent = false;
      billReply = (path) => {
        if (path === CLOSE_PATH) {
          unsent = true;
          return {
            ok: false,
            status: 409,
            error: {
              code: "unsent_lines",
              message:
                "Ci sono piatti non inviati in cucina: inviali o rimuovili prima di chiudere.",
              details: { lineIds: [LINE_STEW.id] },
            },
          };
        }
        return ok(unsent ? { ...BILL_HERE, unsentLineIds: [LINE_STEW.id] } : BILL_HERE);
      };
      await openBill();
      await fill("1");
      const buttons = screen.getAllByRole("button", { name: "Chiudi tavolo" });
      fireEvent.click(buttons[buttons.length - 1]!);
      expect(
        await screen.findByText(
          "1 piatto non è stato inviato in cucina: invialo o rimuovilo prima di chiudere.",
        ),
      ).toBeTruthy();
    });

    it("session_closed says so and reads the order and the bill again", async () => {
      billReply = (path) =>
        path === CLOSE_PATH
          ? {
              ok: false,
              status: 409,
              error: { code: "session_closed", message: "Il tavolo è già stato chiuso." },
            }
          : ok(BILL_HERE);
      await openBill();
      await fill("1");
      const orders = reads(LINES).length;
      const buttons = screen.getAllByRole("button", { name: "Chiudi tavolo" });
      fireEvent.click(buttons[buttons.length - 1]!);
      expect((await screen.findByRole("alert")).textContent).toBe("Il tavolo è già stato chiuso.");
      await waitFor(() => expect(reads(LINES).length).toBe(orders + 1));
    });

    it("operations of this table still queued on the phone disable the close, and say how many", async () => {
      await open();
      await bridge.runtime!.outbox.enqueue(addDraft(1, "s1"));
      await bridge.runtime!.outbox.enqueue(addDraft(2, "s1"));
      await bridge.runtime!.outbox.enqueue(addDraft(3, "s1"));
      fireEvent.click(screen.getByRole("tab", { name: "Conto" }));
      await screen.findByText("Totale (IVA inclusa)");
      await fill("1");
      expect(
        await screen.findByText(
          "Ci sono 3 operazioni di questo tavolo ancora in coda su questo telefono: attendi l'invio.",
        ),
      ).toBeTruthy();
      const buttons = screen.getAllByRole("button", { name: "Chiudi tavolo" });
      expect((buttons[buttons.length - 1] as HTMLButtonElement).disabled).toBe(true);
    });

    it("operations of another table do not", async () => {
      await open();
      await bridge.runtime!.outbox.enqueue(addDraft(1, "s2"));
      fireEvent.click(screen.getByRole("tab", { name: "Conto" }));
      await screen.findByText("Totale (IVA inclusa)");
      await fill("1");
      const buttons = screen.getAllByRole("button", { name: "Chiudi tavolo" });
      expect((buttons[buttons.length - 1] as HTMLButtonElement).disabled).toBe(false);
    });

    it("the close sheet has no default document or payment", async () => {
      await openBill();
      fireEvent.click(screen.getByRole("button", { name: "Chiudi tavolo" }));
      for (const name of ["Scontrino", "Fattura", "Contanti", "Carta", "Altro"]) {
        expect((await screen.findByRole("radio", { name })) as HTMLInputElement).toHaveProperty(
          "checked",
          false,
        );
      }
    });
  });

  it("the bill's markup has no cost, margin, GP or food cost", async () => {
    await openBill();
    expect(document.body.textContent).not.toMatch(/Costo|Margine|Food cost|\bGP\b/);
  });
});
