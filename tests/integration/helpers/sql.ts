import { execFileSync } from "node:child_process";

// Direct SQL against the LOCAL stack's database, for what the API cannot do or must not be trusted for:
// moving a clock-like column back, and scanning every table for secrets. Test code only. It runs `psql`
// with an argument list (no shell) and refuses any host that is not this machine.

export const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

type Run = (file: string, args: string[], options: { encoding: "utf8" }) => string;

export function assertLocalDbUrl(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("The test database URL is not a URL: only the local stack is allowed");
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error("Refusing to run SQL: the test database must be the local stack");
  }
}

export function psqlArgs(url: string, statement: string): string[] {
  return ["-X", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-c", statement, url];
}

const defaultRun: Run = (file, args, options) => execFileSync(file, args, options);

/** Runs one statement (or several, separated by `;`) as the database owner; returns trimmed output. */
export function runSql(
  statement: string,
  run: Run = defaultRun,
  url: string = process.env.STACK_DB_URL ?? LOCAL_DB_URL,
): string {
  assertLocalDbUrl(url);
  return run("psql", psqlArgs(url, statement), { encoding: "utf8" }).trim();
}

/**
 * Like runSql, with the guard triggers off for this one call (session_replication_role = replica). The
 * app's guards make `expires_at` and `ends_at` immutable on purpose; a test that needs time to have
 * passed has to step around them, and only on the local stack.
 */
export function runSqlWithoutTriggers(statement: string, run: Run = defaultRun): string {
  return runSql(`set session_replication_role = replica; ${statement}`, run);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A uuid as an SQL literal; anything else throws, so a value can never inject SQL. */
export function quoteUuid(value: string): string {
  if (!UUID.test(value)) throw new Error("Not a uuid");
  return `'${value}'`;
}

/** Every base table of the schemas `public` and `app`. */
export function appTables(): string[] {
  return runSql(
    `select table_schema || '.' || table_name from information_schema.tables
      where table_schema in ('public', 'app') and table_type = 'BASE TABLE' order by 1`,
  )
    .split("\n")
    .filter(Boolean);
}

/** Every row of a table as JSON text, one row per line. `table` must come from appTables(). */
export function tableText(table: string): string {
  if (!/^(public|app)\.[a-z_]+$/.test(table)) throw new Error("Not an app table name");
  return runSql(`select coalesce(string_agg(to_jsonb(t)::text, E'\\n'), '') from ${table} t`);
}
