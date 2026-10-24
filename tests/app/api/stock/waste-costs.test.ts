import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const route = await import("@/app/api/stock/waste-costs/route");

const BASE = "http://localhost:3000/api/stock/waste-costs";
const ING = "1a000000-0000-4000-8000-00000000001a";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const KEY = "ec000000-0000-4000-8000-0000000000e1";

const COSTS = {
  from: "2026-11-01",
  to: "2026-11-01",
  valueEur: 21,
  rawValueEur: 15,
  batchValueEur: 6,
  unvaluedCount: 1,
  reasons: [
    {
      reasonCode: "spoilage",
      valueEur: 21,
      rawValueEur: 15,
      batchValueEur: 6,
      batchLines: [
        { recipeKey: KEY, recipeName: "Ragù (demo)", portions: 3, valueEur: 6, unvaluedCount: 0 },
        {
          recipeKey: KEY,
          recipeName: "Brodo (demo)",
          portions: 1,
          valueEur: null,
          unvaluedCount: 1,
        },
      ],
      lines: [
        {
          ingredientId: ING,
          ingredientName: "Manzo muscolo (demo)",
          baseUnit: "kg",
          qty: 1.5,
          valueEur: 15,
        },
        {
          ingredientId: ING,
          ingredientName: "Sale grosso (demo)",
          baseUnit: "kg",
          qty: 1,
          valueEur: null,
        },
      ],
    },
  ],
  extra: "x",
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { waste_costs: [ok(COSTS)], ...rpc } });
}
beforeEach(() => {
  reportError.mockClear();
  // Only the clock is faked: 2026-10-31T23:30Z is already 1 November in Rome.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T23:30:00Z"));
  as("owner");
});
afterEach(() => vi.useRealTimers());

const get = (qs = "") => route.GET(new Request(`${BASE}${qs}`));

describe("GET /api/stock/waste-costs", () => {
  it("owner and admin get the combined report, raw and batch waste, every field mapped", async () => {
    for (const role of ["owner", "admin"]) {
      as(role);
      const response = await get();
      expect(response.status, role).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        from: "2026-11-01",
        to: "2026-11-01",
        valueEur: 21,
        rawValueEur: 15,
        batchValueEur: 6,
        unvaluedCount: 1,
        reasons: COSTS.reasons,
      });
      expect(body.extra).toBeUndefined();
    }
  });

  it("drops a key the reply carries that is not declared: top level, a reason, a line and a batch line", async () => {
    const withExtra = {
      ...COSTS,
      extra: 1,
      reasons: [
        {
          ...COSTS.reasons[0],
          extra: 1,
          lines: [{ ...COSTS.reasons[0]!.lines[0], extra: 1 }],
          batchLines: [{ ...COSTS.reasons[0]!.batchLines[0], unit_cost_frozen: 2, extra: 1 }],
        },
      ],
    };
    as("owner", { waste_costs: [ok(withExtra)] });
    const response = await get();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("unit_cost_frozen");
    expect(text).not.toContain('"extra"');
  });

  it("a batch line keeps its own unvaluedCount next to a value (a mix of complete and incomplete batches)", async () => {
    const mixed = {
      ...COSTS,
      reasons: [
        {
          ...COSTS.reasons[0],
          batchLines: [
            {
              recipeKey: KEY,
              recipeName: "Ragù (demo)",
              portions: 6,
              valueEur: 10,
              unvaluedCount: 1,
            },
          ],
        },
      ],
    };
    as("owner", { waste_costs: [ok(mixed)] });
    const body = await (await get()).json();
    expect(body.reasons[0].batchLines).toEqual(mixed.reasons[0]!.batchLines);
  });

  it("a batch line without a complete cost stays null, never 0", async () => {
    const body = await (await get()).json();
    expect(body.reasons[0].batchLines[1]).toMatchObject({
      recipeName: "Brodo (demo)",
      valueEur: null,
    });
  });

  it("chef and waiter get 403 before any RPC", async () => {
    for (const role of ["chef", "waiter"]) {
      as(role);
      expect((await get()).status, role).toBe(403);
      expect(client.rpc).not.toHaveBeenCalled();
      expect(client.from).not.toHaveBeenCalled();
    }
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await get()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("defaults to the first of the Rome month up to today (already 1 November in Rome)", async () => {
    await get();
    expect(client.rpc).toHaveBeenCalledWith("waste_costs", {
      p_from: "2026-11-01",
      p_to: "2026-11-01",
    });
  });

  it("the default month starts on the 1st of the same month", async () => {
    vi.setSystemTime(new Date("2026-10-23T10:00:00Z"));
    await get();
    expect(client.rpc).toHaveBeenCalledWith("waste_costs", {
      p_from: "2026-10-01",
      p_to: "2026-10-23",
    });
  });

  it("passes explicit dates; a lone from runs to today, a lone to starts at the 1st of its month", async () => {
    await get("?from=2026-10-05&to=2026-10-20");
    expect(client.rpc).toHaveBeenLastCalledWith("waste_costs", {
      p_from: "2026-10-05",
      p_to: "2026-10-20",
    });
    await get("?from=2026-10-05");
    expect(client.rpc).toHaveBeenLastCalledWith("waste_costs", {
      p_from: "2026-10-05",
      p_to: "2026-11-01",
    });
    await get("?to=2026-09-20");
    expect(client.rpc).toHaveBeenLastCalledWith("waste_costs", {
      p_from: "2026-09-01",
      p_to: "2026-09-20",
    });
  });

  it("a malformed date or an unknown parameter is a 400 without an RPC", async () => {
    for (const qs of [
      "?from=01/10/2026",
      "?to=2026-13-01",
      "?x=1",
      "?from=2026-10-01&from=2026-10-02",
    ]) {
      as("owner");
      expect((await get(qs)).status, qs).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });

  it("from after to, and a range that is too long, are 422 from the database", async () => {
    as("owner", { waste_costs: [failure("P0001", "range_invalid")] });
    const invalid = await get("?from=2026-10-24&to=2026-10-23");
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).error.code).toBe("range_invalid");
    as("owner", { waste_costs: [failure("P0001", "range_too_long")] });
    const long = await get("?from=2025-01-01&to=2026-10-23");
    expect(long.status).toBe(422);
    expect((await long.json()).error.code).toBe("range_too_long");
  });

  it("42501 from the database is a 403 (a stale token)", async () => {
    as("owner", {
      waste_costs: [failure("42501", "permission denied: costs need owner or admin")],
    });
    expect((await get()).status).toBe(403);
  });
});
