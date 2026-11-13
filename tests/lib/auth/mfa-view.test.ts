import { describe, expect, it } from "vitest";
import { groupSecret, lockMinutes, mfaErrorMessage } from "@/lib/auth/mfa-view";

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
