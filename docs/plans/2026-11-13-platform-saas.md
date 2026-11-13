# Tech plan: Osteria Digitalization · Platform SaaS (the app as a DigiAlto product for many venues)

- **Client slug / internal:** `osteria-dei-rossi` is tenant #1; this is an internal DigiAlto planning document (English).
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-platform-saas`, branch `docs/platform-saas` (at `origin/main`).
  Documents only, no code.
- **Author:** architect · **Date:** 2026-11-13
- **Status:** proposal. **Planning only.** The build starts after go-live (2027-01-12) and the two-week supervised run (Gate 4), at
  the founder's order. No date is promised here.
- **ADR drafts (status Proposed):** `docs/adr/adr-037-platform-layer-and-support-access.md`,
  `docs/adr/adr-038-memberships-and-organisations.md`, `docs/adr/adr-039-entitlements-and-tenant-status-in-postgres.md`,
  `docs/adr/adr-040-tenant-export-and-erasure.md`. ADR-036 is TOTP (PR #79, unmerged).
- **Inputs read:** `CLAUDE.md`; `docs/prd.md` (guiding constraints, scope table, running-cost target); `docs/client-facts.md`;
  `docs/plans/2026-10-21-project-plan.md` (§1, §3, §3.5, §3.6, §3.11, §5, §5a, Q9, Q11, Q13); `docs/plans/2026-11-11-phase2-scope.md`
  (Parts 1–2); the P2-1 TOTP plan (`/home/user/osteria-p21/docs/plans/2026-11-12-p2-1-totp.md`, branch `feat/p2-1-totp`, PR #79);
  ADR-003, ADR-018, ADR-029, ADR-031, ADR-032, ADR-034; `docs/go-live/rate-limits.md`, `docs/go-live/phase1-closeout.md`,
  `docs/go-live/checklist.md`; the migrations and source files cited in §5.4 (every hard-coded assumption has a file:line).
- **Client facts used:** only the trading name "Osteria Dei Rossi" (approved 2026-10-22), to name tenant #1. No other client fact.
- **ID scheme:** milestones **SP0–SP13**; variants **V1–V14**; founder decisions **FD1–FD24**; hard-coded assumptions **H1–H40**;
  spike checks **T1–T5**.
- **How this file maps to `templates/tech-plan.md`:** §1 = goal, scope and current state; §2–§8 = design; §9 = alternatives; §10 =
  build plan (milestones with acceptance tests) and §10b = variants; §11 = risks (with secrets); §12 = founder decisions and open
  questions; §13 = sources.

---

## 0. Summary for the founder (plain language)

**What changes.** Today the app is built for one osteria. To sell it to other restaurants, bars and coffee shops, it needs five things it
does not have yet:

1. **A DigiAlto "back office" that is separate from the venues' data.** DigiAlto staff get their own console to create venues, see if
   they are healthy and switch modules on or off. The console shows *about* a venue (name, status, plan, usage numbers), never its
   invoices, costs or orders.
2. **Help that the venue agrees to.** When DigiAlto support needs to look inside a venue, it asks; the venue's owner taps "Allow" for a
   limited time; everyone in the venue sees a banner while support is in; every action is logged with support's own name; the owner can
   end it at any moment. Support never logs in *as* someone else.
3. **One login for many venues.** An owner with two places signs in once and switches venue. Each venue's data stays fully separate,
   exactly as today.
4. **Modules on and off per plan.** Plans (names and prices are yours to decide) switch modules on or off. The database itself refuses
   what a plan does not include, not only the screens. Switching a module off never deletes data.
5. **Settings instead of osteria rules in the code.** Today some things are fixed for an Italian osteria: the five courses (antipasti …
   bevande), "every sale has a table and covers", the VAT list, the time zone in the screens, the name and colours. I found **40** such
   places (§5.4). Bars and coffee shops need counter sales without tables, quick orders and tabs; those are a separate, larger step.

**What stays the same.** Every safety rule of the current app stays: each venue sees only its own data, roles are checked by the
database, waiters never see costs, stock is never edited (only corrected by new entries). **Osteria Dei Rossi becomes venue #1 with no
change on its screens**: each step is tested against a copy of today's behaviour before it ships.

**What I need from you first (§12):** who owns the code if it becomes a product (open question Q11, blocking); plan names, prices and
whether to use a billing provider (I list options only); sign-up by invitation (my recommendation) or open sign-up with a trial; how
long DigiAlto keeps a cancelled venue's data before erasing it (with a legal adviser); a paid Supabase plan before venue #2 (Supabase's
documentation lists daily backups for paid plans only); and whether DigiAlto keeps its current admin accounts inside Osteria Dei Rossi
or moves to the "ask and allow" support model.

**Size, no dates:** fourteen milestones (SP0–SP13): 4 large, 7 medium, 3 small; plus variants you may switch on later. A spike (SP0)
comes first, because two Supabase behaviours this design relies on must be proven on the real stack before anything is built.

---

## 1. Goal, scope and current state

### 1.1 Goal
Turn the single-venue app into a multi-tenant DigiAlto product for restaurants, bars and coffee shops, with a platform layer outside
tenant RLS, consented support access, per-tenant feature entitlements enforced in Postgres, a tenant lifecycle with GDPR export and
erasure, and per-tenant configuration replacing the osteria assumptions, while Osteria Dei Rossi continues as tenant #1 without
disruption.

### 1.2 In scope (this plan)
Role model (platform and tenant); support access; memberships across tenants and organisations (groups); tenant lifecycle (provision,
onboarding, trial, active, suspended, cancelled, export, erasure); feature flags and tier candidates (no prices); venue types and
per-tenant configuration; inventory of hard-coded assumptions; data protection roles, backups, quotas, observability, migrations, slugs
and domains; commercial plumbing options; migration path for tenant #1; milestones with acceptance tests; founder decisions.

### 1.3 Out of scope
Prices, tier names, the billing provider choice (options only, §7); legal texts (terms, DPA, privacy notices: for a legal adviser);
countries other than Italy (FD19); fiscal register integration of any kind (PRD out of scope, unchanged); any change to Phase 2
candidates C1–C17 beyond what is named here. Paths that depend on an open answer are only in §10b.

### 1.4 Current state (what this plan builds on; `main` as of this branch, plus PR #79 unmerged)

| Area | State today (file) | Consequence for SaaS |
|---|---|---|
| Tenancy | `tenant` (one row per venue), `app_user` with `tenant_id`, RLS on every table; helpers `app.tenant_id()`, `app.role()` read the token's `tenant_id` claim and the active `app_user` row (`supabase/migrations/20261021120000_tenancy_baseline.sql` lines 49–69) | The tenant boundary is sound and stays. "Adding a venue is a data change" (ADR-003) |
| One login = one tenant | `app_user.auth_id ... unique` (same file, line 31); the hook selects *the* active membership (lines 117–121; PIN version `20261025100500_access_token_hook_pin.sql` lines 97–101) | No multi-venue owner, no DigiAlto person in two tenants with one login (H5, H6) |
| DigiAlto access | ADR-003: "an explicit `app_user` row per tenant for DigiAlto admins. There is no global bypass"; policy comment "Only an admin (DigiAlto) can create another admin" (baseline lines 96–103) | The tenant role `admin` *is* DigiAlto today (H7). A SaaS needs DigiAlto outside tenant RLS and a tenant-owned `admin` |
| Onboarding | `scripts/create-tenant.ts` → `public.create_tenant_with_owner` (service role only; baseline lines 143–166); IT VAT only (`scripts/lib/create-tenant.ts` line 13) | Script-only provisioning |
| Second factor | PR #79: TOTP for owner/admin, per-tenant `tenant.mfa_enforcement`, the `aal` gate inside `app.tenant_id()`/`app.role()`/`app.app_user_id()`, `app.membership_ungated()` | SP2 and SP3 change the same helpers and the hook: they must build on #79 merged, and re-pin the hook on purpose (#79 pins its md5 in its step A7) |
| Public routes | `/prenota/[slug]` (`src/app/(public)/prenota/[slug]/page.tsx`); slug in `reservation_settings.public_slug` unique across tenants (`20261124100000_reservation_core.sql` line 86); tenant resolved by `app.reservation_public_tenant(slug)` behind an HMAC gate (`20261128100000_reservation_public.sql` lines 14–57) | Path-based tenant resolution already works for one public feature |
| Configuration that is already per tenant | `tenant.timezone` read by SQL (e.g. `20261026100600_stock_reads.sql` line 67); `settings.business_day_cutoff` (`20261025100100_business_day_cutoff.sql` lines 10–29); service periods 1–6 per tenant, versioned (ADR-031); coperto optional per tenant (`sale_settings`, `20261031100000_menu_tables_core.sql` lines 86–102); dining tables, locations, reservation settings | A good base: several venue differences are data already |
| Demo data | `begin_demo_data` / `purge_demo_data`, the sanctioned ledger exception (ADR-018, `CLAUDE.md` rule 6) | Pattern for the erasure exception (ADR-040) |
| Backups | daily encrypted `pg_dump` of the whole database and incremental invoice-file packs shared by all tenants (ADR-034; `scripts/lib/backup/commands.ts` lines 260–265) | No per-tenant restore or erasure today (H35) |
| Hosting | Vercel Pro (production), Supabase Free (production), decided 2026-11-08 (phase 2 scope §2.2) | Supabase's backup docs list daily backups only for Pro, Team and Enterprise (source S2) |
| Ownership | Q11 "Code and IP ownership given multi-tenancy" open (`docs/go-live/phase1-closeout.md` line 119) | **Blocking for selling** (FD1) |

---

## 2. Role model

### 2.1 Two levels, never mixed

| Level | Roles | Where they are stored | How they reach data |
|---|---|---|---|
| **Platform (DigiAlto)** | `platform_admin` (tenant lifecycle, plans, overrides, erasure approval, staff management); `platform_support` (read tenant metadata, request support access, read platform audit) | `platform.staff (auth_id pk, role, display_name, is_active, created_at, created_by)` in a new schema `platform`, not exposed by the Data API | Only through `public.platform_*` definer functions that return **metadata** (§2.3); never through tenant RLS |
| **Tenant (venue)** | `owner`, `admin`, `chef`, `waiter` (today, `app_role` enum, baseline line 9); candidates `manager` (V8) and `bar` (V9); `accountant` stays Phase 2 C10 | `app_user` rows with `tenant_id` | Tenant RLS, unchanged pattern: `tenant_id = (select app.tenant_id()) and (select app.role()) = any(...)` |
| **Support member** (bridge) | a tenant `app_user` row with `kind = 'support'`, `role = 'admin'`, linked to an approved `support_grant` | `app_user` (+ `kind`, `support_grant_id`) | Tenant RLS exactly like a tenant `admin`, only while the grant is valid; read-only (a write scope exists only under V3) |

**Meaning of tenant `admin` changes.** Today `admin` = DigiAlto. In the product, `admin` is the venue's own trusted back-office person
(owner-like, cannot create owners). DigiAlto reaches a new tenant only as a support member. Tenant #1 keeps its current DigiAlto `admin`
rows in the base plan (§8; V14 converts them).

**Tenant role matrix.** Unchanged (project plan §3.11.2). New roles only through V8/V9.

### 2.2 How platform roles stay outside tenant RLS (ADR-037)

1. **Separate identity.** A platform staff auth user can hold **no** tenant membership except `kind = 'support'` rows. A trigger on
   `app_user` refuses `kind = 'member'` for an `auth_id` present in `platform.staff`, and a trigger on `platform.staff` refuses an
   auth user that has a member row (SP3 test 2).
2. **Separate Postgres role.** In console mode the access token hook sets the JWT `role` claim to a dedicated NOLOGIN Postgres role
   `platform_staff` (granted to `authenticator`) instead of `authenticated`. The hook documentation shows a hook rewriting the `role`
   claim (source S1). `platform_staff` has **no grant on any `public` table**, and every tenant policy is written `to authenticated`,
   so even a missing or wrong tenant policy returns nothing to platform staff. It holds `execute` only on the `public.platform_*`
   functions. Whether PostgREST, Storage and Realtime on the hosted project accept a custom role claim is **unverified**: spike T2. If T2
   fails, **V2** applies.
3. **Separate route group and host.** Console screens live in `src/app/(platform)/…` and its API in `src/app/api/platform/**`.
   `src/proxy.ts` serves `(platform)` only on the console host and answers 404 for it on every tenant host, and 404 for tenant paths on
   the console host (SP3 test 6). Same Next.js app and repo (§9 explains why; V1 is the separate-project option).
4. **Always second factor.** Platform staff need `aal2` for every platform function and every support session (the #79 gate pattern:
   `app.require_aal2()`), with no per-tenant mode (SP3 test 3, SP4 test 8).
5. **Platform audit.** `platform.audit_event (id, actor_auth_id, action, tenant_id null, detail jsonb, at)`, append-only by trigger
   (UPDATE/DELETE refused for every role, as for tenant ledgers). Every platform function and every script that uses the secret key
   writes a row (SP3 tests 7–8). `detail` carries codes and ids only, never business data or personal data beyond the staff id.

**Honesty about the secret key.** Whoever holds the Supabase secret key or the database URL (DigiAlto operations, the backup job) can
technically read every tenant. The controls are: the key stays where `CLAUDE.md` rule 2 allows it (cron services, `scripts/`,
`src/server/staff-auth/privileged.ts`; the base plan adds **no** new file using it); scripts write a platform audit row; the DPA states it
(§6.1).

### 2.3 What the console may read (metadata only)

`public.platform_tenants()` / `public.platform_tenant(id)` return: id, name, organisation, venue type, status and its history, plan,
overrides, created_at, member counts by role, last activity date, usage counters (§6.3), job-health codes and ledger-check finding
codes (§6.4), support grants. **Never**: invoices, prices, costs, recipes, orders, reservations, staff names. SP3 test 5 lists every key
the platform functions return and fails on a business or cost key.

### 2.4 Support access (consented, time-boxed, audited; never silent)

Flow (SP4):
1. **Request.** `platform_support` calls `public.platform_request_support(tenant_id, reason_code, minutes)` → `support_grant` row
   `requested`, scope `read`, `minutes` ≤ `app.support_max_minutes()` (value FD8). Or the owner invites support from the app
   (`POST /api/support-grants`).
2. **Consent.** The tenant's `owner` (the controller's representative; V11 widens this) sees the request on `/impostazioni/assistenza`
   and approves with `public.approve_support_grant(id)`. The #79 TOTP gate applies to the owner's call like to any write. Approval sets
   `expires_at = now() + minutes` and activates (or creates) the support member row for the staff's auth user in that tenant.
3. **Entry.** The staff member selects the tenant (SP2's session-tenant mechanism); the hook issues an `authenticated` token with that
   tenant's claims only while the grant is approved, not revoked and not expired.
4. **During.** `app.tenant_id()`/`app.role()` check the grant at every statement (the same place as the #79 `aal` gate), so expiry and
   revocation take effect on the next query, not at token refresh. The support member reads what a tenant `admin` reads; every write is
   refused by the write gate with `support_read_only` (§3.1). `/api/me` returns `support: {active, until, staffName}` to every tenant
   user, and the app shell shows a banner (SP4 test 6).
5. **End.** Expiry, the owner's `public.revoke_support_grant(id)`, or the staff's own end. pg_cron `support-grant-expiry` only marks
   ended grants and ends their staff sessions (`auth.sessions` delete as in #79 T-10); correctness does not depend on the job.
6. **Records.** `support_grant.requested|approved|revoked|expired|ended` in the tenant's `audit_event` (new entity type
   `support_grant`, union rule) and in `platform.audit_event`.

**Why not "log in as the user":** the audit would show the venue user, not DigiAlto; it needs minting sessions for another person's
account (rejected in the project plan §4 for staff sessions); and nobody could tell support from the user afterwards.

**Waiters never see costs** is untouched: support members are `admin`-level and only owner/admin/chef read cost tables; waiters'
payloads and policies do not change.

---

## 3. Tenant lifecycle

### 3.1 States (ADR-039)

`tenant_status_event (tenant_id, status, reason_code, effective_at, created_by_staff, created_by_user)`, append-only; the current
status is the newest row with `effective_at <= now()` (derived, never stored on `tenant`, in the spirit of ADR-002).

| Status | Who sets it | Reads | Writes | Notes |
|---|---|---|---|---|
| `provisioning` | provisioning procedure | owner only (wizard) | wizard settings only | ends at "finish" |
| `trial` | wizard finish | all | all (within plan) | trial end date in the subscription event (length: FD6) |
| `active` | platform admin | all | all | |
| `suspended` | platform admin (non-payment, abuse, trial end) | all | **refused** (423 `tenant_read_only`) except the exempt list | effective at the tenant's next business-day cut-off (`app.business_day_cutoff`), never mid-service (SP6 test 4) |
| `cancelled` | platform admin, on the owner's request or at contract end | owner, admin | refused | export allowed; erasure after the retention window (FD13) |
| `erased` | `platform.erase_tenant` only | none | none | the tenant row is gone; a tombstone stays in `platform.audit_event` (id only) |

**Write gate in Postgres.** `app.require_writable()` raises `tenant_read_only` (status) or `support_read_only` (support member). It is
called by every write path: the `app.require_*` role helpers used by the definer procedures, and the write policies that still exist for
`authenticated` (e.g. `app_user_insert`, baseline lines 97–103). A pgTAP catalogue test (SP6 test 1) scans `pg_proc` for every `public`
function executable by `authenticated` that is not `stable`/`immutable` and fails unless its body calls `app.require_writable()` or a role
helper that does, or it is on a named exempt list (logout, the #79 MFA exempt functions, `select_tenant`, `approve_support_grant`,
`revoke_support_grant`, the export request). #79 uses the same technique (its pgTAP 341 scans `pg_proc` source).

**Offline queue (ADR-022).** A sync op refused by the gate returns the per-op result `tenant_read_only`; it is kept on the phone and
shown, like a `409/422` today (SP6 test 5). Because suspension waits for the cut-off, a service in progress is never cut.

### 3.2 Create and provision

- **Invitation.** A platform admin creates the tenant in the console (`public.platform_create_tenant(...)`: organisation, name, venue
  type, plan) and receives a single-use invitation code (hashed, expiring; the M11 enrolment-code pattern). The future owner signs up
  with Supabase's ordinary e-mail sign-up from our server route (publishable key, e-mail confirmation through the existing Resend SMTP;
  spike T5), then redeems the code: `public.redeem_tenant_invitation(code)` creates the owner `app_user` row and the terms acceptance in
  one transaction. **No secret key**: Supabase Auth creates the user, our definer creates the membership. Open sign-up is V6.
- `scripts/create-tenant.ts` stays for DigiAlto's own use and tests (IT VAT check kept for Italy, FD19).

### 3.3 Onboarding wizard (SP7)

`/benvenuto` steps, each saved through the existing settings procedures (no new write path): venue type preset (§5.2) → legal and
venue data (name, VAT, time zone default `Europe/Rome`) → service periods (ADR-031) and business-day cut-off → service mode and tables
or counter (§5.3) → coperto (optional) → modules within the plan → staff and devices (M11 flows) → optional demo data (ADR-018) → finish
(status `trial`, or `active` when the platform admin created the tenant as active). The preset only pre-fills; every value stays editable.

### 3.4 Multi-venue / groups (ADR-038)

- **Venue = tenant.** A group with three venues has three tenants. RLS stays per tenant; nothing in the tenant data model spans tenants.
- **Organisation** (`platform.organisation`): the customer company that owns one or more tenants and holds the subscription. An
  organisation owner gets an `owner` membership in each of its tenants (created when a tenant is added), not a cross-tenant role.
- **One login, many tenants:** `app_user` uniqueness becomes `(tenant_id, auth_id)`; the active tenant of a session is stored in
  `app.session_tenant (session_id pk, auth_id, tenant_id, mode, selected_at)` and read by the hook through the `session_id` claim (a
  required claim, source S1; that it is in the hook's input on every authentication method is spike T1). `POST /api/me/tenant
  {tenantId}` → `public.select_tenant(id)` (member only) → the server refreshes the session → new claims. Two phones of the same owner can
  be in two venues at once.
- **`tenant.vat_number unique`** (baseline line 17) is dropped: two venues of one company share a VAT number. The VAT number moves to the
  organisation as the legal entity; the tenant keeps a copy for the extraction "buyer is not the supplier" check (`extract-job.ts` lines
  136–141).
- **Offline cache:** the cached reads (`src/lib/api/offline-cache.ts` line 8) are per path, not per tenant. Switching tenant calls the
  existing `forgetUser()` (`src/components/forget-user.ts` line 9) before the switch (SP2 test 7). The outbox already binds ops to the
  `app_user` id, which differs per tenant.
- Each venue's reports stay per venue (consolidated group reports: V7).
- This replaces project milestone **M43** (multi-venue UI).

### 3.5 Data export and deletion (GDPR): see §6.2 and ADR-040.

---

## 4. Feature switches and tiers

### 4.1 Model (ADR-039)

| Object | Shape | Notes |
|---|---|---|
| `platform.feature` | `key`, `kind` (`module` \| `metered` \| `release`), `requires text[]` | catalogue; `requires` blocks impossible combinations (e.g. `kitchen` requires `orders`) |
| `platform.plan` | `key`, `label` (placeholder until FD3), `is_active` | tiers; names and prices are founder decisions |
| `platform.plan_feature` | `plan_key`, `feature_key`, `monthly_limit numeric null` | what a tier includes; limit for metered features |
| `public.tenant_subscription_event` | `tenant_id`, `plan_key`, `kind` (`trial_started`, `plan_changed`, …), `trial_ends_at`, `effective_at`, `created_by_staff` | append-only; current plan = newest effective row |
| `public.tenant_feature_override` | `tenant_id`, `feature_key`, `enabled`, `monthly_limit`, `reason_code`, `expires_at`, `created_by_staff` | append-only; newest unexpired row wins over the plan |

**Resolution:** `app.feature_enabled(tenant, key)` = newest unexpired override, else the plan's row, else `false`; plus every key in
`requires` must be enabled. `app.require_feature(key)` raises P0001 `feature_disabled`. `app.feature_limit(tenant, key)`.

**Enforced in three places:**
1. **Postgres:** each module's write procedures call `app.require_feature('<key>')` at the top (with the role helper). Metered features
   are counted in Postgres (§6.3). pg_cron jobs skip tenants where the feature is off (e.g. `run_alert_rules` for `alerts`,
   `reservation-mail` for `reservations`), except integrity jobs (`ledger-invariants`, `kpi-rollup`), which run for every tenant that has
   data.
2. **API:** `withApi({ feature: '<key>' })` answers 403 `feature_disabled` before any work.
3. **UI:** `/api/me` returns `features: string[]`; navigation hides switched-off modules. The UI is convenience only.

**Rules that keep the invariants:**
- **A switch gates entry points, never integrity side effects.** If `stock` is off but `orders` is on, `fire_course` still depletes
  batches and freezes costs, because ledgers must stay complete (ADR-002). Turning a module back on finds consistent data.
- **Off never deletes or hides own data from owner/admin.** Reads under RLS stay; the owner can always export (§6.2).
- **Waiters never see costs**: `features` and limits carry no money; the waiter payload test (M0 test 10) is extended to `/api/me`.
- **Rollout safety (zero disruption):** `entitlement_mode` per tenant: `observe` (would-be refusals are written to
  `app.entitlement_observation` and allowed) or `enforce`. Tenant #1 runs in `observe` with the `legacy-full` plan until the log is empty
  for the period of FD23.

### 4.2 Current modules → tier candidates (no names, no prices)

Labels "Tier 1–3" are placeholders. "Add-on" = sold separately in any tier, if the founder wants (FD3).

| Feature key | Module (route / milestone) | Tier candidate | Why |
|---|---|---|---|
| `core` | master data, users, devices, PIN, TOTP, settings, audit (`/anagrafiche`, `/dispositivi`, M1, M11, #79) | all | needed by everything; TOTP is security, never a paid extra |
| `invoices` | upload, review, approval (`/fatture`, M2, M4, M5) | Tier 1 | the entry point of costs |
| `invoices.extraction` (metered) | AI extraction (M3) | Tier 1 with a monthly limit; higher limits in higher tiers or as an add-on | the only per-use third-party cost (§6.3) |
| `costing` | food cost, margins, fixed costs, price variance (`/costi`, `/margini`, M8) | Tier 1 | the core value for any venue |
| `payables` | payables, supplier statement (M9) | Tier 1 | back office |
| `stock` | raw stock, counts, reconciliation, waste (`/magazzino`, M12, M13) | Tier 1 | |
| `alerts` | in-app alerts and rules (`/avvisi`, M6, M16; C9 later) | Tier 1 | |
| `production` | batches, label text, staff meals (`/produzione`, M14, M15) | Tier 2 | the PRD's differentiator (batch and portion layer) |
| `orders` | menu, tables, order entry, firing, voids (M17–M19) | Tier 2 | service operations |
| `kitchen` | kitchen ticket list (`/cucina`, M19b) | Tier 2 (requires `orders`) | |
| `offline` | offline queue (M20) | Tier 2 (requires `orders`) | |
| `day_close` | bill, close, register reconciliation (`/chiusura`, M21) | Tier 2 (requires `orders`) | |
| `reports` | KPIs, AVT, dashboard (M22) | Tier 1 basic; service KPIs need `orders` | |
| `push_forecast` | push list, forecast (M23) | Tier 2 | |
| `exports` | CSV and monthly pack (M24) | all (data portability) | the owner's own data must always leave (§6.2) |
| `reservations` | public booking (`/prenota`, ADR-032) | add-on or Tier 2 | adds customer personal data and e-mail sending |
| `weight_sales` | sell by weight (ADR-035) | Tier 2 | |
| `orders.counter` (new, SP8) | counter sales, quick orders, tabs | Tier 2 | bars and coffee shops |
| `multi_venue` (new, SP2) | tenant switcher, organisation | organisation-level (group tier) | |
| `demo_data` | demo week (ADR-018) | trial only | |
| Phase 2 candidates (labels C2, traceability C3, HACCP C4, accountant C10, e-mail-in C11, forecast C6, menu engineering C7) | — | decided when each ships | |
| `release:<name>` (kind `release`) | staged rollout of a new behaviour | not sold; set by DigiAlto | §6.5 |

---

## 5. Venue types and per-tenant configuration

### 5.1 What differs

| Aspect | Restaurant (today) | Bar | Coffee shop |
|---|---|---|---|
| Service | tables, covers, courses, firing per course | counter and some tables; **tabs** left open | counter, quick orders; few or no tables |
| Order speed | open table → lines → fire → close | one-tap repeated drinks; tab closes later | order and pay in one step |
| Menu | dishes per course | drink-heavy; per bottle and per glass | drinks plus pastries and snacks |
| Stock model | batches and portions plus raw | mostly direct depletion of raw (bottles, kegs) by plate recipes with raw lines; few batches | direct depletion (coffee, milk) plus small batches (pastries, sandwiches) |
| Hours and services | lunch and dinner (ADR-031 default) | one long evening service past midnight (cut-off) | one all-day service, early opening |
| Coperto | common, optional today | usually none | none |
| Kitchen screen | yes | maybe none | maybe none |
| Receipts | register receipt per table (M21) | per tab or per counter sale | per counter sale |

### 5.2 What can be customised per tenant (and where it lives)

| Setting | Today | Proposal | Milestone |
|---|---|---|---|
| Terminology ("coperto", "tavolo", course labels, "comanda", "registratore") | i18n catalogues, fixed | `tenant_term_override (tenant_id, key, locale, text)` for a **whitelist** of keys only; length-capped, rendered as text | SP9 |
| Courses | enum `public.course` (H16) | `tenant_course (tenant_id, key, label, position, is_active)`; `menu_item.course_default` and `order_line.course` become keys validated by FK; seeded with today's five for every existing tenant | SP8 |
| Modules on/off | none | §4 | SP5 |
| Service periods, cut-off | per tenant (ADR-031, settings) | unchanged; presets per venue type in the wizard | SP7 |
| Service mode | tables only | `tenant.service_mode`: `tables` \| `counter` \| `both` | SP8 |
| VAT rates and coperto | global list (H14, H15); coperto per tenant | `tenant_vat_rate (tenant_id, rate, valid_from)` seeded with today's list; every `= any(app.allowed_vat_rates())` check reads the tenant's list; coperto unchanged | SP1 |
| Fiscal / receipt flow | `scontrino`/`fattura`, payment codes global (H20) | per-tenant lists seeded with today's values; Italy only (FD19); no register integration | SP1 |
| Units | enums (H24) | base units unchanged; a display conversion for drink measures only if a bar needs it | SP8 |
| Languages | `it` default, `en` second (H12) | `tenant.default_locale` in (`it`, `en`) | SP1 |
| Time zone | SQL per tenant, TS fixed (H9, H10) | TS reads the tenant time zone from `/api/me` | SP1 |
| Theme | brand tokens of tenant #1 in code (H29–H31) | `tenant_theme (tenant_id, colours jsonb, logo_path)` validated against the existing contrast tests; tenant #1 seeded with today's tokens | SP9 |
| Booking | per tenant (ADR-032) | unchanged; slug moves to tenant level | SP12 |

### 5.3 Counter service, quick orders and tabs (SP8; design sketch; its own plan and ADR at /feature time)

- `table_session` gains `kind` (`table` \| `counter` \| `tab`); `dining_table_id` and `covers` become nullable **only** for
  `counter`/`tab` (check constraint keyed on `kind`; H18, H19). Every existing row is `table`; every existing check is kept for `table`.
- `public.quick_sale(p_id uuid, p_lines jsonb, p_payment text, p_receipt jsonb)`: open + add lines + fire + close in **one transaction**,
  reusing the internals of `add_order_line`, `fire_course` and `close_table`; client-generated id, so the offline op is replay-safe
  (ADR-022).
- **Tabs:** a `tab` session with a short label (a number or a few characters). No customer personal data outside reservations (project
  plan §3.11.8): the field hint says "no names" and the length is capped (SP8 test 6). Names on tabs are only under V13.
- Kitchen tickets only for lines whose menu item routes to the kitchen.

### 5.4 Hard-coded osteria and single-venue assumptions (40 found)

Method: Grep over `src/`, `supabase/migrations/`, `scripts/`, `supabase/seed.sql` for literal names (`osteria`, `Dei Rossi`), `coperto`,
course names, `Europe/Rome`, `EUR`, `it-IT`, `^IT[0-9]`, VAT lists, `pranzo`/`cena`, `scontrino`, `unique` on `auth_id`/`vat_number`,
unit enums, cron schedules, Sentry calls, i18n keys. Comments that only *mention* Europe/Rome are not counted where the code reads the
tenant's zone (SQL does: e.g. `20261026100600_stock_reads.sql` line 67, `20261028100200_batch_core.sql` line 276).

| # | File:line | Assumption | Fix (milestone) |
|---|---|---|---|
| H1 | `supabase/migrations/20261021120000_tenancy_baseline.sql:17` | `tenant.vat_number` must match `^IT[0-9]{11}$` **and is unique**: Italian only; two venues of one company cannot both be tenants | drop unique, move to organisation (SP2); IT check kept (FD19) |
| H2 | same file `:18` | `timezone` default `Europe/Rome` | keep as default; set in wizard (SP7) |
| H3 | same file `:19` | `currency` check `= 'EUR'` | keep (FD19); documented as a country limit |
| H4 | same file `:9` | `app_role` enum fixed to four roles | add values only via V8/V9 |
| H5 | same file `:31` | `app_user.auth_id ... unique`: one login = one tenant | `(tenant_id, auth_id)` unique (SP2) |
| H6 | same file `:117–121`; `20261025100500_access_token_hook_pin.sql:97–101` | the hook picks the single active membership | session-tenant selection (SP2) |
| H7 | same file `:96–103` | "Only an admin (DigiAlto) can create another admin": tenant `admin` = DigiAlto | platform layer and support members (SP3, SP4) |
| H8 | `scripts/lib/create-tenant.ts:13` | provisioning by script only, IT VAT | invitation flow (SP7) |
| H9 | `src/lib/time/format.ts:3` (used by `src/lib/time/venue-date.ts:1–4, 16–17`, `src/lib/tables/table-view.ts`, `src/lib/rules/rules-view.ts`, `src/lib/csv/write.ts`) | `VENUE_TIME_ZONE = "Europe/Rome"` for all display and CSV | tenant time zone from `/api/me` (SP1) |
| H10 | `src/lib/reservations/public-view.ts:44`; `src/server/reservations/mail/render.ts:41` | literal `timeZone: "Europe/Rome"` on the public page and in e-mails | tenant zone from the page/mail payload (SP1) |
| H11 | `src/lib/money/format.ts:10` | `currency: "EUR"` | keep (FD19); read from tenant for safety (SP1) |
| H12 | `src/lib/i18n/locale.ts:1–6` | two locales, `it` default | `tenant.default_locale` (SP1) |
| H13 | `src/app/layout.tsx:88`; `src/app/global-error.tsx:16`; `src/app/manifest.ts:9` | `lang="it"` fixed | from tenant locale (SP1) |
| H14 | `supabase/migrations/20261022130200_review_helpers.sql:10–13` | `app.allowed_vat_rates()` = `[0,4,5,10,22]` for every tenant; used by `20261031100000_menu_tables_core.sql:55, 91, 117`, `20261031100200_menu_procedures.sql:63`, `20261031100400_dining_tables_coperto.sql:220` | per-tenant list (SP1) |
| H15 | `src/server/menu/constants.ts:12`; `src/server/extraction/constants.ts:48` | TS mirrors of the VAT list | read from the tenant settings payload (SP1) |
| H16 | `supabase/migrations/20261031100000_menu_tables_core.sql:17`; `src/server/menu/constants.ts:14`; `20261111100100_kitchen_event_helpers.sql:52`; `20261031100300_menu_reads.sql:58` | courses = enum `antipasti, primi, secondi, dolci, bevande` | `tenant_course` (SP8) |
| H17 | `src/lib/menu/menu-form.ts:63`; `src/lib/sync/overlay.ts:67` | default course `"secondi"` | tenant's first course (SP8) |
| H18 | `supabase/migrations/20261031100000_menu_tables_core.sql:108` | `table_session.dining_table_id not null`: every sale has a table | `kind` with nullable table for counter/tab (SP8) |
| H19 | same file `:111` | `covers between 1 and 99`, required | nullable for counter/tab (SP8) |
| H20 | `supabase/migrations/20261110100000_close_core.sql:11–14, 16–19` | receipt types `scontrino`, `fattura`; payment codes `cash, card, other` global | per-tenant lists (SP1) |
| H21 | `supabase/migrations/20261120100000_service_core.sql:24` | default services Pranzo 11:00, Cena 16:00 (pinned by pgTAP 286) | keep as the "restaurant" preset; the wizard saves an explicit version for new tenants (SP7) |
| H22 | `supabase/migrations/20261124100000_reservation_core.sql:28–29` | default booking services pranzo/cena times | preset per venue type (SP7) |
| H23 | `supabase/migrations/20261025100100_business_day_cutoff.sql:28` | default cut-off 02:00 | keep default; wizard step (SP7) |
| H24 | `supabase/migrations/20261021130000_master_types.sql:4–5`; `20261023100200_recipe_tables.sql:10` | unit enums `kg g l ml pz` (+`porz`), no drink measures | display conversion if needed (SP8) |
| H25 | `supabase/migrations/20261021130000_master_types.sql:48`; `src/lib/vat/it-vat.ts:5`; `src/server/master/import.ts:196` | supplier VAT must be Italian | keep (FD19) |
| H26 | `src/server/extraction/prompt.ts:4, 23` | prompt "an Italian restaurant's purchasing assistant", Italian instruction | venue-neutral wording, still Italian invoices (SP1) |
| H27 | `supabase/migrations/20261022120200_cron_extract.sql:69–71`; `docs/go-live/rate-limits.md:36` | one global extraction job, one invoice per call: no per-tenant fairness | fair claim (SP11) |
| H28 | `src/server/extraction/extract.ts:78–79, 93–94` | token usage only logged, not stored per tenant | `tenant_usage_event` (SP11) |
| H29 | `src/lib/i18n/messages/it.ts:2, 74`; `src/lib/i18n/messages/en.ts:4, 75` | `app.name` and home link = "Osteria Dei Rossi" | tenant name from `/api/me`; product name for public and console pages (SP9) |
| H30 | `src/app/manifest.ts:7–14` | manifest name and colours of tenant #1 | per-host manifest (SP9) |
| H31 | `src/lib/design/tokens.ts:44–53`; `src/app/globals.css:4`; `src/components/brand.tsx:4–24`; `src/app/layout.tsx:14` | brand colours, fonts, mark of tenant #1 | `tenant_theme` (SP9) |
| H32 | `src/lib/auth/password-policy.ts:14–16` | refused password words are tenant #1's name | derive from the tenant's name (SP1) |
| H33 | `src/pwa/outbox.ts:247, 250`; `src/pwa/lease.ts:9`; `src/lib/api/offline-cache.ts:8` | IndexedDB/lock names `osteria-sync`; read cache keyed by path, not tenant | names: cosmetic, left (a rename must migrate queued ops); `forgetUser()` on switch (SP2) |
| H34 | `src/lib/observability/report.ts:5` | Sentry events carry no tenant tag | tag with tenant id (SP11) |
| H35 | `scripts/lib/backup/commands.ts:260–265`; ADR-034 (shared file packs) | backups are whole-database and shared packs: no per-tenant restore or erasure | per-tenant packs, tenant extract (SP10) |
| H36 | `supabase/seed.sql:3`; `scripts/lib/demo/fixture.ts:1, 187` | demo = "one invented osteria week", VAT 10% fixed | presets per venue type (SP7) |
| H37 | `supabase/migrations/20261124100200_reservation_settings.sql:22–37` | `audit_event` entity/action checks have no support or lifecycle entities | extended by the union rule (SP4, SP6) |
| H38 | `supabase/migrations/20261124100000_reservation_core.sql:86` | public slug lives in reservation settings, so a slug exists only with reservations | tenant-level slug (SP12) |
| H39 | `src/lib/i18n/messages/it.ts` (93 keys whose name contains `table`, `covers` or `coperto`, by grep count) | restaurant vocabulary throughout | terminology whitelist (SP9), counter screens (SP8) |
| H40 | `src/lib/i18n/messages/it.ts:2130, 2166` | "registratore (di cassa)" wording for the fiscal register | terminology whitelist (SP9) |

---

## 6. Data and operations

### 6.1 DigiAlto as processor for many controllers

- **Roles (to confirm with a legal adviser; no legal claim here):** each venue is the controller of its operational data (staff
  names, supplier data that may concern natural persons, reservation contacts); DigiAlto processes it on the venue's behalf. For its
  own customer relationship (organisation account, billing contact, sign-up e-mails, platform staff) DigiAlto is the controller.
  GDPR Art. 28 (processor contracts) is the frame the adviser works from; its text was **not** re-read in this session (gdpr-info.eu
  unreachable), so this plan states no obligation from it.
- **One DPA template** for all tenants, with the sub-processor list kept in one place (a document created when FD22 is answered, not by
  this plan). Current list from the project plan §3.11.8 and checklist DPA-1: Supabase, Vercel, Anthropic (invoice content), Resend
  (auth and reservation e-mails), Sentry (errors, PII scrubbed), GitHub (CI, backups workflow), Google (Drive backups). Any provider
  added later joins the list before use. Data location and retention at each provider: project Q13, still open.
- **Change notice:** adding a sub-processor is a platform change announced to every tenant before use; the console keeps the list's
  version and the date each tenant was notified (`platform.notice`; SP3 test 9).

### 6.2 Export, erasure, backups and restore (ADR-040)

- **Export (always available, any status but `erased`).** The owner requests a full export in the app (`POST /api/exports/full`,
  owner only, exempt from the write gate) → `export_request` row → a platform admin runs `scripts/tenant-export.ts --request <id>`
  (database URL and secret key, `scripts/` only) → one encrypted ZIP: one CSV per tenant table (same CSV writer and formula escaping as
  M24) + the tenant's invoice files + a manifest with checksums → uploaded to a private `exports` bucket at `<tenant_id>/...` → the owner
  downloads it through a signed URL (the `SIGNED_URL_TTL_SECONDS` pattern). Automating the script run comes later, if volume needs it.
- **Erasure (cancelled tenants only).** `platform.erase_tenant(tenant_id, approval_ids)` (service role only), run by
  `scripts/tenant-erase.ts`. Preconditions: status `cancelled`; the retention window (FD13) has passed; an export was delivered or the
  owner's waiver is recorded; one platform admin's approval plus the owner's recorded written request (FD12). It sets
  `tenant.erasure_since` (the ADR-018 marker pattern), deletes every row of that tenant in foreign-key order (reusing
  `app.demo_purge_tables()` plus master data, users and the tenant row), and writes a tombstone to `platform.audit_event`. The script
  then deletes the tenant's Storage objects and its backup file packs, and deletes auth users that have no other membership.
  **This is a second sanctioned exception to "ledgers are append-only"**, of the same shape as ADR-018: whole-tenant only, only
  through that function, only with the marker set; UPDATE and TRUNCATE stay refused; within a live tenant nothing changes. It needs
  the founder's approval and a `CLAUDE.md` rule 6 amendment (FD12).
- **Backups.** Whole-database copies stay (ADR-034): Supabase restores only whole projects, and Storage files are not in database
  backups (source S2). Change: invoice-file packs are written **per tenant** (`<tenant_id>` in the pack name), so erasure can delete
  exactly one tenant's packs; database copies of an erased tenant age out with the 14-copy rotation (Q182), which the DPA must state.
- **Per-tenant restore.** No in-place restore of one tenant into the live database (it would rewrite ledgers and could collide with
  rows written since). Instead `scripts/backup/tenant-extract.ts` restores a chosen copy into a scratch database (the existing
  restore-check path) and produces that tenant's export as of that copy. Disaster recovery stays whole-project.
- **Supabase plan.** Supabase's backup docs list daily backups for Pro, Team and Enterprise only, and advise Free projects to export
  regularly (source S2). Before tenant #2 a paid plan is recommended (FD11); its price is for the founder to read.

### 6.3 Limits and quotas

- `public.tenant_usage_event (tenant_id, kind, ref_id, quantity, detail jsonb, at)`, append-only. `extraction`: one row per model call
  (invoice id, input and output tokens from the response's `usage`, attempt), written by a new `extraction_record_usage` in the same
  transaction as the outcome. `upload_bytes`: per stored file. No money is stored (the app knows no prices, and none is estimated).
- **Quota check in Postgres:** `extraction_claim` skips a tenant whose extraction count this month (in the tenant's time zone) has
  reached `app.feature_limit(tenant, 'invoices.extraction')`; its invoices stay `received` with the flag `quota_reached`, shown on the
  list, until the next month or until a platform override raises the limit (FD15).
- **Fairness:** `extraction_claim` takes the oldest waiting invoice of the tenant with the fewest claims in the last hour, so one busy
  tenant cannot hold the queue (SP11 test 3). How many invoices one cron call may process is set after the F26 timing measurements
  (`docs/go-live/extraction-timing.md`), not assumed.
- Existing per-tenant limits stay (uploads 60/hour per tenant, reservation limits per tenant: `docs/go-live/rate-limits.md`). Supabase
  Auth limits are shared by the server address for all tenants (rate-limits.md lines 16–18): with many tenants a flood can block sign-in
  for everyone (risk §11).

### 6.4 Per-tenant observability

- Sentry: `reportError` sets the tag `tenant` = tenant uuid (no name, no user) from the request context; cron jobs set it per item.
  PII scrubbing unchanged.
- Console health page per tenant (metadata only): `job_run` outcomes per job, `app.ledger_checks_body(tenant)` finding codes (as the
  restore check uses it, `commands.ts` lines 260–265), extraction failures and quota state, last activity date, open support grants.
- Platform-wide: a stale job or invariant drift in any tenant raises a **platform** notice in the console, not an e-mail (alerts stay
  in-app, ADR-006/D3; FD24).

### 6.5 Migrations across tenants

Shared schema: one migration applies to every tenant at once. Rules (SP5 adds the `release` feature kind):
1. **Expand → migrate → contract**, each in its own deploy; never a destructive change in the same deploy as the code that stops using
   a column.
2. **Defaults equal today's behaviour** for every existing tenant; new behaviour behind a `release:<name>` feature switched per tenant
   (rings: an internal test tenant first, then tenants in the order the founder sets, FD23).
3. **Backfills per tenant** in sub-transactions with `job_run` (the `run_reservation_retention` pattern), so one tenant's bad row does
   not block the others.
4. **CI fixture with several tenants and venue types** (restaurant with coperto, bar in counter mode, coffee shop all-day); the
   cross-tenant pgTAP suite runs on all of them.
5. **Tenant #1 golden tests:** bill, KPI, menu and alert payloads for a fixed tenant-#1-shaped fixture (fake data) are pinned and must
   not change unless a plan says so (§8).

### 6.6 Slugs, custom domains, public pages

- **Slug:** `tenant.public_slug` (unique, `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$` as today, reserved words refused: `api`, `console`,
  `www`, `prenota`, `menu`, `login`, …). The migration copies `reservation_settings.public_slug`; `app.reservation_public_tenant` reads the
  tenant slug and still requires `reservation_settings.enabled` and readiness.
- `/prenota/<slug>` is unchanged for the visitor. No other public page is added in the base plan (a public menu page is V12).
- **Custom domains** are V4. Facts for that decision: a Supabase custom domain replaces the project's *API* URL and allows one domain
  per project (source S4), so it is not a tenant-domain mechanism; Vercel's multi-tenant template resolves tenants by subdomain in
  `proxy.ts` with a wildcard DNS record (source S5); per-tenant custom domains through Vercel's domain API were **not verified**
  (vercel.com unreachable in this session).

---

## 7. Commercial plumbing (options only; no prices, no provider chosen)

| Topic | Options | Recommended default | What the founder must check (never estimated here) |
|---|---|---|---|
| Billing | (a) manual: DigiAlto invoices from its own accounting; a platform admin sets status in the console; (b) a subscription billing provider (e.g. Stripe) (V5); (c) a merchant-of-record provider (e.g. Paddle, Lemon Squeezy) (V5) | (a) for the first tenants | each provider's fees, payout terms, data location and retention, DPA, support for Italian B2B invoicing; none of these was read in this session |
| Invoicing DigiAlto → venue | DigiAlto's accountant / invoicing tool; provider-generated invoices (V5) | DigiAlto's accountant | how DigiAlto's invoices to Italian businesses must be issued (accountant) |
| Sign-up | invitation code (base plan); open sign-up with trial (V6) | invitation | trial length, card upfront or not (FD6) |
| Terms | terms of service, DPA with sub-processor list, DigiAlto privacy notice for account data, acceptable use, SLA (if any) | drafted by a legal adviser | all texts (FD22) |
| Acceptance record | `public.terms_acceptance (tenant_id, document_key, version, accepted_by, at)`, append-only, written at invitation redeem and on new versions | built in SP7 | — |

The base plan stores no payment data of any kind.

---

## 8. Migration path for Osteria Dei Rossi (tenant #1, zero disruption)

1. **Before anything:** P2-1 TOTP (#79) merged; SP0 spike passed. Tenant #1's `mfa_enforcement` stays as the founder set it.
2. **Every SP migration is additive with defaults that reproduce today** (the H-fixes seed the current values: VAT list, receipt and
   payment codes, five courses, brand theme, `Europe/Rome`, `it`). The tenant #1 golden tests (§6.5 rule 5) pass before and after each
   milestone; a milestone that changes a pinned payload must say so in its plan.
3. **Entitlements in `observe`:** tenant #1 gets plan `legacy-full` (every current feature on, no limits) and `entitlement_mode =
   observe`. `enforce` only after the observation log stays empty for the period of FD23 (SP13).
4. **Status:** a `tenant_status_event` `active` row dated at go-live is inserted for tenant #1; no subscription event (no charge) unless
   the founder decides otherwise.
5. **Organisation:** one organisation holds tenant #1 (legal name and VAT from the tenant's own settings, never from code).
6. **DigiAlto access:** the existing DigiAlto `admin` rows at tenant #1 stay as they are (FD9 default; their conversion to support
   grants is V14). New tenants never get DigiAlto member rows.
7. **Sessions:** SP2 changes the hook. Rollout on a day without service: a session without a `session_tenant` row falls back to the
   user's single membership (exactly today's behaviour), so nobody is signed out. Staff PIN sessions keep their own branch of the hook
   unchanged (SP2 tests 2 and 5).
8. **Offline:** no op shape changes until SP8; SP8 keeps old op payloads valid (the seeded course keys equal the old enum values; SP8
   test 5).
9. **Kill switches:** `entitlement_mode = observe`, feature overrides, a `tenant_status_event` `active` row, and #79's `mfa_enforcement =
   off` are all data changes, effective on the next query, without a deploy.

---

## 9. Alternatives considered

- **Database or Supabase project per tenant**: hard isolation; but migrations fan out, cost per venue rises, and platform metadata needs
  cross-project access with secret keys. ADR-003 already rejected it; kept only as **V10** for a customer with a contractual isolation
  requirement (ADR-003's own revisit trigger).
- **Platform console as a separate Supabase project (V1)**: the strongest separation; but the console then needs a secret key of the
  product project to read tenant metadata, which widens the secret-key surface `CLAUDE.md` rule 2 restricts. Rejected as default.
- **Platform staff as ordinary `authenticated` users with a platform claim**: no custom Postgres role; but a missing tenant policy check
  could leak to staff, and every policy must exclude them. Rejected as default; it is the fallback **V2** if spike T2 fails.
- **"Log in as user" impersonation**: rejected (§2.4): it hides who acted, needs minting another person's session, and is silent by
  nature.
- **A global `bypassrls` support role**: rejected: contradicts ADR-003 "no global bypass" and the consent requirement.
- **Feature flags only in the API or UI**: rejected: `CLAUDE.md` requires roles (and here, entitlements) in Postgres; the Data API is
  reachable with the publishable key.
- **Gating module reads in RLS policies**: rejected: it hides a controller's own data from it when a plan lapses and adds a function call
  to every policy; writes and entry points are gated instead (§4.1).
- **Storing the current plan or status on `tenant`**: rejected for an append-only event history (audit: "why was this tenant
  suspended", ADR-002 spirit). Cost: one indexed lookup per check.
- **Crypto-shredding per-tenant backup keys**: would make the erasure of old database copies immediate; but adds per-tenant key
  management to a founder-run backup job. Rejected for now: per-tenant file packs plus 14-copy rotation (ADR-040).
- **A third-party feature-flag service**: a new provider, a new sub-processor, flags outside Postgres. Rejected.
- **More enum values for courses per venue type**: every new venue would need a migration. Rejected for `tenant_course`.
- **Open sign-up as default**: spam and abuse surface (a CAPTCHA means a new provider), anonymous tenants holding personal data. Kept
  as V6.

---

## 10. Build plan: milestones

Each milestone = one `/feature` run (`feat/sp<NN>-<name>`), with its own plan in `docs/plans/<date>-sp<NN>-<name>.md` holding the
per-commit steps, each with its test. Sizes as in the Phase 2 scope §2.1 (S, M, L). The conventions of the project plan §5a apply: every
endpoint has a role test (pgTAP + API) and a strict-body test; coverage of new code ≥ 80%; fake fixtures only ("Osteria Demo A/B",
"Bar Demo", "Caffè Demo", VAT `IT00000000000`-style); fake clock. **Every milestone also passes the tenant #1 golden tests (G, §6.5
rule 5) and the cross-tenant suite on the multi-venue fixture (X, §6.5 rule 4)**; they are not repeated below.

| # | Milestone | Size | Depends on | Key test (full list in 10a) |
|---|---|---|---|---|
| SP0 | Spike: hook and role checks on the real stack | S | #79 merged | T1–T5 recorded pass/fail |
| SP1 | Per-tenant configuration (locale, time zone, VAT list, receipt/payment codes, prompt, password words) | M | SP0 | a second tenant with other VAT rates; tenant #1 payloads unchanged |
| SP2 | Memberships: one login many tenants, organisations, tenant switcher (replaces M43) | L | SP0 | one login switches A↔B; data never mixes; PIN path unchanged |
| SP3 | Platform layer: staff, `platform_staff` role, console host, platform audit, notices | L | SP2 | staff read 0 rows of any tenant table; metadata keys only |
| SP4 | Support access grants | M | SP3, SP6 | no access before approval; banner; expiry effective on the next query |
| SP5 | Entitlements: features, plans, overrides, observe/enforce | M | SP3 | disabled feature → 403 in the API and P0001 in SQL; observe logs only |
| SP6 | Tenant status and write gate | M | SP5 | suspended → 423 on writes, reads and export work; catalogue test |
| SP7 | Invitation provisioning, onboarding wizard, presets, terms acceptance | M | SP1, SP5, SP6 | invite → owner → wizard → trial without the secret key |
| SP8 | Venue types: tenant courses, counter sales, quick sale, tabs | L | SP1, SP5 | `quick_sale` one transaction; counter session without a table; old ops replay |
| SP9 | Terminology and theme per tenant | M | SP1 | whitelisted terms only; contrast-checked theme; tenant #1 visuals unchanged |
| SP10 | Export, erasure, per-tenant backup packs, tenant extract | L | SP6 | full export round-trip; erasure leaves 0 rows of that tenant, others intact |
| SP11 | Usage metering, quotas, fair extraction, Sentry tenant tag, console health | M | SP5 | quota reached → held; fairness across two tenants |
| SP12 | Tenant slug registry | S | SP2 | `/prenota/<slug>` unchanged; reserved slugs refused |
| SP13 | Tenant #1 cut-over (organisation, plan, status, enforce) | S | SP4, SP5, SP6 | observation log empty; golden tests green after `enforce` |

Order note: SP4 needs SP6's write gate (read-only support), so the build order is SP0, SP1, SP2, SP3, SP5, SP6, SP4, then SP7–SP13 in
the founder's order (FD2).

### 10a. Milestone specifications

**SP0 — Spike: hook and role checks on the real stack** (S)
- Goal: prove the Supabase behaviours ADR-037 and ADR-038 rely on before building.
- In: a throwaway branch, the local stack and staging; results in `docs/plans/<date>-sp00-spike.md`.
- Acceptance tests:
  1. **T1** On the local stack and staging, the access token hook's input `claims` carry `session_id` on password sign-in, e-mail-code
     sign-in, magic link and token refresh (recorded by a test hook in a scratch project). Fail → ADR-038 re-planned before SP2.
  2. **T2** A hook that sets `role = 'platform_staff'` yields a token that PostgREST accepts (a `platform_staff`-only function answers;
     a `to authenticated` table answers permission denied or 0 rows); Storage and Realtime behaviour with that role recorded. Fail → V2.
  3. **T3** A server-side session refresh after `select_tenant` returns a token with the new tenant claim within one request.
  4. **T4** RLS timing with one vs many synthetic tenants on staging for three heavy reads (dashboard, menu, kitchen tickets), recorded
     with the existing Server-Timing headers; no target number, the result informs SP2's index review.
  5. **T5** Supabase's ordinary e-mail sign-up from a server route with the publishable key creates a confirmable user without the
     secret key (for SP7).

**SP1 — Per-tenant configuration** (M)
- In: `tenant.default_locale`; `tenant_vat_rate`; per-tenant receipt and payment code lists; `/api/me` returns `{timeZone, locale,
  currency, vatRates}`; H9–H15, H20, H26, H32 fixed; seeds reproduce today.
- Acceptance tests:
  1. pgTAP: tenant B with VAT list `[10, 22]` refuses a menu price at 4% (P0001) while tenant A (seeded `[0,4,5,10,22]`) accepts it.
  2. `formatDateTime` with a tenant zone other than Europe/Rome renders that zone; with Europe/Rome the M0 DST cases (2026-10-25,
     2027-03-28) are unchanged.
  3. A grep test finds no `"Europe/Rome"` literal in `src/` outside the default constant and tests.
  4. The extraction prompt contains no venue-type word; the M3 recorded-response fixtures still pass; the injection fixture stays data.
  5. The password policy refuses tenant B's own name and no longer refuses "osteria" for tenant B.
  6. G: tenant #1 menu, bill and coperto payloads equal the pinned fixtures.

**SP2 — Memberships and organisations** (L) — ADR-038
- In: `app_user` unique `(tenant_id, auth_id)`; `app.session_tenant`; hook change (both branches, re-pinned); `public.select_tenant`;
  `POST /api/me/tenant`; `GET /api/me` lists memberships; `platform.organisation`, `tenant.organisation_id`; `tenant.vat_number`
  unique dropped; switcher in the app shell; `forgetUser()` on switch.
- Acceptance tests:
  1. One auth user with owner rows in A and B: after selecting A, `app.tenant_id()` = A and B's rows read 0; after switching, the reverse.
  2. A session without a `session_tenant` row and with exactly one membership gets that tenant (today's behaviour); with two memberships
     and no selection it gets no tenant claim and `/api/me` answers `tenant_selection_required`.
  3. `select_tenant` for a tenant where the caller has no active membership → 42501, no row written.
  4. Two sessions of the same user in A and B at once each see only their tenant.
  5. PIN branch: the M11 PIN login, refresh and cut-off tests pass unchanged; a PIN user has exactly one membership (check constraint).
  6. #79 gate: an owner with a verified factor at `aal1` gets no tenant from `app.tenant_id()` in A or B.
  7. Playwright: switching tenant clears the offline read cache (`forgetUser`) before the first read of B.
  8. Two tenants with the same VAT number in one organisation are allowed.

**SP3 — Platform layer** (L) — ADR-037
- In: schema `platform`; `platform.staff`, `platform.audit_event` (append-only), `platform.notice`; Postgres role `platform_staff`;
  hook console mode; `public.platform_*` metadata functions; `(platform)` route group on the console host; `src/proxy.ts` host rules;
  console screens (tenant list, tenant detail, audit); scripts write a platform audit row through a shared helper.
- Acceptance tests:
  1. pgTAP: `platform_staff` has no privilege on any `public` table (catalogue query); a select on any tenant table → permission denied.
  2. Triggers: inserting `app_user kind='member'` for a staff auth user → error; adding a staff row for an auth user with a member row →
     error.
  3. A staff token without `aal2` → every `platform_*` function raises `mfa_required`.
  4. A tenant owner calling `platform_tenants()` → 42501.
  5. pgTAP: the keys returned by every `platform_*` function match a whitelist; any key matching cost, price, person-name or
     business-record patterns fails the test.
  6. Proxy: `(platform)` paths on a tenant host → 404; tenant paths on the console host → 404.
  7. UPDATE/DELETE on `platform.audit_event` → exception for every role, including the service role.
  8. Each `platform_*` write and each `scripts/tenant-*.ts` run writes exactly one platform audit row (codes only).
  9. A new sub-processor notice records its version and the per-tenant notified date; the console lists tenants not yet notified.
  10. The secret-key import lint rule (M0 test 11) passes unchanged: no new file imports the admin client.

**SP4 — Support access grants** (M) — ADR-037
- In: `support_grant`; `app_user.kind`, `support_grant_id`; `platform_request_support`, `approve_support_grant`,
  `revoke_support_grant`, end by staff; the grant check inside the membership helpers; `support-grant-expiry` cron; banner; tenant screen
  `/impostazioni/assistenza`; audit entity `support_grant` (union rule).
- Acceptance tests:
  1. Before approval, the staff member cannot select the tenant (42501) and reads 0 rows.
  2. Only `owner` can approve; admin, chef and waiter → 42501; approval writes `support_grant.approved` in both audit logs.
  3. During a grant: reads like `admin`; any write → `support_read_only` (the SP6 gate); the waiter cost-column test is unchanged.
  4. With the fake clock past `expires_at`, the next query returns no tenant even before the cron runs; the cron then ends the staff's
     sessions and writes `support_grant.expired`.
  5. Owner revoke → the next staff query returns no tenant.
  6. `/api/me` of every tenant user carries `support.active = true` and the banner renders on every app-shell screen (Playwright).
  7. `minutes` above `app.support_max_minutes()` → 22023.
  8. A support member always needs `aal2`, whatever the tenant's `mfa_enforcement`.

**SP5 — Entitlements** (M) — ADR-039
- In: `platform.feature`, `platform.plan`, `platform.plan_feature`, `tenant_subscription_event`, `tenant_feature_override`,
  `app.feature_enabled/require_feature/feature_limit`, `entitlement_mode`, `app.entitlement_observation`; `withApi({feature})`; cron
  skips; `/api/me.features`; console plan and override screens; plan `legacy-full`.
- Acceptance tests:
  1. `reservations` off for B: `set_reservation_settings` → P0001 `feature_disabled`; the `POST` route → 403; A unaffected.
  2. An override with `expires_at` in the past falls back to the plan (fake clock).
  3. `kitchen` enabled while `orders` is off resolves to disabled (`requires`).
  4. `stock` off, `orders` on: `fire_course` still writes batch and stock movements and `order_line_cost` (integrity side effects).
  5. `observe` mode: a disabled call succeeds and writes one `entitlement_observation` row; `enforce` refuses it.
  6. `/api/me.features` for a waiter carries no money key (M0 test 10 fixture extended).
  7. Cron: `run_alert_rules` skips a tenant with `alerts` off; `run_ledger_invariants` still checks it.

**SP6 — Tenant status and write gate** (M) — ADR-039
- In: `tenant_status_event`; `app.tenant_status()`; `app.require_writable()` in the role helpers and write policies; exempt list;
  `/api/me.status`; banner; console status actions; trial-end job (`trial` → `suspended` at the cut-off after `trial_ends_at`); audit
  entities (union rule).
- Acceptance tests:
  1. pgTAP catalogue: every volatile `public` function executable by `authenticated` calls the gate or is on the exempt list.
  2. `suspended`: `add_order_line`, `approve_invoice`, `produce_batch` → `tenant_read_only`; `GET` reports and CSV exports work.
  3. `cancelled`: chef and waiter read 0 rows; the owner reads and can request the full export.
  4. A suspension created at 21:00 with `effective_at` at the next cut-off leaves writes open until the cut-off (fake clock, a DST night
     included); the trial-end job uses the same rule.
  5. `/api/sync` with a suspended tenant: each op returns `tenant_read_only`, the outbox keeps them, nothing is applied.
  6. Status history is append-only; UPDATE/DELETE refused.

**SP7 — Provisioning and onboarding** (M)
- In: `platform_create_tenant` and invitation codes; the sign-up route; `redeem_tenant_invitation`; wizard `/benvenuto` with presets
  (restaurant, bar, coffee shop: service periods, booking defaults, demo set); `terms_acceptance`.
- Acceptance tests:
  1. Invite → sign-up → redeem creates exactly one owner `app_user` and one `terms_acceptance` row in one transaction; the secret-key
     lint rule still passes.
  2. A code is single-use and expires; wrong codes lock after the named threshold (the M11 enrolment pattern).
  3. Redeeming while already a member of that tenant → 409; a platform staff user redeeming → refused; signing up without a code creates
     no tenant and no membership.
  4. The bar preset saves one service period ending after midnight with the cut-off after it; the coffee-shop preset one all-day period.
  5. The wizard cannot finish without time zone, VAT and service mode; finish writes the `trial` (or `active`) status.
  6. Every wizard write goes through the existing settings procedures (no new table write grant: catalogue test).

**SP8 — Venue types: courses, counter, quick sale, tabs** (L; may split into SP8a courses and SP8b counter)
- In: `tenant_course` (seeded), enum → key migration; `table_session.kind`; nullable table/covers for counter/tab; `quick_sale`; tab
  label; offline op `quick_sale`; counter screens; kitchen routing per item.
- Acceptance tests:
  1. Existing order lines and menu items keep their course (keys equal the old enum labels); the M17–M24 suites are green.
  2. A `table` session without a table or covers → check violation; a `counter` session without them → allowed.
  3. `quick_sale` with a fault injected at close → no line, movement or cost row remains (one transaction).
  4. `quick_sale` replayed with the same id → applied once (`applied_op`).
  5. A queued op from before the migration (enum course value) replays correctly after it.
  6. A tab label longer than the cap → 422; the "no names" hint is present.
  7. A waiter's counter payload has no cost key (waiter cost-column test extended).

**SP9 — Terminology and theme** (M)
- In: `tenant_term_override` (whitelist), `tenant_theme`, logo upload (private bucket, image checks as M2), per-host manifest; H29–H31,
  H39–H40.
- Acceptance tests:
  1. An override for a non-whitelisted key → 422; whitelisted text renders escaped.
  2. A theme failing the AA contrast pairs of `tests/lib/design/tokens.test.ts` → 422.
  3. Tenant #1's rendered tokens equal today's (visual snapshot of three screens).
  4. Logo: a non-image file renamed `.png` → 415.

**SP10 — Export, erasure, per-tenant backups** (L) — ADR-040
- In: `export_request`; `scripts/tenant-export.ts`; `exports` bucket; `platform.erase_tenant`; `scripts/tenant-erase.ts`;
  `tenant.erasure_since`; per-tenant file packs (ADR-034 change); `scripts/backup/tenant-extract.ts`; the `CLAUDE.md` rule 6 amendment
  (after FD12).
- Acceptance tests:
  1. Export of a fixture tenant: every tenant table has a CSV; row counts equal the database; file checksums match; formula cells
     escaped.
  2. Erasure refused unless `cancelled`, the window passed, an export or waiver is recorded, and the platform admin's approval and the
     owner's recorded request exist.
  3. After erasure: 0 rows with that `tenant_id` in every table with the column (catalogue query); the other fixture tenant's ledger
     invariants pass.
  4. Outside `erase_tenant`, a DELETE on a ledger still raises, also while `erasure_since` is set on another tenant.
  5. File packs: the backup run writes packs per tenant; erasure deletes only that tenant's packs and manifest entries.
  6. `tenant-extract` from a restored copy yields the same export format and passes the ledger checks for that tenant.

**SP11 — Usage, quotas, fairness, observability** (M)
- In: `tenant_usage_event`; the usage write with the extraction outcome; the quota check and `quota_reached` flag; the fair claim;
  the Sentry tag; the console health page; platform notices for stale jobs and drift.
- Acceptance tests:
  1. Each model call writes one usage row with the tokens of the recorded response; a retry writes another.
  2. At the monthly limit, `extraction_claim` returns nothing for that tenant and the invoice shows `quota_reached`; an override raises
     the limit and the next claim takes it; on the first day of the next month (fake clock, tenant zone) the claim takes it.
  3. Tenant A with 20 waiting invoices and B with 1: B's invoice is claimed within the first two claims.
  4. A Sentry event from a request carries the tenant tag and no name or e-mail (scrubbing test extended).
  5. The console health page shows job and ledger codes for one tenant and no business values (SP3 test 5 whitelist); an injected
     drift in one tenant creates one platform notice and sends no e-mail.

**SP12 — Slug registry** (S)
- In: `tenant.public_slug`, the reserved list, the migration from reservation settings, `reservation_public_tenant` reading it.
- Acceptance tests:
  1. Tenant #1's existing booking URL keeps working (same slug, same gate).
  2. A reserved slug (`console`, `api`) → 422; a slug of another tenant → 409.
  3. Reservations disabled (feature or setting) → the same 404 as an unknown slug.

**SP13 — Tenant #1 cut-over** (S)
- In: organisation, `legacy-full`, the `active` status row, the observation review, `enforce`, a runbook update. DigiAlto's admin rows
  at tenant #1 are not touched (V14 converts them).
- Acceptance tests:
  1. The `entitlement_observation` log for tenant #1 is empty over the FD23 period (report attached to the PR).
  2. After `enforce`: G and X suites green; a Playwright full-service simulation (M25 style, including one offline waiter) passes.
  3. DigiAlto's existing admin rows at tenant #1 sign in and work as before the cut-over (Playwright smoke with a fixture admin).

### 10b. Variants

**V1 — Platform console in a separate Supabase project** · Trigger: FD10b answered "separate project" · Replaces: SP3's
`platform_staff` role and SP3 tests 1 and 6 (the schema and audit move to the console project).
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | Console project with the `platform.*` tables; the product project exposes metadata through a `service_role`-only RPC set called by server routes under an amended secret-key rule (ADR amendment) | `supabase-console/…`, `src/server/platform/` | the metadata RPCs refuse `authenticated` and `anon`; a console request cannot read a `public` business table (permission test) |
| V1.2 | Secret-key lint rule extended to the console module | `eslint.config.mjs` | a lint fixture importing the admin client anywhere else fails |

**V2 — Platform staff as `authenticated` with a platform claim** · Trigger: spike T2 fails · Replaces: SP3's Postgres role
`platform_staff` and SP3 test 1.
| # | Step | Files | Test |
|---|---|---|---|
| V2.1 | The hook adds a `platform_role` claim; `app.tenant_id()` returns null for a console-mode session | migration | pgTAP: a console-mode staff token reads 0 rows of every `public` table (catalogue loop) |
| V2.2 | `app.platform_role()` helper and its checks in every `platform_*` function | migration | an owner token calling `platform_tenants()` → 42501; a staff token without `aal2` → `mfa_required` |

**V3 — Support write scope** · Trigger: FD7 answered "allow writes with owner consent" · Replaces: SP4 test 3 (adds a scope).
| # | Step | Files | Test |
|---|---|---|---|
| V3.1 | Grant scope `read_write`, chosen by the owner at approval; the write gate lets it through | migration, `/impostazioni/assistenza` | a `read_write` member can `approve_invoice` and the row's `created_by` is the support member; a `read` member still gets `support_read_only` |
| V3.2 | The banner names the write scope | app shell | Playwright: the banner text differs by scope |

**V4 — Custom domains per tenant** · Trigger: FD18 "yes" and the product domain decided (Q188) · Replaces: none.
| # | Step | Files | Test |
|---|---|---|---|
| V4.1 | `tenant_domain (tenant_id, host unique, verified_at)`; the proxy resolves a verified host to the tenant slug | migration, `src/proxy.ts` | a verified host serves that tenant's `/prenota`; an unverified host → 404; staff paths on a custom host → 404 (the C14-V5 test) |
| V4.2 | Domain add/verify by a platform-admin script using the hosting provider's API (API behaviour read at that time, not assumed) | `scripts/tenant-domain.ts` | a dry run against a recorded fixture; one platform audit row written |

**V5 — Billing provider integration** · Trigger: FD4 names a provider · Replaces: the manual `active` setting in SP6 for paying tenants.
| # | Step | Files | Test |
|---|---|---|---|
| V5.1 | Webhook route verifying the provider's signature; events → `tenant_subscription_event` / `tenant_status_event` through a `service_role` procedure | `src/app/api/cron/billing-webhook/route.ts` (under `/api/cron/*`, so the secret-key rule holds) | a bad signature → 401, nothing written; a replayed event id → applied once |
| V5.2 | Links to the provider's hosted checkout and portal from the console and the owner's settings; a `past_due` banner | `src/server/billing/` | no card field in any of our forms or payloads (grep test); `past_due` shows the banner; suspension still follows SP6's cut-off rule |

**V6 — Open sign-up with trial** · Trigger: FD5 "self-serve" · Replaces: the third clause of SP7 test 3 (sign-up without a code creates
no tenant).
| # | Step | Files | Test |
|---|---|---|---|
| V6.1 | `provision_tenant` for a confirmed user with no membership; one trial tenant per user | migration, `/registrati` | a second provisioning by the same user → 409; a platform staff user → refused |
| V6.2 | Abuse controls: a per-IP-hash daily limit (the reservation pattern); a CAPTCHA only after FD5b names a provider | route, migration | the limit reached → 429, nothing written; no CAPTCHA script on any page unless configured |

**V7 — Consolidated group reports** · Trigger: FD16 "yes" · Replaces: none.
| # | Step | Files | Test |
|---|---|---|---|
| V7.1 | `public.org_kpis(period)`: a definer that loops over the caller's **owner** memberships and calls each tenant's KPI body | migration | an owner of A and B gets both; an owner of A and chef of B gets only A |

**V8 — Tenant role `manager`** · Trigger: FD17 "manager" · Replaces: none.
| # | Step | Files | Test |
|---|---|---|---|
| V8.1 | Enum value and policies (owner-like operations, no user or billing management) | migrations | the full pgTAP role matrix; a manager cannot create an owner or admin |

**V9 — Tenant role `bar`** · Trigger: FD17 "bar" · Replaces: none.
| # | Step | Files | Test |
|---|---|---|---|
| V9.1 | Enum value, PIN login allowed, waiter-like policies plus counter sales | migrations | `waiter_cost_columns` run for `bar` finds no cost column; the M11 PIN tests pass for `bar` |

**V10 — Isolated database for one customer** · Trigger: a customer's contract requires physical separation (ADR-003 revisit) ·
Replaces: none (that customer only).
| # | Step | Files | Test |
|---|---|---|---|
| V10.1 | The same migrations deployed to a dedicated project; the console registers it as an external tenant (metadata pushed by a script) | `scripts/`, runbook | CI runs the full migration and pgTAP suite against an empty second project |

**V11 — The tenant `admin` may also approve support** · Trigger: FD7b "yes" · Replaces: SP4 test 2.
| # | Step | Files | Test |
|---|---|---|---|
| V11.1 | `approve_support_grant` and `revoke_support_grant` accept `owner` or `admin`; an admin cannot approve a grant for a staff member who is also that admin's own auth user | migration | admin approves → `support_grant.approved` naming the admin; chef and waiter → 42501; self-approval → 42501 |

**V12 — Public menu page** · Trigger: FD20 "yes" · Replaces: none.
| # | Step | Files | Test |
|---|---|---|---|
| V12.1 | `public.public_menu(slug)` (anon, definer): available items, names, prices, allergen state; feature `public_menu` | migration | the payload holds no cost, margin or stock-quantity key (key whitelist test); an unknown or disabled slug → the same 404 |
| V12.2 | `/menu/[slug]` page under the nonce CSP (ADR-028) | `src/app/(public)/menu/[slug]/page.tsx` | Playwright renders the fixture menu; a staff path under the slug → 404 |

**V13 — Customer names on bar tabs** · Trigger: FD21 "names allowed" · Replaces: SP8 test 6.
| # | Step | Files | Test |
|---|---|---|---|
| V13.1 | Tab label allowed to hold a name; the label is cleared (set to the tab number) at close + N hours by a retention job (N with the legal adviser) | migration | after the retention time the label equals the number; the chef reads no tab label (0 rows); the waiter cost-column test unchanged |
| V13.2 | Privacy note in the tenant's privacy texts list (the reservations pattern) | settings | readiness check refuses enabling named tabs until the privacy contact is set |

**V14 — Convert DigiAlto's admin rows at tenant #1 to support grants** · Trigger: FD9 "convert", with the owner's written consent ·
Replaces: SP13 test 3.
| # | Step | Files | Test |
|---|---|---|---|
| V14.1 | Script: deactivate the DigiAlto `admin` rows (history kept), add the people to `platform.staff`, record the owner's consent | `scripts/convert-digialto-admins.ts` | the former admin reads 0 rows of tenant #1 without a grant; with an approved grant reads like admin; `audit_event` holds the consent and the deactivation |

---

## 11. Risks and mitigations

**Security and privacy**
- *Platform staff become a cross-tenant path.* Mitigations: the `platform_staff` role with no table grants (V2 is its fallback), the
  metadata whitelist test, `aal2` always, the platform audit, support only by consent. Residual: secret-key holders (stated in the DPA).
- *Session-tenant confusion (one login, many tenants).* The tenant is chosen server-side only through `select_tenant` (membership
  checked); the hook never trusts incoming claims (as today); SP2 tests 1–4; the offline cache is cleared on switch (SP2 test 7).
- *A support grant left open.* Expiry is checked at every statement, not by the cron; banner; owner revoke (SP4 tests 4–6).
- *Erasure is destructive.* Only `cancelled`, after the window, with an export or waiver, approvals, `service_role` only, script-only,
  with an audit tombstone; ADR-040 and a `CLAUDE.md` amendment the founder approves (SP10 tests 2–4).
- *More personal data at scale* (many controllers' staff, suppliers, reservation contacts). One DPA template, sub-processor notices,
  per-tenant export and erasure, unchanged log rules (no personal data in logs or Sentry).
- *Shared Supabase Auth limits* (rate-limits.md lines 16–18): a flood against one tenant's sign-in affects all; accepted today for one
  venue, **to re-decide before tenant #2** (the hosted values are read by the founder).
- *DigiAlto's legacy admin rows at tenant #1* bypass the consent model until V14; accepted by the base plan because the client agreement
  covers DigiAlto's current role.

**Performance and cost**
- RLS cost grows with rows, not tenants, when `tenant_id` leads the indexes; the Supabase RLS guide recommends indexing policy columns
  and wrapping helpers in `select` (source S3), as the project already does. Spike T4 measures; SP2 reviews indexes. The added helper
  checks (support grant, status) are one indexed lookup per statement (init-plan), measured with the existing perf workflow.
- Extraction cost scales per tenant: metered and capped (SP11); no price estimated.
- One global extraction queue: fairness in SP11.

**Operations**
- One migration hits every tenant: expand/contract, release rings, per-tenant backfills, the multi-venue CI fixture (§6.5).
- The production Supabase plan (FD11, source S2).
- The founder as the only platform admin: a two-person erasure rule is impossible today, hence FD12's default.

**Dependencies (name, licence, why)**
- None added by the base plan. A billing SDK (V5) or a CAPTCHA script (V6) would each need its one-line justification and the
  `no-new-deps` test updated at that time.

**Where every secret lives (new or changed)**

| Secret / credential | Lives in | Used by | When |
|---|---|---|---|
| none for the console, memberships, entitlements, status or support grants | — | Postgres roles and user sessions only | SP2–SP6 |
| Supabase secret key, database URL (existing) | GitHub environment secrets (`production-backup`, and a new protected `platform-ops` environment) or the founder's local env for scripts | `scripts/tenant-export.ts`, `scripts/tenant-erase.ts`, `scripts/backup/tenant-extract.ts`, `scripts/convert-digialto-admins.ts` (V14) | SP10, V14 |
| Auth SMTP credentials (existing Resend SMTP) | Supabase Auth settings (dashboard) | sign-up confirmation and invitation e-mails | SP7 |
| Billing provider API key, webhook signing secret | Vercel env, server-only, never `NEXT_PUBLIC_` | V5 webhook and links | V5 only |
| CAPTCHA secret key | Vercel env, server-only | V6.2 | V6 only |
| Hosting provider API token (domains) | GitHub environment secret for the script, never in the Vercel runtime | V4.2 | V4 only |
| Account logins: billing provider dashboard, CAPTCHA provider, domain registrar | the founder's password manager with MFA (Q26) | humans | when created |

---

## 12. Founder decisions (each with a recommended default) and open questions

| # | Decision | Recommended default | Blocks |
|---|---|---|---|
| FD1 | **Q11: who owns the code and IP** (a DigiAlto product with the osteria as tenant #1, or client-owned) | DigiAlto owns the platform; the osteria's use is set out in a written agreement. Needs the client's agreement and legal advice | **everything commercial**; SP13 |
| FD2 | Sequencing with Phase 2 | P2-1 TOTP first (the SP milestones build on it); then SP0, SP1, SP2, SP3, SP5, SP6, SP4 before any second tenant; Phase 2 items continue in your order in between | planning |
| FD3 | Tier names, contents, prices; add-ons | placeholders until you decide; the mapping in §4.2 as a starting point | SP5 seeding (plans can be added later) |
| FD4 | Billing provider | none at first: manual invoicing | V5 |
| FD5 | Sign-up model (FD5b: CAPTCHA provider under V6) | invitation codes | V6 |
| FD6 | Trial: length, card upfront | a trial exists; its length is yours; no card; at the end → `suspended` (read-only), never deleted | SP6, SP7 |
| FD7 | Support write access (FD7b: may the tenant `admin` also approve support?) | read-only; only the owner approves | V3, V11 |
| FD8 | Maximum support grant duration | 8 hours, renewable by a new approval | SP4 constant |
| FD9 | DigiAlto's current `admin` rows at tenant #1 | keep until the client agreement changes | V14 |
| FD10 | Console host name (FD10b: separate Supabase project) | `console.<product domain>` in the same app; the product domain is still open (Q188) | SP3, V1 |
| FD11 | Supabase plan before tenant #2 | a paid plan (daily backups listed for paid plans only; source S2); you read the price | tenant #2 |
| FD12 | Erasure approvals and the `CLAUDE.md` rule 6 amendment | one platform admin plus the owner's recorded written request; revisit when DigiAlto has two platform admins | SP10 |
| FD13 | Retention after cancellation before erasure | set with the legal adviser; until then nothing is erased | SP10 |
| FD14 | Which venue types in the first sale | restaurants first (no SP8 needed); SP8 when the first bar or coffee shop signs | SP8 timing |
| FD15 | Over the extraction limit | hold in the queue with a notice until next month or a DigiAlto override; no automatic extra charge | SP11 |
| FD16 | Groups: consolidated reports | not at first | V7 |
| FD17 | Extra tenant roles (`manager`, `bar`) | none until a customer needs one | V8, V9 |
| FD18 | Custom domains per tenant | no; `<product domain>/prenota/<slug>` | V4 |
| FD19 | Countries | Italy only (IT VAT, EUR, Italian receipt types, Italian invoices) | — |
| FD20 | Public menu page `/menu/<slug>` | not built | V12 |
| FD21 | Names on bar tabs | no names; a number or short label | V13 |
| FD22 | Legal texts: terms, DPA, sub-processor list, DigiAlto privacy notice | by a legal adviser before tenant #2 | tenant #2 |
| FD23 | Observe period before enforcing entitlements; release-ring order | observe until the log is empty for two full service weeks; an internal test tenant is ring 0, tenant #1 last | SP13 |
| FD24 | Platform notices by e-mail to DigiAlto | in-console only (consistent with ADR-006/D3) | SP11 |

**Open questions (no default possible here)**
- Whether the hosted Supabase project accepts a custom `role` claim for PostgREST, Storage and Realtime (spike T2).
- Whether `session_id` is in the hook's input on every authentication method (spike T1).
- Data location and retention at Anthropic, Resend and Sentry for many controllers (project Q13, open).
- Each billing or CAPTCHA provider's prices, fees and retention (never estimated; V5, V6).
- Per-tenant custom domains through the hosting provider's API (not verified; V4).

---

## 13. Sources (fetched and read on 2026-11-13)

| ID | URL | What it says (as used here) |
|---|---|---|
| S1 | https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/content/guides/auth/auth-hooks/custom-access-token-hook.mdx | Required claims include `role`, `aal`, `session_id`; the hook receives `user_id`, `claims` and `authentication_method` (with `token_refresh` among the values) and "runs before a token is issued"; it can add, remove or change claims; examples copy `app_metadata.role` into `role`; required claims cannot be removed; token size is a concern; it can reject sign-in with an error. Nothing about several tenants per user |
| S2 | https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/content/guides/platform/backups.mdx | Daily backups for Pro, Team and Enterprise (7, 14, up to 30 days); PITR add-on; restores are whole-project and replace the current state; Storage objects are not in database backups; Free projects are advised to export regularly with `db dump` |
| S3 | https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/content/guides/database/postgres/row-level-security.mdx | Index policy filter columns; wrap helper calls in `select`; use `security definer` functions with `search_path = ''`, kept out of exposed schemas; always name the role with `to`; a secret key bypasses RLS only when the request carries no user token |
| S4 | https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/content/guides/platform/custom-domains.mdx | A custom domain replaces the project's API URL; paid add-on; one custom domain per project; subdomains only |
| S5 | https://raw.githubusercontent.com/vercel/platforms/main/README.md | Vercel's multi-tenant Next.js 16 example resolves tenants by subdomain in `proxy.ts` with a wildcard DNS record; it does not describe per-tenant custom domains |

**Not reachable in this session (claims left out or marked unverified):** `vercel.com` (multi-tenant and domain API docs) and
`gdpr-info.eu` (GDPR Art. 28 text). `supabase.com` is blocked (read through GitHub instead). No billing provider's documentation was
read: no feature or fee of any provider is claimed.
