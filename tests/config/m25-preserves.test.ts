import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// M25 plan step 1 (docs/plans/2026-11-01-m25-go-live.md §5): M25 adds no migration, no dependency and no nav change.
const ROOT = new URL("../../", import.meta.url);
// The pin is the newest migration on main: M25 adds none. It moved on purpose when main (M25b, M25c, A5's follow-up #50, the cron bypass #52)
// was merged into this branch. The reservations feature (PR1, plan docs/plans/2026-11-08-reservations.md A1 on) re-pins it on
// purpose to its last migration so far, as it does in the m25a and m25b preserves tests; M25 itself still adds none. A5b (raw stock on the business day, ADR-033)
// re-pins it on purpose to its own last migration, 20261127100100_drop_unused_effective_indexes.sql (A5b has two migrations; it moved forward with each).
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
const LAST_MIGRATION = "20261206210400_post_opening_stock.sql";
// md5 of src/lib/nav/nav-model.ts: main after M25b's navigation by job (ADR-030) plus the one Prenotazioni link of the reservations (A13), then P2-1 B5's /doppia-verifica entry (on purpose), then P2-2's /tracciabilita in Cucina (on purpose); M25 itself changes no navigation.
const NAV_MODEL_MD5 = "2c9f55e8cd55ef3f1cc5a2a46c1795ff";

/** Sorted migration file names of a directory. */
function listMigrations(dir: string | URL): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** The dependency names the no-new-deps guard lists, read from its source (importing a test file would run its tests twice). */
function guardedDependencyNames(): string[] {
  const src = readFileSync(new URL("tests/config/no-new-deps.test.ts", ROOT), "utf8");
  const block = /const EXPECTED = \[([\s\S]*?)\];/.exec(src)?.[1] ?? "";
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe("M25 adds no migration", () => {
  it("the newest migration is still main's", () => {
    const names = listMigrations(new URL("supabase/migrations/", ROOT));
    expect(names.at(-1)).toBe(LAST_MIGRATION);
  });

  it("self-test: an extra later migration in a directory is detected", () => {
    const dir = mkdtempSync(join(tmpdir(), "m25-mig-"));
    writeFileSync(join(dir, LAST_MIGRATION), "-- x\n");
    expect(listMigrations(dir).at(-1)).toBe(LAST_MIGRATION);
    writeFileSync(join(dir, "20261299000000_x.sql"), "-- x\n");
    expect(listMigrations(dir).at(-1)).not.toBe(LAST_MIGRATION);
  });
});

describe("M25 adds no dependency", () => {
  it("package.json names equal the guarded list", () => {
    const pkg = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const names = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)].sort();
    const guarded = guardedDependencyNames();
    expect(guarded.length).toBeGreaterThan(20);
    expect(names).toEqual([...guarded].sort());
  });
});

describe("M25 changes no navigation", () => {
  it("src/lib/nav/nav-model.ts is byte-identical to main's M25b model", () => {
    const md5 = createHash("md5")
      .update(readFileSync(new URL("src/lib/nav/nav-model.ts", ROOT)))
      .digest("hex");
    expect(md5).toBe(NAV_MODEL_MD5);
  });
});
