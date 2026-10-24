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

const route = await import("@/app/api/table-sessions/[id]/route");
const URL_ = `http://localhost:3000/api/table-sessions/${IDS.session1}`;
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const WITH_STATUS = { session: { ...SESSION, billRequested: true, status: "bill_requested" } };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { update_table_session: [ok(WITH_STATUS)], ...rpc },
  });
}
const patch = (body: unknown, id: string = IDS.session1, init: RequestInit = {}) =>
  route.PATCH(jsonRequest(URL_, body, { method: "PATCH", ...init }), routeContext({ id }));

beforeEach(() => {
  reportError.mockClear();
  as("waiter");
});

describe("PATCH /api/table-sessions/:id", () => {
  it.each(["owner", "admin", "waiter"])(
    "%s: one RPC with the session and the patch",
    async (role) => {
      as(role);
      const response = await patch({ billRequested: true });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(WITH_STATUS);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("update_table_session", {
        p_session: IDS.session1,
        p_patch: { billRequested: true },
      });
    },
  );

  it("passes covers and billRequested together", async () => {
    await patch({ covers: 5, billRequested: false });
    expect(client.rpc).toHaveBeenCalledWith("update_table_session", {
      p_session: IDS.session1,
      p_patch: { covers: 5, billRequested: false },
    });
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await patch({ covers: 5 })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await patch({ covers: 5 })).status).toBe(401);
  });

  it("a malformed id is refused before any RPC", async () => {
    expect((await patch({ covers: 5 }, "x")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is 415 and a body over 4 KiB is 413", async () => {
    expect(
      (await patch("x", IDS.session1, { headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    const big = await patch({ covers: 5 }, IDS.session1, {
      headers: { "content-type": "application/json", "content-length": "4097" },
    });
    expect(big.status).toBe(413);
  });

  it.each([
    ["an empty patch", {}],
    ["covers 0", { covers: 0 }],
    ["an unknown key", { covers: 2, closedAt: "2026-11-02T20:00:00Z" }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await patch(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0002", "session_not_found", 404, "not_found"],
    ["P0001", "session_closed", 409, "session_closed"],
    ["P0001", "covers_invalid", 422, "covers_invalid"],
    ["22023", "invalid_request", 400, "invalid_request"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("waiter", { update_table_session: [failure(code, message)] });
    const response = await patch({ covers: 5 });
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(apiCode);
  });

  it("a reply without a status is refused (a 500), as is an injected cost key", async () => {
    as("waiter", { update_table_session: [ok({ session: SESSION })] });
    expect((await patch({ covers: 5 })).status).toBe(500);
    as("waiter", {
      update_table_session: [ok({ session: { ...WITH_STATUS.session, margin_eur: 1 } })],
    });
    const response = await patch({ covers: 5 });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("margin_eur");
  });
});
