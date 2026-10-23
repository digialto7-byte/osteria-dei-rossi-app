import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { venueDate } from "@/lib/time/venue-date";
import type { PayableDetail, PayableListResult, SupplierStatement } from "@/server/payables/types";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";

// M9 acceptance tests 4, 5 and 6 against the real local stack: two fake invoices of one supplier are
// approved through POST /api/invoices/:id/approve (one with a credited line), then the payables API
// is used as the owner, the admin, the chef, the waiter and the other tenant's owner. The route
// handlers run for real (schemas, role checks, error mapping, set_payable_status, the read functions,
// RLS, the audit trail); only `createSupabaseServerClient` is replaced, because it would read cookies
// from a Next.js request: each call is handed the signed-in test user's own client.
//
// Fixtures (supplier, ingredient, location, the invoices in review) use the local secret key, as the
// approval suite does. Every read of an RLS table (payable, audit_event) goes through a user session.
// The tests run in order and share state. Throws in CI when the stack settings are missing; skips on
// a developer machine.
const env = readStackEnv();

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const reviewRoute = await import("@/app/api/invoices/[id]/review/route");
const lineRoute = await import("@/app/api/invoices/[id]/lines/[lineId]/route");
const approveRoute = await import("@/app/api/invoices/[id]/approve/route");
const payablesRoute = await import("@/app/api/payables/route");
const payableRoute = await import("@/app/api/payables/[id]/route");
const statementRoute = await import("@/app/api/suppliers/[id]/statement/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
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
  const body = (await response.json()) as T;
  return { status: response.status, body, error: (body as { error?: Reply["error"] }).error! };
}

const RUN_TAG = randomUUID().slice(0, 8).toUpperCase();
const INVOICE_DATE = "2026-09-29";

describe.skipIf(!env)("payables on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let supplierId: string;
  let ingredientId: string;
  // inv1: 2 kg at 10,00 with 0,5 kg credited (gross 22,00, credit 5,50); inv2: 1 kg at 50,00 (gross 55,00).
  let credited: { invoiceId: string; payableId: string };
  let plain: { invoiceId: string; payableId: string };

  const today = () => venueDate(new Date());

  /** An invoice in review with one mapped kg line, as the extraction worker and the reviewer leave it. */
  async function seedReviewInvoice(number: string, qty: number, unitPrice: number) {
    const id = randomUUID();
    const inserted = await stack.admin.from("invoice").insert({
      id,
      tenant_id: a.id,
      file_path: `${a.id}/2026/${id}.pdf`,
      file_mime: "application/pdf",
      file_size_bytes: 80,
      original_filename: "fattura-demo.pdf",
    });
    expect(inserted.error).toBeNull();
    const net = Math.round(qty * unitPrice * 100);
    const vat = Math.round(net * 0.1);
    // The lifecycle guard only allows received -> extracting -> review.
    for (const patch of [
      { status: "extracting" },
      {
        status: "review",
        supplier_vat: "IT12345678903",
        supplier_name: "Fornitore Demo Srl",
        number_raw: number,
        invoice_date: INVOICE_DATE,
        net_total: net / 100,
        vat_total: vat / 100,
        gross_total: (net + vat) / 100,
        totals_diff: 0,
        gate_flags: [],
        attempts: 1,
        extracted_at: new Date().toISOString(),
        supplier_id: supplierId,
      },
    ]) {
      const moved = await stack.admin.from("invoice").update(patch).eq("id", id);
      expect(moved.error).toBeNull();
    }
    const line = await stack.admin.from("invoice_line").insert({
      tenant_id: a.id,
      invoice_id: id,
      position: 1,
      raw_description: "Farina 00",
      qty,
      unit_raw: "kg",
      unit: "kg",
      unit_price: unitPrice,
      line_amount: net / 100,
      vat_rate: 10,
      field_confidence: {},
      extracted: {},
      ingredient_id: ingredientId,
      mapping_source: "manual",
      corrected_fields: [],
    });
    expect(line.error).toBeNull();
    return id;
  }

  const approve = (id: string, user: TestUser = a.owner) =>
    call(user, approveRoute.POST as Handler, `/api/invoices/${id}/approve`, {
      method: "POST",
      body: {},
      params: { id },
    });
  const list = (user: TestUser, query = "") =>
    call<PayableListResult>(user, payablesRoute.GET as Handler, `/api/payables${query}`);
  const detail = (user: TestUser, id: string) =>
    call<PayableDetail>(user, payableRoute.GET as Handler, `/api/payables/${id}`, {
      params: { id },
    });
  const patch = (user: TestUser, id: string, body: unknown) =>
    call<{ payable: PayableDetail["payable"]; changed: boolean }>(
      user,
      payableRoute.PATCH as Handler,
      `/api/payables/${id}`,
      { method: "PATCH", body, params: { id } },
    );
  const statement = (user: TestUser, id: string) =>
    call<SupplierStatement>(user, statementRoute.GET as Handler, `/api/suppliers/${id}/statement`, {
      params: { id },
    });

  /** What owner A reads in audit_event for one payable, oldest first (RLS applies). */
  async function auditOf(payableId: string) {
    const read = await a.owner.client
      .from("audit_event")
      .select("action, reason, before, after, created_by")
      .eq("entity_type", "payable")
      .eq("entity_id", payableId)
      .order("created_at", { ascending: true });
    expect(read.error).toBeNull();
    return read.data ?? [];
  }

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    const supplier = await stack.admin
      .from("supplier")
      .insert({
        tenant_id: a.id,
        name: "Fornitore Demo Srl",
        vat_number: "IT12345678903",
        payment_terms_days: 30,
      })
      .select("id")
      .single();
    expect(supplier.error).toBeNull();
    supplierId = supplier.data!.id as string;
    const ingredient = await stack.admin
      .from("ingredient")
      .insert({ tenant_id: a.id, name: "Farina 00", base_unit: "kg" })
      .select("id")
      .single();
    expect(ingredient.error).toBeNull();
    ingredientId = ingredient.data!.id as string;
    const location = await stack.admin.from("location").insert({ tenant_id: a.id, name: "Cella" });
    expect(location.error).toBeNull();
  });

  describe("approval creates the payables", () => {
    it("approves two invoices of one supplier, one with a credited line (0,5 x 10,00 x 1,10 = 5,50)", async () => {
      const creditedInvoice = await seedReviewInvoice(`PY ${RUN_TAG}-1`, 2, 10);
      const plainInvoice = await seedReviewInvoice(`PY ${RUN_TAG}-2`, 1, 50);

      const review = await call<{ review: { lines: { id: string }[] } }>(
        a.owner,
        reviewRoute.GET as Handler,
        `/api/invoices/${creditedInvoice}/review`,
        { params: { id: creditedInvoice } },
      );
      expect(review.status).toBe(200);
      const credit = await call(
        a.owner,
        lineRoute.PATCH as Handler,
        `/api/invoices/${creditedInvoice}/lines/${review.body.review.lines[0]!.id}`,
        {
          method: "PATCH",
          body: { creditQty: 0.5 },
          params: { id: creditedInvoice, lineId: review.body.review.lines[0]!.id },
        },
      );
      expect(credit.status).toBe(200);

      expect((await approve(creditedInvoice)).status).toBe(200);
      expect((await approve(plainInvoice)).status).toBe(200);

      const listed = await list(a.owner);
      expect(listed.status).toBe(200);
      expect(listed.body.payables).toHaveLength(2);
      expect(listed.body.payables.every((item) => item.status === "open")).toBe(true);
      expect(listed.body.totals).toMatchObject({ count: 2 });
      const byInvoice = new Map(listed.body.payables.map((item) => [item.invoiceId, item.id]));
      credited = { invoiceId: creditedInvoice, payableId: byInvoice.get(creditedInvoice)! };
      plain = { invoiceId: plainInvoice, payableId: byInvoice.get(plainInvoice)! };
    });
  });

  describe("AT4: the supplier statement", () => {
    it("balance = the sum of the invoices minus the sum of the credit memos", async () => {
      const reply = await statement(a.owner, supplierId);
      expect(reply.status).toBe(200);
      const rows = (await a.owner.client.from("payable").select("gross_amount, credited_amount"))
        .data as { gross_amount: number; credited_amount: number }[];
      const gross = rows.reduce((sum, row) => sum + Number(row.gross_amount), 0);
      const credits = rows.reduce((sum, row) => sum + Number(row.credited_amount), 0);

      expect(reply.body.totals.invoicesTotal).toBeCloseTo(gross, 2);
      expect(reply.body.totals.creditsTotal).toBeCloseTo(credits, 2);
      expect(reply.body.totals.balance).toBeCloseTo(gross - credits, 2);
      expect(reply.body.totals).toMatchObject({
        invoicesTotal: 77,
        creditsTotal: 5.5,
        balance: 71.5,
        disputedAmount: 0,
      });
      expect(reply.body.credits).toHaveLength(1);
      expect(reply.body.credits[0]).toMatchObject({
        payableId: credited.payableId,
        creditedAmount: 5.5,
      });
      expect(reply.body.invoices).toHaveLength(2);
    });
  });

  describe("AT5: a payment is locked and can only be reversed with a reason", () => {
    it("marks the payable paid with today's date", async () => {
      const reply = await patch(a.owner, plain.payableId, { status: "paid", paidOn: today() });
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({ changed: true });
      expect(reply.body.payable).toMatchObject({ status: "paid", paidOn: today() });
      const one = await detail(a.owner, plain.payableId);
      expect(one.body.canReversePayment).toBe(true);
      expect(one.body.allowedStatuses).toEqual([]);
    });

    it("a repeated tap is a harmless no-op, and a paid date in the future is refused", async () => {
      const again = await patch(a.owner, plain.payableId, { status: "paid", paidOn: today() });
      expect(again.status).toBe(200);
      expect(again.body.changed).toBe(false);
      expect(await auditOf(plain.payableId)).toHaveLength(1);
      const tomorrow = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const future = await patch(a.owner, credited.payableId, { status: "paid", paidOn: tomorrow });
      expect(future.status).toBe(422);
      expect(future.error.code).toBe("paid_on_future");
    });

    it("reopening without a reversal is refused with 409 payable_paid_locked", async () => {
      const reply = await patch(a.owner, plain.payableId, { status: "open" });
      expect(reply.status).toBe(409);
      expect(reply.error.code).toBe("payable_paid_locked");
      expect((await detail(a.owner, plain.payableId)).body.payable.status).toBe("paid");
    });

    it("a reversal needs a reason (400), then reopens the payable (200) and keeps the history", async () => {
      expect(
        (await patch(a.owner, plain.payableId, { status: "open", reversal: true })).status,
      ).toBe(400);
      const reply = await patch(a.owner, plain.payableId, {
        status: "open",
        reversal: true,
        reason: "Registrato per errore",
      });
      expect(reply.status).toBe(200);
      expect(reply.body.payable).toMatchObject({ status: "open", paidOn: null });

      const history = (await detail(a.owner, plain.payableId)).body.history;
      expect(history.map((entry) => entry.action)).toEqual([
        "created",
        "payable.status_changed",
        "payable.payment_reversed",
      ]);
      expect(history.at(-1)).toMatchObject({
        reason: "Registrato per errore",
        byName: expect.stringContaining("Titolare"),
      });
    });

    it("the audit rows read through the owner's session match", async () => {
      const audit = await auditOf(plain.payableId);
      expect(audit.map((row) => row.action)).toEqual([
        "payable.status_changed",
        "payable.payment_reversed",
      ]);
      expect(audit[0]).toMatchObject({
        before: { status: "open", paid_on: null },
        after: { status: "paid", paid_on: today() },
      });
      expect(audit[1]).toMatchObject({
        reason: "Registrato per errore",
        before: { status: "paid", paid_on: today() },
        after: { status: "open", paid_on: null },
      });
    });

    it("a paid payable leaves the statement; the unpaid ones stay", async () => {
      expect(
        (await patch(a.owner, credited.payableId, { status: "paid", paidOn: today() })).status,
      ).toBe(200);
      const reply = await statement(a.owner, supplierId);
      expect(reply.body.invoices.map((item) => item.id)).toEqual([plain.payableId]);
      expect(reply.body.totals).toMatchObject({
        invoicesTotal: 55,
        creditsTotal: 0,
        balance: 55,
      });
      expect(reply.body.credits).toEqual([]);
      const paid = await list(a.owner, "?filter=paid");
      expect(paid.body.payables.map((item) => item.id)).toEqual([credited.payableId]);
    });

    it("the admin may change a status too", async () => {
      const reply = await patch(a.admin, plain.payableId, { status: "scheduled" });
      expect(reply.status).toBe(200);
      expect(reply.body.payable.status).toBe("scheduled");
    });
  });

  describe("AT6: roles and tenants", () => {
    it("chef and waiter get 403 from all four endpoints", async () => {
      for (const user of [a.chef, a.waiter]) {
        expect((await list(user)).status).toBe(403);
        expect((await detail(user, plain.payableId)).status).toBe(403);
        expect((await patch(user, plain.payableId, { status: "open" })).status).toBe(403);
        expect((await statement(user, supplierId)).status).toBe(403);
      }
    });

    it("and 42501 straight from the database functions", async () => {
      for (const user of [a.chef, a.waiter]) {
        const calls = [
          user.client.rpc("payable_list"),
          user.client.rpc("payable_detail", { p_payable: plain.payableId }),
          user.client.rpc("supplier_statement", { p_supplier: supplierId }),
          user.client.rpc("set_payable_status", { p_payable: plain.payableId, p_status: "open" }),
        ];
        for (const result of await Promise.all(calls)) expect(result.error?.code).toBe("42501");
      }
    });

    it("chef and waiter read no payable and no payable audit row", async () => {
      for (const user of [a.chef, a.waiter]) {
        expect((await user.client.from("payable").select("id")).data).toEqual([]);
        expect(
          (await user.client.from("audit_event").select("id").eq("entity_type", "payable")).data,
        ).toEqual([]);
      }
    });

    it("owner B sees none of A's payables and gets 404 on A's payable and A's statement", async () => {
      expect((await list(b.owner)).body.payables).toEqual([]);
      expect((await detail(b.owner, plain.payableId)).status).toBe(404);
      expect((await patch(b.owner, plain.payableId, { status: "open" })).status).toBe(404);
      expect((await statement(b.owner, supplierId)).status).toBe(404);
      expect((await b.owner.client.from("payable").select("id")).data).toEqual([]);
    });

    it("nobody changes a payable with a direct write", async () => {
      for (const user of [a.owner, a.admin]) {
        const update = await user.client
          .from("payable")
          .update({ status: "paid" })
          .eq("id", plain.payableId)
          .select("id");
        expect(update.error ?? update.data).toBeTruthy();
        expect(update.data ?? []).toEqual([]);
      }
      expect((await detail(a.owner, plain.payableId)).body.payable.status).toBe("scheduled");
    });
  });
});
