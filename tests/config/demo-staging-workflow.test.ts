import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReport, formatReport } from "../../scripts/lib/demo/report";

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

  it("takes ONE input, the choice of exactly four actions, and no tenant input (dispatch inputs are not private on a public repo)", () => {
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
    expect(workflow).not.toMatch(/tenant_id/);
    expect(workflow).not.toMatch(/github\.event\.inputs|GITHUB_EVENT_PATH|add-mask|GITHUB_ENV/);
  });

  it("reads exactly four secrets of the staging environment, in the script step only, and never PIN_PEPPER or the extraction key", () => {
    const step = stepContaining(SCRIPT);
    expect(workflow).toMatch(/^\s+environment: staging$/m);
    expect(step).toContain("NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}");
    expect(step).toContain(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_PUBLISHABLE_KEY }}",
    );
    expect(step).toContain("SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}");
    // The tenant id is a secret of the staging environment: the runner masks it, in every log line and in the env header.
    expect(step).toContain("DEMO_TENANT_ID: ${{ secrets.DEMO_TENANT_ID }}");
    // Exactly these four secret references in the whole file: none at job level, none for npm ci.
    expect(workflow.match(SECRET_REF)).toHaveLength(4);
    expect(step.match(SECRET_REF)).toHaveLength(4);
    expect(workflow).not.toContain("PIN_PEPPER");
    expect(workflow).not.toContain("ANTHROPIC_API_KEY");
    expect(workflow).not.toContain("EXTRACTION_MODEL_ID");
  });

  it("needs no mailbox and no other variable: the demo owner is a fake on a reserved domain", () => {
    expect(workflow.match(VARS_REF)).toBeNull();
    expect(workflow).not.toContain("DEMO_OWNER_EMAIL");
  });

  it("holds no tenant name or id: the id comes from a staging environment secret", () => {
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
      "required=(NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY)",
    );
    // The tenant secret is required too, except for cleanup, and named in the same error.
    expect(step).toContain('[ "$DEMO_ACTION" = cleanup ] || required+=(DEMO_TENANT_ID)');
    expect(step).toContain('for name in "${required[@]}"; do');
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
    // The only input is the action (not a client fact). Nothing is interpolated into a script.
    expect(workflow.match(INPUT_REF)).toHaveLength(1);
    expect(step).toContain("DEMO_ACTION: ${{ inputs.action }}");
    expect(shellOf(step)).not.toContain("${{");
  });

  describe("the tenant id never reaches the public log, the summary or the report", () => {
    // A fake id: the real one is never in the repository.
    const ID = "33333333-3333-4333-8333-333333333333";
    const URL_OK = "https://wjowhjsfpcdykxwgjipq.supabase.co";

    /** Runs the script step's shell for real, with a stub `npm` that records its arguments and prints a report. */
    function run(env: Record<string, string>) {
      const dir = mkdtempSync(join(tmpdir(), "demo-run-"));
      const bin = join(dir, "bin");
      mkdirSync(bin);
      const argsFile = join(dir, "args");
      const summary = join(dir, "summary");
      writeFileSync(summary, "");
      writeFileSync(
        join(bin, "npm"),
        `#!/bin/bash\nprintf '%s\\n' "$@" > "${argsFile}"\nprintf '%s' '${formatReport(
          buildReport({
            target: "staging",
            mode: "seed",
            ok: true,
            tenantId: ID,
            counts: { invoice: 5 },
            logins: [],
            alerts: [],
          }),
        )}'\n`,
        { mode: 0o755 },
      );
      const shell = shellOf(stepContaining(SCRIPT))
        .split("\n")
        .slice(1)
        .map((line) => line.replace(/^ {10}/, ""))
        .join("\n");
      let status = 0;
      let stdout = "";
      try {
        stdout = execFileSync("bash", ["-e", "-c", shell], {
          env: {
            PATH: `${bin}:${process.env.PATH ?? ""}`,
            STAGING_PROJECT_REF: "wjowhjsfpcdykxwgjipq",
            DEMO_STAGING_OK: "yes",
            GITHUB_STEP_SUMMARY: summary,
            ...env,
          } as unknown as NodeJS.ProcessEnv,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        const failure = error as { status: number; stdout: string; stderr: string };
        status = failure.status;
        stdout = `${failure.stdout}${failure.stderr}`;
      }
      return {
        status,
        stdout,
        summary: readFileSync(summary, "utf8"),
        args: existsSync(argsFile)
          ? readFileSync(argsFile, "utf8").split("\n").filter(Boolean)
          : null,
      };
    }
    const GOOD = {
      NEXT_PUBLIC_SUPABASE_URL: URL_OK,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      SUPABASE_SECRET_KEY: "test-secret-key",
      DEMO_TENANT_ID: ID,
      DEMO_ACTION: "seed",
    };

    it("the id reaches the script as an argument only; the log and the summary hold the report, which has no id", () => {
      const result = run(GOOD);
      expect(result.status).toBe(0);
      expect(result.args).toEqual([
        "run",
        "--silent",
        "demo",
        "--",
        "--target",
        "staging",
        "--tenant",
        ID,
      ]);
      expect(result.stdout).not.toContain(ID);
      expect(result.summary).not.toContain(ID);
      expect(result.summary).toContain('"invoice":5');
    });

    it("the report builder never prints a tenant id", () => {
      const line = formatReport(
        buildReport({
          target: "staging",
          mode: "seed",
          ok: true,
          tenantId: ID,
          counts: {},
          logins: [],
          alerts: [],
        }),
      );
      expect(line).not.toContain(ID);
      expect(JSON.parse(line)).not.toHaveProperty("tenantId");
    });

    it.each([
      ["a missing secret", { SUPABASE_SECRET_KEY: "" }],
      ["a tenant secret that is not a uuid", { DEMO_TENANT_ID: `${ID}x` }],
      ["a missing tenant secret", { DEMO_TENANT_ID: "" }],
      ["another project", { NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }],
      ["an unknown action", { DEMO_ACTION: "drop" }],
    ])(
      "%s stops before the script runs, and prints neither the id nor the value",
      (_label, change) => {
        const result = run({ ...GOOD, ...change });
        expect(result.status).toBe(1);
        expect(result.args).toBeNull();
        expect(result.stdout).not.toContain(ID);
        expect(result.stdout).not.toContain("test-secret-key");
        expect(result.stdout).not.toContain("abcdefghijklmnopqrst");
      },
    );

    it("a missing tenant secret is named in the missing-settings error", () => {
      const result = run({ ...GOOD, DEMO_TENANT_ID: "" });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("::error title=Missing staging settings::");
      expect(result.stdout).toContain("(missing: DEMO_TENANT_ID)");
    });

    it("cleanup needs no tenant: none is passed", () => {
      const result = run({ ...GOOD, DEMO_ACTION: "cleanup", DEMO_TENANT_ID: "" });
      expect(result.status).toBe(0);
      expect(result.args).toEqual([
        "run",
        "--silent",
        "demo",
        "--",
        "--target",
        "staging",
        "--cleanup",
      ]);
    });

    it("checks the id, skips the check only for cleanup, and the script step never prints it", () => {
      const shell = shellOf(stepContaining(SCRIPT));
      expect(shell).toContain('[[ "$DEMO_TENANT_ID" =~ ^[0-9a-fA-F]{8}-');
      expect(shell).toContain('if [ "$DEMO_ACTION" != "cleanup" ]; then');
      const printing = shell
        .split("\n")
        .filter((line) => /\b(echo|printf|cat)\b|::error/.test(line));
      expect(printing.filter((line) => /\$\{?(DEMO_TENANT_ID|args)/.test(line))).toEqual([]);
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
