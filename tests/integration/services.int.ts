import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { BillOutput, CloseOutput } from "@/server/bill/output";
import type { AppVsRegister } from "@/server/day-close/output";
import type { AddLineOutput, FireOutput } from "@/server/orders/output";
import type { KpiReport } from "@/server/reports/output";
import type {
  DayServices,
  ServicePeriods,
  ServicesReport,
  SessionServiceReply,
} from "@/server/services/output";
import type { TablesList } from "@/server/tables/output";
import {
  addDish,
  openSession,
  seedClosingTenant,
  type ClosingCalls,
  type ClosingFixture,
} from "./helpers/closing";
import { byId, cents, otherChoice } from "./helpers/services";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";

// M25c acceptance tests against the real local stack (plan §5 step 16). Over the real routes: the services settings, the day split on the day close,
// the moves of a table, the report split and its agreement with the KPI report and the day close, the roles and the tenancy. Only
// `createSupabaseServerClient` is replaced (as in the M14 to M24 suites), so each call carries the signed-in test user's own client. The secret key creates
// the second waiter only. Tables open at the real clock, so NO test expects a time-derived key: the key of each table is read from /api/day-close/services
// and tables are moved by override. Every date comes from `GET /api/tables` `businessDate`, never from the calendar. Fake data only.
//
// The tests run in order and share state. Tenant A: the closing fixture and three closed tables. Tenant B: nothing but its owner. Throws in CI when the
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
const closeRoute = await import("@/app/api/table-sessions/[id]/close/route");
const settingsRoute = await import("@/app/api/settings/services/route");
const moveRoute = await import("@/app/api/table-sessions/[id]/service/route");
const dayRoute = await import("@/app/api/day-close/services/route");
const reportServicesRoute = await import("@/app/api/reports/services/route");
const kpisRoute = await import("@/app/api/reports/kpis/route");
const appVsRegisterRoute = await import("@/app/api/reports/app-vs-register/route");

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

describe.skipIf(!env)("the service periods on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let fixture: ClosingFixture;
  let day: string;
  const sessions: string[] = [];

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

  const getSettings = (user: TestUser, query = "") =>
    call<ServicePeriods>(user, settingsRoute.GET as Handler, `/api/settings/services${query}`);
  const putSettings = (user: TestUser, body: unknown) =>
    call<ServicePeriods & { changed: boolean }>(
      user,
      settingsRoute.PATCH as Handler,
      "/api/settings/services",
      { method: "PATCH", body },
    );
  const dayServices = (user: TestUser, date = day) =>
    call<DayServices>(user, dayRoute.GET as Handler, `/api/day-close/services?date=${date}`);
  const move = (user: TestUser, session: string, serviceKey: string | null) =>
    call<SessionServiceReply>(
      user,
      moveRoute.POST as Handler,
      `/api/table-sessions/${session}/service`,
      { method: "POST", body: { serviceKey }, params: { id: session } },
    );
  const servicesReport = (user: TestUser, date = day) =>
    call<ServicesReport>(
      user,
      reportServicesRoute.GET as Handler,
      `/api/reports/services?period=day&date=${date}`,
    );
  const kpis = (user: TestUser, date = day) =>
    call<KpiReport>(user, kpisRoute.GET as Handler, `/api/reports/kpis?period=day&date=${date}`);
  const appVsRegister = (user: TestUser, date = day) =>
    call<AppVsRegister>(
      user,
      appVsRegisterRoute.GET as Handler,
      `/api/reports/app-vs-register?date=${date}`,
    );
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
    const today = await call<TablesList>(a.owner, tablesRoute.GET as Handler, "/api/tables");
    expect(today.status).toBe(200);
    day = today.body.businessDate;

    // Three tables with one fired dish each, then closed with a receipt number.
    const dishes = [fixture.items.stew, fixture.items.tagliatelle, fixture.items.vino];
    for (const [index, item] of dishes.entries()) {
      const { sessionId } = await openSession(
        calls,
        a.waiter,
        `Tavolo ${index + 1} (demo)`,
        index + 1,
        index + 2,
      );
      const line = await addDish(calls, a.waiter, sessionId, item);
      expect((await calls.fire(a.waiter, sessionId, [line])).status).toBe(200);
      const preview = await bill(a.waiter, sessionId);
      expect(preview.status).toBe(200);
      const closed = await close(a.waiter, sessionId, preview.body.billToken, `010${index + 1}`);
      expect(closed.status).toBe(200);
      sessions.push(sessionId);
    }
  }, 300_000);

  describe("the settings", () => {
    it("start at the default: Pranzo from 11:00 and Cena from 16:00 to the cut-off", async () => {
      const read = await getSettings(a.owner);
      expect(read.status).toBe(200);
      expect(read.body.isDefault).toBe(true);
      expect(read.body.since).toBeNull();
      expect(read.body.periods.map((p) => [p.key, p.name, p.startsAt, p.endsAt])).toEqual([
        ["pranzo", "Pranzo", "11:00", "16:00"],
        ["cena", "Cena", "16:00", read.body.cutoff],
      ]);
    });

    it("the owner adds Aperitivo (changed true), the same list again changes nothing, and the default comes back", async () => {
      const first = await putSettings(a.owner, {
        periods: [
          { key: "pranzo", name: "Pranzo", startsAt: "11:00" },
          { key: null, name: "Aperitivo", startsAt: "18:00" },
          { key: "cena", name: "Cena", startsAt: "19:30" },
        ],
      });
      expect(first.status).toBe(200);
      expect(first.body.changed).toBe(true);
      expect(first.body.isDefault).toBe(false);
      expect(first.body.periods.map((p) => p.name)).toEqual(["Pranzo", "Aperitivo", "Cena"]);
      const aperitivo = first.body.periods[1]!;
      expect(aperitivo.key).toMatch(/^s_[0-9a-f]{10}$/);
      const again = await putSettings(a.admin, {
        periods: first.body.periods.map(({ key, name, startsAt }) => ({ key, name, startsAt })),
      });
      expect(again.status).toBe(200);
      expect(again.body.changed).toBe(false);
      // Back to the default hours, so the rest of the suite sees the two services (the saved versions stay: the ledger is append-only).
      const back = await putSettings(a.owner, {
        periods: [
          { key: "pranzo", name: "Pranzo", startsAt: "11:00" },
          { key: "cena", name: "Cena", startsAt: "16:00" },
        ],
      });
      expect(back.status).toBe(200);
      expect(back.body.changed).toBe(true);
      expect(back.body.periods.map((p) => p.key)).toEqual(["pranzo", "cena"]);
    });

    it("a bad list is a 400 before the database, a repeated start a 422 with the reason", async () => {
      const bad = await putSettings(a.owner, { periods: [] });
      expect(bad.status).toBe(400);
      const twice = await putSettings(a.owner, {
        periods: [
          { key: "pranzo", name: "Pranzo", startsAt: "11:00" },
          { key: "cena", name: "Cena", startsAt: "11:00" },
        ],
      });
      expect(twice.status).toBe(422);
      expect(twice.error.code).toBe("service_periods_invalid");
      expect(twice.error.details).toEqual({ reason: "start_twice" });
    });

    it("the chef and the waiter get 403 on both verbs; a query string is a 400", async () => {
      for (const user of [a.chef, a.waiter]) {
        expect((await getSettings(user)).status).toBe(403);
        expect(
          (await putSettings(user, { periods: [{ key: "cena", name: "Cena", startsAt: "16:00" }] }))
            .status,
        ).toBe(403);
      }
      expect((await getSettings(a.owner, "?x=1")).status).toBe(400);
    });
  });

  describe("the day split on the day close", () => {
    it("adds up to the day's app total, and each table's key is one of its choices", async () => {
      const split = await dayServices(a.owner);
      expect(split.status).toBe(200);
      const register = await appVsRegister(a.owner);
      expect(register.status).toBe(200);
      const total = split.body.services.reduce((sum, s) => sum + cents(s.totalEur), 0);
      expect(total).toBe(cents(register.body.app.total));
      expect(cents(split.body.total.totalEur)).toBe(cents(register.body.app.total));
      expect(split.body.sessions.map((s) => s.sessionId).sort()).toEqual([...sessions].sort());
      for (const session of split.body.sessions) {
        expect(session.choices).toContain(session.serviceKey);
        expect(session.source).toBe("auto");
      }
      expect(split.body.total.tables).toBe(3);
    });

    it("the admin reads the same split", async () => {
      const owner = await dayServices(a.owner);
      const admin = await dayServices(a.admin);
      expect(admin.status).toBe(200);
      expect(admin.body.services).toEqual(owner.body.services);
      expect(admin.body.total).toEqual(owner.body.total);
    });

    it("carries no staff name", async () => {
      const split = await dayServices(a.owner);
      expect(split.text).not.toMatch(/Titolare|Cameriere|Admin Demo|Chef Demo/);
      expect(split.text).not.toMatch(/"(createdBy|closedBy|openedBy|displayName)"/);
    });
  });

  describe("moving a table", () => {
    it("moves table 1 to another service: it moves, the day total does not, and the move is an override", async () => {
      const before = await dayServices(a.owner);
      const registerBefore = (await appVsRegister(a.owner)).body.app.total;
      const first = byId(before.body).get(sessions[0]!)!;
      const target = otherChoice(first);
      const moved = await move(a.owner, sessions[0]!, target);
      expect(moved.status).toBe(200);
      expect(moved.body.changed).toBe(true);
      expect(moved.body.session).toEqual({
        sessionId: sessions[0],
        serviceKey: target,
        source: "override",
      });
      const after = await dayServices(a.owner);
      const now = byId(after.body).get(sessions[0]!)!;
      expect(now.serviceKey).toBe(target);
      expect(now.source).toBe("override");
      expect(after.body.total).toEqual(before.body.total);
      // The variance is the day's and does not move with the table.
      expect((await appVsRegister(a.owner)).body.app.total).toBe(registerBefore);
    });

    it("the same request again changes nothing; null puts the table back to its automatic service", async () => {
      const mid = byId((await dayServices(a.owner)).body).get(sessions[0]!)!;
      const same = await move(a.admin, sessions[0]!, mid.serviceKey);
      expect(same.status).toBe(200);
      expect(same.body.changed).toBe(false);
      const back = await move(a.admin, sessions[0]!, null);
      expect(back.status).toBe(200);
      expect(back.body.changed).toBe(true);
      expect(back.body.session.source).toBe("auto");
      const now = byId((await dayServices(a.owner)).body).get(sessions[0]!)!;
      expect(now.source).toBe("auto");
    });

    it("a key that is not one of the table's choices is a 422; a malformed id a 404 without reaching the database", async () => {
      const unknown = await move(a.owner, sessions[0]!, "nessuno");
      expect(unknown.status).toBe(422);
      expect(unknown.error.code).toBe("service_unknown");
      const malformed = await move(a.owner, "not-a-uuid", "cena");
      expect(malformed.status).toBe(404);
      const missing = await move(a.owner, randomUUID(), "cena");
      expect(missing.status).toBe(404);
      expect(missing.error.code).toBe("session_not_found");
    });

    it("the chef and the waiter get 403", async () => {
      for (const user of [a.chef, a.waiter]) {
        expect((await move(user, sessions[0]!, "cena")).status).toBe(403);
        expect((await dayServices(user)).status).toBe(403);
      }
    });
  });

  describe("the report split", () => {
    it("the total equals the KPI report's current block for the shared keys, and the services add up", async () => {
      const split = await servicesReport(a.owner);
      const report = await kpis(a.owner);
      expect(split.status).toBe(200);
      expect(report.status).toBe(200);
      for (const key of [
        "covers",
        "tables",
        "revenueGrossEur",
        "revenueNetEur",
        "avgSpendPerCoverEur",
        "avgTicketEur",
        "plates",
        "foodCostEur",
        "foodCostPct",
        "costedRevenueNetEur",
        "costedSharePct",
      ] as const) {
        expect(split.body.total[key], key).toEqual(report.body.current[key]);
      }
      for (const key of ["covers", "tables", "plates"] as const) {
        expect(
          split.body.services.reduce((sum, s) => sum + s[key], 0),
          key,
        ).toBe(split.body.total[key]);
      }
      // Net revenue has 4 decimals: rounding each service to cents can be 1 cent off the total's rounding, so compare at x10 000.
      expect(
        split.body.services.reduce((sum, s) => sum + Math.round(s.revenueNetEur * 10_000), 0),
      ).toBe(Math.round(split.body.total.revenueNetEur * 10_000));
    });

    it("the admin gets the same report; the chef and the waiter 403; the query is the KPI report's (a bad period is a 400)", async () => {
      const owner = await servicesReport(a.owner);
      const admin = await servicesReport(a.admin);
      expect(admin.body.services).toEqual(owner.body.services);
      for (const user of [a.chef, a.waiter]) expect((await servicesReport(user)).status).toBe(403);
      const bad = await call(
        a.owner,
        reportServicesRoute.GET as Handler,
        "/api/reports/services?period=year",
      );
      expect(bad.status).toBe(400);
    });
  });

  describe("tenancy", () => {
    it("owner B sees none of A's tables and cannot move one", async () => {
      const theirs = await dayServices(b.owner);
      expect(theirs.status).toBe(200);
      for (const id of sessions) expect(theirs.text).not.toContain(id);
      expect(theirs.body.total.tables).toBe(0);
      const refused = await move(b.owner, sessions[0]!, "cena");
      expect(refused.status).toBe(404);
      expect(refused.error.code).toBe("session_not_found");
      const settings = await getSettings(b.owner);
      expect(settings.body.isDefault).toBe(true);
    });
  });
});
