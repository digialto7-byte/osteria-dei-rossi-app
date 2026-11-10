import { describe, expect, it } from "vitest";
import {
  checkPack,
  choosePacks,
  missingFromManifest,
  missingPacks,
} from "../../../scripts/lib/backup/files-verify";
import type { FilesManifest, PackIndex } from "../../../scripts/lib/backup/files-manifest";

// Fake data only.
const T1 = "11111111-1111-4111-8111-111111111111";
const A = `${T1}/2026/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`;
const B = `${T1}/2026/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf`;
const C = `${T1}/2026/Mario Rossi fattura.pdf`;
const H = (c: string) => c.repeat(64);
const pack = (day: number, nn = "01") =>
  `osteria-files-202611${String(day).padStart(2, "0")}T021500Z-production-${nn}.tar.gpg`;

const ref = (day: number, member: string, c: string) => ({ pack: pack(day), member, sha256: H(c) });
const entry = (r: ReturnType<typeof ref>, over: object = {}) => ({
  ...r,
  size: 5,
  updatedAt: "2026-11-01T10:00:00+00:00",
  removedAt: null,
  previous: [],
  ...over,
});
function manifestOf(objects: FilesManifest["objects"]): FilesManifest {
  return { version: 1, createdAt: "2026-11-09T02:15:00.000Z", target: "production", objects };
}
const manifest = manifestOf({
  [A]: entry(ref(1, "o/000001", "a")),
  [B]: entry(ref(2, "o/000001", "b"), {
    previous: [ref(1, "o/000002", "c")], // B's earlier bytes live in pack 1, member 2
  }),
  [C]: entry(ref(3, "o/000001", "d"), { removedAt: "2026-11-08T00:00:00.000Z" }),
});
const index = (
  day: number,
  objects: { path: string; member: string; sha256: string }[],
): PackIndex => ({
  version: 1,
  createdAt: "2026-11-09T02:15:00.000Z",
  target: "production",
  objects: objects.map((o) => ({ ...o, size: 5 })),
});
const index1 = () =>
  index(1, [
    { path: A, member: "o/000001", sha256: H("a") },
    { path: B, member: "o/000002", sha256: H("c") },
  ]);

describe("choosePacks", () => {
  const many = manifestOf(
    Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((d) => [`${T1}/2026/f${d}.pdf`, entry(ref(d, "o/000001", "a"))]),
    ),
  );

  it("always includes the newest pack", () => {
    for (const r of [0, 0.5, 0.999]) {
      expect(choosePacks(many, 2, () => r)).toContain(pack(6));
    }
  });

  it("n at or above the pack count, or 'all', gives every pack", () => {
    const all = [1, 2, 3, 4, 5, 6].map((d) => pack(d));
    expect(choosePacks(many, 6, () => 0.3).sort()).toEqual(all);
    expect(choosePacks(many, 50, () => 0.3).sort()).toEqual(all);
    expect(choosePacks(many, "all", () => 0.3).sort()).toEqual(all);
  });

  it("returns n distinct packs for a smaller n, and a fixed random gives a fixed choice", () => {
    const seq = () => {
      const values = [0.1, 0.7, 0.4, 0.9];
      let i = 0;
      return () => values[i++ % values.length]!;
    };
    const first = choosePacks(many, 3, seq());
    const again = choosePacks(many, 3, seq());
    expect(first).toEqual(again);
    expect(new Set(first).size).toBe(3);
    expect(first[0]).toBe(pack(6));
  });

  it("counts a pack that only a previous reference or a removed entry names", () => {
    expect(choosePacks(manifest, "all", () => 0).sort()).toEqual([pack(1), pack(2), pack(3)]);
  });

  it("an empty manifest has no packs; n below 1 still gives the newest only when there is one", () => {
    expect(choosePacks(manifestOf({}), "all", () => 0)).toEqual([]);
    expect(choosePacks(many, 0, () => 0)).toEqual([pack(6)]);
  });
});

describe("checkPack", () => {
  const sums: Record<string, string> = { "o/000001": H("a"), "o/000002": H("c") };
  const sha = (m: string) => sums[m] ?? null;

  it("passes when the index matches the manifest, previous references included, and every hash matches", () => {
    expect(checkPack(pack(1), index1(), manifest, sha)).toEqual({ problems: [], filesChecked: 2 });
  });

  it("one member with another sha256 gives 'pack <name>: 1 file differs', with no path", () => {
    const { problems } = checkPack(pack(1), index1(), manifest, (m) =>
      m === "o/000002" ? H("f") : sha(m),
    );
    expect(problems).toEqual([`pack ${pack(1)}: 1 file differs`]);
    expect(problems.join()).not.toContain(T1);
  });

  it("says 'files differ' for several, and counts an unreadable member as differing", () => {
    const { problems } = checkPack(pack(1), index1(), manifest, () => null);
    expect(problems).toEqual([`pack ${pack(1)}: 2 files differ`]);
  });

  it("an index with an extra entry, a missing entry or another hash differs from the manifest", () => {
    const extra = index1();
    extra.objects.push({ path: C, member: "o/000003", sha256: H("e"), size: 5 });
    const missing = index1();
    missing.objects.pop();
    const other = index1();
    other.objects[0]!.sha256 = H("9");
    for (const bad of [extra, missing, other]) {
      const { problems } = checkPack(pack(1), bad, manifest, sha);
      expect(problems).toContain(`pack ${pack(1)}: index differs from the manifest`);
      expect(problems.join()).not.toContain(T1);
      expect(problems.join()).not.toContain("Mario");
    }
  });

  it("an index that moves a path to another member differs", () => {
    const moved = index1();
    moved.objects[0]!.member = "o/000009";
    expect(checkPack(pack(1), moved, manifest, sha).problems).toContain(
      `pack ${pack(1)}: index differs from the manifest`,
    );
  });
});

describe("missingFromManifest", () => {
  it("a removed entry is not a problem", () => {
    expect(missingFromManifest([A, B, C], manifest)).toBe(0);
  });

  it("counts restored names that have no entry, never listing them", () => {
    expect(missingFromManifest([A, "x/1.pdf", "x/2.pdf"], manifest)).toBe(2);
    expect(missingFromManifest([], manifest)).toBe(0);
  });

  it("does not treat inherited keys as entries", () => {
    expect(missingFromManifest(["constructor", "__proto__", "toString"], manifestOf({}))).toBe(3);
  });
});

describe("missingPacks", () => {
  it("counts packs named by current or previous references that the store does not list", () => {
    expect(missingPacks(manifest, [pack(1), pack(2), pack(3)])).toBe(0);
    expect(missingPacks(manifest, [pack(2), pack(3)])).toBe(1); // pack 1 is only a previous reference of B and A's
    expect(missingPacks(manifest, [])).toBe(3);
  });

  it("ignores listed files the manifest does not name", () => {
    expect(missingPacks(manifest, [pack(1), pack(2), pack(3), pack(9)])).toBe(0);
  });
});
