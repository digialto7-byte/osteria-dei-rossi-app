import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// P2-2 (trace and sell-through, docs/plans/2026-11-14-p2-2-trace-sell-through.md section 5 "Shared lists changed on purpose", step S1 on): the 20261203*
// migrations are exactly the steps built so far. They create no table, alter no table, create no trigger, replace no function that already
// exists, and create only the listed new functions. Each step adds its file and its functions here on purpose.
const MIGRATIONS = join(process.cwd(), "supabase/migrations");

// The files of this feature, in step order.
const TRACE_MIGRATIONS = ["20261203100000_trace_core.sql"];

// Main's newest migration when the branch was cut: every file of this feature sorts after it (supabase db push refuses otherwise).
const AFTER_MAIN = "20261202100000";

// Plan section 3.1 D-P1: read-only over the ledgers, so no table, column or trigger. Indexes and functions only.
const CREATED_TABLES: string[] = [];
const ALTERED_TABLES: string[] = [];
const REPLACED_FUNCTIONS: string[] = [];

const NEW_FUNCTIONS = [
  // S1: the gate, the lot-code normaliser, the constants, the split-family walk
  "app.require_trace_reader",
  "app.lot_code_norm",
  "app.trace_constants",
  "app.batch_family",
  "app.batch_root",
];

/** The files of a directory that belong to this feature (timestamp 20261203*), sorted. */
function traceMigrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith("20261203") && f.endsWith(".sql"))
    .sort();
}

/** The SQL of a migration without its `--` comments, so a name mentioned in a comment is not a definition. */
function sqlWithoutComments(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** Names (schema-qualified, lower case) after each `create [or replace] function`, optionally only the `or replace` ones. */
function definedFunctions(sql: string, orReplace: boolean): string[] {
  const re = orReplace
    ? /create\s+or\s+replace\s+function\s+([a-z_]+\.[a-z_0-9]+)/gi
    : /create\s+function\s+([a-z_]+\.[a-z_0-9]+)/gi;
  return [...sqlWithoutComments(sql).matchAll(re)].map((m) => m[1]!.toLowerCase());
}

function allSql(): string {
  return traceMigrations(MIGRATIONS)
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

describe("P2-2 migrations", () => {
  it("are exactly the steps built so far", () => {
    expect(traceMigrations(MIGRATIONS)).toEqual(TRACE_MIGRATIONS);
  });

  it("sort after main's newest migration at the time of the branch", () => {
    for (const f of TRACE_MIGRATIONS) expect(f.localeCompare(AFTER_MAIN)).toBeGreaterThan(0);
  });

  it("self-test: the listing sees an extra feature file and ignores others", () => {
    const dir = mkdtempSync(join(tmpdir(), "p22-"));
    try {
      writeFileSync(join(dir, "20261203100000_trace_core.sql"), "");
      writeFileSync(join(dir, "20261203999999_extra.sql"), "");
      writeFileSync(join(dir, "20261202100000_admin_mfa_always.sql"), "");
      expect(traceMigrations(dir)).toEqual([
        "20261203100000_trace_core.sql",
        "20261203999999_extra.sql",
      ]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("create no table and alter no table", () => {
    const sql = sqlWithoutComments(allSql());
    const created = [
      ...sql.matchAll(
        /create\s+(?:unlogged\s+|temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?([a-z_.]+)/gi,
      ),
    ].map((m) => m[1]!.toLowerCase());
    expect(created.filter((t) => !CREATED_TABLES.includes(t))).toEqual([]);
    const altered = [...sql.matchAll(/alter\s+table\s+([a-z_.]+)/gi)].map((m) =>
      m[1]!.toLowerCase(),
    );
    expect(altered.filter((t) => !ALTERED_TABLES.includes(t))).toEqual([]);
  });

  it("create no trigger, no view, no type and drop nothing", () => {
    const sql = sqlWithoutComments(allSql());
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?trigger\b/i);
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?(materialized\s+)?view\b/i);
    expect(sql).not.toMatch(/create\s+type\b/i);
    expect(sql).not.toMatch(/\bdrop\b/i);
  });

  it("replace no existing function and create only the listed new ones", () => {
    const sql = allSql();
    expect(definedFunctions(sql, true).filter((f) => !REPLACED_FUNCTIONS.includes(f))).toEqual([]);
    expect(definedFunctions(sql, false).filter((f) => !NEW_FUNCTIONS.includes(f))).toEqual([]);
    // Every listed function is actually defined (the lists do not drift ahead of the files).
    for (const f of NEW_FUNCTIONS) expect(definedFunctions(sql, false)).toContain(f);
  });

  it("self-test: the function scan ignores comments and sees a definition", () => {
    const sql =
      "-- create or replace function app.role()\ncreate or replace function app.role() returns void";
    expect(definedFunctions(sql, true)).toEqual(["app.role"]);
    expect(definedFunctions("-- create function app.x()\n", false)).toEqual([]);
  });
});
