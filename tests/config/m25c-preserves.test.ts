import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M25c plan step 1 (docs/plans/2026-11-01-m25c-services.md §3.2, §5; ADR-031): the migrations of M25c (20261120*) replace only
// app.demo_purge_tables and app.dashboard_yesterday, create exactly the two service tables and the five public functions of §3.6, and never
// touch the pinned objects, the audit checks, the alert registry, the cron jobs, or the existing tables' columns. pgTAP 280 to 286 prove the
// behaviour; this is the early check on the SQL text.
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

const REPLACED = ["app.demo_purge_tables", "app.dashboard_yesterday"];
const TABLES = ["service_override", "service_schedule"];
const PUBLIC_FUNCTIONS = [
  "day_services",
  "kpi_services",
  "service_periods",
  "set_service_periods",
  "set_session_service",
];

/** The §3.2 "Not replaced" list. */
const PROTECTED = [
  "public.open_table",
  "public.close_table",
  "app.close_session_at",
  "app.table_session_guard",
  "app.kpi_sales_lines",
  "app.kpi_session_rows",
  "app.kpi_day_row",
  "app.kpi_range_agg",
  "app.kpi_block",
  "app.kpi_report_json",
  "app.kpi_items_json",
  "app.rollup_daily_kpi",
  "app.app_vs_register_json",
  "public.enter_day_close",
  "app.dashboard_summary_at",
  "public.dashboard_summary",
  "app.forecast_json",
  "app.tenant_has_operational_data",
  "app.business_date",
  "app.business_day_cutoff",
  "app.apply_op_dispatch",
];

/** SQL without `-- comments`, so a name in a comment is not a statement. */
export function code(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

export function createOrReplaceNames(sql: string): string[] {
  return [
    ...code(sql).matchAll(/create\s+or\s+replace\s+function\s+([a-z_]+\.[a-z_0-9]+)\s*\(/gi),
  ].map((m) => m[1]!.toLowerCase());
}

export function createdTables(sql: string): string[] {
  return [...code(sql).matchAll(/create\s+table\s+(?:public\.)?([a-z_0-9]+)/gi)].map((m) =>
    m[1]!.toLowerCase(),
  );
}

export function createdPublicFunctions(sql: string): string[] {
  return [
    ...code(sql).matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi),
  ].map((m) => m[1]!.toLowerCase());
}

function m25cMigrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.startsWith("20261120") && f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(new URL(file, MIGRATIONS), "utf8") }));
}

describe("the regexes see what they should (self-test)", () => {
  const sample = `
    -- create or replace function app.in_a_comment() 
    create or replace function app.demo_purge_tables() returns text[] as $$ $$;
    create function public.service_periods() returns jsonb as $$ $$;
    create table public.service_schedule (x int);
    create table service_override (x int);
  `;
  it("reads replaced functions, tables and public functions, and skips comments", () => {
    expect(createOrReplaceNames(sample)).toEqual(["app.demo_purge_tables"]);
    expect(createdTables(sample)).toEqual(["service_schedule", "service_override"]);
    expect(createdPublicFunctions(sample)).toEqual(["service_periods"]);
  });
});

describe("M25c migrations", () => {
  const files = m25cMigrations();
  const all = files.map((f) => f.sql).join("\n");

  it("finds the M25c migrations, all named 20261120*", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]!.file).toBe("20261120100000_service_core.sql");
  });

  it("replaces only functions the plan names", () => {
    const found = files.flatMap((f) => createOrReplaceNames(f.sql));
    expect(found.filter((n) => !REPLACED.includes(n))).toEqual([]);
    expect(found).toContain("app.demo_purge_tables");
  });

  it("creates only the two service tables", () => {
    const found = files.flatMap((f) => createdTables(f.sql));
    expect(found.filter((n) => !TABLES.includes(n))).toEqual([]);
    expect(found.sort()).toEqual([...TABLES]);
  });

  it("creates only the public functions of plan section 3.6", () => {
    const found = files.flatMap((f) => createdPublicFunctions(f.sql));
    expect(found.filter((n) => !PUBLIC_FUNCTIONS.includes(n))).toEqual([]);
  });

  for (const name of PROTECTED) {
    it(`never re-creates ${name}`, () => {
      const pattern = new RegExp(
        `create\\s+(or\\s+replace\\s+)?function\\s+${name.replace(".", "\\.")}\\s*\\(`,
        "i",
      );
      expect(files.filter((f) => pattern.test(code(f.sql))).map((f) => f.file)).toEqual([]);
    });
  }

  it("alters no existing table and updates no row", () => {
    const c = code(all);
    expect(c).not.toMatch(/alter\s+table\s+public\.table_session/i);
    expect(c).not.toMatch(/alter\s+table\s+public\.day_close/i);
    expect(c).not.toMatch(/alter\s+table\s+public\.daily_kpi/i);
    expect(c).not.toMatch(/\bupdate\s+public\./i);
  });

  it("does not touch the audit checks, the alert registry, the job checks or the cron jobs", () => {
    const c = code(all);
    expect(c).not.toMatch(/audit_event_(entity_type|action)_check/i);
    expect(c).not.toMatch(/insert\s+into\s+app\.alert_kind/i);
    expect(c).not.toMatch(/cron\.schedule/i);
    expect(c).not.toMatch(/job_run_job_check/i);
  });

  it("gives every function an empty search_path, and every function but the constant purge list a definer", () => {
    for (const { file, sql } of files) {
      const c = code(sql);
      const functions = (c.match(/create\s+(or\s+replace\s+)?function\s/gi) ?? []).length;
      // app.demo_purge_tables is a constant list (immutable sql, not a definer) in M22, M23 and here.
      const constants = (c.match(/function\s+app\.demo_purge_tables\s*\(/gi) ?? []).length;
      expect(c.match(/set\s+search_path\s*=\s*''/gi) ?? [], file).toHaveLength(functions);
      expect(c.match(/security\s+definer/gi) ?? [], file).toHaveLength(functions - constants);
    }
  });
});
