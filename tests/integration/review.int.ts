import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ExtractionEnv } from "@/lib/env";
import { addDays, venueDate } from "@/lib/time/venue-date";
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

// M4 acceptance tests 1 to 5 against the real local stack: the review payload, "Crea fornitore",
// the supplier memory (a second invoice arrives mapped), splits, non-stock and credit rules, the
// extraction-quality report, and who may call what. The route handlers run for real (schemas,
// role check, error mapping, the review procedures, RLS); only two things are replaced:
//   - the Anthropic API, by recorded responses behind a fake `fetch` (as in extraction.int.ts);
//   - `createSupabaseServerClient`, which would read cookies from a Next.js request, so each call
//     is handed the signed-in test user's own client (publishable key + that user's JWT).
// Fixtures that must bypass RLS (ingredients, reading supplier_item) use the local secret key.
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
const unsplitRoute = await import("@/app/api/invoices/[id]/lines/[lineId]/unsplit/route");
const supplierRoute = await import("@/app/api/invoices/[id]/supplier/route");
const invoiceRoute = await import("@/app/api/invoices/[id]/route");
const notDuplicateRoute = await import("@/app/api/invoices/[id]/not-duplicate/route");
const retryRoute = await import("@/app/api/invoices/[id]/retry/route");
const centresRoute = await import("@/app/api/cost-centres/route");
const reportRoute = await import("@/app/api/reports/extraction-quality/route");

const PDF_MIME = "application/pdf";
const FAKE_ENV: ExtractionEnv = { anthropicApiKey: "test-key", modelId: "test-model" };
const FAR_FUTURE_MS = 24 * 3600 * 1000;
const NO_ID = "00000000-0000-4000-8000-000000000000";

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply {
  status: number;
  body: Record<string, unknown>;
  review: InvoiceReview;
  error: { code: string; message: string; details?: Record<string, number>[] };
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

// The ten articles of the review-first / review-second fixtures: six with a supplier code, four
// without; the unit is what the invoice prints (and what the ingredient is measured in).
const ARTICLES = [
  ["Fesa di manzo", "kg"],
  ["Parmigiano Reggiano 24 mesi", "kg"],
  ["Olio extravergine di oliva", "l"],
  ["Farina 00", "kg"],
  ["Pomodori pelati 400 g", "pz"],
  ["Mozzarella fiordilatte", "kg"],
  ["Uova fresche", "pz"],
  ["Burro", "kg"],
  ["Latte intero", "l"],
  ["Sale fino", "kg"],
] as const;
const CODED = 6;
const MISREAD = "Farina 00";

describe.skipIf(!env)("invoice review on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  const uploadedAt = new Date();
  const RUN_TAG = randomUUID().slice(0, 8).toUpperCase();
  const number = (n: number) => `RV ${RUN_TAG}-${n}/2026`;

  const ingredientIds = new Map<string, string>();
  let firstId: string;
  let secondId: string;
  let secondNumber: string;
  let supplierId: string;

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

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    // The owner picks ingredients from the master data (M1); here they are fixtures.
    for (const [name, unit] of ARTICLES) {
      const made = await stack.admin
        .from("ingredient")
        .insert({ tenant_id: a.id, name, base_unit: unit })
        .select("id")
        .single();
      expect(made.error).toBeNull();
      ingredientIds.set(name, made.data!.id as string);
    }
  });

  describe("AT1: the first invoice from a new supplier", () => {
    it("is extracted into review with 10 lines and no supplier", async () => {
      firstId = await uploadAndExtract(
        fixtureWith("review-first", { invoice_number: number(1), invoice_date: "2026-10-15" }),
      );
      const review = await getReview(firstId);
      expect(review.invoice.status).toBe("review");
      expect(review.editable).toBe(true);
      expect(review.supplier).toBeNull();
      expect(review.extractedSupplier).toMatchObject({
        name: "Fornitore Demo Srl",
        vatNumber: "IT12345678903",
      });
      expect(review.lines).toHaveLength(10);
      expect(review.summary).toMatchObject({ lines: 10, unmapped: 10, corrected: 0 });
      expect(review.gate.flags).toEqual([]);
      expect(review.lines.every((line) => line.mappingSource === null)).toBe(true);
    });

    it("refuses to map a line before the supplier is linked (the memory is per supplier)", async () => {
      const review = await getReview(firstId);
      const reply = await patchLine(firstId, review.lines[0]!.id, {
        ingredientId: ingredientIds.get(review.lines[0]!.rawDescription),
      });
      expect(reply.status).toBe(422);
      expect(reply.error.code).toBe("supplier_required");
    });

    it("creates the supplier from the extracted data and links it", async () => {
      const before = await getReview(firstId);
      const reply = await call(a.owner, supplierRoute.POST, `/api/invoices/${firstId}/supplier`, {
        method: "POST",
        body: {
          create: {
            name: before.extractedSupplier.name,
            vatNumber: before.extractedSupplier.vatNumber,
            paymentTermsDays: 30,
          },
        },
        params: { id: firstId },
      });
      expect(reply.status).toBe(200);
      expect(reply.review.supplier).toMatchObject({
        name: "Fornitore Demo Srl",
        vatNumber: "IT12345678903",
      });
      supplierId = reply.review.supplier!.id;
      expect(reply.review.invoice.status).toBe("review");
    });

    it("lists unmapped lines first, as lines are mapped one by one", async () => {
      const first = await getReview(firstId);
      const mappedNow = first.lines.slice(0, 3).map((line) => line.rawDescription);
      for (const description of mappedNow) {
        const reply = await patchLine(firstId, lineOf(first, description).id, {
          ingredientId: ingredientIds.get(description),
        });
        expect(reply.status).toBe(200);
      }
      const after = await getReview(firstId);
      const order = after.lines.map((line) => line.rawDescription);
      // The seven still unmapped come first (by position), then the three mapped ones.
      expect(order.slice(0, 7)).toEqual(first.lines.slice(3).map((line) => line.rawDescription));
      expect(order.slice(7)).toEqual(mappedNow);
      expect(after.summary.unmapped).toBe(7);
    });

    it("maps all ten: 10 supplier items, 6 keyed by code and 4 by description hash", async () => {
      const current = await getReview(firstId);
      for (const line of current.lines.filter((l) => l.ingredient === null)) {
        const reply = await patchLine(firstId, line.id, {
          ingredientId: ingredientIds.get(line.rawDescription),
        });
        expect(reply.status).toBe(200);
      }
      const done = await getReview(firstId);
      expect(done.summary).toMatchObject({ unmapped: 0, corrected: 0 });
      for (const line of done.lines) {
        expect(line).toMatchObject({ mappingSource: "manual", corrected: false });
      }

      const items = await stack.admin
        .from("supplier_item")
        .select("supplier_code, description_hash")
        .eq("tenant_id", a.id)
        .eq("supplier_id", supplierId);
      expect(items.error).toBeNull();
      expect(items.data).toHaveLength(ARTICLES.length);
      const byCode = items.data!.filter((row) => row.supplier_code !== null);
      const byHash = items.data!.filter((row) => row.description_hash !== null);
      expect(byCode).toHaveLength(CODED);
      expect(byHash).toHaveLength(ARTICLES.length - CODED);
      expect(byCode.every((row) => row.description_hash === null)).toBe(true);
      expect(byHash.every((row) => /^[0-9a-f]{64}$/.test(String(row.description_hash)))).toBe(true);
    });
  });

  describe("AT2 and AT5: the second invoice from the same supplier", () => {
    it("arrives with all 10 lines auto-mapped and none corrected", async () => {
      secondNumber = number(2);
      secondId = await uploadAndExtract(
        fixtureWith("review-second", { invoice_number: secondNumber, invoice_date: "2026-10-22" }),
      );
      const review = await getReview(secondId);
      expect(review.supplier).toMatchObject({ id: supplierId });
      expect(review.lines).toHaveLength(10);
      for (const line of review.lines) {
        expect(line).toMatchObject({ mappingSource: "auto", corrected: false });
        expect(line.ingredient?.id).toBe(ingredientIds.get(line.rawDescription));
        expect(line.suggestion?.ingredientId).toBe(line.ingredient?.id);
      }
      expect(review.summary).toMatchObject({ lines: 10, unmapped: 0, corrected: 0 });
      // The misread quantity is the one line the screen asks the owner to look at.
      expect(review.lines[0]).toMatchObject({ rawDescription: MISREAD });
      expect(review.lines[0]!.highlights).toContain("amount_mismatch");
    });

    it("correcting the misread quantity marks that line corrected and no other", async () => {
      const before = await getReview(secondId);
      const reply = await patchLine(secondId, lineOf(before, MISREAD).id, { qty: 10 });
      expect(reply.status).toBe(200);
      const corrected = reply.review.lines.filter((line) => line.corrected);
      expect(corrected.map((line) => line.rawDescription)).toEqual([MISREAD]);
      expect(corrected[0]).toMatchObject({
        qty: 10,
        correctedFields: ["qty"],
        checks: [],
        mappingSource: "auto",
      });
      expect(reply.review.summary.corrected).toBe(1);
    });

    it("the quality report: 1 correction in 10 mapped lines is 90% uncorrected", async () => {
      const today = venueDate(new Date());
      const query = `from=${addDays(today, -1)}&to=${addDays(today, 1)}`;
      const reply = await call(
        a.owner,
        reportRoute.GET,
        `/api/reports/extraction-quality?${query}`,
      );
      expect(reply.status).toBe(200);
      // Tenant A is new for this run, so the report sees exactly the two invoices above: the
      // first one (20 lines in all, mapped by hand, no correction) and the second (mapped by the
      // memory, one corrected qty). The PRD figure is the rate over the auto-mapped lines.
      expect(reply.body.report).toMatchObject({
        invoices: 2,
        lines: 20,
        correctedLines: 1,
        correctionRate: 0.05,
        autoMappedLines: 10,
        autoMappedCorrected: 1,
        autoMappedCorrectionRate: 0.1,
        manualMappedLines: 10,
        splitLines: 0,
        bySupplier: [{ supplierId, lines: 20, correctedLines: 1 }],
      });
      expect((reply.body.report as { byField: Record<string, number> }).byField.qty).toBe(1);
    });

    it("owner B sees none of it", async () => {
      const today = venueDate(new Date());
      const reply = await call(
        b.owner,
        reportRoute.GET,
        `/api/reports/extraction-quality?from=${addDays(today, -1)}&to=${addDays(today, 1)}`,
      );
      expect(reply.status).toBe(200);
      expect(reply.body.report).toMatchObject({ invoices: 0, lines: 0, correctionRate: null });
    });
  });

  describe("AT3: splitting a line", () => {
    const description = "Parmigiano Reggiano 24 mesi"; // qty 3, amount 55.20

    it("a wrong sum is a 422 with the differences, and nothing changes", async () => {
      const review = await getReview(secondId);
      const line = lineOf(review, description);
      const reply = await call(
        a.owner,
        splitRoute.POST,
        `/api/invoices/${secondId}/lines/${line.id}/split`,
        {
          method: "POST",
          body: {
            children: [
              { qty: 1, lineAmount: 18.4 },
              { qty: 1.5, lineAmount: 36.8 },
            ],
          },
          params: { id: secondId, lineId: line.id },
        },
      );
      expect(reply.status).toBe(422);
      expect(reply.error.code).toBe("split_sum_mismatch");
      expect(reply.error.details).toEqual([{ qtyDiff: -0.5, amountDiff: 0 }]);
      expect(lineOf(await getReview(secondId), description).isSplit).toBe(false);
    });

    it("an exact split nests the parts under the line, and unsplit restores it", async () => {
      const line = lineOf(await getReview(secondId), description);
      const path = `/api/invoices/${secondId}/lines/${line.id}`;
      const params = { id: secondId, lineId: line.id };
      const split = await call(a.owner, splitRoute.POST, `${path}/split`, {
        method: "POST",
        body: {
          children: [
            { qty: 1, lineAmount: 18.4 },
            { qty: 2, lineAmount: 36.8 },
          ],
        },
        params,
      });
      expect(split.status).toBe(200);
      const parent = lineOf(split.review, description);
      expect(parent.isSplit).toBe(true);
      expect(parent.children?.map((child) => [child.subPosition, child.qty])).toEqual([
        [1, 1],
        [2, 2],
      ]);
      expect(parent.children?.every((child) => child.unitPrice === 18.4)).toBe(true);
      // The totals do not move: the parent is replaced by its parts, once.
      expect(split.review.gate.flags).not.toContain("total_mismatch");

      const back = await call(a.owner, unsplitRoute.POST, `${path}/unsplit`, {
        method: "POST",
        body: {},
        params,
      });
      expect(back.status).toBe(200);
      expect(lineOf(back.review, description)).toMatchObject({ isSplit: false, qty: 3 });
      expect(lineOf(back.review, description).children).toBeUndefined();

      const again = await call(a.owner, unsplitRoute.POST, `${path}/unsplit`, {
        method: "POST",
        body: {},
        params,
      });
      expect(again.status).toBe(409);
      expect(again.error.code).toBe("not_split");
    });
  });

  describe("AT4: non-stock lines and credits", () => {
    const description = "Sale fino"; // qty 5

    it("a non-stock line without a cost centre is a 422", async () => {
      const line = lineOf(await getReview(secondId), description);
      const reply = await patchLine(secondId, line.id, { isStock: false });
      expect(reply.status).toBe(422);
      expect(reply.error.code).toBe("cost_centre_required");
    });

    it("a cost centre that does not exist is a 422 invalid_reference", async () => {
      const line = lineOf(await getReview(secondId), description);
      const reply = await patchLine(secondId, line.id, { isStock: false, costCentreId: NO_ID });
      expect(reply.status).toBe(422);
      expect(reply.error.code).toBe("invalid_reference");
    });

    it("with a cost centre created on the spot, the line is booked non-stock", async () => {
      const made = await call(a.owner, centresRoute.POST, "/api/cost-centres", {
        method: "POST",
        body: { name: ` Pulizie ${RUN_TAG} ` },
      });
      expect(made.status).toBe(201);
      const centre = made.body.costCentre as { id: string; name: string };
      expect(centre.name).toBe(`Pulizie ${RUN_TAG}`);

      const duplicate = await call(a.owner, centresRoute.POST, "/api/cost-centres", {
        method: "POST",
        body: { name: `pulizie  ${RUN_TAG.toLowerCase()}` },
      });
      expect(duplicate.status).toBe(409);
      expect(duplicate.error.code).toBe("duplicate_name");

      const listed = await call(a.owner, centresRoute.GET, "/api/cost-centres");
      expect((listed.body.costCentres as { id: string }[]).map((c) => c.id)).toContain(centre.id);

      const line = lineOf(await getReview(secondId), description);
      const reply = await patchLine(secondId, line.id, {
        isStock: false,
        costCentreId: centre.id,
      });
      expect(reply.status).toBe(200);
      expect(lineOf(reply.review, description)).toMatchObject({
        isStock: false,
        costCentre: { id: centre.id },
        ingredient: null,
        baseQty: null,
      });
    });

    it("a credit quantity above the line quantity is a 422; at most the quantity is accepted", async () => {
      const line = lineOf(await getReview(secondId), "Burro"); // qty 2, price 9.10
      const over = await patchLine(secondId, line.id, { creditQty: 3 });
      expect(over.status).toBe(422);
      expect(over.error.code).toBe("credit_qty_exceeds_qty");

      const ok = await patchLine(secondId, line.id, { creditQty: 1 });
      expect(ok.status).toBe(200);
      expect(lineOf(ok.review, "Burro")).toMatchObject({ creditQty: 1, creditAmount: 10.01 });
    });
  });

  describe("the other invoice actions", () => {
    it("a clean invoice is not a duplicate: not-duplicate is a 409; so is retry", async () => {
      const clear = await call(
        a.owner,
        notDuplicateRoute.POST,
        `/api/invoices/${secondId}/not-duplicate`,
        { method: "POST", body: { partnerId: NO_ID }, params: { id: secondId } },
      );
      expect(clear.status).toBe(409);
      expect(clear.error.code).toBe("not_flagged");

      const retry = await call(a.owner, retryRoute.POST, `/api/invoices/${secondId}/retry`, {
        method: "POST",
        body: {},
        params: { id: secondId },
      });
      expect(retry.status).toBe(409);
      expect(retry.error.code).toBe("not_failed");
    });

    it("a second upload of the same invoice is a duplicate; 'Non è un doppione' reopens it", async () => {
      const dupId = await uploadAndExtract(
        fixtureWith("review-second", { invoice_number: secondNumber, invoice_date: "2026-10-22" }),
      );
      const locked = await getReview(dupId);
      expect(locked.invoice).toMatchObject({ status: "duplicate", duplicateOf: secondId });
      expect(locked.editable).toBe(false);

      const readOnly = await patchLine(dupId, locked.lines[0]!.id, { reviewed: true });
      expect(readOnly.status).toBe(409);
      expect(readOnly.error.code).toBe("invoice_not_in_review");

      // The screen names the look-alike the database blocks it against: the original, with its number and date.
      expect(locked.duplicatePartner).toEqual({
        id: secondId,
        number: secondNumber,
        date: "2026-10-22",
      });
      const clearDup = (partnerId: string) =>
        call(a.owner, notDuplicateRoute.POST, `/api/invoices/${dupId}/not-duplicate`, {
          method: "POST",
          body: { partnerId },
          params: { id: dupId },
        });
      const pairRows = async () =>
        (await stack.admin.from("invoice_duplicate_decision").select("id").eq("invoice_id", dupId))
          .data ?? [];

      // A partner the owner was not shown (here: the invoice itself, and an unknown id) is refused and writes nothing.
      for (const partnerId of [dupId, NO_ID]) {
        const refused = await clearDup(partnerId);
        expect(refused.status).toBe(409);
        expect(refused.error.code).toBe("not_flagged");
      }
      expect(await pairRows()).toHaveLength(0);
      expect((await getReview(dupId)).invoice.status).toBe("duplicate");

      const cleared = await clearDup(locked.duplicatePartner!.id);
      expect(cleared.status).toBe(200);
      expect(cleared.review.invoice).toMatchObject({ status: "review", duplicateOf: null });
      expect(cleared.review.editable).toBe(true);
      expect(cleared.review.duplicatePartner).toBeNull();
      expect(await pairRows()).toHaveLength(1);

      // The same request again (a double tap, a second tab): 200 with the current review, no second row.
      const repeated = await clearDup(secondId);
      expect(repeated.status).toBe(200);
      expect(repeated.review.invoice.status).toBe("review");
      expect(await pairRows()).toHaveLength(1);

      const edited = await patchLine(dupId, cleared.review.lines[0]!.id, { reviewed: true });
      expect(edited.status).toBe(200);
    });

    it("correcting the gross total raises and clears the totals flag", async () => {
      const before = await getReview(secondId);
      const gross = before.gate.grossTotal!;
      const wrong = await call(a.owner, invoiceRoute.PATCH, `/api/invoices/${secondId}`, {
        method: "PATCH",
        body: { grossTotal: gross + 1 },
        params: { id: secondId },
      });
      expect(wrong.status).toBe(200);
      expect(wrong.review.gate.flags).toContain("total_mismatch");
      expect(wrong.review.invoice.headerCorrectedFields).toEqual(["gross_total"]);

      const right = await call(a.owner, invoiceRoute.PATCH, `/api/invoices/${secondId}`, {
        method: "PATCH",
        body: { grossTotal: gross },
        params: { id: secondId },
      });
      expect(right.status).toBe(200);
      expect(right.review.gate.flags).not.toContain("total_mismatch");
      expect(right.review.invoice.headerCorrectedFields).toEqual([]);
    });

    it("a failed reading can be retried: it goes back to received", async () => {
      const failedId = await uploadAndExtract(
        fixtureWith("extra-key", { invoice_number: number(3) }),
      );
      const failed = await stack.admin.from("invoice").select("status").eq("id", failedId).single();
      expect(failed.data).toMatchObject({ status: "extraction_failed" });

      const retry = await call(a.owner, retryRoute.POST, `/api/invoices/${failedId}/retry`, {
        method: "POST",
        body: {},
        params: { id: failedId },
      });
      expect(retry.status).toBe(202);
      expect((retry.body.invoice as { status: string }).status).toBe("received");
      // Nothing may extract it later in this run: it would make a real (paid) call.
      await parkQueue();
    });
  });

  describe("who may call what", () => {
    const line = NO_ID;
    // Every M4 endpoint with a plausible body. The role check comes before the body is read.
    const endpoints = (id: string) =>
      [
        ["GET review", reviewRoute.GET, `/api/invoices/${id}/review`, "GET", undefined, { id }],
        [
          "PATCH line",
          lineRoute.PATCH,
          `/api/invoices/${id}/lines/${line}`,
          "PATCH",
          { reviewed: true },
          { id, lineId: line },
        ],
        [
          "POST split",
          splitRoute.POST,
          `/api/invoices/${id}/lines/${line}/split`,
          "POST",
          {
            children: [
              { qty: 1, lineAmount: 1 },
              { qty: 1, lineAmount: 1 },
            ],
          },
          { id, lineId: line },
        ],
        [
          "POST unsplit",
          unsplitRoute.POST,
          `/api/invoices/${id}/lines/${line}/unsplit`,
          "POST",
          {},
          { id, lineId: line },
        ],
        [
          "POST supplier",
          supplierRoute.POST,
          `/api/invoices/${id}/supplier`,
          "POST",
          { supplierId: NO_ID },
          { id },
        ],
        [
          "PATCH invoice",
          invoiceRoute.PATCH,
          `/api/invoices/${id}`,
          "PATCH",
          { grossTotal: 1 },
          { id },
        ],
        [
          "POST not-duplicate",
          notDuplicateRoute.POST,
          `/api/invoices/${id}/not-duplicate`,
          "POST",
          { partnerId: NO_ID },
          { id },
        ],
        ["POST retry", retryRoute.POST, `/api/invoices/${id}/retry`, "POST", {}, { id }],
        ["GET cost centres", centresRoute.GET, "/api/cost-centres", "GET", undefined, {}],
        ["POST cost centres", centresRoute.POST, "/api/cost-centres", "POST", { name: "Gas" }, {}],
        ["GET report", reportRoute.GET, "/api/reports/extraction-quality", "GET", undefined, {}],
      ] as const;

    it.each([
      ["chef", () => a.chef],
      ["waiter", () => a.waiter],
    ])("%s of tenant A gets 403 on every M4 endpoint", async (_role, user) => {
      for (const [name, handler, path, method, body, params] of endpoints(secondId)) {
        const reply = await call(user(), handler as Handler, path, { method, body, params });
        expect(reply.status, name).toBe(403);
      }
    });

    it.each([
      ["chef", () => a.chef],
      ["waiter", () => a.waiter],
    ])("%s of tenant A reads no row of the M4 tables", async (_role, user) => {
      for (const table of ["invoice_line", "supplier_item", "cost_centre"]) {
        const seen = await user().client.from(table).select("id");
        expect(seen.data ?? [], table).toEqual([]);
      }
    });

    it("owner B gets 404 on tenant A's review and on every line action", async () => {
      const lineId = lineOf(await getReview(secondId), "Latte intero").id;
      const paths = {
        review: [reviewRoute.GET, `/api/invoices/${secondId}/review`, "GET", undefined],
        line: [
          lineRoute.PATCH,
          `/api/invoices/${secondId}/lines/${lineId}`,
          "PATCH",
          { reviewed: true },
        ],
        split: [
          splitRoute.POST,
          `/api/invoices/${secondId}/lines/${lineId}/split`,
          "POST",
          {
            children: [
              { qty: 1, lineAmount: 1 },
              { qty: 5, lineAmount: 1 },
            ],
          },
        ],
        unsplit: [
          unsplitRoute.POST,
          `/api/invoices/${secondId}/lines/${lineId}/unsplit`,
          "POST",
          {},
        ],
        header: [invoiceRoute.PATCH, `/api/invoices/${secondId}`, "PATCH", { grossTotal: 1 }],
        notDuplicate: [
          notDuplicateRoute.POST,
          `/api/invoices/${secondId}/not-duplicate`,
          "POST",
          { partnerId: NO_ID },
        ],
        retry: [retryRoute.POST, `/api/invoices/${secondId}/retry`, "POST", {}],
        supplier: [
          supplierRoute.POST,
          `/api/invoices/${secondId}/supplier`,
          "POST",
          { supplierId: supplierId },
        ],
      } as const;
      for (const [name, [handler, path, method, body]] of Object.entries(paths)) {
        const reply = await call(b.owner, handler as Handler, path, {
          method,
          body,
          params: { id: secondId, lineId },
        });
        expect(reply.status, name).toBe(404);
      }
      // Tenant A's data is untouched by those attempts.
      expect((await getReview(secondId)).lines).toHaveLength(10);
    });
  });
});
