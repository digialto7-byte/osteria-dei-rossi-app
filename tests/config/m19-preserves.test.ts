import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M19 plan step 10: the migrations of M19 (20261106*) must not re-create objects earlier milestones own. pgTAP 179 pins their
// definitions; this is the cheaper early check on the SQL text. The one object M19 replaces on purpose is
// app.session_fired_lines (the M17 stub) - and app.ledger_checks_body, which keeps every earlier check (pgTAP 117, 137, 177).
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

const PROTECTED = [
  "public.produce_batch",
  "public.discard_batch",
  "public.adjust_batch",
  "public.split_batch",
  "public.add_order_line",
  "public.update_order_line",
  "public.remove_order_line",
  "public.order_view",
  "public.menu_list",
  "app.post_stock_outflow",
  "app.raise_alert",
  "app.try_raise_alert",
  "app.chef_payload_allowed",
  "app.batch_settle_state",
  "app.lock_batch_rows",
  "app.lock_live_batches",
  "app.menu_item_availability",
  "app.order_line_json",
  "app.order_line_guard",
  "app.alert_rules_body",
  "app.remaining_portions",
  "app.plates_sold",
];

function m19Migrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.startsWith("20261106") && f.endsWith(".sql"))
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

describe("M19 migrations leave the earlier milestones' objects alone", () => {
  const files = m19Migrations();

  it("finds the M19 migrations", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
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

  it("does not touch the audit checks or the alert registry", () => {
    for (const { file, sql } of files) {
      const c = code(sql);
      expect(c, file).not.toMatch(/audit_event_(entity_type|action)_check/i);
      expect(c, file).not.toMatch(/insert\s+into\s+app\.alert_kind/i);
    }
  });

  it("the earlier-values guard would catch a missing name (self-test of the pattern)", () => {
    const sample = "create or replace function public.order_view(p uuid) returns jsonb as $$ $$;";
    const pattern = /create\s+(or\s+replace\s+)?function\s+public\.order_view\s*\(/i;
    expect(pattern.test(code(sample))).toBe(true);
    expect(pattern.test(code("-- create function public.order_view("))).toBe(false);
  });
});
