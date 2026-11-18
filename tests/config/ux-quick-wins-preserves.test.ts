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
const NEWEST_MIGRATION = "20261206200300_close_with_tenant_codes.sql";

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
