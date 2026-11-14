import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// M25 plan step 1 (docs/plans/2026-11-01-m25-go-live.md §5): M25 adds no migration, no dependency and no nav change.
const ROOT = new URL("../../", import.meta.url);
// The pin is the newest migration on main: M25 adds none. It moved on purpose when main (M25b, M25c, A5's follow-up #50, the cron bypass #52)
// was merged into this branch. The reservations feature (PR1, plan docs/plans/2026-11-08-reservations.md A1 on) re-pins it on
// purpose to its last migration so far, as it does in the m25a and m25b preserves tests; M25 itself still adds none. A5b (raw stock on the business day, ADR-033)
// re-pins it on purpose to its own last migration, 20261127100100_drop_unused_effective_indexes.sql (A5b has two migrations; it moved forward with each).
// The reservations feature (PR2, plan step B1 on, 20261128*) re-pins it on purpose to its own last migration so far; each PR2 migration moves it forward.
// P2-0 F12 (docs/plans/2026-11-11-p2-0-golive-carryovers.md) moved it on purpose to 20261129100000_supplier_item_mapping_update_revoke.sql;
// P2-0b (sell by weight, 20261130*, plan docs/plans/2026-11-11-p2-0b-sell-by-weight.md) re-pins it on purpose to its own last migration.
// P2-1 (TOTP second factor, 20261201*, plan docs/plans/2026-11-12-p2-1-totp.md) re-pins it on purpose to its own last migration so far; each P2-1 migration moves it forward.
// FD31 (admin gated in every mode, 20261202100000_admin_mfa_always.sql) re-pins it on purpose to its own migration: one `create or replace` pair, no new object.
// P2-2 (trace and sell-through, 20261203*, plan docs/plans/2026-11-14-p2-2-trace-sell-through.md) re-pins it on purpose to its own last migration so far; each P2-2 migration moves it forward.
const LAST_MIGRATION = "20261203100000_trace_core.sql";
// md5 of src/lib/nav/nav-model.ts: main after M25b's navigation by job (ADR-030) plus the one Prenotazioni link of the reservations (A13), then P2-1 B5's /doppia-verifica entry (on purpose); M25 itself changes no navigation.
const NAV_MODEL_MD5 = "b65f7b4b88859bb8eb15c68ab1557be4";

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
  it("the newest migration is still main's", () => {
    const names = listMigrations(new URL("supabase/migrations/", ROOT));
    expect(names.at(-1)).toBe(LAST_MIGRATION);
  });

  it("self-test: an extra later migration in a directory is detected", () => {
    const dir = mkdtempSync(join(tmpdir(), "m25-mig-"));
    writeFileSync(join(dir, LAST_MIGRATION), "-- x\n");
    expect(listMigrations(dir).at(-1)).toBe(LAST_MIGRATION);
    writeFileSync(join(dir, "20261299000000_x.sql"), "-- x\n");
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
  it("src/lib/nav/nav-model.ts is byte-identical to main's M25b model", () => {
    const md5 = createHash("md5")
      .update(readFileSync(new URL("src/lib/nav/nav-model.ts", ROOT)))
      .digest("hex");
    expect(md5).toBe(NAV_MODEL_MD5);
  });
});
