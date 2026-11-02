// Keeps the constants of the M25c TypeScript (src/server/services) in step with the SQL of the migrations 20261120100000_service_core.sql and
// 20261120100300_service_settings.sql (plan step 8).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_SERVICES_BODY_BYTES,
  SERVICE_KEY,
  SERVICE_MAX_PERIODS,
  SERVICE_NAME_MAX,
  SERVICE_PERIOD_REASONS,
  SERVICE_START,
} from "@/server/services/constants";

const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const core = read("20261120100000_service_core.sql");
const settings = read("20261120100300_service_settings.sql");
const found = (name: string, text: string, pattern: RegExp) => {
  const match = pattern.exec(text);
  if (!match) throw new Error(`${name}: not found in the migration`);
  return match;
};

describe("limits match the migrations", () => {
  it("SERVICE_MAX_PERIODS is app.service_max_periods()", () => {
    const m = found(
      "max periods",
      core,
      /service_max_periods\(\) returns integer[\s\S]*?select (\d+)/,
    );
    expect(Number(m[1])).toBe(SERVICE_MAX_PERIODS);
    expect(SERVICE_MAX_PERIODS).toBe(6);
  });

  it("SERVICE_KEY is the key pattern of the validator and of the override check", () => {
    const m = found("key", core, /\(x ->> 'key'\) !~ '([^']+)'/);
    expect(new RegExp(m[1]!).source).toBe(SERVICE_KEY.source);
    const check = found(
      "override key check",
      core,
      /service_key text check \(service_key ~ '([^']+)'\)/,
    );
    expect(new RegExp(check[1]!).source).toBe(SERVICE_KEY.source);
    const writer = found("writer key", settings, /\(e ->> 'key'\) !~ '([^']+)'/);
    expect(new RegExp(writer[1]!).source).toBe(SERVICE_KEY.source);
  });

  it("SERVICE_START is the HH:MM pattern of the validator and of the writer", () => {
    const m = found("start", core, /\(x ->> 'startsAt'\) !~ '([^']+)'/);
    expect(new RegExp(m[1]!).source).toBe(SERVICE_START.source);
    const writer = found("writer start", settings, /\(e ->> 'startsAt'\) !~ '([^']+)'/);
    expect(new RegExp(writer[1]!).source).toBe(SERVICE_START.source);
  });

  it("SERVICE_NAME_MAX is the name length of the validator and of the writer", () => {
    const m = found("name length", core, /char_length\(x ->> 'name'\) not between 1 and (\d+)/);
    expect(Number(m[1])).toBe(SERVICE_NAME_MAX);
    const writer = found(
      "writer name length",
      settings,
      /char_length\(e ->> 'name'\) not between 1 and (\d+)/,
    );
    expect(Number(writer[1])).toBe(SERVICE_NAME_MAX);
  });

  it("the reasons of service_periods_invalid are exactly the ones the writer raises", () => {
    const reasons = [...settings.matchAll(/"reason": "(\w+)"/g)].map((x) => x[1]);
    expect([...new Set(reasons)].sort()).toEqual([...SERVICE_PERIOD_REASONS].sort());
    expect(SERVICE_PERIOD_REASONS).toHaveLength(8);
  });

  it("the body cap leaves room for six periods", () => {
    const longest = JSON.stringify({
      periods: Array.from({ length: SERVICE_MAX_PERIODS }, () => ({
        key: "a".repeat(32),
        name: "n".repeat(SERVICE_NAME_MAX),
        startsAt: "11:00",
      })),
    });
    expect(longest.length).toBeLessThan(MAX_SERVICES_BODY_BYTES);
  });
});
