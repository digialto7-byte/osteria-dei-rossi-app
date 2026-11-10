import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M25 step 13 (plan §3.1.5.1, Q181, Q182, Q195): the daily encrypted dump of the production database to Drive. It handles
// production data and secrets, so its safety properties are pinned here.
const workflow = readFileSync(
  new URL("../../.github/workflows/backup-daily.yml", import.meta.url),
  "utf8",
);
const STAGING_REF = "wjowhjsfpcdykxwgjipq";
const SECRET_REF = /\$\{\{\s*secrets\./;

const steps = workflow.slice(workflow.indexOf("    steps:")).split(/\n(?= {6}- )/);
/** The step containing a marker. */
function stepContaining(marker: string): string {
  const step = steps.find((s) => s.includes(marker));
  if (!step) throw new Error(`no step contains ${marker}`);
  return step;
}
const indexOf = (marker: string) => steps.findIndex((s) => s.includes(marker));

describe("backup-daily workflow", () => {
  it("runs daily at 02:15 UTC and by hand with a staging or production target", () => {
    expect(workflow).toMatch(/schedule:\n\s+- cron: "15 2 \* \* \*"\n/);
    expect(workflow.match(/cron:/g)).toHaveLength(1);
    expect(workflow).toMatch(
      /workflow_dispatch:\n\s+inputs:\n\s+target:[\s\S]*?type: choice[\s\S]*?options:\n\s+- production\n\s+- staging/,
    );
    expect(workflow).not.toMatch(/^\s*(push|pull_request):/m);
  });

  it("runs from main only", () => {
    expect(workflow).toMatch(/^ {4}if: github\.ref == 'refs\/heads\/main'$/m);
  });

  it("uses the staging environment for a staging dispatch, production-backup otherwise", () => {
    expect(workflow).toMatch(
      /^ {4}environment: \$\{\{ inputs\.target == 'staging' && 'staging' \|\| 'production-backup' \}\}$/m,
    );
  });

  it("has exactly contents read and issues write", () => {
    const block = /^permissions:\n((?: {2}.*\n)+)/m.exec(workflow)?.[1] ?? "";
    expect(
      block
        .trim()
        .split("\n")
        .map((l) => l.trim())
        .sort(),
    ).toEqual(["contents: read", "issues: write"]);
  });

  it("never runs two backups at once and never cancels one", () => {
    expect(workflow).toMatch(/concurrency:\n\s+group: backup-daily\n\s+cancel-in-progress: false/);
  });

  it("takes the project ref from vars.PRODUCTION_PROJECT_REF, or staging's for a staging dispatch", () => {
    expect(workflow).toContain(`STAGING_PROJECT_REF: ${STAGING_REF}`);
    expect(workflow).toContain(
      "PROJECT_REF: ${{ inputs.target == 'staging' && '" +
        STAGING_REF +
        "' || vars.PRODUCTION_PROJECT_REF }}",
    );
    const guard = stepContaining("Check the project ref");
    expect(guard).toContain('[ -z "$PROJECT_REF" ]');
    expect(guard).toContain("PRODUCTION_PROJECT_REF");
    expect(guard).toContain('"$PROJECT_REF" = "$STAGING_PROJECT_REF"');
    expect(guard).not.toMatch(SECRET_REF);
    expect(indexOf("Check the project ref")).toBeLessThan(indexOf("actions/checkout"));
    // dump.ts runs assertProjectRef on the DB URL and the API URL with this ref.
    expect(stepContaining("scripts/backup/dump.ts")).toContain('--ref "$PROJECT_REF"');
  });

  it("checks the secrets by name before the dump, and the scripts report missing names", () => {
    const dump = stepContaining("scripts/backup/dump.ts");
    for (const name of ["SUPABASE_DB_URL", "SUPABASE_URL", "BACKUP_ENCRYPTION_PASSPHRASE"]) {
      expect(dump).toContain(`${name}: \${{ secrets.${name} }}`);
    }
    expect(dump).toMatch(
      /for name in .*SUPABASE_DB_URL.*SUPABASE_URL.*BACKUP_ENCRYPTION_PASSPHRASE/,
    );
    expect(dump).toContain("::error title=Missing backup settings::");
    expect(dump).toContain("missing: ${missing[*]}");
  });

  it("uses a secret only in the dump, upload, keep-alive and invoice-files steps, never in npm ci", () => {
    for (const step of steps) {
      const uses = SECRET_REF.test(step);
      const allowed = [
        "scripts/backup/dump.ts",
        "scripts/backup/upload.ts",
        "scripts/backup/keepalive.ts",
        "scripts/backup/files.ts",
      ];
      expect(uses, step.split("\n")[0]).toBe(allowed.some((a) => step.includes(a)));
    }
    expect(stepContaining("run: npm ci")).not.toMatch(SECRET_REF);
    const jobEnv = /^ {4}env:\n((?: {6}.*\n)+)/m.exec(workflow)?.[1] ?? "";
    expect(jobEnv).not.toMatch(SECRET_REF);
  });

  describe("invoice files step (ADR-034, F8)", () => {
    const files = () => stepContaining("scripts/backup/files.ts");
    const armedIf = "        if: steps.arm.outputs.armed == 'true'";

    it("is the step 'Back up the invoice files', armed, and the only one that sees SUPABASE_SECRET_KEY (condition 1)", () => {
      const step = files();
      expect(step).toContain("- name: Back up the invoice files");
      expect(step).toContain(`\n${armedIf}\n`);
      expect(step).toContain("SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}");
      for (const s of steps) {
        expect(s.includes("SUPABASE_SECRET_KEY"), s.split("\n")[0]).toBe(s === step);
      }
      // Not in the workflow or job env: no YAML line before `steps:` (comments aside) names it.
      const head = workflow
        .slice(0, workflow.indexOf("    steps:"))
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("#"))
        .join("\n");
      expect(head).not.toContain("SUPABASE_SECRET_KEY");
    });

    it("never echoes or expands the secret key: it appears as the env entry and in the name check only (condition 1)", () => {
      const step = files();
      const lines = step.split("\n").filter((l) => l.includes("SUPABASE_SECRET_KEY"));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}");
      expect(lines[1]).toMatch(/^\s+for name in .*SUPABASE_SECRET_KEY.*; do$/);
      expect(step).not.toMatch(/\$\{?SUPABASE_SECRET_KEY/);
      expect(step).not.toMatch(/\b(echo|printf|cat|env|printenv|set)\b[^\n]*SUPABASE_SECRET_KEY/);
      expect(step).not.toContain("set -x");
    });

    it("gets the six secrets from secrets.* and FULL_FILES from the input, and checks the names first", () => {
      const step = files();
      for (const name of [
        "SUPABASE_DB_URL",
        "SUPABASE_URL",
        "SUPABASE_SECRET_KEY",
        "BACKUP_ENCRYPTION_PASSPHRASE",
        "BACKUP_DRIVE_SA_JSON",
        "BACKUP_DRIVE_FOLDER_ID",
      ]) {
        expect(step).toContain(`${name}: \${{ secrets.${name} }}`);
      }
      expect(step).toContain("FULL_FILES: ${{ inputs.full_files }}");
      expect(step).toMatch(
        /for name in SUPABASE_DB_URL SUPABASE_URL SUPABASE_SECRET_KEY BACKUP_ENCRYPTION_PASSPHRASE BACKUP_DRIVE_SA_JSON BACKUP_DRIVE_FOLDER_ID; do/,
      );
      expect(step).toContain("::error title=Missing backup settings::");
      expect(step).toContain("missing: ${missing[*]}");
      expect(step.indexOf("::error title=Missing")).toBeLessThan(
        step.indexOf("npx tsx scripts/backup/files.ts"),
      );
    });

    it("runs the script with a work dir under $RUNNER_TEMP/backup, the target, the guarded ref and the retention", () => {
      const step = files();
      expect(step).toContain('--work "$RUNNER_TEMP/backup/files"');
      expect(step).toContain('--target "$TARGET"');
      expect(step).toContain('--ref "$PROJECT_REF"');
      expect(step).toContain('--keep "$BACKUP_KEEP"');
      expect(step).not.toContain("--local");
      expect(step).not.toContain("--store-dir");
    });

    it("adds --full only when the full_files input is true, and the input reaches the script through env only", () => {
      const step = files();
      expect(step).toContain('[ "$FULL_FILES" = true ]');
      expect(step).toContain("--full");
      const script = step.slice(step.indexOf("run:"));
      expect(script).not.toContain("${{");
      expect(workflow).toMatch(
        /workflow_dispatch:\n\s+inputs:\n\s+target:[\s\S]*?\n {6}full_files:\n(?: {8}.*\n)*? {8}type: boolean\n(?: {8}.*\n)*? {8}default: false\n/,
      );
      // The input comes after `target`.
      expect(workflow.indexOf("      full_files:")).toBeGreaterThan(
        workflow.indexOf("      target:"),
      );
      expect(workflow.match(/inputs\.full_files/g)).toHaveLength(1);
    });

    it("runs after the dump, the upload and the keep-alive, before the clean-up, and the issue step stays last (condition 3)", () => {
      const order = [
        indexOf("scripts/backup/dump.ts"),
        indexOf("scripts/backup/upload.ts"),
        indexOf("scripts/backup/keepalive.ts"),
        indexOf("scripts/backup/files.ts"),
        indexOf('rm -rf "$RUNNER_TEMP/backup"'),
        indexOf("gh issue"),
      ];
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(new Set(order).size).toBe(order.length);
      expect(order.at(-1)).toBe(steps.length - 1);
    });

    it("cannot hold back the database backup, and a failure turns the job red and reaches the alert (condition 3)", () => {
      // The dump and the upload come first and no step names the files step as a dependency; nothing swallows a failure.
      expect(workflow).not.toContain("continue-on-error");
      expect(workflow).not.toMatch(/\|\| true/);
      for (const marker of ["scripts/backup/dump.ts", "scripts/backup/upload.ts"]) {
        const step = stepContaining(marker);
        expect(step).not.toContain("files");
        expect(step).not.toContain("always()");
      }
      // Default success(): it does not run after a failed dump or upload; the failure() issue step sees its failure.
      expect(files()).not.toMatch(/^ {8}if: .*(always|failure)\(\)/m);
      expect(stepContaining("gh issue")).toContain(
        "if: failure() && steps.arm.outputs.armed == 'true'",
      );
    });

    it("never prints object paths: no cat, listing or decrypt of the manifest or index (condition 4)", () => {
      const step = files();
      expect(step).not.toMatch(/\b(cat|less|head|tail|jq|gpg|tar)\b/);
      expect(step).not.toMatch(/manifest\.json|index\.json|--list|-tf?\b/);
      expect(workflow).not.toMatch(/^\s*(run:\s*)?cat\b/m);
      expect(workflow).not.toContain("upload-artifact");
    });
  });

  it("gives the upload the Drive secrets and the retention from vars.BACKUP_KEEP_COPIES, default 14", () => {
    expect(workflow).toContain("BACKUP_KEEP: ${{ vars.BACKUP_KEEP_COPIES || '14' }}");
    const upload = stepContaining("scripts/backup/upload.ts");
    expect(upload).toContain("BACKUP_DRIVE_SA_JSON: ${{ secrets.BACKUP_DRIVE_SA_JSON }}");
    expect(upload).toContain("BACKUP_DRIVE_FOLDER_ID: ${{ secrets.BACKUP_DRIVE_FOLDER_ID }}");
    expect(upload).toContain('--keep "$BACKUP_KEEP"');
    expect(upload).toContain('--target "$TARGET"');
  });

  it("pings Auth health after the upload, with the project URL and the publishable key", () => {
    expect(indexOf("scripts/backup/keepalive.ts")).toBeGreaterThan(
      indexOf("scripts/backup/upload.ts"),
    );
    const ping = stepContaining("scripts/backup/keepalive.ts");
    expect(ping).toContain("SUPABASE_URL: ${{ secrets.SUPABASE_URL }}");
    expect(ping).toContain("SUPABASE_PUBLISHABLE_KEY: ${{ secrets.SUPABASE_PUBLISHABLE_KEY }}");
  });

  it("dumps before it uploads", () => {
    expect(indexOf("scripts/backup/dump.ts")).toBeLessThan(indexOf("scripts/backup/upload.ts"));
  });

  it("always removes the clear text and the encrypted file from the runner", () => {
    const cleanup = stepContaining('rm -rf "$RUNNER_TEMP/backup"');
    expect(cleanup).toContain("if: always() && steps.arm.outputs.armed == 'true'");
  });

  it("opens or comments on a backup-failure issue with the run link only, using GITHUB_TOKEN", () => {
    const issue = stepContaining("gh issue");
    expect(issue).toContain("if: failure() && steps.arm.outputs.armed == 'true'");
    expect(issue).toContain("backup-failure");
    expect(issue).toContain("GH_TOKEN: ${{ github.token }}");
    expect(issue).toContain(
      "RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
    );
    // The only expressions are these two, both in env: the script text holds none, so nothing can be injected into it.
    expect(issue.match(/\$\{\{/g)).toHaveLength(4);
    const script = issue.slice(issue.indexOf("run:"));
    expect(script).not.toContain("${{");
    expect(script).toContain("$RUN_URL");
    expect(issue).not.toMatch(SECRET_REF);
  });

  it("is the last step to run, so it sees any failure above it", () => {
    expect(indexOf("gh issue")).toBe(steps.length - 1);
  });

  it("does not trace commands and uploads no artifact", () => {
    expect(workflow).not.toContain("set -x");
    expect(workflow).not.toContain("upload-artifact");
  });

  it("checks out without keeping the token", () => {
    expect(stepContaining("actions/checkout")).toContain("persist-credentials: false");
  });

  describe("arming (backups stay quiet until PRODUCTION_PROJECT_REF is set)", () => {
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
        expect(step, step.split("\n")[0]).toMatch(
          new RegExp(
            `^ {8}if: (always\\(\\) && |failure\\(\\) && )?${armedIf.replace(/[.()']/g, "\\$&")}$`,
            "m",
          ),
        );
      }
    });

    it("the issue step can only run when armed, and never on its own failure() alone", () => {
      const issue = stepContaining("gh issue");
      expect(issue).toContain(`if: failure() && ${armedIf}`);
      expect(issue).not.toMatch(/^ {8}if: failure\(\)$/m);
    });

    it("armed: the project ref guard and the secret checks are kept strict", () => {
      expect(stepContaining("Check the project ref")).toContain("exit 1");
      expect(stepContaining("scripts/backup/dump.ts")).toContain("exit 1");
    });
  });
});
