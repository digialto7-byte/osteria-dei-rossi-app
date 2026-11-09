import { createHash, generateKeyPairSync } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { buildManifest } from "../../../scripts/lib/backup/manifest";
import { runRestoreCheck, type RestoreDeps } from "../../../scripts/backup/restore-check";
import {
  CLEANUP_SQL,
  filesManifestName,
  filesPackName,
  isFilesManifestName,
  isFilesPackName,
  REPLICA_SQL,
} from "../../../scripts/lib/backup/commands";
import type { FilesManifest } from "../../../scripts/lib/backup/files-manifest";
import type { BackupStore, StoreFile } from "../../../scripts/lib/backup/store";

const PASS = "p".repeat(40);
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RAW = {
  migrations: ["20261021120000"],
  tables: { "public.stock_movement": 3, "auth.users": 2 },
};
const MANIFEST = buildManifest(RAW, "2026-11-05T02:15:09.000Z");
const NOW = new Date("2026-11-09T04:00:00Z");
const CLEAN = { ledger: [], cronJobs: 0, vaultSecrets: 0 };

function setup(
  restored: unknown = RAW,
  check: unknown = CLEAN,
  env: Record<string, string | undefined> = { BACKUP_ENCRYPTION_PASSPHRASE: PASS },
) {
  const calls: { cmd: string; args: string[]; input?: string }[] = [];
  const removed: string[] = [];
  const lines: string[] = [];
  const written: { path: string; bytes: Uint8Array }[] = [];
  const deps: RestoreDeps = {
    env,
    run: (cmd, args, opts) => {
      calls.push({ cmd, args, input: opts?.input });
      if (cmd === "psql" && args.includes("-At")) {
        const sql = args[args.indexOf("-c") + 1]!;
        return {
          status: 0,
          stdout: JSON.stringify(sql.includes("ledger") ? check : restored),
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
    mkdir: () => {},
    readFile: () => JSON.stringify(MANIFEST),
    writeFile: (path, bytes) => void written.push({ path, bytes }),
    remove: (path) => void removed.push(path),
    fetch: (async () => new Response("{}", { status: 500 })) as typeof fetch,
    now: () => NOW,
    log: (line) => void lines.push(line),
  };
  return { deps, calls, removed, lines, written };
}

const ARGV = ["--file", "/run/in.tar.gpg", "--work", "/run/restore", "--db-url", LOCAL];

describe("runRestoreCheck", () => {
  it("decrypts, unpacks, restores in one psql run and passes checks (a) to (d)", async () => {
    const { deps, calls, lines } = setup();
    expect(await runRestoreCheck(ARGV, deps)).toBe(0);
    const cmds = calls.map((c) => c.cmd);
    expect(cmds.slice(0, 3)).toEqual(["gpg", "tar", "psql"]);
    const restore = calls[2]!;
    expect(restore.args[0]).toBe(LOCAL);
    expect(restore.args).toContain("--single-transaction");
    expect(restore.args).toContain("/run/restore/files/roles.sql");
    // The migration history is restored too (CI run 42509760322: the manifest found no supabase_migrations).
    expect(restore.args).toContain("/run/restore/files/history_schema.sql");
    expect(restore.args).toContain("/run/restore/files/history_data.sql");
    expect(lines.join("\n")).toContain('"ok":true');
  });

  it("gives the passphrase to gpg on stdin only", async () => {
    const { deps, calls } = setup();
    await runRestoreCheck(ARGV, deps);
    expect(calls.filter((c) => c.input !== undefined).map((c) => c.cmd)).toEqual(["gpg"]);
    for (const c of calls) expect(c.args.join(" ")).not.toContain(PASS);
  });

  it("refuses a non-local restore target before running anything", async () => {
    const { deps, calls, lines } = setup();
    const remote =
      "postgresql://postgres.abc:fake-pass@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
    expect(await runRestoreCheck(["--file", "/f", "--work", "/w", "--db-url", remote], deps)).toBe(
      1,
    );
    expect(calls).toEqual([]);
    expect(lines.join("\n")).toContain("restore_target_not_local");
    expect(lines.join("\n")).not.toContain("fake-pass");
  });

  it("(a) fails on a ledger finding and names the check", async () => {
    const { deps, lines } = setup(RAW, { ...CLEAN, ledger: [{ check: "lot_missing", rows: 2 }] });
    expect(await runRestoreCheck(ARGV, deps)).toBe(1);
    expect(lines.join("\n")).toContain("ledger lot_missing: 2");
  });

  it("(b) fails on a differing count and (c) on differing migrations", async () => {
    const counts = setup({ ...RAW, tables: { "public.stock_movement": 2, "auth.users": 2 } });
    expect(await runRestoreCheck(ARGV, counts.deps)).toBe(1);
    expect(counts.lines.join("\n")).toContain("table public.stock_movement: expected 3, found 2");
    const migrations = setup({ ...RAW, migrations: ["20261121100000"] });
    expect(await runRestoreCheck(ARGV, migrations.deps)).toBe(1);
    expect(migrations.lines.join("\n")).toContain("migration 20261021120000");
  });

  it("(d) fails when cron jobs or the Vault secrets survive", async () => {
    for (const bad of [
      { ...CLEAN, cronJobs: 5 },
      { ...CLEAN, vaultSecrets: 1 },
    ]) {
      const { deps, lines } = setup(RAW, bad);
      expect(await runRestoreCheck(ARGV, deps)).toBe(1);
      expect(lines.join("\n")).toMatch(/cron jobs: 5|vault secrets: 1/);
    }
  });

  it("--require-nonzero fails on an empty table and passes on a filled one", async () => {
    const withZero = setup({ ...RAW, tables: { "public.stock_movement": 0, "auth.users": 2 } });
    withZero.deps.readFile = () =>
      JSON.stringify(
        buildManifest(
          { ...RAW, tables: { "public.stock_movement": 0, "auth.users": 2 } },
          MANIFEST.createdAt,
        ),
      );
    const args = [...ARGV, "--require-nonzero", "public.stock_movement,auth.users"];
    expect(await runRestoreCheck(args, withZero.deps)).toBe(1);
    expect(withZero.lines.join("\n")).toContain("public.stock_movement is empty");
    expect(await runRestoreCheck(args, setup().deps)).toBe(0);
  });

  it("fails without the passphrase, and when a command fails, redacting output", async () => {
    expect(await runRestoreCheck(ARGV, setup(RAW, CLEAN, {}).deps)).toBe(1);
    const { deps, lines } = setup();
    const run = deps.run;
    deps.run = (cmd, args, opts) =>
      cmd === "psql" && !args.includes("-At")
        ? { status: 3, stdout: "", stderr: `ERROR near ${LOCAL}` }
        : run(cmd, args, opts);
    expect(await runRestoreCheck(ARGV, deps)).toBe(1);
    expect(lines.join("\n")).toContain("restore_failed");
    expect(lines.join("\n")).not.toContain("postgres:postgres@");
  });

  it("never logs row data from psql stderr; logs the exit status and SQLSTATE; runs psql terse", async () => {
    const samples = [
      "ERROR:  23502\nDETAIL:  Failing row contains (1, mario@example.test, $2a$10$fakefakefakefakefakefakefakefakefakefakefakefake).",
      'ERROR:  22P02\nCONTEXT:  COPY users, line 3, column email: "mario@example.test"',
      "ERROR:  23505\nDETAIL:  Key (email)=(mario@example.test) already exists.",
      "COPY auth.users 1, mario@example.test, $2a$10$fakefakefakefakefakefakefakefakefakefakefakefake",
    ];
    for (const stderr of samples) {
      const { deps, lines, calls } = setup();
      const run = deps.run;
      deps.run = (cmd, args, opts) =>
        cmd === "psql" && !args.includes("-At")
          ? { status: 3, stdout: "", stderr }
          : run(cmd, args, opts);
      expect(await runRestoreCheck(ARGV, deps)).toBe(1);
      const text = lines.join("\n");
      expect(text).not.toContain("mario@example.test");
      expect(text).not.toContain("$2a$10$");
      expect(text).not.toContain("Failing row");
      expect(text).toContain("restore_failed (exit 3");
      for (const c of calls.filter((x) => x.cmd === "psql")) {
        expect(c.args).toContain("VERBOSITY=sqlstate");
        expect(c.args).toContain("SHOW_CONTEXT=never");
      }
    }
    const { deps, lines } = setup();
    const run = deps.run;
    deps.run = (cmd, args, opts) =>
      cmd === "psql" && !args.includes("-At")
        ? { status: 3, stdout: "", stderr: "ERROR:  23502\nDETAIL: x" }
        : run(cmd, args, opts);
    await runRestoreCheck(ARGV, deps);
    expect(lines.join("\n")).toContain("SQLSTATE 23502");
  });

  // CI 2026-11-08 (run 42509317821): the restore went through and a check query failed with no more than "check_query_failed".
  it("a failed check query logs which query, its exit status and SQLSTATE, never its stderr", async () => {
    for (const [query, name] of [
      ["ledger", "restore_check"],
      ["manifest", "manifest"],
    ] as const) {
      const { deps, lines } = setup();
      const run = deps.run;
      deps.run = (cmd, args, opts) => {
        if (cmd === "psql" && args.includes("-At")) {
          const isLedger = args[args.indexOf("-c") + 1]!.includes("ledger");
          if (isLedger === (query === "ledger")) {
            return {
              status: 1,
              stdout: "",
              stderr: "ERROR:  42501\nDETAIL:  Failing row contains (mario@example.test).",
            };
          }
        }
        return run(cmd, args, opts);
      };
      expect(await runRestoreCheck(ARGV, deps)).toBe(1);
      const text = lines.join("\n");
      expect(text).toContain(`check_query_failed:${name} (exit 1, SQLSTATE 42501)`);
      expect(text).not.toContain("mario@example.test");
    }
  });

  it("names the refused statement by file, line, verb and object, read from the dump", async () => {
    const { deps, lines } = setup();
    const run = deps.run;
    deps.run = (cmd, args, opts) =>
      cmd === "psql" && !args.includes("-At")
        ? { status: 3, stdout: "", stderr: "psql:/run/restore/files/data.sql:2: ERROR:  42501" }
        : run(cmd, args, opts);
    deps.readFile = (path) =>
      path.endsWith("data.sql")
        ? 'SET x = 1;\nCOPY "vault"."secrets" ("id", "secret") FROM stdin;\nrow-with-mario@example.test\n'
        : JSON.stringify(MANIFEST);
    expect(await runRestoreCheck(ARGV, deps)).toBe(1);
    const text = lines.join("\n");
    expect(text).toContain(
      'restore_failed (exit 3, SQLSTATE 42501) at data.sql:2 COPY "vault"."secrets"',
    );
    expect(text).not.toContain("mario@example.test");
  });

  it("restores roles.sql without the platform's parameter grants, and logs how many it left out", async () => {
    const { deps, lines, calls } = setup();
    const writes: { path: string; text: string }[] = [];
    deps.readFile = (path) =>
      path.endsWith("roles.sql")
        ? 'CREATE ROLE "r";\nGRANT SET ON PARAMETER "session_replication_role" TO "postgres";\n'
        : JSON.stringify(MANIFEST);
    const write = deps.writeFile;
    deps.writeFile = (path, bytes) => {
      writes.push({ path, text: new TextDecoder().decode(bytes) });
      write(path, bytes);
    };
    expect(await runRestoreCheck(ARGV, deps)).toBe(0);
    const roles = writes.find((w) => w.path === "/run/restore/files/roles.sql");
    expect(roles?.text).toBe('CREATE ROLE "r";\n');
    expect(lines.join("\n")).toContain("roles: 1 parameter grant left out");
    const restore = calls.find((c) => c.cmd === "psql" && !c.args.includes("-At"))!;
    expect(restore.args.indexOf("/run/restore/files/roles.sql")).toBeGreaterThan(-1);
  });

  it("writes the replica and clean-up files next to the dump and restores with them", async () => {
    const { deps, calls } = setup();
    const writes: { path: string; text: string }[] = [];
    const write = deps.writeFile;
    deps.writeFile = (path, bytes) => {
      writes.push({ path, text: new TextDecoder().decode(bytes) });
      write(path, bytes);
    };
    expect(await runRestoreCheck(ARGV, deps)).toBe(0);
    expect(writes.find((w) => w.path === "/run/restore/files/replica.sql")?.text).toBe(REPLICA_SQL);
    expect(writes.find((w) => w.path === "/run/restore/files/cleanup.sql")?.text).toBe(CLEANUP_SQL);
    const restore = calls.find((c) => c.cmd === "psql" && !c.args.includes("-At"))!;
    expect(restore.args).toContain("/run/restore/files/replica.sql");
    expect(restore.args).toContain("/run/restore/files/cleanup.sql");
  });

  it("removes the decrypted files whatever happens", async () => {
    const ok = setup();
    await runRestoreCheck(ARGV, ok.deps);
    expect(ok.removed).toEqual(["/run/restore/backup.tar", "/run/restore/files"]);
    const bad = setup(RAW, { ...CLEAN, cronJobs: 1 });
    await runRestoreCheck(ARGV, bad.deps);
    expect(bad.removed).toEqual(["/run/restore/backup.tar", "/run/restore/files"]);
  });
});

describe("runRestoreCheck from Drive", () => {
  const FOLDER = "folder-id-fake-123";
  const BYTES = new TextEncoder().encode("encrypted-bytes");
  const NAME = "osteria-backup-20261109T021509Z-production.tar.gpg";
  let sa = "";
  beforeAll(() => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    sa = JSON.stringify({
      client_email: "backup@fake.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });
  });
  const md5 = (b: Uint8Array) => createHash("md5").update(b).digest("hex");
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

  function drive(opts: { files?: unknown[]; md5?: string; listStatus?: number } = {}) {
    const urls: string[] = [];
    const env = {
      BACKUP_ENCRYPTION_PASSPHRASE: PASS,
      BACKUP_DRIVE_SA_JSON: sa,
      BACKUP_DRIVE_FOLDER_ID: FOLDER,
    };
    const s = setup(RAW, CLEAN, env);
    s.deps.fetch = (async (url: string | URL) => {
      const u = new URL(String(url));
      urls.push(u.origin + u.pathname);
      if (u.hostname === "oauth2.googleapis.com") {
        return new Response(JSON.stringify({ access_token: "ya29.fake" }));
      }
      if (u.searchParams.get("alt") === "media") return new Response(BYTES);
      if (opts.listStatus) return new Response("{}", { status: opts.listStatus });
      const files = opts.files ?? [
        { id: "f1", name: NAME, createdTime: hoursAgo(2), md5Checksum: opts.md5 ?? md5(BYTES) },
      ];
      return new Response(JSON.stringify({ files }));
    }) as typeof fetch;
    return { ...s, urls };
  }
  const ARGV_DRIVE = ["--from-drive", "production", "--work", "/run/restore", "--db-url", LOCAL];

  it("downloads the newest copy, verifies its MD5, decrypts that file and checks the restore", async () => {
    const { deps, calls, written } = drive();
    expect(await runRestoreCheck(ARGV_DRIVE, deps)).toBe(0);
    // The encrypted copy is written once (roles.sql is rewritten without the platform's parameter grants, and the replica and
    // clean-up files are written next to the dump).
    const encrypted = written.filter((w) => w.path.endsWith(".gpg"));
    expect(encrypted).toHaveLength(1);
    expect(encrypted[0]!.path).toBe("/run/restore/from-drive.tar.gpg");
    expect(encrypted[0]!.bytes).toEqual(BYTES);
    expect(written.map((w) => w.path).sort()).toEqual([
      "/run/restore/files/cleanup.sql",
      "/run/restore/files/replica.sql",
      "/run/restore/files/roles.sql",
      "/run/restore/from-drive.tar.gpg",
    ]);
    expect(calls[0]!.cmd).toBe("gpg");
    expect(calls[0]!.args.at(-1)).toBe("/run/restore/from-drive.tar.gpg");
  });

  it("removes the downloaded copy afterwards", async () => {
    const { deps, removed } = drive();
    await runRestoreCheck(ARGV_DRIVE, deps);
    expect(removed).toContain("/run/restore/from-drive.tar.gpg");
  });

  it("fails with backup_stale when the newest copy is 37 hours old, without downloading or restoring", async () => {
    const stale = [{ id: "f1", name: NAME, createdTime: hoursAgo(37), md5Checksum: md5(BYTES) }];
    const { deps, calls, urls, lines } = drive({ files: stale });
    expect(await runRestoreCheck(ARGV_DRIVE, deps)).toBe(1);
    expect(lines.join("\n")).toContain("backup_stale");
    expect(calls).toEqual([]);
    expect(urls.some((u) => u.includes("/drive/v3/files/f1"))).toBe(false);
  });

  it("fails with backup_missing when the folder has no production copy", async () => {
    const other = [
      {
        id: "s",
        name: NAME.replace("production", "staging"),
        createdTime: hoursAgo(1),
        md5Checksum: "m",
      },
    ];
    const { deps, calls, lines } = drive({ files: other });
    expect(await runRestoreCheck(ARGV_DRIVE, deps)).toBe(1);
    expect(lines.join("\n")).toContain("backup_missing");
    expect(calls).toEqual([]);
  });

  it("fails with backup_checksum_mismatch on a damaged download, before decrypting", async () => {
    const { deps, calls, lines } = drive({ md5: "0".repeat(32) });
    expect(await runRestoreCheck(ARGV_DRIVE, deps)).toBe(1);
    expect(lines.join("\n")).toContain("backup_checksum_mismatch");
    expect(calls).toEqual([]);
  });

  it("reports a Drive failure as a code with no secret", async () => {
    const { deps, lines } = drive({ listStatus: 403 });
    expect(await runRestoreCheck(ARGV_DRIVE, deps)).toBe(1);
    const text = lines.join("\n");
    expect(text).toContain("drive_list_failed:403");
    for (const secret of [FOLDER, "ya29", "PRIVATE KEY", PASS]) expect(text).not.toContain(secret);
  });

  it("needs the Drive variables, and exactly one of --file and --from-drive", async () => {
    const noEnv = drive();
    noEnv.deps.env = { BACKUP_ENCRYPTION_PASSPHRASE: PASS };
    expect(await runRestoreCheck(ARGV_DRIVE, noEnv.deps)).toBe(1);
    expect(noEnv.lines.join("\n")).toContain(
      "backup_env_missing:BACKUP_DRIVE_SA_JSON,BACKUP_DRIVE_FOLDER_ID",
    );
    const both = drive();
    expect(await runRestoreCheck([...ARGV_DRIVE, "--file", "/x"], both.deps)).toBe(1);
    const neither = drive();
    expect(await runRestoreCheck(["--work", "/w"], neither.deps)).toBe(1);
    const badTarget = drive();
    expect(await runRestoreCheck(["--from-drive", "prod", "--work", "/w"], badTarget.deps)).toBe(1);
  });
});

// ---- Invoice files (ADR-034, plan §3.5 checks (e) to (i)) ----
describe("runRestoreCheck: the invoice files", () => {
  const FOLDER = "folder-id-fake-123";
  let sa = "";
  beforeAll(() => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    sa = JSON.stringify({
      client_email: "backup@fake.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });
  });
  const DB_BYTES = new TextEncoder().encode("encrypted-bytes");
  const DB_NAME = "osteria-backup-20261109T021509Z-production.tar.gpg";
  const T1 = "11111111-1111-4111-8111-111111111111";
  const PA = `${T1}/2026/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`;
  const PB = `${T1}/2026/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf`;
  const PC = "demo/Mario Rossi fattura.pdf"; // a secret-key-style path that looks like a person's name
  const md5 = (b: Uint8Array) => createHash("md5").update(b).digest("hex");
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const enc = (text: string) => new TextEncoder().encode(text);
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
  const day = (d: number) => new Date(`2026-11-0${d}T02:15:00Z`);
  const manifestStamp = (d: number) => filesManifestName(day(d), "production");

  type Obj = { path: string; content: string };
  /** The "encrypted" bytes of a pack are a JSON map of members (the fake gpg and tar are identity). */
  function makePack(d: number, objects: Obj[], over: { content?: Record<string, string> } = {}) {
    const name = filesPackName(day(d), "production", 1);
    const members: Record<string, string> = {};
    const index = {
      version: 1,
      createdAt: day(d).toISOString(),
      target: "production",
      objects: objects.map((o, i) => {
        const member = `o/${String(i + 1).padStart(6, "0")}`;
        members[member] = over.content?.[member] ?? o.content;
        return { path: o.path, member, sha256: sha(o.content), size: o.content.length };
      }),
    };
    members["index.json"] = JSON.stringify(index);
    return { name, bytes: enc(JSON.stringify(members)), index };
  }
  function makeManifest(
    packs: ReturnType<typeof makePack>[],
    removed: string[] = [],
  ): FilesManifest {
    const objects: FilesManifest["objects"] = {};
    for (const p of packs) {
      for (const o of p.index.objects) {
        objects[o.path] = {
          sha256: o.sha256,
          size: o.size,
          updatedAt: "2026-11-01T10:00:00+00:00",
          pack: p.name,
          member: o.member,
          removedAt: removed.includes(o.path) ? "2026-11-08T00:00:00.000Z" : null,
          previous: [],
        };
      }
    }
    return { version: 1, createdAt: day(9).toISOString(), target: "production", objects };
  }

  type Spec = {
    packs: ReturnType<typeof makePack>[];
    manifest?: FilesManifest | null; // null = no manifest in the store
    manifestAgeHours?: number;
    restoredNames?: string[];
    dropPack?: number; // index of a pack that is not in the store
  };
  function build(spec: Spec, argvExtra: string[], via: "drive" | "dir" = "drive") {
    const s = setup(RAW, CLEAN, {
      BACKUP_ENCRYPTION_PASSPHRASE: PASS,
      BACKUP_DRIVE_SA_JSON: sa,
      BACKUP_DRIVE_FOLDER_ID: FOLDER,
    });
    const fs = new Map<string, Uint8Array>();
    const store = new Map<string, { bytes: Uint8Array; createdTime: string }>();
    spec.packs.forEach((p, i) => {
      if (i !== spec.dropPack) store.set(p.name, { bytes: p.bytes, createdTime: hoursAgo(30 - i) });
    });
    const manifest = spec.manifest === undefined ? makeManifest(spec.packs) : spec.manifest;
    if (manifest) {
      store.set(manifestStamp(9), {
        bytes: enc(JSON.stringify(manifest)),
        createdTime: hoursAgo(spec.manifestAgeHours ?? 2),
      });
    }
    const downloads: string[] = [];
    const queries: string[] = [];
    const baseRun = s.deps.run;
    s.deps.run = (cmd, args, opts) => {
      if (cmd === "psql" && args.includes("-At")) {
        const sql = args[args.indexOf("-c") + 1]!;
        if (sql.includes("storage.objects")) {
          queries.push("restored_objects");
          return {
            status: 0,
            stdout: JSON.stringify(spec.restoredNames ?? Object.keys(manifest?.objects ?? {})),
            stderr: "",
          };
        }
      }
      if (cmd === "gpg" && fs.has(args.at(-1)!)) {
        s.calls.push({ cmd, args, input: opts?.input });
        fs.set(args[args.indexOf("--output") + 1]!, fs.get(args.at(-1)!)!);
        return { status: 0, stdout: "", stderr: "" };
      }
      if (
        cmd === "tar" &&
        args[0] === "-xf" &&
        args[1]!.includes("files-check") &&
        fs.has(args[1]!)
      ) {
        const dir = args[args.indexOf("-C") + 1]!;
        const members = JSON.parse(new TextDecoder().decode(fs.get(args[1]!)!)) as Record<
          string,
          string
        >;
        for (const [name, text] of Object.entries(members)) fs.set(`${dir}/${name}`, enc(text));
        return { status: 0, stdout: "", stderr: "" };
      }
      return baseRun(cmd, args, opts);
    };
    const baseWrite = s.deps.writeFile;
    s.deps.writeFile = (path, bytes) => {
      fs.set(path, bytes);
      baseWrite(path, bytes);
    };
    const baseRemove = s.deps.remove;
    s.deps.remove = (path) => {
      for (const k of [...fs.keys()]) if (k === path || k.startsWith(`${path}/`)) fs.delete(k);
      baseRemove(path);
    };
    const baseRead = s.deps.readFile;
    s.deps.readFile = (path) =>
      fs.has(path) && path.endsWith(".json")
        ? new TextDecoder().decode(fs.get(path)!)
        : baseRead(path);
    s.deps.readBytes = (path) => {
      const b = fs.get(path);
      if (!b) throw new Error("ENOENT");
      return b;
    };
    s.deps.random = () => 0;
    const memStore: BackupStore = {
      async list(target) {
        return [...store.entries()]
          .filter(([n]) => isFilesPackName(n, target) || isFilesManifestName(n, target))
          .map(([name, f]): StoreFile => ({
            id: name,
            name,
            createdTime: f.createdTime,
            md5Checksum: md5(f.bytes),
          }))
          .sort((a, b) => b.createdTime.localeCompare(a.createdTime));
      },
      async put() {},
      async get(file) {
        downloads.push(file.name);
        return store.get(file.name)!.bytes;
      },
      async retain() {
        return [];
      },
    };
    if (via === "dir") {
      s.deps.dirStore = () => memStore;
    } else {
      s.deps.fetch = (async (url: string | URL) => {
        const u = new URL(String(url));
        if (u.hostname === "oauth2.googleapis.com")
          return new Response(JSON.stringify({ access_token: "ya29.fake" }));
        if (u.searchParams.get("alt") === "media") {
          const id = decodeURIComponent(u.pathname.split("/").pop()!);
          if (id === "db") return new Response(DB_BYTES as BodyInit);
          downloads.push(id);
          return new Response(store.get(id)!.bytes as BodyInit);
        }
        const files = [
          { id: "db", name: DB_NAME, createdTime: hoursAgo(2), md5Checksum: md5(DB_BYTES) },
          ...[...store.entries()].map(([name, f]) => ({
            id: name,
            name,
            createdTime: f.createdTime,
            md5Checksum: md5(f.bytes),
          })),
        ];
        return new Response(JSON.stringify({ files }));
      }) as typeof fetch;
    }
    const argv =
      via === "drive"
        ? ["--from-drive", "production", "--work", "/run/restore", "--db-url", LOCAL, ...argvExtra]
        : [
            "--file",
            "/run/osteria-backup-20261109T021509Z-production.tar.gpg",
            "--work",
            "/run/restore",
            "--db-url",
            LOCAL,
            ...argvExtra,
          ];
    return { ...s, argv, downloads, queries, fs };
  }

  const PACKS = () => [
    makePack(7, [{ path: PA, content: "pdf-a" }]),
    makePack(8, [{ path: PB, content: "pdf-b" }]),
    makePack(9, [{ path: PC, content: "pdf-c" }]),
  ];

  it("without --files-packs the calls and the log are today's: no storage.objects query, no files key", async () => {
    const t = build({ packs: PACKS() }, []);
    expect(await runRestoreCheck(t.argv, t.deps)).toBe(0);
    expect(t.queries).toEqual([]);
    expect(t.downloads).toEqual([]);
    const summary = JSON.parse(t.lines.find((l) => l.startsWith("{"))!);
    expect(Object.keys(summary)).toEqual(["ok", "problems", "migrations", "tables"]);
    expect(t.removed).toEqual([
      "/run/restore/backup.tar",
      "/run/restore/files",
      "/run/restore/from-drive.tar.gpg",
    ]);
  });

  it("--from-drive production --files-packs 2 downloads the newest manifest and two packs, passes, and logs counts", async () => {
    const t = build({ packs: PACKS() }, ["--files-packs", "2"]);
    expect(await runRestoreCheck(t.argv, t.deps)).toBe(0);
    expect(t.downloads).toHaveLength(3);
    expect(t.downloads).toContain(manifestStamp(9));
    expect(t.downloads).toContain(filesPackName(day(9), "production", 1)); // the newest pack is always checked
    const summary = JSON.parse(t.lines.find((l) => l.startsWith("{"))!);
    expect(summary).toMatchObject({
      ok: true,
      files: { objects: 3, packsChecked: 2, filesChecked: 2 },
    });
    expect(t.queries).toEqual(["restored_objects"]);
  });

  it("--files-packs all opens every pack", async () => {
    const t = build({ packs: PACKS() }, ["--files-packs", "all"]);
    expect(await runRestoreCheck(t.argv, t.deps)).toBe(0);
    expect(JSON.parse(t.lines.find((l) => l.startsWith("{"))!).files).toEqual({
      objects: 3,
      packsChecked: 3,
      filesChecked: 3,
    });
  });

  it("no manifest gives files_manifest_missing and exit 1", async () => {
    const t = build({ packs: PACKS(), manifest: null }, ["--files-packs", "2"]);
    expect(await runRestoreCheck(t.argv, t.deps)).toBe(1);
    expect(t.lines.join("\n")).toContain("files_manifest_missing");
  });

  it("a manifest 37 hours old gives files_manifest_stale and exit 1, without opening a pack", async () => {
    const t = build({ packs: PACKS(), manifestAgeHours: 37 }, ["--files-packs", "2"]);
    expect(await runRestoreCheck(t.argv, t.deps)).toBe(1);
    expect(t.lines.join("\n")).toContain("files_manifest_stale");
    expect(t.downloads).toEqual([]);
  });

  it("a differing member fails the run, naming the pack and a count only", async () => {
    const packs = PACKS();
    packs[2] = makePack(9, [{ path: PC, content: "pdf-c" }], {
      content: { "o/000001": "tampered" },
    });
    const t = build({ packs, manifest: makeManifest(PACKS()) }, ["--files-packs", "all"]);
    expect(await runRestoreCheck(t.argv, t.deps)).toBe(1);
    expect(t.lines.join("\n")).toContain(`restore_check: pack ${packs[2]!.name}: 1 file differs`);
  });

  it("an index that differs from the manifest fails the run", async () => {
    const packs = PACKS();
    const other = makePack(8, [
      { path: PB, content: "pdf-b" },
      { path: PA, content: "x" },
    ]);
    packs[1] = other;
    const t = build({ packs, manifest: makeManifest(PACKS()) }, ["--files-packs", "all"]);
    expect(await runRestoreCheck(t.argv, t.deps)).toBe(1);
    expect(t.lines.join("\n")).toContain(`pack ${other.name}: index differs from the manifest`);
  });

  it("a restored object name that the manifest does not have fails the run (count only)", async () => {
    const t = build({ packs: PACKS(), restoredNames: [PA, PB, PC, "x/not-backed-up.pdf"] }, [
      "--files-packs",
      "1",
    ]);
    expect(await runRestoreCheck(t.argv, t.deps)).toBe(1);
    const text = t.lines.join("\n");
    expect(text).toContain(
      "restore_check: files: 1 objects of the database copy are not in the files manifest",
    );
    expect(text).not.toContain("not-backed-up");
  });

  it("a removed manifest entry still counts as present", async () => {
    const packs = PACKS();
    const t = build({ packs, manifest: makeManifest(packs, [PA]), restoredNames: [PA, PB, PC] }, [
      "--files-packs",
      "all",
    ]);
    expect(await runRestoreCheck(t.argv, t.deps)).toBe(0);
  });

  it("a pack the manifest names but the store lacks fails the run", async () => {
    const packs = PACKS();
    const t = build({ packs, manifest: makeManifest(packs), dropPack: 0 }, [
      "--files-packs",
      "all",
    ]);
    expect(await runRestoreCheck(t.argv, t.deps)).toBe(1);
    expect(t.lines.join("\n")).toContain(
      "restore_check: files: 1 packs named in the manifest are missing",
    );
  });

  it("--files-dir with --from-drive is a usage error and runs nothing", async () => {
    const t = build({ packs: PACKS() }, ["--files-packs", "2", "--files-dir", "/store"]);
    expect(await runRestoreCheck(t.argv, t.deps)).toBe(1);
    expect(t.calls).toEqual([]);
  });

  it("other bad file flags are usage errors: --files-dir or --require-files without --files-packs, a bad count, --file without a store", async () => {
    for (const [via, extra] of [
      ["dir", ["--files-dir", "/store"]],
      ["drive", ["--require-files"]],
      ["drive", ["--files-packs", "0"]],
      ["drive", ["--files-packs", "two"]],
      ["dir", ["--files-packs", "2"]],
    ] as const) {
      const t = build({ packs: PACKS() }, [...extra], via);
      expect(await runRestoreCheck(t.argv, t.deps), extra.join(" ")).toBe(1);
      expect(t.calls).toEqual([]);
    }
  });

  it("--require-files fails on a manifest with no live entry (empty, or all removed)", async () => {
    const empty = build({ packs: [], manifest: makeManifest([]) }, [
      "--files-packs",
      "all",
      "--require-files",
    ]);
    expect(await runRestoreCheck(empty.argv, empty.deps)).toBe(1);
    expect(empty.lines.join("\n")).toContain("files: no object in the files manifest");
    const packs = PACKS();
    const allRemoved = build({ packs, manifest: makeManifest(packs, [PA, PB, PC]) }, [
      "--files-packs",
      "all",
      "--require-files",
    ]);
    expect(await runRestoreCheck(allRemoved.argv, allRemoved.deps)).toBe(1);
    // an empty manifest passes without the flag
    const ok = build({ packs: [], manifest: makeManifest([]) }, ["--files-packs", "all"]);
    expect(await runRestoreCheck(ok.argv, ok.deps)).toBe(0);
  });

  it("with --file and --files-dir (the self-test) the directory store is used and no Drive call is made", async () => {
    const t = build(
      { packs: PACKS() },
      ["--files-packs", "all", "--require-files", "--files-dir", "/store"],
      "dir",
    );
    t.deps.fetch = (async () => {
      throw new Error("no network");
    }) as typeof fetch;
    expect(await runRestoreCheck(t.argv, t.deps)).toBe(0);
    expect(JSON.parse(t.lines.find((l) => l.startsWith("{"))!).files.packsChecked).toBe(3);
  });

  it("no log line holds an object path or a personal name, on success or failure", async () => {
    const lines: string[] = [];
    const ok = build({ packs: PACKS() }, ["--files-packs", "all"]);
    await runRestoreCheck(ok.argv, ok.deps);
    lines.push(...ok.lines);
    const packs = PACKS();
    packs[2] = makePack(9, [{ path: PC, content: "pdf-c" }], {
      content: { "o/000001": "tampered" },
    });
    const bad = build(
      {
        packs,
        manifest: makeManifest(PACKS()),
        restoredNames: [PA, PB, PC, "demo/Luigi Verdi.pdf"],
      },
      ["--files-packs", "all"],
    );
    await runRestoreCheck(bad.argv, bad.deps);
    lines.push(...bad.lines);
    const joined = lines.join("\n");
    for (const forbidden of [PA, PB, PC, "Mario", "Rossi", "Luigi", T1, "demo/", PASS, FOLDER]) {
      expect(joined, forbidden).not.toContain(forbidden);
    }
    for (const l of lines) expect(l).not.toMatch(/[0-9a-f]{64}/);
  });

  it("removes files-check and the decrypted manifest in finally, on success and on failure", async () => {
    for (const restoredNames of [undefined, [PA, "x/y.pdf"]]) {
      const t = build({ packs: PACKS(), restoredNames }, ["--files-packs", "all"]);
      await runRestoreCheck(t.argv, t.deps);
      expect(t.removed).toContain("/run/restore/files-check");
      expect(t.removed).toContain("/run/restore/files-manifest.json");
      expect(t.removed).toContain("/run/restore/files-manifest.json.gpg");
      expect([...t.fs.keys()].filter((k) => k.startsWith("/run/restore/files-"))).toEqual([]);
    }
  });

  it("the passphrase reaches gpg on stdin only, also for manifests and packs", async () => {
    const t = build({ packs: PACKS() }, ["--files-packs", "all"]);
    await runRestoreCheck(t.argv, t.deps);
    const gpgs = t.calls.filter((c) => c.cmd === "gpg");
    expect(gpgs.length).toBe(1 + 1 + 3);
    for (const c of gpgs) {
      expect(c.input).toBe(PASS);
      expect(c.args.join(" ")).not.toContain(PASS);
    }
  });
});
