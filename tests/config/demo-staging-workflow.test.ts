import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("takes two inputs: a choice of exactly four actions, and the tenant id", () => {
    const inputs = workflow.slice(
      workflow.indexOf("    inputs:"),
      workflow.indexOf("permissions:"),
    );
    expect(inputs.match(/^ {6}\w+:/gm)).toEqual(["      action:", "      tenant_id:"]);
    const tenant = inputs.slice(inputs.indexOf("      tenant_id:"));
    expect(tenant).toContain("type: string");
    expect(tenant).toContain("required: false");
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

  it("needs no mailbox and no other variable: the demo owner is a fake on a reserved domain", () => {
    expect(workflow.match(VARS_REF)).toBeNull();
    expect(workflow).not.toContain("DEMO_OWNER_EMAIL");
  });

  it("holds no tenant name or id: a client fact is typed into the run form", () => {
    expect(workflow).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(workflow).not.toMatch(/rossi/i);
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
      "for name in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY; do",
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

  it("reaches the shell as environment variables only, never inside run:", () => {
    const step = stepContaining(SCRIPT);
    // The one expression that reads an input is the action (not a client fact). The tenant id is never an expression: the
    // runner prints an `env:` header with every value of a step before the step runs, and that line would be a public log.
    expect(workflow.match(INPUT_REF)).toHaveLength(1);
    expect(step).toContain("DEMO_ACTION: ${{ inputs.action }}");
    expect(workflow).not.toMatch(/\$\{\{[^}]*tenant_id/);
    expect(workflow).not.toMatch(/^\s+DEMO_TENANT_ID:/m);
    expect(shellOf(step)).not.toContain("${{");
  });

  describe("the tenant id stays out of the public log", () => {
    const steps = () => workflow.slice(workflow.indexOf("    steps:")).split(/\n(?= {6}- )/);
    const mask = () => steps()[1]!;
    const script = () => {
      const body = shellOf(mask()).split("\n").slice(1);
      return body.map((line) => line.replace(/^ {10}/, "")).join("\n");
    };
    const run = (event: unknown) => {
      const dir = mkdtempSync(join(tmpdir(), "demo-mask-"));
      const eventPath = join(dir, "event.json");
      const envPath = join(dir, "env");
      writeFileSync(eventPath, JSON.stringify(event));
      writeFileSync(envPath, "");
      const stdout = execFileSync("bash", ["-eo", "pipefail", "-c", script()], {
        env: {
          PATH: process.env.PATH ?? "",
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_ENV: envPath,
        } as unknown as NodeJS.ProcessEnv,
        encoding: "utf8",
      });
      return { stdout, env: readFileSync(envPath, "utf8") };
    };
    // A fake id: the real one is never in the repository.
    const ID = "33333333-3333-4333-8333-333333333333";

    it("the mask step is the very first step, before checkout, with no env: block and no expression", () => {
      expect(mask()).toContain("Mask the tenant id");
      expect(steps()[0]).not.toMatch(/uses:|run:/);
      expect(mask()).not.toMatch(/^\s+env:/m);
      expect(mask()).not.toContain("${{");
      expect(workflow.indexOf("- name: Mask the tenant id")).toBeLessThan(
        workflow.indexOf("- uses: actions/checkout"),
      );
      expect(workflow.indexOf("- name: Mask the tenant id")).toBeLessThan(
        workflow.indexOf("run: npm ci"),
      );
    });

    it("reads the input from the event file, masks it before anything else, and writes it to GITHUB_ENV only after", () => {
      const text = script();
      expect(text).toContain(`jq -r '.inputs.tenant_id // ""' "$GITHUB_EVENT_PATH"`);
      expect(text.indexOf("::add-mask::")).toBeGreaterThan(-1);
      expect(text.indexOf("::add-mask::")).toBeLessThan(text.indexOf('>> "$GITHUB_ENV"'));
      expect(text.indexOf("jq -r")).toBeLessThan(text.indexOf("::add-mask::"));
    });

    it("run for real: the first line printed is the mask command, the value is then in GITHUB_ENV, nothing else is printed", () => {
      const { stdout, env } = run({ inputs: { action: "seed", tenant_id: ID } });
      expect(stdout.split("\n").filter(Boolean)).toEqual([`::add-mask::${ID}`]);
      expect(env).toBe(`DEMO_TENANT_ID=${ID}\n`);
    });

    it("run for real: no id (cleanup) masks nothing and writes nothing", () => {
      for (const inputs of [{ action: "cleanup" }, { action: "cleanup", tenant_id: "" }]) {
        const { stdout, env } = run({ inputs });
        expect(stdout).toBe("");
        expect(env).toBe("");
      }
    });

    it("run for real: a value that is not a uuid is masked too, but never reaches GITHUB_ENV (no injection)", () => {
      const evil = `${ID}\nPATH=/tmp/evil`;
      const { stdout, env } = run({ inputs: { action: "seed", tenant_id: evil } });
      expect(stdout).toContain(`::add-mask::${ID}`);
      expect(stdout).toContain("::add-mask::PATH=/tmp/evil");
      expect(env).toBe("");
    });

    it("the script step takes the id from GITHUB_ENV, checks it, and never prints it; the summary gets only the script's output", () => {
      const step = stepContaining(SCRIPT);
      const shell = shellOf(step);
      expect(step).not.toContain("DEMO_TENANT_ID: ");
      expect(shell).toContain('[[ "$DEMO_TENANT_ID" =~ ^[0-9a-fA-F]{8}-');
      expect(shell).toContain('args+=(--tenant "$DEMO_TENANT_ID")');
      // Every line that prints (echo, printf, cat, ::error) is free of the variable; the summary lines print only $output.
      const printing = shell
        .split("\n")
        .filter((line) => /\b(echo|printf|cat)\b|::error/.test(line));
      expect(
        printing.filter((line) => line.includes("DEMO_TENANT_ID") || line.includes("args")),
      ).toEqual([]);
      const summary = shell.slice(shell.indexOf("{\n"), shell.indexOf('>> "$GITHUB_STEP_SUMMARY"'));
      expect(summary.match(/echo [^\n]*/g)).toEqual([
        "echo '```json'",
        'echo "$output"',
        "echo '```'",
      ]);
      expect(shell).not.toMatch(/set -x|set -o xtrace/);
    });
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
      /echo[^\n]*\$\{?(NEXT_PUBLIC_SUPABASE|SUPABASE_SECRET_KEY|DEMO_TENANT_ID|host)/,
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
    expect(install).not.toContain("inputs.");
    expect(install).not.toContain("tenant");
    expect(install).not.toContain("env:");
  });
});
