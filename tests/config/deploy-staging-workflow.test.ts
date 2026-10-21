import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The staging migration job changes a hosted database, so its safety properties are pinned here.
const workflow = readFileSync(
  new URL("../../.github/workflows/deploy-staging.yml", import.meta.url),
  "utf8",
);
const STAGING_REF = "wjowhjsfpcdykxwgjipq";
// A real secret reference, as opposed to the step id `secrets` in steps.secrets.outputs.
const SECRET_REF = /\$\{\{\s*secrets\./;
const SECRETS = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_REF"];

/** The YAML text of one step, found by a line it contains, up to the next step. */
function stepContaining(marker: string): string {
  const steps = workflow.split(/\n(?=\s+- (?:name|if|uses|run):)/);
  const step = steps.find((candidate) => candidate.includes(marker));
  if (!step) throw new Error(`no step contains ${marker}`);
  return step;
}

describe("deploy-staging workflow", () => {
  it("runs only after CI passed on main, or by hand", () => {
    expect(workflow).toMatch(
      /workflow_run:\s*\n\s+workflows: \[CI\]\s*\n\s+types: \[completed\]\s*\n\s+branches: \[main\]/,
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s*(push|pull_request):/m);
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
  });

  it("ignores CI runs from pull requests, including a fork's branch named main", () => {
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain(
      "github.event.workflow_run.head_repository.full_name == github.repository",
    );
  });

  it("allows manual runs from main only", () => {
    expect(workflow).toContain(
      "(github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')",
    );
  });

  it("deploys the commit CI tested, not whatever main points at later", () => {
    expect(workflow).toContain("ref: ${{ github.event.workflow_run.head_sha || github.sha }}");
    expect(workflow).toContain("persist-credentials: false");
  });

  it("uses the protected staging environment and only the staging project", () => {
    expect(workflow).toMatch(/^\s+environment: staging$/m);
    expect(workflow).toContain(`STAGING_PROJECT_REF: ${STAGING_REF}`);
    expect(workflow).toContain('"$SUPABASE_PROJECT_REF" != "$STAGING_PROJECT_REF"');
    expect(stepContaining("supabase link")).toContain('--project-ref "$STAGING_PROJECT_REF"');
  });

  it("skips with a notice when the staging secrets are missing", () => {
    const check = stepContaining("Check the staging secrets");
    for (const name of SECRETS) expect(check).toContain(`${name}: \${{ secrets.${name} }}`);
    expect(check).toContain("::notice title=Staging deploy skipped::");
    expect(workflow).toContain("steps.secrets.outputs.ready == 'true'");
  });

  it("keeps the secrets away from dependency install scripts", () => {
    expect(stepContaining("run: npm ci")).not.toMatch(SECRET_REF);
    // No job-level secrets either: they would reach every step.
    const jobEnv = workflow.slice(workflow.indexOf("    env:"), workflow.indexOf("    steps:"));
    expect(jobEnv).not.toMatch(SECRET_REF);
  });

  it("pushes migrations only: dry run first, never the fake seed, never a reset", () => {
    expect(stepContaining("db push --dry-run")).toContain("SUPABASE_DB_PASSWORD");
    expect(stepContaining("Apply migrations")).toContain("run: npx supabase db push --yes");
    expect(workflow).not.toContain("--include-seed");
    expect(workflow).not.toMatch(/db reset/);
  });

  it("never runs two deploys at once and has read-only repository access", () => {
    expect(workflow).toMatch(
      /concurrency:\s*\n\s+group: deploy-staging\s*\n\s+cancel-in-progress: false/,
    );
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/);
  });
});
