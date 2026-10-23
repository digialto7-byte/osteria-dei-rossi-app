import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeSupabase,
  jsonRequest,
  OWNER_CLAIMS,
  type FakeClaims,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// M11 acceptance test 7 (API half): a PIN session ends at the cut-off, on revocation, lock, reset or
// deactivation. withApi asks Postgres on every request from a PIN session (ADR-010 decision 6).
let client: FakeSupabase;
const reportError = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const { withApi } = await import("@/lib/api/with-api");

const URL_ = "http://localhost:3000/api/test";
const PIN_CLAIMS: FakeClaims = {
  ...OWNER_CLAIMS,
  app_role: "waiter",
  login: "pin",
  session_id: "44444444-4444-4444-8444-444444444444",
};
const handler = vi.fn(async () => Response.json({ ok: true }));
const roleRoute = withApi({ roles: ["waiter", "owner"] }, handler);
const authedRoute = withApi({ authenticated: true }, handler);
const publicRoute = withApi({ public: true }, handler);

const get = () => new Request(URL_);
const active = (value: boolean) => ({ staff_session_active: [{ data: value, error: null }] });

beforeEach(() => {
  handler.mockClear();
  reportError.mockReset();
});

describe("withApi staff session gate", () => {
  it("a PIN session that Postgres says is over gets 401 session_ended and a local sign-out", async () => {
    client = fakeSupabase({ claims: PIN_CLAIMS, rpc: active(false) });
    const response = await roleRoute(get());
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("session_ended");
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("a live PIN session reaches the handler, after one staff_session_active call", async () => {
    client = fakeSupabase({ claims: PIN_CLAIMS, rpc: active(true) });
    const response = await roleRoute(get());
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("staff_session_active");
    expect(client.auth.signOut).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("the gate also covers routes that only need a signed-in user", async () => {
    client = fakeSupabase({ claims: PIN_CLAIMS, rpc: active(false) });
    const response = await authedRoute(get());
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("session_ended");
  });

  it("email sessions never call the RPC", async () => {
    client = fakeSupabase({ claims: OWNER_CLAIMS, rpc: active(false) });
    expect((await roleRoute(get())).status).toBe(200);
    expect((await authedRoute(get())).status).toBe(200);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("claims marked session_state ended (no tenant) get 401 session_ended, not 403", async () => {
    client = fakeSupabase({
      claims: { sub: OWNER_CLAIMS.sub, session_state: "ended" },
      rpc: active(true),
    });
    const response = await roleRoute(get());
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("session_ended");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("an RPC error is a 500 and the handler does not run", async () => {
    client = fakeSupabase({
      claims: PIN_CLAIMS,
      rpc: { staff_session_active: [{ data: null, error: { code: "XX000", message: "boom" } }] },
    });
    const response = await roleRoute(get());
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("internal");
    expect(handler).not.toHaveBeenCalled();
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it("a non-boolean answer is treated as an error, not as a live session", async () => {
    client = fakeSupabase({
      claims: PIN_CLAIMS,
      rpc: { staff_session_active: [{ data: null, error: null }] },
    });
    expect((await roleRoute(get())).status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
  });

  it("a failing local sign-out still answers 401", async () => {
    client = fakeSupabase({ claims: PIN_CLAIMS, rpc: active(false) });
    client.auth.signOut.mockRejectedValue(new Error("network"));
    const response = await roleRoute(get());
    expect(response.status).toBe(401);
  });

  it("public routes never look at the session", async () => {
    client = fakeSupabase({ claims: PIN_CLAIMS, rpc: active(false) });
    expect((await publicRoute(get())).status).toBe(200);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("the role check still applies to a live PIN session", async () => {
    client = fakeSupabase({ claims: { ...PIN_CLAIMS, app_role: "chef" }, rpc: active(true) });
    expect((await roleRoute(jsonRequest(URL_, {}))).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});
