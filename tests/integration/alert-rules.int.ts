import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, venueDate } from "@/lib/time/venue-date";
import type { AlertItem, AlertList } from "@/server/alerts/list";
import type { ProduceResult } from "@/server/batches/types";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";
import { seedBatchFixture, type BatchFixture } from "./helpers/batches";
import { approveWithLots } from "./helpers/invoices";
import {
  afternoonOf,
  dayOtherThan,
  middayOf,
  nextMondayAfter,
  noNbsp,
  seedRulesFixture,
  type RulesFixture,
} from "./helpers/alert-rules";

// M16 acceptance tests 1 to 4 and the roles and tenancy cases against the real local stack. The rules routes, the alert
// route and the M12/M14 routes run for real (schemas, role checks, error mapping, the settings procedures, the reads,
// the three rules in the hourly body, RLS, grants); only `createSupabaseServerClient` is replaced, because it would read
// cookies from a Next.js request. Each call runs inside an AsyncLocalStorage context that carries the signed-in test
// user's own client (publishable key + that user's JWT).
//
// The hourly job is run through `alert_rules_run(p_at)` with the local stack's secret key (test code only, like
// ledger_invariants_run): the clock is explicit, so every case has its own business date and the dedup index cannot
// make two cases collide. The alert rows are read through the API as owner and chef (the secret key has no grant on
// `alert` by design). Fake data only.
//
// Tenant A holds the stew (AT1, AT2, AT4: beef 12,3 kg, then 3,0 kg). Tenant B holds the Macelleria fixture (AT3) with
// no consumption history, so the weekday forecast is 0 and the order is exactly two 5 kg packs; the stew production in A
// could not do that (a batch posts consumption rows). The tests run in order and share state. Throws in CI when the
// stack settings are missing; skips on a developer machine.
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
const suppliersRoute = await import("@/app/api/suppliers/route");
const supplierItemsRoute = await import("@/app/api/supplier-items/route");
const proposalRoute = await import("@/app/api/batches/proposal/route");
const batchesRoute = await import("@/app/api/batches/route");
const wasteRoute = await import("@/app/api/stock/waste/route");
const alertsRoute = await import("@/app/api/alerts/route");
const ruleIngredientsRoute = await import("@/app/api/rules/ingredients/route");
const ruleSuppliersRoute = await import("@/app/api/rules/suppliers/route");
const ruleRecipesRoute = await import("@/app/api/rules/recipes/route");

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

interface IngredientItem {
  ingredientId: string;
  onHandQty: number;
  minLevel: number | null;
  targetLevel: number | null;
  preferred: { supplierItemId: string; packQty: number } | null;
  nextWindow: { deliveryDate: string; orderByAt: string } | null;
  status: "ok" | "incomplete" | "off";
  reasons: string[];
}
interface IngredientRules {
  today: string;
  items: IngredientItem[];
  supplierItems?: unknown[];
}
interface SupplierRulesItem {
  supplierId: string;
  leadTimeDays: number | null;
  deliveryWeekdays: number[];
  orderCutoffTime: string | null;
  nextWindow: { deliveryDate: string; orderByAt: string } | null;
}
interface RecipeRulesItem {
  recipeKey: string;
  version: number;
  minPortions: number | null;
  targetPortions: number | null;
  prepTimeMin: number | null;
  sources: { min: string | null; target: string | null; prep: string | null };
  remainingPortions: number;
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
const monday = nextMondayAfter(today);
// AT2 gets a date of its own: not today (AT1's), not the Monday of AT3, and inside the stew batch's 72 h.
const otherDay = dayOtherThan([day(1), day(2)], monday);

describe.skipIf(!env)("reorder, prep, purchase and expiry rules on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let f: BatchFixture;
  let m: RulesFixture;
  let stewRecipeId: string;
  let nowIso: string;

  // ---- calls -----------------------------------------------------------------------------------------------------
  const rulesIngredients = (user: TestUser) =>
    call<IngredientRules>(user, ruleIngredientsRoute.GET as Handler, "/api/rules/ingredients");
  const rulesSuppliers = (user: TestUser) =>
    call<{ items: SupplierRulesItem[] }>(
      user,
      ruleSuppliersRoute.GET as Handler,
      "/api/rules/suppliers",
    );
  const rulesRecipes = (user: TestUser) =>
    call<{ items: RecipeRulesItem[] }>(user, ruleRecipesRoute.GET as Handler, "/api/rules/recipes");
  const patchIngredient = (user: TestUser, body: object) =>
    call<{ ingredientId: string; changed: boolean; item: IngredientItem | null }>(
      user,
      ruleIngredientsRoute.PATCH as Handler,
      "/api/rules/ingredients",
      { method: "PATCH", body },
    );
  const patchSupplier = (user: TestUser, body: object) =>
    call<{ supplierId: string; changed: boolean; item: SupplierRulesItem | null }>(
      user,
      ruleSuppliersRoute.PATCH as Handler,
      "/api/rules/suppliers",
      { method: "PATCH", body },
    );
  const patchRecipe = (user: TestUser, body: object) =>
    call<{ recipeKey: string; changed: boolean; item: RecipeRulesItem | null }>(
      user,
      ruleRecipesRoute.PATCH as Handler,
      "/api/rules/recipes",
      { method: "PATCH", body },
    );
  const alerts = (user: TestUser, query = "?filter=all") =>
    call<AlertList>(user, alertsRoute.GET as Handler, `/api/alerts${query}`);
  const produce = (user: TestUser, body: object) =>
    call<ProduceResult>(user, batchesRoute.POST as Handler, "/api/batches", {
      method: "POST",
      body,
    });
  const waste = (user: TestUser, qty: number) =>
    call(user, wasteRoute.POST as Handler, "/api/stock/waste", {
      method: "POST",
      body: {
        ingredientId: f.beefId,
        qty,
        unit: "kg",
        reason: "spoilage",
        locationId: f.cellaId,
      },
    });
  const approveAs = (owner: TestUser) => async (invoiceId: string, locationId: string) =>
    (
      await call(owner, approveRoute.POST as Handler, `/api/invoices/${invoiceId}/approve`, {
        method: "POST",
        body: { locationId },
        params: { id: invoiceId },
      })
    ).status;

  /** The hourly job once at `at`, with the local stack's secret key. */
  const runRules = async (at: string) => {
    const run = await stack.admin.rpc("alert_rules_run", { p_at: at });
    expect(run.error).toBeNull();
    return run.data as { ok: boolean; items: number };
  };
  const beefOnHand = async (user: TestUser, ingredientId: string) => {
    const read = await rulesIngredients(user);
    expect(read.status).toBe(200);
    return read.body.items.find((item) => item.ingredientId === ingredientId)!.onHandQty;
  };
  const ofKind = (list: AlertList, kind: string, businessDate?: string): AlertItem[] =>
    list.alerts.filter(
      (alert) => alert.kind === kind && (businessDate ? alert.businessDate === businessDate : true),
    );

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    f = await seedBatchFixture(stack.admin, a.id, {
      createRecipe: (body) =>
        call(a.owner, recipesRoute.POST as Handler, "/api/recipes", {
          method: "POST",
          body,
        }) as Promise<{ status: number; body: { recipe: { key: string } } }>,
      approve: approveAs(a.owner),
      day,
    });
    const proposal = await call<{ recipe: { id: string } }>(
      a.chef,
      proposalRoute.GET as Handler,
      `/api/batches/proposal?recipeKey=${f.stewKey}`,
    );
    stewRecipeId = proposal.body.recipe.id;
    m = await seedRulesFixture(stack.admin, b.id, 2, {
      createSupplier: (body) =>
        call(b.owner, suppliersRoute.POST as Handler, "/api/suppliers", {
          method: "POST",
          body,
        }) as Promise<{ status: number; body: { supplier: { id: string } } }>,
      createSupplierItem: (body) =>
        call(b.owner, supplierItemsRoute.POST as Handler, "/api/supplier-items", {
          method: "POST",
          body,
        }) as Promise<{ status: number; body: { item: { id: string } } }>,
      approve: approveAs(b.owner),
      day,
    });
  }, 240_000);

  // ---- AT3 (no history), first: it needs a tenant without any consumption row ----------------------------------
  describe("AT3: Macelleria X (demo), Monday and Thursday, 11:00, Monday afternoon (tenant B, no history)", () => {
    it("the owner sets the delivery days, lead time and cut-off, and reads the next window back", async () => {
      const set = await patchSupplier(b.owner, {
        supplierId: m.macelleriaId,
        deliveryWeekdays: [4, 1],
        leadTimeDays: 2,
        orderCutoffTime: "11:00",
      });
      expect(set.status).toBe(200);
      expect(set.body.changed).toBe(true);
      expect(set.body.item).toMatchObject({
        supplierId: m.macelleriaId,
        leadTimeDays: 2,
        deliveryWeekdays: [1, 4],
        orderCutoffTime: "11:00",
      });
      expect(set.body.item!.nextWindow).not.toBeNull();
      // The same patch again changes nothing.
      const again = await patchSupplier(b.owner, {
        supplierId: m.macelleriaId,
        deliveryWeekdays: [1, 4],
      });
      expect([again.status, again.body.changed]).toEqual([200, false]);
    });

    it("the owner sets beef min 5, target 12 and the 5 kg pack; the ingredient is complete", async () => {
      const before = await rulesIngredients(b.owner);
      const beef = before.body.items.find((item) => item.ingredientId === m.beefId)!;
      expect(beef.status).toBe("off");
      expect(before.body.supplierItems).toContainEqual(
        expect.objectContaining({ supplierItemId: m.packId, packQty: 5 }),
      );

      const set = await patchIngredient(b.owner, {
        ingredientId: m.beefId,
        minLevel: 5,
        targetLevel: 12,
        preferredSupplierItemId: m.packId,
      });
      expect(set.status).toBe(200);
      expect(set.body.item).toMatchObject({
        minLevel: 5,
        targetLevel: 12,
        onHandQty: 2,
        status: "ok",
        reasons: [],
        preferred: { supplierItemId: m.packId, packQty: 5 },
      });
    });

    it("on Monday afternoon the owner is told to order 10 kg by Tuesday 11:00 for Thursday", async () => {
      const run = await runRules(afternoonOf(monday));
      expect(run.ok).toBe(true);
      const owner = await alerts(b.owner);
      expect(owner.status).toBe(200);
      const purchase = ofKind(owner.body, "purchase_due", monday);
      expect(purchase).toHaveLength(1);
      expect(noNbsp(purchase[0]!.title)).toBe(
        "Ordina 10 kg di Manzo muscolo (demo) da Macelleria X (demo) entro mar 11:00 per la consegna di gio",
      );
      expect(purchase[0]!.href).toBe("/riordino/ingredienti");

      const english = await alerts(b.owner, "?filter=all&locale=en");
      expect(noNbsp(ofKind(english.body, "purchase_due", monday)[0]!.title)).toBe(
        "Order 10 kg Manzo muscolo (demo) from Macelleria X (demo) by Tue 11:00 for Thu delivery",
      );
    });

    it("the chef of the same tenant does not see the purchase alert", async () => {
      const chef = await alerts(b.chef);
      expect(chef.status).toBe(200);
      expect(ofKind(chef.body, "purchase_due")).toHaveLength(0);
      expect(chef.text).not.toContain("Macelleria");
    });

    it("the owner's preview clock gives the same window as the rows (the Monday run used Tuesday 11:00)", async () => {
      const preview = await b.owner.client.rpc("rules_ingredients", { p_at: afternoonOf(monday) });
      expect(preview.error).toBeNull();
      const beef = (preview.data as IngredientRules).items.find(
        (i) => i.ingredientId === m.beefId,
      )!;
      expect(beef.nextWindow!.deliveryDate).toBe(addDays(monday, 3));
    });
  });

  // ---- AT1 -------------------------------------------------------------------------------------------------------
  describe("AT1: stew 4 portions left, minimum 5, beef 12,3 kg", () => {
    it("the owner sets the stew rules (min 5, target 30, prep 180 min) and reads them back with their sources", async () => {
      const set = await patchRecipe(a.owner, {
        recipeKey: f.stewKey,
        minPortions: 5,
        targetPortions: 30,
        prepTimeMin: 180,
      });
      expect(set.status).toBe(200);
      expect(set.body.item).toMatchObject({
        recipeKey: f.stewKey,
        minPortions: 5,
        targetPortions: 30,
        prepTimeMin: 180,
        sources: { min: "rule", target: "rule", prep: "rule" },
      });
      // A rule is not a recipe version: the stew is still at version 1. Read through the owner's API, since
      // M7 revokes the recipe tables from service_role.
      const listed = await rulesRecipes(a.owner);
      expect(listed.status).toBe(200);
      expect(listed.body.items.find((item) => item.recipeKey === f.stewKey)?.version).toBe(1);
    });

    it("the chef produces a batch with 4 portions and beef is brought to 12,3 kg on hand", async () => {
      const made = await produce(a.chef, {
        recipeId: stewRecipeId,
        outputQty: 0.8,
        portions: 4,
        inputs: [
          { ingredientId: f.beefId, qty: 0.6667, unit: "kg" },
          { ingredientId: f.onionId, qty: 0.04, unit: "kg" },
          { ingredientId: f.carrotId, qty: 0.0267, unit: "kg" },
        ],
      });
      expect(made.status).toBe(201);
      expect(made.body.portions).toBe(4);

      const missing = Number((12.3 - (await beefOnHand(a.owner, f.beefId))).toFixed(4));
      expect(missing).toBeGreaterThan(0);
      const received = await approveWithLots(
        stack.admin,
        a.id,
        {
          supplierId: f.supplierId,
          date: day(-1),
          lines: [
            {
              description: "Manzo L-TOPUP",
              ingredientId: f.beefId,
              qty: missing,
              unit: "kg",
              unitPrice: 10,
              lotCode: "L-TOPUP",
              expiry: day(60),
            },
          ],
        },
        (invoiceId) => approveAs(a.owner)(invoiceId, f.cellaId),
      );
      expect(received.status).toBe(200);
      expect(await beefOnHand(a.owner, f.beefId)).toBeCloseTo(12.3, 4);
      const stew = (await rulesRecipes(a.owner)).body.items.find(
        (item) => item.recipeKey === f.stewKey,
      );
      expect(stew?.remainingPortions).toBe(4);
    });

    it("after the hourly run the chef reads the prep alert, in Italian and in English", async () => {
      nowIso = new Date().toISOString();
      const run = await runRules(nowIso);
      expect(run.ok).toBe(true);
      expect(run.items).toBeGreaterThan(0);

      const chef = await alerts(a.chef);
      expect(chef.status).toBe(200);
      const prep = ofKind(chef.body, "prep_due", today);
      expect(prep).toHaveLength(1);
      expect(prep[0]!.title).toBe("Da preparare oggi: Spezzatino (demo)");
      expect(noNbsp(prep[0]!.body)).toContain(
        "Prepara Spezzatino (demo) oggi, 5,0 kg di Manzo muscolo (demo) disponibili (12,3 kg in giacenza). Restano 4 porzioni, minimo 5.",
      );
      expect(prep[0]!.href).toBe("/produzione/nuova");
      expect(ofKind(chef.body, "prep_raw_short", today)).toHaveLength(0);

      const english = await alerts(a.chef, "?filter=all&locale=en");
      const enPrep = ofKind(english.body, "prep_due", today)[0]!;
      expect(enPrep.title).toBe("Prepare today: Spezzatino (demo)");
      expect(noNbsp(enPrep.body)).toContain(
        "Prepare Spezzatino (demo) today, 5.0 kg Manzo muscolo (demo) available (12.3 kg on hand). 4 portions left, minimum 5.",
      );
    });

    it("the chef's alert JSON carries no money key and the owner sees the same prep alert", async () => {
      const chef = await alerts(a.chef);
      expect(keysOf(chef.body).filter((key) => COSTLY.test(key))).toEqual([]);
      expect(chef.text).not.toContain("€");
      const owner = await alerts(a.owner);
      expect(ofKind(owner.body, "prep_due", today)).toHaveLength(1);
    });
  });

  // ---- AT4: the same hour again ---------------------------------------------------------------------------------
  describe("AT4: three hourly runs on one day give one alert per item", () => {
    it("two more runs at the same clock add nothing", async () => {
      const second = await runRules(nowIso);
      const third = await runRules(nowIso);
      expect([second.items, third.items]).toEqual([0, 0]);
      const owner = await alerts(a.owner);
      const keys = owner.body.alerts.map((x) => `${x.kind}|${x.entityId}|${x.businessDate}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(ofKind(owner.body, "prep_due", today)).toHaveLength(1);
    });
  });

  // ---- AT2 -------------------------------------------------------------------------------------------------------
  describe("AT2: beef 3,0 kg is raw stock short, not a prep alert", () => {
    it("with 3,0 kg the chef sees the raw-short alert and no prep alert for the new date", async () => {
      const onHand = await beefOnHand(a.owner, f.beefId);
      const dropped = await waste(a.chef, Number((onHand - 3).toFixed(4)));
      expect(dropped.status).toBe(201);
      expect(await beefOnHand(a.owner, f.beefId)).toBeCloseTo(3, 4);

      const run = await runRules(middayOf(otherDay));
      expect(run.ok).toBe(true);

      const chef = await alerts(a.chef);
      const short = ofKind(chef.body, "prep_raw_short", otherDay);
      expect(short).toHaveLength(1);
      expect(short[0]!.title).toBe("Manca materia prima per Spezzatino (demo)");
      expect(noNbsp(short[0]!.body)).toContain(
        "Restano 4 porzioni (minimo 5). Per un lotto servono 5,0 kg di Manzo muscolo (demo), in giacenza 3,0 kg.",
      );
      expect(ofKind(chef.body, "prep_due", otherDay)).toHaveLength(0);
    });
  });

  // ---- roles and tenancy ---------------------------------------------------------------------------------------
  describe("roles", () => {
    it("owner, admin and chef read the three lists; the waiter gets 403", async () => {
      for (const user of [a.owner, a.admin, a.chef]) {
        for (const read of [rulesIngredients, rulesSuppliers, rulesRecipes]) {
          expect((await read(user)).status, `${user.role}`).toBe(200);
        }
      }
      for (const read of [rulesIngredients, rulesSuppliers, rulesRecipes]) {
        expect((await read(a.waiter)).status).toBe(403);
      }
    });

    it("the chef's ingredient list has no supplier choices and no money key anywhere", async () => {
      const chef = await rulesIngredients(a.chef);
      expect(chef.body).not.toHaveProperty("supplierItems");
      const owner = await rulesIngredients(a.owner);
      expect(owner.body).toHaveProperty("supplierItems");
      for (const reply of [chef, owner, await rulesSuppliers(a.chef), await rulesRecipes(a.chef)]) {
        expect(keysOf(reply.body).filter((key) => COSTLY.test(key))).toEqual([]);
        expect(reply.text).not.toContain("€");
      }
    });

    it("the chef and the waiter cannot change any rule", async () => {
      for (const user of [a.chef, a.waiter]) {
        expect((await patchIngredient(user, { ingredientId: f.beefId, minLevel: 1 })).status).toBe(
          403,
        );
        expect(
          (await patchSupplier(user, { supplierId: f.supplierId, leadTimeDays: 1 })).status,
        ).toBe(403);
        expect((await patchRecipe(user, { recipeKey: f.stewKey, minPortions: 1 })).status).toBe(
          403,
        );
      }
      const stew = (await rulesRecipes(a.owner)).body.items.find((i) => i.recipeKey === f.stewKey)!;
      expect(stew.minPortions).toBe(5);
    });

    it("the owner's errors come back as codes: levels, weekdays, unknown ids", async () => {
      const levels = await patchIngredient(a.owner, {
        ingredientId: f.beefId,
        minLevel: 5,
        targetLevel: 4,
      });
      expect([levels.status, levels.error.code]).toEqual([422, "levels_invalid"]);
      const water = await patchIngredient(a.owner, { ingredientId: f.waterId, minLevel: 1 });
      expect([water.status, water.error.code]).toEqual([422, "ingredient_not_stock"]);
      const ghost = await patchIngredient(a.owner, {
        ingredientId: "00000000-0000-4000-8000-000000000000",
        minLevel: 1,
      });
      expect([ghost.status, ghost.error.code]).toEqual([404, "not_found"]);
      const plate = await patchRecipe(a.owner, { recipeKey: f.soffrittoKey, minPortions: 1 });
      expect([plate.status, plate.error.code]).toEqual([422, "recipe_not_batch"]);
      const target = await patchRecipe(a.owner, {
        recipeKey: f.stewKey,
        minPortions: 8,
        targetPortions: 7,
      });
      expect([target.status, target.error.code]).toEqual([422, "portions_invalid"]);
    });

    it("a direct write to the rule columns is refused, even for the owner", async () => {
      const level = await a.owner.client
        .from("ingredient")
        .update({ min_level: 1 })
        .eq("id", f.beefId);
      expect(level.error?.code).toBe("42501");
      const lead = await a.owner.client
        .from("supplier")
        .update({ lead_time_days: 1 })
        .eq("id", f.supplierId);
      expect(lead.error?.code).toBe("42501");
      const chefRecipe = await a.chef.client
        .from("recipe_key")
        .update({ rule_min_portions: 9 })
        .eq("id", f.stewKey);
      expect(chefRecipe.error?.code).toBe("42501");
      const stew = (await rulesRecipes(a.owner)).body.items.find((i) => i.recipeKey === f.stewKey)!;
      expect(stew.minPortions).toBe(5);
    });
  });

  describe("tenancy", () => {
    it("owner B sees only B's rows in the three lists, and owner A none of B's", async () => {
      const aIngredients = await rulesIngredients(a.owner);
      const bIngredients = await rulesIngredients(b.owner);
      const aIds = new Set(aIngredients.body.items.map((item) => item.ingredientId));
      for (const item of bIngredients.body.items) expect(aIds.has(item.ingredientId)).toBe(false);
      expect(bIngredients.body.items.map((item) => item.ingredientId)).toEqual([m.beefId]);
      expect(aIds.has(m.beefId)).toBe(false);

      const aSuppliers = await rulesSuppliers(a.owner);
      const bSuppliers = await rulesSuppliers(b.owner);
      const aSupplierIds = new Set(aSuppliers.body.items.map((item) => item.supplierId));
      expect(bSuppliers.body.items.map((item) => item.supplierId)).toContain(m.macelleriaId);
      for (const item of bSuppliers.body.items)
        expect(aSupplierIds.has(item.supplierId)).toBe(false);

      expect((await rulesRecipes(b.owner)).body.items).toEqual([]);
    });

    it("A cannot change B's rules: the ids are not found", async () => {
      const other = await patchSupplier(a.owner, { supplierId: m.macelleriaId, leadTimeDays: 9 });
      expect([other.status, other.error.code]).toEqual([404, "not_found"]);
      const beef = await patchIngredient(a.owner, { ingredientId: m.beefId, minLevel: 1 });
      expect([beef.status, beef.error.code]).toEqual([404, "not_found"]);
      const recipe = await patchRecipe(a.owner, {
        recipeKey: "00000000-0000-4000-8000-000000000001",
        minPortions: 1,
      });
      expect(recipe.status).toBe(404);
    });

    it("A's alerts never list B's purchase alert and B's never list A's stew", async () => {
      const aList = await alerts(a.owner);
      const bList = await alerts(b.owner);
      expect(aList.text).not.toContain("Macelleria");
      expect(bList.text).not.toContain("Spezzatino");
    });
  });
});
