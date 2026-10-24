import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/staff-meals/route");

const URL_ = "http://localhost:3000/api/staff-meals";
const KEY = "ec000000-0000-4000-8000-0000000000e1";
const PANE = "1d000000-0000-4000-8000-00000000001d";
const RULE = "5a000000-0000-4000-8000-0000000000a1";
const CONF = "5c000000-0000-4000-8000-0000000000c1";
const CELLA = "10000000-0000-4000-8000-0000000000a1";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const RULES = {
  businessDate: "2026-10-24",
  rules: [
    {
      ruleId: RULE,
      kind: "recipe",
      targetId: KEY,
      name: "Ragù (demo)",
      unit: "porzioni",
      defaultCount: 2,
      locationId: null,
      isActive: true,
      available: 6,
      today: { confirmationId: CONF, count: 2, at: "2026-10-24T10:10:00+00:00", byInitials: "CD" },
    },
  ],
};
const SAVED = {
  ruleId: RULE,
  created: true,
  kind: "recipe",
  targetId: KEY,
  defaultCount: 2,
  locationId: null,
  isActive: true,
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { staff_meal_rules: [ok(RULES)], set_staff_meal_rule: [ok(SAVED)], ...rpc },
  });
}
beforeEach(() => {
  reportError.mockClear();
  as("chef");
});

const get = () => route.GET(new Request(URL_));
const post = (body: unknown, init?: RequestInit) => route.POST(jsonRequest(URL_, body, init));

describe("GET /api/staff-meals", () => {
  it("owner, admin and chef get the rules with one RPC", async () => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      const response = await get();
      expect(response.status, role).toBe(200);
      expect(await response.json()).toEqual(RULES);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("staff_meal_rules");
    }
  });

  it("the waiter gets 403 before any RPC, and no session is 401", async () => {
    as("waiter");
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    client = fakeSupabase({ claims: null });
    expect((await get()).status).toBe(401);
  });

  it("drops a cost the reply carries", async () => {
    as("chef", {
      staff_meal_rules: [ok({ ...RULES, rules: [{ ...RULES.rules[0], unit_cost: 2 }] })],
    });
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(RULES);
  });

  it("an unexpected database error is a 500 without the database text", async () => {
    as("chef", { staff_meal_rules: [failure("XX000", "boom SEGRETO")] });
    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("SEGRETO");
  });
});

describe("POST /api/staff-meals", () => {
  it("a new recipe rule is a 201 and calls set_staff_meal_rule with the exact arguments", async () => {
    const response = await post({ recipeKey: KEY, defaultCount: 2 });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ruleId: RULE,
      kind: "recipe",
      targetId: KEY,
      defaultCount: 2,
      locationId: null,
      isActive: true,
    });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("set_staff_meal_rule", {
      p_recipe_key: KEY,
      p_ingredient_id: null,
      p_default_count: 2,
      p_unit: null,
      p_location: null,
      p_is_active: true,
    });
  });

  it("an existing rule that is updated is a 200", async () => {
    as("chef", { set_staff_meal_rule: [ok({ ...SAVED, created: false, defaultCount: 3 })] });
    const response = await post({ recipeKey: KEY, defaultCount: 3 });
    expect(response.status).toBe(200);
    expect((await response.json()).defaultCount).toBe(3);
  });

  it("an ingredient rule passes its unit, location and isActive", async () => {
    as("owner", {
      set_staff_meal_rule: [
        ok({ ...SAVED, kind: "ingredient", targetId: PANE, defaultCount: 0.5, locationId: CELLA }),
      ],
    });
    await post({
      ingredientId: PANE,
      defaultCount: 500,
      unit: "g",
      locationId: CELLA,
      isActive: false,
    });
    expect(client.rpc).toHaveBeenCalledWith("set_staff_meal_rule", {
      p_recipe_key: null,
      p_ingredient_id: PANE,
      p_default_count: 500,
      p_unit: "g",
      p_location: CELLA,
      p_is_active: false,
    });
  });

  it("owner, admin and chef may set rules; the waiter gets 403 before any RPC; no session is 401", async () => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      expect((await post({ recipeKey: KEY, defaultCount: 2 })).status, role).toBe(201);
    }
    as("waiter");
    expect((await post({ recipeKey: KEY, defaultCount: 2 })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    client = fakeSupabase({ claims: null });
    expect((await post({ recipeKey: KEY, defaultCount: 2 })).status).toBe(401);
  });

  it("text/plain is a 415, a body over 2 KiB a 413, a bad body a 400; none reaches the RPC", async () => {
    expect((await post("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect(
      (
        await post(
          { recipeKey: KEY, defaultCount: 2 },
          { headers: { "content-type": "application/json", "content-length": "2049" } },
        )
      ).status,
    ).toBe(413);
    for (const bad of [
      { recipeKey: KEY, ingredientId: PANE, defaultCount: 2, unit: "kg" },
      { defaultCount: 2 },
      { recipeKey: KEY },
      { recipeKey: KEY, defaultCount: 0 },
      { ingredientId: PANE, defaultCount: 1 },
      { recipeKey: KEY, defaultCount: 2, cost: 1 },
    ]) {
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("staff_meal_target_invalid, count_invalid and unit_mismatch are 422; rules_limit is 409", async () => {
    for (const code of ["staff_meal_target_invalid", "count_invalid", "unit_mismatch"]) {
      as("chef", { set_staff_meal_rule: [failure("P0001", code)] });
      const response = await post({ recipeKey: KEY, defaultCount: 2 });
      expect(response.status, code).toBe(422);
      expect((await response.json()).error.code).toBe(code);
    }
    as("chef", { set_staff_meal_rule: [failure("P0001", "rules_limit")] });
    const limit = await post({ recipeKey: KEY, defaultCount: 2 });
    expect(limit.status).toBe(409);
    expect((await limit.json()).error.code).toBe("rules_limit");
  });
});
