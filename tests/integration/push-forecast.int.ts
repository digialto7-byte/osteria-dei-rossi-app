import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, venueDate } from "@/lib/time/venue-date";
import type { ServiceMenu } from "@/server/menu/output";
import type { AddLineOutput } from "@/server/orders/output";
import type {
  DiscardsOutput,
  ForecastOutput,
  ManagerPushList,
  PushListOutput,
} from "@/server/push/output";
import type { DashboardOutput } from "@/server/dashboard/output";
import type { TableSession } from "@/server/tables/output";
import { NAMES, seedOrderTenant, type OrderFixture } from "./helpers/orders";
import { PUSH_NAMES, produceSugo, seedPushFixture, type PushFixture } from "./helpers/push";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";

// M23 acceptance tests 1, 2, 4, 6 and 7 (and the forecast and the role rules) against the real local stack (plan §5 step 13), over the real routes: strict
// schemas, role checks, error mapping, push_menu_item, push_list, forecast, discards_vs_push, dashboard_summary, menu_list, add_order_line, RLS. Only
// `createSupabaseServerClient` is replaced (as in the M14 to M22 suites), so each call carries the signed-in test user's own client. The secret key
// creates the Parmigiano ingredient only. The server clock cannot be moved here, so the sugo batches and the Parmigiano lots are made to fall due
// within a day of now (a 20-hour shelf life, an expiry tomorrow); the fixed-instant proofs (DST, the window edges, the averages of past weeks) are in
// pgTAP 249 to 256. A discard dated just after midnight can fall in a business week the report does not show yet: the suite assumes it does not run
// between 00:00 and 02:00 Rome time on a Monday. Fake data only.
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
const recipesRoute = await import("@/app/api/recipes/route");
const proposalRoute = await import("@/app/api/batches/proposal/route");
const batchesRoute = await import("@/app/api/batches/route");
const discardRoute = await import("@/app/api/batches/[id]/discard/route");
const wasteRoute = await import("@/app/api/stock/waste/route");
const menuRoute = await import("@/app/api/menu/route");
const menuItemsRoute = await import("@/app/api/menu/items/route");
const pushRoute = await import("@/app/api/menu/[id]/push/route");
const diningTablesRoute = await import("@/app/api/dining-tables/route");
const openRoute = await import("@/app/api/tables/[id]/open/route");
const linesRoute = await import("@/app/api/table-sessions/[id]/lines/route");
const fireRoute = await import("@/app/api/table-sessions/[id]/fire/route");
const pushListRoute = await import("@/app/api/reports/push-list/route");
const forecastRoute = await import("@/app/api/reports/forecast/route");
const discardsRoute = await import("@/app/api/reports/discards-vs-push/route");
const dashboardRoute = await import("@/app/api/dashboard/route");

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
// What a waiter may never see (project V6): costs, margins, GP, food cost, EUR-named values, recipe identity, VAT, and the M23 risk figure.
const WAITER_FORBIDDEN = /cost|risk|margin|gp|food|eur$|recipe|vat/i;
// What the chef may never see on the push list and the forecast: any euro, price or cover figure.
const CHEF_FORBIDDEN = /cost|price|eur|cover/i;

const today = venueDate(new Date());
const day = (offset: number) => addDays(today, offset);
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

describe.skipIf(!env)("push list, push today, forecast and discards on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let fa: OrderFixture;
  let fp: PushFixture;
  let sessionId: string;
  let liveBatchId: string;
  const lineIds: string[] = [];

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

  const pushList = (user: TestUser) =>
    call<PushListOutput>(user, pushListRoute.GET as Handler, "/api/reports/push-list");
  /** The owner's or admin's reply: the rows carry the cost at risk and the push prices. */
  const managerList = (user: TestUser) =>
    call<ManagerPushList>(user, pushListRoute.GET as Handler, "/api/reports/push-list");
  const forecast = (user: TestUser, query = "") =>
    call<ForecastOutput>(user, forecastRoute.GET as Handler, `/api/reports/forecast${query}`);
  const discards = (user: TestUser, query = "") =>
    call<DiscardsOutput>(
      user,
      discardsRoute.GET as Handler,
      `/api/reports/discards-vs-push${query}`,
    );
  const push = (user: TestUser, itemId: string, body: object) =>
    call<{ changed: boolean; item: { pushPrice: number | null; pushUntil: string | null } }>(
      user,
      pushRoute.POST as Handler,
      `/api/menu/${itemId}/push`,
      { method: "POST", body, params: { id: itemId } },
    );
  const menu = (user: TestUser) => call<ServiceMenu>(user, menuRoute.GET as Handler, "/api/menu");
  const addLine = (user: TestUser, body: object) =>
    call<AddLineOutput>(
      user,
      linesRoute.POST as Handler,
      `/api/table-sessions/${sessionId}/lines`,
      { method: "POST", body, params: { id: sessionId } },
    );
  const tap = (menuItemId: string, extra: object = {}) => ({
    lineId: randomUUID(),
    menuItemId,
    clientUpdatedAt: at(-60_000),
    ...extra,
  });

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;

    const calls = {
      createRecipe: (body: object) =>
        call(a.owner, recipesRoute.POST as Handler, "/api/recipes", {
          method: "POST",
          body,
        }) as Promise<{ status: number; body: { recipe: { key: string } } }>,
      approve: async (invoiceId: string, locationId: string) =>
        (
          await call(a.owner, approveRoute.POST as Handler, `/api/invoices/${invoiceId}/approve`, {
            method: "POST",
            body: { locationId },
            params: { id: invoiceId },
          })
        ).status,
      day,
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
      wasteLot: async (body: object) =>
        (
          await call(a.chef, wasteRoute.POST as Handler, "/api/stock/waste", {
            method: "POST",
            body,
          })
        ).status,
    };
    fa = await seedOrderTenant(stack, a, calls);
    fp = await seedPushFixture(stack, a, fa, calls);

    // A table and a session for the waiter; the second tenant gets nothing but its owner and an empty list.
    const table = await call<{ table: { id: string } }>(
      a.owner,
      diningTablesRoute.POST as Handler,
      "/api/dining-tables",
      { method: "POST", body: { name: "Tavolo 1 (demo)", position: 1 } },
    );
    expect(table.status).toBe(201);
    sessionId = randomUUID();
    const opened = await call<{ created: boolean; session: TableSession }>(
      a.waiter,
      openRoute.POST as Handler,
      `/api/tables/${table.body.table.id}/open`,
      { method: "POST", body: { sessionId, covers: 2 }, params: { id: table.body.table.id } },
    );
    expect(opened.status).toBe(201);

    // The sugo batch of 2 portions is sold out through the order APIs (2 pasta, fired); then a second batch of 5 portions is made.
    const sold = await addLine(a.waiter, tap(fp.pastaItemId, { qty: 2 }));
    expect(sold.status).toBe(201);
    const fired = await call(
      a.waiter,
      fireRoute.POST as Handler,
      `/api/table-sessions/${sessionId}/fire`,
      {
        method: "POST",
        body: { lineIds: [sold.body.line.id] },
        params: { id: sessionId },
      },
    );
    expect(fired.status).toBe(200);
    liveBatchId = await produceSugo(
      fp,
      fa,
      {
        produce: (body) =>
          call(a.chef, batchesRoute.POST as Handler, "/api/batches", {
            method: "POST",
            body,
          }) as Promise<{
            status: number;
            body: { batchId: string; lotCode: string; portions: number };
          }>,
      },
      1,
    );
  }, 300_000);

  describe("AT1, AT2, AT3: the push list", () => {
    it("AT1: a batch sold to 0 portions and a lot wasted to 0 kg are absent; the live batch and lot are there", async () => {
      const list = await pushList(a.owner);
      expect(list.status).toBe(200);
      const ids = list.body.rows.map((row) => row.id);
      expect(ids).not.toContain(fp.soldBatchId);
      expect(ids).not.toContain(fp.lotFullId);
      expect(ids).toContain(liveBatchId);
      expect(ids).toContain(fp.lotLiveId);
      // The stew (72 h) and the ragù (48 h) batches are outside the 24-hour window.
      expect(ids).not.toContain(fa.stewBatchId);
      expect(ids).not.toContain(fa.raguBatchId);
    });

    it("AT2: the batch row has its name, portions and cost at risk = portions x the frozen cost of the batch", async () => {
      const row = (await managerList(a.owner)).body.rows.find((r) => r.id === liveBatchId)!;
      expect(row).toMatchObject({
        kind: "batch",
        name: PUSH_NAMES.sugo,
        quantity: 5,
        unit: "porz",
      });
      const listed = await call<{
        items: { batchId: string; cost?: { perPortionEur: number | null } }[];
      }>(a.owner, batchesRoute.GET as Handler, "/api/batches");
      const perPortion = listed.body.items.find((item) => item.batchId === liveBatchId)!.cost!
        .perPortionEur!;
      expect(perPortion).toBeGreaterThan(0);
      expect(row.costAtRiskEur).toBeCloseTo(5 * perPortion, 4);
      expect(row.plates.map((p) => p.name)).toEqual([PUSH_NAMES.pasta]);
      expect(row.plates[0]).toMatchObject({ pushed: false });
    });

    it("the lot row: the Parmigiano, 1,96 kg left (the two fired pasta took 0,04 kg) at its receipt cost, used by the pasta", async () => {
      const row = (await managerList(a.owner)).body.rows.find((r) => r.id === fp.lotLiveId)!;
      expect(row).toMatchObject({ kind: "lot", name: PUSH_NAMES.parmigiano, unit: "kg" });
      expect(row.quantity).toBeCloseTo(1.96, 3);
      expect(row.costAtRiskEur).toBeCloseTo(1.96 * 20, 2);
      expect(row.plates.map((p) => p.name)).toEqual([PUSH_NAMES.pasta]);
    });

    it("AT3: the rows run from the least time left to the most", async () => {
      const hours = (await pushList(a.owner)).body.rows.map((row) => row.hoursToUseBy);
      expect(hours).toEqual([...hours].sort((x, y) => x - y));
      expect(hours.length).toBeGreaterThanOrEqual(2);
    });

    it("the chef reads the same rows with no euro, price or cover key; the waiter gets 403", async () => {
      const owner = await pushList(a.owner);
      const chef = await pushList(a.chef);
      expect(chef.status).toBe(200);
      expect(chef.body.rows.map((r) => r.id)).toEqual(owner.body.rows.map((r) => r.id));
      expect(keysOf(chef.body).filter((key) => CHEF_FORBIDDEN.test(key))).toEqual([]);
      expect((await pushList(a.waiter)).status).toBe(403);
    });

    it("the admin reads the owner's keys", async () => {
      const admin = await pushList(a.admin);
      expect(admin.status).toBe(200);
      expect(admin.body.role).toBe("admin");
      expect(admin.text).toContain("costAtRiskEur");
    });
  });

  describe("AT4, AT6: push today", () => {
    it("the owner pushes the pasta at 4,50: the waiter's menu pins it first with that price", async () => {
      const pushed = await push(a.owner, fp.pastaItemId, { pushed: true, pushPrice: 4.5 });
      expect(pushed.status).toBe(200);
      expect(pushed.body.changed).toBe(true);
      expect(pushed.body.item.pushPrice).toBe(4.5);
      expect(pushed.body.item.pushUntil).not.toBeNull();
      const reply = await menu(a.waiter);
      expect(reply.status).toBe(200);
      expect(reply.body.pinned[0]).toMatchObject({
        id: fp.pastaItemId,
        pushed: true,
        pushPrice: 4.5,
      });
    });

    it("AT6: the waiter's menu has no cost or risk key anywhere", async () => {
      const reply = await menu(a.waiter);
      expect(keysOf(reply.body).filter((key) => WAITER_FORBIDDEN.test(key))).toEqual([]);
    });

    it("a waiter's line on the pushed dish is charged 4,50", async () => {
      const line = await addLine(a.waiter, tap(fp.pastaItemId));
      expect(line.status).toBe(201);
      expect(line.body.line.unitPrice).toBe(4.5);
      lineIds.push(line.body.line.id);
    });

    it("the push list shows the plate as pushed, with its price for the owner and without it for the chef", async () => {
      const owner = (await managerList(a.owner)).body.rows.find((r) => r.id === liveBatchId)!;
      expect(owner.plates[0]).toMatchObject({ pushed: true, pushPrice: 4.5 });
      const chef = (await pushList(a.chef)).body.rows.find((r) => r.id === liveBatchId)!;
      expect(chef.plates[0]).toMatchObject({ pushed: true });
      expect(chef.plates[0]).not.toHaveProperty("pushPrice");
    });

    it("the same push again changes nothing; a price above the menu price is a 422", async () => {
      const again = await push(a.owner, fp.pastaItemId, { pushed: true, pushPrice: 4.5 });
      expect([again.status, again.body.changed]).toEqual([200, false]);
      const above = await push(a.owner, fp.pastaItemId, { pushed: true, pushPrice: 9.5 });
      expect(above.status).toBe(422);
      expect(above.error.code).toBe("push_price_above_menu");
      const invalid = await push(a.owner, fp.pastaItemId, { pushed: true, pushPrice: 0 });
      expect(invalid.status).toBe(400);
    });

    it("the dashboard's push list tile counts the rows for the owner and the admin", async () => {
      for (const user of [a.owner, a.admin]) {
        const read = await call<DashboardOutput>(
          user,
          dashboardRoute.GET as Handler,
          "/api/dashboard",
        );
        expect(read.status).toBe(200);
        expect(read.body.tiles.pushList.href).toBe("/spingere");
        expect(read.body.tiles.pushList.count).toBeGreaterThanOrEqual(2);
        expect(read.body.tiles.pushList.items.map((i) => i.id)).toContain(liveBatchId);
      }
      expect((await call(a.chef, dashboardRoute.GET as Handler, "/api/dashboard")).status).toBe(
        403,
      );
    });
  });

  describe("AT7: discards against push", () => {
    it("a batch discarded after a push of its plate is listed as pushed", async () => {
      const thrown = await call(
        a.chef,
        discardRoute.POST as Handler,
        `/api/batches/${liveBatchId}/discard`,
        {
          method: "POST",
          body: { portions: 1, reason: "spoilage" },
          params: { id: liveBatchId },
        },
      );
      expect(thrown.status).toBe(201);
      const report = await discards(a.owner);
      expect(report.status).toBe(200);
      const row = report.body.rows.find((r) => r.name === PUSH_NAMES.sugo)!;
      expect(row).toMatchObject({
        batchesDiscarded: 1,
        batchesPushed: 1,
        portionsDiscarded: 1,
        portionsPushed: 1,
        shelfLifeHours: 20,
      });
      expect(row.valueEur).toBeGreaterThan(0);
      expect(report.body.totals.batchesPushed).toBeGreaterThanOrEqual(1);
    });

    it("the admin reads it; the chef and the waiter get 403; a future week is a 422", async () => {
      expect((await discards(a.admin)).status).toBe(200);
      expect((await discards(a.chef)).status).toBe(403);
      expect((await discards(a.waiter)).status).toBe(403);
      const future = await discards(a.owner, `?week=${day(30)}`);
      expect(future.status).toBe(422);
      expect(future.error.code).toBe("date_in_future");
    });
  });

  describe("the stop, the forecast and the role rules", () => {
    it("'Togli' stops the push: the waiter's menu pins nothing, and the price is back", async () => {
      const stopped = await push(a.owner, fp.pastaItemId, { pushed: false });
      expect([stopped.status, stopped.body.changed]).toEqual([200, true]);
      const reply = await menu(a.waiter);
      expect(reply.body.pinned).toEqual([]);
      const stoppedAgain = await push(a.owner, fp.pastaItemId, { pushed: false });
      expect(stoppedAgain.body.changed).toBe(false);
    });

    it("the forecast: the chef has no covers, the owner has; on-hand portions are the live ones; no history yet", async () => {
      const chef = await forecast(a.chef);
      expect(chef.status).toBe(200);
      expect(chef.body.role).toBe("chef");
      expect(chef.text).not.toContain("covers");
      const row = chef.body.batches.find((r) => r.recipeKey === fp.sugoKey)!;
      // 5 made, 1 discarded; the draft pasta line reserves nothing.
      expect(row.onHandPortions).toBe(4);
      expect(chef.body.weeksUsed).toBe(0);
      expect(row.expectedPortions).toBeNull();
      const owner = await forecast(a.owner);
      expect(owner.status).toBe(200);
      expect(owner.body).toHaveProperty("covers.expected", null);
      expect((await forecast(a.admin)).status).toBe(200);
      expect((await forecast(a.waiter)).status).toBe(403);
    });

    it("the forecast date window: a week ahead is a 422, tomorrow is fine", async () => {
      const tomorrow = ((await forecast(a.chef)).body as { tomorrow: string }).tomorrow;
      expect((await forecast(a.chef, `?date=${tomorrow}`)).status).toBe(200);
      const far = await forecast(a.chef, `?date=${day(8)}`);
      expect(far.status).toBe(422);
      expect(far.error.code).toBe("date_out_of_range");
    });

    it("the chef and the waiter cannot push", async () => {
      for (const user of [a.chef, a.waiter]) {
        const refused = await push(user, fp.pastaItemId, { pushed: true });
        expect(refused.status).toBe(403);
      }
      const read = await menu(a.waiter);
      expect(read.body.pinned).toEqual([]);
    });
  });

  describe("tenancy", () => {
    it("owner B's push list, forecast and discards hold none of A's ids", async () => {
      const ids = [
        liveBatchId,
        fp.soldBatchId,
        fp.lotLiveId,
        fp.pastaItemId,
        fp.sugoKey,
        fa.items.stew,
      ];
      for (const reply of [
        await pushList(b.owner),
        await forecast(b.owner),
        await discards(b.owner),
      ]) {
        expect(reply.status).toBe(200);
        for (const id of ids) expect(reply.text).not.toContain(id);
      }
      expect((await pushList(b.owner)).body.rows).toEqual([]);
    });

    it("owner B pushing A's item is a 404, and nothing changed for A", async () => {
      const refused = await push(b.owner, fp.pastaItemId, { pushed: true });
      expect(refused.status).toBe(404);
      const read = await menu(a.waiter);
      expect(read.body.pinned).toEqual([]);
    });

    it("the names are the fixture's (sanity: the order fixture is the one of M18)", () => {
      expect(NAMES.stew).toBe("Spezzatino con polenta (demo)");
    });
  });
});
