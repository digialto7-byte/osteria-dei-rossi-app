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

// Comanda per uscita (docs/plans/2026-11-18-comanda-uscite.md step 9, §3.13): POST /api/table-sessions/:id/call, "Via la n".
let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/table-sessions/[id]/call/route");
const URL_ = `http://localhost:3000/api/table-sessions/${OIDS.session}/call`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const CALLED_AT = "2026-11-19T20:02:00.123+00:00";
const REPLY = {
  changed: true,
  call: {
    uscita: 2,
    calledAt: CALLED_AT,
    calledBy: { id: OIDS.waiterA, displayName: "Cameriere Demo" },
  },
  lines: [{ ...LINE_STEW, uscita: 2, segue: true, state: "fired" }],
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { call_uscita: [ok(REPLY)], ...rpc } });
}
const call = (body: unknown, id: string = OIDS.session, init: RequestInit = {}) =>
  route.POST(jsonRequest(URL_, body, init), routeContext({ id }));

beforeEach(() => {
  reportError.mockClear();
  as("waiter");
});

describe("POST /api/table-sessions/:id/call", () => {
  it.each(["owner", "admin", "waiter"])("%s: 200 with one RPC", async (role) => {
    as(role);
    const response = await call({ uscita: 2 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(REPLY);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("call_uscita", {
      p_session: OIDS.session,
      p_body: { uscita: 2 },
    });
  });

  it("the same caller again is a 200 with changed: false", async () => {
    as("waiter", { call_uscita: [ok({ ...REPLY, changed: false })] });
    expect((await (await call({ uscita: 2 })).json()).changed).toBe(false);
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await call({ uscita: 2 })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["uscita 1", { uscita: 1 }],
    ["uscita 10", { uscita: 10 }],
    ["a string", { uscita: "2" }],
    ["an extra key", { uscita: 2, extra: 1 }],
    ["no body keys", {}],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await call(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a body over 1 KiB is a 413 without any RPC", async () => {
    const response = await call({ uscita: 2 }, OIDS.session, {
      headers: { "content-type": "application/json", "content-length": "1025" },
    });
    expect(response.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("already_called is a 409 conflict with the uscita and the instant", async () => {
    as("waiter", {
      call_uscita: [ok({ conflict: { reason: "already_called", uscita: 2, calledAt: CALLED_AT } })],
    });
    const response = await call({ uscita: 2 });
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error.code).toBe("conflict");
    expect(json.error.details).toEqual({
      reason: "already_called",
      uscita: 2,
      calledAt: CALLED_AT,
    });
    expect(json.error.message).toBe("La 2ª uscita era già stata chiamata.");
  });

  it("nothing_waiting is a 409 conflict with the uscita", async () => {
    as("waiter", { call_uscita: [ok({ conflict: { reason: "nothing_waiting", uscita: 3 } })] });
    const response = await call({ uscita: 3 });
    expect(response.status).toBe(409);
    expect((await response.json()).error.details).toEqual({ reason: "nothing_waiting", uscita: 3 });
  });

  it.each([
    ["P0002", "session_not_found", 404, "not_found"],
    ["P0001", "session_closed", 409, "session_closed"],
    ["22023", "invalid_request", 400, "invalid_request"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("waiter", { call_uscita: [failure(code, message)] });
    const response = await call({ uscita: 2 });
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(apiCode);
  });

  it("an unexpected database error is a 500 that does not echo its text", async () => {
    as("waiter", { call_uscita: [failure("XX000", "boom")] });
    const response = await call({ uscita: 2 });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
  });
});
