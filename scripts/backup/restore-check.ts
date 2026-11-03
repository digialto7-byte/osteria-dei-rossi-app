// Restore check (M25 step 10, plan §3.1.5): decrypt a backup, restore it into an EMPTY local stack and check it.
//   npx tsx scripts/backup/restore-check.ts (--file <x.tar.gpg> | --from-drive staging|production) --work <dir>
//                                           [--db-url <local URL>] [--require-nonzero a.b,c.d]
// --from-drive takes the newest copy of that target from the Shared Drive: it must be at most 36 hours old, and its MD5 must match
// Drive's. Environment: BACKUP_ENCRYPTION_PASSPHRASE, and for Drive BACKUP_DRIVE_SA_JSON and BACKUP_DRIVE_FOLDER_ID.
// The restore target must be local. Passes when
//   (a) app.ledger_checks_body returns no row for any tenant, (b) the row counts equal the manifest's,
//   (c) the migrations equal the manifest's, (d) cron.job and the three Vault secrets are gone.
// Logs hold names and counts only. The decrypted files are removed before exit.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { download, fetchAccessToken, newestBackup, type ServiceAccount } from "../lib/backup/drive";
import { spawnRunner, type Runner } from "../lib/backup/exec";
import { assertFresh } from "../lib/backup/freshness";
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
  writeFile: (path: string, bytes: Uint8Array) => void;
  remove: (path: string) => void;
  fetch: typeof fetch;
  now: () => Date;
  log: (line: string) => void;
};

/** The default target: the local Supabase stack's database. */
export const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const USAGE =
  "Usage: restore-check (--file <x.tar.gpg> | --from-drive staging|production) --work <dir> [--db-url <local URL>] [--require-nonzero a.b,c.d]";

type CheckRow = {
  ledger: { check: string; rows: number }[];
  cronJobs: number;
  vaultSecrets: number;
};

export async function runRestoreCheck(argv: string[], deps: RestoreDeps): Promise<number> {
  let values: {
    file?: string;
    "from-drive"?: string;
    work?: string;
    "db-url"?: string;
    "require-nonzero"?: string;
  };
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        file: { type: "string" },
        "from-drive": { type: "string" },
        work: { type: "string" },
        "db-url": { type: "string" },
        "require-nonzero": { type: "string" },
      },
    }));
  } catch {
    deps.log(USAGE);
    return 1;
  }
  const driveTarget = (["staging", "production"] as const).find((t) => t === values["from-drive"]);
  const fromDrive = values["from-drive"] !== undefined;
  if (!values.work || (values.file === undefined) === !fromDrive || (fromDrive && !driveTarget)) {
    deps.log(USAGE);
    return 1;
  }
  const { BACKUP_DRIVE_SA_JSON: saJson, BACKUP_DRIVE_FOLDER_ID: folderId } = deps.env;
  if (fromDrive && (!saJson || !folderId)) {
    const missing = [!saJson && "BACKUP_DRIVE_SA_JSON", !folderId && "BACKUP_DRIVE_FOLDER_ID"];
    deps.log(`backup_env_missing:${missing.filter(Boolean).join(",")}`);
    return 1;
  }
  const dbUrl = values["db-url"] ?? LOCAL_DB_URL;
  const log = createLogger(deps.log, [
    dbUrl,
    deps.env.BACKUP_ENCRYPTION_PASSPHRASE ?? "",
    saJson ?? "",
    folderId ?? "",
  ]);
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
  const downloaded = join(values.work, "from-drive.tar.gpg");
  const problems: string[] = [];
  try {
    deps.mkdir(files);
    let encrypted = values.file ?? downloaded;
    if (fromDrive && driveTarget) {
      const sa = JSON.parse(saJson!) as ServiceAccount;
      const token = await fetchAccessToken(deps.fetch, sa, Math.floor(deps.now().getTime() / 1000));
      const newest = await newestBackup(deps.fetch, token, folderId!, driveTarget);
      assertFresh(newest, deps.now());
      const bytes = await download(deps.fetch, token, newest!.id);
      // MD5 is Drive's checksum, used to detect a damaged download, not for security.
      if (createHash("md5").update(bytes).digest("hex") !== newest!.md5Checksum) {
        throw new Error("backup_checksum_mismatch");
      }
      deps.writeFile(downloaded, bytes);
      encrypted = downloaded;
    }
    const opened = deps.run("gpg", gpgDecryptArgs(encrypted, tar), { input: passphrase });
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
    log(/^[a-z_]+(:[a-z0-9_]+)?$/.test(message) ? message : "restore_check_failed:unexpected");
    return 1;
  } finally {
    deps.remove(tar);
    deps.remove(files);
    if (fromDrive) deps.remove(downloaded);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRestoreCheck(process.argv.slice(2), {
    env: process.env,
    run: spawnRunner,
    mkdir: (dir) => void mkdirSync(dir, { recursive: true }),
    readFile: (path) => readFileSync(path, "utf8"),
    writeFile: (path, bytes) => writeFileSync(path, bytes, { mode: 0o600 }),
    fetch,
    now: () => new Date(),
    remove: (path) => rmSync(path, { recursive: true, force: true }),
    log: (line) => console.log(line),
  }).then((code) => {
    process.exitCode = code;
  });
}
