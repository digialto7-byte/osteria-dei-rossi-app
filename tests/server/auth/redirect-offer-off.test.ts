import { describe, expect, it, vi } from "vitest";
import { MFA_OFFER_PAGE_READY } from "@/lib/auth/mfa-constants";
import { fakeSupabase, OWNER_CLAIMS } from "../../helpers/fake-supabase";

// P2-1 PR 1: the offer page /login/offerta-codice is built in PR 2 (B4). With the constant as shipped, nobody is sent to a page that does not exist: an owner without a
// factor keeps today's redirect, so for users nothing changes until PR 2. Step B4 flips the constant on purpose and moves this test's expectation with it.
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));
const { afterFirstFactor } = await import("@/server/auth/redirect");

const status = (over: Record<string, unknown> = {}) => [
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
const owner = { tenant_id: OWNER_CLAIMS.tenant_id, app_role: "owner", aal: "aal1" };

describe("the offer redirect while its page does not exist", () => {
  it("the constant is false in PR 1", () => {
    expect(MFA_OFFER_PAGE_READY).toBe(false);
  });

  it("an owner or admin without a factor, mode enrolled or required, keeps today's redirect", async () => {
    for (const mode of ["enrolled", "required"]) {
      const client = fakeSupabase({ claims: null, rpc: { mfa_status: status({ mode }) } });
      expect(await afterFirstFactor(client as never, owner, "/oggi")).toBe("/oggi");
    }
  });

  it("the challenge and the forced enrolment are not behind the constant", async () => {
    const challenge = fakeSupabase({
      claims: null,
      rpc: { mfa_status: status({ hasVerifiedFactor: true, gate: "challenge" }) },
    });
    expect(await afterFirstFactor(challenge as never, owner, "/oggi")).toBe(
      "/login/codice?next=%2Foggi",
    );
    const enrol = fakeSupabase({
      claims: null,
      rpc: { mfa_status: status({ role: "admin", mode: "required", gate: "enrol" }) },
    });
    expect(await afterFirstFactor(enrol as never, { ...owner, app_role: "admin" }, "/oggi")).toBe(
      "/login/attiva-codice?next=%2Foggi",
    );
  });
});
