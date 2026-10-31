// Keeps the constants of the M22 TypeScript (src/server/reports) in step with the SQL of the migrations 20261112100100 (rollup), 20261112100200
// (report) and 20261112100400 (AVT). The SQL stays the authority.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AVT_AVAILABLE_COUNTS,
  DELTA_KEYS,
  KPI_FINALISE_GRACE_MIN,
  MAX_RANGE_DAYS,
  PERIODS,
} from "@/server/reports/constants";

const read = (name: string) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const rollup = read("20261112100100_kpi_rollup.sql");
const report = read("20261112100200_kpi_report.sql");
const avt = read("20261112100400_avt_report.sql");
const found = (name: string, text: string, pattern: RegExp) => {
  const match = pattern.exec(text);
  if (!match) throw new Error(`${name}: not found in the migration`);
  return match;
};
const words = (list: string) => [...list.matchAll(/'(\w+)'/g)].map((x) => x[1]);

describe("report constants match the migrations", () => {
  it("PERIODS are the periods app.kpi_period accepts, in order", () => {
    const m = found("periods", report, /p_period <> all \(array\[([^\]]*)\]\)/);
    expect(words(m[1]!)).toEqual([...PERIODS]);
  });

  it("MAX_RANGE_DAYS is the 366-day cap of a custom range", () => {
    const m = found("cap", report, /p_to - p_from \+ 1 > (\d+)/);
    expect(Number(m[1])).toBe(MAX_RANGE_DAYS);
  });

  it("KPI_FINALISE_GRACE_MIN is app.kpi_finalise_grace()", () => {
    const m = found(
      "grace",
      rollup,
      /kpi_finalise_grace\(\) returns interval[\s\S]*?interval '(\d+) minutes'/,
    );
    expect(Number(m[1])).toBe(KPI_FINALISE_GRACE_MIN);
  });

  it("AVT_AVAILABLE_COUNTS is app.avt_available_counts()", () => {
    const m = found("counts", avt, /avt_available_counts\(\) returns integer[\s\S]*?select (\d+)/);
    expect(Number(m[1])).toBe(AVT_AVAILABLE_COUNTS);
  });

  it("DELTA_KEYS are the keys kpi_report_json computes, in order", () => {
    const block = found(
      "delta",
      report,
      /from \(values (\('covers'[\s\S]*?\{appVsRegister,appTotalEur\}'\))\) k \(key, path\)/,
    );
    const keys = [...block[1]!.matchAll(/\('(\w+)',/g)].map((x) => x[1]);
    expect(keys).toEqual([...DELTA_KEYS]);
  });
});
