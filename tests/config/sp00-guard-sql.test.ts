import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STAGING_PROJECT_REF } from "../../scripts/lib/demo/target";

// SP0 (docs/plans/2026-11-14-sp00-spike.md §3.3, S4): SQL cannot import the staging ref, so the literal in the SQL guard and the
// one in the self-check must stay equal to the constant the script guards use.
const SQL_DIR = join(process.cwd(), "scripts/spike/sp00/sql");
const read = (name: string) => readFileSync(join(SQL_DIR, name), "utf8");

describe("sp0.guard() names the staging project", () => {
  it("00_guard.sql holds the staging ref as its c_staging literal, equal to STAGING_PROJECT_REF", () => {
    const match = /c_staging constant text := '([a-z0-9]+)'/.exec(read("00_guard.sql"));
    expect(match?.[1]).toBe(STAGING_PROJECT_REF);
  });

  it("refuses it before anything else the marker says, and tests the refusal in self-check A", () => {
    const guard = read("00_guard.sql");
    expect(guard).toMatch(/v_ref = c_staging/);
    expect(guard).toMatch(/names the staging project/);
    const check = read("90_selfcheck_a.sql");
    expect(check).toContain(`v_ref constant text := '${STAGING_PROJECT_REF}'`);
    expect(check).toMatch(/staging project/);
  });
});
