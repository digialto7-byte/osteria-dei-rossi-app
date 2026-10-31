import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { BillOutput, CloseOutput } from "@/server/bill/output";
import type { AppVsRegister, EnterDayCloseOutput } from "@/server/day-close/output";
import type { AddLineOutput, FireOutput } from "@/server/orders/output";
import type { OpResult, SyncOutput } from "@/server/sync/output";
import type { TablesList } from "@/server/tables/output";
import {
  addDish,
  buildAt2Table,
  openSession,
  seedClosingTenant,
  type At2Lines,
  type ClosingCalls,
  type ClosingFixture,
} from "./helpers/closing";
import { appUserId, opFor } from "./helpers/sync";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";

// M21 acceptance tests 1 to 5 against the real local stack (plan §5 step 13). Over the real routes: strict schemas, role checks,
// error mapping, session_bill, close_table, enter_day_close, app_vs_register, RLS. Only `createSupabaseServerClient` is replaced (as in the
// M14 to M20 suites), so each call carries the signed-in test user's own client. The secret key creates the second waiter only. The
// server clock cannot be moved here, so AT4 asserts that a just-closed table's business date is the one /api/tables shows for today;
// the fixed-instant proof (cut-off 02:00 and 00:30, both DST nights) is in pgTAP 217 and 219. Fake data only.
//
// The tests run in order and share state. Tenant A: the closing fixture (four dishes, coperto 2,00 € at 10 %, two waiters) and three
// tables: 1 (the AT2 table, 3 covers), 2 (an unsent dish) and 3 (a stale preview). Tenant B: one table and a line. Throws in CI when the
// stack settings are missing; skips on a developer machine.
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
const tablesRoute = await import("@/app/api/tables/route");
const billRoute = await import("@/app/api/table-sessions/[id]/bill/route");
const splitRoute = await import("@/app/api/table-sessions/[id]/bill/split/route");
const closeRoute = await import("@/app/api/table-sessions/[id]/close/route");
const dayCloseRoute = await import("@/app/api/day-close/route");
const reportRoute = await import("@/app/api/reports/app-vs-register/route");
const syncRoute = await import("@/app/api/sync/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  text: string;
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** Any key naming a cost, margin, GP, food cost, recipe or VAT rate. */
const COSTLY_KEY = /"[A-Za-z]*(cost|margin|gp|food|recipe|vat)[A-Za-z]*":/i;

describe.skipIf(!env)("the bill, the close and the end of the day on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let fixture: ClosingFixture;
  let waiter2: TestUser;
  let at2: At2Lines;
  let s1: string;
  let s2: string;
  let s3: string;
  let sb1: string;
  let t1: string;
  let draftLine: string;

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

  /** Every JSON text a waiter received about a bill or a close, scanned for costs at the end. */
  const waiterTexts: string[] = [];
  const asWaiter = <T>(user: TestUser, reply: Reply<T>): Reply<T> => {
    if (user.role === "waiter") waiterTexts.push(reply.text);
    return reply;
  };

  const bill = async (user: TestUser, session: string, query = "") =>
    asWaiter(
      user,
      await call<BillOutput>(
        user,
        billRoute.GET as Handler,
        `/api/table-sessions/${session}/bill${query}`,
        {
          params: { id: session },
        },
      ),
    );
  const split = async (user: TestUser, session: string, body: object) =>
    asWaiter(
      user,
      await call<BillOutput>(
        user,
        splitRoute.POST as Handler,
        `/api/table-sessions/${session}/bill/split`,
        {
          method: "POST",
          body,
          params: { id: session },
        },
      ),
    );
  const close = async (user: TestUser, session: string, body: object) =>
    asWaiter(
      user,
      await call<CloseOutput>(
        user,
        closeRoute.POST as Handler,
        `/api/table-sessions/${session}/close`,
        {
          method: "POST",
          body,
          params: { id: session },
        },
      ),
    );
  const enterDayClose = (user: TestUser, body: object) =>
    call<EnterDayCloseOutput>(user, dayCloseRoute.POST as Handler, "/api/day-close", {
      method: "POST",
      body,
    });
  const report = (user: TestUser, query = "") =>
    call<AppVsRegister>(user, reportRoute.GET as Handler, `/api/reports/app-vs-register${query}`);
  const tables = (user: TestUser) =>
    call<TablesList>(user, tablesRoute.GET as Handler, "/api/tables");

  const closeBody = (token: string, over: object = {}) => ({
    receiptType: "scontrino",
    receiptNumber: "0012-0034",
    paymentType: "card",
    billToken: token,
    ...over,
  });
  const amounts = (parts: { index: number; amount: number }[]) =>
    [...parts].sort((x, y) => x.index - y.index).map((p) => p.amount);

  const calls: ClosingCalls = {
    createItem: (body) =>
      call(a.owner, menuItemsRoute.POST as Handler, "/api/menu/items", {
        method: "POST",
        body,
      }) as Promise<{
        status: number;
        body: { item: { id: string } };
      }>,
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
        {
          method: "POST",
          body: { name, position },
        },
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
        {
          method: "POST",
          body,
          params: { id: session },
        },
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
    waiter2 = fixture.waiter2;

    const first = await openSession(calls, a.waiter, "Tavolo 1 (demo)", 1, 3);
    s1 = first.sessionId;
    t1 = first.tableId;
    s2 = (await openSession(calls, waiter2, "Tavolo 2 (demo)", 2, 2)).sessionId;
    s3 = (await openSession(calls, a.waiter, "Tavolo 3 (demo)", 3, 2)).sessionId;
    at2 = await buildAt2Table(calls, a.waiter, s1, fixture);

    // Tenant B: one table with a session and a line, for the isolation checks.
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
      {
        method: "POST",
        body: { name: "Tavolo 1 (demo)", position: 1 },
      },
    );
    sb1 = randomUUID();
    const openedB = await call(
      b.waiter,
      openRoute.POST as Handler,
      `/api/tables/${tableB.body.table.id}/open`,
      {
        method: "POST",
        body: { sessionId: sb1, covers: 2 },
        params: { id: tableB.body.table.id },
      },
    );
    expect(openedB.status).toBe(201);
    await addDish(calls, b.waiter, sb1, itemB.body.item.id);
  }, 300_000);

  it("AT2: the bill of the AT2 table is 100,00 € (half portions, no voided line, coperto 3 x 2,00 €)", async () => {
    const read = await bill(a.waiter, s1);
    expect(read.status).toBe(200);
    expect(read.body.total).toBe(100);
    expect(read.body.subtotal).toBe(94);
    expect(read.body.coperto).toEqual({ perPerson: 2, covers: 3, amount: 6 });
    expect(read.body.lines.map((l) => l.id).sort()).toEqual(
      [at2.stew2, at2.stewHalf, at2.tagliatelle15, at2.vino].sort(),
    );
    expect(read.body.lines.find((l) => l.id === at2.stewHalf)!.amount).toBe(7);
    expect(read.body.lines.find((l) => l.id === at2.tagliatelle15)!.amount).toBe(18.75);
    expect(read.body.unsentLineIds).toEqual([]);
  });

  it("AT2: 100,00 € by 3 covers is 33,34 + 33,33 + 33,33 (by index)", async () => {
    const read = await bill(a.waiter, s1, "?parts=3");
    expect(read.status).toBe(200);
    expect(read.body.split?.mode).toBe("covers");
    expect(amounts(read.body.split!.parts)).toEqual([33.34, 33.33, 33.33]);
  });

  it("AT2: by items it is 43,42 / 34,17 / 22,41 with the wine shared", async () => {
    const read = await split(a.waiter, s1, {
      groups: [
        { lineIds: [at2.stew2], covers: 1 },
        { lineIds: [at2.tagliatelle15], covers: 1 },
        { lineIds: [at2.stewHalf], covers: 1 },
      ],
      sharedLineIds: [at2.vino],
    });
    expect(read.status).toBe(200);
    expect(read.body.split?.mode).toBe("items");
    expect(amounts(read.body.split!.parts)).toEqual([43.42, 34.17, 22.41]);
  });

  it("a split that leaves a line out is a 422 split_invalid whose details are the reason only", async () => {
    const read = await split(a.waiter, s1, {
      groups: [
        { lineIds: [at2.stew2], covers: 2 },
        { lineIds: [at2.tagliatelle15], covers: 1 },
      ],
      sharedLineIds: [at2.vino],
    });
    expect(read.status).toBe(422);
    expect(read.error.code).toBe("split_invalid");
    expect(read.error.details).toEqual({ reason: "line_missing" });
  });

  it("the chef cannot read a bill (403) and a waiter's bill holds no cost key", async () => {
    expect((await bill(a.chef, s1)).status).toBe(403);
    const read = await bill(a.waiter, s1);
    expect(read.text).not.toMatch(COSTLY_KEY);
  });

  it("tenant B cannot read tenant A's bill (404) and A cannot read B's", async () => {
    expect((await bill(b.owner, s1)).status).toBe(404);
    expect((await bill(a.owner, sb1)).status).toBe(404);
  });

  it("a dish never sent blocks the close (409 unsent_lines with its id); sent, the table closes", async () => {
    await addDish(calls, waiter2, s2, fixture.items.acqua, { qty: 2 }).then(
      (id) => (draftLine = id),
    );
    const read = await bill(waiter2, s2);
    expect(read.body.unsentLineIds).toEqual([draftLine]);
    const refused = await close(
      waiter2,
      s2,
      closeBody(read.body.billToken, { receiptNumber: "0100" }),
    );
    expect(refused.status).toBe(409);
    expect(refused.error.code).toBe("unsent_lines");
    expect(refused.error.details).toEqual({ lineIds: [draftLine] });
    expect((await calls.fire(waiter2, s2, [draftLine])).status).toBe(200);
    const fresh = await bill(waiter2, s2);
    const closed = await close(
      waiter2,
      s2,
      closeBody(fresh.body.billToken, { receiptNumber: "0100" }),
    );
    expect(closed.status).toBe(200);
    expect(closed.body.changed).toBe(true);
    expect(closed.body.bill.total).toBe(10);
  });

  it("a stale preview is a 409 bill_changed, and the new bill can be closed", async () => {
    const first = await addDish(calls, a.waiter, s3, fixture.items.stew);
    expect((await calls.fire(a.waiter, s3, [first])).status).toBe(200);
    const preview = await bill(a.waiter, s3);
    const second = await addDish(calls, waiter2, s3, fixture.items.acqua);
    expect((await calls.fire(waiter2, s3, [second])).status).toBe(200);
    const stale = await close(
      a.waiter,
      s3,
      closeBody(preview.body.billToken, { receiptNumber: "0101" }),
    );
    expect(stale.status).toBe(409);
    expect(stale.error.code).toBe("bill_changed");
    const again = await bill(a.waiter, s3);
    expect(again.body.total).toBe(21);
    const closed = await close(
      a.waiter,
      s3,
      closeBody(again.body.billToken, { receiptNumber: "0101" }),
    );
    expect(closed.status).toBe(200);
  });

  it("AT1: closing without a receipt number is a 200, flagged, and the owner's report lists the table", async () => {
    const preview = await bill(a.waiter, s1);
    const closed = await close(
      a.waiter,
      s1,
      closeBody(preview.body.billToken, { receiptNumber: null }),
    );
    expect(closed.status).toBe(200);
    expect(closed.body.bill.closed).toBe(true);
    expect(closed.body.bill.receipt?.missingReceipt).toBe(true);
    expect(closed.body.bill.receipt?.number).toBeNull();
    expect(closed.body.bill.total).toBe(100);
    const listed = await report(a.owner);
    expect(listed.status).toBe(200);
    expect(listed.body.missingReceipts.map((row) => row.sessionId)).toContain(s1);
    expect(listed.body.missingReceipts.find((row) => row.sessionId === s1)!.total).toBe(100);
  });

  it("a lost reply retried is a 200 with changed false; another number is a 409 session_closed", async () => {
    const replay = await close(waiter2, s1, closeBody("0".repeat(32), { receiptNumber: null }));
    expect(replay.status).toBe(200);
    expect(replay.body.changed).toBe(false);
    const other = await close(a.waiter, s1, closeBody("0".repeat(32), { receiptNumber: "0999" }));
    expect(other.status).toBe(409);
    expect(other.error.code).toBe("session_closed");
  });

  it("AT4: the closed table's business date is the one /api/tables shows for today", async () => {
    const read = await bill(a.owner, s1);
    const list = await tables(a.owner);
    expect(read.body.receipt?.businessDate).toBe(list.body.businessDate);
    expect(list.body.tables.find((tile) => tile.id === t1)!.status).toBe("closed");
  });

  it("AT3: the owner enters the register total and the report is in the reply; a read right after returns the same difference", async () => {
    const before = await report(a.owner);
    expect(before.body.register).toBeNull();
    expect(before.body.difference).toBeNull();
    const entered = await enterDayClose(a.owner, { registerTotal: "1222.00" });
    expect(entered.status).toBe(200);
    expect(entered.body.changed).toBe(true);
    const difference = entered.body.report.difference!;
    expect(difference.amount).toBe(Math.round((entered.body.report.app.total - 1222) * 100) / 100);
    expect(entered.body.report.register?.total).toBe(1222);
    const read = await report(a.owner);
    expect(read.body.difference).toEqual(difference);
    expect(read.body.register?.total).toBe(1222);
    const repeat = await enterDayClose(a.admin, { registerTotal: "1222.00" });
    expect(repeat.body.changed).toBe(false);
  });

  it("AT5: the waiter and the chef cannot write the day close (403), and a waiter cannot insert or read day_close", async () => {
    expect((await enterDayClose(a.waiter, { registerTotal: "1.00" })).status).toBe(403);
    expect((await enterDayClose(a.chef, { registerTotal: "1.00" })).status).toBe(403);
    expect((await report(a.waiter)).status).toBe(403);
    expect((await report(a.chef)).status).toBe(403);
    const me = await appUserId(stack, a.waiter);
    const insert = await a.waiter.client
      .from("day_close")
      .insert({ business_date: "2026-11-04", register_total: 1, created_by: me });
    expect(insert.error?.code).toBe("42501");
    const read = await a.waiter.client.from("day_close").select("*");
    expect(read.data ?? []).toEqual([]);
  });

  it("a dish a phone sends after the close is a stored conflict, and the report counts it", async () => {
    const userId = await appUserId(stack, waiter2);
    const op = opFor(
      "add_line",
      { sessionId: s1, lineId: randomUUID(), menuItemId: fixture.items.acqua },
      userId,
      { msFromNow: -60_000 },
    );
    const sent = await call<SyncOutput>(waiter2, syncRoute.POST as Handler, "/api/sync", {
      method: "POST",
      body: { ops: [op] },
    });
    expect(sent.status).toBe(200);
    expect((sent.body.results[0] as OpResult).status).toBe("conflict");
    const read = await report(a.owner);
    expect(read.body.lateOps.count).toBe(1);
  });

  it("tenant B's report holds none of A's tables, register entry or late ops", async () => {
    const read = await report(b.owner);
    expect(read.status).toBe(200);
    expect(read.body.app.total).toBe(0);
    expect(read.body.register).toBeNull();
    expect(read.body.missingReceipts).toEqual([]);
    expect(read.body.lateOps.count).toBe(0);
  });

  it("no JSON a waiter received about a bill or a close names a cost, margin, GP, food cost, recipe or VAT rate", () => {
    expect(waiterTexts.length).toBeGreaterThan(5);
    for (const text of waiterTexts) expect(text).not.toMatch(COSTLY_KEY);
  });
});
