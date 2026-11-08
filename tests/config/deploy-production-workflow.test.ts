import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M25 step 15 (plan §3.1.6, Q190): the production migration job changes the live database, so its safety properties are pinned
// here, mirroring tests/config/deploy-staging-workflow.test.ts. It starts by hand only; the 'production' environment's required
// reviewer approves each run; the release order is migrations first, then promote the Vercel deployment (runbook).
const workflow = readFileSync(
  new URL("../../.github/workflows/deploy-production.yml", import.meta.url),
  "utf8",
);
const STAGING_REF = "wjowhjsfpcdykxwgjipq";
// A real secret reference, as opposed to the step id `secrets` in steps.secrets.outputs.
const SECRET_REF = /\$\{\{\s*secrets\./;
const SECRETS = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_REF"];

/** The YAML text of one step, found by a line it contains, up to the next step. */
function stepContaining(marker: string): string {
  const steps = workflow.slice(workflow.indexOf("    steps:")).split(/\n(?= {6}- )/);
  const step = steps.find((candidate) => candidate.includes(marker));
  if (!step) throw new Error(`no step contains ${marker}`);
  return step;
}

describe("deploy-production workflow", () => {
  it("starts by hand only: no push, no pull request, no schedule, no workflow_run", () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:\s*\n\npermissions:/m);
    expect(workflow).not.toMatch(
      /^\s*(push|pull_request|pull_request_target|schedule|workflow_run):/m,
    );
    expect(workflow.match(/^on:/gm)).toHaveLength(1);
  });

  it("runs from main only", () => {
    expect(workflow).toMatch(/^ {4}if: github\.ref == 'refs\/heads\/main'$/m);
  });

  it("uses the production environment, whose required reviewer approves the run", () => {
    expect(workflow).toMatch(/^ {4}environment: production$/m);
    expect(workflow).not.toContain("environment: staging");
  });

  it("takes the project ref from vars.PRODUCTION_PROJECT_REF and never hardcodes a production ref", () => {
    expect(workflow).toContain("PRODUCTION_PROJECT_REF: ${{ vars.PRODUCTION_PROJECT_REF }}");
    expect(workflow).toContain(`STAGING_PROJECT_REF: ${STAGING_REF}`);
    expect(stepContaining("supabase link")).toContain('--project-ref "$PRODUCTION_PROJECT_REF"');
    expect(workflow.match(/\b[a-z]{20}\b(?=\.supabase\.co)/g) ?? []).toEqual([]);
  });

  it("stops with a named error when the ref is empty, is staging's, or differs from the secret", () => {
    const check = stepContaining("Check the production settings");
    expect(check).toContain('[ -z "$PRODUCTION_PROJECT_REF" ]');
    expect(check).toContain("::error title=No production project::");
    expect(check).toContain('"$PRODUCTION_PROJECT_REF" = "$STAGING_PROJECT_REF"');
    expect(check).toContain("::error title=Staging is not production::");
    expect(check).toContain('"$SUPABASE_PROJECT_REF" != "$PRODUCTION_PROJECT_REF"');
    expect(check).toContain("::error title=Wrong project::");
    // Every one of them fails the job, instead of skipping it as the staging job does for missing secrets.
    expect(check.match(/exit 1/g)?.length).toBeGreaterThanOrEqual(4);
    expect(check).not.toContain("exit 0");
  });

  it("fails by name when a production secret is missing", () => {
    const check = stepContaining("Check the production settings");
    for (const name of SECRETS) expect(check).toContain(`${name}: \${{ secrets.${name} }}`);
    expect(check).toContain("::error title=Missing production secrets::");
    expect(check).toContain("missing: ${missing[*]}");
  });

  it("checks the settings before it checks out or installs anything", () => {
    expect(workflow.indexOf("Check the production settings")).toBeLessThan(
      workflow.indexOf("actions/checkout"),
    );
  });

  it("deploys the commit that was chosen, without keeping the token", () => {
    const checkout = stepContaining("actions/checkout");
    expect(checkout).toContain("persist-credentials: false");
    expect(checkout).toContain("ref: ${{ github.sha }}");
  });

  it("keeps the secrets away from dependency install scripts", () => {
    expect(stepContaining("run: npm ci")).not.toMatch(SECRET_REF);
    const jobEnv = workflow.match(/^ {4}env:\n((?: {6}.*\n)+)/m)?.[1] ?? "";
    expect(jobEnv).toContain("PRODUCTION_PROJECT_REF");
    expect(jobEnv).not.toMatch(SECRET_REF);
  });

  it("pushes migrations only: dry run first, then a plain supabase db push, never the seed or a reset", () => {
    expect(workflow.indexOf("db push --dry-run")).toBeGreaterThan(-1);
    expect(workflow.indexOf("db push --dry-run")).toBeLessThan(workflow.indexOf("db push --yes"));
    expect(stepContaining("db push --dry-run")).toContain("SUPABASE_DB_PASSWORD");
    expect(stepContaining("Apply migrations")).toContain("run: npx supabase db push --yes");
    const code = workflow
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    for (const forbidden of [
      "--include-seed",
      "--include-all",
      "--linked --reset",
      "db reset",
      "db seed",
      "seed.sql",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    const commands = workflow
      .split("\n")
      .filter((line) => line.trim().startsWith("run:") && line.includes("db push"));
    expect(commands.map((line) => line.trim())).toEqual([
      "run: npx supabase db push --dry-run",
      "run: npx supabase db push --yes",
    ]);
  });

  it("never runs two deploys at once and has read-only repository access", () => {
    expect(workflow).toMatch(
      /concurrency:\s*\n\s+group: deploy-production\s*\n\s+cancel-in-progress: false/,
    );
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/);
  });

  it("never echoes a secret or traces commands", () => {
    expect(workflow).not.toContain("set -x");
    expect(workflow).not.toMatch(/echo[^\n]*\$\{?(SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD)/);
  });
});
