import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dataRpcCalls,
  fakeSupabase,
  OWNER_CLAIMS,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// SP2 S6 (docs/plans/2026-11-26-sp02-memberships.md §3.4): a token without a tenant claim from a login with memberships means "this session has not
// chosen a venue yet": 409 tenant_selection_required (Q-S4, Rule B: never a silent landing in some venue). Without memberships it stays 403 no_tenant.
let client: FakeSupabase;
const reportError = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const { withApi } = await import("@/lib/api/with-api");
const route = withApi({ roles: ["owner", "admin", "chef", "waiter"] }, async () =>
  Response.json({ ok: true }),
);
const get = () => route(new Request("http://localhost:3000/api/test"));
const NO_TENANT = { sub: OWNER_CLAIMS.sub, session_id: "5e550000-0000-4000-8000-00000000000a" };
const membership = (id: string) => ({ tenantId: id, name: "Osteria Demo", role: "owner" });

beforeEach(() => reportError.mockReset());

describe("withApi without a tenant claim", () => {
  it("a roles route, a token without tenant, two memberships: 409 tenant_selection_required", async () => {
    client = fakeSupabase({
      claims: NO_TENANT,
      rpc: { my_memberships: [{ data: [membership("1"), membership("2")], error: null }] },
    });
    const response = await get();
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("tenant_selection_required");
  });

  it("one membership (a token issued before it existed) is a choice to make too: 409", async () => {
    client = fakeSupabase({
      claims: NO_TENANT,
      rpc: { my_memberships: [{ data: [membership("1")], error: null }] },
    });
    expect((await get()).status).toBe(409);
  });

  it("no membership: 403 no_tenant, as before", async () => {
    client = fakeSupabase({
      claims: NO_TENANT,
      rpc: { my_memberships: [{ data: [], error: null }] },
    });
    const response = await get();
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("no_tenant");
  });

  it("an ended PIN session gets 401 before any membership lookup", async () => {
    client = fakeSupabase({ claims: { sub: OWNER_CLAIMS.sub, session_state: "ended" } });
    expect((await get()).status).toBe(401);
    expect(dataRpcCalls(client).filter((c) => c[0] === "my_memberships")).toEqual([]);
  });

  it("a token with a tenant never asks for the memberships", async () => {
    client = fakeSupabase({ claims: OWNER_CLAIMS });
    expect((await get()).status).toBe(200);
    expect(dataRpcCalls(client).filter((c) => c[0] === "my_memberships")).toEqual([]);
  });

  it("a lookup error is a 500 reported with its code only, never a guess", async () => {
    client = fakeSupabase({
      claims: NO_TENANT,
      rpc: {
        my_memberships: [
          { data: null, error: { code: "XX000", message: "Osteria Demo secret detail" } },
        ],
      },
    });
    expect((await get()).status).toBe(500);
    expect(String(reportError.mock.calls[0]?.[0])).toContain("XX000");
    expect(String(reportError.mock.calls[0]?.[0])).not.toContain("Osteria Demo");
  });

  // SP3 step 15 (plan §3.3.5, §3.6 app host step 2): my_memberships needs aal2 from the platform admin; the no-tenant branch passes that on as 403 mfa_required.
  it("my_memberships raising mfa_required (the platform admin at aal1) is 403 mfa_required, not 409 and not 500", async () => {
    client = fakeSupabase({
      claims: NO_TENANT,
      rpc: { my_memberships: [{ data: null, error: { code: "P0001", message: "mfa_required" } }] },
    });
    const response = await get();
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("mfa_required");
    expect(reportError).not.toHaveBeenCalled();
  });

  it("another P0001 from my_memberships is still a 500 with its code only", async () => {
    client = fakeSupabase({
      claims: NO_TENANT,
      rpc: {
        my_memberships: [{ data: null, error: { code: "P0001", message: "something_else" } }],
      },
    });
    expect((await get()).status).toBe(500);
    expect(String(reportError.mock.calls[0]?.[0])).not.toContain("something_else");
  });

  it("a reply that is not a list is a 500, never a guess", async () => {
    client = fakeSupabase({
      claims: NO_TENANT,
      rpc: { my_memberships: [{ data: { tenants: 2 }, error: null }] },
    });
    expect((await get()).status).toBe(500);
  });
});
