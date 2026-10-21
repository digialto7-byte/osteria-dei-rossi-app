import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The staging migration job changes a hosted database, so its safety properties are pinned here.
const workflow = readFileSync(
  new URL("../../.github/workflows/deploy-staging.yml", import.meta.url),
  "utf8",
);
const STAGING_REF = "wjowhjsfpcdykxwgjipq";

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

  it("deploys the commit CI tested, not whatever main points at later", () => {
    expect(workflow).toContain("ref: ${{ github.event.workflow_run.head_sha || github.sha }}");
  });

  it("uses the protected staging environment and only the staging project", () => {
    expect(workflow).toMatch(/^\s+environment: staging$/m);
    expect(workflow).toContain(`STAGING_PROJECT_REF: ${STAGING_REF}`);
    expect(workflow).toContain('"$SUPABASE_PROJECT_REF" != "$STAGING_PROJECT_REF"');
  });

  it("skips with a notice when the staging secrets are missing", () => {
    for (const name of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_REF"]) {
      expect(workflow).toContain(`${name}: \${{ secrets.${name} }}`);
    }
    expect(workflow).toContain("::notice title=Staging deploy skipped::");
    expect(workflow).toContain("steps.secrets.outputs.ready == 'true'");
  });

  it("pushes migrations only: never the fake seed, never a reset", () => {
    expect(workflow).toContain("npx supabase db push");
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
