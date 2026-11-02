import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { parseCsvRecords } from "@/lib/csv/parse";
import { addDays, venueDate } from "@/lib/time/venue-date";
import type { BillOutput, CloseOutput } from "@/server/bill/output";
import { EXPORT_SLUGS, type ExportRole } from "@/server/exports/types";
import type { MonthlyPack } from "@/server/exports/pack-output";
import type { AddLineOutput, FireOutput } from "@/server/orders/output";
import type { AvtOutput, KpiReport } from "@/server/reports/output";
import type { TablesList } from "@/server/tables/output";
import { expectCsvMatchesJson, expectedRowCount } from "../helpers/csv-parity";
import { addDish, openSession } from "./helpers/closing";
import { EXPORT_NAMES, FORMULA_ITEM_BODY, sugoBatchBody, sugoRecipeBody } from "./helpers/exports";
import {
  closeWithLoss,
  produceOverusedBatch,
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

// M24 acceptance tests 1 to 4 against the real local stack (plan §5 step 12), over the real routes: the 11 CSV exports and the monthly pack, with the
// strict schemas, the role checks, the error mapping and every report function behind them. Only `createSupabaseServerClient` is replaced (as in the
// M14 to M23 suites), so each call carries the signed-in test user's own client. It builds on the M22 reports tenant (helpers/reports.ts): the secret key
// creates the supplier, the location and the ingredient only. Every date comes from `GET /api/tables` `businessDate`, never from the calendar, so
// the suite is stable at any hour, including 00:00 to 02:00 Rome time. A batch discard counts on the business day too (founder decision A5: the waste report and the
// discards report group batch movements by the business day of created_at, pgTAP 257), so the waste read is the business day itself and the discards report of
// the business day's ISO week has its row on the Sunday-to-Monday night as well.
// The server clock cannot be moved here: the day is not final, and the fixed-instant proofs (DST, the 00:30 count) are in the Vitest unit tests.
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
const discardRoute = await import("@/app/api/batches/[id]/discard/route");
const approveRoute = await import("@/app/api/invoices/[id]/approve/route");
const countsRoute = await import("@/app/api/counts/route");
const countLinesRoute = await import("@/app/api/counts/[id]/lines/route");
const countCloseRoute = await import("@/app/api/counts/[id]/close/route");
const kpisRoute = await import("@/app/api/reports/kpis/route");
const servicesRoute = await import("@/app/api/reports/services/route");
const itemsRoute = await import("@/app/api/reports/items/route");
const avtRoute = await import("@/app/api/reports/avt/route");
const unmappedRoute = await import("@/app/api/reports/unmapped-items/route");
const discardsRoute = await import("@/app/api/reports/discards-vs-push/route");
const pushListRoute = await import("@/app/api/reports/push-list/route");
const forecastRoute = await import("@/app/api/reports/forecast/route");
const wasteCostsRoute = await import("@/app/api/stock/waste-costs/route");
const varianceRoute = await import("@/app/api/reports/variance/route");
const varianceCostsRoute = await import("@/app/api/reports/variance-costs/route");
const reconciliationRoute = await import("@/app/api/reports/reconciliation/route");
const csvRoute = await import("@/app/api/exports/[file]/route");
const packRoute = await import("@/app/api/exports/monthly-pack/route");

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

interface CsvReply {
  status: number;
  text: string;
  bytes: Uint8Array;
  headers: Headers;
  records: string[][];
}

/** The JSON routes behind each export (count-variance has two). */
const JSON_ROUTES: Record<(typeof EXPORT_SLUGS)[number], { handler: Handler; path: string }[]> = {
  kpis: [{ handler: kpisRoute.GET as Handler, path: "/api/reports/kpis" }],
  items: [{ handler: itemsRoute.GET as Handler, path: "/api/reports/items" }],
  avt: [{ handler: avtRoute.GET as Handler, path: "/api/reports/avt" }],
  "unmapped-items": [
    { handler: unmappedRoute.GET as Handler, path: "/api/reports/unmapped-items" },
  ],
  "discards-vs-push": [
    { handler: discardsRoute.GET as Handler, path: "/api/reports/discards-vs-push" },
  ],
  "push-list": [{ handler: pushListRoute.GET as Handler, path: "/api/reports/push-list" }],
  forecast: [{ handler: forecastRoute.GET as Handler, path: "/api/reports/forecast" }],
  "forecast-plates": [{ handler: forecastRoute.GET as Handler, path: "/api/reports/forecast" }],
  "waste-costs": [{ handler: wasteCostsRoute.GET as Handler, path: "/api/stock/waste-costs" }],
  "count-variance": [
    { handler: varianceRoute.GET as Handler, path: "/api/reports/variance" },
    { handler: varianceCostsRoute.GET as Handler, path: "/api/reports/variance-costs" },
  ],
  reconciliation: [
    { handler: reconciliationRoute.GET as Handler, path: "/api/reports/reconciliation" },
  ],
  services: [{ handler: servicesRoute.GET as Handler, path: "/api/reports/services" }],
};

describe.skipIf(!env)("the CSV exports and the monthly pack on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let fixture: ReportsFixture;
  let closingCountId: string;
  let day: string;
  let month: string;
  let formulaItemId: string;
  const aIds: string[] = [];

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

  /** GET /api/exports/<slug>.csv as `user`: the status, the bytes (a BOM is only visible there), the text and the records. */
  async function csv(user: TestUser, slug: string, query = ""): Promise<CsvReply> {
    return asUser.store!.run(user.client, async () => {
      const response = await (csvRoute.GET as Handler)(
        new Request(`http://localhost:3000/api/exports/${slug}.csv${query}`),
        { params: Promise.resolve({ file: `${slug}.csv` }) },
      );
      const bytes = new Uint8Array(await response.clone().arrayBuffer());
      const text = await response.text();
      const isCsv = (response.headers.get("content-type") ?? "").startsWith("text/csv");
      return {
        status: response.status,
        text,
        bytes,
        headers: response.headers,
        records: isCsv ? parseCsvRecords(text).map((r) => r.cells) : [],
      };
    });
  }

  const pack = (user: TestUser, query = "") =>
    call<MonthlyPack>(user, packRoute.GET as Handler, `/api/exports/monthly-pack${query}`);
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
    createRecipe: (body) =>
      call(a.owner, recipesRoute.POST as Handler, "/api/recipes", {
        method: "POST",
        body,
      }) as Promise<{ status: number; body: { recipe: { key: string } } }>,
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
        { method: "POST", body: { type, locationId } },
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

  /** The query string each export takes in this suite (the same one goes to its JSON routes). */
  const query = (slug: (typeof EXPORT_SLUGS)[number], period: "day" | "month" = "day"): string => {
    switch (slug) {
      case "services":
        return `?period=day&date=${day}`;
      case "kpis":
      case "items":
        return period === "day" ? `?period=day&date=${day}` : `?period=month&date=${month}-01`;
      case "avt":
        return `?count=${closingCountId}`;
      case "unmapped-items":
      case "discards-vs-push":
        return `?week=${day}`;
      case "push-list":
        return "";
      case "forecast":
      case "forecast-plates":
        return `?date=${day}`;
      case "waste-costs":
        return `?from=${day}&to=${day}`;
      case "reconciliation":
        return `?from=${addDays(day, -1)}&to=${day}`;
      case "count-variance":
        return `?session=${closingCountId}`;
    }
  };

  /** What the JSON route(s) answer for a slug: one body, or { variance, costs } for the count variance. */
  async function jsonOf(user: TestUser, slug: (typeof EXPORT_SLUGS)[number], q: string) {
    const bodies: unknown[] = [];
    for (const route of JSON_ROUTES[slug]) {
      const reply = await call(user, route.handler, `${route.path}${q}`);
      expect(reply.status, `${slug} JSON`).toBe(200);
      bodies.push(reply.body);
    }
    return slug === "count-variance" ? { variance: bodies[0], costs: bodies[1] } : bodies[0];
  }

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    fixture = await seedReportsTenant(stack, a, calls);
    aIds.push(...Object.values(fixture.items), fixture.beefId, fixture.cellaId);

    // Table 1 and 2 as in the reports suite: sold and closed. Table 3 sells the item named "=1+1 (demo)" (T4: the name is accepted).
    const formula = await calls.createItem(FORMULA_ITEM_BODY);
    expect(formula.status).toBe(201);
    formulaItemId = formula.body.item.id;
    aIds.push(formulaItemId);
    const sales: Array<[string, string, number, string, number]> = [
      ["Tavolo 1 (demo)", fixture.items.stew, 1, "0201", 3],
      ["Tavolo 2 (demo)", fixture.items.acqua, 2, "0202", 2],
      ["Tavolo 3 (demo)", formulaItemId, 3, "0203", 1],
    ];
    for (const [name, item, position, receipt, covers] of sales) {
      const opened = await openSession(calls, a.waiter, name, position, covers);
      const line = await addDish(calls, a.waiter, opened.sessionId, item);
      expect((await calls.fire(a.waiter, opened.sessionId, [line])).status).toBe(200);
      const preview = await bill(a.waiter, opened.sessionId);
      expect(preview.status).toBe(200);
      expect(
        (await close(a.waiter, opened.sessionId, preview.body.billToken, receipt)).status,
      ).toBe(200);
    }

    await produceOverusedBatch(calls, fixture);
    closingCountId = await closeWithLoss(calls, fixture);

    // After the count (so its loss stays), a batch that falls due within a day, and a second one with a portion thrown away.
    const sugo = await calls.createRecipe(sugoRecipeBody(fixture));
    expect(sugo.status).toBe(201);
    const versionId = await calls.recipeVersionId(sugo.body.recipe.key);
    const live = await call<{ batchId: string }>(
      a.chef,
      batchesRoute.POST as Handler,
      "/api/batches",
      {
        method: "POST",
        body: sugoBatchBody(fixture, versionId),
      },
    );
    expect(live.status).toBe(201);
    const spoiled = await call<{ batchId: string }>(
      a.chef,
      batchesRoute.POST as Handler,
      "/api/batches",
      { method: "POST", body: sugoBatchBody(fixture, versionId) },
    );
    expect(spoiled.status).toBe(201);
    const thrown = await call(
      a.chef,
      discardRoute.POST as Handler,
      `/api/batches/${spoiled.body.batchId}/discard`,
      {
        method: "POST",
        body: { portions: 1, reason: "spoilage" },
        params: { id: spoiled.body.batchId },
      },
    );
    expect(thrown.status).toBe(201);

    // The business date the closes landed on, as the app shows it.
    day = (await call<TablesList>(a.owner, tablesRoute.GET as Handler, "/api/tables")).body
      .businessDate;
    month = day.slice(0, 7);

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
      { method: "POST", body: { name: "Tavolo B (demo)", position: 1 } },
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

  describe("AT1: the CSV equals the JSON of the same query (and T2: no value has more than four decimals)", () => {
    it.each(EXPORT_SLUGS)("%s as the owner", async (slug) => {
      const q = query(slug);
      const json = await jsonOf(a.owner, slug, q);
      const reply = await csv(a.owner, slug, q);
      expect(reply.status).toBe(200);
      expect(reply.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect([...reply.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(reply.headers.get("cache-control")).toBe("no-store");
      expect(reply.headers.get("content-disposition")).toMatch(
        new RegExp(`^attachment; filename="report-${slug}-[0-9_-]+\\.csv"$`),
      );
      const rows = expectCsvMatchesJson(reply.records, slug, "owner", json);
      expect(rows).toBe(expectedRowCount(slug, json));
      // Every number cell of the file is at most four decimals: nothing the database sent was cut.
      for (const line of reply.records.slice(1)) {
        for (const cellText of line) {
          if (/^-?\d+,\d+$/.test(cellText)) expect(cellText).toMatch(/^-?\d+,\d{1,4}$/);
        }
      }
    });

    it.each(["kpis", "items"] as const)("%s for the whole month", async (slug) => {
      const q = query(slug, "month");
      const json = await jsonOf(a.owner, slug, q);
      const reply = await csv(a.owner, slug, q);
      expect(reply.status).toBe(200);
      expectCsvMatchesJson(reply.records, slug, "owner", json);
    });

    it.each(["kpis", "items"] as const)("%s as the admin", async (slug) => {
      const q = query(slug);
      const json = await jsonOf(a.admin, slug, q);
      const reply = await csv(a.admin, slug, q);
      expect(reply.status).toBe(200);
      const role: ExportRole = "admin";
      expectCsvMatchesJson(reply.records, slug, role, json);
      if (slug === "items") {
        expect(reply.records[0]).toHaveLength(12);
        expect(reply.text).not.toMatch(/costo_fisso|margine_lordo|contributo/);
      }
    });

    it("the files of the seeded evening have rows where the evening has data", async () => {
      for (const slug of [
        "kpis",
        "items",
        "avt",
        "unmapped-items",
        "push-list",
        "waste-costs",
        "discards-vs-push",
        "count-variance",
      ] as const) {
        const reply = await csv(a.owner, slug, query(slug));
        expect(reply.records.length, slug).toBeGreaterThan(1);
      }
      expect((await csv(a.owner, "kpis", query("kpis"))).records).toHaveLength(55);
    });

    it("a file with no data is a header only, still a 200", async () => {
      const reply = await csv(b.owner, "push-list");
      expect(reply.status).toBe(200);
      expect(reply.records).toHaveLength(1);
    });

    it("errors stay JSON with the JSON route's status: a future day is a 422 date_in_future", async () => {
      const future = addDays(day, 30);
      const reply = await csv(a.owner, "kpis", `?period=day&date=${future}`);
      expect(reply.status).toBe(422);
      expect(reply.headers.get("content-type")).toMatch(/application\/json/);
      expect((JSON.parse(reply.text) as { error: { code: string } }).error.code).toBe(
        "date_in_future",
      );
    });
  });

  describe("AT2: a name starting with = is escaped in the real files (T4: the item was accepted)", () => {
    it('items.csv and unmapped-items.csv hold "\'=1+1 (demo)" and no bare formula', async () => {
      for (const slug of ["items", "unmapped-items"] as const) {
        const reply = await csv(a.owner, slug, query(slug));
        expect(reply.text, slug).toContain(`"'${EXPORT_NAMES.formulaItem}"`);
        expect(reply.text, slug).not.toMatch(/(^|;)=1\+1 \(demo\)/m);
        const row = reply.records.find((r) => r[0] === formulaItemId)!;
        expect(row[1], slug).toBe(`'${EXPORT_NAMES.formulaItem}`);
      }
    });
  });

  describe("AT4: the chef and the waiter get 403 on every export and on the pack", () => {
    it.each(EXPORT_SLUGS)("%s", async (slug) => {
      for (const user of [a.chef, a.waiter]) {
        const reply = await csv(user, slug, query(slug));
        expect(reply.status).toBe(403);
        expect(reply.headers.get("content-type")).toMatch(/application\/json/);
        expect(reply.text).not.toContain(formulaItemId);
      }
    });

    it("monthly-pack", async () => {
      for (const user of [a.chef, a.waiter]) {
        expect((await pack(user, `?month=${month}`)).status).toBe(403);
      }
    });
  });

  describe("tenancy", () => {
    it("owner B's files hold none of A's ids or names", async () => {
      for (const slug of ["items", "push-list", "kpis", "unmapped-items"] as const) {
        const reply = await csv(b.owner, slug, slug === "push-list" ? "" : query(slug));
        expect(reply.status, slug).toBe(200);
        for (const id of aIds) expect(reply.text, slug).not.toContain(id);
        expect(reply.text, slug).not.toContain(EXPORT_NAMES.formulaItem);
        expect(reply.text, slug).not.toContain(EXPORT_NAMES.sugo);
      }
    });

    it("owner B cannot export A's count: the session is a 404", async () => {
      const reply = await csv(b.owner, "count-variance", `?session=${closingCountId}`);
      expect(reply.status).toBe(404);
    });
  });

  describe("AT3 (data): the monthly pack is the services' replies for the month (T5)", () => {
    it("kpis deep-equal GET /api/reports/kpis for the month; waste deep-equals GET /api/stock/waste-costs", async () => {
      const read = await pack(a.owner, `?month=${month}`);
      expect(read.status).toBe(200);
      expect(read.body.month).toBe(month);
      const kpis = await call<KpiReport>(
        a.owner,
        kpisRoute.GET as Handler,
        `/api/reports/kpis?period=month&date=${month}-01`,
      );
      expect(read.body.kpis).toEqual(kpis.body);
      // T5: the month is the calendar month of the anchor.
      expect(read.body.from).toBe(`${month}-01`);
      expect(read.body.kpis.current.from).toBe(`${month}-01`);
      expect(read.body.kpis.current.to.slice(0, 7)).toBe(month);
      const waste = await call(
        a.owner,
        wasteCostsRoute.GET as Handler,
        `/api/stock/waste-costs?from=${read.body.from}&to=${read.body.to}`,
      );
      expect(read.body.waste).toEqual(waste.body);
      expect(read.body.waste.valueEur).toBe(read.body.kpis.current.waste.valueEur);
    });

    it("the previous and next month follow the KPI dates; a month still running has no next month", async () => {
      const read = await pack(a.owner, `?month=${month}`);
      expect(read.body.previousMonth).toBe(read.body.kpis.previous.from.slice(0, 7));
      expect(read.body.final).toBe(read.body.kpis.current.final);
      if (!read.body.final) expect(read.body.nextMonth).toBeNull();
      else expect(read.body.nextMonth).toBe(addDays(read.body.to, 1).slice(0, 7));
    });

    it("Scostamenti: ok with the seeded count when it was closed in the month, else noCount (computed from the reply's own closedAt)", async () => {
      const read = await pack(a.owner, `?month=${month}`);
      const latest = await call<AvtOutput>(a.owner, avtRoute.GET as Handler, "/api/reports/avt");
      const closedDay = venueDate(new Date(latest.body.count.closedAt));
      const inMonth = closedDay >= read.body.from && closedDay <= read.body.to;
      expect(read.body.variance.state).toBe(inMonth ? "ok" : "noCount");
      if (read.body.variance.state === "ok") {
        expect(read.body.variance.avt.count.id).toBe(closingCountId);
        expect(read.body.variance.avt.rows.length).toBeGreaterThan(0);
      }
    });

    it("without ?month= the pack answers for the month of yesterday's business day", async () => {
      const read = await pack(a.admin);
      expect(read.status).toBe(200);
      expect(read.body.month).toBe(read.body.from.slice(0, 7));
    });

    it("a month in the future is the KPI's 422 date_in_future", async () => {
      const next = addDays(`${month}-28`, 7).slice(0, 7);
      const read = await pack(a.owner, `?month=${next}`);
      expect(read.status).toBe(422);
      expect(read.error.code).toBe("date_in_future");
    });

    it("a malformed month is a 400", async () => {
      expect((await pack(a.owner, "?month=2026-13")).status).toBe(400);
    });

    it("owner B's pack holds none of A's figures", async () => {
      const read = await pack(b.owner, `?month=${month}`);
      expect(read.status).toBe(200);
      for (const id of aIds) expect(read.text).not.toContain(id);
      expect(read.body.kpis.current.covers).toBe(2);
    });
  });
});
