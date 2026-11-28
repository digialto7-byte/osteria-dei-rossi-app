import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeSupabase,
  OWNER_CLAIMS,
  type FakeClaims,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// SP2 S6 (docs/plans/2026-11-26-sp02-memberships.md §3.4): GET /api/me/tenants lists the login's own active memberships for the chooser and the
// switcher. Any signed-in login may call it (a session without a tenant claim needs it most). Strict output, `current` marks the token's tenant,
// never offline-cached, no cost key. An RPC error is a 500 reported with its code only.
let client: FakeSupabase;
const reportError = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/me/tenants/route");
const A = OWNER_CLAIMS.tenant_id!;
const B = "22222222-2222-4222-8222-222222222222";
const LIST = [
  { tenantId: A, name: "Osteria Demo A", role: "owner" },
  { tenantId: B, name: "Osteria Demo B", role: "admin" },
];
const call = () => route.GET(new Request("http://localhost:3000/api/me/tenants"));
const as = (claims: FakeClaims | null, data: unknown = LIST, error: unknown = null) => {
  client = fakeSupabase({
    claims,
    rpc: { my_memberships: [{ data, error: error as { code?: string; message: string } | null }] },
  });
};

beforeEach(() => {
  reportError.mockReset();
  as({ ...OWNER_CLAIMS });
});

describe("GET /api/me/tenants", () => {
  it("lists the memberships, `current` true only for the token's tenant", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tenants: [
        { id: A, name: "Osteria Demo A", role: "owner", current: true },
        { id: B, name: "Osteria Demo B", role: "admin", current: false },
      ],
    });
    expect(client.rpc).toHaveBeenCalledWith("my_memberships");
  });

  it("works without a tenant claim (the chooser): nothing is current", async () => {
    as({ sub: OWNER_CLAIMS.sub! });
    const response = await call();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.tenants.map((t: { current: boolean }) => t.current)).toEqual([false, false]);
  });

  it("is never offline-cached and never stored", async () => {
    const response = await call();
    expect(response.headers.has("x-offline-cache")).toBe(false);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("401 when signed out, and no RPC runs", async () => {
    as(null);
    const response = await call();
    expect(response.status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalledWith("my_memberships");
  });

  it("an unknown key in the RPC reply (a cost) is a 500 and is not echoed", async () => {
    as({ ...OWNER_CLAIMS }, [{ ...LIST[0], unitCost: 3.2 }]);
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("3.2");
  });

  // SP3 step 15 (plan §3.6, app host step 2): the platform admin at aal1 is sent to the code page, so its list answers 403 mfa_required, never 500.
  it("my_memberships raising mfa_required is 403 mfa_required, not reported", async () => {
    as({ sub: OWNER_CLAIMS.sub! }, null, { code: "P0001", message: "mfa_required" });
    const response = await call();
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("mfa_required");
    expect(reportError).not.toHaveBeenCalled();
  });

  it("an RPC error is a 500 reported with its code only, never a tenant name", async () => {
    as({ ...OWNER_CLAIMS }, null, { code: "42501", message: "Osteria Demo A denied" });
    const response = await call();
    expect(response.status).toBe(500);
    expect(reportError).toHaveBeenCalledTimes(1);
    const reported = String((reportError.mock.calls[0]![0] as Error).message);
    expect(reported).toContain("42501");
    expect(reported).not.toContain("Osteria");
  });
});
