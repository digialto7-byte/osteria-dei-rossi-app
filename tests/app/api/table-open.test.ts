import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { IDS, SESSION } from "../../helpers/menu-tables-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/tables/[id]/open/route");
const URL_ = `http://localhost:3000/api/tables/${IDS.table1}/open`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details },
});

const BODY = { sessionId: IDS.session1, covers: 4 };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { open_table: [ok({ created: true, session: SESSION })], ...rpc },
  });
}
const open = (body: unknown, id: string = IDS.table1, init: RequestInit = {}) =>
  route.POST(jsonRequest(URL_, body, init), routeContext({ id }));

beforeEach(() => {
  reportError.mockClear();
  as("waiter");
});

describe("POST /api/tables/:id/open", () => {
  it.each(["owner", "admin", "waiter"])(
    "%s: one RPC with the table, session and covers",
    async (role) => {
      as(role);
      const response = await open(BODY);
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ created: true, session: SESSION });
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("open_table", {
        p_table: IDS.table1,
        p_session: IDS.session1,
        p_covers: 4,
      });
    },
  );

  it("a replay of the same session is a 200 with created false", async () => {
    as("waiter", { open_table: [ok({ created: false, session: SESSION })] });
    const response = await open(BODY);
    expect(response.status).toBe(200);
    expect((await response.json()).created).toBe(false);
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await open(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await open(BODY)).status).toBe(401);
  });

  it("a malformed table id is refused before any RPC", async () => {
    expect((await open(BODY, "x")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is 415 and a body over 4 KiB is 413", async () => {
    expect(
      (await open("x", IDS.table1, { headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    const big = await open(BODY, IDS.table1, {
      headers: { "content-type": "application/json", "content-length": "4097" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["covers 0", { ...BODY, covers: 0 }],
    ["covers 100", { ...BODY, covers: 100 }],
    ["no session id", { covers: 4 }],
    ["a waiter id", { ...BODY, waiterId: IDS.waiterA }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await open(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("table_already_open is a 409 whose details.session is the open session (AT2)", async () => {
    as("waiter", {
      open_table: [failure("P0001", "table_already_open", JSON.stringify(SESSION))],
    });
    const response = await open(BODY);
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error.code).toBe("table_already_open");
    expect(json.error.details.session).toEqual(SESSION);
    expect(json.error.message).toBe("Il tavolo è già aperto da Cameriere Demo.");
  });

  it.each([
    ["P0001", "session_id_conflict", 409, "session_id_conflict"],
    ["P0001", "session_closed", 409, "session_closed"],
    ["P0001", "covers_invalid", 422, "covers_invalid"],
    ["P0001", "table_inactive", 422, "table_inactive"],
    ["P0002", "table_not_found", 404, "not_found"],
    ["22023", "invalid_request", 400, "invalid_request"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("waiter", { open_table: [failure(code, message)] });
    const response = await open(BODY);
    expect(response.status).toBe(status);
    const json = await response.json();
    expect(json.error.code).toBe(apiCode);
    expect(json.error.details).toBeUndefined();
  });

  it("an injected cost key in the reply is a 500 that does not echo it", async () => {
    as("waiter", {
      open_table: [ok({ created: true, session: { ...SESSION, food_cost: 2.2 } })],
    });
    const response = await open(BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("food_cost");
  });

  it("an unexpected database error is a 500 that does not echo its text", async () => {
    as("waiter", { open_table: [failure("XX000", "boom Tavolo 1")] });
    const response = await open(BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
