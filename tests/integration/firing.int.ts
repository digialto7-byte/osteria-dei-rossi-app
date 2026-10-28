import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, venueDate } from "@/lib/time/venue-date";
import type { AlertList } from "@/server/alerts/list";
import { kitchenTicketsOutput, type KitchenTickets } from "@/server/kitchen/output";
import {
  fireOutput,
  type AddLineOutput,
  type FireOutput,
  type OrderLine,
} from "@/server/orders/output";
import type { TableSession } from "@/server/tables/output";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";
import { FIRING_NAMES, seedFiringTenant, type FiringFixture } from "./helpers/firing";
import { approveWithLots } from "./helpers/invoices";
import { runSql } from "./helpers/sql";

// M19 acceptance tests 1 to 4, 6, 7 and 9 and the kitchen list against the real local stack. The routes run for real
// (schemas, role checks, error mapping, fire_course, void_line, kitchen_tickets, RLS, the ledger triggers); only
// `createSupabaseServerClient` is replaced, as in the M14 to M18 suites, so each call carries the signed-in test user's own
// client and two calls can be in flight together. Recipes, batches (the production route), menu items and the polenta
// and bread lots (approved invoices) go through the APIs. The secret key reads `batch_movement`, `batch_cost` and
// `order_line_cost` (select is granted to service_role); `stock_movement` is not granted to it, so the raw rows are read with
// SQL on the LOCAL database (helpers/sql.ts asserts the URL is local). It never reads `recipe` or `recipe_key` (lesson 3).
// Fake data only.
//
// The tests run in order and share state. Tenant A: two locations (Cella, Dispensa), stew batches A (3 portions, 24 h) and
// B (5 portions, 48 h), a ragù batch of 10, polenta in two locations, bread, two waiters, two tables. Tenant B: one
// unmapped dish, one table with a session and a draft line. Throws in CI when the stack settings are missing; skips on a
// developer machine.
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
const discardRoute = await import("@/app/api/batches/[id]/discard/route");
const menuItemsRoute = await import("@/app/api/menu/items/route");
const diningTablesRoute = await import("@/app/api/dining-tables/route");
const openRoute = await import("@/app/api/tables/[id]/open/route");
const linesRoute = await import("@/app/api/table-sessions/[id]/lines/route");
const fireRoute = await import("@/app/api/table-sessions/[id]/fire/route");
const voidRoute = await import("@/app/api/order-lines/[id]/void/route");
const kitchenRoute = await import("@/app/api/kitchen/tickets/route");
const alertsRoute = await import("@/app/api/alerts/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
  error: { code: string; message: string; details?: { reason?: string; line?: OrderLine } };
}

interface MoveRow {
  batch_id: string;
  type: string;
  portions: number;
  ref_type: string;
  reverses_id: string | null;
  reason_code: string | null;
}

const today = venueDate(new Date());
const day = (offset: number) => addDays(today, offset);
/** An instant `ms` from now, as the phone would send it. */
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 10_000) / 10_000;

describe.skipIf(!env)("firing, voids and the kitchen list on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let fa: FiringFixture;
  let waiter2: TestUser;
  let s1: string;
  let s2: string;
  let sb1: string;
  let bLineId: string;
  // Lines of the first flows, found by id from here on.
  let l1: string;
  let costOfL1: unknown;

  // Every JSON text the chef received from the kitchen and alert routes, scanned for euro signs at the end (project V6).
  const chefTexts: string[] = [];

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
      if (user === a.chef && /^\/api\/(kitchen|alerts)/.test(path)) chefTexts.push(text);
      const body = JSON.parse(text) as T;
      return {
        status: response.status,
        body,
        text,
        headers: response.headers,
        error: (body as { error?: Reply["error"] }).error as Reply["error"],
      };
    });
  }

  const addLine = (user: TestUser, session: string, body: object) =>
    call<AddLineOutput>(user, linesRoute.POST as Handler, `/api/table-sessions/${session}/lines`, {
      method: "POST",
      body,
      params: { id: session },
    });
  const fire = (user: TestUser, session: string, lineIds: string[]) =>
    call<FireOutput>(user, fireRoute.POST as Handler, `/api/table-sessions/${session}/fire`, {
      method: "POST",
      body: { lineIds },
      params: { id: session },
    });
  const voidLine = (user: TestUser, id: string, body: object) =>
    call<{ changed: boolean; line: OrderLine }>(
      user,
      voidRoute.POST as Handler,
      `/api/order-lines/${id}/void`,
      { method: "POST", body, params: { id } },
    );
  const discard = (user: TestUser, id: string, body: object) =>
    call(user, discardRoute.POST as Handler, `/api/batches/${id}/discard`, {
      method: "POST",
      body,
      params: { id },
    });
  const tickets = (user: TestUser) =>
    call<KitchenTickets>(user, kitchenRoute.GET as Handler, "/api/kitchen/tickets");
  const alerts = (user: TestUser) =>
    call<AlertList>(user, alertsRoute.GET as Handler, "/api/alerts?filter=open");

  /** The body of a tap on a dish. */
  const tap = (menuItemId: string, extra: object = {}) => ({
    lineId: randomUUID(),
    menuItemId,
    clientUpdatedAt: at(-60_000),
    ...extra,
  });
  /** Adds a dish and returns the new line's id (the line stays a draft). */
  const add = async (user: TestUser, session: string, menuItemId: string, extra: object = {}) => {
    const reply = await addLine(user, session, tap(menuItemId, extra));
    expect(reply.status).toBe(201);
    return reply.body.line.id;
  };

  /** The batch ledger rows that refer to a line, read with the secret key. */
  const moves = async (lineId: string): Promise<MoveRow[]> => {
    const read = await stack.admin
      .from("batch_movement")
      .select("batch_id, type, portions, ref_type, reverses_id, reason_code")
      .eq("ref_id", lineId);
    expect(read.error).toBeNull();
    return (read.data ?? []) as MoveRow[];
  };
  /** Portions the line took from a batch by firing (the original consume rows only). */
  const tookFrom = (rows: MoveRow[], batchId: string) =>
    sum(
      rows
        .filter(
          (m) =>
            m.batch_id === batchId &&
            m.type === "consume" &&
            m.ref_type === "order_line" &&
            m.reverses_id === null,
        )
        .map((m) => -Number(m.portions)),
    );
  /** The balance of a batch, derived from its ledger (nothing is stored). */
  const balance = async (batchId: string) => {
    const read = await stack.admin
      .from("batch_movement")
      .select("portions")
      .eq("batch_id", batchId);
    expect(read.error).toBeNull();
    return sum((read.data ?? []).map((m) => Number(m.portions)));
  };
  /** Raw stock rows of a line and an ingredient: 'LOT@Location qty', sorted by lot code. Local database only. */
  const rawRows = (
    lineId: string,
    ingredientId: string,
    type = "consumption",
    refType = "order_line",
  ) =>
    runSql(
      `select coalesce(string_agg(coalesce(rl.lot_code, 'unlotted') || '@' || loc.name || ' ' || trim_scale(m.qty)::text, ',' order by coalesce(rl.lot_code, 'unlotted') collate "C"), '-')
         from public.stock_movement m
         left join public.raw_lot rl on rl.id = m.raw_lot_id
         join public.location loc on loc.id = m.location_id
        where m.ref_id = '${lineId}' and m.ref_type = '${refType}' and m.type = '${type}' and m.ingredient_id = '${ingredientId}'`,
    );
  const costRow = async (lineId: string) => {
    const read = await stack.admin.from("order_line_cost").select("*").eq("order_line_id", lineId);
    expect(read.error).toBeNull();
    return (read.data ?? [])[0] as Record<string, unknown> | undefined;
  };

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
        }) as Promise<{ status: number; body: { recipe: { key: string } } }>,
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

    const openTable = async (owner: TestUser, waiter: TestUser, name: string, position: number) => {
      const table = await call<{ table: { id: string } }>(
        owner,
        diningTablesRoute.POST as Handler,
        "/api/dining-tables",
        { method: "POST", body: { name, position } },
      );
      expect(table.status).toBe(201);
      const tableId = table.body.table.id;
      const sessionId = randomUUID();
      const opened = await call<{ created: boolean; session: TableSession }>(
        waiter,
        openRoute.POST as Handler,
        `/api/tables/${tableId}/open`,
        { method: "POST", body: { sessionId, covers: 4 }, params: { id: tableId } },
      );
      expect(opened.status).toBe(201);
      return { tableId, sessionId };
    };
    s1 = (await openTable(a.owner, a.waiter, "Tavolo 1 (demo)", 1)).sessionId;
    s2 = (await openTable(a.owner, waiter2, "Tavolo 2 (demo)", 2)).sessionId;
    sb1 = (await openTable(b.owner, b.waiter, "Tavolo 1 (demo)", 1)).sessionId;

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
    const lineB = await addLine(b.waiter, sb1, tap(itemB.body.item.id));
    expect(lineB.status).toBe(201);
    bLineId = lineB.body.line.id;
  }, 300_000);

  describe("AT1 to AT3: FEFO over the batches, raw stock by recipe quantity", () => {
    it("AT1: one Spezzatino takes 1 portion from A (24 h) and none from B (48 h)", async () => {
      l1 = await add(a.waiter, s1, fa.items.stew);
      const sent = await fire(a.waiter, s1, [l1]);
      expect(sent.status).toBe(200);
      expect(fireOutput.safeParse(sent.body).success).toBe(true);
      expect(sent.body.fired).toEqual([l1]);
      expect(sent.body.skipped).toEqual([]);
      expect(sent.body.lines.find((l) => l.id === l1)?.state).toBe("fired");
      const rows = await moves(l1);
      expect(tookFrom(rows, fa.stewBatchA)).toBe(1);
      expect(tookFrom(rows, fa.stewBatchB)).toBe(0);
      expect(await balance(fa.stewBatchA)).toBe(2);
      expect(await balance(fa.stewBatchB)).toBe(5);
    });

    it("AT3: polenta from the lot that expires first, in either location (P2 at Cella, then P1 at Dispensa), and the bread", () => {
      expect(rawRows(l1, fa.polentaId)).toBe("P1@Dispensa (demo) -0.05,P2@Cella -0.1");
      expect(rawRows(l1, fa.paneId)).toBe("N1@Dispensa (demo) -0.1");
    });

    it("the cost is frozen with the sale: complete, and made of the batch cost plus 0,18 polenta and 0,30 bread", async () => {
      const row = (await costRow(l1))!;
      expect(row.incomplete).toBe(false);
      const batchCost = await stack.admin
        .from("batch_cost")
        .select("unit_cost_frozen")
        .eq("batch_id", fa.stewBatchA)
        .single();
      expect(batchCost.error).toBeNull();
      const expected =
        Math.round((Number(batchCost.data!.unit_cost_frozen) + 0.48) * 10_000) / 10_000;
      expect(Number(row.total_cost)).toBeCloseTo(expected, 3);
      expect(Number(row.unit_cost_at_sale)).toBeCloseTo(expected, 3);
      costOfL1 = row;
    });

    it("AT2: a half portion takes 0,5; two portions with A at 1 take A 1 and B 1", async () => {
      const half = await add(a.waiter, s1, fa.items.stew, { qty: 0.5 });
      expect((await fire(a.waiter, s1, [half])).status).toBe(200);
      expect(tookFrom(await moves(half), fa.stewBatchA)).toBe(0.5);
      const another = await add(waiter2, s2, fa.items.stew, { qty: 0.5 });
      expect((await fire(waiter2, s2, [another])).status).toBe(200);
      expect(await balance(fa.stewBatchA)).toBe(1);

      const two = await add(waiter2, s2, fa.items.stew, { qty: 2 });
      const sent = await fire(waiter2, s2, [two]);
      expect(sent.status).toBe(200);
      const rows = await moves(two);
      expect(tookFrom(rows, fa.stewBatchA)).toBe(1);
      expect(tookFrom(rows, fa.stewBatchB)).toBe(1);
      expect(await balance(fa.stewBatchA)).toBe(0);
      expect(await balance(fa.stewBatchB)).toBe(4);
    });

    it("lesson 1: a third location added between fires changes nothing for a dish that uses no raw stock", async () => {
      const before = await add(a.waiter, s1, fa.items.tagliatelle);
      expect((await fire(a.waiter, s1, [before])).status).toBe(200);
      const made = await stack.admin
        .from("location")
        .insert({ tenant_id: a.id, name: "Frigo bar (demo)" });
      expect(made.error).toBeNull();
      const after = await add(a.waiter, s1, fa.items.tagliatelle);
      expect((await fire(a.waiter, s1, [after])).status).toBe(200);
      expect(tookFrom(await moves(before), fa.raguBatchId)).toBe(1);
      expect(tookFrom(await moves(after), fa.raguBatchId)).toBe(1);
      expect(await balance(fa.raguBatchId)).toBe(8);
    });

    it("an unmapped dish (Acqua) is fired with no movement and a cost row without a recipe", async () => {
      const water = await add(a.waiter, s1, fa.items.acqua);
      expect((await fire(a.waiter, s1, [water])).status).toBe(200);
      expect(await moves(water)).toEqual([]);
      const row = (await costRow(water))!;
      expect([row.recipe_id, row.incomplete, row.total_cost]).toEqual([null, true, null]);
    });
  });

  describe("AT7: the frozen cost does not move", () => {
    it("a new invoice price for polenta after the fire leaves the cost row of the line unchanged", async () => {
      const approved = await approveWithLots(
        stack.admin,
        a.id,
        {
          supplierId: fa.batch.supplierId,
          date: day(0),
          lines: [
            {
              description: "Polenta P3",
              ingredientId: fa.polentaId,
              qty: 1,
              unit: "kg",
              unitPrice: 9.9,
              lotCode: "P3",
              expiry: day(12),
            },
          ],
        },
        async (invoiceId) =>
          (
            await call(
              a.owner,
              approveRoute.POST as Handler,
              `/api/invoices/${invoiceId}/approve`,
              {
                method: "POST",
                body: { locationId: fa.dispensaId },
                params: { id: invoiceId },
              },
            )
          ).status,
      );
      expect(approved.status).toBe(200);
      expect(await costRow(l1)).toEqual(costOfL1);
    });
  });

  describe("idempotency", () => {
    it("the same fire twice: 200 then 200 with every line skipped as already_fired, and nothing is written twice", async () => {
      const before = (await moves(l1)).length;
      const again = await fire(a.waiter, s1, [l1]);
      expect(again.status).toBe(200);
      expect(again.body.fired).toEqual([]);
      expect(again.body.skipped).toEqual([{ lineId: l1, reason: "already_fired" }]);
      expect((await moves(l1)).length).toBe(before);
      expect(rawRows(l1, fa.polentaId)).toBe("P1@Dispensa (demo) -0.05,P2@Cella -0.1");
    });

    it("two fires of the same lines at once: one fires them, the other skips them; one set of movements", async () => {
      const x = await add(a.waiter, s1, fa.items.tagliatelle);
      const y = await add(a.waiter, s1, fa.items.tagliatelle);
      const [one, two] = await Promise.all([fire(a.waiter, s1, [x, y]), fire(a.owner, s1, [x, y])]);
      expect([one.status, two.status]).toEqual([200, 200]);
      expect([one.body.fired.length, two.body.fired.length].sort()).toEqual([0, 2]);
      expect(tookFrom(await moves(x), fa.raguBatchId)).toBe(1);
      expect(tookFrom(await moves(y), fa.raguBatchId)).toBe(1);
    });
  });

  describe("AT6: voids", () => {
    it("a void before firing writes no movement and leaves the batches alone", async () => {
      const draft = await add(a.waiter, s1, fa.items.stew);
      const before = [await balance(fa.stewBatchA), await balance(fa.stewBatchB)];
      const voided = await voidLine(a.waiter, draft, {
        reason: "customer_changed",
        clientUpdatedAt: at(-30_000),
      });
      expect(voided.status).toBe(200);
      expect(voided.body.changed).toBe(true);
      expect(voided.body.line.state).toBe("voided");
      expect(await moves(draft)).toEqual([]);
      expect(rawRows(draft, fa.polentaId)).toBe("-");
      expect([await balance(fa.stewBatchA), await balance(fa.stewBatchB)]).toEqual(before);
    });

    it("a void after firing is a reversal plus a waste row per movement, and stock is not restored", async () => {
      const before = [await balance(fa.stewBatchA), await balance(fa.stewBatchB)];
      const voided = await voidLine(a.waiter, l1, {
        reason: "kitchen_error",
        clientUpdatedAt: at(-30_000),
      });
      expect(voided.status).toBe(200);
      expect(voided.body.line.state).toBe("voided");
      const rows = await moves(l1);
      expect(rows.filter((m) => m.reverses_id !== null).map((m) => Number(m.portions))).toEqual([
        1,
      ]);
      const waste = rows.filter((m) => m.type === "waste");
      expect(waste.map((m) => [Number(m.portions), m.reason_code, m.ref_type])).toEqual([
        [-1, "plating_error", "order_void"],
      ]);
      expect([await balance(fa.stewBatchA), await balance(fa.stewBatchB)]).toEqual(before);
      expect(rawRows(l1, fa.polentaId, "waste", "order_void")).toBe(
        "P1@Dispensa (demo) -0.05,P2@Cella -0.1",
      );
      expect(rawRows(l1, fa.polentaId, "consumption", "order_void")).toBe(
        "P1@Dispensa (demo) 0.05,P2@Cella 0.1",
      );
      expect(await costRow(l1)).toEqual(costOfL1);
    });

    it("the same void again is a 200 with changed false; another reason is a 409 conflict", async () => {
      const replay = await voidLine(a.waiter, l1, {
        reason: "kitchen_error",
        clientUpdatedAt: at(-30_000),
      });
      expect([replay.status, replay.body.changed]).toEqual([200, false]);
      const other = await voidLine(a.waiter, l1, { reason: "comp", clientUpdatedAt: at(-30_000) });
      expect([other.status, other.error.code, other.error.details?.reason]).toEqual([
        409,
        "conflict",
        "voided",
      ]);
    });

    it("an unknown reason and M18's internal reason are refused", async () => {
      const line = await add(a.waiter, s1, fa.items.zuppa);
      for (const reason of ["boh", "entry_removed"]) {
        const reply = await voidLine(a.waiter, line, { reason, clientUpdatedAt: at(-30_000) });
        expect(reply.status).toBe(400);
      }
    });
  });

  describe("AT4: a shortage is booked and alerted, never refused", () => {
    it("with no live portion left the fire still succeeds: the shortage goes on a batch that is not discarded, and the chef is alerted", async () => {
      const late = await add(a.waiter, s1, fa.items.stew);
      // Stew is down to B's 4 portions (A is finished); discard B's remaining 4 through the API.
      expect(
        (await discard(a.chef, fa.stewBatchB, { portions: 4, reason: "spoilage" })).status,
      ).toBe(200);
      expect(await balance(fa.stewBatchB)).toBe(0);
      const sent = await fire(a.waiter, s1, [late]);
      expect(sent.status).toBe(200);
      const rows = await moves(late);
      // A (finished, not discarded) is preferred over the discarded B.
      expect(tookFrom(rows, fa.stewBatchA)).toBe(1);
      expect(await balance(fa.stewBatchA)).toBe(-1);
      expect(await balance(fa.stewBatchB)).toBe(0);
      const raw = await costRow(late);
      expect(raw?.incomplete).toBe(false);

      const list = await alerts(a.chef);
      expect(list.status).toBe(200);
      const alert = list.body.alerts.find(
        (item) => item.kind === "negative_stock" && item.entityType === "recipe_key",
      );
      expect(alert).toBeDefined();
      expect(alert!.href).toBe("/produzione");
      expect(alert!.title).toMatch(/^Scorta negativa: /);
      expect(alert!.body).toMatch(/manc(a|ano) 1 porzion/);
    });
  });

  describe("AT9: what the waiter and the chef cannot read", () => {
    it("the waiter reads no order_line_cost row and no batch_movement row (rows exist)", async () => {
      const exists = await stack.admin.from("order_line_cost").select("order_line_id").limit(1);
      expect((exists.data ?? []).length).toBe(1);
      const cost = await a.waiter.client.from("order_line_cost").select("order_line_id");
      expect(cost.error).toBeNull();
      expect(cost.data).toEqual([]);
      const ledger = await a.waiter.client.from("batch_movement").select("id");
      expect(ledger.error).toBeNull();
      expect(ledger.data).toEqual([]);
    });

    it("the chef reads batch quantities but no order_line_cost row; the owner reads the costs", async () => {
      const cost = await a.chef.client.from("order_line_cost").select("order_line_id");
      expect(cost.error).toBeNull();
      expect(cost.data).toEqual([]);
      const ledger = await a.chef.client.from("batch_movement").select("id").limit(1);
      expect((ledger.data ?? []).length).toBe(1);
      const owner = await a.owner.client.from("order_line_cost").select("order_line_id").limit(1);
      expect((owner.data ?? []).length).toBe(1);
    });
  });

  describe("the kitchen list", () => {
    it("the chef reads the tickets of the sent dishes, found by id, and the JSON has no euro value or cost key", async () => {
      const reply = await tickets(a.chef);
      expect(reply.status).toBe(200);
      expect(reply.headers.get("cache-control")).toBe("no-store");
      expect(kitchenTicketsOutput.safeParse(reply.body).success).toBe(true);
      const ticket = reply.body.tickets.find(
        (item) => item.sessionId === s1 && item.lines.some((line) => line.id === l1),
      );
      expect(ticket).toBeDefined();
      expect(ticket!.key).toBe(`${s1}|${ticket!.firedAt}|${ticket!.course}|${ticket!.segue}`);
      expect(ticket!.tableName).toBe("Tavolo 1 (demo)");
      expect(ticket!.lines.find((line) => line.id === l1)).toMatchObject({
        name: FIRING_NAMES.stew,
        qty: 1,
        voided: true,
        voidReason: "kitchen_error",
      });
      expect(reply.text).not.toMatch(/€|unitPrice|unit_cost|cost|price|total/i);
    });

    it("the owner and the admin read the same tickets as the chef; the waiter gets 403", async () => {
      const chef = (await tickets(a.chef)).body.tickets;
      expect((await tickets(a.owner)).body.tickets).toEqual(chef);
      expect((await tickets(a.admin)).body.tickets).toEqual(chef);
      const waiter = await tickets(a.waiter);
      expect(waiter.status).toBe(403);
      expect(waiter.text).not.toContain("€");
    });

    it("tenant B's kitchen has none of A's tickets", async () => {
      const reply = await tickets(b.owner);
      expect(reply.status).toBe(200);
      expect(reply.body.tickets).toEqual([]);
    });
  });

  describe("roles and tenants", () => {
    it("the chef cannot fire or void", async () => {
      const line = await add(a.waiter, s1, fa.items.zuppa);
      expect((await fire(a.chef, s1, [line])).status).toBe(403);
      expect(
        (await voidLine(a.chef, line, { reason: "comp", clientUpdatedAt: at(-30_000) })).status,
      ).toBe(403);
    });

    it("tenant B gets 404 on A's session and A's line, and A cannot fire B's line", async () => {
      const line = await add(a.waiter, s1, fa.items.zuppa);
      expect((await fire(b.waiter, s1, [line])).status).toBe(404);
      expect(
        (await voidLine(b.waiter, line, { reason: "comp", clientUpdatedAt: at(-30_000) })).status,
      ).toBe(404);
      expect((await fire(a.waiter, s1, [bLineId])).status).toBe(404);
      expect((await fire(a.waiter, sb1, [bLineId])).status).toBe(404);
    });

    it("a line of another session of the same tenant is refused whole: nothing is fired", async () => {
      const mine = await add(a.waiter, s1, fa.items.zuppa);
      const theirs = await add(waiter2, s2, fa.items.zuppa);
      const reply = await fire(a.waiter, s1, [mine, theirs]);
      expect([reply.status, reply.error.code]).toEqual([404, "not_found"]);
      const read = await stack.admin
        .from("order_line")
        .select("id, fired_at")
        .in("id", [mine, theirs]);
      expect(read.error).toBeNull();
      expect((read.data ?? []).every((row) => row.fired_at === null)).toBe(true);
    });
  });

  it("the chef received no euro sign from the kitchen or alert routes", () => {
    expect(chefTexts.length).toBeGreaterThan(0);
    expect(chefTexts.filter((text) => text.includes("€"))).toEqual([]);
  });
});
