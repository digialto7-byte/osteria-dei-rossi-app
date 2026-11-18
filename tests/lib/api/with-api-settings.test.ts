import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { ME_SETTINGS } from "../../helpers/me-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const { withApi } = await import("@/lib/api/with-api");

const ok = (data: unknown): FakeResult => ({ data, error: null });
const LISBON = { ...ME_SETTINGS, timeZone: "Europe/Lisbon" };
const request = () => new Request("http://localhost:3000/api/x");

beforeEach(() => {
  reportError.mockClear();
  client = fakeSupabase({ claims: claimsFor("owner"), rpc: { tenant_settings: [ok(LISBON)] } });
});

describe("withApi's tenantSettings() (SP1 step 11)", () => {
  it("calls the tenant_settings RPC once per request, however often it is asked", async () => {
    const route = withApi({ roles: ["owner"] }, async ({ tenantSettings }) => {
      const [a, b] = await Promise.all([tenantSettings(), tenantSettings()]);
      const c = await tenantSettings();
      return Response.json({ same: a === b && b === c, zone: c.timeZone });
    });
    const response = await route(request());
    expect(await response.json()).toEqual({ same: true, zone: "Europe/Lisbon" });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("tenant_settings");
  });

  it("never calls the RPC when the handler does not ask", async () => {
    const route = withApi({ roles: ["owner"] }, async () => Response.json({}));
    await route(request());
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("is a new read for the next request (nothing is shared between requests)", async () => {
    const route = withApi({ roles: ["owner"] }, async ({ tenantSettings }) =>
      Response.json({ zone: (await tenantSettings()).timeZone }),
    );
    await route(request());
    await route(request());
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  it("an RPC error is a 500 reported with the code only", async () => {
    client = fakeSupabase({
      claims: claimsFor("owner"),
      rpc: {
        tenant_settings: [{ data: null, error: { code: "XX000", message: "secret detail" } }],
      },
    });
    const route = withApi({ roles: ["owner"] }, async ({ tenantSettings }) =>
      Response.json(await tenantSettings()),
    );
    const response = await route(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
    expect(String((reportError.mock.calls[0]![0] as Error).message)).toBe(
      "tenant_settings failed: XX000",
    );
  });

  it("settings that fail the schema are a 500, never a default zone", async () => {
    client = fakeSupabase({
      claims: claimsFor("owner"),
      rpc: { tenant_settings: [ok({ ...ME_SETTINGS, timeZone: "Not/AZone" })] },
    });
    const route = withApi({ roles: ["owner"] }, async ({ tenantSettings }) =>
      Response.json(await tenantSettings()),
    );
    expect((await route(request())).status).toBe(500);
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
