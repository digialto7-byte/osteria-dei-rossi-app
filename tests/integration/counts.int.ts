import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { venueDate } from "@/lib/time/venue-date";
import type {
  CancelResult,
  CloseResult,
  CountLineEntry,
  CountSessionDetail,
  Reconciliation,
  Variance,
  VarianceCosts,
} from "@/server/counts/types";
import type { AuditLog } from "@/server/audit/types";
import type { AlertList } from "@/server/alerts/list";
import type { OutflowResult, ReverseResult, TransferResult } from "@/server/stock/types";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";
import { approveWithLots, seedLocation, seedSupplier } from "./helpers/invoices";
import { waitPastRomeMidnight } from "../helpers/rome-midnight";

// M13 acceptance tests 1 to 5 and V6 against the real local stack: counts, the variance and reconciliation reports,
// the activity log and the clean half of the nightly check. The routes run for real (schemas, role checks, error
// mapping, the procedures, the posting engine, RLS, append-only triggers); only `createSupabaseServerClient` is
// replaced, because it would read cookies from a Next.js request: each call is handed the signed-in test user's own
// client. Stock arrives the production way (an approved invoice with lots); the secret key reads stock_movement and
// alert only to prove what the routes did, never to write. The drift half of AT5 (a seeded inconsistency, every
// check, the job health) lives in pgTAP 117: it needs a superuser to seed the inconsistency and a controlled
// app.job_run, and the shared local stack holds other suites' runs.
//
// The tests run in order and share state. Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const approveRoute = await import("@/app/api/invoices/[id]/approve/route");
const wasteRoute = await import("@/app/api/stock/waste/route");
const transfersRoute = await import("@/app/api/stock/transfers/route");
const reverseRoute = await import("@/app/api/stock/movements/[id]/reverse/route");
const countsRoute = await import("@/app/api/counts/route");
const countRoute = await import("@/app/api/counts/[id]/route");
const linesRoute = await import("@/app/api/counts/[id]/lines/route");
const closeRoute = await import("@/app/api/counts/[id]/close/route");
const cancelRoute = await import("@/app/api/counts/[id]/cancel/route");
const criticalRoute = await import("@/app/api/counts/critical/route");
const varianceRoute = await import("@/app/api/reports/variance/route");
const varianceCostsRoute = await import("@/app/api/reports/variance-costs/route");
const reconciliationRoute = await import("@/app/api/reports/reconciliation/route");
const auditRoute = await import("@/app/api/audit/route");
const alertsRoute = await import("@/app/api/alerts/route");

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

// What a quantity answer must never carry (V6): a key that names money, and the euro sign.
const COST_LIKE_KEY = /"[^"]*(cost|price|eur|value|amount|margin)[^"]*"\s*:/i;

// Set in beforeAll, after waiting past Rome midnight: computed at load they could name the day that has just ended.
let today: string;
let monthStart: string;
let startedAt: number;

describe.skipIf(!env)("counts on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let cellaId: string;
  let freezerId: string;
  const ingredient = {} as Record<"beef" | "flour" | "eggs" | "oil", string>;
  let flourDaily: CloseResult;
  let monthly: CloseResult;
  let monthlyId: string;
  let dailyId: string;

  const startCount = (user: TestUser, type: "daily" | "monthly") =>
    call<CountSessionDetail>(user, countsRoute.POST as Handler, "/api/counts", {
      method: "POST",
      body: { type, locationId: cellaId },
    });
  const getCount = (user: TestUser, id: string) =>
    call<CountSessionDetail>(user, countRoute.GET as Handler, `/api/counts/${id}`, {
      params: { id },
    });
  const saveLines = (
    user: TestUser,
    id: string,
    lines: { ingredientId: string; qty: number | null; unit: string }[],
  ) =>
    call<{ lines: CountLineEntry[] }>(user, linesRoute.PUT as Handler, `/api/counts/${id}/lines`, {
      method: "PUT",
      body: { lines },
      params: { id },
    });
  const closeCount = (user: TestUser, id: string) =>
    call<CloseResult>(user, closeRoute.POST as Handler, `/api/counts/${id}/close`, {
      method: "POST",
      body: {},
      params: { id },
    });
  const setCritical = (user: TestUser, ingredientId: string, critical: boolean) =>
    call(user, criticalRoute.PATCH as Handler, "/api/counts/critical", {
      method: "PATCH",
      body: { ingredientId, critical },
    });
  const rpc = (user: TestUser, fn: string, args: Record<string, unknown>) =>
    user.client.rpc(fn, args);

  async function newIngredient(name: string, unit: "kg" | "l" | "pz" = "kg"): Promise<string> {
    const made = await stack.admin
      .from("ingredient")
      .insert({ tenant_id: a.id, name, base_unit: unit })
      .select("id")
      .single();
    expect(made.error).toBeNull();
    return made.data!.id as string;
  }

  async function approve(
    supplierId: string,
    lines: {
      description: string;
      ingredientId: string;
      qty: number;
      unit: "kg" | "l" | "pz";
    }[],
  ) {
    const approved = await approveWithLots(
      stack.admin,
      a.id,
      {
        supplierId,
        date: today,
        lines: lines.map((line) => ({ ...line, unitPrice: 10, lotCode: `L-${line.description}` })),
      },
      async (invoiceId) =>
        (
          await call(a.owner, approveRoute.POST as Handler, `/api/invoices/${invoiceId}/approve`, {
            method: "POST",
            body: { locationId: cellaId },
            params: { id: invoiceId },
          })
        ).status,
    );
    expect(approved.status).toBe(200);
  }

  /** Every movement of tenant A at Cella, read with the secret key. */
  async function ledger() {
    const read = await stack.admin
      .from("stock_movement")
      .select("ingredient_id, type, qty, effective_on, ref_type, ref_id")
      .eq("tenant_id", a.id)
      .eq("location_id", cellaId)
      .range(0, 4999);
    expect(read.error).toBeNull();
    return (read.data ?? []) as {
      ingredient_id: string;
      type: string;
      qty: number;
      effective_on: string;
      ref_type: string;
      ref_id: string;
    }[];
  }

  beforeAll(async () => {
    await waitPastRomeMidnight();
    today = venueDate(new Date());
    monthStart = `${today.slice(0, 8)}01`;
    startedAt = Date.now();
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    const supplierId = await seedSupplier(stack.admin, a.id);
    cellaId = await seedLocation(stack.admin, a.id);
    const second = await stack.admin
      .from("location")
      .insert({ tenant_id: a.id, name: "Freezer" })
      .select("id")
      .single();
    expect(second.error).toBeNull();
    freezerId = second.data!.id as string;
    await seedLocation(stack.admin, b.id);

    ingredient.beef = await newIngredient("Manzo muscolo (demo)");
    ingredient.flour = await newIngredient("Farina di mais (demo)");
    ingredient.eggs = await newIngredient("Uova (demo)", "pz");
    ingredient.oil = await newIngredient("Olio EVO (demo)", "l");
    await approve(supplierId, [
      { description: "BEEF", ingredientId: ingredient.beef, qty: 10, unit: "kg" },
      { description: "FLOUR", ingredientId: ingredient.flour, qty: 25, unit: "kg" },
      { description: "EGGS", ingredientId: ingredient.eggs, qty: 60, unit: "pz" },
      { description: "OIL", ingredientId: ingredient.oil, qty: 10, unit: "l" },
    ]);
  }, 180_000);

  describe("AT1: opening + receipts - consumption - waste +/- adjustments = counted, for every ingredient", () => {
    it("the month of real operations: waste, a reversed waste, a shortfall, a transfer, a daily and a monthly count", async () => {
      // Waste 1,5 kg of beef, reversed; then waste 2 kg.
      const first = await call<OutflowResult>(
        a.chef,
        wasteRoute.POST as Handler,
        "/api/stock/waste",
        {
          method: "POST",
          body: {
            ingredientId: ingredient.beef,
            qty: 1.5,
            unit: "kg",
            reason: "spoilage",
            locationId: cellaId,
          },
        },
      );
      expect(first.status).toBe(201);
      const undo = await call<ReverseResult>(
        a.chef,
        reverseRoute.POST as Handler,
        `/api/stock/movements/${first.body.movements[0]!.id}/reverse`,
        { method: "POST", body: {}, params: { id: first.body.movements[0]!.id } },
      );
      expect(undo.status).toBe(201);
      const second = await call<OutflowResult>(
        a.chef,
        wasteRoute.POST as Handler,
        "/api/stock/waste",
        {
          method: "POST",
          body: {
            ingredientId: ingredient.beef,
            qty: 2,
            unit: "kg",
            reason: "spoilage",
            locationId: cellaId,
          },
        },
      );
      expect(second.status).toBe(201);

      // Consumption beyond the stock: 70 eggs from 60 (a shortfall of 10 on the unlotted bucket) and 4 kg of flour.
      for (const [id, qty, unit] of [
        [ingredient.eggs, 70, "pz"],
        [ingredient.flour, 4, "kg"],
      ] as const) {
        const consumed = await rpc(a.owner, "consume_raw_fefo", {
          p_ingredient: id,
          p_qty: qty,
          p_unit: unit,
          p_location: cellaId,
        });
        expect(consumed.error).toBeNull();
      }

      // Transfer 2 kg of beef to the Freezer.
      const moved = await call<TransferResult>(
        a.chef,
        transfersRoute.POST as Handler,
        "/api/stock/transfers",
        {
          method: "POST",
          body: {
            ingredientId: ingredient.beef,
            qty: 2,
            unit: "kg",
            fromLocationId: cellaId,
            toLocationId: freezerId,
          },
        },
      );
      expect(moved.status).toBe(201);

      // A daily count of the flour (the chef flags it critical): counted 20, expected 21.
      expect((await setCritical(a.chef, ingredient.flour, true)).status).toBe(200);
      const daily = await startCount(a.chef, "daily");
      expect(daily.status).toBe(201);
      dailyId = daily.body.id;
      expect(daily.body.lines.map((l) => l.ingredientId)).toEqual([ingredient.flour]);
      const entered = await saveLines(a.chef, dailyId, [
        { ingredientId: ingredient.flour, qty: 20, unit: "kg" },
      ]);
      expect(entered.status).toBe(200);
      expect(entered.body.lines[0]).toMatchObject({
        expectedQty: 21,
        countedQty: 20,
        differenceQty: -1,
      });
      const closedDaily = await closeCount(a.chef, dailyId);
      expect(closedDaily.status).toBe(200);
      flourDaily = closedDaily.body;
      expect(flourDaily.linesWithDifference).toBe(1);
      expect((await setCritical(a.chef, ingredient.flour, false)).status).toBe(200);

      // The monthly count: everything as expected but 0,2 kg less beef and no eggs at all.
      const month = await startCount(a.chef, "monthly");
      expect(month.status).toBe(201);
      monthlyId = month.body.id;
      const lines = month.body.lines.map((line) => {
        const qty =
          line.ingredientId === ingredient.beef
            ? Math.round((line.expectedNowQty - 0.2) * 10_000) / 10_000
            : line.ingredientId === ingredient.eggs
              ? 0
              : line.expectedNowQty;
        return { ingredientId: line.ingredientId, qty, unit: line.baseUnit };
      });
      expect(lines).toHaveLength(4);
      expect((await saveLines(a.chef, monthlyId, lines)).status).toBe(200);
      const closedMonthly = await closeCount(a.chef, monthlyId);
      expect(closedMonthly.status).toBe(200);
      monthly = closedMonthly.body;
      expect(monthly.linesWithDifference).toBe(2);
    }, 120_000);

    it("the reconciliation balances for every ingredient, and each column equals the fold of the ledger by type", async () => {
      const report = await call<Reconciliation>(
        a.owner,
        reconciliationRoute.GET as Handler,
        `/api/reports/reconciliation?from=${monthStart}&to=${today}&location=${cellaId}`,
      );
      expect(report.status).toBe(200);
      expect(report.body.items).toHaveLength(4);
      const rows = await ledger();
      for (const item of report.body.items) {
        expect(item.balanced, item.name).toBe(true);
        expect(item.matchesCount, item.name).toBe(true);
        expect(item.otherQty, item.name).toBe(0);
        const mine = rows.filter((r) => r.ingredient_id === item.ingredientId);
        const sum = (pick: (r: (typeof mine)[number]) => boolean) =>
          Math.round(mine.filter(pick).reduce((total, r) => total + Number(r.qty), 0) * 10_000) /
          10_000;
        expect(item.openingQty, item.name).toBe(sum((r) => r.effective_on < monthStart));
        expect(item.receiptsQty, item.name).toBe(sum((r) => r.type === "receipt"));
        expect(item.consumptionQty, item.name).toBe(-sum((r) => r.type === "consumption") || 0);
        expect(item.wasteQty, item.name).toBe(-sum((r) => r.type === "waste") || 0);
        expect(item.transfersInQty, item.name).toBe(sum((r) => r.type === "transfer" && r.qty > 0));
        expect(item.transfersOutQty, item.name).toBe(
          -sum((r) => r.type === "transfer" && r.qty < 0) || 0,
        );
        expect(item.countAdjustmentsQty, item.name).toBe(sum((r) => r.type === "count"));
        expect(item.closingQty, item.name).toBe(sum(() => true));
        expect(item.countedQty, item.name).not.toBeNull();
        expect(
          item.openingQty +
            item.receiptsQty -
            item.consumptionQty -
            item.wasteQty +
            item.transfersInQty -
            item.transfersOutQty +
            item.countAdjustmentsQty,
          `${item.name}: the PRD identity`,
        ).toBeCloseTo(item.countedQty!, 4);
      }
    });
  });

  describe("AT2: a daily count of 20 critical items posts movements only where actual differs from expected", () => {
    const names = Array.from(
      { length: 20 },
      (_, i) => `Ingrediente critico ${String(i + 1).padStart(2, "0")} (demo)`,
    );
    const ids: string[] = [];
    let sessionId: string;
    const different = new Map([
      [3, 4.5],
      [7, 5.25],
      [11, 0],
      [15, 6],
      [19, 4.9],
    ]);

    it("flags 20 ingredients through PATCH /api/counts/critical, and the list shows 20", async () => {
      const supplierId = (
        await stack.admin.from("supplier").select("id").eq("tenant_id", a.id).single()
      ).data!.id as string;
      for (const name of names) ids.push(await newIngredient(name));
      await approve(
        supplierId,
        ids.map((id, i) => ({
          description: `C${i + 1}`,
          ingredientId: id,
          qty: 5,
          unit: "kg" as const,
        })),
      );
      for (const id of ids) expect((await setCritical(a.chef, id, true)).status).toBe(200);
      const listed = await call<{ items: unknown[]; criticalCount: number }>(
        a.chef,
        criticalRoute.GET as Handler,
        "/api/counts/critical",
      );
      expect(listed.status).toBe(200);
      expect(listed.body.criticalCount).toBe(20);
    }, 120_000);

    it("counts 15 as expected and 5 differently; the close posts rows for exactly those 5", async () => {
      const started = await startCount(a.chef, "daily");
      expect(started.status).toBe(201);
      sessionId = started.body.id;
      expect(started.body.lines).toHaveLength(20);
      const lines = started.body.lines.map((line) => {
        const index = names.indexOf(line.name) + 1;
        return { ingredientId: line.ingredientId, qty: different.get(index) ?? 5, unit: "kg" };
      });
      expect((await saveLines(a.chef, sessionId, lines)).status).toBe(200);
      const closed = await closeCount(a.chef, sessionId);
      expect(closed.status).toBe(200);
      expect(closed.body.linesWithDifference).toBe(5);
      const posted = await stack.admin
        .from("stock_movement")
        .select("ingredient_id")
        .eq("tenant_id", a.id)
        .eq("type", "count")
        .eq("ref_id", sessionId);
      expect(posted.error).toBeNull();
      const wanted = [...different.keys()].map((index) => ids[index - 1]!).sort();
      expect(
        [...new Set((posted.data ?? []).map((r) => r.ingredient_id as string))].sort(),
      ).toEqual(wanted);
    }, 120_000);

    it("AT3: closing the closed count again is a 409 and posts nothing more", async () => {
      const before = (await ledger()).length;
      const again = await closeCount(a.chef, sessionId);
      expect(again.status).toBe(409);
      expect(again.error.code).toBe("count_closed");
      expect((await ledger()).length).toBe(before);
    });

    it("a cancelled count cannot be closed either, and posts nothing", async () => {
      const started = await startCount(a.owner, "daily");
      expect(started.status).toBe(201);
      const cancelled = await call<CancelResult>(
        a.owner,
        cancelRoute.POST as Handler,
        `/api/counts/${started.body.id}/cancel`,
        { method: "POST", body: {}, params: { id: started.body.id } },
      );
      expect(cancelled.status).toBe(200);
      const closed = await closeCount(a.owner, started.body.id);
      expect(closed.status).toBe(409);
      expect(closed.error.code).toBe("count_cancelled");
    });
  });

  describe("AT4: the activity log lists who did what and when", () => {
    async function everyEntry(user: TestUser, query = "") {
      const entries: AuditLog["entries"] = [];
      let before = "";
      for (let page = 0; page < 20; page += 1) {
        const reply = await call<AuditLog>(
          user,
          auditRoute.GET as Handler,
          `/api/audit?from=${today}&to=${today}${query}${before}`,
        );
        expect(reply.status).toBe(200);
        entries.push(...reply.body.entries);
        if (!reply.body.nextCursor) break;
        before = `&before=${encodeURIComponent(reply.body.nextCursor)}`;
      }
      return entries;
    }

    it("the owner sees the waste, the transfer, the reversal, the counts and the critical flags, with names and times", async () => {
      const entries = await everyEntry(a.owner);
      const byAction = (action: string) => entries.filter((e) => e.action === action);
      expect(byAction("waste").length).toBeGreaterThanOrEqual(2);
      expect(byAction("transfer")).toHaveLength(1);
      expect(byAction("reversal")).toHaveLength(1);
      expect(byAction("count").length).toBeGreaterThanOrEqual(3);
      expect(byAction("count_session.closed").length).toBeGreaterThanOrEqual(3);
      expect(byAction("ingredient.critical_changed").length).toBeGreaterThanOrEqual(22);
      for (const entry of byAction("waste")) expect(entry.byName).toBe("Demo chef Osteria Demo A");
      expect(byAction("count_session.closed")[0]!.entityLabel).toBe("Cella");
      for (const entry of entries) {
        const at = Date.parse(entry.at);
        expect(at, entry.action).toBeGreaterThanOrEqual(startedAt - 2_000);
        expect(at, entry.action).toBeLessThanOrEqual(Date.now() + 2_000);
      }
      const transfer = byAction("transfer")[0]!;
      expect(transfer.locationNames).toEqual(["Cella", "Freezer"]);
      expect(transfer.qty).toBe(2);
    });

    it("kind=stock and kind=events split the feed, and nothing carries before, after, reason or a cost", async () => {
      const stock = await everyEntry(a.owner, "&kind=stock");
      const events = await everyEntry(a.owner, "&kind=events");
      expect(stock.every((e) => e.kind === "stock")).toBe(true);
      expect(events.every((e) => e.kind === "event")).toBe(true);
      const text = JSON.stringify([...stock, ...events]);
      expect(text).not.toMatch(/"(before|after|reason)"\s*:/);
      expect(text).not.toMatch(COST_LIKE_KEY);
    });

    it("the chef and the waiter get 403, tenant B sees none of A's entries", async () => {
      for (const user of [a.chef, a.waiter]) {
        expect((await call(user, auditRoute.GET as Handler, "/api/audit")).status).toBe(403);
      }
      expect(await everyEntry(b.owner)).toEqual([]);
    });
  });

  describe("AT5 (clean half): the nightly check reports nothing wrong with the ledger", () => {
    it("with healthy runs recorded, the run raises no ledger_drift alert with a ledger check for tenant A", async () => {
      for (const job of ["alert-rules", "ledger-invariants"]) {
        const started = await stack.admin.rpc("job_run_start", { p_job: job });
        expect(started.error).toBeNull();
        const finished = await stack.admin.rpc("job_run_finish", {
          p_id: started.data,
          p_ok: true,
          p_error_code: null,
          p_items: 0,
        });
        expect(finished.error).toBeNull();
      }
      const run = await stack.admin.rpc("ledger_invariants_run", {});
      expect(run.error).toBeNull();
      // Read through the owner's own session: the secret key has no grant on `alert` by design.
      const drift = await a.owner.client
        .from("alert")
        .select("payload")
        .eq("tenant_id", a.id)
        .eq("kind", "ledger_drift");
      expect(drift.error).toBeNull();
      const LEDGER_KEYS = [
        "lot_receipt_missing",
        "receipt_lot_mismatch",
        "movement_user",
        "lot_negative",
        "reversal_mirror",
        "transfer_unbalanced",
        "count_mismatch",
      ];
      const keys = (drift.data ?? []).flatMap((row) =>
        ((row.payload as { checks?: { check_key: string }[] }).checks ?? []).map(
          (c) => c.check_key,
        ),
      );
      expect(keys.filter((key) => LEDGER_KEYS.includes(key))).toEqual([]);
      // The owner reads whatever was raised through the alerts route (it renders; a count never raises one itself).
      const listed = await call<AlertList>(
        a.owner,
        alertsRoute.GET as Handler,
        "/api/alerts?filter=all",
      );
      expect(listed.status).toBe(200);
    });
  });

  describe("V6: the chef never sees EUR; the variance in EUR is for owner and admin", () => {
    it("the chef's JSON from the counts, variance and reconciliation routes has no cost-like key and no euro sign", async () => {
      const replies = [
        await call(a.chef, countsRoute.GET as Handler, "/api/counts?status=all"),
        await getCount(a.chef, monthlyId),
        await call<Variance>(
          a.chef,
          varianceRoute.GET as Handler,
          `/api/reports/variance?session=${monthlyId}`,
        ),
        await call(
          a.chef,
          reconciliationRoute.GET as Handler,
          `/api/reports/reconciliation?from=${monthStart}&to=${today}&location=${cellaId}`,
        ),
        await call(a.chef, criticalRoute.GET as Handler, "/api/counts/critical"),
      ];
      for (const reply of replies) {
        expect(reply.status).toBe(200);
        expect(reply.text).not.toMatch(COST_LIKE_KEY);
        expect(reply.text).not.toContain("€");
      }
    });

    it("the variance in EUR: 403 for the chef and the waiter, numbers for the owner and the admin", async () => {
      const path = `/api/reports/variance-costs?session=${monthlyId}`;
      for (const user of [a.chef, a.waiter]) {
        expect((await call(user, varianceCostsRoute.GET as Handler, path)).status).toBe(403);
      }
      for (const user of [a.owner, a.admin]) {
        const reply = await call<VarianceCosts>(user, varianceCostsRoute.GET as Handler, path);
        expect(reply.status).toBe(200);
        // Beef -0,2 kg at 10,00 EUR/kg is a 2,00 loss; the eggs (+10 pz at 10,00) a gain of 100,00.
        expect(reply.body.lossEur).toBe(-2);
        expect(reply.body.gainEur).toBe(100);
        expect(reply.body.valueEur).toBe(98);
      }
    });

    it("the variance in quantities lists both differences", async () => {
      const reply = await call<Variance>(
        a.owner,
        varianceRoute.GET as Handler,
        `/api/reports/variance?session=${monthlyId}`,
      );
      expect(reply.status).toBe(200);
      const differing = reply.body.lines.filter((l) => l.differenceQty !== 0);
      expect(differing.map((l) => l.postedQty).sort((x, y) => x - y)).toEqual([-0.2, 10]);
      for (const line of reply.body.lines) expect(line.postedQty).toBe(line.differenceQty);
    });
  });

  describe("roles and tenancy", () => {
    it("the waiter is refused by every count route", async () => {
      expect((await call(a.waiter, countsRoute.GET as Handler, "/api/counts")).status).toBe(403);
      expect((await startCount(a.waiter, "daily")).status).toBe(403);
      expect((await call(a.waiter, auditRoute.GET as Handler, "/api/audit")).status).toBe(403);
    });

    it("another tenant's owner cannot reach a session: 404 for the view, the lines and the close", async () => {
      expect((await getCount(b.owner, monthlyId)).status).toBe(404);
      expect(
        (
          await saveLines(b.owner, monthlyId, [
            { ingredientId: ingredient.beef, qty: 1, unit: "kg" },
          ])
        ).status,
      ).toBe(404);
      expect((await closeCount(b.owner, monthlyId)).status).toBe(404);
      const listed = await call<{ sessions: unknown[] }>(
        b.owner,
        countsRoute.GET as Handler,
        "/api/counts",
      );
      expect(listed.body.sessions).toEqual([]);
    });

    it("the admin may count (Q1): starts a daily count and cancels it", async () => {
      const started = await startCount(a.admin, "daily");
      expect(started.status).toBe(201);
      const cancelled = await call<CancelResult>(
        a.admin,
        cancelRoute.POST as Handler,
        `/api/counts/${started.body.id}/cancel`,
        { method: "POST", body: {}, params: { id: started.body.id } },
      );
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe("cancelled");
    });

    it("the closed counts keep the results recorded when they were closed", () => {
      expect(flourDaily.linesCounted).toBe(1);
      expect(monthly.linesCounted).toBe(4);
      expect(dailyId).not.toBe(monthlyId);
    });
  });
});
