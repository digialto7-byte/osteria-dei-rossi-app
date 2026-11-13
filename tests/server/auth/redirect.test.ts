import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  OWNER_CLAIMS,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// P2-1 A11 (docs/plans/2026-11-12-p2-1-totp.md section 3.14, 5 A11): after the first factor (password, e-mail code or link) an owner or admin is sent to the next step:
// the code, the forced enrolment, or the offer. The same function serves the three paths.
const report = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/observability/report", () => report);
const { afterFirstFactor, redirectAfterCodeSignIn, redirectAfterSignIn } =
  await import("@/server/auth/redirect");

let client: FakeSupabase;
type Script = Record<string, { data: unknown; error: { code?: string; message: string } | null }[]>;
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
const make = (rpc: Script = {}) => {
  client = fakeSupabase({ claims: null, rpc });
};
const owner = { tenant_id: OWNER_CLAIMS.tenant_id, app_role: "owner", aal: "aal1" };

beforeEach(() => {
  report.reportError.mockReset();
});

describe("afterFirstFactor", () => {
  it("a token already at aal2 goes to its target with no RPC", async () => {
    make();
    expect(await afterFirstFactor(client as never, { ...owner, aal: "aal2" }, "/oggi")).toBe(
      "/oggi",
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([["chef"], ["waiter"]])("%s goes to its target with no RPC", async (role) => {
    make();
    expect(await afterFirstFactor(client as never, { ...owner, app_role: role }, "/tavoli")).toBe(
      "/tavoli",
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an account without a tenant goes to its target with no RPC", async () => {
    make();
    expect(await afterFirstFactor(client as never, { aal: "aal1" }, "/")).toBe("/");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("challenge: to the code page with the way on", async () => {
    make({ mfa_status: status({ hasVerifiedFactor: true, gate: "challenge" }) });
    expect(await afterFirstFactor(client as never, owner, "/oggi")).toBe(
      "/login/codice?next=%2Foggi",
    );
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("mfa_status");
  });

  it("enrol (an admin under required without a factor): to the forced enrolment", async () => {
    make({ mfa_status: status({ role: "admin", mode: "required", gate: "enrol" }) });
    expect(
      await afterFirstFactor(client as never, { ...owner, app_role: "admin" }, "/fatture"),
    ).toBe("/login/attiva-codice?next=%2Ffatture");
  });

  it("no factor and mode not off: the offer", async () => {
    for (const mode of ["enrolled", "required"]) {
      make({ mfa_status: status({ mode, role: "admin" }) });
      expect(await afterFirstFactor(client as never, { ...owner, app_role: "admin" }, "/")).toBe(
        "/login/offerta-codice?next=%2F",
      );
    }
  });

  it("mode off: today's redirect, no offer", async () => {
    make({ mfa_status: status({ mode: "off" }) });
    expect(await afterFirstFactor(client as never, owner, "/oggi")).toBe("/oggi");
  });

  it("mode off with a factor: the gate is off, so today's redirect", async () => {
    make({ mfa_status: status({ mode: "off", hasVerifiedFactor: true }) });
    expect(await afterFirstFactor(client as never, owner, "/oggi")).toBe("/oggi");
  });

  it("the way on keeps a path with a query intact, encoded once", async () => {
    make({ mfa_status: status({ hasVerifiedFactor: true, gate: "challenge" }) });
    expect(await afterFirstFactor(client as never, owner, "/password?dopo=%2Foggi")).toBe(
      "/login/codice?next=%2Fpassword%3Fdopo%3D%252Foggi",
    );
  });

  it("an unsafe target never reaches the next parameter: it becomes /", async () => {
    make({ mfa_status: status({ hasVerifiedFactor: true, gate: "challenge" }) });
    for (const target of ["https://evil.example", "//evil.example", "javascript:alert(1)"]) {
      expect(await afterFirstFactor(client as never, owner, target)).toBe("/login/codice?next=%2F");
    }
  });

  it("an RPC error or an unknown answer falls back to the target and is reported by code only", async () => {
    make({
      mfa_status: [{ data: null, error: { code: "XX000", message: "detail owner@example.test" } }],
    });
    expect(await afterFirstFactor(client as never, owner, "/oggi")).toBe("/oggi");
    expect(report.reportError).toHaveBeenCalledTimes(1);
    const text = String((report.reportError.mock.calls[0]?.[0] as Error).message);
    expect(text).toContain("XX000");
    expect(text).not.toContain("owner@example.test");
    make({ mfa_status: [{ data: { gate: "maybe" }, error: null }] });
    expect(await afterFirstFactor(client as never, owner, "/oggi")).toBe("/oggi");
    expect(report.reportError).toHaveBeenCalledTimes(2);
  });
});

describe("the pure redirects are unchanged", () => {
  it("redirectAfterSignIn and redirectAfterCodeSignIn", () => {
    const claims = { tenant_id: OWNER_CLAIMS.tenant_id, app_role: "owner" };
    expect(redirectAfterSignIn(claims, "/fatture")).toBe("/fatture");
    expect(redirectAfterSignIn(claimsFor("waiter"), undefined)).toBe("/tavoli");
    expect(redirectAfterCodeSignIn(claims, "/fatture")).toBe("/password?dopo=%2Ffatture");
  });
});
