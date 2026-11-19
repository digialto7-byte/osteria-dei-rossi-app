import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, venueDate } from "@/lib/time/venue-date";
import type { AddLineOutput, CallOutput, FireOutput } from "@/server/orders/output";
import type { OpEnvelope } from "@/server/sync/schemas";
import type { SyncOutput } from "@/server/sync/output";
import type { TableSession } from "@/server/tables/output";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";
import { seedFiringTenant, type FiringFixture } from "./helpers/firing";
import { appUserId, opFor } from "./helpers/sync";
import { runSql } from "./helpers/sql";

// Comanda per uscita, step 11 (docs/plans/2026-11-18-comanda-uscite.md §5 step 11): the write path end to end over the real routes
// (schemas, role checks, fire_course with hold, call_uscita, void_line not_prepared, apply_op and the sync versions, RLS, the ledger
// triggers). Only `createSupabaseServerClient` is replaced, as in the other suites. The secret key reads `uscita_call` (select is granted
// to service_role); batch balances are read with SQL on the LOCAL database (helpers/sql.ts asserts the URL is local). Fake data only.
//
// Tenant A: the M19 firing fixture (stew batches A 3 and B 5 portions, two waiters), two open tables. The founder's send on table 1: the
// 1st (Tagliatelle, Zuppa) and the 2nd (two Spezzatino), plus a third Spezzatino in the 2nd that is voided not_prepared before the call.
const env = readStackEnv();

const asUser = vi.hoisted(() => ({ store: null as AsyncLocalStorage<SupabaseClient> | null }));
vi.mock("@/lib/supabase/server", async () => {
  const { AsyncLocalStorage: Storage } = await import("node:async_hooks");
  asUser.store = new Storage<SupabaseClient>();
  return { createSupabaseServerClient: async () => asUser.store!.getStore() };
});
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const approveRoute = await import("@/app/api/invoices/[id]/approve/route");
const recipesRoute = await import("@/app/api/recipes/route");
const proposalRoute = await import("@/app/api/batches/proposal/route");
const batchesRoute = await import("@/app/api/batches/route");
const menuItemsRoute = await import("@/app/api/menu/items/route");
const diningTablesRoute = await import("@/app/api/dining-tables/route");
const openRoute = await import("@/app/api/tables/[id]/open/route");
const linesRoute = await import("@/app/api/table-sessions/[id]/lines/route");
const fireRoute = await import("@/app/api/table-sessions/[id]/fire/route");
const callRoute = await import("@/app/api/table-sessions/[id]/call/route");
const voidRoute = await import("@/app/api/order-lines/[id]/void/route");
const syncRoute = await import("@/app/api/sync/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  text: string;
}

const today = venueDate(new Date());
const day = (offset: number) => addDays(today, offset);

describe.skipIf(!env)("comanda per uscita: the write path on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let fa: FiringFixture;
  let waiter2: TestUser;
  let w1: string;
  let w2: string;
  let wb: string;
  let s1: string;
  let s2: string;
  let sb1: string;
  let acquaB: string;

  async function call<T = Record<string, unknown>>(
    user: TestUser,
    handler: Handler,
    path: string,
    init: {
      method?: string;
      body?: unknown;
      params?: Record<string, string>;
      headers?: Record<string, string>;
    } = {},
  ): Promise<Reply<T>> {
    const method = init.method ?? "GET";
    return asUser.store!.run(user.client, async () => {
      const response = await handler(
        new Request(`http://localhost:3000${path}`, {
          method,
          headers: method === "GET" ? {} : { "content-type": "application/json", ...init.headers },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
        { params: Promise.resolve(init.params ?? {}) },
      );
      const text = await response.text();
      return { status: response.status, body: JSON.parse(text) as T, text };
    });
  }

  const add = (user: TestUser, session: string, menuItemId: string, uscita?: number) =>
    call<AddLineOutput>(user, linesRoute.POST as Handler, `/api/table-sessions/${session}/lines`, {
      method: "POST",
      body: {
        lineId: randomUUID(),
        menuItemId,
        clientUpdatedAt: new Date(Date.now() - 1_000).toISOString(),
        ...(uscita !== undefined ? { uscita } : {}),
      },
      params: { id: session },
    });
  const fire = (user: TestUser, session: string, lineIds: string[], hold: boolean) =>
    call<FireOutput>(user, fireRoute.POST as Handler, `/api/table-sessions/${session}/fire`, {
      method: "POST",
      body: { lineIds, hold },
      params: { id: session },
    });
  const callUscita = (user: TestUser, session: string, uscita: number) =>
    call<CallOutput>(user, callRoute.POST as Handler, `/api/table-sessions/${session}/call`, {
      method: "POST",
      body: { uscita },
      params: { id: session },
    });
  const sync = (user: TestUser, ops: OpEnvelope[], version?: string) =>
    call<SyncOutput>(user, syncRoute.POST as Handler, "/api/sync", {
      method: "POST",
      body: { ops },
      ...(version ? { headers: { "x-sync-version": version } } : {}),
    });
  const calls = async (session: string) => {
    const read = await stack.admin
      .from("uscita_call")
      .select("uscita, cause")
      .eq("table_session_id", session)
      .order("uscita");
    expect(read.error).toBeNull();
    return read.data ?? [];
  };
  const stewBalance = () =>
    runSql(
      `select trim_scale(coalesce(sum(portions), 0)) from public.batch_movement where batch_id in ('${fa.stewBatchA}', '${fa.stewBatchB}')`,
    );

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;

    const approve = async (invoiceId: string, locationId: string) =>
      (
        await call(a.owner, approveRoute.POST as Handler, `/api/invoices/${invoiceId}/approve`, {
          method: "POST",
          body: { locationId },
          params: { id: invoiceId },
        })
      ).status;
    fa = await seedFiringTenant(stack, a, {
      createRecipe: (body: object) =>
        call(a.owner, recipesRoute.POST as Handler, "/api/recipes", {
          method: "POST",
          body,
        }) as Promise<{
          status: number;
          body: { recipe: { key: string } };
        }>,
      approve,
      day,
      versionOf: async (key) =>
        (
          await call<{ recipe: { id: string } }>(
            a.chef,
            proposalRoute.GET as Handler,
            `/api/batches/proposal?recipeKey=${key}`,
          )
        ).body.recipe.id,
      produce: (body) =>
        call(a.chef, batchesRoute.POST as Handler, "/api/batches", {
          method: "POST",
          body,
        }) as Promise<{
          status: number;
          body: { batchId: string; lotCode: string; portions: number };
        }>,
      createItem: (body) =>
        call(a.owner, menuItemsRoute.POST as Handler, "/api/menu/items", {
          method: "POST",
          body,
        }) as Promise<{ status: number; body: { item: { id: string } } }>,
    });
    waiter2 = fa.waiter2;
    w1 = await appUserId(stack, a.waiter);
    w2 = await appUserId(stack, waiter2);
    wb = await appUserId(stack, b.waiter);

    const openTable = async (owner: TestUser, waiter: TestUser, name: string, position: number) => {
      const table = await call<{ table: { id: string } }>(
        owner,
        diningTablesRoute.POST as Handler,
        "/api/dining-tables",
        { method: "POST", body: { name, position } },
      );
      expect(table.status).toBe(201);
      const sessionId = randomUUID();
      const opened = await call<{ created: boolean; session: TableSession }>(
        waiter,
        openRoute.POST as Handler,
        `/api/tables/${table.body.table.id}/open`,
        {
          method: "POST",
          body: { sessionId, covers: 2 },
          params: { id: table.body.table.id },
        },
      );
      expect(opened.status).toBe(201);
      return sessionId;
    };
    s1 = await openTable(a.owner, a.waiter, "Tavolo 1 (demo)", 1);
    s2 = await openTable(a.owner, waiter2, "Tavolo 2 (demo)", 2);
    sb1 = await openTable(b.owner, b.waiter, "Tavolo 1 (demo)", 1);

    const itemB = await call<{ item: { id: string } }>(
      b.owner,
      menuItemsRoute.POST as Handler,
      "/api/menu/items",
      {
        method: "POST",
        body: {
          name: "Acqua (demo)",
          category: "Bevande",
          course: "bevande",
          recipeKey: null,
          price: 3,
          vatRate: 22,
        },
      },
    );
    expect(itemB.status).toBe(201);
    acquaB = itemB.body.item.id;
  }, 300_000);

  let firstUscita: string[];
  let stews: string[];
  let extraStew: string;
  let beforeSend: string;

  it("over the real routes, the founder's four lines fired with hold: true answer held = the two secondi, and uscita_call has no row yet", async () => {
    const t1 = await add(a.waiter, s1, fa.items.tagliatelle);
    const z1 = await add(a.waiter, s1, fa.items.zuppa);
    const st1 = await add(a.waiter, s1, fa.items.stew, 2);
    const st2 = await add(a.waiter, s1, fa.items.stew, 2);
    const st3 = await add(a.waiter, s1, fa.items.stew, 2);
    for (const r of [t1, z1, st1, st2, st3]) expect(r.status).toBe(201);
    expect(t1.body.line.uscita).toBe(1);
    expect(st1.body.line.uscita).toBe(2);
    firstUscita = [t1.body.line.id, z1.body.line.id];
    stews = [st1.body.line.id, st2.body.line.id];
    extraStew = st3.body.line.id;
    beforeSend = stewBalance();

    const sent = await fire(a.waiter, s1, [...firstUscita, ...stews], true);
    expect(sent.status).toBe(200);
    expect([...sent.body.held].sort()).toEqual([...stews].sort());
    expect(await calls(s1)).toEqual([]);
  });

  it("mutation: the same send without hold answers held = [] (so the held assertion above can fail)", async () => {
    const m1 = await add(a.waiter, s2, fa.items.stew, 2);
    const sent = await fire(waiter2, s2, [m1.body.line.id], false);
    expect(sent.status).toBe(200);
    expect(sent.body.held).toEqual([]);
    expect(await calls(s2)).toEqual([{ uscita: 2, cause: "fire_now" }]);
  });

  it("void not_prepared of a held stew: the stew batches are back to their balance before its send", async () => {
    expect(Number(beforeSend) - Number(stewBalance())).toBeGreaterThanOrEqual(2); // the founder's two stews went at the send
    const afterFirst = stewBalance();
    expect((await fire(a.waiter, s1, [extraStew], true)).body.held).toEqual([extraStew]);
    expect(Number(stewBalance())).toBe(Number(afterFirst) - 1);
    const voided = await call(
      a.waiter,
      voidRoute.POST as Handler,
      `/api/order-lines/${extraStew}/void`,
      {
        method: "POST",
        body: { reason: "not_prepared", clientUpdatedAt: new Date().toISOString() },
        params: { id: extraStew },
      },
    );
    expect(voided.status).toBe(200);
    expect(stewBalance()).toBe(afterFirst);
  });

  it("call -> 200 with the 2nd's lines; a second waiter -> 409 already_called", async () => {
    const first = await callUscita(a.waiter, s1, 2);
    expect(first.status).toBe(200);
    expect(first.body.changed).toBe(true);
    expect(first.body.lines.map((l) => l.id).sort()).toEqual([...stews].sort());
    const second = await callUscita(waiter2, s1, 2);
    expect(second.status).toBe(409);
    expect(second.text).toContain("already_called");
    expect(await calls(s1)).toEqual([{ uscita: 2, cause: "call" }]);
  });

  it("/api/sync v2 and v1 batches with a legacy fire and a call, replayed twice: one call row, the same results", async () => {
    // Version 2 (the new bundle): add a 3rd-uscita stew, send it with hold, call the 3rd.
    const lineV2 = randomUUID();
    const v2 = [
      opFor(
        "add_line",
        { sessionId: s2, lineId: lineV2, menuItemId: fa.items.stew, uscita: 3 },
        w2,
        { msFromNow: -600_000 },
      ),
      opFor("fire", { sessionId: s2, lineIds: [lineV2], hold: true }, w2),
      opFor("call_uscita", { sessionId: s2, uscita: 3 }, w2),
    ];
    const r1 = await sync(waiter2, v2, "2");
    const r2 = await sync(waiter2, v2, "2");
    expect(r1.status).toBe(200);
    expect(r1.body.results.map((r) => r.status)).toEqual(["applied", "applied", "applied"]);
    expect(r2.body.results.map((r) => r.status)).toEqual(["duplicate", "duplicate", "duplicate"]);
    expect(r1.text).toContain('"uscita"');
    // Version 1 (an old bundle): a legacy segue add and a fire without hold, which calls the 2nd as "Invia a seguire" did.
    const lineV1 = randomUUID();
    const v1 = [
      opFor(
        "add_line",
        { sessionId: s2, lineId: lineV1, menuItemId: fa.items.stew, segue: true },
        w2,
        { msFromNow: -600_000 },
      ),
      opFor("fire", { sessionId: s2, lineIds: [lineV1] }, w2),
    ];
    const o1 = await sync(waiter2, v1);
    const o2 = await sync(waiter2, v1);
    expect(o1.status).toBe(200);
    expect(o1.text).not.toContain("uscita");
    expect(o1.text).not.toContain('"held"');
    expect(o2.body.results.map((r) => r.status)).toEqual(["duplicate", "duplicate"]);
    expect(await calls(s2)).toEqual([
      { uscita: 2, cause: "fire_now" },
      { uscita: 3, cause: "call" },
    ]);
  });

  it("tenant B's waiter cannot call A's uscita (404 before anything is written)", async () => {
    expect((await callUscita(b.waiter, s1, 3)).status).toBe(404);
    expect(wb && w1 && sb1 && acquaB).toBeTruthy();
  });
});
