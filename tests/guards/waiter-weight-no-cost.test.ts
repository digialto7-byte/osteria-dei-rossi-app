import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OFFLINE_CACHE_PATHS,
  OFFLINE_CACHE_ROLES,
  offlineCacheable,
} from "@/lib/api/offline-cache";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  OWNER_CLAIMS,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../helpers/fake-supabase";
import { ME_SETTINGS } from "../helpers/me-data";
import { SERVICE_MENU, TABLES_LIST } from "../helpers/menu-tables-data";
import { ADD_STEAK_REPLY, LINE_STEAK, OIDS, ORDER_VIEW } from "../helpers/orders-data";
import { STEAK_ITEM } from "../helpers/order-components";

// P2-0b, AT-W8 (plan B7): sale by weight adds only sale facts and quantities to what a waiter reads. Weighted fixtures go through the
// four offline-cached routes and POST /api/sync as a waiter: no key at any depth may name a cost, a margin, food cost, GP, VAT or a
// recipe, a strict output schema must still refuse an injected cost key, and the offline cache allowlist and role gate stay as they were.

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: () => undefined }));

const me = await import("@/app/api/me/route");
const menu = await import("@/app/api/menu/route");
const tables = await import("@/app/api/tables/route");
const lines = await import("@/app/api/table-sessions/[id]/lines/route");
const sync = await import("@/app/api/sync/route");
const venue = await import("@/app/api/settings/venue/route");
const mfaAccount = await import("@/app/api/auth/mfa/account/route");
const mfaAccountFactors = await import("@/app/api/auth/mfa/account/factors/route");
const mfaAccountVerify = await import("@/app/api/auth/mfa/account/factors/[id]/verify/route");
const platformMe = await import("@/app/api/platform/me/route");
const platformTenants = await import("@/app/api/platform/tenants/route");
const platformTenant = await import("@/app/api/platform/tenants/[id]/route");
const platformOpen = await import("@/app/api/platform/tenants/[id]/open/route");
const platformAudit = await import("@/app/api/platform/audit/route");
const platformNotices = await import("@/app/api/platform/notices/route");
const platformNotified = await import("@/app/api/platform/notices/[id]/notified/route");
const platformConsole = await import("@/app/api/platform/console/route");
const platformLogout = await import("@/app/api/platform/logout/route");
const platformPassword = await import("@/app/api/platform/auth/password/route");

const COST_KEY = /cost|margin|food|gp|vat|recipe/i;
// One path outside the plan's pattern predates P2-0b: the cover charge's VAT rate on /api/tables (M17), a sale fact and not a cost.
// The exemption is the exact path, not the key name, so a `vatRate` nested anywhere else in the reply, or on another route, still
// fails. The path is found where it really sits in the fixture (see the test below).
// DS-BQ-2 (lead decision Q-D1) adds the same fact on the order read, at its own exact path: the session's coperto (frozen at opening, already on the tile).
const KNOWN_SALE_PATHS: Record<string, string[]> = {
  "/api/tables": ["tables.session.coperto.vatRate"],
  "/api/table-sessions/:id/lines": ["session.coperto.vatRate"],
  // SP1 step 13: the owner/admin write route answers the tenant's own sale VAT list, at this exact path and nowhere else.
  "PATCH /api/settings/venue": ["settings.saleVatRates"],
};
const ok = (data: unknown): FakeResult => ({ data, error: null });

/** Every key at any depth as a dotted path (array positions left out): "tables.session.coperto.vatRate". */
function pathsOf(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => pathsOf(item, prefix));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) => {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      return [path, ...pathsOf(inner, path)];
    });
  }
  return [];
}
const keysOf = (value: unknown) => pathsOf(value).map((path) => path.split(".").at(-1)!);
/** The paths whose last key matches the cost pattern and that are not the one known sale fact of the route. */
const flagged = (path: string, json: unknown) =>
  [...new Set(pathsOf(json).filter((p) => COST_KEY.test(p.split(".").at(-1)!)))].filter(
    (p) => !(KNOWN_SALE_PATHS[path] ?? []).includes(p),
  );

const WEIGHTED_MENU = {
  ...SERVICE_MENU,
  weightMaxG: 4000,
  categories: [
    ...SERVICE_MENU.categories,
    {
      name: "Secondi",
      items: [
        {
          id: STEAK_ITEM.id,
          name: STEAK_ITEM.name,
          category: "Secondi",
          course: "secondi" as const,
          price: STEAK_ITEM.price,
          available: true,
          unavailableReason: null,
          portionsLeft: STEAK_ITEM.portionsLeft,
          lowStock: STEAK_ITEM.lowStock,
          pushed: false,
          pushPrice: null,
          priceUnit: "etto" as const,
          portionWeightG: 400,
          weightLeftG: 1400,
        },
      ],
    },
  ],
};
const WEIGHTED_VIEW = { ...ORDER_VIEW, lines: [...ORDER_VIEW.lines, LINE_STEAK] };
const ME_ROW = {
  id: "a1000000-0000-4000-8000-00000000000a",
  display_name: "Cameriere Demo",
  role: "waiter",
  tenant: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Osteria Demo A",
    demo_data_since: null,
  },
};

const AT = "2026-11-02T19:30:00.123Z";
const SYNC_ADD = {
  opId: "0e000000-0000-4000-8000-000000000001",
  seq: 1,
  kind: "add_line",
  clientTs: AT,
  userId: OIDS.waiterA,
  payload: {
    sessionId: OIDS.session,
    lineId: OIDS.line3,
    menuItemId: STEAK_ITEM.id,
    weightG: 1230,
  },
};

interface Read {
  call: () => Promise<Response>;
  options: { meRow?: unknown; rpc?: Record<string, FakeResult[]> };
  /** The same reply with a cost key injected where the strict schema must refuse it. */
  poisoned: { rpc: Record<string, FakeResult[]> } | null;
}
const READS: Record<string, Read> = {
  "/api/me": {
    call: () => me.GET(new Request("http://localhost:3000/api/me")),
    // re-pinned on purpose by SP1 (step 9): the fixture gains the tenant_settings RPC result, and `poisoned` becomes a reply
    // with `settings.vatRates` injected, which the strict output must refuse (a stronger check, not a weaker one).
    options: { meRow: ME_ROW, rpc: { tenant_settings: [ok(ME_SETTINGS)] } },
    poisoned: { rpc: { tenant_settings: [ok({ ...ME_SETTINGS, vatRates: [0, 4, 5, 10, 22] })] } },
  },
  "/api/menu": {
    call: () => menu.GET(new Request("http://localhost:3000/api/menu")),
    options: { rpc: { menu_list: [ok(WEIGHTED_MENU)] } },
    poisoned: {
      rpc: {
        menu_list: [
          ok({
            ...WEIGHTED_MENU,
            categories: WEIGHTED_MENU.categories.map((c) => ({
              ...c,
              items: c.items.map((i) => ({ ...i, unitCost: 3.2 })),
            })),
          }),
        ],
      },
    },
  },
  "/api/tables": {
    call: () => tables.GET(new Request("http://localhost:3000/api/tables")),
    options: { rpc: { tables_list: [ok(TABLES_LIST)] } },
    poisoned: {
      rpc: {
        tables_list: [
          ok({
            ...TABLES_LIST,
            tables: TABLES_LIST.tables.map((t) =>
              t.session ? { ...t, session: { ...t.session, unitCost: 3.2 } } : t,
            ),
          }),
        ],
      },
    },
  },
  "/api/table-sessions/:id/lines": {
    call: () =>
      lines.GET(
        new Request(`http://localhost:3000/api/table-sessions/${OIDS.session}/lines`),
        routeContext({ id: OIDS.session }),
      ),
    options: { rpc: { order_view: [ok(WEIGHTED_VIEW)] } },
    poisoned: {
      rpc: {
        order_view: [
          ok({
            ...WEIGHTED_VIEW,
            lines: WEIGHTED_VIEW.lines.map((l) => ({ ...l, unitCost: 3.2 })),
          }),
        ],
      },
    },
  },
};

beforeEach(() => {
  client = fakeSupabase({ claims: claimsFor("waiter") });
});

describe("the offline cache stays as it was (P2-0b adds nothing to it)", () => {
  it("the four paths and the three roles are unchanged", () => {
    expect([...OFFLINE_CACHE_PATHS]).toEqual([
      "/api/me",
      "/api/menu",
      "/api/tables",
      "/api/table-sessions/:id/lines",
    ]);
    expect([...OFFLINE_CACHE_ROLES]).toEqual(["owner", "admin", "waiter"]);
  });

  it("the role gate: the chef's response is never marked, a waiter's is", () => {
    expect(offlineCacheable(Response.json({}), "chef").headers.has("x-offline-cache")).toBe(false);
    expect(offlineCacheable(Response.json({}), "waiter").headers.get("x-offline-cache")).toBe("1");
  });
});

describe.each(Object.entries(READS))("GET %s as a waiter, with weighted fixtures", (path, read) => {
  it("has no key naming a cost, margin, food cost, GP, VAT or recipe, at any depth", async () => {
    client = fakeSupabase({ claims: claimsFor("waiter"), ...read.options });
    const response = await read.call();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(keysOf(json).length).toBeGreaterThan(0);
    expect(flagged(path, json)).toEqual([]);
  });
});

describe("the VAT exemption is the exact path, not the key name", () => {
  it("/api/tables as it is: the cover charge's vatRate is the only flagged path, and it is exempt", async () => {
    client = fakeSupabase({ claims: claimsFor("waiter"), ...READS["/api/tables"]!.options });
    const json = await (await READS["/api/tables"]!.call()).json();
    expect(pathsOf(json).filter((p) => COST_KEY.test(p.split(".").at(-1)!))).toEqual([
      "tables.session.coperto.vatRate",
    ]);
    expect(flagged("/api/tables", json)).toEqual([]);
  });

  it("a second, nested vatRate in the same reply fails the guard", async () => {
    client = fakeSupabase({ claims: claimsFor("waiter"), ...READS["/api/tables"]!.options });
    const json = await (await READS["/api/tables"]!.call()).json();
    const poisoned = structuredClone(json);
    poisoned.tables[0].session.vatRate = 10;
    poisoned.tables[0].session.coperto.nested = { vatRate: 10 };
    expect(flagged("/api/tables", poisoned).sort()).toEqual([
      "tables.session.coperto.nested.vatRate",
      "tables.session.vatRate",
    ]);
  });

  it("the same path on another route is not exempt", () => {
    expect(flagged("/api/menu", { tables: [{ session: { coperto: { vatRate: 10 } } }] })).toEqual([
      "tables.session.coperto.vatRate",
    ]);
  });
});

// DS-BQ-2 (lead decision Q-D1): the order read carries the session's coperto, and its vatRate is a sale fact at the exact path
// `session.coperto.vatRate`. Every other cost-like key on the route stays forbidden.
describe("the order route's VAT exemption is the exact path too (DS-BQ-2)", () => {
  const ORDER = "/api/table-sessions/:id/lines";
  const orderJson = async () => {
    client = fakeSupabase({ claims: claimsFor("waiter"), ...READS[ORDER]!.options });
    return (await READS[ORDER]!.call()).json();
  };

  it("the order route as it is: the coperto's vatRate is the only flagged path, and it is exempt", async () => {
    const json = await orderJson();
    expect(pathsOf(json).filter((p) => COST_KEY.test(p.split(".").at(-1)!))).toEqual([
      "session.coperto.vatRate",
    ]);
    expect(flagged(ORDER, json)).toEqual([]);
  });

  it("a second, nested vatRate in the order reply fails the guard", async () => {
    const poisoned = structuredClone(await orderJson());
    poisoned.session.vatRate = 10;
    poisoned.session.coperto.nested = { vatRate: 10 };
    expect(flagged(ORDER, poisoned).sort()).toEqual([
      "session.coperto.nested.vatRate",
      "session.vatRate",
    ]);
  });

  it("an injected cost key elsewhere on the order route still fails", async () => {
    const poisoned = structuredClone(await orderJson());
    poisoned.session.unitCost = 3.2;
    poisoned.session.coperto.cost = 1;
    poisoned.lines[0].unitCost = 3.2;
    expect(flagged(ORDER, poisoned).sort()).toEqual([
      "lines.unitCost",
      "session.coperto.cost",
      "session.unitCost",
    ]);
  });

  it("the order route's exempt path is not exempt on another route, and the tile's is not exempt here", () => {
    expect(flagged("/api/menu", { session: { coperto: { vatRate: 10 } } })).toEqual([
      "session.coperto.vatRate",
    ]);
    expect(flagged(ORDER, { tables: [{ session: { coperto: { vatRate: 10 } } }] })).toEqual([
      "tables.session.coperto.vatRate",
    ]);
  });

  type Leaky = { session: Record<string, unknown> & { coperto: Record<string, unknown> } };
  it.each([
    ["session.unitCost", (j: Leaky) => (j.session.unitCost = 3.2)],
    ["session.coperto.cost", (j: Leaky) => (j.session.coperto.cost = 1)],
    ["session.vatRate", (j: Leaky) => (j.session.vatRate = 10)],
  ])(
    "a reply with %s injected gives a 500 and the key is not in the text",
    async (name, inject) => {
      const leaky = structuredClone(WEIGHTED_VIEW);
      inject(leaky as unknown as Leaky);
      client = fakeSupabase({ claims: claimsFor("waiter"), rpc: { order_view: [ok(leaky)] } });
      const response = await READS[ORDER]!.call();
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain(name.split(".").at(-1)!);
    },
  );
});

// The two weighted reads whose payload could carry a cost: the strict output schema must refuse one (500), not pass it on.
describe.each(Object.entries(READS).filter(([, read]) => read.poisoned !== null))(
  "GET %s as a waiter, with a cost key injected into the reply",
  (_path, read) => {
    it("refuses an injected unitCost with a 500 (the output schema is strict)", async () => {
      client = fakeSupabase({ claims: claimsFor("waiter"), ...read.options, ...read.poisoned! });
      const response = await read.call();
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain("unitCost");
    });
  },
);

describe("the weighted keys themselves are sale facts", () => {
  it("the menu carries priceUnit, portionWeightG, weightLeftG and the top-level weightMaxG", async () => {
    client = fakeSupabase({ claims: claimsFor("waiter"), rpc: { menu_list: [ok(WEIGHTED_MENU)] } });
    const json = await (await READS["/api/menu"]!.call()).json();
    expect(json.weightMaxG).toBe(4000);
    const steak = json.categories
      .flatMap((c: { items: Array<{ id: string }> }) => c.items)
      .find((i: { id: string }) => i.id === STEAK_ITEM.id);
    expect(steak).toMatchObject({ priceUnit: "etto", portionWeightG: 400, weightLeftG: 1400 });
  });

  it("the line carries weightG and pricePer100g", async () => {
    client = fakeSupabase({
      claims: claimsFor("waiter"),
      ...READS["/api/table-sessions/:id/lines"]!.options,
    });
    const json = await (await READS["/api/table-sessions/:id/lines"]!.call()).json();
    expect(json.lines.find((l: { id: string }) => l.id === LINE_STEAK.id)).toMatchObject({
      weightG: 1230,
      pricePer100g: 4.25,
    });
  });
});

describe("POST /api/sync as a waiter, a weighted add", () => {
  it("replies without any cost-named key, and the weight goes to the RPC untouched", async () => {
    client = fakeSupabase({
      claims: claimsFor("waiter"),
      rpc: {
        apply_op: [
          ok({
            opId: SYNC_ADD.opId,
            status: "applied",
            receivedAt: "2026-11-02T19:31:00.123456+00:00",
            stop: false,
            result: ADD_STEAK_REPLY,
          }),
        ],
      },
    });
    const response = await sync.POST(
      jsonRequest("http://localhost:3000/api/sync", { ops: [SYNC_ADD] }),
    );
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("apply_op", { p_op: SYNC_ADD });
    const json = await response.json();
    expect(keysOf(json)).toContain("weightG");
    expect(flagged("/api/sync", json)).toEqual([]);
  });
});

// SP1 step 13: PATCH /api/settings/venue joins the guard. A waiter and a chef never reach it (403, no RPC); an owner's reply carries the
// sale VAT list only at `settings.saleVatRates`, and the strict output refuses any other cost-like key.
describe("PATCH /api/settings/venue", () => {
  const PATH = "PATCH /api/settings/venue";
  const SETTINGS = { ...ME_SETTINGS, saleVatRates: [10, 22] };
  const call = () =>
    venue.PATCH(
      jsonRequest(
        "http://localhost:3000/api/settings/venue",
        { saleVatRates: [10, 22] },
        { method: "PATCH" },
      ),
    );

  it.each(["waiter", "chef"])("a %s gets 403 and no RPC runs", async (role) => {
    client = fakeSupabase({ claims: claimsFor(role) });
    expect((await call()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an owner's reply: the sale VAT list is the only flagged path, and it is exempt", async () => {
    client = fakeSupabase({
      claims: claimsFor("owner"),
      rpc: { set_tenant_settings: [ok({ changed: true, settings: SETTINGS })] },
    });
    const json = await (await call()).json();
    expect(pathsOf(json).filter((p) => COST_KEY.test(p.split(".").at(-1)!))).toEqual([
      "settings.saleVatRates",
    ]);
    expect(flagged(PATH, json)).toEqual([]);
    expect(flagged("/api/me", json)).toEqual(["settings.saleVatRates"]);
  });

  it("an injected cost key in the reply gives a 500 and is not echoed", async () => {
    client = fakeSupabase({
      claims: claimsFor("owner"),
      rpc: {
        set_tenant_settings: [ok({ changed: true, settings: { ...SETTINGS, unitCost: 3.2 } })],
      },
    });
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("unitCost");
  });
});

// Opening stock (plan 2026-11-18 §3.9, steps 14 and 15): the /api/stock/opening/* routes carry costs (unitCostEur, valueEur), so they
// are owner/admin only. A waiter and a chef never reach them: 403, and no RPC runs.
const openingDraft = await import("@/app/api/stock/opening/draft/route");
const openingLines = await import("@/app/api/stock/opening/draft/lines/route");
const openingLine = await import("@/app/api/stock/opening/draft/lines/[id]/route");
const openingConfirm = await import("@/app/api/stock/opening/confirm/route");
const openingHistory = await import("@/app/api/stock/opening/history/route");
const openingReverse = await import("@/app/api/stock/opening/[id]/reverse/route");
const OPENING = "http://localhost:3000/api/stock/opening";
const OPENING_ID = "0d000000-0000-4000-8000-000000000001";
const OPENING_LOC = "10000000-0000-4000-8000-0000000000a1";
const OPENING_ROUTES: [string, () => Promise<Response>][] = [
  ["GET /api/stock/opening/draft", () => openingDraft.GET(new Request(`${OPENING}/draft`))],
  [
    "DELETE /api/stock/opening/draft",
    () =>
      openingDraft.DELETE(
        jsonRequest(`${OPENING}/draft?locationId=${OPENING_LOC}`, {}, { method: "DELETE" }),
      ),
  ],
  [
    "PUT /api/stock/opening/draft/lines",
    () =>
      openingLines.PUT(
        jsonRequest(
          `${OPENING}/draft/lines`,
          {
            lines: [
              {
                id: OPENING_ID,
                locationId: OPENING_LOC,
                ingredientId: OPENING_ID,
                qty: 1,
                unitCostEur: 1,
              },
            ],
          },
          { method: "PUT" },
        ),
      ),
  ],
  [
    "DELETE /api/stock/opening/draft/lines/:id",
    () =>
      openingLine.DELETE(
        jsonRequest(`${OPENING}/draft/lines/${OPENING_ID}`, {}, { method: "DELETE" }),
        routeContext({ id: OPENING_ID }),
      ),
  ],
  [
    "POST /api/stock/opening/confirm",
    () =>
      openingConfirm.POST(
        jsonRequest(`${OPENING}/confirm`, {
          locationId: OPENING_LOC,
          effectiveOn: "2026-12-01",
          requestId: OPENING_ID,
          lines: [{ id: OPENING_ID, ingredientId: OPENING_ID, qty: 1, unitCostEur: 1 }],
        }),
      ),
  ],
  [
    "GET /api/stock/opening/history",
    () => openingHistory.GET(new Request(`${OPENING}/history?locationId=${OPENING_LOC}`)),
  ],
  [
    "POST /api/stock/opening/:id/reverse",
    () =>
      openingReverse.POST(
        jsonRequest(`${OPENING}/${OPENING_ID}/reverse`, { reason: "qty_wrong" }),
        routeContext({ id: OPENING_ID }),
      ),
  ],
];

describe("opening stock routes are owner/admin only", () => {
  it.each(OPENING_ROUTES)(
    "%s: a waiter and a chef get 403 and no RPC runs",
    async (_name, call) => {
      for (const role of ["waiter", "chef"]) {
        client = fakeSupabase({ claims: claimsFor(role) });
        expect((await call()).status, role).toBe(403);
        expect(client.rpc, role).not.toHaveBeenCalled();
      }
    },
  );
});

// Comanda per uscita (docs/plans/2026-11-18-comanda-uscite.md step 9; §3.16 "Waiters never see costs"): POST /api/table-sessions/:id/call
// answers the call and the uscita's lines as a waiter reads them. No key may name a cost; a cost injected into the RPC reply is a 500.
const callRoute = await import("@/app/api/table-sessions/[id]/call/route");
const CALL_REPLY = {
  changed: true,
  call: {
    uscita: 2,
    calledAt: "2026-11-19T20:02:00+00:00",
    calledBy: { id: OIDS.waiterA, displayName: "Cameriere Demo" },
  },
  lines: [{ ...LINE_STEAK, uscita: 2, segue: true, state: "fired" }],
};
const postCall = () =>
  callRoute.POST(
    new Request(`http://localhost:3000/api/table-sessions/${OIDS.session}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uscita: 2 }),
    }),
    routeContext({ id: OIDS.session }),
  );

describe("POST /api/table-sessions/:id/call as a waiter", () => {
  it("has no key naming a cost, margin, food cost, GP, VAT or recipe, at any depth", async () => {
    client = fakeSupabase({ claims: claimsFor("waiter"), rpc: { call_uscita: [ok(CALL_REPLY)] } });
    const response = await postCall();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(keysOf(json).length).toBeGreaterThan(0);
    expect(flagged("/api/table-sessions/:id/call", json)).toEqual([]);
  });

  it("a cost injected into the reply is a 500 and never reaches the client", async () => {
    client = fakeSupabase({
      claims: claimsFor("waiter"),
      rpc: {
        call_uscita: [ok({ ...CALL_REPLY, lines: [{ ...CALL_REPLY.lines[0], unitCost: 3.2 }] })],
      },
    });
    const response = await postCall();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("3.2");
  });
});

// SP2 S6 and S7 (docs/plans/2026-11-26-sp02-memberships.md §3.8): the venue list and the venue switch join the guard. Neither carries money; the
// strict outputs refuse an injected cost key (500, not echoed).
const meTenants = await import("@/app/api/me/tenants/route");
const meTenant = await import("@/app/api/me/tenant/route");
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIPS = [
  { tenantId: OWNER_CLAIMS.tenant_id, name: "Osteria Demo A", role: "waiter" },
  { tenantId: OTHER_TENANT, name: "Osteria Demo B", role: "waiter" },
];

describe("GET /api/me/tenants and POST /api/me/tenant as a waiter", () => {
  const list = () => meTenants.GET(new Request("http://localhost:3000/api/me/tenants"));

  it("GET /api/me/tenants has no key naming a cost, at any depth", async () => {
    client = fakeSupabase({
      claims: claimsFor("waiter"),
      rpc: { my_memberships: [ok(MEMBERSHIPS)] },
    });
    const response = await list();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(keysOf(json).length).toBeGreaterThan(0);
    expect(flagged("/api/me/tenants", json)).toEqual([]);
  });

  it("GET /api/me/tenants: a cost injected into the reply is a 500 and never reaches the client", async () => {
    client = fakeSupabase({
      claims: claimsFor("waiter"),
      rpc: { my_memberships: [ok([{ ...MEMBERSHIPS[0], unitCost: 3.2 }])] },
    });
    const response = await list();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("3.2");
  });

  it("POST /api/me/tenant has no key naming a cost", async () => {
    client = fakeSupabase({
      claims: claimsFor("waiter"),
      rpc: { select_tenant: [ok({ tenantId: OTHER_TENANT, changed: true })] },
    });
    const after = fakeSupabase({ claims: { ...claimsFor("waiter"), tenant_id: OTHER_TENANT } });
    client.auth.getClaims
      .mockImplementationOnce(client.auth.getClaims.getMockImplementation()!)
      .mockImplementation(after.auth.getClaims.getMockImplementation()!);
    const response = await meTenant.POST(
      jsonRequest("http://localhost:3000/api/me/tenant", { tenantId: OTHER_TENANT }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ tenantId: OTHER_TENANT });
    expect(flagged("/api/me/tenant", json)).toEqual([]);
  });
});

// SP3 step 9 (plan 3.11, last row): the three /api/auth/mfa/account routes. The READS list above is waiter-only (it fixes the waiter's claims), and these routes are for platform staff,
// so they have their own describe here, using the same helpers: a reply may name no cost, margin, food cost, GP, VAT or recipe at any depth.
describe("the platform staff account routes (SP3 step 9): no cost-like key at any depth", () => {
  const STAFF = { sub: "a6000000-0000-4000-8000-000000000001", aal: "aal1" };
  const F1 = "f0000000-0000-4000-8000-000000000001";
  const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="5" height="5"/></svg>';
  const FACTOR = {
    id: F1,
    friendly_name: "Principale",
    factor_type: "totp",
    status: "verified",
    created_at: "2026-11-12T09:30:00.000Z",
    updated_at: "2026-11-12T09:30:00.000Z",
  };
  const rpcs = {
    platform_mfa_attempt_allowed: [ok({ allowed: true, retryAfterSeconds: 0 })],
    platform_mfa_enrol_check: [ok({ issuer: "Costì", friendlyName: "Principale" })],
    platform_mfa_record_enrolled: [ok(true)],
  };
  const ctx = (id: string) => routeContext({ id });

  it("GET /api/auth/mfa/account", async () => {
    client = fakeSupabase({ claims: STAFF, rpc: rpcs });
    client.auth.mfa.listFactors.mockResolvedValue({
      data: { all: [FACTOR], totp: [] },
      error: null,
    });
    const response = await mfaAccount.GET(
      new Request("http://127.0.0.1:3000/api/auth/mfa/account"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(keysOf(json).length).toBeGreaterThan(0);
    expect(flagged("/api/auth/mfa/account", json)).toEqual([]);
  });

  it("POST /api/auth/mfa/account (the code)", async () => {
    client = fakeSupabase({ claims: STAFF, rpc: rpcs });
    client.auth.mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    const response = await mfaAccount.POST(
      jsonRequest("http://127.0.0.1:3000/api/auth/mfa/account", { factorId: F1, code: "123456" }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(keysOf(json).length).toBeGreaterThan(0);
    expect(flagged("/api/auth/mfa/account", json)).toEqual([]);
  });

  it("POST /api/auth/mfa/account/factors (the one-time setup key)", async () => {
    client = fakeSupabase({ claims: STAFF, rpc: rpcs });
    client.auth.mfa.enroll.mockResolvedValue({
      data: { id: F1, totp: { qr_code: SVG, secret: "JBSWY3DPEHPK3PXP" } },
      error: null,
    });
    const response = await mfaAccountFactors.POST(
      jsonRequest("http://127.0.0.1:3000/api/auth/mfa/account/factors", { slot: "principale" }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(keysOf(json).length).toBeGreaterThan(0);
    expect(flagged("/api/auth/mfa/account/factors", json)).toEqual([]);
  });

  it("POST /api/auth/mfa/account/factors/[id]/verify", async () => {
    client = fakeSupabase({ claims: STAFF, rpc: rpcs });
    client.auth.mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    client.auth.mfa.listFactors.mockResolvedValue({
      data: { all: [FACTOR], totp: [] },
      error: null,
    });
    const response = await mfaAccountVerify.POST(
      jsonRequest(`http://127.0.0.1:3000/api/auth/mfa/account/factors/${F1}/verify`, {
        code: "123456",
      }),
      ctx(F1),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(keysOf(json).length).toBeGreaterThan(0);
    expect(flagged("/api/auth/mfa/account/factors/[id]/verify", json)).toEqual([]);
  });

  it("the guard is not vacuous: an injected cost key in a reply is flagged", () => {
    expect(flagged("/api/auth/mfa/account", { factors: [{ id: F1, unitCost: 3.2 }] })).toEqual([
      "factors.unitCost",
    ]);
  });
});

// SP3 step 17 (plan §4, cost-guard row): every /api/platform/* route. Re-pinned on purpose by SP3 (step 17; was the three account routes only). The replies are
// the documented examples of src/lib/platform/api.ts, passed through each route; none may name a cost, margin, food cost, GP, VAT or recipe at any depth.
describe("the console routes (SP3 step 17): no cost-like key at any depth", async () => {
  const { PLATFORM_API_SCHEMAS: ex } = await import("@/lib/platform/api");
  const CONSOLE = {
    sub: "a7000000-0000-4000-8000-000000000001",
    role: "platform_staff",
    aal: "aal2",
    session_id: "c7000000-0000-4000-8000-000000000001",
  };
  const TENANT = "a0000000-0000-4000-8000-00000000000a";
  const NOTICE = "f0000000-0000-4000-8000-00000000000f";
  const B = "http://127.0.0.1:3000/api/platform";
  const cases: [string, () => Promise<Response>, Record<string, FakeResult[]>][] = [
    [
      "/api/platform/me",
      () => platformMe.GET(new Request(`${B}/me`)),
      { platform_me: [ok(ex.meResponse.example)] },
    ],
    [
      "/api/platform/tenants",
      () => platformTenants.GET(new Request(`${B}/tenants`)),
      { platform_tenants: [ok(ex.tenantsResponse.example.tenants)] },
    ],
    [
      "/api/platform/tenants/[id]",
      () => platformTenant.GET(new Request(`${B}/tenants/${TENANT}`), routeContext({ id: TENANT })),
      { platform_tenant: [ok(ex.tenantDetailResponse.example)] },
    ],
    [
      "/api/platform/tenants/[id]/open",
      () =>
        platformOpen.POST(
          jsonRequest(`${B}/tenants/${TENANT}/open`, {}),
          routeContext({ id: TENANT }),
        ),
      { platform_open_tenant: [ok({ tenantId: TENANT, attached: true })] },
    ],
    [
      "/api/platform/audit",
      () => platformAudit.GET(new Request(`${B}/audit?dal=2026-10-16&al=2026-11-15`)),
      { platform_audit: [ok(ex.auditResponse.example)] },
    ],
    [
      "/api/platform/notices",
      () => platformNotices.GET(new Request(`${B}/notices`)),
      { platform_notices: [ok(ex.noticesResponse.example.notices)] },
    ],
    [
      "/api/platform/notices/[id]/notified",
      () =>
        platformNotified.POST(
          jsonRequest(`${B}/notices/${NOTICE}/notified`, { tenantId: TENANT }),
          routeContext({ id: NOTICE }),
        ),
      { platform_notice_mark: [ok(ex.noticeNotifiedResponse.example)] },
    ],
    ["/api/platform/console", () => platformConsole.POST(jsonRequest(`${B}/console`, {})), {}],
    [
      "/api/platform/logout",
      () => platformLogout.POST(jsonRequest(`${B}/logout`, {})),
      { platform_leave_console: [ok({ changed: true })] },
    ],
  ];

  it.each(cases)("%s", async (path, call, rpc) => {
    vi.stubEnv("APP_ORIGIN", "https://app.example.test");
    client = fakeSupabase({ claims: CONSOLE, rpc });
    const response = await call();
    vi.unstubAllEnvs();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(keysOf(json).length).toBeGreaterThan(0);
    expect(flagged(path, json)).toEqual([]);
  });

  it("/api/platform/auth/password", async () => {
    client = fakeSupabase({
      claims: null,
      rpc: { platform_mfa_attempt_allowed: [ok({ allowed: true, retryAfterSeconds: 0 })] },
    });
    const response = await platformPassword.POST(
      jsonRequest(`${B}/auth/password`, {
        email: "platform-admin@example.test",
        password: "test-password",
      }),
    );
    expect(response.status).toBe(200);
    expect(flagged("/api/platform/auth/password", await response.json())).toEqual([]);
  });
});
