// Keeps DRIFT_JOB_KEYS (src/server/alerts/templates.ts) in step with the scheduled jobs the migrations define. A nightly ledger_drift alert names
// a job by its key; a key missing from the list fails the payload schema and the whole alert renders as the generic fallback ("Avviso").
// That happened for kpi-rollup, reservation-mail, reservation-retention and mfa-failure-retention (found by the P2-4 plan, 2026-11-18).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DRIFT_JOB_KEYS } from "@/server/alerts/templates";

const dir = new URL("../../supabase/migrations/", import.meta.url);
const migrations = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => ({ file: f, sql: readFileSync(new URL(f, dir), "utf8") }));

// A job name: lower-case letters, digits, "-" and "_" (wider than today's names, so a future "kpi-rollup-v2" or "foo_bar" is still seen).
const NAME = "[a-z0-9][a-z0-9_-]*";
const quoted = (list: string) =>
  [...list.matchAll(new RegExp(`'(${NAME})'`, "g"))].map((x) => x[1]!);

/**
 * Every job name a migration can make a job-health check report: cron.schedule names, the job_run job list (named constraint or the
 * first inline check), the job_unscheduled list and the job_stale literals.
 */
function jobNames(sql: string): string[] {
  const names: string[] = [];
  for (const m of sql.matchAll(new RegExp(`cron\\.schedule\\(\\s*'(${NAME})'`, "g")))
    names.push(m[1]!);
  for (const m of sql.matchAll(/job_run_job_check\s+check\s*\(\s*job\s+in\s*\(([^)]*)\)/g)) {
    names.push(...quoted(m[1]!));
  }
  for (const m of sql.matchAll(
    /\bjob\s+text\s+not\s+null\s+check\s*\(\s*job\s+in\s*\(([^)]*)\)/g,
  )) {
    names.push(...quoted(m[1]!));
  }
  for (const m of sql.matchAll(
    new RegExp(`'job_stale'::text,\\s*\\d+,\\s*'\\{\\}'::uuid\\[\\],\\s*'(${NAME})'::text`, "g"),
  )) {
    names.push(m[1]!);
  }
  for (const m of sql.matchAll(/'job_unscheduled'[\s\S]*?unnest\(array\[([^\]]*)\]\)/g)) {
    names.push(...quoted(m[1]!));
  }
  return names;
}

describe("DRIFT_JOB_KEYS match the scheduled jobs of the migrations", () => {
  it("the scanner finds a job in each of the three places, also when cron.schedule spans lines", () => {
    expect(jobNames("select cron.schedule(\n  'x-job',\n  '* * * * *', $j$select 1$j$);")).toEqual([
      "x-job",
    ]);
    expect(jobNames("add constraint job_run_job_check check (job in ('a-job', 'b-job'));")).toEqual(
      ["a-job", "b-job"],
    );
    expect(
      jobNames(
        "select 'job_unscheduled'::text, 1, '{}'::uuid[], j.name from unnest(array['c-job', 'd-job']) j (name)",
      ),
    ).toEqual(["c-job", "d-job"]);
    expect(jobNames("job text not null check (job in ('e-job', 'f_job2')),")).toEqual([
      "e-job",
      "f_job2",
    ]);
    expect(
      jobNames("return query select 'job_stale'::text, 1, '{}'::uuid[], 'g-job-v2'::text;"),
    ).toEqual(["g-job-v2"]);
  });

  it("the migrations name jobs at all (the scan is not silently empty)", () => {
    const all = new Set(migrations.flatMap((m) => jobNames(m.sql)));
    expect(all.has("alert-rules")).toBe(true);
    expect(all.has("kpi-rollup")).toBe(true);
  });

  it("the newest job_run_job_check definition is read, so a changed shape cannot slip past", () => {
    const newest = migrations.filter((m) => /job_run_job_check/.test(m.sql)).at(-1)!;
    const listed = [
      ...newest.sql.matchAll(/job_run_job_check\s+check\s*\(\s*job\s+in\s*\(([^)]*)\)/g),
    ].flatMap((m) => quoted(m[1]!));
    expect(listed.length, newest.file).toBeGreaterThan(0);
  });

  it("every job a migration names is in DRIFT_JOB_KEYS", () => {
    const keys = new Set<string>(DRIFT_JOB_KEYS);
    const missing = migrations.flatMap((m) =>
      jobNames(m.sql)
        .filter((name) => !keys.has(name))
        .map((name) => `${m.file}: ${name}`),
    );
    expect(missing).toEqual([]);
  });
});
