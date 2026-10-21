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

const collection = await import("@/app/api/suppliers/route");
const item = await import("@/app/api/suppliers/[id]/route");

const BASE = "http://localhost:3000/api/suppliers";
const ID = "5a000000-0000-4000-8000-00000000005a";
const ROW = {
  id: ID,
  name: "Fornitore Demo Srl",
  vat_number: "IT12345678903",
  payment_terms_days: 30,
  is_active: true,
};
const ok = (data: unknown): FakeResult => ({ data, error: null });

function as(role: string, results: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), results });
}

beforeEach(() => as("owner", { supplier: [ok(ROW)] }));

describe("POST /api/suppliers (M1 acceptance test 2)", () => {
  it.each(["IT12345678901", "IT1234567890", "12345678903"])(
    "%s is 422 invalid_vat_number and nothing is written",
    async (vatNumber) => {
      const response = await collection.POST(jsonRequest(BASE, { name: "X", vatNumber }));
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe("invalid_vat_number");
      expect(client.query.insert).not.toHaveBeenCalled();
    },
  );

  it("stores a valid VAT number normalised", async () => {
    const response = await collection.POST(
      jsonRequest(BASE, {
        name: "Fornitore Demo Srl",
        vatNumber: " it 12345678903",
        paymentTermsDays: 30,
      }),
    );
    expect(response.status).toBe(201);
    expect(client.query.insert).toHaveBeenCalledWith({
      name: "Fornitore Demo Srl",
      vat_number: "IT12345678903",
      payment_terms_days: 30,
    });
    expect(await response.json()).toEqual({
      supplier: {
        id: ID,
        name: "Fornitore Demo Srl",
        vatNumber: "IT12345678903",
        paymentTermsDays: 30,
        isActive: true,
      },
    });
  });

  it("a supplier without a VAT number is fine", async () => {
    const response = await collection.POST(jsonRequest(BASE, { name: "Mercato", vatNumber: null }));
    expect(response.status).toBe(201);
    expect(client.query.insert).toHaveBeenCalledWith({ name: "Mercato", vat_number: null });
  });

  it("a duplicate VAT number in the tenant is 409 duplicate_vat_number", async () => {
    as("owner", {
      supplier: [
        {
          data: null,
          error: {
            code: "23505",
            message: 'duplicate key value violates unique constraint "supplier_tenant_vat_uq"',
          },
        },
      ],
    });
    const response = await collection.POST(
      jsonRequest(BASE, { name: "X", vatNumber: "IT12345678903" }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("duplicate_vat_number");
  });

  it("rejects tenantId (strict body)", async () => {
    const response = await collection.POST(
      jsonRequest(BASE, { name: "X", tenantId: "11111111-1111-4111-8111-111111111111" }),
    );
    expect(response.status).toBe(400);
  });

  it.each(["chef", "waiter"])("%s may not create", async (role) => {
    as(role);
    expect((await collection.POST(jsonRequest(BASE, { name: "X" }))).status).toBe(403);
  });
});

describe("GET and PATCH /api/suppliers", () => {
  it("chef reads, waiter does not", async () => {
    as("chef", { supplier: [ok([ROW])] });
    expect((await collection.GET(new Request(BASE))).status).toBe(200);
    as("waiter");
    expect((await collection.GET(new Request(BASE))).status).toBe(403);
  });

  it("PATCH checks a new VAT number the same way", async () => {
    const response = await item.PATCH(
      jsonRequest(`${BASE}/${ID}`, { vatNumber: "IT12345678901" }, { method: "PATCH" }),
      routeContext({ id: ID }),
    );
    expect(response.status).toBe(422);
    expect(client.query.update).not.toHaveBeenCalled();
  });

  it("PATCH can remove the VAT number and deactivate", async () => {
    const response = await item.PATCH(
      jsonRequest(`${BASE}/${ID}`, { vatNumber: null, isActive: false }, { method: "PATCH" }),
      routeContext({ id: ID }),
    );
    expect(response.status).toBe(200);
    expect(client.query.update).toHaveBeenCalledWith({ vat_number: null, is_active: false });
  });
});
