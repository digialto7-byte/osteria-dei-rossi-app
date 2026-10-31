import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { BillOutput, CloseOutput } from "@/server/bill/output";
import { ticketMarkBody } from "@/lib/kitchen/kitchen-done";
import type {
  KitchenTicket,
  KitchenTickets,
  MarkLineReply,
  MarkTicketReply,
} from "@/server/kitchen/output";
import type { AddLineOutput, FireOutput } from "@/server/orders/output";
import {
  addDish,
  openSession,
  seedClosingTenant,
  type ClosingCalls,
  type ClosingFixture,
} from "./helpers/closing";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";

// M19b acceptance tests 1 to 11 against the real local stack (plan §5 step 13), over the real routes: strict schemas, role checks, error
// mapping, kitchen_mark_line, kitchen_set_ticket, the board, RLS. Only `createSupabaseServerClient` is replaced (as in the M14 to M21 suites), so
// each call carries the signed-in test user's own client; the secret key creates the second waiter and reads `kitchen_event`. The dishes are the
// unmapped ones of the closing fixture (no recipe), so firing them depletes no stock and the suite needs no batches: the stock side of a void
// after a done is proved by the races and pgTAP 226 and by firing.int.ts (M19). Fake data only.
//
// The tests run in order and share state. Tenant A: table 1 with two primi (L1, L2) and one secondo (L3), table 2 with one dish that stays open
// in the kitchen, then closes at the till (AT10). Tenant B: one table and a line. Throws in CI when the stack settings are missing; skips on a
// developer machine.
const env = readStackEnv();

const asUser = vi.hoisted(() => ({ store: null as AsyncLocalStorage<SupabaseClient> | null }));
vi.mock("@/lib/supabase/server", async () => {
  const { AsyncLocalStorage: Storage } = await import("node:async_hooks");
  asUser.store = new Storage<SupabaseClient>();
  return { createSupabaseServerClient: async () => asUser.store!.getStore() };
});
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const menuItemsRoute = await import("@/app/api/menu/items/route");
const diningTablesRoute = await import("@/app/api/dining-tables/route");
const openRoute = await import("@/app/api/tables/[id]/open/route");
const linesRoute = await import("@/app/api/table-sessions/[id]/lines/route");
const fireRoute = await import("@/app/api/table-sessions/[id]/fire/route");
const voidRoute = await import("@/app/api/order-lines/[id]/void/route");
const copertoRoute = await import("@/app/api/settings/coperto/route");
const billRoute = await import("@/app/api/table-sessions/[id]/bill/route");
const closeRoute = await import("@/app/api/table-sessions/[id]/close/route");
const boardRoute = await import("@/app/api/kitchen/tickets/route");
const markLineRoute = await import("@/app/api/kitchen/lines/[id]/mark/route");
const markTicketRoute = await import("@/app/api/kitchen/tickets/mark/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  text: string;
  error: { code: string; message: string };
}

/** Any key naming a cost, margin, GP, food cost, recipe, VAT rate, price or total. */
const COSTLY_KEY =
  /"[A-Za-z_]*(cost|margin|gp|food|recipe|vat|price|prezz|amount|total|importo)[A-Za-z_]*":/i;

describe.skipIf(!env)("the kitchen done marks on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let fixture: ClosingFixture;
  let s1: string;
  let s2: string;
  let sb1: string;
  let l1: string;
  let l2: string;
  let l3: string;
  let open2: string;
  let lb: string;

  async function call<T = Record<string, unknown>>(
    user: TestUser,
    handler: Handler,
    path: string,
    init: { method?: string; body?: unknown; params?: Record<string, string> } = {},
  ): Promise<Reply<T>> {
    const method = init.method ?? "GET";
    return asUser.store!.run(user.client, async () => {
      const response = await handler(
        new Request(`http://localhost:3000${path}`, {
          method,
          headers: method === "GET" ? {} : { "content-type": "application/json" },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
        { params: Promise.resolve(init.params ?? {}) },
      );
      const text = await response.text();
      const body = JSON.parse(text) as T;
      return {
        status: response.status,
        body,
        text,
        error: (body as { error?: Reply["error"] }).error as Reply["error"],
      };
    });
  }

  /** Every JSON text the kitchen received, scanned for costs and euro signs at the end (AT11). */
  const kitchenTexts: string[] = [];
  const asKitchen = <T>(reply: Reply<T>): Reply<T> => {
    kitchenTexts.push(reply.text);
    return reply;
  };

  const board = async (user: TestUser = a.chef) =>
    asKitchen(await call<KitchenTickets>(user, boardRoute.GET as Handler, "/api/kitchen/tickets"));
  const markLine = async (user: TestUser, line: string, done: boolean) =>
    asKitchen(
      await call<MarkLineReply>(
        user,
        markLineRoute.POST as Handler,
        `/api/kitchen/lines/${line}/mark`,
        { method: "POST", body: { done }, params: { id: line } },
      ),
    );
  const markTicket = async (user: TestUser, ticket: KitchenTicket, closed: boolean) =>
    asKitchen(
      await call<MarkTicketReply>(
        user,
        markTicketRoute.POST as Handler,
        "/api/kitchen/tickets/mark",
        { method: "POST", body: ticketMarkBody(ticket, closed) },
      ),
    );

  /** The comanda that holds a line, in the active or the closed list of a board. */
  const find = (reply: KitchenTickets, line: string) => {
    for (const list of ["tickets", "closedTickets"] as const) {
      const ticket = reply[list].find((t) => t.lines.some((l) => l.id === line));
      if (ticket) return { list, ticket, line: ticket.lines.find((l) => l.id === line)! };
    }
    return null;
  };

  /** What the secret key sees in kitchen_event (RLS hides it from the kitchen itself). */
  async function events(filter: {
    line?: string;
    subject?: string;
    action?: string;
    cause?: string;
  }) {
    let query = stack.admin
      .from("kitchen_event")
      .select("id, subject, action, cause, order_line_id, seq");
    if (filter.line) query = query.eq("order_line_id", filter.line);
    if (filter.subject) query = query.eq("subject", filter.subject);
    if (filter.action) query = query.eq("action", filter.action);
    if (filter.cause) query = query.eq("cause", filter.cause);
    const read = await query.eq("tenant_id", a.id).order("seq");
    expect(read.error).toBeNull();
    return read.data ?? [];
  }

  const calls: ClosingCalls = {
    createItem: (body) =>
      call(a.owner, menuItemsRoute.POST as Handler, "/api/menu/items", {
        method: "POST",
        body,
      }) as Promise<{ status: number; body: { item: { id: string } } }>,
    setCoperto: (body) =>
      call(a.owner, copertoRoute.PATCH as Handler, "/api/settings/coperto", {
        method: "PATCH",
        body,
      }),
    createTable: async (name, position) => {
      const made = await call<{ table: { id: string } }>(
        a.owner,
        diningTablesRoute.POST as Handler,
        "/api/dining-tables",
        { method: "POST", body: { name, position } },
      );
      return { status: made.status, tableId: made.body.table?.id };
    },
    openTable: (user, tableId, sessionId, covers) =>
      call(user, openRoute.POST as Handler, `/api/tables/${tableId}/open`, {
        method: "POST",
        body: { sessionId, covers },
        params: { id: tableId },
      }),
    addLine: (user, session, body) =>
      call<AddLineOutput>(
        user,
        linesRoute.POST as Handler,
        `/api/table-sessions/${session}/lines`,
        { method: "POST", body, params: { id: session } },
      ),
    fire: (user, session, lineIds) =>
      call<FireOutput>(user, fireRoute.POST as Handler, `/api/table-sessions/${session}/fire`, {
        method: "POST",
        body: { lineIds },
        params: { id: session },
      }),
    voidLine: (user, id, body) =>
      call(user, voidRoute.POST as Handler, `/api/order-lines/${id}/void`, {
        method: "POST",
        body,
        params: { id },
      }),
  };

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    fixture = await seedClosingTenant(stack, a, calls);

    s1 = (await openSession(calls, a.waiter, "Tavolo 1 (demo)", 1, 4)).sessionId;
    s2 = (await openSession(calls, a.waiter, "Tavolo 2 (demo)", 2, 2)).sessionId;
    l1 = await addDish(calls, a.waiter, s1, fixture.items.tagliatelle);
    l2 = await addDish(calls, a.waiter, s1, fixture.items.tagliatelle, { note: "senza formaggio" });
    l3 = await addDish(calls, a.waiter, s1, fixture.items.stew);
    open2 = await addDish(calls, a.waiter, s2, fixture.items.stew);
    // Two fires: the primi form one comanda, the secondo another.
    expect((await calls.fire(a.waiter, s1, [l1, l2])).status).toBe(200);
    expect((await calls.fire(a.waiter, s1, [l3])).status).toBe(200);
    expect((await calls.fire(a.waiter, s2, [open2])).status).toBe(200);

    // Tenant B: one table with a fired line, for the isolation checks.
    const itemB = await call<{ item: { id: string } }>(
      b.owner,
      menuItemsRoute.POST as Handler,
      "/api/menu/items",
      {
        method: "POST",
        body: {
          name: "Acqua B (demo)",
          category: "Bevande",
          course: "bevande",
          recipeKey: null,
          price: 3,
          vatRate: 22,
        },
      },
    );
    expect(itemB.status).toBe(201);
    const tableB = await call<{ table: { id: string } }>(
      b.owner,
      diningTablesRoute.POST as Handler,
      "/api/dining-tables",
      { method: "POST", body: { name: "Tavolo 1 (demo)", position: 1 } },
    );
    sb1 = crypto.randomUUID();
    const openedB = await call(
      b.waiter,
      openRoute.POST as Handler,
      `/api/tables/${tableB.body.table.id}/open`,
      { method: "POST", body: { sessionId: sb1, covers: 2 }, params: { id: tableB.body.table.id } },
    );
    expect(openedB.status).toBe(201);
    lb = await addDish(calls, b.waiter, sb1, itemB.body.item.id);
    expect((await calls.fire(b.waiter, sb1, [lb])).status).toBe(200);
  }, 300_000);

  it("the board starts with the comande of table 1 and 2, nothing done, nothing closed", async () => {
    const read = await board();
    expect(read.status).toBe(200);
    const primi = find(read.body, l1)!;
    expect([primi.list, primi.ticket.lineCount, primi.ticket.doneCount]).toEqual(["tickets", 2, 0]);
    expect(find(read.body, l2)!.ticket.key).toBe(primi.ticket.key);
    expect(find(read.body, l3)!.ticket.key).not.toBe(primi.ticket.key);
    expect(read.body.remaining).toBe(4);
    expect(read.body.closedTickets).toEqual([]);
    // Tenant A's board never shows tenant B's dish.
    expect(find(read.body, lb)).toBeNull();
  });

  it("AT1, AT2: the chef marks a dish and undoes it; both events stay", async () => {
    const done = await markLine(a.chef, l1, true);
    expect(done.status).toBe(200);
    expect([done.body.changed, done.body.autoClosed]).toEqual([true, false]);
    const mine = find(done.body.board, l1)!;
    expect([mine.line.done, mine.ticket.doneCount, done.body.board.remaining]).toEqual([
      true,
      1,
      3,
    ]);
    // The done line is last on its comanda.
    expect(mine.ticket.lines.map((l) => l.id)).toEqual([l2, l1]);

    const undone = await markLine(a.chef, l1, false);
    expect([undone.body.changed, find(undone.body.board, l1)!.ticket.doneCount]).toEqual([true, 0]);
    expect((await events({ line: l1 })).map((e) => e.action)).toEqual(["done", "undone"]);
  });

  it("AT3: two identical taps at once write once", async () => {
    const [x, y] = await Promise.all([markLine(a.chef, l1, true), markLine(a.owner, l1, true)]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect([x.body.changed, y.body.changed].sort()).toEqual([false, true]);
    expect((await events({ line: l1 })).map((e) => e.action)).toEqual(["done", "undone", "done"]);
  });

  it("AT4: the last open dish closes the comanda; undoing it reopens it", async () => {
    const last = await markLine(a.chef, l2, true);
    expect([last.body.changed, last.body.autoClosed]).toEqual([true, true]);
    const closed = find(last.body.board, l2)!;
    expect([closed.list, closed.ticket.autoClosed]).toEqual(["closedTickets", true]);
    expect(closed.ticket.closedBy?.displayName).toBeTruthy();
    expect(closed.ticket.closedAt).not.toBeNull();

    const undo = await markLine(a.chef, l2, false);
    expect([undo.body.changed, undo.body.reopened]).toEqual([true, true]);
    expect(find(undo.body.board, l2)!.list).toBe("tickets");
    expect((await events({ subject: "ticket", cause: "auto" })).map((e) => e.action)).toEqual([
      "closed",
      "reopened",
    ]);
  });

  it("AT5: Chiudi comanda closes at once and keeps the counts; again changes nothing; Riapri brings it back", async () => {
    const before = find((await board()).body, l3)!;
    const closed = await markTicket(a.chef, before.ticket, true);
    expect([closed.status, closed.body.changed]).toEqual([200, true]);
    const shown = find(closed.body.board, l3)!;
    expect([
      shown.list,
      shown.ticket.doneCount,
      shown.ticket.lineCount,
      shown.ticket.autoClosed,
    ]).toEqual(["closedTickets", 0, 1, false]);
    const again = await markTicket(a.chef, before.ticket, true);
    expect(again.body.changed).toBe(false);
    const reopened = await markTicket(a.owner, before.ticket, false);
    expect([reopened.body.changed, find(reopened.body.board, l3)!.list]).toEqual([true, "tickets"]);
  });

  it("AT6: two kitchen devices mark the last two dishes at once: exactly one automatic close", async () => {
    // State now: L1 done, L2 not done (undone above). Reset L1, then mark both together.
    await markLine(a.chef, l1, false);
    const autoBefore = (await events({ subject: "ticket", cause: "auto", action: "closed" }))
      .length;
    const [x, y] = await Promise.all([markLine(a.chef, l1, true), markLine(a.owner, l2, true)]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect([x.body.autoClosed, y.body.autoClosed].sort()).toEqual([false, true]);
    expect(
      (await events({ subject: "ticket", cause: "auto", action: "closed" })).length - autoBefore,
    ).toBe(1);
    expect(find((await board(a.owner)).body, l1)!.list).toBe("closedTickets");
  });

  it("AT7: the waiter cannot mark or close, and reads no event", async () => {
    const rowsBefore = (await events({})).length;
    const line = await call(
      a.waiter,
      markLineRoute.POST as Handler,
      `/api/kitchen/lines/${l3}/mark`,
      {
        method: "POST",
        body: { done: true },
        params: { id: l3 },
      },
    );
    expect(line.status).toBe(403);
    const ticket = find((await board()).body, l3)!.ticket;
    const close = await call(
      a.waiter,
      markTicketRoute.POST as Handler,
      "/api/kitchen/tickets/mark",
      {
        method: "POST",
        body: ticketMarkBody(ticket, true),
      },
    );
    expect(close.status).toBe(403);
    expect((await events({})).length).toBe(rowsBefore);
    const peek = await a.waiter.client.from("kitchen_event").select("id");
    expect(peek.data ?? []).toEqual([]);
    // Owner and admin may; the chef reads none of the log either.
    expect((await a.chef.client.from("kitchen_event").select("id")).data ?? []).toEqual([]);
    expect((await a.owner.client.from("kitchen_event").select("id")).data?.length).toBe(rowsBefore);
    expect((await markLine(a.admin, l3, true)).status).toBe(200);
    expect((await markLine(a.admin, l3, false)).status).toBe(200);
  });

  it("AT8: the waiter voids a done dish; the kitchen sees it struck, not done, not counted", async () => {
    expect((await markLine(a.chef, l3, true)).status).toBe(200);
    const voided = await calls.voidLine(a.waiter, l3, {
      reason: "kitchen_error",
      clientUpdatedAt: new Date(Date.now() - 1_000).toISOString(),
    });
    expect(voided.status).toBe(200);
    const shown = find((await board()).body, l3)!;
    expect([shown.line.voided, shown.line.voidReason, shown.line.done]).toEqual([
      true,
      "kitchen_error",
      false,
    ]);
    expect([shown.ticket.lineCount, shown.ticket.doneCount]).toEqual([0, 0]);
    // A tap on the voided dish changes nothing.
    const tap = await markLine(a.chef, l3, true);
    expect([tap.status, tap.body.changed]).toEqual([200, false]);
    // Its earlier done event is still in the history.
    expect((await events({ line: l3 })).map((e) => e.action)).toEqual(["done", "undone", "done"]);
  });

  it("AT9: a dish sent after the comanda closed forms a new comanda", async () => {
    const first = find((await board()).body, l1)!;
    expect(first.list).toBe("closedTickets");
    const l4 = await addDish(calls, a.waiter, s1, fixture.items.tagliatelle);
    expect((await calls.fire(a.waiter, s1, [l4])).status).toBe(200);
    const read = await board();
    const second = find(read.body, l4)!;
    expect(second.list).toBe("tickets");
    expect(second.ticket.key).not.toBe(first.ticket.key);
    expect(second.ticket.lineCount).toBe(1);
    expect(find(read.body, l1)!.list).toBe("closedTickets");
  });

  it("AT10: closing the table at the till is not blocked; its comande leave the board; a later mark is a 409", async () => {
    const read = await board();
    expect(find(read.body, open2)!.list).toBe("tickets");
    const bill = await call<BillOutput>(
      a.waiter,
      billRoute.GET as Handler,
      `/api/table-sessions/${s2}/bill`,
      {
        params: { id: s2 },
      },
    );
    expect(bill.status).toBe(200);
    const closed = await call<CloseOutput>(
      a.waiter,
      closeRoute.POST as Handler,
      `/api/table-sessions/${s2}/close`,
      {
        method: "POST",
        body: {
          receiptType: "scontrino",
          receiptNumber: "0001",
          paymentType: "cash",
          billToken: bill.body.billToken,
        },
        params: { id: s2 },
      },
    );
    expect(closed.status).toBe(200);
    expect(find((await board()).body, open2)).toBeNull();
    const late = await markLine(a.chef, open2, true);
    expect([late.status, late.error.code]).toEqual([409, "session_closed"]);
  });

  it("AT11: nothing the kitchen received names a cost or carries a euro sign", () => {
    expect(kitchenTexts.length).toBeGreaterThan(10);
    for (const text of kitchenTexts) {
      expect(text).not.toContain("€");
      expect(text).not.toMatch(COSTLY_KEY);
    }
  });

  it("tenant B reaches nothing of tenant A", async () => {
    const line = await markLine(b.chef, l1, true);
    expect([line.status, line.error.code]).toEqual([404, "line_not_found"]);
    const ticket = find((await board()).body, l1)!.ticket;
    const close = await markTicket(b.chef, ticket, true);
    expect([close.status, close.error.code]).toEqual([404, "ticket_not_found"]);
    // And tenant A cannot touch B's line.
    const foreign = await markLine(a.chef, lb, true);
    expect(foreign.status).toBe(404);
    const boardB = await board(b.chef);
    expect(find(boardB.body, lb)!.list).toBe("tickets");
    expect(find(boardB.body, l1)).toBeNull();
  });
});
