import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, venueDate } from "@/lib/time/venue-date";
import type { AlertList } from "@/server/alerts/list";
import type { PlatesResponse } from "@/server/costing/plates";
import {
  adminDashboardSchema,
  dashboardOutput,
  ownerDashboardSchema,
  type AdminDashboard,
  type OwnerDashboard,
} from "@/server/dashboard/output";
import type { PayableListResult } from "@/server/payables/types";
import { TODAY_ALERT_CAP } from "@/server/today/constants";
import { EXPECTED, seedDashboard } from "./helpers/dashboard";
import { seedLocation, seedSupplier } from "./helpers/invoices";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";

// Owner dashboard plan §5 step 13 against the real local stack. The route handlers run for real (withApi, the role check,
// dashboard_summary(), RLS, today_counts()); only `createSupabaseServerClient` is replaced, because it would read cookies
// from a Next.js request: each call is handed the signed-in test user's own client. Fixtures are the costing imports and
// four purchases approved through the approve route (helpers/dashboard.ts); the secret key is used only to write the
// invoices in review and the minimum of one ingredient, never by the code under test. Fake data only.
//
// The tests run in order and share state. Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const importIngredientsRoute = await import("@/app/api/admin/import/ingredients/route");
const importRecipesRoute = await import("@/app/api/admin/import/recipes/route");
const ingredientsRoute = await import("@/app/api/ingredients/route");
const approveRoute = await import("@/app/api/invoices/[id]/approve/route");
const wasteRoute = await import("@/app/api/stock/waste/route");
const fixedRoute = await import("@/app/api/fixed-costs/route");
const platesRoute = await import("@/app/api/costs/plates/route");
const payablesRoute = await import("@/app/api/payables/route");
const alertsRoute = await import("@/app/api/alerts/route");
const dashboardRoute = await import("@/app/api/dashboard/route");
const todayRoute = await import("@/app/api/today/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  text: string;
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
  return { status: response.status, body: JSON.parse(text) as T, text };
}

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/costing/${name}`, import.meta.url), "utf8");

const today = venueDate(new Date());
const day = (offset: number) => addDays(today, offset);
const FORBIDDEN_FOR_ADMIN = /fixed|rent|labour|utilit|perPlate/i;
const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : value !== null && typeof value === "object"
      ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
      : [];

describe.skipIf(!env)("owner dashboard on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  const ingredientIds = new Map<string, string>();

  const getDashboard = (user: TestUser, query = "") =>
    call(user, dashboardRoute.GET as Handler, `/api/dashboard${query}`);
  const getOwner = async (user: TestUser = a.owner) => {
    const reply = await getDashboard(user);
    expect(reply.status).toBe(200);
    return reply.body as unknown as OwnerDashboard;
  };

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    const supplierId = await seedSupplier(stack.admin, a.id);
    const locationId = await seedLocation(stack.admin, a.id);

    const imported = await call(
      a.admin,
      importIngredientsRoute.POST as Handler,
      "/api/admin/import/ingredients",
      { method: "POST", body: { format: "csv", csv: fixture("ingredienti-costi-demo.csv") } },
    );
    expect(imported.status).toBe(200);
    const recipes = await call(
      a.admin,
      importRecipesRoute.POST as Handler,
      "/api/admin/import/recipes",
      { method: "POST", body: { format: "csv", csv: fixture("ricette-costi-demo.csv") } },
    );
    expect(recipes.status).toBe(200);
    const listed = await call<{ ingredients: { id: string; name: string }[] }>(
      a.owner,
      ingredientsRoute.GET as Handler,
      "/api/ingredients",
    );
    for (const ingredient of listed.body.ingredients)
      ingredientIds.set(ingredient.name, ingredient.id);

    await seedDashboard(
      { db: stack.admin, tenantId: a.id, supplierId, locationId, ingredientIds },
      {
        day,
        approve: async (invoiceId, location) =>
          (
            await call(
              a.owner,
              approveRoute.POST as Handler,
              `/api/invoices/${invoiceId}/approve`,
              {
                method: "POST",
                body: { locationId: location },
                params: { id: invoiceId },
              },
            )
          ).status,
        waste: async (body) =>
          (
            await call(a.owner, wasteRoute.POST as Handler, "/api/stock/waste", {
              method: "POST",
              body,
            })
          ).status,
        enterFixedCosts: async (body) =>
          (
            await call(a.owner, fixedRoute.POST as Handler, "/api/fixed-costs", {
              method: "POST",
              body,
            })
          ).status,
      },
    );
  }, 240_000);

  describe("the owner", () => {
    it("gets 200 and a body that validates against the owner schema", async () => {
      const reply = await getDashboard(a.owner);
      expect(reply.status).toBe(200);
      expect(ownerDashboardSchema.safeParse(reply.body).success).toBe(true);
      expect(dashboardOutput.safeParse(reply.body).success).toBe(true);
    });

    it("payables: overdue and due soon equal the arithmetic of the seed", async () => {
      const { tiles } = await getOwner();
      expect(tiles.payables.dueSoonDays).toBe(7);
      expect(tiles.payables.overdue).toEqual(EXPECTED.payables.overdue);
      expect(tiles.payables.dueSoon).toEqual(EXPECTED.payables.dueSoon);
      expect(tiles.payables.items.map((item) => item.overdue)).toEqual([true, true, false]);
    });

    it("stock at risk: one below its minimum, one lot expiring tomorrow, and batches as today_counts says", async () => {
      const body = await getOwner();
      const { belowMin, expiringLots, expiringBatches } = body.tiles.stockAtRisk;
      expect(belowMin.items.map((item) => item.name)).toEqual(EXPECTED.belowMinNames);
      expect(belowMin.count).toBe(EXPECTED.belowMinNames.length);
      expect(expiringLots.items.map((item) => item.lotCode)).toEqual(EXPECTED.expiringLotCodes);
      expect(expiringLots.items[0]).toMatchObject({ state: "due_soon", expiry: day(1) });
      const batchesCard = body.today.cards.find((card) => card.key === "batchesUseBy");
      expect(expiringBatches.count).toBe(batchesCard?.count);
    });

    it("waste: the ISO week of today, Monday to Sunday, with the one waste of the seed", async () => {
      const { waste } = (await getOwner()).tiles;
      expect(waste).toMatchObject({
        valueEur: EXPECTED.waste.valueEur,
        rawValueEur: EXPECTED.waste.rawValueEur,
        batchValueEur: EXPECTED.waste.batchValueEur,
        unvaluedCount: EXPECTED.waste.unvaluedCount,
      });
      expect(waste.reasons).toEqual([
        { reasonCode: EXPECTED.waste.reason, valueEur: EXPECTED.waste.valueEur },
      ]);
      expect(new Date(`${waste.from}T00:00:00Z`).getUTCDay()).toBe(1);
      expect(waste.to).toBe(addDays(waste.from, 6));
      expect(waste.from <= today && today <= waste.to).toBe(true);
    });

    it("fixed costs: the month's total, nothing allocated before sales", async () => {
      const { fixedCosts } = (await getOwner()).tiles;
      expect(fixedCosts).toMatchObject({
        monthlyTotalEur: EXPECTED.fixedCosts.monthlyTotalEur,
        perPlateEur: EXPECTED.fixedCosts.perPlateEur,
        reason: EXPECTED.fixedCosts.reason,
      });
    });

    it("food cost and the worst plates equal what the plates API says, recomputed here", async () => {
      const dashboard = await getOwner();
      const plates = await call<PlatesResponse>(
        a.owner,
        platesRoute.GET as Handler,
        "/api/costs/plates",
      );
      expect(plates.status).toBe(200);
      const complete = plates.body.plates.filter((plate) => plate.status !== "incomplete");
      const incomplete = plates.body.plates.filter((plate) => plate.status === "incomplete");
      const food = complete.reduce((sum, plate) => sum + (plate.foodCostEur ?? 0), 0);
      const price = complete.reduce((sum, plate) => sum + (plate.salePriceExVatEur ?? 0), 0);

      expect(dashboard.tiles.foodCost.platesCounted).toBe(complete.length);
      expect(dashboard.tiles.foodCost.platesIncomplete).toBe(incomplete.length);
      if (complete.length === 0) expect(dashboard.tiles.foodCost.overallPct).toBeNull();
      else expect(dashboard.tiles.foodCost.overallPct).toBeCloseTo((food / price) * 100, 1);

      const gap = (plate: (typeof complete)[number]) =>
        plate.targetGpPct === null ? null : (plate.gpPct ?? 0) - plate.targetGpPct;
      const ranked = [...complete].sort((x, y) => {
        const gx = gap(x);
        const gy = gap(y);
        if ((gx === null) !== (gy === null)) return gx === null ? 1 : -1;
        const byGap = (gx ?? x.gpPct ?? 0) - (gy ?? y.gpPct ?? 0);
        if (Math.abs(byGap) > 1e-9) return byGap;
        return x.name < y.name ? -1 : x.name > y.name ? 1 : 0;
      });
      expect(dashboard.tiles.plates.worst.map((plate) => plate.recipeKey)).toEqual(
        ranked.slice(0, 5).map((plate) => plate.recipeKey),
      );
      expect(dashboard.tiles.plates.incompleteCount).toBe(incomplete.length);
    });

    it("no plate key carries a fixed, full or net cost, even for the owner", async () => {
      const reply = await getDashboard(a.owner);
      const keys = keysOf((reply.body as { tiles: { plates: unknown } }).tiles.plates);
      expect(keys.filter((key) => /fixed|full|net|margin|cost(?!Pct)/i.test(key))).toEqual([]);
    });
  });

  describe("the admin", () => {
    it("gets 200, the admin schema, and no fixed-cost, price-variance or today-list tile", async () => {
      const reply = await getDashboard(a.admin);
      expect(reply.status).toBe(200);
      expect(adminDashboardSchema.safeParse(reply.body).success).toBe(true);
      const body = reply.body as unknown as AdminDashboard;
      const tiles = Object.keys(body.tiles);
      for (const key of ["fixedCosts", "priceVariance", "todayLists"]) {
        expect(tiles).not.toContain(key);
      }
      expect(tiles.sort()).toEqual(["foodCost", "payables", "plates", "stockAtRisk", "waste"]);
      expect(keysOf(reply.body).filter((key) => FORBIDDEN_FOR_ADMIN.test(key))).toEqual([]);
    });

    it("sees the same figures as the owner for the tiles they share", async () => {
      const owner = await getOwner();
      const admin = (await getDashboard(a.admin)).body as unknown as AdminDashboard;
      for (const key of ["foodCost", "plates", "payables", "stockAtRisk", "waste"] as const) {
        expect(admin.tiles[key]).toEqual(owner.tiles[key]);
      }
    });
  });

  describe("who is refused", () => {
    it("the chef and the waiter get 403", async () => {
      expect((await getDashboard(a.chef)).status).toBe(403);
      expect((await getDashboard(a.waiter)).status).toBe(403);
    });

    it("a query string is a 400", async () => {
      expect((await getDashboard(a.owner, "?x=1")).status).toBe(400);
    });
  });

  describe("coexistence with /api/today", () => {
    const getToday = (user: TestUser) => call(user, todayRoute.GET as Handler, "/api/today");

    it("the owner's today block equals GET /api/today's body", async () => {
      const dashboard = await getOwner();
      const today_ = await getToday(a.owner);
      expect(today_.status).toBe(200);
      expect(dashboard.today).toEqual(today_.body);
    });

    it("the admin's today block equals GET /api/today's body", async () => {
      const dashboard = (await getDashboard(a.admin)).body as unknown as AdminDashboard;
      const today_ = await getToday(a.admin);
      expect(today_.status).toBe(200);
      expect(dashboard.today).toEqual(today_.body);
    });

    it("the alerts card counts the open alerts /api/alerts returns, up to the cap", async () => {
      const dashboard = await getOwner();
      const open = await call<AlertList>(
        a.owner,
        alertsRoute.GET as Handler,
        "/api/alerts?filter=open",
      );
      expect(open.status).toBe(200);
      const card = dashboard.today.cards.find((c) => c.key === "alerts");
      expect(card?.count).toBe(Math.min(open.body.alerts.length, TODAY_ALERT_CAP));
    });
  });

  describe("tenancy", () => {
    it("owner B sees none of A's figures, names or payable ids", async () => {
      const bBody = await getDashboard(b.owner);
      expect(bBody.status).toBe(200);
      const fromB = bBody.body as unknown as OwnerDashboard;
      expect(fromB.tiles.payables.overdue).toEqual({ count: 0, amountEur: 0 });
      expect(fromB.tiles.payables.dueSoon).toEqual({ count: 0, amountEur: 0 });
      expect(fromB.tiles.fixedCosts.monthlyTotalEur).toBeNull();

      const aPayables = await call<PayableListResult>(
        a.owner,
        payablesRoute.GET as Handler,
        "/api/payables",
      );
      expect(aPayables.body.payables.length).toBeGreaterThan(0);
      for (const payable of aPayables.body.payables) expect(bBody.text).not.toContain(payable.id);
      for (const name of ["Burro (demo)", "Manzo muscolo (demo)", "L-DASH"]) {
        expect(bBody.text).not.toContain(name);
      }
    });
  });
});
