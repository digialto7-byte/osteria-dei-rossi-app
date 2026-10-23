import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const basisRoute = await import("@/app/api/ingredients/[id]/cost-basis/route");
const settingsRoute = await import("@/app/api/settings/route");
const fixedRoute = await import("@/app/api/fixed-costs/route");

const BEEF = "be000000-0000-4000-8000-0000000000be";
const BASE = "http://localhost:3000/api";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details },
});

const SETTINGS = { avgCostN: 3, priceVariancePct: 10, saleVatPct: 10 };
const ENTERED = {
  id: "f1000000-0000-4000-8000-0000000000f1",
  month: "2026-10-01",
  rent: 3000,
  labour: 9000,
  utilities: 1500,
  total: 13500,
};
const BODY = { month: "2026-10", rentEur: 3000, labourEur: 9000, utilitiesEur: 1500 };

function as(
  role: string,
  rpc: Record<string, FakeResult[]> = {},
  results: Record<string, FakeResult[]> = {},
) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: {
      set_ingredient_cost_basis: [
        ok({ ingredientId: BEEF, basis: "last_price", validFrom: "2026-10-23T10:00:00+00:00" }),
      ],
      cost_settings: [ok(SETTINGS)],
      update_cost_settings: [ok({ ...SETTINGS, priceVariancePct: 5 })],
      enter_fixed_costs: [ok(ENTERED)],
      ...rpc,
    },
    results: { fixed_cost_period: [ok(null)], ...results },
  });
}
beforeEach(() => as("owner"));

const putBasis = (body: unknown, init: RequestInit = {}) =>
  basisRoute.PUT(
    jsonRequest(`${BASE}/ingredients/${BEEF}/cost-basis`, body, { method: "PUT", ...init }),
    routeContext({ id: BEEF }),
  );
const getSettings = () => settingsRoute.GET(new Request(`${BASE}/settings`));
const patchSettings = (body: unknown, init: RequestInit = {}) =>
  settingsRoute.PATCH(jsonRequest(`${BASE}/settings`, body, { method: "PATCH", ...init }));
const getFixed = () => fixedRoute.GET(new Request(`${BASE}/fixed-costs`));
const postFixed = (body: unknown) => fixedRoute.POST(jsonRequest(`${BASE}/fixed-costs`, body));

describe("PUT /api/ingredients/:id/cost-basis (AT3)", () => {
  it("owner and admin set the basis through one RPC", async () => {
    for (const role of ["owner", "admin"]) {
      as(role);
      const response = await putBasis({ basis: "last_price" });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ingredientId: BEEF,
        basis: "last_price",
        validFrom: "2026-10-23T10:00:00+00:00",
      });
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("set_ingredient_cost_basis", {
        p_ingredient: BEEF,
        p_basis: "last_price",
      });
    }
  });

  it("chef and waiter get 403 before any RPC", async () => {
    for (const role of ["chef", "waiter"]) {
      as(role);
      expect((await putBasis({ basis: "last_price" })).status).toBe(403);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });

  it("400 for an unknown basis or an extra key, 415 for text/plain, 404 for a bad id", async () => {
    expect((await putBasis({ basis: "x" })).status).toBe(400);
    expect((await putBasis({ basis: "last_price", extra: 1 })).status).toBe(400);
    expect(
      (await putBasis("basis=last_price", { headers: { "content-type": "text/plain" } })).status,
    ).toBe(415);
    const response = await basisRoute.PUT(
      jsonRequest(`${BASE}/ingredients/x/cost-basis`, { basis: "last_price" }, { method: "PUT" }),
      routeContext({ id: "x" }),
    );
    expect(response.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("404 for an ingredient of another tenant (P0002) and 403 from the database", async () => {
    as("owner", { set_ingredient_cost_basis: [failure("P0002", "not_found")] });
    expect((await putBasis({ basis: "last_price" })).status).toBe(404);
    as("owner", { set_ingredient_cost_basis: [failure("42501", "denied")] });
    expect((await putBasis({ basis: "last_price" })).status).toBe(403);
  });

  it("nothing but the three fields travels on", async () => {
    as("owner", {
      set_ingredient_cost_basis: [
        ok({ ingredientId: BEEF, basis: "moving_average", validFrom: null, secret: "x" }),
      ],
    });
    expect(await (await putBasis({ basis: "moving_average" })).json()).toEqual({
      ingredientId: BEEF,
      basis: "moving_average",
      validFrom: null,
    });
  });
});

describe("/api/settings", () => {
  it("GET: owner and admin read the three settings", async () => {
    for (const role of ["owner", "admin"]) {
      as(role);
      const response = await getSettings();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(SETTINGS);
    }
  });

  it("GET and PATCH: chef and waiter get 403 before any RPC", async () => {
    for (const role of ["chef", "waiter"]) {
      as(role);
      expect((await getSettings()).status).toBe(403);
      expect((await patchSettings({ priceVariancePct: 5 })).status).toBe(403);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });

  it("PATCH sends the changed keys in snake_case and returns the three values", async () => {
    const response = await patchSettings({ priceVariancePct: 5 });
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("update_cost_settings", {
      p_patch: { price_variance_pct: 5 },
    });
    expect(await response.json()).toEqual({ avgCostN: 3, priceVariancePct: 5, saleVatPct: 10 });
  });

  it("PATCH maps all three keys, and the admin may too", async () => {
    as("admin");
    await patchSettings({ avgCostN: 4, priceVariancePct: 8.5, saleVatPct: 22 });
    expect(client.rpc).toHaveBeenCalledWith("update_cost_settings", {
      p_patch: { avg_cost_n: 4, price_variance_pct: 8.5, sale_vat_pct: 22 },
    });
  });

  it("PATCH refuses an unknown key (400), text/plain (415) and a bad type (400)", async () => {
    expect((await patchSettings({ foo: 1 })).status).toBe(400);
    expect((await patchSettings({ priceVariancePct: "5" })).status).toBe(400);
    expect((await patchSettings("x", { headers: { "content-type": "text/plain" } })).status).toBe(
      415,
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("PATCH: settings_invalid is a 422 with the field and code, in API names", async () => {
    as("owner", {
      update_cost_settings: [
        failure(
          "P0001",
          "settings_invalid",
          JSON.stringify([{ field: "avg_cost_n", code: "out_of_range" }]),
        ),
      ],
    });
    const response = await patchSettings({ avgCostN: 11 });
    expect(response.status).toBe(422);
    const { error } = await response.json();
    expect(error.code).toBe("settings_invalid");
    expect(error.details).toEqual([{ field: "avgCostN", code: "out_of_range" }]);
  });
});

describe("/api/fixed-costs (owner only, founder 2026-10-23)", () => {
  it.each(["admin", "chef", "waiter"])("%s gets 403 before any RPC or query", async (role) => {
    as(role);
    expect((await getFixed()).status).toBe(403);
    expect((await postFixed(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await getFixed()).status).toBe(401);
  });

  it("GET lists the months newest first with the entry in force", async () => {
    as(
      "owner",
      {},
      {
        fixed_cost_period: [
          ok([
            {
              id: "a",
              month: "2026-10-01",
              rent: 3000,
              labour: 9000,
              utilities: 1500,
              created_at: "2026-10-02T08:00:00+00:00",
            },
            {
              id: "b",
              month: "2026-10-01",
              rent: 3500,
              labour: 9000,
              utilities: 1500,
              created_at: "2026-10-20T08:00:00+00:00",
            },
          ]),
        ],
      },
    );
    const { periods } = await (await getFixed()).json();
    expect(periods.map((p: { id: string; inForce: boolean }) => [p.id, p.inForce])).toEqual([
      ["b", true],
      ["a", false],
    ]);
    expect(client.from).toHaveBeenCalledWith("fixed_cost_period");
  });

  it("POST sends the first day of the month and answers 201 for a new entry", async () => {
    const response = await postFixed(BODY);
    expect(response.status).toBe(201);
    expect(client.rpc).toHaveBeenCalledWith("enter_fixed_costs", {
      p_month: "2026-10-01",
      p_rent: 3000,
      p_labour: 9000,
      p_utilities: 1500,
    });
    expect(await response.json()).toEqual({
      period: {
        id: ENTERED.id,
        month: "2026-10-01",
        rentEur: 3000,
        labourEur: 9000,
        utilitiesEur: 1500,
        totalEur: 13500,
      },
    });
  });

  it("POST answers 200 when the figures repeat the month's newest entry (a double tap)", async () => {
    as("owner", {}, { fixed_cost_period: [ok({ id: ENTERED.id })] });
    expect((await postFixed(BODY)).status).toBe(200);
  });

  it("POST: 400 for a malformed month, a missing or extra field; 415 for text/plain", async () => {
    expect((await postFixed({ ...BODY, month: "2026-13" })).status).toBe(400);
    expect((await postFixed({ ...BODY, month: "2026-10-01" })).status).toBe(400);
    expect((await postFixed({ month: "2026-10", rentEur: 1 })).status).toBe(400);
    expect((await postFixed({ ...BODY, perPerson: 1 })).status).toBe(400);
    const plain = await fixedRoute.POST(
      jsonRequest(`${BASE}/fixed-costs`, "x", { headers: { "content-type": "text/plain" } }),
    );
    expect(plain.status).toBe(415);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("POST: fixed_cost_invalid is a 422 with details in API names", async () => {
    as("owner", {
      enter_fixed_costs: [
        failure(
          "P0001",
          "fixed_cost_invalid",
          JSON.stringify([{ field: "labour", code: "out_of_range" }]),
        ),
      ],
    });
    const response = await postFixed({ ...BODY, labourEur: -1 });
    expect(response.status).toBe(422);
    const { error } = await response.json();
    expect(error.code).toBe("fixed_cost_invalid");
    expect(error.details).toEqual([{ field: "labourEur", code: "out_of_range" }]);
  });
});
