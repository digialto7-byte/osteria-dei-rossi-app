import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeSupabase,
  OWNER_CLAIMS,
  type FakeClaims,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// M25a step 2 (ADR-029 decision 4): a session ends 30 days after its sign-in, whatever the Supabase plan.
let client: FakeSupabase;

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const { withApi } = await import("@/lib/api/with-api");

const NOW = Date.parse("2026-11-20T10:00:00Z");
const DAY = 86_400;
const agedClaims = (days: number, extra: FakeClaims = {}): FakeClaims => ({
  ...OWNER_CLAIMS,
  ...extra,
  amr: [{ method: "password", timestamp: NOW / 1000 - days * DAY }],
});

const handler = vi.fn(async () => Response.json({ ok: true }));
const roleRoute = withApi({ roles: ["owner"] }, handler);
const authedRoute = withApi({ authenticated: true }, handler);
const publicRoute = withApi({ public: true }, handler);
const get = () => new Request("http://localhost:3000/api/test");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  handler.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("withApi 30-day session cap", () => {
  it("a 31-day-old session on a roles route gets 401 session_expired and a local sign-out", async () => {
    client = fakeSupabase({ claims: agedClaims(31) });
    const response = await roleRoute(get());
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("session_expired");
    expect(body.error.message).toBe("La sessione è scaduta: accedi di nuovo.");
    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(handler).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("the same on an authenticated-only route", async () => {
    client = fakeSupabase({ claims: agedClaims(31) });
    const response = await authedRoute(get());
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("session_expired");
    expect(handler).not.toHaveBeenCalled();
  });

  it("a 29-day-old session is served", async () => {
    client = fakeSupabase({ claims: agedClaims(29) });
    expect((await roleRoute(get())).status).toBe(200);
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it("a PIN session 31 days old is expired before the staff gate asks Postgres", async () => {
    client = fakeSupabase({ claims: agedClaims(31, { login: "pin" }) });
    const response = await roleRoute(get());
    expect((await response.json()).error.code).toBe("session_expired");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a session without any amr is expired (fail closed)", async () => {
    client = fakeSupabase({ claims: { ...OWNER_CLAIMS, amr: [] } });
    expect((await roleRoute(get())).status).toBe(401);
  });

  it("a public route ignores the claims", async () => {
    client = fakeSupabase({ claims: agedClaims(400) });
    expect((await publicRoute(get())).status).toBe(200);
    expect(client.auth.getClaims).not.toHaveBeenCalled();
  });

  it("still answers 401 when the local sign-out throws", async () => {
    client = fakeSupabase({ claims: agedClaims(31) });
    client.auth.signOut.mockRejectedValueOnce(new Error("network"));
    expect((await roleRoute(get())).status).toBe(401);
  });
});
