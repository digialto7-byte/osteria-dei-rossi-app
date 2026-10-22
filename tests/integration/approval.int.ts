import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ExtractionEnv } from "@/lib/env";
import { runExtractionJob } from "@/server/cron/extract-job";
import { createExtractionClient } from "@/server/extraction/client";
import { storeInvoiceUpload } from "@/server/invoices/invoices";
import type { InvoiceReview, ReviewLine } from "@/server/invoices/review-types";
import { fakeAnthropicFetch, fixture, type FakeReply } from "../helpers/fake-anthropic-fetch";
import { fakePdf } from "../helpers/fake-files";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";

// M5 acceptance tests 1, 2, 3, 5, 6 and 7 against the real local stack: a reviewed invoice is
// approved through POST /api/invoices/:id/approve and the ledgers are read back through the owner's
// own client (RLS applies). The route handlers run for real (schemas, role check, error mapping,
// approve_invoice / reject_invoice, RLS, append-only triggers); only two things are replaced:
//   - the Anthropic API, by recorded responses behind a fake `fetch` (as in review.int.ts);
//   - `createSupabaseServerClient`, which would read cookies from a Next.js request, so each call
//     is handed the signed-in test user's own client (publishable key + that user's JWT).
// Fixtures that must bypass RLS (ingredients) and the AT6 attacks use the local secret key.
// Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const reviewRoute = await import("@/app/api/invoices/[id]/review/route");
const lineRoute = await import("@/app/api/invoices/[id]/lines/[lineId]/route");
const splitRoute = await import("@/app/api/invoices/[id]/lines/[lineId]/split/route");
const supplierRoute = await import("@/app/api/invoices/[id]/supplier/route");
const approveRoute = await import("@/app/api/invoices/[id]/approve/route");
const rejectRoute = await import("@/app/api/invoices/[id]/reject/route");
const centresRoute = await import("@/app/api/cost-centres/route");
const locationsRoute = await import("@/app/api/locations/route");

const PDF_MIME = "application/pdf";
const FAKE_ENV: ExtractionEnv = { anthropicApiKey: "test-key", modelId: "test-model" };
const FAR_FUTURE_MS = 24 * 3600 * 1000;
const NO_ID = "00000000-0000-4000-8000-000000000000";
/** The tables an approval writes; the audit trail is included. */
const LEDGERS = ["raw_lot", "stock_movement", "price_history", "payable", "audit_event"] as const;
/** The tables the chef and the waiter must not read (the chef reads lots, which carry no cost). */
const COST_TABLES = [
  "stock_movement",
  "v_stock_on_hand",
  "price_history",
  "payable",
  "audit_event",
] as const;

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply {
  status: number;
  body: Record<string, unknown>;
  review: InvoiceReview;
  error: { code: string; message: string };
}

/** One request to a real route handler, as the given user. */
async function call(
  user: TestUser,
  handler: Handler,
  path: string,
  init: { method?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<Reply> {
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
  const body = (await response.json()) as Record<string, unknown>;
  return {
    status: response.status,
    body,
    review: body.review as InvoiceReview,
    error: body.error as Reply["error"],
  };
}

const lineOf = (review: InvoiceReview, description: string): ReviewLine => {
  const found = review.lines.find((line) => line.rawDescription === description);
  if (!found) throw new Error(`No line "${description}" in the review`);
  return found;
};

interface MessageBody {
  content: { type: string; text: string }[];
  [key: string]: unknown;
}

/** A recorded response with the given header fields replaced, so scenarios never collide as duplicates. */
function fixtureWith(name: string, patch: Record<string, unknown>): FakeReply {
  const message = fixture(name) as MessageBody;
  const data = JSON.parse(message.content[0]!.text) as Record<string, unknown>;
  return {
    body: {
      ...message,
      content: [{ type: "text", text: JSON.stringify({ ...data, ...patch }) }],
    },
    status: 200,
  };
}

// The six lines of tests/fixtures/extraction/approval.json and the ingredient each is booked to
// (all measured in kg). "Parmigiano Reggiano 24 mesi" (3 kg) is split into two parts.
const INGREDIENTS = [
  "Fesa di manzo",
  "Zafferano in polvere",
  "Passata di pomodoro",
  "Burro",
  "Parmigiano stagionato",
  "Parmigiano grattugiato",
] as const;
const SPLIT = "Parmigiano Reggiano 24 mesi";
const NON_STOCK = "Detersivo piatti";

describe.skipIf(!env)("invoice approval on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  const uploadedAt = new Date();
  const RUN_TAG = randomUUID().slice(0, 8).toUpperCase();
  const number = (n: number) => `AP ${RUN_TAG}-${n}/2026`;

  const ingredientIds = new Map<string, string>();
  let mainId: string;
  let supplierId: string;
  let locationId: string;
  let mismatchId: string;
  let ownerUserId: string;

  async function parkQueue() {
    const parked = await stack.admin
      .from("invoice")
      .update({ next_attempt_at: new Date(Date.now() + FAR_FUTURE_MS).toISOString() })
      .eq("status", "received");
    expect(parked.error).toBeNull();
  }

  /** Uploads one invoice as owner A and runs the worker once with the given reply. */
  async function uploadAndExtract(reply: FakeReply): Promise<string> {
    await parkQueue();
    const stored = await storeInvoiceUpload(
      a.owner.client,
      { tenantId: a.id },
      { bytes: fakePdf(), declaredMime: PDF_MIME, filename: "fattura-demo.pdf" },
      uploadedAt,
    );
    const fake = fakeAnthropicFetch([reply]);
    const outcome = await runExtractionJob({
      admin: stack.admin,
      makeClient: (e) => createExtractionClient(e, fake.fetchImpl),
      readEnv: () => FAKE_ENV,
      now: Date.now,
    });
    expect(outcome).toMatchObject({ claimed: stored.id });
    return stored.id;
  }

  const getReview = async (id: string, user: TestUser = a.owner) => {
    const reply = await call(user, reviewRoute.GET, `/api/invoices/${id}/review`, {
      params: { id },
    });
    expect(reply.status).toBe(200);
    return reply.review;
  };

  const patchLine = (id: string, lineId: string, body: unknown, user: TestUser = a.owner) =>
    call(user, lineRoute.PATCH, `/api/invoices/${id}/lines/${lineId}`, {
      method: "PATCH",
      body,
      params: { id, lineId },
    });

  const approve = (id: string, body: unknown = {}, user: TestUser = a.owner) =>
    call(user, approveRoute.POST, `/api/invoices/${id}/approve`, {
      method: "POST",
      body,
      params: { id },
    });

  const reject = (id: string, body: unknown = {}, user: TestUser = a.owner) =>
    call(user, rejectRoute.POST, `/api/invoices/${id}/reject`, {
      method: "POST",
      body,
      params: { id },
    });

  /** Every row of a table or view as the given user sees it (RLS applies). */
  async function rowsOf(user: TestUser, table: string): Promise<Record<string, unknown>[]> {
    const read = await user.client.from(table).select("*");
    expect(read.error, `${user.role} reads ${table}`).toBeNull();
    return (read.data ?? []) as Record<string, unknown>[];
  }

  /** How many rows owner A sees in each ledger table: what "nothing was written" compares. */
  async function ledgerCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of LEDGERS) counts[table] = (await rowsOf(a.owner, table)).length;
    return counts;
  }

  const statusOf = async (id: string) =>
    (await stack.admin.from("invoice").select("status").eq("id", id).single()).data?.status;

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    // The owner picks ingredients from the master data (M1); here they are fixtures.
    for (const name of INGREDIENTS) {
      const made = await stack.admin
        .from("ingredient")
        .insert({ tenant_id: a.id, name, base_unit: "kg" })
        .select("id")
        .single();
      expect(made.error).toBeNull();
      ingredientIds.set(name, made.data!.id as string);
    }
    const member = await stack.admin
      .from("app_user")
      .select("id")
      .eq("auth_id", a.owner.authId)
      .single();
    expect(member.error).toBeNull();
    ownerUserId = member.data!.id as string;
  });

  describe("AT3: a reviewed invoice is approved and posts receipts, prices and a payable", () => {
    it("is blocked while the supplier, the lines and the location are missing", async () => {
      mainId = await uploadAndExtract(fixtureWith("approval", { invoice_number: number(1) }));
      const review = await getReview(mainId);
      expect(review.invoice.status).toBe("review");
      expect(review.lines).toHaveLength(6);
      expect(review.approval).toMatchObject({ canApprove: false });
      expect(review.approval!.blockers.map((blocker) => blocker.code)).toContain(
        "supplier_required",
      );

      const refused = await approve(mainId);
      expect(refused.status).toBe(422);
      expect(refused.error.code).toBe("supplier_required");
    });

    it("links a new supplier with 30 payment days; the blockers move on to the lines and the location", async () => {
      const before = await getReview(mainId);
      const reply = await call(a.owner, supplierRoute.POST, `/api/invoices/${mainId}/supplier`, {
        method: "POST",
        body: {
          create: {
            name: before.extractedSupplier.name,
            vatNumber: before.extractedSupplier.vatNumber,
            paymentTermsDays: 30,
          },
        },
        params: { id: mainId },
      });
      expect(reply.status).toBe(200);
      supplierId = reply.review.supplier!.id;

      const blockers = reply.review.approval!.blockers;
      expect(blockers.map((blocker) => blocker.code)).toEqual(["lines_unmapped", "no_location"]);
      // lines_unmapped names the six lines; the panel counts them from here.
      expect(blockers[0]!.lineIds).toHaveLength(6);
      expect(blockers[1]!.lineIds).toEqual([]);

      const refused = await approve(mainId);
      expect(refused.status).toBe(422);
      expect(refused.error.code).toBe("lines_unmapped");
    });

    it("creates the location 'Cella' and books the lines: measure units, a pack, a split, non-stock, a credit", async () => {
      const made = await call(a.owner, locationsRoute.POST, "/api/locations", {
        method: "POST",
        body: { name: "Cella" },
      });
      expect(made.status).toBe(201);
      locationId = (made.body.location as { id: string }).id;

      const review = await getReview(mainId);
      for (const description of ["Fesa di manzo", "Zafferano in polvere", "Burro"]) {
        const reply = await patchLine(mainId, lineOf(review, description).id, {
          ingredientId: ingredientIds.get(description),
        });
        expect(reply.status, description).toBe(200);
      }
      // Two cartons of 6 x 1 kg: 12 kg received.
      const pack = await patchLine(mainId, lineOf(review, "Passata di pomodoro").id, {
        ingredientId: ingredientIds.get("Passata di pomodoro"),
        pack: { count: 6, size: 1, unit: "kg" },
      });
      expect(pack.status).toBe(200);
      expect(lineOf(pack.review, "Passata di pomodoro")).toMatchObject({
        unit: "conf",
        pack: { count: 6, size: 1, unit: "kg" },
      });

      const centre = await call(a.owner, centresRoute.POST, "/api/cost-centres", {
        method: "POST",
        body: { name: "Pulizie" },
      });
      expect(centre.status).toBe(201);
      const nonStock = await patchLine(mainId, lineOf(review, NON_STOCK).id, {
        isStock: false,
        costCentreId: (centre.body.costCentre as { id: string }).id,
      });
      expect(nonStock.status).toBe(200);

      const credit = await patchLine(mainId, lineOf(review, "Burro").id, { creditQty: 0.5 });
      expect(credit.status).toBe(200);
      expect(lineOf(credit.review, "Burro")).toMatchObject({ creditQty: 0.5, creditAmount: 5.5 });

      const split = await call(
        a.owner,
        splitRoute.POST,
        `/api/invoices/${mainId}/lines/${lineOf(review, SPLIT).id}/split`,
        {
          method: "POST",
          body: {
            children: [
              { qty: 1, lineAmount: 10 },
              { qty: 2, lineAmount: 20 },
            ],
          },
          params: { id: mainId, lineId: lineOf(review, SPLIT).id },
        },
      );
      expect(split.status).toBe(200);

      // Only the two parts of the split are still unmapped; the blocker names exactly them.
      const parts = lineOf(split.review, SPLIT).children!;
      expect(split.review.approval!.blockers).toEqual([
        { code: "lines_unmapped", lineIds: expect.arrayContaining(parts.map((p) => p.id)) },
      ]);
      expect(split.review.approval!.blockers[0]!.lineIds).toHaveLength(2);

      const names = ["Parmigiano stagionato", "Parmigiano grattugiato"];
      for (const [index, part] of parts.entries()) {
        const reply = await patchLine(mainId, part.id, {
          ingredientId: ingredientIds.get(names[index]!),
        });
        expect(reply.status, `part ${index + 1}`).toBe(200);
      }
    });

    it("shows the payable and what will be received before the tap, and writes nothing yet", async () => {
      const review = await getReview(mainId);
      expect(review.approval).toMatchObject({
        canApprove: true,
        blockers: [],
        receiptDate: "2026-09-29",
        receipts: 6,
        payable: {
          grossAmount: 130.21,
          creditedAmount: 5.5,
          amount: 124.71,
          dueDate: "2026-10-29",
          dueDateSource: "supplier_terms",
        },
        locations: { required: false, defaultId: locationId },
      });
      expect(review.decision).toBeNull();
      expect(review.posting).toBeNull();

      expect(lineOf(review, "Fesa di manzo").toReceive).toEqual({
        qty: 2,
        unit: "kg",
        unitPrice: 12.75,
      });
      expect(lineOf(review, "Zafferano in polvere").toReceive).toEqual({
        qty: 0.5,
        unit: "kg",
        unitPrice: 8,
      });
      expect(lineOf(review, "Passata di pomodoro").toReceive).toEqual({
        qty: 12,
        unit: "kg",
        unitPrice: 2.5,
      });
      expect(lineOf(review, "Burro").toReceive).toEqual({ qty: 1.5, unit: "kg", unitPrice: 10 });
      expect(lineOf(review, NON_STOCK).toReceive).toBeNull();
      expect(lineOf(review, SPLIT).children!.map((part) => part.toReceive)).toEqual([
        { qty: 1, unit: "kg", unitPrice: 10 },
        { qty: 2, unit: "kg", unitPrice: 10 },
      ]);

      for (const table of LEDGERS) expect(await rowsOf(a.owner, table), table).toEqual([]);
    });

    it("approves: 200 with the decision and the posting, status approved", async () => {
      const reply = await approve(mainId);
      expect(reply.status).toBe(200);
      const review = reply.review;
      expect(review.invoice.status).toBe("approved");
      expect(review.editable).toBe(false);
      expect(review.approval).toBeNull();
      expect(review.decision).toMatchObject({
        action: "approved",
        byName: "Titolare Osteria Demo A",
        reason: null,
      });
      expect(Number.isNaN(Date.parse(review.decision!.at))).toBe(false);
      expect(review.posting).toEqual({
        payable: {
          grossAmount: 130.21,
          creditedAmount: 5.5,
          amount: 124.71,
          dueDate: "2026-10-29",
          dueDateSource: "supplier_terms",
          status: "open",
        },
        locationName: "Cella",
      });
      expect(lineOf(review, "Passata di pomodoro").received).toEqual({ qty: 12, unit: "kg" });
      expect(lineOf(review, "Burro").received).toEqual({ qty: 1.5, unit: "kg" });
      expect(lineOf(review, NON_STOCK).received).toBeNull();
    });

    it("wrote 6 lots in base units with lot, expiry and the conversion used", async () => {
      const lots = await rowsOf(a.owner, "raw_lot");
      expect(lots).toHaveLength(6);
      const byIngredient = new Map(lots.map((lot) => [lot.ingredient_id as string, lot]));
      const lotOf = (name: string) => byIngredient.get(ingredientIds.get(name)!)!;

      const quantities = Object.fromEntries(
        INGREDIENTS.map((name) => [name, lotOf(name).qty_received]),
      );
      expect(quantities).toEqual({
        "Fesa di manzo": 2,
        "Zafferano in polvere": 0.5,
        "Passata di pomodoro": 12,
        Burro: 1.5,
        "Parmigiano stagionato": 1,
        "Parmigiano grattugiato": 2,
      });
      for (const lot of lots) {
        expect(lot).toMatchObject({
          location_id: locationId,
          supplier_id: supplierId,
          base_unit: "kg",
          received_on: "2026-09-29",
        });
      }
      expect(lotOf("Fesa di manzo")).toMatchObject({
        lot_code: "L-0926-A",
        expiry: "2026-10-20",
        source_unit: "kg",
        base_factor: 1,
      });
      expect(lotOf("Passata di pomodoro")).toMatchObject({
        lot_code: "PP-77",
        expiry: "2027-09-30",
        source_qty: 2,
        source_unit: "conf",
        base_factor: 6,
      });
      expect(lotOf("Zafferano in polvere")).toMatchObject({
        source_qty: 500,
        source_unit: "g",
        base_factor: 0.001,
      });
    });

    it("wrote one receipt per lot at the frozen price, and one price row per received line", async () => {
      const lots = await rowsOf(a.owner, "raw_lot");
      const movements = await rowsOf(a.owner, "stock_movement");
      expect(movements).toHaveLength(6);
      for (const movement of movements) {
        const lot = lots.find((row) => row.id === movement.raw_lot_id)!;
        expect(movement).toMatchObject({
          type: "receipt",
          qty: lot.qty_received,
          ingredient_id: lot.ingredient_id,
          location_id: locationId,
          ref_type: "invoice_line",
          ref_id: lot.invoice_line_id,
          effective_on: "2026-09-29",
        });
      }

      const prices = await rowsOf(a.owner, "price_history");
      expect(prices).toHaveLength(6);
      const priceOf = (name: string) =>
        prices.find((row) => row.ingredient_id === ingredientIds.get(name))!.unit_price;
      expect(Object.fromEntries(INGREDIENTS.map((name) => [name, priceOf(name)]))).toEqual({
        "Fesa di manzo": 12.75,
        "Zafferano in polvere": 8,
        "Passata di pomodoro": 2.5,
        Burro: 10,
        "Parmigiano stagionato": 10,
        "Parmigiano grattugiato": 10,
      });
      // The movement carries the price it was received at (cost frozen at receipt).
      for (const movement of movements) {
        const price = prices.find((row) => row.invoice_line_id === movement.ref_id)!;
        expect(movement.unit_cost).toBe(price.unit_price);
      }
    });

    it("wrote the payable (gross minus credit, due in 30 days) and one audit row", async () => {
      const payables = await rowsOf(a.owner, "payable");
      expect(payables).toHaveLength(1);
      expect(payables[0]).toMatchObject({
        invoice_id: mainId,
        supplier_id: supplierId,
        gross_amount: 130.21,
        credited_amount: 5.5,
        amount: 124.71,
        due_date: "2026-10-29",
        due_date_source: "supplier_terms",
        status: "open",
      });

      const audit = await rowsOf(a.owner, "audit_event");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        entity_type: "invoice",
        entity_id: mainId,
        action: "invoice.approved",
        created_by: ownerUserId,
        before: { status: "review" },
        after: { status: "approved", amount: 124.71, location_id: locationId, receipts: 6 },
      });
    });

    it("derives the stock on hand from the ledger, per ingredient", async () => {
      const view = await rowsOf(a.owner, "v_stock_on_hand");
      expect(view).toHaveLength(6);
      const onHand = Object.fromEntries(
        INGREDIENTS.map((name) => [
          name,
          view.find((row) => row.ingredient_id === ingredientIds.get(name))!.qty_on_hand,
        ]),
      );
      expect(onHand).toEqual({
        "Fesa di manzo": 2,
        "Zafferano in polvere": 0.5,
        "Passata di pomodoro": 12,
        Burro: 1.5,
        "Parmigiano stagionato": 1,
        "Parmigiano grattugiato": 2,
      });
      expect(view.every((row) => row.location_id === locationId)).toBe(true);
    });
  });

  describe("AT5: a second approval is refused and the non-stock line posts nothing", () => {
    it("approving again is a 409 and nothing is written", async () => {
      const before = await ledgerCounts();
      expect(before).toEqual({
        raw_lot: 6,
        stock_movement: 6,
        price_history: 6,
        payable: 1,
        audit_event: 1,
      });
      const again = await approve(mainId);
      expect(again.status).toBe(409);
      expect(again.error.code).toBe("invoice_already_approved");
      expect(await ledgerCounts()).toEqual(before);
    });

    it("no lot, movement or price row refers to the non-stock line", async () => {
      const line = lineOf(await getReview(mainId), NON_STOCK);
      expect(line.isStock).toBe(false);
      const lots = await rowsOf(a.owner, "raw_lot");
      const movements = await rowsOf(a.owner, "stock_movement");
      const prices = await rowsOf(a.owner, "price_history");
      expect(lots.some((row) => row.invoice_line_id === line.id)).toBe(false);
      expect(movements.some((row) => row.ref_id === line.id)).toBe(false);
      expect(prices.some((row) => row.invoice_line_id === line.id)).toBe(false);
    });

    it("an approved invoice can be neither rejected nor edited", async () => {
      const rejected = await reject(mainId);
      expect(rejected.status).toBe(409);
      expect(rejected.error.code).toBe("invoice_already_approved");

      const edit = await patchLine(mainId, lineOf(await getReview(mainId), "Burro").id, {
        creditQty: 1,
      });
      expect(edit.status).toBe(409);
      expect(edit.error.code).toBe("invoice_not_in_review");
      expect(await statusOf(mainId)).toBe("approved");
    });
  });

  describe("AT1: an invoice whose total does not match is refused and nothing is written", () => {
    it("shows the blocker first, answers 409 total_mismatch and leaves the invoice in review", async () => {
      mismatchId = await uploadAndExtract(
        fixtureWith("mismatch-006", { invoice_number: number(2) }),
      );
      const review = await getReview(mismatchId);
      expect(review.gate.flags).toContain("total_mismatch");
      expect(review.approval!.canApprove).toBe(false);
      expect(review.approval!.blockers[0]!.code).toBe("total_mismatch");

      const before = await ledgerCounts();
      const refused = await approve(mismatchId);
      expect(refused.status).toBe(409);
      expect(refused.error.code).toBe("total_mismatch");
      expect(await ledgerCounts()).toEqual(before);
      expect(await statusOf(mismatchId)).toBe("review");
    });
  });

  describe("AT2: a duplicate is refused; it can be rejected", () => {
    let originalId: string;
    let duplicateId: string;

    it("the same document uploaded twice: the second is a duplicate and approval is a 409", async () => {
      const same = fixtureWith("valid", { invoice_number: number(3) });
      originalId = await uploadAndExtract(same);
      duplicateId = await uploadAndExtract(same);
      expect((await getReview(originalId)).invoice.status).toBe("review");
      const duplicate = await getReview(duplicateId);
      expect(duplicate.invoice).toMatchObject({ status: "duplicate", duplicateOf: originalId });
      expect(duplicate.approval).toBeNull();
      // The review names the original the database holds it against (the id "Non è un doppione" sends).
      const original = await getReview(originalId);
      expect(duplicate.duplicatePartner).toEqual({
        id: originalId,
        number: original.invoice.number,
        date: original.invoice.invoiceDate,
      });
      expect(original.duplicatePartner).toBeNull();

      const before = await ledgerCounts();
      const refused = await approve(duplicateId);
      expect(refused.status).toBe(409);
      expect(refused.error.code).toBe("duplicate_invoice");
      expect(await ledgerCounts()).toEqual(before);
      expect(await statusOf(duplicateId)).toBe("duplicate");
    });

    it("rejecting the duplicate with a reason records who, when and why", async () => {
      const reply = await reject(duplicateId, { reason: "  Doppione di prova  " });
      expect(reply.status).toBe(200);
      expect(reply.review.invoice.status).toBe("rejected");
      expect(reply.review.editable).toBe(false);
      expect(reply.review.decision).toMatchObject({
        action: "rejected",
        byName: "Titolare Osteria Demo A",
        reason: "Doppione di prova",
      });

      const audit = (await rowsOf(a.owner, "audit_event")).find(
        (row) => row.entity_id === duplicateId,
      );
      expect(audit).toMatchObject({
        action: "invoice.rejected",
        reason: "Doppione di prova",
        created_by: ownerUserId,
      });

      const again = await reject(duplicateId);
      expect(again.status).toBe(409);
      expect(again.error.code).toBe("invoice_rejected");
      const approved = await approve(duplicateId);
      expect(approved.status).toBe(409);
      expect(approved.error.code).toBe("invoice_rejected");
    });

    it("rejecting without a reason stores none; a rejected document can be uploaded again", async () => {
      const reply = await reject(originalId);
      expect(reply.status).toBe(200);
      expect(reply.review.decision).toMatchObject({ action: "rejected", reason: null });

      const again = await uploadAndExtract(fixtureWith("valid", { invoice_number: number(3) }));
      expect((await getReview(again)).invoice.status).toBe("review");
    });

    it("nothing was posted by any rejection", async () => {
      expect((await ledgerCounts()).raw_lot).toBe(6);
      expect((await ledgerCounts()).payable).toBe(1);
    });
  });

  describe("AT7: who may approve, reject and read the ledgers", () => {
    it.each([
      ["chef", () => a.chef],
      ["waiter", () => a.waiter],
    ])(
      "%s of tenant A gets 403 on approve and reject, and nothing changes",
      async (_role, user) => {
        const before = await ledgerCounts();
        const approved = await approve(mismatchId, {}, user());
        expect(approved.status).toBe(403);
        const rejected = await reject(mismatchId, { reason: "no" }, user());
        expect(rejected.status).toBe(403);
        expect(await ledgerCounts()).toEqual(before);
        expect(await statusOf(mismatchId)).toBe("review");
      },
    );

    it("the chef reads the lots (no cost) and nothing that carries a cost", async () => {
      expect((await rowsOf(a.chef, "raw_lot")).length).toBe(6);
      for (const table of COST_TABLES) {
        expect(await rowsOf(a.chef, table), `chef reads ${table}`).toEqual([]);
      }
    });

    it("the waiter reads no row of the lots, the ledgers, the view or the audit trail", async () => {
      for (const table of ["raw_lot", ...COST_TABLES]) {
        expect(await rowsOf(a.waiter, table), `waiter reads ${table}`).toEqual([]);
      }
    });

    it("owner B gets 404 on tenant A's invoices and reads none of A's rows", async () => {
      const before = await ledgerCounts();
      for (const id of [mainId, mismatchId]) {
        expect((await approve(id, {}, b.owner)).status).toBe(404);
        expect((await reject(id, {}, b.owner)).status).toBe(404);
      }
      expect(await ledgerCounts()).toEqual(before);
      for (const table of ["raw_lot", ...COST_TABLES]) {
        expect(await rowsOf(b.owner, table), `owner B reads ${table}`).toEqual([]);
      }
      expect(await approve(NO_ID, {}, a.owner).then((reply) => reply.status)).toBe(404);
    });
  });

  describe("AT6: the ledgers are append-only, even for the secret key", () => {
    // PostgREST answers a missing privilege with 42501 and a trigger refusal with P0001.
    const REFUSED = ["42501", "P0001"];
    const TABLES = [
      ["stock_movement", { qty: 999 }],
      ["raw_lot", { qty_received: 999 }],
      ["price_history", { unit_price: 999 }],
      ["payable", { amount: 999 }],
      ["audit_event", { action: "invoice.rejected" }],
    ] as const;

    it.each(TABLES)(
      "UPDATE and DELETE on %s fail and the rows are unchanged",
      async (table, patch) => {
        const before = await rowsOf(a.owner, table);
        expect(before.length).toBeGreaterThan(0);

        const updated = await stack.admin.from(table).update(patch).eq("tenant_id", a.id);
        expect(updated.error, `UPDATE ${table}`).not.toBeNull();
        expect(REFUSED).toContain(updated.error!.code);

        const deleted = await stack.admin.from(table).delete().eq("tenant_id", a.id);
        expect(deleted.error, `DELETE ${table}`).not.toBeNull();
        expect(REFUSED).toContain(deleted.error!.code);

        expect(await rowsOf(a.owner, table)).toEqual(before);
      },
    );

    it("the owner's own session cannot rewrite or delete them either", async () => {
      for (const [table, patch] of TABLES) {
        const before = await rowsOf(a.owner, table);
        const updated = await a.owner.client.from(table).update(patch).eq("tenant_id", a.id);
        expect(updated.error, `owner UPDATE ${table}`).not.toBeNull();
        const deleted = await a.owner.client.from(table).delete().eq("tenant_id", a.id);
        expect(deleted.error, `owner DELETE ${table}`).not.toBeNull();
        expect(await rowsOf(a.owner, table)).toEqual(before);
      }
    });

    it("the secret key cannot insert a receipt either: only approve_invoice writes the ledger", async () => {
      const before = await ledgerCounts();
      const inserted = await stack.admin.from("stock_movement").insert({
        tenant_id: a.id,
        ingredient_id: ingredientIds.get("Burro"),
        location_id: locationId,
        type: "receipt",
        qty: 1,
        unit_cost: 1,
        effective_on: "2026-09-29",
      });
      expect(inserted.error).not.toBeNull();
      expect(await ledgerCounts()).toEqual(before);
    });
  });
});
