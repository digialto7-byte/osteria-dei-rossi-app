import { describe, expect, it } from "vitest";
import {
  assertLocalApiUrl,
  assertLocalDbUrl,
  FILES_LIST_SQL,
  filesManifestName,
  filesPackName,
  isFilesManifestName,
  isFilesPackName,
  RESTORED_OBJECTS_SQL,
  stampOf,
  PSQL_SAFE_FLAGS,
  failureSummary,
  failureLocation,
  withoutParameterGrants,
  assertPassphrase,
  assertProjectRef,
  backupFileName,
  createLogger,
  dumpArgs,
  STORAGE_PLATFORM_TABLES,
  gpgDecryptArgs,
  gpgEncryptArgs,
  isBackupFileName,
  psqlRestoreArgs,
  redact,
  RESTORE_CHECK_SQL,
  restoreSql,
  REPLICA_SQL,
  CLEANUP_SQL,
  urlSecrets,
} from "../../../scripts/lib/backup/commands";

// Fake pooler URL (M25 step 10): the user is postgres.<ref>, as Supabase's session pooler requires.
const U =
  "postgresql://postgres.abc:fake-pass@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
const FILES = {
  roles: "roles.sql",
  schema: "schema.sql",
  historySchema: "history_schema.sql",
  replica: "replica.sql",
  data: "data.sql",
  historyData: "history_data.sql",
  cleanup: "cleanup.sql",
};

describe("dumpArgs", () => {
  it("dumps the roles with --role-only", () => {
    expect(dumpArgs("roles", U)).toEqual([
      "supabase",
      "db",
      "dump",
      "--db-url",
      U,
      "-f",
      "roles.sql",
      "--role-only",
    ]);
  });

  // CI run 42509760322: "check_query_failed:manifest (exit 1, SQLSTATE 42P01)". `supabase db dump` leaves out the
  // supabase_migrations schema, so a restored copy had no migration history (and a new project would not know what it has).
  // Supabase's own restore guide dumps it apart, schema and data.
  it("dumps the migration history's schema and data apart, as Supabase's restore guide does", () => {
    expect(dumpArgs("history_schema", U)).toEqual([
      "supabase",
      "db",
      "dump",
      "--db-url",
      U,
      "-f",
      "history_schema.sql",
      "--schema",
      "supabase_migrations",
    ]);
    expect(dumpArgs("history_data", U)).toEqual([
      "supabase",
      "db",
      "dump",
      "--db-url",
      U,
      "-f",
      "history_data.sql",
      "--schema",
      "supabase_migrations",
      "--data-only",
      "--use-copy",
    ]);
  });

  it("dumps the schema with neither --role-only nor --data-only", () => {
    const args = dumpArgs("schema", U);
    expect(args).toEqual(["supabase", "db", "dump", "--db-url", U, "-f", "schema.sql"]);
    expect(args).not.toContain("--role-only");
    expect(args).not.toContain("--data-only");
  });

  it("dumps the data as COPY statements", () => {
    const args = dumpArgs("data", U);
    expect(args).toEqual([
      "supabase",
      "db",
      "dump",
      "--db-url",
      U,
      "-f",
      "data.sql",
      "--data-only",
      "--use-copy",
      "-x",
      "storage.buckets_analytics",
      "-x",
      "storage.buckets_vectors",
      "-x",
      "storage.vector_indexes",
    ]);
  });

  // CI run 42389635679: "restore_failed (exit 3, SQLSTATE 42501) at data.sql:995 COPY "storage"."buckets_vectors"". Storage's
  // analytics and vector buckets are platform features this app does not use; only their admin role may write their tables. The
  // invoice files (storage.buckets, storage.objects) stay in the dump.
  it("leaves Storage's platform-only tables out of the data, never the buckets or objects", () => {
    const args = dumpArgs("data", U);
    const excluded = args.flatMap((a, i) => (args[i - 1] === "-x" ? [a] : []));
    expect(excluded).toEqual(STORAGE_PLATFORM_TABLES);
    expect(excluded).not.toContain("storage.buckets");
    expect(excluded).not.toContain("storage.objects");
    expect(excluded.every((t) => t.startsWith("storage."))).toBe(true);
  });
});

describe("redact and the logger", () => {
  it("replaces every occurrence of every secret", () => {
    expect(redact(`a ${U} b ${U}`, [U])).toBe("a *** b ***");
  });

  it("ignores empty secrets and replaces longer secrets first", () => {
    expect(redact("abcdef abc", ["", "abc", "abcdef"])).toBe("*** ***");
  });

  it("urlSecrets lists the URL and its password, raw and decoded", () => {
    expect(urlSecrets(U)).toEqual([U, "fake-pass"]);
    expect(urlSecrets("postgresql://u:p%40ss@h:5432/d")).toEqual([
      "postgresql://u:p%40ss@h:5432/d",
      "p%40ss",
      "p@ss",
    ]);
    expect(urlSecrets("not a url")).toEqual(["not a url"]);
  });

  it("the logger never lets the URL or its password through", () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line), urlSecrets(U));
    log(`dump failed for ${U}`);
    log("password fake-pass was refused");
    expect(lines.join("\n")).not.toContain("fake-pass");
    expect(lines.join("\n")).not.toContain("pooler.supabase.com");
    expect(lines).toHaveLength(2);
  });
});

describe("gpg arguments", () => {
  it("encrypts symmetrically with AES256 and reads the passphrase from stdin only", () => {
    const args = gpgEncryptArgs("in.tar", "out.tar.gpg");
    for (const a of [
      "--batch",
      "--pinentry-mode",
      "loopback",
      "--symmetric",
      "--cipher-algo",
      "AES256",
      "--passphrase-fd",
      "0",
    ]) {
      expect(args).toContain(a);
    }
    expect(args).not.toContain("--passphrase");
    expect(args.join(" ")).not.toMatch(/passphrase\b(?!-fd)/);
    expect(args.slice(-3)).toEqual(["--output", "out.tar.gpg", "in.tar"]);
  });

  it("decrypts in batch mode with the passphrase from stdin", () => {
    const args = gpgDecryptArgs("in.tar.gpg", "out.tar");
    for (const a of [
      "--batch",
      "--pinentry-mode",
      "loopback",
      "--passphrase-fd",
      "0",
      "--decrypt",
    ]) {
      expect(args).toContain(a);
    }
    expect(args.slice(-3)).toEqual(["--output", "out.tar", "in.tar.gpg"]);
  });
});

describe("assertPassphrase", () => {
  it("passes at 32 characters", () => {
    const p = "x".repeat(32);
    expect(assertPassphrase(p)).toBe(p);
  });

  it("fails at 31 characters, unset and empty, without echoing the value", () => {
    const short = "s3cret-".repeat(5).slice(0, 31);
    expect(short).toHaveLength(31);
    let message = "";
    try {
      assertPassphrase(short);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("backup_passphrase_too_short");
    expect(message).not.toContain("s3cret");
    expect(() => assertPassphrase(undefined)).toThrow("backup_passphrase_too_short");
    expect(() => assertPassphrase("")).toThrow("backup_passphrase_too_short");
  });
});

describe("restoreSql", () => {
  const args = restoreSql(FILES);
  const at = (needle: string) => args.findIndex((a) => a.includes(needle));

  it("is one transaction that stops on the first error", () => {
    expect(args).toContain("--single-transaction");
    expect(args.join(" ")).toContain("-v ON_ERROR_STOP=1");
  });

  it("runs roles, schema, history schema, replica mode, data, history data, then the clean-up, all from files (so a failure has a file and line)", () => {
    const order = [
      at("roles.sql"),
      args.indexOf("schema.sql"),
      at("history_schema.sql"),
      at("replica.sql"),
      args.indexOf("data.sql"),
      at("history_data.sql"),
      at("cleanup.sql"),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // CI run 42392230459: an inline -c statement failed with SQLSTATE 42501 and psql gave no location.
    expect(args).not.toContain("-c");
  });

  it("the replica and clean-up files hold one statement per line: replica mode; cron jobs, then the three Vault secrets", () => {
    expect(REPLICA_SQL.trim()).toBe("SET session_replication_role = replica;");
    const cleanup = CLEANUP_SQL.trim().split("\n");
    expect(cleanup).toHaveLength(2);
    // pg_cron gives the restoring role no DELETE on cron.job (CI 2026-11-08: 42501 at cleanup.sql:1); its own API removes the jobs.
    expect(cleanup[0]).toBe("SELECT cron.unschedule(jobid) FROM cron.job;");
    expect(cleanup[1]).toMatch(/^DELETE FROM vault\.secrets WHERE name IN \(/);
    for (const name of ["'app_base_url'", "'cron_secret'", "'vercel_protection_bypass'"]) {
      expect(cleanup[1]).toContain(name);
    }
  });

  it("failureLocation names a statement of the clean-up file", () => {
    const lines = (file: string) => (file === "cleanup.sql" ? CLEANUP_SQL.split("\n") : null);
    expect(failureLocation("psql:/run/files/cleanup.sql:2: ERROR:  42501", lines)).toBe(
      "cleanup.sql:2 DELETE FROM vault.secrets",
    );
  });

  // Review of d458c50: a bare SELECT alternative could take a word from a COPY data row (the scan reads up to 200 lines up).
  it("failureLocation reads SELECT only as the clean-up's cron.unschedule, never a data row's first word", () => {
    const lines = (file: string) =>
      file === "data.sql" ? ["COPY public.x (a) FROM stdin;", "SELECT secretword\tvalue"] : null;
    const at = failureLocation("psql:/run/files/data.sql:2: ERROR:  22P02", lines);
    expect(at ?? "").not.toContain("secretword");
  });

  it("failureLocation names the cron clean-up statement", () => {
    const lines = (file: string) => (file === "cleanup.sql" ? CLEANUP_SQL.split("\n") : null);
    expect(failureLocation("psql:/run/files/cleanup.sql:1: ERROR:  42501", lines)).toBe(
      "cleanup.sql:1 SELECT cron.unschedule",
    );
  });

  it("psqlRestoreArgs puts the URL first and refuses a non-local URL", () => {
    const local = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
    expect(psqlRestoreArgs(local, FILES)[0]).toBe(local);
    expect(() => psqlRestoreArgs(U, FILES)).toThrow("restore_target_not_local");
    expect(() => assertLocalDbUrl("postgresql://u:p@localhost:5432/d")).not.toThrow();
    expect(() => assertLocalDbUrl("postgresql://u:p@127.0.0.1.evil.test:5432/d")).toThrow(
      "restore_target_not_local",
    );
    expect(() => assertLocalDbUrl("nonsense")).toThrow("restore_target_not_local");
  });

  it("assertLocalDbUrl refuses a query string, a fragment and a non-postgres scheme (libpq would honour ?host=)", () => {
    const base = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
    expect(() => assertLocalDbUrl(base)).not.toThrow();
    for (const bad of [
      `${base}?host=db.x.supabase.co`,
      `${base}?hostaddr=1.2.3.4`,
      `${base}?`,
      `${base}#frag`,
      "postgresql://127.0.0.1@evil.test:5432/postgres",
      "postgresql://postgres@127.0.0.1,evil.test:5432/postgres",
      "https://127.0.0.1/postgres",
    ]) {
      expect(() => assertLocalDbUrl(bad), bad).toThrow("restore_target_not_local");
    }
  });

  it("every psql runs terse with no context, and the restore args carry the flags", () => {
    expect(PSQL_SAFE_FLAGS).toEqual(["-v", "VERBOSITY=sqlstate", "-v", "SHOW_CONTEXT=never"]);
    const args = psqlRestoreArgs("postgresql://postgres:postgres@127.0.0.1:54322/postgres", FILES);
    expect(args.join(" ")).toContain("VERBOSITY=sqlstate");
    expect(args.join(" ")).toContain("SHOW_CONTEXT=never");
  });

  it("failureSummary keeps the label, the exit status and a SQLSTATE, and nothing else", () => {
    const stderr = [
      "ERROR:  23502",
      "DETAIL:  Failing row contains (1, mario@example.test, $2a$10$fakefakefakefakefakefake).",
      'CONTEXT:  COPY users, line 3, column email: "mario@example.test"',
    ].join("\n");
    expect(failureSummary("restore_failed", { status: 3, stderr })).toBe(
      "restore_failed (exit 3, SQLSTATE 23502)",
    );
    expect(
      failureSummary("dump_failed:data", {
        status: 1,
        stderr: "pg_dump: error: x=(a@example.test)",
      }),
    ).toBe("dump_failed:data (exit 1)");
    expect(
      failureSummary("restore_failed", {
        status: 3,
        stderr: "ERROR:  duplicate key value Key (email)=(mario@example.test) already exists.",
      }),
    ).toBe("restore_failed (exit 3)");
    expect(failureSummary("x", { status: null, stderr: "" })).toBe("x (no exit status)");
  });

  it("failureSummary reads the SQLSTATE behind psql -f's file prefix, and never takes a code from another line", () => {
    const stderr = [
      "psql:/tmp/restore/data.sql:4812: ERROR:  23502",
      "DETAIL:  Failing row contains (1, mario@example.test, $2a$10$fakefakefakefakefakefake).",
    ].join("\n");
    expect(failureSummary("restore_failed", { status: 3, stderr })).toBe(
      "restore_failed (exit 3, SQLSTATE 23502)",
    );
    // The code must sit on the ERROR line itself: text on the next line is never read as a code.
    expect(failureSummary("restore_failed", { status: 3, stderr: "ERROR:\nMARIO" })).toBe(
      "restore_failed (exit 3)",
    );
    expect(
      failureSummary("restore_failed", { status: 3, stderr: "psql:/x.sql:1: ERROR:\n\nROSSI" }),
    ).toBe("restore_failed (exit 3)");
    // Anything after the code (a message, a value) still keeps the line out.
    expect(
      failureSummary("restore_failed", {
        status: 3,
        stderr: "psql:/tmp/x.sql:1: ERROR:  23505 (mario@example.test)",
      }),
    ).toBe("restore_failed (exit 3)");
  });

  it("the restore check reads the ledger checks of every tenant, cron jobs and the three Vault secrets", () => {
    expect(RESTORE_CHECK_SQL).toContain("app.ledger_checks_body(");
    expect(RESTORE_CHECK_SQL).toContain("cron.job");
    expect(RESTORE_CHECK_SQL).toContain("vault.secrets");
    expect(RESTORE_CHECK_SQL).toContain("'vercel_protection_bypass'");
    expect(RESTORE_CHECK_SQL).not.toContain("ledger_invariants_run");
  });
});

describe("assertProjectRef", () => {
  it("passes for the pooler user postgres.<ref> and the host <ref>.supabase.co", () => {
    expect(() => assertProjectRef(U, "https://abc.supabase.co", "abc")).not.toThrow();
  });

  it("throws for another ref", () => {
    expect(() => assertProjectRef(U, "https://abc.supabase.co", "xyz")).toThrow(
      "backup_db_user_mismatch",
    );
    expect(() =>
      assertProjectRef(U.replace("postgres.abc", "postgres.xyz"), "https://abc.supabase.co", "abc"),
    ).toThrow("backup_db_user_mismatch");
  });

  it("throws for a user without a ref", () => {
    expect(() =>
      assertProjectRef(U.replace("postgres.abc", "postgres"), "https://abc.supabase.co", "abc"),
    ).toThrow("backup_db_user_mismatch");
  });

  it("throws for a look-alike host, a non-https URL and credentials in the URL", () => {
    for (const bad of [
      "https://abc.supabase.co.evil.test",
      "https://evil.test/abc.supabase.co",
      "http://abc.supabase.co",
      "https://user:pw@abc.supabase.co",
      "nonsense",
    ]) {
      expect(() => assertProjectRef(U, bad, "abc"), bad).toThrow("backup_supabase_host_mismatch");
    }
  });

  it("throws for an empty or malformed ref and never echoes the DB URL", () => {
    for (const ref of ["", "A B", "abc.def"]) {
      expect(() => assertProjectRef(U, "https://abc.supabase.co", ref)).toThrow(
        "backup_project_ref_invalid",
      );
    }
    try {
      assertProjectRef(U, "https://abc.supabase.co", "xyz");
    } catch (error) {
      expect((error as Error).message).not.toContain("fake-pass");
    }
  });
});

describe("backup file names", () => {
  it("builds osteria-backup-<UTC stamp>-<target>.tar.gpg", () => {
    const name = backupFileName(new Date("2026-11-05T02:15:09Z"), "production");
    expect(name).toBe("osteria-backup-20261105T021509Z-production.tar.gpg");
    expect(isBackupFileName(name, "production")).toBe(true);
  });

  it("tells the targets and other files apart", () => {
    const staging = backupFileName(new Date("2026-11-05T02:15:09Z"), "staging");
    expect(isBackupFileName(staging, "production")).toBe(false);
    expect(isBackupFileName("other.txt", "production")).toBe(false);
    expect(isBackupFileName("osteria-backup-x-production.tar.gpg", "production")).toBe(false);
  });

  // A refused restore (CI run 42384566832: SQLSTATE 42501 and nothing else) must say which statement, without row data: the file
  // and line psql prints, and only the verb and object name of the statement on that line.
  it("failureLocation names the file, the line and the statement's verb and object, never row data", () => {
    const files: Record<string, string[]> = {
      "data.sql": [
        "SET session_replication_role = replica;",
        'COPY "auth"."users" ("id", "email") FROM stdin;',
        "1\tmario@example.test",
        "\\.",
      ],
      "schema.sql": [
        'ALTER TABLE ONLY "public"."tenant" OWNER TO "supabase_admin";',
        "CREATE OR REPLACE FUNCTION app.x()",
        "  RETURNS void LANGUAGE sql AS $$ select 1 $$;",
      ],
    };
    const lines = (file: string) => files[file] ?? null;
    expect(failureLocation("psql:/tmp/r/files/data.sql:2: ERROR:  42501", lines)).toBe(
      'data.sql:2 COPY "auth"."users"',
    );
    expect(failureLocation("psql:/tmp/r/files/schema.sql:1: ERROR:  42501", lines)).toBe(
      'schema.sql:1 ALTER TABLE ONLY "public"."tenant"',
    );
    // psql reports a multi-line statement at its last line: the start is found above it.
    expect(failureLocation("psql:/tmp/r/files/schema.sql:3: ERROR:  42501", lines)).toBe(
      "schema.sql:3 CREATE OR REPLACE FUNCTION app.x",
    );
    // A row line is never logged.
    expect(failureLocation("psql:/tmp/r/files/data.sql:3: ERROR:  22P02", lines)).toBe(
      'data.sql:3 COPY "auth"."users"',
    );
    // An unknown file, a -c command (no file prefix) or no location at all: file and line only, or nothing.
    expect(failureLocation("psql:/tmp/r/files/other.sql:9: ERROR:  42501", lines)).toBe(
      "other.sql:9",
    );
    expect(failureLocation("ERROR:  42501", lines)).toBeNull();
    expect(failureLocation("psql:/tmp/a@b.sql:9: ERROR:  42501", lines)).toBeNull();
  });

  // CI run 42387206657: "restore_failed (exit 3, SQLSTATE 42501) at roles.sql:13 GRANT SET". The role dump carries the platform's own
  // GRANT ... ON PARAMETER, which only its admin role may give; a fresh stack already has them.
  it("withoutParameterGrants drops only the GRANT/REVOKE ... ON PARAMETER lines and counts them", () => {
    const roles = [
      'CREATE ROLE "reporting";',
      'GRANT SET ON PARAMETER "session_replication_role" TO "postgres" GRANTED BY "supabase_admin";',
      'GRANT SET, ALTER SYSTEM ON PARAMETER "pgsodium.enable_event_trigger" TO "postgres";',
      "REVOKE ALTER SYSTEM ON PARAMETER log_statement FROM postgres;",
      'GRANT "authenticated" TO "reporting";',
    ].join("\n");
    const { sql, skipped } = withoutParameterGrants(roles);
    expect(skipped).toBe(3);
    expect(sql).toBe(
      ['CREATE ROLE "reporting";', 'GRANT "authenticated" TO "reporting";'].join("\n"),
    );
    expect(withoutParameterGrants("").skipped).toBe(0);
  });
});

describe("invoice-file backup names (ADR-034)", () => {
  const now = new Date("2026-11-09T02:15:07.123Z");

  it("builds pack and manifest names from the UTC stamp, the target and the split index", () => {
    expect(filesPackName(now, "production", 1)).toBe(
      "osteria-files-20261109T021507Z-production-01.tar.gpg",
    );
    expect(filesPackName(now, "staging", 99)).toBe(
      "osteria-files-20261109T021507Z-staging-99.tar.gpg",
    );
    expect(filesManifestName(now, "staging")).toBe(
      "osteria-files-manifest-20261109T021507Z-staging.json.gpg",
    );
  });

  it("round-trips target and stamp through the predicates and stampOf", () => {
    const pack = filesPackName(now, "production", 7);
    const manifest = filesManifestName(now, "production");
    expect(isFilesPackName(pack, "production")).toBe(true);
    expect(isFilesManifestName(manifest, "production")).toBe(true);
    expect(stampOf(pack)).toBe("20261109T021507Z");
    expect(stampOf(manifest)).toBe("20261109T021507Z");
    expect(stampOf(backupFileName(now, "staging"))).toBe("20261109T021507Z");
    expect(stampOf("notes.txt")).toBeNull();
  });

  it("refuses a split index outside 01-99", () => {
    for (const bad of [0, 100, -1, 1.5, Number.NaN]) {
      expect(() => filesPackName(now, "staging", bad)).toThrow("files_pack_index_invalid");
    }
  });

  it("keeps the three name families apart", () => {
    const db = backupFileName(now, "production");
    const pack = filesPackName(now, "production", 1);
    const manifest = filesManifestName(now, "production");
    expect(isBackupFileName(pack, "production")).toBe(false);
    expect(isBackupFileName(manifest, "production")).toBe(false);
    expect(isFilesPackName(db, "production")).toBe(false);
    expect(isFilesManifestName(db, "production")).toBe(false);
    expect(isFilesPackName(manifest, "production")).toBe(false);
    expect(isFilesManifestName(pack, "production")).toBe(false);
    // the other target
    expect(isFilesPackName(pack, "staging")).toBe(false);
    expect(isFilesManifestName(manifest, "staging")).toBe(false);
    // junk around a name
    expect(isFilesPackName(`x${pack}`, "production")).toBe(false);
    expect(isFilesPackName(pack.replace("-01.", "-00."), "production")).toBe(false);
    expect(isFilesManifestName(`${manifest}.bak`, "production")).toBe(false);
  });

  it("the two SQL texts read storage.objects of the invoices bucket and write nothing", () => {
    for (const sql of [FILES_LIST_SQL, RESTORED_OBJECTS_SQL]) {
      expect(sql).toContain("storage.objects");
      expect(sql).toContain("bucket_id = 'invoices'");
      expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant|copy)\b/i);
    }
    expect(FILES_LIST_SQL).toContain("'updatedAt', updated_at");
    expect(RESTORED_OBJECTS_SQL).not.toContain("updated_at");
  });

  it("assertLocalApiUrl accepts a local http(s) URL only", () => {
    expect(() => assertLocalApiUrl("http://127.0.0.1:54321")).not.toThrow();
    expect(() => assertLocalApiUrl("https://localhost:54321")).not.toThrow();
    for (const bad of [
      "https://abc.supabase.co",
      "http://127.0.0.1:54321?host=evil.example",
      "http://127.0.0.1:54321#x",
      "ftp://127.0.0.1:54321",
      "http://127.0.0.1.evil.example",
      "not a url",
    ]) {
      expect(() => assertLocalApiUrl(bad), bad).toThrow("files_source_not_local");
    }
  });
});
