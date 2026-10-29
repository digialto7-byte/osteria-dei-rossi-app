import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { ADD_REPLY, LINE_STEW, OIDS } from "../../helpers/orders-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/sync/route");
const URL_ = "http://localhost:3000/api/sync";

const AT = "2026-11-02T19:30:00.123Z";
const RECEIVED = "2026-11-02T19:31:00.123456+00:00";
const opId = (n: number) => `0e000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const lineId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const ADD = (n: number) => ({
  opId: opId(n),
  seq: n,
  kind: "add_line",
  clientTs: AT,
  userId: OIDS.waiterA,
  payload: { sessionId: OIDS.session, lineId: lineId(n), menuItemId: OIDS.item },
});
const EDIT = (n: number) => ({
  opId: opId(n),
  seq: n,
  kind: "edit_line",
  clientTs: AT,
  userId: OIDS.waiterA,
  payload: { lineId: lineId(1), qty: 2 },
});
const FIRE = (n: number) => ({
  opId: opId(n),
  seq: n,
  kind: "fire",
  clientTs: AT,
  userId: OIDS.waiterA,
  payload: { sessionId: OIDS.session, lineIds: [lineId(1)] },
});

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});
const applied = (n: number, result: unknown): FakeResult =>
  ok({ opId: opId(n), status: "applied", receivedAt: RECEIVED, stop: false, result });
const addApplied = (n: number) => applied(n, ADD_REPLY);
const editApplied = (n: number) => applied(n, { changed: true, line: LINE_STEW });
const editConflict = (n: number): FakeResult =>
  ok({
    opId: opId(n),
    status: "conflict",
    receivedAt: RECEIVED,
    stop: false,
    result: { conflict: { reason: "fired", line: { ...LINE_STEW, state: "fired" } } },
  });
const addRejected = (n: number): FakeResult =>
  ok({
    opId: opId(n),
    status: "rejected",
    receivedAt: RECEIVED,
    stop: true,
    result: {
      sqlstate: "P0001",
      message: "item_unavailable",
      detail: { menuItemId: OIDS.item, reason: "no_portions", portionsLeft: 0 },
    },
  });

function as(role: string, replies: FakeResult[] = [addApplied(1)]) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { apply_op: replies } });
}
const post = (body: unknown, init: RequestInit = {}) => route.POST(jsonRequest(URL_, body, init));
const rpcOps = () =>
  client.rpc.mock.calls.map((call) => (call[1] as { p_op: { opId: string } }).p_op.opId);

beforeEach(() => {
  reportError.mockClear();
  as("waiter");
});

describe("POST /api/sync: access and limits", () => {
  it.each(["owner", "admin", "waiter"])(
    "%s: one apply_op RPC per op, in order, with p_op exactly the op",
    async (role) => {
      as(role, [addApplied(1), editApplied(2), applied(3, { lines: [], fired: [], skipped: [] })]);
      const ops = [ADD(1), EDIT(2), FIRE(3)];
      const response = await post({ ops });
      expect(response.status).toBe(200);
      expect(client.rpc).toHaveBeenCalledTimes(3);
      ops.forEach((op, i) =>
        expect(client.rpc).toHaveBeenNthCalledWith(i + 1, "apply_op", { p_op: op }),
      );
      const json = await response.json();
      expect(json.results.map((r: { opId: string }) => r.opId)).toEqual([
        opId(1),
        opId(2),
        opId(3),
      ]);
      expect(json.stopped).toBeNull();
    },
  );

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await post({ ops: [ADD(1)] })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401, text/plain 415, a body over 64 KiB 413, an envelope error 400, all without an RPC", async () => {
    client = fakeSupabase({ claims: null });
    expect((await post({ ops: [ADD(1)] })).status).toBe(401);
    as("waiter");
    expect(
      (
        await route.POST(
          jsonRequest(URL_, { ops: [ADD(1)] }, { headers: { "content-type": "text/plain" } }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await post(
          { ops: [ADD(1)] },
          { headers: { "content-length": "70000", "content-type": "application/json" } },
        )
      ).status,
    ).toBe(413);
    expect((await post({ ops: [] })).status).toBe(400);
    expect((await post({ ops: [ADD(1), ADD(1)] })).status).toBe(400);
    expect((await post({ ops: [{ ...ADD(2), seq: 0 }] })).status).toBe(400);
    expect((await post({ ops: [ADD(1)], extra: true })).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("carries serverTime, no-store and a Server-Timing header", async () => {
    const response = await post({ ops: [ADD(1)] });
    const json = await response.json();
    expect(Number.isNaN(Date.parse(json.serverTime))).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(
      /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/,
    );
  });
});

describe("POST /api/sync: per-op payload check", () => {
  it("a bad payload is rejected invalid_request without an RPC, and the later ops still go", async () => {
    as("waiter", [editApplied(2)]);
    const bad = { ...EDIT(1), payload: { lineId: lineId(1) } }; // no field to change
    const response = await post({ ops: [bad, EDIT(2)] });
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.results[0]).toMatchObject({
      opId: opId(1),
      kind: "edit_line",
      status: "rejected",
      receivedAt: null,
      error: { httpStatus: 400, code: "invalid_request" },
    });
    expect(json.results[1]).toMatchObject({ opId: opId(2), status: "applied" });
    expect(rpcOps()).toEqual([opId(2)]);
    expect(json.stopped).toBeNull();
  });

  it("a stamp inside a payload is rejected the same way", async () => {
    const bad = { ...EDIT(1), payload: { lineId: lineId(1), qty: 2, clientUpdatedAt: AT } };
    const json = await (await post({ ops: [bad] })).json();
    expect(json.results[0]).toMatchObject({
      status: "rejected",
      error: { code: "invalid_request" },
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an add_line with a bad payload is a dead entity: the batch stops there", async () => {
    const bad = { ...ADD(1), payload: { sessionId: OIDS.session, lineId: lineId(1) } };
    const json = await (await post({ ops: [bad, EDIT(2)] })).json();
    expect(json.results).toHaveLength(1);
    expect(json.stopped).toEqual({ opId: opId(1), reason: "dead_entity" });
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/sync: stops", () => {
  it("AT2: a conflict in op 2 of 5 is kept and later ops continue; nothing stops the batch", async () => {
    as("waiter", [editApplied(1), editConflict(2), editApplied(3), editApplied(4), editApplied(5)]);
    const json = await (await post({ ops: [EDIT(1), EDIT(2), EDIT(3), EDIT(4), EDIT(5)] })).json();
    expect(json.results).toHaveLength(5);
    expect(json.results.map((r: { status: string }) => r.status)).toEqual([
      "applied",
      "conflict",
      "applied",
      "applied",
      "applied",
    ]);
    expect(json.results[1].conflict).toMatchObject({ reason: "fired" });
    expect(json.stopped).toBeNull();
    expect(client.rpc).toHaveBeenCalledTimes(5);
  });

  it("an add that did not apply stops the batch after it (dead entity), with no RPC for the later ops", async () => {
    as("waiter", [addApplied(1), addRejected(2), editApplied(3)]);
    const json = await (await post({ ops: [ADD(1), ADD(2), EDIT(3)] })).json();
    expect(json.results.map((r: { opId: string }) => r.opId)).toEqual([opId(1), opId(2)]);
    expect(json.results[1]).toMatchObject({
      status: "rejected",
      error: { httpStatus: 409, code: "item_unavailable" },
    });
    expect(json.stopped).toEqual({ opId: opId(2), reason: "dead_entity" });
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  it("a duplicate of a rejected add stops the batch too", async () => {
    as("waiter", [
      ok({
        opId: opId(1),
        status: "duplicate",
        stop: true,
        stored: {
          status: "rejected",
          receivedAt: RECEIVED,
          result: { sqlstate: "P0002", message: "menu_item_not_found", detail: null },
        },
      }),
    ]);
    const json = await (await post({ ops: [ADD(1), EDIT(2)] })).json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0]).toMatchObject({ status: "duplicate", stored: { status: "rejected" } });
    expect(json.stopped).toEqual({ opId: opId(1), reason: "dead_entity" });
  });

  it("an infrastructure error on op 1 is a 503 sync_unavailable", async () => {
    as("waiter", [failure("PGRST000", "could not connect")]);
    const response = await post({ ops: [ADD(1), EDIT(2)] });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("sync_unavailable");
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("a thrown fetch on op 1 is a 503 too", async () => {
    as("waiter");
    client.rpc.mockImplementation(() => Promise.reject(new TypeError("fetch failed")));
    expect((await post({ ops: [ADD(1)] })).status).toBe(503);
  });

  it("an infrastructure error on op 3 is a 200 with two results and stopped unavailable", async () => {
    as("waiter", [
      editApplied(1),
      editApplied(2),
      failure("57014", "canceling statement due to statement timeout"),
    ]);
    const response = await post({ ops: [EDIT(1), EDIT(2), EDIT(3), EDIT(4)] });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.results).toHaveLength(2);
    expect(json.stopped).toEqual({ opId: opId(3), reason: "unavailable" });
    expect(client.rpc).toHaveBeenCalledTimes(3);
  });

  it("42501 user_mismatch stops the batch with user_mismatch (a 200: nothing was written)", async () => {
    as("waiter", [failure("42501", "user_mismatch")]);
    const response = await post({ ops: [ADD(1), EDIT(2)] });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.results).toEqual([]);
    expect(json.stopped).toEqual({ opId: opId(1), reason: "user_mismatch" });
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("an RPC permission error that is not user_mismatch is unavailable, not a binding stop", async () => {
    as("waiter", [
      failure("42501", "permission denied: opening tables needs owner, admin or waiter"),
    ]);
    expect((await post({ ops: [ADD(1)] })).status).toBe(503);
  });
});

describe("POST /api/sync: leaks", () => {
  it("a cost key in a fake reply makes the route a 500 and never reaches the JSON", async () => {
    as("waiter", [applied(1, { ...ADD_REPLY, line: { ...LINE_STEW, unit_cost: 3.2 } })]);
    const response = await post({ ops: [ADD(1)] });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("unit_cost");
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
