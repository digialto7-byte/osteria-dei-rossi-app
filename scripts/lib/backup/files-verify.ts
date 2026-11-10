// Weekly verification of the invoice-file backup (ADR-034): which packs to open, and what a pack must hold. Pure functions.
// Problems name the pack and counts only: never an object path or a hash.
import type { FilesManifest, PackIndex } from "./files-manifest";

type Expected = { path: string; member: string; sha256: string };

/** Every pack the manifest names, in the current references and in `previous`, oldest first (names sort by stamp). */
function namedPacks(manifest: FilesManifest): string[] {
  const names = new Set<string>();
  for (const e of Object.values(manifest.objects)) {
    names.add(e.pack);
    for (const p of e.previous) names.add(p.pack);
  }
  return [...names].sort();
}

/** The newest pack plus random others, `n` in all (`"all"` = every pack). `random` is injected: () => [0, 1). */
export function choosePacks(
  manifest: FilesManifest,
  n: number | "all",
  random: () => number,
): string[] {
  const packs = namedPacks(manifest);
  if (packs.length === 0) return [];
  if (n === "all" || n >= packs.length) return packs;
  const newest = packs[packs.length - 1]!;
  const others = packs.slice(0, -1);
  const chosen = [newest];
  for (let want = Math.max(1, n) - 1; want > 0 && others.length > 0; want--) {
    const i = Math.min(others.length - 1, Math.floor(random() * others.length));
    chosen.push(others.splice(i, 1)[0]!);
  }
  return chosen;
}

/** What the manifest says one pack must hold: current entries and history entries that point into it. */
function expectedIn(packName: string, manifest: FilesManifest): Expected[] {
  const out: Expected[] = [];
  for (const [path, e] of Object.entries(manifest.objects)) {
    if (e.pack === packName) out.push({ path, member: e.member, sha256: e.sha256 });
    for (const p of e.previous) {
      if (p.pack === packName) out.push({ path, member: p.member, sha256: p.sha256 });
    }
  }
  return out;
}

const key = (e: Expected) => JSON.stringify([e.path, e.member, e.sha256]);

/**
 * Checks one opened pack: its `index.json` must equal the manifest's references to it, and the sha256 of every member
 * (`sha256Of(member)`, null when the member is missing) must equal the manifest's.
 */
export function checkPack(
  packName: string,
  index: PackIndex,
  manifest: FilesManifest,
  sha256Of: (member: string) => string | null,
): { problems: string[]; filesChecked: number } {
  const expected = expectedIn(packName, manifest);
  const problems: string[] = [];
  const want = expected.map(key).sort();
  const have = index.objects.map(key).sort();
  if (want.length !== have.length || want.some((k, i) => k !== have[i])) {
    problems.push(`pack ${packName}: index differs from the manifest`);
  }
  const differ = expected.filter((e) => sha256Of(e.member) !== e.sha256).length;
  if (differ > 0)
    problems.push(`pack ${packName}: ${differ} ${differ === 1 ? "file differs" : "files differ"}`);
  return { problems, filesChecked: expected.length };
}

/** How many of the restored database's `invoices` object names have no manifest entry (a removed entry counts as present). */
export function missingFromManifest(restoredNames: string[], manifest: FilesManifest): number {
  return restoredNames.filter((name) => !Object.hasOwn(manifest.objects, name)).length;
}

/** How many packs the manifest names that the store does not list. */
export function missingPacks(manifest: FilesManifest, listed: string[]): number {
  const have = new Set(listed);
  return namedPacks(manifest).filter((name) => !have.has(name)).length;
}
