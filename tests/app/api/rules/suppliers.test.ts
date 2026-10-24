import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/rules/suppliers/route");

const URL_ = "http://localhost:3000/api/rules/suppliers";
const SUP = "5a000000-0000-4000-8000-000000000001";
const OTHER = "5a000000-0000-4000-8000-000000000002";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const ITEM_JSON = {
  supplierId: SUP,
  name: "Macelleria X (demo)",
  leadTimeDays: 2,
  deliveryWeekdays: [1, 4],
  orderCutoffTime: "11:00",
  nextWindow: { deliveryDate: "2026-11-05", orderByAt: "2026-11-03T10:00:00Z" },
};
const OTHER_JSON = {
  supplierId: OTHER,
  name: "Fornitore Y (demo)",
  leadTimeDays: null,
  deliveryWeekdays: [],
  orderCutoffTime: null,
  nextWindow: null,
};
const READ = { items: [OTHER_JSON, ITEM_JSON] };
const CHANGE = {
  supplierId: SUP,
  changed: true,
  leadTimeDays: 2,
  deliveryWeekdays: [1, 4],
  orderCutoffTime: "11:00",
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { rules_suppliers: [ok(READ)], set_supplier_delivery: [ok(CHANGE)], ...rpc },
  });
}
const patch = (body: unknown, init: RequestInit = {}) =>
  route.PATCH(jsonRequest(URL_, body, { method: "PATCH", ...init }));
const BODY = {
  supplierId: SUP,
  leadTimeDays: 2,
  deliveryWeekdays: [4, 1],
  orderCutoffTime: "11:00",
};

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/rules/suppliers", () => {
  it.each(["owner", "admin", "chef"])("%s gets the suppliers with one RPC", async (role) => {
    as(role);
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(READ);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("rules_suppliers");
  });

  it("the waiter gets 403 before any RPC and no session is 401", async () => {
    as("waiter");
    expect((await route.GET(new Request(URL_))).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    client = fakeSupabase({ claims: null });
    expect((await route.GET(new Request(URL_))).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an undeclared key in the reply never reaches the JSON", async () => {
    as("owner", { rules_suppliers: [ok({ items: [{ ...ITEM_JSON, last_price: 3 }] })] });
    const response = await route.GET(new Request(URL_));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("last_price");
  });

  it("maps 42501 to 403", async () => {
    as("owner", { rules_suppliers: [failure("42501", "x")] });
    expect((await route.GET(new Request(URL_))).status).toBe(403);
  });
});

describe("PATCH /api/rules/suppliers", () => {
  it.each(["owner", "admin"])(
    "%s: one RPC with the patch, then a read for the item",
    async (role) => {
      as(role);
      const response = await patch(BODY);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ supplierId: SUP, changed: true, item: ITEM_JSON });
      expect(client.rpc.mock.calls[0]).toEqual([
        "set_supplier_delivery",
        {
          p_supplier: SUP,
          p_patch: { leadTimeDays: 2, deliveryWeekdays: [4, 1], orderCutoffTime: "11:00" },
        },
      ]);
      expect(client.rpc.mock.calls).toHaveLength(2);
      expect(client.rpc.mock.calls[1]![0]).toBe("rules_suppliers");
    },
  );

  it("clears with null and accepts an empty weekday list", async () => {
    await patch({ supplierId: SUP, orderCutoffTime: null, deliveryWeekdays: [] });
    expect(client.rpc.mock.calls[0]).toEqual([
      "set_supplier_delivery",
      { p_supplier: SUP, p_patch: { orderCutoffTime: null, deliveryWeekdays: [] } },
    ]);
  });

  it("the item is null when the follow-up read does not list the supplier", async () => {
    as("owner", { rules_suppliers: [ok({ items: [OTHER_JSON] })] });
    expect(await (await patch(BODY)).json()).toEqual({
      supplierId: SUP,
      changed: true,
      item: null,
    });
  });

  it.each(["chef", "waiter"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await patch(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401, text/plain 415, over 4 KiB 413", async () => {
    expect((await patch("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect(
      (
        await patch(BODY, {
          headers: { "content-type": "application/json", "content-length": "4097" },
        })
      ).status,
    ).toBe(413);
    client = fakeSupabase({ claims: null });
    expect((await patch(BODY)).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown key", { ...BODY, name: "x" }],
    ["an empty patch", { supplierId: SUP }],
    ["a malformed id", { ...BODY, supplierId: "nope" }],
    ["weekday 0", { supplierId: SUP, deliveryWeekdays: [0] }],
    ["weekday 8", { supplierId: SUP, deliveryWeekdays: [8] }],
    ["a repeated weekday", { supplierId: SUP, deliveryWeekdays: [1, 1] }],
    ["null weekdays", { supplierId: SUP, deliveryWeekdays: null }],
    ["a bad cut-off", { supplierId: SUP, orderCutoffTime: "24:00" }],
    ["lead time 366", { supplierId: SUP, leadTimeDays: 366 }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    const response = await patch(body);
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0001", "lead_time_invalid", 422, "lead_time_invalid"],
    ["P0001", "weekdays_invalid", 422, "weekdays_invalid"],
    ["P0001", "cutoff_invalid", 422, "cutoff_invalid"],
    ["P0002", "supplier_not_found", 404, "not_found"],
    ["22023", "invalid_request", 400, "invalid_request"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("owner", { set_supplier_delivery: [failure(code, message)] });
    const response = await patch(BODY);
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(apiCode);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("an unexpected database error is a 500 with no text", async () => {
    as("owner", { set_supplier_delivery: [failure("XX000", "boom Macelleria")] });
    const response = await patch(BODY);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
  });
});
