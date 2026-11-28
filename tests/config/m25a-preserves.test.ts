import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// M25a plan step 0 (docs/plans/2026-11-01-m25a-password-login.md §3.2, §5): M25a adds no migration, no
// dependency, no nav change and no new importer of the privileged staff-auth module.
const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
// M25a adds no migration. The pin is the newest migration on the merged tree: M25b re-pinned it on purpose
// (plan §3.9, step 18) to its own 20261118100000_payable_list_range.sql, and M25c re-pins it on purpose (plan step 1) to its
// last file, 20261120100600_dashboard_yesterday_services.sql (it was moved forward with each of M25c's migration steps). A5's
// follow-up (#50) re-pins it on purpose to 20261121100000_raw_waste_business_date.sql, the next free timestamp after M25c.
// The cron fix re-pins it on purpose to 20261122100000_cron_vercel_protection_bypass.sql (Vercel protection bypass header
// in app.call_cron_route, no table and no public function). The reservations feature (PR1, plan A1 on) re-pins it on purpose to its
// last migration so far; each PR1 step moves it forward. A5b (raw stock on the business day, ADR-033, plan 2026-11-08-a5b) re-pins it on purpose to its own
// last migration, 20261127100100_drop_unused_effective_indexes.sql (A5b has two migrations; it moved forward with each).
// The reservations feature (PR2, plan step B1 on, 20261128*) re-pins it on purpose to its own last migration so far; each PR2 migration moves it forward.
// P2-0 F12 (docs/plans/2026-11-11-p2-0-golive-carryovers.md) moved it on purpose to 20261129100000_supplier_item_mapping_update_revoke.sql;
// P2-0b (sell by weight, 20261130*, plan docs/plans/2026-11-11-p2-0b-sell-by-weight.md) re-pins it on purpose to its own last migration.
// P2-1 (TOTP second factor, 20261201*, plan docs/plans/2026-11-12-p2-1-totp.md) re-pins it on purpose to its own last migration so far; each P2-1 migration moves it forward.
// FD31 (admin gated in every mode, 20261202100000_admin_mfa_always.sql) re-pins it on purpose to its own migration: one `create or replace` pair, no new object.
// P2-2 (trace and sell-through, 20261203*, plan docs/plans/2026-11-14-p2-2-trace-sell-through.md) re-pins it on purpose to its own last migration so far; each P2-2 migration moves it forward.
// P2-7 (XML e-invoice upload, 20261204*, plan docs/plans/2026-11-14-p2-7-xml-invoice-upload.md) re-pins it on purpose to its own last migration so far; each P2-7 migration moves it forward.
// BQ-1 (docs/plans/2026-11-14-bq1-tables-unsent-count.md, 20261205100000_tables_unsent_count.sql) moves it on purpose to its own migration: one new helper and tables_list replaced.
// DS-BQ-2 (docs/plans/2026-11-14-ds-bq2-order-session-opener-coperto.md, 20261206100000_order_view_opener_coperto.sql) moves it on purpose to its own migration: public.order_view replaced, no new object.
// The code_hash comment small fix (lead, 2026-11-15, 20261206100100_device_enrolment_code_hash_comment.sql) moves it on purpose: one `comment on column`, numbered before SP2's 20261207* so no stacked migration lands before it.
// SP1 (docs/plans/2026-11-15-sp01-tenant-config.md, step 3, 20261206200000_tenant_sale_vat.sql) re-pinned on purpose by SP1: the newest migration is its own, the tenant sale VAT list (one table, three app functions, three triggers, a backfill); each later SP1 migration moves it forward.
// SP1 step 4 (20261206200100_sale_vat_reads.sql), re-pinned on purpose by SP1: three sale-side reads re-created on the tenant's sale VAT list (default_vat_rate, menu_items_manage, sale_settings_read), no new object.
// SP1 step 5 (20261206200200_tenant_close_codes.sql), re-pinned on purpose by SP1: tenant_close_code (one table, two app helpers, seed_tenant_settings re-created, a backfill).
// SP1 step 6 (20261206200300_close_with_tenant_codes.sql), re-pinned on purpose by SP1: app.close_session_at and app.app_vs_register_json re-created on the tenant's receipt and payment lists, no new object.
// SP1 step 7 (20261206200400_tenant_locale_settings.sql), re-pinned on purpose by SP1: tenant.default_locale, public.tenant_settings and public.set_tenant_settings, and app.check_sale_vat_rate re-created with the tenant-row lock; no new table.
// Opening stock step 3 (20261206210000_stock_movement_opening_type.sql), re-pinned on purpose by opening stock (step 3; was 20261206200400_tenant_locale_settings.sql): one `alter type ... add value 'opening'`, no other object.
// Opening stock step 4 (20261206210100_stock_movement_opening_shape.sql), re-pinned on purpose by opening stock (step 4; was 20261206210000_stock_movement_opening_type.sql): one CHECK on stock_movement (stock_movement_opening_ck), no other object.
// Opening stock step 5 (20261206210200_stock_opening_tables.sql), re-pinned on purpose by opening stock (step 5; was 20261206210100_stock_movement_opening_shape.sql): the stock_opening and opening_draft_line tables, the audit values and the purge list.
// Opening stock step 6 (20261206210300_stock_opening_draft.sql), re-pinned on purpose by opening stock (step 6; was 20261206210200_stock_opening_tables.sql): the helpers, the cut-off and the draft procedures.
// Opening stock step 7 (20261206210400_post_opening_stock.sql), re-pinned on purpose by opening stock (step 7; was 20261206210300_stock_opening_draft.sql): post_opening_stock, opening_history and opening_stock_summary.
// Opening stock step 9 (20261206210500_reverse_opening_stock.sql), re-pinned on purpose by opening stock (step 9; was 20261206210400_post_opening_stock.sql): reverse_opening_stock and the reason list.
// Opening stock step 10 (20261206210600_ingredient_cost_opening_fallback.sql), re-pinned on purpose by opening stock (step 10; was 20261206210500_reverse_opening_stock.sql): the opening-cost fallback in app.ingredient_unit_costs.
// Opening stock step 11 (20261206210700_reconciliation_opening.sql), re-pinned on purpose by opening stock (step 11; was 20261206210600_ingredient_cost_opening_fallback.sql): the reconciliation folds opening rows into openingQty.
// Comanda per uscita step 3 (20261206220000_uscita_core.sql), re-pinned on purpose by comanda-uscite (step 3; was 20261206210700_reconciliation_opening.sql): order_line.uscita, uscita_call, the guard, the purge list and the helpers.
// Comanda per uscita step 4 (20261206220100_uscita_order_entry.sql), re-pinned on purpose by comanda-uscite (step 4; was 20261206220000_uscita_core.sql): order entry with an uscita.
// Comanda per uscita step 5 (20261206220200_uscita_fire_call.sql), re-pinned on purpose by comanda-uscite (step 5; was 20261206220100_uscita_order_entry.sql): one send with hold and the call.
// Comanda per uscita step 7 (20261206220300_uscita_void.sql), re-pinned on purpose by comanda-uscite (step 7; was 20261206220200_uscita_fire_call.sql): not_prepared.
// Comanda per uscita step 8 (20261206220400_uscita_open_sessions.sql), re-pinned on purpose by comanda-uscite (step 8; was 20261206220300_uscita_void.sql): the open sessions placed in place, the NOT VALID check and the default 1.
// Comanda per uscita step 13 (20261206220500_uscita_kitchen.sql), re-pinned on purpose by comanda-uscite (step 13; was 20261206220400_uscita_open_sessions.sql): the kitchen board by uscita (M6)
// Comanda per uscita step 17 (20261206220600_uscita_tables_order_view.sql), re-pinned on purpose by comanda-uscite (step 17; was 20261206220500_uscita_kitchen.sql): the waiter reads by uscita (M7)
// Comanda per uscita step 18 (20261206220700_uscita_close.sql), re-pinned on purpose by comanda-uscite (step 18; was 20261206220600_uscita_tables_order_view.sql): the close guard (M8)
// SP2 step S1 (20261207100000_organisation.sql), re-pinned on purpose by SP2 (step S1; was 20261206220700_uscita_close.sql): platform.organisation and the tenant VAT unique dropped (H1).
// SP2 step S3 (20261207100100_memberships.sql), re-pinned on purpose by SP2 (step S3; was 20261207100000_organisation.sql): the key (tenant_id, auth_id), app.session_tenant and the hook.
// SP2 step S4 (20261207100200_select_tenant.sql), re-pinned on purpose by SP2 (step S4; was 20261207100100_memberships.sql): select_tenant, my_memberships and the switch interval.
// SP2 step S5 (20261207100300_session_tenant_purge.sql), re-pinned on purpose by SP2 (step S5; was 20261207100200_select_tenant.sql): the auth-purge job removes old selections.
// SP3 step 1 (20261208100000_organisation_vat_guard.sql), re-pinned on purpose by SP3 (step 1; was 20261207100300_session_tenant_purge.sql): the organisation-side VAT drift guard (one trigger and its function).
// SP3 step 2 (20261208100100_platform_staff_audit.sql), re-pinned on purpose by SP3 (step 2; was 20261208100000_organisation_vat_guard.sql): platform.staff, platform.audit_event and their guards.
// SP3 step 3 (20261208100200_platform_staff_guards.sql), re-pinned on purpose by SP3 (step 3; was 20261208100100_platform_staff_audit.sql): the staff/member guards on platform.staff and public.app_user, and the lock table platform.auth_lock.
// SP3 step 4 (20261208100300_platform_bootstrap.sql), re-pinned on purpose by SP3 (step 4; was 20261208100200_platform_staff_guards.sql): public.platform_bootstrap_admin (service role only).
// SP3 step 5 (20261208100400_platform_script_audit.sql), re-pinned on purpose by SP3 (step 5; was 20261208100300_platform_bootstrap.sql): public.platform_record_script_run, the scripts' one audit writer.
// SP3 step 9 (20261208100500_platform_mfa.sql), re-pinned on purpose by SP3 (step 9; was 20261208100400_platform_script_audit.sql): the account-level second factor of platform staff (platform.mfa_failure and three public functions).
// SP3 step 9 (20261208100550_platform_mfa_enrol_check.sql), re-pinned on purpose by SP3 (step 9; was 20261208100500_platform_mfa.sql): public.platform_mfa_enrol_check, the account enrolment's refusal of a venue owner or admin.
// SP3 step 10 (20261208100600_platform_staff_role.sql), re-pinned on purpose by SP3 (step 10; was 20261208100550_platform_mfa_enrol_check.sql): the platform_staff role and app.require_console.
// SP3 step 11 (20261208100700_platform_metadata.sql), re-pinned on purpose by SP3 (step 11; was 20261208100600_platform_staff_role.sql): the console's metadata reads.
const LAST_MIGRATION = "20261208100700_platform_metadata.sql";
/** md5 of src/lib/nav/nav-model.ts at main 0f1df68, then M25b's navigation model (changed on purpose, plan §3.9 step 18), then the reservations' Prenotazioni link in Sala (A13, on purpose). P2-1 B5 adds the /doppia-verifica entry in Registro (owner and admin), on purpose. P2-2 adds /tracciabilita, last in Cucina for owner, admin and chef, on purpose. */
const NAV_MODEL_MD5 = "2c9f55e8cd55ef3f1cc5a2a46c1795ff";

/** Sorted .sql file names of a migrations directory. */
export function listMigrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** The quoted strings of the `const <name> = [ ... ];` array literal in a source file. */
function stringArray(path: string, name: string): string[] {
  const source = readFileSync(join(ROOT, path), "utf8");
  const match = new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`).exec(source);
  expect(match, `${name} in ${path}`).not.toBeNull();
  return [...match![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe("M25a leaves migrations, dependencies, nav and the privileged surface alone", () => {
  it("adds no migration after the last one on main", () => {
    const names = listMigrations(MIGRATIONS);
    expect(names[names.length - 1]).toBe(LAST_MIGRATION);
  });

  it("the migration listing sees an extra file (self-test)", () => {
    const dir = mkdtempSync(join(tmpdir(), "m25a-mig-"));
    writeFileSync(join(dir, LAST_MIGRATION), "-- x\n");
    writeFileSync(join(dir, "20261299000000_x.sql"), "-- x\n");
    const names = listMigrations(dir);
    expect(names[names.length - 1]).not.toBe(LAST_MIGRATION);
  });

  it("package.json dependency names equal the list of no-new-deps.test.ts", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const names = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)].sort();
    expect(names).toEqual(stringArray("tests/config/no-new-deps.test.ts", "EXPECTED").sort());
  });

  it("src/lib/nav/nav-model.ts is byte-identical to the M25b model (pinned on purpose)", () => {
    const md5 = createHash("md5")
      .update(readFileSync(join(ROOT, "src/lib/nav/nav-model.ts")))
      .digest("hex");
    expect(md5).toBe(NAV_MODEL_MD5);
  });

  it("the privileged-module importer list still has four files", () => {
    expect(
      stringArray("tests/guards/privileged-importers.test.ts", "ALLOWED_IMPORTERS"),
    ).toHaveLength(4);
  });
});
