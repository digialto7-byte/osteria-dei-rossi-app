import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { BillOutput, CloseOutput } from "@/server/bill/output";
import type { AppVsRegister, EnterDayCloseOutput } from "@/server/day-close/output";
import type { KitchenTickets } from "@/server/kitchen/output";
import type { ServiceMenu, WeightSettings } from "@/server/menu/output";
import type { AddLineOutput, FireOutput } from "@/server/orders/output";
import type { SyncOutput } from "@/server/sync/output";
import { openSession, type ClosingCalls } from "./helpers/closing";
import { portionItemBody, WEIGHT_NAMES, WEIGHT_TABLE, weightedItemBody } from "./helpers/menu";
import { seedMenuTablesTenant } from "./helpers/menu-tables";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";
import { appUserId, opFor } from "./helpers/sync";

// P2-0b step A9 (plan §5): sell by weight against the real local stack, over the real routes (strict schemas, role checks, error
// mapping, RLS). Only `createSupabaseServerClient` is replaced, so each call carries the signed-in test user's own client. The owner
// creates the weighted dishes, the waiter orders by weight, fires, bills and closes (the A6 table: 89,66 €), the chef reads the
// ticket, the owner changes the maximum weight, offline ops with and without weightG replay, and tenant B stays apart.
// This suite needs the Supabase stack and is skipped without it (it throws in CI when the stack settings are missing). Fake data only.
const env = readStackEnv();

const asUser = vi.hoisted(() => ({ store: null as AsyncLocalStorage<SupabaseClient> | null }));
vi.mock("@/lib/supabase/server", async () => {
  const { AsyncLocalStorage: Storage } = await import("node:async_hooks");
  asUser.store = new Storage<SupabaseClient>();
  return { createSupabaseServerClient: async () => asUser.store!.getStore() };
});
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const menuItemsRoute = await import("@/app/api/menu/items/route");
const menuItemRoute = await import("@/app/api/menu/[id]/route");
const menuRoute = await import("@/app/api/menu/route");
const recipesRoute = await import("@/app/api/recipes/route");
const weightRoute = await import("@/app/api/settings/weight/route");
const copertoRoute = await import("@/app/api/settings/coperto/route");
const diningTablesRoute = await import("@/app/api/dining-tables/route");
const openRoute = await import("@/app/api/tables/[id]/open/route");
const linesRoute = await import("@/app/api/table-sessions/[id]/lines/route");
const fireRoute = await import("@/app/api/table-sessions/[id]/fire/route");
const voidRoute = await import("@/app/api/order-lines/[id]/void/route");
const kitchenRoute = await import("@/app/api/kitchen/tickets/route");
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
  error: { code: string; message: string };
}

/** Any key naming a cost, margin, GP, food cost, recipe or VAT rate. */
const COSTLY_KEY = /"[A-Za-z]*(cost|margin|gp|food|recipe|vat)[A-Za-z]*":/i;

describe.skipIf(!env)("sell by weight on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let steakId: string;
  let mushroomsId: string;
  let pastaId: string;
  let s1: string;
  let s2: string;
  const lines = { steak: "", mushrooms: "", pasta: "", pastaHalf: "" };

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

  /** Every JSON text a waiter received, scanned for costs at the end. */
  const waiterTexts: string[] = [];
  const asWaiter = <T>(user: TestUser, reply: Reply<T>): Reply<T> => {
    if (user.role === "waiter") waiterTexts.push(reply.text);
    return reply;
  };

  const createItem = (user: TestUser, body: object) =>
    call<{ item: { id: string; priceUnit: string; portionWeightG: number | null } }>(
      user,
      menuItemsRoute.POST as Handler,
      "/api/menu/items",
      { method: "POST", body },
    );
  const addLine = async (user: TestUser, session: string, body: object) =>
    asWaiter(
      user,
      await call<AddLineOutput>(
        user,
        linesRoute.POST as Handler,
        `/api/table-sessions/${session}/lines`,
        {
          method: "POST",
          body,
          params: { id: session },
        },
      ),
    );
  const add = (user: TestUser, session: string, menuItemId: string, extra: object) =>
    addLine(user, session, {
      lineId: randomUUID(),
      menuItemId,
      clientUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
      ...extra,
    });
  const fire = async (user: TestUser, session: string, lineIds: string[]) =>
    asWaiter(
      user,
      await call<FireOutput>(
        user,
        fireRoute.POST as Handler,
        `/api/table-sessions/${session}/fire`,
        {
          method: "POST",
          body: { lineIds },
          params: { id: session },
        },
      ),
    );
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
  const menu = async (user: TestUser) =>
    asWaiter(user, await call<ServiceMenu>(user, menuRoute.GET as Handler, "/api/menu"));

  const calls: ClosingCalls = {
    createItem: (body) =>
      createItem(a.owner, body) as unknown as Promise<{
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
    addLine: (user, session, body) => addLine(user, session, body),
    fire: (user, session, lineIds) => fire(user, session, lineIds),
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
    const fixture = await seedMenuTablesTenant(stack, a, {
      createRecipe: (body) =>
        call(a.owner, recipesRoute.POST as Handler, "/api/recipes", {
          method: "POST",
          body,
        }) as never,
    });
    expect(
      (await calls.setCoperto({ copertoAmount: WEIGHT_TABLE.coperto, copertoVatRate: 10 })).status,
    ).toBe(200);

    // Owner of A: "Bistecca a peso (demo)" is mapped to the demo plate; the funghi are unmapped; the pasta is an ordinary dish.
    const steak = await createItem(
      a.owner,
      weightedItemBody(
        WEIGHT_NAMES.steak,
        "Secondi",
        "secondi",
        WEIGHT_TABLE.steakEtto,
        400,
        fixture.plateKey,
      ),
    );
    expect(steak.status).toBe(201);
    steakId = steak.body.item.id;
    const mushrooms = await createItem(
      a.owner,
      weightedItemBody(
        WEIGHT_NAMES.mushrooms,
        "Antipasti",
        "antipasti",
        WEIGHT_TABLE.mushroomsEtto,
        200,
        null,
      ),
    );
    expect(mushrooms.status).toBe(201);
    mushroomsId = mushrooms.body.item.id;
    const pasta = await createItem(
      a.owner,
      portionItemBody(WEIGHT_NAMES.pasta, "Primi", "primi", WEIGHT_TABLE.pasta),
    );
    expect(pasta.status).toBe(201);
    pastaId = pasta.body.item.id;

    s1 = (await openSession(calls, a.waiter, "Tavolo 1 (demo)", 1, WEIGHT_TABLE.covers)).sessionId;
    s2 = (await openSession(calls, a.waiter, "Tavolo 2 (demo)", 2, 2)).sessionId;
  }, 300_000);

  it("the owner's weighted dish is stored per etto with its reference portion; the manage list says so", async () => {
    const list = await call<{
      items: { id: string; priceUnit: string; portionWeightG: number | null; price: number }[];
    }>(a.owner, menuItemsRoute.GET as Handler, "/api/menu/items");
    expect(list.status).toBe(200);
    const row = list.body.items.find((item) => item.id === steakId)!;
    expect(row).toMatchObject({
      priceUnit: "etto",
      portionWeightG: 400,
      price: WEIGHT_TABLE.steakEtto,
    });
    expect(list.body.items.find((item) => item.id === pastaId)).toMatchObject({
      priceUnit: "portion",
      portionWeightG: null,
    });
  });

  it("a weighted dish without a reference portion is refused (422 portion_weight_missing)", async () => {
    const refused = await createItem(a.owner, {
      ...weightedItemBody("Costata a peso (demo)", "Secondi", "secondi", 5, 400, null),
      portionWeightG: undefined,
    });
    expect(refused.status).toBe(422);
    expect(refused.error.code).toBe("portion_weight_missing");
  });

  it("the waiter adds 1 230 g: 52,28 €, qty 1, the price per etto and the reference portion frozen on the line", async () => {
    const added = await add(a.waiter, s1, steakId, { weightG: WEIGHT_TABLE.steakG });
    expect(added.status).toBe(201);
    expect(added.body.line).toMatchObject({
      qty: 1,
      weightG: WEIGHT_TABLE.steakG,
      pricePer100g: WEIGHT_TABLE.steakEtto,
      unitPrice: WEIGHT_TABLE.steakAmount,
    });
    lines.steak = added.body.line.id;
  });

  it("without a weight the dish is refused (422), 40 g and 1 205 g never reach the database (400), and a portion dish refuses a weight", async () => {
    expect((await add(a.waiter, s1, steakId, {})).error.code).toBe("weight_required");
    // Below the minimum and off the step are the route's Zod schema: 400 invalid_request before any RPC.
    for (const weightG of [40, 1205]) {
      const refused = await add(a.waiter, s1, steakId, { weightG });
      expect([refused.status, refused.error.code]).toEqual([400, "invalid_request"]);
    }
    expect((await add(a.waiter, s1, pastaId, { weightG: 500 })).error.code).toBe(
      "weight_not_allowed",
    );
    // Above the tenant's maximum passes Zod and is the database's: 422 weight_invalid.
    const tooHeavy = await add(a.waiter, s1, steakId, { weightG: 3010 });
    expect([tooHeavy.status, tooHeavy.error.code]).toEqual([422, "weight_invalid"]);
  });

  it("the other lines of the A6 table: funghi 250 g, tagliatelle x 1 and x 0,5", async () => {
    const mushrooms = await add(a.waiter, s1, mushroomsId, { weightG: WEIGHT_TABLE.mushroomsG });
    expect(mushrooms.body.line.unitPrice).toBe(WEIGHT_TABLE.mushroomsAmount);
    lines.mushrooms = mushrooms.body.line.id;
    lines.pasta = (await add(a.waiter, s1, pastaId, { qty: 1 })).body.line.id;
    lines.pastaHalf = (await add(a.waiter, s1, pastaId, { qty: 0.5 })).body.line.id;
    expect(lines.pasta && lines.pastaHalf).toBeTruthy();
  });

  it("the waiter fires the whole table", async () => {
    const fired = await fire(a.waiter, s1, [
      lines.steak,
      lines.mushrooms,
      lines.pasta,
      lines.pastaHalf,
    ]);
    expect(fired.status).toBe(200);
    expect(fired.body.fired).toHaveLength(4);
  });

  it("the chef's ticket shows weightG 1 230 and not a single euro key", async () => {
    const board = await call<KitchenTickets>(
      a.chef,
      kitchenRoute.GET as Handler,
      "/api/kitchen/tickets",
    );
    expect(board.status).toBe(200);
    const all = board.body.tickets.flatMap((ticket) => ticket.lines);
    expect(all.find((line) => line.id === lines.steak)).toMatchObject({
      qty: 1,
      weightG: WEIGHT_TABLE.steakG,
    });
    expect(all.find((line) => line.id === lines.pasta)?.weightG).toBeNull();
    expect(board.text).not.toMatch(
      /"[A-Za-z]*(price|prezzo|cost|eur|amount|total|vat)[A-Za-z]*":/i,
    );
    expect(board.text).not.toContain("€");
  });

  it("the bill is 89,66 € and the splits add up to the cent", async () => {
    const read = await bill(a.waiter, s1);
    expect(read.status).toBe(200);
    expect(read.body.subtotal).toBe(WEIGHT_TABLE.subtotal);
    expect(read.body.total).toBe(WEIGHT_TABLE.total);
    const steakLine = read.body.lines.find((line) => line.id === lines.steak)!;
    expect(steakLine).toMatchObject({
      qty: 1,
      weightG: WEIGHT_TABLE.steakG,
      pricePer100g: WEIGHT_TABLE.steakEtto,
      amount: WEIGHT_TABLE.steakAmount,
    });
    const byCovers = await bill(a.waiter, s1, "?parts=4");
    const cents = byCovers.body.split!.parts.map((part) =>
      Math.round((part as { amount: number }).amount * 100),
    );
    expect(cents.reduce((sum, c) => sum + c, 0)).toBe(Math.round(WEIGHT_TABLE.total * 100));
    const byItems = asWaiter(
      a.waiter,
      await call<BillOutput>(
        a.waiter,
        splitRoute.POST as Handler,
        `/api/table-sessions/${s1}/bill/split`,
        {
          method: "POST",
          body: {
            groups: [
              { lineIds: [lines.steak], covers: 2 },
              { lineIds: [lines.pasta, lines.pastaHalf], covers: 2 },
            ],
            sharedLineIds: [lines.mushrooms],
          },
          params: { id: s1 },
        },
      ),
    );
    expect(byItems.status).toBe(200);
    const itemCents = byItems.body.split!.parts.map((part) =>
      Math.round((part as { amount: number }).amount * 100),
    );
    expect(itemCents.reduce((sum, c) => sum + c, 0)).toBe(Math.round(WEIGHT_TABLE.total * 100));
  });

  it("closing with the preview's token works, and the end of the day shows 89,66 € and a difference of 0", async () => {
    const token = (await bill(a.waiter, s1)).body.billToken;
    const closed = asWaiter(
      a.waiter,
      await call<CloseOutput>(
        a.waiter,
        closeRoute.POST as Handler,
        `/api/table-sessions/${s1}/close`,
        {
          method: "POST",
          body: {
            receiptType: "scontrino",
            receiptNumber: "0012-0034",
            paymentType: "card",
            billToken: token,
          },
          params: { id: s1 },
        },
      ),
    );
    expect(closed.status).toBe(200);
    expect(closed.body.bill.total).toBe(WEIGHT_TABLE.total);
    const entered = await call<EnterDayCloseOutput>(
      a.owner,
      dayCloseRoute.POST as Handler,
      "/api/day-close",
      {
        method: "POST",
        body: { registerTotal: WEIGHT_TABLE.total.toFixed(2) },
      },
    );
    expect(entered.status).toBe(200);
    const report = await call<AppVsRegister>(
      a.owner,
      reportRoute.GET as Handler,
      "/api/reports/app-vs-register",
    );
    expect(report.body.app.total).toBe(WEIGHT_TABLE.total);
    expect(report.body.difference?.amount).toBe(0);
  });

  it("the owner raises the maximum to 4 000 g; the waiter's menu carries it and a 3 500 g add is accepted", async () => {
    const before = await menu(a.waiter);
    expect(before.body.weightMaxG).toBe(3000);
    const set = await call<{ changed: boolean; weightMaxG: number }>(
      a.owner,
      weightRoute.PUT as Handler,
      "/api/settings/weight",
      {
        method: "PUT",
        body: { weightMaxG: 4000 },
      },
    );
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ changed: true, weightMaxG: 4000 });
    expect((await menu(a.waiter)).body.weightMaxG).toBe(4000);
    expect((await add(a.waiter, s2, steakId, { weightG: 3500 })).status).toBe(201);
    const tooHeavy = await add(a.waiter, s2, steakId, { weightG: 4010 });
    expect([tooHeavy.status, tooHeavy.error.code]).toEqual([422, "weight_invalid"]);
    const read = await call<WeightSettings>(
      a.owner,
      weightRoute.GET as Handler,
      "/api/settings/weight",
    );
    expect(read.body).toMatchObject({
      weightMaxG: 4000,
      defaultWeightMaxG: 3000,
      minWeightG: 50,
      stepG: 10,
    });
  });

  it("a weight setting outside the range is a 422 weight_max_invalid", async () => {
    const refused = await call(a.owner, weightRoute.PUT as Handler, "/api/settings/weight", {
      method: "PUT",
      body: { weightMaxG: 490 },
    });
    expect(refused.status).toBe(422);
    expect(refused.error.code).toBe("weight_max_invalid");
  });

  it("a sync batch with an old-shape op (no weightG, a portion dish) and a new one (weightG) applies both", async () => {
    const userId = await appUserId(stack, a.waiter);
    const oldShape = opFor(
      "add_line",
      { sessionId: s2, lineId: randomUUID(), menuItemId: pastaId, qty: 2 },
      userId,
    );
    const newShape = opFor(
      "add_line",
      { sessionId: s2, lineId: randomUUID(), menuItemId: mushroomsId, weightG: 300 },
      userId,
    );
    const sent = await call<SyncOutput>(a.waiter, syncRoute.POST as Handler, "/api/sync", {
      method: "POST",
      body: { ops: [oldShape, newShape] },
    });
    waiterTexts.push(sent.text);
    expect(sent.status).toBe(200);
    expect(sent.body.results.map((result) => result.status)).toEqual(["applied", "applied"]);
  });

  it("a waiter cannot change a dish or the weight setting (403)", async () => {
    const patched = await call(a.waiter, menuItemRoute.PATCH as Handler, `/api/menu/${steakId}`, {
      method: "PATCH",
      body: { price: 9 },
      params: { id: steakId },
    });
    expect(patched.status).toBe(403);
    const put = await call(a.waiter, weightRoute.PUT as Handler, "/api/settings/weight", {
      method: "PUT",
      body: { weightMaxG: 5000 },
    });
    expect(put.status).toBe(403);
    expect((await call(a.chef, weightRoute.GET as Handler, "/api/settings/weight")).status).toBe(
      403,
    );
  });

  it("owner B sees none of A's lines and still has the default maximum", async () => {
    const lookedAt = await call(
      b.owner,
      linesRoute.GET as Handler,
      `/api/table-sessions/${s1}/lines`,
      {
        params: { id: s1 },
      },
    );
    expect(lookedAt.status).toBe(404);
    const read = await call<WeightSettings>(
      b.owner,
      weightRoute.GET as Handler,
      "/api/settings/weight",
    );
    expect(read.body.weightMaxG).toBe(3000);
  });

  it("no reply a waiter received carried a cost, margin, GP, food cost, recipe or VAT key", () => {
    expect(waiterTexts.length).toBeGreaterThan(0);
    for (const text of waiterTexts) expect(text).not.toMatch(COSTLY_KEY);
  });
});
