import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Reservations plan step A1 (docs/plans/2026-11-08-reservations.md §3.2, §5; ADR-032), extended by each later PR1 step: the migrations of PR1 (20261124*)
// replace only the functions listed here, create exactly the nine public tables (and the one app table) of §3.2 and the public functions listed, and never
// touch the pinned objects, the cron jobs, the job check or the existing tables' columns. pgTAP 290 to 296b prove the behaviour; this is the check on the SQL text.
// PR2 (20261128*, plan §5 B1 on) has its own block at the end: its migrations are named on purpose, sort after main's newest (20261127100100), and are checked the same way.
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

/** The migrations of PR1 present so far, in order (a step adds its file here on purpose). */
const FILES = [
  "20261124100000_reservation_core.sql",
  "20261124100100_demo_purge_tables_resv.sql",
  "20261124100200_reservation_settings.sql",
  "20261124100300_reservation_request_core.sql",
  "20261124100400_reservation_suggest.sql",
  "20261124100500_reservation_staff.sql",
  "20261124100550_reservation_staff_create.sql",
  "20261124100600_reservation_reads.sql",
  "20261124100650_reservation_joined_tables.sql",
];
/** `create or replace` allowed on purpose. */
const REPLACED = ["app.demo_purge_tables", "public.open_table", "public.tables_list"];
const TABLES = [
  "dining_table_booking",
  "reservation",
  "reservation_contact",
  "reservation_email",
  "reservation_event",
  "reservation_settings",
  "reservation_table",
  "reservation_throttle",
  "table_group",
  "table_group_member",
];
const PUBLIC_FUNCTIONS = [
  "reservation_settings",
  "set_reservation_settings",
  "table_booking",
  "set_table_booking",
  "create_table_group",
  "deactivate_table_group",
  "accept_reservation",
  "decline_reservation",
  "move_reservation",
  "assign_reservation_tables",
  "mark_reservation",
  "seat_reservation",
  "erase_reservation_contact",
  "create_staff_reservation",
  "reservations_day",
  "reservation_detail",
  "reservations_pending_count",
  "split_reservation_tables",
  // replaced on purpose in the joined-tables migration (A7b)
  "open_table",
  "tables_list",
];

/** Pinned objects: PR1 never re-creates them (the A7b exception is listed in REPLACED once that step lands). */
const PROTECTED = [
  "public.close_table",
  "app.close_session_at",
  "app.table_session_guard",
  "app.session_services",
  "app.session_service_one",
  "app.kpi_sales_lines",
  "app.kpi_session_rows",
  "app.kpi_day_row",
  "app.kpi_range_agg",
  "app.kpi_block",
  "app.kpi_report_json",
  "app.kpi_items_json",
  "app.rollup_daily_kpi",
  "app.app_vs_register_json",
  "public.enter_day_close",
  "app.tenant_has_operational_data",
  "app.business_date",
  "app.business_day_cutoff",
  "app.apply_op_dispatch",
  "public.open_table",
  "public.tables_list",
];

/** SQL without `-- comments`, so a name in a comment is not a statement. */
export function code(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

export function createOrReplaceNames(sql: string): string[] {
  return [
    ...code(sql).matchAll(/create\s+or\s+replace\s+function\s+([a-z_]+\.[a-z_0-9]+)\s*\(/gi),
  ].map((m) => m[1]!.toLowerCase());
}

export function createdTables(sql: string): string[] {
  return [...code(sql).matchAll(/create\s+table\s+(?:(?:public|app)\.)?([a-z_0-9]+)/gi)].map((m) =>
    m[1]!.toLowerCase(),
  );
}

export function createdPublicFunctions(sql: string): string[] {
  return [
    ...code(sql).matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z_0-9]+)\s*\(/gi),
  ].map((m) => m[1]!.toLowerCase());
}

/** The newest migration on main when PR2 was branched: every PR2 migration must sort after it (supabase db push refuses an unapplied migration that sorts before an applied one). */
const MAIN_NEWEST = "20261127100100_drop_unused_effective_indexes.sql";
/** The migrations of PR2 present so far, in order (a step adds its file here on purpose). */
const PR2_FILES = [
  "20261128100000_reservation_public.sql",
  "20261128100100_reservation_cancel.sql",
  "20261128100200_reservation_mail.sql",
];
/** `create or replace` allowed in PR2: none. */
const PR2_REPLACED: string[] = [];
/** The public functions PR2 creates so far (the five anon wrappers of B1 and B2, and the two service_role mail functions of B3). */
const PR2_ANON_FUNCTIONS = [
  "reservation_page",
  "reservation_slots",
  "request_reservation",
  "reservation_cancel_view",
  "cancel_reservation",
];
/** Executable by service_role only (the mail cron route). */
const PR2_SERVICE_FUNCTIONS = ["reservation_mail_claim", "reservation_mail_finish"];
const PR2_PUBLIC_FUNCTIONS = [...PR2_ANON_FUNCTIONS, ...PR2_SERVICE_FUNCTIONS];

function pr2Migrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.startsWith("20261128") && f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(new URL(file, MIGRATIONS), "utf8") }));
}

function resvMigrations() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.startsWith("20261124") && f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(new URL(file, MIGRATIONS), "utf8") }));
}

describe("the regexes see what they should (self-test)", () => {
  const sample = `
    -- create or replace function app.in_a_comment()
    create or replace function app.demo_purge_tables() returns text[] as $$ $$;
    create function public.reservations_day() returns jsonb as $$ $$;
    create table public.reservation (x int);
    create table app.reservation_throttle (x int);
    create table table_group (x int);
  `;
  it("reads replaced functions, tables and public functions, and skips comments", () => {
    expect(createOrReplaceNames(sample)).toEqual(["app.demo_purge_tables"]);
    expect(createdTables(sample)).toEqual(["reservation", "reservation_throttle", "table_group"]);
    expect(createdPublicFunctions(sample)).toEqual(["reservations_day"]);
  });
});

describe("PR1 migrations (20261124*)", () => {
  const files = resvMigrations();
  const all = files.map((f) => f.sql).join("\n");

  it("are exactly the files of the steps built so far, all named 20261124*", () => {
    expect(files.map((f) => f.file)).toEqual(FILES);
  });

  it("replace only the listed functions", () => {
    const found = files.flatMap((f) => createOrReplaceNames(f.sql));
    expect(found.sort()).toEqual([...REPLACED].sort());
  });

  it("replace public.open_table and public.tables_list only in the joined-tables migration (A7b)", () => {
    for (const name of ["public.open_table", "public.tables_list"]) {
      expect(
        files.filter((f) => createOrReplaceNames(f.sql).includes(name)).map((f) => f.file),
        name,
      ).toEqual(["20261124100650_reservation_joined_tables.sql"]);
    }
  });

  it("create exactly the nine public tables and the throttle table", () => {
    const found = files.flatMap((f) => createdTables(f.sql));
    expect(found.sort()).toEqual([...TABLES]);
  });

  it("create exactly the listed public functions", () => {
    const found = files.flatMap((f) => createdPublicFunctions(f.sql));
    expect(found.sort()).toEqual([...PUBLIC_FUNCTIONS].sort());
  });

  for (const name of PROTECTED) {
    if (REPLACED.includes(name)) continue;
    it(`never re-creates ${name}`, () => {
      const pattern = new RegExp(
        `create\\s+(or\\s+replace\\s+)?function\\s+${name.replace(".", "\\.")}\\s*\\(`,
        "i",
      );
      expect(files.filter((f) => pattern.test(code(f.sql))).map((f) => f.file)).toEqual([]);
    });
  }

  it("alters no existing table and updates no row of an existing table", () => {
    const c = code(all);
    expect(c).not.toMatch(/alter\s+table\s+public\.table_session/i);
    expect(c).not.toMatch(/alter\s+table\s+public\.dining_table\b/i);
    expect(c).not.toMatch(/alter\s+table\s+public\.day_close/i);
    expect(c).not.toMatch(/alter\s+table\s+public\.tenant/i);
    expect(c).not.toMatch(/\bupdate\s+public\.(table_session|dining_table|tenant)\b/i);
  });

  it("touches the audit checks only in the settings migration, and the job check never", () => {
    const touching = files
      .filter((f) => /audit_event_(entity_type|action)_check/i.test(code(f.sql)))
      .map((f) => f.file);
    expect(touching).toEqual(["20261124100200_reservation_settings.sql"]);
  });

  it("does not touch the job check, the alert registry or the cron jobs", () => {
    const c = code(all);
    expect(c).not.toMatch(/job_run_job_check/i);
    expect(c).not.toMatch(/insert\s+into\s+app\.alert_kind/i);
    expect(c).not.toMatch(/cron\.schedule/i);
  });

  it("writes no money: no column or key names cost, price, margin, total or eur", () => {
    const c = code(all).toLowerCase();
    expect(c).not.toMatch(
      /\b[a-z_]*(cost|price|margin|total|eur)[a-z_]*\s+(numeric|integer|smallint|text|jsonb|boolean)\b/,
    );
    expect(c).not.toMatch(/€/);
  });

  it("gives every function an empty search_path, and every function but the constant purge list a definer", () => {
    for (const { file, sql } of files) {
      const c = code(sql);
      const functions = (c.match(/create\s+(or\s+replace\s+)?function\s/gi) ?? []).length;
      // app.demo_purge_tables is a constant list (immutable sql, not a definer) in M22, M23, M25c and here.
      const constants = (c.match(/function\s+app\.demo_purge_tables\s*\(/gi) ?? []).length;
      expect(c.match(/set\s+search_path\s*=\s*''/gi) ?? [], file).toHaveLength(functions);
      expect(c.match(/security\s+definer/gi) ?? [], file).toHaveLength(functions - constants);
    }
  });
});

describe("PR2 migrations (20261128*)", () => {
  const files = pr2Migrations();
  const all = files.map((f) => f.sql).join("\n");

  it("are exactly the files of the steps built so far", () => {
    expect(files.map((f) => f.file)).toEqual(PR2_FILES);
  });

  it("all sort after the newest migration on main", () => {
    const names = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    expect(names.filter((f) => f.startsWith("20261128")).every((f) => f > MAIN_NEWEST)).toBe(true);
    expect(files.every((f) => f.file > MAIN_NEWEST)).toBe(true);
  });

  it("replace only the listed functions", () => {
    expect(files.flatMap((f) => createOrReplaceNames(f.sql)).sort()).toEqual(
      [...PR2_REPLACED].sort(),
    );
  });

  it("create no table", () => {
    expect(files.flatMap((f) => createdTables(f.sql))).toEqual([]);
  });

  it("create exactly the listed public functions", () => {
    expect(files.flatMap((f) => createdPublicFunctions(f.sql)).sort()).toEqual(
      [...PR2_PUBLIC_FUNCTIONS].sort(),
    );
  });

  for (const name of PROTECTED) {
    it(`never re-creates ${name}`, () => {
      const pattern = new RegExp(
        `create\\s+(or\\s+replace\\s+)?function\\s+${name.replace(".", "\\.")}\\s*\\(`,
        "i",
      );
      expect(files.filter((f) => pattern.test(code(f.sql))).map((f) => f.file)).toEqual([]);
    });
  }

  it("alters no existing table", () => {
    const c = code(all);
    expect(c).not.toMatch(
      /alter\s+table\s+public\.(table_session|dining_table|day_close|tenant)\b/i,
    );
    expect(c).not.toMatch(/\bupdate\s+public\.(table_session|dining_table|tenant)\b/i);
  });

  it("alters only the released check of reservation_table (cancel) and the job check of app.job_run (mail)", () => {
    const altering = files
      .filter((f) => /alter\s+table\s/i.test(code(f.sql)))
      .map((f) => {
        const targets = [...code(f.sql).matchAll(/alter\s+table\s+([a-z_.]+)/gi)];
        return [f.file, targets.map((m) => m[1])];
      });
    expect(altering).toEqual([
      [
        "20261128100100_reservation_cancel.sql",
        ["public.reservation_table", "public.reservation_table"],
      ],
      ["20261128100200_reservation_mail.sql", ["app.job_run", "app.job_run"]],
    ]);
  });

  it("touches the job check only in the mail migration, and never the audit checks or the alert registry", () => {
    const touching = files.filter((f) => /job_run_job_check/i.test(code(f.sql))).map((f) => f.file);
    expect(touching).toEqual(["20261128100200_reservation_mail.sql"]);
    const c = code(all);
    expect(c).not.toMatch(/audit_event_(entity_type|action)_check/i);
    expect(c).not.toMatch(/insert\s+into\s+app\.alert_kind/i);
  });

  it("schedules exactly the cron jobs of PR2, each in its own migration", () => {
    const jobs = files.flatMap((f) =>
      [...code(f.sql).matchAll(/cron\.schedule\(\s*'([a-z-]+)'/gi)].map((m) => [f.file, m[1]]),
    );
    expect(jobs).toEqual([["20261128100200_reservation_mail.sql", "reservation-mail"]]);
  });

  it("grants the anon wrappers to anon and nothing else to anon", () => {
    const grants = [
      ...code(all).matchAll(/grant\s+execute\s+on\s+function\s+([\s\S]*?)\s+to\s+([a-z_, ]+);/gi),
    ].filter((m) => /\banon\b/i.test(m[2]!));
    const names = grants.flatMap((m) =>
      [...m[1]!.matchAll(/public\.([a-z_0-9]+)\s*\(/gi)].map((x) => x[1]!.toLowerCase()),
    );
    expect(names.sort()).toEqual([...PR2_ANON_FUNCTIONS].sort());
    // an anon grant is anon alone
    for (const m of grants) expect(m[2]!.trim().toLowerCase()).toBe("anon");
  });

  it("grants the mail functions to service_role and nothing else to service_role", () => {
    const grants = [
      ...code(all).matchAll(/grant\s+execute\s+on\s+function\s+([\s\S]*?)\s+to\s+([a-z_, ]+);/gi),
    ].filter((m) => /\bservice_role\b/i.test(m[2]!));
    const names = grants.flatMap((m) =>
      [...m[1]!.matchAll(/public\.([a-z_0-9]+)\s*\(/gi)].map((x) => x[1]!.toLowerCase()),
    );
    expect(names.sort()).toEqual([...PR2_SERVICE_FUNCTIONS].sort());
    for (const m of grants) expect(m[2]!.trim().toLowerCase()).toBe("service_role");
  });

  it("writes no money: no column or key names cost, price, margin, total or eur", () => {
    const c = code(all).toLowerCase();
    expect(c).not.toMatch(
      /\b[a-z_]*(cost|price|margin|total|eur)[a-z_]*\s+(numeric|integer|smallint|text|jsonb|boolean)\b/,
    );
    expect(c).not.toMatch(/€/);
  });

  it("gives every function an empty search_path and a definer", () => {
    for (const { file, sql } of files) {
      const c = code(sql);
      const functions = (c.match(/create\s+(or\s+replace\s+)?function\s/gi) ?? []).length;
      expect(c.match(/set\s+search_path\s*=\s*''/gi) ?? [], file).toHaveLength(functions);
      expect(c.match(/security\s+definer/gi) ?? [], file).toHaveLength(functions);
    }
  });
});
