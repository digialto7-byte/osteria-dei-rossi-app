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

const collection = await import("@/app/api/ingredients/route");
const item = await import("@/app/api/ingredients/[id]/route");

const BASE = "http://localhost:3000/api/ingredients";
const ID = "1a000000-0000-4000-8000-00000000001a";
const ROW = {
  id: ID,
  name: "Farina",
  base_unit: "kg",
  category: "Secco",
  is_stock: true,
  allergens: ["glutine"],
  allergen_status: "declared",
  allergens_confirmed_at: null,
  default_shelf_life_days: 180,
  is_active: true,
};
const ITEM = {
  id: ID,
  name: "Farina",
  baseUnit: "kg",
  category: "Secco",
  isStock: true,
  allergens: ["glutine"],
  allergenStatus: "declared",
  allergensConfirmedAt: null,
  defaultShelfLifeDays: 180,
  isActive: true,
};
const ok = (data: unknown): FakeResult => ({ data, error: null });

function as(role: string, results: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), results });
}

beforeEach(() => as("owner", { ingredient: [ok(ROW)] }));

describe("POST /api/ingredients", () => {
  it("creates an ingredient with its base unit and allergens", async () => {
    const response = await collection.POST(
      jsonRequest(BASE, {
        name: "Farina",
        baseUnit: "kg",
        category: "Secco",
        allergens: ["glutine"],
        defaultShelfLifeDays: 180,
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ingredient: ITEM });
    expect(client.query.insert).toHaveBeenCalledWith({
      name: "Farina",
      base_unit: "kg",
      category: "Secco",
      allergens: ["glutine"],
      default_shelf_life_days: 180,
    });
  });

  it("rejects a base unit other than kg, l, pz", async () => {
    const response = await collection.POST(jsonRequest(BASE, { name: "Farina", baseUnit: "g" }));
    expect(response.status).toBe(400);
  });

  it("rejects an allergen outside the 14 EU groups", async () => {
    const response = await collection.POST(
      jsonRequest(BASE, { name: "Farina", baseUnit: "kg", allergens: ["glutammato"] }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects createdBy (strict body; set by the database)", async () => {
    const response = await collection.POST(
      jsonRequest(BASE, { name: "Farina", baseUnit: "kg", createdBy: ID }),
    );
    expect(response.status).toBe(400);
    expect(client.query.insert).not.toHaveBeenCalled();
  });

  it("a chef may not create", async () => {
    as("chef");
    expect((await collection.POST(jsonRequest(BASE, { name: "X", baseUnit: "kg" }))).status).toBe(
      403,
    );
  });
});

describe("GET and PATCH", () => {
  it("lists for the chef too", async () => {
    as("chef", { ingredient: [ok([ROW])] });
    const response = await collection.GET(new Request(BASE));
    expect(await response.json()).toEqual({ ingredients: [ITEM] });
  });

  it("a waiter may not read", async () => {
    as("waiter");
    expect((await collection.GET(new Request(BASE))).status).toBe(403);
  });

  it("the base unit cannot be changed after creation", async () => {
    const response = await item.PATCH(
      jsonRequest(`${BASE}/${ID}`, { baseUnit: "l" }, { method: "PATCH" }),
      routeContext({ id: ID }),
    );
    expect(response.status).toBe(400);
    expect(client.query.update).not.toHaveBeenCalled();
  });

  it("deactivates, and ?active=false lists it", async () => {
    as("owner", {
      ingredient: [ok({ ...ROW, is_active: false }), ok([{ ...ROW, is_active: false }])],
    });
    const patched = await item.PATCH(
      jsonRequest(`${BASE}/${ID}`, { isActive: false }, { method: "PATCH" }),
      routeContext({ id: ID }),
    );
    expect(patched.status).toBe(200);
    expect(client.query.update).toHaveBeenCalledWith({ is_active: false });
    const listed = await collection.GET(new Request(`${BASE}?active=false`));
    expect((await listed.json()).ingredients[0].isActive).toBe(false);
  });

  it("GET by id for an invalid uuid is 404", async () => {
    const response = await item.GET(new Request(`${BASE}/nope`), routeContext({ id: "nope" }));
    expect(response.status).toBe(404);
  });
});

describe("allergen state (M7)", () => {
  const UNKNOWN_ROW = {
    ...ROW,
    allergens: null,
    allergen_status: "unknown",
    allergens_confirmed_at: null,
  };

  it("shows a row without a stated list as allergens null and status unknown, never as none", async () => {
    as("chef", { ingredient: [ok([UNKNOWN_ROW])] });
    const body = await (await collection.GET(new Request(BASE))).json();
    expect(body.ingredients[0]).toMatchObject({
      allergens: null,
      allergenStatus: "unknown",
      allergensConfirmedAt: null,
    });
  });

  it("shows the confirmation time of a confirmed row", async () => {
    const confirmed = {
      ...ROW,
      allergen_status: "confirmed",
      allergens_confirmed_at: "2026-10-23T10:00:00+00:00",
    };
    as("owner", { ingredient: [ok(confirmed)] });
    const response = await item.GET(new Request(`${BASE}/${ID}`), routeContext({ id: ID }));
    expect((await response.json()).ingredient).toMatchObject({
      allergenStatus: "confirmed",
      allergensConfirmedAt: "2026-10-23T10:00:00+00:00",
    });
  });

  it("PATCH may send allergens null, back to not stated", async () => {
    as("owner", { ingredient: [ok(UNKNOWN_ROW)] });
    const response = await item.PATCH(
      jsonRequest(`${BASE}/${ID}`, { allergens: null }, { method: "PATCH" }),
      routeContext({ id: ID }),
    );
    expect(response.status).toBe(200);
    expect(client.query.update).toHaveBeenCalledWith({ allergens: null });
  });

  it("PATCH cannot write the confirmation (strict body)", async () => {
    const response = await item.PATCH(
      jsonRequest(`${BASE}/${ID}`, { allergensConfirmedAt: "2026-10-23" }, { method: "PATCH" }),
      routeContext({ id: ID }),
    );
    expect(response.status).toBe(400);
    expect(client.query.update).not.toHaveBeenCalled();
  });

  it("an empty list stays an empty list: declared none", async () => {
    await item.PATCH(
      jsonRequest(`${BASE}/${ID}`, { allergens: [] }, { method: "PATCH" }),
      routeContext({ id: ID }),
    );
    expect(client.query.update).toHaveBeenCalledWith({ allergens: [] });
  });
});
