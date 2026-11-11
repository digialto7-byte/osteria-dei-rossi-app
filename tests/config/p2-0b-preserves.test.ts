import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// P2-0b (sell by weight, docs/plans/2026-11-11-p2-0b-sell-by-weight.md §5 "Shared lists changed on purpose", step A1 on): the 20261130*
// migrations are exactly the steps built so far, create no table, alter only the four listed tables, replace only the listed functions
// and never re-create one of the functions that must stay as they are. Each step adds its file and its functions here on purpose.
const MIGRATIONS = join(process.cwd(), "supabase/migrations");

// The files of this feature, in step order (A1 on). P2-0b PR 1 adds one per step A1-A5.
export const WEIGHT_MIGRATIONS = [
  "20261130100000_weight_core.sql",
  "20261130100100_weight_menu.sql",
];

// P2-0 PR A adds 20261129100000 first (on another branch): every file of this feature sorts after it.
const AFTER_P2_0 = "20261129100000";

const ALTERED_TABLES = [
  "public.menu_item",
  "public.menu_item_price",
  "public.sale_settings",
  "public.order_line",
];

// Functions an earlier migration created and this feature replaces (create or replace), by step.
export const REPLACED_FUNCTIONS = [
  "app.order_line_guard",
  "app.menu_items_json",
  "public.create_menu_item",
  "public.update_menu_item",
  "public.menu_list",
  "app.plate_cost_rows",
  "public.plate_breakdown",
];

// public.plate_costs gains output columns, which create or replace cannot do: it is dropped (never with cascade) and created again
// with the same arguments, security attributes and grants (pgTAP 321 pins them).
export const DROPPED_AND_RECREATED = ["public.plate_costs"];

// Functions this feature creates in schema app (A1 on) and in public (A2: weight_settings and set_weight_settings only).
export const NEW_APP_FUNCTIONS = [
  "app.weight_line_price",
  "app.order_line_portions",
  "app.weight_min_g",
  "app.weight_step_g",
  "app.default_weight_max_g",
  "app.weight_max_setting_bounds",
  "app.weight_max_g",
  "app.order_line_weight_price",
  "app.menu_item_sale_terms_at",
];
export const NEW_PUBLIC_FUNCTIONS = ["public.weight_settings", "public.set_weight_settings"];

// The functions that must stay as they are (plan §5 shared lists, "Unchanged on purpose"): never re-created by a 20261130* file.
export const PROTECTED_FUNCTIONS = [
  "public.void_line",
  "public.remove_order_line",
  "public.order_view",
  "public.open_table",
  "public.close_table",
  "app.close_session_at",
  "app.app_vs_register_json",
  "public.enter_day_close",
  "app.split_cents",
  "app.bill_split_items",
  "app.rollup_daily_kpi",
  "app.kpi_day_row",
  "app.kpi_session_rows",
  "app.plates_sold",
  "app.menu_item_price_at",
  "app.menu_item_availability",
  "app.apply_op_dispatch",
  "public.apply_op",
  "app.deplete_line_batches",
  "app.post_plate_raw_outflow",
  "app.lock_fire_batches",
  "public.set_sale_settings",
  "public.sale_settings_read",
  "app.coperto_settings",
  "public.plate_margins_pct",
  "public.recipe_cost_at",
];

/** The files of a directory that belong to this feature (timestamp 20261130*), sorted. */
export function weightMigrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith("20261130") && f.endsWith(".sql"))
    .sort();
}

/** The SQL of a migration without its `--` comments, so a name mentioned in a comment is not a definition. */
export function sqlWithoutComments(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/** Names (schema-qualified, lower case) after each `create [or replace] function`, optionally only the `or replace` ones. */
export function definedFunctions(sql: string, orReplace: boolean): string[] {
  const re = orReplace
    ? /create\s+or\s+replace\s+function\s+([a-z_]+\.[a-z_0-9]+)/gi
    : /create\s+function\s+([a-z_]+\.[a-z_0-9]+)/gi;
  return [...sqlWithoutComments(sql).matchAll(re)].map((m) => m[1]!.toLowerCase());
}

function allSql(): string {
  return weightMigrations(MIGRATIONS)
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

describe("P2-0b migrations", () => {
  it("are exactly the steps built so far", () => {
    expect(weightMigrations(MIGRATIONS)).toEqual(WEIGHT_MIGRATIONS);
  });

  it("sort after P2-0 PR A's 20261129100000", () => {
    for (const f of WEIGHT_MIGRATIONS) expect(f.localeCompare(AFTER_P2_0)).toBeGreaterThan(0);
  });

  it("self-test: the listing sees an extra feature file", () => {
    const dir = mkdtempSync(join(tmpdir(), "p20b-"));
    try {
      writeFileSync(join(dir, "20261130100000_weight_core.sql"), "");
      writeFileSync(join(dir, "20261130999999_extra.sql"), "");
      writeFileSync(join(dir, "20261128100600_other.sql"), "");
      expect(weightMigrations(dir)).toEqual([
        "20261130100000_weight_core.sql",
        "20261130999999_extra.sql",
      ]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("create no table", () => {
    expect(sqlWithoutComments(allSql())).not.toMatch(/create\s+table/i);
  });

  it("alter only menu_item, menu_item_price, sale_settings and order_line", () => {
    const altered = [...sqlWithoutComments(allSql()).matchAll(/alter\s+table\s+([a-z_.]+)/gi)].map(
      (m) => m[1]!.toLowerCase(),
    );
    expect(altered.length).toBeGreaterThan(0);
    expect(altered.filter((t) => !ALTERED_TABLES.includes(t))).toEqual([]);
  });

  it("replace only the listed functions and create only the listed new ones", () => {
    const sql = allSql();
    expect(definedFunctions(sql, true).filter((f) => !REPLACED_FUNCTIONS.includes(f))).toEqual([]);
    // A function that is dropped and created again is the one listed exception, not a new function.
    const created = definedFunctions(sql, false).filter((f) => !DROPPED_AND_RECREATED.includes(f));
    expect(
      created.filter((f) => !NEW_APP_FUNCTIONS.concat(NEW_PUBLIC_FUNCTIONS).includes(f)),
    ).toEqual([]);
    expect(
      created.filter((f) => f.startsWith("public.") && !NEW_PUBLIC_FUNCTIONS.includes(f)),
    ).toEqual([]);
  });

  it("drop only the listed function, and never with cascade", () => {
    const sql = sqlWithoutComments(allSql());
    const dropped = [
      ...sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?([a-z_]+\.[a-z_0-9]+)/gi),
    ].map((m) => m[1]!.toLowerCase());
    expect(dropped.filter((f) => !DROPPED_AND_RECREATED.includes(f))).toEqual([]);
    expect(sql).not.toMatch(/cascade/i);
    for (const f of DROPPED_AND_RECREATED) expect(definedFunctions(sql, false)).toContain(f);
  });

  it("never re-create a function that must stay as it is", () => {
    const sql = allSql();
    const touched = [...definedFunctions(sql, true), ...definedFunctions(sql, false)];
    expect(touched.filter((f) => PROTECTED_FUNCTIONS.includes(f))).toEqual([]);
  });

  it("self-test: the function scan ignores comments and sees a definition", () => {
    const sql =
      "-- create or replace function public.void_line()\ncreate or replace function public.void_line() returns void";
    expect(definedFunctions(sql, true)).toEqual(["public.void_line"]);
    expect(definedFunctions("-- create function app.x()\n", false)).toEqual([]);
    expect(sqlWithoutComments("drop function public.x(date); -- cascade\n")).not.toMatch(
      /cascade/i,
    );
  });
});
