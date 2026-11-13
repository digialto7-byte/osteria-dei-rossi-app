import { describe, expect, it } from "vitest";
import {
  factorRows,
  factorToUse,
  groupSecret,
  lockedMinutes,
  lockMinutes,
  mfaErrorMessage,
  verifiedFactors,
} from "@/lib/auth/mfa-view";

// P2-1 B2: presentation helpers for the second-factor screens. They format only: no API call, no decision about who may do what.

describe("groupSecret", () => {
  it("shows the key in groups of four", () => {
    expect(groupSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });

  it("keeps a short last group and ignores spaces already in the key", () => {
    expect(groupSecret("JBSWY3DPEH")).toBe("JBSW Y3DP EH");
    expect(groupSecret(" jbsw y3dp ")).toBe("JBSW Y3DP");
  });

  it("an empty key is an empty string", () => {
    expect(groupSecret("")).toBe("");
  });
});

describe("lockMinutes", () => {
  it("rounds the seconds up to whole minutes, at least one", () => {
    expect(lockMinutes(720)).toBe(12);
    expect(lockMinutes(721)).toBe(13);
    expect(lockMinutes(60)).toBe(1);
    expect(lockMinutes(1)).toBe(1);
    expect(lockMinutes(0)).toBe(1);
    expect(lockMinutes(-5)).toBe(1);
  });
});

describe("mfaErrorMessage", () => {
  it("a wrong code is the Italian sentence about the phone clock", () => {
    expect(mfaErrorMessage({ code: "mfa_code_invalid", message: "x" })).toBe(
      "Codice non valido. Controlla che l'ora del telefono sia giusta e riprova.",
    );
  });

  it("an expired challenge", () => {
    expect(mfaErrorMessage({ code: "mfa_challenge_expired", message: "x" })).toBe(
      "Il codice è scaduto. Riprova.",
    );
  });

  it("a lock names the minutes from retryAfterSeconds, singular and plural", () => {
    const locked = (retryAfterSeconds: number) =>
      mfaErrorMessage({ code: "mfa_locked", message: "x", details: { retryAfterSeconds } });
    expect(locked(720)).toBe("Troppi tentativi. Riprova tra 12 minuti.");
    expect(locked(30)).toBe("Troppi tentativi. Riprova tra 1 minuto.");
  });

  it("a lock without a usable number falls back to the server's message", () => {
    expect(mfaErrorMessage({ code: "mfa_locked", message: "Server text" })).toBe("Server text");
    expect(
      mfaErrorMessage({
        code: "mfa_locked",
        message: "Server text",
        details: { retryAfterSeconds: "x" },
      }),
    ).toBe("Server text");
  });

  it("any other code shows the server's message", () => {
    expect(mfaErrorMessage({ code: "rate_limited", message: "Riprova tra poco." })).toBe(
      "Riprova tra poco.",
    );
    expect(mfaErrorMessage({ code: "mfa_last_factor", message: "Ultimo." })).toBe("Ultimo.");
  });
});

// P2-1 B3: choosing the factor for the sign-in code and reading the lock.

const factor = (
  id: string,
  slot: "principale" | "riserva" | "altro",
  status: "verified" | "unverified",
) => ({
  id,
  slot,
  status,
  createdAt: "2026-11-12T10:00:00.000Z",
});

describe("verifiedFactors", () => {
  it("keeps verified factors only, main device first", () => {
    const list = [
      factor("r", "riserva", "verified"),
      factor("u", "principale", "unverified"),
      factor("p", "principale", "verified"),
      factor("x", "altro", "verified"),
    ];
    expect(verifiedFactors(list).map((f) => f.id)).toEqual(["p", "r", "x"]);
  });

  it("an empty list stays empty", () => {
    expect(verifiedFactors([])).toEqual([]);
  });
});

describe("factorToUse", () => {
  const both = verifiedFactors([
    factor("p", "principale", "verified"),
    factor("r", "riserva", "verified"),
  ]);

  it("the first one, or the second when the backup is chosen", () => {
    expect(factorToUse(both, false)?.id).toBe("p");
    expect(factorToUse(both, true)?.id).toBe("r");
  });

  it("with one factor the backup choice changes nothing; with none there is nothing", () => {
    expect(factorToUse(both.slice(0, 1), true)?.id).toBe("p");
    expect(factorToUse([], false)).toBeUndefined();
  });
});

describe("lockedMinutes", () => {
  const now = new Date("2026-11-12T10:00:00.000Z");

  it("rounds the time left up to whole minutes", () => {
    expect(lockedMinutes("2026-11-12T10:12:00.000Z", now)).toBe(12);
    expect(lockedMinutes("2026-11-12T10:12:01.000Z", now)).toBe(13);
    expect(lockedMinutes("2026-11-12T10:00:10.000Z", now)).toBe(1);
  });

  it("null, a lock already over, or one ending right now is not a lock", () => {
    expect(lockedMinutes(null, now)).toBeNull();
    expect(lockedMinutes("2026-11-12T09:59:00.000Z", now)).toBeNull();
    expect(lockedMinutes("2026-11-12T10:00:00.000Z", now)).toBeNull();
  });
});

// P2-1 B5: the rows of the /doppia-verifica list, built from GET /api/me/mfa.

const row = (
  slot: "principale" | "riserva" | "altro",
  status: "verified" | "unverified",
  createdAt = "2026-11-12T10:00:00.000Z",
) => ({
  id: `id-${slot}-${status}`,
  slot,
  status,
  createdAt,
});
const listStatus = (factors: ReturnType<typeof row>[], canAddFactor = true) => ({
  role: "owner" as const,
  mode: "enrolled" as const,
  gate: "ok" as const,
  currentLevel: "aal2" as const,
  factors,
  canAddFactor,
  lockedUntil: null,
});

describe("factorRows", () => {
  it("names both slots even when none is set", () => {
    expect(factorRows(listStatus([])).map((r) => [r.slot, r.state])).toEqual([
      ["principale", "missing"],
      ["riserva", "missing"],
    ]);
  });

  it("a verified slot shows its date and can be removed; missing can be added when canAddFactor", () => {
    const rows = factorRows(
      listStatus([row("principale", "verified", "2026-11-12T09:00:00.000Z")]),
    );
    expect(rows[0]).toMatchObject({ slot: "principale", state: "verified", canRemove: true });
    expect(rows[0]!.factorId).toBe("id-principale-verified");
    expect(rows[1]).toMatchObject({ slot: "riserva", state: "missing", canAdd: true });
  });

  it("canAddFactor false hides Aggiungi on every missing slot", () => {
    const rows = factorRows(listStatus([], false));
    expect(rows.every((r) => r.canAdd === false)).toBe(true);
  });

  it("a slot with only an unverified factor is 'incomplete' and removable, never addable", () => {
    const rows = factorRows(listStatus([row("riserva", "unverified")]));
    expect(rows[1]).toMatchObject({
      slot: "riserva",
      state: "incomplete",
      canRemove: true,
      canAdd: false,
    });
    expect(rows[1]!.factorId).toBe("id-riserva-unverified");
  });

  it("prefers the verified factor of a slot when both exist", () => {
    const rows = factorRows(
      listStatus([row("principale", "unverified"), row("principale", "verified")]),
    );
    expect(rows[0]).toMatchObject({ state: "verified", factorId: "id-principale-verified" });
  });

  it("an 'altro' factor (named outside the app) is listed last, removable", () => {
    const rows = factorRows(listStatus([row("altro", "verified")]));
    expect(rows.map((r) => r.slot)).toEqual(["principale", "riserva", "altro"]);
    expect(rows[2]).toMatchObject({
      slot: "altro",
      state: "verified",
      canAdd: false,
      canRemove: true,
    });
  });
});
