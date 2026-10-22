import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  MIN_CRON_SECRET_CHARS,
  readCronEnv,
  readExtractionEnv,
  readPublicEnv,
  readServerEnv,
} from "@/lib/env";
import * as extractionConstants from "@/server/extraction/constants";

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

const EXTRACTION = { ANTHROPIC_API_KEY: "test-key", EXTRACTION_MODEL_ID: "test-model-1" };

describe("extraction env", () => {
  it("accepts a complete extraction environment", () => {
    expect(readExtractionEnv(EXTRACTION)).toEqual({
      anthropicApiKey: "test-key",
      modelId: "test-model-1",
    });
  });

  it("a missing EXTRACTION_MODEL_ID is a ConfigError naming it (AT5)", () => {
    const { EXTRACTION_MODEL_ID: _omitted, ...missing } = EXTRACTION;
    expect(() => readExtractionEnv(missing)).toThrow(ConfigError);
    expect(() => readExtractionEnv(missing)).toThrow(/EXTRACTION_MODEL_ID/);
  });

  it("an empty key or model ID counts as missing", () => {
    expect(() => readExtractionEnv({ ...EXTRACTION, ANTHROPIC_API_KEY: "" })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(() => readExtractionEnv({ ...EXTRACTION, EXTRACTION_MODEL_ID: "" })).toThrow(
      /EXTRACTION_MODEL_ID/,
    );
  });

  it.each(["has space", " leading", "-dash-first", "x".repeat(101), "bad\nline", "a;b"])(
    "rejects the model ID %j",
    (modelId) => {
      expect(() => readExtractionEnv({ ...EXTRACTION, EXTRACTION_MODEL_ID: modelId })).toThrow(
        /EXTRACTION_MODEL_ID/,
      );
    },
  );

  it.each(["m", "model-1.5:beta", "vendor/model@2026", "x".repeat(100)])(
    "accepts the model ID %j",
    (modelId) => {
      expect(readExtractionEnv({ ...EXTRACTION, EXTRACTION_MODEL_ID: modelId }).modelId).toBe(
        modelId,
      );
    },
  );

  it("the server env does not need the extraction or cron variables", () => {
    expect(() => readServerEnv(VALID)).not.toThrow();
  });

  it("never echoes a value in the error", () => {
    const secret = "sk-should-not-leak with space";
    for (const read of [
      () => readExtractionEnv({ ...EXTRACTION, EXTRACTION_MODEL_ID: secret }),
      () => readCronEnv({ CRON_SECRET: "short-should-not-leak" }),
    ]) {
      expect(read).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining("leak") }),
      );
    }
  });
});

describe("cron env", () => {
  it("accepts a secret of the minimum length", () => {
    const cronSecret = "c".repeat(MIN_CRON_SECRET_CHARS);
    expect(readCronEnv({ CRON_SECRET: cronSecret })).toEqual({ cronSecret });
  });

  it("rejects a secret one character short, an empty one and a missing one", () => {
    const short = "c".repeat(MIN_CRON_SECRET_CHARS - 1);
    expect(() => readCronEnv({ CRON_SECRET: short })).toThrow(ConfigError);
    expect(() => readCronEnv({ CRON_SECRET: short })).toThrow(/CRON_SECRET/);
    expect(() => readCronEnv({ CRON_SECRET: "" })).toThrow(/CRON_SECRET/);
    expect(() => readCronEnv({})).toThrow(/CRON_SECRET/);
  });

  it("the minimum length is 32", () => {
    expect(MIN_CRON_SECRET_CHARS).toBe(32);
  });

  it("the extraction constants re-export the same value", () => {
    expect(extractionConstants.MIN_CRON_SECRET_CHARS).toBe(MIN_CRON_SECRET_CHARS);
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
      "ANTHROPIC_API_KEY",
      "EXTRACTION_MODEL_ID",
      "CRON_SECRET",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("lists the extraction variables with the placeholder", () => {
    for (const name of ["ANTHROPIC_API_KEY", "EXTRACTION_MODEL_ID", "CRON_SECRET"]) {
      expect(lines).toContain(`${name}=replace-me`);
    }
  });

  it("holds only placeholder values", () => {
    for (const line of lines) {
      const value = line.slice(line.indexOf("=") + 1);
      expect(value === "replace-me" || /^http:\/\/127\.0\.0\.1:\d+$/.test(value), line).toBe(true);
    }
  });
});
