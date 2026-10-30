import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { BILL, BILL_BY_COVERS, BIDS } from "../../helpers/bill-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/table-sessions/[id]/bill/route");
const URL_ = `http://localhost:3000/api/table-sessions/${BIDS.session}/bill`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { session_bill: [ok(BILL)], ...rpc } });
}
const get = (query = "", id: string = BIDS.session) =>
  route.GET(new Request(URL_ + query), routeContext({ id }));

const TIMING = /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/;

beforeEach(() => {
  reportError.mockClear();
  as("waiter");
});

describe("GET /api/table-sessions/:id/bill", () => {
  it.each(["owner", "admin", "waiter"])(
    "%s reads the bill with one RPC and no split",
    async (role) => {
      as(role);
      const response = await get();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(BILL);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("session_bill", {
        p_session: BIDS.session,
        p_split: null,
      });
      expect(client.from).not.toHaveBeenCalled();
    },
  );

  it("?parts=3 asks for the split by covers", async () => {
    as("waiter", { session_bill: [ok(BILL_BY_COVERS)] });
    const response = await get("?parts=3");
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("session_bill", {
      p_session: BIDS.session,
      p_split: { mode: "covers", parts: 3 },
    });
    expect((await response.json()).split.mode).toBe("covers");
  });

  it("is never cached and carries a Server-Timing header", async () => {
    const response = await get();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(TIMING);
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401 and a malformed id is 404, both without an RPC", async () => {
    client = fakeSupabase({ claims: null });
    expect((await get()).status).toBe(401);
    as("waiter");
    expect((await get("", "x")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([["?parts=1"], ["?parts=100"], ["?parts=2.5"], ["?parts=x"], ["?x=1"], ["?parts=3&x=1"]])(
    "%s is a 400 without any RPC",
    async (query) => {
      expect((await get(query)).status).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it("maps session_not_found to a 404 (also another tenant's session)", async () => {
    as("waiter", { session_bill: [failure("P0002", "session_not_found")] });
    const response = await get();
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("a cost key injected into the reply is a 500 and never reaches the JSON", async () => {
    as("waiter", { session_bill: [ok({ ...BILL, lines: [{ ...BILL.lines[0], unitCost: 4.2 }] })] });
    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("unitCost");
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("an unexpected database error is a 500 that names no database text", async () => {
    as("waiter", { session_bill: [failure("XX000", "secret internals")] });
    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
