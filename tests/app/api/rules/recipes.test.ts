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

const route = await import("@/app/api/rules/recipes/route");

const URL_ = "http://localhost:3000/api/rules/recipes";
const KEY = "4b000000-0000-4000-8000-000000000001";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const ITEM_JSON = {
  recipeKey: KEY,
  name: "Spezzatino (demo)",
  version: 3,
  portionsPerBatch: 30,
  minPortions: 5,
  targetPortions: 30,
  prepTimeMin: 180,
  sources: { min: "rule", target: "rule", prep: "version" },
  remainingPortions: 4,
};
const READ = { items: [ITEM_JSON] };
const CHANGE = {
  recipeKey: KEY,
  changed: true,
  minPortions: 5,
  targetPortions: 30,
  prepTimeMin: 180,
  sources: { min: "rule", target: "rule", prep: "version" },
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { rules_recipes: [ok(READ)], set_recipe_rules: [ok(CHANGE)], ...rpc },
  });
}
const patch = (body: unknown, init: RequestInit = {}) =>
  route.PATCH(jsonRequest(URL_, body, { method: "PATCH", ...init }));
const BODY = { recipeKey: KEY, minPortions: 5, targetPortions: 30, prepTimeMin: 180 };

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/rules/recipes", () => {
  it.each(["owner", "admin", "chef"])("%s gets the recipes with one RPC", async (role) => {
    as(role);
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(READ);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("rules_recipes");
  });

  it("the waiter gets 403 before any RPC and no session is 401", async () => {
    as("waiter");
    expect((await route.GET(new Request(URL_))).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    client = fakeSupabase({ claims: null });
    expect((await route.GET(new Request(URL_))).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an undeclared key (a cost) in the reply never reaches the JSON", async () => {
    as("owner", { rules_recipes: [ok({ items: [{ ...ITEM_JSON, last_price: 3 }] })] });
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("last_price");
  });

  it("maps 42501 to 403", async () => {
    as("owner", { rules_recipes: [failure("42501", "x")] });
    expect((await route.GET(new Request(URL_))).status).toBe(403);
  });
});

describe("PATCH /api/rules/recipes", () => {
  it.each(["owner", "admin"])(
    "%s: one RPC with the patch, then a read for the item",
    async (role) => {
      as(role);
      const response = await patch(BODY);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ recipeKey: KEY, changed: true, item: ITEM_JSON });
      expect(client.rpc.mock.calls[0]).toEqual([
        "set_recipe_rules",
        {
          p_recipe_key: KEY,
          p_patch: { minPortions: 5, targetPortions: 30, prepTimeMin: 180 },
        },
      ]);
      expect(client.rpc.mock.calls).toHaveLength(2);
      expect(client.rpc.mock.calls[1]![0]).toBe("rules_recipes");
    },
  );

  it("null clears a rule and falls back to the version", async () => {
    await patch({ recipeKey: KEY, minPortions: null });
    expect(client.rpc.mock.calls[0]).toEqual([
      "set_recipe_rules",
      { p_recipe_key: KEY, p_patch: { minPortions: null } },
    ]);
  });

  it("the item is null when the follow-up read does not list the recipe", async () => {
    as("owner", { rules_recipes: [ok({ items: [] })] });
    expect(await (await patch(BODY)).json()).toEqual({ recipeKey: KEY, changed: true, item: null });
  });

  it.each(["chef", "waiter"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await patch(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401, text/plain 415, over 4 KiB 413", async () => {
    expect((await patch("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect(
      (
        await patch(BODY, {
          headers: { "content-type": "application/json", "content-length": "4097" },
        })
      ).status,
    ).toBe(413);
    client = fakeSupabase({ claims: null });
    expect((await patch(BODY)).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown key", { ...BODY, price: 1 }],
    ["an empty patch", { recipeKey: KEY }],
    ["a malformed key", { ...BODY, recipeKey: "nope" }],
    ["portions 10001", { recipeKey: KEY, minPortions: 10_001 }],
    ["prep time 1441", { recipeKey: KEY, prepTimeMin: 1441 }],
    ["a fractional target", { recipeKey: KEY, targetPortions: 1.5 }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await patch(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0001", "recipe_not_batch", 422, "recipe_not_batch"],
    ["P0001", "portions_invalid", 422, "portions_invalid"],
    ["P0001", "prep_time_invalid", 422, "prep_time_invalid"],
    ["P0002", "recipe_not_found", 404, "not_found"],
    ["22023", "invalid_request", 400, "invalid_request"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("owner", { set_recipe_rules: [failure(code, message)] });
    const response = await patch(BODY);
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(apiCode);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("an unexpected database error is a 500 with no text", async () => {
    as("owner", { set_recipe_rules: [failure("XX000", "boom Spezzatino")] });
    const response = await patch(BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
  });
});
