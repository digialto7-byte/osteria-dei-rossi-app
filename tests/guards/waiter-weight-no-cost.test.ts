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
