import { beforeEach, describe, expect, it, vi } from "vitest";
import { routeContext, type FakeResult, type FakeSupabase } from "../../../helpers/fake-supabase";
import { INVOICE_ID, LINE_ID, dbError, ok, reviewClient } from "../../../helpers/review-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const split = await import("@/app/api/invoices/[id]/lines/[lineId]/split/route");
const unsplit = await import("@/app/api/invoices/[id]/lines/[lineId]/unsplit/route");
const { splitDiff } = await import("@/server/invoices/review-actions");

const BASE = `http://localhost:3000/api/invoices/${INVOICE_ID}/lines/${LINE_ID}`;
const context = routeContext({ id: INVOICE_ID, lineId: LINE_ID });
const PARENT = ok({ qty: 3, line_amount: 30 });

const post = (handler: typeof split.POST, path: string, body: unknown, init: RequestInit = {}) =>
  handler(
    new Request(`${BASE}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...init,
    }),
    context,
  );
const doSplit = (body: unknown, init?: RequestInit) => post(split.POST, "split", body, init);
const doUnsplit = (body: unknown = {}, init?: RequestInit) =>
  post(unsplit.POST, "unsplit", body, init);

function asRole(role: string, rpc: Record<string, FakeResult> = {}, parent: FakeResult = PARENT) {
  client = reviewClient(role, {
    rpc: Object.fromEntries(Object.entries(rpc).map(([name, result]) => [name, [result]])),
    tables: { invoice_line: [parent, ok([])] },
  });
}

const half = [
  { qty: 1, lineAmount: 10 },
  { qty: 2, lineAmount: 20 },
];

beforeEach(() => asRole("owner"));

describe("splitDiff", () => {
  it("compares in whole ten-thousandths, so 0.1 + 0.2 matches 0.3", () => {
    expect(
      splitDiff({ qty: 0.3, lineAmount: 0.3 }, [
        { qty: 0.1, lineAmount: 0.1 },
        { qty: 0.2, lineAmount: 0.2 },
      ]),
    ).toEqual({ qtyDiff: 0, amountDiff: 0 });
  });

  it("reports children minus parent", () => {
    expect(
      splitDiff({ qty: 3, lineAmount: 30 }, [
        { qty: 1, lineAmount: 10 },
        { qty: 1.5, lineAmount: 20.01 },
      ]),
    ).toEqual({
      qtyDiff: -0.5,
      amountDiff: 0.01,
    });
  });
});

describe("POST /api/invoices/:id/lines/:lineId/split", () => {
  it("calls the procedure with snake_case children and returns the review", async () => {
    const response = await doSplit({ children: half });
    expect(response.status).toBe(200);
    expect((await response.json()).review.lines).toHaveLength(0);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("review_split_line", {
      p_invoice: INVOICE_ID,
      p_line: LINE_ID,
      p_children: [
        { qty: 1, line_amount: 10 },
        { qty: 2, line_amount: 20 },
      ],
    });
    expect(client.query.eq).toHaveBeenCalledWith("id", LINE_ID);
    expect(client.query.eq).toHaveBeenCalledWith("invoice_id", INVOICE_ID);
  });

  it("refuses sums that do not add up, with the differences, and does not call the procedure (AT3)", async () => {
    const response = await doSplit({
      children: [
        { qty: 1, lineAmount: 10 },
        { qty: 1.5, lineAmount: 20 },
      ],
    });
    expect(response.status).toBe(422);
    const { error } = await response.json();
    expect(error.code).toBe("split_sum_mismatch");
    expect(error.details).toEqual([{ qtyDiff: -0.5, amountDiff: 0 }]);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("refuses an amount that is one cent short (AT3)", async () => {
    const response = await doSplit({
      children: [
        { qty: 1, lineAmount: 10 },
        { qty: 2, lineAmount: 19.99 },
      ],
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error.details).toEqual([{ qtyDiff: 0, amountDiff: -0.01 }]);
  });

  it("accepts the float trap 0.1 + 0.2 = 0.3", async () => {
    asRole("owner", {}, ok({ qty: "0.3000", line_amount: "0.3000" }));
    const response = await doSplit({
      children: [
        { qty: 0.1, lineAmount: 0.1 },
        { qty: 0.2, lineAmount: 0.2 },
      ],
    });
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("answers 404 when the line is not visible", async () => {
    asRole("owner", {}, ok(null));
    expect((await doSplit({ children: half })).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["maps split_sum_mismatch from the database", "split_sum_mismatch", 422],
    ["maps split_credit_conflict", "split_credit_conflict", 422],
    ["maps split_child_cannot_split", "split_child_cannot_split", 422],
    ["maps invoice_not_in_review", "invoice_not_in_review", 409],
  ])("%s", async (_name, code, status) => {
    asRole("owner", { review_split_line: dbError("P0001", code) });
    const response = await doSplit({ children: half });
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  });

  it.each([
    ["one child", { children: [{ qty: 3, lineAmount: 30 }] }],
    [
      "eleven children",
      { children: Array.from({ length: 11 }, () => ({ qty: 1, lineAmount: 1 })) },
    ],
    ["no children key", {}],
    [
      "a zero qty",
      {
        children: [
          { qty: 0, lineAmount: 0 },
          { qty: 3, lineAmount: 30 },
        ],
      },
    ],
    [
      "a negative amount",
      {
        children: [
          { qty: 1, lineAmount: -1 },
          { qty: 2, lineAmount: 31 },
        ],
      },
    ],
    [
      "five decimals",
      {
        children: [
          { qty: 1.00001, lineAmount: 1 },
          { qty: 2, lineAmount: 29 },
        ],
      },
    ],
    ["an unknown key", { children: half, extra: 1 }],
    ["an unknown child key", { children: [{ qty: 1, lineAmount: 10, x: 1 }, half[1]] }],
  ])("answers 400 for %s without any call", async (_name, body) => {
    const response = await doSplit(body);
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("accepts exactly ten children", async () => {
    asRole("owner", {}, ok({ qty: 10, line_amount: 10 }));
    const children = Array.from({ length: 10 }, () => ({ qty: 1, lineAmount: 1 }));
    expect((await doSplit({ children })).status).toBe(200);
  });

  it.each(["chef", "waiter"])("answers 403 for a %s", async (role) => {
    asRole(role);
    expect((await doSplit({ children: half })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("requires JSON", async () => {
    const response = await doSplit("x", { headers: { "content-type": "text/plain" } });
    expect(response.status).toBe(415);
  });
});

describe("POST /api/invoices/:id/lines/:lineId/unsplit", () => {
  // Unsplit reads no parent row: the first invoice_line read is the review's own.
  const as = (role: string, rpc: Record<string, FakeResult> = {}) => asRole(role, rpc, ok([]));

  beforeEach(() => as("owner"));

  it("calls the procedure and returns the review", async () => {
    const response = await doUnsplit();
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("review_unsplit_line", {
      p_invoice: INVOICE_ID,
      p_line: LINE_ID,
    });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(await response.json()).toHaveProperty("review");
  });

  it("answers 409 not_split", async () => {
    as("owner", { review_unsplit_line: dbError("P0001", "not_split") });
    const response = await doUnsplit();
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("not_split");
  });

  it("answers 400 for a body with fields", async () => {
    expect((await doUnsplit({ x: 1 })).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(["chef", "waiter"])("answers 403 for a %s", async (role) => {
    as(role);
    expect((await doUnsplit()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("answers 404 for another tenant's line (P0002)", async () => {
    as("owner", { review_unsplit_line: dbError("P0002", "not_found") });
    expect((await doUnsplit()).status).toBe(404);
  });
});
