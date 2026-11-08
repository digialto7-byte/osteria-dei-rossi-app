// Daily backup, part 2 (M25 step 12): upload the encrypted file to the Shared Drive folder, verify its MD5, then keep only
// the newest N backups of the target.
//   npx tsx scripts/backup/upload.ts --file <osteria-backup-….tar.gpg> --target staging|production --keep 14
// Environment: BACKUP_DRIVE_SA_JSON (the service account's JSON key), BACKUP_DRIVE_FOLDER_ID.
// Prints one JSON line: the file name, its size and how many old copies were deleted. Never a key, token or folder id.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isBackupFileName, type BackupTarget } from "../lib/backup/commands";
import {
  applyRetention,
  fetchAccessToken,
  uploadResumable,
  type ServiceAccount,
} from "../lib/backup/drive";

export type UploadDeps = {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  readFile: (path: string) => Uint8Array;
  now: () => Date;
  log: (line: string) => void;
};

const USAGE = "Usage: upload --file <x.tar.gpg> --target staging|production --keep <n>";

export async function runUpload(argv: string[], deps: UploadDeps): Promise<number> {
  let values: { file?: string; target?: string; keep?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: { file: { type: "string" }, target: { type: "string" }, keep: { type: "string" } },
    }));
  } catch {
    deps.log(USAGE);
    return 1;
  }
  const target = (["staging", "production"] as const).find((t) => t === values.target) as
    BackupTarget | undefined;
  const keep = Number(values.keep);
  if (!values.file || !target) {
    deps.log(USAGE);
    return 1;
  }
  const name = basename(values.file);
  if (!isBackupFileName(name, target)) {
    deps.log("upload_file_not_a_backup_of_target");
    return 1;
  }
  if (!Number.isInteger(keep) || keep < 1) {
    deps.log("retention_keep_invalid");
    return 1;
  }
  const { BACKUP_DRIVE_SA_JSON: saJson, BACKUP_DRIVE_FOLDER_ID: folderId } = deps.env;
  if (!saJson || !folderId) {
    deps.log("backup_env_missing:BACKUP_DRIVE_SA_JSON,BACKUP_DRIVE_FOLDER_ID");
    return 1;
  }
  let sa: ServiceAccount;
  try {
    const parsed = JSON.parse(saJson) as Partial<ServiceAccount>;
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
      throw new Error("shape");
    }
    sa = { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    deps.log("drive_service_account_invalid");
    return 1;
  }
  try {
    const bytes = deps.readFile(values.file);
    const token = await fetchAccessToken(deps.fetch, sa, Math.floor(deps.now().getTime() / 1000));
    await uploadResumable(deps.fetch, token, folderId, name, bytes);
    const { deleted } = await applyRetention(deps.fetch, token, folderId, target, keep);
    deps.log(JSON.stringify({ uploaded: name, bytes: bytes.byteLength, deleted: deleted.length }));
    return 0;
  } catch (error) {
    const message = (error as Error).message;
    deps.log(/^[a-z_]+(:[a-z0-9_]+)?$/.test(message) ? message : "upload_failed:unexpected");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runUpload(process.argv.slice(2), {
    env: process.env,
    fetch,
    readFile: (path) => readFileSync(path),
    now: () => new Date(),
    log: (line) => console.log(line),
  }).then((code) => {
    process.exitCode = code;
  });
}
