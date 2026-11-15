import { describe, expect, it } from "vitest";
import {
  accountGate,
  accountVerifiedFactors,
  usesAccountFallback,
  type AccountFactor,
  type AccountMfaStatus,
} from "@/lib/console/account-mfa";

const factor = (
  id: string,
  slot: AccountFactor["slot"],
  status: AccountFactor["status"],
): AccountFactor => ({
  id,
  slot,
  status,
});
const status = (over: Partial<AccountMfaStatus>): AccountMfaStatus => ({
  factors: [],
  currentLevel: "aal1",
  canAddFactor: true,
  lockedUntil: null,
  ...over,
});

describe("accountGate", () => {
  it("is ok at aal2", () => {
    expect(accountGate(status({ currentLevel: "aal2" }))).toBe("ok");
  });
  it("is enrol with no verified factor", () => {
    expect(accountGate(status({}))).toBe("enrol");
    expect(accountGate(status({ factors: [factor("a", "principale", "unverified")] }))).toBe(
      "enrol",
    );
  });
  it("is challenge with a verified factor at aal1", () => {
    expect(accountGate(status({ factors: [factor("a", "principale", "verified")] }))).toBe(
      "challenge",
    );
  });
});

describe("accountVerifiedFactors", () => {
  it("drops unverified factors and orders principale, riserva, altro", () => {
    const out = accountVerifiedFactors([
      factor("c", "altro", "verified"),
      factor("x", "principale", "unverified"),
      factor("b", "riserva", "verified"),
      factor("a", "principale", "verified"),
    ]);
    expect(out.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });
});

describe("usesAccountFallback", () => {
  const r = (status: number, code: string) => ({ status, error: { code } });
  it("is true for 403 no_tenant and 409 tenant_selection_required", () => {
    expect(usesAccountFallback(r(403, "no_tenant"))).toBe(true);
    expect(usesAccountFallback(r(409, "tenant_selection_required"))).toBe(true);
  });
  it("is false for everything else", () => {
    for (const [s, c] of [
      [403, "forbidden"],
      [403, "mfa_required"],
      [409, "console_selection_required"],
      [401, "unauthenticated"],
      [401, "session_expired"],
      [500, "internal"],
      [409, "no_tenant"],
      [403, "tenant_selection_required"],
    ] as const) {
      expect(usesAccountFallback(r(s, c)), `${s} ${c}`).toBe(false);
    }
  });
});
