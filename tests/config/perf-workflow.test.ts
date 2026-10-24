import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// AT7's timing run (M18 step 17) writes fake data into the hosted staging project with its secret key, so its safety
// properties are pinned here, as for the T1 spike (t1-staging-workflow.test.ts). Only the founder starts it, once, from
// main, after the M18 merge, and approves the `staging` environment.
const path = new URL("../../.github/workflows/perf-order-entry.yml", import.meta.url);
const workflow = existsSync(path) ? readFileSync(path, "utf8") : "";
const STAGING_REF = "wjowhjsfpcdykxwgjipq";
const SECRET_REF = /\$\{\{\s*secrets\./g;
const SCRIPT = "scripts/perf/order-entry.ts";

/** The YAML text of one step, found by a line it contains, up to the next step. */
function stepContaining(marker: string): string {
  const steps = workflow.slice(workflow.indexOf("    steps:")).split(/\n(?= {6}- )/);
  const step = steps.find((candidate) => candidate.includes(marker));
  if (!step) throw new Error(`no step contains ${marker}`);
  return step;
}

describe("perf-order-entry workflow", () => {
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

  it("takes the app address as a required text input", () => {
    expect(workflow).toMatch(/inputs:\n {6}base_url:\n(?: {8}.*\n)*? {8}required: true/);
    expect(workflow).toMatch(/base_url:\n(?: {8}.*\n)*? {8}type: string/);
  });

  it("uses the protected staging environment, read-only token, no persisted credentials", () => {
    expect(workflow).toMatch(/^\s+environment: staging$/m);
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(workflow).toContain("persist-credentials: false");
  });

  it("reads the three Supabase secrets in the run step only", () => {
    const step = stepContaining(SCRIPT);
    expect(step).toContain("NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}");
    expect(step).toContain(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_PUBLISHABLE_KEY }}",
    );
    expect(step).toContain("SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}");
    // Exactly these three references in the whole file: none at job level, none for npm ci.
    expect(workflow.match(SECRET_REF)).toHaveLength(3);
    expect(step.match(SECRET_REF)).toHaveLength(3);
  });

  it("does not use the deployment-protection bypass secret or the PIN pepper (variant V6 is not in force)", () => {
    expect(workflow).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(workflow).not.toContain("PIN_PEPPER");
  });

  it("hands the address to the script through the environment, never into the shell text", () => {
    const step = stepContaining(SCRIPT);
    expect(step).toContain("BASE_URL: ${{ inputs.base_url }}");
    const script = step.slice(step.indexOf("run: |"));
    expect(script).not.toContain("${{");
    expect(script).toContain('--base-url "$BASE_URL"');
    expect(workflow.match(/\$\{\{\s*inputs\./g)).toHaveLength(1);
  });

  it("runs the script with its explicit staging opt-in, after the checks", () => {
    const step = stepContaining(SCRIPT);
    expect(step).toContain('PERF_STAGING_OK: "yes"');
    expect(step).toContain(`npx tsx ${SCRIPT}`);
  });

  it("refuses any project but staging, a non-https address and missing secrets, before the script runs", () => {
    const step = stepContaining(SCRIPT);
    expect(workflow).toContain(`STAGING_PROJECT_REF: ${STAGING_REF}`);
    const call = step.indexOf(`npx tsx ${SCRIPT}`);
    for (const guard of [
      '"$STAGING_PROJECT_REF.supabase.co"',
      "::error title=Missing staging secrets::",
      "https://*)",
    ]) {
      expect(step, guard).toContain(guard);
      expect(step.indexOf(guard), guard).toBeLessThan(call);
    }
  });

  it("compares the exact host, so a look-alike URL, a port or http:// is refused", () => {
    const step = stepContaining(SCRIPT);
    expect(step).toContain('host="${NEXT_PUBLIC_SUPABASE_URL#https://}"');
    expect(step).toContain('host="${host%%/*}"');
    expect(step).toContain('if [ "$host" != "$STAGING_PROJECT_REF.supabase.co" ]; then');
  });

  it("prints only the script's report: no tracing, no echo of values", () => {
    expect(workflow).not.toMatch(/set -x|set -o xtrace/);
    expect(workflow).not.toMatch(
      /echo[^\n]*\$\{?(NEXT_PUBLIC_SUPABASE|SUPABASE_SECRET_KEY|BASE_URL|host)/,
    );
    const step = stepContaining(SCRIPT);
    expect(step).toContain('>> "$GITHUB_STEP_SUMMARY"');
  });

  it("runs once at a time without cancelling a run in progress, with a time limit", () => {
    expect(workflow).toMatch(
      /concurrency:\n {2}group: perf-order-entry\n {2}cancel-in-progress: false/,
    );
    expect(workflow).toMatch(/^ {4}timeout-minutes: \d+$/m);
  });

  it("is the only workflow that runs the script, and CI never does", () => {
    const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
    expect(ci).not.toContain("perf/order-entry");
    expect(ci).not.toContain("perf-order-entry");
  });
});
