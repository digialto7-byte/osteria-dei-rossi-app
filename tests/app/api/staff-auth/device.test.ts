import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeSupabase } from "../../../helpers/fake-supabase";
import { DEVICE_HASH, DEVICE_TOKEN, deviceCookie, PEPPER } from "./helpers";

process.env.PIN_PEPPER = PEPPER;
let client: FakeSupabase;
const privileged = vi.hoisted(() => ({
  beginPinLogin: vi.fn(),
  finishPinLogin: vi.fn(),
  redeemEnrolmentCode: vi.fn(),
  deviceStaffList: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));
vi.mock("@/server/staff-auth/privileged", () => privileged);

const { GET } = await import("@/app/api/auth/device/route");

const get = (cookie?: string) =>
  new Request("http://localhost:3000/api/auth/device", { headers: cookie ? { cookie } : {} });

beforeEach(() => {
  client = fakeSupabase({ claims: null });
  for (const mock of Object.values(privileged)) mock.mockReset();
});

describe("GET /api/auth/device", () => {
  it("no cookie -> {enrolled:false} and no RPC", async () => {
    const response = await GET(get());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enrolled: false });
    expect(privileged.deviceStaffList).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("a malformed cookie is the same as none", async () => {
    const response = await GET(get("__Host-odr_device=short"));
    expect(await response.json()).toEqual({ enrolled: false });
    expect(privileged.deviceStaffList).not.toHaveBeenCalled();
  });

  it.each(["revoked", "unknown"])(
    "a %s device -> {enrolled:false} and the cookie is cleared",
    async (status) => {
      privileged.deviceStaffList.mockResolvedValue({ status });
      const response = await GET(get(deviceCookie()));
      expect(await response.json()).toEqual({ enrolled: false });
      expect(privileged.deviceStaffList).toHaveBeenCalledWith(DEVICE_HASH);
      const cookie = response.headers.get("set-cookie") ?? "";
      expect(cookie).toContain("__Host-odr_device=;");
      expect(cookie).toContain("Max-Age=0");
    },
  );

  it("an enrolled device -> label, locked and staff with displayName and role only", async () => {
    privileged.deviceStaffList.mockResolvedValue({
      status: "ok",
      label: "Telefono sala (demo)",
      locked: false,
      staff: [
        { id: "u1", displayName: "Cameriere Demo", role: "waiter", authEmail: "x", lastLogin: "t" },
        { id: "u2", displayName: "Cuoco Demo", role: "chef" },
      ],
    });
    const response = await GET(get(deviceCookie()));
    expect(await response.json()).toEqual({
      enrolled: true,
      label: "Telefono sala (demo)",
      locked: false,
      staff: [
        { id: "u1", displayName: "Cameriere Demo", role: "waiter" },
        { id: "u2", displayName: "Cuoco Demo", role: "chef" },
      ],
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(JSON.stringify(privileged.deviceStaffList.mock.calls)).not.toContain(DEVICE_TOKEN);
  });

  it("a locked device is reported as locked", async () => {
    privileged.deviceStaffList.mockResolvedValue({
      status: "ok",
      label: "Tablet cucina (demo)",
      locked: true,
      staff: [],
    });
    expect((await (await GET(get(deviceCookie()))).json()).locked).toBe(true);
  });

  it("a failing RPC is a 500 with no detail", async () => {
    privileged.deviceStaffList.mockRejectedValue(new Error("db"));
    const response = await GET(get(deviceCookie()));
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("internal");
  });

  it("answers no-store", async () => {
    expect((await GET(get())).headers.get("cache-control")).toBe("no-store");
  });
});
