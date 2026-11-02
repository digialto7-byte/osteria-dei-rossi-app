import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays } from "@/lib/time/venue-date";
import type { InvoiceItem } from "@/server/invoices/invoices";
import type { PayableListResult } from "@/server/payables/types";
import { seedLocation, seedReviewInvoice } from "./helpers/invoices";
import {
  createStack,
  readStackEnv,
  type Stack,
  type TestTenant,
  type TestUser,
} from "./helpers/stack";

// M25b step 15 (plan §5): the Fatture and Pagamenti filters against the real local stack. The route handlers run for real (strict query
// parsing, the role check, the invoice RLS select, payable_list with its range); only `createSupabaseServerClient` is replaced, because it
// would read cookies from a Next.js request: each call is handed the signed-in test user's own client.
//
// Dates: the invoice dates are fixed fixture values; every other date comes from a reply (the payable's `dueDate`, `GET /api/tables`
// `businessDate` for the payment day), never from the calendar's today. Fake data only.
// The tests run in order and share state. Throws in CI when the stack settings are missing; skips on a developer machine.
const env = readStackEnv();

const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => session.client,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const invoicesRoute = await import("@/app/api/invoices/route");
const approveRoute = await import("@/app/api/invoices/[id]/approve/route");
const payablesRoute = await import("@/app/api/payables/route");
const payableRoute = await import("@/app/api/payables/[id]/route");
const suppliersRoute = await import("@/app/api/suppliers/route");
const supplierRoute = await import("@/app/api/suppliers/[id]/route");
const tablesRoute = await import("@/app/api/tables/route");

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
}

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
  return { status: response.status, body: (await response.json()) as T };
}

// Valid fake VAT numbers (the checksum is enforced by the supplier table).
const VAT_1 = "IT12345678903";
const VAT_2 = "IT01234567897";
const DATE_1 = "2026-09-14";
const DATE_2 = "2026-09-28";
const DATE_3 = "2026-09-21";

describe.skipIf(!env)("Fatture and Pagamenti filters on the real stack", () => {
  let stack: Stack;
  let a: TestTenant;
  let b: TestTenant;
  let s1: string;
  let s2: string;
  let ingredientId: string;
  const invoiceOf: Record<string, string> = {};
  const payableOf: Record<string, string> = {};
  const dueOf: Record<string, string> = {};
  let businessDay: string;

  const invoices = (user: TestUser, query = "") =>
    call<{ invoices: InvoiceItem[] }>(user, invoicesRoute.GET as Handler, `/api/invoices${query}`);
  const payables = (user: TestUser, query = "") =>
    call<PayableListResult>(user, payablesRoute.GET as Handler, `/api/payables${query}`);
  const ids = (reply: Reply<{ invoices: InvoiceItem[] }>) => reply.body.invoices.map((i) => i.id);

  async function supplier(name: string, vat: string) {
    const made = await stack.admin
      .from("supplier")
      .insert({ tenant_id: a.id, name, vat_number: vat, payment_terms_days: 30 })
      .select("id")
      .single();
    expect(made.error).toBeNull();
    return made.data!.id as string;
  }

  beforeAll(async () => {
    stack = await createStack(env!);
    a = stack.tenantA;
    b = stack.tenantB;
    s1 = await supplier("Fornitore Demo A", VAT_1);
    s2 = await supplier("Fornitore Demo B", VAT_2);
    await seedLocation(stack.admin, a.id);
    const ingredient = await stack.admin
      .from("ingredient")
      .insert({ tenant_id: a.id, name: "Farina 00", base_unit: "kg" })
      .select("id")
      .single();
    expect(ingredient.error).toBeNull();
    ingredientId = ingredient.data!.id as string;

    // Three invoices: two of supplier 1 (dates 1 and 2), one of supplier 2 (date 3).
    for (const [key, supplierId, date] of [
      ["i1", s1, DATE_1],
      ["i2", s1, DATE_2],
      ["i3", s2, DATE_3],
    ] as const) {
      const id = await seedReviewInvoice(stack.admin, a.id, {
        supplierId,
        date,
        lines: [{ description: "Farina 00", ingredientId, qty: 2, unit: "kg", unitPrice: 10 }],
      });
      invoiceOf[key] = id;
      const approved = await call(
        a.owner,
        approveRoute.POST as Handler,
        `/api/invoices/${id}/approve`,
        {
          method: "POST",
          body: {},
          params: { id },
        },
      );
      expect(approved.status).toBe(200);
    }
    // The payables the approvals created, with the due dates the server computed.
    const all = await payables(a.owner, "?filter=all");
    for (const [key, id] of Object.entries(invoiceOf)) {
      const found = all.body.payables.find((p) => p.invoiceId === id)!;
      payableOf[key] = found.id;
      dueOf[key] = found.dueDate;
    }
    // The business day, as the app shows it, for the payment date.
    businessDay = (
      await call<{ businessDate: string }>(a.owner, tablesRoute.GET as Handler, "/api/tables")
    ).body.businessDate;
  });

  describe("GET /api/invoices", () => {
    it("?supplier= returns that supplier's invoices only", async () => {
      const reply = await invoices(a.owner, `?supplier=${s1}`);
      expect(reply.status).toBe(200);
      expect(ids(reply)).toEqual(expect.arrayContaining([invoiceOf.i1!, invoiceOf.i2!]));
      expect(ids(reply)).not.toContain(invoiceOf.i3!);
    });

    it("?from=&to= on an invoice's own date includes it, and the day before excludes it", async () => {
      const day = (await invoices(a.owner)).body.invoices.find(
        (i) => i.id === invoiceOf.i2,
      )!.invoiceDate!;
      const same = await invoices(a.owner, `?from=${day}&to=${day}`);
      expect(ids(same)).toContain(invoiceOf.i2!);
      expect(ids(same)).not.toContain(invoiceOf.i1!);
      const before = await invoices(a.owner, `?from=${addDays(day, -2)}&to=${addDays(day, -1)}`);
      expect(ids(before)).not.toContain(invoiceOf.i2!);
    });

    it("one side only works: from after all dates is empty of ours, to before all dates too", async () => {
      expect(ids(await invoices(a.owner, "?from=2030-01-01"))).not.toContain(invoiceOf.i1!);
      expect(ids(await invoices(a.owner, "?to=2000-01-01"))).not.toContain(invoiceOf.i1!);
      expect(ids(await invoices(a.owner, "?to=2030-01-01"))).toContain(invoiceOf.i1!);
    });

    it("another tenant's owner with A's supplier id gets 200 and nothing", async () => {
      const reply = await invoices(b.owner, `?supplier=${s1}`);
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ invoices: [] });
    });

    it("chef and waiter get 403, and from after to is a 400", async () => {
      expect((await invoices(a.chef, `?supplier=${s1}`)).status).toBe(403);
      expect((await invoices(a.waiter, `?supplier=${s1}`)).status).toBe(403);
      expect((await invoices(a.owner, "?from=2026-10-31&to=2026-10-01")).status).toBe(400);
      expect((await invoices(a.owner, "?foo=1")).status).toBe(400);
    });
  });

  describe("GET /api/payables", () => {
    it("filter=all with from=to=<a due date> returns only payables due that day", async () => {
      const due = dueOf.i2!;
      const reply = await payables(a.owner, `?filter=all&from=${due}&to=${due}`);
      expect(reply.status).toBe(200);
      expect(reply.body.payables.map((p) => p.id)).toContain(payableOf.i2!);
      expect(reply.body.payables.every((p) => p.dueDate === due)).toBe(true);
    });

    it("a supplier filter narrows the list and the unpaid totals", async () => {
      const reply = await payables(a.owner, `?filter=unpaid&supplier=${s2}`);
      expect(reply.body.payables.map((p) => p.id)).toEqual([payableOf.i3!]);
      expect(reply.body.totals).toMatchObject({ count: 1 });
    });

    it("the unpaid totals follow the range", async () => {
      const due = dueOf.i1!;
      const reply = await payables(a.owner, `?filter=unpaid&supplier=${s1}&from=${due}&to=${due}`);
      expect(reply.body.totals?.count).toBe(reply.body.payables.length);
      expect(reply.body.payables.map((p) => p.id)).toContain(payableOf.i1!);
    });

    it("a paid range is on the payment date, not the due date", async () => {
      const paid = await call(
        a.owner,
        payableRoute.PATCH as Handler,
        `/api/payables/${payableOf.i1}`,
        {
          method: "PATCH",
          body: { status: "paid", paidOn: businessDay },
          params: { id: payableOf.i1! },
        },
      );
      expect(paid.status).toBe(200);
      const onDay = await payables(a.owner, `?filter=paid&from=${businessDay}&to=${businessDay}`);
      expect(onDay.body.payables.map((p) => p.id)).toContain(payableOf.i1!);
      const dayBefore = addDays(businessDay, -1);
      const earlier = await payables(a.owner, `?filter=paid&from=${dayBefore}&to=${dayBefore}`);
      expect(earlier.body.payables.map((p) => p.id)).not.toContain(payableOf.i1!);
      const byDue = await payables(a.owner, `?filter=paid&from=${dueOf.i1}&to=${dueOf.i1}`);
      expect(byDue.body.payables.map((p) => p.id)).not.toContain(payableOf.i1!);
    });

    it("another tenant's owner with A's supplier id gets 200 and nothing", async () => {
      const reply = await payables(b.owner, `?filter=all&supplier=${s1}`);
      expect(reply.status).toBe(200);
      expect(reply.body.payables).toEqual([]);
    });

    it("chef and waiter get 403, and from after to is a 400", async () => {
      expect((await payables(a.chef, "?from=2026-11-01")).status).toBe(403);
      expect((await payables(a.waiter, "?from=2026-11-01")).status).toBe(403);
      expect((await payables(a.owner, "?from=2026-11-30&to=2026-11-01")).status).toBe(400);
    });
  });

  describe("GET /api/suppliers (T1)", () => {
    it("still lists a supplier that was deactivated, with no query", async () => {
      const off = await call(a.owner, supplierRoute.PATCH as Handler, `/api/suppliers/${s2}`, {
        method: "PATCH",
        body: { isActive: false },
        params: { id: s2 },
      });
      expect(off.status).toBe(200);
      const reply = await call<{ suppliers: { id: string; isActive: boolean }[] }>(
        a.owner,
        suppliersRoute.GET as Handler,
        "/api/suppliers",
      );
      expect(reply.status).toBe(200);
      expect(reply.body.suppliers.find((s) => s.id === s2)).toMatchObject({ isActive: false });
    });
  });
});
