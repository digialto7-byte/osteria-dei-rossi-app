import { describe, expect, it, vi } from "vitest";
import { MFA_OFFER_PAGE_READY } from "@/lib/auth/mfa-constants";
import { fakeSupabase, OWNER_CLAIMS } from "../../helpers/fake-supabase";

// P2-1 B4: the offer page /login/offerta-codice exists, so MFA_OFFER_PAGE_READY is true and an owner or admin without a factor is sent there after the first factor.
// This replaces redirect-offer-off.test.ts (PR 1), which pinned the opposite while the page did not exist. No mock of the constant: the shipped value is under test.
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
const admin = { ...owner, app_role: "admin" };

describe("the offer redirect now that its page exists", () => {
  it("the constant is true", () => {
    expect(MFA_OFFER_PAGE_READY).toBe(true);
  });

  it("an owner without a factor, mode enrolled or required, is offered the code with the way back", async () => {
    for (const mode of ["enrolled", "required"]) {
      const client = fakeSupabase({ claims: null, rpc: { mfa_status: status({ mode }) } });
      expect(await afterFirstFactor(client as never, owner, "/oggi")).toBe(
        "/login/offerta-codice?next=%2Foggi",
      );
    }
  });

  it("an admin without a factor and mode enrolled is forced to enrol, not offered (FD31, 2026-11-13: the gate answers enrol in every mode)", async () => {
    const client = fakeSupabase({
      claims: null,
      rpc: { mfa_status: status({ role: "admin", gate: "enrol" }) },
    });
    expect(await afterFirstFactor(client as never, admin, "/fatture?x=1")).toBe(
      "/login/attiva-codice?next=%2Ffatture%3Fx%3D1",
    );
  });

  it("mode off keeps today's redirect, with no offer", async () => {
    const client = fakeSupabase({ claims: null, rpc: { mfa_status: status({ mode: "off" }) } });
    expect(await afterFirstFactor(client as never, owner, "/oggi")).toBe("/oggi");
  });

  it("an external next becomes / inside the offer link", async () => {
    const client = fakeSupabase({ claims: null, rpc: { mfa_status: status() } });
    expect(await afterFirstFactor(client as never, owner, "https://evil.test/")).toBe(
      "/login/offerta-codice?next=%2F",
    );
  });

  it("an owner who already has a factor gets the challenge, not the offer", async () => {
    const client = fakeSupabase({
      claims: null,
      rpc: { mfa_status: status({ hasVerifiedFactor: true, gate: "challenge" }) },
    });
    expect(await afterFirstFactor(client as never, owner, "/oggi")).toBe(
      "/login/codice?next=%2Foggi",
    );
  });

  it("the forced enrolment still wins over the offer", async () => {
    const client = fakeSupabase({
      claims: null,
      rpc: { mfa_status: status({ role: "admin", mode: "required", gate: "enrol" }) },
    });
    expect(await afterFirstFactor(client as never, admin, "/oggi")).toBe(
      "/login/attiva-codice?next=%2Foggi",
    );
  });
});
