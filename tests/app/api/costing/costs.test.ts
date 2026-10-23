import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const recipeCostRoute = await import("@/app/api/recipes/[key]/cost/route");
const platesRoute = await import("@/app/api/costs/plates/route");
const percentagesRoute = await import("@/app/api/costs/plates/percentages/route");
const ingredientsRoute = await import("@/app/api/costs/ingredients/route");

const KEY = "cc000000-0000-4000-8000-0000000000cc";
const SALT = "5a000000-0000-4000-8000-00000000005a";
const BEEF = "be000000-0000-4000-8000-0000000000be";
const BASE = "http://localhost:3000/api";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const PLATE_ROW = {
  recipe_key: KEY,
  name: "Spezzatino con polenta (demo)",
  version: 2,
  food_cost_eur: 2.0567,
  fixed_cost_eur: null,
  full_cost_eur: null,
  sale_price_eur: 12,
  vat_pct: 10,
  sale_price_ex_vat_eur: 10.9091,
  gross_margin_eur: 8.8524,
  net_margin_eur: null,
  food_cost_pct: 18.85,
  gp_pct: 81.15,
  target_gp_pct: 70,
  fixed_cost_allocated: false,
  status: "fixed_cost_unallocated",
  reasons: [],
  missing_ingredient_ids: [],
};
const INCOMPLETE_ROW = {
  ...PLATE_ROW,
  recipe_key: "dd000000-0000-4000-8000-0000000000dd",
  name: "Polenta e sale (demo)",
  food_cost_eur: null,
  gross_margin_eur: null,
  food_cost_pct: null,
  gp_pct: null,
  status: "incomplete",
  reasons: ["missing_price"],
  missing_ingredient_ids: [SALT],
};
const FIXED = {
  periodMonth: "2026-10-01",
  monthlyTotalEur: 13500,
  platesSold: 0,
  perPlateEur: null,
  reason: "no_sales",
};
const COST = {
  recipeKey: KEY,
  recipeId: "ee000000-0000-4000-8000-0000000000ee",
  version: 2,
  type: "batch",
  name: "Spezzatino (demo)",
  at: null,
  totalCostEur: 50,
  unitCostEur: 1.6667,
  costUnit: "porz",
  incomplete: false,
  reasons: [],
  missingIngredientIds: [],
  lines: [
    {
      position: 1,
      target: { kind: "ingredient", id: BEEF, name: "Manzo muscolo (demo)" },
      qty: 5,
      unit: "kg",
      yieldFactor: 1,
      unitCostEur: 10,
      lineCostEur: 50,
      incomplete: false,
      reason: null,
    },
  ],
  plate: null,
};

function as(
  role: string,
  rpc: Record<string, FakeResult[]> = {},
  results: Record<string, FakeResult[]> = {},
) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: {
      recipe_cost_at: [ok(COST)],
      plate_costs: [ok([PLATE_ROW, INCOMPLETE_ROW])],
      fixed_cost_status: [ok(FIXED)],
      plate_margins_pct: [ok([])],
      ingredient_costs: [ok([])],
      cost_settings: [ok({ avgCostN: 3, priceVariancePct: 10, saleVatPct: 10 })],
      ...rpc,
    },
    results: { ingredient: [ok([{ id: SALT, name: "Sale grosso (demo)" }])], ...results },
  });
}
beforeEach(() => as("owner"));

const get = (route: { GET: (r: Request, c?: never) => Promise<Response> }, path: string) =>
  route.GET(new Request(`${BASE}${path}`));
const getKey = (path = "") =>
  recipeCostRoute.GET(
    new Request(`${BASE}/recipes/${KEY}/cost${path}`),
    routeContext({ key: KEY }),
  );

describe("role table", () => {
  const cases = [
    ["recipe cost", () => getKey()],
    ["plates", () => get(platesRoute, "/costs/plates")],
    ["ingredients", () => get(ingredientsRoute, "/costs/ingredients")],
  ] as const;

  it.each(cases)(
    "%s: owner and admin read, chef and waiter get 403 before any RPC",
    async (_n, call) => {
      for (const role of ["owner", "admin"]) {
        as(role);
        expect((await call()).status).toBe(200);
      }
      for (const role of ["chef", "waiter"]) {
        as(role);
        expect((await call()).status).toBe(403);
        expect(client.rpc).not.toHaveBeenCalled();
      }
    },
  );

  it("percentages: owner, admin and chef read; the waiter gets 403 before any RPC", async () => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      expect((await get(percentagesRoute, "/costs/plates/percentages")).status).toBe(200);
    }
    as("waiter");
    expect((await get(percentagesRoute, "/costs/plates/percentages")).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401 on every route", async () => {
    client = fakeSupabase({ claims: null });
    expect((await getKey()).status).toBe(401);
    expect((await get(platesRoute, "/costs/plates")).status).toBe(401);
    expect((await get(percentagesRoute, "/costs/plates/percentages")).status).toBe(401);
    expect((await get(ingredientsRoute, "/costs/ingredients")).status).toBe(401);
  });
});

describe("GET /api/recipes/:key/cost", () => {
  it("calls recipe_cost_at with the key and no date for the current cost", async () => {
    const response = await getKey();
    expect(client.rpc).toHaveBeenCalledWith("recipe_cost_at", { p_key: KEY, p_date: null });
    const { cost } = await response.json();
    expect(cost).toMatchObject({
      recipeKey: KEY,
      totalCostEur: 50,
      unitCostEur: 1.6667,
      plate: null,
    });
    expect(cost.lines[0].target.name).toBe("Manzo muscolo (demo)");
  });

  it("passes ?at as p_date", async () => {
    await getKey("?at=2026-10-20");
    expect(client.rpc).toHaveBeenCalledWith("recipe_cost_at", { p_key: KEY, p_date: "2026-10-20" });
  });

  it("names the missing ingredients of an incomplete cost and maps the plate", async () => {
    as("owner", {
      recipe_cost_at: [
        ok({
          ...COST,
          type: "plate",
          totalCostEur: null,
          unitCostEur: null,
          incomplete: true,
          reasons: ["missing_price"],
          missingIngredientIds: [SALT],
          plate: {
            recipeKey: KEY,
            name: "Polenta e sale (demo)",
            version: 1,
            foodCostEur: null,
            fixedCostEur: null,
            fullCostEur: null,
            salePriceEur: 9,
            vatPct: 10,
            salePriceExVatEur: 8.1818,
            grossMarginEur: null,
            netMarginEur: null,
            foodCostPct: null,
            gpPct: null,
            targetGpPct: 70,
            fixedCostAllocated: false,
            status: "incomplete",
            reasons: ["missing_price"],
            missingIngredientIds: [SALT],
          },
        }),
      ],
    });
    const { cost } = await (await getKey()).json();
    expect(cost.missingIngredients).toEqual([{ id: SALT, name: "Sale grosso (demo)" }]);
    expect(cost.plate.missingIngredients).toEqual([{ id: SALT, name: "Sale grosso (demo)" }]);
    expect(cost.plate.status).toBe("incomplete");
    expect(cost.plate).not.toHaveProperty("missingIngredientIds");
    expect(cost).not.toHaveProperty("missingIngredientIds");
  });

  it("400 for a malformed date or an unknown parameter, 422 for the future, no RPC", async () => {
    expect((await getKey("?at=x")).status).toBe(400);
    expect((await getKey("?foo=1")).status).toBe(400);
    expect((await getKey("?at=2999-01-01")).status).toBe(422);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("404 for a malformed key", async () => {
    const response = await recipeCostRoute.GET(
      new Request(`${BASE}/recipes/x/cost`),
      routeContext({ key: "x" }),
    );
    expect(response.status).toBe(404);
  });

  it("maps database errors: date_in_future 422, P0002 404, recipe_not_in_force 404, 42501 403", async () => {
    as("owner", { recipe_cost_at: [failure("P0001", "date_in_future")] });
    expect((await getKey()).status).toBe(422);
    as("owner", { recipe_cost_at: [failure("P0002", "not_found")] });
    expect((await getKey()).status).toBe(404);
    as("owner", { recipe_cost_at: [failure("P0002", "recipe_not_in_force")] });
    const old = await getKey();
    expect(old.status).toBe(404);
    expect((await old.json()).error.code).toBe("recipe_not_in_force");
    as("owner", { recipe_cost_at: [failure("42501", "permission denied")] });
    expect((await getKey()).status).toBe(403);
  });

  it("an unexpected database error is a 500 without the database text", async () => {
    as("owner", { recipe_cost_at: [failure("XX000", "secret internals")] });
    const response = await getKey();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret internals");
  });
});

describe("GET /api/costs/plates", () => {
  it("maps every field of the owner's plate, with the fixed cost status", async () => {
    const response = await get(platesRoute, "/costs/plates?at=2026-10-20");
    expect(client.rpc).toHaveBeenCalledWith("plate_costs", { p_date: "2026-10-20" });
    expect(client.rpc).toHaveBeenCalledWith("fixed_cost_status", { p_date: "2026-10-20" });
    const body = await response.json();
    expect(body.at).toBe("2026-10-20");
    expect(body.fixedCost).toEqual(FIXED);
    expect(body.plates[0]).toEqual({
      recipeKey: KEY,
      name: "Spezzatino con polenta (demo)",
      version: 2,
      foodCostEur: 2.0567,
      fixedCostEur: null,
      fullCostEur: null,
      salePriceEur: 12,
      vatPct: 10,
      salePriceExVatEur: 10.9091,
      grossMarginEur: 8.8524,
      netMarginEur: null,
      foodCostPct: 18.85,
      gpPct: 81.15,
      targetGpPct: 70,
      fixedCostAllocated: false,
      status: "fixed_cost_unallocated",
      reasons: [],
      missingIngredients: [],
    });
    expect(body.plates[1].missingIngredients).toEqual([{ id: SALT, name: "Sale grosso (demo)" }]);
    expect(body.plates[1].foodCostEur).toBeNull();
  });

  it("the admin never triggers fixed_cost_status: fixedCost is null and the fixed fields are null", async () => {
    as("admin", {
      plate_costs: [
        ok([
          {
            ...PLATE_ROW,
            fixed_cost_eur: null,
            full_cost_eur: null,
            net_margin_eur: null,
            fixed_cost_allocated: null,
            status: "ok",
          },
        ]),
      ],
    });
    const body = await (await get(platesRoute, "/costs/plates")).json();
    expect(client.rpc).not.toHaveBeenCalledWith("fixed_cost_status", expect.anything());
    expect(body.fixedCost).toBeNull();
    expect(body.at).toBeNull();
    expect(body.plates[0]).toMatchObject({
      fixedCostEur: null,
      fullCostEur: null,
      netMarginEur: null,
      fixedCostAllocated: null,
      status: "ok",
    });
  });

  it("an empty menu is an empty list", async () => {
    as("owner", { plate_costs: [ok(null)] });
    expect((await (await get(platesRoute, "/costs/plates")).json()).plates).toEqual([]);
  });

  it("400 for a bad date, 422 for the future, error mapping for the RPC", async () => {
    expect((await get(platesRoute, "/costs/plates?at=x")).status).toBe(400);
    expect((await get(platesRoute, "/costs/plates?at=2999-01-01")).status).toBe(422);
    as("owner", { plate_costs: [failure("P0001", "date_in_future")] });
    expect((await get(platesRoute, "/costs/plates")).status).toBe(422);
    as("owner", { fixed_cost_status: [failure("42501", "denied")] });
    expect((await get(platesRoute, "/costs/plates")).status).toBe(403);
  });
});

describe("GET /api/costs/ingredients", () => {
  it("returns the average window and every ingredient with its costs", async () => {
    as("owner", {
      ingredient_costs: [
        ok([
          {
            ingredient_id: BEEF,
            name: "Manzo muscolo (demo)",
            base_unit: "kg",
            is_active: true,
            basis: "moving_average",
            unit_cost_eur: 10,
            avg_eur: 10,
            last_eur: 11,
            max_eur: 11,
            purchases_used: 3,
            last_purchase_on: "2026-10-20",
          },
          {
            ingredient_id: SALT,
            name: "Sale grosso (demo)",
            base_unit: "kg",
            is_active: true,
            basis: "moving_average",
            unit_cost_eur: null,
            avg_eur: null,
            last_eur: null,
            max_eur: null,
            purchases_used: 0,
            last_purchase_on: null,
          },
        ]),
      ],
    });
    const response = await get(ingredientsRoute, "/costs/ingredients?at=2026-10-21");
    expect(client.rpc).toHaveBeenCalledWith("ingredient_costs", { p_date: "2026-10-21" });
    const body = await response.json();
    expect(body.at).toBe("2026-10-21");
    expect(body.avgCostN).toBe(3);
    expect(body.ingredients[0]).toEqual({
      id: BEEF,
      name: "Manzo muscolo (demo)",
      baseUnit: "kg",
      isActive: true,
      basis: "moving_average",
      unitCostEur: 10,
      avgEur: 10,
      lastEur: 11,
      maxEur: 11,
      purchasesUsed: 3,
      lastPurchaseOn: "2026-10-20",
    });
    expect(body.ingredients[1].unitCostEur).toBeNull();
    expect(body.ingredients[1].purchasesUsed).toBe(0);
  });

  it("an empty list when the tenant has no ingredients; error mapping", async () => {
    as("owner", { ingredient_costs: [ok(null)] });
    expect((await (await get(ingredientsRoute, "/costs/ingredients")).json()).ingredients).toEqual(
      [],
    );
    as("owner", { ingredient_costs: [failure("P0001", "date_in_future")] });
    expect((await get(ingredientsRoute, "/costs/ingredients")).status).toBe(422);
    expect((await get(ingredientsRoute, "/costs/ingredients?z=1")).status).toBe(400);
  });
});
