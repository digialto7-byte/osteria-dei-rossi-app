import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { SERVICE_MENU, TABLES_LIST } from "../../helpers/menu-tables-data";
import { OIDS, ORDER_VIEW } from "../../helpers/orders-data";

// M20 plan §3.5: the four cost-free waiter reads the service worker may cache carry `x-offline-cache: 1` on a 200, and only there.
let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: () => undefined }));

const me = await import("@/app/api/me/route");
const menu = await import("@/app/api/menu/route");
const tables = await import("@/app/api/tables/route");
const lines = await import("@/app/api/table-sessions/[id]/lines/route");

const ok = (data: unknown): FakeResult => ({ data, error: null });
const ME_ROW = {
  id: "a1000000-0000-4000-8000-00000000000a",
  display_name: "Titolare Demo",
  role: "owner",
  tenant: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Osteria Demo A",
    demo_data_since: null,
  },
};
const HEADER = "x-offline-cache";

interface Read {
  call: () => Promise<Response>;
  options: { meRow?: unknown; rpc?: Record<string, FakeResult[]> };
}
const READS: Record<string, Read> = {
  "/api/me": {
    call: () => me.GET(new Request("http://localhost:3000/api/me")),
    options: { meRow: ME_ROW },
  },
  "/api/menu": {
    call: () => menu.GET(new Request("http://localhost:3000/api/menu")),
    options: { rpc: { menu_list: [ok(SERVICE_MENU)] } },
  },
  "/api/tables": {
    call: () => tables.GET(new Request("http://localhost:3000/api/tables")),
    options: { rpc: { tables_list: [ok(TABLES_LIST)] } },
  },
  "/api/table-sessions/:id/lines": {
    call: () =>
      lines.GET(
        new Request(`http://localhost:3000/api/table-sessions/${OIDS.session}/lines`),
        routeContext({ id: OIDS.session }),
      ),
    options: { rpc: { order_view: [ok(ORDER_VIEW)] } },
  },
};

beforeEach(() => {
  client = fakeSupabase({ claims: claimsFor("waiter") });
});

describe.each(Object.entries(READS))("GET %s", (_path, read) => {
  it("carries x-offline-cache: 1 on a 200", async () => {
    client = fakeSupabase({ claims: claimsFor("waiter"), ...read.options });
    const response = await read.call();
    expect(response.status).toBe(200);
    expect(response.headers.get(HEADER)).toBe("1");
  });

  it("does not on a 401", async () => {
    client = fakeSupabase({ claims: null, ...read.options });
    const response = await read.call();
    expect(response.status).toBe(401);
    expect(response.headers.has(HEADER)).toBe(false);
  });

  it("does not on a 403", async () => {
    client = fakeSupabase({
      claims: { ...claimsFor("waiter"), tenant_id: undefined },
      ...read.options,
    });
    const response = await read.call();
    expect(response.status).toBe(403);
    expect(response.headers.has(HEADER)).toBe(false);
  });

  it("does not on a 500", async () => {
    client = fakeSupabase({
      claims: claimsFor("waiter"),
      meRow: { not: "a row" },
      rpc: {
        menu_list: [{ data: { broken: true }, error: null }],
        tables_list: [{ data: { broken: true }, error: null }],
        order_view: [{ data: { broken: true }, error: null }],
      },
    });
    const response = await read.call();
    expect(response.status).toBe(500);
    expect(response.headers.has(HEADER)).toBe(false);
  });
});

describe("the other statuses", () => {
  it("a missing order (404) does not carry the header", async () => {
    client = fakeSupabase({
      claims: claimsFor("waiter"),
      rpc: { order_view: [{ data: null, error: { code: "P0002", message: "session_not_found" } }] },
    });
    const response = await lines.GET(
      new Request(`http://localhost:3000/api/table-sessions/${OIDS.session}/lines`),
      routeContext({ id: OIDS.session }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.has(HEADER)).toBe(false);
  });

  it("a malformed id (404) does not carry the header", async () => {
    client = fakeSupabase({ claims: claimsFor("waiter") });
    const response = await lines.GET(
      new Request("http://localhost:3000/api/table-sessions/x/lines"),
      routeContext({ id: "x" }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.has(HEADER)).toBe(false);
  });

  it("the chef's 403 on the menu does not carry the header", async () => {
    client = fakeSupabase({ claims: claimsFor("chef") });
    const response = await menu.GET(new Request("http://localhost:3000/api/menu"));
    expect(response.status).toBe(403);
    expect(response.headers.has(HEADER)).toBe(false);
  });
});
