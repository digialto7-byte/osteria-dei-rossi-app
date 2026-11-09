// Restore check (M25 step 10, plan §3.1.5): decrypt a backup, restore it into an EMPTY local stack and check it.
//   npx tsx scripts/backup/restore-check.ts (--file <x.tar.gpg> | --from-drive staging|production) --work <dir>
//                                           [--db-url <local URL>] [--require-nonzero a.b,c.d]
// --from-drive takes the newest copy of that target from the Shared Drive: it must be at most 36 hours old, and its MD5 must match
// Drive's. Environment: BACKUP_ENCRYPTION_PASSPHRASE, and for Drive BACKUP_DRIVE_SA_JSON and BACKUP_DRIVE_FOLDER_ID.
// The restore target must be local. Passes when
//   (a) app.ledger_checks_body returns no row for any tenant, (b) the row counts equal the manifest's,
//   (c) the migrations equal the manifest's, (d) cron.job and the three Vault secrets are gone.
// Invoice files (ADR-034), only with --files-packs <n|all> [--files-dir <dir>] [--require-files]: after (a)-(d), also
//   (e) the newest files manifest of the target is at most 36 hours old, its MD5 matches, it decrypts and parses,
//   (f) every pack it names (current or previous) is in the store, (g) every `invoices` object row of the restored database has a
//   manifest entry, (h) the newest pack and random others, n in all ("all" = every pack): index equals the manifest, sha256 of every
//   file equals the manifest, (i) --require-files: at least one entry that is not removed.
// --files-dir (a directory store, the CI self-test) goes only with --file. Without --files-packs nothing changes.
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
  failureSummary,
  failureLocation,
  withoutParameterGrants,
  REPLICA_SQL,
  CLEANUP_SQL,
  PSQL_SAFE_FLAGS,
  gpgDecryptArgs,
  psqlRestoreArgs,
  RESTORE_CHECK_SQL,
  RESTORED_OBJECTS_SQL,
  isFilesManifestName,
} from "../lib/backup/commands";
import { download, fetchAccessToken, newestBackup, type ServiceAccount } from "../lib/backup/drive";
import { spawnRunner, type Runner } from "../lib/backup/exec";
import { assertFresh } from "../lib/backup/freshness";
import { parseFilesManifest, parsePackIndex } from "../lib/backup/files-manifest";
import {
  checkPack,
  choosePacks,
  missingFromManifest,
  missingPacks,
} from "../lib/backup/files-verify";
import { dirStore, driveStore, type BackupStore } from "../lib/backup/store";
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
  /** Only for the files check: the bytes of a file (a pack member). */
  readBytes?: (path: string) => Uint8Array;
  /** Only for the files check: the random source of the pack sample (default Math.random). */
  random?: () => number;
  /** Only for the files check with --files-dir (default: the real directory store). */
  dirStore?: (dir: string) => BackupStore;
};

/** The default target: the local Supabase stack's database. */
export const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const USAGE =
  "Usage: restore-check (--file <x.tar.gpg> | --from-drive staging|production) --work <dir> [--db-url <local URL>] [--require-nonzero a.b,c.d]";

const FILES_USAGE =
  "Usage: restore-check ... [--files-packs <n|all> [--files-dir <dir>] [--require-files]] (--files-dir only with --file)";
const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

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
    "files-packs"?: string;
    "files-dir"?: string;
    "require-files"?: boolean;
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
        "files-packs": { type: "string" },
        "files-dir": { type: "string" },
        "require-files": { type: "boolean" },
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
  const filesRaw = values["files-packs"];
  const filesDir = values["files-dir"];
  const wantFiles = filesRaw !== undefined;
  const filesCount = filesRaw === "all" ? "all" : Number(filesRaw);
  // The files check needs a store: Drive with --from-drive, a directory with --file. The target of a directory store is the one in
  // the backup file's name.
  const dirTarget = (["staging", "production"] as const).find((t) =>
    (values.file ?? "").endsWith(`-${t}.tar.gpg`),
  );
  const filesBad =
    (!wantFiles && (filesDir !== undefined || values["require-files"] === true)) ||
    (wantFiles && filesCount !== "all" && (!Number.isInteger(filesCount) || filesCount < 1)) ||
    (wantFiles && fromDrive && filesDir !== undefined) ||
    (wantFiles && !fromDrive && (filesDir === undefined || !dirTarget));
  if (filesBad) {
    deps.log(FILES_USAGE);
    return 1;
  }
  const filesTarget = fromDrive ? driveTarget! : dirTarget!;
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
  const filesWork = join(values.work, "files-check");
  const manifestEnc = join(values.work, "files-manifest.json.gpg");
  const manifestClear = join(values.work, "files-manifest.json");
  const problems: string[] = [];
  let token: string | undefined;
  try {
    deps.mkdir(files);
    let encrypted = values.file ?? downloaded;
    if (fromDrive && driveTarget) {
      const sa = JSON.parse(saJson!) as ServiceAccount;
      token = await fetchAccessToken(deps.fetch, sa, Math.floor(deps.now().getTime() / 1000));
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
      log(failureSummary("decrypt_failed", opened));
      return 1;
    }
    const unpacked = deps.run("tar", ["-xf", tar, "-C", files]);
    if (unpacked.status !== 0) {
      log("untar_failed");
      return 1;
    }
    const expected = parseManifest(deps.readFile(join(files, "manifest.json")));
    const rolesFile = join(files, "roles.sql");
    const roles = withoutParameterGrants(deps.readFile(rolesFile));
    deps.writeFile(rolesFile, new TextEncoder().encode(roles.sql));
    deps.writeFile(join(files, "replica.sql"), new TextEncoder().encode(REPLICA_SQL));
    deps.writeFile(join(files, "cleanup.sql"), new TextEncoder().encode(CLEANUP_SQL));
    if (roles.skipped > 0) {
      log(`roles: ${roles.skipped} parameter grant${roles.skipped === 1 ? "" : "s"} left out`);
    }
    const restored = deps.run(
      "psql",
      psqlRestoreArgs(dbUrl, {
        roles: join(files, "roles.sql"),
        schema: join(files, "schema.sql"),
        historySchema: join(files, "history_schema.sql"),
        replica: join(files, "replica.sql"),
        data: join(files, "data.sql"),
        historyData: join(files, "history_data.sql"),
        cleanup: join(files, "cleanup.sql"),
      }),
    );
    if (restored.status !== 0) {
      const at = failureLocation(restored.stderr, (file) => {
        try {
          return deps.readFile(join(files, file)).split("\n");
        } catch {
          return null;
        }
      });
      log(`${failureSummary("restore_failed", restored)}${at ? ` at ${at}` : ""}`);
      return 1;
    }

    // A failed check query logs which one, with its exit status and SQLSTATE only (stderr can hold row values).
    const query = (name: string, sql: string): unknown => {
      const r = deps.run("psql", [
        dbUrl,
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        ...PSQL_SAFE_FLAGS,
        "-c",
        sql,
      ]);
      if (r.status !== 0) {
        log(failureSummary(`check_query_failed:${name}`, r));
        throw new Error("check_query_failed");
      }
      return JSON.parse(r.stdout);
    };
    const actual = buildManifest(query("manifest", MANIFEST_SQL), expected.createdAt);
    problems.push(...compareManifests(expected, actual));
    const check = query("restore_check", RESTORE_CHECK_SQL) as CheckRow;
    for (const finding of check.ledger) problems.push(`ledger ${finding.check}: ${finding.rows}`);
    if (check.cronJobs !== 0) problems.push(`cron jobs: ${check.cronJobs}`);
    if (check.vaultSecrets !== 0) problems.push(`vault secrets: ${check.vaultSecrets}`);
    for (const name of (values["require-nonzero"] ?? "").split(",").filter(Boolean)) {
      if ((actual.tables[name] ?? 0) <= 0) problems.push(`${name} is empty`);
    }

    let filesSummary: { objects: number; packsChecked: number; filesChecked: number } | undefined;
    if (wantFiles) {
      const store = fromDrive
        ? driveStore(deps.fetch, token!, folderId!)
        : (deps.dirStore ?? dirStore)(filesDir!);
      const files = (filesSummary = { objects: 0, packsChecked: 0, filesChecked: 0 });
      const listing = await store.list(filesTarget);
      const newestManifest = listing.find((f) => isFilesManifestName(f.name, filesTarget)) ?? null;
      let fresh = true;
      try {
        assertFresh(newestManifest, deps.now());
      } catch (error) {
        fresh = false;
        problems.push(
          (error as Error).message === "backup_missing"
            ? "files_manifest_missing"
            : "files_manifest_stale",
        );
      }
      if (fresh && newestManifest) {
        deps.writeFile(manifestEnc, await store.get(newestManifest));
        const opened = deps.run("gpg", gpgDecryptArgs(manifestEnc, manifestClear), {
          input: passphrase,
        });
        if (opened.status !== 0) {
          log(failureSummary("files_manifest_decrypt_failed", opened));
          return 1;
        }
        const manifest = parseFilesManifest(deps.readFile(manifestClear));
        files.objects = Object.keys(manifest.objects).length;
        const absent = missingPacks(
          manifest,
          listing.map((f) => f.name),
        );
        if (absent > 0) problems.push(`files: ${absent} packs named in the manifest are missing`);
        const restoredNames = query("restored_objects", RESTORED_OBJECTS_SQL) as string[];
        const orphans = missingFromManifest(restoredNames, manifest);
        if (orphans > 0) {
          problems.push(
            `files: ${orphans} objects of the database copy are not in the files manifest`,
          );
        }
        const chosen = choosePacks(manifest, filesCount, deps.random ?? Math.random);
        for (const [k, packName] of chosen.entries()) {
          const file = listing.find((f) => f.name === packName);
          if (!file) continue; // counted above
          const encrypted = join(filesWork, `${k}.tar.gpg`);
          const packTar = join(filesWork, `${k}.tar`);
          const dir = join(filesWork, String(k));
          deps.mkdir(dir);
          deps.writeFile(encrypted, await store.get(file));
          const unlocked = deps.run("gpg", gpgDecryptArgs(encrypted, packTar), {
            input: passphrase,
          });
          const unpackedPack =
            unlocked.status === 0 ? deps.run("tar", ["-xf", packTar, "-C", dir]) : unlocked;
          if (unlocked.status !== 0 || unpackedPack.status !== 0) {
            problems.push(`pack ${packName}: cannot be opened`);
          } else {
            files.packsChecked += 1;
            let index;
            try {
              index = parsePackIndex(
                new TextDecoder().decode(deps.readBytes!(join(dir, "index.json"))),
              );
            } catch {
              problems.push(`pack ${packName}: index differs from the manifest`);
            }
            if (index) {
              const result = checkPack(packName, index, manifest, (member) => {
                try {
                  return sha256Hex(deps.readBytes!(join(dir, member)));
                } catch {
                  return null;
                }
              });
              problems.push(...result.problems);
              files.filesChecked += result.filesChecked;
            }
          }
          deps.remove(encrypted);
          deps.remove(packTar);
          deps.remove(dir);
        }
        if (
          values["require-files"] === true &&
          !Object.values(manifest.objects).some((e) => e.removedAt === null)
        ) {
          problems.push("files: no object in the files manifest");
        }
      }
    }

    for (const problem of problems) log(`restore_check: ${problem}`);
    log(
      JSON.stringify({
        ok: problems.length === 0,
        problems: problems.length,
        migrations: actual.migrations.length,
        tables: actual.tables,
        ...(filesSummary ? { files: filesSummary } : {}),
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
    if (wantFiles) {
      deps.remove(filesWork);
      deps.remove(manifestEnc);
      deps.remove(manifestClear);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRestoreCheck(process.argv.slice(2), {
    env: process.env,
    run: spawnRunner,
    mkdir: (dir) => void mkdirSync(dir, { recursive: true }),
    readFile: (path) => readFileSync(path, "utf8"),
    readBytes: (path) => new Uint8Array(readFileSync(path)),
    writeFile: (path, bytes) => writeFileSync(path, bytes, { mode: 0o600 }),
    fetch,
    now: () => new Date(),
    remove: (path) => rmSync(path, { recursive: true, force: true }),
    log: (line) => console.log(line),
  }).then((code) => {
    process.exitCode = code;
  });
}
