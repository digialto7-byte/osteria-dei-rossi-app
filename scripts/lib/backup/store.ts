// Where the invoice-file packs and manifests live (ADR-034): the Shared Drive in production, a plain directory in the CI
// self-test. Both refuse any name that is not one of our file names, so a name can never be a path. Errors are fixed codes.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  isBackupFileName,
  isFilesManifestName,
  isFilesPackName,
  stampOf,
  type BackupTarget,
} from "./commands";
import { applyRetention, download, listFiles, uploadResumable, type DriveFile } from "./drive";

export type StoreFile = DriveFile;

export interface BackupStore {
  /** The target's packs and manifests, newest first. */
  list(target: BackupTarget): Promise<StoreFile[]>;
  /** Stores the bytes under a name of ours. Drive allows duplicate names; callers check `list` first. */
  put(name: string, bytes: Uint8Array): Promise<void>;
  /** The bytes of a listed file; throws `backup_checksum_mismatch` when they do not match its MD5. */
  get(file: StoreFile): Promise<Uint8Array>;
  /** Keeps the newest `keep` manifests of the target and deletes the others. Packs are never deleted. Returns the names deleted. */
  retain(target: BackupTarget, keep: number): Promise<string[]>;
}

const TARGETS: BackupTarget[] = ["staging", "production"];
const isOurName = (name: string) =>
  TARGETS.some(
    (t) => isBackupFileName(name, t) || isFilesPackName(name, t) || isFilesManifestName(name, t),
  );
const isFilesName = (name: string, target: BackupTarget) =>
  isFilesPackName(name, target) || isFilesManifestName(name, target);

function assertName(name: string): void {
  if (!isOurName(name)) throw new Error("store_name_invalid");
}

// MD5 is Drive's own checksum, used to detect a damaged transfer, not for security.
const md5 = (bytes: Uint8Array) => createHash("md5").update(bytes).digest("hex");

function checked(file: StoreFile, bytes: Uint8Array): Uint8Array {
  if (md5(bytes) !== file.md5Checksum) throw new Error("backup_checksum_mismatch");
  return bytes;
}

export function driveStore(fetchFn: typeof fetch, token: string, folderId: string): BackupStore {
  return {
    list: (target) =>
      listFiles(fetchFn, token, folderId, "osteria-files-", (name) => isFilesName(name, target)),
    async put(name, bytes) {
      assertName(name);
      await uploadResumable(fetchFn, token, folderId, name, bytes);
    },
    async get(file) {
      assertName(file.name);
      return checked(file, await download(fetchFn, token, file.id));
    },
    async retain(target, keep) {
      return (await applyRetention(fetchFn, token, folderId, target, keep, "files-manifest"))
        .deleted;
    },
  };
}

/** `20261109T021507Z` -> `2026-11-09T02:15:07Z`. */
function isoOfStamp(name: string): string {
  const s = stampOf(name) ?? "";
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
}

export function dirStore(dir: string): BackupStore {
  const list = async (target: BackupTarget): Promise<StoreFile[]> =>
    readdirSync(dir)
      .filter((name) => isFilesName(name, target))
      .map((name) => ({
        id: name,
        name,
        createdTime: isoOfStamp(name),
        md5Checksum: md5(readFileSync(join(dir, name))),
      }))
      .sort((a, b) => b.createdTime.localeCompare(a.createdTime) || b.name.localeCompare(a.name));
  return {
    list,
    async put(name, bytes) {
      assertName(name);
      const path = join(dir, name);
      if (existsSync(path)) throw new Error("store_name_exists");
      writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
    },
    async get(file) {
      assertName(file.name);
      return checked(file, new Uint8Array(readFileSync(join(dir, file.name))));
    },
    async retain(target, keep) {
      if (!Number.isInteger(keep) || keep < 1) throw new Error("retention_keep_invalid");
      const old = (await list(target))
        .filter((f) => isFilesManifestName(f.name, target))
        .slice(keep);
      for (const file of old) unlinkSync(join(dir, file.name));
      return old.map((f) => f.name);
    },
  };
}
