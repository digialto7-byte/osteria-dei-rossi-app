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

const varianceRoute = await import("@/app/api/reports/variance/route");
const costsRoute = await import("@/app/api/reports/variance-costs/route");
const reconciliationRoute = await import("@/app/api/reports/reconciliation/route");

const BASE = "http://localhost:3000/api/reports";
const SESSION = "51000000-0000-4000-8000-000000000001";
const ING = "1a000000-0000-4000-8000-00000000001a";
const LOC = "10000000-0000-4000-8000-0000000000a1";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const SESSION_JSON = {
  id: SESSION,
  type: "monthly",
  status: "closed",
  location: { id: LOC, name: "Cella (demo)" },
  startedAt: "2026-10-31T08:12:00+00:00",
  startedBy: { name: null, me: false },
  closedAt: "2026-10-31T09:00:00+00:00",
  closedBy: { name: null, me: false },
  cancelledAt: null,
  linesTotal: 2,
  linesCounted: 1,
  linesWithDifference: 1,
};
const VARIANCE = {
  session: SESSION_JSON,
  linesSkipped: 1,
  lines: [
    {
      ingredientId: ING,
      name: "Manzo muscolo (demo)",
      baseUnit: "kg",
      expectedQty: 7,
      countedQty: 6.8,
      differenceQty: -0.2,
      postedQty: -0.2,
    },
  ],
};
const COSTS = {
  sessionId: SESSION,
  valueEur: -2,
  lossEur: -2,
  gainEur: 0,
  unvaluedCount: 1,
  lines: [{ ingredientId: ING, valueEur: -2 }],
};
const ITEM = {
  ingredientId: ING,
  name: "Manzo muscolo (demo)",
  baseUnit: "kg",
  openingQty: 4,
  receiptsQty: 10,
  consumptionQty: 3,
  wasteQty: 2,
  transfersInQty: 0,
  transfersOutQty: 2,
  countAdjustmentsQty: -0.2,
  otherQty: 0,
  closingQty: 6.8,
  balanced: true,
  countedQty: 6.8,
  countedAt: "2026-10-31T08:30:00+00:00",
  countSessionId: SESSION,
  afterCountQty: 0,
  matchesCount: true,
};
const RECONCILIATION = {
  from: "2026-10-01",
  to: "2026-10-31",
  location: { id: LOC, name: "Cella (demo)" },
  items: [ITEM],
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: {
      count_variance: [ok(VARIANCE)],
      count_variance_costs: [ok(COSTS)],
      stock_reconciliation: [ok(RECONCILIATION)],
      ...rpc,
    },
  });
}
beforeEach(() => {
  reportError.mockClear();
  as("owner");
});
afterEach(() => vi.useRealTimers());

const get = (route: { GET: (r: Request) => Promise<Response> }, path: string, query = "") =>
  route.GET(new Request(`${BASE}/${path}${query}`));
const COST_LIKE = /"[^"]*(cost|price|eur|value|amount|margin)[^"]*"\s*:/i;

describe("GET /api/reports/variance", () => {
  const call = () => get(varianceRoute, "variance", `?session=${SESSION}`);

  it("owner, admin and chef get 200 with the quantities", async () => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      const response = await call();
      expect(response.status, role).toBe(200);
      expect(await response.json()).toEqual(VARIANCE);
    }
    expect(client.rpc).toHaveBeenCalledWith("count_variance", { p_session: SESSION });
  });

  it("the waiter and no session are refused before any RPC", async () => {
    as("waiter");
    expect((await call()).status).toBe(403);
    client = fakeSupabase({ claims: null });
    expect((await call()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("has no cost-like key or euro sign, even if the RPC reply carried one", async () => {
    as("chef", {
      count_variance: [
        ok({
          ...VARIANCE,
          lines: [{ ...VARIANCE.lines[0], unit_cost: 10, valueEur: 2 }],
          totalEur: 3,
        }),
      ],
    });
    const text = await (await call()).text();
    expect(text).not.toMatch(COST_LIKE);
    expect(text).not.toContain("€");
  });

  it.each(["", "?session=x", `?session=${SESSION}&x=1`])("answers 400 for %s", async (query) => {
    expect((await get(varianceRoute, "variance", query)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("maps count_not_closed to 409 and P0002 to 404", async () => {
    as("owner", { count_variance: [failure("P0001", "count_not_closed")] });
    const response = await call();
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("count_not_closed");
    as("owner", { count_variance: [failure("P0002", "count_not_found")] });
    expect((await call()).status).toBe(404);
  });
});

describe("GET /api/reports/variance-costs", () => {
  const call = () => get(costsRoute, "variance-costs", `?session=${SESSION}`);

  it("owner and admin get the euro values", async () => {
    for (const role of ["owner", "admin"]) {
      as(role);
      const response = await call();
      expect(response.status, role).toBe(200);
      expect(await response.json()).toEqual(COSTS);
    }
    expect(client.rpc).toHaveBeenCalledWith("count_variance_costs", { p_session: SESSION });
  });

  it("the chef and the waiter are refused before any RPC", async () => {
    for (const role of ["chef", "waiter"]) {
      as(role);
      expect((await call()).status, role).toBe(403);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });

  it("keeps a null value null, never 0", async () => {
    as("owner", {
      count_variance_costs: [ok({ ...COSTS, lines: [{ ingredientId: ING, valueEur: null }] })],
    });
    expect((await (await call()).json()).lines[0].valueEur).toBeNull();
  });

  it("maps count_not_closed to 409, a bad session to 400", async () => {
    as("owner", { count_variance_costs: [failure("P0001", "count_not_closed")] });
    expect((await call()).status).toBe(409);
    expect((await get(costsRoute, "variance-costs", "?session=x")).status).toBe(400);
  });
});

describe("GET /api/reports/reconciliation", () => {
  const call = (query = "") => get(reconciliationRoute, "reconciliation", query);

  it("owner, admin and chef get the report with the planned arguments", async () => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      const response = await call(`?from=2026-10-01&to=2026-10-31&location=${LOC}`);
      expect(response.status, role).toBe(200);
      expect(await response.json()).toEqual(RECONCILIATION);
    }
    expect(client.rpc).toHaveBeenCalledWith("stock_reconciliation", {
      p_from: "2026-10-01",
      p_to: "2026-10-31",
      p_location: LOC,
    });
  });

  it("the waiter and no session are refused before any RPC", async () => {
    as("waiter");
    expect((await call()).status).toBe(403);
    client = fakeSupabase({ claims: null });
    expect((await call()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("without dates it reports the Rome month so far: at 23:30Z on 31 October it is already 1 November", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T23:30:00Z"));
    await call();
    expect(client.rpc).toHaveBeenCalledWith("stock_reconciliation", {
      p_from: "2026-11-01",
      p_to: "2026-11-01",
      p_location: null,
    });
  });

  it("with only `to`, the month of `to` starts the period", async () => {
    await call("?to=2026-10-15");
    expect(client.rpc).toHaveBeenCalledWith("stock_reconciliation", {
      p_from: "2026-10-01",
      p_to: "2026-10-15",
      p_location: null,
    });
  });

  it("has no cost-like key or euro sign", async () => {
    as("chef", {
      stock_reconciliation: [
        ok({ ...RECONCILIATION, items: [{ ...ITEM, unit_cost: 10, valueEur: 1 }] }),
      ],
    });
    const text = await (await call("?from=2026-10-01&to=2026-10-31")).text();
    expect(text).not.toMatch(COST_LIKE);
    expect(text).not.toContain("€");
  });

  it.each(["?from=2026-13-01", "?to=31/10/2026", "?location=x", "?x=1"])(
    "answers 400 for %s",
    async (query) => {
      expect((await call(query)).status).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["range_invalid", 422],
    ["range_too_long", 422],
    ["location_required", 422],
    ["location_not_found", 422],
    ["no_location", 422],
  ])("maps %s to %i", async (message, status) => {
    as("owner", { stock_reconciliation: [failure("P0001", message)] });
    const response = await call("?from=2026-10-01&to=2026-10-31");
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(message);
  });
});
