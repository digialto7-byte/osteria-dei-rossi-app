import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  OWNER_CLAIMS,
  type FakeClaims,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// P2-1 A11 (AT-T4): the magic link is a first factor like the password. Its landing goes through the same next step, so the link cannot bypass the code.
let client: FakeSupabase;
const report = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => report);

const callback = await import("@/app/api/auth/callback/route");
const BASE = "http://localhost:3000";
const mfaStatus = (over: Record<string, unknown> = {}) => [
  {
    data: {
      role: "owner",
      mode: "enrolled",
      hasVerifiedFactor: false,
      gate: "ok",
      issuer: "Osteria Demo A",
      ...over,
    },
    error: null,
  },
];
const land = async (
  query: string,
  claims: FakeClaims,
  rpc: Record<string, ReturnType<typeof mfaStatus>> = {},
) => {
  client = fakeSupabase({ claims: { ...claims, aal: "aal1" }, rpc });
  const response = await callback.GET(new Request(`${BASE}/api/auth/callback?${query}`));
  return { status: response.status, location: response.headers.get("location") };
};

beforeEach(() => report.reportError.mockReset());

describe("GET /api/auth/callback and the second factor", () => {
  it("an owner with a factor lands on the code page, with the way on", async () => {
    expect(
      await land("code=abc&next=%2Ffatture", OWNER_CLAIMS, {
        mfa_status: mfaStatus({ hasVerifiedFactor: true, gate: "challenge" }),
      }),
    ).toEqual({
      status: 303,
      location: `${BASE}/login/codice?next=%2Ffatture`,
    });
  });

  it("an admin under required without a factor lands on the forced enrolment", async () => {
    expect(
      await land("code=abc", claimsFor("admin"), {
        mfa_status: mfaStatus({ role: "admin", mode: "required", gate: "enrol" }),
      }),
    ).toEqual({
      status: 303,
      location: `${BASE}/login/attiva-codice?next=%2F`,
    });
  });

  it("an owner without a factor is offered it", async () => {
    expect(
      (await land("code=abc&next=%2Foggi", OWNER_CLAIMS, { mfa_status: mfaStatus() })).location,
    ).toBe(`${BASE}/login/offerta-codice?next=%2Foggi`);
  });

  it("mode off, a chef or a waiter: the same redirect as before", async () => {
    expect(
      (
        await land("code=abc&next=%2Fcucina", OWNER_CLAIMS, {
          mfa_status: mfaStatus({ mode: "off" }),
        })
      ).location,
    ).toBe(`${BASE}/cucina`);
    const chef = await land("code=abc&next=%2Fcucina", claimsFor("chef"));
    expect(chef.location).toBe(`${BASE}/cucina`);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an off-site next is dropped before the next step", async () => {
    expect(
      (
        await land("code=abc&next=https://evil.example", OWNER_CLAIMS, {
          mfa_status: mfaStatus({ hasVerifiedFactor: true, gate: "challenge" }),
        })
      ).location,
    ).toBe(`${BASE}/login/codice?next=%2F`);
  });

  it("an invalid link still goes back to the login page and asks nothing", async () => {
    client = fakeSupabase({ claims: OWNER_CLAIMS });
    client.auth.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { status: 400, message: "invalid" },
    });
    const response = await callback.GET(new Request(`${BASE}/api/auth/callback?code=old`));
    expect(response.headers.get("location")).toBe(`${BASE}/login?errore=link`);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
