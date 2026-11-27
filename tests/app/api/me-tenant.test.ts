import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeSupabase,
  jsonRequest,
  OWNER_CLAIMS,
  type FakeClaims,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// SP2 S7 (docs/plans/2026-11-26-sp02-memberships.md §3.4, #131 §3.4 row 4): POST /api/me/tenant stores the session's choice (select_tenant), refreshes
// the session on the same route client (its cookie writer stores the new tokens) and answers 200 only when the new token carries the tenant asked for.
let client: FakeSupabase;
const reportError = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/me/tenant/route");
const A = OWNER_CLAIMS.tenant_id!;
const B = "22222222-2222-4222-8222-222222222222";
const SESSION = "5e550000-0000-4000-8000-00000000000a";
const BEFORE: FakeClaims = { ...OWNER_CLAIMS, session_id: SESSION };
const AFTER: FakeClaims = { ...OWNER_CLAIMS, tenant_id: B, session_id: SESSION };
const ok = (data: unknown): FakeResult => ({ data, error: null });
const fail = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});
const post = (body: unknown = { tenantId: B }) =>
  route.POST(jsonRequest("http://localhost:3000/api/me/tenant", body));

/** A client whose first getClaims (withApi) shows `before` and whose next one (after the refresh) shows `after`. */
function setup(rpc: FakeResult, before: FakeClaims | null = BEFORE, after: FakeClaims = AFTER) {
  // staff_session_active: a PIN session that is still live reaches the handler (with-api's staff check).
  client = fakeSupabase({
    claims: before,
    rpc: { select_tenant: [rpc], staff_session_active: [ok(true)] },
  });
  const fresh = fakeSupabase({ claims: after });
  const first = client.auth.getClaims.getMockImplementation()!;
  client.auth.getClaims
    .mockImplementationOnce(first)
    .mockImplementation(fresh.auth.getClaims.getMockImplementation()!);
}

beforeEach(() => {
  reportError.mockReset();
  setup(ok({ tenantId: B, changed: true }));
});

describe("POST /api/me/tenant", () => {
  it("200 with the new tenant after select_tenant and one refreshSession on the same client", async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tenantId: B });
    expect(client.rpc).toHaveBeenCalledWith("select_tenant", { p_tenant: B });
    expect(client.auth.refreshSession).toHaveBeenCalledTimes(1);
    const rpcOrder = client.rpc.mock.invocationCallOrder[0]!;
    expect(client.auth.refreshSession.mock.invocationCallOrder[0]!).toBeGreaterThan(rpcOrder);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("works from a session without a tenant claim (the chooser)", async () => {
    setup(ok({ tenantId: B, changed: true }), { sub: OWNER_CLAIMS.sub!, session_id: SESSION });
    expect((await post()).status).toBe(200);
  });

  it("choosing the tenant already held still refreshes and answers 200", async () => {
    setup(ok({ tenantId: A, changed: false }), BEFORE, BEFORE);
    const response = await post({ tenantId: A });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tenantId: A });
  });

  it.each([
    ["a missing tenantId", {}],
    ["a non-uuid", { tenantId: "osteria" }],
    ["an extra key", { tenantId: B, extra: 1 }],
  ])("400 invalid_request for %s, and no RPC", async (_name, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
    expect(client.rpc).not.toHaveBeenCalledWith("select_tenant", expect.anything());
  });

  it("403 forbidden for a PIN staff session, checked from the claims before any SQL", async () => {
    setup(ok({ tenantId: B, changed: true }), { ...BEFORE, app_role: "waiter", login: "pin" });
    const response = await post();
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    expect(client.rpc).not.toHaveBeenCalledWith("select_tenant", expect.anything());
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
  });

  it("404 tenant_not_found when the login is not an active member (42501), and no refresh", async () => {
    setup(fail("42501", "not_a_member"));
    const response = await post();
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("tenant_not_found");
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
  });

  it("429 tenant_switch_too_soon inside the switch interval, and no refresh", async () => {
    setup(fail("P0001", "tenant_switch_too_soon"));
    const response = await post();
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("tenant_switch_too_soon");
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
  });

  it("401 unauthenticated when the token has no session id", async () => {
    setup(fail("P0001", "session_missing"));
    const response = await post();
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthenticated");
  });

  it("401 when signed out, and no RPC", async () => {
    setup(ok({}), null);
    expect((await post()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("any other RPC error is a 500 reported with its code only", async () => {
    setup(fail("XX000", "Osteria Demo B exploded"));
    const response = await post();
    expect(response.status).toBe(500);
    expect(reportError).toHaveBeenCalledTimes(1);
    const reported = (reportError.mock.calls[0]![0] as Error).message;
    expect(reported).toContain("XX000");
    expect(reported).not.toContain("Osteria");
  });

  it("503 tenant_switch_failed when the refresh fails, reported once with its code only", async () => {
    client.auth.refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: { code: "refresh_token_not_found", message: "Osteria Demo B" },
    });
    const response = await post();
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("tenant_switch_failed");
    expect(reportError).toHaveBeenCalledTimes(1);
    const reported = (reportError.mock.calls[0]![0] as Error).message;
    expect(reported).toContain("refresh_token_not_found");
    expect(reported).not.toContain("Osteria");
  });

  it("503 tenant_switch_failed when the new token's tenant is not the one asked for (Rule B)", async () => {
    setup(ok({ tenantId: B, changed: true }), BEFORE, BEFORE);
    const response = await post();
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("tenant_switch_failed");
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("503 when the claims cannot be read after the refresh", async () => {
    client.auth.getClaims
      .mockReset()
      .mockResolvedValueOnce({
        data: {
          claims: {
            ...BEFORE,
            aal: "aal2",
            amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
          },
        },
        error: null,
      } as never)
      .mockResolvedValueOnce({ data: null, error: { message: "bad jwt" } } as never);
    const response = await post();
    expect(response.status).toBe(503);
  });

  it("refuses a body that is not JSON (CSRF): 415, no RPC", async () => {
    const response = await route.POST(
      new Request("http://localhost:3000/api/me/tenant", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ tenantId: B }),
      }),
    );
    expect(response.status).toBe(415);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
