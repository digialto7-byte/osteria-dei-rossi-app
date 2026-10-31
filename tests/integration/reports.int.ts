import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CloseOutput } from "@/server/bill/output";
import type { BillOutput } from "@/server/bill/output";
import type { DashboardOutput } from "@/server/dashboard/output";
import type { AddLineOutput, FireOutput } from "@/server/orders/output";
import type { AvtOutput, ItemsOutput, KpiReport, UnmappedOutput } from "@/server/reports/output";
import type { TablesList } from "@/server/tables/output";
import { addDish, buildAt2Table, openSession, type At2Lines } from "./helpers/closing";
import {
  closeWithLoss,
  produceOverusedBatch,
  REPORT_NAMES,
  seedReportsTenant,
  type ReportsCalls,
  type ReportsFixture,
} from "./helpers/reports";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";

// M22 acceptance tests 1, 2, 4, 5, 8 and 9 against the real local stack (plan §5 step 14), over the real routes: strict schemas, role checks, error
// mapping, kpi_report, kpi_items, avt_report, unmapped_items, record_dashboard_open, dashboard_summary, RLS. Only `createSupabaseServerClient` is
// replaced (as in the M14 to M21 suites), so each call carries the signed-in test user's own client. The secret key creates the supplier, the
// location and the ingredient only. The server clock cannot be moved here, so the sales land on today's business date and are NOT final (the rollup
// runs on past dates): AT3 and the fixed-instant proofs are in pgTAP 232 and 234 to 238. The numbers are worked out in helpers/reports.ts. Fake data only.
//
// The tests run in order and share state (the beforeAll builds one evening). Throws in CI when the stack settings are missing; skips on a developer machine.
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
const closeRoute = await import("@/app/api/table-sessions/[id]/close/route");
const recipesRoute = await import("@/app/api/recipes/route");
const proposalRoute = await import("@/app/api/batches/proposal/route");
const batchesRoute = await import("@/app/api/batches/route");
const approveRoute = await import("@/app/api/invoices/[id]/approve/route");
const countsRoute = await import("@/app/api/counts/route");
const countLinesRoute = await import("@/app/api/counts/[id]/lines/route");
const countCloseRoute = await import("@/app/api/counts/[id]/close/route");
const kpisRoute = await import("@/app/api/reports/kpis/route");
const itemsRoute = await import("@/app/api/reports/items/route");
const avtRoute = await import("@/app/api/reports/avt/route");
const unmappedRoute = await import("@/app/api/reports/unmapped-items/route");
const dashboardRoute = await import("@/app/api/dashboard/route");
const opensRoute = await import("@/app/api/dashboard/opens/route");

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

/** A fixed-cost, gross-margin or contribution key: the admin must never see one. */
const OWNER_ONLY_KEY = /"[A-Za-z]*(fixedCost|grossMargin|contribution)[A-Za-z]*":/;
const ten = (value: number) => Math.round(value * 10_000);

describe.skipIf(!env)("the KPI reports on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let fixture: ReportsFixture;
  let closingCountId: string;
  let day: string;

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

  const kpis = (user: TestUser, query = "") =>
    call<KpiReport>(user, kpisRoute.GET as Handler, `/api/reports/kpis${query}`);
  const items = (user: TestUser, query = "") =>
    call<ItemsOutput>(user, itemsRoute.GET as Handler, `/api/reports/items${query}`);
  const avt = (user: TestUser, query = "") =>
    call<AvtOutput>(user, avtRoute.GET as Handler, `/api/reports/avt${query}`);
  const unmapped = (user: TestUser, query = "") =>
    call<UnmappedOutput>(user, unmappedRoute.GET as Handler, `/api/reports/unmapped-items${query}`);
  const opens = (user: TestUser) =>
    call<{ isoWeek: string; opens: number }>(
      user,
      opensRoute.POST as Handler,
      "/api/dashboard/opens",
      {
        method: "POST",
        body: {},
      },
    );
  const dashboard = (user: TestUser) =>
    call<DashboardOutput>(user, dashboardRoute.GET as Handler, "/api/dashboard");
  const bill = (user: TestUser, session: string) =>
    call<BillOutput>(user, billRoute.GET as Handler, `/api/table-sessions/${session}/bill`, {
      params: { id: session },
    });
  const close = (user: TestUser, session: string, token: string, number: string) =>
    call<CloseOutput>(user, closeRoute.POST as Handler, `/api/table-sessions/${session}/close`, {
      method: "POST",
      body: {
        receiptType: "scontrino",
        receiptNumber: number,
        paymentType: "card",
        billToken: token,
      },
      params: { id: session },
    });

  const calls: ReportsCalls = {
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
    createRecipe: (body) =>
      call(a.owner, recipesRoute.POST as Handler, "/api/recipes", {
        method: "POST",
        body,
      }) as Promise<{
        status: number;
        body: { recipe: { key: string } };
      }>,
    recipeVersionId: async (key) =>
      (
        await call<{ recipe: { id: string } }>(
          a.chef,
          proposalRoute.GET as Handler,
          `/api/batches/proposal?recipeKey=${key}`,
        )
      ).body.recipe.id,
    approve: async (invoiceId, locationId) =>
      (
        await call(a.owner, approveRoute.POST as Handler, `/api/invoices/${invoiceId}/approve`, {
          method: "POST",
          body: { locationId },
          params: { id: invoiceId },
        })
      ).status,
    produce: (body) =>
      call(a.chef, batchesRoute.POST as Handler, "/api/batches", { method: "POST", body }),
    startCount: async (type, locationId) => {
      const started = await call<{ id: string }>(
        a.chef,
        countsRoute.POST as Handler,
        "/api/counts",
        {
          method: "POST",
          body: { type, locationId },
        },
      );
      return { status: started.status, id: started.body.id };
    },
    saveLines: (id, lines) =>
      call(a.chef, countLinesRoute.PUT as Handler, `/api/counts/${id}/lines`, {
        method: "PUT",
        body: { lines },
        params: { id },
      }),
    closeCount: (id) =>
      call(a.chef, countCloseRoute.POST as Handler, `/api/counts/${id}/close`, {
        method: "POST",
        body: {},
        params: { id },
      }),
  };

  let at2: At2Lines;
  let t1Session: string;
  let t2Session: string;

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    fixture = await seedReportsTenant(stack, a, calls);

    // Table 1 (the AT2 table, 3 covers) and table 2 (2 covers: one stew, two water), sold and closed.
    const first = await openSession(calls, a.waiter, "Tavolo 1 (demo)", 1, 3);
    t1Session = first.sessionId;
    at2 = await buildAt2Table(calls, a.waiter, t1Session, {
      waiter2: a.waiter,
      items: fixture.items,
    });
    const second = await openSession(calls, a.waiter, "Tavolo 2 (demo)", 2, 2);
    t2Session = second.sessionId;
    const stew = await addDish(calls, a.waiter, t2Session, fixture.items.stew);
    const water = await addDish(calls, a.waiter, t2Session, fixture.items.acqua, { qty: 2 });
    expect((await calls.fire(a.waiter, t2Session, [stew, water])).status).toBe(200);
    for (const [session, number] of [
      [t1Session, "0201"],
      [t2Session, "0202"],
    ] as const) {
      const preview = await bill(a.waiter, session);
      expect(preview.status).toBe(200);
      expect((await close(a.waiter, session, preview.body.billToken, number)).status).toBe(200);
    }

    await produceOverusedBatch(calls, fixture);
    closingCountId = await closeWithLoss(calls, fixture);

    // The business date the closes landed on, as the app shows it.
    day = (await call<TablesList>(a.owner, tablesRoute.GET as Handler, "/api/tables")).body
      .businessDate;

    // Tenant B: one closed table of its own, for the isolation checks.
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
        body: { name: "Tavolo B (demo)", position: 1 },
      },
    );
    const sessionB = randomUUID();
    expect(
      (
        await call(
          b.waiter,
          openRoute.POST as Handler,
          `/api/tables/${tableB.body.table.id}/open`,
          {
            method: "POST",
            body: { sessionId: sessionB, covers: 2 },
            params: { id: tableB.body.table.id },
          },
        )
      ).status,
    ).toBe(201);
    const lineB = await addDish(calls, b.waiter, sessionB, itemB.body.item.id);
    expect((await calls.fire(b.waiter, sessionB, [lineB])).status).toBe(200);
    const previewB = await bill(b.waiter, sessionB);
    expect((await close(b.waiter, sessionB, previewB.body.billToken, "0301")).status).toBe(200);
  }, 300_000);

  it("AT1 (live): the day's covers, revenue, plates and food cost are the hand-computed ones, and the day is not final", async () => {
    const read = await kpis(a.owner, `?period=day&date=${day}`);
    expect(read.status).toBe(200);
    const current = read.body.current;
    expect(current.final).toBe(false);
    expect([current.covers, current.tables]).toEqual([5, 2]);
    expect(current.revenueGrossEur).toBe(124);
    expect(current.copertoNetEur).toBeCloseTo(9.0909, 4);
    expect(current.revenueNetEur).toBeCloseTo(112.7272, 4);
    expect(current.plates).toBe(8);
    expect(current.foodCostEur).toBeCloseTo(8.4, 4);
    expect(current.costedRevenueNetEur).toBeCloseTo(44.5454, 4);
    expect(current.foodCostPct).toBeCloseTo(18.86, 2);
    expect(current.coversByWeekday.reduce((x, y) => x + y, 0)).toBe(5);
    expect(read.body.previous.covers).toBe(0);
    expect(read.body.delta.covers).toEqual({ abs: 5, pct: null });
  });

  it("AT2: the items report's food cost % is the KPI report's, from the JSON and from the item rows summed in ten-thousandths", async () => {
    const report = await kpis(a.owner, `?period=day&date=${day}`);
    const list = await items(a.owner, `?period=day&date=${day}`);
    expect(list.status).toBe(200);
    expect(list.body.totals.foodCostPct).toBe(report.body.current.foodCostPct);
    expect(list.body.totals.foodCostEur).toBe(report.body.current.foodCostEur);
    expect(list.body.totals.costedRevenueNetEur).toBe(report.body.current.costedRevenueNetEur);
    const food = list.body.rows.reduce((sum, row) => sum + ten(row.foodCostEur ?? 0), 0);
    const costed = list.body.rows.reduce((sum, row) => sum + ten(row.costedRevenueNetEur), 0);
    expect(food).toBe(ten(report.body.current.foodCostEur));
    expect(costed).toBe(ten(report.body.current.costedRevenueNetEur));
    expect(Math.round((food / costed) * 10_000) / 100).toBe(report.body.current.foodCostPct);
    const stew = list.body.rows.find((row) => row.name === REPORT_NAMES.stew)!;
    expect([stew.plates, stew.status]).toEqual([3.5, "costed"]);
    const wine = list.body.rows.find((row) => row.name === REPORT_NAMES.vino)!;
    expect([wine.status, wine.foodCostEur]).toEqual(["unmapped", null]);
    expect(list.body.totals.revenueNetEur + report.body.current.copertoNetEur).toBeCloseTo(
      report.body.current.revenueNetEur,
      4,
    );
  });

  it("the dashboard's yesterday tile is there for the owner and the admin, and comingSoon is the push list", async () => {
    for (const user of [a.owner, a.admin]) {
      const read = await dashboard(user);
      expect(read.status).toBe(200);
      expect(read.body.tiles.yesterday.href).toBe("/report");
      expect(read.body.comingSoon).toEqual(["pushList"]);
    }
  });

  it("the owner's rows carry the fixed-cost keys, the admin's do not", async () => {
    const owner = await items(a.owner, `?period=day&date=${day}`);
    expect(owner.body.role).toBe("owner");
    expect(owner.text).toMatch(OWNER_ONLY_KEY);
    const stew = (owner.body as Extract<ItemsOutput, { role: "owner" }>).rows.find(
      (row) => row.name === REPORT_NAMES.stew,
    )!;
    expect(stew.fixedCostReason).toBe("no_fixed_costs");
    const admin = await items(a.admin, `?period=day&date=${day}`);
    expect(admin.status).toBe(200);
    expect(admin.body.role).toBe("admin");
    expect(admin.text).not.toMatch(OWNER_ONLY_KEY);
  });

  it("AT4: the AVT variance of the beef is the hand value in euro (one batch over-using its input, one count loss)", async () => {
    const read = await avt(a.owner);
    expect(read.status).toBe(200);
    expect(read.body.count.id).toBe(closingCountId);
    expect(read.body.openingCount.id).toBe(fixture.openingCountId);
    const beef = read.body.rows.find((row) => row.name === REPORT_NAMES.beef)!;
    expect(beef.actualQty).toBeCloseTo(3.4, 4);
    expect(beef.theoreticalQty).toBeCloseTo(2.7, 4);
    expect(beef.varianceQty).toBeCloseTo(0.7, 4);
    expect(beef.unitCostEur).toBeCloseTo(12, 4);
    expect(beef.varianceEur).toBeCloseTo(8.4, 4);
    expect(read.body.totals.lossEur).toBeCloseTo(8.4, 4);
    expect(read.body.availableCounts.map((c) => c.id)).toEqual([
      closingCountId,
      fixture.openingCountId,
    ]);
    const explicit = await avt(a.admin, `?count=${closingCountId}`);
    expect(
      explicit.body.rows.find((row) => row.name === REPORT_NAMES.beef)!.varianceEur,
    ).toBeCloseTo(8.4, 4);
  });

  it("AT4: the first monthly count has no opening count (422), a foreign or unknown id is a 404", async () => {
    const first = await avt(a.owner, `?count=${fixture.openingCountId}`);
    expect(first.status).toBe(422);
    expect(first.error.code).toBe("avt_no_opening_count");
    expect((await avt(b.owner, `?count=${closingCountId}`)).status).toBe(404);
    expect((await avt(a.owner, `?count=${randomUUID()}`)).status).toBe(404);
  });

  it("AT5: the unmapped report lists the dishes sold without a recipe, and not the stew", async () => {
    const read = await unmapped(a.owner, `?week=${day}`);
    expect(read.status).toBe(200);
    expect(read.body.rows.map((row) => row.name)).toEqual([
      REPORT_NAMES.acqua,
      REPORT_NAMES.tagliatelle,
      REPORT_NAMES.vino,
    ]);
    expect(read.body.rows.map((row) => row.plates)).toEqual([2, 1.5, 1]);
    expect(read.body.totals).toEqual({ plates: 4.5, revenueGrossEur: 6 + 18.75 + 40.25 });
    expect(read.body.rows.every((row) => row.lastSoldOn === day)).toBe(true);
    expect((await unmapped(a.owner, `?week=2999-01-01`)).status).toBe(422);
  });

  it("AT9: the owner's opens count up by one for the week; the admin cannot post", async () => {
    const first = await opens(a.owner);
    expect(first.status).toBe(200);
    const second = await opens(a.owner);
    expect(second.status).toBe(200);
    expect(second.body.isoWeek).toBe(first.body.isoWeek);
    expect(second.body.opens).toBe(first.body.opens + 1);
    expect(new Date(`${first.body.isoWeek}T00:00:00Z`).getUTCDay()).toBe(1);
    expect((await opens(a.admin)).status).toBe(403);
    expect((await opens(b.owner)).body.opens).toBe(1);
    const stored = await stack.admin.from("dashboard_open").select("opens").eq("tenant_id", a.id);
    expect(stored.data).toHaveLength(1);
    expect(stored.data![0]!.opens).toBe(second.body.opens);
  });

  it("AT8: the chef and the waiter get 403 on every report route and on the opens", async () => {
    for (const user of [a.chef, a.waiter]) {
      expect((await kpis(user)).status).toBe(403);
      expect((await items(user)).status).toBe(403);
      expect((await avt(user)).status).toBe(403);
      expect((await unmapped(user)).status).toBe(403);
      expect((await opens(user)).status).toBe(403);
      expect((await dashboard(user)).status).toBe(403);
    }
  });

  it("tenancy: owner B sees none of A's figures or ids", async () => {
    const own = await kpis(b.owner, `?period=day&date=${day}`);
    expect(own.status).toBe(200);
    expect([own.body.current.covers, own.body.current.revenueGrossEur]).toEqual([2, 3]);
    const list = await items(b.owner, `?period=day&date=${day}`);
    const aIds = Object.values(fixture.items);
    for (const reply of [own, list, await unmapped(b.owner, `?week=${day}`)]) {
      for (const id of aIds) expect(reply.text).not.toContain(id);
      expect(reply.text).not.toContain(REPORT_NAMES.stew);
    }
    expect((await avt(b.owner)).status).toBe(404);
    expect(at2.stew2).toBeTruthy();
  });
});
