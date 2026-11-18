import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// DS-BQ-2 (docs/plans/2026-11-14-ds-bq2-order-session-opener-coperto.md, step 1): the 20261206* migrations are exactly one file. It replaces only
// public.order_view (the order session gains openedAt, openedToday, openedBy and coperto) and creates no function, table, trigger or policy.
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const FILE = "20261206100000_order_view_opener_coperto.sql";
const CODE_HASH_COMMENT = "20261206100100_device_enrolment_code_hash_comment.sql";
// Main's newest migration at the time of the branch (BQ-1).
const AFTER_MAIN = "20261205100000_tables_unsent_count.sql";

/**
 * The files of this feature, sorted: DS-BQ-2's own hour (timestamp 20261206 + hour 10). Re-pinned on purpose by SP1 (lead-ratified, plan Q7, 2026-11-18):
 * the filter was every 20261206* file, and is narrowed to this hour so SP1 can use 20261206200000-20261206200400 (the 20261206200* files are
 * guarded by tests/config/sp1-preserves.test.ts). The exact-list assertion below is unchanged.
 */
function bq2Migrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith("2026120610") && f.endsWith(".sql"))
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
  it("is exactly the 20261206 file, followed only by the code_hash comment fix (within its own hour)", () => {
    // The small fix (lead, 2026-11-15) sits between DS-BQ-2 and SP2's 20261207*, so it shares this day. It only comments a column
    // (pgTAP 388), so DS-BQ-2's "no new object" checks below stay on FILE alone.
    expect(bq2Migrations(MIGRATIONS)).toEqual([FILE, CODE_HASH_COMMENT]);
  });

  it("the code_hash fix is one comment on column and nothing else", () => {
    const sql = sqlWithoutComments(
      readFileSync(join(MIGRATIONS, CODE_HASH_COMMENT), "utf8"),
    ).trim();
    expect(sql).toMatch(/^comment on column public\.device_enrolment\.code_hash is\s/);
    expect(sql.match(/;/g)).toHaveLength(1);
  });

  it("sorts after main's newest migration at the time of the branch (BQ-1)", () => {
    expect(FILE.localeCompare(AFTER_MAIN)).toBeGreaterThan(0);
  });

  it("self-test: the listing sees an extra file of the DS-BQ-2 hour and ignores the others, SP1's 20261206200* files included", () => {
    const dir = mkdtempSync(join(tmpdir(), "bq2-"));
    try {
      writeFileSync(join(dir, FILE), "");
      writeFileSync(join(dir, "20261206100200_extra.sql"), "");
      writeFileSync(join(dir, "20261206200000_x.sql"), "");
      writeFileSync(join(dir, "20261207100000_y.sql"), "");
      writeFileSync(join(dir, AFTER_MAIN), "");
      expect(bq2Migrations(dir)).toEqual([FILE, "20261206100200_extra.sql"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("replaces only public.order_view and creates no function, table, trigger or policy", () => {
    const sql = sqlWithoutComments(readFileSync(join(MIGRATIONS, FILE), "utf8"));
    const replaced = [
      ...sql.matchAll(/create\s+or\s+replace\s+function\s+([a-z_]+\.[a-z_0-9]+)/gi),
    ].map((m) => m[1]!.toLowerCase());
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
