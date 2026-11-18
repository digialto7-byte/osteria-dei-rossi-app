import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  tenantSettingsCalls,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { ME_SETTINGS } from "../../helpers/me-data";

// SP1 step 11, at the route level: a route that uses the zone reads tenant_settings EXACTLY once per request and uses the tenant's zone
// (not the server's first-paint zone); a route that does not use it reads it ZERO times.
let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: () => undefined }));

const payable = await import("@/app/api/payables/[id]/route");
const payables = await import("@/app/api/payables/route");

const ID = "90000000-0000-4000-8000-000000000001";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const DETAIL = {
  payable: { id: ID },
  allowedStatuses: [],
  canReversePayment: false,
  history: [],
};
const LISBON = { ...ME_SETTINGS, timeZone: "Europe/Lisbon" };
const get = () =>
  payable.GET(new Request(`http://localhost:3000/api/payables/${ID}`), routeContext({ id: ID }));

// 23:30 UTC on a December night (1998 has the 2026 clock-change shape; the date-bomb guard keeps clock-reading dates far from today):
// Lisbon is still on the 10th, Rome is on the 11th.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("1998-12-10T23:30:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("GET /api/payables/:id and the tenant's zone", () => {
  it("a Lisbon tenant gets Lisbon's day, and tenant_settings is read exactly once", async () => {
    client = fakeSupabase({
      claims: claimsFor("owner"),
      rpc: { payable_detail: [ok(DETAIL)], tenant_settings: [ok(LISBON)] },
    });
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).today).toBe("1998-12-10");
    expect(tenantSettingsCalls(client)).toBe(1);
  });

  it("a Rome tenant gets Rome's day at the same instant", async () => {
    client = fakeSupabase({
      claims: claimsFor("owner"),
      rpc: { payable_detail: [ok(DETAIL)], tenant_settings: [ok(ME_SETTINGS)] },
    });
    expect((await (await get()).json()).today).toBe("1998-12-11");
    expect(tenantSettingsCalls(client)).toBe(1);
  });

  it("settings that fail the schema make it a 500, not a default zone", async () => {
    client = fakeSupabase({
      claims: claimsFor("owner"),
      rpc: {
        payable_detail: [ok(DETAIL)],
        tenant_settings: [ok({ ...ME_SETTINGS, timeZone: "x" })],
      },
    });
    expect((await get()).status).toBe(500);
  });
});

describe("a route that does not use the zone", () => {
  it("GET /api/payables reads tenant_settings zero times", async () => {
    client = fakeSupabase({
      claims: claimsFor("owner"),
      rpc: {
        payable_list: [
          ok({ items: [], nextCursor: null, totals: { count: 0, amount: 0 }, today: "1998-12-10" }),
        ],
      },
    });
    const response = await payables.GET(new Request("http://localhost:3000/api/payables"));
    expect(response.status).toBe(200);
    expect(tenantSettingsCalls(client)).toBe(0);
  });
});
