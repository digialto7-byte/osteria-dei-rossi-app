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

const route = await import("@/app/api/order-lines/[id]/remove/route");
const URL_ = `http://localhost:3000/api/order-lines/${OIDS.line1}/remove`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details },
});

const BODY = { clientUpdatedAt: "2026-11-02T19:40:00.000Z" };
const REPLY = { changed: true, line: { ...LINE_STEW, state: "voided" } };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { remove_order_line: [ok(REPLY)], ...rpc },
  });
}
const remove = (body: unknown, id: string = OIDS.line1, init: RequestInit = {}) =>
  route.POST(jsonRequest(URL_, body, init), routeContext({ id }));

beforeEach(() => {
  reportError.mockClear();
  as("waiter");
});

describe("POST /api/order-lines/:id/remove", () => {
  it.each(["owner", "admin", "waiter"])("%s: one RPC with the line and the stamp", async (role) => {
    as(role);
    const response = await remove(BODY);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(REPLY);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("remove_order_line", {
      p_line: OIDS.line1,
      p_body: BODY,
    });
  });

  it("carries a Server-Timing header", async () => {
    expect((await remove(BODY)).headers.get("server-timing")).toMatch(
      /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/,
    );
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await remove(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401, a malformed id 404, text/plain 415, a big body 413", async () => {
    client = fakeSupabase({ claims: null });
    expect((await remove(BODY)).status).toBe(401);
    as("waiter");
    expect((await remove(BODY, "x")).status).toBe(404);
    expect(
      (await remove("x", OIDS.line1, { headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    const big = await remove(BODY, OIDS.line1, {
      headers: { "content-type": "application/json", "content-length": "2049" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["no stamp", {}],
    ["a reason", { ...BODY, reason: "x" }],
    ["a stamp without an offset", { clientUpdatedAt: "2026-11-02" }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await remove(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a fired line is a 409 conflict with the current line", async () => {
    const detail = { reason: "fired", line: { ...LINE_STEW, state: "fired" } };
    as("waiter", { remove_order_line: [ok({ conflict: detail })] });
    const response = await remove(BODY);
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error.details).toEqual(detail);
    expect(json.error.message).toBe("Questa riga è già stata inviata in cucina.");
  });

  it.each([
    ["P0002", "line_not_found", 404, "not_found"],
    ["P0001", "client_time_invalid", 422, "client_time_invalid"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("waiter", { remove_order_line: [failure(code, message)] });
    const response = await remove(BODY);
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(apiCode);
  });

  it("an unexpected database error is a 500 that does not echo its text", async () => {
    as("waiter", { remove_order_line: [failure("XX000", "boom")] });
    const response = await remove(BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
  });
});
