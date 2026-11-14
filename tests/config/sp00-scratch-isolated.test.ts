import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// SP0 (docs/plans/2026-11-14-sp00-spike.md S14): the scratch SQL redefines the access token hook, drops a unique constraint and adds a role. It
// exists only for throwaway databases, so it must have no way into a migration, a pgTAP file or a deploy workflow. When SP3 adds the real
// platform_staff role to a migration, this guard is changed on purpose in that PR.
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

describe("the SP0 scratch SQL is isolated", () => {
  it("nothing under supabase/ (migrations, pgTAP, native shims, config, seed) mentions sp0_, sp0. or platform_staff", () => {
    const files = walk("supabase");
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.filter((file) => SCRATCH.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it("every .sql file in the repository that mentions them is in the scratch folder", () => {
    const sql = walk(".").filter((file) => file.endsWith(".sql"));
    const mentioning = sql.filter((file) => SCRATCH.test(read(file)));
    expect(mentioning.length).toBeGreaterThan(0);
    for (const file of mentioning) expect(file.startsWith(`${SQL_DIR}/`), file).toBe(true);
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
