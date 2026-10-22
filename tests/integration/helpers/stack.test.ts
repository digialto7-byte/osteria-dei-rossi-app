import { describe, expect, it } from "vitest";
import { readStackEnv } from "./stack";

const FULL = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  SUPABASE_SECRET_KEY: "test-secret-key",
};

describe("readStackEnv", () => {
  it("returns the three settings when all are set", () => {
    expect(readStackEnv(FULL)).toEqual({
      url: "http://127.0.0.1:54321",
      publishableKey: "test-publishable-key",
      secretKey: "test-secret-key",
    });
  });

  it("returns null locally when the stack settings are missing (the suite skips)", () => {
    expect(readStackEnv({})).toBeNull();
    expect(readStackEnv({ ...FULL, SUPABASE_SECRET_KEY: "" })).toBeNull();
  });

  it("throws in CI when any setting is missing, naming it", () => {
    expect(() => readStackEnv({ CI: "true" })).toThrow(/SUPABASE_SECRET_KEY/);
    expect(() => readStackEnv({ ...FULL, CI: "true", NEXT_PUBLIC_SUPABASE_URL: "" })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it("does not throw in CI when everything is set", () => {
    expect(readStackEnv({ ...FULL, CI: "true" })).not.toBeNull();
  });
});
