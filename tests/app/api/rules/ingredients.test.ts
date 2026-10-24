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

const route = await import("@/app/api/rules/ingredients/route");

const URL_ = "http://localhost:3000/api/rules/ingredients";
const ING = "1a000000-0000-4000-8000-00000000001a";
const ITEM = "5e000000-0000-4000-8000-000000000001";
const SUP = "5a000000-0000-4000-8000-000000000001";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const ITEM_JSON = {
  ingredientId: ING,
  name: "Manzo muscolo (demo)",
  baseUnit: "kg",
  isCritical: false,
  minLevel: 5,
  targetLevel: 12,
  onHandQty: 9,
  preferred: {
    supplierItemId: ITEM,
    supplierId: SUP,
    supplierName: "Macelleria X (demo)",
    packQty: 5,
    packLabel: "5 kg",
  },
  nextWindow: { deliveryDate: "2026-11-05", orderByAt: "2026-11-03T10:00:00Z" },
  status: "ok",
  reasons: [],
};
const CHOICE = {
  supplierItemId: ITEM,
  ingredientId: ING,
  supplierId: SUP,
  supplierName: "Macelleria X (demo)",
  packQty: 5,
  packLabel: "5 kg",
};
const READ_OWNER = { today: "2026-11-02", items: [ITEM_JSON], supplierItems: [CHOICE] };
const READ_CHEF = { today: "2026-11-02", items: [ITEM_JSON] };
const CHANGE = {
  ingredientId: ING,
  changed: true,
  minLevel: 5,
  targetLevel: 12,
  preferredSupplierItemId: ITEM,
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  const read = role === "chef" ? READ_CHEF : READ_OWNER;
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { rules_ingredients: [ok(read)], set_ingredient_rules: [ok(CHANGE)], ...rpc },
  });
}
const patch = (body: unknown, init: RequestInit = {}) =>
  route.PATCH(jsonRequest(URL_, body, { method: "PATCH", ...init }));
const BODY = { ingredientId: ING, minLevel: 5, targetLevel: 12, preferredSupplierItemId: ITEM };

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/rules/ingredients", () => {
  it.each(["owner", "admin"])(
    "%s gets the items and the supplier choices with one RPC",
    async (role) => {
      as(role);
      const response = await route.GET(new Request(URL_));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(READ_OWNER);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("rules_ingredients");
    },
  );

  it("the chef gets the items without supplier choices", async () => {
    as("chef");
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual(READ_CHEF);
    expect(json).not.toHaveProperty("supplierItems");
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("the waiter gets 403 before any RPC", async () => {
    as("waiter");
    expect((await route.GET(new Request(URL_))).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("no session is 401 before any RPC", async () => {
    client = fakeSupabase({ claims: null });
    expect((await route.GET(new Request(URL_))).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an injected last_price never reaches the JSON (strict output: a 500)", async () => {
    as("owner", {
      rules_ingredients: [ok({ ...READ_OWNER, items: [{ ...ITEM_JSON, last_price: 4.2 }] })],
    });
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("last_price");
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("supplier choices in the chef's reply are refused rather than passed on", async () => {
    as("chef", { rules_ingredients: [ok(READ_OWNER)] });
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("Macelleria");
  });

  it("maps a database refusal: 42501 is 403, an unexpected error a 500 with no text", async () => {
    as("owner", { rules_ingredients: [failure("42501", "permission denied")] });
    expect((await route.GET(new Request(URL_))).status).toBe(403);
    as("owner", { rules_ingredients: [failure("XX000", "boom 12,50 €")] });
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
  });
});

describe("PATCH /api/rules/ingredients", () => {
  it.each(["owner", "admin"])(
    "%s: one RPC with the patch, then a read for the item",
    async (role) => {
      as(role);
      const response = await patch(BODY);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ingredientId: ING, changed: true, item: ITEM_JSON });
      const calls = client.rpc.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual([
        "set_ingredient_rules",
        {
          p_ingredient: ING,
          p_patch: { minLevel: 5, targetLevel: 12, preferredSupplierItemId: ITEM },
        },
      ]);
      expect(calls[1]![0]).toBe("rules_ingredients");
    },
  );

  it("passes only the keys that were sent, and JSON null as null", async () => {
    await patch({ ingredientId: ING, preferredSupplierItemId: null });
    expect(client.rpc.mock.calls[0]).toEqual([
      "set_ingredient_rules",
      { p_ingredient: ING, p_patch: { preferredSupplierItemId: null } },
    ]);
  });

  it("an unchanged patch is a 200 with changed false", async () => {
    as("owner", { set_ingredient_rules: [ok({ ...CHANGE, changed: false })] });
    const json = await (await patch(BODY)).json();
    expect(json.changed).toBe(false);
  });

  it("the item is null when the follow-up read does not list the ingredient", async () => {
    as("owner", { rules_ingredients: [ok({ ...READ_OWNER, items: [] })] });
    const json = await (await patch(BODY)).json();
    expect(json).toEqual({ ingredientId: ING, changed: true, item: null });
  });

  it("the follow-up item has no supplierItems and no undeclared key", async () => {
    const json = await (await patch(BODY)).json();
    expect(Object.keys(json.item)).not.toContain("supplierItems");
    expect(JSON.stringify(json)).not.toMatch(/price|cost|eur/i);
  });

  it.each(["chef", "waiter"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await patch(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await patch(BODY)).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is 415 and a body over 4 KiB is 413, both before any RPC", async () => {
    expect((await patch("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    const big = await patch(BODY, {
      headers: { "content-type": "application/json", "content-length": "4097" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown key", { ...BODY, lastPrice: 1 }],
    ["an empty patch", { ingredientId: ING }],
    ["a malformed id", { ...BODY, ingredientId: "not-a-uuid" }],
    ["a malformed item id", { ingredientId: ING, preferredSupplierItemId: "x" }],
    ["a negative level", { ingredientId: ING, minLevel: -1 }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    const response = await patch(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("invalid JSON is a 400", async () => {
    expect((await patch("{")).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0001", "levels_invalid", 422, "levels_invalid"],
    ["P0001", "ingredient_not_stock", 422, "ingredient_not_stock"],
    ["P0001", "supplier_item_inactive", 422, "supplier_item_inactive"],
    ["P0002", "ingredient_not_found", 404, "not_found"],
    ["P0002", "supplier_item_not_found", 404, "not_found"],
    ["22023", "invalid_request", 400, "invalid_request"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("owner", { set_ingredient_rules: [failure(code, message)] });
    const response = await patch(BODY);
    expect(response.status).toBe(status);
    const json = await response.json();
    expect(json.error.code).toBe(apiCode);
    expect(json.error.message).not.toContain(message === "invalid_request" ? "SQL" : message);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("an unexpected database error is a 500 that does not echo its text", async () => {
    as("owner", { set_ingredient_rules: [failure("XX000", "boom Manzo 12,50 €")] });
    const response = await patch(BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("answers with no-store", async () => {
    expect((await patch(BODY)).headers.get("cache-control")).toBe("no-store");
  });
});
