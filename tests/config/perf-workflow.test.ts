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

  it("reads the three Supabase secrets and the bypass secret in the run step only", () => {
    const step = stepContaining(SCRIPT);
    expect(step).toContain("NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}");
    expect(step).toContain(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_PUBLISHABLE_KEY }}",
    );
    expect(step).toContain("SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}");
    // M25: the staging host is behind Vercel Authentication, so the run step also passes the bypass secret to the script.
    expect(step).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
    );
    // Exactly these four references in the whole file: none at job level, none for npm ci.
    expect(workflow.match(SECRET_REF)).toHaveLength(4);
    expect(step.match(SECRET_REF)).toHaveLength(4);
  });

  it("never echoes the bypass secret, and does not use the PIN pepper", () => {
    expect(workflow).not.toMatch(/echo[^\n]*VERCEL_AUTOMATION_BYPASS_SECRET/);
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

  it("sends the staging session only to the configured staging app host, compared exactly, before the script runs", () => {
    const step = stepContaining(SCRIPT);
    // The allow-list is one repository variable of the staging environment; it is read through the environment.
    expect(step).toContain("STAGING_APP_HOST: ${{ vars.STAGING_APP_HOST }}");
    expect(workflow.match(/\$\{\{\s*vars\./g)).toHaveLength(1);
    const script = step.slice(step.indexOf("run: |"));
    expect(script).not.toContain("${{");
    for (const line of [
      '[ -z "$STAGING_APP_HOST" ]',
      'app_host="${BASE_URL#https://}"',
      'app_host="${app_host%%/*}"',
      'if [ "$app_host" != "$STAGING_APP_HOST" ]; then',
    ]) {
      expect(step, line).toContain(line);
      expect(step.indexOf(line), line).toBeLessThan(step.indexOf(`npx tsx ${SCRIPT}`));
    }
    // An exact host, never a pattern: no case glob, no suffix or prefix match on the address.
    expect(script).not.toMatch(/\*\.vercel\.app|=~|\$\{BASE_URL%/);
  });

  it("refuses an unset allow-list instead of running against any address", () => {
    const step = stepContaining(SCRIPT);
    expect(step).toContain("::error title=Staging host not configured::");
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

// AT7 for the owner dashboard (M22 step 18): the Slow 4G timing of the "Ieri" tile. Same safety properties as the order-entry run:
// by hand, from main, in the staging environment, secrets in the run step only, exact host checks before the script.
describe("perf-dashboard-4g workflow", () => {
  const file = new URL("../../.github/workflows/perf-dashboard-4g.yml", import.meta.url);
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const script = "scripts/perf/dashboard-4g.ts";

  function stepOf(marker: string): string {
    const steps = text.slice(text.indexOf("    steps:")).split(/\n(?= {6}- )/);
    const step = steps.find((candidate) => candidate.includes(marker));
    if (!step) throw new Error(`no step contains ${marker}`);
    return step;
  }

  it("exists and is started by hand only, from main only", () => {
    expect(text).not.toBe("");
    expect(text).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(text).not.toMatch(/^\s*(push|pull_request|pull_request_target|schedule|workflow_run):/m);
    expect(text).toContain("if: github.ref == 'refs/heads/main'");
  });

  it("uses the protected staging environment, read-only token, no persisted credentials", () => {
    expect(text).toMatch(/^\s+environment: staging$/m);
    expect(text).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(text).toContain("persist-credentials: false");
  });

  it("reads the three Supabase secrets and the bypass secret in the run step only, and nothing else secret", () => {
    const step = stepOf(script);
    expect(step).toContain("NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}");
    expect(step).toContain(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_PUBLISHABLE_KEY }}",
    );
    expect(step).toContain("SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}");
    // M25: the staging host is behind Vercel Authentication (see the order-entry workflow's test above).
    expect(step).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
    );
    expect(text.match(SECRET_REF)).toHaveLength(4);
    expect(step.match(SECRET_REF)).toHaveLength(4);
    expect(text).not.toMatch(/echo[^\n]*VERCEL_AUTOMATION_BYPASS_SECRET/);
    expect(text).not.toContain("PIN_PEPPER");
  });

  it("hands the address to the script through the environment, never into the shell text", () => {
    const step = stepOf(script);
    expect(step).toContain("BASE_URL: ${{ inputs.base_url }}");
    const body = step.slice(step.indexOf("run: |"));
    expect(body).not.toContain("${{");
    expect(body).toContain('--base-url "$BASE_URL"');
    expect(text.match(/\$\{\{\s*inputs\./g)).toHaveLength(1);
  });

  it("checks the project, the https address, the secrets and the exact app host before the script, with the opt-in", () => {
    const step = stepOf(script);
    const call = step.indexOf(`npx tsx ${script}`);
    expect(call).toBeGreaterThan(-1);
    expect(step).toContain('PERF_STAGING_OK: "yes"');
    expect(text).toContain(`STAGING_PROJECT_REF: ${STAGING_REF}`);
    expect(step).toContain("STAGING_APP_HOST: ${{ vars.STAGING_APP_HOST }}");
    expect(text.match(/\$\{\{\s*vars\./g)).toHaveLength(1);
    for (const guard of [
      '"$STAGING_PROJECT_REF.supabase.co"',
      "::error title=Missing staging secrets::",
      "https://*)",
      '[ -z "$STAGING_APP_HOST" ]',
      'if [ "$app_host" != "$STAGING_APP_HOST" ]; then',
    ]) {
      expect(step, guard).toContain(guard);
      expect(step.indexOf(guard), guard).toBeLessThan(call);
    }
    expect(step).not.toMatch(/\*\.vercel\.app|=~|\$\{BASE_URL%/);
  });

  it("installs the Chromium browser, without any secret in that step", () => {
    const install = stepOf("playwright install");
    expect(install).toContain("npx playwright install --with-deps chromium");
    expect(install.match(SECRET_REF)).toBeNull();
    expect(text.indexOf("playwright install")).toBeLessThan(text.indexOf(`npx tsx ${script}`));
  });

  it("prints only the script's report, one run at a time, with a time limit", () => {
    expect(text).not.toMatch(/set -x|set -o xtrace/);
    expect(text).not.toMatch(
      /echo[^\n]*\$\{?(NEXT_PUBLIC_SUPABASE|SUPABASE_SECRET_KEY|BASE_URL|host)/,
    );
    expect(stepOf(script)).toContain('>> "$GITHUB_STEP_SUMMARY"');
    expect(text).toMatch(
      /concurrency:\n {2}group: perf-dashboard-4g\n {2}cancel-in-progress: false/,
    );
    expect(text).toMatch(/^ {4}timeout-minutes: \d+$/m);
  });

  it("is not run by CI", () => {
    const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
    expect(ci).not.toContain("perf/dashboard-4g");
    expect(ci).not.toContain("perf-dashboard-4g");
  });
});
