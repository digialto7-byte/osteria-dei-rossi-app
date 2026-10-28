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

const route = await import("@/app/api/costs/plates/[key]/route");
const { breakdownSchema } = await import("@/server/costing/plate-breakdown");

// UX plan B13 (P1-10): GET /api/costs/plates/:key. Owner and admin get the euro figures, the chef percentages only (V6),
// the waiter nothing. The document is built by public.plate_breakdown(); the route checks its shape for the role.
const KEY = "ec000000-0000-4000-8000-000000000004";
const SALT = "1d000000-0000-4000-8000-00000000001d";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const line = (
  position: number,
  name: string,
  share: number | null,
  cost?: number | null,
  extra = {},
) => ({
  position,
  target: { kind: "ingredient", id: `1a000000-0000-4000-8000-00000000000${position}`, name },
  sharePct: share,
  incomplete: share === null,
  reason: share === null ? "no_price" : null,
  ...(cost === undefined ? {} : { lineCostEur: cost }),
  ...extra,
});
const core = {
  recipeKey: KEY,
  name: "Spezzatino con polenta (demo)",
  version: 1,
  at: null,
  status: "ok",
  incomplete: false,
  reasons: [],
  missingIngredientIds: [],
  foodCostPct: 18.8528,
  gpPct: 81.1472,
  targetGpPct: 70,
};
const OWNER_DOC = {
  ...core,
  lines: [
    line(1, "Manzo (demo)", 81.04, 1.6667),
    line(3, "Pane (demo)", 14.59, 0.3),
    line(2, "Farina (demo)", 4.38, 0.09),
  ],
  money: { foodCostEur: 2.0567, salePriceExVatEur: 10.9091, grossMarginEur: 8.8524 },
};
const CHEF_DOC = {
  ...core,
  lines: [
    line(1, "Manzo (demo)", 81.04),
    line(3, "Pane (demo)", 14.59),
    line(2, "Farina (demo)", 4.38),
  ],
};

function as(
  role: string,
  doc: FakeResult = ok(role === "chef" ? CHEF_DOC : OWNER_DOC),
  ingredients: FakeResult = ok([]),
) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: { plate_breakdown: [doc] },
    results: { ingredient: [ingredients] },
  });
}
type Handler = (
  request: Request,
  context: { params: Promise<{ key: string }> },
) => Promise<Response>;
const get = (query = "", key = KEY) =>
  (route.GET as Handler)(new Request(`http://localhost:3000/api/costs/plates/${key}${query}`), {
    params: Promise.resolve({ key }),
  });
const noQueries = () => {
  expect(client.rpc).not.toHaveBeenCalled();
  expect(client.from).not.toHaveBeenCalled();
};
const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)])
      : [];

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/costs/plates/:key: who may read", () => {
  it("refuses the waiter with 403 before any query", async () => {
    as("waiter");
    expect((await get()).status).toBe(403);
    noQueries();
  });

  it("refuses a visitor with 401", async () => {
    as("none");
    expect((await get()).status).toBe(401);
    noQueries();
  });

  it("answers a key that is not a uuid with 404, as every path parameter does, before any query", async () => {
    expect((await get("", "not-a-uuid")).status).toBe(404);
    noQueries();
  });

  it.each(["owner", "admin", "chef"])("lets the %s in", async (role) => {
    as(role);
    expect((await get()).status).toBe(200);
  });
});

describe("GET /api/costs/plates/:key: the owner and the admin", () => {
  it.each(["owner", "admin"])(
    "%s: the breakdown with euro figures, as the database built it",
    async (role) => {
      as(role);
      const body = await (await get()).json();
      expect(breakdownSchema("owner").parse(body)).toEqual(body);
      expect(body.lines.map((l: { target: { name: string } }) => l.target.name)).toEqual([
        "Manzo (demo)",
        "Pane (demo)",
        "Farina (demo)",
      ]);
      expect(body.lines[0].lineCostEur).toBe(1.6667);
      expect(body.money).toEqual({
        foodCostEur: 2.0567,
        salePriceExVatEur: 10.9091,
        grossMarginEur: 8.8524,
      });
      expect(body.missingIngredients).toEqual([]);
    },
  );

  it("calls the function with the key and no date by default", async () => {
    await get();
    expect(client.rpc).toHaveBeenCalledWith("plate_breakdown", { p_key: KEY, p_date: null });
  });

  it("passes ?at=YYYY-MM-DD as the day", async () => {
    await get("?at=2026-10-01");
    expect(client.rpc).toHaveBeenCalledWith("plate_breakdown", {
      p_key: KEY,
      p_date: "2026-10-01",
    });
  });

  it.each(["?at=2026-13-01", "?at=ieri", "?x=1", "?at=2026-10-01&at=2026-10-02"])(
    "%s is a 400 and reads nothing",
    async (query) => {
      expect((await get(query)).status).toBe(400);
      noQueries();
    },
  );

  it("a day in the future is a 422", async () => {
    const response = await get("?at=2999-01-01");
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "date_in_future",
    );
  });

  it("names the missing ingredients from the ingredient table", async () => {
    as(
      "owner",
      ok({
        ...OWNER_DOC,
        incomplete: true,
        status: "incomplete",
        missingIngredientIds: [SALT],
        lines: [line(1, "Polenta (demo)", null, null), line(2, "Sale (demo)", null, null)],
        money: { foodCostEur: null, salePriceExVatEur: 10.9091, grossMarginEur: null },
      }),
      ok([{ id: SALT, name: "Sale grosso (demo)" }]),
    );
    const body = await (await get()).json();
    expect(body.missingIngredients).toEqual([{ id: SALT, name: "Sale grosso (demo)" }]);
    expect(body.missingIngredientIds).toBeUndefined();
    expect(body.lines[0].incomplete).toBe(true);
    expect(body.lines[0].reason).toBe("no_price");
  });
});

describe("GET /api/costs/plates/:key: the chef sees percentages only (V6)", () => {
  beforeEach(() => as("chef"));

  it("answers with shares and percentages, matching the chef schema", async () => {
    const body = await (await get()).json();
    expect(breakdownSchema("chef").parse(body)).toEqual(body);
    expect(body.foodCostPct).toBe(18.8528);
    expect(body.lines.map((l: { sharePct: number }) => l.sharePct)).toEqual([81.04, 14.59, 4.38]);
  });

  it("carries no key about euro, no money block, no line cost", async () => {
    const body = await (await get()).json();
    expect(keysOf(body).filter((k) => /eur|money/i.test(k))).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/€/);
  });

  it("any query is a 400 for the chef, and nothing is read", async () => {
    for (const query of ["?at=2026-10-01", "?x=1"]) {
      as("chef");
      expect((await get(query)).status).toBe(400);
      noQueries();
    }
  });

  it("fails closed if the database ever put a euro key in the chef's document: a 500, and the figure does not leave", async () => {
    as("chef", ok({ ...CHEF_DOC, lines: [line(1, "Manzo (demo)", 81.04, 1.6667)] }));
    const response = await get();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("cost_unavailable");
    expect(text).not.toContain("1.6667");
    expect(reportError).toHaveBeenCalled();
  });

  it("the same for a money block", async () => {
    as("chef", ok({ ...CHEF_DOC, money: OWNER_DOC.money }));
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("2.0567");
  });
});

describe("GET /api/costs/plates/:key: failures", () => {
  it("an owner's document without the money block is refused as malformed (500)", async () => {
    as("owner", ok(CHEF_DOC));
    expect((await get()).status).toBe(500);
  });

  it.each([
    ["42501", "permission denied", 403, "forbidden"],
    ["P0002", "not_found", 404, "not_found"],
    ["P0002", "recipe_not_in_force", 404, "recipe_not_in_force"],
    ["P0001", "recipe_not_plate", 422, "recipe_not_plate"],
    ["P0001", "date_in_future", 422, "date_in_future"],
  ])("database %s %s becomes %i %s", async (code, message, status, apiCode) => {
    as("owner", failure(code, message));
    const response = await get();
    expect(response.status).toBe(status);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(apiCode);
  });

  it("an unexpected database error is a plain 500 with no detail", async () => {
    as("owner", failure("XX000", "secret internals"));
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret internals");
  });
});
