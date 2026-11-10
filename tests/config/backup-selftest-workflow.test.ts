import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M25 step 11 (AT4, automated): the backup scripts run against the local stack in CI, with a fake passphrase, no secret and
// no upload.
const workflow = readFileSync(
  new URL("../../.github/workflows/backup-selftest.yml", import.meta.url),
  "utf8",
);
const DRAFT_GATE =
  "if: github.event_name != 'pull_request' || github.event.pull_request.draft == false";
const PATHS = [
  "scripts/backup/**",
  "scripts/lib/backup/**",
  "supabase/migrations/**",
  ".github/workflows/backup-*.yml",
];

/** The step blocks of the one job, in order. */
const steps = workflow.slice(workflow.indexOf("    steps:")).split(/\n(?= {6}- )/);
/** The index of the first step containing the marker. */
function at(marker: string): number {
  const i = steps.findIndex((s) => s.includes(marker));
  if (i < 0) throw new Error(`no step contains ${marker}`);
  return i;
}

describe("backup-selftest workflow", () => {
  it("runs on ready pull requests and main pushes that touch backups or migrations, and by hand", () => {
    expect(workflow).toMatch(
      /^ {2}pull_request:\n {4}types: \[opened, synchronize, reopened, ready_for_review\]\n {4}paths:\n/m,
    );
    expect(workflow).toMatch(/^ {2}push:\n {4}branches: \[main\]\n {4}paths:\n/m);
    expect(workflow).toContain("workflow_dispatch:");
    for (const path of PATHS) {
      expect(workflow.split(`- "${path}"`).length - 1, path).toBe(2);
    }
  });

  it("has the CI draft gate, so a draft pull request spends no minutes", () => {
    expect(workflow).toContain(`\n    ${DRAFT_GATE}\n`);
  });

  it("is read-only and uses no secret and no environment", () => {
    expect(workflow).toMatch(/permissions:\n {2}contents: read/);
    expect(workflow).not.toMatch(/\$\{\{\s*secrets\./);
    expect(workflow).not.toMatch(/^\s+environment:/m);
    expect(workflow).not.toContain("upload-artifact");
    expect(workflow).not.toContain("set -x");
  });

  it("uses an obviously fake passphrase of at least 32 characters", () => {
    const value = /BACKUP_ENCRYPTION_PASSPHRASE: (\S+)/.exec(workflow)?.[1] ?? "";
    expect(value).toContain("not-a-secret");
    expect(value.length).toBeGreaterThanOrEqual(32);
  });

  it("runs the steps in order: install, start, tenant and demo, dump, stop, empty stack, restore check, clean-up", () => {
    const order = [
      at("run: npm ci"),
      at("npx supabase start"),
      at("npm run demo"),
      at("scripts/backup/dump.ts"),
      at("supabase stop --no-backup"),
      at('--workdir "$RUNNER_TEMP/restore"'),
      at("scripts/backup/restore-check.ts"),
      steps.length - 1,
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
  });

  it("creates the demo tenant with fake data before the dump", () => {
    const step = steps[at("npm run demo")]!;
    expect(step).toContain("npm run -s create-tenant");
    expect(step).toContain("--owner-email owner@example.test");
    expect(step).toContain("Osteria Demo");
  });

  it("dumps the local stack with --local and the fake passphrase", () => {
    const step = steps[at("scripts/backup/dump.ts")]!;
    expect(step).toContain("--local");
    expect(step).toContain(
      "SUPABASE_DB_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    );
    expect(step).toContain("BACKUP_ENCRYPTION_PASSPHRASE: ${{ env.BACKUP_ENCRYPTION_PASSPHRASE }}");
    expect(step).toContain('--out "$RUNNER_TEMP/backup"');
  });

  it("restores into an empty stack: a work directory with config.toml only, no migrations, no seed", () => {
    const step = steps[at('--workdir "$RUNNER_TEMP/restore"')]!;
    expect(step).toContain('mkdir -p "$RUNNER_TEMP/restore/supabase"');
    expect(step).toContain('cp supabase/config.toml "$RUNNER_TEMP/restore/supabase/config.toml"');
    expect(step).not.toMatch(/cp .*migrations|cp .*seed/);
    // config.toml names the e-mail templates by path (auth.email.template.*.content_path, relative to the work directory), and
    // `supabase start` refuses a config whose template is missing (run 42091422466).
    expect(step).toContain('cp -R supabase/templates "$RUNNER_TEMP/restore/supabase/templates"');
  });

  it("checks (a) to (d) and demands rows in the ledger and in auth.users", () => {
    const step = steps[at("scripts/backup/restore-check.ts")]!;
    expect(step).toContain("--require-nonzero public.stock_movement,auth.users");
    expect(step).toContain('--work "$RUNNER_TEMP/restore-files"');
  });

  it("ends with a clean-up that always runs and removes the clear text and the stack", () => {
    const last = steps.at(-1)!;
    expect(last).toContain("if: always()");
    expect(last).toContain(
      'rm -rf "$RUNNER_TEMP/backup" "$RUNNER_TEMP/restore" "$RUNNER_TEMP/restore-files"',
    );
    expect(last).toContain("supabase stop --no-backup");
    const stop = 'npx supabase stop --no-backup --workdir "$RUNNER_TEMP/restore" || true';
    expect(last).toContain(stop);
    expect(last.indexOf(stop)).toBeLessThan(last.indexOf("rm -rf"));
  });

  describe("invoice files (ADR-034, F10)", () => {
    const files = () => steps[at("scripts/backup/files.ts")]!;
    const yaml = workflow
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");

    it("runs the files backup after the dump and before the stack is stopped", () => {
      const order = [
        at("npm run demo"),
        at("scripts/backup/dump.ts"),
        at("scripts/backup/files.ts"),
        at("supabase stop --no-backup"),
        at('--workdir "$RUNNER_TEMP/restore"'),
        at("scripts/backup/restore-check.ts"),
        steps.length - 1,
      ];
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(new Set(order).size).toBe(order.length);
    });

    it("uses a local folder store, the local stack's own keys and a fake passphrase, with no secret (condition 2)", () => {
      const step = files();
      expect(step).toContain("- name: Back up the invoice files twice into a local folder");
      expect(step).toContain("--local");
      expect(step).toContain('--store-dir "$RUNNER_TEMP/files-store"');
      expect(step).toContain('--work "$RUNNER_TEMP/files-work"');
      expect(step).toContain("--target staging");
      expect(step).not.toContain("--ref");
      expect(step).toContain(
        "SUPABASE_DB_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      );
      expect(step).toContain("SUPABASE_URL: ${{ env.NEXT_PUBLIC_SUPABASE_URL }}");
      expect(step).toContain(
        "BACKUP_ENCRYPTION_PASSPHRASE: ${{ env.BACKUP_ENCRYPTION_PASSPHRASE }}",
      );
      // The secret key is the local stack's: exported by `supabase status` into GITHUB_ENV, never a repository secret.
      const exportStep = steps[at("npx supabase status -o json")]!;
      expect(exportStep).toContain(
        "SUPABASE_SECRET_KEY=$(pick '.SECRET_KEY // .SERVICE_ROLE_KEY')",
      );
      expect(step).not.toContain("SUPABASE_SECRET_KEY");
      expect(at("npx supabase status -o json")).toBeLessThan(at("scripts/backup/files.ts"));
      expect(step).not.toMatch(/secrets\./);
    });

    it("keeps pull requests away from every secret and environment: no secrets, vars, environment, write permission or privileged trigger (condition 2)", () => {
      expect(yaml).not.toMatch(/\$\{\{[^}]*\bsecrets\b|^\s*secrets:/m);
      expect(yaml).not.toMatch(/\bvars\./);
      expect(yaml).not.toMatch(/\benvironment\b/);
      expect(yaml).not.toContain("production-backup");
      expect(yaml).not.toContain("pull_request_target");
      expect(yaml).not.toContain("workflow_run");
      expect(yaml).not.toMatch(/^\s+(issues|contents|pull-requests|id-token|actions):\s+write/m);
      const block = /^permissions:\n((?: {2}.*\n)+)/m.exec(workflow)?.[1] ?? "";
      expect(block.trim()).toBe("contents: read");
      expect(workflow.match(/^permissions:/gm)).toHaveLength(1);
      expect(yaml).not.toMatch(/^ {4}permissions:/m);
    });

    it("runs the script twice, waits between the runs, and proves the second one found nothing new", () => {
      const step = files();
      expect(step.match(/npx tsx scripts\/backup\/files\.ts/g)).toHaveLength(2);
      expect(step).toContain('mkdir -p "$RUNNER_TEMP/files-store"');
      expect(step).toContain("set -euo pipefail");
      // Names carry a UTC stamp to the second; two runs in the same second would collide on the manifest name.
      expect(step).toMatch(/sleep [2-9]/);
      const second = step.slice(step.lastIndexOf("npx tsx scripts/backup/files.ts"));
      expect(second).toContain('| tee "$RUNNER_TEMP/files-second.log"');
      expect(step).toContain(`grep -q '"new":0' "$RUNNER_TEMP/files-second.log"`);
      expect(step.indexOf("tee")).toBeGreaterThan(step.indexOf("sleep"));
    });

    it("never prints object paths: the log is only grepped quietly, nothing cats a manifest or an index (condition 4)", () => {
      const step = files();
      expect(step).not.toMatch(/\b(cat|less|head|tail|jq|gpg|tar)\b/);
      expect(step).not.toMatch(/manifest\.json|index\.json|--list/);
      expect(step).not.toMatch(/grep (?!-q)/);
      expect(yaml).not.toMatch(/\bcat\b[^\n]*(files-|manifest|index)/);
      expect(yaml).not.toContain("upload-artifact");
    });

    it("checks the packs and the completeness in the restore step against the same folder", () => {
      const step = steps[at("scripts/backup/restore-check.ts")]!;
      expect(step).toContain('--files-dir "$RUNNER_TEMP/files-store"');
      expect(step).toContain("--files-packs all");
      expect(step).toContain("--require-files");
      expect(step).toContain(
        "BACKUP_ENCRYPTION_PASSPHRASE: ${{ env.BACKUP_ENCRYPTION_PASSPHRASE }}",
      );
    });

    it("cleans up the folder store, the work dir and the second run's log", () => {
      const last = steps.at(-1)!;
      expect(last).toContain("if: always()");
      for (const path of ["files-store", "files-work", "files-second.log"]) {
        expect(last).toContain(`"$RUNNER_TEMP/${path}"`);
      }
      expect(last.indexOf("files-store")).toBeGreaterThan(last.indexOf("rm -rf"));
    });
  });

  it("does not depend on a missing gpg or psql", () => {
    expect(workflow).toContain("gpg --version");
    expect(workflow).toContain("psql --version");
  });
});
