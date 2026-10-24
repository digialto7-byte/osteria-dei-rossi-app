import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { COPERTO_READ } from "../../helpers/menu-tables-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/settings/coperto/route");
const URL_ = "http://localhost:3000/api/settings/coperto";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const BODY = { copertoAmount: 1.5, copertoVatRate: 10 };
const CHANGE = { changed: true, coperto: { amount: 1.5, vatRate: 10 } };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { sale_settings_read: [ok(COPERTO_READ)], set_sale_settings: [ok(CHANGE)], ...rpc },
  });
}
const patch = (body: unknown, init: RequestInit = {}) =>
  route.PATCH(jsonRequest(URL_, body, { method: "PATCH", ...init }));

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/settings/coperto", () => {
  it.each(["owner", "admin"])(
    "%s gets the coperto, the default rate and the allowed rates",
    async (role) => {
      as(role);
      const response = await route.GET(new Request(URL_));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(COPERTO_READ);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("sale_settings_read");
    },
  );

  it("a tenant without a coperto gets null", async () => {
    as("owner", {
      sale_settings_read: [ok({ ...COPERTO_READ, coperto: null, defaults: { vatRate: 22 } })],
    });
    const json = await (await route.GET(new Request(URL_))).json();
    expect(json.coperto).toBeNull();
    expect(json.defaults.vatRate).toBe(22);
  });

  it.each(["waiter", "chef"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await route.GET(new Request(URL_))).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await route.GET(new Request(URL_))).status).toBe(401);
  });
});

describe("PATCH /api/settings/coperto", () => {
  it.each(["owner", "admin"])("%s: one RPC with both keys", async (role) => {
    as(role);
    const response = await patch(BODY);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(CHANGE);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("set_sale_settings", { p_patch: BODY });
  });

  it("null and null clear the coperto", async () => {
    as("owner", { set_sale_settings: [ok({ changed: true, coperto: null })] });
    const body = { copertoAmount: null, copertoVatRate: null };
    const response = await patch(body);
    expect(response.status).toBe(200);
    expect((await response.json()).coperto).toBeNull();
    expect(client.rpc).toHaveBeenCalledWith("set_sale_settings", { p_patch: body });
  });

  it("one null and one value goes to the database, which answers 422 coperto_invalid", async () => {
    as("owner", { set_sale_settings: [failure("P0001", "coperto_invalid")] });
    const response = await patch({ copertoAmount: 1.5, copertoVatRate: null });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("coperto_invalid");
  });

  it.each(["waiter", "chef"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await patch(BODY)).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is 415 and a body over 4 KiB is 413", async () => {
    expect((await patch("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    const big = await patch(BODY, {
      headers: { "content-type": "application/json", "content-length": "4097" },
    });
    expect(big.status).toBe(413);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing key", { copertoAmount: 1.5 }],
    ["an amount of 0", { copertoAmount: 0, copertoVatRate: 10 }],
    ["an amount above 100", { copertoAmount: 100.01, copertoVatRate: 10 }],
    ["a VAT rate that is not allowed", { copertoAmount: 1.5, copertoVatRate: 12 }],
  ])("%s is a 400 without any RPC", async (_name, body) => {
    expect((await patch(body)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0001", "coperto_invalid", 422, "coperto_invalid"],
    ["P0001", "vat_rate_invalid", 422, "vat_rate_invalid"],
    ["22023", "invalid_request", 400, "invalid_request"],
    ["42501", "permission denied", 403, "forbidden"],
  ])("%s %s from the database is %i %s", async (code, message, status, apiCode) => {
    as("owner", { set_sale_settings: [failure(code, message)] });
    const response = await patch(BODY);
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(apiCode);
  });
});
