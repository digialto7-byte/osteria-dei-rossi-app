import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, venueDate } from "@/lib/time/venue-date";
import type { AlertList } from "@/server/alerts/list";
import type { CostCheckResponse } from "@/server/costing/cost-check-run";
import type { IngredientCostsResponse } from "@/server/costing/ingredients";
import type { PlatesResponse } from "@/server/costing/plates";
import type {
  CostSettings,
  FixedCostPeriod,
  PlateCost,
  PlateMarginPct,
  RecipeCost,
} from "@/server/costing/types";
import type { RecipeSummary } from "@/server/recipes/detail";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";
import {
  seedLocation,
  seedReviewInvoice,
  seedSupplier,
  type ReviewLineSeed,
} from "./helpers/invoices";

// M8 acceptance tests 1 to 9 and V6 (chef: percentages only; waiter: nothing) against the real
// local stack. The route handlers run for real (schemas, role checks, error mapping, the cost
// functions, approve_invoice with the variance check, RLS); only `createSupabaseServerClient` is
// replaced, because it would read cookies from a Next.js request: each call is handed the signed-in
// test user's own client (publishable key + that user's JWT).
//
// Fixtures: invoices in review are written with the local secret key (test code only, see
// helpers/invoices.ts) and approved through POST /api/invoices/:id/approve; ingredients and recipes
// are imported through the M1 and M7 routes. Every read of an RLS table goes through a user session,
// never the secret key. Names are fake ("(demo)"), prices invented (plan §3.10).
//
// The tests run in order and share state: tenant A holds the data, tenant B must see none of it.
// Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const importIngredientsRoute = await import("@/app/api/admin/import/ingredients/route");
const importRecipesRoute = await import("@/app/api/admin/import/recipes/route");
const ingredientsRoute = await import("@/app/api/ingredients/route");
const recipesRoute = await import("@/app/api/recipes/route");
const approveRoute = await import("@/app/api/invoices/[id]/approve/route");
const recipeCostRoute = await import("@/app/api/recipes/[key]/cost/route");
const platesRoute = await import("@/app/api/costs/plates/route");
const percentagesRoute = await import("@/app/api/costs/plates/percentages/route");
const costIngredientsRoute = await import("@/app/api/costs/ingredients/route");
const basisRoute = await import("@/app/api/ingredients/[id]/cost-basis/route");
const settingsRoute = await import("@/app/api/settings/route");
const fixedRoute = await import("@/app/api/fixed-costs/route");
const checkRoute = await import("@/app/api/admin/cost-check/route");
const alertsRoute = await import("@/app/api/alerts/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  error: { code: string; message: string; details?: Record<string, string | number>[] };
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
  const body = (await response.json()) as T;
  return {
    status: response.status,
    body,
    error: (body as { error?: Reply["error"] }).error as Reply["error"],
  };
}

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/costing/${name}`, import.meta.url), "utf8");

const today = venueDate(new Date());
const day = (offset: number) => addDays(today, offset);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!env)("food cost on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let supplierId: string;
  const ingredientIds = new Map<string, string>();
  const keys = new Map<string, string>();

  const key = (name: string) => keys.get(name)!;
  const getCost = (user: TestUser, name: string, query = "") =>
    call<{ cost: RecipeCost }>(
      user,
      recipeCostRoute.GET as Handler,
      `/api/recipes/${key(name)}/cost${query}`,
      { params: { key: key(name) } },
    );
  const getPlates = (user: TestUser, query = "") =>
    call<PlatesResponse>(user, platesRoute.GET as Handler, `/api/costs/plates${query}`);
  const plateOf = (body: PlatesResponse, name: string): PlateCost =>
    body.plates.find((plate) => plate.name === name)!;
  const getIngredientCosts = (user: TestUser, query = "") =>
    call<IngredientCostsResponse>(
      user,
      costIngredientsRoute.GET as Handler,
      `/api/costs/ingredients${query}`,
    );
  const getPercentages = (user: TestUser) =>
    call<{ plates: PlateMarginPct[] }>(
      user,
      percentagesRoute.GET as Handler,
      "/api/costs/plates/percentages",
    );
  const getAlerts = (user: TestUser) =>
    call<AlertList>(user, alertsRoute.GET as Handler, "/api/alerts");
  const priceAlerts = async (user: TestUser) =>
    (await getAlerts(user)).body.alerts.filter((alert) => alert.kind === "price_variance");

  /** Seeds an invoice dated `date` and approves it as owner A; returns the approve reply status. */
  async function buyAndApprove(date: string, lines: [name: string, qty: number, price: number][]) {
    const seeds: ReviewLineSeed[] = lines.map(([name, qty, unitPrice]) => ({
      description: name,
      ingredientId: ingredientIds.get(name)!,
      qty,
      unit: name === "Pane (demo)" ? "pz" : "kg",
      unitPrice,
    }));
    const id = await seedReviewInvoice(stack.admin, a.id, { supplierId, date, lines: seeds });
    const reply = await call(a.owner, approveRoute.POST as Handler, `/api/invoices/${id}/approve`, {
      method: "POST",
      body: {},
      params: { id },
    });
    return reply.status;
  }

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    supplierId = await seedSupplier(stack.admin, a.id);
    await seedLocation(stack.admin, a.id);

    const imported = await call(
      a.admin,
      importIngredientsRoute.POST as Handler,
      "/api/admin/import/ingredients",
      { method: "POST", body: { format: "csv", csv: fixture("ingredienti-costi-demo.csv") } },
    );
    expect(imported.status).toBe(200);
    const listed = await call<{ ingredients: { id: string; name: string }[] }>(
      a.owner,
      ingredientsRoute.GET as Handler,
      "/api/ingredients",
    );
    for (const ingredient of listed.body.ingredients)
      ingredientIds.set(ingredient.name, ingredient.id);

    const recipes = await call(
      a.admin,
      importRecipesRoute.POST as Handler,
      "/api/admin/import/recipes",
      { method: "POST", body: { format: "csv", csv: fixture("ricette-costi-demo.csv") } },
    );
    expect(recipes.status).toBe(200);
    const created = await call<{ recipes: RecipeSummary[] }>(
      a.owner,
      recipesRoute.GET as Handler,
      "/api/recipes",
    );
    for (const recipe of created.body.recipes) keys.set(recipe.name, recipe.key);

    // Three beef purchases at 10,00 EUR/kg, plus the other prices (first purchases raise no alert).
    expect(
      await buyAndApprove(day(-30), [
        ["Manzo muscolo (demo)", 20, 10],
        ["Farina di mais (demo)", 10, 1.5],
        ["Pane (demo)", 100, 0.3],
        ["Prova (demo)", 5, 10],
        ["Burro (demo)", 2, 10],
      ]),
    ).toBe(200);
    expect(await buyAndApprove(day(-20), [["Manzo muscolo (demo)", 20, 10]])).toBe(200);
    expect(await buyAndApprove(day(-10), [["Manzo muscolo (demo)", 20, 10]])).toBe(200);
  }, 180_000);

  describe("AT1 and AT2: yield, sub-recipes, batch per portion, plate", () => {
    it("a yield of 0,82 raises the cost per usable kg to price / 0,82", async () => {
      const { status, body } = await getCost(a.owner, "Manzo pulito (demo)");
      expect(status).toBe(200);
      expect(body.cost).toMatchObject({
        type: "sub",
        costUnit: "kg",
        unitCostEur: 12.1951,
        incomplete: false,
      });
      expect(body.cost.lines[0]).toMatchObject({
        yieldFactor: 0.82,
        unitCostEur: 10,
        lineCostEur: 12.1951,
        target: { kind: "ingredient", name: "Manzo muscolo (demo)" },
      });
    });

    it("the batch costs per portion, the sub per kg, the plate adds its parts", async () => {
      const stew = (await getCost(a.owner, "Spezzatino (demo)")).body.cost;
      expect(stew).toMatchObject({ totalCostEur: 50, unitCostEur: 1.6667, costUnit: "porz" });
      const polenta = (await getCost(a.owner, "Polenta (demo)")).body.cost;
      expect(polenta).toMatchObject({ unitCostEur: 0.45, costUnit: "kg" });
      const plate = (await getCost(a.owner, "Spezzatino con polenta (demo)")).body.cost;
      expect(plate).toMatchObject({ type: "plate", totalCostEur: 2.0567 });
      expect(plate.plate).toMatchObject({
        foodCostEur: 2.0567,
        salePriceEur: 12,
        vatPct: 10,
        salePriceExVatEur: 10.9091,
        grossMarginEur: 8.8524,
        foodCostPct: 18.85,
        gpPct: 81.15,
        targetGpPct: 70,
      });
    });
  });

  describe("AT6 and AT8: fixed cost not allocated, below target, incomplete", () => {
    it("before any fixed cost is entered the owner is told so; food cost % is shown anyway", async () => {
      const { body } = await getPlates(a.owner);
      expect(body.fixedCost).toMatchObject({ reason: "no_fixed_costs", perPlateEur: null });
      const plate = plateOf(body, "Spezzatino con polenta (demo)");
      expect(plate).toMatchObject({
        status: "fixed_cost_unallocated",
        fixedCostEur: null,
        fullCostEur: null,
        netMarginEur: null,
        fixedCostAllocated: false,
        foodCostPct: 18.85,
      });
    });

    it("the owner enters the month; a repeat is not a second entry; with no sales nothing is allocated", async () => {
      const month = today.slice(0, 7);
      const entry = { month, rentEur: 3000, labourEur: 9000, utilitiesEur: 1500 };
      const first = await call<{ period: FixedCostPeriod }>(
        a.owner,
        fixedRoute.POST as Handler,
        "/api/fixed-costs",
        { method: "POST", body: entry },
      );
      expect(first.status).toBe(201);
      expect(first.body.period).toMatchObject({ month: `${month}-01`, totalEur: 13500 });
      const again = await call(a.owner, fixedRoute.POST as Handler, "/api/fixed-costs", {
        method: "POST",
        body: entry,
      });
      expect(again.status).toBe(200);

      const listed = await call<{ periods: FixedCostPeriod[] }>(
        a.owner,
        fixedRoute.GET as Handler,
        "/api/fixed-costs",
      );
      expect(listed.body.periods).toHaveLength(1);
      expect(listed.body.periods[0]).toMatchObject({ inForce: true, superseded: false });

      const { body } = await getPlates(a.owner);
      expect(body.fixedCost).toMatchObject({
        reason: "no_sales",
        monthlyTotalEur: 13500,
        platesSold: 0,
        perPlateEur: null,
      });
      expect(plateOf(body, "Spezzatino con polenta (demo)")).toMatchObject({
        status: "fixed_cost_unallocated",
        foodCostPct: 18.85,
        gpPct: 81.15,
      });
    });

    it("a target of 85 % is below target, and a plate with an unpriced ingredient is incomplete", async () => {
      const { body } = await getPlates(a.owner);
      expect(plateOf(body, "Spezzatino al vino (demo)")).toMatchObject({
        status: "below_target",
        targetGpPct: 85,
      });
      const salt = plateOf(body, "Polenta e sale (demo)");
      expect(salt).toMatchObject({ status: "incomplete", foodCostEur: null, foodCostPct: null });
      expect(salt.missingIngredients.map((item) => item.name)).toEqual(["Sale grosso (demo)"]);
    });

    it("the admin sees no fixed-cost field and never the fixed_cost_unallocated status", async () => {
      const { status, body } = await getPlates(a.admin);
      expect(status).toBe(200);
      expect(body.fixedCost).toBeNull();
      for (const plate of body.plates) {
        expect(plate.fixedCostEur).toBeNull();
        expect(plate.fullCostEur).toBeNull();
        expect(plate.netMarginEur).toBeNull();
        expect(plate.fixedCostAllocated).toBeNull();
        expect(plate.status).not.toBe("fixed_cost_unallocated");
      }
      expect(plateOf(body, "Spezzatino con polenta (demo)")).toMatchObject({
        status: "ok",
        foodCostPct: 18.85,
        grossMarginEur: 8.8524,
      });
      const one = await getCost(a.admin, "Spezzatino con polenta (demo)");
      expect(one.body.cost.plate).toMatchObject({ fixedCostEur: null, fixedCostAllocated: null });
    });

    it("fixed costs are owner only: the admin gets 403 on read and write, with no entry made", async () => {
      expect((await call(a.admin, fixedRoute.GET as Handler, "/api/fixed-costs")).status).toBe(403);
      const write = await call(a.admin, fixedRoute.POST as Handler, "/api/fixed-costs", {
        method: "POST",
        body: { month: today.slice(0, 7), rentEur: 1, labourEur: 1, utilitiesEur: 1 },
      });
      expect(write.status).toBe(403);
      const rows = await a.owner.client.from("fixed_cost_period").select("id");
      expect(rows.data).toHaveLength(1);
      // Defence in depth: the database refuses the admin too.
      const direct = await a.admin.client.rpc("fixed_cost_status", { p_date: null });
      expect(direct.error?.code).toBe("42501");
      const hidden = await a.admin.client.from("fixed_cost_period").select("id");
      expect(hidden.data).toEqual([]);
    });
  });

  describe("AT4 and AT5: a new price is visible at once and raises one owner alert", () => {
    it("a +9 % purchase raises no alert", async () => {
      expect(await buyAndApprove(day(-5), [["Burro (demo)", 2, 10.9]])).toBe(200);
      expect(await priceAlerts(a.owner)).toEqual([]);
    });

    it("approving beef at 13,00 changes every cost on the very next read, within 5 seconds", async () => {
      expect(await buyAndApprove(day(0), [["Manzo muscolo (demo)", 20, 13]])).toBe(200);
      const started = Date.now();
      let reads = 0;
      let stew: RecipeCost | undefined;
      do {
        reads += 1;
        stew = (await getCost(a.owner, "Spezzatino (demo)")).body.cost;
        if (stew.totalCostEur === 55) break;
        await sleep(250);
      } while (Date.now() - started < 5000);
      const plates = (await getPlates(a.owner)).body;
      const elapsed = Date.now() - started;
      expect(stew.totalCostEur).toBe(55);
      expect(stew.unitCostEur).toBe(1.8333);
      expect(plateOf(plates, "Spezzatino con polenta (demo)").foodCostEur).toBe(2.2233);
      // Derived on read: the first read is already fresh (the polling above only reports the time).
      expect(reads).toBe(1);
      expect(elapsed).toBeLessThan(5000);
    });

    it("the owner reads one price alert naming the ingredient and the change", async () => {
      const alerts = await priceAlerts(a.owner);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.title).toMatch(/^Prezzo cambiato: Manzo muscolo \(demo\) \+30,0\s%$/);
      expect(alerts[0]!.body).toContain("Ricette coinvolte: 4");
      expect(alerts[0]!.body).toContain("Spezzatino con polenta (demo)");
    });

    it("the admin cannot read alerts (403) and the chef's list holds no price alert", async () => {
      expect((await getAlerts(a.admin)).status).toBe(403);
      expect(await priceAlerts(a.chef)).toEqual([]);
      expect(await priceAlerts(b.owner)).toEqual([]);
    });
  });

  describe("AT3 and AT7: the cost basis and costs as of a date", () => {
    it("the moving average of the last 3 purchases is used; the last price and the maximum are shown", async () => {
      const { body } = await getIngredientCosts(a.owner);
      expect(body.avgCostN).toBe(3);
      const beef = body.ingredients.find((item) => item.name === "Manzo muscolo (demo)")!;
      expect(beef).toMatchObject({
        basis: "moving_average",
        unitCostEur: 11,
        avgEur: 11,
        lastEur: 13,
        maxEur: 13,
        purchasesUsed: 3,
        lastPurchaseOn: today,
      });
      const salt = body.ingredients.find((item) => item.name === "Sale grosso (demo)")!;
      expect(salt).toMatchObject({ unitCostEur: null, purchasesUsed: 0 });
    });

    it("switching to the last price changes the cost, and switching back restores it", async () => {
      const beef = ingredientIds.get("Manzo muscolo (demo)")!;
      const put = (basis: string) =>
        call<{ ingredientId: string; basis: string }>(
          a.admin,
          basisRoute.PUT as Handler,
          `/api/ingredients/${beef}/cost-basis`,
          { method: "PUT", body: { basis }, params: { id: beef } },
        );
      const last = await put("last_price");
      expect(last.status).toBe(200);
      expect(last.body).toMatchObject({ ingredientId: beef, basis: "last_price" });
      expect((await getCost(a.owner, "Spezzatino (demo)")).body.cost.totalCostEur).toBe(65);
      expect((await put("moving_average")).status).toBe(200);
      expect((await getCost(a.owner, "Spezzatino (demo)")).body.cost.totalCostEur).toBe(55);
    });

    it("a date before the last purchase uses the older average", async () => {
      const { body } = await getIngredientCosts(a.owner, `?at=${day(-1)}`);
      const beef = body.ingredients.find((item) => item.name === "Manzo muscolo (demo)")!;
      expect(body.at).toBe(day(-1));
      expect(beef).toMatchObject({ unitCostEur: 10, lastEur: 10, maxEur: 10 });
    });

    it("a recipe did not exist before its first version; a future date is refused", async () => {
      const old = await getCost(a.owner, "Spezzatino (demo)", `?at=${day(-1)}`);
      expect(old.status).toBe(404);
      expect(old.error.code).toBe("recipe_not_in_force");
      const future = await getCost(a.owner, "Spezzatino (demo)", `?at=${day(2)}`);
      expect(future.status).toBe(422);
      expect(future.error.code).toBe("date_in_future");
      expect((await getPlates(a.owner, `?at=${day(2)}`)).status).toBe(422);
    });
  });

  describe("AT9: the chef's sheet against the app", () => {
    it("the admin posts the demo sheet and gets the plates more than 5 % off", async () => {
      const { status, body } = await call<CostCheckResponse>(
        a.admin,
        checkRoute.POST as Handler,
        "/api/admin/cost-check",
        { method: "POST", body: { format: "csv", csv: fixture("foglio-chef-demo.csv") } },
      );
      expect(status).toBe(200);
      expect(body.compared).toBe(4);
      expect(
        body.listed.map((item) => [item.name, item.appEur, item.sheetEur, item.diffPct]),
      ).toEqual([
        ["Tagliata (demo)", 10.6, 10, 6],
        ["Ragù (demo)", 9.4, 10, -6],
      ]);
      expect(body.withinTolerance).toBe(2);
      expect(body.unmatched.map((item) => item.name)).toEqual(["Piatto fantasma (demo)"]);
      expect(body.duplicates).toHaveLength(2);
    });

    it("a sheet with a formula cell is refused by row, without echoing it", async () => {
      const refused = await call(a.owner, checkRoute.POST as Handler, "/api/admin/cost-check", {
        method: "POST",
        body: { format: "csv", csv: "piatto;costo_cibo\nTagliata (demo);=1+1\n" },
      });
      expect(refused.status).toBe(422);
      expect(refused.error.code).toBe("import_invalid");
      expect(JSON.stringify(refused.body)).not.toContain("1+1");
    });
  });

  describe("settings", () => {
    it("owner and admin read the defaults; a change is audited by the database and a bad value is a 422", async () => {
      const read = await call<CostSettings>(a.owner, settingsRoute.GET as Handler, "/api/settings");
      expect(read.body).toEqual({ avgCostN: 3, priceVariancePct: 10, saleVatPct: 10 });
      const changed = await call<CostSettings>(
        a.admin,
        settingsRoute.PATCH as Handler,
        "/api/settings",
        { method: "PATCH", body: { priceVariancePct: 5 } },
      );
      expect(changed.status).toBe(200);
      expect(changed.body.priceVariancePct).toBe(5);
      const bad = await call(a.owner, settingsRoute.PATCH as Handler, "/api/settings", {
        method: "PATCH",
        body: { avgCostN: 11 },
      });
      expect(bad.status).toBe(422);
      expect(bad.error.code).toBe("settings_invalid");
      expect(bad.error.details).toEqual([{ field: "avgCostN", code: "out_of_range" }]);
      const reset = await call<CostSettings>(
        a.owner,
        settingsRoute.PATCH as Handler,
        "/api/settings",
        { method: "PATCH", body: { priceVariancePct: 10 } },
      );
      expect(reset.body.priceVariancePct).toBe(10);
    });
  });

  describe("V6: the chef reads percentages only, the waiter nothing", () => {
    it("the cost tables hold rows for the owner and none for the chef or the waiter", async () => {
      for (const table of ["price_history", "fixed_cost_period", "ingredient_cost_basis"]) {
        const owner = await a.owner.client.from(table).select("*");
        expect(owner.error, `owner reads ${table}`).toBeNull();
        expect(owner.data!.length, `owner rows in ${table}`).toBeGreaterThan(0);
      }
      for (const user of [a.chef, a.waiter]) {
        for (const table of [
          "price_history",
          "fixed_cost_period",
          "ingredient_cost_basis",
          "supplier_item",
        ]) {
          const read = await user.client.from(table).select("*");
          expect(read.error, `${user.role} reads ${table}`).toBeNull();
          expect(read.data, `${user.role} rows in ${table}`).toEqual([]);
        }
      }
    });

    it("every euro function and the cost view refuse the chef and the waiter", async () => {
      for (const user of [a.chef, a.waiter]) {
        const calls = [
          user.client.rpc("recipe_cost_at", { p_key: key("Spezzatino (demo)"), p_date: null }),
          user.client.rpc("plate_costs", { p_date: null }),
          user.client.rpc("ingredient_costs", { p_date: null }),
          user.client.rpc("fixed_cost_status", { p_date: null }),
          user.client.rpc("cost_settings"),
          user.client.from("v_recipe_cost").select("*"),
        ];
        for (const result of await Promise.all(calls)) {
          expect(result.error?.code, user.role).toBe("42501");
        }
      }
      const waiterPct = await a.waiter.client.rpc("plate_margins_pct");
      expect(waiterPct.error?.code).toBe("42501");
    });

    it("the chef's percentages carry exactly six keys per plate and no euro", async () => {
      const { status, body } = await getPercentages(a.chef);
      expect(status).toBe(200);
      expect(body.plates.length).toBeGreaterThanOrEqual(7);
      for (const item of body.plates) {
        expect(Object.keys(item).sort()).toEqual(
          ["foodCostPct", "gpPct", "name", "recipeKey", "status", "targetGpPct"].sort(),
        );
        expect(item.status).not.toBe("fixed_cost_unallocated");
      }
      const json = JSON.stringify(body);
      expect(json).not.toContain("€");
      expect(json).not.toMatch(/"[A-Za-z_]*(eur|price|margin)"/i);
      const stew = body.plates.find((item) => item.name === "Spezzatino con polenta (demo)")!;
      expect(stew).toMatchObject({ status: "ok", targetGpPct: 70 });
      expect(stew.foodCostPct).toBeGreaterThan(0);
      expect(body.plates.find((item) => item.name === "Polenta e sale (demo)")).toMatchObject({
        status: "incomplete",
        foodCostPct: null,
      });
      expect(body.plates.find((item) => item.name === "Spezzatino al vino (demo)")!.status).toBe(
        "below_target",
      );
    });

    it("the euro routes answer 403 to the chef and to the waiter; the waiter cannot read percentages either", async () => {
      const name = "Spezzatino (demo)";
      for (const user of [a.chef, a.waiter]) {
        expect((await getCost(user, name)).status, user.role).toBe(403);
        expect((await getPlates(user)).status, user.role).toBe(403);
        expect((await getIngredientCosts(user)).status, user.role).toBe(403);
        expect(
          (await call(user, settingsRoute.GET as Handler, "/api/settings")).status,
          user.role,
        ).toBe(403);
        expect(
          (await call(user, fixedRoute.GET as Handler, "/api/fixed-costs")).status,
          user.role,
        ).toBe(403);
        expect(
          (
            await call(user, checkRoute.POST as Handler, "/api/admin/cost-check", {
              method: "POST",
              body: { format: "csv", csv: "piatto;costo_cibo\n" },
            })
          ).status,
          user.role,
        ).toBe(403);
      }
      expect((await getPercentages(a.waiter)).status).toBe(403);
    });
  });

  describe("tenancy", () => {
    it("tenant B gets 404 for A's recipe and sees no plate, ingredient cost or fixed cost", async () => {
      const other = await call(
        b.owner,
        recipeCostRoute.GET as Handler,
        `/api/recipes/${key("Spezzatino (demo)")}/cost`,
        { params: { key: key("Spezzatino (demo)") } },
      );
      expect(other.status).toBe(404);
      expect((await getPlates(b.owner)).body.plates).toEqual([]);
      expect((await getIngredientCosts(b.owner)).body.ingredients).toEqual([]);
      const periods = await call<{ periods: FixedCostPeriod[] }>(
        b.owner,
        fixedRoute.GET as Handler,
        "/api/fixed-costs",
      );
      expect(periods.body.periods).toEqual([]);
      expect((await getPercentages(b.owner)).body.plates).toEqual([]);
    });
  });
});
