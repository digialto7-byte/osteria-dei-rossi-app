import { describe, expect, it } from "vitest";
import { buildManifest } from "../../../scripts/lib/backup/manifest";
import { runRestoreCheck, type RestoreDeps } from "../../../scripts/backup/restore-check";

const PASS = "p".repeat(40);
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RAW = {
  migrations: ["20261021120000"],
  tables: { "public.stock_movement": 3, "auth.users": 2 },
};
const MANIFEST = buildManifest(RAW, "2026-11-05T02:15:09.000Z");
const CLEAN = { ledger: [], cronJobs: 0, vaultSecrets: 0 };

function setup(
  restored: unknown = RAW,
  check: unknown = CLEAN,
  env: Record<string, string | undefined> = { BACKUP_ENCRYPTION_PASSPHRASE: PASS },
) {
  const calls: { cmd: string; args: string[]; input?: string }[] = [];
  const removed: string[] = [];
  const lines: string[] = [];
  const deps: RestoreDeps = {
    env,
    run: (cmd, args, opts) => {
      calls.push({ cmd, args, input: opts?.input });
      if (cmd === "psql" && args.includes("-At")) {
        const sql = args[args.indexOf("-c") + 1]!;
        return {
          status: 0,
          stdout: JSON.stringify(sql.includes("ledger") ? check : restored),
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
    mkdir: () => {},
    readFile: () => JSON.stringify(MANIFEST),
    remove: (path) => void removed.push(path),
    log: (line) => void lines.push(line),
  };
  return { deps, calls, removed, lines };
}

const ARGV = ["--file", "/run/in.tar.gpg", "--work", "/run/restore", "--db-url", LOCAL];

describe("runRestoreCheck", () => {
  it("decrypts, unpacks, restores in one psql run and passes checks (a) to (d)", async () => {
    const { deps, calls, lines } = setup();
    expect(await runRestoreCheck(ARGV, deps)).toBe(0);
    const cmds = calls.map((c) => c.cmd);
    expect(cmds.slice(0, 3)).toEqual(["gpg", "tar", "psql"]);
    const restore = calls[2]!;
    expect(restore.args[0]).toBe(LOCAL);
    expect(restore.args).toContain("--single-transaction");
    expect(restore.args).toContain("/run/restore/files/roles.sql");
    expect(lines.join("\n")).toContain('"ok":true');
  });

  it("gives the passphrase to gpg on stdin only", async () => {
    const { deps, calls } = setup();
    await runRestoreCheck(ARGV, deps);
    expect(calls.filter((c) => c.input !== undefined).map((c) => c.cmd)).toEqual(["gpg"]);
    for (const c of calls) expect(c.args.join(" ")).not.toContain(PASS);
  });

  it("refuses a non-local restore target before running anything", async () => {
    const { deps, calls, lines } = setup();
    const remote =
      "postgresql://postgres.abc:fake-pass@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
    expect(await runRestoreCheck(["--file", "/f", "--work", "/w", "--db-url", remote], deps)).toBe(
      1,
    );
    expect(calls).toEqual([]);
    expect(lines.join("\n")).toContain("restore_target_not_local");
    expect(lines.join("\n")).not.toContain("fake-pass");
  });

  it("(a) fails on a ledger finding and names the check", async () => {
    const { deps, lines } = setup(RAW, { ...CLEAN, ledger: [{ check: "lot_missing", rows: 2 }] });
    expect(await runRestoreCheck(ARGV, deps)).toBe(1);
    expect(lines.join("\n")).toContain("ledger lot_missing: 2");
  });

  it("(b) fails on a differing count and (c) on differing migrations", async () => {
    const counts = setup({ ...RAW, tables: { "public.stock_movement": 2, "auth.users": 2 } });
    expect(await runRestoreCheck(ARGV, counts.deps)).toBe(1);
    expect(counts.lines.join("\n")).toContain("table public.stock_movement: expected 3, found 2");
    const migrations = setup({ ...RAW, migrations: ["20261121100000"] });
    expect(await runRestoreCheck(ARGV, migrations.deps)).toBe(1);
    expect(migrations.lines.join("\n")).toContain("migration 20261021120000");
  });

  it("(d) fails when cron jobs or the Vault secrets survive", async () => {
    for (const bad of [
      { ...CLEAN, cronJobs: 5 },
      { ...CLEAN, vaultSecrets: 1 },
    ]) {
      const { deps, lines } = setup(RAW, bad);
      expect(await runRestoreCheck(ARGV, deps)).toBe(1);
      expect(lines.join("\n")).toMatch(/cron jobs: 5|vault secrets: 1/);
    }
  });

  it("--require-nonzero fails on an empty table and passes on a filled one", async () => {
    const withZero = setup({ ...RAW, tables: { "public.stock_movement": 0, "auth.users": 2 } });
    withZero.deps.readFile = () =>
      JSON.stringify(
        buildManifest(
          { ...RAW, tables: { "public.stock_movement": 0, "auth.users": 2 } },
          MANIFEST.createdAt,
        ),
      );
    const args = [...ARGV, "--require-nonzero", "public.stock_movement,auth.users"];
    expect(await runRestoreCheck(args, withZero.deps)).toBe(1);
    expect(withZero.lines.join("\n")).toContain("public.stock_movement is empty");
    expect(await runRestoreCheck(args, setup().deps)).toBe(0);
  });

  it("fails without the passphrase, and when a command fails, redacting output", async () => {
    expect(await runRestoreCheck(ARGV, setup(RAW, CLEAN, {}).deps)).toBe(1);
    const { deps, lines } = setup();
    const run = deps.run;
    deps.run = (cmd, args, opts) =>
      cmd === "psql" && !args.includes("-At")
        ? { status: 3, stdout: "", stderr: `ERROR near ${LOCAL}` }
        : run(cmd, args, opts);
    expect(await runRestoreCheck(ARGV, deps)).toBe(1);
    expect(lines.join("\n")).toContain("restore_failed");
    expect(lines.join("\n")).not.toContain("postgres:postgres@");
  });

  it("removes the decrypted files whatever happens", async () => {
    const ok = setup();
    await runRestoreCheck(ARGV, ok.deps);
    expect(ok.removed).toEqual(["/run/restore/backup.tar", "/run/restore/files"]);
    const bad = setup(RAW, { ...CLEAN, cronJobs: 1 });
    await runRestoreCheck(ARGV, bad.deps);
    expect(bad.removed).toEqual(["/run/restore/backup.tar", "/run/restore/files"]);
  });
});
