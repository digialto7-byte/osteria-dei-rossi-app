// Backup commands (M25 step 10, plan §3.1.5): the argument lists, guards and SQL the backup scripts run. Pure functions, so
// every rule is unit-tested; the scripts in scripts/backup/ only run them. Nothing here reads the environment, and no
// function puts a secret into an error message.

export type DumpFile = "roles" | "schema" | "data";
export type BackupTarget = "staging" | "production";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const REF = /^[a-z0-9]+$/;
export const MIN_PASSPHRASE_LENGTH = 32;

/** The `supabase db dump` call for one file, run as `npx <args>`. The URL is a CLI argument: never log it unredacted. */
export function dumpArgs(file: DumpFile, dbUrl: string): string[] {
  const base = ["supabase", "db", "dump", "--db-url", dbUrl, "-f", `${file}.sql`];
  if (file === "roles") return [...base, "--role-only"];
  if (file === "data") return [...base, "--data-only", "--use-copy"];
  return base;
}

/** Every string of a connection URL that must not reach a log: the URL, and its password raw and decoded. */
export function urlSecrets(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [url];
  }
  const out = [url];
  if (parsed.password) {
    out.push(parsed.password);
    let decoded = parsed.password;
    try {
      decoded = decodeURIComponent(parsed.password);
    } catch {
      // keep the raw form only
    }
    if (decoded !== parsed.password) out.push(decoded);
  }
  return out;
}

/** Replaces every occurrence of every secret with ***, longest secret first. Empty secrets are ignored. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of [...secrets].filter((s) => s !== "").sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join("***");
  }
  return out;
}

/** A logger that redacts the secrets from every line. */
export function createLogger(
  write: (line: string) => void,
  secrets: readonly string[],
): (line: string) => void {
  return (line) => write(redact(line, secrets));
}

/** The passphrase is read from stdin (`--passphrase-fd 0`), never from an argument. */
export function gpgEncryptArgs(input: string, output: string): string[] {
  return [
    "--batch",
    "--pinentry-mode",
    "loopback",
    "--symmetric",
    "--cipher-algo",
    "AES256",
    "--passphrase-fd",
    "0",
    "--output",
    output,
    input,
  ];
}

export function gpgDecryptArgs(input: string, output: string): string[] {
  return [
    "--batch",
    "--pinentry-mode",
    "loopback",
    "--passphrase-fd",
    "0",
    "--decrypt",
    "--output",
    output,
    input,
  ];
}

/** At least 32 characters. The error never carries the value. */
export function assertPassphrase(passphrase: string | undefined): string {
  if (passphrase === undefined || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error("backup_passphrase_too_short");
  }
  return passphrase;
}

/**
 * The restore may only write into a local stack. Only the host decides where psql connects, so a URL with a query string
 * (`?host=`, `?hostaddr=`, any libpq parameter) or a fragment is refused, as is any scheme but postgres.
 */
export function assertLocalDbUrl(dbUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(dbUrl);
  } catch {
    throw new Error("restore_target_not_local");
  }
  const plain = parsed.protocol === "postgresql:" || parsed.protocol === "postgres:";
  const extras =
    parsed.search !== "" || parsed.hash !== "" || dbUrl.includes("?") || dbUrl.includes("#");
  if (!plain || extras || !LOCAL_HOSTS.has(parsed.hostname))
    throw new Error("restore_target_not_local");
}

/**
 * Every psql these scripts start: only the SQLSTATE in an error (no message, no DETAIL with row values) and no CONTEXT
 * (which quotes COPY lines). Logs hold names and counts only.
 */
export const PSQL_SAFE_FLAGS = ["-v", "VERBOSITY=sqlstate", "-v", "SHOW_CONTEXT=never"];

/**
 * The one line a failed command may log: the label, the exit status and, for a psql error printed as exactly
 * `ERROR:  <SQLSTATE>` (behind psql -f's `psql:<file>:<line>: ` prefix or not), that code. The rest of stderr can hold
 * row values and is dropped.
 */
export function failureSummary(
  label: string,
  result: { status: number | null; stderr: string },
): string {
  const exit = result.status === null ? "no exit status" : `exit ${result.status}`;
  const code = /^(?:psql:[^:\n]*:\d+: )?ERROR:\s+([0-9A-Z]{5})\s*$/m.exec(result.stderr)?.[1];
  return `${label} (${exit}${code ? `, SQLSTATE ${code}` : ""})`;
}

/**
 * The psql arguments (after the URL) of a restore: one transaction that stops at the first error. Roles, schema, then
 * triggers off for the data load (`session_replication_role = replica`), then the production-only schedules and Vault
 * secrets are removed in the same transaction, so a restored copy can never call the live app (plan T11).
 */
export function restoreSql(files: { roles: string; schema: string; data: string }): string[] {
  return [
    "--single-transaction",
    "-v",
    "ON_ERROR_STOP=1",
    ...PSQL_SAFE_FLAGS,
    "-f",
    files.roles,
    "-f",
    files.schema,
    "-c",
    "set session_replication_role = replica",
    "-f",
    files.data,
    "-c",
    "delete from cron.job",
    "-c",
    "delete from vault.secrets where name in ('app_base_url', 'cron_secret', 'vercel_protection_bypass')",
  ];
}

/** The full psql argument list: the (local) URL first. */
export function psqlRestoreArgs(
  dbUrl: string,
  files: { roles: string; schema: string; data: string },
): string[] {
  assertLocalDbUrl(dbUrl);
  return [dbUrl, ...restoreSql(files)];
}

/**
 * Read-only restore check, one JSON row: the ledger findings of every tenant (`app.ledger_checks_body`, not the runner,
 * which writes and judges job health), and what must be empty after a restore. Names and counts only.
 */
export const RESTORE_CHECK_SQL = `select json_build_object(
  'ledger', (select coalesce(json_agg(json_build_object('check', b.check_key, 'rows', b.rows_count)), '[]'::json)
               from public.tenant t cross join lateral app.ledger_checks_body(t.id, now()) b),
  'cronJobs', (select count(*) from cron.job),
  'vaultSecrets', (select count(*) from vault.secrets where name in ('app_base_url', 'cron_secret', 'vercel_protection_bypass'))
)`;

/** The project-ref guard: DB user `postgres.<ref>` (session pooler) and API host `<ref>.supabase.co`. */
export function assertProjectRef(dbUrl: string, supabaseUrl: string, ref: string): void {
  if (!REF.test(ref)) throw new Error("backup_project_ref_invalid");
  let user = "";
  try {
    user = decodeURIComponent(new URL(dbUrl).username);
  } catch {
    // an unparsable URL has no user: refused below
  }
  if (user !== `postgres.${ref}`) throw new Error("backup_db_user_mismatch");
  let api: URL | null = null;
  try {
    api = new URL(supabaseUrl);
  } catch {
    // refused below
  }
  if (
    api === null ||
    api.protocol !== "https:" ||
    api.hostname !== `${ref}.supabase.co` ||
    api.username !== "" ||
    api.password !== "" ||
    api.port !== ""
  ) {
    throw new Error("backup_supabase_host_mismatch");
  }
}

const NAME = /^osteria-backup-(\d{8}T\d{6}Z)-(staging|production)\.tar\.gpg$/;

/** `osteria-backup-<UTC stamp>-<target>.tar.gpg` */
export function backupFileName(now: Date, target: BackupTarget): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
  return `osteria-backup-${stamp}-${target}.tar.gpg`;
}

/** True for a backup file of this target. Other files in the folder are never touched. */
export function isBackupFileName(name: string, target: BackupTarget): boolean {
  return NAME.exec(name)?.[2] === target;
}
