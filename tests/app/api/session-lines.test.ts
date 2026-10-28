import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { ADD_REPLY, LINE_STEW, OIDS, ORDER_VIEW } from "../../helpers/orders-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/table-sessions/[id]/lines/route");
const URL_ = `http://localhost:3000/api/table-sessions/${OIDS.session}/lines`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details },
});

const BODY = {
  lineId: OIDS.line1,
  menuItemId: OIDS.item,
  clientUpdatedAt: "2026-11-02T19:30:00.123Z",
  course: "secondi",
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { order_view: [ok(ORDER_VIEW)], add_order_line: [ok(ADD_REPLY)], ...rpc },
  });
}
const get = (id: string = OIDS.session) => route.GET(new Request(URL_), routeContext({ id }));
const post = (body: unknown, id: string = OIDS.session, init: RequestInit = {}) =>
  route.POST(jsonRequest(URL_, body, init), routeContext({ id }));

const TIMING = /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/;

beforeEach(() => {
  reportError.mockClear();
  as("waiter");
});

describe("GET /api/table-sessions/:id/lines", () => {
  it.each(["owner", "admin", "waiter"])("%s reads the order with one RPC", async (role) => {
    as(role);
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ORDER_VIEW);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("order_view", { p_session: OIDS.session });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("carries a Server-Timing header with auth, rpc and total", async () => {
    expect((await get()).headers.get("server-timing")).toMatch(TIMING);
  });

  it("answers with no-store", async () => {
    expect((await get()).headers.get("cache-control")).toBe("no-store");
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await get()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a malformed session id is a 404 without any RPC", async () => {
    expect((await get("x")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("session_not_found is a 404", async () => {
    as("waiter", { order_view: [failure("P0002", "session_not_found")] });
    const response = await get();
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("an injected unit_cost / margin_eur in a line never reaches the JSON", async () => {
    const leaky = structuredClone(ORDER_VIEW) as unknown as { lines: Record<string, unknown>[] };
    leaky.lines[0]!.unit_cost = 4.2;
    leaky.lines[0]!.margin_eur = 9.8;
    as("waiter", { order_view: [ok(leaky)] });
    const response = await get();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("unit_cost");
    expect(text).not.toContain("margin_eur");
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/table-sessions/:id/lines", () => {
  it.each(["owner", "admin", "waiter"])(
    "%s: one RPC with the session and the body",
    async (role) => {
      as(role);
      const response = await post(BODY);
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual(ADD_REPLY);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("add_order_line", {
        p_session: OIDS.session,
        p_body: BODY,
      });
    },
  );

  it("a replay (created false) is a 200", async () => {
    as("waiter", { add_order_line: [ok({ ...ADD_REPLY, created: false })] });
    const response = await post(BODY);
    expect(response.status).toBe(200);
    expect((await response.json()).created).toBe(false);
  });

  it("carries a Server-Timing header", async () => {
    expect((await post(BODY)).headers.get("server-timing")).toMatch(TIMING);
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await post(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await post(BODY)).status).toBe(401);
  });

  it("a malformed session id is a 404 without any RPC", async () => {
    expect((await post(BODY, "x")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is 415", async () => {
    const response = await post("x", OIDS.session, { headers: { "content-type": "text/plain" } });
    expect(response.status).toBe(415);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a body over 2 KiB is 413", async () => {
    const response = await post(BODY, OIDS.session, {
      headers: { "content-type": "application/json", "content-length": "2049" },
    });
    expect(response.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["no lineId", { ...BODY, lineId: undefined }],
    ["qty 0.3", { ...BODY, qty: 0.3 }],
    ["a price", { ...BODY, unitPrice: 1 }],
    ["a note of 141 characters", { ...BODY, note: "x".repeat(141) }],
    ["a stamp without an offset", { ...BODY, clientUpdatedAt: "2026-11-02T19:30:00" }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await post(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("item_unavailable is a 409 whose details name the dish, the reason and the portions left (AT1)", async () => {
    const detail = { menuItemId: OIDS.item, reason: "no_portions", portionsLeft: 0 };
    as("waiter", {
      add_order_line: [failure("P0001", "item_unavailable", JSON.stringify(detail))],
    });
    const response = await post(BODY);
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error.code).toBe("item_unavailable");
    expect(json.error.details).toEqual(detail);
    expect(json.error.details.menuItemId).toBe(OIDS.item);
  });

  it.each([
    ["P0002", "session_not_found", 404, "not_found"],
    ["P0002", "menu_item_not_found", 404, "not_found"],
    ["P0001", "session_closed", 409, "session_closed"],
    ["P0001", "line_id_conflict", 409, "line_id_conflict"],
    ["P0001", "qty_invalid", 422, "qty_invalid"],
    ["P0001", "note_invalid", 422, "note_invalid"],
    ["P0001", "course_invalid", 422, "course_invalid"],
    ["P0001", "client_time_invalid", 422, "client_time_invalid"],
    ["22023", "invalid_request", 400, "invalid_request"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("waiter", { add_order_line: [failure(code, message)] });
    const response = await post(BODY);
    expect(response.status).toBe(status);
    const json = await response.json();
    expect(json.error.code).toBe(apiCode);
    expect(json.error.details).toBeUndefined();
  });

  it("an injected cost key in the reply is a 500 that does not echo it", async () => {
    as("waiter", {
      add_order_line: [ok({ ...ADD_REPLY, line: { ...LINE_STEW, food_cost: 2.2 } })],
    });
    const response = await post(BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("food_cost");
  });

  it("an unexpected database error is a 500 that does not echo its text", async () => {
    as("waiter", { add_order_line: [failure("XX000", "boom senza cipolla")] });
    const response = await post(BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
