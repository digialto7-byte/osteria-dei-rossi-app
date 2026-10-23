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
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const route = await import("@/app/api/ingredients/[id]/allergens/confirm/route");

const ID = "1a000000-0000-4000-8000-00000000001a";
const URL_ = `http://localhost:3000/api/ingredients/${ID}/allergens/confirm`;
const ROW = {
  id: ID,
  name: "Farina di mais (demo)",
  base_unit: "kg",
  category: null,
  is_stock: true,
  allergens: ["glutine", "latte"],
  allergen_status: "confirmed",
  allergens_confirmed_at: "2026-10-23T10:00:00+00:00",
  default_shelf_life_days: null,
  is_active: true,
};
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(
  role: string,
  rpc: Record<string, FakeResult[]> = { confirm_ingredient_allergens: [ok({})] },
) {
  client = fakeSupabase({ claims: claimsFor(role), rpc, results: { ingredient: [ok(ROW)] } });
}
const confirm = (body: unknown, init?: RequestInit) =>
  route.POST(jsonRequest(URL_, body, init), routeContext({ id: ID }));

beforeEach(() => as("owner"));

describe("POST /api/ingredients/:id/allergens/confirm", () => {
  // Q6 = owner only (founder 2026-10-23).
  it("the owner confirms through the procedure, once", async () => {
    as("owner");
    const response = await confirm({ allergens: ["latte", "glutine"] });
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("confirm_ingredient_allergens", {
      p_ingredient: ID,
      p_allergens: ["latte", "glutine"],
    });
    expect((await response.json()).ingredient).toMatchObject({
      id: ID,
      allergens: ["glutine", "latte"],
      allergenStatus: "confirmed",
      allergensConfirmedAt: "2026-10-23T10:00:00+00:00",
    });
  });

  it("de-duplicates the list and accepts the empty list (declared none)", async () => {
    await confirm({ allergens: ["latte", "latte"] });
    expect(client.rpc).toHaveBeenCalledWith("confirm_ingredient_allergens", {
      p_ingredient: ID,
      p_allergens: ["latte"],
    });
    as("owner");
    expect((await confirm({ allergens: [] })).status).toBe(200);
  });

  it.each(["admin", "chef", "waiter"])("%s gets 403 before any procedure call", async (role) => {
    as(role);
    expect((await confirm({ allergens: ["latte"] })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller gets 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await confirm({ allergens: [] })).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("refuses an unknown allergen, 15 items, a missing list, null and an extra key with 400", async () => {
    const fifteen = Array.from({ length: 15 }, () => "latte");
    for (const body of [
      { allergens: ["glutammato"] },
      { allergens: fifteen },
      {},
      { allergens: null },
      { allergens: [], confirmedBy: ID },
    ]) {
      expect((await confirm(body)).status).toBe(400);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON with 415", async () => {
    const response = await route.POST(
      new Request(URL_, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ allergens: [] }),
      }),
      routeContext({ id: ID }),
    );
    expect(response.status).toBe(415);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an id that is not a uuid is 404", async () => {
    const response = await route.POST(
      jsonRequest(URL_, { allergens: [] }),
      routeContext({ id: "nope" }),
    );
    expect(response.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("P0002 is 404", async () => {
    as("owner", { confirm_ingredient_allergens: [failure("P0002", "not_found")] });
    expect((await confirm({ allergens: [] })).status).toBe(404);
  });

  it("42501 from the database is 403", async () => {
    as("owner", { confirm_ingredient_allergens: [failure("42501", "permission denied")] });
    expect((await confirm({ allergens: [] })).status).toBe(403);
  });

  it("an unknown database error is 500 and the body names only the SQLSTATE class, no message", async () => {
    as("owner", { confirm_ingredient_allergens: [failure("XX000", "secret internal detail")] });
    const response = await confirm({ allergens: [] });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret internal detail");
  });
});
