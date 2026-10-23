import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, venueDate } from "@/lib/time/venue-date";
import type { OutflowResult, ReverseResult, TransferResult } from "@/server/stock/types";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";
import { approveWithLots, seedLocation, seedSupplier } from "./helpers/invoices";
import {
  ModelError,
  StockModel,
  bucketKey,
  fromTicks,
  toTicks,
  type ModelRow,
} from "./helpers/stock-model";

// M12 AT2 against the real local stack: for random sequences of real procedure calls (waste, transfers, reversals,
// refused calls), v_stock_on_hand equals the fold of the movements AND an independent model of the ledger
// (helpers/stock-model.ts), and no lot is ever below zero. After every action, three checks, read through the owner's
// own session (RLS applies):
//   1. the rows of v_stock_on_hand equal the fold of every stock_movement row, summed here per ingredient, location, lot;
//   2. both equal the model's buckets, and the totals per ingredient and location equal the model's totals;
//   3. no lot bucket is below zero (a shortfall is booked on the unlotted bucket, never on a lot).
// Besides the state, every answer is compared with the model: the rows of an accepted call (lot, location, quantity, in
// order) and the code of a refused one. A hand-written seeded generator (mulberry32) keeps this free of dependencies. On
// a failure the seed and the whole action list are printed; STOCK_PROPERTY_SEED=<n> replays one sequence.
// Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

/** Sequences per run, and actions per sequence (plan §3.3). */
const PROPERTY_SEQUENCES = 20;
const PROPERTY_ACTIONS = 30;
/** The fixed CI list; a developer can add a failing seed here to keep it as a regression. */
const CI_SEEDS = Array.from({ length: PROPERTY_SEQUENCES }, (_, index) => 1001 + index * 7);

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const approveRoute = await import("@/app/api/invoices/[id]/approve/route");
const wasteRoute = await import("@/app/api/stock/waste/route");
const transfersRoute = await import("@/app/api/stock/transfers/route");
const reverseRoute = await import("@/app/api/stock/movements/[id]/reverse/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T> {
  status: number;
  body: T;
  code: string | undefined;
}

async function call<T>(
  user: TestUser,
  handler: Handler,
  path: string,
  body: unknown,
  params: Record<string, string> = {},
): Promise<Reply<T>> {
  session.client = user.client;
  const response = await handler(
    new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params) },
  );
  const parsed = (await response.json()) as T;
  return {
    status: response.status,
    body: parsed,
    code: (parsed as { error?: { code?: string } }).error?.code,
  };
}

/** mulberry32: a small seeded generator. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedsToRun = (): number[] => {
  const single = process.env.STOCK_PROPERTY_SEED;
  if (single !== undefined && single !== "") {
    const seed = Number(single);
    if (!Number.isInteger(seed)) throw new Error("STOCK_PROPERTY_SEED must be an integer");
    return [seed];
  }
  return CI_SEEDS;
};

const today = venueDate(new Date());
const NO_ID = "00000000-0000-4000-8000-000000000000";

interface LotRow {
  id: string;
  ingredient_id: string;
  expiry: string | null;
  received_on: string;
  qty_received: number;
}

describe.skipIf(!env)(
  "AT2: v_stock_on_hand is the fold of the movements (property test, real stack)",
  () => {
    let stack: Stack;
    let a: TestTenant;
    let supplierId: string;
    let cellaId: string;
    let freezerId: string;
    let counter = 0;

    async function newIngredient(name: string): Promise<string> {
      const made = await stack.admin
        .from("ingredient")
        .insert({ tenant_id: a.id, name, base_unit: "kg" })
        .select("id")
        .single();
      expect(made.error).toBeNull();
      return made.data!.id as string;
    }

    beforeAll(async () => {
      stack = await createStack(env!);
      a = stack.tenantA;
      supplierId = await seedSupplier(stack.admin, a.id);
      cellaId = await seedLocation(stack.admin, a.id);
      const second = await stack.admin
        .from("location")
        .insert({ tenant_id: a.id, name: "Freezer" })
        .select("id")
        .single();
      expect(second.error).toBeNull();
      freezerId = second.data!.id as string;
    }, 120_000);

    /** Reads the ledger and the view as the owner and checks the three invariants against the model. */
    async function checkInvariants(ingredients: string[], model: StockModel): Promise<void> {
      const view = await a.owner.client
        .from("v_stock_on_hand")
        .select("ingredient_id, location_id, raw_lot_id, qty_on_hand")
        .in("ingredient_id", ingredients)
        .range(0, 4999);
      expect(view.error).toBeNull();
      const ledger = await a.owner.client
        .from("stock_movement")
        .select("ingredient_id, location_id, raw_lot_id, qty")
        .in("ingredient_id", ingredients)
        .range(0, 4999);
      expect(ledger.error).toBeNull();

      const fromView = new Map<string, number>();
      for (const row of view.data ?? []) {
        const ticks = toTicks(Number(row.qty_on_hand));
        if (ticks !== 0)
          fromView.set(bucketKey(row.ingredient_id, row.location_id, row.raw_lot_id), ticks);
      }
      const fold = new Map<string, number>();
      for (const row of ledger.data ?? []) {
        const key = bucketKey(row.ingredient_id, row.location_id, row.raw_lot_id);
        fold.set(key, (fold.get(key) ?? 0) + toTicks(Number(row.qty)));
      }
      for (const [key, ticks] of fold) if (ticks === 0) fold.delete(key);

      expect(Object.fromEntries(fromView), "view = fold of the movements").toEqual(
        Object.fromEntries(fold),
      );
      expect(Object.fromEntries(fromView), "view = the model's buckets").toEqual(
        Object.fromEntries(model.buckets()),
      );
      const totals = new Map<string, number>();
      for (const [key, ticks] of fromView) {
        const [ingredient, location] = key.split("|") as [string, string];
        totals.set(
          `${ingredient}|${location}`,
          (totals.get(`${ingredient}|${location}`) ?? 0) + ticks,
        );
      }
      const modelTotals = new Map([...model.totals()].filter(([, ticks]) => ticks !== 0));
      expect(Object.fromEntries(totals), "totals per ingredient and location").toEqual(
        Object.fromEntries(modelTotals),
      );
      const negativeLots = [...fromView].filter(
        ([key, ticks]) => !key.endsWith("|null") && ticks < 0,
      );
      expect(negativeLots, "no lot bucket below zero").toEqual([]);
    }

    async function runSequence(seed: number, log: string[]): Promise<void> {
      const rng = mulberry32(seed);
      const int = (n: number) => Math.floor(rng() * n);
      const pick = <T>(items: readonly T[]): T => items[int(items.length)]!;
      const quarter = () => (1 + int(32)) / 4; // 0,25 to 8 kg
      log.push(`seed ${seed}`);

      // --- setup: one invoice, four lots over two ingredients (mixed expiries, some without) -----------------
      counter += 1;
      const ingA = await newIngredient(`Manzo ${seed}-${counter} (demo)`);
      const ingB = await newIngredient(`Farina ${seed}-${counter} (demo)`);
      const ingredients = [ingA, ingB];
      const expiry = () => (int(4) === 0 ? undefined : addDays(today, 1 + int(20)));
      const lines = [
        { description: "L1", ingredientId: ingA, lotCode: "A1", expiry: expiry() },
        { description: "L2", ingredientId: ingA, lotCode: "A2", expiry: expiry() },
        { description: "L3", ingredientId: ingB, lotCode: "B1", expiry: expiry() },
        { description: "L4", ingredientId: ingB, lotCode: "B2", expiry: expiry() },
      ].map((line) => ({ ...line, qty: quarter() + 1, unit: "kg" as const, unitPrice: 10 }));
      const approved = await approveWithLots(
        stack.admin,
        a.id,
        { supplierId, date: addDays(today, -1), lines },
        async (invoiceId) =>
          (
            await call(
              a.owner,
              approveRoute.POST as Handler,
              `/api/invoices/${invoiceId}/approve`,
              { locationId: cellaId },
              { id: invoiceId },
            )
          ).status,
      );
      log.push(`approve ${approved.status}`);
      expect(approved.status, log.join("\n")).toBe(200);

      const model = new StockModel();
      const lotRows = await a.owner.client
        .from("raw_lot")
        .select("id, ingredient_id, expiry, received_on, qty_received")
        .in("ingredient_id", ingredients);
      expect(lotRows.error).toBeNull();
      const lots = (lotRows.data ?? []) as LotRow[];
      expect(lots).toHaveLength(4);
      for (const lot of lots) {
        model.receive(
          {
            id: lot.id,
            ingredient: lot.ingredient_id,
            expiry: lot.expiry,
            receivedOn: lot.received_on,
          },
          cellaId,
          toTicks(Number(lot.qty_received)),
        );
      }
      const receiptMovements = await a.owner.client
        .from("stock_movement")
        .select("id, raw_lot_id")
        .in("ingredient_id", ingredients)
        .eq("type", "receipt");
      const receiptHandle = new Map<string, string>(
        (receiptMovements.data ?? []).map((row) => [`receipt-${row.raw_lot_id}`, row.id as string]),
      );
      const handles = new Map<string, string[]>(); // operation id -> its movement ids
      const lotIds = lots.map((lot) => lot.id);
      await checkInvariants(ingredients, model);

      const sameRows = (
        response: { lot: string | null; location: string; ticks: number }[],
        rows: ModelRow[],
        ordered: boolean,
      ) => {
        const show = (r: { lot: string | null; location: string; ticks: number }) =>
          `${r.lot ?? "null"}|${r.location}|${r.ticks}`;
        const got = response.map(show);
        const want = rows.map(show);
        return ordered ? [got, want] : [[...got].sort(), [...want].sort()];
      };
      const asRows = (movements: { rawLotId: string | null; locationId: string; qty: number }[]) =>
        movements.map((m) => ({ lot: m.rawLotId, location: m.locationId, ticks: toTicks(m.qty) }));

      // --- actions ---------------------------------------------------------------------------------------------
      for (let step = 1; step <= PROPERTY_ACTIONS; step += 1) {
        const user: TestUser = int(2) === 0 ? a.owner : a.chef;
        const roll = int(100);
        const ingredient = pick(ingredients);
        const lotsOf = lots.filter((lot) => lot.ingredient_id === ingredient).map((lot) => lot.id);
        let label: string;

        if (roll < 38) {
          // Waste, also beyond the stock, sometimes with an override lot (possibly empty or from the other ingredient).
          const location = pick([cellaId, freezerId]);
          const qty = quarter();
          const override = int(4) === 0 ? pick(int(8) === 0 ? lotIds : lotsOf) : undefined;
          label = `${step} waste ${user.role} ${ingredient === ingA ? "A" : "B"} ${qty} kg at ${location === cellaId ? "Cella" : "Freezer"}${override ? ` override ${override}` : ""}`;
          const reply = await call<OutflowResult>(
            user,
            wasteRoute.POST as Handler,
            "/api/stock/waste",
            {
              ingredientId: ingredient,
              qty,
              unit: "kg",
              reason: "spoilage",
              locationId: location,
              ...(override ? { lotId: override } : {}),
            },
          );
          log.push(`${label} -> ${reply.status}${reply.code ? ` ${reply.code}` : ""}`);
          if (reply.status === 201) {
            const rows = model.outflow(
              reply.body.operationId,
              ingredient,
              location,
              toTicks(qty),
              override,
            );
            expect(sameRows(asRows(reply.body.movements), rows, true)[0], log.join("\n")).toEqual(
              sameRows(asRows(reply.body.movements), rows, true)[1],
            );
            handles.set(
              reply.body.operationId,
              reply.body.movements.map((m) => m.id),
            );
            expect(reply.body.onHandQty, log.join("\n")).toBe(
              fromTicks(model.total(ingredient, location)),
            );
          } else {
            expectRefusal(
              reply,
              () => model.outflow("refused", ingredient, location, toTicks(qty), override),
              log,
            );
          }
        } else if (roll < 56) {
          // Transfer: within the stock, or beyond it (then refused with insufficient_stock), also beyond the location total.
          const [from, to] = int(2) === 0 ? [cellaId, freezerId] : [freezerId, cellaId];
          const positive = model
            .positiveBuckets(ingredient, from)
            .reduce((sum, bucket) => sum + bucket.ticks, 0);
          // A location with a shortfall (a negative unlotted bucket beside positive lots, reached by moving stock
          // into it) holds less than its positive lots: ask for more than the total but not more than the lots.
          const total = model.total(ingredient, from);
          const wanted =
            total < positive && int(2) === 0
              ? Math.max(toTicks(0.25), Math.ceil((total + 1) / 2500) * 2500)
              : int(5) === 0
                ? positive + toTicks(0.25)
                : Math.max(toTicks(0.25), Math.floor((positive * (1 + int(4))) / 4 / 2500) * 2500);
          const qty = fromTicks(wanted);
          const override = int(5) === 0 ? pick(lotsOf) : undefined;
          label = `${step} transfer ${user.role} ${ingredient === ingA ? "A" : "B"} ${qty} kg ${from === cellaId ? "Cella->Freezer" : "Freezer->Cella"}${override ? ` override ${override}` : ""}`;
          const reply = await call<TransferResult>(
            user,
            transfersRoute.POST as Handler,
            "/api/stock/transfers",
            {
              ingredientId: ingredient,
              qty,
              unit: "kg",
              fromLocationId: from,
              toLocationId: to,
              ...(override ? { lotId: override } : {}),
            },
          );
          log.push(`${label} -> ${reply.status}${reply.code ? ` ${reply.code}` : ""}`);
          if (reply.status === 201) {
            const rows = model.transfer(
              reply.body.operationId,
              ingredient,
              from,
              to,
              wanted,
              override,
            );
            expect(sameRows(asRows(reply.body.movements), rows, true)[0], log.join("\n")).toEqual(
              sameRows(asRows(reply.body.movements), rows, true)[1],
            );
            handles.set(
              reply.body.operationId,
              reply.body.movements.map((m) => m.id),
            );
          } else {
            expectRefusal(
              reply,
              () => model.transfer("refused", ingredient, from, to, wanted, override),
              log,
            );
          }
        } else if (roll < 94) {
          // Reverse any earlier operation: a waste, a transfer, a reversal (refused) or a receipt (refused).
          const known = [...handles.keys()];
          const receipts = [...receiptHandle.keys()];
          if (known.length === 0 && receipts.length === 0) continue;
          const target =
            int(10) === 0 && receipts.length > 0
              ? pick(receipts)
              : known.length > 0
                ? pick(known)
                : pick(receipts);
          const movementIds = receiptHandle.has(target)
            ? [receiptHandle.get(target)!]
            : handles.get(target)!;
          const movementId = pick(movementIds);
          label = `${step} reverse ${user.role} ${target} via ${movementId}`;
          const reply = await call<ReverseResult>(
            user,
            reverseRoute.POST as Handler,
            `/api/stock/movements/${movementId}/reverse`,
            {},
            { id: movementId },
          );
          log.push(`${label} -> ${reply.status}${reply.code ? ` ${reply.code}` : ""}`);
          if (reply.status === 201) {
            const rows = model.reverse(reply.body.operationId, target);
            expect(reply.body.reversedOperationId, log.join("\n")).toBe(target);
            const [got, want] = sameRows(asRows(reply.body.movements), rows, false);
            expect(got, log.join("\n")).toEqual(want);
            handles.set(
              reply.body.operationId,
              reply.body.movements.map((m) => m.id),
            );
          } else {
            expectRefusal(reply, () => model.reverse("refused", target), log);
          }
        } else {
          // A reversal of something that does not exist is a 404 and changes nothing.
          label = `${step} reverse unknown`;
          const reply = await call<ReverseResult>(
            user,
            reverseRoute.POST as Handler,
            `/api/stock/movements/${NO_ID}/reverse`,
            {},
            { id: NO_ID },
          );
          log.push(`${label} -> ${reply.status}`);
          expect(reply.status, log.join("\n")).toBe(404);
        }
        try {
          await checkInvariants(ingredients, model);
        } catch (error) {
          throw new Error(
            `Invariant broken after "${label}"\n${log.join("\n")}\n${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    /** A refused call: the model must refuse it too, with the same code (a lot that is not the ingredient's is a 404). */
    function expectRefusal(reply: Reply<unknown>, attempt: () => unknown, log: string[]): void {
      let modelCode: string | undefined;
      try {
        attempt();
      } catch (error) {
        if (error instanceof ModelError) modelCode = error.code;
        else throw error;
      }
      const detail = `${reply.status} ${reply.code}; the model says ${modelCode}\n${log.join("\n")}`;
      if (modelCode === "lot_not_found") {
        expect([reply.status, reply.code], detail).toEqual([404, "not_found"]);
        return;
      }
      expect([409, 422], detail).toContain(reply.status);
      expect(reply.code, detail).toBe(modelCode);
    }

    for (const seed of seedsToRun()) {
      it(`seed ${seed}: ${PROPERTY_ACTIONS} random actions keep the view equal to the fold, the model and non-negative lots`, async () => {
        const log: string[] = [];
        try {
          await runSequence(seed, log);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Property failed for STOCK_PROPERTY_SEED=${seed}: ${message}\nActions so far:\n${log.join("\n")}`,
          );
        }
      }, 240_000);
    }
  },
);
