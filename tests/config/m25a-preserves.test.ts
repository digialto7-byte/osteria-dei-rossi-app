import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// M25a plan step 0 (docs/plans/2026-11-01-m25a-password-login.md §3.2, §5): M25a adds no migration, no
// dependency, no nav change and no new importer of the privileged staff-auth module.
const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
// M25a adds no migration. The pin is the newest migration on the merged tree: M25b re-pinned it on purpose
// (plan §3.9, step 18) to its own 20261118100000_payable_list_range.sql, and M25c re-pins it on purpose (plan step 1; moved with each
// of its migration steps) to its newest file, 20261120100600_dashboard_yesterday_services.sql once step 6 has landed.
const LAST_MIGRATION = "20261120100100_demo_purge_tables_m25c.sql";
/** md5 of src/lib/nav/nav-model.ts at main 0f1df68, then M25b's navigation model (changed on purpose, plan §3.9 step 18). */
const NAV_MODEL_MD5 = "2c9a4b9d40bdf875e6fb4c48bbc7066f";

/** Sorted .sql file names of a migrations directory. */
export function listMigrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** The quoted strings of the `const <name> = [ ... ];` array literal in a source file. */
function stringArray(path: string, name: string): string[] {
  const source = readFileSync(join(ROOT, path), "utf8");
  const match = new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`).exec(source);
  expect(match, `${name} in ${path}`).not.toBeNull();
  return [...match![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe("M25a leaves migrations, dependencies, nav and the privileged surface alone", () => {
  it("adds no migration after the last one on main", () => {
    const names = listMigrations(MIGRATIONS);
    expect(names[names.length - 1]).toBe(LAST_MIGRATION);
  });

  it("the migration listing sees an extra file (self-test)", () => {
    const dir = mkdtempSync(join(tmpdir(), "m25a-mig-"));
    writeFileSync(join(dir, LAST_MIGRATION), "-- x\n");
    writeFileSync(join(dir, "20261201000000_x.sql"), "-- x\n");
    const names = listMigrations(dir);
    expect(names[names.length - 1]).not.toBe(LAST_MIGRATION);
  });

  it("package.json dependency names equal the list of no-new-deps.test.ts", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const names = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)].sort();
    expect(names).toEqual(stringArray("tests/config/no-new-deps.test.ts", "EXPECTED").sort());
  });

  it("src/lib/nav/nav-model.ts is byte-identical to the M25b model (pinned on purpose)", () => {
    const md5 = createHash("md5")
      .update(readFileSync(join(ROOT, "src/lib/nav/nav-model.ts")))
      .digest("hex");
    expect(md5).toBe(NAV_MODEL_MD5);
  });

  it("the privileged-module importer list still has four files", () => {
    expect(
      stringArray("tests/guards/privileged-importers.test.ts", "ALLOWED_IMPORTERS"),
    ).toHaveLength(4);
  });
});
