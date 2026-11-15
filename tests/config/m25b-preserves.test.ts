import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { webManifest as manifest } from "@/lib/brand/manifest";

// M25b plan step 0 (docs/plans/2026-11-01-m25b-navigation.md §3.1.1, §5): the navigation restructure moves no URL, adds no
// shortcut to the manifest and adds one migration only. No dependency is added either; tests/config/no-new-deps.test.ts already
// pins the package names, so it is not repeated here (it is not importable: its list is private to that file).
const APP = new URL("../../src/app/", import.meta.url).pathname;
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url).pathname;

// The 61 page.tsx paths of main 0f1df68 (plan §2.2), as directories under src/app ("(owner)" is the Home page).
const PAGES = [
  "(owner)",
  "(owner)/anagrafiche",
  "(owner)/anagrafiche/fornitori",
  "(owner)/anagrafiche/fornitori/[id]",
  "(owner)/anagrafiche/fornitori/[id]/estratto-conto",
  "(owner)/anagrafiche/importa",
  "(owner)/anagrafiche/ingredienti",
  "(owner)/anagrafiche/ubicazioni",
  "(owner)/avvisi",
  "(owner)/chiusura",
  "(owner)/costi",
  "(owner)/costi/impostazioni",
  "(owner)/costi/ingredienti",
  "(owner)/costi/ricette/[key]",
  "(owner)/costi/verifica",
  "(owner)/cucina",
  "(owner)/dispositivi",
  "(owner)/fatture",
  "(owner)/fatture/[id]",
  "(owner)/fatture/[id]/revisione",
  "(owner)/fatture/qualita",
  "(owner)/impostazioni/dati-di-prova",
  "(owner)/magazzino",
  "(owner)/magazzino/[ingredientId]",
  "(owner)/magazzino/conteggi",
  "(owner)/magazzino/conteggi/[id]",
  "(owner)/magazzino/conteggi/[id]/scostamenti",
  "(owner)/magazzino/conteggi/critici",
  "(owner)/magazzino/riconciliazione",
  "(owner)/magazzino/sprechi",
  "(owner)/margini",
  "(owner)/margini/[key]",
  "(owner)/menu",
  "(owner)/pagamenti",
  "(owner)/pagamenti/[id]",
  "(owner)/personale",
  "(owner)/produzione",
  "(owner)/produzione/[id]",
  "(owner)/produzione/[id]/etichetta",
  "(owner)/produzione/nuova",
  "(owner)/produzione/personale",
  "(owner)/registro",
  "(owner)/report",
  "(owner)/report/mese",
  "(owner)/ricette",
  "(owner)/ricette/[key]",
  "(owner)/ricette/[key]/nuova-versione",
  "(owner)/ricette/[key]/versioni/[version]",
  "(owner)/ricette/nuova",
  "(owner)/riordino",
  "(owner)/riordino/fornitori",
  "(owner)/riordino/ingredienti",
  "(owner)/riordino/ricette",
  "(owner)/spingere",
  "(owner)/tavoli",
  "(owner)/tavoli/[sessionId]",
  "(owner)/tavoli/comanda",
  "(owner)/tavoli/impostazioni",
  "(public)/dispositivo",
  "(public)/login",
  // re-pinned on purpose by SP2 (step S10; was: no venue chooser page, 61 pages)
  "(public)/login/scegli-locale",
  "(public)/pin",
];

// New pages M25b (altro, sicurezza) and M25a (password) may add under (owner); the reservations feature adds prenotazioni (A12, on purpose).
// The two public booking pages (reservations B11, on purpose) and the second-factor pages of P2-1 (steps B2 to B4, on purpose); nothing else
// may appear under (public).
const ALLOWED_NEW_PUBLIC_PAGES = [
  "(public)/prenota/[slug]/page.tsx",
  "(public)/prenota/[slug]/annulla/page.tsx",
  "(public)/login/attiva-codice/page.tsx",
  "(public)/login/codice/page.tsx",
  "(public)/login/offerta-codice/page.tsx",
  // re-pinned on purpose by SP2 (step S10; was: no venue chooser page)
  "(public)/login/scegli-locale/page.tsx",
];

const ALLOWED_NEW_OWNER_PAGES = [
  "altro/page.tsx",
  "sicurezza/page.tsx",
  "password/page.tsx",
  "prenotazioni/page.tsx",
  "doppia-verifica/page.tsx",
  // P2-2 (trace and sell-through, on purpose): the search and the three trace pages.
  "tracciabilita/page.tsx",
  "tracciabilita/lotto/[id]/page.tsx",
  "tracciabilita/produzione/[id]/page.tsx",
  "tracciabilita/piatto/[lineId]/page.tsx",
];

const LAST_BASE_MIGRATION = "20261116100000_push_menu_price_missing.sql";
// A5 (20261117*) is on main already; M25b adds the one payable_list migration. Review fixes use 20261118100100+ and are not listed
// until they exist. M25c's seven migrations (20261120*, plan step 1) are allowed on purpose: M25c is built on the merged tree.
const ALLOWED_NEW_MIGRATIONS = [
  "20261118100000_payable_list_range.sql",
  "20261120100000_service_core.sql",
  "20261120100100_demo_purge_tables_m25c.sql",
  "20261120100200_service_assign.sql",
  "20261120100300_service_settings.sql",
  "20261120100400_session_service.sql",
  "20261120100500_service_reports.sql",
  "20261120100600_dashboard_yesterday_services.sql",
  // A5's follow-up (#50, raw waste on the business day) lands after M25c, on the merged tree.
  "20261121100000_raw_waste_business_date.sql",
  // The cron fix (Vercel protection bypass header in app.call_cron_route) lands after that, on the merged tree.
  "20261122100000_cron_vercel_protection_bypass.sql",
  // The reservations feature (PR1, 20261124*, plan step A1 on) is built on the merged tree. Each step adds its file here on purpose.
  "20261124100000_reservation_core.sql",
  "20261124100100_demo_purge_tables_resv.sql",
  "20261124100200_reservation_settings.sql",
  "20261124100300_reservation_request_core.sql",
  "20261124100400_reservation_suggest.sql",
  "20261124100500_reservation_staff.sql",
  "20261124100550_reservation_staff_create.sql",
  "20261124100600_reservation_reads.sql",
  "20261124100650_reservation_joined_tables.sql",
  // A5b (raw stock on the business day, ADR-033) lands after the reservations PR1, on the merged tree. Each A5b migration step adds its file here on purpose.
  "20261127100000_raw_stock_business_date.sql",
  "20261127100100_drop_unused_effective_indexes.sql",
  // The reservations feature (PR2, 20261128*, plan step B1 on) is built on the merged tree after A5b. Each PR2 step adds its file here on purpose.
  "20261128100000_reservation_public.sql",
  "20261128100100_reservation_cancel.sql",
  "20261128100200_reservation_mail.sql",
  "20261128100300_reservation_retention.sql",
  // CI review of #69: anon keeps no grant on public sequences (Supabase default privileges).
  "20261128100400_revoke_anon_sequences.sql",
  "20261128100500_revoke_anon_defaults.sql",
  // Fix: affected_recipe_keys walks level by level so a vacuumed-empty statistics state cannot blow up its plan (302).
  "20261128100600_affected_recipe_keys_bfs.sql",
  // P2-0 F12: authenticated loses the direct UPDATE of the mapping-memory columns of supplier_item (pgTAP 303).
  "20261129100000_supplier_item_mapping_update_revoke.sql",
  // P2-0b (sell by weight, 20261130*) is built on the merged tree. Each PR 1 step adds its file here on purpose.
  "20261130100000_weight_core.sql",
  "20261130100100_weight_menu.sql",
  "20261130100200_weight_order_entry.sql",
  "20261130100300_weight_fire.sql",
  "20261130100400_weight_reads.sql",
  // P2-1 (TOTP second factor, 20261201*) is built on the merged tree. Each step adds its file here on purpose.
  "20261201100000_mfa_gate.sql",
  "20261201100100_mfa_self.sql",
  "20261201100200_mfa_admin.sql",
  "20261201100300_pin_change_window.sql",
  "20261201100400_money_keys_eur.sql",
  "20261201100500_mfa_failure_retention.sql",
  // FD31 (the admin is gated in every mode): two functions replaced, no new object.
  "20261202100000_admin_mfa_always.sql",
  // P2-2 (trace and sell-through, 20261203*): read-only functions and indexes. Each step adds its file here on purpose.
  "20261203100000_trace_core.sql",
  "20261203100100_trace_lot_search.sql",
  "20261203100200_trace_forward.sql",
  "20261203100300_trace_backward.sql",
  "20261203100400_push_sell_through.sql",
  "20261203100500_reservation_covers.sql",
  // P2-7 (XML e-invoice upload, 20261204*): the XML columns, the Storage kinds, the VAT summary table and the import and replace procedures. Each step adds its file here on purpose.
  "20261204100000_xml_invoice_columns.sql",
  "20261204100100_invoice_storage_xml.sql",
  "20261204100200_invoice_vat_summary.sql",
  "20261204100300_import_xml_invoices.sql",
  "20261204100400_replace_with_xml.sql",
  "20261204100500_automap_statistics_independent.sql",
  // BQ-1 (session.unsentCount on /api/tables): one new helper and tables_list replaced.
  "20261205100000_tables_unsent_count.sql",
  // DS-BQ-2 (opener and coperto on the order read): public.order_view replaced, no new object.
  "20261206100000_order_view_opener_coperto.sql",
  // The code_hash comment small fix (lead, 2026-11-15): one `comment on column`, no object.
  "20261206100100_device_enrolment_code_hash_comment.sql",
  // SP1 (docs/plans/2026-11-15-sp01-tenant-config.md), re-pinned on purpose by SP1: step 3, the tenant sale VAT list (one table, three app functions, three triggers, a backfill). Each SP1 migration step adds its file here.
  "20261206200000_tenant_sale_vat.sql",
  // SP1 step 4 (20261206200100_sale_vat_reads.sql), re-pinned on purpose by SP1: three sale-side reads re-created on the tenant's sale VAT list (default_vat_rate, menu_items_manage, sale_settings_read), no new object.
  "20261206200100_sale_vat_reads.sql",
  // SP1 step 5 (20261206200200_tenant_close_codes.sql), re-pinned on purpose by SP1: tenant_close_code (one table, two app helpers, seed_tenant_settings re-created, a backfill).
  "20261206200200_tenant_close_codes.sql",
  // SP1 step 6 (20261206200300_close_with_tenant_codes.sql), re-pinned on purpose by SP1: app.close_session_at and app.app_vs_register_json re-created on the tenant's receipt and payment lists, no new object.
  "20261206200300_close_with_tenant_codes.sql",
  // SP1 step 7 (20261206200400_tenant_locale_settings.sql), re-pinned on purpose by SP1: tenant.default_locale, public.tenant_settings and public.set_tenant_settings, and app.check_sale_vat_rate re-created with the tenant-row lock; no new table.
  "20261206200400_tenant_locale_settings.sql",
  // Opening stock step 3 (20261206210000_stock_movement_opening_type.sql), re-pinned on purpose by opening stock (step 3; was the list ending at 20261206200400_tenant_locale_settings.sql): one enum value.
  "20261206210000_stock_movement_opening_type.sql",
  // Opening stock step 4 (20261206210100_stock_movement_opening_shape.sql), re-pinned on purpose by opening stock (step 4; was the list ending at 20261206210000_stock_movement_opening_type.sql): one CHECK on stock_movement.
  "20261206210100_stock_movement_opening_shape.sql",
  // Opening stock step 5 (20261206210200_stock_opening_tables.sql), re-pinned on purpose by opening stock (step 5; was the list ending at 20261206210100_stock_movement_opening_shape.sql): the two opening tables.
  "20261206210200_stock_opening_tables.sql",
  // Opening stock step 6 (20261206210300_stock_opening_draft.sql), re-pinned on purpose by opening stock (step 6; was the list ending at 20261206210200_stock_opening_tables.sql): the helpers, the cut-off and the draft procedures.
  "20261206210300_stock_opening_draft.sql",
  // Opening stock step 7 (20261206210400_post_opening_stock.sql), re-pinned on purpose by opening stock (step 7; was the list ending at 20261206210300_stock_opening_draft.sql): post_opening_stock, opening_history and opening_stock_summary.
  "20261206210400_post_opening_stock.sql",
  // Opening stock step 9 (20261206210500_reverse_opening_stock.sql), re-pinned on purpose by opening stock (step 9; was the list ending at 20261206210400_post_opening_stock.sql): reverse_opening_stock and the reason list.
  "20261206210500_reverse_opening_stock.sql",
  // Opening stock step 10 (20261206210600_ingredient_cost_opening_fallback.sql), re-pinned on purpose by opening stock (step 10; was the list ending at 20261206210500_reverse_opening_stock.sql): the opening-cost fallback in app.ingredient_unit_costs.
  "20261206210600_ingredient_cost_opening_fallback.sql",
  // Opening stock step 11 (20261206210700_reconciliation_opening.sql), re-pinned on purpose by opening stock (step 11; was the list ending at 20261206210600_ingredient_cost_opening_fallback.sql): the reconciliation folds opening rows into openingQty.
  "20261206210700_reconciliation_opening.sql",
  // Comanda per uscita step 3 (20261206220000_uscita_core.sql), re-pinned on purpose by comanda-uscite (step 3; was the list ending at 20261206210700_reconciliation_opening.sql): order_line.uscita, uscita_call, the guard, the purge list and the helpers.
  "20261206220000_uscita_core.sql",
  // Comanda per uscita step 4 (20261206220100_uscita_order_entry.sql), re-pinned on purpose by comanda-uscite (step 4; was the list ending at 20261206220000_uscita_core.sql): order entry with an uscita.
  "20261206220100_uscita_order_entry.sql",
  // Comanda per uscita step 5 (20261206220200_uscita_fire_call.sql), re-pinned on purpose by comanda-uscite (step 5; was the list ending at 20261206220100_uscita_order_entry.sql): one send with hold and the call.
  "20261206220200_uscita_fire_call.sql",
  // Comanda per uscita step 7 (20261206220300_uscita_void.sql), re-pinned on purpose by comanda-uscite (step 7; was the list ending at 20261206220200_uscita_fire_call.sql): not_prepared.
  "20261206220300_uscita_void.sql",
  // Comanda per uscita step 8 (20261206220400_uscita_open_sessions.sql), re-pinned on purpose by comanda-uscite (step 8; was the list ending at 20261206220300_uscita_void.sql): the open sessions placed in place, the NOT VALID check and the default 1.
  "20261206220400_uscita_open_sessions.sql",
  // Comanda per uscita step 13 (20261206220500_uscita_kitchen.sql), re-pinned on purpose by comanda-uscite (step 13; was the list ending at 20261206220400_uscita_open_sessions.sql): the kitchen board by uscita (M6)
  "20261206220500_uscita_kitchen.sql",
  // Comanda per uscita step 17 (20261206220600_uscita_tables_order_view.sql), re-pinned on purpose by comanda-uscite (step 17; was the list ending at 20261206220500_uscita_kitchen.sql): the waiter reads by uscita (M7)
  "20261206220600_uscita_tables_order_view.sql",
  // Comanda per uscita step 18 (20261206220700_uscita_close.sql), re-pinned on purpose by comanda-uscite (step 18; was the list ending at 20261206220600_uscita_tables_order_view.sql): the close guard (M8)
  "20261206220700_uscita_close.sql",
  // SP2 step S1 (20261207100000_organisation.sql), re-pinned on purpose by SP2 (step S1; was the list ending at 20261206220700_uscita_close.sql): platform.organisation and H1.
  "20261207100000_organisation.sql",
  // SP2 step S3 (20261207100100_memberships.sql), re-pinned on purpose by SP2 (step S3; was the list ending at 20261207100000_organisation.sql): the key, app.session_tenant and the hook.
  "20261207100100_memberships.sql",
  // SP2 step S4 (20261207100200_select_tenant.sql), re-pinned on purpose by SP2 (step S4; was the list ending at 20261207100100_memberships.sql): select_tenant, my_memberships and the switch interval.
  "20261207100200_select_tenant.sql",
  // SP2 step S5 (20261207100300_session_tenant_purge.sql), re-pinned on purpose by SP2 (step S5; was the list ending at 20261207100200_select_tenant.sql): the auth-purge job removes old selections.
  "20261207100300_session_tenant_purge.sql",
  // SP3 step 1 (20261208100000_organisation_vat_guard.sql), re-pinned on purpose by SP3 (step 1; was the list ending at 20261207100300_session_tenant_purge.sql): the organisation-side VAT drift guard (one trigger and its function).
  "20261208100000_organisation_vat_guard.sql",
  // SP3 step 2 (20261208100100_platform_staff_audit.sql), re-pinned on purpose by SP3 (step 2; was the list ending at 20261208100000_organisation_vat_guard.sql): platform.staff, platform.audit_event and their guards.
  "20261208100100_platform_staff_audit.sql",
  // SP3 step 3 (20261208100200_platform_staff_guards.sql), re-pinned on purpose by SP3 (step 3; was the list ending at 20261208100100_platform_staff_audit.sql): the staff/member guards on platform.staff and public.app_user, and the lock table platform.auth_lock.
  "20261208100200_platform_staff_guards.sql",
  // SP3 step 4 (20261208100300_platform_bootstrap.sql), re-pinned on purpose by SP3 (step 4; was the list ending at 20261208100200_platform_staff_guards.sql): public.platform_bootstrap_admin (service role only).
  "20261208100300_platform_bootstrap.sql",
  // SP3 step 5 (20261208100400_platform_script_audit.sql), re-pinned on purpose by SP3 (step 5; was the list ending at 20261208100300_platform_bootstrap.sql): public.platform_record_script_run, the scripts' one audit writer.
  "20261208100400_platform_script_audit.sql",
  // SP3 step 5 follow-up (20261208100450_script_audit_mfa_reset_tenant.sql), re-pinned on purpose by SP3 (step 5; was the list without it): platform_record_script_run re-created to resolve the tenant of script.mfa_reset.
  "20261208100450_script_audit_mfa_reset_tenant.sql",
  // SP3 step 9 (20261208100500_platform_mfa.sql), re-pinned on purpose by SP3 (step 9; was the list ending at 20261208100400_platform_script_audit.sql): the account-level second factor of platform staff (platform.mfa_failure and three public functions).
  "20261208100500_platform_mfa.sql",
  // SP3 step 9 (20261208100550_platform_mfa_enrol_check.sql), re-pinned on purpose by SP3 (step 9; was the list ending at 20261208100500_platform_mfa.sql): public.platform_mfa_enrol_check, the account enrolment's refusal of a venue owner or admin.
  "20261208100550_platform_mfa_enrol_check.sql",
];

function pageFiles(root: string, dir = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...pageFiles(root, rel));
    else if (entry.name === "page.tsx") out.push(rel);
  }
  return out;
}

/** Migration file names strictly after `last`, sorted, minus the A5 ones already on main (20261117*). */
function migrationsAfter(dir: string, last: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && f > last)
    .sort();
}

const BASE_ONLY_AFTER = [
  "20261117100000_batch_movement_business_date.sql",
  "20261117100100_dashboard_week_business_date.sql",
];

describe("URLs stay put (ADR-030)", () => {
  it("lists 61 pages", () => {
    expect(PAGES).toHaveLength(62); // re-pinned on purpose by SP2 (step S10; was 61)
  });

  for (const route of PAGES) {
    it(`/${route} still has its page.tsx`, () => {
      expect(existsSync(join(APP, route, "page.tsx"))).toBe(true);
    });
  }

  it("adds only the allowed pages under (owner)", () => {
    const known = new Set(PAGES.map((p) => `${p}/page.tsx`));
    const owner = pageFiles(join(APP, "(owner)"));
    const extra = owner.filter((f) => !known.has(`(owner)/${f}`));
    expect(extra.filter((f) => !ALLOWED_NEW_OWNER_PAGES.includes(f))).toEqual([]);
  });

  it("adds no page under (public) or at the app root", () => {
    const known = new Set(
      PAGES.filter((p) => p.startsWith("(public)")).map((p) => `${p}/page.tsx`),
    );
    const pub = pageFiles(join(APP, "(public)")).map((f) => `(public)/${f}`);
    expect(pub.filter((f) => !known.has(f) && !ALLOWED_NEW_PUBLIC_PAGES.includes(f))).toEqual([]);
    expect(existsSync(join(APP, "page.tsx"))).toBe(false);
  });
});

describe("the manifest", () => {
  it("has no shortcuts and starts at /", () => {
    const m = manifest();
    expect("shortcuts" in m).toBe(false);
    expect(m.start_url).toBe("/");
  });
});

describe("migrations after M24", () => {
  it("are A5's two and a subset of the M25b list", () => {
    const after = migrationsAfter(MIGRATIONS, LAST_BASE_MIGRATION).filter(
      (f) => !BASE_ONLY_AFTER.includes(f),
    );
    expect(after.filter((f) => !ALLOWED_NEW_MIGRATIONS.includes(f))).toEqual([]);
  });

  it("A5's migrations are present (the base is main with A5)", () => {
    expect(migrationsAfter(MIGRATIONS, LAST_BASE_MIGRATION).slice(0, 2)).toEqual(BASE_ONLY_AFTER);
  });

  it("self-test: the listing helper sees an extra file", () => {
    const dir = mkdtempSync(join(tmpdir(), "m25b-"));
    try {
      writeFileSync(join(dir, LAST_BASE_MIGRATION), "");
      writeFileSync(join(dir, "20261119000000_x.sql"), "");
      const found = migrationsAfter(dir, LAST_BASE_MIGRATION);
      expect(found).toEqual(["20261119000000_x.sql"]);
      expect(found.filter((f) => !ALLOWED_NEW_MIGRATIONS.includes(f))).toEqual([
        "20261119000000_x.sql",
      ]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// Step 6: the one migration replaces public.payable_list and nothing else (pgTAP 267 proves the behaviour).
describe("the M25b migration (20261118100000_payable_list_range.sql)", () => {
  const sql = readFileSync(join(MIGRATIONS, "20261118100000_payable_list_range.sql"), "utf8");
  const code = sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

  it("drops and creates public.payable_list, once each", () => {
    expect(code.match(/drop\s+function\s+[\w.]+/gi)).toEqual(["drop function public.payable_list"]);
    expect(code.match(/create\s+(or\s+replace\s+)?function\s+[\w.]+/gi)).toEqual([
      "create function public.payable_list",
    ]);
  });

  it("changes no table, policy, index, job or check", () => {
    expect(code).not.toMatch(/create\s+(unlogged\s+|temp\w*\s+)?table\s/i);
    expect(code).not.toMatch(/alter\s+table\s/i);
    expect(code).not.toMatch(/(create|drop|alter)\s+policy\s/i);
    expect(code).not.toMatch(/create\s+(unique\s+)?index\s/i);
    expect(code).not.toMatch(/cron\.schedule/i);
    expect(code).not.toMatch(
      /audit_event_(entity_type|action)_check|alert_kind|job_run_job_check/i,
    );
  });

  it("keeps the definer rules and the grants", () => {
    expect(code).toMatch(/security\s+definer/i);
    expect(code).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(code).toMatch(/require_payables_reader\(\)/);
    expect(code).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.payable_list\([^)]*\)\s+from\s+public,\s*anon,\s*service_role/i,
    );
    expect(code).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.payable_list\([^)]*\)\s+to\s+authenticated/i,
    );
  });
});
