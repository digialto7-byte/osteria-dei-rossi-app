import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { BILL_BY_ITEMS, BIDS } from "../../helpers/bill-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/table-sessions/[id]/bill/split/route");
const URL_ = `http://localhost:3000/api/table-sessions/${BIDS.session}/bill/split`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details },
});

const BODY = {
  groups: [
    { lineIds: [BIDS.line1], covers: 1 },
    { lineIds: [BIDS.line3], covers: 1 },
    { lineIds: [BIDS.line2], covers: 1 },
  ],
  sharedLineIds: [BIDS.line4],
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { session_bill: [ok(BILL_BY_ITEMS)], ...rpc },
  });
}
const post = (body: unknown, id: string = BIDS.session, init: RequestInit = {}) =>
  route.POST(jsonRequest(URL_, body, init), routeContext({ id }));

beforeEach(() => {
  reportError.mockClear();
  as("waiter");
});

describe("POST /api/table-sessions/:id/bill/split", () => {
  it.each(["owner", "admin", "waiter"])("%s: one RPC with the items split", async (role) => {
    as(role);
    const response = await post(BODY);
    expect(response.status).toBe(200);
    expect((await response.json()).split.mode).toBe("items");
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("session_bill", {
      p_session: BIDS.session,
      p_split: { mode: "items", ...BODY },
    });
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await post(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401, a malformed id 404, text/plain 415, a body over 16 KiB 413, all without an RPC", async () => {
    client = fakeSupabase({ claims: null });
    expect((await post(BODY)).status).toBe(401);
    as("waiter");
    expect((await post(BODY, "x")).status).toBe(404);
    expect(
      (await post("x", BIDS.session, { headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    const big = await post(BODY, BIDS.session, {
      headers: { "content-type": "application/json", "content-length": "16385" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["one group", { groups: [{ lineIds: [], covers: 1 }], sharedLineIds: [] }],
    [
      "a duplicate id",
      {
        groups: [
          { lineIds: [BIDS.line1], covers: 1 },
          { lineIds: [BIDS.line1], covers: 1 },
        ],
        sharedLineIds: [],
      },
    ],
    ["no shared list", { groups: BODY.groups }],
    ["a stray key", { ...BODY, mode: "items" }],
    ["no body keys", {}],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await post(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("split_invalid is a 422 whose details are the reason only", async () => {
    as("waiter", {
      session_bill: [failure("P0001", "split_invalid", JSON.stringify({ reason: "line_twice" }))],
    });
    const response = await post(BODY);
    expect(response.status).toBe(422);
    const { error } = await response.json();
    expect(error.code).toBe("split_invalid");
    expect(error.details).toEqual({ reason: "line_twice" });
  });

  it("a split_invalid DETAIL with another key is dropped (no line id leaks)", async () => {
    as("waiter", {
      session_bill: [
        failure(
          "P0001",
          "split_invalid",
          JSON.stringify({ reason: "line_twice", lineId: BIDS.line1 }),
        ),
      ],
    });
    const { error } = await (await post(BODY)).json();
    expect(error.details).toBeUndefined();
  });

  it("session_not_found is a 404", async () => {
    as("waiter", { session_bill: [failure("P0002", "session_not_found")] });
    expect((await post(BODY)).status).toBe(404);
  });
});
