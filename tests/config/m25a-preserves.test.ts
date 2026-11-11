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
// (plan §3.9, step 18) to its own 20261118100000_payable_list_range.sql, and M25c re-pins it on purpose (plan step 1) to its
// last file, 20261120100600_dashboard_yesterday_services.sql (it was moved forward with each of M25c's migration steps). A5's
// follow-up (#50) re-pins it on purpose to 20261121100000_raw_waste_business_date.sql, the next free timestamp after M25c.
// The cron fix re-pins it on purpose to 20261122100000_cron_vercel_protection_bypass.sql (Vercel protection bypass header
// in app.call_cron_route, no table and no public function). The reservations feature (PR1, plan A1 on) re-pins it on purpose to its
// last migration so far; each PR1 step moves it forward. A5b (raw stock on the business day, ADR-033, plan 2026-11-08-a5b) re-pins it on purpose to its own
// last migration, 20261127100100_drop_unused_effective_indexes.sql (A5b has two migrations; it moved forward with each).
// The reservations feature (PR2, plan step B1 on, 20261128*) re-pins it on purpose to its own last migration so far; each PR2 migration moves it forward.
// P2-0b (sell by weight, 20261130*, plan docs/plans/2026-11-11-p2-0b-sell-by-weight.md) re-pins it on purpose to its own last migration so far; each PR 1 step moves it forward.
const LAST_MIGRATION = "20261130100100_weight_menu.sql";
/** md5 of src/lib/nav/nav-model.ts at main 0f1df68, then M25b's navigation model (changed on purpose, plan §3.9 step 18), then the reservations' Prenotazioni link in Sala (A13, on purpose). */
const NAV_MODEL_MD5 = "59c223e78f378e6746ed1234c78899fc";

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
