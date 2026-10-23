import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/batches/route");

const BASE = "http://localhost:3000/api/batches";
const KEY = "ec000000-0000-4000-8000-0000000000e1";
const B1 = "ba000000-0000-4000-8000-0000000000b1";
const B2 = "ba000000-0000-4000-8000-0000000000b2";
const CELLA = "10000000-0000-4000-8000-0000000000a1";
const SALT = "1d000000-0000-4000-8000-00000000001d";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const item = (batchId: string, over: object = {}) => ({
  batchId,
  lotCode: "261023-SPEZZA-1",
  recipeKey: KEY,
  recipeName: "Spezzatino (demo)",
  version: 1,
  producedAt: "2026-10-23T10:00:00+00:00",
  useBy: "2026-10-26T10:00:00+00:00",
  useByState: "ok",
  shelfLifeHours: 72,
  outputQty: 6.2,
  outputUnit: "kg",
  portionsComputed: 31,
  portionsInitial: 31,
  portionsRemaining: 31,
  state: "fresh",
  locationId: CELLA,
  locationName: "Cella (demo)",
  byInitials: "CD",
  byMe: true,
  ...over,
});
const LIST = { items: [item(B1), item(B2, { lotCode: "261023-BRODOD-1" })], nextCursor: null };
const COSTS = [
  {
    batch_id: B1,
    total_cost_eur: 53.5167,
    unit_cost_eur: 1.7263,
    incomplete: false,
    missing_ingredient_ids: [],
  },
  {
    batch_id: B2,
    total_cost_eur: null,
    unit_cost_eur: null,
    incomplete: true,
    missing_ingredient_ids: [SALT],
  },
];

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { batch_list: [ok(LIST)], batch_costs: [ok(COSTS)], ...rpc },
  });
}
beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

const get = (query = "") => route.GET(new Request(`${BASE}${query}`));
const COSTLY = /eur|cost|price|margin|value|amount/i;
const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : value !== null && typeof value === "object"
      ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
      : [];

describe("GET /api/batches", () => {
  it("the waiter gets 403 before any RPC, and no session is 401", async () => {
    as("waiter");
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    client = fakeSupabase({ claims: null });
    expect((await get()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("the chef gets the list with one RPC, no cost key, no euro sign", async () => {
    as("chef");
    const response = await get();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("batch_list", {
      p_recipe_key: null,
      p_before_at: null,
      p_before_id: null,
      p_limit: 50,
    });
    const body = JSON.parse(text) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(2);
    expect(body.items.every((i) => !("cost" in i))).toBe(true);
    expect(keysOf(body).filter((k) => COSTLY.test(k))).toEqual([]);
    expect(text).not.toContain("€");
  });

  it("owner and admin get batch_list, then batch_costs with the page ids, merged by id", async () => {
    for (const role of ["owner", "admin"]) {
      as(role);
      const body = await (await get()).json();
      expect(client.rpc, role).toHaveBeenCalledTimes(2);
      expect(client.rpc).toHaveBeenNthCalledWith(2, "batch_costs", { p_batch_ids: [B1, B2] });
      expect(body.items[0].cost, role).toEqual({
        totalEur: 53.5167,
        perPortionEur: 1.7263,
        incomplete: false,
      });
      // An unpriced input: null, never 0.
      expect(body.items[1].cost, role).toEqual({
        totalEur: null,
        perPortionEur: null,
        incomplete: true,
      });
      expect(JSON.stringify(body)).not.toContain("missing_ingredient_ids");
    }
  });

  it("owner: an empty page does not call batch_costs, and a batch without a cost row is incomplete", async () => {
    as("owner", { batch_list: [ok({ items: [], nextCursor: null })] });
    expect((await (await get()).json()).items).toEqual([]);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    as("owner", { batch_costs: [ok([COSTS[0]])] });
    const body = await (await get()).json();
    expect(body.items[1].cost).toEqual({ totalEur: null, perPortionEur: null, incomplete: true });
  });

  it("passes the recipe key and the cursor, and words the next cursor", async () => {
    const cursor = `2026-10-23T10:00:00+00:00_${B1}`;
    as("chef", {
      batch_list: [
        ok({ items: [item(B1)], nextCursor: { producedAt: "2026-10-23T09:00:00+00:00", id: B2 } }),
      ],
    });
    const response = await get(`?recipeKey=${KEY}&before=${encodeURIComponent(cursor)}`);
    expect(client.rpc).toHaveBeenCalledWith("batch_list", {
      p_recipe_key: KEY,
      p_before_at: "2026-10-23T10:00:00+00:00",
      p_before_id: B1,
      p_limit: 50,
    });
    expect((await response.json()).nextCursor).toBe(`2026-10-23T09:00:00+00:00_${B2}`);
  });

  it("a bad cursor, a bad key and an unknown parameter are 400s without an RPC", async () => {
    for (const query of [
      "?before=nope",
      "?recipeKey=nope",
      "?limit=9",
      `?before=2026-10-23_${B1}`,
    ]) {
      as("chef");
      expect((await get(query)).status, query).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });

  it("drops an extra field the list carries, such as a cost", async () => {
    as("chef", {
      batch_list: [ok({ items: [item(B1, { total_cost: 1, unit_cost: 2 })], nextCursor: null })],
    });
    const text = await (await get()).text();
    expect(text).not.toContain("total_cost");
    expect(text).not.toContain("unit_cost");
  });

  it.each([
    ["42501", "permission denied", 403],
    ["P0001", "invalid_request", 400],
  ])("%s %s becomes %i", async (code, message, status) => {
    as("chef", { batch_list: [failure(code, message)] });
    expect((await get()).status).toBe(status);
  });

  it("a cost read refused by the database is a 403 for the owner too (the role check stands)", async () => {
    as("owner", { batch_costs: [failure("42501", "x")] });
    expect((await get()).status).toBe(403);
  });

  it("an unexpected database error is a 500 that reports the SQLSTATE only", async () => {
    as("chef", { batch_list: [failure("XX000", "boom SEGRETO")] });
    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("SEGRETO");
    expect(String(reportError.mock.calls[0]?.[0])).toContain("XX000");
  });
});
