import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { SERVICE_MENU } from "../../helpers/menu-tables-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/menu/route");
const URL_ = "http://localhost:3000/api/menu";
const ok = (data: unknown): FakeResult => ({ data, error: null });

function as(role: string, menu_list: FakeResult = ok(SERVICE_MENU)) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { menu_list: [menu_list] } });
}

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/menu", () => {
  it.each(["owner", "admin", "waiter"])("%s gets the service menu with one RPC", async (role) => {
    as(role);
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SERVICE_MENU);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("menu_list");
    expect(client.from).not.toHaveBeenCalled();
  });

  it("the chef gets 403 before any RPC", async () => {
    as("chef");
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("no session is 401 before any RPC", async () => {
    client = fakeSupabase({ claims: null });
    expect((await route.GET(new Request(URL_))).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an injected unit_cost / margin_eur never reaches the JSON (strict output: a 500)", async () => {
    const leaky = structuredClone(SERVICE_MENU) as unknown as {
      categories: { items: Record<string, unknown>[] }[];
    };
    leaky.categories[0]!.items[0]!.unit_cost = 4.2;
    leaky.categories[0]!.items[0]!.margin_eur = 9.8;
    as("waiter", ok(leaky));
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("unit_cost");
    expect(text).not.toContain("margin_eur");
    expect(text).not.toContain("4.2");
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("maps a database refusal to 403 and an unexpected error to a 500 with no text", async () => {
    as("owner", { data: null, error: { code: "42501", message: "permission denied" } });
    expect((await route.GET(new Request(URL_))).status).toBe(403);
    as("owner", { data: null, error: { code: "XX000", message: "boom Acqua (demo) 2,00 €" } });
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
  });

  it("answers with no-store", async () => {
    expect((await route.GET(new Request(URL_))).headers.get("cache-control")).toBe("no-store");
  });
});
