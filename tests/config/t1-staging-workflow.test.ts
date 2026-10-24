import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The T1 spike on staging (M11 plan M-1, founder OK 2026-10-24) creates and deletes an Auth user on
// a hosted project with its secret key, so its safety properties are pinned here.
const path = new URL("../../.github/workflows/t1-staging.yml", import.meta.url);
const workflow = existsSync(path) ? readFileSync(path, "utf8") : "";
const STAGING_REF = "wjowhjsfpcdykxwgjipq";
const SECRET_REF = /\$\{\{\s*secrets\./g;

/** The YAML text of one step, found by a line it contains, up to the next step. */
function stepContaining(marker: string): string {
  const steps = workflow.slice(workflow.indexOf("    steps:")).split(/\n(?= {6}- )/);
  const step = steps.find((candidate) => candidate.includes(marker));
  if (!step) throw new Error(`no step contains ${marker}`);
  return step;
}

describe("t1-staging workflow", () => {
  it("exists", () => {
    expect(workflow).not.toBe("");
  });

  it("is started by hand only, from main only", () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:\s*$/m);
    expect(workflow).not.toMatch(
      /^\s*(push|pull_request|pull_request_target|schedule|workflow_run):/m,
    );
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
  });

  it("uses the protected staging environment, read-only token, no persisted credentials", () => {
    expect(workflow).toMatch(/^\s+environment: staging$/m);
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(workflow).toContain("persist-credentials: false");
  });

  it("reads the three Supabase secrets in the spike step only, and never PIN_PEPPER", () => {
    const spike = stepContaining("scripts/spike/t1-staff-auth.ts");
    expect(spike).toContain("NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}");
    expect(spike).toContain(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_PUBLISHABLE_KEY }}",
    );
    expect(spike).toContain("SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}");
    // Exactly these three secret references in the whole file: none at job level, none for npm ci.
    expect(workflow.match(SECRET_REF)).toHaveLength(3);
    expect(spike.match(SECRET_REF)).toHaveLength(3);
    expect(workflow).not.toContain("PIN_PEPPER");
  });

  it("runs the script with its explicit staging opt-in", () => {
    const spike = stepContaining("scripts/spike/t1-staff-auth.ts");
    expect(spike).toContain('T1_STAGING_OK: "yes"');
    expect(spike).toContain("npx tsx scripts/spike/t1-staff-auth.ts --target staging");
  });

  it("refuses any project but staging, and missing secrets, before the script runs", () => {
    const spike = stepContaining("scripts/spike/t1-staff-auth.ts");
    expect(workflow).toContain(`STAGING_PROJECT_REF: ${STAGING_REF}`);
    expect(spike).toContain('"$STAGING_PROJECT_REF.supabase.co"');
    const guard = spike.indexOf("STAGING_PROJECT_REF.supabase.co");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(spike.indexOf("npx tsx scripts/spike/t1-staff-auth.ts"));
    expect(spike).toContain("::error title=Missing staging secrets::");
  });

  it("prints nothing of its own beyond the script's one JSON line (no tracing, no echo of values)", () => {
    expect(workflow).not.toMatch(/set -x|set -o xtrace/);
    expect(workflow).not.toMatch(/echo[^\n]*\$\{?(NEXT_PUBLIC_SUPABASE|SUPABASE_SECRET_KEY|host)/);
  });

  it("compares the exact host, so a look-alike URL, a port or http:// is refused", () => {
    const spike = stepContaining("scripts/spike/t1-staff-auth.ts");
    expect(spike).toContain('host="${NEXT_PUBLIC_SUPABASE_URL#https://}"');
    expect(spike).toContain('host="${host%%/*}"');
    expect(spike).toContain('if [ "$host" != "$STAGING_PROJECT_REF.supabase.co" ]; then');
  });

  it("runs once at a time without cancelling a run in progress, with a time limit", () => {
    expect(workflow).toMatch(/concurrency:\n {2}group: t1-staging\n {2}cancel-in-progress: false/);
    expect(workflow).toMatch(/^ {4}timeout-minutes: 15$/m);
  });
});
