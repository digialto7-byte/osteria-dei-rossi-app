import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { IDS, MAPPED_ITEM } from "../../helpers/menu-tables-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/menu/[id]/route");
const URL_ = `http://localhost:3000/api/menu/${IDS.item}`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { update_menu_item: [ok({ changed: true, item: MAPPED_ITEM })], ...rpc },
  });
}
const patch = (body: unknown, id: string = IDS.item, init: RequestInit = {}) =>
  route.PATCH(jsonRequest(URL_, body, { method: "PATCH", ...init }), routeContext({ id }));

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("PATCH /api/menu/:id", () => {
  it.each(["owner", "admin"])(
    "%s: one RPC with the id and the patch, 200 {changed, item}",
    async (role) => {
      as(role);
      const response = await patch({ price: 15, vatRate: 22 });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ changed: true, item: MAPPED_ITEM });
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("update_menu_item", {
        p_item: IDS.item,
        p_patch: { price: 15, vatRate: 22 },
      });
    },
  );

  it("passes active and a null recipe key through", async () => {
    await patch({ active: false, recipeKey: null });
    expect(client.rpc).toHaveBeenCalledWith("update_menu_item", {
      p_item: IDS.item,
      p_patch: { active: false, recipeKey: null },
    });
  });

  it("an unchanged patch is a 200 with changed false", async () => {
    as("owner", { update_menu_item: [ok({ changed: false, item: MAPPED_ITEM })] });
    expect((await (await patch({ price: 14 })).json()).changed).toBe(false);
  });

  it.each(["chef", "waiter"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await patch({ price: 15 })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await patch({ price: 15 })).status).toBe(401);
  });

  it("a malformed id is refused before any RPC (the same 404 as a missing row)", async () => {
    const response = await patch({ price: 15 }, "not-a-uuid");
    expect(response.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is 415 and a body over 4 KiB is 413", async () => {
    expect((await patch("x", IDS.item, { headers: { "content-type": "text/plain" } })).status).toBe(
      415,
    );
    const big = await patch({ price: 15 }, IDS.item, {
      headers: { "content-type": "application/json", "content-length": "4097" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty patch", {}],
    ["a push key", { pushPrice: 12 }],
    ["an unknown key", { id: IDS.item }],
    ["a price with 3 decimals", { price: 14.005 }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    const response = await patch(body);
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0002", "menu_item_not_found", 404, "not_found"],
    ["P0002", "recipe_not_found", 404, "not_found"],
    ["P0001", "menu_item_name_taken", 409, "menu_item_name_taken"],
    ["P0001", "recipe_already_on_menu", 409, "recipe_already_on_menu"],
    ["P0001", "recipe_not_plate", 422, "recipe_not_plate"],
    ["P0001", "price_invalid", 422, "price_invalid"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("owner", { update_menu_item: [failure(code, message)] });
    const response = await patch({ price: 15 });
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(apiCode);
  });

  it("an unexpected database error is a 500 that does not echo its text", async () => {
    as("owner", { update_menu_item: [failure("XX000", "boom 2,00 €")] });
    const response = await patch({ price: 15 });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
  });
});
