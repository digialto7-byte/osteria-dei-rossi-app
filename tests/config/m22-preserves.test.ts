import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M22 plan step 9 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.2 "Not replaced"): the migrations of M22 (20261112*) must not
// re-create objects earlier milestones own. pgTAP 240 pins their definitions; this is the cheaper early check on the SQL text.
// M22 replaces exactly five functions on purpose, each with `create or replace`: app.plates_sold (the M8 stub), app.tenant_has_operational_data,
// app.job_health_checks, app.demo_purge_tables and public.dashboard_summary.
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

const PROTECTED = [
  "public.close_table",
  "app.close_session_at",
  "app.session_bill_json",
  "app.app_vs_register_json",
  "public.fire_course",
  "public.void_line",
  "app.freeze_line_cost",
  "app.plate_cost_rows",
  "app.fixed_cost_at",
  "public.waste_costs",
  "public.count_variance",
  "public.count_variance_costs",
  "public.stock_reconciliation",
  "app.batch_requirements",
  "app.business_date",
  "app.next_cutoff",
  "app.local_instant",
  "app.ledger_checks_body",
  "public.today_counts",
];

const REPLACED = [
  "app.plates_sold",
  "app.tenant_has_operational_data",
  "app.job_health_checks",
  "app.demo_purge_tables",
  "public.dashboard_summary",
];

function m22Migrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.startsWith("20261112") && f.endsWith(".sql"))
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

describe("M22 migrations leave the earlier milestones' objects alone", () => {
  const files = m22Migrations();

  it("finds the M22 migrations", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
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

  it("replaces only the five functions the plan names, with create or replace", () => {
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

  it("does not touch the audit checks or the alert registry", () => {
    for (const { file, sql } of files) {
      const c = code(sql);
      expect(c, file).not.toMatch(/audit_event_(entity_type|action)_check/i);
      expect(c, file).not.toMatch(/insert\s+into\s+app\.alert_kind/i);
    }
  });

  it("the pattern would catch a re-creation (self-test)", () => {
    const sample = "create or replace function public.close_table(p uuid) returns jsonb as $$ $$;";
    const pattern = /create\s+(or\s+replace\s+)?function\s+public\.close_table\s*\(/i;
    expect(pattern.test(code(sample))).toBe(true);
    expect(pattern.test(code("-- create function public.close_table("))).toBe(false);
  });
});
