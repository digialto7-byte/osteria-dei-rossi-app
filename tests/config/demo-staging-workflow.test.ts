import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The demo data on staging (demo plan step 15, ADR-018) creates and deletes a tenant, Auth users and Storage objects on
// a hosted project with its secret key, so its safety properties are pinned here. Mirrors t1-staging-workflow.test.ts.
const path = new URL("../../.github/workflows/demo-staging.yml", import.meta.url);
const workflow = existsSync(path) ? readFileSync(path, "utf8") : "";
const STAGING_REF = "wjowhjsfpcdykxwgjipq";
const SECRET_REF = /\$\{\{\s*secrets\./g;
const VARS_REF = /\$\{\{\s*vars\./g;
const INPUT_REF = /\$\{\{\s*(github\.event\.)?inputs\./g;
const SCRIPT = "npm run --silent demo -- ";

/** The YAML text of one step, found by a line it contains, up to the next step. */
function stepContaining(marker: string): string {
  const steps = workflow.slice(workflow.indexOf("    steps:")).split(/\n(?= {6}- )/);
  const step = steps.find((candidate) => candidate.includes(marker));
  if (!step) throw new Error(`no step contains ${marker}`);
  return step;
}

/** The part of the step after `run: |` (the shell script), without the env block. */
function shellOf(step: string): string {
  return step.slice(step.indexOf("run: |"));
}

describe("demo-staging workflow", () => {
  it("exists", () => {
    expect(workflow).not.toBe("");
  });

  it("is started by hand only, from main only", () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:/m);
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

  it("takes one choice input with exactly the four actions", () => {
    const inputs = workflow.slice(
      workflow.indexOf("    inputs:"),
      workflow.indexOf("permissions:"),
    );
    expect(inputs.match(/^ {6}\w+:/gm)).toEqual(["      action:"]);
    expect(inputs).toContain("type: choice");
    expect(inputs.match(/^ {10}- (\w+)$/gm)?.map((line) => line.trim())).toEqual([
      "- seed",
      "- reset",
      "- purge",
      "- cleanup",
    ]);
  });

  it("reads exactly the three Supabase secrets, in the script step only, and never PIN_PEPPER or the extraction key", () => {
    const step = stepContaining(SCRIPT);
    expect(step).toContain("NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}");
    expect(step).toContain(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_PUBLISHABLE_KEY }}",
    );
    expect(step).toContain("SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}");
    // Exactly these three secret references in the whole file: none at job level, none for npm ci.
    expect(workflow.match(SECRET_REF)).toHaveLength(3);
    expect(step.match(SECRET_REF)).toHaveLength(3);
    expect(workflow).not.toContain("PIN_PEPPER");
    expect(workflow).not.toContain("ANTHROPIC_API_KEY");
    expect(workflow).not.toContain("EXTRACTION_MODEL_ID");
  });

  it("takes the owner's mailbox from an environment variable, not a secret", () => {
    const step = stepContaining(SCRIPT);
    expect(step).toContain("DEMO_OWNER_EMAIL: ${{ vars.DEMO_OWNER_EMAIL }}");
    expect(workflow.match(VARS_REF)).toHaveLength(1);
    expect(workflow).not.toContain("secrets.DEMO_OWNER_EMAIL");
  });

  it("runs the script with its explicit staging opt-in and the staging target", () => {
    const step = stepContaining(SCRIPT);
    expect(step).toContain('DEMO_STAGING_OK: "yes"');
    expect(step).toContain('npm run --silent demo -- "${args[@]}"');
    expect(step).toContain("args=(--target staging)");
  });

  it("refuses any project but staging, and missing settings, before the script runs", () => {
    const step = stepContaining(SCRIPT);
    expect(workflow).toContain(`STAGING_PROJECT_REF: ${STAGING_REF}`);
    expect(step).toContain('"$STAGING_PROJECT_REF.supabase.co"');
    expect(step).toContain("::error title=Missing staging settings::");
    expect(step).toContain(
      "for name in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY DEMO_OWNER_EMAIL; do",
    );
    const run = step.indexOf("npm run --silent demo");
    expect(step.indexOf("STAGING_PROJECT_REF.supabase.co")).toBeGreaterThan(-1);
    expect(step.indexOf("STAGING_PROJECT_REF.supabase.co")).toBeLessThan(run);
    expect(step.indexOf("Missing staging settings")).toBeLessThan(run);
  });

  it("compares the exact host, so a look-alike URL, a port or http:// is refused", () => {
    const step = stepContaining(SCRIPT);
    expect(step).toContain('host="${NEXT_PUBLIC_SUPABASE_URL#https://}"');
    expect(step).toContain('host="${host%%/*}"');
    expect(step).toContain('if [ "$host" != "$STAGING_PROJECT_REF.supabase.co" ]; then');
  });

  it("reaches the shell as an environment variable only, never inside run:", () => {
    const step = stepContaining(SCRIPT);
    // The one reference is the env line; nothing of the input is interpolated into a script or a name.
    expect(workflow.match(INPUT_REF)).toHaveLength(1);
    expect(step).toContain("DEMO_ACTION: ${{ inputs.action }}");
    expect(shellOf(step)).not.toContain("${{");
  });

  it("maps the action to exactly four fixed flags and refuses anything else", () => {
    const shell = shellOf(stepContaining(SCRIPT));
    const cases = shell.match(/^ {12}[a-z*]+\) .*$/gm)?.map((line) => line.trim());
    expect(cases).toEqual([
      'seed) flag="" ;;',
      'reset) flag="--reset" ;;',
      'purge) flag="--purge" ;;',
      'cleanup) flag="--cleanup" ;;',
      expect.stringMatching(/^\*\) .*exit 1 ;;$/),
    ]);
    expect(shell).toContain('case "$DEMO_ACTION" in');
    // The flag is checked before the script runs.
    expect(shell.indexOf('case "$DEMO_ACTION" in')).toBeLessThan(
      shell.indexOf("npm run --silent demo"),
    );
  });

  it("prints nothing of its own beyond the script's one JSON line (no tracing, no echo of values)", () => {
    expect(workflow).not.toMatch(/set -x|set -o xtrace/);
    expect(workflow).not.toMatch(
      /echo[^\n]*\$\{?(NEXT_PUBLIC_SUPABASE|SUPABASE_SECRET_KEY|DEMO_OWNER_EMAIL|host)/,
    );
  });

  it("writes only the script's output to the job summary, and keeps its exit code", () => {
    const shell = shellOf(stepContaining(SCRIPT));
    expect(shell).toContain('echo "$output"');
    expect(shell).toContain('>> "$GITHUB_STEP_SUMMARY"');
    expect(shell).toContain('exit "$status"');
  });

  it("runs once at a time without cancelling a run in progress, with a time limit", () => {
    expect(workflow).toMatch(
      /concurrency:\n {2}group: demo-staging\n {2}cancel-in-progress: false/,
    );
    expect(workflow).toMatch(/^ {4}timeout-minutes: 15$/m);
  });

  it("runs npm ci without any secret", () => {
    const install = stepContaining("run: npm ci");
    expect(install).not.toContain("secrets.");
    expect(install).not.toContain("vars.");
    expect(install).not.toContain("env:");
  });
});
