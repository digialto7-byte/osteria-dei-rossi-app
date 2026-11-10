import { describe, expect, it } from "vitest";
import {
  nextFilesManifest,
  parseFilesManifest,
  parsePackIndex,
  planFilesRun,
  type FilesManifest,
} from "../../../scripts/lib/backup/files-manifest";

// Fake data only: fake tenant and invoice UUIDs.
const T1 = "11111111-1111-4111-8111-111111111111";
const A = `${T1}/2026/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`;
const B = `${T1}/2026/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf`;
const C = `${T1}/2026/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png`;
const H1 = "a".repeat(64);
const H2 = "b".repeat(64);
const H3 = "c".repeat(64);
const PACK1 = "osteria-files-20261108T021500Z-production-01.tar.gpg";
const PACK2 = "osteria-files-20261109T021500Z-production-01.tar.gpg";
const NOW = new Date("2026-11-09T02:15:00.000Z");

const entry = (over: Partial<FilesManifest["objects"][string]> = {}) => ({
  sha256: H1,
  size: 10,
  updatedAt: "2026-11-01T10:00:00+00:00",
  pack: PACK1,
  member: "o/000001",
  removedAt: null,
  previous: [],
  ...over,
});
const manifest = (objects: FilesManifest["objects"]): FilesManifest => ({
  version: 1,
  createdAt: "2026-11-08T02:15:00.000Z",
  target: "production",
  objects,
});
const listed = (name: string, updatedAt = "2026-11-01T10:00:00+00:00") => ({ name, updatedAt });

describe("planFilesRun", () => {
  it("fetches a path that is not in the previous manifest", () => {
    const plan = planFilesRun(manifest({}), [listed(B), listed(A)]);
    expect(plan.toFetch).toEqual([A, B]);
    expect(plan.unchanged).toEqual([]);
    expect(plan.newlyRemoved).toEqual([]);
  });

  it("leaves a path with the same updatedAt alone", () => {
    const plan = planFilesRun(manifest({ [A]: entry() }), [listed(A)]);
    expect(plan).toEqual({ toFetch: [], unchanged: [A], newlyRemoved: [] });
  });

  it("fetches a path whose updatedAt differs", () => {
    const plan = planFilesRun(manifest({ [A]: entry() }), [listed(A, "2026-11-05T10:00:00+00:00")]);
    expect(plan.toFetch).toEqual([A]);
    expect(plan.unchanged).toEqual([]);
  });

  it("reports a missing path once: a path already marked removed is not reported again", () => {
    const previous = manifest({
      [A]: entry(),
      [B]: entry({ removedAt: "2026-11-07T00:00:00.000Z" }),
    });
    const plan = planFilesRun(previous, []);
    expect(plan.newlyRemoved).toEqual([A]);
    expect(plan.toFetch).toEqual([]);
  });

  it("fetches a removed path that reappears", () => {
    const previous = manifest({ [A]: entry({ removedAt: "2026-11-07T00:00:00.000Z" }) });
    expect(planFilesRun(previous, [listed(A)]).toFetch).toEqual([A]);
  });

  it("with no previous manifest (the --full case) fetches everything", () => {
    const plan = planFilesRun(null, [listed(B), listed(A)]);
    expect(plan).toEqual({ toFetch: [A, B], unchanged: [], newlyRemoved: [] });
  });

  it("does not treat inherited object keys as entries", () => {
    expect(planFilesRun(manifest({}), [listed("constructor")]).toFetch).toEqual(["constructor"]);
    expect(planFilesRun(manifest({}), [listed("__proto__")]).toFetch).toEqual(["__proto__"]);
  });
});

describe("nextFilesManifest", () => {
  const packed = (path: string, sha256: string, member = "o/000001") => ({
    path,
    sha256,
    size: 20,
    updatedAt: "2026-11-09T01:00:00+00:00",
    pack: PACK2,
    member,
  });

  it("adds a new path with no history", () => {
    const next = nextFilesManifest(manifest({}), [packed(A, H1)], [], [], NOW, "production");
    expect(next).toMatchObject({ version: 1, target: "production", createdAt: NOW.toISOString() });
    expect(next.objects[A]).toEqual({
      sha256: H1,
      size: 20,
      updatedAt: "2026-11-09T01:00:00+00:00",
      pack: PACK2,
      member: "o/000001",
      removedAt: null,
      previous: [],
    });
  });

  it("keeps an unchanged entry as it was", () => {
    const previous = manifest({ [A]: entry() });
    expect(nextFilesManifest(previous, [], [], [], NOW, "production").objects[A]).toEqual(entry());
  });

  it("same sha256 after a fetch only refreshes updatedAt: same pack, no history", () => {
    const previous = manifest({ [A]: entry() });
    const next = nextFilesManifest(
      previous,
      [],
      [{ path: A, updatedAt: "2026-11-05T10:00:00+00:00" }],
      [],
      NOW,
      "production",
    );
    expect(next.objects[A]).toEqual(entry({ updatedAt: "2026-11-05T10:00:00+00:00" }));
  });

  it("different sha256 is a change: the old reference moves to previous", () => {
    const previous = manifest({ [A]: entry() });
    const next = nextFilesManifest(previous, [packed(A, H2)], [], [], NOW, "production");
    expect(next.objects[A]).toMatchObject({
      sha256: H2,
      pack: PACK2,
      previous: [{ pack: PACK1, member: "o/000001", sha256: H1 }],
    });
  });

  it("history accumulates over several changes", () => {
    const previous = manifest({
      [A]: entry({ sha256: H2, previous: [{ pack: PACK1, member: "o/000001", sha256: H1 }] }),
    });
    const next = nextFilesManifest(
      previous,
      [packed(A, H3, "o/000004")],
      [],
      [],
      NOW,
      "production",
    );
    expect(next.objects[A]!.previous).toHaveLength(2);
    expect(next.objects[A]!.previous[1]).toEqual({ pack: PACK1, member: "o/000001", sha256: H2 });
  });

  it("marks a missing path removed once and keeps its pack reference", () => {
    const first = nextFilesManifest(manifest({ [A]: entry() }), [], [], [A], NOW, "production");
    expect(first.objects[A]).toEqual(entry({ removedAt: NOW.toISOString() }));
    const later = new Date("2026-11-10T02:15:00.000Z");
    const plan = planFilesRun(first, []);
    expect(plan.newlyRemoved).toEqual([]);
    const second = nextFilesManifest(first, [], [], plan.newlyRemoved, later, "production");
    expect(second.objects[A]!.removedAt).toBe(NOW.toISOString());
  });

  it("a removed path that reappears with other bytes is re-packed: removedAt cleared, old ref in previous", () => {
    const previous = manifest({ [A]: entry({ removedAt: "2026-11-07T00:00:00.000Z" }) });
    const next = nextFilesManifest(previous, [packed(A, H2)], [], [], NOW, "production");
    expect(next.objects[A]).toMatchObject({
      sha256: H2,
      removedAt: null,
      previous: [{ pack: PACK1, member: "o/000001", sha256: H1 }],
    });
  });

  it("a removed path that reappears with the same bytes is live again, same pack", () => {
    const previous = manifest({ [A]: entry({ removedAt: "2026-11-07T00:00:00.000Z" }) });
    const next = nextFilesManifest(
      previous,
      [],
      [{ path: A, updatedAt: "2026-11-09T00:00:00+00:00" }],
      [],
      NOW,
      "production",
    );
    expect(next.objects[A]).toEqual(entry({ updatedAt: "2026-11-09T00:00:00+00:00" }));
  });

  it("with no previous manifest every path is new and nothing has history", () => {
    const next = nextFilesManifest(null, [packed(B, H2), packed(A, H1)], [], [], NOW, "staging");
    expect(next.target).toBe("staging");
    expect(Object.values(next.objects).every((o) => o.previous.length === 0)).toBe(true);
  });

  it("writes the object keys in sorted order", () => {
    const previous = manifest({ [C]: entry() });
    const next = nextFilesManifest(
      previous,
      [packed(B, H2, "o/000002"), packed(A, H1)],
      [],
      [],
      NOW,
      "production",
    );
    expect(Object.keys(next.objects)).toEqual([A, B, C]);
  });

  it("round-trips through JSON and the parser", () => {
    const next = nextFilesManifest(manifest({}), [packed(A, H1)], [], [], NOW, "production");
    expect(parseFilesManifest(JSON.stringify(next))).toEqual(next);
  });
});

describe("parseFilesManifest", () => {
  const good = () => JSON.parse(JSON.stringify(manifest({ [A]: entry() })));
  const parse = (value: unknown) => parseFilesManifest(JSON.stringify(value));

  it("accepts a valid manifest", () => {
    expect(parse(good()).objects[A]).toEqual(entry());
  });

  it("refuses text that is not JSON", () => {
    expect(() => parseFilesManifest("{nope")).toThrow("files_manifest_invalid");
  });

  it("refuses an unknown version", () => {
    expect(() => parse({ ...good(), version: 2 })).toThrow("files_manifest_invalid");
  });

  it("refuses a bad target", () => {
    expect(() => parse({ ...good(), target: "dev" })).toThrow("files_manifest_invalid");
  });

  it.each([
    ["short hex", { sha256: "abc" }],
    ["upper-case hex", { sha256: "A".repeat(64) }],
    ["negative size", { size: -1 }],
    ["fractional size", { size: 1.5 }],
    ["bad pack name", { pack: "../evil.tar.gpg" }],
    ["bad member name", { member: "../o/000001" }],
    ["short member", { member: "o/1" }],
    ["bad removedAt", { removedAt: 5 }],
    ["bad previous ref", { previous: [{ pack: PACK1, member: "x", sha256: H1 }] }],
    ["previous not an array", { previous: {} }],
  ])("refuses %s", (_label, over) => {
    const m = good();
    m.objects[A] = { ...m.objects[A], ...over };
    expect(() => parse(m)).toThrow("files_manifest_invalid");
  });

  it.each([
    ["empty", ""],
    ["control character", "a/b\u0007c.pdf"],
    ["newline", "a/b\nc.pdf"],
    ["over 1,024 characters", "a".repeat(1025)],
  ])("refuses a path that is %s", (_label, path) => {
    const m = good();
    m.objects = { [path]: entry() };
    expect(() => parse(m)).toThrow("files_manifest_invalid");
  });

  it("keeps a path named __proto__ as an ordinary entry", () => {
    const m = good();
    m.objects = JSON.parse(JSON.stringify({ x: entry() }).replace('"x"', '"__proto__"'));
    const parsed = parse(m);
    expect(Object.keys(parsed.objects)).toEqual(["__proto__"]);
  });

  it("the error never carries a path", () => {
    const m = good();
    m.objects[A].sha256 = "bad";
    try {
      parse(m);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toBe("files_manifest_invalid");
    }
  });
});

describe("parsePackIndex", () => {
  const good = () => ({
    version: 1,
    createdAt: "2026-11-09T02:15:00.000Z",
    target: "production",
    objects: [{ path: A, member: "o/000001", sha256: H1, size: 10 }],
  });
  const parse = (value: unknown) => parsePackIndex(JSON.stringify(value));

  it("accepts a valid index", () => {
    expect(parse(good())).toEqual(good());
  });

  it.each([
    ["version 2", { version: 2 }],
    ["bad target", { target: "x" }],
    ["objects not an array", { objects: {} }],
    ["bad hex", { objects: [{ path: A, member: "o/000001", sha256: "zz", size: 1 }] }],
    ["negative size", { objects: [{ path: A, member: "o/000001", sha256: H1, size: -2 }] }],
    ["bad member", { objects: [{ path: A, member: "a/b", sha256: H1, size: 1 }] }],
    [
      "control character",
      { objects: [{ path: "a\u0000b", member: "o/000001", sha256: H1, size: 1 }] },
    ],
    ["empty path", { objects: [{ path: "", member: "o/000001", sha256: H1, size: 1 }] }],
  ])("refuses %s", (_label, over) => {
    expect(() => parse({ ...good(), ...over })).toThrow("pack_index_invalid");
  });

  it("refuses text that is not JSON", () => {
    expect(() => parsePackIndex("")).toThrow("pack_index_invalid");
  });
});
