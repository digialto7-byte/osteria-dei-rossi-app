import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { BIDS, BILL_CLOSED, CLOSE_BODY, CLOSE_REPLY, TOKEN } from "../../helpers/bill-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/table-sessions/[id]/close/route");
const URL_ = `http://localhost:3000/api/table-sessions/${BIDS.session}/close`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details },
});

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { close_table: [ok(CLOSE_REPLY)], ...rpc },
  });
}
const close = (body: unknown, id: string = BIDS.session, init: RequestInit = {}) =>
  route.POST(jsonRequest(URL_, body, init), routeContext({ id }));

const TIMING = /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/;

beforeEach(() => {
  reportError.mockClear();
  as("waiter");
});

describe("POST /api/table-sessions/:id/close", () => {
  it.each(["owner", "admin", "waiter"])(
    "%s: one RPC with the session and the body",
    async (role) => {
      as(role);
      const response = await close(CLOSE_BODY);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(CLOSE_REPLY);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("close_table", {
        p_session: BIDS.session,
        p_body: CLOSE_BODY,
      });
    },
  );

  it("a blank number is sent as null: the table closes and is flagged", async () => {
    await close({ ...CLOSE_BODY, receiptNumber: "   " });
    expect(client.rpc).toHaveBeenCalledWith("close_table", {
      p_session: BIDS.session,
      p_body: { ...CLOSE_BODY, receiptNumber: null },
    });
  });

  it("a replay answers 200 with changed false", async () => {
    as("waiter", { close_table: [ok({ changed: false, bill: BILL_CLOSED })] });
    const response = await close(CLOSE_BODY);
    expect(response.status).toBe(200);
    expect((await response.json()).changed).toBe(false);
  });

  it("carries Server-Timing and is never cached", async () => {
    const response = await close(CLOSE_BODY);
    expect(response.headers.get("server-timing")).toMatch(TIMING);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await close(CLOSE_BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401, a malformed id 404, text/plain 415, a body over 1 KiB 413, all without an RPC", async () => {
    client = fakeSupabase({ claims: null });
    expect((await close(CLOSE_BODY)).status).toBe(401);
    as("waiter");
    expect((await close(CLOSE_BODY, "x")).status).toBe(404);
    expect(
      (await close("x", BIDS.session, { headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    const big = await close(CLOSE_BODY, BIDS.session, {
      headers: { "content-type": "application/json", "content-length": "1025" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown type", { ...CLOSE_BODY, receiptType: "pos" }],
    ["an unknown payment", { ...CLOSE_BODY, paymentType: "cheque" }],
    ["a bad number", { ...CLOSE_BODY, receiptNumber: "12 34" }],
    ["a bad token", { ...CLOSE_BODY, billToken: "x" }],
    ["a stray key", { ...CLOSE_BODY, total: 100 }],
    ["no body keys", {}],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await close(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["session_closed", 409],
    ["bill_changed", 409],
    ["receipt_number_invalid", 422],
    ["receipt_type_invalid", 422],
    ["payment_type_invalid", 422],
  ])("P0001 %s is a %i with the same code", async (code, status) => {
    as("waiter", { close_table: [failure("P0001", code)] });
    const response = await close(CLOSE_BODY);
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  });

  it("unsent_lines is a 409 with the line ids parsed from the DETAIL", async () => {
    as("waiter", {
      close_table: [failure("P0001", "unsent_lines", JSON.stringify({ lineIds: [BIDS.line1] }))],
    });
    const response = await close(CLOSE_BODY);
    expect(response.status).toBe(409);
    expect((await response.json()).error.details).toEqual({ lineIds: [BIDS.line1] });
  });

  it("an unsent_lines DETAIL with any other key is dropped", async () => {
    as("waiter", {
      close_table: [
        failure("P0001", "unsent_lines", JSON.stringify({ lineIds: [BIDS.line1], name: "Mario" })),
      ],
    });
    const response = await close(CLOSE_BODY);
    expect(response.status).toBe(409);
    expect((await response.json()).error.details).toBeUndefined();
  });

  it("session_not_found is a 404", async () => {
    as("waiter", { close_table: [failure("P0002", "session_not_found")] });
    expect((await close(CLOSE_BODY)).status).toBe(404);
  });

  it("a cost key injected into the reply is a 500 and never reaches the JSON", async () => {
    as("waiter", { close_table: [ok({ ...CLOSE_REPLY, bill: { ...BILL_CLOSED, margin: 0.4 } })] });
    const response = await close(CLOSE_BODY);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("margin");
  });

  it("uses the token of the body as given", async () => {
    await close({ ...CLOSE_BODY, billToken: TOKEN });
    expect(client.rpc).toHaveBeenCalledWith(
      "close_table",
      expect.objectContaining({ p_body: expect.objectContaining({ billToken: TOKEN }) }),
    );
  });
});
