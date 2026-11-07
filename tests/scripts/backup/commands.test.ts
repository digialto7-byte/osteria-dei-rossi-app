import { describe, expect, it } from "vitest";
import {
  assertLocalDbUrl,
  PSQL_SAFE_FLAGS,
  failureSummary,
  failureLocation,
  withoutParameterGrants,
  assertPassphrase,
  assertProjectRef,
  backupFileName,
  createLogger,
  dumpArgs,
  gpgDecryptArgs,
  gpgEncryptArgs,
  isBackupFileName,
  psqlRestoreArgs,
  redact,
  RESTORE_CHECK_SQL,
  restoreSql,
  urlSecrets,
} from "../../../scripts/lib/backup/commands";

// Fake pooler URL (M25 step 10): the user is postgres.<ref>, as Supabase's session pooler requires.
const U =
  "postgresql://postgres.abc:fake-pass@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
const FILES = { roles: "roles.sql", schema: "schema.sql", data: "data.sql" };

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
    ]);
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

  it("runs roles, schema, replica mode, data, cron removal, then Vault clean-up", () => {
    const order = [
      at("roles.sql"),
      at("schema.sql"),
      at("set session_replication_role = replica"),
      at("data.sql"),
      at("delete from cron.job"),
      at("vault.secrets"),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(args[at("vault.secrets")]).toContain("'app_base_url'");
    expect(args[at("vault.secrets")]).toContain("'cron_secret'");
    expect(args[at("vault.secrets")]).toContain("'vercel_protection_bypass'");
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
