import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// CI budget (founder, 2026-10-24, no extra spend): drafts run the cheap job only, the heavy jobs run
// once a pull request is ready and on main, a newer push cancels an older pull request run, and
// docs-only pull requests run nothing. deploy-staging follows a green CI run on main, so main must
// keep running every job.
const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const HEAVY = ["db-races", "supabase", "t1-spike"];
const DRAFT_GATE =
  "if: github.event_name != 'pull_request' || github.event.pull_request.draft == false";

/** The YAML text of one top-level job, up to the next job. */
function job(name: string): string {
  const start = ci.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`no job ${name}`);
  const rest = ci.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z0-9_-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe("CI budget", () => {
  it("runs on pull requests (including ready_for_review) and on pushes to main", () => {
    expect(ci).toMatch(
      /^ {2}pull_request:\n {4}types: \[opened, synchronize, reopened, ready_for_review\]$/m,
    );
    expect(ci).toMatch(/^ {2}push:\n {4}branches: \[main\]$/m);
  });

  it("skips docs-only pull requests, but never pushes to main", () => {
    const pr = ci.slice(ci.indexOf("  pull_request:"), ci.indexOf("  push:"));
    expect(pr).toContain('paths-ignore:\n      - "docs/**"\n      - "**/*.md"');
    const push = ci.slice(ci.indexOf("  push:"), ci.indexOf("\npermissions:"));
    expect(push).not.toContain("paths");
  });

  it("cancels an older run of the same pull request, never a running main run", () => {
    expect(ci).toMatch(
      /^concurrency:\n {2}group: ci-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m,
    );
  });

  it.each(HEAVY)("the heavy job %s skips draft pull requests and always runs on main", (name) => {
    expect(job(name)).toContain(`\n    ${DRAFT_GATE}\n`);
  });

  it("the checks job runs on every pull request, draft or not", () => {
    expect(job("checks")).not.toMatch(/^ {4}if:/m);
  });

  it("gates exactly the three heavy jobs", () => {
    expect(ci.split(DRAFT_GATE)).toHaveLength(HEAVY.length + 1);
  });
});
