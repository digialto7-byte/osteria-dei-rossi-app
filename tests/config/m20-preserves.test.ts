import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M20 plan step 7: the migrations of M20 (20261109*) must not re-create the procedures apply_op dispatches to, nor the helpers they use.
// pgTAP 214 pins their definitions (md5); this is the cheaper early check on the SQL text. apply_op calls the public procedures
// unchanged (ADR-022), and no other object of an earlier milestone is replaced except app.demo_purge_tables (the purge list).
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

const PROTECTED = [
  "public.open_table",
  "public.add_order_line",
  "public.update_order_line",
  "public.remove_order_line",
  "public.fire_course",
  "public.void_line",
  "public.order_view",
  "public.table_session_get",
  "app.parse_client_time",
  "app.order_line_json",
  "app.order_line_guard",
  "app.menu_keys_ok",
  "app.append_only",
  "app.append_only_truncate",
];

function m20Migrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.startsWith("20261109") && f.endsWith(".sql"))
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

function recreates(sql: string, name: string): boolean {
  const pattern = new RegExp(
    `create\\s+(or\\s+replace\\s+)?function\\s+${name.replace(".", "\\.")}\\s*\\(`,
    "i",
  );
  return pattern.test(code(sql));
}

describe("M20 migrations leave the earlier milestones' objects alone", () => {
  const files = m20Migrations();

  it("finds the M20 migrations", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const name of PROTECTED) {
    it(`never re-creates ${name}`, () => {
      const hits = files.filter((f) => recreates(f.sql, name)).map((f) => f.file);
      expect(hits).toEqual([]);
    });
  }

  it("does not touch the audit checks or the alert registry", () => {
    for (const { file, sql } of files) {
      const c = code(sql);
      expect(c, file).not.toMatch(/audit_event_(entity_type|action)_check/i);
      expect(c, file).not.toMatch(/insert\s+into\s+app\.alert_kind/i);
    }
  });

  it("the pattern would catch a re-creation and ignores comments (self-test)", () => {
    expect(recreates("create or replace function public.fire_course(p uuid) returns jsonb", "public.fire_course")).toBe(true);
    expect(recreates("-- create function public.fire_course(", "public.fire_course")).toBe(false);
    expect(recreates("create function public.apply_op(p jsonb)", "public.fire_course")).toBe(false);
  });
});
