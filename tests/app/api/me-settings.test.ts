import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  OWNER_CLAIMS,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const me = await import("@/app/api/me/route");

const ok = (data: unknown): FakeResult => ({ data, error: null });
const ME_ROW = {
  id: "a1000000-0000-4000-8000-00000000000a",
  display_name: "Titolare Demo",
  role: "owner",
  tenant: { id: OWNER_CLAIMS.tenant_id, name: "Osteria Demo", demo_data_since: null },
};
const SETTINGS = {
  timeZone: "Europe/Rome",
  locale: "it",
  currency: "EUR",
  receiptTypes: ["scontrino", "fattura"],
  paymentTypes: ["cash", "card", "other"],
};
const call = () => me.GET(new Request("http://localhost:3000/api/me"));
function as(role: string, rpc: FakeResult, row: unknown = { ...ME_ROW, role }) {
  client = fakeSupabase({ claims: claimsFor(role), meRow: row, rpc: { tenant_settings: [rpc] } });
}

beforeEach(() => {
  reportError.mockClear();
  as("owner", ok(SETTINGS));
});

describe("GET /api/me with settings (SP1 step 9)", () => {
  it("answers today's keys plus `settings` from the tenant_settings RPC", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: ME_ROW.id, displayName: "Titolare Demo", role: "owner" },
      tenant: { id: OWNER_CLAIMS.tenant_id, name: "Osteria Demo", isDemo: false },
      settings: SETTINGS,
    });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("tenant_settings");
  });

  it.each(["owner", "admin", "waiter"])("stays offline-cacheable for %s", async (role) => {
    as(role, ok(SETTINGS));
    expect((await call()).headers.get("x-offline-cache")).toBe("1");
  });

  it("stays out of the offline cache for the chef", async () => {
    as("chef", ok(SETTINGS));
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.has("x-offline-cache")).toBe(false);
  });

  it("an RPC error is a 500, reported with the code only", async () => {
    as("owner", { data: null, error: { code: "XX000", message: "secret detail Osteria Demo" } });
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(String((reportError.mock.calls[0]![0] as Error).message)).toBe(
      "tenant_settings failed: XX000",
    );
  });

  it.each([
    ["no settings at all", null],
    ["an injected vatRates", { ...SETTINGS, vatRates: [0, 4, 10, 22] }],
    ["another currency", { ...SETTINGS, currency: "USD" }],
    ["an unknown zone", { ...SETTINGS, timeZone: "Not/AZone" }],
    ["an empty list", { ...SETTINGS, paymentTypes: [] }],
  ])("the strict output refuses %s with a 500, never a default", async (_name, bad) => {
    as("waiter", ok(bad));
    const response = await call();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("vatRates");
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("does not read the settings for a user without a membership (403 first)", async () => {
    as("owner", ok(SETTINGS), null);
    expect((await call()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
