import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { IDS, MANAGE_MENU, MAPPED_ITEM, UNMAPPED_ITEM } from "../../helpers/menu-tables-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/menu/items/route");
const URL_ = "http://localhost:3000/api/menu/items";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const BODY = {
  name: "Acqua (demo)",
  category: "Bevande",
  course: "bevande",
  recipeKey: null,
  price: 2,
  vatRate: 10,
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: {
      menu_items_manage: [ok(MANAGE_MENU)],
      create_menu_item: [ok({ item: UNMAPPED_ITEM })],
      ...rpc,
    },
  });
}
const post = (body: unknown, init: RequestInit = {}) => route.POST(jsonRequest(URL_, body, init));

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/menu/items", () => {
  it.each(["owner", "admin"])("%s gets the manage shape with one RPC", async (role) => {
    as(role);
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(MANAGE_MENU);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("menu_items_manage");
  });

  it.each(["waiter", "chef"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await route.GET(new Request(URL_))).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await route.GET(new Request(URL_))).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an injected cost key is a 500 that does not echo it", async () => {
    const leaky = { ...MANAGE_MENU, items: [{ ...MAPPED_ITEM, food_cost: 3.1 }] };
    as("owner", { menu_items_manage: [ok(leaky)] });
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("food_cost");
  });
});

describe("POST /api/menu/items", () => {
  it.each(["owner", "admin"])("%s: one RPC with the body, then 201 {item}", async (role) => {
    as(role);
    const response = await post(BODY);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ item: UNMAPPED_ITEM });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("create_menu_item", { p_body: BODY });
  });

  it("passes the optional keys on and a recipe key as given", async () => {
    const body = { ...BODY, recipeKey: IDS.recipeKey, position: 3, available: false };
    await post(body);
    expect(client.rpc).toHaveBeenCalledWith("create_menu_item", { p_body: body });
  });

  it.each(["chef", "waiter"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await post(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await post(BODY)).status).toBe(401);
  });

  it("text/plain is 415 and a body over 4 KiB is 413, both before any RPC", async () => {
    expect((await post("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    const big = await post(BODY, {
      headers: { "content-type": "application/json", "content-length": "4097" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown key", { ...BODY, pushUntil: "2026-11-02T20:00:00Z" }],
    ["no VAT rate", { ...BODY, vatRate: undefined }],
    ["a price with 3 decimals", { ...BODY, price: 2.005 }],
    ["a VAT rate that is not allowed", { ...BODY, vatRate: 12 }],
    ["an empty name", { ...BODY, name: "" }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("invalid JSON is a 400", async () => {
    expect((await post("{")).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0001", "menu_item_name_taken", 409, "menu_item_name_taken"],
    ["P0001", "recipe_already_on_menu", 409, "recipe_already_on_menu"],
    ["P0001", "recipe_not_plate", 422, "recipe_not_plate"],
    ["P0001", "recipe_inactive", 422, "recipe_inactive"],
    ["P0001", "price_invalid", 422, "price_invalid"],
    ["P0001", "vat_rate_invalid", 422, "vat_rate_invalid"],
    ["P0002", "recipe_not_found", 404, "not_found"],
    ["22023", "invalid_request", 400, "invalid_request"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("owner", { create_menu_item: [failure(code, message)] });
    const response = await post(BODY);
    expect(response.status).toBe(status);
    const json = await response.json();
    expect(json.error.code).toBe(apiCode);
    expect(json.error.message).not.toContain(message);
  });

  it("an unexpected database error is a 500 that does not echo its text", async () => {
    as("owner", { create_menu_item: [failure("XX000", "boom Acqua 2,00 €")] });
    const response = await post(BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
