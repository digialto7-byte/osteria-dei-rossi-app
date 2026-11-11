import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// P2-0 plan (docs/plans/2026-11-11-p2-0-golive-carryovers.md §5, step A2): PR A adds exactly one migration, the F12 column revokes
// on public.supplier_item, and it is exactly two statements (UPDATE of the mapping columns, INSERT of description_hash). Anything else is a change of plan and must be done on purpose here.
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
/** The newest migration on main when P2-0 was branched (b473e9f). */
const MAIN_NEWEST = "20261128100600_affected_recipe_keys_bfs.sql";
const F12 = "20261129100000_supplier_item_mapping_update_revoke.sql";
const F12_STATEMENTS =
  "revoke update (ingredient_id, description_hash) on public.supplier_item from authenticated; " +
  "revoke insert (description_hash) on public.supplier_item from authenticated;";

/** Migration file names of a directory that sort after `after`. */
export function migrationsAfter(dir: string, after: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && f > after)
    .sort();
}

/** SQL with line comments, block comments and all whitespace runs collapsed (single spaces, trimmed). */
export function stripSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("P2-0 PR A adds one migration, the F12 revoke", () => {
  // Later PRs add their own migrations after F12 (P2-0b, 20261130*, pinned by p2-0b-preserves); between main's newest at the time
  // and F12 there is exactly the F12 file.
  it("the migrations after main's newest, up to F12, are exactly the F12 file", () => {
    expect(migrationsAfter(MIGRATIONS, MAIN_NEWEST).filter((name) => name <= F12)).toEqual([F12]);
  });

  it("the file is exactly the two revoke statements, nothing else", () => {
    expect(stripSql(readFileSync(join(MIGRATIONS, F12), "utf8"))).toBe(F12_STATEMENTS);
  });

  it("the listing sees an extra file (self-test)", () => {
    const dir = mkdtempSync(join(tmpdir(), "p2-0-mig-"));
    writeFileSync(join(dir, F12), "-- x\n");
    expect(migrationsAfter(dir, MAIN_NEWEST)).toEqual([F12]);
    writeFileSync(join(dir, "20261201000000_x.sql"), "-- x\n");
    expect(migrationsAfter(dir, MAIN_NEWEST)).toEqual([F12, "20261201000000_x.sql"]);
  });

  it("the statement check sees a second statement and a widened revoke (self-test)", () => {
    expect(stripSql(`-- c\n${F12_STATEMENTS}\n/* b */`)).toBe(F12_STATEMENTS);
    expect(stripSql(`${F12_STATEMENTS}\nrevoke all on public.x from anon;`)).not.toBe(
      F12_STATEMENTS,
    );
    expect(stripSql("revoke update on public.supplier_item from authenticated;")).not.toBe(
      F12_STATEMENTS,
    );
  });
});
