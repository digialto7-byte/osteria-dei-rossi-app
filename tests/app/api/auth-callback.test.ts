import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  OWNER_CLAIMS,
  type FakeClaims,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// P2-1 A11 (AT-T4): the magic link is a first factor like the password. Its landing goes through the same next step, so the link cannot bypass the code.
// Lead fix (2026-11-14, fix/link-signin-password-offer): the link also makes the same /password offer as the e-mail code (owner and admin with a tenant,
// a safe next), so the expectations below match tests/app/api/auth-email-code.test.ts case by case.
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
      location: `${BASE}/login/codice?next=${encodeURIComponent("/password?dopo=%2Ffatture")}`,
    });
  });

  it("an admin under required without a factor lands on the forced enrolment", async () => {
    expect(
      await land("code=abc", claimsFor("admin"), {
        mfa_status: mfaStatus({ role: "admin", mode: "required", gate: "enrol" }),
      }),
    ).toEqual({
      status: 303,
      location: `${BASE}/login/attiva-codice?next=${encodeURIComponent("/password?dopo=%2F")}`,
    });
  });

  it("an owner without a factor is offered it, then the password offer", async () => {
    expect(
      (await land("code=abc&next=%2Foggi", OWNER_CLAIMS, { mfa_status: mfaStatus() })).location,
    ).toBe(`${BASE}/login/offerta-codice?next=${encodeURIComponent("/password?dopo=%2Foggi")}`);
  });

  it("mode off: the owner gets the password offer only; a chef keeps the redirect and makes no RPC", async () => {
    expect(
      (
        await land("code=abc&next=%2Fcucina", OWNER_CLAIMS, {
          mfa_status: mfaStatus({ mode: "off" }),
        })
      ).location,
    ).toBe(`${BASE}/password?dopo=%2Fcucina`);
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
    ).toBe(`${BASE}/login/codice?next=${encodeURIComponent("/password?dopo=%2F")}`);
  });

  it("offers an owner or an admin the password page first, remembering where they were going", async () => {
    const off = { mfa_status: mfaStatus({ mode: "off" }) };
    expect((await land("code=abc", OWNER_CLAIMS, off)).location).toBe(`${BASE}/password?dopo=%2F`);
    expect(
      (
        await land("code=abc&next=%2Freport", claimsFor("admin"), {
          mfa_status: mfaStatus({ role: "admin", mode: "off" }),
        })
      ).location,
    ).toBe(`${BASE}/password?dopo=%2Freport`);
  });

  it("a next that is already the password page is not wrapped twice", async () => {
    const off = { mfa_status: mfaStatus({ mode: "off" }) };
    expect((await land("code=abc&next=%2Fpassword", OWNER_CLAIMS, off)).location).toBe(
      `${BASE}/password`,
    );
  });

  it("an unsafe next becomes the landing page inside the offer", async () => {
    const off = { mfa_status: mfaStatus({ mode: "off" }) };
    expect((await land("code=abc&next=https://evil.example", OWNER_CLAIMS, off)).location).toBe(
      `${BASE}/password?dopo=%2F`,
    );
  });

  it("a waiter goes to the tables and an account without a tenant to /, with no offer and no RPC", async () => {
    expect((await land("code=abc", claimsFor("waiter"))).location).toBe(`${BASE}/tavoli`);
    expect(client.rpc).not.toHaveBeenCalled();
    expect((await land("code=abc", { sub: OWNER_CLAIMS.sub } as FakeClaims)).location).toBe(
      `${BASE}/`,
    );
    expect(client.rpc).not.toHaveBeenCalled();
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
