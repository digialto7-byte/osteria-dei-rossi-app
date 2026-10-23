import { describe, expect, it } from "vitest";
import {
  deviceScreen,
  isCompletePin,
  loginFeedback,
  roleWord,
  sanitizePin,
} from "@/lib/staff-auth/pin-view";

const STAFF = [
  { id: "u1", displayName: "Cameriere Demo", role: "waiter" as const },
  { id: "u2", displayName: "Cuoco Demo", role: "chef" as const },
];
const error = (code: string, details?: Record<string, string | number>[]) => ({
  code,
  message: "server text",
  details,
});

describe("deviceScreen", () => {
  it("not enrolled", () => {
    expect(deviceScreen({ enrolled: false })).toEqual({ kind: "not_enrolled" });
  });
  it("a locked device shows the lock, not the staff", () => {
    expect(deviceScreen({ enrolled: true, label: "Tablet", locked: true, staff: STAFF })).toEqual({
      kind: "locked",
    });
  });
  it("an enrolled device lists its staff", () => {
    expect(
      deviceScreen({ enrolled: true, label: "Telefono sala (demo)", locked: false, staff: STAFF }),
    ).toEqual({ kind: "ready", label: "Telefono sala (demo)", staff: STAFF });
  });
});

describe("roleWord", () => {
  it("words the role in both languages", () => {
    expect(roleWord("chef")).toBe("Cuoco");
    expect(roleWord("waiter")).toBe("Cameriere");
    expect(roleWord("chef", "en")).toBe("Chef");
    expect(roleWord("waiter", "en")).toBe("Waiter");
  });
});

describe("loginFeedback", () => {
  it("pin_invalid with attemptsLeft 2 -> 'PIN errato. Tentativi rimasti: 2.'", () => {
    expect(loginFeedback(error("pin_invalid", [{ attemptsLeft: 2 }]))).toEqual({
      kind: "retry",
      message: "PIN errato. Tentativi rimasti: 2.",
    });
  });
  it("pin_invalid without a count is just 'PIN errato.'", () => {
    expect(loginFeedback(error("pin_invalid")).message).toBe("PIN errato.");
  });
  it("user_locked 2026-10-24T19:15Z -> 'Riprova alle 21:15' (Europe/Rome)", () => {
    expect(loginFeedback(error("user_locked", [{ lockedUntil: "2026-10-24T19:15:00Z" }]))).toEqual({
      kind: "user_locked",
      message: "Troppi tentativi. Riprova alle 21:15.",
    });
  });
  it("the same instant in winter time is one hour earlier in Rome", () => {
    expect(
      loginFeedback(error("user_locked", [{ lockedUntil: "2026-12-10T19:15:00Z" }])).message,
    ).toBe("Troppi tentativi. Riprova alle 20:15.");
  });
  it("user_locked with a missing or bad time falls back to the plain text", () => {
    expect(loginFeedback(error("user_locked")).message).toBe(
      "Troppi tentativi. Riprova più tardi.",
    );
    expect(loginFeedback(error("user_locked", [{ lockedUntil: "soon" }])).message).toBe(
      "Troppi tentativi. Riprova più tardi.",
    );
  });
  it("device_locked", () => {
    expect(loginFeedback(error("device_locked"))).toEqual({
      kind: "locked",
      message: "Dispositivo bloccato per troppi tentativi. Chiedi al titolare di sbloccarlo.",
    });
  });
  it.each(["device_revoked", "device_unknown", "device_missing"])(
    "%s -> the device is no longer enrolled",
    (code) => {
      expect(loginFeedback(error(code))).toEqual({
        kind: "not_enrolled",
        message: "Questo dispositivo non è abilitato.",
      });
    },
  );
  it("attempt_in_progress", () => {
    expect(loginFeedback(error("attempt_in_progress")).message).toBe("Accesso in corso, attendi.");
  });
  it.each(["upstream_error", "auth_rate_limited", "network", "bad_response", "internal"])(
    "%s -> service unavailable",
    (code) => {
      expect(loginFeedback(error(code))).toEqual({
        kind: "retry",
        message: "Servizio non disponibile, riprova tra poco.",
      });
    },
  );
  it("english second", () => {
    expect(loginFeedback(error("pin_invalid", [{ attemptsLeft: 1 }]), "en").message).toBe(
      "Wrong PIN. Attempts left: 1.",
    );
  });
  it("never echoes the server's own message", () => {
    for (const code of ["pin_invalid", "user_locked", "internal", "something_new"]) {
      expect(loginFeedback(error(code)).message).not.toContain("server text");
    }
  });
});

describe("PIN input helpers", () => {
  it("sanitizePin keeps at most four digits", () => {
    expect(sanitizePin("48a2-7x9")).toBe("4827");
    expect(sanitizePin("１２３４")).toBe("");
    expect(sanitizePin("")).toBe("");
  });
  it("isCompletePin is exactly four ASCII digits", () => {
    expect(isCompletePin("4827")).toBe(true);
    for (const bad of ["", "482", "48271", "48a7", "４８２７"])
      expect(isCompletePin(bad)).toBe(false);
  });
});
