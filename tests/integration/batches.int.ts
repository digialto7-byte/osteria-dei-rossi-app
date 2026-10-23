import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, venueDate } from "@/lib/time/venue-date";
import type { AlertList } from "@/server/alerts/list";
import type { BatchLabel, BatchProposal, ProduceResult } from "@/server/batches/types";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";
import { approveWithLots } from "./helpers/invoices";
import { seedBatchFixture, type BatchFixture } from "./helpers/batches";

// M14 acceptance tests 1 to 5 and 7, the shortfall and tenancy against the real local stack. The batch routes run for
// real (schemas, role checks, error mapping, produce_batch and the reads, the FEFO engine, the lot lock, the frozen
// cost, RLS, append-only triggers); only `createSupabaseServerClient` is replaced, because it would read cookies from a
// Next.js request. Each call runs inside an AsyncLocalStorage context that carries the signed-in test user's own client
// (publishable key + that user's JWT), so two calls can be in flight at once (AT4 sends two productions together).
// Fixtures arrive the production way: recipes through POST /api/recipes, lots through an approved invoice. The secret
// key reads stock_movement, v_batch_portions and batch_input only to prove what the ledgers hold. Fake data only.
//
// The tests run in order and share state (tenant A: 6 kg of beef in two lots, onion and carrot at 1,00 EUR/kg).
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
const basisRoute = await import("@/app/api/ingredients/[id]/cost-basis/route");
const proposalRoute = await import("@/app/api/batches/proposal/route");
const batchesRoute = await import("@/app/api/batches/route");
const labelRoute = await import("@/app/api/batches/[id]/label/route");
const alertsRoute = await import("@/app/api/alerts/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  text: string;
  error: { code: string; message: string; details?: Array<{ ingredientId: string }> };
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

interface BatchRow {
  batchId: string;
  lotCode: string;
  portionsRemaining: number;
  cost?: { totalEur: number | null; perPortionEur: number | null; incomplete: boolean };
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
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 3)
    .map((word) => word[0]!.toUpperCase())
    .join("");
const seqOf = (lotCode: string) => Number(/-(\d+)$/.exec(lotCode)![1]);

describe.skipIf(!env)("batch production on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let f: BatchFixture;
  let stewRecipeId: string;
  let brodoRecipeId: string;
  let firstBatch: ProduceResult;

  const proposal = (user: TestUser, key: string, query = "") =>
    call<BatchProposal>(
      user,
      proposalRoute.GET as Handler,
      `/api/batches/proposal?recipeKey=${key}${query}`,
    );
  const produce = (user: TestUser, body: object) =>
    call<ProduceResult>(user, batchesRoute.POST as Handler, "/api/batches", {
      method: "POST",
      body,
    });
  const list = (user: TestUser) =>
    call<{ items: BatchRow[]; nextCursor: string | null }>(
      user,
      batchesRoute.GET as Handler,
      "/api/batches",
    );
  const label = (user: TestUser, id: string) =>
    call<BatchLabel>(user, labelRoute.GET as Handler, `/api/batches/${id}/label`, {
      params: { id },
    });
  const approve = async (invoiceId: string, locationId: string) =>
    (
      await call(a.owner, approveRoute.POST as Handler, `/api/invoices/${invoiceId}/approve`, {
        method: "POST",
        body: { locationId },
        params: { id: invoiceId },
      })
    ).status;
  const stewInputs = (beef: number, onion: number, carrot: number) => [
    { ingredientId: f.beefId, qty: beef, unit: "kg" },
    { ingredientId: f.onionId, qty: onion, unit: "kg" },
    { ingredientId: f.carrotId, qty: carrot, unit: "kg" },
  ];
  /** Rows of the batch's consumption movements, read with the secret key. */
  const consumption = async (ingredientId: string, batchId: string) => {
    const read = await stack.admin
      .from("stock_movement")
      .select("qty, raw_lot_id")
      .eq("ref_type", "batch")
      .eq("ref_id", batchId)
      .eq("ingredient_id", ingredientId);
    expect(read.error).toBeNull();
    return read.data ?? [];
  };
  const batchMovementCount = async () => {
    const read = await stack.admin
      .from("stock_movement")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", a.id)
      .eq("ref_type", "batch");
    expect(read.error).toBeNull();
    return read.count ?? 0;
  };

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    f = await seedBatchFixture(stack.admin, a.id, {
      createRecipe: (body) =>
        call(a.owner, recipesRoute.POST as Handler, "/api/recipes", {
          method: "POST",
          body,
        }) as Promise<{
          status: number;
          body: { recipe: { key: string } };
        }>,
      approve,
      day,
    });
    // The version ids the production names come from the proposals.
    stewRecipeId = (await proposal(a.chef, f.stewKey)).body.recipe.id;
    brodoRecipeId = (await proposal(a.chef, f.brodoKey)).body.recipe.id;
  }, 180_000);

  describe("AT2: the proposal", () => {
    it("scales the recipe to 6,2 kg: beef 5,1667, onion 0,31, carrot 0,2067, water 1,0333, 31 portions", async () => {
      const { status, body } = await proposal(a.chef, f.stewKey, "&outputQty=6.2");
      expect(status).toBe(200);
      const byName = new Map(body.inputs.map((input) => [input.name, input]));
      expect(byName.get("Manzo muscolo (demo)")?.proposedQty).toBe(5.1667);
      expect(byName.get("Cipolla (demo)")?.proposedQty).toBe(0.31);
      expect(byName.get("Carota (demo)")?.proposedQty).toBe(0.2067);
      expect(byName.get("Acqua (demo)")).toMatchObject({ proposedQty: 1.0333, isStock: false });
      expect(body.portionsComputed).toBe(31);
      expect(body.recipe.portionSize).toBe(0.2);
      expect(
        byName.get("Manzo muscolo (demo)")!.lots.map((lot) => `${lot.lotCode}:${lot.onHandQty}`),
      ).toEqual(["L-D2:3", "L-D5:3"]);
      expect(body.suggestedLocationId).toBe(f.cellaId);
    });
  });

  describe("AT1 and the label: the stew, with the confirmed 5,3 kg of beef", () => {
    it("the chef produces; the beef is reduced by exactly 5,3 kg, not by the proposed 5,1667", async () => {
      const { status, body } = await produce(a.chef, {
        recipeId: stewRecipeId,
        outputQty: 6.2,
        inputs: stewInputs(5.3, 0.31, 0.2067),
      });
      expect(status).toBe(201);
      firstBatch = body;
      expect(body).toMatchObject({ portions: 31, portionsComputed: 31, negatives: [] });
      const rows = await consumption(f.beefId, body.batchId);
      expect(rows.reduce((sum, row) => sum + Number(row.qty), 0)).toBeCloseTo(-5.3, 4);
      const portions = await stack.admin
        .from("v_batch_portions")
        .select("portions_remaining")
        .eq("batch_id", body.batchId)
        .single();
      expect(Number(portions.data?.portions_remaining)).toBe(31);
    });

    it("every batch_input mirrors its movement", async () => {
      const inputs = await stack.admin
        .from("batch_input")
        .select("qty, raw_lot_id, stock_movement_id")
        .eq("batch_id", firstBatch.batchId);
      expect(inputs.error).toBeNull();
      expect(inputs.data).toHaveLength(4); // beef over two lots, onion, carrot
      const moves = await stack.admin
        .from("stock_movement")
        .select("id, qty, raw_lot_id")
        .eq("ref_id", firstBatch.batchId);
      for (const input of inputs.data!) {
        const move = moves.data!.find((m) => m.id === input.stock_movement_id)!;
        expect(Number(input.qty)).toBe(-Number(move.qty));
        expect(input.raw_lot_id).toBe(move.raw_lot_id);
      }
    });

    it("the chef reads the label text: six facts, the producer's initials, no cost", async () => {
      const { status, body, text } = await label(a.chef, firstBatch.batchId);
      expect(status).toBe(200);
      expect(body).toMatchObject({
        recipeName: "Spezzatino (demo)",
        portions: 31,
        lotCode: firstBatch.lotCode,
        operatorInitials: initialsOf("Demo chef Osteria Demo A"),
        shelfLifeHours: 72,
      });
      expect(keysOf(body).filter((key) => COSTLY.test(key))).toEqual([]);
      expect(text).not.toContain("€");
    });
  });

  describe("AT3: all or nothing", () => {
    it("an input naming an empty lot is a 409 lot_empty and no beef movement is added", async () => {
      // An onion lot that is received and then written off entirely.
      const supplied = await approveWithLots(
        stack.admin,
        a.id,
        {
          supplierId: f.supplierId,
          date: day(-1),
          lines: [
            {
              description: "Cipolla L-EMPTY",
              ingredientId: f.onionId,
              qty: 1,
              unit: "kg",
              unitPrice: 1,
              lotCode: "L-EMPTY",
              expiry: day(9),
            },
          ],
        },
        (invoiceId) => approve(invoiceId, f.cellaId),
      );
      expect(supplied.status).toBe(200);
      const lot = await a.chef.client
        .from("raw_lot")
        .select("id")
        .eq("lot_code", "L-EMPTY")
        .single();
      expect(lot.error).toBeNull();
      const wasted = await a.owner.client.rpc("post_waste", {
        p_ingredient: f.onionId,
        p_qty: 1,
        p_unit: "kg",
        p_reason: "spoilage",
        p_location: f.cellaId,
        p_lot: lot.data!.id,
      });
      expect(wasted.error).toBeNull();

      const before = await batchMovementCount();
      const failed = await produce(a.chef, {
        recipeId: stewRecipeId,
        outputQty: 6.2,
        inputs: [
          { ingredientId: f.beefId, qty: 0.5, unit: "kg" },
          { ingredientId: f.onionId, qty: 0.31, unit: "kg", lotId: lot.data!.id },
          { ingredientId: f.carrotId, qty: 0.2067, unit: "kg" },
        ],
      });
      expect([failed.status, failed.error.code]).toEqual([409, "lot_empty"]);
      expect(failed.error.details).toEqual([{ ingredientId: f.onionId }]);
      expect(await batchMovementCount()).toBe(before);
    });
  });

  describe("AT4: lot codes", () => {
    it("two productions one after the other are numbered one apart", async () => {
      const first = await produce(a.chef, {
        recipeId: stewRecipeId,
        outputQty: 0.6,
        inputs: stewInputs(0.5, 0.03, 0.02),
      });
      const second = await produce(a.chef, {
        recipeId: stewRecipeId,
        outputQty: 0.6,
        inputs: stewInputs(0.5, 0.03, 0.02),
      });
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(first.body.lotCode).toMatch(/^\d{6}-SPEZZA-\d+$/);
      expect(seqOf(second.body.lotCode)).toBe(seqOf(first.body.lotCode) + 1);
      expect(seqOf(first.body.lotCode)).toBe(seqOf(firstBatch.lotCode) + 1);
    });

    it("two productions at the same moment get two distinct codes and no 409", async () => {
      const body = { recipeId: stewRecipeId, outputQty: 0.6, inputs: stewInputs(0.5, 0.03, 0.02) };
      const [one, two] = await Promise.all([produce(a.chef, body), produce(a.owner, body)]);
      expect([one.status, two.status]).toEqual([201, 201]);
      const seqs = [seqOf(one.body.lotCode), seqOf(two.body.lotCode)].sort((x, y) => x - y);
      expect(seqs[1]).toBe(seqs[0]! + 1);
      expect(one.body.lotCode).not.toBe(two.body.lotCode);
    });
  });

  describe("AT5: a price change does not move the frozen cost", () => {
    const costOf = async (user: TestUser, batchId: string) =>
      (await list(user)).body.items.find((item) => item.batchId === batchId)?.cost;

    it("the owner reads 53,5167 and 1,7263 per portion for the first batch", async () => {
      expect(await costOf(a.owner, firstBatch.batchId)).toEqual({
        totalEur: 53.5167,
        perPortionEur: 1.7263,
        incomplete: false,
      });
    });

    it("after a purchase at 20,00 the same batch is unchanged and a new batch freezes the new price", async () => {
      const put = await call(
        a.admin,
        basisRoute.PUT as Handler,
        `/api/ingredients/${f.beefId}/cost-basis`,
        { method: "PUT", body: { basis: "last_price" }, params: { id: f.beefId } },
      );
      expect(put.status).toBe(200);
      const bought = await approveWithLots(
        stack.admin,
        a.id,
        {
          supplierId: f.supplierId,
          date: today,
          lines: [
            {
              description: "Manzo caro",
              ingredientId: f.beefId,
              qty: 3,
              unit: "kg",
              unitPrice: 20,
              lotCode: "L-D20",
              expiry: day(6),
            },
          ],
        },
        (invoiceId) => approve(invoiceId, f.cellaId),
      );
      expect(bought.status).toBe(200);
      expect((await costOf(a.owner, firstBatch.batchId))?.totalEur).toBe(53.5167);

      const next = await produce(a.chef, {
        recipeId: stewRecipeId,
        outputQty: 6.2,
        inputs: stewInputs(5.3, 0.31, 0.2067),
      });
      expect(next.status).toBe(201);
      expect(await costOf(a.owner, next.body.batchId)).toEqual({
        totalEur: 106.5167,
        perPortionEur: 3.436,
        incomplete: false,
      });
      expect((await costOf(a.owner, firstBatch.batchId))?.totalEur).toBe(53.5167);
    });

    it("an input that was never bought makes the cost incomplete, never 0", async () => {
      const brodo = await produce(a.chef, {
        recipeId: brodoRecipeId,
        outputQty: 5,
        inputs: [
          { ingredientId: f.onionId, qty: 0.2, unit: "kg" },
          { ingredientId: f.saltId, qty: 30, unit: "g" },
        ],
      });
      expect(brodo.status).toBe(201);
      expect(await costOf(a.owner, brodo.body.batchId)).toEqual({
        totalEur: null,
        perPortionEur: null,
        incomplete: true,
      });
    });
  });

  describe("AT7 and Q16: roles", () => {
    it("the chef reads no batch_cost row, writes no batch, and his list has no cost", async () => {
      const seen = await a.chef.client.from("batch_cost").select("batch_id");
      expect(seen.error).toBeNull();
      expect(seen.data).toEqual([]);
      const owner = await a.owner.client.from("batch_cost").select("batch_id");
      expect((owner.data ?? []).length).toBeGreaterThan(0);
      const insert = await a.chef.client.from("batch").insert({ tenant_id: a.id, lot_code: "X-1" });
      expect(insert.error?.code).toBe("42501");
      const chefList = await list(a.chef);
      expect(chefList.status).toBe(200);
      expect(chefList.body.items.length).toBeGreaterThan(0);
      expect(keysOf(chefList.body).filter((key) => COSTLY.test(key))).toEqual([]);
      expect(chefList.text).not.toContain("€");
      const costs = await a.chef.client.rpc("batch_costs", { p_batch_ids: [firstBatch.batchId] });
      expect(costs.error?.code).toBe("42501");
    });

    it("the admin reads the cost like the owner", async () => {
      const row = (await list(a.admin)).body.items.find((i) => i.batchId === firstBatch.batchId);
      expect(row?.cost?.totalEur).toBe(53.5167);
    });

    it("the waiter gets 403 on the four routes and 42501 from the procedures", async () => {
      expect((await proposal(a.waiter, f.stewKey)).status).toBe(403);
      expect(
        (
          await produce(a.waiter, {
            recipeId: stewRecipeId,
            outputQty: 6,
            inputs: stewInputs(1, 1, 1),
          })
        ).status,
      ).toBe(403);
      expect((await list(a.waiter)).status).toBe(403);
      expect((await label(a.waiter, firstBatch.batchId)).status).toBe(403);
      const rpc = await a.waiter.client.rpc("produce_batch", {
        p_recipe_id: stewRecipeId,
        p_output_qty: 6,
        p_inputs: [],
      });
      expect(rpc.error?.code).toBe("42501");
      for (const table of ["batch", "batch_input", "batch_movement", "batch_cost"]) {
        const read = await a.waiter.client.from(table).select("*");
        expect([table, (read.data ?? []).length]).toEqual([table, 0]);
      }
    });
  });

  describe("a shortfall is recorded, not refused", () => {
    it("beef beyond the stock is a 201 with the negative location, and the chef sees the alert", async () => {
      const { status, body } = await produce(a.chef, {
        recipeId: stewRecipeId,
        outputQty: 6,
        inputs: stewInputs(50, 0.3, 0.2),
      });
      expect(status).toBe(201);
      expect(body.negatives.map((n) => n.ingredientId)).toContain(f.beefId);
      expect(body.negatives[0]!.onHandQty).toBeLessThan(0);
      const alerts = await call<AlertList>(
        a.chef,
        alertsRoute.GET as Handler,
        "/api/alerts?filter=all",
      );
      expect(alerts.status).toBe(200);
      expect(
        alerts.body.alerts
          .filter((alert) => alert.kind === "negative_stock")
          .map((alert) => alert.title),
      ).toContain("Scorta negativa: Manzo muscolo (demo)");
    });
  });

  describe("tenancy", () => {
    it("owner B cannot propose, produce or read the label for tenant A, and B's list is empty", async () => {
      expect((await proposal(b.owner, f.stewKey)).status).toBe(404);
      expect(
        (
          await produce(b.owner, {
            recipeId: stewRecipeId,
            outputQty: 6,
            inputs: stewInputs(1, 1, 1),
          })
        ).status,
      ).toBe(404);
      expect((await label(b.owner, firstBatch.batchId)).status).toBe(404);
      expect((await label(b.owner, NO_ID)).status).toBe(404);
      const own = await list(b.owner);
      expect(own.status).toBe(200);
      expect(own.body.items).toEqual([]);
    });
  });
});
