import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupFileName,
  filesManifestName,
  filesPackName,
} from "../../../scripts/lib/backup/commands";
import { dirStore, driveStore } from "../../../scripts/lib/backup/store";

const TOKEN = "ya29.fake-access-token";
const FOLDER = "folder-id-fake-123";
const md5 = (bytes: Uint8Array) => createHash("md5").update(bytes).digest("hex");
const D1 = new Date("2026-11-08T02:15:00Z");
const D2 = new Date("2026-11-09T02:15:00Z");

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "files-store-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("dirStore", () => {
  it("round-trips bytes and lists the createdTime from the name's stamp, newest first", async () => {
    const store = dirStore(dir);
    const pack = filesPackName(D1, "production", 1);
    const manifest = filesManifestName(D2, "production");
    await store.put(pack, new Uint8Array([1, 2, 3]));
    await store.put(manifest, new Uint8Array([9, 9]));
    const listed = await store.list("production");
    expect(listed.map((f) => f.name)).toEqual([manifest, pack]);
    expect(listed[0]!.createdTime).toBe("2026-11-09T02:15:00Z");
    expect(listed[1]!.md5Checksum).toBe(md5(new Uint8Array([1, 2, 3])));
    expect(await store.get(listed[1]!)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("lists only the target's pack and manifest names; other files stay unseen", async () => {
    const store = dirStore(dir);
    await store.put(filesPackName(D1, "staging", 1), new Uint8Array([1]));
    await store.put(backupFileName(D1, "production"), new Uint8Array([1]));
    writeFileSync(join(dir, "notes.txt"), "x");
    await store.put(filesManifestName(D1, "production"), new Uint8Array([1]));
    expect((await store.list("production")).map((f) => f.name)).toEqual([
      filesManifestName(D1, "production"),
    ]);
  });

  it("refuses any name that is not a backup, pack or manifest name, writing nothing", async () => {
    const store = dirStore(dir);
    for (const bad of [
      "../x",
      "/abs/path",
      "a/b",
      "notes.txt",
      "",
      `${filesPackName(D1, "staging", 1)}/..`,
    ]) {
      await expect(store.put(bad, new Uint8Array([1])), bad).rejects.toThrow("store_name_invalid");
    }
    expect(existsSync(join(dir, "..", "x"))).toBe(false);
  });

  it("refuses to read a name that is not ours", async () => {
    const store = dirStore(dir);
    await expect(
      store.get({ id: "x", name: "../etc/passwd", createdTime: "", md5Checksum: "" }),
    ).rejects.toThrow("store_name_invalid");
  });

  it("refuses an existing name and keeps the first bytes", async () => {
    const store = dirStore(dir);
    const name = filesManifestName(D1, "staging");
    await store.put(name, new Uint8Array([1]));
    await expect(store.put(name, new Uint8Array([2]))).rejects.toThrow("store_name_exists");
    expect(readFileSync(join(dir, name))).toEqual(Buffer.from([1]));
  });

  it("get throws backup_checksum_mismatch when the file changed after listing", async () => {
    const store = dirStore(dir);
    const name = filesPackName(D1, "staging", 1);
    await store.put(name, new Uint8Array([1]));
    const [file] = await store.list("staging");
    writeFileSync(join(dir, name), "tampered");
    await expect(store.get(file!)).rejects.toThrow("backup_checksum_mismatch");
  });

  it("retain keeps the newest manifests of the target and never touches a pack or the other target", async () => {
    const store = dirStore(dir);
    const days = [1, 2, 3, 4].map((d) => new Date(`2026-11-0${d}T02:15:00Z`));
    for (const d of days) await store.put(filesManifestName(d, "production"), new Uint8Array([1]));
    await store.put(filesManifestName(days[0]!, "staging"), new Uint8Array([1]));
    await store.put(filesPackName(days[0]!, "production", 1), new Uint8Array([1]));
    const deleted = await store.retain("production", 2);
    expect(deleted).toEqual([
      filesManifestName(days[1]!, "production"),
      filesManifestName(days[0]!, "production"),
    ]);
    expect(existsSync(join(dir, filesPackName(days[0]!, "production", 1)))).toBe(true);
    expect(existsSync(join(dir, filesManifestName(days[0]!, "staging")))).toBe(true);
    await expect(store.retain("production", 0)).rejects.toThrow("retention_keep_invalid");
  });
});

type Call = { url: string; method: string; body: unknown };
function fakeDrive(
  files: { id: string; name: string; createdTime: string; md5Checksum: string }[],
) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), method: init?.method ?? "GET", body: init?.body };
    calls.push(call);
    const u = new URL(call.url);
    if (call.method === "GET" && u.searchParams.get("alt") === "media") {
      return new Response(new Uint8Array([1, 2, 3]));
    }
    if (call.method === "GET") return Response.json({ files });
    if (call.method === "DELETE") return new Response(null, { status: 204 });
    if (call.method === "POST") {
      return new Response("{}", { headers: { location: "https://upload.fake/session" } });
    }
    const bytes = call.body as Uint8Array;
    return Response.json({ id: "new", md5Checksum: md5(bytes) });
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe("driveStore", () => {
  const pack = filesPackName(D1, "production", 1);
  const manifest = filesManifestName(D2, "production");
  const files = [
    {
      id: "k",
      name: pack,
      createdTime: "2026-11-08T02:15:09Z",
      md5Checksum: md5(new Uint8Array([1, 2, 3])),
    },
    { id: "m", name: manifest, createdTime: "2026-11-09T02:15:09Z", md5Checksum: "m5" },
    {
      id: "d",
      name: backupFileName(D1, "production"),
      createdTime: "2026-11-08T02:15:09Z",
      md5Checksum: "m5",
    },
  ];

  it("lists packs and manifests of the target only, newest first", async () => {
    const { fetchFn } = fakeDrive(files);
    const store = driveStore(fetchFn, TOKEN, FOLDER);
    expect((await store.list("production")).map((f) => f.id)).toEqual(["m", "k"]);
    expect(await store.list("staging")).toEqual([]);
  });

  it("get returns the bytes when the MD5 matches and throws backup_checksum_mismatch otherwise", async () => {
    const { fetchFn } = fakeDrive(files);
    const store = driveStore(fetchFn, TOKEN, FOLDER);
    expect(await store.get(files[0]!)).toEqual(new Uint8Array([1, 2, 3]));
    await expect(store.get(files[1]!)).rejects.toThrow("backup_checksum_mismatch");
  });

  it("put uploads to the folder after checking the name", async () => {
    const { fetchFn, calls } = fakeDrive([]);
    const store = driveStore(fetchFn, TOKEN, FOLDER);
    await store.put(pack, new Uint8Array([7]));
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
    const before = calls.length;
    await expect(store.put("../evil", new Uint8Array([1]))).rejects.toThrow("store_name_invalid");
    expect(calls).toHaveLength(before);
  });

  it("retain deletes old manifests only", async () => {
    const old = [
      ...files,
      {
        id: "m0",
        name: filesManifestName(new Date("2026-11-01T02:15:00Z"), "production"),
        createdTime: "2026-11-01T02:15:09Z",
        md5Checksum: "x",
      },
    ];
    const { fetchFn, calls } = fakeDrive(old);
    const deleted = await driveStore(fetchFn, TOKEN, FOLDER).retain("production", 1);
    expect(deleted).toEqual([old[3]!.name]);
    expect(calls.filter((c) => c.method === "DELETE").map((c) => new URL(c.url).pathname)).toEqual([
      "/drive/v3/files/m0",
    ]);
  });

  it("no error message holds the folder id or the token", async () => {
    const leak = (async () =>
      new Response(`${TOKEN} ${FOLDER}`, { status: 500 })) as unknown as typeof fetch;
    const store = driveStore(leak, TOKEN, FOLDER);
    const errors = await Promise.all([
      store.list("production").catch((e) => e),
      store.put(pack, new Uint8Array([1])).catch((e) => e),
      store.get(files[0]!).catch((e) => e),
      store.retain("production", 1).catch((e) => e),
    ]);
    for (const error of errors) {
      expect((error as Error).message).not.toContain(TOKEN);
      expect((error as Error).message).not.toContain(FOLDER);
    }
  });
});
