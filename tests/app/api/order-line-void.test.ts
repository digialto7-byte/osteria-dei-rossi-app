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

const route = await import("@/app/api/order-lines/[id]/void/route");
const URL_ = `http://localhost:3000/api/order-lines/${OIDS.line1}/void`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details },
});

const BODY = { reason: "kitchen_error", clientUpdatedAt: "2026-11-02T19:40:00.000Z" };
const REPLY = { changed: true, line: { ...LINE_STEW, state: "voided" } };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { void_line: [ok(REPLY)], ...rpc } });
}
const voidLine = (body: unknown, id: string = OIDS.line1, init: RequestInit = {}) =>
  route.POST(jsonRequest(URL_, body, init), routeContext({ id }));

const TIMING = /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/;

beforeEach(() => {
  reportError.mockClear();
  as("waiter");
});

describe("POST /api/order-lines/:id/void", () => {
  it.each(["owner", "admin", "waiter"])(
    "%s: one RPC with the line, the reason and the stamp",
    async (role) => {
      as(role);
      const response = await voidLine(BODY);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(REPLY);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("void_line", { p_line: OIDS.line1, p_body: BODY });
    },
  );

  it("a replay answers 200 with changed false", async () => {
    as("waiter", { void_line: [ok({ ...REPLY, changed: false })] });
    const response = await voidLine(BODY);
    expect(response.status).toBe(200);
    expect((await response.json()).changed).toBe(false);
  });

  it("carries a Server-Timing header", async () => {
    expect((await voidLine(BODY)).headers.get("server-timing")).toMatch(TIMING);
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await voidLine(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401, a malformed id 404, text/plain 415, a body over 2 KiB 413", async () => {
    client = fakeSupabase({ claims: null });
    expect((await voidLine(BODY)).status).toBe(401);
    as("waiter");
    expect((await voidLine(BODY, "x")).status).toBe(404);
    expect(
      (await voidLine("x", OIDS.line1, { headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    const big = await voidLine(BODY, OIDS.line1, {
      headers: { "content-type": "application/json", "content-length": "2049" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["no reason", { clientUpdatedAt: BODY.clientUpdatedAt }],
    ["M18's internal reason", { ...BODY, reason: "entry_removed" }],
    ["an unknown reason", { ...BODY, reason: "boh" }],
    ["no stamp", { reason: "comp" }],
    ["a stray key", { ...BODY, note: "x" }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await voidLine(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(["stale", "voided", "session_closed"] as const)(
    "a %s conflict result is a 409 conflict with the line",
    async (reason) => {
      const detail = { reason, line: LINE_STEW };
      as("waiter", { void_line: [ok({ conflict: detail })] });
      const response = await voidLine(BODY);
      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error.code).toBe("conflict");
      expect(json.error.details).toEqual(detail);
    },
  );

  it.each([
    ["P0002", "line_not_found", 404, "not_found"],
    ["P0001", "void_reason_invalid", 422, "void_reason_invalid"],
    ["P0001", "client_time_invalid", 422, "client_time_invalid"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("waiter", { void_line: [failure(code, message)] });
    const response = await voidLine(BODY);
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(apiCode);
  });

  it("an unexpected database error is a 500 that does not echo its text", async () => {
    as("waiter", { void_line: [failure("XX000", "boom")] });
    const response = await voidLine(BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
  });
});
