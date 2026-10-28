import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { LINE_SOUP, LINE_STEW, OIDS } from "../../helpers/orders-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/table-sessions/[id]/fire/route");
const URL_ = `http://localhost:3000/api/table-sessions/${OIDS.session}/fire`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details },
});

const BODY = { lineIds: [OIDS.line1, OIDS.line2] };
const REPLY = {
  lines: [
    { ...LINE_STEW, state: "fired" },
    { ...LINE_SOUP, state: "fired" },
  ],
  fired: [OIDS.line1, OIDS.line2],
  skipped: [],
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { fire_course: [ok(REPLY)], ...rpc } });
}
const fire = (body: unknown, id: string = OIDS.session, init: RequestInit = {}) =>
  route.POST(jsonRequest(URL_, body, init), routeContext({ id }));

const TIMING = /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/;

beforeEach(() => {
  reportError.mockClear();
  as("waiter");
});

describe("POST /api/table-sessions/:id/fire", () => {
  it.each(["owner", "admin", "waiter"])(
    "%s: one RPC with the session and the line ids",
    async (role) => {
      as(role);
      const response = await fire(BODY);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(REPLY);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("fire_course", {
        p_session: OIDS.session,
        p_body: BODY,
      });
    },
  );

  it("a full replay is a 200 that skips every line", async () => {
    const replay = {
      lines: REPLY.lines,
      fired: [],
      skipped: [
        { lineId: OIDS.line1, reason: "already_fired" },
        { lineId: OIDS.line2, reason: "voided" },
      ],
    };
    as("waiter", { fire_course: [ok(replay)] });
    const response = await fire(BODY);
    expect(response.status).toBe(200);
    expect((await response.json()).skipped).toHaveLength(2);
  });

  it("carries a Server-Timing header", async () => {
    expect((await fire(BODY)).headers.get("server-timing")).toMatch(TIMING);
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await fire(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401, a malformed id 404, text/plain 415, a body over 4 KiB 413, all without an RPC", async () => {
    client = fakeSupabase({ claims: null });
    expect((await fire(BODY)).status).toBe(401);
    as("waiter");
    expect((await fire(BODY, "x")).status).toBe(404);
    expect(
      (await fire("x", OIDS.session, { headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    const big = await fire(BODY, OIDS.session, {
      headers: { "content-type": "application/json", "content-length": "4097" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["no ids", { lineIds: [] }],
    ["a duplicate id", { lineIds: [OIDS.line1, OIDS.line1] }],
    [
      "51 ids",
      {
        lineIds: Array.from(
          { length: 51 },
          (_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        ),
      },
    ],
    ["a non-uuid", { lineIds: ["x"] }],
    ["a stray key", { ...BODY, course: "primi" }],
    ["no body keys", {}],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await fire(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0002", "session_not_found", 404, "not_found"],
    ["P0002", "line_not_found", 404, "not_found"],
    ["P0001", "session_closed", 409, "session_closed"],
    ["22023", "invalid_request", 400, "invalid_request"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("waiter", { fire_course: [failure(code, message)] });
    const response = await fire(BODY);
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(apiCode);
  });

  it("a reply with an injected cost key is a 500 and the key never reaches the client", async () => {
    as("waiter", {
      fire_course: [ok({ ...REPLY, lines: [{ ...REPLY.lines[0], unit_cost: 2.98 }] })],
    });
    const response = await fire(BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("2.98");
    expect(reportError).toHaveBeenCalled();
  });

  it("an unexpected database error is a 500 that does not echo its text", async () => {
    as("waiter", { fire_course: [failure("XX000", "boom")] });
    const response = await fire(BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
  });
});
