import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Three check constraints are re-created by several milestones. A later milestone that forgets an
// earlier value breaks the procedures of that earlier milestone (the M11/M13 incident, repaired by
// 20261027100800). The rule: the LAST definition of each contains every value of every earlier one.
const CONSTRAINTS = [
  "audit_event_entity_type_check",
  "audit_event_action_check",
  "job_run_job_check",
];

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

type Definition = { file: string; values: string[] };

/** The quoted values of each `add constraint <name> check (...)` clause, in migration order. */
function definitionsOf(name: string, files: { file: string; sql: string }[]): Definition[] {
  const out: Definition[] = [];
  const marker = new RegExp(`add\\s+constraint\\s+${name}\\b`, "gi");
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
  }

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

  it("passes on a synthetic list that only adds values", () => {
    const synthetic = [
      { file: "a.sql", sql: "add constraint c_check check (x in ('one'));" },
      { file: "b.sql", sql: "add constraint c_check check (x in ('one', 'two'));" },
    ];
    expect(lostValues(definitionsOf("c_check", synthetic))).toEqual([]);
  });
});
