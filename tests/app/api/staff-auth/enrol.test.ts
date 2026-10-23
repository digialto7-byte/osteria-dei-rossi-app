import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeSupabase } from "../../../helpers/fake-supabase";
import { hashEnrolmentCode, hashIp, normaliseCode, sha256Hex } from "@/server/staff-auth/tokens";
import { PEPPER, postJson } from "./helpers";

// M11 acceptance test 4 (API half): a code is single use and short lived, redemption is rate
// limited per IP, and only a successful redemption sets the device cookie.
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

const { POST } = await import("@/app/api/devices/enrol/route");

const DEVICE_ID = "55555555-5555-4555-8555-555555555555";
const ok = { status: "ok", deviceId: DEVICE_ID, label: "Telefono sala (demo)" };
const enrol = (code: unknown = "K7M2-QX9P", headers: Record<string, string> = {}) =>
  postJson("/api/devices/enrol", { code }, headers);

beforeEach(() => {
  client = fakeSupabase({ claims: null });
  for (const mock of Object.values(privileged)) mock.mockReset();
  privileged.redeemEnrolmentCode.mockResolvedValue(ok);
});

describe("POST /api/devices/enrol", () => {
  it("ok -> 201 {device:{label}} and the device cookie", async () => {
    const response = await POST(enrol());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ device: { label: "Telefono sala (demo)" } });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-odr_device=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
  });

  it("the token stored is the hash of the token in the cookie; the response never shows the token", async () => {
    const response = await POST(enrol());
    const token = /^__Host-odr_device=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
    expect(privileged.redeemEnrolmentCode.mock.calls[0]?.[1]).toBe(sha256Hex(token ?? ""));
    expect(await response.text()).not.toContain(token);
  });

  it("two enrolments get different tokens", async () => {
    const a = (await POST(enrol())).headers.get("set-cookie");
    const b = (await POST(enrol())).headers.get("set-cookie");
    expect(a).not.toBe(b);
  });

  it("the code is normalised before hashing", async () => {
    await POST(enrol(" k7m2-qx9p "));
    await POST(enrol("K7M2QX9P"));
    await POST(enrol("k7m2 qx9p"));
    const hashes = privileged.redeemEnrolmentCode.mock.calls.map((call) => call[0]);
    expect(new Set(hashes)).toEqual(
      new Set([hashEnrolmentCode(PEPPER, normaliseCode("K7M2QX9P"))]),
    );
    expect(hashes).not.toContain(sha256Hex("K7M2QX9P"));
    expect(hashes).toHaveLength(3);
  });

  it.each([
    ["code_used", 410, "enrolment_code_used"],
    ["code_expired", 410, "enrolment_code_expired"],
    ["code_invalid", 404, "enrolment_code_invalid"],
    ["rate_limited", 429, "enrol_rate_limited"],
  ])("%s -> %i %s with no cookie", async (status, http, code) => {
    privileged.redeemEnrolmentCode.mockResolvedValue({ status });
    const response = await POST(enrol());
    expect(response.status).toBe(http);
    expect((await response.json()).error.code).toBe(code);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("the IP hash comes from the first x-forwarded-for entry", async () => {
    await POST(enrol("K7M2-QX9P", { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }));
    expect(privileged.redeemEnrolmentCode.mock.calls[0]?.[2]).toBe(hashIp(PEPPER, "203.0.113.9"));
  });

  it("without the header the IP hash is the hash of 'unknown'", async () => {
    await POST(enrol());
    expect(privileged.redeemEnrolmentCode.mock.calls[0]?.[2]).toBe(hashIp(PEPPER, "unknown"));
  });

  it("the raw IP never reaches the privileged call", async () => {
    await POST(enrol("K7M2-QX9P", { "x-forwarded-for": "203.0.113.9" }));
    expect(JSON.stringify(privileged.redeemEnrolmentCode.mock.calls)).not.toContain("203.0.113.9");
  });

  it.each([
    ["an empty code", ""],
    ["a code over 16 characters", "A".repeat(17)],
    ["a number", 12345678],
  ])("%s -> 400 and nothing is called", async (_label, code) => {
    const response = await POST(enrol(code));
    expect(response.status).toBe(400);
    expect(privileged.redeemEnrolmentCode).not.toHaveBeenCalled();
  });

  it("an extra key -> 400; text/plain -> 415", async () => {
    expect((await POST(postJson("/api/devices/enrol", { code: "K7M2QX9P", x: 1 }))).status).toBe(
      400,
    );
    const plain = new Request("http://localhost:3000/api/devices/enrol", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "K7M2QX9P",
    });
    expect((await POST(plain)).status).toBe(415);
    expect(privileged.redeemEnrolmentCode).not.toHaveBeenCalled();
  });
});
