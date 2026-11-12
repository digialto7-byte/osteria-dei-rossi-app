import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// P2-1 (TOTP second factor, docs/plans/2026-11-12-p2-1-totp.md section 5 "Shared lists changed on purpose", step A1 on): the 20261201*
// migrations are exactly the steps built so far, create only the listed tables, alter only `tenant`, replace only the listed functions,
// and never re-create one of the functions that must stay as they are. Each step adds its file and its functions here on purpose.
const MIGRATIONS = join(process.cwd(), "supabase/migrations");

// The files of this feature, in step order. Founder decisions of 2026-11-12 (Q-T2 = V2) add the retention migration 20261201100500.
const TOTP_MIGRATIONS = [
  "20261201100000_mfa_gate.sql",
  "20261201100100_mfa_self.sql",
  "20261201100200_mfa_admin.sql",
  "20261201100500_mfa_failure_retention.sql",
];

// Main's newest migration when the branch was cut: every file of this feature sorts after it (supabase db push refuses otherwise).
const AFTER_MAIN = "20261130100400";

// Q-T2 = V2: the wrong-code log is its own table in schema app (A3). audit_event only gets a wider action check (union rule, tests/config/check-constraint-union.test.ts).
const CREATED_TABLES = ["app.mfa_failure"];
const ALTERED_TABLES = ["public.tenant", "public.audit_event", "app.mfa_failure", "app.job_run"];

// Functions an earlier migration created and this feature replaces (create or replace), re-pinned on purpose by P2-1 A1.
const REPLACED_FUNCTIONS = [
  "app.tenant_id",
  "app.role",
  "app.app_user_id",
  // A4b: verbatim from 20261128100300 plus the stale and unscheduled rules of mfa-failure-retention.
  "app.job_health_checks",
];

const NEW_FUNCTIONS = [
  "app.jwt_aal",
  "app.mfa_has_verified_factor",
  "app.mfa_needs_aal2",
  "app.membership_ungated",
  "app.require_aal2",
  // A3
  "app.mfa_lock_failures",
  "app.mfa_lock_minutes",
  "app.mfa_max_factors",
  "app.mfa_gate_of",
  "public.mfa_gate",
  "public.mfa_status",
  "public.mfa_attempt_allowed",
  "public.mfa_record_failure",
  "public.mfa_enrol_check",
  "public.mfa_record_enrolled",
  "public.mfa_unenrol_check",
  "public.mfa_record_unenrolled",
  // A4 (no in-app reset: Q-T1 = V1)
  "app.mfa_reset_pending_minutes",
  "public.mfa_accounts",
  "public.set_mfa_enforcement",
  "public.mfa_reset_service_begin",
  "public.mfa_reset_service_failed",
  // A4b (Q-T2 = V2): the 30-day retention job
  "app.run_mfa_failure_retention",
];

// Plan "Unchanged on purpose": never re-created by a 20261201* file (pin_login_finish and payload_money_keys are replaced by later steps).
const PROTECTED_FUNCTIONS = [
  "app.custom_access_token_hook",
  "app.staff_session_open",
  "app.pin_sign_in_allowed",
  "public.pin_login_begin",
  "public.staff_session_active",
  "app.end_staff_sessions",
  "public.record_pin_change",
  "public.prepare_pin_change",
  "app.raise_alert",
  "app.payload_has_money_value",
  "app.demo_purge_tables",
];

/** The files of a directory that belong to this feature (timestamp 20261201*), sorted. */
function totpMigrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith("20261201") && f.endsWith(".sql"))
    .sort();
}

/** The SQL of a migration without its `--` comments, so a name mentioned in a comment is not a definition. */
function sqlWithoutComments(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** Names (schema-qualified, lower case) after each `create [or replace] function`, optionally only the `or replace` ones. */
function definedFunctions(sql: string, orReplace: boolean): string[] {
  const re = orReplace
    ? /create\s+or\s+replace\s+function\s+([a-z_]+\.[a-z_0-9]+)/gi
    : /create\s+function\s+([a-z_]+\.[a-z_0-9]+)/gi;
  return [...sqlWithoutComments(sql).matchAll(re)].map((m) => m[1]!.toLowerCase());
}

function allSql(): string {
  return totpMigrations(MIGRATIONS)
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

describe("P2-1 migrations", () => {
  it("are exactly the steps built so far", () => {
    expect(totpMigrations(MIGRATIONS)).toEqual(TOTP_MIGRATIONS);
  });

  it("sort after main's newest migration at the time of the branch", () => {
    for (const f of TOTP_MIGRATIONS) expect(f.localeCompare(AFTER_MAIN)).toBeGreaterThan(0);
  });

  it("self-test: the listing sees an extra feature file and ignores others", () => {
    const dir = mkdtempSync(join(tmpdir(), "p21-"));
    try {
      writeFileSync(join(dir, "20261201100000_mfa_gate.sql"), "");
      writeFileSync(join(dir, "20261201999999_extra.sql"), "");
      writeFileSync(join(dir, "20261130100400_weight_reads.sql"), "");
      expect(totpMigrations(dir)).toEqual([
        "20261201100000_mfa_gate.sql",
        "20261201999999_extra.sql",
      ]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("create only the listed tables", () => {
    const created = [
      ...sqlWithoutComments(allSql()).matchAll(
        /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_.]+)/gi,
      ),
    ].map((m) => m[1]!.toLowerCase());
    expect(created.filter((t) => !CREATED_TABLES.includes(t))).toEqual([]);
  });

  it("alter only the listed tables", () => {
    const altered = [...sqlWithoutComments(allSql()).matchAll(/alter\s+table\s+([a-z_.]+)/gi)].map(
      (m) => m[1]!.toLowerCase(),
    );
    expect(altered.length).toBeGreaterThan(0);
    expect(altered.filter((t) => !ALTERED_TABLES.includes(t))).toEqual([]);
  });

  it("replace only the listed functions and create only the listed new ones", () => {
    const sql = allSql();
    expect(definedFunctions(sql, true).filter((f) => !REPLACED_FUNCTIONS.includes(f))).toEqual([]);
    expect(definedFunctions(sql, false).filter((f) => !NEW_FUNCTIONS.includes(f))).toEqual([]);
    // Every listed function is actually defined (the lists do not drift ahead of the files).
    for (const f of REPLACED_FUNCTIONS) expect(definedFunctions(sql, true)).toContain(f);
  });

  it("never re-create a function that must stay as it is", () => {
    const sql = allSql();
    const touched = [...definedFunctions(sql, true), ...definedFunctions(sql, false)];
    expect(touched.filter((f) => PROTECTED_FUNCTIONS.includes(f))).toEqual([]);
  });

  it("drop only the two old check constraints they replace, and never with cascade", () => {
    const sql = sqlWithoutComments(allSql());
    const drops = [...sql.matchAll(/\bdrop\s+([^;]*);/gi)].map((m) => m[1]!.trim().toLowerCase());
    expect(
      drops.filter(
        (d) => d !== "constraint audit_event_action_check" && d !== "constraint job_run_job_check",
      ),
    ).toEqual([]);
    expect(sql).not.toMatch(/\bdrop\b[^;]*\bcascade\b/i);
  });

  it("self-test: the function scan ignores comments and sees a definition", () => {
    const sql =
      "-- create or replace function app.role()\ncreate or replace function app.role() returns void";
    expect(definedFunctions(sql, true)).toEqual(["app.role"]);
    expect(definedFunctions("-- create function app.x()\n", false)).toEqual([]);
  });
});
