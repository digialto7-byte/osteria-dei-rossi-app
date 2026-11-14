import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// DS-BQ-2 (docs/plans/2026-11-14-ds-bq2-order-session-opener-coperto.md, step 1): the 20261206* migrations are exactly one file. It replaces only
// public.order_view (the order session gains openedAt, openedToday, openedBy and coperto) and creates no function, table, trigger or policy.
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const FILE = "20261206100000_order_view_opener_coperto.sql";
// Main's newest migration at the time of the branch (BQ-1).
const AFTER_MAIN = "20261205100000_tables_unsent_count.sql";

/** The files of this feature (timestamp 20261206*), sorted. */
function bq2Migrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith("20261206") && f.endsWith(".sql"))
    .sort();
}

/** The SQL without its `--` comments, so a name mentioned in a comment is not a definition. */
function sqlWithoutComments(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

describe("DS-BQ-2 migration", () => {
  it("is exactly the 20261206 file", () => {
    expect(bq2Migrations(MIGRATIONS)).toEqual([FILE]);
  });

  it("sorts after main's newest migration at the time of the branch (BQ-1)", () => {
    expect(FILE.localeCompare(AFTER_MAIN)).toBeGreaterThan(0);
  });

  it("self-test: the listing sees an extra feature file and ignores others", () => {
    const dir = mkdtempSync(join(tmpdir(), "bq2-"));
    try {
      writeFileSync(join(dir, FILE), "");
      writeFileSync(join(dir, "20261206999999_extra.sql"), "");
      writeFileSync(join(dir, AFTER_MAIN), "");
      expect(bq2Migrations(dir)).toEqual([FILE, "20261206999999_extra.sql"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("replaces only public.order_view and creates no function, table, trigger or policy", () => {
    const sql = sqlWithoutComments(readFileSync(join(MIGRATIONS, FILE), "utf8"));
    const replaced = [...sql.matchAll(/create\s+or\s+replace\s+function\s+([a-z_]+\.[a-z_0-9]+)/gi)].map(
      (m) => m[1]!.toLowerCase(),
    );
    expect(replaced).toEqual(["public.order_view"]);
    expect(sql).not.toMatch(/create\s+function\b/i);
    expect(sql).not.toMatch(/create\s+(unlogged\s+|temp(orary)?\s+)?table\b/i);
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?trigger\b/i);
    expect(sql).not.toMatch(/create\s+policy\b/i);
    expect(sql).not.toMatch(/alter\s+table\b/i);
  });

  it("never drops and never cascades", () => {
    const sql = sqlWithoutComments(readFileSync(join(MIGRATIONS, FILE), "utf8"));
    expect(sql).not.toMatch(/\bdrop\s+/i);
    expect(sql).not.toMatch(/\bcascade\b/i);
    expect(sql).not.toMatch(/^\s*truncate\s/im);
    expect(sql).not.toMatch(/^\s*delete\s+from\b/im);
  });

  it("self-test: the comment stripper hides a name in a comment", () => {
    expect(sqlWithoutComments("-- drop table x\nselect 1;")).not.toMatch(/\bdrop\b/);
  });
});
