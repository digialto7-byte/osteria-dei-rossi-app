# Tech plan: Costì / Osteria Digitalization · SP1, per-tenant configuration

- **Status:** draft for the lead · **Author:** architect · **Date:** 2026-11-15 (written 2026-11-18)
- **Repo and branch:** `osteria-dei-rossi-app`, this plan on `docs/sp01-tenant-config-plan` (from `origin/main`). The build: one
  `/feature` run on `feat/sp01-tenant-config` from `main`, **not stacked** on SP2 or SP3 (§3.10).
- **Milestone:** SP1 of `docs/plans/2026-11-13-platform-saas.md` (§10 row SP1 line 956; §10a "SP1" lines 996–1015; §5.2 lines 592–596;
  §5.4 H9–H15, H20, H26, H32; §6.5 rules 4–5).
- **Client slug / internal:** `osteria-dei-rossi` is tenant #1. Internal planning document (English).
- **Client facts used:** none. Fixtures are fake: "Osteria Demo A", "Osteria Demo B", `IT00000000001`-style VAT numbers, addresses on
  `example.test`. The only name the code already holds (tenant #1's, in `password-policy.ts` and `venue.name`) is quoted as found, not
  added to.
- **Inputs read:** this repo's `CLAUDE.md`; platform plan §0a, §0b, §5.1–§5.4, §6.5, §8, §10, §10a (SP0–SP4), §12; ADR-037, ADR-038,
  ADR-039; the SP0 plan `docs/plans/2026-11-14-sp00-spike.md` (§8, §10); the SP3 plan `docs/plans/2026-11-15-sp3-console.md` (read from the
  `docs/sp3-console-plan` worktree; format model); the SP2 plan `docs/plans/2026-11-14-sp2-memberships.md` and its built files
  (`20261207100000_organisation.sql`, `src/components/use-me.ts`, `src/lib/tenancy/switch.ts`), read from the local
  `feat/sp2-memberships` worktree; the code cited in §2.
- **How main was read:** this session had file tools but no shell, so `git fetch` could not run. Everything below comes from the
  `docs/sp01-tenant-config-plan` worktree. The coordinator confirmed on 2026-11-18 that main's newest migration is still
  `20261206100100_device_enrolment_code_hash_comment.sql` and that SP2's first is `20261207100000` on `origin/feat/sp2-memberships`.
  **Where the platform plan and the code differ, the code wins.** §9 lists every difference.
- **ID scheme:** steps **0–18**; variants **V1–V6**; open questions **Q1–Q12**; risks **R1–R10**; SP1 acceptance tests **AT1–AT6**
  (= platform plan §10a "SP1" tests 1–6, same order). **G** = tenant #1 golden tests, **X** = cross-tenant suite (platform plan §6.5).
  SP2 steps are written "SP2 S6".

---

## 0. Summary

SP1 turns the remaining osteria constants into per-tenant data, and leaves tenant #1's payloads and screens exactly as they are:

1. **VAT, two lists (default, founder may revisit).** `app.allowed_vat_rates()` stays the immutable statutory list. It checks supplier
   invoices and bounds the three sale-side CHECKs. A new `public.tenant_vat_rate` holds each tenant's **sale** list, read through the stable
   `app.sale_vat_rates(tenant)`. A trigger, `app.check_sale_vat_rate()`, enforces it on `menu_item_price` and `sale_settings` for every
   writer. The two sale reads and the default rate switch to the tenant list.
2. **Receipt and payment codes per tenant.** `public.tenant_close_code` picks which codes a tenant offers, and in what order, from today's
   fixed catalogue (`app.receipt_types()`, `app.payment_type_codes()`, which stay as the CHECK bounds). `close_table` and the day-close
   report read the tenant's list.
3. **Locale and zone.** A new column `tenant.default_locale` joins the existing `tenant.timezone`. `GET /api/me` gains
   `settings: {timeZone, locale, currency, receiptTypes, paymentTypes}`. The browser keeps these in a small client-only store, and the
   formatters read it as their default. Server code passes the tenant's zone explicitly.
4. **Small fixes.** The extraction prompt becomes venue-neutral (H26); the refused password words come from the tenant's name (H32); the
   `lang` attribute follows the tenant's locale (H13); no `"Europe/Rome"` literal remains outside one constant (H9, H10).
5. **Seeds reproduce today.** A trigger on `tenant` seeds every tenant, existing and new, with today's lists. Tenant #1's menu, coperto,
   bill, day-close and table payloads equal golden pins taken on `main` before any change (**G**, step 1). Demo A and Demo B run the
   cross-tenant suite (**X**, step 2).

**Gating.** SP1 needs no SP0 hosted verdict and nothing from SP2 or SP3. (T1 and T3 feed SP2, T2 feeds SP3, T4 feeds SP2's indexes, T5
feeds SP7.) The one exception: a **T4.H isolation failure** stops every merge, SP1 included, until an RLS fix lands (SP0 §8 line 604).

**Migrations `20261206200000`–`20261206200400`** (five files), pgTAP **389–396**. The range sorts after main's newest (`20261206100100`)
and before SP2's first (`20261207100000`). It needs one ratified one-line change to `tests/config/ds-bq2-preserves.test.ts`, whose filter
claims every `20261206*` file (§3.10). **Merge order: SP1 to `main` before SP2.** Otherwise `supabase db push` on staging would meet an
older migration after a newer one (V1).

**Flags for the lead (read first).**
1. **`vatRates` is not in `/api/me`** (platform plan §10a SP1 lists it). `/api/me` is offline-cached for waiters, and
   `tests/guards/waiter-weight-no-cost.test.ts:33` refuses any key matching `/vat/i` on it. The owner forms already get the sale list from
   their own owner-only reads (`menu_items_manage`, `sale_settings_read`), which SP1 switches. (Q3; V4 if you want it anyway, for owner
   and admin only.)
2. **Procedures are not re-created for VAT.** The trigger raises the same `P0001 vat_rate_invalid` inside the same transaction, for the
   procedures and for direct inserts alike. Re-creating `create_menu_item`, `update_menu_item` and `set_sale_settings` would add nothing
   and would move three md5 pins in pgTAP 327 (§4).
3. **H10 needs no zone.** Both literals format a *calendar date* at 12:00 UTC (`public-view.ts:38–46`, `render.ts:35–44`), and the
   database has already computed that date in the tenant's zone. SP1 sets `timeZone: "UTC"`, as `formatCalendarDate` does
   (`format.ts:48–50`), instead of adding a zone to two strict payloads (Q4).
4. **G and X do not exist yet** (no "golden" anywhere in `tests/` or `supabase/tests/`; the SP2 and SP3 plans do not build them). SP1 is
   the first SP milestone to merge, so it creates both, and later milestones extend them.
5. **SP2 plans a new file with the same name, `tests/app/api/me-route.test.ts`** (SP2 S6). SP1 uses `tests/app/api/me-settings.test.ts`
   so neither branch creates a file the other also creates (§3.10).

Scope: 5 migrations, 8 pgTAP files (389–396), 1 changed route (`/api/me`), 1 new route (`PATCH /api/settings/venue`), client plumbing,
formatter signatures, a source scanner. No new dependency, no new secret, no new cron job, no new audit action.

---

## 1. Goal and scope

**Goal:** a second tenant can have another sale VAT list, other receipt and payment choices, another locale and (when provisioning allows
it) another time zone. Supplier-invoice checks stay statutory, and Osteria Dei Rossi sees no change.

**In scope**
- `public.tenant_vat_rate`, `app.sale_vat_rates`, `app.check_sale_vat_rate` and its two triggers; the switched default and reads (H14, H15).
- `public.tenant_close_code`, `app.tenant_receipt_types`, `app.tenant_payment_types`; `close_table` and the day-close report on the tenant
  list (H20).
- `tenant.default_locale`; `public.tenant_settings()`; `public.set_tenant_settings(jsonb)` and `PATCH /api/settings/venue`, with no screen
  (Q1).
- The seed trigger on `tenant` and the backfill of existing tenants.
- `GET /api/me` → `settings`; the client store; formatter signatures; `lang` (H9, H11, H12, H13).
- H10 (calendar labels), H26 (prompt), H32 (password words).
- G (tenant #1 golden payloads) and X (cross-tenant suite on Demo A and Demo B).
- Every pin that moves (§3.8). The coexistence with SP2 and the SP3 stack (§3.10).

**Out of scope**
- A settings screen (SP7 wizard, or V2). Changing `tenant.timezone` from the app (Q2). Currencies other than EUR, and countries other than
  Italy (FD19).
  - For SP7's settings screen (lead, PR #192, 2026-11-18): when a rate is switched off, the screen lists what still uses it (coperto, N
    dishes) with links to change them. A switched-off rate keeps working on what already uses it until that is edited (Q12), and the stored
    coperto rate keeps applying to new tables; SP1 refuses nothing and only documents it (`docs/runbook.md` "Venue settings").
- Receipt or payment codes outside today's catalogue (Q6), and custom labels (SP9 terminology).
- Courses, counter service, units (SP8). Venue name and theme from `/api/me` (SP9). The manifest's `lang` (product surface; Q5).
- Any change to `src/server/staff-auth/**`, `public/sw.js`, `app.tenant_id()`, `app.role()`, `app.app_user_id()`, the access-token hook,
  `app.line_checks`, `app.allowed_vat_rates()`, `app.menu_vat`, `public.create_menu_item`, `public.update_menu_item`,
  `public.set_sale_settings`, `public.open_table`.
- The `/api/me` query's `.eq("auth_id", …).maybeSingle()` (`route.ts:14–18`), which breaks with several memberships: that is SP2 S6's fix.

---

## 2. Current state

Line numbers are on the worktree of `docs/sp01-tenant-config-plan` (`main`), checked 2026-11-18. "(moved)" marks a line that differs from
platform plan §5.4.

| What | Where (file:line) | Fact that matters for SP1 |
|---|---|---|
| Tenant columns | `supabase/migrations/20261021120000_tenancy_baseline.sql:18–19` | `timezone text not null default 'Europe/Rome'`; `currency ... check (currency = 'EUR')`. No locale column |
| Statutory VAT (H14) | `20261022130200_review_helpers.sql:10–13` | `app.allowed_vat_rates()` = `[0,4,5,10,22]`, immutable; purchase side `app.line_checks` `:56`, the check at `:67`, revoke `:238`. Pinned by pgTAP `021:131` |
| Sale-side CHECKs | `20261031100000_menu_tables_core.sql:55` (`menu_item_price.vat_rate`), `:91` (`sale_settings.coperto_vat_rate`), `:117` (`table_session.coperto_vat_rate`) | each `= any (app.allowed_vat_rates())`. `menu_item_price` is insert-only, versioned by `valid_from` (`:49–64`) |
| Sale VAT in procedures | `20261031100200_menu_procedures.sql:51–68` (`app.menu_vat`, immutable, check at `:63`) (moved: the platform plan's ":63" is inside this helper); its callers `create_menu_item` / `update_menu_item`, re-created by `20261130100100_weight_menu.sql:150, 248` (calls at `:184, :300`); `20261031100400_dining_tables_coperto.sql:183–249` (`set_sale_settings`, check at `:220–222`) | statutory check, `P0001 vat_rate_invalid` → 422 (`src/server/menu/errors.ts:32`, `src/server/tables/errors.ts:34`) |
| Default rate | `20261031100100_menu_tables_helpers.sql:113–122` | `app.default_vat_rate` = `cost_settings.sale_vat_pct` if in the statutory list; pgTAP `151:163–165` |
| Sale VAT in reads | `20261031100300_menu_reads.sql:44–64` (`menu_items_manage`, `'vatRates'` at `:57`); `20261031100400_dining_tables_coperto.sql:162–179` (`sale_settings_read`, `:177`) | owner/admin only (`app.require_menu_writer`, helpers `:36–46`) |
| TS VAT mirrors (H15) | `src/server/menu/constants.ts:11–12` `VAT_RATES`; used by `src/server/menu/schemas.ts:37`, `src/lib/menu/menu-form.ts:117`, `src/lib/tables/coperto-form.ts:41`; parity `tests/parity/tables-sql-parity.test.ts:99–109`. Purchase side `src/server/extraction/constants.ts:48` `ALLOWED_VAT_RATES`; parity `tests/parity/review-sql-parity.test.ts:135` | the forms' options already come from the payloads: `menu-item-form.tsx:171`, `coperto-card.tsx:68` |
| Receipt and payment codes (H20) | `20261110100000_close_core.sql:11–19` (catalogue functions), CHECKs `:25, :27`; `20261110100200_close_table.sql:38–44` (in `app.close_session_at`, `:12`); `20261110100300_day_close.sql:86–99` (`app.app_vs_register_json`, `:60`) (moved: the report's lines are not in H20) | TS `src/server/bill/constants.ts:5, 9`; `close-sheet.tsx:15, 116, 135` uses the constants as options; parity `tests/parity/close-sql-parity.test.ts:29–45` |
| Time zone in TS (H9) | `src/lib/time/format.ts:3` `VENUE_TIME_ZONE`, used `:11, :69, :89`; `src/lib/time/venue-date.ts:1–21`; `src/lib/tables/table-view.ts:7, 58`; `src/lib/rules/rules-view.ts:5, 47`; `src/lib/csv/write.ts:6, 53`; **also** `src/lib/trace/trace-view.ts:6, 30` (P2-2), `src/lib/console/console-dates.ts:4, 53` (SP3, platform console) and the literal `src/lib/platform/api.ts:190` (SP3 example fixture) (moved/new) | every formatter caches per locale only |
| Server uses of the venue day | `src/server/stock/lots.ts:43`; `src/server/reports/extraction-quality.ts:42`; `src/server/payables/detail.ts:17`; `src/server/exports/monthly-pack.ts:47, 73`; `src/server/exports/tables/count-variance.ts:60`; `src/server/exports/tables/avt.ts:29`; `src/server/invoices/invoices.ts:153`; `src/server/invoices/xml-upload.ts:156`; `src/server/costing/cost-check-run.ts:50`; `src/server/costing/at-date.ts:38`; `src/server/alerts/templates.ts:4–9` | all call `venueDate`/`venueYear`/formatters without a zone |
| H10 | `src/lib/reservations/public-view.ts:37–46`; `src/server/reservations/mail/render.ts:35–44` | calendar dates read at `T12:00:00Z`; the mail row's date is already local (`render.ts:18`) |
| Money (H11) | `src/lib/money/format.ts:10` | `currency: "EUR"` |
| Locale (H12) | `src/lib/i18n/locale.ts:1–10`; `src/lib/i18n/index.ts:17–25` | `t()` defaults to `DEFAULT_LOCALE`; nothing ever picks `en` at runtime |
| `lang` (H13) | `src/app/layout.tsx:120` (moved from `:88`); `src/app/global-error.tsx:16`; manifest `src/lib/brand/manifest.ts:20`, served by `src/app/manifest.webmanifest/route.ts` (moved: there is no `src/app/manifest.ts`) | root layout is a server component, already dynamic (`headers()`, `:116–118`) |
| Prompt (H26) | `src/server/extraction/prompt.ts:4` ("Italian restaurant's purchasing assistant"), **`:14–15`** ("the restaurant receiving the invoice") (new), `:23` (Italian instruction) | pinned by `tests/server/extraction/prompt.test.ts` and `extract.test.ts:116` (equality to the constant) |
| Password words (H32) | `src/lib/auth/password-policy.ts:13–16, 41–51`; caller `src/server/auth/password-change.ts:102` | constants hold tenant #1's name; `checkNewPassword(password, { email })` |
| `/api/me` | `src/app/api/me/route.ts:13–37`; client type `src/components/use-me.ts:7–10` | offline-cacheable for owner, admin, waiter (`src/lib/api/offline-cache.ts:8–19`); the worker's `api-user` cache is **not** versioned (`public/sw.js:24`), so an old reply can outlive a deploy |
| Cost guard on `/api/me` | `tests/guards/waiter-weight-no-cost.test.ts:33, 91–100, 123–128` | `COST_KEY = /cost|margin|food|gp|vat|recipe/i` at any depth; `/api/me` has `poisoned: null` today |
| Audit of tenant settings | action `tenant.settings_changed`, entity `tenant`, already in every action CHECK (last `20261204100300_import_xml_invoices.sql:35`), written by `update_cost_settings` (`20261023110000_cost_settings.sql:203–204`); label in `src/lib/counts/count-view.ts:50` | SP1 reuses it, so no audit CHECK pin moves |
| Role helper | `app.require_menu_writer()` (`menu_tables_helpers.sql:36–46`): owner or admin through `app.role()`, which carries #79's `aal` gate (`20261201100000_mfa_gate.sql:65–99`) and FD31 (`20261202100000_admin_mfa_always.sql`) | reused for writes |
| Newest files | migrations: `20261206100100_device_enrolment_code_hash_comment.sql`; pgTAP: `386` (SP3, on main), `388` (on main); SP2 reserves `369–373` and `20261207100000–100300`; SP3 reserves `374–387` and `2026120810*` | **SP1: migrations `20261206200000+`, pgTAP `389+`** |
| `ds-bq2` guard | `tests/config/ds-bq2-preserves.test.ts:14–18, 30–34` | `startsWith("20261206")` must equal exactly the two DS-BQ-2 files |

---

## 3. Design

### 3.1 Data model

**3.1.1 `public.tenant_vat_rate` (step 3).**
`(tenant_id uuid not null references public.tenant (id), rate numeric(5,2) not null check (rate = any (app.allowed_vat_rates())),
is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
updated_by uuid null, primary key (tenant_id, rate), constraint tenant_vat_rate_updated_by_fkey foreign key (tenant_id, updated_by)
references public.app_user (tenant_id, id) on delete set null (updated_by))`.
- `updated_by` is null for seeded rows (no `app_user` exists when a tenant is created). `on delete set null (updated_by)` (PG15+): the demo
  purge deletes the demo users but keeps this row, so a rate a demo user last edited loses only its author and the purge does not abort
  (code review 2026-11-18; pgTAP 193 has the case).
- `app.sale_vat_rates` returns `trim_scale`d values, so `to_jsonb` of the list is the same text as `to_jsonb(app.allowed_vat_rates())`
  (`[0, 4, 5, 10, 22]`): the `vatRates` payloads keep their text when step 4 reads this list (pgTAP 391 asserts the text).
- RLS on. One policy, `tenant_vat_rate_select`: `for select to authenticated using (tenant_id = (select app.tenant_id()))`.
- No insert, update or delete grant to `anon`, `authenticated` or `service_role`. Rows are written only by `app.seed_tenant_settings` and
  `public.set_tenant_settings` (definers).
- **Not operational data (lead, 2026-11-18, ADR-018 note):** the table is tenant configuration. It is not in `app.demo_purge_tables()`, a demo
  purge keeps its rows and `app.tenant_has_operational_data` ignores it (listing it would make `begin_demo_data` refuse every seeded tenant).
  pgTAP 194 exempts configuration tables by an exact list (`tenant_vat_rate`; step 5 adds `tenant_close_code`); pgTAP 193 asserts a purge leaves
  the rows intact. The same holds for `tenant_close_code` (§3.1.2).
- Rows are never deleted: a removed rate becomes `is_active = false`. The `rate` CHECK calls an immutable function, so the rule "a CHECK
  never reads a table" holds (AT1, last clause).

**3.1.2 `public.tenant_close_code` (step 5).**
`(tenant_id uuid not null references public.tenant (id), kind text not null check (kind in ('receipt', 'payment')), code text not null,
position smallint not null check (position between 1 and 20), is_active boolean not null default true, created_at, updated_at, updated_by
uuid null (FK as above, `on delete set null (updated_by)`), primary key (tenant_id, kind, code),
constraint tenant_close_code_catalogue_ck check ((kind = 'receipt' and code = any (app.receipt_types()))
or (kind = 'payment' and code = any (app.payment_type_codes()))))`.
- RLS, policy, grants and no-delete exactly as 3.1.1.
- The catalogue stays the codes the product knows, has Italian and English labels for, and allows in `table_session`'s CHECKs
  (`close_core.sql:25, 27`). A tenant chooses which of them it offers and in what order.

**3.1.3 `tenant.default_locale` (step 7).** `alter table public.tenant add column default_locale text not null default 'it' constraint
tenant_default_locale_check check (default_locale in ('it', 'en'))`. The list equals `LOCALES` (`src/lib/i18n/locale.ts:1`; parity test,
step 7).

**3.1.4 Seeding (steps 3, 5).** Trigger `tenant_seed_settings`, `after insert on public.tenant for each row`, function
`app.seed_tenant_settings()` (definer, `search_path = ''`, closed to every API role).
- It inserts the five statutory rates, then (from step 5) the receipt codes and payment codes in catalogue order, all active, with
  `on conflict do nothing`.
- The same migrations backfill every existing tenant with one `insert … select … on conflict do nothing`.
- Every tenant created by `create_tenant_with_owner`, a script, SP7's wizard or a pgTAP fixture therefore gets today's lists. Fixtures in
  pgTAP 151, 153, 154, 215 and 220 keep passing unchanged.

**3.1.5 What is not stored.** `tenant.timezone` already exists and is not editable in SP1 (Q2). `currency` stays `EUR` by CHECK.
`table_session.coperto_vat_rate` stays a snapshot taken at opening, with the statutory CHECK only, so an open session keeps its rate when
the list changes (AT1).

### 3.2 Functions

All are definers with `search_path = ''`, owned by `postgres`, and start with `revoke all … from public, anon, authenticated,
service_role`. **Naming:** no new public name matches `cost|margin|price|service` (pins `286:45–50`).

| Function | Kind | Step | Body | Grants |
|---|---|---|---|---|
| `app.sale_vat_rates(p_tenant uuid) returns numeric[]` | new, stable | 3 | active rates of the tenant, ascending | none |
| `app.check_sale_vat_rate() returns trigger` | new | 3 | `TG_TABLE_NAME` picks the column (`vat_rate` / `coperto_vat_rate`) with an `if`, not a `case` (a plpgsql `case` naming `new.coperto_vat_rate` fails with 42703 on the other table); null passes; a rate outside the statutory list **falls through** so the column CHECK raises 23514 as today (pgTAP 150 unchanged; lead, 2026-11-18); else `if v = any (app.allowed_vat_rates()) and not (v = any (app.sale_vat_rates(new.tenant_id))) then raise exception 'vat_rate_invalid' using errcode = 'P0001'`. Reads `new.tenant_id`, never the token, so it also holds for table-owner inserts | none |
| triggers `menu_item_price_sale_vat` (`before insert or update of vat_rate on public.menu_item_price`) and `sale_settings_sale_vat` (`before insert or update of coperto_vat_rate on public.sale_settings`, `when (new.coperto_vat_rate is not null)`) | new | 3 | as above | — |
| `app.seed_tenant_settings() returns trigger` + trigger `tenant_seed_settings` | new; re-created in step 5 | 3, 5 | §3.1.4 | none |
| `app.default_vat_rate(uuid)` | re-created, same signature | 4 | `where c.sale_vat_pct = any (app.sale_vat_rates(p_tenant))` (was `menu_tables_helpers.sql:121`) | unchanged (none) |
| `public.menu_items_manage()` | re-created | 4 | `'vatRates', to_jsonb(app.sale_vat_rates(v_tenant))` (was `menu_reads.sql:57`) | unchanged |
| `public.sale_settings_read()` | re-created | 4 | `'vatRates', to_jsonb(app.sale_vat_rates(v_tenant))` (was `dining_tables_coperto.sql:177`) | unchanged |
| `app.tenant_receipt_types(uuid)`, `app.tenant_payment_types(uuid) returns text[]` | new, stable | 5 | active codes by `position` | none |
| `app.close_session_at(uuid, uuid, uuid, jsonb, timestamptz)` | re-created | 6 | keeps the catalogue checks at their place (`close_table.sql:38–44`, so the error order for an unknown code is unchanged); after the replay comparison (`:56–60`) and before the write, adds `if v_type <> all (app.tenant_receipt_types(p_tenant)) then raise 'receipt_type_invalid'` and the same for payment. A replay of an already-closed session with a since-deactivated code still answers `changed: false` | unchanged |
| `app.app_vs_register_json(uuid, date)` | re-created | 6 | buckets = the tenant's active codes in `position` order, then any code used by that day's closed sessions that is not active, in catalogue order (a deactivated code never hides a day's totals) | unchanged |
| `public.tenant_settings() returns jsonb` | new, stable | 7 | requires a tenant (`app.tenant_id()` not null, else 42501), any role. Returns `{timeZone, locale, currency, receiptTypes, paymentTypes}`, **no VAT key** (§0 flag 1) | `authenticated` |
| `public.set_tenant_settings(p_patch jsonb) returns jsonb` | new, volatile | 7 | §3.3 | `authenticated` |

**Not re-created, on purpose** (§4): `app.allowed_vat_rates`, `app.line_checks`, `app.menu_vat`, `public.create_menu_item`,
`public.update_menu_item`, `public.set_sale_settings`, `public.open_table`, `app.receipt_types`, `app.payment_type_codes`.
`set_sale_settings` and the menu procedures meet the per-tenant rule through the trigger, with the same code and transaction.

**pgTAP 341 (gate coverage):** both new public functions reach the gate (`app.tenant_id()`, `app.require_menu_writer()` → `app.role()`),
so 341 stays unchanged and green (step 7 asserts it).

### 3.3 `public.set_tenant_settings(jsonb)` and `PATCH /api/settings/venue` (steps 7, 13)

**SQL, one transaction:**
1. `app.require_menu_writer()`: owner or admin; #79's `aal` gate applies through `app.role()`, and FD31 makes `admin` always `aal2`.
2. Key check with `app.menu_keys_ok(p_patch, <allowed>, <none required>)`. Allowed keys: `locale`, `saleVatRates`, `receiptTypes`,
   `paymentTypes`; at least one present, else 22023.
3. Validate:
   - `locale` must be `it` or `en` (P0001 `locale_invalid`).
   - `saleVatRates`: a non-empty array of numbers, no duplicates, each in the statutory list. Codes: P0001 `vat_rate_invalid`, or
     `settings_list_empty`.
   - `receiptTypes` / `paymentTypes`: non-empty, no duplicates, each in the catalogue, at most 20. Codes: `receipt_type_invalid` /
     `payment_type_invalid` / `settings_list_empty`. Array order becomes `position`.
4. `select … from public.tenant where id = v_tenant for no key update` (one writer per tenant, as `set_sale_settings:226`).
   Step 7 also re-creates `app.check_sale_vat_rate` (step 3's body unchanged) so that, for a statutory rate, it first takes `FOR SHARE` on
   the same tenant row and then reads the list: a rate being switched off cannot slip into a concurrent menu or coperto write (Q-c; §7).
5. Compute before and after. If equal, return `{changed: false, settings}` with no write.
6. Upsert the active flags and positions. Rows are never deleted.
7. Write one `audit_event` row: entity `tenant`, action `tenant.settings_changed`. `before`/`after` hold only the changed keys
   (`default_locale`, `sale_vat_rates`, `receipt_types`, `payment_types`), codes and numbers only.
8. Return `{changed: true, settings}`, where `settings` is the `tenant_settings()` shape plus `saleVatRates` (owner/admin only).

**Route** `src/app/api/settings/venue/route.ts`:
- `PATCH` only, `withApi({ roles: ["owner", "admin"], body: venueSettingsPatch })`, JSON only.
- Strict Zod body (`src/server/venue-settings/schemas.ts`): an unknown key → 400.
- Errors → 422 with Italian messages (new keys `venueSettingsError.*`); 42501 → 403; `mfa_required` → 403 as every route.
- New codes `locale_invalid` and `settings_list_empty` join `ErrorCode` (`src/lib/api/errors.ts`). The existing three keep their texts.
- Not offline-cacheable. The route joins the cost guard's route list.

There is no screen in SP1 (Q1). SP7's wizard uses this route; V2 adds a screen now.

### 3.4 `GET /api/me` and the browser (steps 8–10)

**Server.** After today's row read, the route calls `supabase.rpc("tenant_settings")` and answers today's keys **plus a top-level
`settings`**. The keys and the reasons for each:
- `timeZone`: IANA name, validated by `new Intl.DateTimeFormat("en-GB", { timeZone })` not throwing.
- `locale`: `"it" | "en"`.
- `currency`: `z.literal("EUR")`. A tenant row with another currency is refused loudly, never mis-formatted (H11).
- `receiptTypes`: a non-empty array, each in `RECEIPT_TYPES`.
- `paymentTypes`: a non-empty array, each in `PAYMENT_TYPES`.

The reply gets a strict output schema (`src/server/me/output.ts`, new). The shape lives in client-importable
`src/lib/venue/settings.ts` (`venueSettingsSchema`, `type VenueSettings`, `FIRST_PAINT_VENUE_SETTINGS`).

`FIRST_PAINT_VENUE_SETTINGS = { timeZone: DEFAULT_TIME_ZONE, locale: "it", currency: "EUR", receiptTypes: [...RECEIPT_TYPES], paymentTypes:
[...PAYMENT_TYPES] }`. `DEFAULT_TIME_ZONE = "Europe/Rome"` is the **only** such literal in `src/`.

**Client store, not React** (`src/lib/venue/current.ts`, new):
- `currentVenueSettings()`, `applyVenueSettings(s)`, `resetVenueSettings()`.
- In the browser it holds the last applied settings, also kept in `localStorage["venue-settings"]`. The value is not personal data: zone,
  locale, currency, two code lists. It is read once at module load, so a returning device formats correctly from the first render.
- On the server (`typeof window === "undefined"`), `currentVenueSettings()` always returns `FIRST_PAINT_VENUE_SETTINGS`, and `apply` is a
  no-op. Concurrent requests of different tenants can never share it.
- `use-me.ts` validates `result.data.settings` with `venueSettingsSchema` inside `start()` and then calls `applyVenueSettings`; settings that are missing or malformed make the state `error` (reported with `reportError`), never defaults (Lead ruling 2026-11-18 (Rule B): no silent settings defaults; the only sanctioned default is the formatter's before the store is filled).
  `resetMe()` calls `resetVenueSettings()`.
- `applyVenueSettings` also sets `document.documentElement.lang` (H13, step 12).
- `forgetUser()` (`src/components/forget-user.ts`) calls `resetVenueSettings()`. SP2's `switchTenant` already calls `forgetUser()` twice,
  so a switch to B can never keep A's settings.
- **Old cached replies (Lead ruling 2026-11-18, Rule B):** `settings` is required in the client type `Me`. A reply cached by the worker before the deploy has no `settings`: the hook reports it and the state is `error` (the screen shows its retry), the store stays unfilled, and nothing is defaulted (R3).

**Formatters, no data logic in components.** Each formatter gets a trailing optional `zone` (and `locale` already exists), defaulting to
the store:
- `format.ts`: `formatDateTime`, `formatTime`, `formatWeekdayTime`. Formatter caches are keyed `${locale}|${zone}`.
- `venue-date.ts`: `venueDate`, `venueYear`.
- `csv/write.ts`: `formatCsvInstant`.
- `table-view.ts:58`, `rules-view.ts:47`, `trace-view.ts:30`.
- `t()` and `tn()` default to `currentVenueSettings().locale` instead of `DEFAULT_LOCALE`.

Components keep calling the view modules exactly as today: no component changes for the zone, and the data still comes only from
`/api/*` JSON.

`VENUE_TIME_ZONE` stays exported from `format.ts` as an alias of `DEFAULT_TIME_ZONE`, documented as "the platform console's zone". The
SP3 files that import it (`console-dates.ts`) are not touched, and a scanner allows importers only under `src/lib/console/**` and
`src/lib/time/**` (step 12).

**Close sheet (H20 client).** `close-sheet.tsx` takes its options from `useMe().me.settings.receiptTypes / paymentTypes`, through a pure
helper `closeOptions(me)` in `src/lib/bill/close-form.ts` that returns `null` without settings: the comanda page then shows a loading line while `/api/me` loads, and the `bill.close.settingsMissing` message once it has failed, never the catalogue (Lead ruling 2026-11-18, Rule B). Labels stay `receiptTypeLabel` /
`paymentTypeLabel`. The server schemas (`src/server/bill/schemas.ts:49–51`, `output.ts:30–32`, `day-close/output.ts:18–39`) keep the
catalogue as their bound. The tenant rule is SQL's, answering 422 as today.

**VAT forms (H15).**
- `src/server/menu/constants.ts` `VAT_RATES` is renamed `STATUTORY_VAT_RATES` ("the outer bound; the tenant's sale list comes with
  `menu_items_manage` and `sale_settings_read`"). The server Zod refine (`schemas.ts:37`) bounds by it.
- `menu-form.ts:117` and `coperto-form.ts:41` validate against the `vatRates` they are given (the payload's), not the constant.
- `extraction/constants.ts:48` is unchanged, and its parity test too.

### 3.5 Server code passes the zone (step 11)

`withApi`'s handler context gains `tenantSettings(): Promise<VenueSettings>`, memoised per request: one `rpc("tenant_settings")` on first
use, none otherwise. Every server site in the §2 table passes `(await tenantSettings()).timeZone` explicitly:
- lots, extraction quality, payables detail, monthly pack, count variance, AVT, invoice and XML upload paths, cost check, at-date.
- The alert formatters (`AlertFormatters` gains `zone`).
- The CSV writer: the export services pass the zone into `writeCsv`'s options.

Cron routes that render nothing per tenant need no change. A scanner (`tests/guards/server-zone-explicit.test.ts`) fails when any call of
`venueDate`, `venueYear`, `formatDateTime`, `formatTime`, `formatWeekdayTime` or `formatCsvInstant` under `src/server/**` lacks its zone
argument.

### 3.6 H10, H13, H26, H32 (steps 12, 14, 15)

- **H10:** `dayLabel` and `whenLabel` use `timeZone: "UTC"` on the `T12:00:00Z` instant. The output is identical for every zone, because
  the date is already the tenant's local date. A test pins the strings for 2026-03-29 and 2026-10-25 (DST days) in both locales.
- **H13:**
  - `layout.tsx:120` renders `lang={DEFAULT_LOCALE}` server-side; the client store updates `document.documentElement.lang`.
  - `global-error.tsx:16` uses `DEFAULT_LOCALE`.
  - The manifest's `lang` (`src/lib/brand/manifest.ts:20`) stays `"it"`: it is the product's (Costì), served before any sign-in (Q5).
  - `public/sw.js`'s offline page keeps `lang="it"` (out of scope).
- **H26:**
  - `prompt.ts:4` → "…as the purchasing assistant of an Italian food business".
  - `prompt.ts:14–15` → "…the buyer (the cessionario/committente, the business receiving the invoice)…".
  - `:23` stays Italian (the invoices are Italian, FD19).
  - `EXTRACTION_MODEL_ID` handling, the output schema and `client.ts` are untouched.
  - `prompt.test.ts` keeps its five assertions and adds one: no venue-type word,
    `/restaurant|ristorante|osteria|trattoria|pizzeria|\bbar\b|caff[eè]|café|coffee/i`.
  - The M3 recorded-response fixtures replay unchanged, because they do not hash the prompt (`extract.test.ts:116` compares to the
    constant).
- **H32:**
  - `checkNewPassword(password, { email, venueNames: string[] })`. The words derive from each name: NFKC, accents removed, split into
    words.
  - Refused: every word of ≥ 4 letters; the joins of every run of ≥ 2 consecutive words, only when the join has 4 or more letters, the same floor as a single word (lead ruling on PR #187, 2026-11-18); and the reverse join of the first and last
    significant word.
  - The constants at `:13–16` go.
  - `password-change.ts:102` passes the current tenant's name, read through RLS (`from("tenant").select("name")`).
  - For tenant #1's name, the derived set is a **superset** of today's six strings (G for H32; it adds "osteriadei").
  - SP2 may pass every membership's name (noted for SP2, Q8).

### 3.7 Sequences

- **Owner changes the sale list of B** to `[10, 22]`:
  1. `PATCH /api/settings/venue` → `set_tenant_settings` → rows 0/4/5 set inactive, one audit row.
  2. `menu_items_manage` now lists `[10, 22]`.
  3. A menu price at 4 % is refused by the trigger (`P0001 vat_rate_invalid` → 422).
  4. An open session's coperto stays at its snapshot.
  5. Supplier invoices of B at 4 % are not flagged (statutory `line_checks`).
- **Waiter closes a table at B** where `fattura` is inactive:
  1. The close sheet shows `scontrino` only (`/api/me` settings).
  2. A forged `fattura` passes the catalogue check, then meets the tenant check → 422 `receipt_type_invalid`, nothing written.
- **Page load:** module load reads `localStorage` → first render with the last known settings → `/api/me` → `applyVenueSettings` →
  later renders and navigations use the fresh values.

### 3.8 Pins that move (each with the comment "re-pinned on purpose by SP1")

| File:line (main) | Kind | Change | Step |
|---|---|---|---|
| `supabase/tests/database/327_p20b_preserves.test.sql:20` `close_session_at`, `:21` `app_vs_register_json`, `:37` `sale_settings_read` | "unchanged" md5 | new values (builder computes) | 6, 6, 4 |
| same `:125–128` | public catalogue md5 (182) | add `tenant_settings`, `set_tenant_settings` to the left-out names | 7 |
| `346_p21_preserves.test.sql:64–68` | public catalogue md5 and count 197 | same left-outs on both lines | 7 |
| `229_m19b_preserves.test.sql:72–73` | public names md5 | same left-outs | 7 |
| `359_p22_preserves.test.sql` `p27_objs` | additions since main | **a separate `insert into p27_objs values …;` placed right after `:21`** (before main's insert at `:22`), so SP2's edits at `:36–50` do not touch adjacent lines. Rows: `table` `tenant_vat_rate`, `tenant_close_code`; `column` `tenant.default_locale`; `constraint` `tenant.tenant_default_locale_check`; `trigger` `menu_item_price.menu_item_price_sale_vat`, `sale_settings.sale_settings_sale_vat`, `tenant.tenant_seed_settings`; `app_fn` `sale_vat_rates`, `check_sale_vat_rate`, `seed_tenant_settings`, `tenant_receipt_types`, `tenant_payment_types`; `public_fn` `tenant_settings`, `set_tenant_settings`. All 359 values stay | 3, 5, 7 |
| `229_m19b_preserves.test.sql:40`, `240_m22_preserves.test.sql:30, :33`, `286_m25c_preserves.test.sql:11, :23`, `296_reservations_preserves.test.sql:11, :16`, `301_reservations_public_preserves.test.sql:11, :16` | "unchanged" `md5(prosrc)` of `app.close_session_at` and `app.app_vs_register_json` | new values, each commented "re-pinned on purpose by SP1 (step 6; was <old>)" (found by the step-6 build; lead ruling 2026-11-18) | 6 |
| `365_p27_roles_preserves.test.sql:127` tables | count | 71 → 73 | 3, 5 |
| same `:130` triggers | count | 127 → 130 | 3 |
| same `:135` policies | count | 72 → 74 | 3, 5 |
| `286_m25c_preserves.test.sql:51–52` | public table list | add `tenant_close_code`, `tenant_vat_rate` | 3, 5 |
| `194_demo_purge_tables_complete.test.sql` test 1 | "every table with a tenant_id is in the purge list" | exact-list exemption of configuration tables: `tenant_vat_rate` (step 5 adds `tenant_close_code`); purge functions and 359's md5 pins untouched; 193 gains one assertion that a purge keeps `tenant_vat_rate` (plan 89 to 90). Added by the builder, lead-approved 2026-11-18 | 3, 5 |
| `207_dashboard_preserves` t16, `214_m20_preserves` t14, `229_m19b_preserves` t27, `296_reservations_preserves` t25 | public table list | add `tenant_vat_rate` (step 5 adds `tenant_close_code`), commented "re-pinned on purpose by SP1". Missed by the first draft of this plan, lead-approved 2026-11-18 | 3, 5 |
| `tests/config/m25-preserves.test.ts:23`, `m25a-preserves.test.ts:29`, `ux-quick-wins-preserves.test.ts:13` | newest migration | each SP1 file in turn, last `20261206200400_tenant_locale_settings.sql` | each migration step |
| `tests/config/m25b-preserves.test.ts:177` | `ALLOWED_NEW_MIGRATIONS` | append each SP1 file | same |
| `tests/config/ds-bq2-preserves.test.ts:17` and self-test `:48–58` | the `20261206*` claim | narrow the filter to `startsWith("2026120610")` (DS-BQ-2's own hour); the self-test gains a `20261206200000_x.sql` file that must be ignored. **Needs the lead's ratification** | 3 |
| `tests/parity/tables-sql-parity.test.ts:11, 108` | constant name | `VAT_RATES` → `STATUTORY_VAT_RATES` (same assertion) | 10 |
| `tests/parity/close-sql-parity.test.ts` | parity | unchanged cases plus: the seed in `20261206200200_…` lists exactly `RECEIPT_TYPES` and `PAYMENT_TYPES` in order; `FIRST_PAINT_VENUE_SETTINGS` lists equal the catalogue | 5, 8 |
| `tests/guards/waiter-weight-no-cost.test.ts:123–128` | `/api/me` fixture | add the `tenant_settings` RPC result; `poisoned` becomes a reply with `settings.vatRates` injected, which the strict output must refuse (a stronger check, not weaker) | 9 |
| same route list | cost guard | add `PATCH /api/settings/venue` | 13 |

**Must pass unchanged:**
- pgTAP 150 (a rate of 12 % still meets the CHECK, 23514: the trigger lets non-statutory rates fall through), 001, 002, 003, 005, 021 (statutory list), 085, 151, 153, 154, 215, 220, 321, 341, 342, 346:12 (hook), 359 values, 386, 388.
- `tests/parity/review-sql-parity.test.ts`; `tests/lint/offline-cache-allowlist.test.ts`; `tests/config/sp3-preserves.test.ts` (the
  wordmark and `venue.name` are untouched).
- Every prefix-scoped preserves test; `tests/server/extraction/*`.

**Any other failing pin is a stop: report it to the lead, do not re-pin it silently.**

### 3.9 Security, privacy, RLS

- **Tenant boundary:**
  - Both new tables carry `tenant_id`, RLS on, select-only policies scoped by `app.tenant_id()`, and no write grants (pgTAP 001 and 346:94
    cover them).
  - The trigger and the seed read `new.tenant_id`, never a client value.
  - X (step 2) proves B reads 0 rows of A in both tables and that B's `set_tenant_settings` cannot touch A.
- **Who writes:** owner and admin only, through `app.require_menu_writer()`, which carries #79's gate: `aal2` per the tenant's
  `mfa_enforcement`, and always for `admin` (FD31). Chef and waiter get 42501, and their routes 403 (pgTAP and route tests, steps 7, 13).
- **Audit:** one `tenant.settings_changed` row per effective change, codes and numbers only, visible on `/registro` with today's label.
  DigiAlto's actions show as such once SP4 lands.
- **Waiters never see costs:** `/api/me` gains no VAT or money key. Its new strict output schema refuses one (cost guard, step 9). The VAT
  lists stay in owner/admin reads.
- **Input validation:** strict Zod body with an unknown key → 400; SQL repeats every check (Data API callers bypass Zod); arrays capped
  (20); no free text is stored.
- **Personal data:** none added. The password check uses the business name, in memory only. `localStorage["venue-settings"]` holds no
  person data and is cleared by `forgetUser()`.
- **Secrets:** none new. The extraction model ID stays in `EXTRACTION_MODEL_ID` and the extraction API key stays in the hosting
  environment, both unchanged. The Supabase secret key is not used by anything SP1 adds.
- **ADR-039 later:** `set_tenant_settings` is a volatile, authenticated-executable function, so SP6's write-gate catalogue test will
  require it to call `app.require_writable()`. No SP1 action is needed.

### 3.10 Coexistence with SP2 (draft PR #131) and the SP3 stack; migration range

**Who adds what to `/api/me`:**
- SP1 adds the top-level key `settings` (and the strict output schema, `src/server/me/output.ts`).
- SP2 S6 adds the top-level key `tenantCount` and replaces the row query with a tenant-filtered one.
- When SP2 rebases onto SP1, it adds `tenantCount` to SP1's output schema (one line) and its query change touches the select (`:14–18`),
  not SP1's lines after it.
- Client type `Me`: SP1 adds `settings?: VenueSettings` (`use-me.ts:7–10`); SP2 adds `tenantCount`. SP2's built edits are at `:17–18`,
  `:27` and `:52–54` (`MeState`, the 409 branch). SP1's call goes into `start()`, which SP2 does not touch.
- SP1's route test is `tests/app/api/me-settings.test.ts`, never SP2's planned `tests/app/api/me-route.test.ts`.

**Merge order:** SP1 → `main` first; then SP2 rebases; then the SP3 stack rebases onto SP2. SP1 needs no SP0 verdict, while SP2 and the
stack wait for the hosted run, so this is also the natural order.

**Expected conflicts on SP2's rebase (resolution rule: add, never overwrite):**

| File:line | Resolution |
|---|---|
| m25 / m25a / ux-quick-wins newest-migration constant | SP2's value (its file is newer) |
| m25b list | keep SP1's lines, then SP2's |
| 365 `:127`, `:130` | SP1's value + SP2's increment (73 → 74, 130 → 131) |
| 327, 346, 229 left-out lists | union |
| `src/app/api/me/route.ts` | both keys |
| `tests/guards/waiter-weight-no-cost.test.ts` route list | union |

The SP3 stack applies the same rules to the same pins after SP2.

**Guards checked:**

| Guard | Effect of SP1 |
|---|---|
| SP2's `sp2-preserves` | asserts the `20261207*` files and that they sort after `20261206100000`: unaffected |
| `sp3-preserves` on main | wordmark and console files: unaffected |
| SP3 stack's migration list (`2026120810*`) | unaffected |
| `ds-bq2-preserves` | the one blocker; narrowed in step 3, with ratification |
| m25* pins | moved by SP1, then by SP2 |

**Migration range `20261206200000`–`20261206200400`, why:**
- It is after main's newest (`20261206100100`) and before SP2's `20261207100000`.
- Any number between those two either starts with `20261206` (claimed by `ds-bq2-preserves:17`) or with `20261207` (claimed by SP2's
  `sp2-preserves`, which lists every `20261207*` file exactly). **No range fits cleanly.**
- Narrowing DS-BQ-2's guard to its own hour is a one-line, main-only change. Narrowing SP2's guard would edit an open PR.
- The evening hour (`20`) leaves room for review fixes (`2026120620xxxx`) without touching `2026120610*`.

**Staging:** `deploy-staging.yml:91, 98` runs `supabase db push` on `main` without `--include-all`. A local migration older than the
newest one applied remotely is refused unless `--include-all` is given (source S1). So if SP2 or the stack reached `main` first, SP1 must
renumber (V1).

### 3.11 Gating

| Gate | SP1 steps |
|---|---|
| now (main) | all, 0–18 |
| T1.H, T2.H, T3.H, T5.H | none |
| T4.H numbers | none |
| T4.H **isolation fail** | stop all merges (SP0 §8 line 604), SP1 included |
| SP2 merged before SP1 | V1 (renumber) |

---

## 4. Alternatives considered

- **A per-tenant VAT list inside the CHECKs:** a CHECK must not read a table, and the purchase side needs the statutory list anyway.
  Rejected (platform plan §9).
- **Re-create the menu procedures and `set_sale_settings` to check the tenant list** (the platform plan's wording): an earlier error,
  before other validation. But the trigger already refuses with the same code in the same transaction, for every writer including the
  demo seed and table-owner inserts, and re-creating them moves three md5 pins (327:36, :49, :50) for no behaviour gain. Rejected.
- **`vatRates` in `/api/me`:** one place for every setting. But it breaks the waiter cost guard (`/vat/i`), and the owner forms already
  receive the list. Rejected (Q3, V4).
- **Absent rows mean the default list** (no seed trigger): no trigger, no backfill. But the rule is implicit, "remove every rate" becomes
  ambiguous, and SP7 would still need explicit rows. Rejected for the seed trigger.
- **A zone parameter threaded through every view module and component:** explicit everywhere. But it touches ~40 view files and their
  components for a value that is identical for every tenant until SP7 (FD19). Rejected for the client store with an explicit zone on the
  server.
- **A React context for the settings:** idiomatic. But it forces every view call site into a hook and puts settings logic in the
  component tree. Rejected.
- **A zone field in the reservation mail and public payloads (H10):** matches the brief's wording. But the date is already local, and UTC
  at noon is exact. Rejected (Q4).
- **Free-text receipt and payment codes per tenant:** flexible. But it needs labels per tenant (SP9) and would loosen the
  `table_session` CHECKs. Rejected (Q6, V6).
- **Number SP1 inside `20261207000000–20261207095959`:** it would leave DS-BQ-2's guard alone, but it breaks SP2's exact `20261207*` list
  in an open PR. Rejected.
- **A new audit action `tenant_config.changed`:** a clearer name, but it moves the audit CHECK pins in 286, 327 and 346.
  `tenant.settings_changed` already means exactly this. Rejected.

---

## 5. Build plan

**Rules for all steps:**
- Test first: write the named test, see it fail for the stated reason, then change the code. One commit per step.
- Every step ends with `npm run lint`, `npx tsc --noEmit`, `npm test`, `npx supabase test db` green.
- Each migration step moves the newest-migration pins (§3.8) and adds its file to `tests/config/sp1-preserves.test.ts` (created in
  step 3). That test asserts:
  - the `20261206200*` files are exactly the steps built so far and sort between `20261206100100` and `20261207100000`;
  - they create or replace only the objects of §3.2;
  - they never re-create `app.tenant_id`, `app.role`, `app.app_user_id`, `app.custom_access_token_hook`, `app.allowed_vat_rates`,
    `app.line_checks`, `app.menu_vat`, `public.create_menu_item`, `public.update_menu_item`, `public.set_sale_settings`;
  - never `drop … cascade`, never `delete from`;
  - no new public name matches `cost|margin|price|service`.

| # | Step (one commit) | Files | Test that proves it (the first one fails first) |
|---|---|---|---|
| 0 | **Base check (no commit).** Confirm main's newest migration and pgTAP; confirm no `20261206200*` file and no pgTAP ≥ 389 on any open branch the lead knows of | — | All suites green; the newest migration is `20261206100100_device_enrolment_code_hash_comment.sql` |
| 1 | **G: tenant #1 golden payloads** (characterization; §6.5 rule 5) | `supabase/tests/database/389_sp1_golden_tenant1.test.sql` | Built on `main` before any SP1 change, with a tenant-#1-shaped fake fixture (coperto on, five rates, two receipt and three payment codes, fixed clock, inserted as table owner). Pins `md5(jsonb::text)` of `menu_list()`, `menu_items_manage()`, `sale_settings_read()`, `tables_list()`, the bill (`app.session_bill_json`), the day report (`app.app_vs_register_json`), as called by their own pgTAP files (153, 154, 215). **Passes on main by design.** Its proof is a mutation case in the same file (one price changed → the menu md5 differs), which must fail when the pin is wrong. Stays green, unchanged, through step 18 (AT6) |
| 2 | **X: cross-tenant suite on Demo A/B** (§6.5 rule 4) | `390_sp1_cross_tenant.test.sql` | Fixture "Osteria Demo A" (coperto 2,50 at 10 %) and "Osteria Demo B" (no coperto), owners on `example.test`. A catalogue loop over every `public` table with `tenant_id`: as B's owner, A's rows read 0; an insert with A's `tenant_id` → 42501 or RLS violation. Passes on main by design; its mutation case grants B a read on A in a temp policy and must fail. Later steps add rows to the fixture (B's list `[10, 22]` from step 3) |
| 3 | **Sale VAT list, trigger, seed** (§3.1.1, §3.1.4, §3.2) | `supabase/migrations/20261206200000_tenant_sale_vat.sql`; `391_sp1_sale_vat.test.sql`; `396_sp1_preserves.test.sql` (new); `tests/config/sp1-preserves.test.ts` (new); `ds-bq2-preserves.test.ts:17, 48–58`; 359, 365, 286 rows; newest-migration pins | **391 first test: "tenant B with sale list [10, 22] refuses a direct `menu_item_price` insert at 4 % with P0001 `vat_rate_invalid`" (fails: the row is accepted).** Then (AT1): <br>• `create_menu_item` at 4 % for B → the same code; for A → accepted; <br>• `set_sale_settings` coperto at 4 % for B → refused, for A → accepted; <br>• a direct `sale_settings` insert at 4 % for B → refused; <br>• an `invoice_line` of B at 4 % → `app.line_checks` gives no `vat_rate_unexpected`; <br>• inserting rate 12 into `tenant_vat_rate` → 23514; <br>• an open `table_session` of B keeps `coperto_vat_rate` 4 after 4 is deactivated, and still closes; <br>• a new tenant gets five active rates; existing tenants are backfilled; <br>• RLS and grants as §3.1.1; the two functions are closed to API roles. <br>**396 first test:** "no CHECK constraint in `public` or `app` depends on a function that is not immutable" (via `pg_depend` between `pg_constraint` and `pg_proc`); fails if a constraint ever calls `sale_vat_rates`. Then: no write grant on either new table. **Vitest `sp1-preserves`:** the file-list rules of §5 |
| 4 | **Default rate and sale reads on the tenant list** | `…20261206200100_sale_vat_reads.sql`; `392_sp1_sale_vat_reads.test.sql`; 327 `:37` | **392 first test: "`menu_items_manage()` for B lists `vatRates` [10, 22]" (fails: five).** Then: `sale_settings_read()` the same; `default_vat_rate` for B with `sale_vat_pct` 4 → null, with 10 → 10; for A unchanged (151:163–165 green); G (389) unchanged |
| 5 | **Receipt and payment codes per tenant** (§3.1.2) | `…20261206200200_tenant_close_codes.sql` (table, helpers, seed fn re-created, backfill); `393_sp1_close_codes.test.sql`; `close-sql-parity.test.ts`; 359, 365, 286 rows | **393 first test: "a new tenant gets receipt codes [scontrino, fattura] and payment codes [cash, card, other] in that order" (fails: table missing).** Then: `tenant_receipt_types(B)` follows `position` and skips inactive codes; a code outside the catalogue → 23514; RLS and grants. **Parity:** the seed lists equal `RECEIPT_TYPES` / `PAYMENT_TYPES`; `scripts/spike/sp00/sql/04_t4.sql` adds `tenant_close_code` to `c_seeded` (the clone's own insert seeds it; SP0 self-check D3, found on #173) |
| 6 | **Close and day report on the tenant lists** | `…20261206200300_close_with_tenant_codes.sql`; `394_sp1_close_codes_procs.test.sql`; 327 `:20, :21` | **394 first test: "`close_table` for B with `fattura` inactive → P0001 `receipt_type_invalid`, the session stays open" (fails: it closes).** Then: an unknown payment code still fails first with the catalogue check (error order unchanged); a replay of a session closed with `fattura` before deactivation → `changed: false`; `app_vs_register_json` for B lists its active codes in order and still shows a deactivated code used that day; for A identical to 389's pin; 215 and 220 green |
| 7 | **Locale, `tenant_settings`, `set_tenant_settings`** (§3.1.3, §3.3) | `…20261206200400_tenant_locale_settings.sql`; `395_sp1_tenant_settings.test.sql`; 327 `:125–128`; 346 `:64–68`; 229 `:72–73`; 359; `tests/parity/locale-sql-parity.test.ts` (new) | **395 first test: "`tenant_settings()` as B's waiter returns exactly the keys timeZone, locale, currency, receiptTypes, paymentTypes" (fails: function missing).** Then: <br>• no key matches `/vat|cost|price/`; <br>• without a tenant → 42501; <br>• `set_tenant_settings` as owner at `aal2` changes the locale and lists and writes one `tenant.settings_changed` row; a second identical call → `changed: false`, no row; <br>• as chef or waiter → 42501; an owner with a verified factor at `aal1` under `required` → gated (#79); an admin at `aal1` → gated (FD31); <br>• empty list → `settings_list_empty`; duplicate, out-of-catalogue or out-of-statute value → its code; unknown key → 22023; <br>• B cannot change A (X row); the audit row holds no `@` and no name; <br>• both functions are definers with an empty `search_path`, executable by `authenticated` only; 341 green unchanged. <br>**Parity:** the CHECK list equals `LOCALES` |
| 8 | **Venue settings module and formatter zone** (§3.4; AT2) | `src/lib/venue/settings.ts`, `src/lib/venue/current.ts` (new); `src/lib/time/format.ts`; `src/lib/time/venue-date.ts`; `src/lib/money/format.ts`; `src/lib/i18n/index.ts`; `tests/lib/time.test.ts`; `tests/lib/venue/current.test.ts` (new); `tests/lib/money/format.test.ts` | **First test: "`formatDateTime(2026-07-01T10:00Z, 'it', 'Europe/Lisbon')` renders 11:00" (fails: the argument is ignored, 12:00).** Then: <br>• the M0 DST cases (2026-10-25, 2027-03-28) are unchanged with the default (AT2); <br>• `venueDate` with a zone; the cache keys by zone (two zones in a row stay distinct); <br>• the store returns the first-paint settings (`FIRST_PAINT_VENUE_SETTINGS`, the one sanctioned default) on the server even after `apply`, and `tests/guards/first-paint-defaults.test.ts` pins that only `settings.ts` and `current.ts` name it (simulated `window` absent); in the browser, `apply` → read, and `reset` → defaults and the `localStorage` key removed; a corrupt `localStorage` value → treated as absent and reported (`reportError`), the store stays unfilled (Lead ruling 2026-11-18 (Rule B): no silent settings defaults; the only sanctioned default is the formatter's before the store is filled); <br>• `t()` follows the store's locale; <br>• `venueSettingsSchema` refuses currency `USD`, an unknown zone, an empty list |
| 9 | **`/api/me` settings and the client store wiring** (§3.4) | `src/app/api/me/route.ts`; `src/server/me/output.ts` (new); `src/components/use-me.ts`; `src/components/forget-user.ts`; `tests/app/api/me-settings.test.ts` (new); `tests/components/use-me.test.ts`; `tests/guards/waiter-weight-no-cost.test.ts` | **First test: "GET /api/me answers today's keys plus `settings` from the `tenant_settings` RPC" (fails: no key).** Then: <br>• old keys unchanged; still offline-cacheable for owner, admin, waiter, not chef; an RPC error → 500 reported with the code only; <br>• the strict output refuses an injected `settings.vatRates` (guard `poisoned` case); <br>• `use-me`: an ok reply applies the settings, one without `settings` (old cache) or with malformed `settings` is the `error` state, reported, store unfilled (Lead ruling 2026-11-18 (Rule B): no silent settings defaults; the only sanctioned default is the formatter's before the store is filled), `resetMe` resets; <br>• `forgetUser` resets the store |
| 10 | **Close sheet and VAT forms read their payloads** (H15, H20 client) | `src/lib/bill/close-form.ts`; `src/app/(owner)/tavoli/comanda/close-sheet.tsx`; `src/server/menu/constants.ts`; `src/server/menu/schemas.ts`; `src/lib/menu/menu-form.ts`; `src/lib/tables/coperto-form.ts`; `tests/lib/bill/close-form.test.ts`; `tests/lib/menu/menu-form.test.ts`; `tests/lib/tables/coperto-form.test.ts`; `tests/parity/tables-sql-parity.test.ts` | **First test: "`closeOptions(me)` with receiptTypes ['scontrino'] offers only scontrino" (fails: helper missing).** Then: missing settings → no options and a visible message, never the catalogue (Lead ruling 2026-11-18 (Rule B): no silent settings defaults; the only sanctioned default is the formatter's before the store is filled); the menu form refuses a *new* 4 when given `vatRates` [10, 22] and accepts 10; **Q12 note:** an existing price stored at 4 % with `vatRates` [10, 22] shows 4 % as its current option, and saving the item unchanged keeps 4 % (no silent change); the coperto form the same; `STATUTORY_VAT_RATES` parity unchanged in value; component test: the close sheet renders the options given |
| 11 | **Server sites pass the tenant zone** (§3.5) | `src/lib/api/with-api.ts`; the twelve server files of §2; `src/lib/csv/write.ts`; `src/server/alerts/templates.ts`; `tests/guards/server-zone-explicit.test.ts` (new); `tests/lib/api/with-api-settings.test.ts` (new) | **First test: the scanner "flags a fixture file under a fake `src/server/` that calls `venueDate(now)` without a zone" (fails: scanner missing).** Then: the real tree passes; `tenantSettings()` calls the RPC once per request and never when unused (spy); `payables/detail` with a Lisbon fixture gives Lisbon's day at 23:30 UTC; existing export and alert tests green |
| 12 | **No `Europe/Rome` literal; H10; H13** (AT3) | `src/lib/reservations/public-view.ts`; `src/server/reservations/mail/render.ts`; `src/app/layout.tsx`; `src/app/global-error.tsx`; `src/lib/platform/api.ts:190`; `src/lib/venue/current.ts` (`lang`); `tests/guards/no-zone-literal.test.ts` (new); `tests/lib/reservations/public-view.test.ts`; `tests/server/reservations/mail/render.test.ts` | **First test: the scanner "finds no `"Europe/Rome"` or `'Europe/Rome'` string-literal token in `src/` outside `src/lib/venue/settings.ts`" (TypeScript scanner, string literals and template heads only, so comments are not matched)** (fails today: 7 files). Then: <br>• `VENUE_TIME_ZONE` importers only under `src/lib/console/**` and `src/lib/time/**`; <br>• `dayLabel` and `whenLabel` give the same strings as today for 2026-03-29 and 2026-10-25 in both locales; <br>• `applyVenueSettings({locale: "en"})` sets `document.documentElement.lang` to `en`; <br>• the root layout still renders `lang="it"` (`tests/app/root-metadata.test.ts` green) |
| 13 | **`PATCH /api/settings/venue`** (§3.3) | `src/app/api/settings/venue/route.ts` (new); `src/server/venue-settings/{schemas,settings,errors}.ts` (new); `src/lib/api/errors.ts`; `src/lib/i18n/messages/it.ts`, `en.ts`; `tests/app/api/settings-venue.test.ts` (new); cost-guard route list; `docs/go-live/rate-limits.md` only if `tests/config/rate-limits-doc.test.ts` requires a row for every write route | **First test: "an owner's PATCH with `{saleVatRates: [10, 22]}` calls `set_tenant_settings` once and answers 200 with `changed: true`" (fails: route missing).** Then: chef and waiter → 403 before any RPC; `{extra: 1}` → 400; no JSON content type → 415; each P0001 code → 422 with its Italian text; 42501 → 403; the answer holds `saleVatRates` (owner/admin route) and nothing cost-like besides it; the API is not offline-cacheable |
| 14 | **Venue-neutral extraction prompt** (H26; AT4) | `src/server/extraction/prompt.ts`; `tests/server/extraction/prompt.test.ts` | **First test: "SYSTEM_PROMPT contains no venue-type word" (the regex of §3.6) (fails: "restaurant" twice).** Then: the five existing assertions; `extract.test.ts` and the M3 recorded-response and injection fixtures green unchanged; no file mentions a model ID literal (existing guard) |
| 15 | **Password words from the tenant's name** (H32; AT5) | `src/lib/auth/password-policy.ts`; `src/server/auth/password-change.ts`; `tests/lib/auth/password-policy.test.ts`; `tests/app/api/me-password.test.ts` (corrected 2026-11-18: the file built) | **First test: "with `venueNames: ['Osteria Demo B']` the password 'DemoB-cucina-2026' is refused `like_venue`" (fails: only tenant #1's words are refused).** Then: <br>• "Osteria2026!sole" passes for a name without "osteria" (e.g. 'Trattoria Da Luigi'), and 'Rossi-cucina-2026' passes for 'Osteria Demo B' (corrected 2026-11-18 to what was built; the old line said "Osteria2026!sole" is not refused for B, which §3.6 contradicts: "osteria" is a word of that name); <br>• every word refused today is still refused for `['Osteria Dei Rossi']` (G for H32); <br>• accent, full-width and zero-width cases as today; <br>• `changePassword` reads the tenant's name once and passes it |
| 16 | **Review sweep of the seeds and payloads** (AT6) | `389` (unchanged); `tests/parity/close-sql-parity.test.ts`; `tests/parity/review-sql-parity.test.ts` (unchanged) | 389 green with its step-1 values; the parity files green; `npx supabase db reset` and the demo seed (`begin_demo_data`, VAT 10 %) succeed for a fresh tenant |
| 17 | **ADR and runbook** | `docs/adr/adr-046-per-tenant-sale-lists.md` (next free number on main; the two-list VAT design and the per-tenant code lists, recording that the founder may revisit); `docs/runbook.md` ("Venue settings": how to change a list by the route; what removing a VAT rate does to open sessions and existing prices) | `tests/config/runbook.test.ts` green; ADR template fields present |
| 18 | **Integration, e2e, verification, hand-off** | `tests/integration/tenant-settings.int.ts` (new); `e2e/venue-settings.spec.ts` (new) | **Integration (local stack):** Demo B's owner sets `[10, 22]` → the menu form payload lists two rates → a 4 % price → 422. **Playwright:** tenant #1 fixture: the close sheet shows "Scontrino"/"Fattura" and the three payments as today; Demo B with `fattura` inactive shows one receipt option; `document.documentElement.lang` is `it` for both. Full suites green; coverage of new code ≥ 80 %; `code-reviewer` PASS; AT1–AT6, G and X mapped to passing tests in the PR description |

**Acceptance tests → steps:**

| Test | Steps |
|---|---|
| AT1 | 3 (trigger, procedures, invoices, statute, open session), 396 in step 3 (catalogue), 4 (reads) |
| AT2 | 8 |
| AT3 | 12 |
| AT4 | 14 |
| AT5 | 15 |
| AT6 | 1 (G pins), 4 and 6 (G stays green), 5 and 16 (parity) |
| G | 1, kept by 3–16 |
| X | 2, extended in 3, 5, 7 |

**Order that keeps tenant #1 working at every commit:**
- 1–2 add tests only.
- 3–7 are additive, seeded to today's values, and G-proven.
- 8–12 keep defaults equal to today's.
- 13 adds a route nobody calls.
- 14–15 change wording and a superset of refused words.

### 5b. Variants

**V1 — SP2 (or the SP3 stack) reaches `main` before SP1** · Trigger: a `20261207*` or later file is on `main` before SP1 merges ·
Replaces: the migration names of steps 3–7, the `ds-bq2` narrowing of step 3 and the range rule of `sp1-preserves`.

| # | Step | Files | Test |
|---|---|---|---|
| V1.1 | Rename the five migrations to the first free day after main's newest (e.g. `2026120900xxxx` if SP3's `20261208*` is on main) | the five files; newest-migration pins; `sp1-preserves.test.ts` | `sp1-preserves`: SP1's files sort after every other file on `main`; `ds-bq2-preserves.test.ts` unchanged from main |
| V1.2 | Recompute the counts SP2/SP3 moved (365, 359 additions) on top of theirs | 365, 359, 286 | the same pgTAP files green on the merged tree; `supabase db push --dry-run` on staging lists only SP1's files |

**V2 — A settings screen now** · Trigger: Q1 answered "screen now" · Replaces: nothing (adds after step 13).

| # | Step | Files | Test |
|---|---|---|---|
| V2.1 | `/impostazioni/locale` (owner/admin): language, sale VAT rates, receipt and payment choices, through `PATCH /api/settings/venue`; the read is a new `GET /api/settings/venue` returning `set_tenant_settings`'s answer shape from `tenant_settings()` plus `saleVatRates` | `src/app/(owner)/impostazioni/locale/page.tsx`; route `GET`; `m25b-preserves` page lists; nav model | component tests (a removed rate shows the open-session note); `GET` role test (chef/waiter 403); `m25b-preserves` page count moved on purpose; Playwright: owner removes 4 %, the menu form no longer offers it |

**V3 — No write path in SP1 (seed only)** · Trigger: Q1 answered "seed only until SP7" · Replaces: step 13 and the
`set_tenant_settings` part of step 7.

| # | Step | Files | Test |
|---|---|---|---|
| V3.1 | Step 7 creates only `tenant.default_locale` and `tenant_settings()` | migration of step 7; `395_…` | 395 without the write cases; `set_tenant_settings` does not exist |
| V3.2 | AT1's "B removes a rate" and X's B list are set as table owner in pgTAP | `391_…`, `390_…` | the same assertions pass with owner-level fixture updates |

**V4 — `vatRates` in `/api/me` for owner and admin** · Trigger: Q3 answered "include" · Replaces: the `/api/me` shape of step 9.

| # | Step | Files | Test |
|---|---|---|---|
| V4.1 | `tenant_settings()` adds `saleVatRates` only when `app.role()` is owner or admin; the route's output allows it only for those roles | migration of step 7; `src/server/me/output.ts` | 395: a waiter's answer has no VAT key, an owner's has it; the cost guard (waiter) green; an owner's `/api/me` is still offline-cacheable |

**V5 — The founder revisits the two-list design: one per-tenant list for both sides** · Trigger: the founder decides supplier invoices
follow the tenant's list · Replaces: AT1's invoice clause and the "not re-created" status of `app.line_checks`.

| # | Step | Files | Test |
|---|---|---|---|
| V5.1 | `app.line_checks` gains `p_tenant` and flags rates outside `app.sale_vat_rates(p_tenant)`; its callers pass the tenant | new migration; 021 re-pinned on purpose; 365's unchanged list re-pinned | 021: B's 4 % line is flagged `vat_rate_unexpected`; A's is not; `review-sql-parity` changes on purpose |

**V6 — Venue-specific payment codes** (e.g. meal vouchers) · Trigger: Q6 answered "custom codes" · Replaces: the catalogue CHECK of
§3.1.2.

| # | Step | Files | Test |
|---|---|---|---|
| V6.1 | Add the founder-named codes to `app.payment_type_codes()` and `PAYMENT_TYPES` with labels in both catalogues; tenants opt in through the list | new migration; `src/server/bill/constants.ts`; `it.ts`, `en.ts` | close-sql-parity green with the new list; 393: a new tenant's seed still lists only today's three (the new code is opt-in); a close with the new code at a tenant that offers it succeeds |

---

## 6. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | A seed or backfill gap leaves a tenant with no sale rates, so every menu write fails | seed trigger plus backfill in the same migration; 391 asserts every existing tenant has five rates after the migration; `set_tenant_settings` refuses an empty list |
| R2 | A rate removed while menu prices use it | a price edit that keeps the stored rate is accepted; setting that rate fresh is refused (vat_rate_invalid); runbook note (step 17); Q12, Q-a |
| R3 | An offline-cached `/api/me` from before the deploy has no `settings` (`sw.js:24`, unversioned cache) | `settings` required on the client; a reply without it is an `error` state, reported, never defaulted (lead ruling 2026-11-18, Rule B); test in step 9. Open for the lead: an offline waiter whose only cached `/api/me` predates the deploy sees the error until one online `/api/me` |
| R4 | First render on a new device for a non-default tenant formats with the defaults until `/api/me` answers | `localStorage` warm start; no tenant has non-default zone or locale before SP7 (FD19); later navigations use the store |
| R5 | A server path forgets the zone | scanner of step 11; the server store always returns defaults, so a miss is today's behaviour, never another tenant's value |
| R6 | Out-of-order migrations on staging if SP2 lands first | merge order (§3.10); V1; `db push --dry-run` in `deploy-staging.yml:91` shows it before apply |
| R7 | Rebase conflicts in shared pins (365, 359, 327, 346, 229, m25*) | separate `p27_objs` insert; resolution rules of §3.10 written into the PR description for SP2's builder |
| R8 | Security: a tenant writes another tenant's settings, or a waiter changes lists | definers resolve the tenant from the token; owner/admin only through the gated helper; X and 395 prove it; no table write grants |
| R9 | Security: VAT or another cost-adjacent key leaks to waiters through `/api/me` | no VAT key; strict output; cost guard with a poisoned case (step 9) |
| R10 | Locale `en` shows untranslated strings | the `en` catalogue is complete today (key-parity tests); `en` is reachable only through `set_tenant_settings` by an owner |

**Secrets:** none added or moved (§3.9).

---

## 7. Open questions for the lead / founder

| # | Question | Default (applies unless answered) |
|---|---|---|
| Q1 | Is tenant configuration editable in the app now, or only seeded until SP7's wizard? | SQL procedure and `PATCH /api/settings/venue` now, **no screen**; the screen comes with SP7 (V2 = screen now; V3 = seed only) |
| Q2 | May an owner change the time zone? | No. Set at provisioning (SP7) or by migration; Italy only (FD19). Changing it moves future business-day boundaries |
| Q3 | Should `/api/me` carry `vatRates` as the platform plan says? | No: the waiter cost guard forbids `vat` keys; owner forms get the list from their reads (V4 otherwise) |
| Q4 | H10: format the calendar date in UTC instead of adding a zone to the mail and public payloads? | Yes (identical output, no payload change) |
| Q5 | The manifest's `lang` (H13): per tenant? | No: the manifest is Costì's, served before sign-in; per-host manifests are SP9 |
| Q6 | May a tenant add payment or receipt codes outside today's catalogue? | No: subset and order only; new codes are a migration plus labels (V6) |
| Q7 | Ratify narrowing `ds-bq2-preserves` to `2026120610*` so SP1 can use `20261206200000`–`20261206200400`, and the merge order SP1 before SP2 | Yes (§3.10; V1 if SP2 lands first) |
| Q8 | Password words: the current tenant's name only, or every membership's name once SP2 lands? | Current tenant in SP1; SP2 passes all memberships' names (a one-line change it owns) |
| Q9 | Locale per tenant or per person? | Per tenant (`tenant.default_locale`); per-person is a later item |
| Q10 | Write ADR-046 (two lists; per-tenant sale and close lists) as step 17? | Yes, by the architect; status "proposed" |
| Q11 | VAT two-list design (founder may revisit) | Stands as platform plan §0a; V5 if revisited |
| Q12 | Removing a VAT rate that current menu prices use: allowed or refused? | Allowed; existing prices stay valid until edited (R2) |

**Lead decisions 2026-11-18:** the defaults of Q1–Q12 stand, with these specifics:
- **Lead ruling 2026-11-18 (Rule B): no silent settings defaults; the only sanctioned default is the formatter's before the store is filled** (`FIRST_PAINT_VENUE_SETTINGS`, `src/lib/venue/settings.ts`). Missing or malformed `settings` in `/api/me`, and a corrupt `localStorage` value, are errors or refusals, never defaults. Overrides §3.4 "Old cached replies", §5 rows 8–10 and R3.
- **Q7** is ratified: `ds-bq2-preserves` narrows to `2026120610*`; SP1 uses `20261206200000`–`20261206200400`; SP1 merges before SP2
  (SP2 is gated on the hosted SP0 anyway).
- **Q11** stands as the founder decided (platform plan §0a).
- **Q12 note (Rule B):** removing a rate is allowed, but the owner's menu form must show the **stored** rate of an existing price even
  when that rate has left the tenant's list, so that editing the price (or anything else on the item) never silently changes or drops its
  rate. Step 10 tests it (below).
- **Q-a (2026-11-18, after the step-3 review):** the database enforces the tenant's list only on a rate that is **new or changed**. On an
  UPDATE (the coperto), it checks only when the new rate is distinct from the old one. On a new price version, it checks only when the rate
  differs from the item's newest existing version. So changing only the coperto amount, or a dish's price, with a stored 4 % keeps working,
  and setting 4 % fresh is refused. pgTAP 391 tests both directions.
- **Q-b (2026-11-18):** a demo reset leaves the tenant's configuration (sale VAT list, from step 5 the close codes) as the venue set it: it
  is their real setup, not demo data (ADR-018 note).
- **Q-c (2026-11-18):** step 7's `set_tenant_settings` takes the tenant-row lock, so a rate being switched off cannot slip into a concurrent
  `create_menu_item`; a two-session race test comes with it.
- **Q-c lock modes (2026-11-18, after the step-7 build):** `set_tenant_settings` takes `FOR NO KEY UPDATE` on the tenant row (§3.3 item 4) and
  the sale VAT trigger takes `FOR SHARE` before it reads the list. The two conflict, so the race stays closed; menu writers (`FOR SHARE`) do not
  wait for each other, and foreign-key checks against the tenant (`FOR KEY SHARE`) do not wait for a settings change. `FOR UPDATE` was rejected
  because it would block every such check. Race cases in `scripts/test-db-races.sh`: `sale-vat-off-vs-*`, `update-item-vs-sale-vat-off`,
  `menu-writers-no-wait`, `settings-vs-fk-insert`.
- **`GET /api/me` overlap with SP2:** separate top-level keys and separate test files, as in §3.10; SP2 adds its counts on its rebase.

---

## 8. Sources

| ID | URL | Used for |
|---|---|---|
| S1 | https://supabase.com/llms/cli.txt | `supabase db push` and its `--include-all` flag ("include all migrations not found on remote history table"). The exact refusal text for an out-of-order local file was not read in an official page; the plan relies only on "without `--include-all`, a file older than the remote's newest is not applied", to be confirmed by `db push --dry-run` on staging (step 0 of V1) |
| S2 | https://supabase.com/docs/guides/deployment/database-migrations | migration history and `db push` sync errors |

---

## 9. Differences found between the platform plan and the code

1. H13: `layout.tsx` `lang` is at `:120`, not `:88`. There is no `src/app/manifest.ts`; the manifest is `src/lib/brand/manifest.ts:20`,
   served by `src/app/manifest.webmanifest/route.ts`.
2. H14: `menu_procedures.sql:63` is inside `app.menu_vat` (`:51–68`). The procedures that call it were re-created by
   `20261130100100_weight_menu.sql:150, 248` (calls `:184, :300`).
3. H26: the prompt also says "the restaurant receiving the invoice" at `prompt.ts:14–15`.
4. H9: three more users since 2026-11-13: `trace-view.ts:6, 30`; `console-dates.ts:4, 53` (SP3); a literal in `src/lib/platform/api.ts:190`.
   Eleven server files use the venue day (§2).
5. H10: both literals format calendar dates at noon UTC; the zone does not change the output (§0 flag 3).
6. H20: the day-close report `day_close.sql:86–99` also reads the code lists.
7. `/api/me` is under the waiter cost guard; `vatRates` there would fail it (§0 flag 1).
8. G and X do not exist yet; SP1 creates them (§0 flag 4).
9. `ds-bq2-preserves.test.ts:17` claims every `20261206*` file, so the gap between main and SP2 is not free (§3.10).
10. SP2 S6 plans `tests/app/api/me-route.test.ts`; SP1 avoids that name.
11. An existing audit action, `tenant.settings_changed`, already fits; no audit CHECK pin needs to move.
12. The `/api/me` row query (`route.ts:14–18`) assumes one membership per login; that is SP2's to fix, not SP1's.
