import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { DINING_TABLES } from "../../helpers/menu-tables-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/dining-tables/route");
const URL_ = "http://localhost:3000/api/dining-tables";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: {
      dining_tables_manage: [ok({ tables: DINING_TABLES })],
      create_dining_table: [ok({ table: DINING_TABLES[0] })],
      ...rpc,
    },
  });
}
const post = (body: unknown, init: RequestInit = {}) => route.POST(jsonRequest(URL_, body, init));

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/dining-tables", () => {
  it.each(["owner", "admin"])("%s gets the tables with one RPC", async (role) => {
    as(role);
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tables: DINING_TABLES });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("dining_tables_manage");
  });

  it.each(["waiter", "chef"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await route.GET(new Request(URL_))).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await route.GET(new Request(URL_))).status).toBe(401);
  });
});

describe("POST /api/dining-tables", () => {
  it.each(["owner", "admin"])("%s: one RPC with the body, 201 {table}", async (role) => {
    as(role);
    const response = await post({ name: "Tavolo 1 (demo)", position: 1 });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ table: DINING_TABLES[0] });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("create_dining_table", {
      p_body: { name: "Tavolo 1 (demo)", position: 1 },
    });
  });

  it.each(["waiter", "chef"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await post({ name: "T" })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is 415 and a body over 4 KiB is 413", async () => {
    expect((await post("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    const big = await post(
      { name: "T" },
      {
        headers: { "content-type": "application/json", "content-length": "4097" },
      },
    );
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty name", { name: "" }],
    ["no name", {}],
    ["a name of 41 characters", { name: "x".repeat(41) }],
    ["an unknown key", { name: "T", active: false }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await post(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0001", "table_name_taken", 409, "table_name_taken"],
    ["P0001", "name_invalid", 422, "name_invalid"],
    ["P0001", "position_invalid", 422, "position_invalid"],
    ["22023", "invalid_request", 400, "invalid_request"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("owner", { create_dining_table: [failure(code, message)] });
    const response = await post({ name: "Tavolo 1 (demo)" });
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(apiCode);
  });
});
