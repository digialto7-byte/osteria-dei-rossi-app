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

const collection = await import("@/app/api/supplier-items/route");
const item = await import("@/app/api/supplier-items/[id]/route");

const BASE = "http://localhost:3000/api/supplier-items";
const ID = "17000000-0000-4000-8000-000000000001";
const SUPPLIER = "5a000000-0000-4000-8000-00000000005a";
const INGREDIENT = "1a000000-0000-4000-8000-00000000001a";
const ROW = {
  id: ID,
  supplier_id: SUPPLIER,
  ingredient_id: INGREDIENT,
  supplier_code: "FAR-6",
  pack_count: 6,
  pack_qty: 1,
  pack_unit: "kg",
  pack_label: "cassa",
  is_preferred: false,
  is_active: true,
};
const CASSA = {
  supplierId: SUPPLIER,
  ingredientId: INGREDIENT,
  supplierCode: "FAR-6",
  packCount: 6,
  packQty: 1,
  packUnit: "kg",
  packLabel: "cassa",
};
const ok = (data: unknown): FakeResult => ({ data, error: null });

function as(role: string, results: Record<string, FakeResult[]> = {}, rpc = {}) {
  client = fakeSupabase({ claims: claimsFor(role), results, rpc });
}

beforeEach(() =>
  as(
    "owner",
    { ingredient: [ok({ base_unit: "kg" })], supplier_item: [ok(ROW)] },
    {
      set_preferred_supplier_item: [ok(null)],
    },
  ),
);

describe("POST /api/supplier-items (M1 acceptance test 3)", () => {
  it("creates a 6 × 1 kg cassa and reports 6 kg per pack", async () => {
    const response = await collection.POST(jsonRequest(BASE, CASSA));
    expect(response.status).toBe(201);
    const { item: created } = await response.json();
    expect(created).toMatchObject({ supplierCode: "FAR-6", baseQtyPerPack: 6, baseUnit: "kg" });
    expect(created).not.toHaveProperty("lastPrice");
    expect(client.query.insert).toHaveBeenCalledWith({
      supplier_id: SUPPLIER,
      ingredient_id: INGREDIENT,
      supplier_code: "FAR-6",
      pack_count: 6,
      pack_qty: 1,
      pack_unit: "kg",
      pack_label: "cassa",
    });
  });

  it.each([
    [{ packQty: 0 }, "invalid_pack"],
    [{ packQty: -2 }, "invalid_pack"],
    [{ packCount: 0 }, "invalid_pack"],
  ])("%j is 422 %s and nothing is written", async (change, code) => {
    const response = await collection.POST(jsonRequest(BASE, { ...CASSA, ...change }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe(code);
    expect(client.query.insert).not.toHaveBeenCalled();
  });

  it("a kg pack for an ingredient counted in pieces is 422 incompatible_units", async () => {
    as("owner", { ingredient: [ok({ base_unit: "pz" })] });
    const response = await collection.POST(jsonRequest(BASE, CASSA));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("incompatible_units");
    expect(client.query.insert).not.toHaveBeenCalled();
  });

  it("an unknown or invisible ingredient is 422 invalid_reference", async () => {
    as("owner", { ingredient: [ok(null)] });
    const response = await collection.POST(jsonRequest(BASE, CASSA));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("invalid_reference");
  });

  it("rejects lastPrice (strict body; prices come from invoices)", async () => {
    const response = await collection.POST(jsonRequest(BASE, { ...CASSA, lastPrice: 1 }));
    expect(response.status).toBe(400);
  });

  it("isPreferred goes through set_preferred_supplier_item", async () => {
    const response = await collection.POST(jsonRequest(BASE, { ...CASSA, isPreferred: true }));
    expect(response.status).toBe(201);
    expect(client.rpc).toHaveBeenCalledWith("set_preferred_supplier_item", { item_id: ID });
    expect((await response.json()).item.isPreferred).toBe(true);
  });
});

describe("cost table access", () => {
  it.each(["chef", "waiter"])("%s gets 403 on GET and POST", async (role) => {
    as(role);
    expect((await collection.GET(new Request(BASE))).status).toBe(403);
    expect((await collection.POST(jsonRequest(BASE, CASSA))).status).toBe(403);
  });

  it("owner lists items of one supplier", async () => {
    as("owner", { supplier_item: [ok([ROW])] });
    const response = await collection.GET(new Request(`${BASE}?supplierId=${SUPPLIER}`));
    expect(response.status).toBe(200);
    expect((await response.json()).items).toHaveLength(1);
    expect(client.query.eq).toHaveBeenCalledWith("supplier_id", SUPPLIER);
  });

  it("a supplierId filter that is not a uuid is 400", async () => {
    expect((await collection.GET(new Request(`${BASE}?supplierId=x`))).status).toBe(400);
  });
});

describe("PATCH /api/supplier-items/:id", () => {
  it("re-checks the pack against the ingredient when the pack changes", async () => {
    as("owner", {
      supplier_item: [ok(ROW)],
      ingredient: [ok({ base_unit: "kg" })],
    });
    const response = await item.PATCH(
      jsonRequest(`${BASE}/${ID}`, { packUnit: "l" }, { method: "PATCH" }),
      routeContext({ id: ID }),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("incompatible_units");
    expect(client.query.update).not.toHaveBeenCalled();
  });

  it("a new pack size of 0 is 422 invalid_pack", async () => {
    const response = await item.PATCH(
      jsonRequest(`${BASE}/${ID}`, { packQty: 0 }, { method: "PATCH" }),
      routeContext({ id: ID }),
    );
    expect(response.status).toBe(422);
  });

  it("deactivates without touching the pack", async () => {
    const response = await item.PATCH(
      jsonRequest(`${BASE}/${ID}`, { isActive: false }, { method: "PATCH" }),
      routeContext({ id: ID }),
    );
    expect(response.status).toBe(200);
    expect(client.query.update).toHaveBeenCalledWith({ is_active: false });
  });

  it("supplierId cannot be changed (strict body)", async () => {
    const response = await item.PATCH(
      jsonRequest(`${BASE}/${ID}`, { supplierId: SUPPLIER }, { method: "PATCH" }),
      routeContext({ id: ID }),
    );
    expect(response.status).toBe(400);
  });
});
