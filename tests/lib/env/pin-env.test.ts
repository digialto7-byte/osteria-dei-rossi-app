import { describe, expect, it } from "vitest";
import { ConfigError, MIN_PIN_PEPPER_CHARS, readPinEnv } from "@/lib/env";

const PEPPER = "test-pepper-not-a-secret-0123456789abcdef";

describe("readPinEnv", () => {
  it("returns the pepper", () => {
    expect(readPinEnv({ PIN_PEPPER: PEPPER })).toEqual({ pinPepper: PEPPER });
  });

  it("requires at least 32 characters", () => {
    expect(MIN_PIN_PEPPER_CHARS).toBe(32);
    expect(readPinEnv({ PIN_PEPPER: "x".repeat(32) }).pinPepper).toHaveLength(32);
    expect(() => readPinEnv({ PIN_PEPPER: "x".repeat(31) })).toThrow(ConfigError);
  });

  it("a missing or empty pepper names the variable and never the value", () => {
    for (const source of [{}, { PIN_PEPPER: "" }, { PIN_PEPPER: "short-secret-value" }]) {
      try {
        readPinEnv(source);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as ConfigError).variables).toEqual(["PIN_PEPPER"]);
        expect((error as ConfigError).message).not.toContain("short-secret-value");
      }
    }
  });

  it("is not part of the server schema, so routes without staff login boot without it", async () => {
    const { readServerEnv } = await import("@/lib/env");
    expect(() =>
      readServerEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-key",
      }),
    ).not.toThrow();
  });
});
