// Daily backup, part 1 (M25 step 10, plan §3.1.5): dump roles, schema and data, write the manifest, pack and encrypt.
//   npx tsx scripts/backup/dump.ts --out <dir> --target staging|production --ref <project ref>
//   npx tsx scripts/backup/dump.ts --out <dir> --target staging --local      (the CI self-test: a local database, no ref)
// Environment: SUPABASE_DB_URL (session pooler, user postgres.<ref>), SUPABASE_URL, BACKUP_ENCRYPTION_PASSPHRASE.
// Output: <dir>/osteria-backup-<UTC stamp>-<target>.tar.gpg and its .sha256. The clear text stays in <dir>/work and
// <dir>/backup.tar and is removed before exit. Logs hold names and counts only, never the URL or the passphrase.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  assertLocalDbUrl,
  assertPassphrase,
  assertProjectRef,
  backupFileName,
  createLogger,
  dumpArgs,
  failureSummary,
  gpgEncryptArgs,
  PSQL_SAFE_FLAGS,
  urlSecrets,
  type BackupTarget,
  type DumpFile,
} from "../lib/backup/commands";
import { spawnRunner, type Runner } from "../lib/backup/exec";
import { buildManifest, MANIFEST_SQL } from "../lib/backup/manifest";

export type DumpDeps = {
  env: Record<string, string | undefined>;
  /** Absolute path of the supabase CLI: the dumps run in the work directory, outside the repository. */
  supabaseBin: string;
  run: Runner;
  mkdir: (dir: string) => void;
  writeFile: (path: string, text: string) => void;
  remove: (path: string) => void;
  sha256: (path: string) => string;
  now: () => Date;
  log: (line: string) => void;
};

const FILES: DumpFile[] = ["roles", "schema", "data", "history_schema", "history_data"];
const REQUIRED = ["SUPABASE_DB_URL", "SUPABASE_URL", "BACKUP_ENCRYPTION_PASSPHRASE"] as const;
const USAGE = "Usage: dump --out <dir> --target staging|production (--ref <project ref> | --local)";

export async function runDump(argv: string[], deps: DumpDeps): Promise<number> {
  const { env } = deps;
  let values: { out?: string; target?: string; ref?: string; local?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        out: { type: "string" },
        target: { type: "string" },
        ref: { type: "string" },
        local: { type: "boolean" },
      },
    }));
  } catch {
    deps.log(USAGE);
    return 1;
  }
  const target = (["staging", "production"] as const).find((t) => t === values.target);
  const local = values.local === true;
  if (!values.out || !target || (local ? values.ref !== undefined : !values.ref)) {
    deps.log(USAGE);
    return 1;
  }
  const missing = REQUIRED.filter((name) => !env[name] && !(local && name === "SUPABASE_URL"));
  if (missing.length > 0) {
    deps.log(`backup_env_missing:${missing.join(",")}`);
    return 1;
  }
  const dbUrl = env.SUPABASE_DB_URL!;
  const passphrase = env.BACKUP_ENCRYPTION_PASSPHRASE!;
  const log = createLogger(deps.log, [...urlSecrets(dbUrl), passphrase]);

  // These errors are fixed codes without a value, so they go through the plain logger (a short passphrase such as "short"
  // would otherwise be redacted out of its own error code).
  try {
    assertPassphrase(passphrase);
    if (local) {
      try {
        assertLocalDbUrl(dbUrl);
      } catch {
        throw new Error("backup_source_not_local");
      }
    } else {
      assertProjectRef(dbUrl, env.SUPABASE_URL!, values.ref!);
    }
  } catch (error) {
    deps.log((error as Error).message);
    return 1;
  }

  const out = values.out;
  const work = join(out, "work");
  const tar = join(out, "backup.tar");
  const name = backupFileName(deps.now(), target as BackupTarget);
  const encrypted = join(out, name);
  try {
    deps.mkdir(work);
    for (const file of FILES) {
      const [, ...args] = dumpArgs(file, dbUrl);
      const result = deps.run(deps.supabaseBin, args, { cwd: work });
      if (result.status !== 0) {
        log(failureSummary(`dump_failed:${file}`, result));
        return 1;
      }
    }
    const counts = deps.run("psql", [
      dbUrl,
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      ...PSQL_SAFE_FLAGS,
      "-c",
      MANIFEST_SQL,
    ]);
    if (counts.status !== 0) {
      log(failureSummary("manifest_failed", counts));
      return 1;
    }
    const manifest = buildManifest(JSON.parse(counts.stdout), deps.now().toISOString());
    deps.writeFile(join(work, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    const packed = deps.run("tar", [
      "-cf",
      tar,
      "-C",
      work,
      "roles.sql",
      "schema.sql",
      "data.sql",
      "history_schema.sql",
      "history_data.sql",
      "manifest.json",
    ]);
    if (packed.status !== 0) {
      log("tar_failed");
      return 1;
    }
    const sealed = deps.run("gpg", gpgEncryptArgs(tar, encrypted), { input: passphrase });
    if (sealed.status !== 0) {
      log(failureSummary("encrypt_failed", sealed));
      return 1;
    }
    const sha256 = deps.sha256(encrypted);
    deps.writeFile(`${encrypted}.sha256`, `${sha256}  ${name}\n`);
    log(JSON.stringify({ file: name, sha256, tables: manifest.tables }));
    return 0;
  } catch {
    log("dump_failed:unexpected");
    return 1;
  } finally {
    deps.remove(work);
    deps.remove(tar);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDump(process.argv.slice(2), {
    env: process.env,
    supabaseBin: fileURLToPath(new URL("../../node_modules/.bin/supabase", import.meta.url)),
    run: spawnRunner,
    mkdir: (dir) => void mkdirSync(dir, { recursive: true }),
    writeFile: (path, text) => writeFileSync(path, text, { mode: 0o600 }),
    remove: (path) => rmSync(path, { recursive: true, force: true }),
    sha256: (path) => createHash("sha256").update(readFileSync(path)).digest("hex"),
    now: () => new Date(),
    log: (line) => console.log(line),
  }).then((code) => {
    process.exitCode = code;
  });
}
