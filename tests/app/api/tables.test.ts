import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { TABLES_LIST } from "../../helpers/menu-tables-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/tables/route");
const URL_ = "http://localhost:3000/api/tables";
const ok = (data: unknown): FakeResult => ({ data, error: null });

function as(role: string, tables_list: FakeResult = ok(TABLES_LIST)) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { tables_list: [tables_list] } });
}

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/tables", () => {
  it.each(["owner", "admin", "waiter"])("%s gets the tables with one RPC", async (role) => {
    as(role);
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(TABLES_LIST);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("tables_list");
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    expect((await route.GET(new Request(URL_))).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await route.GET(new Request(URL_))).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an injected unit_cost / margin_eur never reaches the JSON", async () => {
    const leaky = structuredClone(TABLES_LIST) as unknown as { tables: Record<string, unknown>[] };
    leaky.tables[0]!.unit_cost = 4.2;
    leaky.tables[1]!.margin_eur = 9.8;
    as("waiter", ok(leaky));
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("unit_cost");
    expect(text).not.toContain("margin_eur");
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("maps a database refusal to 403 and an unexpected error to a 500 with no text", async () => {
    as("owner", { data: null, error: { code: "42501", message: "permission denied" } });
    expect((await route.GET(new Request(URL_))).status).toBe(403);
    as("owner", { data: null, error: { code: "XX000", message: "boom Tavolo 1" } });
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
  });
});
