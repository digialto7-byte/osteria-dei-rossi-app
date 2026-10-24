import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { DINING_TABLES, IDS } from "../../helpers/menu-tables-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/dining-tables/[id]/route");
const URL_ = `http://localhost:3000/api/dining-tables/${IDS.table1}`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { update_dining_table: [ok({ changed: true, table: DINING_TABLES[0] })], ...rpc },
  });
}
const patch = (body: unknown, id: string = IDS.table1, init: RequestInit = {}) =>
  route.PATCH(jsonRequest(URL_, body, { method: "PATCH", ...init }), routeContext({ id }));

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("PATCH /api/dining-tables/:id", () => {
  it.each(["owner", "admin"])("%s: one RPC with the table and the patch", async (role) => {
    as(role);
    const response = await patch({ name: "Tavolo 1 (demo)", active: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ changed: true, table: DINING_TABLES[0] });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("update_dining_table", {
      p_table: IDS.table1,
      p_patch: { name: "Tavolo 1 (demo)", active: true },
    });
  });

  it.each(["waiter", "chef"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await patch({ active: false })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a malformed id is refused before any RPC", async () => {
    expect((await patch({ active: false }, "x")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty patch", {}],
    ["an unknown key", { open: false }],
    ["a blank name", { name: "  " }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await patch(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0002", "table_not_found", 404, "not_found"],
    ["P0001", "table_open", 409, "table_open"],
    ["P0001", "table_name_taken", 409, "table_name_taken"],
    ["P0001", "name_invalid", 422, "name_invalid"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("owner", { update_dining_table: [failure(code, message)] });
    const response = await patch({ active: false });
    expect(response.status).toBe(status);
    const json = await response.json();
    expect(json.error.code).toBe(apiCode);
    if (apiCode === "table_open") expect(json.error.message).toBe("Chiudi prima il tavolo aperto.");
  });

  it("text/plain is 415 and a body over 4 KiB is 413", async () => {
    expect(
      (await patch("x", IDS.table1, { headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    const big = await patch({ active: false }, IDS.table1, {
      headers: { "content-type": "application/json", "content-length": "4097" },
    });
    expect(big.status).toBe(413);
  });
});
