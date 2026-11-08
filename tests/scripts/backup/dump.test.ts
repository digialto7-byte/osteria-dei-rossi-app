import { describe, expect, it } from "vitest";
import { runDump, type DumpDeps } from "../../../scripts/backup/dump";
import { STORAGE_PLATFORM_TABLES } from "../../../scripts/lib/backup/commands";

const PASS = "p".repeat(40);
const DB =
  "postgresql://postgres.abc:fake-pass@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
const RAW = {
  migrations: ["20261021120000"],
  tables: { "public.stock_movement": 3, "auth.users": 2 },
};

type Call = { cmd: string; args: string[]; cwd?: string; input?: string };

function setup(overrides: { failOn?: string; env?: Record<string, string | undefined> } = {}) {
  const calls: Call[] = [];
  const files = new Map<string, string>();
  const removed: string[] = [];
  const lines: string[] = [];
  const deps: DumpDeps = {
    env: {
      SUPABASE_DB_URL: DB,
      SUPABASE_URL: "https://abc.supabase.co",
      BACKUP_ENCRYPTION_PASSPHRASE: PASS,
      ...overrides.env,
    },
    supabaseBin: "/repo/node_modules/.bin/supabase",
    run: (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts?.cwd, input: opts?.input });
      const tag = cmd.endsWith("supabase") ? `dump:${args[args.indexOf("-f") + 1]}` : cmd;
      if (overrides.failOn && tag.includes(overrides.failOn)) {
        return { status: 1, stdout: "", stderr: `boom ${DB}` };
      }
      if (cmd === "psql") return { status: 0, stdout: JSON.stringify(RAW), stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    },
    mkdir: () => {},
    writeFile: (path, text) => void files.set(path, text),
    remove: (path) => void removed.push(path),
    sha256: () => "a".repeat(64),
    now: () => new Date("2026-11-05T02:15:09Z"),
    log: (line) => void lines.push(line),
  };
  return { deps, calls, files, removed, lines };
}

const ARGV = ["--out", "/run/backup", "--target", "production", "--ref", "abc"];
const NAME = "osteria-backup-20261105T021509Z-production.tar.gpg";

describe("runDump", () => {
  it("dumps roles, schema, data and the migration history from the work directory, then manifests, packs and encrypts", async () => {
    const { deps, calls, files } = setup();
    expect(await runDump(ARGV, deps)).toBe(0);
    const dumps = calls.filter((c) => c.cmd.endsWith("supabase"));
    expect(dumps.map((c) => c.args)).toEqual([
      ["db", "dump", "--db-url", DB, "-f", "roles.sql", "--role-only"],
      ["db", "dump", "--db-url", DB, "-f", "schema.sql"],
      [
        "db",
        "dump",
        "--db-url",
        DB,
        "-f",
        "data.sql",
        "--data-only",
        "--use-copy",
        ...STORAGE_PLATFORM_TABLES.flatMap((t) => ["-x", t]),
      ],
      ["db", "dump", "--db-url", DB, "-f", "history_schema.sql", "--schema", "supabase_migrations"],
      [
        "db",
        "dump",
        "--db-url",
        DB,
        "-f",
        "history_data.sql",
        "--schema",
        "supabase_migrations",
        "--data-only",
        "--use-copy",
      ],
    ]);
    const tar = calls.find((c) => c.cmd === "tar")!;
    expect(tar.args.slice(4)).toEqual([
      "roles.sql",
      "schema.sql",
      "data.sql",
      "history_schema.sql",
      "history_data.sql",
      "manifest.json",
    ]);
    expect(new Set(dumps.map((c) => c.cwd))).toEqual(new Set(["/run/backup/work"]));
    const manifest = JSON.parse(files.get("/run/backup/work/manifest.json")!);
    expect(manifest).toMatchObject({ version: 1, ...RAW, createdAt: "2026-11-05T02:15:09.000Z" });
    expect(calls.map((c) => c.cmd).slice(-2)).toEqual(["tar", "gpg"]);
    expect(files.get(`/run/backup/${NAME}.sha256`)).toBe(`${"a".repeat(64)}  ${NAME}\n`);
  });

  it("gives the passphrase to gpg on stdin only, never as an argument or to any other command", async () => {
    const { deps, calls } = setup();
    await runDump(ARGV, deps);
    for (const c of calls) expect(c.args.join(" ")).not.toContain(PASS);
    expect(calls.filter((c) => c.input !== undefined).map((c) => [c.cmd, c.input])).toEqual([
      ["gpg", PASS],
    ]);
    const gpg = calls.find((c) => c.cmd === "gpg")!;
    expect(gpg.args.slice(-3)).toEqual([
      "--output",
      `/run/backup/${NAME}`,
      "/run/backup/backup.tar",
    ]);
  });

  it("removes the clear text afterwards", async () => {
    const { deps, removed } = setup();
    await runDump(ARGV, deps);
    expect(removed).toEqual(["/run/backup/work", "/run/backup/backup.tar"]);
  });

  it("prints names and counts, never the URL, its password or the passphrase", async () => {
    const { deps, lines } = setup();
    await runDump(ARGV, deps);
    const text = lines.join("\n");
    expect(text).toContain(NAME);
    expect(text).toContain("public.stock_movement");
    for (const secret of [DB, "fake-pass", "pooler.supabase.com", PASS]) {
      expect(text).not.toContain(secret);
    }
  });

  it("stops before any command when the passphrase is short", async () => {
    const { deps, calls, lines } = setup({ env: { BACKUP_ENCRYPTION_PASSPHRASE: "short" } });
    expect(await runDump(ARGV, deps)).toBe(1);
    expect(calls).toEqual([]);
    expect(lines.join("\n")).toContain("backup_passphrase_too_short");
  });

  it("stops before any command when the DB user belongs to another project", async () => {
    const { deps, calls, lines } = setup();
    expect(
      await runDump(["--out", "/run/backup", "--target", "production", "--ref", "xyz"], deps),
    ).toBe(1);
    expect(calls).toEqual([]);
    expect(lines.join("\n")).toContain("backup_db_user_mismatch");
  });

  it("fails on a missing variable or a bad argument without running anything", async () => {
    for (const env of [{ SUPABASE_DB_URL: undefined }, { SUPABASE_URL: "" }]) {
      const { deps, calls } = setup({ env });
      expect(await runDump(ARGV, deps)).toBe(1);
      expect(calls).toEqual([]);
    }
    const { deps, calls } = setup();
    expect(await runDump(["--out", "/x", "--target", "prod", "--ref", "abc"], deps)).toBe(1);
    expect(await runDump(["--bogus"], deps)).toBe(1);
    expect(calls).toEqual([]);
  });

  it("never logs row data from a failed psql or dump; keeps the exit status and SQLSTATE; psql runs terse", async () => {
    const stderr =
      'ERROR:  23505\nDETAIL:  Key (email)=(mario@example.test) already exists.\nCONTEXT:  COPY users, line 3, column email: "mario@example.test"\nDETAIL:  Failing row contains (1, mario@example.test, $2a$10$fakefakefakefakefakefakefakefakefakefakefakefake).';
    for (const failing of ["psql", "dump:data.sql", "gpg"]) {
      const { deps, calls, lines } = setup();
      const run = deps.run;
      deps.run = (cmd, args, opts) => {
        const tag = cmd.endsWith("supabase") ? `dump:${args[args.indexOf("-f") + 1]}` : cmd;
        return tag === failing ? { status: 3, stdout: "", stderr } : run(cmd, args, opts);
      };
      expect(await runDump(ARGV, deps)).toBe(1);
      const text = lines.join("\n");
      expect(text).not.toContain("mario@example.test");
      expect(text).not.toContain("$2a$10$");
      expect(text).not.toContain("Failing row");
      expect(text).toContain("(exit 3, SQLSTATE 23505)");
      const psql = calls.find((c) => c.cmd === "psql");
      if (psql) {
        expect(psql.args).toContain("VERBOSITY=sqlstate");
        expect(psql.args).toContain("SHOW_CONTEXT=never");
      }
    }
  });

  it("fails on a failed dump, redacts the URL from the error, and still removes the clear text", async () => {
    const { deps, calls, lines, removed } = setup({ failOn: "dump:data.sql" });
    expect(await runDump(ARGV, deps)).toBe(1);
    const text = lines.join("\n");
    expect(text).toContain("dump_failed:data");
    expect(text).not.toContain("fake-pass");
    expect(calls.some((c) => c.cmd === "gpg")).toBe(false);
    expect(removed).toContain("/run/backup/work");
  });

  it("fails when the manifest query returns something that is not a manifest", async () => {
    const { deps } = setup();
    const run = deps.run;
    deps.run = (cmd, args, opts) =>
      cmd === "psql"
        ? { status: 0, stdout: '{"tables":{"x":1}}', stderr: "" }
        : run(cmd, args, opts);
    expect(await runDump(ARGV, deps)).toBe(1);
  });

  describe("--local (the CI self-test against a local stack)", () => {
    const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
    const LOCAL_ARGV = ["--out", "/run/backup", "--target", "staging", "--local"];

    it("dumps a local database without a project ref or an API URL", async () => {
      const { deps, calls } = setup({ env: { SUPABASE_DB_URL: LOCAL, SUPABASE_URL: undefined } });
      expect(await runDump(LOCAL_ARGV, deps)).toBe(0);
      expect(calls.filter((c) => c.cmd.endsWith("supabase"))).toHaveLength(5);
      expect(calls.find((c) => c.cmd === "gpg")?.input).toBe(PASS);
    });

    it("refuses a database that is not local, before any command", async () => {
      const { deps, calls, lines } = setup();
      expect(await runDump(LOCAL_ARGV, deps)).toBe(1);
      expect(calls).toEqual([]);
      expect(lines.join("\n")).toContain("backup_source_not_local");
    });

    it("refuses --local together with --ref", async () => {
      const { deps, calls } = setup({ env: { SUPABASE_DB_URL: LOCAL } });
      expect(await runDump([...LOCAL_ARGV, "--ref", "abc"], deps)).toBe(1);
      expect(calls).toEqual([]);
    });

    it("keeps the passphrase rule", async () => {
      const { deps, calls } = setup({
        env: { SUPABASE_DB_URL: LOCAL, BACKUP_ENCRYPTION_PASSPHRASE: "short" },
      });
      expect(await runDump(LOCAL_ARGV, deps)).toBe(1);
      expect(calls).toEqual([]);
    });
  });
});
