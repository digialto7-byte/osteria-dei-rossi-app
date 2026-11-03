import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M25 step 14 (plan §3.1.5.2, Q183, Q195): the weekly restore check. It reads Drive and the runner only, and never touches the
// production database.
const workflow = readFileSync(
  new URL("../../.github/workflows/backup-restore-weekly.yml", import.meta.url),
  "utf8",
);
const SECRET_REF = /\$\{\{\s*secrets\./;
const steps = workflow.slice(workflow.indexOf("    steps:")).split(/\n(?= {6}- )/);
function stepContaining(marker: string): string {
  const step = steps.find((s) => s.includes(marker));
  if (!step) throw new Error(`no step contains ${marker}`);
  return step;
}
const indexOf = (marker: string) => steps.findIndex((s) => s.includes(marker));

describe("backup-restore-weekly workflow", () => {
  it("runs on Monday at 04:00 UTC and by hand with a staging or production target", () => {
    expect(workflow).toMatch(/schedule:\n\s+- cron: "0 4 \* \* 1"\n/);
    expect(workflow.match(/cron:/g)).toHaveLength(1);
    expect(workflow).toMatch(
      /workflow_dispatch:\n\s+inputs:\n\s+target:[\s\S]*?type: choice[\s\S]*?options:\n\s+- production\n\s+- staging/,
    );
    expect(workflow).not.toMatch(/^\s*(push|pull_request):/m);
  });

  it("runs from main only, with the same environments as the daily backup", () => {
    expect(workflow).toMatch(/^ {4}if: github\.ref == 'refs\/heads\/main'$/m);
    expect(workflow).toMatch(
      /^ {4}environment: \$\{\{ inputs\.target == 'staging' && 'staging' \|\| 'production-backup' \}\}$/m,
    );
  });

  it("has exactly contents read and issues write, and one run at a time", () => {
    const block = /^permissions:\n((?: {2}.*\n)+)/m.exec(workflow)?.[1] ?? "";
    expect(
      block
        .trim()
        .split("\n")
        .map((l) => l.trim())
        .sort(),
    ).toEqual(["contents: read", "issues: write"]);
    expect(workflow).toMatch(
      /concurrency:\n\s+group: backup-restore-weekly\n\s+cancel-in-progress: false/,
    );
  });

  it("references the three Drive and passphrase secrets in the restore step only, and no database secret", () => {
    const restore = stepContaining("scripts/backup/restore-check.ts");
    for (const name of [
      "BACKUP_DRIVE_SA_JSON",
      "BACKUP_DRIVE_FOLDER_ID",
      "BACKUP_ENCRYPTION_PASSPHRASE",
    ]) {
      expect(restore).toContain(`${name}: \${{ secrets.${name} }}`);
    }
    for (const step of steps) {
      expect(SECRET_REF.test(step), step.split("\n")[0]).toBe(step === restore);
    }
    expect(workflow).not.toContain("SUPABASE_DB_URL");
    expect(workflow).not.toContain("SUPABASE_URL");
    expect(workflow).not.toContain("PRODUCTION_PROJECT_REF");
    expect(stepContaining("run: npm ci")).not.toMatch(SECRET_REF);
  });

  it("starts an empty local stack from config.toml only, before the restore", () => {
    const stack = stepContaining('--workdir "$RUNNER_TEMP/restore"');
    expect(stack).toContain('cp supabase/config.toml "$RUNNER_TEMP/restore/supabase/config.toml"');
    expect(stack).not.toMatch(/cp .*migrations|cp .*seed/);
    expect(indexOf('--workdir "$RUNNER_TEMP/restore"')).toBeLessThan(
      indexOf("scripts/backup/restore-check.ts"),
    );
  });

  it("restores the newest copy of the target from Drive and requires users in it", () => {
    const restore = stepContaining("scripts/backup/restore-check.ts");
    expect(restore).toContain('--from-drive "$TARGET"');
    expect(restore).toContain('--work "$RUNNER_TEMP/restore-files"');
    expect(restore).toContain("--require-nonzero auth.users");
    expect(restore).not.toContain("--file");
  });

  it("always stops the stack and removes the files", () => {
    const cleanup = stepContaining("supabase stop --no-backup");
    expect(cleanup).toContain("if: always()");
    expect(cleanup).toContain('rm -rf "$RUNNER_TEMP/restore" "$RUNNER_TEMP/restore-files"');
    expect(indexOf("supabase stop --no-backup")).toBeGreaterThan(
      indexOf("scripts/backup/restore-check.ts"),
    );
  });

  it("opens or comments on the backup-failure issue with the run link only, as the last step", () => {
    const issue = stepContaining("gh issue");
    expect(issue).toContain("if: failure()");
    expect(issue).toContain("backup-failure");
    expect(issue).toContain("GH_TOKEN: ${{ github.token }}");
    expect(issue).toContain(
      "RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
    );
    expect(issue.slice(issue.indexOf("run:"))).not.toContain("${{");
    expect(issue).not.toMatch(SECRET_REF);
    expect(indexOf("gh issue")).toBe(steps.length - 1);
  });

  it("does not trace commands, uploads no artifact and does not keep the checkout token", () => {
    expect(workflow).not.toContain("set -x");
    expect(workflow).not.toContain("upload-artifact");
    expect(stepContaining("actions/checkout")).toContain("persist-credentials: false");
  });
});
