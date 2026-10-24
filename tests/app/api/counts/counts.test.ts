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
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const listRoute = await import("@/app/api/counts/route");
const detailRoute = await import("@/app/api/counts/[id]/route");
const linesRoute = await import("@/app/api/counts/[id]/lines/route");
const closeRoute = await import("@/app/api/counts/[id]/close/route");
const cancelRoute = await import("@/app/api/counts/[id]/cancel/route");
const criticalRoute = await import("@/app/api/counts/critical/route");

const BASE = "http://localhost:3000/api/counts";
const SESSION = "51000000-0000-4000-8000-000000000001";
const ING = "1a000000-0000-4000-8000-00000000001a";
const LOC = "10000000-0000-4000-8000-0000000000a1";
const USER = { name: "Chef Demo", me: true };

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const SESSION_JSON = {
  id: SESSION,
  type: "daily",
  status: "open",
  location: { id: LOC, name: "Cella (demo)" },
  startedAt: "2026-10-23T08:12:00+00:00",
  startedBy: USER,
  closedAt: null,
  closedBy: null,
  cancelledAt: null,
  linesTotal: 1,
  linesCounted: 0,
  linesWithDifference: 0,
};
const DETAIL_JSON = {
  ...SESSION_JSON,
  today: "2026-10-23",
  invoicesAwaitingApproval: 2,
  lines: [
    {
      ingredientId: ING,
      name: "Manzo muscolo (demo)",
      baseUnit: "kg",
      position: 1,
      expectedNowQty: 5,
      expectedQty: null,
      countedQty: null,
      differenceQty: null,
      enteredAt: null,
    },
  ],
};
const ENTRY = {
  ingredientId: ING,
  expectedQty: 5,
  countedQty: 4.5,
  differenceQty: -0.5,
  enteredAt: "2026-10-23T08:13:00+00:00",
};
const CLOSE_JSON = {
  sessionId: SESSION,
  closedAt: "2026-10-23T08:20:00+00:00",
  linesCounted: 1,
  linesSkipped: 0,
  linesWithDifference: 1,
  lines: [{ ingredientId: ING, differenceQty: -0.5 }],
};
const CANCEL_JSON = {
  sessionId: SESSION,
  status: "cancelled",
  cancelledAt: "2026-10-23T08:20:00+00:00",
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}, results = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: {
      count_sessions: [ok({ sessions: [SESSION_JSON], nextCursor: null })],
      count_start: [ok({ ...DETAIL_JSON, resumed: false })],
      count_session_view: [ok(DETAIL_JSON)],
      count_record_lines: [ok({ lines: [ENTRY] })],
      count_close: [ok(CLOSE_JSON)],
      count_cancel: [ok(CANCEL_JSON)],
      set_ingredient_critical: [ok({ ingredientId: ING, isCritical: true, changed: true })],
      ...rpc,
    },
    results: {
      ingredient: [
        ok([{ id: ING, name: "Manzo muscolo (demo)", base_unit: "kg", is_critical: true }]),
      ],
      ...results,
    },
  });
}
beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

const ctx = (id = SESSION) => routeContext({ id });
const calls: [string, () => Promise<Response>][] = [
  ["GET /api/counts", () => listRoute.GET(new Request(BASE))],
  ["POST /api/counts", () => listRoute.POST(jsonRequest(BASE, { type: "daily" }))],
  ["GET /api/counts/:id", () => detailRoute.GET(new Request(`${BASE}/${SESSION}`), ctx())],
  [
    "PUT /api/counts/:id/lines",
    () =>
      linesRoute.PUT(
        jsonRequest(
          `${BASE}/${SESSION}/lines`,
          { lines: [{ ingredientId: ING, qty: 4.5, unit: "kg" }] },
          { method: "PUT" },
        ),
        ctx(),
      ),
  ],
  [
    "POST /api/counts/:id/close",
    () => closeRoute.POST(jsonRequest(`${BASE}/${SESSION}/close`, {}), ctx()),
  ],
  [
    "POST /api/counts/:id/cancel",
    () => cancelRoute.POST(jsonRequest(`${BASE}/${SESSION}/cancel`, {}), ctx()),
  ],
  ["GET /api/counts/critical", () => criticalRoute.GET(new Request(`${BASE}/critical`))],
  [
    "PATCH /api/counts/critical",
    () =>
      criticalRoute.PATCH(
        jsonRequest(`${BASE}/critical`, { ingredientId: ING, critical: true }, { method: "PATCH" }),
      ),
  ],
];

describe("role table", () => {
  it.each(calls)("%s: owner, admin and chef get 2xx", async (_name, call) => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      const status = (await call()).status;
      expect(status, role).toBeGreaterThanOrEqual(200);
      expect(status, role).toBeLessThan(300);
    }
  });

  it.each(calls)("%s: the waiter gets 403 before any RPC or query", async (_name, call) => {
    as("waiter");
    expect((await call()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(calls)("%s: no session is 401", async (_name, call) => {
    client = fakeSupabase({ claims: null });
    expect((await call()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is a 415 on every write", async () => {
    const plain = { headers: { "content-type": "text/plain" } };
    expect((await listRoute.POST(jsonRequest(BASE, "x", plain))).status).toBe(415);
    expect(
      (
        await linesRoute.PUT(
          jsonRequest(`${BASE}/${SESSION}/lines`, "x", { ...plain, method: "PUT" }),
          ctx(),
        )
      ).status,
    ).toBe(415);
    expect(
      (await closeRoute.POST(jsonRequest(`${BASE}/${SESSION}/close`, "x", plain), ctx())).status,
    ).toBe(415);
    expect(
      (await cancelRoute.POST(jsonRequest(`${BASE}/${SESSION}/cancel`, "x", plain), ctx())).status,
    ).toBe(415);
    expect(
      (
        await criticalRoute.PATCH(
          jsonRequest(`${BASE}/critical`, "x", { ...plain, method: "PATCH" }),
        )
      ).status,
    ).toBe(415);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("GET /api/counts", () => {
  it("calls count_sessions with the page size and returns the sessions", async () => {
    const response = await listRoute.GET(new Request(`${BASE}?status=closed`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessions: [SESSION_JSON], nextCursor: null });
    expect(client.rpc).toHaveBeenCalledWith("count_sessions", {
      p_status: "closed",
      p_before_at: null,
      p_before_id: null,
      p_limit: 20,
    });
  });

  it("turns the SQL cursor into <at>_<id>, and reads ?before= back", async () => {
    as("owner", {
      count_sessions: [
        ok({
          sessions: [SESSION_JSON],
          nextCursor: { at: "2026-10-22T08:00:00+00:00", id: SESSION },
        }),
      ],
    });
    const body = await (await listRoute.GET(new Request(BASE))).json();
    expect(body.nextCursor).toBe(`2026-10-22T08:00:00+00:00_${SESSION}`);
    await listRoute.GET(new Request(`${BASE}?before=${encodeURIComponent(body.nextCursor)}`));
    expect(client.rpc).toHaveBeenLastCalledWith("count_sessions", {
      p_status: "all",
      p_before_at: "2026-10-22T08:00:00+00:00",
      p_before_id: SESSION,
      p_limit: 20,
    });
  });

  it.each(["?status=weekly", "?x=1", "?before=nope"])("answers 400 for %s", async (query) => {
    expect((await listRoute.GET(new Request(`${BASE}${query}`))).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/counts", () => {
  it("calls count_start once with the planned arguments and answers 201", async () => {
    const response = await listRoute.POST(jsonRequest(BASE, { type: "daily" }));
    expect(response.status).toBe(201);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("count_start", { p_type: "daily", p_location: null });
    const body = await response.json();
    expect(body.resumed).toBe(false);
    expect(body.lines).toHaveLength(1);
    expect(body.invoicesAwaitingApproval).toBe(2);
  });

  it("passes a location, and answers 200 when the open count was resumed", async () => {
    as("owner", { count_start: [ok({ ...DETAIL_JSON, resumed: true })] });
    const response = await listRoute.POST(jsonRequest(BASE, { type: "monthly", locationId: LOC }));
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("count_start", { p_type: "monthly", p_location: LOC });
    expect((await response.json()).resumed).toBe(true);
  });

  it.each([
    [{ type: "weekly" }, 400],
    [{ type: "daily", extra: 1 }, 400],
    [{}, 400],
  ])("%j is a 400 without an RPC", async (body, status) => {
    expect((await listRoute.POST(jsonRequest(BASE, body))).status).toBe(status);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0001", "count_open_exists", 409],
    ["P0001", "no_critical_ingredients", 422],
    ["P0001", "location_required", 422],
    ["P0001", "no_location", 422],
    ["P0001", "location_not_found", 422],
  ])("%s %s maps to %i", async (code, message, status) => {
    as("owner", { count_start: [failure(code, message)] });
    const response = await listRoute.POST(jsonRequest(BASE, { type: "daily" }));
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(message);
  });
});

describe("GET /api/counts/:id", () => {
  it("calls count_session_view", async () => {
    const response = await detailRoute.GET(new Request(`${BASE}/${SESSION}`), ctx());
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("count_session_view", { p_session: SESSION });
    expect((await response.json()).lines[0].expectedNowQty).toBe(5);
  });

  it("a malformed id is a 404 without an RPC, and so is /critical read as an id", async () => {
    for (const id of ["nope", "critical"]) {
      const response = await detailRoute.GET(new Request(`${BASE}/${id}`), ctx(id));
      expect(response.status, id).toBe(404);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("P0002 is a 404", async () => {
    as("owner", { count_session_view: [failure("P0002", "count_not_found")] });
    const response = await detailRoute.GET(new Request(`${BASE}/${SESSION}`), ctx());
    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toBe("Conteggio non trovato.");
  });
});

describe("PUT /api/counts/:id/lines", () => {
  const put = (body: unknown) =>
    linesRoute.PUT(jsonRequest(`${BASE}/${SESSION}/lines`, body, { method: "PUT" }), ctx());

  it("calls count_record_lines with snake_case lines", async () => {
    const response = await put({
      lines: [
        { ingredientId: ING, qty: 4.5, unit: "kg" },
        { ingredientId: "1a000000-0000-4000-8000-00000000001b", qty: null, unit: "g" },
      ],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ lines: [ENTRY] });
    expect(client.rpc).toHaveBeenCalledWith("count_record_lines", {
      p_session: SESSION,
      p_lines: [
        { ingredient_id: ING, qty: 4.5, unit: "kg" },
        { ingredient_id: "1a000000-0000-4000-8000-00000000001b", qty: null, unit: "g" },
      ],
    });
  });

  it.each([
    { lines: [] },
    { lines: [{ ingredientId: ING, qty: -1, unit: "kg" }] },
    {
      lines: [
        { ingredientId: ING, qty: 1, unit: "kg" },
        { ingredientId: ING, qty: 2, unit: "kg" },
      ],
    },
    { lines: [{ ingredientId: ING, qty: 1, unit: "kg", unitCost: 1 }] },
    { lines: [{ ingredientId: ING, qty: 1, unit: "kg" }], extra: true },
  ])("%j is a 400 without an RPC", async (body) => {
    expect((await put(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0001", "count_closed", 409],
    ["P0001", "count_cancelled", 409],
    ["P0001", "duplicate_line", 422],
    ["P0001", "qty_invalid", 422],
    ["P0001", "unit_mismatch", 422],
    ["P0002", "count_line_not_found", 404],
    ["P0002", "count_not_found", 404],
    ["22023", "invalid_request", 400],
  ])("%s %s maps to %i", async (code, message, status) => {
    as("owner", { count_record_lines: [failure(code, message)] });
    const response = await put({ lines: [{ ingredientId: ING, qty: 1, unit: "kg" }] });
    expect(response.status).toBe(status);
  });
});

describe("close and cancel", () => {
  it("POST …/close calls count_close and returns the result", async () => {
    const response = await closeRoute.POST(jsonRequest(`${BASE}/${SESSION}/close`, {}), ctx());
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("count_close", { p_session: SESSION });
    expect(await response.json()).toEqual(CLOSE_JSON);
  });

  it("POST …/cancel calls count_cancel", async () => {
    const response = await cancelRoute.POST(jsonRequest(`${BASE}/${SESSION}/cancel`, {}), ctx());
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("count_cancel", { p_session: SESSION });
    expect(await response.json()).toEqual(CANCEL_JSON);
  });

  it.each([
    ["count_close", "count_closed", 409],
    ["count_close", "count_cancelled", 409],
    ["count_close", "count_empty", 422],
    ["count_cancel", "count_closed", 409],
    ["count_cancel", "count_cancelled", 409],
  ])("%s %s maps to %i", async (fn, message, status) => {
    as("owner", { [fn]: [failure("P0001", message)] });
    const route = fn === "count_close" ? closeRoute : cancelRoute;
    const path = fn === "count_close" ? "close" : "cancel";
    const response = await route.POST(jsonRequest(`${BASE}/${SESSION}/${path}`, {}), ctx());
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(message);
  });

  it("a body with keys is a 400, a malformed id a 404", async () => {
    expect(
      (await closeRoute.POST(jsonRequest(`${BASE}/${SESSION}/close`, { force: 1 }), ctx())).status,
    ).toBe(400);
    expect((await closeRoute.POST(jsonRequest(`${BASE}/x/close`, {}), ctx("x"))).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("/api/counts/critical", () => {
  it("GET lists the active stock ingredients through the user's client (RLS)", async () => {
    const response = await criticalRoute.GET(new Request(`${BASE}/critical`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        { ingredientId: ING, name: "Manzo muscolo (demo)", baseUnit: "kg", isCritical: true },
      ],
      criticalCount: 1,
    });
    expect(client.from).toHaveBeenCalledWith("ingredient");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("PATCH calls set_ingredient_critical", async () => {
    const response = await criticalRoute.PATCH(
      jsonRequest(`${BASE}/critical`, { ingredientId: ING, critical: true }, { method: "PATCH" }),
    );
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("set_ingredient_critical", {
      p_ingredient: ING,
      p_critical: true,
    });
    expect(await response.json()).toEqual({ ingredientId: ING, isCritical: true, changed: true });
  });

  it("PATCH maps ingredient_not_stock to 422 and a foreign id to 404", async () => {
    as("owner", { set_ingredient_critical: [failure("P0001", "ingredient_not_stock")] });
    const body = { ingredientId: ING, critical: true };
    const patch = () =>
      criticalRoute.PATCH(jsonRequest(`${BASE}/critical`, body, { method: "PATCH" }));
    expect((await patch()).status).toBe(422);
    as("owner", { set_ingredient_critical: [failure("P0002", "ingredient_not_found")] });
    expect((await patch()).status).toBe(404);
  });

  it("PATCH refuses a bad body with a 400", async () => {
    const response = await criticalRoute.PATCH(
      jsonRequest(`${BASE}/critical`, { ingredientId: ING }, { method: "PATCH" }),
    );
    expect(response.status).toBe(400);
  });
});

describe("what the JSON may carry (V6)", () => {
  const COST_LIKE = /"[^"]*(cost|price|eur|value|amount|margin)[^"]*"\s*:/i;

  it("no count answer has a cost-like key or a euro sign, even if the RPC reply carried a cost", async () => {
    as("chef", {
      count_start: [
        ok({
          ...DETAIL_JSON,
          resumed: false,
          unit_cost: 10,
          lines: [{ ...DETAIL_JSON.lines[0], unit_cost: 10 }],
        }),
      ],
      count_session_view: [ok({ ...DETAIL_JSON, unit_cost: 10 })],
      count_record_lines: [ok({ lines: [{ ...ENTRY, unit_cost: 10 }] })],
      count_close: [ok({ ...CLOSE_JSON, valueEur: 5 })],
      count_sessions: [ok({ sessions: [{ ...SESSION_JSON, unit_cost: 3 }], nextCursor: null })],
    });
    for (const [name, call] of calls) {
      const text = await (await call()).text();
      expect(text, name).not.toMatch(COST_LIKE);
      expect(text, name).not.toContain("€");
    }
  });
});
