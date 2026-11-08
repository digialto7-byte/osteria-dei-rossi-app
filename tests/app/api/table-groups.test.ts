import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import {
  CREATE_TABLE_GROUP,
  DEACTIVATE_TABLE_GROUP,
  GROUP_1,
  TABLE_1,
  TABLE_2,
} from "../../helpers/reservations-data";
import { GROUP_INVALID_REASONS } from "@/server/reservations/constants";
import { isMessageKey } from "@/lib/i18n";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const createRoute = await import("@/app/api/table-groups/route");
const deactivateRoute = await import("@/app/api/table-groups/[id]/deactivate/route");
const URL_ = "http://localhost:3000/api/table-groups";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details: details ?? null },
});
const BODY = { name: "Tavoli 1+2", seats: 6, tableIds: [TABLE_1, TABLE_2] };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: {
      create_table_group: [ok(CREATE_TABLE_GROUP)],
      deactivate_table_group: [ok(DEACTIVATE_TABLE_GROUP)],
      ...rpc,
    },
  });
}
const create = (body: unknown, init: RequestInit = {}) =>
  createRoute.POST(jsonRequest(URL_, body, init));
const deactivate = (id: string, init: RequestInit = {}) =>
  deactivateRoute.POST(jsonRequest(`${URL_}/${id}/deactivate`, {}, init), routeContext({ id }));
const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string; message: string; details?: unknown } })
    .error;

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("POST /api/table-groups", () => {
  it.each(["owner", "admin"])("%s: 201 and one RPC with exactly { p_body }", async (role) => {
    as(role);
    const response = await create(BODY);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(CREATE_TABLE_GROUP);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("create_table_group", { p_body: BODY });
  });

  it.each(["waiter", "chef"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await create(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    as("none");
    expect((await create(BODY)).status).toBe(401);
  });

  it("text/plain is 415 and 5 KB is 413", async () => {
    expect((await create("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect(
      (
        await create(BODY, {
          headers: { "content-type": "application/json", "content-length": "5120" },
        })
      ).status,
    ).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["a blank name", { ...BODY, name: "  " }],
    ["a 41-character name", { ...BODY, name: "x".repeat(41) }],
    ["seats 1", { ...BODY, seats: 1 }],
    ["seats 100", { ...BODY, seats: 100 }],
    ["one table", { ...BODY, tableIds: [TABLE_1] }],
    ["nine tables", { ...BODY, tableIds: Array.from({ length: 9 }, () => TABLE_1) }],
    ["a table id that is not a uuid", { ...BODY, tableIds: [TABLE_1, "2"] }],
    ["an extra key", { ...BODY, note: "x" }],
    ["a missing seats", { name: BODY.name, tableIds: BODY.tableIds }],
  ])("%s is 400 without an RPC", async (_label, body) => {
    expect((await create(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("the name is trimmed before it is sent", async () => {
    await create({ ...BODY, name: "  Tavoli 1+2  " });
    expect(client.rpc).toHaveBeenCalledWith("create_table_group", { p_body: BODY });
  });

  it.each(GROUP_INVALID_REASONS)(
    "P0001 group_invalid (%s) is 422 with the reason",
    async (reason) => {
      as("owner", {
        create_table_group: [failure("P0001", "group_invalid", JSON.stringify({ reason }))],
      });
      const response = await create(BODY);
      expect(response.status).toBe(422);
      const error = await errorOf(response);
      expect(error.code).toBe("group_invalid");
      expect(error.details).toEqual({ reason });
      expect(isMessageKey(`reservationError.group.${reason}`)).toBe(true);
    },
  );

  it("an unknown table is 404", async () => {
    as("owner", { create_table_group: [failure("P0002", "table_not_found")] });
    expect((await create(BODY)).status).toBe(404);
  });

  it("a reply with an extra key is a 500", async () => {
    as("owner", {
      create_table_group: [ok({ group: { ...CREATE_TABLE_GROUP.group, costEur: 1 } })],
    });
    expect((await create(BODY)).status).toBe(500);
  });
});

describe("POST /api/table-groups/:id/deactivate", () => {
  it.each(["owner", "admin"])("%s: 200 and one RPC with p_group", async (role) => {
    as(role);
    const response = await deactivate(GROUP_1);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(DEACTIVATE_TABLE_GROUP);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("deactivate_table_group", { p_group: GROUP_1 });
  });

  it.each(["waiter", "chef"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await deactivate(GROUP_1)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a malformed id is 404 without an RPC", async () => {
    expect((await deactivate("not-a-uuid")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an unknown group (P0002) is 404", async () => {
    as("owner", { deactivate_table_group: [failure("P0002", "group_not_found")] });
    expect((await deactivate(GROUP_1)).status).toBe(404);
  });

  it("a body with a key is 400 without an RPC", async () => {
    const response = await deactivateRoute.POST(
      jsonRequest(`${URL_}/${GROUP_1}/deactivate`, { x: 1 }),
      routeContext({ id: GROUP_1 }),
    );
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
