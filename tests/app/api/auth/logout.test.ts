import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeSupabase,
  jsonRequest,
  OWNER_CLAIMS,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
const reportError = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const logout = await import("@/app/api/auth/logout/route");
const request = () => jsonRequest("http://localhost:3000/api/auth/logout", {});
const PIN_CLAIMS = { ...OWNER_CLAIMS, app_role: "waiter", login: "pin" };
const LIVE = { staff_session_active: [{ data: true, error: null }] };

beforeEach(() => reportError.mockReset());

describe("POST /api/auth/logout with staff sessions", () => {
  it("ends the staff session first, then signs out", async () => {
    client = fakeSupabase({ claims: PIN_CLAIMS, rpc: LIVE });
    const response = await logout.POST(request());
    expect(response.status).toBe(204);
    expect(client.rpc).toHaveBeenCalledWith("end_my_staff_session");
    expect(client.rpc.mock.invocationCallOrder[1]).toBeLessThan(
      client.auth.signOut.mock.invocationCallOrder[0] ?? 0,
    );
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("an RPC error still signs out, and is reported by code only", async () => {
    client = fakeSupabase({
      claims: PIN_CLAIMS,
      rpc: {
        ...LIVE,
        end_my_staff_session: [{ data: null, error: { code: "XX000", message: "secret" } }],
      },
    });
    const response = await logout.POST(request());
    expect(response.status).toBe(204);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(String(reportError.mock.calls[0]?.[0])).toContain("XX000");
    expect(String(reportError.mock.calls[0]?.[0])).not.toContain("secret");
  });

  it("a thrown RPC still signs out", async () => {
    client = fakeSupabase({ claims: PIN_CLAIMS, rpc: LIVE });
    client.rpc.mockImplementation(async (fn: string) => {
      if (fn === "staff_session_active") return { data: true, error: null };
      throw new Error("network");
    });
    expect((await logout.POST(request())).status).toBe(204);
    expect(client.auth.signOut).toHaveBeenCalled();
  });

  it("a PIN session that already ended can still be left (401 plus local sign-out)", async () => {
    client = fakeSupabase({
      claims: PIN_CLAIMS,
      rpc: { staff_session_active: [{ data: false, error: null }] },
    });
    const response = await logout.POST(request());
    expect(response.status).toBe(401);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
