import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLOR_TOKENS } from "@/lib/design/tokens";

// UX quick wins plan §3.2 and §5 (D1): the quick wins change layout, placement, wording and flow only. No migration, no new design
// token, no new dependency (the dependency list is pinned by no-new-deps.test.ts). Adding any of them needs a plan change.
// The quick wins added none: the newest one is the admin-always-MFA fix (FD31), which is not a quick win. A later migration needs this pin moved on purpose.
// P2-2 (20261203*) moves it on purpose to its own last migration so far; each P2-2 migration moves it forward.
// P2-7 (20261204*) moves it on purpose to its own last migration so far; each P2-7 migration moves it forward.
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
// SP3 step 12 (20261208100800_platform_notices.sql), re-pinned on purpose by SP3 (step 12; was 20261208100700_platform_metadata.sql): the platform notices and platform_me.
const NEWEST_MIGRATION = "20261208100800_platform_notices.sql";

describe("UX quick wins add no migration and no token", () => {
  it("keeps the newest migration", () => {
    const files = readdirSync(new URL("../../supabase/migrations/", import.meta.url))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files.at(-1)).toBe(NEWEST_MIGRATION);
  });

  const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
  const theme = css.slice(css.indexOf("@theme {"), css.indexOf("@theme inline"));

  it("declares in @theme exactly the colour tokens of tokens.ts", () => {
    const names = [...theme.matchAll(/--color-([a-z-]+):/g)].map((m) => m[1]).sort();
    expect(names).toEqual([...COLOR_TOKENS].sort());
  });

  it("declares no spacing or text token besides the existing --spacing-tap", () => {
    const names = [...theme.matchAll(/--(spacing|text)-([a-z0-9-]+):/g)].map(
      (m) => `${m[1]}-${m[2]}`,
    );
    expect(names).toEqual(["spacing-tap", "spacing-tap-comfort"]);
  });
});
