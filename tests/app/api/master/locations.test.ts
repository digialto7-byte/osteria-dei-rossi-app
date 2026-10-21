import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  OWNER_CLAIMS,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const collection = await import("@/app/api/locations/route");
const item = await import("@/app/api/locations/[id]/route");

const BASE = "http://localhost:3000/api/locations";
const ID = "0c000000-0000-4000-8000-00000000000c";
const ROW = { id: ID, name: "Cella", is_active: true };
const ok = (data: unknown): FakeResult => ({ data, error: null });

function as(role: string, results: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), results });
}

beforeEach(() => as("owner", { location: [ok([ROW])] }));

describe("GET /api/locations", () => {
  it("lists active locations, sorted by name, in camelCase", async () => {
    const response = await collection.GET(new Request(BASE));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      locations: [{ id: ID, name: "Cella", isActive: true }],
    });
    expect(client.query.eq).toHaveBeenCalledWith("is_active", true);
    expect(client.query.order).toHaveBeenCalledWith("name");
  });

  it("?active=all lists deactivated ones too, ?active=false only those", async () => {
    await collection.GET(new Request(`${BASE}?active=all`));
    expect(client.query.eq).not.toHaveBeenCalled();
    await collection.GET(new Request(`${BASE}?active=false`));
    expect(client.query.eq).toHaveBeenCalledWith("is_active", false);
  });

  it.each(["owner", "admin", "chef"])("%s may read", async (role) => {
    as(role, { location: [ok([])] });
    expect((await collection.GET(new Request(BASE))).status).toBe(200);
  });

  it("a waiter may not", async () => {
    as("waiter");
    expect((await collection.GET(new Request(BASE))).status).toBe(403);
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await collection.GET(new Request(BASE))).status).toBe(401);
  });
});

describe("POST /api/locations", () => {
  it("creates a location: 201", async () => {
    as("owner", { location: [ok(ROW)] });
    const response = await collection.POST(jsonRequest(BASE, { name: " Cella " }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ location: { id: ID, name: "Cella", isActive: true } });
    expect(client.query.insert).toHaveBeenCalledWith({ name: "Cella" });
  });

  it.each(["chef", "waiter"])("%s may not create", async (role) => {
    as(role);
    expect((await collection.POST(jsonRequest(BASE, { name: "X" }))).status).toBe(403);
  });

  it("rejects an unknown field such as tenantId (strict body)", async () => {
    const response = await collection.POST(
      jsonRequest(BASE, { name: "X", tenantId: OWNER_CLAIMS.tenant_id }),
    );
    expect(response.status).toBe(400);
    expect(client.query.insert).not.toHaveBeenCalled();
  });

  it("a duplicate name is 409 duplicate_name", async () => {
    as("owner", {
      location: [
        { data: null, error: { code: "23505", message: 'unique constraint "location_name_uq"' } },
      ],
    });
    const response = await collection.POST(jsonRequest(BASE, { name: "Cella" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("duplicate_name");
  });
});

describe("/api/locations/:id", () => {
  it("GET returns one location", async () => {
    as("chef", { location: [ok(ROW)] });
    const response = await item.GET(new Request(`${BASE}/${ID}`), routeContext({ id: ID }));
    expect(await response.json()).toEqual({ location: { id: ID, name: "Cella", isActive: true } });
  });

  it("GET of a missing or invisible row is 404", async () => {
    as("owner", { location: [ok(null)] });
    const response = await item.GET(new Request(`${BASE}/${ID}`), routeContext({ id: ID }));
    expect(response.status).toBe(404);
  });

  it("PATCH deactivates", async () => {
    as("owner", { location: [ok({ ...ROW, is_active: false })] });
    const response = await item.PATCH(
      jsonRequest(`${BASE}/${ID}`, { isActive: false }, { method: "PATCH" }),
      routeContext({ id: ID }),
    );
    expect(response.status).toBe(200);
    expect(client.query.update).toHaveBeenCalledWith({ is_active: false });
    expect(client.query.eq).toHaveBeenCalledWith("id", ID);
  });

  it("an empty PATCH is 400", async () => {
    const response = await item.PATCH(
      jsonRequest(`${BASE}/${ID}`, {}, { method: "PATCH" }),
      routeContext({ id: ID }),
    );
    expect(response.status).toBe(400);
  });

  it("has no DELETE handler (nothing is deleted, only deactivated)", () => {
    expect("DELETE" in item).toBe(false);
    expect("DELETE" in collection).toBe(false);
  });
});
