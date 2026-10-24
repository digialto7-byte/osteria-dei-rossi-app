import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, venueDate } from "@/lib/time/venue-date";
import type {
  AdjustResult,
  BatchDetail,
  BatchLabel,
  DiscardResult,
  ProduceResult,
  SplitResult,
} from "@/server/batches/types";
import type {
  StaffMealConfirmation,
  StaffMealRuleResult,
  StaffMealRules,
} from "@/server/staff-meals/types";
import type { WasteCosts } from "@/server/stock/types";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";
import { approveWithLots } from "./helpers/invoices";
import {
  seedBatchFixture,
  seedRaguBatch,
  seedRaguRecipe,
  type BatchFixture,
} from "./helpers/batches";

// M15 acceptance tests 1 to 6 and Q16 against the real local stack. The routes run for real (schemas, role checks,
// error mapping, adjust_batch, discard_batch, split_batch, the staff-meal procedures, waste_costs, RLS, append-only
// triggers); only `createSupabaseServerClient` is replaced, as in the M14 suite, so each call carries the signed-in test
// user's own client and two calls can be in flight together (AT5 sends two confirmations at once). Fixtures arrive the
// production way: recipes through POST /api/recipes, lots through approved invoices, batches through POST /api/batches.
// The secret key reads v_batch_portions, batch and staff_meal_confirmation only to prove what the ledgers hold.
// Fake data only.
//
// The tests run in order and share state (tenant A: Ragù batches R1, R2, R3 of 10 portions at 2,00 EUR a portion).
// Throws in CI when the stack settings are missing; skips on a developer machine.
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
const detailRoute = await import("@/app/api/batches/[id]/route");
const labelRoute = await import("@/app/api/batches/[id]/label/route");
const adjustRoute = await import("@/app/api/batches/[id]/adjust/route");
const discardRoute = await import("@/app/api/batches/[id]/discard/route");
const splitRoute = await import("@/app/api/batches/[id]/split/route");
const staffMealsRoute = await import("@/app/api/staff-meals/route");
const confirmRoute = await import("@/app/api/staff-meals/[id]/confirm/route");
const wasteCostsRoute = await import("@/app/api/stock/waste-costs/route");

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
const HOUR_MS = 3_600_000;

type Made = { batchId: string; lotCode: string; portions: number };

describe.skipIf(!env)("batch actions, staff meals and the waste report on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let f: BatchFixture;
  let freezerId: string;
  let paneId: string;
  let raguKey: string;
  let raguRecipeId: string;
  let brodoRecipeId: string;
  let r1: Made;
  let r2: Made;
  let r3: Made;
  let brodoBatch: string;
  let raguRuleId: string;
  let paneRuleId: string;
  let child: SplitResult;

  // Every JSON text the chef received from an M15 route, scanned for euro signs and cost keys at the end (Q16).
  const chefTexts: string[] = [];

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
      if (user === a.chef) chefTexts.push(text);
      const body = JSON.parse(text) as T;
      return {
        status: response.status,
        body,
        text,
        error: (body as { error?: Reply["error"] }).error as Reply["error"],
      };
    });
  }

  const produce = (user: TestUser, body: object) =>
    call<ProduceResult>(user, batchesRoute.POST as Handler, "/api/batches", {
      method: "POST",
      body,
    });
  const detail = (user: TestUser, id: string) =>
    call<BatchDetail>(user, detailRoute.GET as Handler, `/api/batches/${id}`, { params: { id } });
  const label = (user: TestUser, id: string) =>
    call<BatchLabel>(user, labelRoute.GET as Handler, `/api/batches/${id}/label`, {
      params: { id },
    });
  const adjust = (user: TestUser, id: string, body: object) =>
    call<AdjustResult>(user, adjustRoute.POST as Handler, `/api/batches/${id}/adjust`, {
      method: "POST",
      body,
      params: { id },
    });
  const discard = (user: TestUser, id: string, body: object) =>
    call<DiscardResult>(user, discardRoute.POST as Handler, `/api/batches/${id}/discard`, {
      method: "POST",
      body,
      params: { id },
    });
  const split = (user: TestUser, id: string, body: object) =>
    call<SplitResult>(user, splitRoute.POST as Handler, `/api/batches/${id}/split`, {
      method: "POST",
      body,
      params: { id },
    });
  const rules = (user: TestUser) =>
    call<StaffMealRules>(user, staffMealsRoute.GET as Handler, "/api/staff-meals");
  const saveRule = (user: TestUser, body: object) =>
    call<StaffMealRuleResult>(user, staffMealsRoute.POST as Handler, "/api/staff-meals", {
      method: "POST",
      body,
    });
  const confirm = (user: TestUser, id: string, body: object = {}) =>
    call<StaffMealConfirmation>(
      user,
      confirmRoute.POST as Handler,
      `/api/staff-meals/${id}/confirm`,
      { method: "POST", body, params: { id } },
    );
  const wasteCosts = (user: TestUser) =>
    call<WasteCosts>(user, wasteCostsRoute.GET as Handler, "/api/stock/waste-costs");
  const approve = async (invoiceId: string, locationId: string) =>
    (
      await call(a.owner, approveRoute.POST as Handler, `/api/invoices/${invoiceId}/approve`, {
        method: "POST",
        body: { locationId },
        params: { id: invoiceId },
      })
    ).status;
  const raguBatch = (): Promise<Made> =>
    seedRaguBatch(f.beefId, raguRecipeId, f.cellaId, (body) => produce(a.chef, body));
  /** Portions remaining of a batch, read from the ledger view with the secret key. */
  const remainingOf = async (batchId: string) => {
    const read = await stack.admin
      .from("v_batch_portions")
      .select("portions_remaining")
      .eq("batch_id", batchId)
      .single();
    expect(read.error).toBeNull();
    return Number(read.data!.portions_remaining);
  };

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
      approve,
      day,
    };
    f = await seedBatchFixture(stack.admin, a.id, calls);

    // A second location and a bread ingredient (3,00 EUR/kg) for the staff-meal rules.
    const freezer = await stack.admin
      .from("location")
      .insert({ tenant_id: a.id, name: "Congelatore (demo)" })
      .select("id")
      .single();
    expect(freezer.error).toBeNull();
    freezerId = freezer.data!.id as string;
    const pane = await stack.admin
      .from("ingredient")
      .insert({ tenant_id: a.id, name: "Pane (demo)", base_unit: "kg", is_stock: true })
      .select("id")
      .single();
    expect(pane.error).toBeNull();
    paneId = pane.data!.id as string;

    // Beef for several Ragù batches (2 kg each) and the bread, bought the production way.
    const stocked = await approveWithLots(
      stack.admin,
      a.id,
      {
        supplierId: f.supplierId,
        date: day(-1),
        lines: [
          {
            description: "Manzo L-RAGU",
            ingredientId: f.beefId,
            qty: 30,
            unit: "kg",
            unitPrice: 10,
            lotCode: "L-RAGU",
            expiry: day(9),
          },
          {
            description: "Pane L-PANE",
            ingredientId: paneId,
            qty: 3,
            unit: "kg",
            unitPrice: 3,
            lotCode: "L-PANE",
            expiry: day(3),
          },
        ],
      },
      (invoiceId) => approve(invoiceId, f.cellaId),
    );
    expect(stocked.status).toBe(200);

    raguKey = await seedRaguRecipe(f, calls);
    const versionOf = async (key: string) =>
      (
        await call<{ recipe: { id: string } }>(
          a.chef,
          proposalRoute.GET as Handler,
          `/api/batches/proposal?recipeKey=${key}`,
        )
      ).body.recipe.id;
    raguRecipeId = await versionOf(raguKey);
    brodoRecipeId = await versionOf(f.brodoKey);
    r1 = await raguBatch();
  }, 240_000);

  describe("AT2: a discard is a waste movement with its reason", () => {
    it("the chef discards 3 of 10 as spoilage: 201, 7 remaining, the batch is open", async () => {
      const { status, body } = await discard(a.chef, r1.batchId, {
        portions: 3,
        reason: "spoilage",
      });
      expect(status).toBe(201);
      expect(body).toMatchObject({
        batchId: r1.batchId,
        portions: 3,
        reasonCode: "spoilage",
        portionsRemaining: 7,
        state: "open",
      });
      expect(await remainingOf(r1.batchId)).toBe(7);
    });

    it("the history names the discard, and the chef reads no cost on it", async () => {
      const { status, body, text } = await detail(a.chef, r1.batchId);
      expect(status).toBe(200);
      const waste = body.movements.find((m) => m.type === "waste")!;
      expect(waste).toMatchObject({
        portions: -3,
        reasonCode: "spoilage",
        refType: "batch_discard",
        byMe: true,
      });
      expect(keysOf(body).filter((key) => COSTLY.test(key))).toEqual([]);
      expect(text).not.toContain("€");
    });

    it("more than is left is a 409 portions_insufficient and nothing changes; a bad reason is a 400", async () => {
      const over = await discard(a.chef, r1.batchId, { portions: 8, reason: "spoilage" });
      expect([over.status, over.error.code]).toEqual([409, "portions_insufficient"]);
      expect((await discard(a.chef, r1.batchId, { portions: 1, reason: "foo" })).status).toBe(400);
      expect(
        (await discard(a.chef, r1.batchId, { portions: 1, reason: "count_correction" })).status,
      ).toBe(400);
      expect(await remainingOf(r1.batchId)).toBe(7);
    });
  });

  describe("AT3: a count writes the difference", () => {
    it("counting 6 when 7 are expected writes one count movement of -1", async () => {
      const { status, body } = await adjust(a.chef, r1.batchId, { counted: 6 });
      expect(status).toBe(200);
      expect(body).toMatchObject({ delta: -1, portionsRemaining: 6, state: "open" });
      expect(body.movementId).not.toBeNull();
      const moves = await stack.admin
        .from("batch_movement")
        .select("type, portions, ref_type")
        .eq("batch_id", r1.batchId)
        .eq("type", "count");
      expect(moves.data).toEqual([{ type: "count", portions: -1, ref_type: "batch_adjust" }]);
    });

    it("counting the same again writes nothing; bad counts are a 400", async () => {
      const again = await adjust(a.chef, r1.batchId, { counted: 6 });
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ movementId: null, delta: 0, portionsRemaining: 6 });
      for (const counted of [-1, 1.23456, 10_001]) {
        expect((await adjust(a.chef, r1.batchId, { counted })).status, String(counted)).toBe(400);
      }
      expect(await remainingOf(r1.batchId)).toBe(6);
    });
  });

  describe("AT1: a split moves portions into a new, linked batch", () => {
    it("the chef splits 4 of 10 into the freezer: 6 and 4 remain, the total is still 10", async () => {
      r2 = await raguBatch();
      const { status, body } = await split(a.chef, r2.batchId, {
        portions: 4,
        hoursFromNow: 2160,
        locationId: freezerId,
      });
      expect(status).toBe(201);
      child = body;
      expect(body).toMatchObject({
        batchId: r2.batchId,
        portions: 4,
        portionsRemaining: 6,
        locationId: freezerId,
        state: "open",
      });
      expect(body.newBatchId).not.toBe(r2.batchId);
      expect(body.lotCode).toMatch(/^\d{6}-RAGUDE-\d+$/);
      expect(body.lotCode).not.toBe(r2.lotCode);
      const parent = await remainingOf(r2.batchId);
      const part = await remainingOf(body.newBatchId);
      expect([parent, part, parent + part]).toEqual([6, 4, 10]);
    });

    it("the new batch is linked to the parent and keeps the production time; its use-by is 2160 h out", async () => {
      const row = await stack.admin
        .from("batch")
        .select("split_from_batch_id, location_id, produced_at, use_by, shelf_life_hours, state")
        .eq("id", child.newBatchId)
        .single();
      expect(row.error).toBeNull();
      const parentRow = await stack.admin
        .from("batch")
        .select("produced_at")
        .eq("id", r2.batchId)
        .single();
      expect(row.data).toMatchObject({
        split_from_batch_id: r2.batchId,
        location_id: freezerId,
        state: "fresh",
      });
      expect(new Date(row.data!.produced_at as string).getTime()).toBe(
        new Date(parentRow.data!.produced_at as string).getTime(),
      );
      // Counted from the original production, rounded down to the hour: never later than 2160 h from now.
      const ahead = new Date(row.data!.use_by as string).getTime() - Date.now();
      expect(ahead).toBeLessThanOrEqual(2160 * HOUR_MS);
      expect(ahead).toBeGreaterThan(2158 * HOUR_MS);
      expect(row.data!.shelf_life_hours).toBeGreaterThanOrEqual(2160);
      expect(row.data!.shelf_life_hours).toBeLessThanOrEqual(2161);
    });

    it("the detail of the parent lists the part, the detail of the part names the parent", async () => {
      const parent = await detail(a.chef, r2.batchId);
      expect(parent.body).toMatchObject({ portionsRemaining: 6, state: "open", splitFrom: null });
      expect(parent.body.splits).toEqual([
        {
          batchId: child.newBatchId,
          lotCode: child.lotCode,
          portions: 4,
          locationName: "Congelatore (demo)",
        },
      ]);
      expect(parent.body.can.split).toBe(true);
      const part = await detail(a.chef, child.newBatchId);
      expect(part.body.splitFrom).toEqual({ batchId: r2.batchId, lotCode: r2.lotCode });
      expect(part.body).toMatchObject({ portionsRemaining: 4, state: "fresh" });
    });

    it("the reprinted label of the part says where it comes from and keeps the production time", async () => {
      const reprint = await label(a.chef, child.newBatchId);
      const parentLabel = await label(a.chef, r2.batchId);
      expect(reprint.status).toBe(200);
      expect(reprint.body).toMatchObject({
        lotCode: child.lotCode,
        portions: 4,
        portionsRemaining: 4,
        splitFrom: { lotCode: r2.lotCode },
        producedAt: parentLabel.body.producedAt,
        operatorInitials: parentLabel.body.operatorInitials,
      });
      expect(parentLabel.body).toMatchObject({ portionsRemaining: 6, splitFrom: null });
    });

    it("more than is left, a fraction and an hour count outside 1 to 8760 are refused", async () => {
      const over = await split(a.chef, r2.batchId, { portions: 7, hoursFromNow: 24 });
      expect([over.status, over.error.code]).toEqual([409, "portions_insufficient"]);
      expect((await split(a.chef, r2.batchId, { portions: 1.5, hoursFromNow: 24 })).status).toBe(
        400,
      );
      expect((await split(a.chef, r2.batchId, { portions: 1, hoursFromNow: 0 })).status).toBe(400);
      expect((await split(a.chef, r2.batchId, { portions: 1, hoursFromNow: 8761 })).status).toBe(
        400,
      );
      expect(await remainingOf(r2.batchId)).toBe(6);
    });

    it("splitting into an unknown location is a 422 and writes nothing", async () => {
      const bad = await split(a.chef, r2.batchId, {
        portions: 1,
        hoursFromNow: 24,
        locationId: NO_ID,
      });
      expect([bad.status, bad.error.code]).toEqual([422, "location_not_found"]);
      expect(await remainingOf(r2.batchId)).toBe(6);
    });
  });

  describe("AT4: portions at zero finish the batch", () => {
    it("counting 0 finishes the batch and counting above 0 reopens it", async () => {
      r3 = await raguBatch();
      expect((await adjust(a.chef, r3.batchId, { counted: 0 })).body.state).toBe("finished");
      const finished = await detail(a.chef, r3.batchId);
      expect(finished.body).toMatchObject({ state: "finished", portionsRemaining: 0 });
      expect(finished.body.can).toMatchObject({ discard: false, split: false });

      const reopened = await adjust(a.chef, r3.batchId, { counted: 2 });
      expect(reopened.body).toMatchObject({ portionsRemaining: 2, state: "open" });
      expect((await adjust(a.chef, r3.batchId, { counted: 0 })).body.state).toBe("finished");
    });

    it("throwing away all the portions marks the batch discarded, and no more can be thrown", async () => {
      // A Brodo (its cost is incomplete: the salt was never bought), so this waste stays out of the priced
      // fixture of AT6 and shows there as the one unvalued operation.
      const brodo = await produce(a.chef, {
        recipeId: brodoRecipeId,
        outputQty: 5,
        locationId: f.cellaId,
        inputs: [
          { ingredientId: f.onionId, qty: 0.2, unit: "kg", locationId: f.cellaId },
          { ingredientId: f.saltId, qty: 30, unit: "g", locationId: f.cellaId },
        ],
      });
      expect(brodo.status).toBe(201);
      brodoBatch = brodo.body.batchId;
      const gone = await discard(a.chef, brodoBatch, { portions: 20, reason: "over_production" });
      expect(gone.status).toBe(201);
      expect(gone.body).toMatchObject({ portionsRemaining: 0, state: "discarded" });
      expect((await detail(a.chef, brodoBatch)).body.state).toBe("discarded");

      const more = await discard(a.chef, brodoBatch, { portions: 1, reason: "over_production" });
      expect([more.status, more.error.code]).toEqual([409, "portions_insufficient"]);
    });

    it("splitting every portion finishes the parent", async () => {
      const whole = await raguBatch();
      const result = await split(a.chef, whole.batchId, { portions: 10, hoursFromNow: 72 });
      expect(result.status).toBe(201);
      // No location given on a two-location tenant: the part stays where its parent is (Cella).
      expect(result.body).toMatchObject({
        portionsRemaining: 0,
        state: "finished",
        locationId: f.cellaId,
      });
      expect((await remainingOf(whole.batchId)) + (await remainingOf(result.body.newBatchId))).toBe(
        10,
      );
    });
  });

  describe("AT5: the staff meal is confirmed once a business day", () => {
    it("the chef sets a rule for the Ragù: 201 when new, 200 when saved again", async () => {
      const created = await saveRule(a.chef, { recipeKey: raguKey, defaultCount: 2 });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ kind: "recipe", targetId: raguKey, defaultCount: 2 });
      raguRuleId = created.body.ruleId;
      const again = await saveRule(a.chef, { recipeKey: raguKey, defaultCount: 2 });
      expect([again.status, again.body.ruleId]).toEqual([200, raguRuleId]);
    });

    it("the rule list shows the portions available and nothing confirmed yet", async () => {
      const { status, body } = await rules(a.chef);
      expect(status).toBe(200);
      expect(body.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const rule = body.rules.find((r) => r.ruleId === raguRuleId)!;
      expect(rule).toMatchObject({
        name: "Ragù (demo)",
        unit: "porzioni",
        defaultCount: 2,
        isActive: true,
        today: null,
      });
      expect(rule.available).toBeGreaterThanOrEqual(2);
    });

    it("confirming takes 2 portions from the oldest batch; the second confirmation is a 409", async () => {
      const before = await remainingOf(r1.batchId);
      const first = await confirm(a.chef, raguRuleId);
      expect(first.status).toBe(201);
      expect(first.body.count).toBe(2);
      expect(first.body.movements).toHaveLength(1);
      expect(first.body.movements[0]).toMatchObject({ batchId: r1.batchId });
      expect(await remainingOf(r1.batchId)).toBe(before - 2);

      const second = await confirm(a.chef, raguRuleId);
      expect([second.status, second.error.code]).toEqual([409, "staff_meal_already_confirmed"]);
      expect(second.error.message).toBe("Già confermato per oggi.");
      expect(await remainingOf(r1.batchId)).toBe(before - 2);

      const listed = await rules(a.chef);
      const today = listed.body.rules.find((r) => r.ruleId === raguRuleId)!.today;
      expect(today).toMatchObject({ confirmationId: first.body.confirmationId, count: 2 });
    });

    it("two confirmations at the same moment: one 201, one 409, one row on each ledger", async () => {
      // Tenant A has two locations: a rule with no location cannot be saved (it could never be confirmed).
      const ambiguous = await saveRule(a.owner, {
        ingredientId: paneId,
        defaultCount: 0.5,
        unit: "kg",
      });
      expect([ambiguous.status, ambiguous.error.code]).toEqual([422, "location_required"]);
      const created = await saveRule(a.owner, {
        ingredientId: paneId,
        defaultCount: 0.5,
        unit: "kg",
        locationId: f.cellaId,
      });
      expect(created.status).toBe(201);
      expect(created.body.locationId).toBe(f.cellaId);
      paneRuleId = created.body.ruleId;
      const [one, two] = await Promise.all([
        confirm(a.chef, paneRuleId),
        confirm(a.owner, paneRuleId),
      ]);
      expect([one.status, two.status].sort()).toEqual([201, 409]);
      const loser = one.status === 409 ? one : two;
      expect(loser.error.code).toBe("staff_meal_already_confirmed");
      const winner = one.status === 201 ? one : two;

      const confirmations = await stack.admin
        .from("staff_meal_confirmation")
        .select("id")
        .eq("rule_id", paneRuleId);
      expect(confirmations.data).toHaveLength(1);
      const moves = await stack.admin
        .from("stock_movement")
        .select("qty, reason_code")
        .eq("ref_type", "staff_meal")
        .eq("ref_id", winner.body.confirmationId);
      expect(moves.data).toHaveLength(1);
      expect(Number(moves.data![0]!.qty)).toBeCloseTo(-0.5, 4);
      expect(moves.data![0]!.reason_code).toBe("staff_meal");
    });

    it("an inactive rule cannot be confirmed", async () => {
      const off = await saveRule(a.chef, { recipeKey: raguKey, defaultCount: 2, isActive: false });
      expect(off.body.isActive).toBe(false);
      const refused = await confirm(a.chef, raguRuleId);
      expect(refused.status).toBe(409);
      // Back on, as the report below does not depend on it.
      expect((await saveRule(a.chef, { recipeKey: raguKey, defaultCount: 2 })).body.isActive).toBe(
        true,
      );
    });
  });

  describe("AT6: the waste report in EUR adds raw and batch waste by reason", () => {
    it("matches the hand-computed fixture: 12,20 EUR, of which 2,20 raw and 10,00 batch, one unvalued operation", async () => {
      // The raw side: onion 0,5 kg spoilage (0,50) and carrot 0,2 kg expired (0,20), by the owner.
      for (const [ingredient, qty, reason] of [
        [f.onionId, 0.5, "spoilage"],
        [f.carrotId, 0.2, "expired"],
      ] as const) {
        const wasted = await a.owner.client.rpc("post_waste", {
          p_ingredient: ingredient,
          p_qty: qty,
          p_unit: "kg",
          p_reason: reason,
          p_location: f.cellaId,
        });
        expect(wasted.error).toBeNull();
      }
      const { status, body } = await wasteCosts(a.owner);
      expect(status).toBe(200);
      expect(body.valueEur).toBeCloseTo(12.2, 4);
      expect(body.rawValueEur).toBeCloseTo(2.2, 4);
      expect(body.batchValueEur).toBeCloseTo(10, 4);
      expect(body.unvaluedCount).toBe(1);

      const reason = (code: string) => body.reasons.find((r) => r.reasonCode === code)!;
      expect(reason("spoilage").valueEur).toBeCloseTo(6.5, 4);
      expect(reason("spoilage").rawValueEur).toBeCloseTo(0.5, 4);
      expect(reason("spoilage").batchValueEur).toBeCloseTo(6, 4);
      expect(reason("spoilage").batchLines).toEqual([
        expect.objectContaining({ recipeName: "Ragù (demo)", portions: 3 }),
      ]);
      expect(reason("spoilage").batchLines[0]!.valueEur).toBeCloseTo(6, 4);
      expect(reason("staff_meal").valueEur).toBeCloseTo(5.5, 4);
      expect(reason("staff_meal").rawValueEur).toBeCloseTo(1.5, 4);
      expect(reason("staff_meal").batchValueEur).toBeCloseTo(4, 4);
      expect(reason("expired").valueEur).toBeCloseTo(0.2, 4);
      expect(reason("over_production").batchLines).toEqual([
        expect.objectContaining({ recipeName: "Brodo (demo)", portions: 20, valueEur: null }),
      ]);
      // Largest first.
      const values = body.reasons.map((r) => r.valueEur);
      expect(values).toEqual([...values].sort((x, y) => y - x));
    });

    it("the admin reads the report; the chef and the waiter get 403", async () => {
      expect((await wasteCosts(a.admin)).status).toBe(200);
      expect((await wasteCosts(a.chef)).status).toBe(403);
      expect((await wasteCosts(a.waiter)).status).toBe(403);
    });
  });

  describe("Q16 = project V6: the chef sees no euro", () => {
    it("none of the chef's M15 answers has a euro sign or a cost-like key", () => {
      expect(chefTexts.length).toBeGreaterThan(20);
      for (const text of chefTexts) {
        expect(text).not.toContain("€");
        expect(keysOf(JSON.parse(text)).filter((key) => COSTLY.test(key))).toEqual([]);
      }
    });

    it("the chef cannot write the ledgers directly or read the batch cost", async () => {
      const insert = await a.chef.client
        .from("batch_movement")
        .insert({ tenant_id: a.id, batch_id: r1.batchId, type: "count", portions: 1 });
      expect(insert.error?.code).toBe("42501");
      const costs = await a.chef.client.from("batch_cost").select("batch_id");
      expect(costs.data).toEqual([]);
      const reasons = await a.chef.client.rpc("waste_costs", { p_from: day(-1), p_to: today });
      expect(reasons.error?.code).toBe("42501");
    });
  });

  describe("roles and tenancy", () => {
    it("the waiter gets 403 on every M15 route and 42501 from the procedures", async () => {
      expect((await detail(a.waiter, r1.batchId)).status).toBe(403);
      expect((await adjust(a.waiter, r1.batchId, { counted: 1 })).status).toBe(403);
      expect(
        (await discard(a.waiter, r1.batchId, { portions: 1, reason: "spoilage" })).status,
      ).toBe(403);
      expect((await split(a.waiter, r1.batchId, { portions: 1, hoursFromNow: 24 })).status).toBe(
        403,
      );
      expect((await rules(a.waiter)).status).toBe(403);
      expect((await saveRule(a.waiter, { recipeKey: raguKey, defaultCount: 1 })).status).toBe(403);
      expect((await confirm(a.waiter, raguRuleId)).status).toBe(403);
      for (const [name, args] of [
        ["adjust_batch", { p_batch: r1.batchId, p_counted: 1 }],
        ["discard_batch", { p_batch: r1.batchId, p_portions: 1, p_reason: "spoilage" }],
        ["split_batch", { p_batch: r1.batchId, p_portions: 1, p_hours_from_now: 24 }],
        ["batch_detail", { p_batch: r1.batchId }],
        ["staff_meal_rules", {}],
        ["confirm_staff_meal", { p_rule: raguRuleId }],
      ] as const) {
        const rpc = await a.waiter.client.rpc(name, args);
        expect([name, rpc.error?.code]).toEqual([name, "42501"]);
      }
    });

    it("owner B gets 404 for tenant A's batch and rule, and sees no rules of his own", async () => {
      expect((await detail(b.owner, r1.batchId)).status).toBe(404);
      expect((await label(b.owner, r1.batchId)).status).toBe(404);
      expect((await adjust(b.owner, r1.batchId, { counted: 1 })).status).toBe(404);
      expect((await discard(b.owner, r1.batchId, { portions: 1, reason: "spoilage" })).status).toBe(
        404,
      );
      expect((await split(b.owner, r1.batchId, { portions: 1, hoursFromNow: 24 })).status).toBe(
        404,
      );
      expect((await confirm(b.owner, raguRuleId)).status).toBe(404);
      const own = await rules(b.owner);
      expect(own.status).toBe(200);
      expect(own.body.rules).toEqual([]);
      const costs = await wasteCosts(b.owner);
      expect([costs.status, costs.body.valueEur]).toEqual([200, 0]);
      expect(await remainingOf(r1.batchId)).toBeGreaterThan(0);
    });
  });
});
