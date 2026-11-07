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
    // PRODUCTION_PROJECT_REF is read by the gate step only (it is a variable, not a database secret).
    expect(steps.filter((st) => st.includes("PRODUCTION_PROJECT_REF"))).toEqual([
      stepContaining("id: arm"),
    ]);
    expect(stepContaining("run: npm ci")).not.toMatch(SECRET_REF);
  });

  it("starts an empty local stack from config.toml only, before the restore", () => {
    const stack = stepContaining('--workdir "$RUNNER_TEMP/restore"');
    expect(stack).toContain('cp supabase/config.toml "$RUNNER_TEMP/restore/supabase/config.toml"');
    expect(stack).not.toMatch(/cp .*migrations|cp .*seed/);
    // config.toml names the e-mail templates by path (auth.email.template.*.content_path, relative to the work directory), and
    // `supabase start` refuses a config whose template is missing (run 42091422466).
    expect(stack).toContain('cp -R supabase/templates "$RUNNER_TEMP/restore/supabase/templates"');
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
    expect(cleanup).toContain("if: always() && steps.arm.outputs.armed == 'true'");
    expect(cleanup).toContain('rm -rf "$RUNNER_TEMP/restore" "$RUNNER_TEMP/restore-files"');
    expect(indexOf("supabase stop --no-backup")).toBeGreaterThan(
      indexOf("scripts/backup/restore-check.ts"),
    );
    // The stack was started with --workdir, so it is stopped with the same one, before that directory is removed.
    const stop = 'npx supabase stop --no-backup --workdir "$RUNNER_TEMP/restore" || true';
    expect(cleanup).toContain(stop);
    expect(cleanup.indexOf(stop)).toBeLessThan(cleanup.indexOf('rm -rf "$RUNNER_TEMP/restore"'));
  });

  it("opens or comments on the backup-failure issue with the run link only, as the last step", () => {
    const issue = stepContaining("gh issue");
    expect(issue).toContain("if: failure() && steps.arm.outputs.armed == 'true'");
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

  describe("arming (the restore check stays quiet until PRODUCTION_PROJECT_REF is set)", () => {
    const gateAt = indexOf("id: arm");
    const gate = steps[gateAt]!;
    const armedIf = "steps.arm.outputs.armed == 'true'";

    it("starts with a gate step 'arm' that reads vars.PRODUCTION_PROJECT_REF and sets the armed output", () => {
      expect(gate.trim().startsWith("- name:")).toBe(true);
      expect(steps.slice(0, gateAt).map((x) => x.trim())).toEqual(["steps:"]);
      expect(gate).toContain("id: arm");
      expect(gate).toContain("vars.PRODUCTION_PROJECT_REF");
      expect(gate).toContain('echo "armed=true" >> "$GITHUB_OUTPUT"');
      expect(gate).toContain('echo "armed=false" >> "$GITHUB_OUTPUT"');
      expect(gate).not.toMatch(SECRET_REF);
    });

    it("unarmed: the gate writes the notice, exits successfully and never fails", () => {
      expect(gate).toContain(
        "::notice title=Backups not armed::backups not armed: PRODUCTION_PROJECT_REF is not set",
      );
      expect(gate).not.toMatch(/exit [1-9]/);
      expect(gate).not.toContain("::error");
    });

    it("only a production run depends on the variable: a staging dispatch stays armed", () => {
      expect(gate).toContain('"$TARGET" = staging');
    });

    it("every step after the gate, the cleanup and the issue step included, is conditioned on the armed output", () => {
      expect(steps.length).toBeGreaterThan(2);
      for (const step of steps.slice(gateAt + 1)) {
        expect(step, step.split("\n")[0]).toContain(armedIf);
        expect(step, step.split("\n")[0]).toMatch(
          /^ {8}if: .*steps\.arm\.outputs\.armed == 'true'$/m,
        );
      }
    });

    it("the issue step can only run when armed, and never on its own failure() alone", () => {
      const issue = stepContaining("gh issue");
      expect(issue).toContain(`if: failure() && ${armedIf}`);
      expect(issue).not.toMatch(/^ {8}if: failure\(\)$/m);
    });
  });
});
