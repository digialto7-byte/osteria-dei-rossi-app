import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SYNC_KINDS } from "@/server/sync/constants";

// M19b plan step 9: the migrations of M19b (20261111*) must not re-create the procedures and helpers of earlier milestones, except the two
// the plan replaces on purpose (app.kitchen_ticket_rows, public.kitchen_tickets) and the purge list (app.demo_purge_tables). pgTAP 229 pins the
// definitions (md5); this is the cheaper early check on the SQL text. Kitchen marks are online-only (M20 §1, ADR-024): the service worker
// and the offline queue are not touched.
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

const PROTECTED = [
  "public.fire_course",
  "public.void_line",
  "public.close_table",
  "public.session_bill",
  "public.order_view",
  "public.tables_list",
  "public.apply_op",
  "app.apply_op_dispatch",
  "app.close_session_at",
  "app.order_line_json",
  "app.order_line_guard",
  "app.sync_op_kinds",
  "app.require_kitchen_reader",
  "app.business_date",
  "app.ledger_checks_body",
];

function m19bMigrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.startsWith("20261111") && f.endsWith(".sql"))
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

describe("M19b migrations leave the earlier milestones' objects alone", () => {
  const files = m19bMigrations();

  it("finds the M19b migrations", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const name of PROTECTED) {
    it(`never re-creates ${name}`, () => {
      const hits = files.filter((f) => recreates(f.sql, name)).map((f) => f.file);
      expect(hits).toEqual([]);
    });
  }

  it("the detector sees a re-creation (negative control)", () => {
    expect(
      recreates("create or replace function public.fire_course(p_x int)", "public.fire_course"),
    ).toBe(true);
    expect(recreates("-- create function public.fire_course(", "public.fire_course")).toBe(false);
  });

  it("replaces only the board read and the purge list", () => {
    const replaced = files
      .filter((f) => /create\s+or\s+replace\s+function/i.test(code(f.sql)))
      .flatMap((f) =>
        [...code(f.sql).matchAll(/create\s+or\s+replace\s+function\s+([a-z_.]+)\s*\(/gi)].map(
          (m) => m[1],
        ),
      )
      .sort();
    expect(replaced).toEqual([
      "app.demo_purge_tables",
      "app.kitchen_ticket_rows",
      "public.kitchen_tickets",
    ]);
  });
});

describe("kitchen marks are online-only (AT12)", () => {
  it("the offline queue still carries the six M20 op kinds", () => {
    expect([...SYNC_KINDS]).toEqual([
      "open_table",
      "add_line",
      "edit_line",
      "remove_line",
      "fire",
      "void_line",
    ]);
  });

  it("the service worker caches the same four reads as at M20 and nothing of the kitchen", () => {
    const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
    const match = /const API_PATHS = (\[[^\]]*\]);/.exec(sw);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1]!)).toEqual([
      "/api/me",
      "/api/menu",
      "/api/tables",
      "/api/table-sessions/:id/lines",
    ]);
    expect(sw).not.toMatch(/cucina|\/api\/kitchen/);
  });

  it("no offline-queue file mentions the kitchen", () => {
    const dir = new URL("../../src/pwa/", import.meta.url);
    for (const f of readdirSync(dir)) {
      if (!/\.(ts|tsx|js)$/.test(f)) continue;
      expect(readFileSync(new URL(f, dir), "utf8"), f).not.toMatch(/kitchen|cucina/i);
    }
  });
});
