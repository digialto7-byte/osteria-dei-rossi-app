import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const stockRoute = await import("@/app/api/stock/route");
const lotsRoute = await import("@/app/api/stock/lots/route");
const movementsRoute = await import("@/app/api/stock/movements/route");

const BASE = "http://localhost:3000/api/stock";
const ING = "1a000000-0000-4000-8000-00000000001a";
const CELLA = "10000000-0000-4000-8000-0000000000a1";
const FREEZER = "10000000-0000-4000-8000-0000000000a2";
const LOT = "10700000-0000-4000-8000-0000000000a1";
const MOVE = "0e000000-0000-4000-8000-0000000000e1";
const OP = "0f000000-0000-4000-8000-0000000000a1";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

// What the SQL functions return, plus a tempting extra column that must never reach the JSON.
const HAND_ROW = {
  ingredient_id: ING,
  ingredient_name: "Manzo muscolo (demo)",
  base_unit: "kg",
  is_active: true,
  location_id: CELLA,
  location_name: "Cella (demo)",
  on_hand_qty: 6,
  unlotted_qty: 0,
  unit_cost: 10,
};
const LOT_ROW = {
  raw_lot_id: LOT,
  lot_code: "L-D2",
  location_id: CELLA,
  location_name: "Cella (demo)",
  expiry: "2026-10-25",
  expiry_state: "ok",
  received_on: "2026-10-20",
  supplier_name: "Fornitore Demo Srl",
  qty_received: 2,
  on_hand_qty: 2,
  fefo_rank: 1,
  unit_cost: 10,
};
const OPERATION = {
  operationId: OP,
  handleId: MOVE,
  type: "waste",
  refType: "manual",
  reasonCode: "spoilage",
  isReversal: false,
  reversedByOperationId: null,
  reversible: true,
  qty: -1.5,
  unit: "kg",
  lines: [
    {
      movementId: MOVE,
      locationId: CELLA,
      locationName: "Cella (demo)",
      rawLotId: LOT,
      lotCode: "L-D2",
      qty: -1.5,
      unit_cost: 10,
    },
  ],
  effectiveOn: "2026-10-23",
  createdAt: "2026-10-23T10:12:00.123456+00:00",
  byName: null,
  byMe: false,
  unit_cost: 10,
};

function as(
  role: string,
  over: { rpc?: Record<string, FakeResult[]>; results?: Record<string, FakeResult[]> } = {},
) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: {
      stock_on_hand: [ok([HAND_ROW])],
      stock_lots: [ok([LOT_ROW])],
      stock_movements: [
        ok({
          operations: [OPERATION],
          nextCursor: { createdAt: "2026-10-23T10:12:00.123456+00:00", id: MOVE },
        }),
      ],
      ...over.rpc,
    },
    results: {
      ingredient: [ok({ id: ING, name: "Manzo muscolo (demo)", base_unit: "kg" })],
      location: [
        ok([
          { id: CELLA, name: "Cella (demo)" },
          { id: FREEZER, name: "Freezer (demo)" },
        ]),
      ],
      ...over.results,
    },
  });
}
beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

const calls: [string, () => Promise<Response>][] = [
  ["GET /api/stock", () => stockRoute.GET(new Request(BASE))],
  ["GET /api/stock/lots", () => lotsRoute.GET(new Request(`${BASE}/lots?ingredient=${ING}`))],
  [
    "GET /api/stock/movements",
    () => movementsRoute.GET(new Request(`${BASE}/movements?ingredient=${ING}`)),
  ],
];

describe("role table", () => {
  it.each(calls)("%s: the waiter gets 403 before any RPC", async (_name, call) => {
    as("waiter");
    expect((await call()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(calls)("%s: no session is 401", async (_name, call) => {
    client = fakeSupabase({ claims: null });
    expect((await call()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(calls)("%s: owner, admin and chef pass", async (_name, call) => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      expect((await call()).status, role).toBe(200);
    }
  });

  it.each(calls)("%s: 42501 from the database is a 403, P0002 a 404", async (_name, call) => {
    const rpc = {
      stock_on_hand: [failure("42501", "x")],
      stock_lots: [failure("42501", "x")],
      stock_movements: [failure("42501", "x")],
    };
    as("owner", { rpc });
    expect((await call()).status).toBe(403);
    const missing = {
      stock_on_hand: [failure("P0002", "location_not_found")],
      stock_lots: [failure("P0002", "ingredient_not_found")],
      stock_movements: [failure("P0002", "ingredient_not_found")],
    };
    as("owner", { rpc: missing });
    expect((await call()).status).toBe(404);
  });
});

describe("GET /api/stock", () => {
  it("returns the items grouped by ingredient, with no cost key", async () => {
    const response = await stockRoute.GET(new Request(BASE));
    const body = await response.json();
    expect(client.rpc).toHaveBeenCalledWith("stock_on_hand", { p_location: null });
    expect(Object.keys(body).sort()).toEqual(["asOf", "items"]);
    expect(body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.items).toEqual([
      {
        ingredientId: ING,
        name: "Manzo muscolo (demo)",
        baseUnit: "kg",
        isActive: true,
        onHandQty: 6,
        negative: false,
        locations: [
          {
            locationId: CELLA,
            name: "Cella (demo)",
            onHandQty: 6,
            unlottedQty: 0,
            negative: false,
          },
        ],
      },
    ]);
  });

  it("passes the location filter; an unknown query parameter or a bad uuid is a 400 without an RPC", async () => {
    await stockRoute.GET(new Request(`${BASE}?location=${CELLA}`));
    expect(client.rpc).toHaveBeenCalledWith("stock_on_hand", { p_location: CELLA });
    for (const qs of ["?foo=1", "?location=x"]) {
      as("owner");
      expect((await stockRoute.GET(new Request(`${BASE}${qs}`))).status, qs).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });
});

describe("GET /api/stock/lots", () => {
  it("returns the ingredient, today, the units, the active locations and the lots", async () => {
    const response = await lotsRoute.GET(new Request(`${BASE}/lots?ingredient=${ING}`));
    const body = await response.json();
    expect(client.rpc).toHaveBeenCalledWith("stock_lots", {
      p_ingredient: ING,
      p_include_empty: false,
    });
    expect(Object.keys(body).sort()).toEqual(["ingredient", "locations", "lots", "today", "units"]);
    expect(body.ingredient).toEqual({ id: ING, name: "Manzo muscolo (demo)", baseUnit: "kg" });
    expect(body.units).toEqual(["kg", "g"]);
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.locations).toEqual([
      { id: CELLA, name: "Cella (demo)" },
      { id: FREEZER, name: "Freezer (demo)" },
    ]);
    expect(body.lots).toEqual([
      {
        rawLotId: LOT,
        lotCode: "L-D2",
        locationId: CELLA,
        locationName: "Cella (demo)",
        expiry: "2026-10-25",
        expiryState: "ok",
        receivedOn: "2026-10-20",
        supplierName: "Fornitore Demo Srl",
        qtyReceived: 2,
        onHandQty: 2,
        fefoRank: 1,
      },
    ]);
    expect(client.query.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("units follow the base unit: l -> l, ml; pz -> pz", async () => {
    as("chef", { results: { ingredient: [ok({ id: ING, name: "Olio (demo)", base_unit: "l" })] } });
    expect(
      (await (await lotsRoute.GET(new Request(`${BASE}/lots?ingredient=${ING}`))).json()).units,
    ).toEqual(["l", "ml"]);
    as("chef", {
      results: { ingredient: [ok({ id: ING, name: "Uova (demo)", base_unit: "pz" })] },
    });
    expect(
      (await (await lotsRoute.GET(new Request(`${BASE}/lots?ingredient=${ING}`))).json()).units,
    ).toEqual(["pz"]);
  });

  it("?empty=1 asks for the empty buckets too", async () => {
    await lotsRoute.GET(new Request(`${BASE}/lots?ingredient=${ING}&empty=1`));
    expect(client.rpc).toHaveBeenCalledWith("stock_lots", {
      p_ingredient: ING,
      p_include_empty: true,
    });
  });

  it("a malformed ingredient is a 404 without an RPC; a missing one is a 400", async () => {
    expect((await lotsRoute.GET(new Request(`${BASE}/lots?ingredient=x`))).status).toBe(404);
    expect((await lotsRoute.GET(new Request(`${BASE}/lots`))).status).toBe(400);
    expect((await lotsRoute.GET(new Request(`${BASE}/lots?ingredient=${ING}&x=1`))).status).toBe(
      400,
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an ingredient the caller cannot read is a 404", async () => {
    as("chef", { results: { ingredient: [ok(null)] } });
    expect((await lotsRoute.GET(new Request(`${BASE}/lots?ingredient=${ING}`))).status).toBe(404);
  });
});

describe("GET /api/stock/movements", () => {
  it("returns the operations and a cursor string", async () => {
    const response = await movementsRoute.GET(new Request(`${BASE}/movements?ingredient=${ING}`));
    const body = await response.json();
    expect(client.rpc).toHaveBeenCalledWith("stock_movements", {
      p_ingredient: ING,
      p_before_at: null,
      p_before_id: null,
      p_limit: 50,
    });
    expect(body.nextCursor).toBe(`2026-10-23T10:12:00.123456+00:00_${MOVE}`);
    expect(body.operations).toHaveLength(1);
    expect(body.operations[0]).toEqual({
      ...OPERATION,
      unit_cost: undefined,
      lines: [{ ...OPERATION.lines[0], unit_cost: undefined }],
    });
  });

  it("passes the cursor back as two arguments", async () => {
    const before = `2026-10-23T10:12:00.123456+00:00_${MOVE}`;
    await movementsRoute.GET(
      new Request(`${BASE}/movements?ingredient=${ING}&before=${encodeURIComponent(before)}`),
    );
    expect(client.rpc).toHaveBeenCalledWith("stock_movements", {
      p_ingredient: ING,
      p_before_at: "2026-10-23T10:12:00.123456+00:00",
      p_before_id: MOVE,
      p_limit: 50,
    });
  });

  it("a bad cursor is a 400 and runs no RPC", async () => {
    const response = await movementsRoute.GET(
      new Request(`${BASE}/movements?ingredient=${ING}&before=nope`),
    );
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no cursor when the page is the last", async () => {
    as("chef", { rpc: { stock_movements: [ok({ operations: [], nextCursor: null })] } });
    const body = await (
      await movementsRoute.GET(new Request(`${BASE}/movements?ingredient=${ING}`))
    ).json();
    expect(body).toEqual({ operations: [], nextCursor: null });
  });
});

describe("V6: the quantity endpoints carry no cost (Q16)", () => {
  const COSTLY = /eur|cost|price|margin|value|amount/i;
  const keysOf = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.flatMap(keysOf)
      : value !== null && typeof value === "object"
        ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
        : [];

  it.each(calls)(
    "%s: no key looks like money, no euro sign, and the injected unit_cost is gone",
    async (_name, call) => {
      for (const role of ["owner", "admin", "chef"]) {
        as(role);
        const text = await (await call()).text();
        const body = JSON.parse(text) as unknown;
        expect(
          keysOf(body).filter((key) => COSTLY.test(key)),
          `${role} keys`,
        ).toEqual([]);
        expect(text, role).not.toContain("€");
        expect(text, role).not.toContain("unit_cost");
      }
    },
  );
});
