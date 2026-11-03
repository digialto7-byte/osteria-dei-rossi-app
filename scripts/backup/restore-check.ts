// Restore check (M25 step 10, plan §3.1.5): decrypt a backup, restore it into an EMPTY local stack and check it.
//   npx tsx scripts/backup/restore-check.ts --file <x.tar.gpg> --work <dir> [--db-url <local URL>] [--require-nonzero a.b,c.d]
// Environment: BACKUP_ENCRYPTION_PASSPHRASE. The target must be local. Passes when
//   (a) app.ledger_checks_body returns no row for any tenant, (b) the row counts equal the manifest's,
//   (c) the migrations equal the manifest's, (d) cron.job and the two Vault secrets are gone.
// Logs hold names and counts only. The decrypted files are removed before exit.
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  assertLocalDbUrl,
  assertPassphrase,
  createLogger,
  gpgDecryptArgs,
  psqlRestoreArgs,
  RESTORE_CHECK_SQL,
} from "../lib/backup/commands";
import { spawnRunner, type Runner } from "../lib/backup/exec";
import {
  buildManifest,
  compareManifests,
  MANIFEST_SQL,
  parseManifest,
} from "../lib/backup/manifest";

export type RestoreDeps = {
  env: Record<string, string | undefined>;
  run: Runner;
  mkdir: (dir: string) => void;
  readFile: (path: string) => string;
  remove: (path: string) => void;
  log: (line: string) => void;
};

/** The default target: the local Supabase stack's database. */
export const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const USAGE =
  "Usage: restore-check --file <x.tar.gpg> --work <dir> [--db-url <local URL>] [--require-nonzero a.b,c.d]";

type CheckRow = {
  ledger: { check: string; rows: number }[];
  cronJobs: number;
  vaultSecrets: number;
};

export async function runRestoreCheck(argv: string[], deps: RestoreDeps): Promise<number> {
  let values: { file?: string; work?: string; "db-url"?: string; "require-nonzero"?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        file: { type: "string" },
        work: { type: "string" },
        "db-url": { type: "string" },
        "require-nonzero": { type: "string" },
      },
    }));
  } catch {
    deps.log(USAGE);
    return 1;
  }
  if (!values.file || !values.work) {
    deps.log(USAGE);
    return 1;
  }
  const dbUrl = values["db-url"] ?? LOCAL_DB_URL;
  const log = createLogger(deps.log, [dbUrl, deps.env.BACKUP_ENCRYPTION_PASSPHRASE ?? ""]);
  let passphrase: string;
  try {
    assertLocalDbUrl(dbUrl);
    passphrase = assertPassphrase(deps.env.BACKUP_ENCRYPTION_PASSPHRASE);
  } catch (error) {
    log((error as Error).message);
    return 1;
  }

  const tar = join(values.work, "backup.tar");
  const files = join(values.work, "files");
  const problems: string[] = [];
  try {
    deps.mkdir(files);
    const opened = deps.run("gpg", gpgDecryptArgs(values.file, tar), { input: passphrase });
    if (opened.status !== 0) {
      log("decrypt_failed");
      log(opened.stderr);
      return 1;
    }
    const unpacked = deps.run("tar", ["-xf", tar, "-C", files]);
    if (unpacked.status !== 0) {
      log("untar_failed");
      return 1;
    }
    const expected = parseManifest(deps.readFile(join(files, "manifest.json")));
    const restored = deps.run(
      "psql",
      psqlRestoreArgs(dbUrl, {
        roles: join(files, "roles.sql"),
        schema: join(files, "schema.sql"),
        data: join(files, "data.sql"),
      }),
    );
    if (restored.status !== 0) {
      log("restore_failed");
      log(restored.stderr);
      return 1;
    }

    const query = (sql: string): unknown => {
      const r = deps.run("psql", [dbUrl, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]);
      if (r.status !== 0) throw new Error("check_query_failed");
      return JSON.parse(r.stdout);
    };
    const actual = buildManifest(query(MANIFEST_SQL), expected.createdAt);
    problems.push(...compareManifests(expected, actual));
    const check = query(RESTORE_CHECK_SQL) as CheckRow;
    for (const finding of check.ledger) problems.push(`ledger ${finding.check}: ${finding.rows}`);
    if (check.cronJobs !== 0) problems.push(`cron jobs: ${check.cronJobs}`);
    if (check.vaultSecrets !== 0) problems.push(`vault secrets: ${check.vaultSecrets}`);
    for (const name of (values["require-nonzero"] ?? "").split(",").filter(Boolean)) {
      if ((actual.tables[name] ?? 0) <= 0) problems.push(`${name} is empty`);
    }

    for (const problem of problems) log(`restore_check: ${problem}`);
    log(
      JSON.stringify({
        ok: problems.length === 0,
        problems: problems.length,
        migrations: actual.migrations.length,
        tables: actual.tables,
      }),
    );
    return problems.length === 0 ? 0 : 1;
  } catch (error) {
    const message = (error as Error).message;
    log(/^[a-z_]+$/.test(message) ? message : "restore_check_failed:unexpected");
    return 1;
  } finally {
    deps.remove(tar);
    deps.remove(files);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRestoreCheck(process.argv.slice(2), {
    env: process.env,
    run: spawnRunner,
    mkdir: (dir) => void mkdirSync(dir, { recursive: true }),
    readFile: (path) => readFileSync(path, "utf8"),
    remove: (path) => rmSync(path, { recursive: true, force: true }),
    log: (line) => console.log(line),
  }).then((code) => {
    process.exitCode = code;
  });
}
