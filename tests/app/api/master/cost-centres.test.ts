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
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const route = await import("@/app/api/cost-centres/route");

const BASE = "http://localhost:3000/api/cost-centres";
const ID = "cc000000-0000-4000-8000-000000000001";
const ROW = { id: ID, name: "Pulizie", is_active: true };
const ok = (data: unknown): FakeResult => ({ data, error: null });

function as(role: string, results: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), results });
}

beforeEach(() => as("owner", { cost_centre: [ok([ROW])] }));

describe("GET /api/cost-centres", () => {
  it("lists active centres by name, in camelCase", async () => {
    const response = await route.GET(new Request(BASE));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      costCentres: [{ id: ID, name: "Pulizie", isActive: true }],
    });
    expect(client.from).toHaveBeenCalledWith("cost_centre");
    expect(client.query.eq).toHaveBeenCalledWith("is_active", true);
    expect(client.query.order).toHaveBeenCalledWith("name");
  });

  it("?active=all lists deactivated ones too", async () => {
    await route.GET(new Request(`${BASE}?active=all`));
    expect(client.query.eq).not.toHaveBeenCalled();
  });

  it("works for an admin", async () => {
    as("admin", { cost_centre: [ok([])] });
    expect(await (await route.GET(new Request(BASE))).json()).toEqual({ costCentres: [] });
  });

  it.each(["chef", "waiter"])("answers 403 for a %s before any query", async (role) => {
    as(role, { cost_centre: [ok([ROW])] });
    expect((await route.GET(new Request(BASE))).status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    client = fakeSupabase({ claims: null });
    expect((await route.GET(new Request(BASE))).status).toBe(401);
  });
});

describe("POST /api/cost-centres", () => {
  it("creates a centre with the trimmed name and answers 201", async () => {
    as("owner", { cost_centre: [ok(ROW)] });
    const response = await route.POST(jsonRequest(BASE, { name: " Pulizie " }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      costCentre: { id: ID, name: "Pulizie", isActive: true },
    });
    expect(client.query.insert).toHaveBeenCalledWith({ name: "Pulizie" });
  });

  it("accepts a 60-char name", async () => {
    as("owner", { cost_centre: [ok(ROW)] });
    expect((await route.POST(jsonRequest(BASE, { name: "x".repeat(60) }))).status).toBe(201);
  });

  it.each([
    ["an empty name", { name: "" }],
    ["a blank name", { name: "   " }],
    ["a 61-char name", { name: "x".repeat(61) }],
    ["no name", {}],
    ["an unknown key", { name: "Gas", isActive: false }],
    ["a non-string name", { name: 5 }],
  ])("answers 400 for %s without querying", async (_name, body) => {
    const response = await route.POST(jsonRequest(BASE, body));
    expect(response.status).toBe(400);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("answers 409 duplicate_name when the name exists", async () => {
    as("owner", {
      cost_centre: [
        {
          data: null,
          error: {
            code: "23505",
            message: 'duplicate key value violates unique constraint "cost_centre_name_uq"',
          },
        },
      ],
    });
    const response = await route.POST(jsonRequest(BASE, { name: "pulizie" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("duplicate_name");
  });

  it.each(["chef", "waiter"])("answers 403 for a %s before any query", async (role) => {
    as(role);
    expect((await route.POST(jsonRequest(BASE, { name: "Gas" }))).status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("requires JSON", async () => {
    const response = await route.POST(
      jsonRequest(BASE, "name=Gas", { headers: { "content-type": "text/plain" } }),
    );
    expect(response.status).toBe(415);
  });

  it("exports no PUT, PATCH or DELETE (centres are only created in M4)", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) expect(route).not.toHaveProperty(method);
  });
});
