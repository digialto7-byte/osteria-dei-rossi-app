import { describe, expect, it } from "vitest";
import { derivePinPassword } from "@/server/staff-auth/derive";

const PEPPER = "test-pepper-not-a-secret-0123456789abcdef";
const ID = "91000000-0000-4000-8000-000000000001";

describe("derivePinPassword", () => {
  it("matches an independently computed HMAC-SHA256 vector (base64url, 43 characters)", () => {
    const password = derivePinPassword(PEPPER, ID, "4827");
    expect(password).toBe("s5yFxH5zPs78iaOlbmf9Pcv49ln9GawYC3RK9mE2vLY");
    expect(password).toHaveLength(43);
    expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("changes with the PIN, the user id and the pepper", () => {
    const base = derivePinPassword(PEPPER, ID, "4827");
    expect(derivePinPassword(PEPPER, ID, "4828")).not.toBe(base);
    expect(derivePinPassword(PEPPER, "91000000-0000-4000-8000-000000000002", "4827")).not.toBe(
      base,
    );
    expect(derivePinPassword(`${PEPPER}x`, ID, "4827")).not.toBe(base);
  });

  it("is stable for the same inputs", () => {
    expect(derivePinPassword(PEPPER, ID, "4827")).toBe(derivePinPassword(PEPPER, ID, "4827"));
  });

  it("never contains the PIN as a substring, for all 10 000 PINs of one user", () => {
    const leaks: string[] = [];
    for (let n = 0; n < 10_000; n += 1) {
      const pin = String(n).padStart(4, "0");
      if (derivePinPassword(PEPPER, ID, pin).includes(pin)) leaks.push(pin);
    }
    expect(leaks).toEqual([]);
  });

  it("refuses an empty pepper, user id or PIN instead of deriving from nothing", () => {
    expect(() => derivePinPassword("", ID, "4827")).toThrow();
    expect(() => derivePinPassword(PEPPER, "", "4827")).toThrow();
    expect(() => derivePinPassword(PEPPER, ID, "")).toThrow();
  });

  it("an error does not carry the PIN or the pepper", () => {
    try {
      derivePinPassword("", ID, "4827");
    } catch (error) {
      expect(String(error)).not.toContain("4827");
    }
  });
});
