import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const listRoute = await import("@/app/api/payables/route");
const idRoute = await import("@/app/api/payables/[id]/route");

const ID = "90000000-0000-4000-8000-000000000001";
const SUP = "5a000000-0000-4000-8000-00000000005a";
const BASE = "http://localhost:3000/api/payables";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const ITEM = {
  id: ID,
  invoiceId: "e1000000-0000-4000-8000-0000000000e1",
  invoiceNumber: "FT 1",
  invoiceDate: "2026-10-01",
  supplierId: SUP,
  supplierName: "Fornitore Demo Srl",
  amount: 1234.5,
  dueDate: "2026-12-10",
  status: "open",
  paidOn: null,
  daysToDue: 48,
  overdue: false,
};
const DETAIL = {
  payable: {
    ...ITEM,
    grossAmount: 1234.5,
    creditedAmount: 0,
    dueDateSource: "invoice",
    paidAt: null,
  },
  allowedStatuses: ["scheduled", "paid", "disputed"],
  canReversePayment: false,
  history: [],
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: {
      payable_list: [
        ok({
          items: [ITEM],
          nextCursor: null,
          totals: { count: 1, amount: 1234.5 },
          today: "2026-10-23",
        }),
      ],
      payable_detail: [ok(DETAIL)],
      set_payable_status: [ok({ payableId: ID, status: "scheduled", paidOn: null, changed: true })],
      ...rpc,
    },
  });
}
beforeEach(() => {
  reportError.mockClear();
  // Only the clock is faked: the detail carries the venue's today (Europe/Rome).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-23T22:30:00Z"));
  as("owner");
});
afterEach(() => vi.useRealTimers());

const patch = (body: unknown, init?: RequestInit) =>
  idRoute.PATCH(
    jsonRequest(`${BASE}/${ID}`, body, { method: "PATCH", ...init }),
    routeContext({ id: ID }),
  );
const getOne = () => idRoute.GET(new Request(`${BASE}/${ID}`), routeContext({ id: ID }));

describe("role table", () => {
  const calls: [string, () => Promise<Response>][] = [
    ["GET /api/payables", () => listRoute.GET(new Request(BASE))],
    ["GET /api/payables/:id", getOne],
    ["PATCH /api/payables/:id", () => patch({ status: "scheduled" })],
  ];

  it.each(calls)("%s: chef and waiter get 403 before any RPC (AT6)", async (_name, call) => {
    for (const role of ["chef", "waiter"]) {
      as(role);
      expect((await call()).status).toBe(403);
      expect(client.rpc).not.toHaveBeenCalled();
      expect(client.from).not.toHaveBeenCalled();
    }
  });

  it.each(calls)("%s: no session is 401", async (_name, call) => {
    client = fakeSupabase({ claims: null });
    expect((await call()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(calls)("%s: owner and admin pass the role check", async (_name, call) => {
    for (const role of ["owner", "admin"]) {
      as(role);
      expect((await call()).status).toBe(200);
    }
  });
});

describe("GET /api/payables", () => {
  it("returns the list, totals, cursor and today", async () => {
    const response = await listRoute.GET(new Request(BASE));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      payables: [ITEM],
      totals: { count: 1, amount: 1234.5 },
      nextCursor: null,
      today: "2026-10-23",
    });
    expect(client.rpc).toHaveBeenCalledWith("payable_list", {
      p_filter: "unpaid",
      p_supplier: null,
      p_cursor_date: null,
      p_cursor_id: null,
      p_limit: 50,
    });
  });

  it("passes the filter, supplier and cursor through", async () => {
    await listRoute.GET(new Request(`${BASE}?filter=paid&supplier=${SUP}&before=2026-10-01_${ID}`));
    expect(client.rpc).toHaveBeenCalledWith("payable_list", {
      p_filter: "paid",
      p_supplier: SUP,
      p_cursor_date: "2026-10-01",
      p_cursor_id: ID,
      p_limit: 50,
    });
  });

  it.each(["?foo=bar", "?before=garbage", "?filter=x", "?supplier=1"])(
    "%s is a 400 and runs no RPC",
    async (qs) => {
      const response = await listRoute.GET(new Request(`${BASE}${qs}`));
      expect(response.status).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/payables/:id", () => {
  it("returns the detail", async () => {
    const response = await getOne();
    expect(await response.json()).toEqual({ ...DETAIL, today: "2026-10-24" });
    expect(client.rpc).toHaveBeenCalledWith("payable_detail", { p_payable: ID });
  });

  it("a malformed id is a 404 without any RPC", async () => {
    const response = await idRoute.GET(new Request(`${BASE}/x`), routeContext({ id: "x" }));
    expect(response.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("P0002 is a 404", async () => {
    as("owner", { payable_detail: [failure("P0002", "not_found")] });
    expect((await getOne()).status).toBe(404);
  });
});

describe("PATCH /api/payables/:id", () => {
  it("calls set_payable_status once with the five arguments, then re-reads the detail", async () => {
    const response = await patch({ status: "scheduled", reason: "Pagamento concordato" });
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledTimes(2);
    expect(client.rpc).toHaveBeenNthCalledWith(1, "set_payable_status", {
      p_payable: ID,
      p_status: "scheduled",
      p_paid_on: null,
      p_reason: "Pagamento concordato",
      p_reversal: false,
    });
    expect(client.rpc).toHaveBeenNthCalledWith(2, "payable_detail", { p_payable: ID });
    expect(await response.json()).toEqual({ payable: DETAIL.payable, changed: true });
  });

  it("passes the paid date and the reversal flag", async () => {
    await patch({ status: "paid", paidOn: "2026-10-20" });
    expect(client.rpc).toHaveBeenNthCalledWith(1, "set_payable_status", {
      p_payable: ID,
      p_status: "paid",
      p_paid_on: "2026-10-20",
      p_reason: null,
      p_reversal: false,
    });
    await patch({ status: "open", reversal: true, reason: "Errore" });
    expect(client.rpc).toHaveBeenCalledWith("set_payable_status", {
      p_payable: ID,
      p_status: "open",
      p_paid_on: null,
      p_reason: "Errore",
      p_reversal: true,
    });
  });

  it("reports changed false for a no-op", async () => {
    as("owner", {
      set_payable_status: [ok({ payableId: ID, status: "open", paidOn: null, changed: false })],
    });
    expect(await (await patch({ status: "open" })).json()).toMatchObject({ changed: false });
  });

  it("an unknown key, a bad date and a reversal without a reason are 400 before any RPC", async () => {
    for (const body of [
      { status: "open", note: "x" },
      { status: "paid", paidOn: "ieri" },
      { status: "open", reversal: true },
      { status: "scheduled", reversal: true, reason: "x" },
    ]) {
      expect((await patch(body)).status).toBe(400);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is 415 and invalid JSON is 400", async () => {
    const plain = await patch("status=open", { headers: { "content-type": "text/plain" } });
    expect(plain.status).toBe(415);
    expect((await patch("{nope")).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0001", "payable_paid_locked", 409],
    ["P0001", "payable_not_paid", 409],
    ["P0001", "payable_transition_invalid", 409],
    ["P0001", "paid_on_required", 422],
    ["P0001", "paid_on_not_allowed", 422],
    ["P0001", "paid_on_future", 422],
    ["P0001", "reason_required", 422],
    ["P0001", "reversal_target_invalid", 422],
    ["P0001", "invalid_request", 400],
    ["P0002", "not_found", 404],
    ["42501", "insufficient_privilege", 403],
  ])("%s %s is %i", async (code, message, status) => {
    as("owner", { set_payable_status: [failure(code!, message!)] });
    const response = await patch({ status: "open" });
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error.message).not.toContain(message);
  });

  it("AT5: paid -> open without a reversal is a 409 payable_paid_locked", async () => {
    as("owner", { set_payable_status: [failure("P0001", "payable_paid_locked")] });
    const response = await patch({ status: "open" });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("payable_paid_locked");
  });

  it("an unknown database error is a 500 and reports the SQLSTATE only", async () => {
    as("owner", {
      set_payable_status: [
        {
          data: null,
          error: { code: "XX000", message: "boom Merce non conforme 1234.50", details: "1234.50" },
        },
      ],
    });
    const response = await patch({ status: "disputed", reason: "Merce non conforme" });
    expect(response.status).toBe(500);
    expect(reportError).toHaveBeenCalledTimes(1);
    const reported = JSON.stringify(
      reportError.mock.calls[0]![0],
      Object.getOwnPropertyNames(reportError.mock.calls[0]![0] as object),
    );
    expect(reported).toContain("XX000");
    expect(reported).not.toMatch(/Merce|1234/);
    expect(JSON.stringify(await response.json())).not.toMatch(/Merce|1234/);
  });
});
