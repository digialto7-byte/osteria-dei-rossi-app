import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M24 plan step 1 (docs/plans/2026-10-31-m24-exports.md §3.2): the one M24 migration (20261116*) replaces app.push_menu_item_at and nothing else.
// No public function, table or index is added. pgTAP 264 proves the behaviour; this is the early check on the SQL text.
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

const REPLACED = ["app.push_menu_item_at"];

/** The names M23's guard protects, plus the public function the follow-up must leave alone. */
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
  "public.push_menu_item",
  "app.dashboard_summary_at",
  "app.demo_purge_tables",
];

/** SQL without `-- comments`, so a name in a comment is not a re-creation. */
function code(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

function createOrReplaceNames(sql: string): string[] {
  return [
    ...code(sql).matchAll(/create\s+or\s+replace\s+function\s+([a-z_]+\.[a-z_]+)\s*\(/gi),
  ].map((m) => m[1]!.toLowerCase());
}

function m24Migrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.startsWith("20261116") && f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(new URL(file, MIGRATIONS), "utf8") }));
}

describe("M24 migrations replace only app.push_menu_item_at", () => {
  const files = m24Migrations();

  it("finds the M24 migration", () => {
    expect(files.map((f) => f.file)).toEqual(["20261116100000_push_menu_price_missing.sql"]);
  });

  it("replaces exactly the one function the plan names, with create or replace", () => {
    const found = files.flatMap((f) => createOrReplaceNames(f.sql));
    expect(found.sort()).toEqual([...REPLACED].sort());
  });

  it("adds no public function, table or index, and no plain create function", () => {
    for (const { file, sql } of files) {
      const c = code(sql);
      expect(c, file).not.toMatch(/create\s+function\s/i);
      expect(c, file).not.toMatch(/create\s+(or\s+replace\s+)?function\s+public\./i);
      expect(c, file).not.toMatch(/create\s+(unlogged\s+|temp\w*\s+)?table\s/i);
      expect(c, file).not.toMatch(/create\s+(unique\s+)?index\s/i);
    }
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

  it("does not touch the audit checks, the alert registry or the cron jobs", () => {
    for (const { file, sql } of files) {
      const c = code(sql);
      expect(c, file).not.toMatch(/audit_event_(entity_type|action)_check/i);
      expect(c, file).not.toMatch(/insert\s+into\s+app\.alert_kind/i);
      expect(c, file).not.toMatch(/cron\.schedule/i);
      expect(c, file).not.toMatch(/job_run_job_check/i);
    }
  });

  it("keeps the definer rules of the replaced twin", () => {
    for (const { file, sql } of files) {
      const c = code(sql);
      expect(c, file).toMatch(/security\s+definer/i);
      expect(c, file).toMatch(/set\s+search_path\s*=\s*''/i);
      expect(c, file).toMatch(
        /revoke\s+all\s+on\s+function\s+app\.push_menu_item_at\s*\(uuid,\s*uuid,\s*uuid,\s*jsonb,\s*timestamptz\)\s+from\s+public,\s*anon,\s*authenticated,\s*service_role/i,
      );
    }
  });

  it("raises menu_price_missing", () => {
    expect(files.map((f) => code(f.sql)).join("\n")).toMatch(/menu_price_missing/);
  });
});

describe("the patterns used above (self-test)", () => {
  it("strips comments", () => {
    expect(code("select 1; -- create function public.x(")).not.toMatch(/create/);
  });

  it("catches a re-creation and a second replaced function", () => {
    const sample = "create or replace function public.menu_list() returns jsonb as $$ $$;";
    expect(createOrReplaceNames(sample)).toEqual(["public.menu_list"]);
    expect(createOrReplaceNames("-- create or replace function app.x(")).toEqual([]);
  });

  it("catches a plain create function and a public one", () => {
    expect(/create\s+function\s/i.test(code("create function app.x() returns int"))).toBe(true);
    expect(
      /create\s+(or\s+replace\s+)?function\s+public\./i.test(
        code("create or replace function public.x()"),
      ),
    ).toBe(true);
  });
});
