import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { ticketMarkBody } from "@/lib/kitchen/kitchen-done";
import { KITCHEN_TICKETS } from "../../helpers/kitchen-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/kitchen/tickets/mark/route");
const URL_ = "http://localhost:3000/api/kitchen/tickets/mark";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details },
});

const BODY = ticketMarkBody(KITCHEN_TICKETS.tickets[0]!, true);
const REPLY = { changed: true, board: KITCHEN_TICKETS };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { kitchen_set_ticket: [ok(REPLY)], ...rpc },
  });
}
const mark = (body: unknown, init: RequestInit = {}) =>
  route.POST(jsonRequest(URL_, body, init), routeContext({}));

const TIMING = /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/;

beforeEach(() => {
  reportError.mockClear();
  as("chef");
});

describe("POST /api/kitchen/tickets/mark", () => {
  it.each(["chef", "owner", "admin"])("%s: one RPC with the five fields", async (role) => {
    as(role);
    const response = await mark(BODY);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(REPLY);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("kitchen_set_ticket", { p_body: BODY });
  });

  it("a reopen sends closed false", async () => {
    await mark({ ...BODY, closed: false });
    expect(client.rpc).toHaveBeenCalledWith("kitchen_set_ticket", {
      p_body: { ...BODY, closed: false },
    });
  });

  it("is never cached and carries a Server-Timing header", async () => {
    const response = await mark(BODY);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(TIMING);
  });

  it("the waiter gets 403 before any RPC", async () => {
    as("waiter");
    expect((await mark(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401, text/plain 415, a body over 512 bytes 413", async () => {
    client = fakeSupabase({ claims: null });
    expect((await mark(BODY)).status).toBe(401);
    as("chef");
    expect((await mark("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    const big = await mark(BODY, {
      headers: { "content-type": "application/json", "content-length": "513" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["three decimals", { ...BODY, firedAt: "2026-11-04T19:31:00.123Z" }],
    ["an unknown course", { ...BODY, course: "pizze" }],
    ["a string segue", { ...BODY, segue: "false" }],
    ["a missing closed", { ...BODY, closed: undefined }],
    ["a stray key", { ...BODY, note: "x" }],
    ["a bad session id", { ...BODY, sessionId: "nope" }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await mark(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0002", "ticket_not_found", 404, "ticket_not_found"],
    ["P0001", "session_closed", 409, "session_closed"],
    ["22023", "invalid_request", 400, "invalid_request"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("chef", { kitchen_set_ticket: [failure(code, message, "secret 9,00 €")] });
    const response = await mark(BODY);
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe(apiCode);
    expect(text).not.toContain("secret");
  });

  it("an injected total in the reply is a 500 and never in the JSON", async () => {
    as("chef", { kitchen_set_ticket: [ok({ ...REPLY, total: 12.5 })] });
    const response = await mark(BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("12.5");
  });
});
