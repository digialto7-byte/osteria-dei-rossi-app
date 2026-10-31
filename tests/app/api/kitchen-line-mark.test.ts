import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { KIDS, KITCHEN_TICKETS } from "../../helpers/kitchen-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/kitchen/lines/[id]/mark/route");
const URL_ = `http://localhost:3000/api/kitchen/lines/${KIDS.line1}/mark`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details },
});

const REPLY = { changed: true, autoClosed: false, reopened: false, board: KITCHEN_TICKETS };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { kitchen_mark_line: [ok(REPLY)], ...rpc },
  });
}
const mark = (body: unknown, id: string = KIDS.line1, init: RequestInit = {}) =>
  route.POST(jsonRequest(URL_, body, init), routeContext({ id }));

const TIMING = /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/;

beforeEach(() => {
  reportError.mockClear();
  as("chef");
});

describe("POST /api/kitchen/lines/:id/mark", () => {
  it.each(["chef", "owner", "admin"])(
    "%s: one RPC with the line and the target state",
    async (role) => {
      as(role);
      const response = await mark({ done: true });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(REPLY);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("kitchen_mark_line", {
        p_line: KIDS.line1,
        p_body: { done: true },
      });
    },
  );

  it("a no-op answers 200 with changed false", async () => {
    as("chef", { kitchen_mark_line: [ok({ ...REPLY, changed: false })] });
    const response = await mark({ done: false });
    expect(response.status).toBe(200);
    expect((await response.json()).changed).toBe(false);
  });

  it("is never cached and carries a Server-Timing header", async () => {
    const response = await mark({ done: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(TIMING);
  });

  it("the waiter gets 403 before any RPC", async () => {
    as("waiter");
    expect((await mark({ done: true })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401, a malformed id 404, text/plain 415, a body over 512 bytes 413", async () => {
    client = fakeSupabase({ claims: null });
    expect((await mark({ done: true })).status).toBe(401);
    as("chef");
    expect((await mark({ done: true }, "x")).status).toBe(404);
    expect(
      (await mark("x", KIDS.line1, { headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    const big = await mark({ done: true }, KIDS.line1, {
      headers: { "content-type": "application/json", "content-length": "513" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["no key", {}],
    ["a string", { done: "yes" }],
    ["a number", { done: 1 }],
    ["a stray key", { done: true, note: "x" }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await mark(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0002", "line_not_found", 404, "line_not_found"],
    ["P0001", "session_closed", 409, "session_closed"],
    ["22023", "invalid_request", 400, "invalid_request"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("chef", { kitchen_mark_line: [failure(code, message, "secret 9,00 €")] });
    const response = await mark({ done: true });
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe(apiCode);
    expect(text).not.toContain("secret");
  });

  it("an unexpected database error is a 500 that does not echo its text", async () => {
    as("chef", { kitchen_mark_line: [failure("XX000", "boom")] });
    const response = await mark({ done: true });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
  });

  it("an injected unitPrice in the board of the reply is a 500 and never in the JSON", async () => {
    const line = { ...KITCHEN_TICKETS.tickets[0]!.lines[0]!, unitPrice: 14 };
    const board = {
      ...KITCHEN_TICKETS,
      tickets: [{ ...KITCHEN_TICKETS.tickets[0]!, lines: [line] }],
    };
    as("chef", { kitchen_mark_line: [ok({ ...REPLY, board })] });
    const response = await mark({ done: true });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("unitPrice");
  });
});
