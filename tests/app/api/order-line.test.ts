import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { LINE_STEW, OIDS } from "../../helpers/orders-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/order-lines/[id]/route");
const URL_ = `http://localhost:3000/api/order-lines/${OIDS.line1}`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details },
});

const PATCH_BODY = { clientUpdatedAt: "2026-11-02T19:40:00.000Z", course: "dolci" };
const REPLY = { changed: true, line: { ...LINE_STEW, course: "dolci" } };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { update_order_line: [ok(REPLY)], ...rpc },
  });
}
const patch = (body: unknown, id: string = OIDS.line1, init: RequestInit = {}) =>
  route.PATCH(jsonRequest(URL_, body, { method: "PATCH", ...init }), routeContext({ id }));

const TIMING = /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/;

beforeEach(() => {
  reportError.mockClear();
  as("waiter");
});

describe("PATCH /api/order-lines/:id", () => {
  it.each(["owner", "admin", "waiter"])("%s: one RPC with the line and the patch", async (role) => {
    as(role);
    const response = await patch(PATCH_BODY);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(REPLY);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("update_order_line", {
      p_line: OIDS.line1,
      p_patch: PATCH_BODY,
    });
  });

  it("carries a Server-Timing header", async () => {
    expect((await patch(PATCH_BODY)).headers.get("server-timing")).toMatch(TIMING);
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await patch(PATCH_BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await patch(PATCH_BODY)).status).toBe(401);
  });

  it("a malformed line id is a 404 without any RPC", async () => {
    expect((await patch(PATCH_BODY, "x")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is 415 and a body over 2 KiB is 413", async () => {
    expect(
      (await patch("x", OIDS.line1, { headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    const big = await patch(PATCH_BODY, OIDS.line1, {
      headers: { "content-type": "application/json", "content-length": "2049" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty patch", { clientUpdatedAt: PATCH_BODY.clientUpdatedAt }],
    ["no stamp", { qty: 2 }],
    ["qty 99.5", { ...PATCH_BODY, qty: 99.5 }],
    ["a dish change", { ...PATCH_BODY, menuItemId: OIDS.item2 }],
    ["a price", { ...PATCH_BODY, unitPrice: 1 }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await patch(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a stale edit is a 409 conflict whose details carry the current line (AT5)", async () => {
    const detail = { reason: "stale", line: { ...LINE_STEW, note: "ben cotto" } };
    as("waiter", { update_order_line: [failure("P0001", "conflict", JSON.stringify(detail))] });
    const response = await patch(PATCH_BODY);
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error.code).toBe("conflict");
    expect(json.error.details).toEqual(detail);
    expect(json.error.details.line.note).toBe("ben cotto");
    expect(json.error.message).toContain("Cameriere Demo");
  });

  it("a quantity increase on a dish that ran out is a 409 item_unavailable", async () => {
    const detail = { menuItemId: OIDS.item, reason: "no_portions", portionsLeft: 0 };
    as("waiter", {
      update_order_line: [failure("P0001", "item_unavailable", JSON.stringify(detail))],
    });
    const response = await patch({ ...PATCH_BODY, qty: 3 });
    expect(response.status).toBe(409);
    expect((await response.json()).error.details).toEqual(detail);
  });

  it.each([
    ["P0002", "line_not_found", 404, "not_found"],
    ["P0001", "qty_invalid", 422, "qty_invalid"],
    ["P0001", "client_time_invalid", 422, "client_time_invalid"],
    ["22023", "invalid_request", 400, "invalid_request"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("waiter", { update_order_line: [failure(code, message)] });
    const response = await patch(PATCH_BODY);
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(apiCode);
  });

  it("an injected margin key in the reply is a 500 that does not echo it", async () => {
    as("waiter", {
      update_order_line: [ok({ ...REPLY, line: { ...REPLY.line, margin_eur: 9.8 } })],
    });
    const response = await patch(PATCH_BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("margin_eur");
  });
});
