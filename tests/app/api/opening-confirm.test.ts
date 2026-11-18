import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// Opening stock step 15 (plan 2026-11-18 §3.9, §5 step 15): POST confirm and POST reverse. Owner and admin only; one RPC each.
let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: () => undefined }));

const confirmRoute = await import("@/app/api/stock/opening/confirm/route");
const reverseRoute = await import("@/app/api/stock/opening/[id]/reverse/route");

const BASE = "http://localhost:3000/api/stock/opening";
const LOC = "10000000-0000-4000-8000-0000000000a1";
const ING = "1a000000-0000-4000-8000-000000000001";
const OPENING = "0e000000-0000-4000-8000-000000000001";
const REQ = "e0000000-0000-4000-8000-000000000001";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details: string | null = null): FakeResult => ({
  data: null,
  error: { code, message, details },
});

const LINES = [
  { id: "0d000000-0000-4000-8000-000000000001", ingredientId: ING, qty: 25, unitCostEur: 0.8 },
];
const BODY = { locationId: LOC, effectiveOn: "2026-12-01", requestId: REQ, lines: LINES };
const BOOKED = {
  openingId: OPENING,
  locationId: LOC,
  effectiveOn: "2026-12-01",
  lineCount: 1,
  totalValueEur: 20,
  changed: true,
};
const REVERSED = {
  openingId: OPENING,
  reversalOperationId: REQ,
  restoredLineIds: ["0d000000-0000-4000-8000-000000000009"],
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { post_opening_stock: [ok(BOOKED)], reverse_opening_stock: [ok(REVERSED)], ...rpc },
  });
}
beforeEach(() => as("owner"));

const confirm = (body: unknown = BODY) => confirmRoute.POST(jsonRequest(`${BASE}/confirm`, body));
const reverse = (body: unknown = { reason: "cost_wrong" }, id = OPENING) =>
  reverseRoute.POST(jsonRequest(`${BASE}/${id}/reverse`, body), routeContext({ id }));

describe("POST /api/stock/opening/confirm", () => {
  it("an owner's POST confirm calls post_opening_stock with p_location, p_effective_on, p_request_id, p_lines and answers 201", async () => {
    const response = await confirm();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(BOOKED);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("post_opening_stock", {
      p_location: LOC,
      p_effective_on: "2026-12-01",
      p_request_id: REQ,
      p_lines: LINES,
    });
  });

  it("a replay answer (changed: false) is a 200", async () => {
    as("admin", { post_opening_stock: [ok({ ...BOOKED, changed: false })] });
    const response = await confirm();
    expect(response.status).toBe(200);
    expect((await response.json()).changed).toBe(false);
  });

  it("opening_draft_changed is a 409; opening_date_after_receipt a 422 with details.date", async () => {
    as("owner", { post_opening_stock: [failure("P0001", "opening_draft_changed")] });
    expect((await confirm()).status).toBe(409);
    as("owner", {
      post_opening_stock: [failure("P0001", "opening_date_after_receipt", "2026-12-03")],
    });
    const response = await confirm();
    expect(response.status).toBe(422);
    expect((await response.json()).error).toEqual({
      code: "opening_date_after_receipt",
      message: "La data deve essere prima della prima fattura ricevuta (3 dic).",
      details: { date: "2026-12-03" },
    });
  });

  it("a malformed body is a 400 with no RPC", async () => {
    for (const body of [
      { ...BODY, effectiveOn: "1/12/2026" },
      { ...BODY, requestId: "r1" },
      { ...BODY, lines: [] },
      { ...BODY, extra: 1 },
    ]) {
      as("owner");
      expect((await confirm(body)).status).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });
});

describe("POST /api/stock/opening/:id/reverse", () => {
  it("the body {reason: 'cost_wrong'} calls reverse_opening_stock and answers 201", async () => {
    const response = await reverse();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(REVERSED);
    expect(client.rpc).toHaveBeenCalledWith("reverse_opening_stock", {
      p_opening: OPENING,
      p_reason: "cost_wrong",
    });
  });

  it("{reason: 'foo'} is a 400 with no RPC", async () => {
    expect((await reverse({ reason: "foo" })).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("already_reversed and opening_draft_not_empty are 409; opening_not_found a 404", async () => {
    for (const [code, message, status] of [
      ["P0001", "already_reversed", 409],
      ["P0001", "opening_draft_not_empty", 409],
      ["P0002", "opening_not_found", 404],
    ] as const) {
      as("owner", { reverse_opening_stock: [failure(code, message)] });
      expect((await reverse()).status, message).toBe(status);
    }
  });
});

describe("roles", () => {
  it("chef and waiter get 403 on confirm and reverse, before any RPC; the admin may", async () => {
    for (const role of ["chef", "waiter"]) {
      as(role);
      expect((await confirm()).status, role).toBe(403);
      expect((await reverse()).status, role).toBe(403);
      expect(client.rpc, role).not.toHaveBeenCalled();
    }
    as("admin");
    expect((await confirm()).status).toBe(201);
    expect((await reverse()).status).toBe(201);
  });
});
