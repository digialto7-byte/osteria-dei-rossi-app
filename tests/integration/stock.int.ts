import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, venueDate } from "@/lib/time/venue-date";
import type { AlertList } from "@/server/alerts/list";
import type {
  OutflowResult,
  ReverseResult,
  StockMovementsResult,
  TransferResult,
  WasteCosts,
} from "@/server/stock/types";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";
import { approveWithLots, seedLocation, seedSupplier } from "./helpers/invoices";

// M12 acceptance tests 1, 3, 4, 5, 6 and 7 and V6 (the chef never sees EUR) against the real local stack. The stock
// routes run for real (schemas, role checks, error mapping, the four procedures and the three reads, the FEFO engine,
// the negative-stock alert, RLS, append-only triggers); only `createSupabaseServerClient` is replaced, because it would
// read cookies from a Next.js request: each call is handed the signed-in test user's own client (publishable key + that
// user's JWT). Stock fixtures arrive the production way: an invoice with lot codes and expiries is approved through
// POST /api/invoices/:id/approve. Reads of RLS tables go through a user session; the secret key reads stock_movement
// only to prove the original rows are untouched by a reversal (service_role keeps SELECT there).
//
// The tests run in order and share state: tenant A holds 6 kg of beef in three lots (L-D5, L-D2, L-NONE, 2 kg each,
// at Cella, bought at 10,00 EUR/kg), and every test that changes the stock is reversed before the next. Tenant B must
// see none of it. Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const approveRoute = await import("@/app/api/invoices/[id]/approve/route");
const stockRoute = await import("@/app/api/stock/route");
const lotsRoute = await import("@/app/api/stock/lots/route");
const movementsRoute = await import("@/app/api/stock/movements/route");
const wasteRoute = await import("@/app/api/stock/waste/route");
const transfersRoute = await import("@/app/api/stock/transfers/route");
const reverseRoute = await import("@/app/api/stock/movements/[id]/reverse/route");
const wasteCostsRoute = await import("@/app/api/stock/waste-costs/route");
const alertsRoute = await import("@/app/api/alerts/route");

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

/** One request to a real route handler, as the given user. */
async function call<T = Record<string, unknown>>(
  user: TestUser,
  handler: Handler,
  path: string,
  init: { method?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<Reply<T>> {
  session.client = user.client;
  const method = init.method ?? "GET";
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
}

interface StockBody {
  items: {
    name: string;
    onHandQty: number;
    negative: boolean;
    locations: { name: string; onHandQty: number; unlottedQty: number; negative: boolean }[];
  }[];
}
interface LotsBody {
  lots: {
    rawLotId: string | null;
    lotCode: string | null;
    locationName: string;
    onHandQty: number;
    fefoRank: number | null;
  }[];
}

const COSTLY = /eur|cost|price|margin|value|amount/i;
const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : value !== null && typeof value === "object"
      ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
      : [];

const today = venueDate(new Date());
const day = (offset: number) => addDays(today, offset);
const NO_ID = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!env)("raw stock on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let beefId: string;
  let cellaId: string;
  let freezerId: string;
  const lotCodeById = new Map<string, string>();

  const getStock = (user: TestUser) =>
    call<StockBody>(user, stockRoute.GET as Handler, "/api/stock");
  const getLots = (user: TestUser, query = "") =>
    call<LotsBody>(user, lotsRoute.GET as Handler, `/api/stock/lots?ingredient=${beefId}${query}`);
  const getMovements = (user: TestUser) =>
    call<StockMovementsResult>(
      user,
      movementsRoute.GET as Handler,
      `/api/stock/movements?ingredient=${beefId}`,
    );
  const waste = (user: TestUser, qty: number, extra: Record<string, unknown> = {}) =>
    call<OutflowResult>(user, wasteRoute.POST as Handler, "/api/stock/waste", {
      method: "POST",
      body: {
        ingredientId: beefId,
        qty,
        unit: "kg",
        reason: "spoilage",
        locationId: cellaId,
        ...extra,
      },
    });
  const transfer = (user: TestUser, qty: number) =>
    call<TransferResult>(user, transfersRoute.POST as Handler, "/api/stock/transfers", {
      method: "POST",
      body: {
        ingredientId: beefId,
        qty,
        unit: "kg",
        fromLocationId: cellaId,
        toLocationId: freezerId,
      },
    });
  const reverse = (user: TestUser, movementId: string) =>
    call<ReverseResult>(
      user,
      reverseRoute.POST as Handler,
      `/api/stock/movements/${movementId}/reverse`,
      {
        method: "POST",
        body: {},
        params: { id: movementId },
      },
    );
  const wasteCosts = (user: TestUser) =>
    call<WasteCosts>(user, wasteCostsRoute.GET as Handler, "/api/stock/waste-costs");
  const beefOf = (body: StockBody) =>
    body.items.find((item) => item.name === "Manzo muscolo (demo)");
  const codesOf = (movements: { rawLotId: string | null; qty: number }[]) =>
    movements.map((m) => `${m.rawLotId ? lotCodeById.get(m.rawLotId) : "null"} ${m.qty}`);

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    const supplierId = await seedSupplier(stack.admin, a.id);
    cellaId = await seedLocation(stack.admin, a.id);
    const second = await stack.admin
      .from("location")
      .insert({ tenant_id: a.id, name: "Freezer" })
      .select("id")
      .single();
    expect(second.error).toBeNull();
    freezerId = second.data!.id as string;
    const made = await stack.admin
      .from("ingredient")
      .insert({ tenant_id: a.id, name: "Manzo muscolo (demo)", base_unit: "kg" })
      .select("id")
      .single();
    expect(made.error).toBeNull();
    beefId = made.data!.id as string;

    // The AT1 lots arrive by invoice: three lines of 2 kg at 10,00 EUR/kg, expiring D+5, D+2 and never.
    const approved = await approveWithLots(
      stack.admin,
      a.id,
      {
        supplierId,
        date: day(-1),
        lines: [
          {
            description: "Manzo L-D5",
            ingredientId: beefId,
            qty: 2,
            unit: "kg",
            unitPrice: 10,
            lotCode: "L-D5",
            expiry: day(5),
          },
          {
            description: "Manzo L-D2",
            ingredientId: beefId,
            qty: 2,
            unit: "kg",
            unitPrice: 10,
            lotCode: "L-D2",
            expiry: day(2),
          },
          {
            description: "Manzo L-NONE",
            ingredientId: beefId,
            qty: 2,
            unit: "kg",
            unitPrice: 10,
            lotCode: "L-NONE",
          },
        ],
      },
      async (invoiceId) =>
        (
          await call(a.owner, approveRoute.POST as Handler, `/api/invoices/${invoiceId}/approve`, {
            method: "POST",
            body: { locationId: cellaId },
            params: { id: invoiceId },
          })
        ).status,
    );
    expect(approved.status).toBe(200);
    const lots = await getLots(a.chef);
    expect(lots.status).toBe(200);
    for (const lot of lots.body.lots) lotCodeById.set(lot.rawLotId!, lot.lotCode!);
  }, 120_000);

  describe("AT1: FEFO", () => {
    it("lists the lots first-expiring first", async () => {
      const { body } = await getLots(a.chef);
      expect(body.lots.map((lot) => `${lot.lotCode}:${lot.fefoRank}:${lot.onHandQty}`)).toEqual([
        "L-D2:1:2",
        "L-D5:2:2",
        "L-NONE:3:2",
      ]);
    });

    let wasteOp: OutflowResult;
    it("the chef's waste of 5 kg takes L-D2, then L-D5, then the lot without an expiry", async () => {
      const { status, body } = await waste(a.chef, 5);
      expect(status).toBe(201);
      wasteOp = body;
      expect(codesOf(body.movements)).toEqual(["L-D2 -2", "L-D5 -2", "L-NONE -1"]);
      expect(body).toMatchObject({ onHandQty: 1, negative: false });
      expect(beefOf((await getStock(a.chef)).body)?.onHandQty).toBe(1);
    });

    it("an override lot is respected: the lot first, then FEFO", async () => {
      // 1 kg is left, all of it in L-NONE: the override names the lot that still has stock.
      const { status, body } = await waste(a.chef, 0.5, {
        lotId: [...lotCodeById].find(([, code]) => code === "L-NONE")![0],
      });
      expect(status).toBe(201);
      expect(codesOf(body.movements)).toEqual(["L-NONE -0.5"]);
      const undo = await reverse(a.chef, body.movements[0]!.id);
      expect(undo.status).toBe(201);
    });

    it("AT5: reversing the waste restores the stock and leaves the original rows untouched", async () => {
      const before = await stack.admin
        .from("stock_movement")
        .select("*")
        .in(
          "id",
          wasteOp.movements.map((m) => m.id),
        );
      expect(before.error).toBeNull();
      const { status, body } = await reverse(a.chef, wasteOp.movements[2]!.id);
      expect(status).toBe(201);
      expect(body.reversedOperationId).toBe(wasteOp.operationId);
      expect(codesOf(body.movements).sort()).toEqual(["L-D2 2", "L-D5 2", "L-NONE 1"]);
      const after = await stack.admin
        .from("stock_movement")
        .select("*")
        .in(
          "id",
          wasteOp.movements.map((m) => m.id),
        );
      expect(after.data).toEqual(before.data);
      expect(beefOf((await getStock(a.owner)).body)?.onHandQty).toBe(6);

      const history = (await getMovements(a.owner)).body.operations;
      const original = history.find((op) => op.operationId === wasteOp.operationId)!;
      expect(original.reversedByOperationId).toBe(body.operationId);
      expect(original.reversible).toBe(false);
      expect(history.find((op) => op.operationId === body.operationId)).toMatchObject({
        isReversal: true,
        reversible: false,
      });
      const again = await reverse(a.owner, wasteOp.movements[0]!.id);
      expect([again.status, again.error.code]).toEqual([409, "already_reversed"]);
    });
  });

  describe("AT3: waste in EUR", () => {
    it("a 1,5 kg waste at basis 10 is worth 15,00 EUR to the owner and the admin, and to nobody else", async () => {
      const done = await waste(a.owner, 1.5);
      expect(done.status).toBe(201);
      const owner = await wasteCosts(a.owner);
      expect(owner.status).toBe(200);
      expect(owner.body.valueEur).toBe(15);
      expect(owner.body.reasons.find((r) => r.reasonCode === "spoilage")?.valueEur).toBe(15);
      expect((await wasteCosts(a.admin)).body.valueEur).toBe(15);
      expect((await wasteCosts(a.chef)).status).toBe(403);
      expect((await wasteCosts(a.waiter)).status).toBe(403);
      // The reversal nets it to zero.
      expect((await reverse(a.owner, done.body.movements[0]!.id)).status).toBe(201);
      expect((await wasteCosts(a.owner)).body.valueEur).toBe(0);
    });
  });

  describe("AT4: transfers", () => {
    it("moves the quantity between locations and keeps the ingredient total", async () => {
      const moved = await transfer(a.chef, 2);
      expect(moved.status).toBe(201);
      expect(codesOf(moved.body.movements)).toEqual(["L-D2 -2", "L-D2 2"]);
      const item = beefOf((await getStock(a.chef)).body)!;
      expect(item.onHandQty).toBe(6);
      expect(item.locations.map((l) => `${l.name}:${l.onHandQty}`).sort()).toEqual([
        "Cella:4",
        "Freezer:2",
      ]);
      expect((await reverse(a.chef, moved.body.movements[0]!.id)).status).toBe(201);
      expect(beefOf((await getStock(a.chef)).body)?.locations).toHaveLength(2);
      expect(beefOf((await getStock(a.chef)).body)?.onHandQty).toBe(6);
    });

    it("moving more than is recorded is a 409 and changes nothing", async () => {
      const refused = await transfer(a.chef, 50);
      expect([refused.status, refused.error.code]).toEqual([409, "insufficient_stock"]);
      expect(beefOf((await getStock(a.chef)).body)?.onHandQty).toBe(6);
    });
  });

  describe("AT6: consumption beyond the stock", () => {
    let over: OutflowResult;
    it("writes the movement, goes negative and says so", async () => {
      const { status, body } = await waste(a.chef, 10);
      expect(status).toBe(201);
      over = body;
      expect(body).toMatchObject({ onHandQty: -4, negative: true });
      expect(codesOf(body.movements)).toEqual(["L-D2 -2", "L-D5 -2", "L-NONE -2", "null -4"]);
      const item = beefOf((await getStock(a.chef)).body)!;
      expect(item).toMatchObject({ onHandQty: -4, negative: true });
      expect(item.locations[0]).toMatchObject({ unlottedQty: -4, negative: true });
    });

    const negativeAlerts = async (user: TestUser) =>
      (
        await call<AlertList>(user, alertsRoute.GET as Handler, "/api/alerts?filter=all")
      ).body.alerts.filter((alert) => alert.kind === "negative_stock");

    it("the chef and the owner read one 'Scorta negativa' alert with the names, and no euro", async () => {
      for (const user of [a.chef, a.owner]) {
        const alerts = await negativeAlerts(user);
        expect(alerts).toHaveLength(1);
        expect(alerts[0]!.title).toBe("Scorta negativa: Manzo muscolo (demo)");
        expect(alerts[0]!.body).toContain("Cella");
        expect(alerts[0]!.body).toContain("−4");
        expect(JSON.stringify(alerts[0])).not.toMatch(/€|eur/i);
      }
    });

    it("the admin has no access to alerts at all (403)", async () => {
      expect((await call(a.admin, alertsRoute.GET as Handler, "/api/alerts")).status).toBe(403);
    });

    it("a second shortfall the same day raises no second alert", async () => {
      const more = await waste(a.chef, 1);
      expect(more.status).toBe(201);
      expect(await negativeAlerts(a.owner)).toHaveLength(1);
      expect((await reverse(a.chef, more.body.movements[0]!.id)).status).toBe(201);
    });

    it("reversing the overdraft restores the stock", async () => {
      expect((await reverse(a.chef, over.movements[0]!.id)).status).toBe(201);
      expect(beefOf((await getStock(a.chef)).body)?.onHandQty).toBe(6);
    });
  });

  describe("AT7: roles", () => {
    it("the chef cannot write the ledgers directly and reads none of its rows", async () => {
      const inserted = await a.chef.client.from("stock_movement").insert({
        tenant_id: a.id,
        ingredient_id: beefId,
        location_id: cellaId,
        type: "consumption",
        qty: -1,
        ref_type: "manual",
        ref_id: NO_ID,
        effective_on: today,
      });
      expect(inserted.error?.code).toBe("42501");
      const lot = await a.chef.client
        .from("raw_lot")
        .update({ qty_received: 9 })
        .eq("ingredient_id", beefId);
      expect(lot.error?.code).toBe("42501");
      for (const table of ["stock_movement", "v_stock_on_hand"]) {
        const read = await a.chef.client.from(table).select("*");
        expect(read.error, table).toBeNull();
        expect(read.data, table).toEqual([]);
      }
      const lots = await a.chef.client.from("raw_lot").select("id");
      expect(lots.data?.length).toBeGreaterThan(0);
    });

    it("the waiter is refused by every stock function (42501) and every route (403)", async () => {
      const rpcs: [string, Record<string, unknown>][] = [
        ["consume_raw_fefo", { p_ingredient: beefId, p_qty: 1, p_unit: "kg" }],
        ["post_waste", { p_ingredient: beefId, p_qty: 1, p_unit: "kg", p_reason: "spoilage" }],
        [
          "post_transfer",
          { p_ingredient: beefId, p_qty: 1, p_unit: "kg", p_from: cellaId, p_to: freezerId },
        ],
        ["reverse_movement", { p_movement: NO_ID }],
        ["stock_on_hand", {}],
        ["stock_lots", { p_ingredient: beefId }],
        ["stock_movements", { p_ingredient: beefId }],
        ["raw_waste_costs", { p_from: today, p_to: today }],
      ];
      for (const [name, args] of rpcs) {
        const { error } = await a.waiter.client.rpc(name, args);
        expect(error?.code, name).toBe("42501");
      }
      expect((await getStock(a.waiter)).status).toBe(403);
      expect((await getLots(a.waiter)).status).toBe(403);
      expect((await getMovements(a.waiter)).status).toBe(403);
      expect((await waste(a.waiter, 1)).status).toBe(403);
      expect((await transfer(a.waiter, 1)).status).toBe(403);
      expect((await reverse(a.waiter, NO_ID)).status).toBe(403);
      expect((await wasteCosts(a.waiter)).status).toBe(403);
    });
  });

  describe("V6: the chef never sees a euro value", () => {
    it("the three read routes carry no cost key and no euro sign, for every role that may call them", async () => {
      await waste(a.owner, 1.5); // some history with a cost on the rows
      for (const user of [a.chef, a.admin, a.owner]) {
        for (const reply of [await getStock(user), await getLots(user), await getMovements(user)]) {
          expect(reply.status).toBe(200);
          expect(keysOf(reply.body).filter((key) => COSTLY.test(key))).toEqual([]);
          expect(reply.text).not.toContain("€");
          expect(reply.text).not.toContain("unit_cost");
        }
      }
    });

    it("the chef's own write answers carry none either", async () => {
      const done = await waste(a.chef, 0.5);
      expect(done.status).toBe(201);
      expect(keysOf(done.body).filter((key) => COSTLY.test(key))).toEqual([]);
      expect(done.text).not.toContain("€");
    });

    it("the history hides other people's names from the chef", async () => {
      const operations = (await getMovements(a.chef)).body.operations.filter(
        (op) => op.type === "waste",
      );
      const mine = operations.filter((op) => op.byMe);
      const others = operations.filter((op) => !op.byMe);
      expect(mine.length).toBeGreaterThan(0);
      expect(others.length).toBeGreaterThan(0);
      expect(others.every((op) => op.byName === null)).toBe(true);
      const asOwner = (await getMovements(a.owner)).body.operations.filter(
        (op) => op.type === "waste",
      );
      expect(asOwner.every((op) => typeof op.byName === "string")).toBe(true);
    });
  });

  describe("tenancy", () => {
    it("tenant B sees no stock, gets 404 for tenant A's ingredient and cannot post to it", async () => {
      const stockOfB = await getStock(b.owner);
      expect(stockOfB.status).toBe(200);
      expect(stockOfB.body.items).toEqual([]);
      expect((await getLots(b.owner)).status).toBe(404);
      expect((await getMovements(b.owner)).status).toBe(404);
      const posted = await waste(b.owner, 1, { locationId: undefined });
      expect(posted.status).toBe(404);
    });
  });
});
