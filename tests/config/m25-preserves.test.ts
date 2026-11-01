import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// M25 plan step 1 (docs/plans/2026-11-01-m25-go-live.md §5): M25 adds no migration, no dependency and no nav change.
const ROOT = new URL("../../", import.meta.url);
const LAST_MIGRATION = "20261116100000_push_menu_price_missing.sql";
// md5 of src/lib/nav/nav-model.ts at main 0f1df68.
const NAV_MODEL_MD5 = "402764f8ad2084708fcec4c9666f2164";

/** Sorted migration file names of a directory. */
function listMigrations(dir: string | URL): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** The dependency names the no-new-deps guard lists, read from its source (importing a test file would run its tests twice). */
function guardedDependencyNames(): string[] {
  const src = readFileSync(new URL("tests/config/no-new-deps.test.ts", ROOT), "utf8");
  const block = /const EXPECTED = \[([\s\S]*?)\];/.exec(src)?.[1] ?? "";
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe("M25 adds no migration", () => {
  it("the newest migration is still the M24 one", () => {
    const names = listMigrations(new URL("supabase/migrations/", ROOT));
    expect(names.at(-1)).toBe(LAST_MIGRATION);
  });

  it("self-test: an extra later migration in a directory is detected", () => {
    const dir = mkdtempSync(join(tmpdir(), "m25-mig-"));
    writeFileSync(join(dir, LAST_MIGRATION), "-- x\n");
    expect(listMigrations(dir).at(-1)).toBe(LAST_MIGRATION);
    writeFileSync(join(dir, "20261117000000_x.sql"), "-- x\n");
    expect(listMigrations(dir).at(-1)).not.toBe(LAST_MIGRATION);
  });
});

describe("M25 adds no dependency", () => {
  it("package.json names equal the guarded list", () => {
    const pkg = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const names = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)].sort();
    const guarded = guardedDependencyNames();
    expect(guarded.length).toBeGreaterThan(20);
    expect(names).toEqual([...guarded].sort());
  });
});

describe("M25 changes no navigation", () => {
  it("src/lib/nav/nav-model.ts is byte-identical to main 0f1df68", () => {
    const md5 = createHash("md5")
      .update(readFileSync(new URL("src/lib/nav/nav-model.ts", ROOT)))
      .digest("hex");
    expect(md5).toBe(NAV_MODEL_MD5);
  });
});
