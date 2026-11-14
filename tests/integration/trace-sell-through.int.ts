import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays } from "@/lib/time/venue-date";
import type { InvoiceReview } from "@/server/invoices/review-types";
import type { PushSellThrough } from "@/server/push/output";
import type { ReservationActionResult, ReservationsCovers } from "@/server/reservations/output";
import type { AddLineOutput } from "@/server/orders/output";
import type { TablesList } from "@/server/tables/output";
import type {
  LotCapture,
  TraceBatch,
  TraceBatchChef,
  TraceLineSearch,
  TraceLot,
  TraceLotChef,
  TraceLotSearch,
  TraceOrderLine,
} from "@/server/trace/output";
import {
  produceRagu,
  seedTraceInvoice,
  seedTraceMaster,
  seedTraceRecipes,
  TRACE_NAMES,
  type TraceMaster,
  type TraceRecipes,
} from "./helpers/trace";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";

// P2-2 acceptance tests AT-P1, AT-P5, AT-P6, AT-P7 and AT-P9 (plan S18) against the real local stack, over the real routes: strict schemas, role checks, error mapping, the
// trace functions, push_sell_through, reservations_covers, the review reply, RLS. Only `createSupabaseServerClient` is replaced (as in the M14 to M25c suites), so each call
// carries the signed-in test user's own client. The secret key creates the supplier, the location, the two ingredients and the invoice in `review` (the state the extraction
// worker leaves). Every date comes from `GET /api/tables` `businessDate`, never from the calendar, so the suite is stable at any hour, including 00:00 to 02:00 Rome time.
// The server clock cannot be moved here: the DST and 1998 cases are pgTAP 352 to 359. The "PIN waiter" of the plan is the stack's password waiter (the PIN path has its
// own suite, staff-pin.int.ts); the role is the same. A booking is typed by staff (it starts accepted), because a customer's request has no route. Fake data only.
//
// The tests run in order and share state. Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const asUser = vi.hoisted(() => ({ store: null as AsyncLocalStorage<SupabaseClient> | null }));
vi.mock("@/lib/supabase/server", async () => {
  const { AsyncLocalStorage: Storage } = await import("node:async_hooks");
  asUser.store = new Storage<SupabaseClient>();
  return { createSupabaseServerClient: async () => asUser.store!.getStore() };
});
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const approveRoute = await import("@/app/api/invoices/[id]/approve/route");
const reviewRoute = await import("@/app/api/invoices/[id]/review/route");
const recipesRoute = await import("@/app/api/recipes/route");
const proposalRoute = await import("@/app/api/batches/proposal/route");
const batchesRoute = await import("@/app/api/batches/route");
const menuItemsRoute = await import("@/app/api/menu/items/route");
const pushRoute = await import("@/app/api/menu/[id]/push/route");
const diningTablesRoute = await import("@/app/api/dining-tables/route");
const tablesRoute = await import("@/app/api/tables/route");
const openRoute = await import("@/app/api/tables/[id]/open/route");
const linesRoute = await import("@/app/api/table-sessions/[id]/lines/route");
const fireRoute = await import("@/app/api/table-sessions/[id]/fire/route");
const voidRoute = await import("@/app/api/order-lines/[id]/void/route");
const traceLotsRoute = await import("@/app/api/trace/lots/route");
const traceLotRoute = await import("@/app/api/trace/lots/[id]/route");
const traceBatchRoute = await import("@/app/api/trace/batches/[id]/route");
const traceCaptureRoute = await import("@/app/api/trace/capture/route");
const traceLinesRoute = await import("@/app/api/trace/lines/route");
const traceLineRoute = await import("@/app/api/trace/lines/[id]/route");
const sellThroughRoute = await import("@/app/api/reports/push-sell-through/route");
const coversRoute = await import("@/app/api/reservations/covers/route");
const reservationsRoute = await import("@/app/api/reservations/route");

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

/** Property names at any depth of a JSON value. */
const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : value !== null && typeof value === "object"
      ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
      : [];
// What the chef may never see in a trace: a cost, a price or a euro value, the invoice and the purchase line.
const CHEF_TRACE_FORBIDDEN = /cost|price|eur|invoice|purchase/i;
// What no trace reply may carry for any role: a money key or guest data.
const NO_MONEY_OR_GUEST = /cost|price|eur|name_?guest|phone|email|contact/i;

describe.skipIf(!env)("trace, sell-through and booked covers on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let master: TraceMaster;
  let recipes: TraceRecipes;
  let today: string;
  let tomorrow: string;
  let sessionId: string;
  let invoiceId: string;
  let lotId: string;
  let batchId: string;
  let keptLineId: string;
  let voidedLineId: string;

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

  const get = <T>(user: TestUser, handler: unknown, path: string, id?: string) =>
    call<T>(user, handler as Handler, path, id === undefined ? {} : { params: { id } });
  const searchLots = (user: TestUser, query: string) =>
    get<TraceLotSearch>(user, traceLotsRoute.GET, `/api/trace/lots${query}`);
  const lotTrace = <T = TraceLot>(user: TestUser, id: string) =>
    get<T>(user, traceLotRoute.GET, `/api/trace/lots/${id}`, id);
  const batchTrace = <T = TraceBatch>(user: TestUser, id: string) =>
    get<T>(user, traceBatchRoute.GET, `/api/trace/batches/${id}`, id);
  const sellThrough = (user: TestUser, query = "") =>
    get<PushSellThrough>(user, sellThroughRoute.GET, `/api/reports/push-sell-through${query}`);
  const covers = (user: TestUser, query = "") =>
    get<ReservationsCovers>(user, coversRoute.GET, `/api/reservations/covers${query}`);
  const tap = (menuItemId: string) => ({
    lineId: randomUUID(),
    menuItemId,
    clientUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
    qty: 1,
  });
  const addLine = async () => {
    const added = await call<AddLineOutput>(
      a.waiter,
      linesRoute.POST as Handler,
      `/api/table-sessions/${sessionId}/lines`,
      { method: "POST", body: tap(recipes.itemId), params: { id: sessionId } },
    );
    expect(added.status).toBe(201);
    return added.body.line.id;
  };

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    const tiles = await call<TablesList>(a.owner, tablesRoute.GET as Handler, "/api/tables");
    expect(tiles.status).toBe(200);
    today = tiles.body.businessDate;
    tomorrow = addDays(today, 1);

    master = await seedTraceMaster(stack.admin, a.id);
    const calls = {
      createRecipe: (body: object) =>
        call(a.owner, recipesRoute.POST as Handler, "/api/recipes", {
          method: "POST",
          body,
        }) as Promise<{ status: number; body: { recipe: { key: string } } }>,
      approve: async (id: string, locationId: string) =>
        (
          await call(a.owner, approveRoute.POST as Handler, `/api/invoices/${id}/approve`, {
            method: "POST",
            body: { locationId },
            params: { id },
          })
        ).status,
      day: (offset: number) => addDays(today, offset),
      versionOf: async (key: string) =>
        (
          await call<{ recipe: { id: string } }>(
            a.chef,
            proposalRoute.GET as Handler,
            `/api/batches/proposal?recipeKey=${key}`,
          )
        ).body.recipe.id,
      produce: (body: object) =>
        call(a.chef, batchesRoute.POST as Handler, "/api/batches", {
          method: "POST",
          body,
        }) as Promise<{
          status: number;
          body: { batchId: string; lotCode: string; portions: number };
        }>,
      createItem: (body: object) =>
        call(a.owner, menuItemsRoute.POST as Handler, "/api/menu/items", {
          method: "POST",
          body,
        }) as Promise<{ status: number; body: { item: { id: string } } }>,
    };

    // Receiving: the review counts the uncoded stock line before the approval, and the approval is not blocked by it.
    invoiceId = await seedTraceInvoice(stack.admin, a.id, master, {
      receivedOn: addDays(today, -1),
      expiry: addDays(today, 10),
    });
    const review = await call<{ review: InvoiceReview }>(
      a.owner,
      reviewRoute.GET as Handler,
      `/api/invoices/${invoiceId}/review`,
      { params: { id: invoiceId } },
    );
    expect(review.status).toBe(200);
    expect(review.body.review.summary.stockLinesWithoutLot).toBe(1);
    const missing = review.body.review.lines.filter((line) => line.lotMissing);
    expect(missing.map((line) => line.rawDescription)).toEqual([TRACE_NAMES.uncoded]);
    expect(await calls.approve(invoiceId, master.cellaId)).toBe(200);

    // The kitchen: a batch from the coded lot, a plate on it, the plate pushed.
    recipes = await seedTraceRecipes(master, calls);
    batchId = await produceRagu(recipes, master, calls);
    const pushed = await call(
      a.owner,
      pushRoute.POST as Handler,
      `/api/menu/${recipes.itemId}/push`,
      {
        method: "POST",
        body: { pushed: true },
        params: { id: recipes.itemId },
      },
    );
    expect(pushed.status).toBe(200);

    // The waiter adds and fires two lines of the plate, then voids one of them.
    const table = await call<{ table: { id: string } }>(
      a.owner,
      diningTablesRoute.POST as Handler,
      "/api/dining-tables",
      { method: "POST", body: { name: "Tavolo 1 (demo)", position: 1 } },
    );
    expect(table.status).toBe(201);
    sessionId = randomUUID();
    const opened = await call(
      a.waiter,
      openRoute.POST as Handler,
      `/api/tables/${table.body.table.id}/open`,
      { method: "POST", body: { sessionId, covers: 2 }, params: { id: table.body.table.id } },
    );
    expect(opened.status).toBe(201);
    keptLineId = await addLine();
    voidedLineId = await addLine();
    const fired = await call(
      a.waiter,
      fireRoute.POST as Handler,
      `/api/table-sessions/${sessionId}/fire`,
      { method: "POST", body: { lineIds: [keptLineId, voidedLineId] }, params: { id: sessionId } },
    );
    expect(fired.status).toBe(200);
    const voided = await call(
      a.waiter,
      voidRoute.POST as Handler,
      `/api/order-lines/${voidedLineId}/void`,
      {
        method: "POST",
        body: {
          reason: "kitchen_error",
          clientUpdatedAt: new Date(Date.now() - 30_000).toISOString(),
        },
        params: { id: voidedLineId },
      },
    );
    expect(voided.status).toBe(200);
  }, 300_000);

  describe("AT-P5: receiving", () => {
    it("the approved invoice posted both lines: the coded lot and a lot with no code, both found by ingredient", async () => {
      const coded = await searchLots(a.owner, `?q=${TRACE_NAMES.lotCode}`);
      expect(coded.status).toBe(200);
      expect(coded.body.lots).toHaveLength(1);
      lotId = coded.body.lots[0]!.lotId;
      expect(coded.body.lots[0]).toMatchObject({
        lotCode: TRACE_NAMES.lotCode,
        receivedOn: addDays(today, -1),
        qtyReceived: 5,
        unit: "kg",
      });
      expect(coded.body.lots[0]!.ingredient.name).toBe(TRACE_NAMES.coded);
      const uncoded = await searchLots(a.owner, `?ingredientId=${master.uncodedId}`);
      expect(uncoded.status).toBe(200);
      expect(uncoded.body.lots).toHaveLength(1);
      expect(uncoded.body.lots[0]!.lotCode).toBeNull();
    });

    it("the review of the approved invoice still counts the line with no lot", async () => {
      const review = await call<{ review: InvoiceReview }>(
        a.owner,
        reviewRoute.GET as Handler,
        `/api/invoices/${invoiceId}/review`,
        { params: { id: invoiceId } },
      );
      expect(review.status).toBe(200);
      expect(review.body.review.summary.stockLinesWithoutLot).toBe(1);
    });

    it("the capture rate counts 1 delivery with a code out of 2, by supplier", async () => {
      const read = await get<LotCapture>(a.owner, traceCaptureRoute.GET, "/api/trace/capture");
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({ lots: 2, withLotCode: 1 });
      expect(read.body.bySupplier).toEqual([
        expect.objectContaining({ supplierId: master.supplierId, lots: 2, withLotCode: 1 }),
      ]);
    });

    it("a code search is case-insensitive and by prefix; an empty search is a 400", async () => {
      const prefix = await searchLots(a.chef, "?q=l-demo");
      expect(prefix.status).toBe(200);
      expect(prefix.body.lots.map((lot) => lot.lotId)).toEqual([lotId]);
      const none = await searchLots(a.owner, "?q=NESSUNO");
      expect(none.body.lots).toEqual([]);
      expect((await searchLots(a.owner, "")).status).toBe(400);
    });
  });

  describe("AT-P1: the forward trace of the lot", () => {
    it("the owner's lot page lists the batch, one plate group of 1 line, the voided line, the invoice and the purchase line", async () => {
      const read = await lotTrace(a.owner, lotId);
      expect(read.status).toBe(200);
      expect(read.body.lot).toMatchObject({
        lotId,
        lotCode: TRACE_NAMES.lotCode,
        qtyReceived: 5,
        unit: "kg",
        invoice: { id: invoiceId },
        purchase: { description: `${TRACE_NAMES.coded} ${TRACE_NAMES.lotCode}` },
      });
      expect(read.body.raw).toMatchObject({ received: 5, intoBatches: 1, onHand: 4 });
      expect(read.body.batches.map((batch) => batch.batchId)).toEqual([batchId]);
      expect(read.body.batches[0]).toMatchObject({
        recipeName: TRACE_NAMES.batchRecipe,
        portionsInitial: 10,
        splitFrom: null,
      });
      // Two portions went out, one came back with the void and was thrown away: 8 are left, as the stock is not restored.
      expect(read.body.batches[0]!.portions.remaining).toBe(8);
      expect(read.body.plates).toHaveLength(1);
      expect(read.body.plates[0]).toMatchObject({
        businessDate: today,
        menuItemId: recipes.itemId,
        name: TRACE_NAMES.plate,
        lines: 1,
        via: "batch",
      });
      expect(read.body.voided.lines).toBe(1);
      expect(read.body.gaps).toEqual({ lotCodeMissing: false, unlottedSameIngredientBatches: 0 });
      expect(read.body.batchesTruncated || read.body.platesTruncated).toBe(false);
    });

    it("the lot with no code says so in the gaps", async () => {
      const uncoded = await searchLots(a.owner, `?ingredientId=${master.uncodedId}`);
      const read = await lotTrace(a.owner, uncoded.body.lots[0]!.lotId);
      expect(read.status).toBe(200);
      expect(read.body.gaps.lotCodeMissing).toBe(true);
      expect(read.body.batches).toEqual([]);
    });

    it("the admin reads what the owner reads", async () => {
      const read = await lotTrace(a.admin, lotId);
      expect(read.status).toBe(200);
      expect(read.text).toContain("purchase");
    });

    it("the chef reads the same lot with no invoice, no purchase line and no money key", async () => {
      const read = await lotTrace<TraceLotChef>(a.chef, lotId);
      expect(read.status).toBe(200);
      expect(read.body.batches.map((batch) => batch.batchId)).toEqual([batchId]);
      expect(keysOf(read.body).filter((key) => CHEF_TRACE_FORBIDDEN.test(key))).toEqual([]);
    });
  });

  describe("AT-P1: the backward traces", () => {
    it("the batch lists its lot and, for the owner, the invoice; the chef gets the lot without it", async () => {
      const owner = await batchTrace(a.owner, batchId);
      expect(owner.status).toBe(200);
      expect(owner.body.batch).toMatchObject({
        batchId,
        recipeName: TRACE_NAMES.batchRecipe,
        splitFrom: null,
      });
      expect(owner.body.inputs).toHaveLength(1);
      expect(owner.body.inputs[0]).toMatchObject({
        inherited: false,
        ingredient: { name: TRACE_NAMES.coded },
        lot: {
          lotId,
          lotCode: TRACE_NAMES.lotCode,
          supplier: { id: master.supplierId },
          invoice: { id: invoiceId },
        },
      });
      expect(owner.body.plates).toHaveLength(1);

      const chef = await batchTrace<TraceBatchChef>(a.chef, batchId);
      expect(chef.status).toBe(200);
      expect(chef.body.inputs[0]!.lot).toMatchObject({ lotId, lotCode: TRACE_NAMES.lotCode });
      expect(chef.text).not.toContain("invoice");
      expect(keysOf(chef.body).filter((key) => CHEF_TRACE_FORBIDDEN.test(key))).toEqual([]);
    });

    it("a served plate leads back to the batch and to the lot", async () => {
      const found = await get<TraceLineSearch>(
        a.chef,
        traceLinesRoute.GET,
        `/api/trace/lines?date=${today}&menuItemId=${recipes.itemId}`,
      );
      expect(found.status).toBe(200);
      expect(found.body.businessDate).toBe(today);
      expect(found.body.lines.map((line) => line.lineId)).toContain(keptLineId);
      expect(found.body.lines.every((line) => line.tableName === "Tavolo 1 (demo)")).toBe(true);
      const line = await get<TraceOrderLine>(
        a.owner,
        traceLineRoute.GET,
        `/api/trace/lines/${keptLineId}`,
        keptLineId,
      );
      expect(line.status).toBe(200);
      expect(line.body.line.menuItemName).toBe(TRACE_NAMES.plate);
      expect(line.body.batches.map((batch) => batch.batchId)).toEqual([batchId]);
      expect(line.body.lots.map((lot) => lot.lotId)).toEqual([lotId]);
    });

    it("a date in the future is a 422 date_in_future", async () => {
      const future = await get(a.owner, traceLinesRoute.GET, `/api/trace/lines?date=${tomorrow}`);
      expect(future.status).toBe(422);
      expect(future.error.code).toBe("date_in_future");
    });

    it("no trace reply carries a money key or guest data, for any role", async () => {
      for (const user of [a.owner, a.admin, a.chef]) {
        for (const reply of [
          await lotTrace(user, lotId),
          await batchTrace(user, batchId),
          await get(user, traceLineRoute.GET, `/api/trace/lines/${keptLineId}`, keptLineId),
        ]) {
          expect(reply.status).toBe(200);
          expect(keysOf(reply.body).filter((key) => NO_MONEY_OR_GUEST.test(key))).toEqual([]);
        }
      }
    });
  });

  describe("AT-P6: sell-through", () => {
    it("today shows the pushed plate with 1 line sold (the voided one is not counted), ongoing", async () => {
      const read = await sellThrough(a.owner, `?date=${today}`);
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({
        businessDate: today,
        ongoing: true,
        summary: { pushes: 1, lines: 1, portions: 1 },
      });
      expect(read.body.pushes).toHaveLength(1);
      expect(read.body.pushes[0]).toMatchObject({
        menuItemId: recipes.itemId,
        name: TRACE_NAMES.plate,
        ongoing: true,
        plates: { lines: 1, portions: 1 },
      });
      // The batch has a 72-hour shelf life, so it was not close to its use-by when the push started.
      expect(read.body.pushes[0]!.atRisk).toEqual([]);
    });

    it("with no date the day is yesterday: not ongoing, and today's push is not on it", async () => {
      const read = await sellThrough(a.owner);
      expect(read.status).toBe(200);
      expect(read.body.businessDate).toBe(addDays(today, -1));
      expect(read.body.ongoing).toBe(false);
      expect(read.body.summary.pushes).toBe(0);
    });

    it("the chef reads the counts with no price key; a date after today is a 422", async () => {
      const chef = await sellThrough(a.chef, `?date=${today}`);
      expect(chef.status).toBe(200);
      expect(chef.body.summary.lines).toBe(1);
      expect(keysOf(chef.body).filter((key) => /price|cost|eur/i.test(key))).toEqual([]);
      const admin = await sellThrough(a.admin, `?date=${today}`);
      expect(admin.status).toBe(200);
      expect(admin.text).toContain("hasDayRate");
      const future = await sellThrough(a.owner, `?date=${tomorrow}`);
      expect(future.status).toBe(422);
      expect(future.error.code).toBe("date_in_future");
    });
  });

  describe("AT-P7: booked covers for the chef", () => {
    it("the chef sees no booking before one is made, then the covers of a booking typed by the waiter, as numbers only", async () => {
      const before = await covers(a.chef, `?date=${tomorrow}`);
      expect(before.status).toBe(200);
      expect(before.body.businessDate).toBe(tomorrow);
      expect(before.body.services.reduce((sum, s) => sum + s.covers, 0)).toBe(0);

      const made = await call<ReservationActionResult>(
        a.waiter,
        reservationsRoute.POST as Handler,
        "/api/reservations",
        {
          method: "POST",
          body: {
            date: tomorrow,
            time: "13:05",
            serviceKey: "pranzo",
            party: 6,
            name: "Cliente Telefono Demo",
            phone: "+39 000 0000004",
          },
        },
      );
      expect(made.status).toBe(201);
      expect(made.body.status).toBe("accepted");

      const after = await covers(a.chef, `?date=${tomorrow}`);
      expect(after.status).toBe(200);
      expect(after.body.services.find((s) => s.key === "pranzo")).toMatchObject({
        reservations: 1,
        covers: 6,
      });
      expect(after.text).not.toContain("Cliente");
      expect(after.text).not.toContain("0000004");
      expect(Object.keys(after.body).sort()).toEqual(["businessDate", "services"]);
      for (const service of after.body.services) {
        expect(Object.keys(service).sort()).toEqual(["covers", "key", "name", "reservations"]);
      }
      // The owner and the waiter read the same numbers.
      for (const user of [a.owner, a.admin, a.waiter]) {
        const read = await covers(user, `?date=${tomorrow}`);
        expect(read.status).toBe(200);
        expect(read.body.services.find((s) => s.key === "pranzo")?.covers).toBe(6);
      }
    });

    it("the chef still reads 0 rows from the reservation tables", async () => {
      for (const table of ["reservation", "reservation_contact"]) {
        const read = await a.chef.client.from(table).select("*");
        expect(read.error).toBeNull();
        expect(read.data).toEqual([]);
      }
    });

    it("a day too far ahead is a 422 date_out_of_range", async () => {
      const far = await covers(a.chef, `?date=${addDays(today, 30)}`);
      expect(far.status).toBe(422);
      expect(far.error.code).toBe("date_out_of_range");
    });
  });

  describe("the role rules", () => {
    it("the waiter gets 403 on every trace route and on the sell-through, with no data", async () => {
      const probes = [
        await searchLots(a.waiter, "?q=x"),
        await get(a.waiter, traceCaptureRoute.GET, "/api/trace/capture"),
        await lotTrace(a.waiter, lotId),
        await batchTrace(a.waiter, batchId),
        await get(a.waiter, traceLinesRoute.GET, `/api/trace/lines?date=${today}`),
        await get(a.waiter, traceLineRoute.GET, `/api/trace/lines/${keptLineId}`, keptLineId),
        await sellThrough(a.waiter),
      ];
      for (const probe of probes) {
        expect(probe.status).toBe(403);
        expect(probe.text).not.toContain(TRACE_NAMES.lotCode);
      }
    });
  });

  describe("AT-P9: tenancy", () => {
    it("owner B gets a 404 on A's lot, batch and plate, exactly like an unknown id", async () => {
      const unknown = randomUUID();
      const foreign = [
        [await lotTrace(b.owner, lotId), await lotTrace(b.owner, unknown)],
        [await batchTrace(b.owner, batchId), await batchTrace(b.owner, unknown)],
        [
          await get(b.owner, traceLineRoute.GET, `/api/trace/lines/${keptLineId}`, keptLineId),
          await get(b.owner, traceLineRoute.GET, `/api/trace/lines/${unknown}`, unknown),
        ],
      ] as const;
      for (const [theirs, nobody] of foreign) {
        expect(theirs.status).toBe(404);
        expect(theirs.body).toEqual(nobody.body);
      }
    });

    it("owner B's searches, capture rate, sell-through and covers hold none of A's data", async () => {
      const search = await searchLots(b.owner, `?q=${TRACE_NAMES.lotCode}`);
      expect(search.status).toBe(200);
      expect(search.body.lots).toEqual([]);
      const capture = await get<LotCapture>(b.owner, traceCaptureRoute.GET, "/api/trace/capture");
      expect(capture.body).toMatchObject({ lots: 0, withLotCode: 0, bySupplier: [] });
      const sold = await sellThrough(b.owner, `?date=${today}`);
      expect(sold.status).toBe(200);
      expect(sold.body.summary).toEqual({ pushes: 0, lines: 0, portions: 0 });
      const booked = await covers(b.owner, `?date=${tomorrow}`);
      expect(booked.body.services.reduce((sum, s) => sum + s.covers, 0)).toBe(0);
      for (const text of [search.text, capture.text, sold.text, booked.text]) {
        for (const id of [lotId, batchId, recipes.itemId, master.supplierId, keptLineId]) {
          expect(text).not.toContain(id);
        }
      }
    });
  });
});
