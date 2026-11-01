import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { PUSH_RESULT } from "../../helpers/push-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/menu/[id]/push/route");
const ITEM = "11000000-0000-4000-8000-000000000001";
const URL_ = `http://localhost:3000/api/menu/${ITEM}/push`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, reply: FakeResult = ok(PUSH_RESULT)) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { push_menu_item: [reply] } });
}
const post = (body: unknown, id: string = ITEM, init: RequestInit = {}) =>
  route.POST(jsonRequest(URL_, body, { method: "POST", ...init }), routeContext({ id }));
const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("POST /api/menu/:id/push", () => {
  it.each(["owner", "admin"])("%s: exactly one RPC with the id and the body", async (role) => {
    as(role);
    const response = await post({ pushed: true, pushPrice: 12 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(PUSH_RESULT);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("push_menu_item", {
      p_item: ITEM,
      p_body: { pushed: true, pushPrice: 12 },
    });
  });

  it("a start without a price sends pushPrice null", async () => {
    await post({ pushed: true });
    expect(client.rpc).toHaveBeenCalledWith("push_menu_item", {
      p_item: ITEM,
      p_body: { pushed: true, pushPrice: null },
    });
  });

  it("a stop sends just pushed false", async () => {
    await post({ pushed: false });
    expect(client.rpc).toHaveBeenCalledWith("push_menu_item", {
      p_item: ITEM,
      p_body: { pushed: false },
    });
  });

  it("answers no-store with a Server-Timing header", async () => {
    const response = await post({ pushed: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(/rpc;dur=/);
  });

  it.each(["chef", "waiter"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await post({ pushed: true })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await post({ pushed: true })).status).toBe(401);
  });

  it("a malformed id is the same 404 as a missing row, without an RPC", async () => {
    const response = await post({ pushed: true }, "not-a-uuid");
    expect(response.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is 415 and a body over 256 bytes is 413", async () => {
    expect((await post("x", ITEM, { headers: { "content-type": "text/plain" } })).status).toBe(415);
    const big = await post({ pushed: true }, ITEM, {
      headers: { "content-type": "application/json", "content-length": "257" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["pushed as text", { pushed: "yes" }],
    ["a stop with a price", { pushed: false, pushPrice: 1 }],
    ["a three-decimal price", { pushed: true, pushPrice: 12.345 }],
    ["an extra key", { pushed: true, until: "2026-11-06T00:00:00Z" }],
    ["an empty body", {}],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0002", "menu_item_not_found", 404, "not_found"],
    ["P0001", "push_price_above_menu", 422, "push_price_above_menu"],
    ["P0001", "menu_price_missing", 422, "menu_price_missing"],
    ["P0001", "push_price_invalid", 422, "push_price_invalid"],
    ["P0001", "menu_item_inactive", 409, "menu_item_inactive"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s maps to %i %s", async (sqlstate, message, status, code) => {
    as("owner", failure(sqlstate, message));
    const response = await post({ pushed: true, pushPrice: 20 });
    expect(response.status).toBe(status);
    expect(await errorOf(response)).toBe(code);
  });

  it("menu_price_missing carries its own Italian message", async () => {
    as("owner", failure("P0001", "menu_price_missing"));
    const response = await post({ pushed: true, pushPrice: 12 });
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      "Questo piatto non ha un prezzo di menu in vigore: impostalo nel Menu prima di dargli un prezzo del giorno.",
    );
  });

  it("an unexpected database error is a 500 that does not leak its message", async () => {
    as("owner", failure("XX000", "relation menu_push is broken"));
    const response = await post({ pushed: true });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("menu_push");
  });

  it("a reply with a key the schema does not know is a 500", async () => {
    as("owner", ok({ ...PUSH_RESULT, item: { ...PUSH_RESULT.item, unit_cost: 3 } }));
    expect((await post({ pushed: true })).status).toBe(500);
  });
});
