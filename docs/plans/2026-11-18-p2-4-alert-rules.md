# Tech plan: Costì / Osteria Digitalization · P2-4, full alert rules engine (in-app only)

- **Status:** draft for the lead · **Author:** architect · **Date:** 2026-11-18
- **Repo and branch:** `osteria-dei-rossi-app`. This plan is on `docs/p2-4-alert-rules-plan` (from `main` `9a839551`). The build is one
  `/feature` run on `feat/p2-4-alert-rules` from `main`, delivered as **five PRs** (§5). Each PR stays a draft until `code-reviewer` passes.
- **Milestone:** P2-4 of `docs/plans/2026-11-11-phase2-scope.md`. Lines used:
  - Part 3 row P2-4, line 880;
  - candidate C9 = project M27, lines 319–336;
  - D3 (lines 70 and 921) and D5 (lines 72 and 923);
  - F7, line 576;
  - §2.5.2 rows M6 Q1 (line 730), M16 Q60 (line 769) and UX Q7 (line 800).
- **Client slug / internal:** `osteria-dei-rossi` is tenant #1. Internal planning document, in English. UI copy is Italian and marked
  "(da approvare)".
- **Client facts used:** none. Every fixture is fake: "Osteria Demo A", "Osteria Demo B", the M16 fixtures ("Spezzatino (demo)",
  "Manzo muscolo (demo)", "Macelleria X (demo)"), and invented payables, lots and batches. Every threshold default below is **today's
  value in the code**, cited by file and line.
- **Inputs read:**
  - this repo's `CLAUDE.md` (invariants, rule 6);
  - the Phase 2 scope (rows above);
  - the M6 plan `docs/plans/2026-10-22-m06-alerts.md` and the M16 plan `docs/plans/2026-10-24-m16-alert-rules.md`;
  - ADR-006 and ADR-015;
  - every alert migration (§2);
  - `src/server/alerts/`, `src/app/(owner)/avvisi/`, `src/app/api/alerts/`;
  - pgTAP `043`–`046`, `060`, `072`–`075`, `089`, `098`, `119`, `140`–`149`, `159`, `169`, `179`, `196`, `207`, `255`, `346`;
  - `tests/integration/alert-rules.int.ts`;
  - the SP1 plan `docs/plans/2026-11-15-sp01-tenant-config.md` (format, the §3.3 pattern, Rule B, G and X);
  - the platform plan `docs/plans/2026-11-13-platform-saas.md` §4–§6.5;
  - `docs/go-live/phase1-closeout.md:57` (F7).
- **How main was read:** with file tools only, so no `git log`. Everything below comes from the worktree on `9a839551`. The newest
  migration there is `20261206200400_tenant_locale_settings.sql` (SP1), and the newest pgTAP is `396_sp1_preserves.test.sql`. **Where a
  plan and the code differ, the code wins.** §9 lists every difference found.
- **ADR-033** already reads "accepted" on main (fixed 2026-11-11). This plan does not touch it.
- **ID scheme:**
  - steps **0–19**, in PRs **PR1–PR5**;
  - variants **V1–V7**; open questions **Q1–Q13**; risks **R1–R11**;
  - acceptance tests **AT1–AT7**, this milestone's own (§1);
  - **G** = the tenant #1 golden test and **X** = the cross-tenant suite (platform plan §6.5 rules 4–5, as SP1 built them in pgTAP `389`
    and `390`);
  - unverified technical assumptions **T1–T3** (§6), each proved in a named step.

---

## 0. Summary

P2-4 turns the thresholds, audiences and on/off switches of the alert rules into **audited per-tenant settings**. Alerts stay in
`/avvisi`, with the same one-tap acknowledgement. There is no new channel, provider, secret, piece of hardware or alert kind.

1. **One settings row per tenant**, `public.tenant_alert_settings`, with typed columns.
   - A trigger seeds every tenant, existing and new, with today's values, so **tenant #1 sees no change** (G proves it).
   - The rules read the row and refuse loudly when it is missing (Rule B: no silent defaults).
2. **What becomes adjustable:**
   - each of the five hourly rules can be switched on or off: payable reminders, the weekly payables digest, prep, purchase, expiry;
   - the payable reminder days (today 7 before and 3 after);
   - the expiry windows (today 1 day for raw lots and 24 hours for batches);
   - whether the chef also receives each of the five non-cost rule kinds (today four do; `purchase_due` does not).
3. **Writes** follow SP1's §3.3 pattern:
   - the procedure `public.set_alert_settings(jsonb)`, for owner and admin, in one transaction;
   - one `audit_event` (`tenant.settings_changed`) holding only the changed keys;
   - a strict Zod route, `PATCH /api/settings/alerts`.
4. **Per-rule isolation, revisited.**
   - Per tenant and per rule isolation **already exists**, as savepoint blocks since M9 and M16. The scope row took its wording from
     ADR-006, which is out of date on this point.
   - What is still missing: the switches (each block runs only when its rule is on), a loud refusal when a tenant has no settings row,
     and **F7**.
   - F7: a cancelled run (SQLSTATE 57014) escapes `when others`, rolls back its own `job_run` row and leaves no trace. P2-4 makes the
     nightly job-health check read `cron.job_run_details`.
   - Dispatch stays static, with no dynamic SQL (§3.6).
5. **Screen** `/avvisi/impostazioni` "Regole degli avvisi", for owner and admin. It is in PR5, UI-only, and Builder 2 may own it.

**Seven migrations, `20261206230000`–`20261206230600`.** §5 marks each one **[MIGRATION]**; the lead reads each line by line.
- **Renumbered (lead, 2026-11-18):** opening stock and the comanda per uscita are pre-go-live and merge first, so P2-4 moves from
  `2026120621*` to `2026120623*`. The range sorts after opening stock's `2026120621*` and the comanda per uscita's `2026120622*`, and
  before SP2's reserved `20261207100000`.
- No guard needs changing: `sp1-preserves` claims `20261206200*` and `ds-bq2-preserves` claims `2026120610*`.
- pgTAP numbers are **397–406**. `20261206230700`–`230900` stay free for review fixes.

**Flags for the lead (read first).**
1. **The scope row's isolation risk is out of date.** Scope line 330 says "one failing rule still rolls back that hour's whole rule
   body"; the wording comes from ADR-006 line 75. It has been false since M9:
   - `20261024100300_payable_rules.sql:20–24, 193–203` isolates each tenant and rule;
   - `20261030100800_alert_rules_body_m16.sql:4–7, 17–43` keeps that isolation.

   The real gap is F7 (flag 2). §3.6 says what "revisited" delivers.
2. **F7 mechanism (T1).** `exception when others` does not catch `query_canceled`. A statement timeout therefore rolls back the whole run,
   including the row written by `job_run_begin`. Today only `job_stale` notices, and only after three hours without a successful run
   (`20261201100500_mfa_failure_retention.sql:84–90`). Step 10 proves T1 locally and adds the check.
3. **A live rendering bug, found on the way and fixed in step 11.**
   - `DRIFT_JOB_KEYS` (`src/server/alerts/templates.ts:225–231`) lists five job names.
   - `job_health_checks` can also name `kpi-rollup`, `reservation-retention` and `mfa-failure-retention` (`job_stale`), and any `job_run`
     job, including `reservation-mail` (`job_failed`).
   - When it does, the strict schema fails and `/avvisi` shows the generic fallback text for that night's `ledger_drift`
     (`render.ts:45–59`).
4. **The thresholds drive alerts only.** Two other readers keep today's values (Q4 → V3):
   - the dashboard's "due within 7 days" tile, pinned `z.literal(7)` (`src/server/dashboard/output.ts:140`, `sql-schema.ts:41`);
   - the stock screens, which use `app.expiry_state` and `app.use_by_state`.
5. **The price-variance threshold is already a tenant setting.**
   - It is `price_variance_pct`, default 10, edited on `/costi/impostazioni`.
   - It lives in `tenant.settings` jsonb with **silent** fallbacks (`20261023110000_cost_settings.sql:47–61, 77–80`), which conflicts
     with SP1's Rule B.
   - P2-4 shows it read-only with a link and does not move it (Q9).

---

## 1. Goal and scope

**Goal:** the owner, or DigiAlto as admin, can adjust when the existing alert rules fire, choose who in the kitchen receives them, and
switch a rule off. Every change is audited. Nothing changes until someone changes it, and nothing leaves the app.

**In scope**
- `public.tenant_alert_settings` (one row per tenant), its seed trigger and backfill, RLS, and no write grants.
- `public.alert_settings()` and `public.set_alert_settings(jsonb)`, with `GET` and `PATCH /api/settings/alerts`.
- The rules read the settings:
  - `app.payable_reminder_rule` and `app.expiry_rule` read the thresholds;
  - `app.raise_rule_alert` reads the chef audience;
  - `app.alert_rules_body` reads the on/off switches.
- **F7:** `app.job_health_checks` reads `cron.job_run_details` (new check `job_aborted`). `DRIFT_JOB_KEYS` and `DRIFT_CHECK_KEYS` are
  completed.
- G (tenant #1 golden alert outputs) and X (Demo A/B cross-tenant).
- The screen `/avvisi/impostazioni`, linked from `/avvisi` (owner) and `/riordino` (owner, admin).
- ADR-047 (number to confirm, Q10), a runbook section, and a dated correction note in ADR-006.

**Out of scope**
- Any outbound channel: Telegram, e-mail or Web Push (D3; ADR-006). No new secret, provider or device. The sensor pilot (C5, D5) and
  OQ-1 come later.
- New alert kinds, new rule types, rule types defined as data, and any user-written rule language.
- The forecast model (14-day weekday average, `20261127100000_raw_stock_business_date.sql:117–119, 147–148`), which belongs to C6/M32.
- Per-ingredient and per-recipe minimums. They already exist and are audited (M16 `/riordino`).
- `price_variance_pct` storage (Q9), `device_locked` thresholds (security, M11), and the dashboard and push-list windows (Q4).
- Alert retention (project Q14, DPA-1) and purging `cron.job_run_details` (Q8).
- SP5 entitlements. P2-4 only leaves one place for SP5's `alerts` switch (§3.12).

**Acceptance tests (this plan's own)**
- **AT1 Defaults.** With the seeded settings, the hourly run gives exactly today's alerts for the G fixture: kinds, entities, dates,
  severity, audience and payload. The rendered it/en texts are unchanged.
- **AT2 Thresholds.**
  - Raw-lot window 3: a lot expiring in 3 days alerts; with 1 it does not.
  - Batch window 48 h: a batch at +40 h alerts.
  - Payable days 5 / 1: the first reminder comes at D−5 and the overdue one at D+1.
  - Changing the due-soon days never re-sends a reminder already sent for the same due date.
- **AT3 Audience.**
  - The chef is removed from `prep_due`: new prep alerts are missing from the chef's `GET /api/alerts`.
  - The chef is added to `purchase_due`: the chef sees new purchase alerts.
  - A cost-bearing kind can never be added: SQL and Zod both refuse it.
- **AT4 Switches.** With the purchase rule off there is no `purchase_due`, and the other rules still run. Switched back on, it fires on
  the next run.
- **AT5 Audit and roles.**
  - Each effective change writes one `tenant.settings_changed` row holding only the changed keys; a no-op writes none.
  - Chef and waiter get 403 from the API and 42501 from SQL. Admin may write.
- **AT6 Isolation and F7.**
  - A failing rule is recorded as `rule_failed` and the others commit.
  - A missing settings row is recorded as `settings_missing`.
  - A failed `cron.job_run_details` row inside the window yields `job_aborted` in the nightly `ledger_drift` alert, rendered (not the
    fallback). With no such row, `job_health_checks` returns exactly what it returns today.
- **AT7 Tenancy.** B's settings never change A's alerts. B can neither read nor write A's settings row.

---

## 2. Current state (what exists today)

Line numbers are on the worktree at `9a839551`.

### 2.1 The pipeline

| What | Where (file:line) | Fact that matters |
|---|---|---|
| Kind registry | `supabase/migrations/20261022150100_alert.sql:13–23` (table), `:27–29` (test kinds) | `app.alert_kind (kind, cost_bearing, default_severity, default_audience)`. CHECKs: audience ⊆ {owner, chef} and contains owner (`:18–20`); no chef on a cost-bearing kind (`:21–22`). **Global, no tenant.** Closed to every API role (`:25`) |
| Alert table | same file `:84–114` | `audience_roles` and `cost_bearing` are copied at raise time (`:95–97`); payload is an object of at most 8 KB (`:111–112`); set-once ack (`:113`) |
| Dedup | same file `:118–119` | unique `(tenant_id, kind, entity_type, entity_id, business_date) nulls not distinct` |
| Immutability | same file `:126–152` | only the set-once ack may change; no delete, no truncate |
| RLS | same file `:163–173` | the owner reads all; the chef reads rows with `chef ∈ audience_roles and not cost_bearing`; admin and waiter read nothing |
| Entry point | `app.raise_alert`, last replaced in `20261026100200_chef_payload_allowlist.sql:67` | audience = `coalesce(p_audience, registry default) ∪ {owner}` (`:99–111`); cost guards (`:113–127`); chef allow-list as the last guard (`:128–131`); business date = Rome calendar date (`:133–134`); `on conflict do nothing` (`:139–145`) |
| Guard absorber | `20261023110400_try_raise_alert.sql:15–28` (`app.alert_refusal`), `:39–52` (`record_alert_refusal`), `:54–91` (`try_raise_alert`) | guard codes become a refusal row (ids and codes only); other errors are re-raised |
| Acknowledge | `20261022150300_alert_ack.sql:9–43` | owner or chef, only on an alert they can read; set once and shared by everyone |
| Runner | `20261022150400_alert_rules.sql:47` (`cron.schedule('alert-rules', '0 * * * *', …)`); `20261022150600_alert_rules_warning.sql:11–30` (`app.run_alert_rules`) | `job_run_begin` → `alert_rules_body(p_at)` in a savepoint → `job_run_end`. Pinned as "never replaced" (md5 `ff878123…`, pgTAP `075:139–140`) |
| Body | `20261030100800_alert_rules_body_m16.sql:8–46` | one loop over **all** tenants (`:17`); five `BEGIN … EXCEPTION` blocks per tenant (`:18–42`), recording `rule_failed` under the callers `payable_reminders`, `payables_digest`, `prep_rules`, `purchase_rules`, `expiry_rules` |
| Test wrapper | same file `:52–71` | `public.alert_rules_run(p_at)`, `service_role` only |
| Job health | `20261201100500_mfa_failure_retention.sql:56–157` (latest `app.job_health_checks`) | `alert-rules` is stale after 3 h without an ok run (`:84–90`); `job_failed` from `app.job_run` (`:129–134`); `job_unscheduled` (`:136–140`); `alerts_refused` (`:150–155`). **Never reads `cron.job_run_details`** (F7) |
| Nightly raiser | `20261027101000_job_health_window.sql:97–135` (`run_ledger_invariants`) | builds one `ledger_drift` per tenant from the ledger checks and job health |

### 2.2 The rules and their thresholds today

| Rule (caller) | Kinds raised | Threshold today, and where it lives | Audience today | Dedup today |
|---|---|---|---|---|
| `payable_reminders` | `payable_due_7d`, `payable_due_today`, `payable_overdue_3d` | **Code literals:** due within **7** days (`20261024100500_payable_rules_zero_amount.sql:27, 38–39`), overdue from **3** days (`:31–33`); `amount > 0` (`:27`) | `{owner}`, cost-bearing (`20261024100200_payable_alert_kinds.sql:12–16`) | business date = the stage's nominal date (`:33, 36, 39`); pre-check on that date (`:42–46`) |
| `payables_digest` | `payables_weekly_digest` | weekly, dated the ISO Monday (`20261024100300_payable_rules.sql:163–182`); at most 15 suppliers listed (`20261024100500:114`) | `{owner}`, cost-bearing | one per ISO week (`20261024100300:168–173`) |
| `prep_rules` | `prep_due`, `prep_raw_short` | **Per recipe** (data). The effective min, target and prep time are `recipe_key.rule_*`, or else the version's (`app.recipe_rules`, `20261030100100_rules_helpers.sql:106`); written by the audited `set_recipe_rules` (`20261030100200`) | `{owner,chef}` in the registry (`20261030100400_rule_alert_kinds.sql:6–7`); raised with `p_audience` null (`20261030100500_prep_rule.sql:18`) | one per recipe key per Rome day (`:98–101`) |
| `purchase_rules` | `purchase_due` | **Per ingredient and supplier** (data, M16): `min_level`, `target_level`, preferred item, lead time, weekdays, cut-off (`20261030100600_purchase_rule.sql:20–37`). The forecast is a 14-day weekday average, in code (`20261127100000:117–119`) | `{owner}` in the registry (`20261030100400:8`; M16 Q60) | one per ingredient per day (`:41–44`) |
| `expiry_rules` | `raw_lot_expiring`, `batch_expiring` | **Code literals.** Raw lot: `expiry <= today + 1` (`20261030100700_expiry_rule.sql:25`), state from `app.expiry_state` (`20261026100400_stock_core.sql:95–105`, the same "+1" at `:102`). Batch: `use_by <= p_at + 24 h` (`20261030100700:49`), state from `app.use_by_state` (`20261028100100_batch_helpers.sql:30–39`, "24" at `:36`). Critical when expired (`20261030100700:38, 62`) | `{owner,chef}` in the registry (`20261030100400:9–10`) | one per lot or batch per day (`:30–33, 54–57`) |

**Kinds raised outside the hourly body.** P2-4 does not make these switchable (Q2).

| Kind | Raised by | Threshold | Audience |
|---|---|---|---|
| `price_variance` | `approve_invoice` (`20261023110800_cost_review_fixes.sql:184`) | `price_variance_pct`, default **10**, in `tenant.settings` jsonb. Read by `app.cost_settings` (`20261023110000_cost_settings.sql:64–82`); written and audited by `update_cost_settings` (`:137–209`). Edited on `/costi/impostazioni` through `GET/PATCH /api/settings` (owner, admin) | `{owner}`, cost-bearing (`20261023110500_price_variance_kind.sql:6–7`) |
| `negative_stock` | `app.raise_negative_stock` (`20261026100400_stock_core.sql:142–164`); fire helpers (`20261106100700_fire_locked_batches_only.sql:115`) | on hand < 0 | `{owner,chef}` (`20261026100300_negative_stock_kind.sql:6–7`) |
| `device_locked` | `pin_login_finish` (`20261025100400_pin_login.sql:131`) | 20 failed PINs in 60 minutes (`20261025100300_device_locked_kind.sql:4–5`) | `{owner}` |
| `ledger_drift` | `run_ledger_invariants` (§2.1) | any finding | `{owner}`, critical (`20261027100600_ledger_drift_kind.sql:6–7`) |

### 2.3 Who receives what, and the screens

- **Recipients:**
  - The owner reads every alert.
  - The chef reads the non-cost alerts whose audience includes the chef (RLS above, and `visibleTo`, `src/server/alerts/list.ts:128–131`).
  - Admin and waiter read none: `GET /api/alerts` is `roles: ["owner", "chef"]` (`src/app/api/alerts/route.ts:6–17`). This is the
    founder's decision of 2026-10-23 (ADR-006).
- **TS registry:** `src/server/alerts/kinds.ts:7–23` (15 kinds), checked against SQL by `tests/integration/alerts.int.ts`.
- **Templates:** `src/server/alerts/templates.ts`, with the drift keys at `:208–231`. Links come from `list.ts:140–163`.
- **Screen:** `src/app/(owner)/avvisi/page.tsx:21–145`, which reads `/api/alerts` only. Nav entry: `src/lib/nav/nav-model.ts:85`.
- **Existing settings screens:**
  - `/riordino/*` (M16; `canEditRules` = owner, admin, `src/lib/rules/rules-view.ts:16`);
  - `/costi/impostazioni` (price variance);
  - `/impostazioni/dati-di-prova`.

  There is no alert settings screen: M6 decided there was "nothing to configure" (`docs/plans/2026-10-22-m06-alerts.md:40`).
- **Role helper:** `app.require_rules_writer()` (`20261030100200_rules_settings_procedures.sql:22–33`) allows owner and admin through
  `app.role()`, so the `aal` gate of #79 and FD31 applies.

### 2.4 Pins on the code P2-4 touches (found by grep; §3.10 lists the moves)

- `app.alert_rules_body` md5:
  - `089:20`, `098:22`, `119:33`, `159:38`, `169:57`, `179:16, :50` (`2ac38ab6…`, of `pg_get_functiondef`);
  - `196:49` (`08aaae27…`, of `prosrc`).
- `app.payable_reminder_rule` at `207:29`; `app.expiry_rule` at `207:30` and `255:10`; `app.job_health_checks` at `346:38`
  (`fd3492f2…`).
- These are unchanged and must stay so:
  - `app.run_alert_rules`: `075:139`, `089:22`, `119:34`, `148:192`, `149:29`, `159:37`, `196:48`;
  - `app.raise_alert`: `119:30`, `149:27`, `159:35`, `179:62`;
  - `app.try_raise_alert`: `076:106`, `119:31`, `149:28`, `159:36`, `179:64`.

---

## 3. Design

### 3.1 What "full rules engine" means in this scope

| Scope words (line 880) | Concrete delivery |
|---|---|
| "Thresholds … as audited tenant settings" | Per tenant: `payable_due_soon_days` (7), `payable_overdue_days` (3), `raw_lot_expiry_days` (1), `batch_use_by_hours` (24). Per-recipe and per-ingredient thresholds stay where M16 put them; the screen links to them |
| "Audiences … as audited tenant settings" | `chef_alert_kinds`: which of the five non-cost rule kinds the chef also receives. The owner always receives them (registry and table CHECKs). Cost-bearing kinds can never be chosen. Admin and waiter can never be recipients (unchanged) |
| Enable and disable per rule (brief) | Five switches, one per hourly rule (the callers in §2.2) |
| "Per-rule isolation revisited" | §3.6 |
| "Folds F7" | §3.7 |
| "Alerts stay in `/avvisi`" | No delivery table, no dispatcher, no channel column. ADR-006's in-app decision stands (D3) |

### 3.2 Data model **[MIGRATION 1, step 3]**

`public.tenant_alert_settings`:

```
tenant_id                 uuid primary key references public.tenant (id)
payable_reminders_enabled boolean  not null
payables_digest_enabled   boolean  not null
prep_rules_enabled        boolean  not null
purchase_rules_enabled    boolean  not null
expiry_rules_enabled      boolean  not null
payable_due_soon_days     smallint not null check (payable_due_soon_days between 1 and 30)
payable_overdue_days      smallint not null check (payable_overdue_days between 1 and 30)
raw_lot_expiry_days       smallint not null check (raw_lot_expiry_days between 0 and 7)
batch_use_by_hours        smallint not null check (batch_use_by_hours between 1 and 72)
chef_alert_kinds          text[]   not null
  constraint tenant_alert_settings_chef_kinds_ck
    check (chef_alert_kinds <@ app.chef_configurable_alert_kinds()
           and array_position(chef_alert_kinds, null) is null)
created_at, updated_at    timestamptz not null default now()
updated_by                uuid null
  constraint tenant_alert_settings_updated_by_fkey foreign key (tenant_id, updated_by)
    references public.app_user (tenant_id, id) on delete set null (updated_by)
```

- **No column defaults.** Values come only from the seed function, so nothing is ever silently defaulted (Rule B). A tenant without a row
  gets **no** hourly alerts and a loud `settings_missing` refusal (§3.5.4), which the nightly `alerts_refused` check reports.
- **The bounds are proposed engineering limits, not client facts** (Q6). The upper bounds keep each window inside the data the rules scan,
  and keep the payloads meaningful.
- **`app.chef_configurable_alert_kinds()`:**
  - immutable, returns `'{batch_expiring,prep_due,prep_raw_short,purchase_due,raw_lot_expiring}'`, closed to API roles;
  - being immutable keeps SP1's rule that a CHECK never reads a table (pgTAP `396`);
  - pgTAP `399` asserts that each listed kind exists in `app.alert_kind` with `cost_bearing = false`, so a cost kind can never become
    chef-visible through this setting;
  - the `raise_alert` guards (`20261026100200:116–131`) remain the second line of defence.
- **Seed:** the function `app.seed_tenant_alert_settings()` (definer, `search_path = ''`, closed) and the trigger
  `tenant_seed_alert_settings` (`after insert on public.tenant for each row`).
  - It inserts these literal values with `on conflict do nothing`: every switch `true`; days and hours `7, 3, 1, 24`;
    `chef_alert_kinds = '{batch_expiring,prep_due,prep_raw_short,raw_lot_expiring}'`.
  - These are today's values: §2.2, and the chef kinds are the registry defaults that contain `chef`.
  - The same migration backfills every existing tenant with one `insert … select … on conflict do nothing`.
  - It is a separate trigger from SP1's `tenant_seed_settings`, so SP1's function is not re-created.
- **RLS:** enabled. The policy `tenant_alert_settings_select` is `for select to authenticated using (tenant_id = (select app.tenant_id())
  and (select app.role()) in ('owner', 'admin'))`. There is no insert, update or delete grant to `anon`, `authenticated` or
  `service_role`. Only the seed and `set_alert_settings` write rows.
- **Not operational data.** As SP1 did for `tenant_vat_rate` (ADR-018 note):
  - the table is not in `app.demo_purge_tables()`, and a demo purge keeps it;
  - `app.tenant_has_operational_data` ignores it;
  - pgTAP `194`'s exact-list exemption gains it, and `193` gains one "purge keeps it" assertion.
- **No P2-4 path deletes a row.** The table is configuration, not a ledger, so updates are allowed. They go only through the procedure,
  and each one is audited.

### 3.3 Functions

All functions are definers with `search_path = ''`, owned by the migration owner, and start with `revoke all … from public, anon,
authenticated, service_role`. No new public name matches `cost|margin|price|service` (the SP1 naming pin).

| Function | Kind | Step | Body | Grants |
|---|---|---|---|---|
| `app.chef_configurable_alert_kinds() returns text[]` | new, immutable | 3 | the five kinds | none |
| `app.seed_tenant_alert_settings() returns trigger` + trigger | new | 3 | the §3.2 seed | none |
| `app.alert_settings_of(p_tenant uuid) returns public.tenant_alert_settings` | new, stable | 3 | the row, or `raise 'alert_settings_missing' using errcode = 'P0001'` | none |
| `public.alert_settings() returns jsonb` | new, stable | 4 | `app.require_rules_writer()` first, then the §3.8 GET shape for `app.tenant_id()` | `authenticated` |
| `public.set_alert_settings(p_patch jsonb) returns jsonb` | new, volatile | 4 | §3.4 | `authenticated` |
| `app.payable_reminder_rule(uuid, timestamptz)` | re-created, same signature | 6 | §3.5.1 | unchanged (none) |
| `app.rule_expiry_state(p_expiry date, p_today date, p_days int) returns text` and `app.rule_use_by_state(p_use_by timestamptz, p_at timestamptz, p_hours int) returns text` | new, immutable | 7 | `expired` / `due_soon` / `ok`, with the window as a parameter. With 1 and 24 they equal `app.expiry_state` / `app.use_by_state` for every input (proved in `402`) | none |
| `app.expiry_rule(uuid, timestamptz)` | re-created, same signature | 7 | §3.5.2 | unchanged |
| `app.raise_rule_alert(…)` | re-created, same signature | 8 | §3.5.3 | unchanged |
| `app.alert_rules_body(timestamptz)` | re-created | 9 | §3.5.4 | unchanged |
| `app.job_health_checks(uuid, timestamptz)` | re-created, verbatim plus one block | 10 | §3.7 | unchanged |

**Not re-created, on purpose:**
- `app.raise_alert`, `app.try_raise_alert`, `app.alert_guard_codes`, `app.chef_payload_allowed`, `app.payload_money_keys`;
- `app.run_alert_rules`, `app.alert_business_date`, `public.acknowledge_alert`, `public.alert_rules_run`;
- `app.prep_rule`, `app.purchase_rule`, `app.payables_digest_rule`, `app.expiry_state`, `app.use_by_state`;
- every `app.alert_kind` row.

The preserves test of step 3 refuses any migration in the P2-4 range that re-creates one of them.

### 3.4 `public.set_alert_settings(jsonb)` and the route (steps 4, 13)

**SQL, in one transaction** (SP1's §3.3 pattern):
1. Call `app.require_rules_writer()`: owner or admin, 42501 otherwise. The `aal` gate of #79 and FD31 applies through `app.role()`.
2. Check the shape. The patch must be an object with at least one key.
   - Booleans: `payableRemindersEnabled`, `payablesDigestEnabled`, `prepEnabled`, `purchaseEnabled`, `expiryEnabled`.
   - JSON integers: `payableDueSoonDays`, `payableOverdueDays`, `rawLotExpiryDays`, `batchUseByHours`.
   - An array of strings: `chefKinds`.
   - An unknown key, a wrong JSON type, a non-integer number or an empty patch → `invalid_request` (22023).
3. Validate the values:
   - an integer outside its bounds → P0001 `alert_threshold_out_of_range`, with `detail` = the key name;
   - `chefKinds` with a duplicate, a null, or a kind outside `app.chef_configurable_alert_kinds()` → P0001 `alert_chef_kind_invalid`.
     This also refuses every cost-bearing kind, since none is on the list.
4. Lock the row: `select … from public.tenant_alert_settings where tenant_id = v_tenant for no key update`. No row →
   `alert_settings_missing` (P0001). The procedure never inserts a missing row.
5. Compute the row after the change. `chef_alert_kinds` is stored sorted (`collate "C"`), so a different order never counts as a change.
   If nothing differs, return `{changed: false, settings}` and write nothing.
6. Update the row, setting `updated_at = now()` and `updated_by = app.app_user_id()`.
7. Write one `audit_event`: entity `tenant`, id = the tenant, action `tenant.settings_changed`.
   - The action is already in the CHECK and is reused as SP1 did, so no audit pin moves.
   - `before` and `after` hold **only the changed columns**, by column name.
   - The values are booleans, integers and kind codes: no money and no names.
8. Return `{changed: true, settings}`, where `settings` has the `public.alert_settings()` shape.

**Route** `src/app/api/settings/alerts/route.ts`:
- `GET` → `withApi({ roles: ["owner", "admin"] })`, then `rpc("alert_settings")`.
- `PATCH` → `withApi({ roles: ["owner", "admin"], body: alertSettingsPatch, maxBodyBytes: MAX_ALERT_SETTINGS_BODY_BYTES })`, then
  `rpc("set_alert_settings", { p_patch })`.
- Strict Zod (`src/server/alert-settings/schemas.ts`):
  - an unknown key → 400;
  - integers are bounded by constants mirrored from SQL (parity test);
  - `chefKinds` is an enum array of `CHEF_CONFIGURABLE_ALERT_KINDS`, without duplicates;
  - JSON content type only (415 otherwise); 4 KiB body limit (413).
- Error map:
  - 42501 → 403; 22023 → 400;
  - `alert_threshold_out_of_range` and `alert_chef_kind_invalid` → 422, with Italian messages;
  - `alert_settings_missing` → 500 with the code only (a data fault, not a user error);
  - anything else → 500 with the SQLSTATE only.
- A strict output schema (`src/server/alert-settings/output.ts`).
- Not offline-cacheable. Both methods join the cost-guard route list, so no key matching the money pattern may appear.

### 3.5 How the rules read the settings

**3.5.1 Payable reminders (step 6, [MIGRATION 3]).** First `s := app.alert_settings_of(p_tenant)`. Then the body of
`20261024100500:10–68` runs with three substitutions:
- `p.due_date <= v_today + s.payable_due_soon_days` replaces `+ 7` (`:27`);
- `r.due_date + s.payable_overdue_days` replaces `+ 3` (`:31, :33`);
- `r.due_date - s.payable_due_soon_days` replaces `- 7` (`:39`).

**The pre-check changes from "this nominal date" to "this stage for this due date":** `exists (… a.kind = v_kind and a.entity_type =
'payable' and a.entity_id = r.id and a.payload ->> 'due_date' = r.due_date::text)`.
- With fixed days this is the same test as today, because one due date gives exactly one nominal date per stage. G proves it.
- A changed due date still re-fires exactly as today, because the payload's `due_date` differs.
- Changing the days does **not** re-send a stage already sent for that due date (AT2). Without this, moving from 7 to 5 would give a new
  nominal date and a new dedup key, and every payable already reminded would be reminded again.

The kind codes stay `payable_due_7d` and `payable_overdue_3d`. They are identifiers, and the texts never print the number
(`src/lib/i18n/messages/it.ts:1091–1096`).

**3.5.2 Expiry (step 7, [MIGRATION 4]).** First `s := app.alert_settings_of(p_tenant)`. Then the body of `20261030100700:6–69` runs with:
- `rl.expiry <= v_today + s.raw_lot_expiry_days` (`:25`);
- `app.rule_expiry_state(rl.expiry, v_today, s.raw_lot_expiry_days)` (`:21`);
- `b.use_by <= p_at + make_interval(hours => s.batch_use_by_hours)` (`:49`);
- `app.rule_use_by_state(b.use_by, p_at, s.batch_use_by_hours)` (`:46`).

Payload keys, severities and `state_key` values (`due_soon`, `expired`) are unchanged. Days are still date arithmetic and hours are still
elapsed time (M14 Q40), so DST behaves as in M16 AT6. Step 7 tests the DST case.

**3.5.3 Audience (step 8, [MIGRATION 5]).** `app.raise_rule_alert` (`20261030100500_prep_rule.sql:7–22`) keeps its signature.
- Before calling `try_raise_alert`, it computes `v_aud := case when p_kind = any (app.alert_settings_of(p_tenant).chef_alert_kinds) then
  '{owner,chef}' else '{owner}' end` and passes it as `p_audience` (today `null`, `:18`).
- `raise_alert` still adds the owner, refuses a chef on a cost kind and runs the chef allow-list.
- `purchase_due` sent to the chef passes the allow-list; M16 pgTAP `144` already asserts it.
- The payable rules keep calling `try_raise_alert` with `null`, so they keep the registry's `{owner}`.

**Audience applies to new alerts only.** Alert rows are immutable (ADR-006), so an alert raised today keeps the audience it was raised
with. Because of the dedup key, a change made mid-day takes effect from the next Rome day for items already alerted today (Q11).

**3.5.4 Body (step 9, [MIGRATION 6]).**

```
for t in select id from public.tenant order by id loop
  begin
    s := app.alert_settings_of(t.id);
  exception when others then
    perform app.record_alert_refusal(t.id, null, 'tenant', t.id, 'alert_rules', 'settings_missing', sqlstate);
    continue;
  end;
  if s.payable_reminders_enabled then <M9 block, verbatim> end if;
  if s.payables_digest_enabled   then <M9 block, verbatim> end if;
  if s.prep_rules_enabled        then <M16 block, verbatim> end if;
  if s.purchase_rules_enabled    then <M16 block, verbatim> end if;
  if s.expiry_rules_enabled      then <M16 block, verbatim> end if;
end loop;
```

- `app.run_alert_rules` is not touched.
- A switched-off rule writes nothing and records nothing: it is a choice, not a fault.
- The `for t in select … from public.tenant` line stays a single statement, so SP5 can add its `alerts` feature predicate there (§3.12).
- **Concurrency.** A run reads each tenant's row once per rule (READ COMMITTED), so a settings change that commits during a run can apply
  to the later rules of that run. This is harmless: each alert is still deduplicated, and the next run uses the new values everywhere.

### 3.6 Per-rule isolation, revisited

**What the scope row refers to.**
- ADR-006 `:53–56` rejected "a rule registry with dynamic dispatch … for now".
- ADR-006 `:75` records "one failing rule rolls back that hour's whole rule body".
- ADR-006 `:80` says to revisit "when there are enough rules that per-rule isolation is worth a registry".
- The scope copied that risk (line 330), and the M16 plan §3.9 left the decision to "M27".

**What the code already does.**
- Each **tenant × rule** runs in its own savepoint, since M9 (`20261024100300:20–24`) and in M16 (`20261030100800:17–43`).
- A failure is recorded as `alert_refusal (caller, 'rule_failed', sqlstate)`, and job health reports it as `alerts_refused`.
- M16 pgTAP `148` ("Isolation") proves it.

**What is still missing, and what P2-4 does about it:**

| Gap | P2-4 |
|---|---|
| Rules cannot be switched per tenant | a data check before each block (§3.5.4) |
| A tenant with broken configuration would crash the loop or run on silent defaults | `alert_settings_of` raises inside its own block, which records `settings_missing` and moves on to the next tenant |
| A **cancelled** run (57014: statement timeout, `pg_cancel_backend`) is not caught by `when others` (T1). The whole transaction rolls back, `job_run` included, and nothing records it | detected afterwards from `cron.job_run_details` (§3.7, F7) |
| Adding a rule means editing the body by hand and moving md5 pins | accepted and unchanged (one more re-pin in step 9). A new rule needs a migration for its function anyway |

**A registry with dynamic dispatch is still rejected:**
- `EXECUTE format('select app.%I(…)')` adds an SQL-injection surface inside a definer;
- it cannot be pinned by md5 as one function;
- it does not solve 57014 either;
- the five rules are a fixed list of codes, and the settings row's columns already serve as their catalogue.

**True isolation against timeouts** needs separate transactions: a `PROCEDURE` that `COMMIT`s after each tenant × rule, or one cron job
per rule. That is a new runner contract, kept as **V7** for when F7 shows aborted runs in practice (Q7).

### 3.7 F7: job health reads pg_cron's run history (step 10, [MIGRATION 7])

`app.job_health_checks` is re-created **verbatim** from `20261201100500:56–157`, plus one block before `job_failed`:

```
return query
  select 'job_aborted'::text, count(*)::integer, '{}'::uuid[], j.jobname::text
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
   where d.status = 'failed'
     and j.jobname = any (array['alert-rules', 'auth-purge', 'extract-invoices', 'kpi-rollup',
                                'ledger-invariants', 'mfa-failure-retention', 'reservation-retention'])
     and d.end_time >= v_since and d.end_time <= p_at
   group by j.jobname
   order by j.jobname;
```

- **Columns read:** `status`, `end_time`, `jobid` and `jobname` only. `return_message` and `command` are **never** selected: an error
  message can quote data, and the project rule is SQLSTATE or codes only.
- **No double count with `job_failed`.** A job that records its own failure in `job_run` and returns normally leaves cron's status
  `succeeded`. Only a run that **raised or was cancelled** shows `failed` in cron, and that run's `job_run` row was rolled back.
- **Window:** the same `v_since` as `job_failed`.
- **Job list:** the existing `job_unscheduled` list (`:138`). `reservation-mail` is not in it today (Q8).
- **Native runner:** `supabase/tests-native/platform_shim.sql` gains a minimal `cron.job_run_details (runid, jobid, status, end_time,
  return_message, command, start_time)`, so that `scripts/test-db-native.sh` can run `405`.
- **T2 (access):** the definer owner can select `cron.job_run_details` on the Supabase stack; it already reads `cron.job` (`:139`). T2 is
  proved locally by `405` on `npx supabase start` (real pg_cron) and confirmed on staging in step 19.
- **TS (step 11):**
  - `DRIFT_CHECK_KEYS` gains `job_aborted`.
  - `DRIFT_JOB_KEYS` gaining `kpi-rollup`, `reservation-mail`, `reservation-retention` and `mfa-failure-retention` (flag 3) is **not
    part of P2-4 any more**: the lead moved it to a small fix PR shipped before P2-4 PR1, with the parity test below (§7, ruling on flag 3).
  - New labels `alerts.kind.ledger_drift.check.job_aborted`: it "attività pianificata interrotta: {job}" (da approvare), en "scheduled job
    aborted: {job}".
  - A parity test fails when `DRIFT_JOB_KEYS` lacks a job name used in `supabase/migrations/`: in any `job_run_job_check`, any
    `job_unscheduled` list or any `cron.schedule(` call. It ships with the fix PR above; step 11 only extends it to `job_aborted`.
- **Purge of pg_cron's run history (lead ruling on Q8, 2026-11-18; same migration 7, no new file):** `cron.job_run_details` is never
  purged by pg_cron, and `reservation-mail` runs every minute (about 525k rows a year). Migration 7 also schedules one daily job,
  `cron-history-purge`, that deletes `cron.job_run_details` rows whose `end_time` is older than 14 days, and adds that job name to
  `job_run_job_check` only if the job records itself in `app.job_run` (decided when writing the step; the pgTAP below pins whichever it is).
  `405` pins: the schedule exists once with its exact command; a row 15 days old is deleted by one run and a row 13 days old is kept;
  the command touches no other table.
- **`reservation-mail` in the job-health lists (Q8 ruling):** added to the `job_unscheduled` list and the `job_aborted` list of §3.7,
  because F7 reads its status from `cron.job_run_details` at the same cost as the others. It stays out of the `job_stale` checks: it
  writes no `app.job_run` row per minute (decided in step 10 from the code; `405` pins the lists).

### 3.8 API shapes

`GET /api/settings/alerts` → 200. The same shape is the `settings` of the PATCH answer:

```
{ rules: { payableReminders: { enabled: true, dueSoonDays: 7, overdueDays: 3 },
           payablesDigest:   { enabled: true },
           prep:             { enabled: true },
           purchase:         { enabled: true },
           expiry:           { enabled: true, rawLotDays: 1, batchHours: 24 } },
  chefKinds: ["batch_expiring", "prep_due", "prep_raw_short", "raw_lot_expiring"],
  chefConfigurableKinds: ["batch_expiring", "prep_due", "prep_raw_short", "purchase_due", "raw_lot_expiring"],
  bounds: { dueSoonDays: {min: 1, max: 30}, overdueDays: {min: 1, max: 30}, rawLotDays: {min: 0, max: 7}, batchHours: {min: 1, max: 72} },
  updatedAt: "…Z" }
```

`PATCH` body: any non-empty subset of `{payableRemindersEnabled, payablesDigestEnabled, prepEnabled, purchaseEnabled, expiryEnabled,
payableDueSoonDays, payableOverdueDays, rawLotExpiryDays, batchUseByHours, chefKinds}` → 200 `{changed, settings}`.

The price-variance threshold is **not** part of this API. The screen reads it from the existing owner/admin `GET /api/settings` (Q9).

### 3.9 Screen (PR5, **UI-only**, Builder 2 may own it)

`/avvisi/impostazioni` (`src/app/(owner)/avvisi/impostazioni/page.tsx`, `alert-rules-form.tsx`), phone first at 360 px, in the house
style.
- It reads `GET /api/settings/alerts` and `GET /api/settings`, and writes through `PATCH /api/settings/alerts` only.
- The pure helpers live in `src/lib/alerts/alert-settings-view.ts`: the form state from the payload, the patch built from the changed
  fields only, the bound messages, and `canEditAlertSettings(role)` (owner or admin). Nothing is computed in React.
- Chef and waiter get the forbidden message; there is no read-only mode for them (Q5).

**Copy (all "(da approvare)")**

| Element | Italian |
|---|---|
| Title | "Regole degli avvisi" |
| Intro | "Gli avvisi restano nell'app, nella pagina Avvisi. Le modifiche valgono dal prossimo controllo orario." |
| Switch label, off badge | "Attiva" / "Spenta" |
| Card 1 | "Pagamenti in scadenza" · fields "Primo avviso: giorni prima della scadenza", "Avviso di ritardo: giorni dopo la scadenza" · note "Solo il titolare riceve questi avvisi: contengono importi." |
| Card 2 | "Riepilogo settimanale dei pagamenti" · note "Ogni lunedì, solo al titolare." |
| Card 3 | "Preparazioni" · checkboxes "Anche lo chef riceve «Da preparare»", "Anche lo chef riceve «Manca materia prima»" · link "Minimi e obiettivi delle ricette" → `/riordino/ricette` |
| Card 4 | "Ordini ai fornitori" · checkbox "Anche lo chef riceve «Ordina»" · link "Minimi e fornitori degli ingredienti" → `/riordino/ingredienti` |
| Card 5 | "Scadenze" · fields "Lotti in magazzino: giorni prima della scadenza", "Lotti prodotti: ore prima del «consumare entro»" · checkboxes "Anche lo chef riceve gli avvisi dei lotti in magazzino", "Anche lo chef riceve gli avvisi dei lotti prodotti" |
| Card 6 | "Variazione dei prezzi" · "Soglia attuale: {pct} %" · link "Modifica in Costi › Impostazioni" → `/costi/impostazioni` |
| Footer note | "Sempre attivi: scorte negative, dispositivo bloccato, controllo notturno." |
| Buttons and results | "Salva" · "Regole salvate." · "Nessuna modifica." |
| Errors | "Valore fuori dall'intervallo consentito ({min}–{max})." · "Questo avviso non può essere inviato allo chef." · forbidden: "Le regole degli avvisi sono disponibili solo per titolare e amministratore." |
| Entry links | on `/avvisi` (owner): "Regole degli avvisi"; on `/riordino` (owner, admin): a fourth card "Regole degli avvisi" |

No nav pill is added: the phone row is capped at 6 (`src/lib/nav/nav-model.ts:76`). Admin reads no alerts, so admin reaches the screen
from `/riordino`.

### 3.10 Pins that move (each commented "re-pinned on purpose by P2-4 (step N; was <old>)")

| File:line (main) | What | Step |
|---|---|---|
| `089:20`, `098:22`, `119:33`, `159:38`, `169:57`, `179:16` and `:50` | `alert_rules_body` md5 (`2ac38ab6…`) | 9 |
| `196:49` | `alert_rules_body` md5 of `prosrc` (`08aaae27…`) | 9 |
| `207:29` | `payable_reminder_rule` md5 of `prosrc` (`caf44c21…`). Its comment "keeps its inline 7" becomes "reads `payable_due_soon_days`; the dashboard twin keeps 7 (Q4)" | 6 |
| `207:30`, `255:10` | `expiry_rule` md5 of `prosrc` (`4b2fd508…`) | 7 |
| `346:38` | `job_health_checks` md5 (`fd3492f2…`) | 10 |
| `359_p22_preserves` `p27_objs` | a **separate** `insert into p27_objs values …;` after SP1's: `table tenant_alert_settings`; `constraint` CHECKs and FK; `trigger tenant.tenant_seed_alert_settings`; `app_fn` `chef_configurable_alert_kinds`, `seed_tenant_alert_settings`, `alert_settings_of`, `rule_expiry_state`, `rule_use_by_state`; `public_fn` `alert_settings`, `set_alert_settings` | 3, 4, 7 |
| `365_p27_roles_preserves` table, trigger and policy counts | +1 each (the builder reads the current values on main) | 3 |
| `286_m25c_preserves:51–52`; `207` t16, `214` t14, `229` t27, `296` t25 | public table lists gain `tenant_alert_settings` | 3 |
| `194` exemption list, `193` (+1 assertion) | configuration table | 3 |
| `327:125–128`, `346:64–68`, `229:72–73` | public catalogue md5 and counts: the left-outs gain `alert_settings`, `set_alert_settings` | 4 |
| `scripts/spike/sp00/sql/04_t4.sql` `c_seeded` | gains `tenant_alert_settings` (the clone's tenant insert seeds it, as SP1 found on #173) | 3 |
| `tests/config/m25-preserves.test.ts:23`, `m25a-preserves.test.ts:29`, `ux-quick-wins-preserves.test.ts:13`; `m25b-preserves.test.ts:177` | the newest migration / `ALLOWED_NEW_MIGRATIONS` | every migration step |
| `tests/config/m25b-preserves.test.ts` page list | one new page | 16 |
| `tests/guards/waiter-weight-no-cost.test.ts` route list | `GET` and `PATCH /api/settings/alerts` | 13 |

Rows 7–14 use the line numbers SP1's plan recorded; the builder confirms each one on main.

**Must pass unchanged:**
- pgTAP `043`–`046`, `060`, `072`–`075`, `083`–`084`, `091`–`093`, `140`–`148`, `389` (SP1 G), `390` (SP1 X, which now also covers the
  new table through its catalogue loop) and `396`;
- `tests/integration/alerts.int.ts` (kind parity: there is no new kind), `tests/integration/alert-rules.int.ts` and
  `e2e/alert-rules.spec.ts`.

**Any other failing pin is a stop. Report it to the lead; do not re-pin it silently.**

### 3.11 Security, privacy, RLS, secrets

- **Tenant boundary:**
  - The new table carries `tenant_id` and RLS, with select only for the tenant's owner and admin and no write grants. pgTAP `001` and
    SP1's `390` cover it automatically.
  - Every procedure takes the tenant from `app.tenant_id()`, never from the body.
  - The rules read the row of the tenant they are looping over.
  - X (step 2, extended in steps 3, 4 and 6–9) proves that B's settings never touch A.
- **Roles in Postgres:**
  - Writes go through `app.require_rules_writer()` (owner, admin, `aal`-gated). Chef and waiter get 42501, and their routes answer 403
    before any RPC.
  - Recipients are still enforced by the registry CHECKs, the alert table CHECKs, `raise_alert`'s guards and RLS. The setting can only
    choose between `owner` alone and `owner` plus `chef`.
- **Waiters never see costs; the chef never sees €:**
  - no new setting is a money value;
  - cost-bearing kinds are kept out of `chefKinds` four times over: the immutable list (CHECK), `set_alert_settings`, the Zod enum, and
    still `raise_alert`'s `alert_audience_cost`;
  - `purchase_due` sent to the chef carries quantities only (allow-list);
  - the one cost-adjacent threshold, `price_variance_pct`, stays behind `require_cost_reader` (owner, admin);
  - rule for any future threshold that is a money amount: it lives behind the cost reader, and the kind it drives must be
    `cost_bearing`.
- **Ledgers append-only:** no ledger table is written or altered. `alert` rows stay immutable: a setting change never edits an existing
  alert.
- **Procedures single-transaction:** `set_alert_settings` validates, locks, updates and audits in one transaction. The runner contract is
  unchanged.
- **Input validation:** strict Zod, and SQL repeats every check because Data API callers bypass Zod. The body limit is 4 KiB, and no free
  text is stored.
- **Audit:** one row per effective change, holding the changed keys only and the user id, as every audit row does. It shows on
  `/registro` under the existing label.
- **Personal data:** none added. `cron.job_run_details` is read for status and time only. GDPR roles and retention are unchanged (project
  Q13, Q14; DPA-1).
- **Secrets:** none new.
  - No P2-4 `src/` code uses the Supabase secret key.
  - The integration and e2e helpers keep using the local stack's key to call `alert_rules_run`, exactly as M16 does. That key is
    `SUPABASE_SECRET_KEY`, set in the Vercel environment and, locally, in `.env` (gitignored).
  - No third-party key, provider login or Vault value is added.
- **SP6 later:** `set_alert_settings` is a volatile function that `authenticated` can execute, so SP6's write-gate test will require
  `app.require_writable()` in it. P2-4 needs to do nothing now.

### 3.12 Multi-tenant and platform compatibility

- **No tenant-#1 literal.** Every tenant gets the same seed, and no uuid or name appears in a P2-4 migration (scanner in step 3).
- **SP5 entitlements** (platform plan §4.1, SP5 test 7): `run_alert_rules` must skip tenants that have `alerts` off.
  - That is one predicate on the body's tenant select (§3.5.4).
  - The per-rule switches here are tenant **preferences**, distinct from a sold entitlement. Both apply, the entitlement first.
- **SP7 wizard:** it inherits the seed trigger, so a new tenant starts with today's defaults. A restaurant preset can call
  `set_alert_settings`.
- **SP3 console health page:** `job_aborted` is a new finding code the page can show.
- **Migration range `20261206230000`–`20261206230600`:**
  - it sorts after opening stock's `2026120621*` and the comanda per uscita's `2026120622*` (both merge first, lead 2026-11-18) and before SP2's reserved `20261207100000` and SP3's `2026120810*`;
  - `sp1-preserves.test.ts:80` matches `20261206200*` and `ds-bq2-preserves.test.ts` matches `2026120610*`, so neither claims
    `2026120623*`;
  - if SP2 or the SP3 stack reaches `main` before a P2-4 migration PR merges, `supabase db push` on staging (run without
    `--include-all`) would meet an older file after a newer one. That case is **V1**.

---

## 4. Alternatives considered

- **Settings as keys in `tenant.settings` jsonb** (the M8 cost-settings pattern). It needs no new table. But the values are untyped, the
  readers need silent fallbacks (`app.setting_number`), which breaks Rule B, and the keys have no CHECKs. Rejected.
- **A key/value table `tenant_alert_threshold (tenant_id, key, value)`.** One row per setting is flexible. But per-key bounds would need a
  lookup function inside a CHECK, and rows could go missing key by key. Rejected for one typed row: there are five rules, and a new rule
  needs a migration anyway.
- **Per-tenant overrides inside `app.alert_kind`** (adding `tenant_id`). It would turn the global registry into tenant data, change its
  primary key and touch every raiser. Rejected.
- **Resolve the tenant's audience inside `app.raise_alert`.** It would give one place for every kind, `negative_stock` included. But it
  re-creates the most-pinned function (pinned in at least 5 files) for kinds the scope does not ask to change. Rejected for the base plan
  and kept as **V2** (Q3).
- **Disable a kind inside `raise_alert`** by returning without an insert. It changes the entry point's contract for event callers such as
  `approve_invoice`. Rejected (Q2); V4 covers price variance only.
- **A rule registry with dynamic dispatch.** Rejected again (§3.6).
- **A `PROCEDURE` runner with a `COMMIT` per rule, or one cron job per rule.** Either gives real timeout isolation, but each is a new
  runner contract and writes five times as many `job_run` rows. Deferred to **V7** until F7 shows a need.
- **F7 by parsing `return_message` for "statement timeout".** It would give a more precise label, but it reads text that may quote data.
  Rejected: status only.
- **Thresholds that also drive the dashboard and push list now.** That would be consistent, but it moves the dashboard SQL, the
  `z.literal(7)` and the M23 pins, none of which is in scope. Kept as **V3** (Q4).
- **A general "Impostazioni" hub page** (UX Q7). Rejected for now: one more settings screen does not justify a hub, and `/avvisi` is where
  the owner already looks.

---

## 5. Build plan

**Rules for every step:**
- Test first: write the named test, see it fail for the stated reason, then change the code. One commit per step.
- A test-only step names its **proof** instead: a mutation case that must fail, or the tree on which it fails.
- Every step ends with `npm run lint`, `npx tsc --noEmit`, `npm test` and `npx supabase test db` green. Migration steps also run
  `scripts/test-db-native.sh`.
- **[MIGRATION]** marks a step that adds a migration file; the lead reads it line by line.
- Each migration step adds its file to `tests/config/p24-preserves.test.ts` (created in step 3). That test asserts that:
  - the `2026120623*` files are exactly the steps built so far, sorted, after every `2026120621*` and `2026120622*` file and before `20261207100000`;
  - they create or replace only the objects of §3.3, and never one on the "not re-created" list (§3.3);
  - they contain no `insert into`, `update` or `delete from` on `app.alert_kind`;
  - they contain no `drop … cascade`, `delete from` or `truncate`;
  - they contain no uuid literal outside comments;
  - no new public name matches `cost|margin|price|service`;
  - they contain no `cron.schedule` or `cron.unschedule` (no new job), **except** exactly one `cron.schedule('cron-history-purge', …)`
    in migration 7 (Q8 ruling), and no `delete from` except the one inside that job's command on `cron.job_run_details`.

**PR split and size**

| PR | Steps | What | Size |
|---|---|---|---|
| **PR1** Baseline and settings store | 0–5 | G, X, the table (M1), the read/write procedures (M2), the race case. No behaviour change: nothing reads the settings yet | M |
| **PR2** Rules read the settings | 6–9 | payable thresholds (M3), expiry thresholds (M4), audience (M5), switches in the body (M6) | M |
| **PR3** F7 job health | 10–11 | `job_aborted` (M7), the 14-day purge of `cron.job_run_details` (M7, Q8 ruling), `reservation-mail` in the job-health lists, the shim, the `job_aborted` label | S |
| **PR4** API and docs | 12–15 | TS domain, `GET/PATCH /api/settings/alerts`, integration suite, ADR and runbook | M |
| **PR5** Screen (**UI-only**, Builder 2 may own it) | 16–19 | form and page, entry links, Playwright, verification and hand-off | M |

PR order: PR1 → PR2 → PR4 → PR5. PR3 depends only on PR1 and can merge before or after PR2.

| # | Step (one commit) | Files | Test that proves it (the first one fails first) |
|---|---|---|---|
| 0 | **Base check (no commit).** Confirm main's newest migration (the last `2026120622*` file of the comanda per uscita, which merges first) and pgTAP; check that no `2026120623*` file and no pgTAP ≥ 397 exists on any branch the lead knows of; compute on main the md5 values that `406` will pin | — | All suites green; newest migration `20261206200400_tenant_locale_settings.sql`, newest pgTAP `396` |
| 1 | **G: tenant #1 golden alert outputs** (characterization, before any change) | `supabase/tests/database/397_p24_golden_alerts.test.sql`; `tests/server/alerts/golden-render.test.ts` (new) | Built on `main`. **Fixture:** tenant-#1-shaped and fake, inserted as table owner, covering every hourly kind: payables due in 7 days, due today and 3 days overdue, plus the Monday digest; the M16 stew in its AT1 and AT2 shapes on two recipes; the Macelleria purchase; one raw lot expiring tomorrow and one expired; one batch at +20 h and one expired. **Runs:** `app.run_alert_rules` at three fixed clocks, `2026-11-02T14:00Z`, `2026-11-02T23:30Z` (the next Rome day) and `2026-10-25T01:30Z` (DST, fixture shifted). **Pins:** the md5 of the fixture tenant's `jsonb_agg((kind, entity_type, entity_id, business_date, severity, audience_roles, cost_bearing, payload) order by kind, entity_id, business_date)`, `job_run.items` per run, and zero `alert_refusal` rows. **Passes on main by design.** Its proof is a mutation case in the same file: moving one payable due date by a day makes the md5 differ. `golden-render.test.ts` pins the it/en title and body of each G payload with fake names (snapshot). Both files stay unchanged through step 19 (AT1) |
| 2 | **X: cross-tenant alert suite on Demo A/B** | `398_p24_cross_tenant_alerts.test.sql` | The same fixture in "Osteria Demo A" and "Osteria Demo B" (owners and chefs on `example.test`). On main, one run gives each tenant its own alerts, and A's set has G's shape (ids differ). B's owner reads 0 of A's alerts; B's chef reads only B's chef-audience alerts. **Passes on main by design.** Its proof is a mutation case: a temporary policy letting B read A must make it fail. Steps 3, 4 and 6–9 add B-specific settings and their assertions |
| 3 | **[MIGRATION 1] Settings table, seed, backfill** (§3.2) | `supabase/migrations/20261206230000_tenant_alert_settings.sql`; `399_p24_alert_settings_table.test.sql`; `406_p24_preserves.test.sql` (new); `tests/config/p24-preserves.test.ts` (new); `tests/parity/alert-settings-sql-parity.test.ts` (new); the step-3 rows of §3.10; `scripts/spike/sp00/sql/04_t4.sql` | **399 first test: "a tenant inserted after the migration has one `tenant_alert_settings` row with every switch true, 7, 3, 1, 24 and chef kinds {batch_expiring, prep_due, prep_raw_short, raw_lot_expiring}" (fails: table missing).** Then: <br>• every existing tenant is backfilled; <br>• out-of-bound values give 23514: 0 and 31 (days), −1 and 8 (raw lots), 0 and 73 (hours); <br>• `chef_alert_kinds` holding `price_variance` or `payable_due_7d` → 23514; <br>• every kind of `app.chef_configurable_alert_kinds()` exists in `app.alert_kind` with `cost_bearing = false`; <br>• `alert_settings_of` on a tenant without a row → P0001 `alert_settings_missing`; <br>• RLS: owner and admin read their row, chef and waiter read 0, B reads 0 of A's (X row); <br>• no write privilege for any API role; <br>• a demo purge keeps the row (`193`), and `begin_demo_data` still accepts a seeded tenant. <br>**406 first test:** "`app.raise_alert`, `try_raise_alert`, `run_alert_rules`, `prep_rule`, `purchase_rule`, `payables_digest_rule`, `chef_payload_allowed`, `expiry_state`, `use_by_state` keep the md5 values computed in step 0" (fails if any is edited). Then: the `app.alert_kind` rows equal main's (15 rows, same flags); the `alert-rules` cron row is unchanged and no cron job is added. **Parity:** the TS seed and bound constants equal the SQL literals; `CHEF_CONFIGURABLE_ALERT_KINDS` equals the SQL function, and each of its kinds is `costBearing: false` in `ALERT_KINDS`. **Vitest `p24-preserves`:** the file rules of §5 |
| 4 | **[MIGRATION 2] `alert_settings()` and `set_alert_settings(jsonb)`** (§3.4) | `…20261206230100_alert_settings_procedures.sql`; `400_p24_alert_settings_procedures.test.sql`; the step-4 rows of §3.10 | **400 first test: "owner A's `set_alert_settings('{\"rawLotExpiryDays\": 3}')` stores 3 and writes one `tenant.settings_changed` audit row whose before and after are exactly `{raw_lot_expiry_days: 1}` and `{raw_lot_expiry_days: 3}`" (fails: function missing).** Then: <br>• the same patch again → `changed: false`, no row; <br>• `chefKinds` in a different order from the stored one → no change; <br>• `chefKinds` with `price_variance`, or with a duplicate → `alert_chef_kind_invalid`; <br>• 31 days → `alert_threshold_out_of_range` with detail `payableDueSoonDays`; <br>• 1.5, `true` for a number, an unknown key, or `{}` → 22023; <br>• admin A is allowed (audit `created_by` = the admin); <br>• chef and waiter → 42501, nothing written; <br>• gated by #79 and FD31: an owner at `aal1` under `required`, and an admin at `aal1`; <br>• B's owner changes only B's row (X); <br>• `alert_settings()` as chef → 42501; its shape is §3.8's, with no key matching `/eur\|cost\|price\|margin\|amount\|total/i`; <br>• both functions are definers with an empty `search_path`, executable by `authenticated` only; `341` stays green |
| 5 | **Race case** | `scripts/test-db-races.sh` (one case appended) | CI `db-races`, existing cases unchanged. **`alert-settings-concurrent-writes`:** s1 runs `set_alert_settings({rawLotExpiryDays: 2})` and parks before commit; s2 runs `set_alert_settings({rawLotExpiryDays: 3})` and blocks on the row lock (`s2_blocked` 1); after the gate both commit, the final value is 3, there are two audit rows (1→2, 2→3), and `no_deadlock` holds. **Proof:** in a scratch copy with the `for no key update` removed, `s2_blocked` is 0 and the case fails |
| 6 | **[MIGRATION 3] Payable reminders read their days** (§3.5.1) | `…20261206230200_payable_rule_thresholds.sql`; `401_p24_payable_thresholds.test.sql`; `207:29`; `398` (B rows) | **401 first test: "with `payable_due_soon_days` 5, a payable due in 6 days raises no reminder, and one due in 5 days raises `payable_due_7d` dated D−5" (fails: 7 is hard-coded).** Then: <br>• overdue 1 → `payable_overdue_3d` from D+1; <br>• **no re-send:** with 7, a reminder is sent at D−7; after a switch to 5 on D−4 there is no second `payable_due_7d` for that payable; <br>• a due date moved after the reminder → re-fired (as today); <br>• `amount 0` → nothing (the M9 review fix is kept); <br>• a tenant without a settings row → P0001 `alert_settings_missing`; <br>• with the defaults, `073` (M9 reminders) stays green unchanged and G (397) stays unchanged; <br>• X: B with 5 days alerts on the 5-day payable and A does not |
| 7 | **[MIGRATION 4] Expiry reads its windows** (§3.5.2) | `…20261206230300_expiry_rule_thresholds.sql`; `402_p24_expiry_thresholds.test.sql`; `207:30`; `255:10`; `398` (B rows) | **402 first test: "with `raw_lot_expiry_days` 3, a lot of 1 kg expiring today + 3 raises `raw_lot_expiring` with `state_key` `due_soon`" (fails: the window is +1).** Then: <br>• `rule_expiry_state` with 1 day equals `app.expiry_state`, and `rule_use_by_state` with 24 hours equals `app.use_by_state`, over a vector of dates and instants that includes 2026-10-25 and 2027-03-28; <br>• 0 days → only lots expiring today, and expired ones; <br>• 48 hours → a batch at +40 h alerts; with 24 it does not; <br>• expired stays critical whatever the window; <br>• **DST:** with 24 hours, a batch whose use-by is 24 elapsed hours after a run at `2026-10-24T23:30Z` alerts, as `147` asserts today; <br>• `147` stays green unchanged and G stays unchanged; <br>• X: B with 3 days alerts on the +3 lot and A does not |
| 8 | **[MIGRATION 5] Chef audience from the settings** (§3.5.3) | `…20261206230400_rule_alert_audience.sql`; `403_p24_rule_audience.test.sql`; `398` (B rows) | **403 first test: "with `chef_alert_kinds` lacking `prep_due`, the stew run raises `prep_due` with `audience_roles` {owner}, and the chef's claims read 0 rows of it" (fails: the audience is {owner,chef}).** Then: <br>• with `purchase_due` added, the AT3 alert has {owner,chef}, the chef reads it, and its payload passes `chef_payload_allowed`; <br>• an alert raised before the change keeps its audience (the row is immutable); <br>• payables still go to {owner}; <br>• with the defaults the audiences equal the registry defaults (`144` and `145`–`147` green, G unchanged); <br>• X: B's chef sees no prep alert, while A's chef still does |
| 9 | **[MIGRATION 6] Switches in the body; the settings-missing refusal** (§3.5.4) | `…20261206230500_alert_rules_body_p24.sql`; `404_p24_rules_body.test.sql`; the body pins of §3.10 (`089`, `098`, `119`, `159`, `169`, `179`, `196`); `398` (B rows) | **404 first test: "with `purchase_rules_enabled` false, a run on the Macelleria fixture raises no `purchase_due` and still raises the stew and expiry alerts" (fails: the rule runs).** Then: <br>• each of the five switches off → none of its kinds, the others present; switched back on → raised on the next run; <br>• a tenant whose row is deleted inside the test transaction (as table owner) → one `alert_refusal (caller alert_rules, code settings_missing)`, and the next tenant's alerts are still raised; <br>• **isolation (M16's `148` case kept):** with `app.purchase_rule` replaced by a raising stub, the prep and expiry alerts commit and there is one `rule_failed (purchase_rules)`; <br>• the body text contains the five M9/M16 calls in order; one definition each of the body and the runner; `app.run_alert_rules` md5 still `ff878123…`; <br>• `148` green and G (397) unchanged; <br>• X: B with purchase off has no `purchase_due` and A has one (AT4, AT7) |
| 10 | **[MIGRATION 7] F7: `job_aborted` from `cron.job_run_details`** (§3.7) | `…20261206230600_job_health_cron_runs.sql`; `405_p24_job_health_cron.test.sql`; `supabase/tests-native/platform_shim.sql`; `346:38` | **405 first test: "a `cron.job_run_details` row for job `alert-rules` with status `failed` and `end_time` inside the window yields `('job_aborted', 1, '{}', 'alert-rules')`" (fails: no such check).** Then: <br>• `succeeded` rows → nothing; <br>• a failed row before `v_since` or after `p_at` → nothing; <br>• a job name outside the list → nothing; <br>• with no failed rows, the function's output equals main's output for the same fixture, row for row (the job-health golden); <br>• the function never references `return_message` or `command` (scan of `pg_get_functiondef`); <br>• **T1:** inside the test, with `set local statement_timeout = '200ms'` and `app.prep_rule` replaced by a `pg_sleep(1)` stub, `app.run_alert_rules(p_at)` raises 57014 and leaves no `job_run` row (the mechanism F7 detects); <br>• `233`, `300` and `347` green; one definition |
| 11 | **`job_aborted` key and label in TS** (§3.7). The four missing job keys (flag 3) and the parity test shipped earlier as their own fix PR (lead ruling) | `src/server/alerts/templates.ts`; `src/lib/i18n/messages/{it,en,keys}.ts`; `tests/server/alerts/templates.test.ts`; `tests/parity/drift-keys-sql-parity.test.ts` (extended) | **First test: "a `ledger_drift` payload with check `job_aborted` and job `alert-rules` renders 'attività pianificata interrotta: alert-rules', not the fallback" (fails: `DRIFT_CHECK_KEYS` lacks `job_aborted`).** Then: <br>• the en text; <br>• `cron-history-purge` renders if migration 7 lists it (the parity test from the fix PR fails otherwise); <br>• `DRIFT_CHECK_KEYS` ⊇ every `check_key` literal of the latest `job_health_checks` and `ledger_checks_body` |
| 12 | **The alert-settings domain in TS** | `src/server/alert-settings/{constants,schemas,output,errors}.ts`; `src/lib/alerts/alert-settings-view.ts`; `src/lib/api/errors.ts` (`ErrorCode` gains `alert_threshold_out_of_range`, `alert_chef_kind_invalid`, `alert_settings_missing`); `src/lib/i18n/messages/{it,en,keys}.ts`; `tests/server/alert-settings/{schemas,output,errors}.test.ts`; `tests/lib/alerts/alert-settings-view.test.ts` | **First test: "`alertSettingsPatch` refuses `{chefKinds: ['price_variance']}`" (fails: schema missing).** Then: <br>• refused: an unknown key, an empty object, 31 days, −1, 1.5, duplicate kinds; <br>• the output schema refuses an injected `priceVariancePct` or `amountEur` key (strict); <br>• each SQL code maps to its status and Italian message; an unknown SQLSTATE → 500 without text; <br>• view helpers: the form state from a payload; a patch holding only the changed fields; `canEditAlertSettings` true for owner and admin only; the bound message "Valore fuori dall'intervallo consentito (1–30)." |
| 13 | **`GET` and `PATCH /api/settings/alerts`** | `src/server/alert-settings/settings.ts`; `src/app/api/settings/alerts/route.ts` (new); `tests/app/api/settings-alerts.test.ts` (new); `tests/guards/waiter-weight-no-cost.test.ts` (route list); `docs/go-live/rate-limits.md` only if `tests/config/rate-limits-doc.test.ts` requires a row for every write route | **First test: "an owner's PATCH `{prepEnabled: false}` calls `set_alert_settings` once with `p_patch` and answers 200 `{changed: true, settings}`" (fails: route missing).** Then: <br>• GET by owner or admin → 200 with one RPC; chef and waiter → 403 before any RPC; no session → 401; <br>• `text/plain` → 415; over 4 KiB → 413; `{extra: 1}` → 400 without an RPC; <br>• each P0001 code → 422 with its text; 42501 → 403; `mfa_required` → 403, as on every route; <br>• the cost guard finds no money key; not offline-cacheable (`tests/lint/offline-cache-allowlist.test.ts` green) |
| 14 | **Integration suite on the local stack** | `tests/integration/alert-settings.int.ts` (new); `tests/integration/helpers/alert-rules.ts` (reused unchanged) | **First test: "after the owner PATCHes `chefKinds` without `prep_due`, `alert_rules_run` → the chef's `GET /api/alerts` has no 'Da preparare oggi' and the owner's has it".** This is an end-to-end check of steps 4–13, so it passes once written. **Proof:** a mutation case in the same file (the helper sends `chefKinds` with `prep_due`) must make the chef assertion fail. Then: <br>• `purchaseEnabled: false` → the owner gets no "Ordina …"; <br>• `chefKinds` + `purchase_due` → the chef sees "Ordina 10 kg di Manzo muscolo (demo) …" with no `€`; <br>• a chef PATCH → 403; the owner's `from('tenant_alert_settings').update(...)` → permission error; <br>• B's owner GET shows B's values only; <br>• `alert-rules.int.ts` and `alerts.int.ts` green unchanged (AT1 at API level) |
| 15 | **ADR, runbook, ADR-006 and ADR-015 statuses** | `docs/adr/adr-047-alert-rule-settings.md` (status "proposed"; number = the next free one on main; SP1 took 046, Q10); `docs/adr/adr-006-alert-pipeline.md` (status **"accepted"** with a dated note, Q10 ruling, and a dated "Note 2026-11-18" under Consequences: M9's per-rule blocks superseded the "whole body" line, and P2-4 revisits isolation in ADR-047); `docs/adr/adr-015-*.md` (status **"accepted"** with a dated note, Q10 ruling); `docs/runbook.md` ("Regole degli avvisi": what each switch does; changes apply from the next hourly run; the `job_aborted` finding and what to check) | `tests/config/runbook.test.ts` green; the ADR template's fields are present; the ADR states the decision, the rejected alternatives (§4) and when to revisit it: OQ-1 / C5 sensor alarms, F7 findings (V7), SP5 |
| 16 | **[UI-only] Rules form and page** (§3.9) | `src/app/(owner)/avvisi/impostazioni/{page,alert-rules-form}.tsx`; `tests/components/alert-rules-form.test.ts`; `tests/components/alert-settings-page.test.ts`; `tests/config/m25b-preserves.test.ts` (page list) | `renderToStaticMarkup` with fixture payloads. **First test: "the form renders five rule cards with 'Attiva' switches and the payable fields at 7 and 3" (fails: component missing).** Then: <br>• the expiry card shows 1 and 24, with the bounds as hints; <br>• the chef checkboxes reflect `chefKinds`, and payables have none; <br>• card 6 shows "Soglia attuale: 10 %" from the `/api/settings` fixture, with its link; <br>• the forbidden payload → the forbidden message; <br>• the markup has no `€`; card 6 shows only a percentage; <br>• the page calls only the two GET routes and the PATCH route (fetch spy) |
| 17 | **[UI-only] Entry links** | `src/app/(owner)/avvisi/page.tsx`; `src/app/(owner)/riordino/page.tsx`; `tests/components/riordino-page.test.ts`; `tests/components/avvisi-page.test.ts` (new or extended) | **First test: "the /riordino page for an admin shows a fourth card 'Regole degli avvisi' linking to /avvisi/impostazioni" (fails: three cards).** Then: the chef's `/riordino` has no such card; the owner's `/avvisi` shows the link; the nav model is unchanged (`tests/lib/nav/nav-model.test.ts` green, still at most 6 pills) |
| 18 | **[UI-only] Playwright at 360 px and 1280 px** | `e2e/alert-rules-settings.spec.ts` (new); `e2e/helpers/seed-rules.ts` (reused) | Test-only commit. **Proof:** the spec fails on `main` (the page is missing). **360 × 740, owner:** open `/avvisi` → "Regole degli avvisi" → untick "Anche lo chef riceve «Da preparare»" → "Salva" → "Regole salvate."; seed the stew; after the rules run, the **chef's** `/avvisi` has no "Da preparare oggi" and the owner's has it. Admin opens the screen from `/riordino` and it loads. The chef on `/avvisi/impostazioni` gets the forbidden message. `expectPhoneFriendly` in light and dark. **1280 × 800:** the content stays in the page column. `e2e/alert-rules.spec.ts` green unchanged |
| 19 | **Verification and hand-off** | the PR descriptions | Full suites green; coverage of new TS ≥ 80 %; `code-reviewer` PASS on each PR; AT1–AT7, G and X mapped to passing tests. **T2 on staging:** after PR3 deploys, `select count(*) from app.job_health_checks('<a staging tenant id>', now())` runs without error as the migration owner, and pgTAP `405` passed on the local Supabase stack (real pg_cron). **T3 on staging (the lead's choice):** a one-off cron job `p24-t3-check` running `select 1/0` is scheduled by hand, left to run once and unscheduled; its `cron.job_run_details` row has `status = 'failed'`, and the next nightly `ledger_drift` on staging lists `job_aborted` only if the job name is in the list (it is not, so nothing is listed). This confirms the status value without touching a production job |

**Acceptance tests → steps**

| Test | Steps |
|---|---|
| AT1 | 1 (G pins, render snapshot), kept by 3–18; 14 (API level) |
| AT2 | 6, 7 |
| AT3 | 3 (CHECK), 4, 8, 12, 14, 18 |
| AT4 | 9, 14 |
| AT5 | 4, 5, 13 |
| AT6 | 9 (`rule_failed`, `settings_missing`), 10 (T1, `job_aborted`), 11 (rendered, not the fallback) |
| AT7 | 2, extended in 3, 4, 6, 7, 8 and 9; 14 |
| G | 1, kept green and unchanged by 3–18 |
| X | 2, extended as above |

**Order that keeps tenant #1 working at every commit:**
- Steps 1–2 add tests only.
- Steps 3–5 add a table and procedures that nothing reads yet.
- Steps 6–9 read seeded values equal to today's literals, and G stays green at each.
- Steps 10–11 add a finding that is empty unless a cron run failed, and fix the fallback rendering.
- Steps 12–18 add an API and a screen.

### 5b. Variants

**V1 — SP2 or the SP3 stack reaches `main` before a P2-4 migration PR** · Trigger: a `20261207*` or later file is on `main` while a P2-4
migration is still unmerged · Replaces: the file names of the unmerged migration steps (3, 4, 6–10) and the range rule of
`p24-preserves`.

| # | Step | Files | Test |
|---|---|---|---|
| V1.1 | Rename the unmerged P2-4 migrations to the first free day after main's newest, keeping their order and their `…21xx00` suffixes | those files; the newest-migration pins; `p24-preserves.test.ts` | `p24-preserves`: P2-4's unmerged files sort after every file on `main`, and P2-4 files already merged keep their names |
| V1.2 | Recompute the counts SP2/SP3 moved (`365`, the `359` additions, the catalogue left-outs) on top of theirs | `365`, `359`, `327`, `346`, `229` | the same pgTAP files green on the merged tree; `supabase db push --dry-run` on staging lists only P2-4's files |

**V2 — The chef audience also applies to `negative_stock`** · Trigger: Q3 answered "include negative stock" · Replaces: the "not
re-created" status of `app.raise_alert` (§3.3) and the configurable list of step 3.

| # | Step | Files | Test |
|---|---|---|---|
| V2.1 | **[MIGRATION]** `app.chef_configurable_alert_kinds()` gains `negative_stock`. `app.raise_alert` is re-created from `20261026100200:67` verbatim except step 2, which becomes `coalesce(p_audience, <tenant setting for the kind if configurable>, v_kind.default_audience)` | new migration; the `raise_alert` pins in `119`, `149`, `159`, `179` re-pinned on purpose; `406` updated | pgTAP: with `negative_stock` removed from B's chef kinds, an M12 outflow below zero raises it with {owner} for B and {owner,chef} for A; every guard keeps its order and code (`044`, `091` green); G unchanged |

**V3 — The thresholds also drive the dashboard and push list** · Trigger: Q4 answered "same windows everywhere" · Replaces: flag 4's
"alerts only" and the dashboard's `z.literal(7)`.

| # | Step | Files | Test |
|---|---|---|---|
| V3.1 | **[MIGRATION]** The dashboard twin `app.payable_due_soon_days()` becomes `(p_tenant)` and reads `payable_due_soon_days`; the stock-risk tile and the push list read `rule_expiry_state` / `rule_use_by_state` with the tenant's windows | new migration; the dashboard and M23 pins (`207`, `255`, dashboard parity test) re-pinned on purpose | pgTAP: B with 5 days → the tile's `dueSoonDays` is 5 and its rows are ≤ D+5; A unchanged (the dashboard snapshots in `tests/server/dashboard/__snapshots__` unchanged for A) |
| V3.2 | `dueSoonDays: z.number().int().min(1).max(30)` in `output.ts:140` and `sql-schema.ts:41` | those files; `tests/server/dashboard/*.test.ts` | the strict schema accepts 5 and refuses 31; A's snapshot unchanged |

**V4 — The price-variance alert can be switched off** · Trigger: Q2 answered "allow switching price variance off" · Replaces: nothing;
it adds a sixth switch.

| # | Step | Files | Test |
|---|---|---|---|
| V4.1 | **[MIGRATION]** A column `price_variance_enabled boolean not null` (backfilled true, seeded true). `approve_invoice`'s variance block raises only when it is true; the rest is re-created verbatim | new migration; `061` and the `approve_invoice` pins re-pinned on purpose | pgTAP: with B off, an approval over the threshold writes its price rows and **no** `price_variance` alert; A unchanged; the approval stays one transaction |
| V4.2 | API key `priceVarianceEnabled`; card 6 gains the switch | `schemas.ts`, `output.ts`, `alert-rules-form.tsx`, their tests | route and component tests as in steps 13 and 16, for the new key |

**V5 — API only, no screen in P2-4** · Trigger: Q1 answered "no screen yet (SP7 wizard)" · Replaces: steps 16–18.

| # | Step | Files | Test |
|---|---|---|---|
| V5.1 | No page is built. The runbook records that the owner asks DigiAlto for a change, and that DigiAlto (admin) applies it through `PATCH /api/settings/alerts` with the owner's agreement, recorded in the audit log | `docs/runbook.md` | `tests/config/runbook.test.ts` green; the `m25b-preserves` page list unchanged (no new page); the route tests of step 13 prove the write path, and step 14 proves its effect on the chef's list |

**V6 — Only the owner may change alert settings** · Trigger: Q5 answered "owner only" · Replaces: the writer role of steps 4 and 13, and
the admin cases of steps 4, 13, 17 and 18.

| # | Step | Files | Test |
|---|---|---|---|
| V6.1 | **[MIGRATION]** `app.require_alert_settings_writer()` (owner only), used by `set_alert_settings`; `alert_settings()` stays readable by owner and admin | new migration; `400` | admin `set_alert_settings` → 42501; owner allowed; admin `alert_settings()` → 200 |
| V6.2 | The PATCH route takes `roles: ["owner"]`; the form is read-only for admin | route; `alert-settings-view.ts`; their tests | admin PATCH → 403 before any RPC; the admin's form shows the values as text and has no "Salva" |

**V7 — The runner commits per rule** · Trigger: Q7 answered "yes", for example after `job_aborted` names `alert-rules` in production ·
Replaces: the "never replaced" contract of `run_alert_rules` (pins `075`, `089`, `119`, `148`, `149`, `159`, `196`) and step 9's
single-transaction runner.

| # | Step | Files | Test |
|---|---|---|---|
| V7.1 | **[MIGRATION]** `app.run_alert_rules_each()`, a `PROCEDURE` that loops over tenants × enabled rules, each in its own transaction (`COMMIT` after each), with its own `job_run` begin/end per rule. The cron command becomes `call app.run_alert_rules_each()`, `alert_rules_run` (service role) calls it, and ADR-047 is amended | new migration; the re-pins listed above; `405` | pgTAP / native: with a `pg_sleep` stub in `prep_rule` and `statement_timeout` at 200 ms, the payable and digest alerts of the same run are committed and their `job_run` rows are `ok`; the prep rule's row is missing and `job_aborted` names `alert-rules`; G unchanged with the defaults |

---

## 6. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | A tenant without a settings row silently gets no alerts | seed trigger and backfill in one migration; a `settings_missing` refusal on every run (step 9), reported nightly as `alerts_refused`; `399` asserts every tenant has a row |
| R2 | Changing the payable days re-sends reminders | the pre-check by stage and due date (§3.5.1); the "no re-send" case in `401` |
| R3 | A cost kind reaches the chef through the setting | the immutable configurable list (CHECK), `set_alert_settings`, the Zod enum, `raise_alert`'s cost guard and RLS; `399`, `400`, `403`, step 12 |
| R4 | The owner expects a change to affect today's alert (audience) or the dashboard | the screen's intro says "dal prossimo controllo orario"; Q4, Q11; runbook (step 15) |
| R5 | Switching off the purchase or expiry rule hides real problems | the switch is explicit, audited and shown as "Spenta"; the integrity kinds (`negative_stock`, `ledger_drift`) cannot be switched off (Q2) |
| R6 | A 57014 still loses a whole run (timeouts are not isolated) | detected the next night (`job_aborted`); `job_stale` after 3 h as today; V7 if it happens (Q7) |
| R7 | The definer cannot read `cron.job_run_details` on hosted Supabase (T2) | proved locally on the Supabase stack in `405` and on staging in step 19. If staging refuses, PR3 is not promoted and the builder reports to the lead before any change of design |
| R8 | `cron.job_run_details` grows without bound (pg_cron does not purge it, source S2), so the nightly read slows down | the query filters by the `end_time` window and joins on `jobid`; the volume is an existing matter (Q8) |
| R9 | The merge order with opening stock, the comanda per uscita, SP2 or SP3 breaks `db push` | the range sits after both pre-go-live plans and before SP2; V1 |
| R10 | Rebase conflicts on shared pins (`359`, `365`, `327`, `346`, `229`, m25*) | a separate `p27_objs` insert; SP1's §3.10 union rules (add, never overwrite), written into each PR description |
| R11 | Security: a waiter or chef changes the rules, or B writes A | `require_rules_writer` (`aal`-gated), no table grants, the tenant taken from the token; `400`, X, route tests |

**Unverified technical assumptions (each proved in the named step):**
- **T1:** `exception when others` does not catch `query_canceled` (57014), so a timeout rolls back the whole run, `job_run` included.
  Source S1 (PostgreSQL docs, PL/pgSQL "Trapping Errors"); the page could not be fetched from this session. Proved in `405` (step 10).
- **T2:** the migration owner can select `cron.job_run_details` on Supabase. Proved locally in `405` and on staging in step 19.
- **T3:** pg_cron records a run that raised an error with `status = 'failed'`. The pg_cron README shows `failed` rows (source S2). The
  local tests insert rows directly; step 19 confirms the status on staging with a one-off failing job, if the lead wants it.

**Secrets:** none added or moved (§3.11).

---

## 7. Open questions for the lead / founder

| # | Question | Recommended default (applies unless answered) |
|---|---|---|
| Q1 | A settings screen in P2-4, or the API only until SP7? | The screen now, at `/avvisi/impostazioni`: the scope's value is "the owner can adjust" (V5 otherwise) |
| Q2 | Which rules may be switched off? | Only the five hourly rules. These stay always on: `price_variance` (it has its own threshold), `negative_stock` and `ledger_drift` (integrity), `device_locked` (security). V4 for price variance |
| Q3 | Which kinds have a configurable chef audience? | The five non-cost rule kinds: `prep_due`, `prep_raw_short`, `purchase_due`, `raw_lot_expiring`, `batch_expiring`. This answers M6 Q1 and M16 Q60 as settings. `negative_stock` keeps its registry default (V2 to include it) |
| Q4 | Should the new windows also change the dashboard tiles and the push list? | No, alerts only; the screen and the runbook say so (V3 otherwise) |
| Q5 | Who may change alert settings? | Owner and admin, audited: the scope's proposal, and the same as M8 Q10/Q11 and M16 (V6 = owner only). Chef and waiter get no access, not even to read |
| Q6 | The bounds of the thresholds | Proposed: payable reminder 1–30 days before; overdue 1–30 days after; raw lots 0–7 days; batches 1–72 hours. These are engineering limits, not client facts; the founder may set others |
| Q7 | If `job_aborted` ever names `alert-rules`, should the runner commit per rule? | Not now: detect first (V7 on evidence) |
| Q8 | pg_cron does not purge `cron.job_run_details` (source S2), and `reservation-mail` runs every minute. Should DigiAlto add a purge, and should `reservation-mail` join the job-health lists? | **Ruled (lead, 2026-11-18): in P2-4 PR3, not later.** A daily purge of rows older than 14 days, in migration 7, pinned by `405`; `reservation-mail` joins the job-health lists F7 reads cheaply (§3.7) |
| Q9 | Should `price_variance_pct` move out of `tenant.settings` jsonb (silent fallbacks, against Rule B) into a typed setting? | **Ruled (lead, 2026-11-18): after P2-4, as its own S item** (see "Follow-ups" below). In P2-4 it is shown read-only with a link |
| Q10 | The ADR number, and the ADR statuses | **Ruled (lead, 2026-11-18):** ADR-047 with status "proposed". In step 15, also mark ADR-006 and ADR-015 **"accepted"** with a dated note (both are built and running), plus the ADR-006 correction note on the per-rule savepoints |
| Q11 | A change made during the day applies from the next hourly run, and items already alerted today keep today's alert? | Yes (dedup key and immutable rows); the screen says so |
| Q12 | Ratify the migration range and the order | **Ratified, then changed (lead, 2026-11-18):** P2-4 merges after opening stock (`2026120621*`) and the comanda per uscita (`2026120622*`), both pre-go-live, so its range is `20261206230000`–`230600`; still before SP2 |
| Q13 | Should "expired stock alerts every day" (M16 Q64) become a switch too? | No: M16's V6 stays the path if the founder answers Q64 differently |

**Lead review, 2026-11-18 (PR #194): plan accepted.** Every default above stands, except where a row says "Ruled". Q6: the bounds as
proposed. Q8, Q9, Q10 and Q12 as ruled in their rows. The `DRIFT_JOB_KEYS` bug (flag 3) ships now as its own small fix PR, test-first
("a drift alert naming `kpi-rollup` gets its real text"), before P2-4 PR1, and is dropped from step 11. Order: the drift fix, then P2-4
PR1.

**Follow-ups after P2-4 (not in this plan's steps):**
- `price_variance_pct` out of `tenant.settings` jsonb into a typed, audited setting with no silent fallback (Q9, Rule B). Size S.

---

## 8. Sources

| ID | URL | Used for |
|---|---|---|
| S1 | https://www.postgresql.org/docs/current/plpgsql-control-structures.html | T1: in PL/pgSQL exception handlers, "OTHERS" does not match `QUERY_CANCELED` (or `ASSERT_FAILURE`). **Not fetched in this session** (the host is not reachable from the sandbox); proved by test in step 10 |
| S2 | https://github.com/citusdata/pg_cron | `cron.job_run_details` columns (`jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time`); rows with `failed` status; "the records in the table are not cleaned automatically"; `cron.log_run` on by default (read 2026-11-18) |
| S3 | https://supabase.com/llms/cli.txt (SP1's S1) | `supabase db push` and `--include-all`, for V1 |

---

## 9. Differences found between the plans and the code

1. **The scope's C9 risk text (line 330) and ADR-006's Consequences (line 75)** say one failing rule rolls back the whole hour's body.
   - The code has isolated each tenant × rule since M9 (`20261024100300:20–24, 193–203`), M16 kept it (`20261030100800:4–7, 17–43`), and
     M16 pgTAP `148` tests it.
   - The only remaining whole-run loss is a cancelled run (57014), which is F7.
2. **M16 plan §3.9** says M27 "replaces `alert_rules_body` only after re-pinning `148`/`149`". On main, `148` and `149` do not pin the
   body's md5. It is pinned in `089`, `098`, `119`, `159`, `169`, `179` (`pg_get_functiondef`) and `196` (`prosrc`), and all of these
   move in step 9.
3. **M16 plan §2** lists the body's md5 pins as `089`, `098` and `119`. Later milestones added four more (item 2).
4. **Closeout F7 (`phase1-closeout.md:57`)** says job health "reads `alert_refusal` only". It also has `job_stale` for `alert-rules`
   (`20261201100500:84–90`), which catches **repeated** timeouts after three hours. Single or intermittent timeouts stay invisible.
5. **`DRIFT_JOB_KEYS` (`templates.ts:225–231`) is incomplete.**
   - It lacks `kpi-rollup`, `reservation-retention`, `mfa-failure-retention` and `reservation-mail`, all of which `job_health_checks` can
     name.
   - A `ledger_drift` naming one of them renders the generic fallback (`render.ts:45–59`).
   - This live bug predates P2-4; step 11 fixes it.
6. **`reservation-mail`** is in `job_run_job_check` (`20261201100500:17`), but in neither the `job_stale` checks nor the
   `job_unscheduled` list (`:138`) (Q8).
7. **The scope's founder question** asks "which rules must be configurable … who may change them (owner and admin, audited, like M8
   Q10/Q11)".
   - `price_variance_pct` is already such a setting (`20261023110000:137–209`).
   - It is stored with silent fallbacks (`app.setting_number`, `:47–61`), unlike SP1's Rule B (Q9).
8. **The dashboard's payables window** is pinned to 7 in TS (`src/server/dashboard/output.ts:140`, `sql-schema.ts:41`). It has an SQL
   twin, `app.payable_due_soon_days()` (comment in pgTAP `207:29`). A per-tenant reminder window therefore diverges from the tile unless
   V3 is chosen (Q4).
9. **ADR-006 and ADR-015** still read "Status: proposed" although both are built and in production use (Q10). ADR-033 already reads
   "accepted" and is not touched.
