import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Three check constraints are re-created by several milestones. A later milestone that forgets an
// earlier value breaks the procedures of that earlier milestone (the M11/M13 incident). The rule:
// EVERY definition contains every value of every earlier one, in migration order. Checking only the
// last definition is not enough: a database that already holds rows with the dropped value refuses
// the narrower constraint, so the whole deploy stops there (staging, 2026-10-28).
const CONSTRAINTS = [
  "audit_event_entity_type_check",
  "audit_event_action_check",
  "job_run_job_check",
];

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

type Definition = { file: string; values: string[] };

/** The quoted values of each `constraint <name> check (...)` clause, in migration order. */
function definitionsOf(name: string, files: { file: string; sql: string }[]): Definition[] {
  const out: Definition[] = [];
  const marker = new RegExp(`constraint\\s+${name}\\s+check\\b`, "gi");
  for (const { file, sql } of files) {
    for (const m of sql.matchAll(marker)) {
      const rest = sql.slice(m.index + m[0].length);
      // The clause ends at the next statement end or the next `add constraint`.
      const end = rest.search(/;|add\s+constraint/i);
      const clause = end === -1 ? rest : rest.slice(0, end);
      out.push({ file, values: [...clause.matchAll(/'([^']*)'/g)].map((v) => v[1]!) });
    }
  }
  return out;
}

/** Values of earlier definitions that the last definition lacks. */
function lostValues(defs: Definition[]): string[] {
  if (defs.length < 2) return [];
  const last = new Set(defs[defs.length - 1]!.values);
  return [...new Set(defs.slice(0, -1).flatMap((d) => d.values))]
    .filter((v) => !last.has(v))
    .sort();
}

/** For each definition after the first, the earlier values it lacks (empty entries are left out). */
function narrowings(defs: Definition[]): { file: string; lost: string[] }[] {
  const out: { file: string; lost: string[] }[] = [];
  const seen = new Set<string>();
  for (const def of defs) {
    const own = new Set(def.values);
    const lost = [...seen].filter((v) => !own.has(v)).sort();
    if (lost.length > 0) out.push({ file: def.file, lost });
    def.values.forEach((v) => seen.add(v));
  }
  return out;
}

function readMigrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(new URL(file, MIGRATIONS), "utf8") }));
}

describe("check constraints that several milestones re-create", () => {
  const files = readMigrations();

  for (const name of CONSTRAINTS) {
    it(`${name}: the last definition keeps every earlier value`, () => {
      const defs = definitionsOf(name, files);
      expect(defs.length).toBeGreaterThan(0);
      expect(lostValues(defs)).toEqual([]);
    });

    it(`${name}: no definition drops a value of an earlier one`, () => {
      expect(narrowings(definitionsOf(name, files))).toEqual([]);
    });
  }

  it("every other check defined in more than one migration also never drops a value", () => {
    const names = new Set(
      files.flatMap(({ sql }) =>
        [...sql.matchAll(/constraint\s+([a-z0-9_]+)\s+check\b/gi)].map((m) => m[1]!.toLowerCase()),
      ),
    );
    const redefined = [...names].filter((n) => definitionsOf(n, files).length > 1);
    expect(redefined).toEqual(expect.arrayContaining(CONSTRAINTS));
    const narrowed = redefined
      .map((n) => ({ name: n, narrowings: narrowings(definitionsOf(n, files)) }))
      .filter((r) => r.narrowings.length > 0);
    expect(narrowed).toEqual([]);
  });

  it("finds the definitions in more than one migration for the audit checks", () => {
    expect(definitionsOf("audit_event_action_check", files).length).toBeGreaterThan(3);
    expect(definitionsOf("job_run_job_check", files).length).toBeGreaterThan(2);
  });

  it("fails on a synthetic list that drops a value", () => {
    const synthetic = [
      {
        file: "a.sql",
        sql: "alter table t add constraint c_check check (x in ('one', 'two', 'three'));",
      },
      {
        file: "b.sql",
        sql: "alter table t\n  drop constraint c_check,\n  add constraint c_check check (x in ('one', 'three', 'four'));",
      },
    ];
    expect(lostValues(definitionsOf("c_check", synthetic))).toEqual(["two"]);
  });

  it("flags a middle definition that drops a value even when a later one restores it", () => {
    const synthetic = [
      { file: "a.sql", sql: "add constraint c_check check (x in ('one', 'two'));" },
      {
        file: "b.sql",
        sql: "drop constraint c_check, add constraint c_check check (x in ('one'));",
      },
      { file: "c.sql", sql: "add constraint c_check check (x in ('one', 'two', 'three'));" },
    ];
    const defs = definitionsOf("c_check", synthetic);
    expect(lostValues(defs)).toEqual([]);
    expect(narrowings(defs)).toEqual([{ file: "b.sql", lost: ["two"] }]);
  });

  it("reads a named check inside create table as a definition", () => {
    const synthetic = [
      { file: "a.sql", sql: "create table t (x text, constraint c_check check (x in ('one')));" },
    ];
    expect(definitionsOf("c_check", synthetic)).toEqual([{ file: "a.sql", values: ["one"] }]);
  });

  it("passes on a synthetic list that only adds values", () => {
    const synthetic = [
      { file: "a.sql", sql: "add constraint c_check check (x in ('one'));" },
      { file: "b.sql", sql: "add constraint c_check check (x in ('one', 'two'));" },
    ];
    expect(lostValues(definitionsOf("c_check", synthetic))).toEqual([]);
  });
});
