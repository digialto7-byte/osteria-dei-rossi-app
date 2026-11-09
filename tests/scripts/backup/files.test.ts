import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  filesManifestName,
  isFilesManifestName,
  isFilesPackName,
  stampOf,
  type BackupTarget,
} from "../../../scripts/lib/backup/commands";
import { parseFilesManifest, parsePackIndex } from "../../../scripts/lib/backup/files-manifest";
import type { BackupStore, StoreFile } from "../../../scripts/lib/backup/store";
import { runFiles, type FilesDeps } from "../../../scripts/backup/files";

// Fake data only: fake UUIDs, a fake DB password, a fake secret key, a fake passphrase, and one secret-key-style path that looks
// like a person's name (the secret key bypasses the app's path policy, so such a path can exist).
const T1 = "11111111-1111-4111-8111-111111111111";
const P1 = `${T1}/2026/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`;
const P2 = `${T1}/2026/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf`;
const P3 = `${T1}/2026/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png`;
const DEMO = "demo/Mario Rossi fattura.pdf";
const DB_PASSWORD = "db-pass-fake-9f8e7d";
const SECRET_KEY = "sb-secret-fake-key-123456";
const PASSPHRASE = "test-passphrase-not-a-secret-0123456789";
const FOLDER = "folder-id-fake-123";
const SA_JSON =
  '{"client_email":"b@fake.iam.gserviceaccount.com","private_key":"fake-private-key-xyz"}';
const ENV = {
  SUPABASE_DB_URL: `postgresql://postgres.abc:${DB_PASSWORD}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
  SUPABASE_URL: "https://abc.supabase.co",
  SUPABASE_SECRET_KEY: SECRET_KEY,
  BACKUP_ENCRYPTION_PASSPHRASE: PASSPHRASE,
  BACKUP_DRIVE_SA_JSON: SA_JSON,
  BACKUP_DRIVE_FOLDER_ID: FOLDER,
};
const WORK = "/runner/backup/files";
const ARGS = ["--work", WORK, "--target", "production", "--ref", "abc", "--keep", "14"];
const SECRETS = [DB_PASSWORD, SECRET_KEY, PASSPHRASE, FOLDER, "fake-private-key-xyz"];

const md5 = (b: Uint8Array) => createHash("md5").update(b).digest("hex");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const text = (s: string) => new Uint8Array(Buffer.from(s));

/** An in-memory store: newest first by the stamp in the name, like the real ones. */
function memStore() {
  const files = new Map<string, Uint8Array>();
  const retainCalls: [BackupTarget, number][] = [];
  const store: BackupStore = {
    async list(target) {
      return [...files.keys()]
        .filter((n) => isFilesPackName(n, target) || isFilesManifestName(n, target))
        .map((name): StoreFile => ({
          id: name,
          name,
          createdTime: stampOf(name)!,
          md5Checksum: md5(files.get(name)!),
        }))
        .sort((a, b) => b.createdTime.localeCompare(a.createdTime) || b.name.localeCompare(a.name));
    },
    async put(name, bytes) {
      files.set(name, bytes);
    },
    async get(file) {
      return files.get(file.name)!;
    },
    async retain(target, keep) {
      retainCalls.push([target, keep]);
      return [];
    },
  };
  return { store, files, retainCalls };
}

type World = {
  /** path -> { bytes, updatedAt } of the fake bucket */
  bucket: Map<string, { bytes: Uint8Array; updatedAt: string }>;
  store: ReturnType<typeof memStore>;
};
function world(objects: Record<string, string> = {}): World {
  const bucket = new Map<string, { bytes: Uint8Array; updatedAt: string }>();
  for (const [path, content] of Object.entries(objects)) {
    bucket.set(path, { bytes: text(content), updatedAt: "2026-11-01T10:00:00+00:00" });
  }
  return { bucket, store: memStore() };
}

const INVOICE_BUCKET_FOR_TEST = "invoices";

type Options = {
  downloadError?: (path: string) => Error;
  throwOn?: "tar";
  now?: string;
  psqlFails?: boolean;
  failDownloads?: Map<string, number>; // path -> how many attempts fail
  passphraseOnDisk?: string; // the "gpg" tag used by the fake: lets a test build a manifest made with another passphrase
  limits?: FilesDeps["limits"];
  openStore?: FilesDeps["openStore"];
};

/** One run of the script on a fake machine. */
async function run(
  w: World,
  argv: string[],
  opts: Options = {},
  env: Record<string, string | undefined> = ENV,
) {
  const fs = new Map<string, Uint8Array>();
  const logs: string[] = [];
  const calls: { command: string; args: string[]; input?: string }[] = [];
  const removed: string[] = [];
  const downloads: string[] = [];
  const writes: string[] = [];
  const attempts = new Map<string, number>();
  const openStore = vi.fn(opts.openStore ?? (async () => w.store.store));

  const deps: FilesDeps = {
    env,
    run: (command, args, options) => {
      calls.push({ command, args, input: options?.input });
      if (command === opts.throwOn) throw new Error(`spawn failed ${DEMO} ${SECRET_KEY}`);
      if (command === "psql") {
        if (opts.psqlFails) {
          return { status: 2, stdout: "", stderr: "ERROR:  42501\nDETAIL: Mario Rossi row" };
        }
        const rows = [...w.bucket.entries()].map(([name, o]) => ({ name, updatedAt: o.updatedAt }));
        return { status: 0, stdout: `${JSON.stringify(rows)}\n`, stderr: "" };
      }
      if (command === "tar") {
        const dir = args[args.indexOf("-C") + 1]!;
        const members: Record<string, string> = {};
        for (const [path, bytes] of fs) {
          if (path.startsWith(`${dir}/`))
            members[path.slice(dir.length + 1)] = Buffer.from(bytes).toString("base64");
        }
        fs.set(args[args.indexOf("-cf") + 1]!, text(JSON.stringify(members)));
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "gpg") {
        const output = args[args.indexOf("--output") + 1]!;
        const input = args[args.length - 1]!;
        const tag = `GPG(${options?.input}):`;
        const source = fs.get(input);
        if (!source) return { status: 2, stdout: "", stderr: "no such file" };
        if (args.includes("--decrypt")) {
          const head = Buffer.from(source).toString("utf8", 0, tag.length);
          if (head !== tag)
            return { status: 2, stdout: "", stderr: "decryption failed: Mario Rossi" };
          fs.set(output, source.slice(tag.length));
        } else {
          fs.set(output, new Uint8Array(Buffer.concat([Buffer.from(tag), source])));
        }
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 127, stdout: "", stderr: "unknown" };
    },
    mkdir: () => undefined,
    writeFile: (path, bytes) => {
      writes.push(path);
      fs.set(path, bytes);
    },
    readFile: (path) => {
      const bytes = fs.get(path);
      if (!bytes) throw new Error("ENOENT");
      return bytes;
    },
    remove: (path) => {
      removed.push(path);
      for (const key of [...fs.keys()])
        if (key === path || key.startsWith(`${path}/`)) fs.delete(key);
    },
    now: () => new Date(opts.now ?? "2026-11-09T02:15:07Z"),
    log: (line) => logs.push(line),
    openStore,
    downloadObject: async (path) => {
      downloads.push(path);
      const n = (attempts.get(path) ?? 0) + 1;
      attempts.set(path, n);
      if (n <= (opts.failDownloads?.get(path) ?? 0))
        throw (opts.downloadError ?? ((p) => new Error(`storage said no to ${p}`)))(path);
      const o = w.bucket.get(path);
      if (!o) throw new Error("not found");
      return o.bytes;
    },
    limits: opts.limits,
  };
  const code = await runFiles(argv, deps);
  return { code, logs, calls, removed, downloads, fs, openStore, writes };
}

/** The decoded members of an uploaded pack. */
function unpack(w: World, name: string): Record<string, string> {
  const bytes = Buffer.from(w.store.files.get(name)!);
  const tag = `GPG(${PASSPHRASE}):`;
  expect(bytes.toString("utf8", 0, tag.length)).toBe(tag);
  const members = JSON.parse(bytes.toString("utf8", tag.length)) as Record<string, string>;
  return Object.fromEntries(
    Object.entries(members).map(([k, v]) => [k, Buffer.from(v, "base64").toString()]),
  );
}
const packsOf = (w: World) =>
  [...w.store.files.keys()].filter((n) => isFilesPackName(n, "production")).sort();
const manifestsOf = (w: World) =>
  [...w.store.files.keys()].filter((n) => isFilesManifestName(n, "production")).sort();
const summary = (logs: string[]) => JSON.parse(logs.find((l) => l.startsWith("{"))!);
function newestManifest(w: World) {
  const name = manifestsOf(w).at(-1)!;
  const bytes = Buffer.from(w.store.files.get(name)!);
  return parseFilesManifest(bytes.toString("utf8", `GPG(${PASSPHRASE}):`.length));
}

describe("runFiles: the daily flow", () => {
  it("first run packs every object: one pack, one manifest, a summary without paths", async () => {
    const w = world({ [P1]: "pdf-one", [P2]: "pdf-two" });
    const r = await run(w, ARGS);
    expect(r.code).toBe(0);
    expect(packsOf(w)).toEqual(["osteria-files-20261109T021507Z-production-01.tar.gpg"]);
    expect(manifestsOf(w)).toEqual([
      filesManifestName(new Date("2026-11-09T02:15:07Z"), "production"),
    ]);
    const members = unpack(w, packsOf(w)[0]!);
    expect(members["o/000001"]).toBe("pdf-one");
    expect(members["o/000002"]).toBe("pdf-two");
    const index = parsePackIndex(members["index.json"]!);
    expect(index.objects.map((o) => o.path)).toEqual([P1, P2]);
    expect(index.objects[0]).toMatchObject({
      member: "o/000001",
      sha256: sha(text("pdf-one")),
      size: 7,
    });
    const manifest = newestManifest(w);
    expect(manifest.objects[P1]).toMatchObject({
      pack: packsOf(w)[0],
      member: "o/000001",
      removedAt: null,
    });
    expect(summary(r.logs)).toEqual({
      objects: 2,
      new: 2,
      changed: 0,
      removed: 0,
      packs: packsOf(w),
      bytes: 14,
      manifest: manifestsOf(w)[0],
    });
    expect(r.logs.find((l) => l.startsWith("{"))).toMatch(
      /^\{"objects":2,"new":2,"changed":0,"removed":0,"packs":\[/,
    );
  });

  it("member names in a pack are opaque, never the object path", async () => {
    const w = world({ [P1]: "pdf-one" });
    await run(w, ARGS);
    expect(Object.keys(unpack(w, packsOf(w)[0]!)).sort()).toEqual(["index.json", "o/000001"]);
  });

  it('a second run with the same list uploads a manifest only and logs "new":0', async () => {
    const w = world({ [P1]: "pdf-one", [P2]: "pdf-two" });
    await run(w, ARGS);
    const second = await run(w, ARGS, { now: "2026-11-10T02:15:07Z" });
    expect(second.code).toBe(0);
    expect(packsOf(w)).toHaveLength(1);
    expect(manifestsOf(w)).toHaveLength(2);
    expect(second.logs.find((l) => l.startsWith("{"))).toContain('"new":0');
    expect(second.downloads).toEqual([]);
    expect(summary(second.logs)).toMatchObject({
      objects: 2,
      new: 0,
      changed: 0,
      removed: 0,
      packs: [],
      bytes: 0,
    });
  });

  it("one added object makes one pack with one member", async () => {
    const w = world({ [P1]: "pdf-one" });
    await run(w, ARGS);
    w.bucket.set(P2, { bytes: text("pdf-two"), updatedAt: "2026-11-09T09:00:00+00:00" });
    const second = await run(w, ARGS, { now: "2026-11-10T02:15:07Z" });
    expect(second.code).toBe(0);
    expect(second.downloads).toEqual([P2]);
    const packs = packsOf(w);
    expect(packs).toHaveLength(2);
    const members = unpack(w, packs[1]!);
    expect(Object.keys(members).sort()).toEqual(["index.json", "o/000001"]);
    expect(members["o/000001"]).toBe("pdf-two");
    expect(newestManifest(w).objects[P2]!.pack).toBe(packs[1]);
    expect(summary(second.logs)).toMatchObject({ objects: 2, new: 1 });
  });

  it("splits into several packs when one would pass MAX_PACK_BYTES, numbering them 01, 02, ...", async () => {
    const w = world({ [P1]: "0123456789", [P2]: "abcdefghij", [P3]: "ABCDEFGHIJ" });
    const r = await run(w, ARGS, { limits: { packBytes: 15, runBytes: 1000 } });
    expect(r.code).toBe(0);
    expect(packsOf(w)).toEqual([
      "osteria-files-20261109T021507Z-production-01.tar.gpg",
      "osteria-files-20261109T021507Z-production-02.tar.gpg",
      "osteria-files-20261109T021507Z-production-03.tar.gpg",
    ]);
    expect(newestManifest(w).objects[P3]!.pack).toBe(packsOf(w)[2]);
    // one open pack on disk at a time: after each seal the clear text goes
    expect(r.removed.length).toBeGreaterThanOrEqual(3);
  });

  it("MAX_RUN_BYTES: the manifest is uploaded, then the run fails with files_run_cap_reached; the next run continues", async () => {
    const w = world({ [P1]: "0123456789", [P2]: "abcdefghij", [P3]: "ABCDEFGHIJ" });
    const first = await run(w, ARGS, { limits: { packBytes: 1000, runBytes: 15 } });
    expect(first.code).toBe(1);
    expect(first.logs).toContain("files_run_cap_reached");
    expect(first.downloads).toEqual([P1, P2]);
    expect(manifestsOf(w)).toHaveLength(1);
    expect(Object.keys(newestManifest(w).objects)).toEqual([P1, P2]);
    const second = await run(w, ARGS, { now: "2026-11-10T02:15:07Z" });
    expect(second.code).toBe(0);
    expect(second.downloads).toEqual([P3]);
    expect(Object.keys(newestManifest(w).objects)).toEqual([P1, P2, P3]);
  });

  it("reaching the cap with nothing left to fetch is not a failure", async () => {
    const w = world({ [P1]: "0123456789", [P2]: "abcdefghij" });
    const r = await run(w, ARGS, { limits: { packBytes: 1000, runBytes: 15 } });
    // The cap is only checked before a download: both objects are fetched (10 < 15 before the second), nothing is left.
    expect(r.code).toBe(0);
    expect(r.logs).not.toContain("files_run_cap_reached");
  });

  it("retries a download once; two failures give files_download_failed and upload nothing", async () => {
    const once = world({ [P1]: "pdf-one" });
    const ok = await run(once, ARGS, { failDownloads: new Map([[P1, 1]]) });
    expect(ok.code).toBe(0);
    expect(ok.downloads).toEqual([P1, P1]);

    const twice = world({ [P1]: "pdf-one", [P2]: "pdf-two" });
    const bad = await run(twice, ARGS, { failDownloads: new Map([[P1, 2]]) });
    expect(bad.code).toBe(1);
    expect(bad.logs).toContain("files_download_failed (object 1 of 2)");
    expect(twice.store.files.size).toBe(0);
    expect(bad.downloads).toEqual([P1, P1]);
  });
});

describe("runFiles: bucket anomalies (D7)", () => {
  const seeded = async () => {
    const w = world({ [P1]: "pdf-one", [P2]: "pdf-two" });
    await run(w, ARGS);
    return w;
  };

  it("production: a removed object uploads the manifest, then exits 1 with files_bucket_anomaly", async () => {
    const w = await seeded();
    w.bucket.delete(P2);
    const r = await run(w, ARGS, { now: "2026-11-10T02:15:07Z" });
    expect(r.code).toBe(1);
    expect(r.logs).toContain("files_bucket_anomaly");
    expect(manifestsOf(w)).toHaveLength(2);
    expect(newestManifest(w).objects[P2]!.removedAt).not.toBeNull();
    expect(summary(r.logs)).toMatchObject({ objects: 1, removed: 1 });
    // a path counts once: the next run sees it already marked
    const next = await run(w, ARGS, { now: "2026-11-11T02:15:07Z" });
    expect(next.code).toBe(0);
    expect(summary(next.logs)).toMatchObject({ removed: 0 });
  });

  it("production: an object whose bytes changed exits 1, and the old reference is kept", async () => {
    const w = await seeded();
    w.bucket.set(P1, { bytes: text("pdf-one-CHANGED"), updatedAt: "2026-11-09T12:00:00+00:00" });
    const r = await run(w, ARGS, { now: "2026-11-10T02:15:07Z" });
    expect(r.code).toBe(1);
    expect(r.logs).toContain("files_bucket_anomaly");
    expect(summary(r.logs)).toMatchObject({ new: 0, changed: 1 });
    const entry = newestManifest(w).objects[P1]!;
    expect(entry.sha256).toBe(sha(text("pdf-one-CHANGED")));
    expect(entry.previous).toHaveLength(1);
  });

  it("same bytes under a new updatedAt is not a change", async () => {
    const w = await seeded();
    w.bucket.set(P1, { bytes: text("pdf-one"), updatedAt: "2026-11-09T12:00:00+00:00" });
    const r = await run(w, ARGS, { now: "2026-11-10T02:15:07Z" });
    expect(r.code).toBe(0);
    expect(r.downloads).toEqual([P1]);
    expect(packsOf(w)).toHaveLength(1);
    expect(newestManifest(w).objects[P1]!.updatedAt).toBe("2026-11-09T12:00:00+00:00");
    expect(summary(r.logs)).toMatchObject({ new: 0, changed: 0 });
  });

  it("staging (the demo purge): the same removal and change exit 0", async () => {
    const w = world({ [P1]: "pdf-one", [P2]: "pdf-two" });
    const staging = ["--work", WORK, "--target", "staging", "--ref", "abc", "--keep", "14"];
    await run(w, staging);
    w.bucket.delete(P2);
    w.bucket.set(P1, { bytes: text("other"), updatedAt: "2026-11-09T12:00:00+00:00" });
    const r = await run(w, staging, { now: "2026-11-10T02:15:07Z" });
    expect(r.code).toBe(0);
    expect(summary(r.logs)).toMatchObject({ changed: 1, removed: 1 });
  });
});

describe("runFiles: the previous manifest", () => {
  it("an unreadable previous manifest stops the run with files_manifest_unreadable and uploads nothing", async () => {
    const w = world({ [P1]: "pdf-one" });
    await run(w, ARGS, { now: "2026-11-08T02:15:07Z" });
    const before = w.store.files.size;
    const other = {
      ...ENV,
      BACKUP_ENCRYPTION_PASSPHRASE: "another-passphrase-not-a-secret-9876543210",
    };
    const r = await run(w, ARGS, { now: "2026-11-09T02:15:07Z" }, other);
    expect(r.code).toBe(1);
    expect(r.logs).toContain("files_manifest_unreadable");
    expect(w.store.files.size).toBe(before);
    expect(r.downloads).toEqual([]);
  });

  it("an invalid (not parsable) previous manifest is unreadable too", async () => {
    const w = world({ [P1]: "pdf-one" });
    w.store.files.set(
      filesManifestName(new Date("2026-11-08T02:15:07Z"), "production"),
      new Uint8Array(Buffer.from(`GPG(${PASSPHRASE}):{"version":2}`)),
    );
    const r = await run(w, ARGS);
    expect(r.code).toBe(1);
    expect(r.logs).toContain("files_manifest_unreadable");
  });

  it("with --full the previous manifest is ignored: everything is packed again, with no history", async () => {
    const w = world({ [P1]: "pdf-one" });
    await run(w, ARGS, { now: "2026-11-08T02:15:07Z" });
    const other = {
      ...ENV,
      BACKUP_ENCRYPTION_PASSPHRASE: "another-passphrase-not-a-secret-9876543210",
    };
    const r = await run(w, [...ARGS, "--full"], { now: "2026-11-09T02:15:07Z" }, other);
    expect(r.code).toBe(0);
    expect(r.downloads).toEqual([P1]);
    expect(summary(r.logs)).toMatchObject({ new: 1 });
    expect(packsOf(w)).toHaveLength(2);
  });

  it("a name already in the store stops the run with files_name_taken", async () => {
    const w = world({ [P1]: "pdf-one" });
    await run(w, ARGS);
    const r = await run(w, ARGS); // same clock second: same manifest name
    expect(r.code).toBe(1);
    expect(r.logs).toContain("files_name_taken");
    expect(manifestsOf(w)).toHaveLength(1);
  });

  it("a first run with no manifest at all works (nothing to read)", async () => {
    const w = world({});
    const r = await run(w, ARGS);
    expect(r.code).toBe(0);
    expect(packsOf(w)).toEqual([]);
    expect(manifestsOf(w)).toHaveLength(1);
    expect(summary(r.logs)).toMatchObject({ objects: 0, new: 0, packs: [] });
  });
});

describe("runFiles: arguments, guards and environment", () => {
  const refused = async (argv: string[], env: Record<string, string | undefined> = ENV) => {
    const w = world({ [P1]: "pdf-one" });
    const r = await run(w, argv, {}, env);
    expect(r.calls).toEqual([]);
    expect(r.downloads).toEqual([]);
    expect(r.openStore).not.toHaveBeenCalled();
    expect(w.store.files.size).toBe(0);
    return r;
  };
  const LOCAL_ENV = {
    ...ENV,
    SUPABASE_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    SUPABASE_URL: "http://127.0.0.1:54321",
  };

  it("--store-dir without --local is refused before any run or fetch", async () => {
    const r = await refused([
      "--work",
      WORK,
      "--target",
      "staging",
      "--ref",
      "abc",
      "--keep",
      "1",
      "--store-dir",
      "/x",
    ]);
    expect(r.code).toBe(1);
    const r2 = await refused([
      "--work",
      WORK,
      "--target",
      "staging",
      "--keep",
      "1",
      "--store-dir",
      "/x",
    ]);
    expect(r2.code).toBe(1);
  });

  it("--local without --store-dir, or with --ref, is refused", async () => {
    expect(
      (await refused(["--work", WORK, "--target", "staging", "--keep", "1", "--local"], LOCAL_ENV))
        .code,
    ).toBe(1);
    expect(
      (
        await refused(
          [
            "--work",
            WORK,
            "--target",
            "staging",
            "--keep",
            "1",
            "--local",
            "--store-dir",
            "/x",
            "--ref",
            "abc",
          ],
          LOCAL_ENV,
        )
      ).code,
    ).toBe(1);
  });

  it("usage errors: missing --work, --target, --keep or a bad keep", async () => {
    for (const argv of [
      ["--target", "production", "--ref", "abc", "--keep", "14"],
      ["--work", WORK, "--ref", "abc", "--keep", "14"],
      ["--work", WORK, "--target", "production", "--ref", "abc"],
      ["--work", WORK, "--target", "production", "--ref", "abc", "--keep", "0"],
      ["--work", WORK, "--target", "dev", "--ref", "abc", "--keep", "14"],
      ["--work", WORK, "--target", "production", "--ref", "abc", "--keep", "14", "--bogus"],
    ]) {
      expect((await refused(argv)).code).toBe(1);
    }
  });

  it("--local with a remote DB URL or a remote API URL is refused with files_source_not_local", async () => {
    const local = [
      "--work",
      WORK,
      "--target",
      "staging",
      "--keep",
      "1",
      "--local",
      "--store-dir",
      "/x",
    ];
    const remoteDb = await refused(local, { ...LOCAL_ENV, SUPABASE_DB_URL: ENV.SUPABASE_DB_URL });
    expect(remoteDb.logs).toContain("files_source_not_local");
    const remoteApi = await refused(local, { ...LOCAL_ENV, SUPABASE_URL: ENV.SUPABASE_URL });
    expect(remoteApi.logs).toContain("files_source_not_local");
  });

  it("with --ref, a SUPABASE_URL or DB user of another project is refused before any fetch", async () => {
    const host = await refused(ARGS, { ...ENV, SUPABASE_URL: "https://other.supabase.co" });
    expect(host.logs).toEqual(["backup_supabase_host_mismatch"]);
    const user = await refused(ARGS, {
      ...ENV,
      SUPABASE_DB_URL: ENV.SUPABASE_DB_URL.replace("postgres.abc", "postgres.other"),
    });
    expect(user.logs).toEqual(["backup_db_user_mismatch"]);
  });

  it("lists the names of missing environment variables, never values", async () => {
    const r = await refused(ARGS, {
      ...ENV,
      SUPABASE_SECRET_KEY: undefined,
      BACKUP_DRIVE_FOLDER_ID: "",
    });
    expect(r.logs).toEqual(["backup_env_missing:SUPABASE_SECRET_KEY,BACKUP_DRIVE_FOLDER_ID"]);
  });

  it("with --store-dir the Drive variables are not required", async () => {
    const w = world({ [P1]: "pdf-one" });
    const { BACKUP_DRIVE_SA_JSON: _a, BACKUP_DRIVE_FOLDER_ID: _b, ...rest } = LOCAL_ENV;
    const r = await run(
      w,
      ["--work", WORK, "--target", "staging", "--keep", "1", "--local", "--store-dir", "/store"],
      {},
      rest,
    );
    expect(r.code).toBe(0);
    expect(r.openStore).toHaveBeenCalledWith(expect.objectContaining({ storeDir: "/store" }));
  });

  it("refuses a short passphrase with a code that does not carry it", async () => {
    const r = await refused(ARGS, { ...ENV, BACKUP_ENCRYPTION_PASSPHRASE: "short" });
    expect(r.logs).toEqual(["backup_passphrase_too_short"]);
  });
});

describe("runFiles: secrets and personal data", () => {
  it("the passphrase goes only to gpg's stdin; the secret key and the DB password are in no argument", async () => {
    const w = world({ [P1]: "pdf-one" });
    const r = await run(w, ARGS);
    const gpgs = r.calls.filter((c) => c.command === "gpg");
    expect(gpgs.length).toBeGreaterThanOrEqual(2);
    for (const c of gpgs) {
      expect(c.input).toBe(PASSPHRASE);
      expect(c.args.join(" ")).toContain("--passphrase-fd 0");
    }
    for (const c of r.calls) {
      for (const secret of [PASSPHRASE, SECRET_KEY, FOLDER, "fake-private-key-xyz"]) {
        expect(c.args.join(" ")).not.toContain(secret);
      }
      if (c.command !== "psql") expect(c.args.join(" ")).not.toContain(DB_PASSWORD);
    }
    // the psql listing is the read-only SQL on storage.objects
    const psql = r.calls.find((c) => c.command === "psql")!;
    expect(psql.args).toContain("ON_ERROR_STOP=1");
    expect(psql.args.join(" ")).toContain("storage.objects");
  });

  it("no log line holds an object path, a personal name, a secret or the folder id, on success or any failure", async () => {
    const all: string[] = [];
    const scenarios: [string, () => Promise<{ logs: string[] }>][] = [
      ["success", async () => run(world({ [P1]: "one", [DEMO]: "two" }), ARGS)],
      [
        "download fails",
        async () => run(world({ [DEMO]: "two" }), ARGS, { failDownloads: new Map([[DEMO, 2]]) }),
      ],
      ["psql fails", async () => run(world({ [DEMO]: "two" }), ARGS, { psqlFails: true })],
      [
        "unreadable manifest",
        async () => {
          const w = world({ [DEMO]: "two" });
          await run(w, ARGS, { now: "2026-11-08T02:15:07Z" });
          return run(w, ARGS, {}, { ...ENV, BACKUP_ENCRYPTION_PASSPHRASE: "x".repeat(40) });
        },
      ],
      [
        "store fails with a message holding everything",
        async () =>
          run(world({ [DEMO]: "two" }), ARGS, {
            openStore: async () => {
              throw new Error(`boom ${DEMO} ${SECRET_KEY} ${FOLDER} ${PASSPHRASE} ${DB_PASSWORD}`);
            },
          }),
      ],
      [
        "anomaly",
        async () => {
          const w = world({ [DEMO]: "two" });
          await run(w, ARGS, { now: "2026-11-08T02:15:07Z" });
          w.bucket.delete(DEMO);
          return run(w, ARGS, {});
        },
      ],
    ];
    for (const [, scenario] of scenarios) all.push(...(await scenario()).logs);
    expect(all.length).toBeGreaterThan(0);
    const joined = all.join("\n");
    for (const forbidden of [P1, DEMO, "Mario", "Rossi", T1, "aaaaaaaa", ...SECRETS, "demo/"]) {
      expect(joined, forbidden).not.toContain(forbidden);
    }
  });

  it("a thrown error message that is not a plain code is logged as a fixed unexpected code", async () => {
    const r = await run(world({ [DEMO]: "two" }), ARGS, {
      openStore: async () => {
        throw new Error(`Mario Rossi ${SECRET_KEY}`);
      },
    });
    expect(r.code).toBe(1);
    expect(r.logs.join("\n")).not.toContain("Mario");
    expect(r.logs).toHaveLength(1);
  });
});

describe("runFiles: fail loud, untrusted paths, download errors (lead's conditions)", () => {
  it("a failing download never leaks the key, the URL or the path: its error is dropped and only the position is logged", async () => {
    const w = world({ [DEMO]: "two" });
    const url = `${ENV.SUPABASE_URL}/storage/v1/object/${INVOICE_BUCKET_FOR_TEST}/${DEMO}`;
    const r = await run(w, ARGS, {
      downloadError: (path) => new Error(`GET ${url} apikey=${SECRET_KEY} failed for ${path}`),
      failDownloads: new Map([[DEMO, 2]]),
    });
    expect(r.code).toBe(1);
    expect(r.logs).toEqual(["files_download_failed (object 1 of 1)"]);
    const joined = r.logs.join("\n");
    for (const forbidden of [SECRET_KEY, DEMO, "Mario", "Rossi", "supabase.co", "apikey"]) {
      expect(joined).not.toContain(forbidden);
    }
  });

  it("a download that fails on the 2nd of 3 objects makes the run exit non-zero and puts no pack and no manifest", async () => {
    const w = world({ [P1]: "0123456789", [P2]: "abcdefghij", [P3]: "ABCDEFGHIJ" });
    const put = vi.spyOn(w.store.store, "put");
    // packBytes 10: P1 is already sealed into a pack when P2 fails; it still must not be uploaded.
    const r = await run(w, ARGS, {
      failDownloads: new Map([[P2, 2]]),
      limits: { packBytes: 10, runBytes: 1000 },
    });
    expect(r.code).not.toBe(0);
    expect(put).not.toHaveBeenCalled();
    expect(w.store.files.size).toBe(0);
    expect(w.store.retainCalls).toEqual([]);
    expect(r.logs).toEqual(["files_download_failed (object 2 of 3)"]);
  });

  it("a failure while uploading a later pack leaves no manifest behind", async () => {
    const w = world({ [P1]: "0123456789", [P2]: "abcdefghij" });
    const real = w.store.store.put;
    let n = 0;
    w.store.store.put = async (name, bytes) => {
      if (++n === 2) throw new Error("drive_upload_failed:500");
      return real(name, bytes);
    };
    const r = await run(w, ARGS, { limits: { packBytes: 10, runBytes: 1000 } });
    expect(r.code).toBe(1);
    expect([...w.store.files.keys()].some((k) => isFilesManifestName(k, "production"))).toBe(false);
  });

  const HOSTILE = [
    "../../etc/x",
    "a/../../b",
    "$(touch pwned).pdf",
    "`id`;rm -rf ~.pdf",
    "/abs/olute.pdf",
    "..",
  ];
  it("hostile object paths never become a file or directory name, an argument or a log line", async () => {
    const w = world(Object.fromEntries(HOSTILE.map((p, i) => [p, `bytes-${i}`])));
    const r = await run(w, ARGS);
    expect(r.code).toBe(0);
    // every file the script wrote is inside the work directory and has a generated name
    for (const path of r.writes) {
      expect(path.startsWith(`${WORK}/`), path).toBe(true);
      expect(path).not.toContain("..");
      expect(path).toMatch(/^[\w./-]+$/);
    }
    expect(r.writes.filter((p) => p.includes("/pack/o/")).length).toBe(HOSTILE.length);
    // no command argument holds an object path
    for (const c of r.calls)
      for (const arg of c.args) for (const p of HOSTILE) expect(arg).not.toBe(p);
    expect(r.calls.map((c) => c.command).sort()).toEqual(["gpg", "gpg", "psql", "tar"]);
    // the real paths are only in the (encrypted) index and manifest
    const index = parsePackIndex(unpack(w, packsOf(w)[0]!)["index.json"]!);
    expect(index.objects.map((o) => o.path).sort()).toEqual([...HOSTILE].sort());
    expect(Object.keys(newestManifest(w).objects).sort()).toEqual([...HOSTILE].sort());
    expect(r.logs.join("\n")).not.toContain("etc/x");
  });

  it("a path with a control character fails the run loudly with a count, uploads nothing and logs no path", async () => {
    const w = world({ [P1]: "one", "line\nbreak Mario.pdf": "two" });
    const r = await run(w, ARGS);
    expect(r.code).toBe(1);
    expect(r.logs).toEqual(["files_path_invalid (1 object)"]);
    expect(w.store.files.size).toBe(0);
    expect(r.downloads).toEqual([]);
  });

  it("the work directory is gone after a thrown error (a runner that throws, a store that throws)", async () => {
    const w = world({ [P1]: "one" });
    const thrown = await run(w, ARGS, { throwOn: "tar" });
    expect(thrown.code).toBe(1);
    expect(thrown.removed).toContain(WORK);
    expect([...thrown.fs.keys()].filter((k) => k.startsWith(WORK))).toEqual([]);
    expect(thrown.logs).toEqual(["files_run_failed:unexpected"]);
    const w2 = world({ [P1]: "one" });
    const store = await run(w2, ARGS, {
      openStore: async () => {
        throw new Error("boom");
      },
    });
    expect(store.removed).toContain(WORK);
  });
});

describe("runFiles: clean-up and retention", () => {
  it("removes the work directory on success and on every failure", async () => {
    const cases: (() => Promise<Awaited<ReturnType<typeof run>>>)[] = [
      async () => run(world({ [P1]: "one" }), ARGS),
      async () => run(world({ [P1]: "one" }), ARGS, { failDownloads: new Map([[P1, 2]]) }),
      async () => run(world({ [P1]: "one" }), ARGS, { psqlFails: true }),
      async () => {
        const w = world({ [P1]: "one" });
        await run(w, ARGS, { now: "2026-11-08T02:15:07Z" });
        return run(w, ARGS, {}, { ...ENV, BACKUP_ENCRYPTION_PASSPHRASE: "y".repeat(40) });
      },
      async () => {
        const w = world({ [P1]: "one" });
        await run(w, ARGS);
        return run(w, ARGS); // name taken
      },
    ];
    for (const scenario of cases) {
      const r = await scenario();
      expect(r.removed).toContain(WORK);
      expect([...r.fs.keys()].filter((k) => k.startsWith(WORK))).toEqual([]);
    }
  });

  it("calls the manifest retention with --keep, after the manifest is uploaded", async () => {
    const w = world({ [P1]: "one" });
    const r = await run(w, [
      "--work",
      WORK,
      "--target",
      "production",
      "--ref",
      "abc",
      "--keep",
      "7",
    ]);
    expect(r.code).toBe(0);
    expect(w.store.retainCalls).toEqual([["production", 7]]);
  });

  it("does not run the retention when the run fails before a manifest is written", async () => {
    const w = world({ [P1]: "one" });
    await run(w, ARGS, { failDownloads: new Map([[P1, 2]]) });
    expect(w.store.retainCalls).toEqual([]);
  });
});
