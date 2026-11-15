import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// SP0 (docs/plans/2026-11-14-sp00-spike.md S14): the scratch SQL redefines the access token hook, drops a unique constraint and adds a role. It
// exists only for throwaway databases, so it must have no way into a migration, a pgTAP file or a deploy workflow. When SP3 adds the real
// platform_staff role to a migration, this guard is changed on purpose in that PR.
// Re-pinned on purpose by SP3 (docs/plans/2026-11-15-sp3-console.md §3.11, listed there for step 10; moved to step 3 because step 3's own names, the trigger
// app_user_platform_staff_guard and the error code platform_staff_member_role, contain the word): the word platform_staff is allowed in
// supabase/migrations/2026120810* and supabase/tests/database/3[7-8][0-9]_sp3_* only. sp0_ and sp0. stay banned everywhere under supabase/.
// One file beyond the plan's two patterns: 359_p22_preserves.test.sql, because the same plan row (§3.11, 359 p27_objs) has it list the trigger
// app_user.app_user_platform_staff_guard by name. The plan's two rows contradict each other there (reported by the SP3 builder).
const ROOT = process.cwd();
const SQL_DIR = "scripts/spike/sp00/sql";
const SKIPPED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "coverage",
  "playwright-report",
  "test-results",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    if (SKIPPED_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const SCRATCH = /sp0_|sp0\.|platform_staff/;
const SP0_NAMES = /sp0_|sp0\./;
const STAFF_ROLE = /platform_staff/;
// re-pinned on purpose by SP3: the only files besides the scratch folder that may name the platform_staff role.
const SP3_ROLE_PATHS =
  /^supabase\/(migrations\/2026120810[^/]*|tests\/database\/(3[78][0-9]_sp3_[^/]*|359_p22_preserves\.test\.sql))$/;

describe("the SP0 scratch SQL is isolated", () => {
  it("nothing under supabase/ (migrations, pgTAP, native shims, config, seed) mentions sp0_ or sp0., and platform_staff appears only in SP3's own migrations and pgTAP files", () => {
    const files = walk("supabase");
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((file) => SP0_NAMES.test(read(file)))).toEqual([]);
    const staffRole = files.filter((file) => STAFF_ROLE.test(read(file)));
    expect(staffRole.filter((file) => !SP3_ROLE_PATHS.test(file))).toEqual([]);
  });

  it("every .sql file in the repository that mentions them is in the scratch folder, or is an SP3 file naming platform_staff only", () => {
    const sql = walk(".").filter((file) => file.endsWith(".sql"));
    const mentioning = sql.filter((file) => SCRATCH.test(read(file)));
    expect(mentioning.length).toBeGreaterThan(0);
    for (const file of mentioning) {
      const text = read(file);
      const inScratch = file.startsWith(`${SQL_DIR}/`);
      const sp3Only = SP3_ROLE_PATHS.test(file) && !SP0_NAMES.test(text);
      expect(inScratch || sp3Only, file).toBe(true);
    }
  });

  it("self-test: the SP3 path allowlist takes SP3's files and nothing else", () => {
    expect(
      SP3_ROLE_PATHS.test("supabase/migrations/20261208100200_platform_staff_guards.sql"),
    ).toBe(true);
    expect(
      SP3_ROLE_PATHS.test("supabase/tests/database/376_sp3_staff_member_guards.test.sql"),
    ).toBe(true);
    expect(SP3_ROLE_PATHS.test("supabase/migrations/20261207100000_organisation.sql")).toBe(false);
    expect(SP3_ROLE_PATHS.test("supabase/tests/database/369_sp2_organisation.test.sql")).toBe(
      false,
    );
    expect(SP3_ROLE_PATHS.test("supabase/seed.sql")).toBe(false);
    expect(SP0_NAMES.test("select sp0.guard();")).toBe(true);
  });

  it("every scratch file except 00_guard.sql starts, after its comments, with `select sp0.guard();`", () => {
    const files = readdirSync(join(ROOT, SQL_DIR)).filter((file) => file.endsWith(".sql"));
    expect(files).toEqual(
      expect.arrayContaining([
        "00_guard.sql",
        "01_hook_probe.sql",
        "02_console_role.sql",
        "03_memberships.sql",
        "04_t4.sql",
      ]),
    );
    for (const file of files.filter((name) => name !== "00_guard.sql")) {
      const firstStatement = read(join(SQL_DIR, file))
        .split("\n")
        .find((line) => line.trim() !== "" && !line.trim().startsWith("--"));
      expect(firstStatement?.trim(), file).toBe("select sp0.guard();");
    }
  });

  it("no workflow but sp0-spike.yml mentions the scratch folders", () => {
    const workflows = readdirSync(join(ROOT, ".github/workflows")).filter((name) =>
      /\.ya?ml$/.test(name),
    );
    for (const name of workflows) {
      const text = read(join(".github/workflows", name));
      if (name === "sp0-spike.yml") expect(text).toContain("scripts/spike/sp00/sql/");
      else expect(text, name).not.toMatch(/spike\/sp00|lib\/sp00|sp0\./);
    }
  });

  it("the deploy workflows still push migrations with exactly the same two commands", () => {
    for (const name of ["deploy-staging.yml", "deploy-production.yml"]) {
      const pushes = read(join(".github/workflows", name))
        .split("\n")
        .filter((line) => /^\s*run: .*supabase db push/.test(line))
        .map((line) => line.replace(/^\s*run: /, "").trim());
      expect(pushes, name).toEqual([
        "npx supabase db push --dry-run",
        "npx supabase db push --yes",
      ]);
    }
  });

  it("no spike script reads SPIKE_DB_URL or SUPABASE_ACCESS_TOKEN, or calls supabase db push or link", () => {
    const files = [...walk("scripts/spike"), ...walk("scripts/lib/sp00")].filter((file) =>
      /\.(ts|sql|sh)$/.test(file),
    );
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = read(file);
      expect(text, relative(".", file)).not.toMatch(
        /\bSPIKE_DB_URL\b|\bSUPABASE_ACCESS_TOKEN\b|supabase\s+db\s+push|supabase\s+link/,
      );
    }
  });
});
