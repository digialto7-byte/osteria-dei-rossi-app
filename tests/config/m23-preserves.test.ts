import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M23 plan step 8 (docs/plans/2026-10-31-m23-push-forecast.md §3.2 "Not replaced"): the migrations of M23 (20261114*) must not re-create
// objects earlier milestones own. pgTAP 255 pins their definitions; this is the cheaper early check on the SQL text.
// M23 replaces exactly two functions on purpose, each with `create or replace`: app.demo_purge_tables (the list gains menu_push) and
// app.dashboard_summary_at (the M22 body plus pushList).
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

const PROTECTED = [
  "public.menu_list",
  "public.add_order_line",
  "public.update_menu_item",
  "app.menu_item_availability",
  "app.plate_batch_needs",
  "app.plate_raw_needs",
  "app.live_batch_remaining",
  "public.discard_batch",
  "public.waste_costs",
  "app.expiry_rule",
  "app.kpi_sales_lines",
  "app.kpi_session_rows",
  "app.kpi_cutoff_end",
  "app.rollup_daily_kpi",
  "public.fire_course",
  "public.void_line",
  "public.dashboard_summary",
];

const REPLACED = ["app.dashboard_summary_at", "app.demo_purge_tables"];

function m23Migrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.startsWith("20261114") && f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(new URL(file, MIGRATIONS), "utf8") }));
}

/** SQL without `-- comments`, so a protected name in a comment is not a re-creation. */
function code(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

describe("M23 migrations leave the earlier milestones' objects alone", () => {
  const files = m23Migrations();

  it("finds the M23 migrations", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  for (const name of PROTECTED) {
    it(`never re-creates ${name}`, () => {
      const pattern = new RegExp(
        `create\\s+(or\\s+replace\\s+)?function\\s+${name.replace(".", "\\.")}\\s*\\(`,
        "i",
      );
      const hits = files.filter((f) => pattern.test(code(f.sql))).map((f) => f.file);
      expect(hits).toEqual([]);
    });
  }

  it("replaces only the two functions the plan names, with create or replace", () => {
    const found = new Set<string>();
    for (const { sql } of files) {
      for (const m of code(sql).matchAll(
        /create\s+or\s+replace\s+function\s+([a-z_]+\.[a-z_]+)\s*\(/gi,
      )) {
        found.add(m[1]!.toLowerCase());
      }
    }
    expect([...found].sort()).toEqual([...REPLACED].sort());
  });

  it("does not touch the audit checks, the alert registry or the cron jobs", () => {
    for (const { file, sql } of files) {
      const c = code(sql);
      expect(c, file).not.toMatch(/audit_event_(entity_type|action)_check/i);
      expect(c, file).not.toMatch(/insert\s+into\s+app\.alert_kind/i);
      expect(c, file).not.toMatch(/cron\.schedule/i);
      expect(c, file).not.toMatch(/job_run_job_check/i);
    }
  });

  it("the pattern would catch a re-creation (self-test)", () => {
    const sample = "create or replace function public.menu_list() returns jsonb as $$ $$;";
    const pattern = /create\s+(or\s+replace\s+)?function\s+public\.menu_list\s*\(/i;
    expect(pattern.test(code(sample))).toBe(true);
    expect(pattern.test(code("-- create function public.menu_list("))).toBe(false);
  });
});
