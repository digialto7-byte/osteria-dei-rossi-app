import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConfigError, readPublicEnv, readServerEnv } from "@/lib/env";

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fake",
};

describe("env schema", () => {
  it("accepts a complete public environment", () => {
    expect(readPublicEnv(VALID)).toEqual({
      supabaseUrl: VALID.NEXT_PUBLIC_SUPABASE_URL,
      supabasePublishableKey: VALID.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
  });

  it("names the missing variable in a ConfigError", () => {
    const { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: _omitted, ...missing } = VALID;
    expect(() => readPublicEnv(missing)).toThrow(ConfigError);
    expect(() => readPublicEnv(missing)).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("treats an empty value as missing", () => {
    expect(() => readPublicEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "" })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it("rejects a Supabase URL that is not a URL", () => {
    expect(() => readPublicEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "localhost" })).toThrow(
      ConfigError,
    );
  });

  it("server env: Sentry DSN is optional but must be a URL when set", () => {
    expect(readServerEnv(VALID).sentryDsn).toBeUndefined();
    expect(() => readServerEnv({ ...VALID, SENTRY_DSN: "not-a-url" })).toThrow(/SENTRY_DSN/);
    expect(
      readServerEnv({ ...VALID, SENTRY_DSN: "https://k@o1.ingest.sentry.io/1" }).sentryDsn,
    ).toBe("https://k@o1.ingest.sentry.io/1");
  });

  it("server env: the deployment environment is derived from VERCEL_ENV", () => {
    expect(readServerEnv(VALID).deployment).toBe("development");
    expect(readServerEnv({ ...VALID, VERCEL_ENV: "production" }).deployment).toBe("production");
    expect(readServerEnv({ ...VALID, VERCEL_ENV: "preview" }).deployment).toBe("preview");
  });

  it("never echoes a variable's value in the error", () => {
    expect(() =>
      readPublicEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "sb_secret_should_not_leak" }),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining("sb_secret") }));
  });
});

describe(".env.example", () => {
  const lines = readFileSync(new URL("../../.env.example", import.meta.url), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

  it("lists every variable the env schema reads", () => {
    const names = lines.map((line) => line.split("=")[0]);
    for (const name of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "SENTRY_DSN",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("holds only placeholder values", () => {
    for (const line of lines) {
      const value = line.slice(line.indexOf("=") + 1);
      expect(value === "replace-me" || /^http:\/\/127\.0\.0\.1:\d+$/.test(value), line).toBe(true);
    }
  });
});
