import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  claimsFor,
  fakeSupabase,
  OWNER_CLAIMS,
  type FakeClaims,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// P2-1 A9 (docs/plans/2026-11-12-p2-1-totp.md section 3.1 T-5, 5 A9): withApi asks Postgres (public.mfa_gate) only for an owner or admin whose token is not aal2, and
// answers early and clearly: 403 mfa_required (a code is needed) or 403 mfa_enrol_required (the account must enrol). Postgres stays authoritative.
let client: FakeSupabase;
const report = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => report);

const { withApi } = await import("@/lib/api/with-api");

const handler = vi.fn(async () => Response.json({ ok: true }));
const ownerRoute = withApi({ roles: ["owner", "admin"] }, handler);
const staffRoute = withApi({ roles: ["owner", "admin", "chef", "waiter"] }, handler);
const exemptRoute = withApi({ roles: ["owner", "admin"], mfa: "exempt" }, handler);
const authedRoute = withApi({ authenticated: true }, handler);
const bodyRoute = withApi(
  { roles: ["owner", "admin"], body: z.object({ name: z.string() }) },
  handler,
);
const get = () => new Request("http://localhost:3000/api/test");
const ok = (data: unknown) => [{ data, error: null }];
const at = (aal: string | undefined, extra: FakeClaims = {}): FakeClaims => ({
  ...OWNER_CLAIMS,
  ...extra,
  aal,
});
const gateCalls = () => client.rpc.mock.calls.filter((c) => c[0] === "mfa_gate");

beforeEach(() => {
  handler.mockClear();
  report.reportError.mockReset();
});

describe("withApi second-factor gate", () => {
  it("an owner token at aal2 reaches the handler with no RPC", async () => {
    client = fakeSupabase({ claims: at("aal2") });
    expect((await ownerRoute(get())).status).toBe(200);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("aal1 and mfa_gate ok: the handler runs after exactly one mfa_gate call", async () => {
    client = fakeSupabase({ claims: at("aal1"), rpc: { mfa_gate: ok("ok") } });
    expect((await ownerRoute(get())).status).toBe(200);
    expect(gateCalls()).toHaveLength(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("a missing aal claim counts as aal1 (Supabase: a missing claim is aal1)", async () => {
    client = fakeSupabase({ claims: at(undefined), rpc: { mfa_gate: ok("ok") } });
    expect((await ownerRoute(get())).status).toBe(200);
    expect(gateCalls()).toHaveLength(1);
  });

  it("challenge: 403 mfa_required, before the handler", async () => {
    client = fakeSupabase({ claims: at("aal1"), rpc: { mfa_gate: ok("challenge") } });
    const response = await ownerRoute(get());
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("mfa_required");
    expect(body.error.message).toBe("Serve il codice di verifica: inseriscilo per continuare.");
    expect(handler).not.toHaveBeenCalled();
  });

  it("enrol: 403 mfa_enrol_required, before the handler", async () => {
    client = fakeSupabase({
      claims: at("aal1", { app_role: "admin" }),
      rpc: { mfa_gate: ok("enrol") },
    });
    const response = await ownerRoute(get());
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("mfa_enrol_required");
    expect(handler).not.toHaveBeenCalled();
  });

  it("the gate answers before the body is read: a bad JSON body gets 403, not 400, and is not consumed", async () => {
    client = fakeSupabase({ claims: at("aal1"), rpc: { mfa_gate: ok("challenge") } });
    const request = new Request("http://localhost:3000/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const response = await bodyRoute(request);
    expect(response.status).toBe(403);
    expect(request.bodyUsed).toBe(false);
  });

  it("an RPC error is a 500, reported with the code only", async () => {
    client = fakeSupabase({
      claims: at("aal1"),
      rpc: {
        mfa_gate: [
          { data: null, error: { code: "XX000", message: "detail that must not travel" } },
        ],
      },
    });
    const response = await ownerRoute(get());
    expect(response.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
    expect(report.reportError).toHaveBeenCalledTimes(1);
    const reported = String((report.reportError.mock.calls[0]?.[0] as Error).message);
    expect(reported).toContain("XX000");
    expect(reported).not.toContain("detail that must not travel");
  });

  it.each([[null], ["maybe"], [42]])(
    "an unexpected answer (%j) is a 500: the gate fails closed",
    async (answer) => {
      client = fakeSupabase({ claims: at("aal1"), rpc: { mfa_gate: ok(answer) } });
      expect((await ownerRoute(get())).status).toBe(500);
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it.each(["chef", "waiter"])("%s never causes a mfa_gate call, even at aal1", async (role) => {
    client = fakeSupabase({ claims: at("aal1", { app_role: role }) });
    expect((await staffRoute(get())).status).toBe(200);
    expect(gateCalls()).toHaveLength(0);
  });

  it("a PIN session (login pin) never causes a mfa_gate call", async () => {
    client = fakeSupabase({
      claims: at("aal1", { app_role: "waiter", login: "pin" }),
      rpc: { staff_session_active: ok(true) },
    });
    expect((await staffRoute(get())).status).toBe(200);
    expect(gateCalls()).toHaveLength(0);
  });

  it("a route marked mfa: exempt skips the gate (the enrolment and challenge routes)", async () => {
    client = fakeSupabase({ claims: at("aal1"), rpc: { mfa_gate: ok("challenge") } });
    expect((await exemptRoute(get())).status).toBe(200);
    expect(gateCalls()).toHaveLength(0);
  });

  it("an authenticated-only route (logout) is not gated", async () => {
    client = fakeSupabase({ claims: at("aal1"), rpc: { mfa_gate: ok("challenge") } });
    expect((await authedRoute(get())).status).toBe(200);
    expect(gateCalls()).toHaveLength(0);
  });

  it("the 30-day cap comes first: a 31-day-old aal1 owner gets session_expired, not mfa_required", async () => {
    const old = Date.now() / 1000 - 31 * 86_400;
    client = fakeSupabase({
      claims: at("aal1", { amr: [{ method: "password", timestamp: old }] }),
      rpc: { mfa_gate: ok("challenge") },
    });
    const response = await ownerRoute(get());
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("session_expired");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("the staff session check comes first: an ended session is session_ended, not mfa_required", async () => {
    client = fakeSupabase({
      claims: { ...claimsFor("owner"), aal: "aal1", session_state: "ended" },
      rpc: { mfa_gate: ok("challenge") },
    });
    const response = await ownerRoute(get());
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("session_ended");
    expect(gateCalls()).toHaveLength(0);
  });

  it("the role check still comes before the gate for a role the route does not allow", async () => {
    client = fakeSupabase({
      claims: at("aal1", { app_role: "chef" }),
      rpc: { mfa_gate: ok("challenge") },
    });
    const response = await ownerRoute(get());
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    expect(gateCalls()).toHaveLength(0);
  });
});
