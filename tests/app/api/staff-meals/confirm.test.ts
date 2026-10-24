import { beforeEach, describe, expect, it, vi } from "vitest";
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

const route = await import("@/app/api/staff-meals/[id]/confirm/route");

const RULE = "5a000000-0000-4000-8000-0000000000a1";
const CONF = "5c000000-0000-4000-8000-0000000000c1";
const BATCH = "ba000000-0000-4000-8000-0000000000b1";
const PANE = "1d000000-0000-4000-8000-00000000001d";
const CELLA = "10000000-0000-4000-8000-0000000000a1";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const RESULT = {
  confirmationId: CONF,
  ruleId: RULE,
  businessDate: "2026-10-24",
  count: 2,
  movements: [{ batchId: BATCH, portions: 2 }],
  negatives: [],
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { confirm_staff_meal: [ok(RESULT)], ...rpc },
  });
}
beforeEach(() => {
  reportError.mockClear();
  as("chef");
});

const post = (body: unknown = {}, id: string = RULE, init?: RequestInit) =>
  route.POST(
    jsonRequest(`http://localhost:3000/api/staff-meals/${id}/confirm`, body, init),
    routeContext({ id }),
  );

describe("POST /api/staff-meals/:id/confirm", () => {
  it("owner, admin and chef get 201 and the RPC is called once with the default count (AT5)", async () => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      const response = await post();
      expect(response.status, role).toBe(201);
      expect(await response.json()).toEqual(RESULT);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("confirm_staff_meal", {
        p_rule: RULE,
        p_count: null,
      });
    }
  });

  it("passes the count of the day when one is given", async () => {
    await post({ count: 3 });
    expect(client.rpc).toHaveBeenCalledWith("confirm_staff_meal", { p_rule: RULE, p_count: 3 });
  });

  it("an ingredient meal returns its quantity and the negatives, without a cost", async () => {
    const raw = {
      ...RESULT,
      movements: [{ ingredientId: PANE, qty: -0.5 }],
      negatives: [{ ingredientId: PANE, locationId: CELLA, onHandQty: -0.5 }],
      unit_cost: 3,
    };
    as("chef", { confirm_staff_meal: [ok(raw)] });
    const response = await post();
    expect(response.status).toBe(201);
    const { unit_cost: _dropped, ...expected } = raw;
    expect(await response.json()).toEqual(expected);
  });

  it("the waiter gets 403 before any RPC, and no session is 401", async () => {
    as("waiter");
    expect((await post()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    client = fakeSupabase({ claims: null });
    expect((await post()).status).toBe(401);
  });

  it("a malformed id is a 404 without an RPC", async () => {
    expect((await post({}, "nope")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is a 415, a body over 2 KiB a 413, a bad body a 400; none reaches the RPC", async () => {
    expect((await post("x", RULE, { headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect(
      (
        await post({}, RULE, {
          headers: { "content-type": "application/json", "content-length": "2049" },
        })
      ).status,
    ).toBe(413);
    for (const bad of [{ count: 0 }, { count: 1001 }, { count: -1 }, { extra: 1 }]) {
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a second confirmation the same day is a 409, from the pre-check (P0001) and from the unique key (23505)", async () => {
    for (const error of [
      failure("P0001", "staff_meal_already_confirmed"),
      failure("23505", 'violates unique constraint "staff_meal_confirmation_day_uq"'),
    ]) {
      as("chef", { confirm_staff_meal: [error] });
      const response = await post();
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe("staff_meal_already_confirmed");
      expect(body.error.message).toBe("Già confermato per oggi.");
    }
  });

  it("portions_insufficient and an inactive rule are 409, count_invalid is 422, an unknown rule 404", async () => {
    for (const [code, status] of [
      ["portions_insufficient", 409],
      ["staff_meal_rule_inactive", 409],
      ["count_invalid", 422],
    ] as const) {
      as("chef", { confirm_staff_meal: [failure("P0001", code)] });
      const response = await post();
      expect(response.status, code).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
    as("chef", { confirm_staff_meal: [failure("P0002", "staff_meal_rule_not_found")] });
    const missing = await post();
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("not_found");
  });

  it("an unexpected database error is a 500 without the database text", async () => {
    as("chef", { confirm_staff_meal: [failure("XX000", "boom SEGRETO")] });
    const response = await post();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("SEGRETO");
  });
});
