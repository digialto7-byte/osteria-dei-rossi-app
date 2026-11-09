// Invoice-file backup model (ADR-034): the full files manifest, a pack's index and the diff that decides what a run must fetch.
// Pure functions: no I/O, no clock. Errors are fixed codes: never an object path, a hash or any value from the input.
import type { BackupTarget } from "./commands";

export type FileRef = { pack: string; member: string; sha256: string };
export type ManifestEntry = FileRef & {
  size: number;
  updatedAt: string;
  removedAt: string | null;
  previous: FileRef[];
};
export type FilesManifest = {
  version: 1;
  createdAt: string;
  target: BackupTarget;
  objects: Record<string, ManifestEntry>;
};
export type PackIndexEntry = { path: string; member: string; sha256: string; size: number };
export type PackIndex = {
  version: 1;
  createdAt: string;
  target: BackupTarget;
  objects: PackIndexEntry[];
};
export type ListedObject = { name: string; updatedAt: string };
export type PackedObject = PackIndexEntry & { updatedAt: string; pack: string };
export type FilesPlan = { toFetch: string[]; unchanged: string[]; newlyRemoved: string[] };

const HEX = /^[0-9a-f]{64}$/;
const PACK = /^osteria-files-\d{8}T\d{6}Z-(?:staging|production)-(?:0[1-9]|[1-9]\d)\.tar\.gpg$/;
const MEMBER = /^o\/\d{6}$/;
const MAX_PATH = 1024;

const has = (objects: Record<string, unknown>, key: string) => Object.hasOwn(objects, key);
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The entry of a path, never an inherited property (`constructor`, `__proto__`). */
export function entryOf(manifest: FilesManifest | null, path: string): ManifestEntry | undefined {
  return manifest !== null && has(manifest.objects, path) ? manifest.objects[path] : undefined;
}

/** What a run must do with the live object list, given the previous full manifest (null = none, or `--full`). */
export function planFilesRun(previous: FilesManifest | null, listed: ListedObject[]): FilesPlan {
  const toFetch: string[] = [];
  const unchanged: string[] = [];
  const live = new Set<string>();
  for (const { name, updatedAt } of [...listed].sort((a, b) => byCodeUnit(a.name, b.name))) {
    live.add(name);
    const known = entryOf(previous, name);
    if (known && known.removedAt === null && known.updatedAt === updatedAt) unchanged.push(name);
    else toFetch.push(name);
  }
  const newlyRemoved = Object.entries(previous?.objects ?? {})
    .filter(([path, e]) => e.removedAt === null && !live.has(path))
    .map(([path]) => path)
    .sort(byCodeUnit);
  return { toFetch, unchanged, newlyRemoved };
}

/**
 * The next full manifest. `packed` = objects whose bytes are new (a path with an earlier entry keeps that reference in
 * `previous`); `refreshed` = fetched objects whose bytes are the ones already stored (only `updatedAt` moves, and a removed
 * entry is live again); `newlyRemoved` = paths gone from the bucket (marked once, the pack reference stays).
 */
export function nextFilesManifest(
  previous: FilesManifest | null,
  packed: PackedObject[],
  refreshed: { path: string; updatedAt: string }[],
  newlyRemoved: string[],
  now: Date,
  target: BackupTarget,
): FilesManifest {
  const entries = new Map<string, ManifestEntry>();
  for (const [path, e] of Object.entries(previous?.objects ?? {})) entries.set(path, e);
  for (const path of newlyRemoved) {
    const e = entries.get(path);
    if (e && e.removedAt === null) entries.set(path, { ...e, removedAt: now.toISOString() });
  }
  for (const { path, updatedAt } of refreshed) {
    const e = entries.get(path);
    if (e) entries.set(path, { ...e, updatedAt, removedAt: null });
  }
  for (const p of packed) {
    const old = entries.get(p.path);
    entries.set(p.path, {
      sha256: p.sha256,
      size: p.size,
      updatedAt: p.updatedAt,
      pack: p.pack,
      member: p.member,
      removedAt: null,
      previous: old
        ? [...old.previous, { pack: old.pack, member: old.member, sha256: old.sha256 }]
        : [],
    });
  }
  const sorted = [...entries.entries()].sort(([a], [b]) => byCodeUnit(a, b));
  return {
    version: 1,
    createdAt: now.toISOString(),
    target,
    objects: Object.fromEntries(sorted),
  };
}

// ---- validators: plain, like manifest.ts ----

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isTarget = (v: unknown): v is BackupTarget => v === "staging" || v === "production";
const isDate = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
const isSize = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const hasControl = (text: string) =>
  [...text].some((ch) => {
    const code = ch.codePointAt(0)!;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
  });
export const isPath = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_PATH && !hasControl(v);
const isHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v);
const isPack = (v: unknown): v is string => typeof v === "string" && PACK.test(v);
const isMember = (v: unknown): v is string => typeof v === "string" && MEMBER.test(v);

function isRef(v: unknown): v is FileRef {
  return isRecord(v) && isPack(v.pack) && isMember(v.member) && isHex(v.sha256);
}

function isEntry(v: unknown): v is ManifestEntry {
  return (
    isRef(v) &&
    isSize((v as Record<string, unknown>).size) &&
    isDate((v as Record<string, unknown>).updatedAt) &&
    ((v as Record<string, unknown>).removedAt === null ||
      isDate((v as Record<string, unknown>).removedAt)) &&
    Array.isArray((v as Record<string, unknown>).previous) &&
    ((v as Record<string, unknown>).previous as unknown[]).every(isRef)
  );
}

function json(text: string, code: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(code);
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isDate(value.createdAt) ||
    !isTarget(value.target)
  ) {
    throw new Error(code);
  }
  return value;
}

/** Parses the decrypted files manifest; refuses anything that does not match the documented shape. */
export function parseFilesManifest(text: string): FilesManifest {
  const code = "files_manifest_invalid";
  const value = json(text, code);
  if (!isRecord(value.objects)) throw new Error(code);
  const objects: [string, ManifestEntry][] = [];
  for (const [path, e] of Object.entries(value.objects)) {
    if (!isPath(path) || !isEntry(e)) throw new Error(code);
    objects.push([path, e]);
  }
  return {
    version: 1,
    createdAt: value.createdAt as string,
    target: value.target as BackupTarget,
    objects: Object.fromEntries(objects),
  };
}

/** Parses a pack's `index.json`. */
export function parsePackIndex(text: string): PackIndex {
  const code = "pack_index_invalid";
  const value = json(text, code);
  if (!Array.isArray(value.objects)) throw new Error(code);
  const objects = value.objects.map((o: unknown): PackIndexEntry => {
    if (
      !isRecord(o) ||
      !isPath(o.path) ||
      !isMember(o.member) ||
      !isHex(o.sha256) ||
      !isSize(o.size)
    ) {
      throw new Error(code);
    }
    return { path: o.path, member: o.member, sha256: o.sha256, size: o.size };
  });
  return {
    version: 1,
    createdAt: value.createdAt as string,
    target: value.target as BackupTarget,
    objects,
  };
}
