// Daily backup, part 3 (ADR-034): the invoice files. New objects of the private bucket `invoices` go into one encrypted tar pack
// per run (split at 200 MiB); an encrypted full manifest is written on every run; packs are never deleted by code.
//   npx tsx scripts/backup/files.ts --work <dir> --target staging|production --keep <n>
//                                   (--ref <project ref> | --local --store-dir <dir>) [--full]
// Environment: SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SECRET_KEY, BACKUP_ENCRYPTION_PASSPHRASE and, without --store-dir,
// BACKUP_DRIVE_SA_JSON and BACKUP_DRIVE_FOLDER_ID.
// Object paths come from storage.objects and are untrusted: they never become a file-system path, a command argument or a log
// line. Inside a pack every object has a generated member name (o/000001); the real path is only in the encrypted index and
// manifest. Logs hold counts, byte totals, our own Drive file names and error codes. The secret key is used only by
// `downloadObject`; no error carries a URL, a header, a key or a path.
// Fail loud: nothing is uploaded until every download succeeded, and a manifest only names files that were packed.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import {
  assertLocalApiUrl,
  assertLocalDbUrl,
  assertPassphrase,
  assertProjectRef,
  createLogger,
  failureSummary,
  FILES_LIST_SQL,
  filesManifestName,
  filesPackName,
  gpgDecryptArgs,
  gpgEncryptArgs,
  isFilesManifestName,
  isFilesPackName,
  PSQL_SAFE_FLAGS,
  urlSecrets,
  type BackupTarget,
} from "../lib/backup/commands";
import { fetchAccessToken, type ServiceAccount } from "../lib/backup/drive";
import { spawnRunner, type Runner } from "../lib/backup/exec";
import {
  entryOf,
  isPath,
  nextFilesManifest,
  parseFilesManifest,
  planFilesRun,
  type FilesManifest,
  type ListedObject,
  type PackedObject,
  type PackIndexEntry,
} from "../lib/backup/files-manifest";
import { dirStore, driveStore, type BackupStore } from "../lib/backup/store";

export const MAX_PACK_BYTES = 200 * 1024 * 1024;
export const MAX_RUN_BYTES = 1024 * 1024 * 1024;
export const INVOICE_BUCKET = "invoices";

export type StoreOptions = { storeDir?: string; saJson?: string; folderId?: string };
export type FilesDeps = {
  env: Record<string, string | undefined>;
  run: Runner;
  mkdir: (dir: string) => void;
  writeFile: (path: string, bytes: Uint8Array) => void;
  readFile: (path: string) => Uint8Array;
  remove: (path: string) => void;
  now: () => Date;
  log: (line: string) => void;
  openStore: (options: StoreOptions) => Promise<BackupStore>;
  /** The only code that holds the secret key. It throws a plain error (no URL, header, key or path). */
  downloadObject: (path: string) => Promise<Uint8Array>;
  limits?: { packBytes: number; runBytes: number };
};

const USAGE =
  "Usage: files --work <dir> --target staging|production --keep <n> (--ref <project ref> | --local --store-dir <dir>) [--full]";
const ALWAYS = [
  "SUPABASE_DB_URL",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "BACKUP_ENCRYPTION_PASSPHRASE",
] as const;
const DRIVE = ["BACKUP_DRIVE_SA_JSON", "BACKUP_DRIVE_FOLDER_ID"] as const;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const member = (n: number) => `o/${String(n).padStart(6, "0")}`;
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function parseListing(stdout: string): ListedObject[] | null {
  try {
    const rows: unknown = JSON.parse(stdout);
    if (!Array.isArray(rows)) return null;
    const out: ListedObject[] = [];
    for (const row of rows) {
      if (typeof row?.name !== "string" || typeof row?.updatedAt !== "string") return null;
      out.push({ name: row.name, updatedAt: row.updatedAt });
    }
    return out;
  } catch {
    return null;
  }
}

type Sealed = { name: string; path: string };

export async function runFiles(argv: string[], deps: FilesDeps): Promise<number> {
  const { env } = deps;
  let values: {
    work?: string;
    target?: string;
    keep?: string;
    ref?: string;
    local?: boolean;
    "store-dir"?: string;
    full?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        work: { type: "string" },
        target: { type: "string" },
        keep: { type: "string" },
        ref: { type: "string" },
        local: { type: "boolean" },
        "store-dir": { type: "string" },
        full: { type: "boolean" },
      },
    }));
  } catch {
    deps.log(USAGE);
    return 1;
  }
  const target = (["staging", "production"] as const).find((t) => t === values.target);
  const keep = Number(values.keep);
  const local = values.local === true;
  const storeDir = values["store-dir"];
  // --local and --store-dir only together; --ref only without them.
  const modeOk = local
    ? storeDir !== undefined && values.ref === undefined
    : storeDir === undefined && !!values.ref;
  if (!values.work || !target || !Number.isInteger(keep) || keep < 1 || !modeOk) {
    deps.log(USAGE);
    return 1;
  }
  const required = [...ALWAYS, ...(storeDir === undefined ? DRIVE : [])];
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    deps.log(`backup_env_missing:${missing.join(",")}`);
    return 1;
  }
  const dbUrl = env.SUPABASE_DB_URL!;
  const apiUrl = env.SUPABASE_URL!;
  const passphrase = env.BACKUP_ENCRYPTION_PASSPHRASE!;
  const log = createLogger(deps.log, [
    ...urlSecrets(dbUrl),
    passphrase,
    env.SUPABASE_SECRET_KEY!,
    env.BACKUP_DRIVE_SA_JSON ?? "",
    env.BACKUP_DRIVE_FOLDER_ID ?? "",
  ]);

  // Fixed codes without a value: the plain logger (a short passphrase would be redacted out of its own code).
  try {
    assertPassphrase(passphrase);
    if (local) {
      try {
        assertLocalDbUrl(dbUrl);
      } catch {
        throw new Error("files_source_not_local");
      }
      assertLocalApiUrl(apiUrl);
    } else {
      assertProjectRef(dbUrl, apiUrl, values.ref!);
    }
  } catch (error) {
    deps.log((error as Error).message);
    return 1;
  }

  const limits = deps.limits ?? { packBytes: MAX_PACK_BYTES, runBytes: MAX_RUN_BYTES };
  const work = values.work;
  const packDir = join(work, "pack");
  const tarPath = join(work, "pack.tar");
  const startedAt = deps.now();
  const bucketTarget: BackupTarget = target;
  try {
    deps.mkdir(work);
    const store = await deps.openStore({
      storeDir,
      saJson: env.BACKUP_DRIVE_SA_JSON,
      folderId: env.BACKUP_DRIVE_FOLDER_ID,
    });
    const listing = await store.list(bucketTarget);
    const taken = new Set(listing.map((f) => f.name));

    // The previous full manifest (none for the first run or for --full).
    let previous: FilesManifest | null = null;
    const newest = listing.find((f) => isFilesManifestName(f.name, bucketTarget));
    if (newest && values.full !== true) {
      const encrypted = join(work, "previous.json.gpg");
      const clear = join(work, "previous.json");
      deps.writeFile(encrypted, await store.get(newest));
      const opened = deps.run("gpg", gpgDecryptArgs(encrypted, clear), { input: passphrase });
      try {
        if (opened.status !== 0) throw new Error("unreadable");
        previous = parseFilesManifest(new TextDecoder().decode(deps.readFile(clear)));
      } catch {
        log("files_manifest_unreadable");
        return 1;
      }
    }

    const listed = deps.run("psql", [
      dbUrl,
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      ...PSQL_SAFE_FLAGS,
      "-c",
      FILES_LIST_SQL,
    ]);
    if (listed.status !== 0) {
      log(failureSummary("files_list_failed", listed));
      return 1;
    }
    const objects = parseListing(listed.stdout);
    if (objects === null) {
      log("files_list_invalid");
      return 1;
    }
    // A path the manifest and index could not carry (control character, empty, too long) must not be skipped quietly.
    const unusable = objects.filter((o) => !isPath(o.name)).length;
    if (unusable > 0) {
      log(`files_path_invalid (${unusable} object${unusable === 1 ? "" : "s"})`);
      return 1;
    }
    const updatedAtOf = new Map(objects.map((o) => [o.name, o.updatedAt]));
    const plan = planFilesRun(previous, objects);

    // Download everything first; seal packs to disk (encrypted); upload only when every download has succeeded.
    const sealed: Sealed[] = [];
    const packed: PackedObject[] = [];
    const refreshed: { path: string; updatedAt: string }[] = [];
    let open: PackIndexEntry[] = [];
    let openBytes = 0;
    let seq = 0;
    let added = 0;
    let changed = 0;
    let downloaded = 0;
    let capReached = false;

    const seal = () => {
      if (open.length === 0) return;
      seq += 1;
      const name = filesPackName(startedAt, bucketTarget, seq);
      if (taken.has(name)) throw new Error("files_name_taken");
      taken.add(name);
      deps.writeFile(
        join(packDir, "index.json"),
        encode({
          version: 1,
          createdAt: startedAt.toISOString(),
          target: bucketTarget,
          objects: open,
        }),
      );
      const tarred = deps.run("tar", ["-cf", tarPath, "-C", packDir, "index.json", "o"]);
      if (tarred.status !== 0) throw new Error("tar_failed");
      const path = join(work, name);
      const sealedOk = deps.run("gpg", gpgEncryptArgs(tarPath, path), { input: passphrase });
      if (sealedOk.status !== 0) throw new Error("encrypt_failed");
      for (const entry of open)
        packed.push({ ...entry, updatedAt: updatedAtOf.get(entry.path)!, pack: name });
      sealed.push({ name, path });
      deps.remove(packDir);
      deps.remove(tarPath);
      open = [];
      openBytes = 0;
    };

    const total = plan.toFetch.length;
    for (const [i, path] of plan.toFetch.entries()) {
      if (downloaded >= limits.runBytes) {
        capReached = true;
        break;
      }
      let bytes: Uint8Array | null = null;
      for (let attempt = 0; attempt < 2 && bytes === null; attempt++) {
        try {
          bytes = await deps.downloadObject(path);
        } catch {
          // one retry; the error is dropped: it may carry the path or the request
        }
      }
      if (bytes === null) {
        log(`files_download_failed (object ${i + 1} of ${total})`);
        return 1;
      }
      downloaded += bytes.byteLength;
      const hash = sha256(bytes);
      const old = entryOf(previous, path);
      if (old && old.sha256 === hash) {
        refreshed.push({ path, updatedAt: updatedAtOf.get(path)! });
        continue;
      }
      if (old) changed += 1;
      else added += 1;
      if (open.length > 0 && openBytes + bytes.byteLength > limits.packBytes) seal();
      if (open.length === 0) deps.mkdir(join(packDir, "o"));
      const memberName = member(open.length + 1);
      deps.writeFile(join(packDir, memberName), bytes);
      open.push({ path, member: memberName, sha256: hash, size: bytes.byteLength });
      openBytes += bytes.byteLength;
    }
    seal();

    // The manifest names only what is packed. Encrypt it, then upload packs, then the manifest.
    const now = deps.now();
    const next = nextFilesManifest(
      previous,
      packed,
      refreshed,
      plan.newlyRemoved,
      now,
      bucketTarget,
    );
    const manifestName = filesManifestName(now, bucketTarget);
    if (taken.has(manifestName)) throw new Error("files_name_taken");
    const manifestPlain = join(work, "manifest.json");
    const manifestEnc = join(work, manifestName);
    deps.writeFile(manifestPlain, encode(next));
    const encrypted = deps.run("gpg", gpgEncryptArgs(manifestPlain, manifestEnc), {
      input: passphrase,
    });
    if (encrypted.status !== 0) {
      log(failureSummary("encrypt_failed", encrypted));
      return 1;
    }
    for (const pack of sealed) await store.put(pack.name, deps.readFile(pack.path));
    await store.put(manifestName, deps.readFile(manifestEnc));
    await store.retain(bucketTarget, keep);

    const bytes = packed.reduce((sum, p) => sum + p.size, 0);
    log(
      JSON.stringify({
        objects: Object.values(next.objects).filter((o) => o.removedAt === null).length,
        new: added,
        changed,
        removed: plan.newlyRemoved.length,
        packs: sealed.map((p) => p.name),
        bytes,
        manifest: manifestName,
      }),
    );
    if (capReached) {
      log("files_run_cap_reached");
      return 1;
    }
    if (bucketTarget === "production" && changed + plan.newlyRemoved.length > 0) {
      log("files_bucket_anomaly");
      return 1;
    }
    return 0;
  } catch (error) {
    const message = (error as Error).message;
    log(/^[a-z_]+(:[a-z0-9_]+)?$/.test(message) ? message : "files_run_failed:unexpected");
    return 1;
  } finally {
    deps.remove(work);
  }
}

/** The store of a real run: the Shared Drive, or a directory in the self-test. */
export function defaultOpenStore(fetchFn: typeof fetch, now: () => Date) {
  return async ({ storeDir, saJson, folderId }: StoreOptions): Promise<BackupStore> => {
    if (storeDir !== undefined) return dirStore(storeDir);
    let sa: ServiceAccount;
    try {
      const parsed = JSON.parse(saJson ?? "") as Partial<ServiceAccount>;
      if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string")
        throw new Error("shape");
      sa = { client_email: parsed.client_email, private_key: parsed.private_key };
    } catch {
      throw new Error("drive_service_account_invalid");
    }
    const token = await fetchAccessToken(fetchFn, sa, Math.floor(now().getTime() / 1000));
    return driveStore(fetchFn, token, folderId ?? "");
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const now = () => new Date();
  runFiles(process.argv.slice(2), {
    env: process.env,
    run: spawnRunner,
    mkdir: (dir) => void mkdirSync(dir, { recursive: true }),
    writeFile: (path, bytes) => writeFileSync(path, bytes, { mode: 0o600 }),
    readFile: (path) => readFileSync(path),
    remove: (path) => rmSync(path, { recursive: true, force: true }),
    now,
    log: (line) => console.log(line),
    openStore: defaultOpenStore(fetch, now),
    downloadObject: async (path) => {
      const client = createClient(
        process.env.SUPABASE_URL ?? "",
        process.env.SUPABASE_SECRET_KEY ?? "",
        {
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );
      const { data, error } = await client.storage.from(INVOICE_BUCKET).download(path);
      // Never rethrow the library's error: it can carry the request URL and the path.
      if (error || !data) throw new Error("download_failed");
      return new Uint8Array(await data.arrayBuffer());
    },
  }).then((code) => {
    process.exitCode = code;
  });
}
