import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CloseResult, CountSessionDetail } from "@/server/counts/types";
import type { DraftResponse, HistoryResponse } from "@/server/opening/output";
import type { IngredientCostsResponse } from "@/server/costing/ingredients";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";
import { approveWithLots, seedLocation, seedSupplier } from "./helpers/invoices";
import { minutesToRomeMidnight, waitPastRomeMidnight } from "../helpers/rome-midnight";

// Opening stock, step 18 (docs/plans/2026-11-18-opening-stock.md §5): the carico iniziale end to end on the real local stack, through the
// real route handlers (schemas, role checks, error mapping, the procedures, RLS, the append-only ledger). Only
// `createSupabaseServerClient` is replaced, so each call runs with the signed-in test user's own client. The secret key is used for
// fixtures only (ingredients, the invoice to approve), never to write what the code under test writes. Fake data only.
//
// The tests run in order and share state. Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const draftRoute = await import("@/app/api/stock/opening/draft/route");
const draftLinesRoute = await import("@/app/api/stock/opening/draft/lines/route");
const draftLineRoute = await import("@/app/api/stock/opening/draft/lines/[id]/route");
const confirmRoute = await import("@/app/api/stock/opening/confirm/route");
const historyRoute = await import("@/app/api/stock/opening/history/route");
const reverseRoute = await import("@/app/api/stock/opening/[id]/reverse/route");
const stockRoute = await import("@/app/api/stock/route");
const movementsRoute = await import("@/app/api/stock/movements/route");
const costsRoute = await import("@/app/api/costs/ingredients/route");
const approveRoute = await import("@/app/api/invoices/[id]/approve/route");
const countsRoute = await import("@/app/api/counts/route");
const countLinesRoute = await import("@/app/api/counts/[id]/lines/route");
const countCloseRoute = await import("@/app/api/counts/[id]/close/route");

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
  const body = JSON.parse(text) as T;
  return {
    status: response.status,
    body,
    text,
    error: (body as { error?: Reply["error"] }).error as Reply["error"],
  };
}

// What a quantity answer must never carry (V6): a key that names money.
const COST_LIKE_KEY = /"[^"]*(cost|price|eur|value|amount|margin)[^"]*"\s*:/i;

/** Sleeps past the business-day cut-off (02:00 by default) when it is under two minutes away, so the run stays on one business day. */
async function waitPastCutoff(cutoffMinutes = 120) {
  const sinceMidnight = 24 * 60 - minutesToRomeMidnight();
  const toCutoff = (cutoffMinutes - sinceMidnight + 24 * 60) % (24 * 60);
  if (toCutoff < 2) await new Promise((resolve) => setTimeout(resolve, toCutoff * 60_000 + 1_000));
}

describe.skipIf(!env)("opening stock on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let supplierId: string;
  let dispensaId: string;
  let flourId: string;
  let oilId: string;
  let today: string;
  let firstOpeningId: string;
  const flourLine = randomUUID();
  const oilLine = randomUUID();
  const firstRequest = randomUUID();

  const getDraft = (user: TestUser) =>
    call<DraftResponse>(user, draftRoute.GET as Handler, "/api/stock/opening/draft");
  const putLines = (user: TestUser, lines: Record<string, unknown>[]) =>
    call(user, draftLinesRoute.PUT as Handler, "/api/stock/opening/draft/lines", {
      method: "PUT",
      body: { lines },
    });
  const confirm = (user: TestUser, body: Record<string, unknown>) =>
    call<{ openingId: string; changed: boolean; lineCount: number; totalValueEur: number }>(
      user,
      confirmRoute.POST as Handler,
      "/api/stock/opening/confirm",
      { method: "POST", body },
    );
  const history = (user: TestUser, locationId: string) =>
    call<HistoryResponse>(
      user,
      historyRoute.GET as Handler,
      `/api/stock/opening/history?locationId=${locationId}`,
    );
  const onHand = async (ingredientId: string) => {
    const stock = await call<{
      items: { ingredientId: string; locations: { locationId: string; onHandQty: number }[] }[];
    }>(a.owner, stockRoute.GET as Handler, `/api/stock?location=${dispensaId}`);
    expect(stock.status).toBe(200);
    return (
      stock.body.items
        .find((i) => i.ingredientId === ingredientId)
        ?.locations.find((l) => l.locationId === dispensaId)?.onHandQty ?? null
    );
  };
  const flourCost = async () => {
    const costs = await call<IngredientCostsResponse>(
      a.owner,
      costsRoute.GET as Handler,
      "/api/costs/ingredients",
    );
    expect(costs.status).toBe(200);
    return costs.body.ingredients.find((i) => i.id === flourId)!;
  };
  const draftLine = (id: string, ingredientId: string, qty: number, unitCostEur: number) => ({
    id,
    locationId: dispensaId,
    ingredientId,
    qty,
    unitCostEur,
  });
  const confirmLines = (lines: ReturnType<typeof draftLine>[]) =>
    lines.map(({ id, ingredientId, qty, unitCostEur }) => ({ id, ingredientId, qty, unitCostEur }));

  async function newIngredient(name: string, unit: "kg" | "l"): Promise<string> {
    const made = await stack.admin
      .from("ingredient")
      .insert({ tenant_id: a.id, name, base_unit: unit })
      .select("id")
      .single();
    expect(made.error).toBeNull();
    return made.data!.id as string;
  }

  beforeAll(async () => {
    await waitPastRomeMidnight();
    await waitPastCutoff();
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    supplierId = await seedSupplier(stack.admin, a.id);
    dispensaId = await seedLocation(stack.admin, a.id);
    await seedLocation(stack.admin, b.id);
    flourId = await newIngredient("Farina 00 (demo)", "kg");
    oilId = await newIngredient("Olio EVO (demo)", "l");
  }, 180_000);

  it("owner PUTs two Dispensa lines, GETs the draft, POSTs confirm, and the stock shows the quantities while the cost list shows 0,80 with costSource 'opening'", async () => {
    const lines = [draftLine(flourLine, flourId, 25, 0.8), draftLine(oilLine, oilId, 10, 6.5)];
    expect((await putLines(a.owner, lines)).status).toBe(200);
    const draft = await getDraft(a.owner);
    expect(draft.status).toBe(200);
    today = draft.body.today;
    const dispensa = draft.body.locations.find((l) => l.locationId === dispensaId)!;
    expect(dispensa.lineCount).toBe(2);
    expect(dispensa.totalValueEur).toBe(85);
    expect(dispensa.bookable).toBe(true);
    expect(draft.body.booked).toBe(false);

    // Proof that the draft match is enforced: a confirm with a stale quantity books nothing.
    const stale = await confirm(a.owner, {
      locationId: dispensaId,
      effectiveOn: today,
      requestId: randomUUID(),
      lines: confirmLines([draftLine(flourLine, flourId, 24, 0.8), lines[1]!]),
    });
    expect(stale.status).toBe(409);
    expect(stale.error.code).toBe("opening_draft_changed");
    expect((await onHand(flourId)) ?? 0).toBe(0);

    const booked = await confirm(a.owner, {
      locationId: dispensaId,
      effectiveOn: today,
      requestId: firstRequest,
      lines: confirmLines(lines),
    });
    expect(booked.status).toBe(201);
    expect(booked.body.changed).toBe(true);
    expect(booked.body.lineCount).toBe(2);
    firstOpeningId = booked.body.openingId;

    expect(await onHand(flourId)).toBe(25);
    expect(await onHand(oilId)).toBe(10);
    const cost = await flourCost();
    expect(cost.unitCostEur).toBe(0.8);
    expect(cost.purchasesUsed).toBe(0);
    expect(cost.costSource).toBe("opening");
    expect((await getDraft(a.owner)).body.booked).toBe(true);
  }, 60_000);

  it("a second confirm with the same requestId is a 200 replay with changed false, and books nothing more", async () => {
    const replay = await confirm(a.owner, {
      locationId: dispensaId,
      effectiveOn: today,
      requestId: firstRequest,
      lines: confirmLines([
        draftLine(flourLine, flourId, 25, 0.8),
        draftLine(oilLine, oilId, 10, 6.5),
      ]),
    });
    expect(replay.status).toBe(200);
    expect(replay.body.changed).toBe(false);
    expect(replay.body.openingId).toBe(firstOpeningId);
    expect(await onHand(flourId)).toBe(25);
  });

  it("reverse with qty_wrong restores the lines to the draft; the rebooked, corrected draft gives the corrected balances", async () => {
    const reversed = await call<{ restoredLineIds: string[] }>(
      a.owner,
      reverseRoute.POST as Handler,
      `/api/stock/opening/${firstOpeningId}/reverse`,
      { method: "POST", body: { reason: "qty_wrong" }, params: { id: firstOpeningId } },
    );
    expect(reversed.status).toBe(201);
    expect(reversed.body.restoredLineIds).toHaveLength(2);
    expect((await onHand(flourId)) ?? 0).toBe(0);

    const draft = await getDraft(a.owner);
    const restored = draft.body.locations.find((l) => l.locationId === dispensaId)!.lines;
    expect(restored.map((l) => [l.ingredientId, l.qty]).sort()).toEqual(
      [
        [flourId, 25],
        [oilId, 10],
      ].sort(),
    );
    const flour = restored.find((l) => l.ingredientId === flourId)!;
    const oil = restored.find((l) => l.ingredientId === oilId)!;
    const corrected = [
      draftLine(flour.id, flourId, 24, 0.8),
      draftLine(oil.id, oilId, oil.qty, oil.unitCostEur),
    ];
    expect((await putLines(a.owner, [corrected[0]!])).status).toBe(200);
    const rebooked = await confirm(a.owner, {
      locationId: dispensaId,
      effectiveOn: today,
      requestId: randomUUID(),
      lines: confirmLines(corrected),
    });
    expect(rebooked.status).toBe(201);
    expect(await onHand(flourId)).toBe(24);
    expect(await onHand(oilId)).toBe(10);

    const ops = (await history(a.owner, dispensaId)).body.operations;
    expect(ops).toHaveLength(2);
    expect(ops.find((o) => o.openingId === firstOpeningId)?.reversed?.reasonCode).toBe("qty_wrong");
  }, 60_000);

  it("an approved invoice for Farina switches its cost to costSource 'invoice' at the invoice price", async () => {
    const approved = await approveWithLots(
      stack.admin,
      a.id,
      {
        supplierId,
        date: today,
        lines: [
          {
            description: "FARINA",
            ingredientId: flourId,
            qty: 10,
            unit: "kg",
            unitPrice: 1.2,
            lotCode: "L-FARINA",
          },
        ],
      },
      async (invoiceId) =>
        (
          await call(a.owner, approveRoute.POST as Handler, `/api/invoices/${invoiceId}/approve`, {
            method: "POST",
            body: { locationId: dispensaId },
            params: { id: invoiceId },
          })
        ).status,
    );
    expect(approved.status).toBe(200);
    const cost = await flourCost();
    expect(cost.unitCostEur).toBe(1.2);
    expect(cost.purchasesUsed).toBe(1);
    expect(cost.costSource).toBe("invoice");
    expect(await onHand(flourId)).toBe(34);
  }, 60_000);

  it("after a closed monthly count at Dispensa, a draft PUT and a confirm there are 409 opening_location_counted", async () => {
    // A line put in the draft BEFORE the count: post_opening_stock checks the draft match (step 5) before the cut-off (step 8), so the confirm
    // below matches the draft and reaches opening_check_bookable instead of stopping at opening_draft_changed.
    const late = draftLine(randomUUID(), flourId, 1, 0.8);
    expect((await putLines(a.owner, [late])).status).toBe(200);
    const started = await call<CountSessionDetail>(
      a.chef,
      countsRoute.POST as Handler,
      "/api/counts",
      {
        method: "POST",
        body: { type: "monthly", locationId: dispensaId },
      },
    );
    expect(started.status).toBe(201);
    const countId = started.body.id;
    const counted = started.body.lines.map((line) => ({
      ingredientId: line.ingredientId,
      qty: line.expectedNowQty,
      unit: line.baseUnit,
    }));
    const saved = await call(
      a.chef,
      countLinesRoute.PUT as Handler,
      `/api/counts/${countId}/lines`,
      {
        method: "PUT",
        body: { lines: counted },
        params: { id: countId },
      },
    );
    expect(saved.status).toBe(200);
    const closed = await call<CloseResult>(
      a.chef,
      countCloseRoute.POST as Handler,
      `/api/counts/${countId}/close`,
      { method: "POST", body: {}, params: { id: countId } },
    );
    expect(closed.status).toBe(200);

    const put = await putLines(a.owner, [{ ...late, qty: 2 }]);
    expect(put.status).toBe(409);
    expect(put.error.code).toBe("opening_location_counted");
    const booked = await confirm(a.owner, {
      locationId: dispensaId,
      effectiveOn: today,
      requestId: randomUUID(),
      lines: confirmLines([late]),
    });
    expect(booked.status).toBe(409);
    expect(booked.error.code).toBe("opening_location_counted");
    expect(await onHand(flourId)).toBe(34);
  }, 60_000);

  it("the chef gets 403 on every opening route, and reads Farina's history with the 'opening' rows but no cost key", async () => {
    const id = randomUUID();
    const refused = [
      await getDraft(a.chef),
      await call(
        a.chef,
        draftRoute.DELETE as Handler,
        `/api/stock/opening/draft?locationId=${dispensaId}`,
        {
          method: "DELETE",
        },
      ),
      await putLines(a.chef, [draftLine(id, flourId, 1, 1)]),
      await call(a.chef, draftLineRoute.DELETE as Handler, `/api/stock/opening/draft/lines/${id}`, {
        method: "DELETE",
        params: { id },
      }),
      await confirm(a.chef, {
        locationId: dispensaId,
        effectiveOn: today,
        requestId: randomUUID(),
        lines: confirmLines([draftLine(id, flourId, 1, 1)]),
      }),
      await history(a.chef, dispensaId),
      await call(
        a.chef,
        reverseRoute.POST as Handler,
        `/api/stock/opening/${firstOpeningId}/reverse`,
        {
          method: "POST",
          body: { reason: "qty_wrong" },
          params: { id: firstOpeningId },
        },
      ),
    ];
    expect(refused.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403]);

    const movements = await call<{ operations: { type: string }[] }>(
      a.chef,
      movementsRoute.GET as Handler,
      `/api/stock/movements?ingredient=${flourId}`,
    );
    expect(movements.status).toBe(200);
    expect(movements.body.operations.map((o) => o.type)).toContain("opening");
    expect(movements.text).not.toMatch(COST_LIKE_KEY);
  }, 60_000);

  it("B's owner sees none of A's opening data and cannot book into A's location", async () => {
    const draft = await getDraft(b.owner);
    expect(draft.status).toBe(200);
    expect(draft.body.locations.map((l) => l.locationId)).not.toContain(dispensaId);
    expect(draft.body.booked).toBe(false);
    expect(draft.body.lineCount).toBe(0);
    const theirs = await history(b.owner, dispensaId);
    expect(theirs.status).toBe(422);
    expect(theirs.error.code).toBe("location_not_found");
    const intrude = await confirm(b.owner, {
      locationId: dispensaId,
      effectiveOn: today,
      requestId: randomUUID(),
      lines: confirmLines([draftLine(randomUUID(), flourId, 1, 1)]),
    });
    expect([404, 422]).toContain(intrude.status);
    expect(await onHand(flourId)).toBe(34);
  }, 60_000);
});
