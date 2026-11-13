# Tech plan: Osteria Digitalization · Platform SaaS (the app as the DigiAlto product "Costì" for many venues)

- **Client slug / internal:** `osteria-dei-rossi` is tenant #1; this is an internal DigiAlto planning document (English).
- **Repo and branch:** `osteria-dei-rossi-app`. First written in worktree `/home/user/osteria-platform-saas`, branch `docs/platform-saas`
  (merged). **Amended** in worktree `/home/user/osteria-pd2`, branch `docs/platform-decisions-2` (from `main`), to apply the second set
  of founder decisions (§0b). Documents only, no code.
- **Author:** architect · **Date:** 2026-11-13 (both sets)
- **Status:** proposal, with the **founder decisions of 2026-11-13 applied: the first set (§0a) and the second set (§0b), which changes
  several first-set defaults.** **Planning only.** The build starts after go-live (2027-01-12) and the two-week supervised run (Gate 4),
  at the founder's order. No date is promised here. The one exception is QW13 (§5.5), a strings-only item proposed for the UX
  quick-wins staff PR, which the lead approves separately.
- **ADR drafts (status proposed):** `docs/adr/adr-037-platform-layer-and-support-access.md` (decision changed by §0b; file name kept),
  `docs/adr/adr-038-memberships-and-organisations.md` (amended by §0b), `docs/adr/adr-039-entitlements-and-tenant-status-in-postgres.md`,
  `docs/adr/adr-040-tenant-export-and-erasure.md`. ADR-037 and ADR-038 amend ADR-003. ADR-036 is TOTP (PR #79, merged to `main`).
- **Inputs read:** `CLAUDE.md`; `docs/prd.md` (guiding constraints, scope table, running-cost target); `docs/client-facts.md`;
  `docs/plans/2026-10-21-project-plan.md` (§1, §3, §3.5, §3.6, §3.11, §5, §5a, Q9, Q11, Q13); `docs/plans/2026-11-11-phase2-scope.md`
  (Parts 1–2); the P2-1 TOTP plan `docs/plans/2026-11-12-p2-1-totp.md` (PR #79, merged); ADR-003, ADR-018, ADR-028, ADR-029, ADR-031,
  ADR-032, ADR-034; `docs/go-live/rate-limits.md`, `docs/go-live/phase1-closeout.md`, `docs/go-live/checklist.md`; `supabase/config.toml`
  (`[auth]` sign-up setting, the magic-link template); the migrations and source files cited in §2.4, §2.5, §5.4 and §5.5 (every
  hard-coded assumption and every capability difference has a file:line, checked on this branch).
- **Client facts used:** only the trading name "Osteria Dei Rossi" (approved 2026-10-22, `docs/client-facts.md` line 12), to name tenant
  #1. No other client fact. The founder's statement that DigiAlto and the osteria have the same owner (FD1) and the product name
  **"Costì"** (FD27) are founder decisions relayed by the lead, recorded in §0a and §0b; neither is in `docs/client-facts.md` yet (§12, open
  item for the lead). **No e-mail address appears in this plan or its ADRs** (the repo is public; FD28).
- **ID scheme:** milestones **SP0–SP13**; variants **V1–V16** (V3, V11, V14 and V15 withdrawn by the second set, §10b); founder decisions
  **FD1–FD35**; hard-coded assumptions **H1–H40**; spike checks **T1–T5**; UX quick-win **QW13** (proposed here, built in the UX
  quick-wins PR).
- **How this file maps to `templates/tech-plan.md`:** §0a and §0b = founder decisions applied; §1 = goal, scope and current state; §2–§8 =
  design; §9 = alternatives; §10 = build plan (milestones with acceptance tests) and §10b = variants; §11 = risks (with secrets); §12 =
  founder decisions and open questions; §13 = sources.
- **Open item for the lead (DigiAlto-Ops):** the founder's 2026-11-13 decision to turn the app into a SaaS product, and both sets of
  founder decisions of the same day (§0a, §0b), must be written into DigiAlto-Ops `clients/osteria-dei-rossi/context.md` (status,
  decisions, open items); the product name "Costì" also belongs in DigiAlto-Ops (agency knowledge) and, before QW13 ships, as a line in
  this repo's `docs/client-facts.md`. This repo's `CLAUDE.md` keeps status and decisions in DigiAlto-Ops, not here.

---

## 0. Summary for the founder (plain language)

**What changes.** Today the app is built for one osteria. To sell it, as **Costì**, to other restaurants, and later to bars and coffee
shops, it needs five things it does not have yet:

1. **A DigiAlto "back office" that is separate from the venues' data.** DigiAlto's platform admin account gets a console to create
   venues, see if they are healthy and switch modules on or off. The console shows *about* a venue (name, status, plan, usage numbers),
   never its invoices, costs or orders.
2. **DigiAlto as the standing admin of every venue, in the open.** As you decided (second set, FD29), one DigiAlto account (yours) is
   `admin` in every venue from the day the venue is created. There is no "ask and allow" step. In exchange: everything that account does
   in a venue is recorded as "DigiAlto" and the venue's owner can filter for it in the activity log; the account always needs its
   second factor; the access is written into the venue contract and privacy terms (legal adviser); and attaching the account to a new
   venue is itself recorded. The account never sees what only the owner sees today (fixed costs, which can reveal salaries; allergen
   confirmations; alerts).
3. **One login for many venues.** An owner with two places signs in once and switches venue; DigiAlto's account works the same way
   across all venues. Each venue's data stays fully separate, exactly as today.
4. **Modules on and off per plan.** Plans (names and prices are yours to decide) switch modules on or off. The database itself refuses
   what a plan does not include, not only the screens. Switching a module off never deletes data.
5. **Settings instead of osteria rules in the code.** Today some things are fixed for an Italian osteria: the five courses (antipasti …
   bevande), "every sale has a table and covers", the VAT list, the time zone in the screens, the name and colours. I found **40** such
   places (§5.4). Bars and coffee shops need counter sales without tables, quick orders and tabs; those are a separate, larger step
   (SP8), which you decided to schedule when the first bar or coffee shop signs (FD14).

**The name.** The product is **Costì**; each venue keeps its own name and look. Costì appears where the product speaks (the installed
app's name, the browser tab, the sign-in page and sign-in e-mails, the console); the venue's name stays in the app's header, on the
venue's Home, on the booking page and in e-mails to the venue's guests (§5.5). A small strings-only change, **QW13**, can put this in
place now; logo and colours are not part of it (undecided).

**What stays the same, and the one rule that changes.** Each venue sees only its own data, roles are checked by the database, waiters
never see costs, and within a live venue stock and history are never edited (only corrected by new entries). **One rule changes, as you
approved on 2026-11-13 (FD12):** "nothing is ever deleted" gets a **second exception** (the first is the demo-data reset): erasing a whole
venue (ADR-040), and only when all of these hold: the venue has cancelled and its retention period has passed (FD13, set with a legal
adviser; until it is set nothing is erased), DigiAlto holds the owner's written request, and a DigiAlto platform admin has approved it,
with an audit record. The matching change to rule 6 of the project's `CLAUDE.md` is written in the SP10 pull request, together with the
code, not before. **Osteria Dei Rossi becomes venue #1 with no change on its screens** beyond the QW13 strings: each step is tested
against a copy of today's behaviour before it ships.

**What you decided on 2026-11-13, and what I still need.** First set (§0a): DigiAlto owns and sells the platform, with Osteria Dei Rossi as
customer and venue #1 under a short written agreement (FD1); restaurants first (FD14); invitation only (FD5); erasure with the safeguards
above (FD12). Second set (§0b): the name Costì (FD27); one platform admin, your account, never written in the repo (FD28); standing admin
in every venue instead of consented support (FD29); the owner is the venue's only admin besides DigiAlto, and `admin` now means
DigiAlto's account inside a venue (FD30). Every other question takes my recommended default, which you may revisit; the new ones are
FD31–FD35 (second factor for DigiAlto's account even where a venue switched the requirement off; how reads are recorded; no in-app
"remove DigiAlto" switch; where each name appears; what the owner does and does not inherit from today's `admin`). Still to come from you
(I estimate none of them): plan names, contents and prices (FD3); the trial length (FD6); the product domain (FD10); the paid Supabase
plan's price, before venue #2 (FD11); how long a cancelled venue's data is kept, with a legal adviser (FD13); the legal texts, including
the DigiAlto-access disclosure, by a legal adviser (FD22); and the written agreement itself (FD1).

**Size, no dates:** fourteen milestones (SP0–SP13): 4 large, 7 medium, 3 small; plus variants you may switch on later. One large
milestone (SP8, counter service for bars and coffee shops) waits until the first bar or coffee shop signs (FD14). A spike (SP0) comes
first, because two Supabase behaviours this design relies on must be proven on the real stack before anything is built.

---

## 0a. Founder decisions 2026-11-13

Received through the lead on 2026-11-13 and applied throughout this plan and in ADR-037 to ADR-040 (whose status stays "proposed"). In
§12 every FD now carries a status: **decided** (an explicit answer) or **decided: default, founder may revisit** (the recommended
default stands; a different answer later triggers the variant named in §12, or re-plans the step named there). **The second set (§0b)
later the same day changed FD7, FD8, FD9, FD17, FD25 and FD26 and withdrew the pgTAP 341 design point below; this table is kept as the
record of the first set, with those rows marked.**

| FD | Decision | Status | Where applied |
|---|---|---|---|
| FD1 | **DigiAlto owns the platform and sells it.** Osteria Dei Rossi is a customer and tenant #1 under a short written agreement. DigiAlto and the osteria have the same owner (the founder's decision of 2026-10-22, relayed by the lead; recorded in DigiAlto-Ops, not in `docs/client-facts.md`) | **decided** | §0; §1.4 (Ownership row: Q11 answered); §8 (intro); §11; §12; SP13 (the written agreement comes first); ADR-037 (context) |
| FD5 | **Invitation only; no public sign-up.** FD5b (a CAPTCHA provider) is moot while V6 is parked | **decided** | §3.2 (the owner's login is created by a platform-admin script; Supabase Auth sign-up stays off); §3.3; §5.4 H8; §7; §9; SP0 (T5); SP7 (In, tests 1–3); §10b V6 (parked); §11 (secrets) |
| FD12 | **Erasure: yes, with safeguards.** Erasure happens only when **all** hold: (1) after cancellation, plus the retention period (FD13, set with a legal adviser; **until then nothing is erased**); (2) the owner's recorded written request; (3) a platform-admin approval, audited. The `CLAUDE.md` rule 6 amendment is approved as ADR-040 describes; it goes into the **SP10 PR**, not now (`CLAUDE.md` is not edited by this plan) | **decided** | §0; §6.2; §10 (SP10 row); SP10 (In, tests 2 and 7); §11; §12; ADR-040 |
| FD14 | **Restaurants first.** SP8 (counter service, quick orders, tabs) is scheduled when the first bar or coffee shop signs | **decided** | §0; §1.1; §3.3; §5 (intro), §5.2, §5.3; §5.4 H22, H36; §6.5 rule 4; §10 (intro, table, order note); SP7 (In, tests 4–5); SP8 (In, tests 8–9) |
| all others (FD2–FD4, FD6–FD11, FD13, FD15–FD26) | **The recommended default stands**, explicitly including FD25 (separate console logins until V14) and FD26 (platform-staff actor for #79's scripts). **Changed by the second set (§0b): FD7, FD8, FD9, FD17, FD25, FD26** | **decided: default, founder may revisit** (FD7, FD8, FD9, FD17, FD25, FD26: now as §0b and §12 say) | §12 (each row) |
| design point, no FD number | pgTAP 341 allowlist widened to name `app.support_end_sessions` next to `mfa_reset_service_begin`. **Withdrawn by the second set (§0b): there are no support grants, so no second function writes `auth.*`; pgTAP 341 keeps #79's allowlist** | withdrawn | §2.6; SP3 test 12; SP4 test 8; ADR-037 |
| design point, no FD number | **VAT two-list design** (statutory list for supplier invoices and as the CHECK bound; per-tenant sale list in procedures and triggers) | default, founder may revisit | §5.2; H14, H15; SP1 test 1 |

**What the decisions bring with them (architect's notes, not new decisions):**
1. **FD5 and Supabase Auth sign-up.** The earlier SP7 draft let the future owner sign up through Supabase's ordinary e-mail sign-up with
   the publishable key. That needs Supabase Auth's sign-up switched on, and the publishable key is public, so anyone could then create
   auth users through the Auth API: a public sign-up at the Auth level, which FD5 excludes. Today the switch is off
   (`supabase/config.toml` lines 178–180: `enable_signup = false`, comment "owners and admins are created by scripts/create-tenant.ts,
   never by self-signup"), and go-live founder item M-5 keeps it off on staging and production (`docs/go-live/phase1-closeout.md`
   line 341). The base plan therefore keeps it off and creates the invited owner's login with a platform-admin script,
   `scripts/tenant-invite.ts`, which uses the secret key in `scripts/` as `CLAUDE.md` rule 2 allows and as `scripts/create-tenant.ts`
   already does (`scripts/lib/create-tenant.ts` lines 75–79). No new file outside `scripts/` uses the secret key (§3.2, SP7).
2. **FD1, same owner.** At tenant #1, the person who writes the erasure request (owner) and acts as DigiAlto platform admin can be the
   same person. (The first set also named the owner's support approval here; support approval no longer exists, §0b.) Every control
   still records each role separately (tenant audit and platform audit); none of them depends on two different people (FD12 asks for
   one platform-admin approval). Whether the written agreement between two businesses with the same owner needs a particular form is for
   the legal adviser (FD22); this plan makes no legal claim. The agreement is the natural place to state DigiAlto's admin role at tenant
   #1 (FD9 as changed by FD30, §11); its text is the adviser's. **Because one person holds both roles at tenant #1, the platform admin
   account and the owner's login at tenant #1 must be two different auth users** (one membership row per user and tenant carries one
   role; §2.4 point 1).
3. **FD12 and FD13.** The retention period is not set yet, so `app.erasure_retention_days()` returns null and `platform.erase_tenant`
   refuses every tenant with `retention_not_set` (SP10 test 2) until a migration sets the value after legal advice.
4. **FD14.** SP8 is not in the sequence before tenant #2. H16–H19, H24 and the counter screens of H39 stay as they are until SP8; they
   are restaurant assumptions and correct for restaurants. The onboarding wizard offers only the restaurant preset until SP8 (SP7 test 4).

---

## 0b. Founder decisions 2026-11-13 (second set)

Received through the lead on 2026-11-13, after #81's first set; **they change #81's defaults** and are applied throughout this plan, in
ADR-037 and in ADR-038 (status stays "proposed"; each carries a dated note). FD27–FD30 are explicit answers (**decided**). FD31–FD35 are
design points the decisions open; each takes the recommended default (**default, founder may revisit**).

| FD | Decision | Status | Replaces / changes | Where applied |
|---|---|---|---|---|
| FD27 | **The product is named "Costì".** Osteria Dei Rossi is tenant #1. Costì is the app/platform name; each venue keeps its own name and theme. Recorded as a founder decision relayed by the lead; `docs/client-facts.md` and DigiAlto-Ops should record it (open item for the lead) | **decided** | — | title; §0; §5.5 (placement, current code, QW13); H29, H30; SP3 (console strings); SP4 test 10 (TOTP issuer); SP9 |
| FD28 | **One overall platform admin: DigiAlto's founder account.** No e-mail address is written anywhere in the repo. The account is identified at provisioning time by a script argument (`--email`) or the env var `PLATFORM_ADMIN_EMAIL` (held only in Vercel/GitHub environments), or by a `platform.staff` row the founder creates with the secret key. Docs say "the platform admin account (address held by DigiAlto)" | **decided** | `platform_admin` was a role for several DigiAlto people | §2.1; §2.4 point 1; §11 (secrets); SP3 (In, test 11) |
| FD29 | **The platform admin has standing `admin` in every tenant. No ask-and-allow support access.** Every action of that account in a tenant is audited as "DigiAlto" and visible to that tenant's owner through a filter in the audit view; it is disclosed in the venue contract and privacy terms (legal adviser, FD22); TOTP is required for the account; a platform-level audit entry is written when the account is attached to a new tenant | **decided** | **FD7 and FD8** (support grants, read-only scope, maximum duration); the support-grant parts of ADR-037; SP4 as first planned; V3, V11; the pgTAP 341 widening | §0; §1.1, §1.2; §2.4–§2.6; §3.1 (write gate); §3.2; §6.1; §8; §9; SP4; SP6; SP7; SP13; §10b; §11; ADR-037 |
| FD30 | **Tenant roles.** Each venue's owner is its own tenant admin and the only venue-level admin besides DigiAlto; no extra venue admins (FD17: none). Chef and waiter stay as today. `admin` is redefined as "the platform admin's role inside a tenant". DigiAlto's admin rows at tenant #1 become this platform admin membership | **decided** | **FD9** (legacy rows kept), **FD17** (now explicit: none), **FD25** (separate console logins), **FD26** (platform-staff actor); V14, V15 | §2.1; §2.5 (capability table); §8 steps 6 and 10; SP3; SP4 (tests 5, 7, 8); SP13; ADR-037; ADR-038 |
| FD31 | **Second factor for the platform admin account everywhere**: `aal2` for `admin` in every tenant mode, `off` included; the account can never remove its last factor; attaching requires a verified factor (§2.4 point 6) | default, founder may revisit | #79's T-2 rule for `admin` (gated only under `required`, or under `enrolled` with a factor; never under `off`) | §2.4; SP3 test 11; SP4 tests 1, 3; §11 |
| FD32 | **How DigiAlto's actions are recorded**: writes carry the DigiAlto row as `created_by` (existing columns); each tenant entry writes one tenant audit row in Postgres; each `/api/*` request of the account writes one `platform_access_event` row (method and path pattern only) | default, founder may revisit (another answer re-plans SP4 test 4's access-log part; no variant drafted) | — | §2.4 point 4; SP4 test 4; SP6 (exempt list); §11 |
| FD33 | **No in-app switch for the owner to remove or pause DigiAlto.** The account is detached only by a platform script, on the owner's written request or at contract end | default, founder may revisit | — | §2.4 point 8; SP4 test 9; V16 |
| FD34 | **Where each name appears** (§5.5): Costì in the manifest, `<title>`, the sign-in page's intro, sign-in e-mails and their sender display name, the console and the platform admin's TOTP issuer; the venue's name in the header band, the venue's Home, the booking page and e-mails to guests | default, founder may revisit | — | §5.5; QW13; SP4 test 10; SP9 |
| FD35 | **What the owner inherits from today's `admin`** (§2.5): nothing that is exclusive to `admin` today. No tenant session may create an `admin` row; the owner may no longer insert `owner` rows directly; the demo seed stops creating a demo admin | default, founder may revisit | baseline policy "Only an admin (DigiAlto) can create another admin" | §2.5; SP4 tests 5–6 |
| FD36 | **Google booking: yes** (founder 2026-11-13, relayed by the lead). At go-live, no code: the owner adds `<public domain>/prenota/<slug>` as the "Prenota" link on Google Business Profile (go-live checklist GBP-1, after the custom domain, Q188). Later: "Reserve with Google" (Actions Center booking partner) as a SaaS milestone **candidate**; its feasibility is being researched, so it is not planned here | decided (go-live step); candidate (Reserve with Google) | — | go-live checklist GBP-1; §10 "Later candidates" |

**What the second set brings with it (architect's notes, not new decisions):**
1. **This is close to ADR-003 as first written.** ADR-003 named the four roles "owner, chef, waiter and admin (DigiAlto)" and gave DigiAlto
   "an explicit `app_user` row per tenant ... no global bypass". FD29 and FD30 keep exactly that, with one login across tenants (SP2,
   ADR-038) and the controls listed in FD29. The platform layer (console, `platform_staff` role, metadata-only functions, platform audit)
   stays as designed.
2. **What is dropped from the first-set design:** `support_grant` and its procedures, `app_user.kind = 'support'`, the grant check in the
   membership helpers, the `support-grant-expiry` job, `app.support_end_sessions` and the pgTAP 341 widening, the support banner and
   `/impostazioni/assistenza`, `app.support_max_minutes()` (FD8), the `support_read_only` refusal of the write gate, `audit_event.created_by_staff`,
   the `p_actor_staff` argument and `--staff` flag on #79's functions and scripts (FD26), and variants V3, V11, V14, V15. **Kept:** the
   platform schema, `platform_staff` role, console host, platform audit, metadata whitelist, `app.session_tenant`, the write gate for
   tenant status.
3. **One account in every tenant is the strongest credential in the system.** FD31's default and the controls in §2.4 follow from that;
   the residual risk is in §11.
4. **QW13** is strings only (no logo, no colours) and does not depend on any SP milestone; it is described in §5.5 for the lead to approve
   into the UX quick-wins PR (`docs/plans/2026-11-13-ux-quick-wins.md` is on another branch and is not edited here).

---

## 1. Goal, scope and current state

### 1.1 Goal
Turn the single-venue app into the multi-tenant DigiAlto product **Costì** (FD27), sold first to restaurants (FD14) and later to bars and
coffee shops (SP8), with a platform layer outside tenant RLS, DigiAlto's standing and audited `admin` membership in every tenant (FD29),
per-tenant feature entitlements enforced in Postgres, a tenant lifecycle with GDPR export and erasure, and per-tenant configuration
replacing the osteria assumptions, while Osteria Dei Rossi continues as tenant #1 without disruption.

### 1.2 In scope (this plan)
Product and venue naming (§5.5, QW13); role model (platform and tenant); DigiAlto's standing admin access and its audit; memberships
across tenants and organisations (groups); tenant lifecycle (provision, onboarding, trial, active, suspended, cancelled, export,
erasure); feature flags and tier candidates (no prices); venue types and per-tenant configuration; inventory of hard-coded assumptions;
data protection roles, backups, quotas, observability, migrations, slugs and domains; commercial plumbing options; migration path for
tenant #1; milestones with acceptance tests; founder decisions.

### 1.3 Out of scope
Prices, tier names, the billing provider choice (options only, §7); legal texts (terms, DPA, privacy notices, the DigiAlto-access
disclosure, the FD1 written agreement: for a legal adviser); the Costì logo and colours (undecided); countries other than Italy (FD19);
fiscal register integration of any kind (PRD out of scope, unchanged); any change to Phase 2 candidates C1–C17 beyond what is named here.
Paths that depend on an open answer are only in §10b.

### 1.4 Current state (what this plan builds on; `main` as of branch `docs/platform-decisions-2`, PR #79 included)

| Area | State today (file) | Consequence for SaaS |
|---|---|---|
| Tenancy | `tenant` (one row per venue), `app_user` with `tenant_id`, RLS on every table; helpers `app.tenant_id()`, `app.role()`, `app.app_user_id()` read the token's `tenant_id` claim and the active `app_user` row, plus #79's `aal` gate (`supabase/migrations/20261201100000_mfa_gate.sql` lines 65–99; M0 bodies `20261021120000_tenancy_baseline.sql` lines 49–69) | The tenant boundary is sound and stays. "Adding a venue is a data change" (ADR-003) |
| One login = one tenant | `app_user.auth_id ... unique` (baseline line 31); the hook selects *the* active membership (baseline lines 117–121; PIN version `20261025100500_access_token_hook_pin.sql` lines 97–101) | No multi-venue owner, no DigiAlto account in two tenants with one login (H5, H6) |
| DigiAlto access | ADR-003: "an explicit `app_user` row per tenant for DigiAlto admins. There is no global bypass"; policy comment "Only an admin (DigiAlto) can create another admin" (baseline lines 96–103); comments "Admin (DigiAlto support)" in `20261022150100_alert.sql` line 162 and `20261023100600_allergen_confirm_owner_only.sql` line 2 | The tenant role `admin` *is* DigiAlto today (H7). FD30 keeps that meaning and ties it to the one platform admin account (§2.4, §2.5) |
| Onboarding | `scripts/create-tenant.ts` → `public.create_tenant_with_owner` (service role only; baseline lines 143–166); the script creates the owner's confirmed auth user with the secret key (`scripts/lib/create-tenant.ts` lines 75–79); IT VAT only (same file line 13). Supabase Auth sign-up is off (`supabase/config.toml` line 180; go-live item M-5). No script creates an `admin` row; the demo seed does (`20261105100000_demo_data_marker.sql` lines 147–149) | Script-only provisioning; no self sign-up, which FD5 keeps |
| Second factor | PR #79: TOTP for owner/admin, per-tenant `tenant.mfa_enforcement` `off`/`enrolled`/`required`, default `enrolled` (`20261201100000_mfa_gate.sql` lines 16–18); `app.mfa_needs_aal2` (lines 36–47); the gate inside the three helpers (lines 65–99); `public.set_mfa_enforcement` and the break-glass `public.mfa_reset_service_begin/failed` are service-role only and require `p_actor` to be an **active admin of the tenant** (`20261201100200_mfa_admin.sql` lines 53, 88, 118). `mfa_reset_service_begin` deletes the target's `auth.sessions` (line 97) and is the **only** `public`/`app` function writing `auth.*` (pgTAP 341) | SP2–SP4 change the same helpers and the hook: they build on #79 and re-pin the hook on purpose. Because the platform admin holds an `admin` row in every tenant (FD29), #79's actor rule works at every tenant unchanged: no platform-staff actor is needed (FD26 superseded) and pgTAP 341 is not widened |
| Public routes | `/prenota/[slug]` (`src/app/(public)/prenota/[slug]/page.tsx`); slug in `reservation_settings.public_slug` unique across tenants (`20261124100000_reservation_core.sql` line 86); HMAC gate `app.reservation_gate_ok` (`20261128100000_reservation_public.sql` lines 14–46) and tenant resolution by `app.reservation_public_tenant(p_slug, p_now)` (two arguments, from line 48) | Path-based tenant resolution already works for one public feature |
| Configuration that is already per tenant | `tenant.timezone` read by SQL (e.g. `20261026100600_stock_reads.sql` line 67); `settings.business_day_cutoff` (`20261025100100_business_day_cutoff.sql` lines 10–29); service periods 1–6 per tenant, versioned (ADR-031); coperto optional per tenant (`sale_settings`, `20261031100000_menu_tables_core.sql` lines 86–102); dining tables, locations, reservation settings | A good base: several venue differences are data already |
| Product name | `app.name` = "Osteria Dei Rossi" (`src/lib/i18n/messages/it.ts` line 2, `en.ts` line 4), used for `<title>`, the header wordmark and the Home heading; manifest name (`src/app/manifest.ts` lines 7–8); sign-in e-mail subject and template (`supabase/config.toml` line 257; `supabase/templates/magic-link.html` lines 6, 10) | Product and venue name are one string today; FD27 separates them (§5.5, QW13) |
| Demo data | `begin_demo_data` / `purge_demo_data`, the sanctioned ledger exception (ADR-018, `CLAUDE.md` rule 6) | Pattern for the erasure exception (ADR-040) |
| Backups | daily encrypted `pg_dump` of the whole database and incremental invoice-file packs shared by all tenants (ADR-034); the database copy name `osteria-backup-<stamp>-<target>.tar.gpg` (`scripts/lib/backup/commands.ts` lines 298–302) and the pack and manifest names with no tenant part (`osteria-files-…`, same file lines 313–330) | No per-tenant restore or erasure today (H35) |
| Hosting | Vercel Pro (production), Supabase Free (production), decided 2026-11-08 (phase 2 scope §2.2) | Supabase's backup docs list daily backups only for Pro, Team and Enterprise (source S2) |
| Ownership | Q11 "Code and IP ownership given multi-tenancy" was open (`docs/go-live/phase1-closeout.md` line 119). **Answered by FD1 (2026-11-13):** DigiAlto owns and sells the platform; Osteria Dei Rossi is customer and tenant #1 under a short written agreement | No longer blocking the design; the written agreement comes before SP13 and before selling |

---

## 2. Role model

### 2.1 Two levels, one bridge account

| Level | Roles | Where they are stored | How they reach data |
|---|---|---|---|
| **Platform (DigiAlto)** | `platform_admin`: **exactly one active account, the platform admin account (address held by DigiAlto)** (FD28): tenant lifecycle, invitations, plans, overrides, recording erasure requests and approving erasure, attaching itself to tenants. `platform_support` stays in the role list for a future read-only console user; **no account holds it** and it can never hold a tenant membership | `platform.staff (auth_id pk, role, display_name, is_active, created_at, created_by)` in a new schema `platform`, not exposed by the Data API; a partial unique index allows one active `platform_admin` | In **console mode**, only through `public.platform_*` definer functions that return **metadata** (§2.3); never through tenant RLS |
| **Tenant (venue)** | `owner` (the venue's own admin, FD30), `admin` (**redefined: the platform admin's role inside a tenant**, FD30), `chef`, `waiter` (`app_role` enum, baseline line 9); candidates `manager` (V8) and `bar` (V9) only if the founder reverses FD17; `accountant` stays Phase 2 C10 | `app_user` rows with `tenant_id`; the platform admin account has one `admin` row per tenant, display name "DigiAlto" | Tenant RLS, unchanged pattern: `tenant_id = (select app.tenant_id()) and (select app.role()) = any(...)` |

**Meaning of tenant `admin` (FD30).** Today `admin` = DigiAlto (H7), by policy comment and by practice. From SP4 it is held **only** by the
platform admin account: no tenant session can create an `admin` row (SP4 test 5), only `public.platform_attach_admin` can (§2.4 point 1),
and a platform health check flags any other active `admin` row (`admin_row_foreign`, SP4 test 7). The venue's own administration is the
**owner's**; there is no second venue-level admin (FD17, decided). What today's `admin` may do that the owner may not, and the proposal
for each, is §2.5.

**Second-factor actor (FD26 superseded by FD29/FD30).** #79's `set_mfa_enforcement` and `mfa_reset_service_begin/failed` require an active
`admin` of the tenant as `p_actor` (`20261201100200_mfa_admin.sql` lines 53, 88, 118). The platform admin's `admin` row exists in every
tenant (§2.4), so the functions need no new argument: `scripts/set-mfa-enforcement.ts` and `scripts/mfa-reset.ts` keep `--actor`, which
becomes optional and defaults to the platform admin's row in the target tenant (resolved from the `platform.staff` row; SP4 test 8). The
first set's `p_actor_staff`, `--staff` and `audit_event.created_by_staff` are not built; pgTAP 341 keeps #79's allowlist.

**Tenant role matrix.** Unchanged (project plan §3.11.2), except the capability decisions of §2.5. New roles only through V8/V9.

### 2.2 How platform roles stay outside tenant RLS (ADR-037)

1. **One identity, two modes (FD28–FD30).** The platform admin account is the **only** auth user that is both in `platform.staff` and a
   tenant member, and every membership it holds is `role = 'admin'`. Triggers: on `app_user`, a row for an auth user in `platform.staff`
   is refused unless that user is the active `platform_admin` and the row's role is `admin`; on `platform.staff`, a `platform_support`
   row is refused for an auth user with any member row, and a `platform_admin` row is refused for an auth user with any non-`admin` member
   row, active or not (SP3 test 2). A session is in **one mode at a time**: *console mode* (selected on the console host by
   `public.select_console()`, stored in `platform.console_session (session_id pk, auth_id, selected_at)`) or *tenant mode* (selected by
   `public.select_tenant(id)`, stored in `app.session_tenant`, SP2). Selecting one mode removes the session's row for the other (these are
   session-state rows, not ledgers).
2. **Separate Postgres role in console mode.** In console mode the access token hook sets the JWT `role` claim to a dedicated NOLOGIN
   Postgres role `platform_staff` (granted to `authenticator`) instead of `authenticated`, and adds no tenant claim. The hook
   documentation shows a hook rewriting the `role` claim (source S1). `platform_staff` has **no grant on any `public` table**, and every
   tenant policy is written `to authenticated`, so even a missing or wrong tenant policy returns nothing to a console session. It holds
   `execute` only on the `public.platform_*` functions. Whether PostgREST, Storage and Realtime on the hosted project accept a custom role
   claim is **unverified**: spike T2. If T2 fails, **V2** applies. (ADR-003 rejected separate Postgres roles *per app role with column
   grants*; ADR-037 explains why one extra role for console sessions with no table grants is a different case, and amends ADR-003.)
3. **Separate route group and host.** Console screens live in `src/app/(platform)/…` and its API in `src/app/api/platform/**`.
   `src/proxy.ts` serves `(platform)` only on the console host and answers 404 for it on every tenant host, and 404 for tenant paths on
   the console host (SP3 test 6). Same Next.js app and repo (§9 explains why; V1 is the separate-project option).
4. **Always second factor.** Every platform function and `select_console()` need `aal2` (the #79 gate pattern: `app.require_aal2()`), and
   in tenant mode the account's `admin` rows need `aal2` in every tenant mode (FD31, §2.4 point 6) (SP3 test 3, SP4 test 3).
5. **Platform audit.** `platform.audit_event (id, actor_auth_id, action, tenant_id null, detail jsonb, at)`, append-only by trigger
   (UPDATE/DELETE refused for every role, as for tenant ledgers). Every platform function and every script that uses the secret key
   writes a row (SP3 tests 7–8), including `platform_admin.bootstrapped`, `platform_admin.attached` (FD29) and
   `platform_admin.detached`. `detail` carries codes and ids only, never business data, never an e-mail address.

**Honesty about the secret key.** Whoever holds the Supabase secret key or the database URL (DigiAlto operations, the backup job) can
technically read every tenant. The controls are: the key stays where `CLAUDE.md` rule 2 allows it (cron services, `scripts/`,
`src/server/staff-auth/privileged.ts`; the base plan adds **no** new file using it outside `scripts/`); scripts write a platform audit
row; the DPA states it (§6.1).

### 2.3 What the console may read (metadata only)

`public.platform_tenants()` / `public.platform_tenant(id)` return: id, name, organisation, venue type, status and its history, plan,
overrides, created_at, member counts by role, whether the platform admin is attached, last activity date, usage counters (§6.3),
job-health codes and ledger-check finding codes (§6.4). **Never**: invoices, prices, costs, recipes, orders, reservations, staff names.
SP3 test 5 lists every key the platform functions return and fails on a business or cost key. To read a tenant's business data, the
platform admin switches to tenant mode for that tenant (§2.4), where every action is recorded as DigiAlto.

### 2.4 DigiAlto's standing admin membership (FD29; replaces the first set's support grants)

1. **Identity and bootstrap (FD28, SP3).** The founder creates the platform admin account's auth user and verifies its TOTP factor, then
   runs `scripts/platform-admin.ts bootstrap`, which reads the address from `--email` or `PLATFORM_ADMIN_EMAIL` (Vercel/GitHub environment
   only, never committed, never printed: the script prints the auth id), looks the auth user up with the admin API, and calls the
   service-role-only `public.platform_bootstrap_admin(p_auth uuid)`. The function refuses an auth user without a verified TOTP factor
   (`mfa_factor_required`), an auth user holding any non-`admin` membership (`platform_admin_has_member_role`; this is why the founder's
   owner login at tenant #1 cannot be the platform admin account, §0a note 2), and a second active `platform_admin`
   (`platform_admin_exists`); it writes `platform_admin.bootstrapped`. Alternatively the founder inserts the `platform.staff` row with the
   secret key; the same triggers and checks apply (SP3 test 11).
2. **Attach (FD29, SP4).** `public.platform_attach_admin(p_tenant uuid)` (service role, or the platform admin in console mode at `aal2`)
   inserts the account's `admin` row in that tenant (display name "DigiAlto", login method e-mail), writes **one platform audit row
   `platform_admin.attached`** and one tenant `audit_event` row `app_user.platform_admin_attached`, so the owner sees it too. It is
   idempotent (`{changed:false}`, no audit, when an active row exists) and refuses when no active platform admin exists. It runs inside
   `platform_create_tenant` for every new tenant (SP7 test 7) and through `scripts/platform-admin.ts attach --tenant <id>` for existing
   ones. Every new tenant therefore has the DigiAlto `admin` row from creation; at that point it holds no business data (status
   `provisioning`).
3. **Selecting a tenant: how the gate picks the active tenant (checked against the code).**
   - *Today:* the hook strips incoming `tenant_id`/`app_role` claims (`20261025100500_access_token_hook_pin.sql` lines 64–66), keeps the PIN
     branch for PIN accounts (lines 70–95), and for e-mail accounts selects the active `app_user` row by `auth_id` (lines 97–101) and adds
     its `tenant_id` and role (lines 103–106). With several active rows a PL/pgSQL `select … into` without `strict` takes one row in no
     defined order, so `app_user.auth_id unique` (baseline line 31) is what keeps this correct today; SP2 drops the uniqueness and changes
     the hook **in the same migration**.
   - *After SP2:* the hook reads `app.session_tenant` by the token's `session_id` claim (presence on every authentication method: spike
     T1), checks that the selected row is an active membership of that auth user, and only then adds `tenant_id` and `app_role`; with no
     selection and exactly one membership it falls back to that membership (today's behaviour for every tenant #1 user); with several and
     no selection it adds no tenant claim and `/api/me` answers `tenant_selection_required`. The platform admin always has several, so it
     always selects (`POST /api/me/tenant` → `public.select_tenant(id)`, membership checked, then a server-side session refresh). With a
     `platform.console_session` row the hook takes console mode instead (§2.2 point 2).
   - *The gate itself does not change form:* `app.tenant_id()`, `app.role()` and `app.app_user_id()` keep selecting the active `app_user`
     row whose `auth_id = auth.uid()` and whose `tenant_id` equals the token's `tenant_id` claim, plus #79's `aal` condition
     (`20261201100000_mfa_gate.sql` lines 69–74, 81–86, 93–98; `app.membership_ungated()` lines 57–61 the same without the gate). With
     `(tenant_id, auth_id)` unique there is at most one such row, so each helper returns one tenant, one role, one row id.
   - *Why RLS stays per tenant:* every policy compares a row's `tenant_id` with the scalar `(select app.tenant_id())` (e.g.
     `tenant_select`, `app_user_select`, baseline lines 85–94), so one statement sees one tenant; no policy has an organisation or
     platform branch; a switch is a new token, never a per-request client parameter (the hook never trusts incoming claims). The
     platform admin's reach across tenants is a sequence of single-tenant sessions, each recorded (point 4).
   - A token refresh keeps the session's `aal` (TOTP plan line 371), so switching tenant does not ask for the code again.
4. **Recording DigiAlto's actions (FD29, FD32 default).**
   - *Writes:* every ledger row and `audit_event` row written by the account carries the DigiAlto row as `created_by` (the existing
     columns; nothing new needed).
   - *Entries:* `public.select_tenant` writes one tenant `audit_event` row `app_user.platform_admin_entered` when the caller's membership
     is `admin` (in Postgres, whatever path the session came from).
   - *Reads:* `withApi` calls `public.record_platform_access(p_method text, p_path text)` for every `/api/*` request whose role is `admin`,
     writing one `public.platform_access_event (tenant_id, app_user_id, method, path, at)` row: the path pattern with every id segment
     replaced by `:id`, no query string, no body. Append-only; RLS: owner and admin read their tenant's rows.
   - *Residual:* a request sent straight to the Data API with the account's token, outside `/api/*`, is not in the access log (Postgres
     cannot log a `select` without an extension); its entry and its writes still are. `CLAUDE.md` rule 6 ("every screen reads `/api/*`")
     keeps the app's own path covered (§11).
5. **Visible to the owner (FD29).** The activity log (`/registro`, `canReadAudit` = owner and admin, `src/lib/counts/count-view.ts` line 21;
   `GET /api/audit`, `src/app/api/audit/route.ts` line 6) gains a filter **"Solo DigiAlto"**: `public.audit_log` gets `p_actor text
   default 'all'` (`'all'` | `'digialto'`) next to `p_kind` (`20261027100500_audit_log.sql` lines 8–10, check at line 30); with
   `'digialto'` it returns the entries whose actor is the tenant's `admin` row, plus `platform_access_event` rows and the attach and entry
   events, each labelled "DigiAlto" (SP4 test 4).
6. **Second factor (FD29; FD31 default).**
   - *Under #79 as built:* `app.mfa_needs_aal2` (`20261201100000_mfa_gate.sql` lines 42–46) gates an `admin` when the tenant's mode is not
     `off` and (it has a verified factor **or** the mode is `required`). So at a tenant in `required`, the account always needs `aal2`. At
     a tenant still in `enrolled` (the default after #79's migration, line 17) it needs `aal2` **only while it has a verified factor**: the
     account has one (bootstrap requires it), but under `enrolled` #79 lets an admin remove its last factor (the `mfa_last_factor` refusal
     applies only under `required`, `20261201100100_mfa_self.sql` lines 253–256), after which the gate would drop. At a tenant set to
     `off` (the kill switch) the account would need no second factor at all.
   - *Recommended (FD31):* force `aal2` for this account everywhere. **How:** (a) `app.mfa_needs_aal2` becomes `p_role = 'admin' or
     (p_role = 'owner' and <#79's owner rule>)`, so `admin` is gated in `off`, `enrolled` and `required`; since `admin` is only the
     platform admin account (point 2, §2.1), this is exactly "aal2 for that account", with no extra lookup per statement; `public.mfa_gate()`
     and `withApi`'s early answer follow because they call the same function (`20261201100100_mfa_self.sql` lines 58–67, 71–83); (b)
     `public.mfa_unenrol_check` refuses removing the account's last verified factor in every mode; (c) `platform_bootstrap_admin` and
     `platform_attach_admin` refuse an account without a verified factor; (d) console mode already needs `aal2` (§2.2 point 4). The kill
     switch `off` then affects owners only; if TOTP itself fails, DigiAlto works through the scripts (secret key), not through a weaker
     sign-in. #79's pgTAP 340 matrix is updated on purpose for its `admin` rows; its owner rows stay as they are (SP4 test 3).
   - *TOTP issuer:* `public.mfa_enrol_check` returns the tenant's name as issuer (`20261201100100_mfa_self.sql` line 196); for `admin` it
     returns "Costì" instead, because one factor serves every tenant (FD34; SP4 test 10).
7. **Disclosure (FD29).** The venue contract and privacy terms state DigiAlto's standing admin access (texts by the legal adviser, FD22).
   In the app, the terms accepted at invitation redeem include that document (SP7 test 7). For tenant #1 the FD1 written agreement is the
   place (precondition of SP13).
8. **Detach (FD33 default).** `public.platform_detach_admin(p_tenant uuid, p_reason_code text)` (service role, run by `scripts/platform-admin.ts
   detach`) deactivates the row (history kept, never deleted), writes `platform_admin.detached` and the tenant's `app_user.deactivated`.
   It is run on the owner's written request or at contract end. The owner has no in-app switch (a switch is V16).

**Why not "log in as the user":** the audit would show the venue user, not DigiAlto; it needs minting sessions for another person's
account (rejected in the project plan §4 for staff sessions); and nobody could tell DigiAlto from the user afterwards.

**Waiters never see costs** is untouched. The platform admin reads what `admin` reads today, which excludes the owner-only data of §2.5
(fixed costs, alerts, allergen confirmation, the owner's dashboard counters).

### 2.5 Today's `admin` versus `owner` (from the code; FD30, FD35)

Method: Grep for `'admin'` and `"admin"` in `supabase/migrations/` and `src/`, for `require_staff_manager`, the `can*` helpers and the nav
model. Almost every check lists `owner` and `admin` together (for example `app.require_staff_manager`, `20261025100200_enrolment.sql`
line 16; `canManageStaff`, `src/lib/staff-auth/staff-view.ts` line 21; `APP_ROLES`, `src/lib/api/with-api.ts` line 10; every `withApi({
roles: [...] })` that names `admin` also names `owner`). The differences are below.

**What `admin` can do and `owner` cannot**

| # | Capability | Where (file:line) | Proposal |
|---|---|---|---|
| A1 | Create an `admin` row through the Data API (the insert policy lets only an `admin` add an `admin`) | `20261021120000_tenancy_baseline.sql` lines 96–103 (line 102), with the column grant at line 83; pinned by `supabase/tests/database/002_cross_tenant.test.sql` lines 53–57 ("an owner cannot create an admin") | **Owner: no.** Nobody in a tenant session gets it any more: the policy becomes `role in ('chef', 'waiter')` (FD35); `admin` rows come only from `platform_attach_admin` (SP4 test 5) |
| A2 | Be the `p_actor` of `set_mfa_enforcement` and of the break-glass `mfa_reset_service_begin/failed` (service-role scripts) | `20261201100200_mfa_admin.sql` lines 53, 88, 118; `scripts/lib/mfa-admin.ts` lines 5–6 | **Owner: no.** These are DigiAlto operations run with the secret key; the actor is the platform admin's row, present in every tenant (§2.1; SP4 test 8) |
| A3 | Be counted by `set_mfa_enforcement('required')`'s precondition, be gated under `required` without a factor, and be refused removing the last factor under `required` (obligations, not powers) | `20261201100200_mfa_admin.sql` lines 57–62; `20261201100000_mfa_gate.sql` lines 45–46; `20261201100100_mfa_self.sql` lines 253–256 | **Owner: not inherited** (#79's "owner optional" stays). For `admin` they become unconditional (FD31, §2.4 point 6) |
| A4 | Its own "Oggi" shortcut list (staff, import, menu, tables, tickets, invoices), different from the owner's | `src/lib/nav/today-actions.ts` lines 59–66 (owner's list lines 46–58) | Not a capability: the owner already reaches each of those routes. No change |

**What `owner` can do and `admin` cannot (so the platform admin does not get it either)**

| Capability | Where (file:line) |
|---|---|
| Read and write fixed costs ("a labour total can reveal a salary") | `20261023110000_cost_settings.sql` lines 22–33 (line 29), policy line 262 |
| Confirm an ingredient's allergens | `20261023100600_allergen_confirm_owner_only.sql` lines 1–2, 12 |
| Read alerts (owner every alert; chef kitchen alerts; "Admin (DigiAlto support) and waiters have no rows"); acknowledge any alert; raise the test alert | `20261022150100_alert.sql` lines 160–173; `20261022150300_alert_ack.sql` lines 27, 57; `src/lib/alerts/alert-view.ts` lines 42–43; `src/app/(owner)/page.tsx` lines 69–71 |
| Remove demo data | `20261105100300_demo_purge.sql` line 205 |
| Owner-only dashboard counters and the owner's dashboard variant | `20261112100600_dashboard_kpis.sql` line 151; `20261108100300_dashboard_summary.sql` line 61; admin's schema `src/server/dashboard/output.ts` line 178 |

**Proposals (FD35 default):** the owner inherits nothing from A1–A4; the owner-only list stays owner-only (SP4 test 5 checks it for the
platform admin). Two clean-ups follow from "the owner is the only venue-level admin": the insert policy no longer lets an owner insert
another `owner` row directly (today it does: the policy allows any role but `admin`, baseline lines 97–103; owners come only from the
invitation flow, SP7), and `begin_demo_data` stops creating a demo `admin` (`20261105100000_demo_data_marker.sql` lines 104–109, 147–149;
`app.demo_state.admin_user` line 23 becomes nullable; the purge reads it at `20261105100300_demo_purge.sql` line 139; the seed creates
that user at `scripts/lib/demo/seed.ts` lines 218–226 with the fixture at `scripts/lib/demo/fixture.ts` lines 12, 419) (SP4 test 6).
`create_staff` and `update_staff` already touch only chef and waiter (`20261025100600_staff_management.sql` lines 52, 95, 105), so the
owner cannot rename or deactivate the DigiAlto row in the app.

### 2.6 What happens to the first set's support-access design (ADR-037)

| First-set item | Now |
|---|---|
| SP4 "Support access grants": `support_grant`, `platform_request_support`, `approve_support_grant`, `revoke_support_grant`, owner consent on `/impostazioni/assistenza`, banner, `app.support_max_minutes()` (FD8) | **Dropped** (FD29). SP4 is re-planned as the platform admin membership (§10a) |
| `app_user.kind = 'support'`, `support_grant_id`, the grant check in the membership helpers | **Dropped**; the helpers keep #79's form (§2.4 point 3) |
| `support-grant-expiry` cron and `app.support_end_sessions` (the second `auth.*` writer) | **Dropped**; pgTAP 341's allowlist stays #79's single function (SP3 test 12, SP4 test 8) |
| Read-only support scope and the write gate's `support_read_only` | **Dropped**; the write gate raises `tenant_read_only` only (§3.1); the platform admin writes like any `admin` |
| `audit_event.created_by_staff`, `p_actor_staff`, `--staff` (FD26) | **Dropped**: the DigiAlto `admin` row is the actor and the `created_by` (§2.1) |
| `app.session_tenant` with mode `support` | **Kept** without a mode column; console mode moves to `platform.console_session` (§2.2 point 1) |
| Platform schema, `platform_staff` role, console host, platform audit, metadata whitelist | **Kept** |
| Separate console logins (FD25) and the V15 one-login exemption | **Dropped**: one account, two modes (§2.2 point 1) |
| V3 (support write scope), V11 (admin approves support), V14 (convert legacy rows to grants) | **Withdrawn** (§10b) |

---

## 3. Tenant lifecycle

### 3.1 States (ADR-039)

`tenant_status_event (tenant_id, status, reason_code, effective_at, created_by_staff, created_by_user)`, append-only; the current
status is the newest row with `effective_at <= now()` (derived, never stored on `tenant`, in the spirit of ADR-002).

| Status | Who sets it | Reads | Writes | Notes |
|---|---|---|---|---|
| `provisioning` | provisioning procedure | owner and the platform admin (wizard) | wizard settings only | ends at "finish" |
| `trial` | wizard finish | all | all (within plan) | trial end date in the subscription event (length: FD6) |
| `active` | platform admin | all | all | |
| `suspended` | platform admin (non-payment, abuse, trial end) | all | **refused** (423 `tenant_read_only`) except the exempt list | effective at the tenant's next business-day cut-off (`app.business_day_cutoff`), never mid-service (SP6 test 4) |
| `cancelled` | platform admin, on the owner's request or at contract end | owner, admin | refused | export allowed; erasure only under FD12's conditions (§6.2), never before the retention period (FD13) has passed |
| `erased` | `platform.erase_tenant` only | none | none | the tenant row is gone; a tombstone stays in `platform.audit_event` (id only) |

**Write gate in Postgres.** `app.require_writable()` raises `tenant_read_only` when the tenant's status refuses writes. It is called by
every write path: the `app.require_*` role helpers used by the definer procedures, and the write policies that still exist for
`authenticated` (e.g. `app_user_insert`, baseline lines 97–103). A pgTAP catalogue test (SP6 test 1) scans `pg_proc` for every `public`
function executable by `authenticated` that is not `stable`/`immutable` and fails unless its body calls `app.require_writable()` or a role
helper that does, or it is on a named exempt list (logout, the #79 MFA exempt functions, `select_tenant`, `record_platform_access`,
`redeem_tenant_invitation`, the export request). #79 uses the same technique (its pgTAP 341 scans `pg_proc` source).

**Offline queue (ADR-022).** A sync op refused by the gate returns the per-op result `tenant_read_only`; it is kept on the phone and
shown, like a `409/422` today (SP6 test 5). Because suspension waits for the cut-off, a service in progress is never cut.

### 3.2 Create and provision (invitation only, FD5 decided)

There is **no public sign-up**: no sign-up page or route, and Supabase Auth's own sign-up stays off (`[auth] enable_signup = false`,
`supabase/config.toml` line 180; go-live item M-5, `docs/go-live/phase1-closeout.md` line 341). A new tenant exists only because the
platform admin created it:

1. **Tenant, DigiAlto membership and invitation (console, no secret key).** The platform admin calls `public.platform_create_tenant(...)`
   (organisation, name, venue type, plan, owner e-mail) → tenant with status `provisioning`, the platform admin's `admin` row through
   `platform_attach_admin` (§2.4 point 2: one `platform_admin.attached` platform audit row and one tenant audit row), and one
   `tenant_invitation (id, tenant_id, email, auth_id null, expires_at, redeemed_at, created_by_staff)` row (tenant data: `tenant_id` and
   RLS, no grant to `anon` or `authenticated`), plus one platform audit row for the creation.
2. **The owner's login (script, secret key in `scripts/` only).** The platform admin runs `scripts/tenant-invite.ts --invitation <id>`.
   It creates the owner's confirmed auth user for the invitation's e-mail as `scripts/lib/create-tenant.ts` does (lines 75–79), or reuses
   the existing auth user with that e-mail (an owner adding a second venue, SP2), binds the auth user to the invitation through the
   service-role-only `public.bind_tenant_invitation(p_invitation, p_auth_id)`, and writes one platform audit row. It refuses the platform
   admin account as an invitee (FD30: that account holds `admin` rows only).
3. **First sign-in and redeem.** The owner signs in with the existing e-mail code (M25a); `/api/me` reports the pending invitation and
   the app opens `/benvenuto`, where the owner accepts the terms (including the DigiAlto-access disclosure, §2.4 point 7) and calls
   `public.redeem_tenant_invitation(p_invitation)`: it checks that the invitation is bound to the caller's auth id, unexpired and
   unredeemed, then creates the owner `app_user` row and the `terms_acceptance` rows in one transaction. The owner sets a password on the
   existing `/password` page (M25a).

The secret key stays where `CLAUDE.md` rule 2 allows it (`scripts/`); the browser and every user-facing route use the publishable key
and the user's session only. Open sign-up is V6, parked by FD5.
- `scripts/create-tenant.ts` stays for DigiAlto's own use and tests (IT VAT check kept for Italy, FD19); after SP4 it also attaches the
  platform admin when one exists.

### 3.3 Onboarding wizard (SP7)

`/benvenuto` steps, each saved through the existing settings procedures (the only new write path is `redeem_tenant_invitation`): terms
and redeem (§3.2) → venue type preset (§5.2; **restaurant only until SP8**, FD14) → legal and venue data (name, VAT, time zone default
`Europe/Rome`) → service periods (ADR-031) and business-day cut-off → tables (the service-mode step and counter mode arrive with SP8,
§5.3) → coperto (optional) → modules within the plan → staff and devices (M11 flows) → optional demo data (ADR-018) → finish (status
`trial`, or `active` when the platform admin created the tenant as active). The preset only pre-fills; every value stays editable.

### 3.4 Multi-venue / groups (ADR-038)

- **Venue = tenant.** A group with three venues has three tenants. RLS stays per tenant; nothing in the tenant data model spans tenants.
- **Organisation** (`platform.organisation`): the customer company that owns one or more tenants and holds the subscription. An
  organisation owner gets an `owner` membership in each of its tenants (created when a tenant is added), not a cross-tenant role.
- **One login, many tenants:** `app_user` uniqueness becomes `(tenant_id, auth_id)`; the active tenant of a session is stored in
  `app.session_tenant (session_id pk, auth_id, tenant_id, selected_at)` and read by the hook through the `session_id` claim (a required
  claim, source S1; that it is in the hook's input on every authentication method is spike T1). `POST /api/me/tenant {tenantId}` →
  `public.select_tenant(id)` (member only) → the server refreshes the session → new claims. Two phones of the same owner can be in two
  venues at once. The platform admin account is the user with the most memberships (one per tenant) and uses the same mechanism (§2.4
  point 3).
- **`tenant.vat_number unique`** (baseline line 17) is dropped: two venues of one company share a VAT number. The VAT number moves to the
  organisation as the legal entity; the tenant keeps a copy for the extraction "buyer is not the supplier" check
  (`src/server/cron/extract-job.ts` lines 136–141).
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
- **Tenant data outside `public` needs the same coverage.** `app.entitlement_observation` (SP5) and `app.session_tenant` (SP2) carry
  `tenant_id` but live in schema `app`. pgTAP 001 checks `public` only (`supabase/tests/database/001_rls_every_table.test.sql` lines 8, 16,
  23), so SP5 adds a catalogue test over the non-`public` schemas: every table with a `tenant_id` column is in a named list, has RLS on, a
  non-null `tenant_id` and no privilege for `anon` or `authenticated` (SP5 test 8). The `platform` catalogue tables without `tenant_id`
  (including `platform.console_session`) are listed by name in SP3 (ADR-037).

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
| `orders.counter` (new, SP8; built when the first bar or coffee shop signs, FD14) | counter sales, quick orders, tabs | Tier 2 | bars and coffee shops |
| `multi_venue` (new, SP2) | tenant switcher, organisation | organisation-level (group tier) | |
| `demo_data` | demo week (ADR-018) | trial only | |
| Phase 2 candidates (labels C2, traceability C3, HACCP C4, accountant C10, e-mail-in C11, forecast C6, menu engineering C7) | — | decided when each ships | |
| `release:<name>` (kind `release`) | staged rollout of a new behaviour | not sold; set by DigiAlto | §6.5 |

---

## 5. Venue types and per-tenant configuration

**Restaurants first (FD14, decided 2026-11-13).** The bar and coffee-shop columns of §5.1, the counter design of §5.3 and their presets
are built in SP8, which is scheduled when the first bar or coffee shop signs. Until then every new tenant is a restaurant, and the
restaurant assumptions H16–H19 and H24 stay as they are.

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
| Service periods, cut-off | per tenant (ADR-031, settings) | unchanged; presets per venue type in the wizard | SP7 (restaurant preset); SP8 (bar and coffee-shop presets, FD14) |
| Service mode | tables only | `tenant.service_mode`: `tables` \| `counter` \| `both` | SP8 |
| VAT rates and coperto | one global `immutable` list for sales **and** supplier invoices (H14, H15); coperto per tenant | **Two lists (default, founder may revisit; §0a).** (1) **Statutory list**: `app.allowed_vat_rates()` stays `immutable` and global (Italy, FD19). It keeps checking supplier-invoice lines (`app.line_checks`, `review_helpers.sql` line 67; TS mirror `src/server/extraction/constants.ts` line 48) and stays the outer bound in the three sale-side CHECK constraints (`menu_tables_core.sql` lines 55, 91, 117), which therefore remain table-free. (2) **Sale list per tenant**: `tenant_vat_rate (tenant_id, rate, is_active)`, every rate inside the statutory list, seeded with today's list; read by a `stable` `app.sale_vat_rates(tenant)`. A CHECK never reads a table, so the per-tenant check lives in **procedures** (`menu_procedures.sql` line 63, `dining_tables_coperto.sql` line 220), the default (`menu_tables_helpers.sql` line 121), the read payloads (`menu_reads.sql` line 57, `dining_tables_coperto.sql` line 177) and a `before insert or update` **trigger** `app.check_sale_vat_rate()` on `menu_item_price` and `sale_settings`. `table_session.coperto_vat_rate` is a snapshot of `sale_settings` taken at opening and keeps only the statutory CHECK. Coperto unchanged | SP1 |
| Fiscal / receipt flow | `scontrino`/`fattura`, payment codes global (H20) | per-tenant lists seeded with today's values; Italy only (FD19); no register integration | SP1 |
| Units | enums (H24) | base units unchanged; a display conversion for drink measures only if a bar needs it | SP8 |
| Languages | `it` default, `en` second (H12) | `tenant.default_locale` in (`it`, `en`) | SP1 |
| Time zone | SQL per tenant, TS fixed (H9, H10) | TS reads the tenant time zone from `/api/me` | SP1 |
| Venue name in the UI | the `venue.name` catalogue string after QW13 (§5.5) | the tenant's name from `/api/me` | SP9 |
| Theme | brand tokens of tenant #1 in code (H29–H31) | `tenant_theme (tenant_id, colours jsonb, logo_path)` validated against the existing contrast tests; tenant #1 seeded with today's tokens | SP9 |
| Booking | per tenant (ADR-032) | unchanged; slug moves to tenant level | SP12 |

### 5.3 Counter service, quick orders and tabs (SP8, scheduled when the first bar or coffee shop signs, FD14; design sketch; its own plan and ADR at /feature time)

- `table_session` gains `kind` (`table` \| `counter` \| `tab`); `dining_table_id` and `covers` become nullable **only** for
  `counter`/`tab` (check constraint keyed on `kind`; H18, H19). Every existing row is `table`; every existing check is kept for `table`.
- `public.quick_sale(p_id uuid, p_lines jsonb, p_payment text, p_receipt jsonb)`: open + add lines + fire + close in **one transaction**,
  reusing the internals of `add_order_line`, `fire_course` and `close_table`; client-generated id, so the offline op is replay-safe
  (ADR-022).
- **Tabs:** a `tab` session with a short label (a number or a few characters). No customer personal data outside reservations (project
  plan §3.11.8): the field hint says "no names" and the length is capped (SP8 test 6). Names on tabs are only under V13.
- Kitchen tickets only for lines whose menu item routes to the kitchen.
- The wizard gains the service-mode step and the bar and coffee-shop presets (SP8 tests 8–9).

### 5.4 Hard-coded osteria and single-venue assumptions (40 found)

Method: Grep over `src/`, `supabase/migrations/`, `scripts/`, `public/`, `supabase/seed.sql` for literal names (`osteria`, `Dei Rossi`),
`coperto`, course names, `Europe/Rome`, `EUR`, `it-IT`, `^IT[0-9]`, VAT lists, `pranzo`/`cena`, `scontrino`, `unique` on
`auth_id`/`vat_number`, unit enums, cron schedules, Sentry calls, i18n keys. Comments that only *mention* Europe/Rome are not counted where
the code reads the tenant's zone (SQL does: e.g. `20261026100600_stock_reads.sql` line 67, `20261028100200_batch_core.sql` line 276).

| # | File:line | Assumption | Fix (milestone) |
|---|---|---|---|
| H1 | `supabase/migrations/20261021120000_tenancy_baseline.sql:17` | `tenant.vat_number` must match `^IT[0-9]{11}$` **and is unique**: Italian only; two venues of one company cannot both be tenants | drop unique, move to organisation (SP2); IT check kept (FD19) |
| H2 | same file `:18` | `timezone` default `Europe/Rome` | keep as default; set in wizard (SP7) |
| H3 | same file `:19` | `currency` check `= 'EUR'` | keep (FD19); documented as a country limit |
| H4 | same file `:9` | `app_role` enum fixed to four roles | unchanged (FD17 decided: no extra roles); add values only via V8/V9 |
| H5 | same file `:31` | `app_user.auth_id ... unique`: one login = one tenant | `(tenant_id, auth_id)` unique (SP2) |
| H6 | same file `:117–121`; `20261025100500_access_token_hook_pin.sql:97–101` | the hook picks the single active membership | session-tenant selection (SP2) |
| H7 | same file `:96–103` | "Only an admin (DigiAlto) can create another admin": tenant `admin` = DigiAlto | `admin` kept as DigiAlto's role, tied to the one platform admin account; the policy refuses `admin` (and `owner`) inserts from tenant sessions (SP3, SP4; FD30, FD35) |
| H8 | `scripts/lib/create-tenant.ts:13` | provisioning by script only, IT VAT | console invitation plus `scripts/tenant-invite.ts`; Auth sign-up stays off (SP7, FD5) |
| H9 | `src/lib/time/format.ts:3` (used by `src/lib/time/venue-date.ts:1–4, 16–17`, `src/lib/tables/table-view.ts`, `src/lib/rules/rules-view.ts`, `src/lib/csv/write.ts`) | `VENUE_TIME_ZONE = "Europe/Rome"` for all display and CSV | tenant time zone from `/api/me` (SP1) |
| H10 | `src/lib/reservations/public-view.ts:44`; `src/server/reservations/mail/render.ts:41` | literal `timeZone: "Europe/Rome"` on the public page and in e-mails | tenant zone from the page/mail payload (SP1) |
| H11 | `src/lib/money/format.ts:10` | `currency: "EUR"` | keep (FD19); read from tenant for safety (SP1) |
| H12 | `src/lib/i18n/locale.ts:1–6` | two locales, `it` default | `tenant.default_locale` (SP1) |
| H13 | `src/app/layout.tsx:88`; `src/app/global-error.tsx:16`; `src/app/manifest.ts:9` | `lang="it"` fixed | from tenant locale (SP1) |
| H14 | `supabase/migrations/20261022130200_review_helpers.sql:10–13` | `app.allowed_vat_rates()` = `[0,4,5,10,22]`, `immutable`, one list for every tenant and for both sides. **Sale side:** CHECK constraints `20261031100000_menu_tables_core.sql:55` (menu price), `:91` (coperto setting), `:117` (session snapshot); procedures `20261031100200_menu_procedures.sql:63`, `20261031100400_dining_tables_coperto.sql:220`; default rate `20261031100100_menu_tables_helpers.sql:121`; read payloads `20261031100300_menu_reads.sql:57`, `20261031100400_dining_tables_coperto.sql:177`. **Purchase side:** `app.line_checks` `review_helpers.sql:67` (supplier-invoice line flag `vat_rate_unexpected`) and its privilege revoke `:238` | statutory list kept for purchases and as the CHECK bound; per-tenant sale list in procedures and triggers, never in a CHECK (SP1, §5.2; two-list design: default, founder may revisit) |
| H15 | `src/server/menu/constants.ts:12`; `src/server/extraction/constants.ts:48` | TS mirrors of the VAT list | sale side (`menu/constants.ts`) read from the tenant settings payload; purchase side (`extraction/constants.ts`) stays the statutory mirror, parity-tested with the SQL (`tests/parity/review-sql-parity.test.ts`) (SP1) |
| H16 | `supabase/migrations/20261031100000_menu_tables_core.sql:17`; `src/server/menu/constants.ts:14`; `20261111100100_kitchen_event_helpers.sql:52`; `20261031100300_menu_reads.sql:58` | courses = enum `antipasti, primi, secondi, dolci, bevande` | `tenant_course` (SP8) |
| H17 | `src/lib/menu/menu-form.ts:63`; `src/lib/sync/overlay.ts:67` | default course `"secondi"` | tenant's first course (SP8) |
| H18 | `supabase/migrations/20261031100000_menu_tables_core.sql:108` | `table_session.dining_table_id not null`: every sale has a table | `kind` with nullable table for counter/tab (SP8) |
| H19 | same file `:111` | `covers between 1 and 99`, required | nullable for counter/tab (SP8) |
| H20 | `supabase/migrations/20261110100000_close_core.sql:11–14, 16–19`; TS copies `src/server/bill/constants.ts:5, 9` (kept equal to the SQL by `tests/parity/close-sql-parity.test.ts`) | receipt types `scontrino`, `fattura`; payment codes `cash, card, other` global | per-tenant lists; the TS copies read the tenant payload and the parity test checks the seeded defaults (SP1) |
| H21 | `supabase/migrations/20261120100000_service_core.sql:24` | default services Pranzo 11:00, Cena 16:00 (pinned by pgTAP 286) | keep as the "restaurant" preset; the wizard saves an explicit version for new tenants (SP7) |
| H22 | `supabase/migrations/20261124100000_reservation_core.sql:28–29` | default booking services pranzo/cena times | restaurant preset (SP7); bar and coffee-shop presets (SP8, FD14) |
| H23 | `supabase/migrations/20261025100100_business_day_cutoff.sql:28` | default cut-off 02:00 | keep default; wizard step (SP7) |
| H24 | `supabase/migrations/20261021130000_master_types.sql:4–5`; `20261023100200_recipe_tables.sql:10` | unit enums `kg g l ml pz` (+`porz`), no drink measures | display conversion if needed (SP8) |
| H25 | `supabase/migrations/20261021130000_master_types.sql:48`; `src/lib/vat/it-vat.ts:5`; `src/server/master/import.ts:196` | supplier VAT must be Italian | keep (FD19) |
| H26 | `src/server/extraction/prompt.ts:4, 23` | prompt "an Italian restaurant's purchasing assistant", Italian instruction | venue-neutral wording, still Italian invoices (SP1) |
| H27 | `supabase/migrations/20261022120200_cron_extract.sql:69–71`; `docs/go-live/rate-limits.md:36` | one global extraction job, one invoice per call: no per-tenant fairness | fair claim (SP11) |
| H28 | `src/server/extraction/extract.ts:78–79, 93–94` | token usage only logged, not stored per tenant | `tenant_usage_event` (SP11) |
| H29 | `src/lib/i18n/messages/it.ts:2, 74`; `src/lib/i18n/messages/en.ts:4, 75` | `app.name` and home link = "Osteria Dei Rossi": product name and venue name are one string | QW13 splits them (`app.name` = "Costì", new `venue.name`; §5.5); tenant name from `/api/me` (SP9) |
| H30 | `src/app/manifest.ts:7–14` | manifest name and colours of tenant #1 | QW13 sets the name to "Costì" (colours unchanged); per-host manifest (SP9) |
| H31 | `src/lib/design/tokens.ts:44–53`; `src/app/globals.css:4`; `src/components/brand.tsx:4–24`; `src/app/layout.tsx:17–31` (the brand fonts Bodoni Moda and Figtree via `next/font/local`) | brand colours, fonts, mark of tenant #1 | `tenant_theme` (SP9) |
| H32 | `src/lib/auth/password-policy.ts:14–16` | refused password words are tenant #1's name | derive from the tenant's name (SP1) |
| H33 | `src/pwa/outbox.ts:247, 250`; `src/pwa/lease.ts:9`; `src/lib/api/offline-cache.ts:8`; also the cosmetic name misses `public/sw.js:2` (header comment "Osteria Dei Rossi - service worker") and the backup file names `osteria-backup-` / `osteria-files-` (`scripts/lib/backup/commands.ts:298–330`, `scripts/lib/backup/files-manifest.ts:30`) | IndexedDB/lock names `osteria-sync` and other product-wide names carrying "osteria"; read cache keyed by path, not tenant | names: cosmetic, left (a rename must migrate queued ops, and the backup names are matched by the rotation predicates; QW13 does not touch them); `forgetUser()` on switch (SP2); per-tenant pack names are SP10's change (H35) |
| H34 | `src/lib/observability/report.ts:5` | Sentry events carry no tenant tag | tag with tenant id (SP11) |
| H35 | `scripts/lib/backup/commands.ts:298–330` (database copy name `:298–302`; pack and manifest names with no tenant part `:313–330`); ADR-034 (shared file packs) | backups are whole-database and shared packs: no per-tenant restore or erasure | per-tenant packs, tenant extract (SP10) |
| H36 | `supabase/seed.sql:3`; `scripts/lib/demo/fixture.ts:1, 187` | demo = "one invented osteria week", VAT 10% fixed | restaurant demo set (SP7); bar and coffee-shop demo sets (SP8, FD14) |
| H37 | `supabase/migrations/20261124100200_reservation_settings.sql:22–37` | `audit_event` entity/action checks have no platform-admin or lifecycle actions | extended by the union rule (SP4, SP6) |
| H38 | `supabase/migrations/20261124100000_reservation_core.sql:86` | public slug lives in reservation settings, so a slug exists only with reservations | tenant-level slug (SP12) |
| H39 | `src/lib/i18n/messages/it.ts`: **130** of its 2,610 message keys have `table`, `covers` or `coperto` in the key name, case-insensitive (117 case-sensitive). Command, from the repo root: `rg -c -i '^\s*"[^"]*(table\|covers\|coperto)[^"]*"\s*:' src/lib/i18n/messages/it.ts` (drop `-i` for 117; `rg -c '^\s*"[^"]*"\s*:'` gives 2,610) | restaurant vocabulary throughout | terminology whitelist (SP9), counter screens (SP8) |
| H40 | `src/lib/i18n/messages/it.ts:2130, 2166` | "registratore (di cassa)" wording for the fiscal register | terminology whitelist (SP9) |

### 5.5 Product name "Costì" and venue name (FD27; placement FD34 default; QW13)

**Placement.** The rule: where the **product** speaks (installing, signing in, the browser tab, account e-mails, the console), the name is
**Costì**; where the **venue** speaks to its staff or its guests (the app's header band and Home, the booking page, guest e-mails), the
name is the **venue's**. The venue's name in the UI is tenant #1's approved trading name until SP9 reads the tenant's name from `/api/me`.

| Surface | Today (file:line) | Shows (FD34 default) | When |
|---|---|---|---|
| PWA manifest `name`, `short_name` | `src/app/manifest.ts:7–8` "Osteria Dei Rossi" | **Costì** | QW13 (colours `:13–14` unchanged) |
| Document `<title>` | `src/app/layout.tsx:68` `t("app.name")` | **Costì** (value of `app.name`) | QW13 |
| Header band wordmark (every page, root layout `src/app/layout.tsx:92–96` → `BrandLink`, `src/components/brand.tsx:30–43`, text at `:39`) | `t("app.name")` | the **venue's** name (new key `venue.name`) | QW13 (key swap); SP9 (from `/api/me`) |
| Header link accessible name `brand.homeLink` | `it.ts:74`, `en.ts:75` "Osteria Dei Rossi, Home" | the **venue's** name, unchanged (matches the visible wordmark) | — |
| Home heading (loading and problem states) | `src/app/(owner)/page.tsx:80, 88` `t("app.name")` | the **venue's** name | QW13 (key swap) |
| Sign-in page `/login` | heading `login.title` "Accedi" (`it.ts:3`, `login-screen.tsx:64–66`), intro `login.intro` (`it.ts:4`, `en.ts:6`, `login-screen.tsx:67`) | **Costì** in the intro line; heading "Accedi" unchanged | QW13 |
| PIN and device pages `/pin`, `/dispositivo` | `pin.title` `it.ts:1478`, `pin.notEnrolled` `:1480` (`pin-flow.tsx:102, 138`); `enrol.title` `:1494` (`enrol-form.tsx:47`); header band | the **venue's** name (header band): a staff device belongs to one venue; no string change | — |
| Sign-in e-mail (magic link and code) | subject `supabase/config.toml:257`; template `supabase/templates/magic-link.html:6` (title), `:10` (wordmark); sender display name: the hosted project's SMTP settings (dashboard; the local `[auth.email.smtp]` block `config.toml:245–252` is commented) | **Costì**; sender display name "Costì" | QW13 (repo files); founder (hosted template, subject and sender name) |
| Reservation e-mails to guests | subjects `it.ts:2690, 2695, 2698`, footer `:2710` (en `:2661, 2665, 2669, 2680`) with `{venue}` from the database (`src/server/reservations/mail/render.ts:55, 75, 79`); sender `MAIL_FROM` (Vercel env, `src/lib/env/index.ts:226`; `docs/runbook.md:57`) | the **venue's** name, unchanged; `MAIL_FROM`'s display name: the venue's (env value, set by the founder) | — ; a per-tenant sender display name is SP9 |
| Public booking page `/prenota/[slug]` | heading `page.venueName` (`request-form.tsx:199, 226`); header band | the **venue's** name (QW13 keeps the band on the venue) | — |
| TOTP issuer shown in the authenticator app | tenant name (`20261201100100_mfa_self.sql:196`) | owner: the venue's name (unchanged); platform admin account: **Costì** | SP4 (test 10) |
| Platform console | not built | **Costì** ("Costì · Console") | SP3 |
| Internal names (`public/sw.js:2`, `osteria-sync`, backup names) | H33 | unchanged (cosmetic; renames would migrate queued ops and backups) | — |
| Comments naming tenant #1's house style (`src/lib/design/tokens.ts:1, 40`; `src/app/globals.css:4`; `src/components/brand.tsx:4`; `src/components/ui.tsx:13`) | describe tenant #1's theme | unchanged (still true: the theme is the venue's) | — |

**QW13 — "Rename to Costì" (strings only; proposed for the UX quick-wins staff PR; the lead approves).** No logo, no colours, no layout.

| # | File:line | Change |
|---|---|---|
| 1 | `src/lib/i18n/messages/it.ts:2`; `src/lib/i18n/messages/en.ts:4` | `"app.name": "Osteria Dei Rossi"` → `"app.name": "Costì"` |
| 2 | `src/lib/i18n/messages/it.ts`, `en.ts` (next to `app.name`) | new key `"venue.name": "Osteria Dei Rossi"` (tenant #1's approved trading name, `docs/client-facts.md` line 12; replaced by the tenant's name from `/api/me` in SP9) |
| 3 | `src/components/brand.tsx:39` | `t("app.name")` → `t("venue.name")` (the header wordmark stays the venue's) |
| 4 | `src/app/(owner)/page.tsx:80, 88` | `t("app.name")` → `t("venue.name")` |
| 5 | `src/app/manifest.ts:7–8` | `name` and `short_name` → `"Costì"` |
| 6 | `src/lib/i18n/messages/it.ts:4` | `"Entra con la tua email e la password."` → `"Entra in Costì con la tua email e la password."` |
| 7 | `src/lib/i18n/messages/en.ts:6` | `"Sign in with your email and password."` → `"Sign in to Costì with your email and password."` |
| 8 | `supabase/config.toml:257` | subject → `"Il tuo accesso a Costì"` |
| 9 | `supabase/templates/magic-link.html:6, 10` | `<title>Il tuo accesso a Costì</title>`; wordmark `<strong>Costì</strong>` (inline styles untouched) |
| — | stay the venue's name | `brand.homeLink` (`it.ts:74`, `en.ts:75`); `login.title` "Accedi"; PIN and device strings; reservation e-mail subjects and footer; `/prenota` heading; comments and internal names above |

`src/app/layout.tsx:68` needs no edit: `<title>` follows `app.name`.

**QW13 tests.**
- `tests/app/manifest.test.ts` lines 9–12 updated on purpose: `name` and `short_name` are "Costì"; the language, display, colour and
  no-icons cases (lines 14–28) pass unchanged.
- New unit test: `t("app.name")` is "Costì" and `t("venue.name")` is "Osteria Dei Rossi" in both locales.
- New source test (TypeScript scanner, string-literal tokens only, as SP1 test 3): no `"Osteria Dei Rossi"` literal in `src/` outside the
  `venue.name` and `brand.homeLink` catalogue entries.
- Component test: `BrandLink` renders the wordmark "Osteria Dei Rossi" with the accessible name "Osteria Dei Rossi, Home"; the existing
  `e2e/app-shell.spec.ts` lines 28, 38, 48 pass unchanged.
- Playwright: `/login` has the document title "Costì" (`toHaveTitle`), its intro contains "Costì", and its heading is still "Accedi"
  (`e2e/smoke.spec.ts` line 21, `e2e/password-login.spec.ts` line 61 unchanged).
- Config test: the `[auth.email.template.magic_link]` subject in `supabase/config.toml` and `supabase/templates/magic-link.html` contain
  "Costì" and not "Osteria Dei Rossi".
- The full Vitest and Playwright suites pass. Note: the nav label "Costi" (`it.ts:1469`, costs) differs from "Costì" by one accent; the
  nav tests match it with `exact: true` (`e2e/costs.spec.ts` lines 158, 335, 454), so they do not collide (§11 notes the reading risk).

**Before QW13 ships:** the product name is recorded in DigiAlto-Ops and `docs/client-facts.md` (open item for the lead), and the founder
updates the hosted Supabase Auth e-mail template, subject and SMTP sender display name (the repo's `config.toml` and template apply to
the local stack; QW13's PR description lists this step).

---

## 6. Data and operations

### 6.1 DigiAlto as processor for many controllers

- **Roles (to confirm with a legal adviser; no legal claim here):** each venue is the controller of its operational data (staff
  names, supplier data that may concern natural persons, reservation contacts); DigiAlto processes it on the venue's behalf. For its
  own customer relationship (organisation account, billing contact, invitation e-mails, the platform admin account) DigiAlto is the
  controller. GDPR Art. 28 (processor contracts) is the frame the adviser works from; its text was **not** re-read in this session
  (gdpr-info.eu unreachable), so this plan states no obligation from it. Tenant #1 included: FD1 makes Osteria Dei Rossi a customer of
  DigiAlto, even though both have the same owner (§0a note 2).
- **DigiAlto's standing admin access (FD29)** is disclosed in the venue contract and privacy terms, with what the access covers (the
  `admin` capabilities of §2.5), how it is recorded (§2.4 point 4) and how the owner sees it (§2.4 point 5). Texts by the legal adviser
  (FD22).
- **One DPA template** for all tenants, with the sub-processor list kept in one place (a document created when FD22 is answered, not by
  this plan). Current list from the project plan §3.11.8 and checklist DPA-1: Supabase, Vercel, Anthropic (invoice content), Resend
  (auth and reservation e-mails), Sentry (errors, PII scrubbed), GitHub (CI, backups workflow), Google (Drive backups). Any provider
  added later joins the list before use. Data location and retention at each provider: project Q13, still open.
- **Change notice:** adding a sub-processor is a platform change announced to every tenant before use; the console keeps the list's
  version and the date each tenant was notified (`platform.notice`; SP3 test 9).

### 6.2 Export, erasure, backups and restore (ADR-040)

- **Export (always available, any status but `erased`).** The owner requests a full export in the app (`POST /api/exports/full`,
  owner only, exempt from the write gate) → `export_request` row → the platform admin runs `scripts/tenant-export.ts --request <id>`
  (database URL and secret key, `scripts/` only) → one encrypted ZIP: one CSV per tenant table (same CSV writer and formula escaping as
  M24) + the tenant's invoice files + a manifest with checksums → uploaded to a private `exports` bucket at `<tenant_id>/...` → the owner
  downloads it through a signed URL (the `SIGNED_URL_TTL_SECONDS` pattern). Automating the script run comes later, if volume needs it.
- **Erasure (cancelled tenants only; FD12 decided 2026-11-13: yes, with safeguards).** `platform.erase_tenant(p_tenant,
  p_request_event, p_approval_event)` (service role only), run by `scripts/tenant-erase.ts`. It erases only when **all** of FD12's
  conditions hold, and refuses with a P0001 code per missing condition, deleting nothing:
  1. **After cancellation, plus the retention period.** Status `cancelled`, and `app.erasure_retention_days()` days have passed since the
     cancellation's `effective_at`. The period is FD13, set with a legal adviser; **until it is set the function returns null and nothing
     is erased** (`retention_not_set`, for every tenant whatever the dates). Setting it is a migration made after the legal advice.
  2. **The owner's recorded written request.** The platform admin records it with `public.platform_record_erasure_request(p_tenant,
     p_document_ref)`, which writes `erasure.owner_request_recorded` to `platform.audit_event`. The written request itself is kept in
     DigiAlto's records outside the database; `p_document_ref` is a short reference code (length-capped, no personal data).
  3. **A platform-admin approval, audited.** `public.platform_approve_erasure(p_tenant, p_request_event)` (active `platform_admin`,
     `aal2`) writes `erasure.approved` to `platform.audit_event`.

  Both events must name the tenant and be later than the cancellation. A further plan safeguard (default, founder may revisit): an
  export was delivered or the owner's waiver is recorded. With one platform admin (FD28), and at tenant #1 where the owner is also
  DigiAlto's owner (FD1), steps 2 and 3 can be done by the same person; both events are still recorded separately. When all hold, the
  function sets `tenant.erasure_since` (the ADR-018 marker pattern), deletes every row of that tenant in foreign-key order (reusing
  `app.demo_purge_tables()` plus master data, users and the tenant row), and writes a tombstone to `platform.audit_event`. The script
  then deletes the tenant's Storage objects and its backup file packs, and deletes auth users that have no other membership (never the
  platform admin account, which has other memberships and a `platform.staff` row).
  **This is a second sanctioned exception to "ledgers are append-only"**, of the same shape as ADR-018: whole-tenant only, only
  through that function, only with the marker set; UPDATE and TRUNCATE stay refused; within a live tenant nothing changes. The founder
  approved the `CLAUDE.md` rule 6 amendment as ADR-040 describes (FD12); the edit to `CLAUDE.md` is made in **SP10's PR**, together with
  the code it describes, and not before (SP10 test 7).
- **Backups.** Whole-database copies stay (ADR-034): Supabase restores only whole projects, and Storage files are not in database
  backups (source S2). Change: invoice-file packs are written **per tenant** (`<tenant_id>` in the pack name; today's names have no tenant
  part, `scripts/lib/backup/commands.ts` lines 313–330), so erasure can delete exactly one tenant's packs; database copies of an erased
  tenant age out with the 14-copy rotation (Q182), which the DPA must state.
- **Per-tenant restore.** No in-place restore of one tenant into the live database (it would rewrite ledgers and could collide with
  rows written since). Instead `scripts/backup/tenant-extract.ts` restores a chosen copy into a scratch database (the existing
  restore-check path) and produces that tenant's export as of that copy. Disaster recovery stays whole-project.
- **Supabase plan.** Supabase's backup docs list daily backups for Pro, Team and Enterprise only, and advise Free projects to export
  regularly (source S2). Before tenant #2 a paid plan (FD11, default); its price is for the founder to read.

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
  restore check uses it: `RESTORE_CHECK_SQL`, `scripts/lib/backup/commands.ts` lines 260–268, with the per-tenant call at line 265),
  extraction failures and quota state, last activity date, whether the platform admin is attached, and the finding `admin_row_foreign`
  (an active `admin` row that is not the platform admin account's, SP4 test 7).
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
4. **CI fixture with several tenants.** Until SP8 (restaurants first, FD14): two restaurant-shaped tenants, Osteria Demo A with coperto
   and Osteria Demo B without coperto and with a different sale VAT list, plus one fixture platform admin account attached to both (from
   SP4). SP8 adds Bar Demo in counter mode and Caffè Demo with one all-day service. The cross-tenant pgTAP suite runs on all of them.
5. **Tenant #1 golden tests:** bill, KPI, menu and alert payloads for a fixed tenant-#1-shaped fixture (fake data) are pinned and must
   not change unless a plan says so (§8).

### 6.6 Slugs, custom domains, public pages

- **Slug:** `tenant.public_slug` (unique, `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$` as today, reserved words refused: `api`, `console`,
  `www`, `prenota`, `menu`, `login`, …). The migration copies `reservation_settings.public_slug`; `app.reservation_public_tenant(p_slug,
  p_now)` reads the tenant slug and still requires `reservation_settings.enabled` and readiness.
- `/prenota/<slug>` is unchanged for the visitor. No other public page is added in the base plan (a public menu page is V12).
- **Custom domains** are V4. Facts for that decision: a Supabase custom domain replaces the project's *API* URL and allows one domain
  per project (source S4), so it is not a tenant-domain mechanism; Vercel's multi-tenant template gives each tenant a subdomain, says
  that "the proxy handles routing requests to the correct tenant" (it detects the subdomain in `proxy.ts`; the template stores tenant
  data in Redis), and lists a wildcard DNS record for deployment (source S5). Where exactly the template looks up the tenant was not
  read and is not claimed here. Per-tenant custom domains through Vercel's domain API were **not verified** (vercel.com unreachable in
  this session).

---

## 7. Commercial plumbing (options only; no prices, no provider chosen)

| Topic | Options | Recommended default | What the founder must check (never estimated here) |
|---|---|---|---|
| Billing | (a) manual: DigiAlto invoices from its own accounting; the platform admin sets status in the console; (b) a subscription billing provider (e.g. Stripe) (V5); (c) a merchant-of-record provider (e.g. Paddle, Lemon Squeezy) (V5) | (a) for the first tenants (FD4: default, founder may revisit) | each provider's fees, payout terms, data location and retention, DPA, support for Italian B2B invoicing; none of these was read in this session |
| Invoicing DigiAlto → venue | DigiAlto's accountant / invoicing tool; provider-generated invoices (V5) | DigiAlto's accountant | how DigiAlto's invoices to Italian businesses must be issued (accountant) |
| Sign-up | invitation only (base plan, **FD5 decided 2026-11-13**; Supabase Auth sign-up stays off, §3.2); open sign-up with trial (V6, parked) | invitation only | trial length (FD6) |
| Terms | terms of service, DPA with sub-processor list, DigiAlto privacy notice for account data, the DigiAlto-access disclosure (FD29), acceptable use, SLA (if any); for tenant #1 also the FD1 written agreement | drafted by a legal adviser | all texts (FD22, FD1) |
| Acceptance record | `public.terms_acceptance (tenant_id, document_key, version, accepted_by, at)`, append-only, written at invitation redeem and on new versions | built in SP7 | — |

The base plan stores no payment data of any kind.

---

## 8. Migration path for Osteria Dei Rossi (tenant #1, zero disruption)

Under FD1 (decided 2026-11-13) Osteria Dei Rossi is DigiAlto's customer and tenant #1 under a short written agreement; the agreement,
including the DigiAlto-access disclosure (FD29), is in place before SP13 (§10a).

1. **Before anything:** P2-1 TOTP (#79) merged (done); SP0 spike passed. Tenant #1's `mfa_enforcement` stays as the founder set it.
2. **Every SP migration is additive with defaults that reproduce today** (the H-fixes seed the current values: VAT list, receipt and
   payment codes, five courses, brand theme, `Europe/Rome`, `it`). The tenant #1 golden tests (§6.5 rule 5) pass before and after each
   milestone; a milestone that changes a pinned payload must say so in its plan. QW13 changes only the strings of §5.5.
3. **Entitlements in `observe`:** tenant #1 gets plan `legacy-full` (every current feature on, no limits) and `entitlement_mode =
   observe`. `enforce` only after the observation log stays empty for the period of FD23 (SP13).
4. **Status:** a `tenant_status_event` `active` row dated at go-live is inserted for tenant #1; no subscription event (no charge) unless
   the founder decides otherwise.
5. **Organisation:** one organisation holds tenant #1 (legal name and VAT from the tenant's own settings, never from code).
6. **DigiAlto access (FD30; replaces the first set's "legacy rows kept").** Any existing `admin` rows at tenant #1 become, or give way to,
   the platform admin membership, in this order: (a) SP3: the founder bootstraps the platform admin account (§2.4 point 1); it must be a
   different auth user from the owner's login at tenant #1 (§0a note 2). (b) SP4: `scripts/platform-admin.ts migrate-legacy --tenant
   <id>` runs first as a **dry run** that prints only counts and `app_user` ids of the active `admin` rows (no names, no e-mails). With
   `--apply`: if one of them belongs to the platform admin account, it is kept and becomes the membership (display name set to
   "DigiAlto", audited); otherwise `platform_attach_admin` creates it; every other active `admin` row is deactivated (history kept, an
   `app_user.deactivated` audit row created by the DigiAlto row), and one platform audit row records the run. Whether tenant #1 has such
   rows today, and how many, is read by the dry run; this plan does not assume it. (c) The console health finding `admin_row_foreign`
   is empty for tenant #1 afterwards (SP4 test 7).
7. **Sessions:** SP2 changes the hook. Rollout on a day without service: a session without a `session_tenant` row falls back to the
   user's single membership (exactly today's behaviour), so nobody is signed out. Staff PIN sessions keep their own branch of the hook
   unchanged (SP2 tests 2 and 5).
8. **Offline:** no op shape changes until SP8; SP8 keeps old op payloads valid (the seeded course keys equal the old enum values; SP8
   test 5).
9. **Kill switches:** `entitlement_mode = observe`, feature overrides, a `tenant_status_event` `active` row, and #79's `mfa_enforcement =
   off` are all data changes, effective on the next query, without a deploy. Under FD31, `off` no longer removes the second factor from
   the platform admin account; it still removes it for owners.
10. **Second-factor actor:** at tenant #1, as everywhere, the actor of `scripts/mfa-reset.ts` and `scripts/set-mfa-enforcement.ts` is the
    platform admin's `admin` row (the `--actor` default after SP4, SP4 test 8); a deactivated legacy admin row is refused
    (`actor_invalid`), exactly as #79 shipped.

---

## 9. Alternatives considered

- **Database or Supabase project per tenant**: hard isolation; but migrations fan out, cost per venue rises, and platform metadata needs
  cross-project access with secret keys. ADR-003 already rejected it; kept only as **V10** for a customer with a contractual isolation
  requirement (ADR-003's own revisit trigger).
- **Platform console as a separate Supabase project (V1)**: the strongest separation; but the console then needs a secret key of the
  product project to read tenant metadata, which widens the secret-key surface `CLAUDE.md` rule 2 restricts. Rejected as default.
- **Platform staff as ordinary `authenticated` users with a platform claim**: no custom Postgres role; but a missing tenant policy check
  could leak to console sessions, and every policy must exclude them. Rejected as default; it is the fallback **V2** if spike T2 fails.
- **Consented, time-boxed support grants** (the first-set default): DigiAlto enters only after the owner's approval, read-only, with a
  banner. Rejected by the founder (FD29, second set) for standing `admin` with full audit, disclosure and a second factor; the first-set
  design is recorded in §2.6.
- **Separate console logins for DigiAlto people** (first-set FD25) and its one-login exemption (V15): rejected by FD28–FD30: one
  account, two modes.
- **"Log in as user" impersonation**: rejected (§2.4): it hides who acted, needs minting another person's session, and is silent by
  nature.
- **A global `bypassrls` role for DigiAlto**: rejected: contradicts ADR-003 "no global bypass"; the standing access goes through one
  ordinary `admin` row per tenant, under the same policies as any member.
- **A trigger reserving `role = 'admin'` to the platform admin account**: the strongest guarantee; but 148 pgTAP files under
  `supabase/tests/database/` contain the literal `'admin'`, most of them inserting fixture `admin` rows for their own auth users directly
  as the table owner, and the demo seed inserts one; every one would need the single platform admin as its fixture. Rejected for: no
  tenant-session path creates `admin` (policy, SP4 test 5), only `platform_attach_admin` does, and the health finding `admin_row_foreign`
  catches anything else (SP4 test 7). The triggers on `platform.staff` and on the platform admin's own rows (§2.2 point 1) stay.
- **Gating the platform admin's `aal2` by a lookup in `platform.staff` instead of by role**: precise even if a stray `admin` row existed;
  but one more lookup per statement in the hottest helper. Rejected: `admin` is the platform admin's role by construction (FD30), and
  `admin_row_foreign` reports any exception.
- **Feature flags only in the API or UI**: rejected: `CLAUDE.md` requires roles (and here, entitlements) in Postgres; the Data API is
  reachable with the publishable key.
- **Gating module reads in RLS policies**: rejected: it hides a controller's own data from it when a plan lapses and adds a function call
  to every policy; writes and entry points are gated instead (§4.1).
- **Storing the current plan or status on `tenant`**: rejected for an append-only event history (audit: "why was this tenant
  suspended", ADR-002 spirit). Cost: one indexed lookup per check.
- **A per-tenant VAT list inside the existing CHECK constraints**: a CHECK must not read a table (the function would have to stop being
  `immutable`), and supplier invoices need the statutory list anyway. Rejected for two lists (§5.2).
- **Crypto-shredding per-tenant backup keys**: would make the erasure of old database copies immediate; but adds per-tenant key
  management to a founder-run backup job. Rejected for now: per-tenant file packs plus 14-copy rotation (ADR-040).
- **A third-party feature-flag service**: a new provider, a new sub-processor, flags outside Postgres. Rejected.
- **More enum values for courses per venue type**: every new venue would need a migration. Rejected for `tenant_course`.
- **Open sign-up**: spam and abuse surface (a CAPTCHA means a new provider), anonymous tenants holding personal data. Rejected by the
  founder (FD5, 2026-11-13); V6 is parked.
- **Invited owners sign up through Supabase Auth's own sign-up, with our route checking the invitation first** (the earlier SP7 draft):
  no secret key in provisioning; but it needs Auth sign-up switched on, and the publishable key is public, so the Auth API's sign-up
  would be open to anyone whatever our route checks. That is a public sign-up at the Auth level, against FD5 and go-live item M-5.
  Rejected for a platform-admin script (`scripts/tenant-invite.ts`, §3.2) that creates the owner's login with the secret key in
  `scripts/`, as `scripts/create-tenant.ts` does today.
- **A separate table of erasure approvals**: a clear place for the FD12 evidence; but a new platform table, while
  `platform.audit_event` is already append-only, audited and per-tenant. Rejected: the two erasure events are platform audit rows
  (§6.2).
- **QW13 with the product name in the header band too**: one string everywhere; but the header band is every venue screen's identity,
  including the guests' booking page, and FD27 says each venue keeps its own name. Rejected for the split of §5.5 (FD34 default).

---

## 10. Build plan: milestones

Each milestone = one `/feature` run (`feat/sp<NN>-<name>`), with its own plan in `docs/plans/<date>-sp<NN>-<name>.md` holding the
per-commit steps, each with its test. Sizes as in the Phase 2 scope §2.1 (S, M, L). The conventions of the project plan §5a apply: every
endpoint has a role test (pgTAP + API) and a strict-body test; coverage of new code ≥ 80%; fake fixtures only ("Osteria Demo A/B", and
from SP8 "Bar Demo", "Caffè Demo"; VAT `IT00000000000`-style; fake addresses on `example.test` for the fixture platform admin); fake
clock. **Every milestone also passes the tenant #1 golden tests (G, §6.5 rule 5) and the cross-tenant suite on the multi-venue fixture
(X, §6.5 rule 4)**; they are not repeated below. QW13 is not a milestone; it ships with the UX quick-wins PR (§5.5).

| # | Milestone | Size | Depends on | Key test (full list in 10a) |
|---|---|---|---|---|
| SP0 | Spike: hook and role checks on the real stack | S | #79 merged | T1–T5 recorded pass/fail |
| SP1 | Per-tenant configuration (locale, time zone, sale VAT list, receipt/payment codes, prompt, password words) | M | SP0 | a second tenant with other sale VAT rates; supplier-invoice checks unchanged; tenant #1 payloads unchanged |
| SP2 | Memberships: one login many tenants, organisations, tenant switcher (replaces M43) | L | SP0 | one login switches A↔B; data never mixes; PIN path unchanged |
| SP3 | Platform layer: staff (one platform admin), `platform_staff` role, console mode and host, platform audit, notices, platform admin bootstrap | L | SP2 | console sessions read 0 rows of any tenant table; metadata keys only; bootstrap refuses an account without a verified factor |
| SP4 | Platform admin membership in every tenant: attach, DigiAlto audit and filter, `aal2` everywhere, `admin` redefined, tenant #1 legacy rows | M | SP2, SP3 | attach writes the platform audit row; every DigiAlto action visible to the owner under "Solo DigiAlto"; `aal2` in every mode |
| SP5 | Entitlements: features, plans, overrides, observe/enforce | M | SP3 | disabled feature → 403 in the API and P0001 in SQL; observe logs only |
| SP6 | Tenant status and write gate | M | SP5 | suspended → 423 on writes, reads and export work; catalogue test |
| SP7 | Invitation provisioning (invitation only, FD5), onboarding wizard with the restaurant preset, terms acceptance | M | SP1, SP4, SP5, SP6 | console invite → script-created owner login → e-mail-code sign-in → redeem → wizard → trial; platform admin attached; Auth sign-up stays refused |
| SP8 | Venue types: tenant courses, counter sales, quick sale, tabs, bar and coffee-shop presets | L | SP1, SP5, SP7; **scheduled when the first bar or coffee shop signs (FD14)** | `quick_sale` one transaction; counter session without a table; old ops replay |
| SP9 | Terminology, theme and venue name per tenant | M | SP1 | whitelisted terms only; contrast-checked theme; tenant #1 visuals unchanged |
| SP10 | Export, erasure (FD12 safeguards), per-tenant backup packs, tenant extract, the `CLAUDE.md` rule 6 amendment | L | SP6 | full export round-trip; nothing erased while the retention period is unset; erasure leaves 0 rows of that tenant, others intact |
| SP11 | Usage metering, quotas, fair extraction, Sentry tenant tag, console health | M | SP5 | quota reached → held; fairness across two tenants |
| SP12 | Tenant slug registry | S | SP2 | `/prenota/<slug>` unchanged; reserved slugs refused |
| SP13 | Tenant #1 cut-over (organisation, plan, status, enforce) | S | SP4, SP5, SP6; the FD1 written agreement in place | observation log empty; golden tests green after `enforce` |

**Later candidates (not milestones yet, founder 2026-11-13):** "Reserve with Google" (Google Actions Center booking partner) for every
tenant's `/prenota/<slug>`; feasibility is being researched, and it is planned only after that study. The fiscal candidates (C19 SDI
XML invoice intake, and the receipts question OQ-4) live in the Phase 2 scope, `docs/plans/2026-11-11-phase2-scope.md`.

Order note: SP4 no longer needs SP6 (there is no read-only support scope), so the build order is SP0, SP1, SP2, SP3, SP4, SP5, SP6, then
SP7 and SP9–SP13 in the founder's order (FD2). SP8 is not in that sequence: it is scheduled when the first bar or coffee shop signs
(FD14).

### 10a. Milestone specifications

**SP0 — Spike: hook and role checks on the real stack** (S)
- Goal: prove the Supabase behaviours ADR-037 and ADR-038 rely on, and that sign-up stays closed (FD5), before building.
- In: a throwaway branch, the local stack and staging; results in `docs/plans/<date>-sp00-spike.md`.
- Acceptance tests:
  1. **T1** On the local stack and staging, the access token hook's input `claims` carry `session_id` on password sign-in, e-mail-code
     sign-in, magic link and token refresh (recorded by a test hook in a scratch project). Fail → ADR-038 re-planned before SP2.
  2. **T2** A hook that sets `role = 'platform_staff'` yields a token that PostgREST accepts (a `platform_staff`-only function answers;
     a `to authenticated` table answers permission denied or 0 rows); Storage and Realtime behaviour with that role recorded. Fail → V2.
  3. **T3** A server-side session refresh after `select_tenant` returns a token with the new tenant claim within one request, and keeps
     the session's `aal`.
  4. **T4** RLS timing with one vs many synthetic tenants on staging for three heavy reads (dashboard, menu, kitchen tickets), recorded
     with the existing Server-Timing headers; no target number, the result informs SP2's index review.
  5. **T5** (for SP7, FD5) With `[auth] enable_signup = false`, a direct sign-up request to Supabase Auth with the publishable key is
     refused on the local stack and on staging, and a confirmed user created by the admin API (as `scripts/create-tenant.ts` does) signs
     in with the e-mail code (M25a). Fail (sign-up accepted) → the hosted setting is corrected before SP7 (go-live item M-5).

**SP1 — Per-tenant configuration** (M)
- In: `tenant.default_locale`; `tenant_vat_rate` (sale list) with `app.sale_vat_rates(tenant)` and the trigger `app.check_sale_vat_rate()`
  on `menu_item_price` and `sale_settings`; the sale-side procedures, default and read payloads switched to the tenant list; the statutory
  `app.allowed_vat_rates()` kept for supplier invoices and as the CHECK bound (two-list design: default, founder may revisit); per-tenant
  receipt and payment code lists; `/api/me` returns `{timeZone, locale, currency, vatRates}`; H9–H15, H20, H26, H32 fixed; seeds
  reproduce today.
- Acceptance tests:
  1. pgTAP: tenant B with sale list `[10, 22]` refuses a menu price at 4% and a coperto at 4% (the procedures: P0001
     `vat_rate_invalid`; a direct insert as the table owner: the trigger, same code), while tenant A (seeded `[0,4,5,10,22]`) accepts
     both. An invoice line of tenant B at 4% is **not** flagged `vat_rate_unexpected` by `app.line_checks` (statutory list). A rate
     outside the statutory list cannot enter `tenant_vat_rate`. A catalogue query over `pg_constraint` finds no CHECK constraint that
     calls a function which is not `immutable`. An open `table_session` keeps its coperto rate after B removes that rate from its list.
  2. `formatDateTime` with a tenant zone other than Europe/Rome renders that zone; with Europe/Rome the M0 DST cases (2026-10-25,
     2027-03-28) are unchanged.
  3. A source test finds no `"Europe/Rome"` / `'Europe/Rome'` **string literal** in `src/` outside the default constant and tests; it
     matches string-literal tokens only (the TypeScript scanner), so comments that mention Europe/Rome are not matched.
  4. The extraction prompt contains no venue-type word; the M3 recorded-response fixtures still pass; the injection fixture stays data.
  5. The password policy refuses tenant B's own name and no longer refuses "osteria" for tenant B.
  6. G: tenant #1 menu, bill and coperto payloads equal the pinned fixtures; `tests/parity/close-sql-parity.test.ts` and
     `tests/parity/review-sql-parity.test.ts` pass against the seeded defaults.

**SP2 — Memberships and organisations** (L) — ADR-038
- In: `app_user` unique `(tenant_id, auth_id)`, in the **same migration** as the hook change (§2.4 point 3); `app.session_tenant`; hook
  change (both branches, re-pinned); `public.select_tenant`; `POST /api/me/tenant`; `GET /api/me` lists memberships;
  `platform.organisation`, `tenant.organisation_id`; `tenant.vat_number` unique dropped; switcher in the app shell; `forgetUser()` on
  switch.
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
- In: schema `platform`; `platform.staff` with a partial unique index (one active `platform_admin`, FD28), `platform.audit_event`
  (append-only), `platform.notice`, `platform.console_session`; Postgres role `platform_staff`; `public.select_console()` and the hook's
  console mode; `public.platform_*` metadata functions; `(platform)` route group on the console host with the "Costì · Console" strings;
  `src/proxy.ts` host rules; console screens (tenant list, tenant detail, audit); scripts write a platform audit row through a shared
  helper; the staff/member triggers of §2.2 point 1; `scripts/platform-admin.ts bootstrap` with the service-role-only
  `public.platform_bootstrap_admin(p_auth uuid)` (FD28).
- Acceptance tests:
  1. pgTAP: `platform_staff` has no privilege on any `public` table (catalogue query); a select on any tenant table → permission denied.
  2. Triggers: an `app_user` row for a `platform_support` auth user → error; an `owner`, `chef` or `waiter` row for the platform admin's
     auth user → error; a `platform_admin` staff row for an auth user holding a non-`admin` member row (active or inactive) → error; a
     second active `platform_admin` → unique violation.
  3. A console token without `aal2` → every `platform_*` function and `select_console()` raise `mfa_required`.
  4. A tenant owner calling `platform_tenants()` → 42501.
  5. pgTAP: the keys returned by every `platform_*` function match a whitelist; any key matching cost, price, person-name, e-mail or
     business-record patterns fails the test.
  6. Proxy: `(platform)` paths on a tenant host → 404; tenant paths on the console host → 404.
  7. UPDATE/DELETE on `platform.audit_event` → exception for every role, including the service role.
  8. Each `platform_*` write and each `scripts/tenant-*.ts` and `scripts/platform-admin.ts` run writes exactly one platform audit row
     (codes and ids only; a test scans `detail` for an `@` and fails on it).
  9. A new sub-processor notice records its version and the per-tenant notified date; the console lists tenants not yet notified.
  10. The secret-key import lint rule (M0 test 11) passes unchanged: no new file outside `scripts/` imports the admin client.
  11. Bootstrap (FD28, FD31): `platform_bootstrap_admin` refuses an auth user without a verified TOTP factor (`mfa_factor_required`),
      one with a non-`admin` membership (`platform_admin_has_member_role`) and a second platform admin (`platform_admin_exists`), each
      writing nothing; it is not executable by `anon`, `authenticated` or `platform_staff`; success writes one `platform_admin.bootstrapped`
      row. `scripts/platform-admin.ts bootstrap` reads `--email` or `PLATFORM_ADMIN_EMAIL`, and its output and logs (captured in the test)
      contain the auth id and no address.
  12. Console mode: after `select_console()` the platform admin's token has role `platform_staff` and no tenant claim and reads 0 rows of
      every tenant table; after `select_tenant(A)` the same session's next token is `authenticated` with A's claims and gets 42501 from
      every `platform_*` function. pgTAP 341 passes with #79's allowlist unchanged (no new `auth.*` writer).

**SP4 — Platform admin membership in every tenant** (M) — ADR-037, ADR-038; FD28–FD31, FD32, FD33, FD35
- In: `public.platform_attach_admin(p_tenant)` and `public.platform_detach_admin(p_tenant, p_reason_code)`; `scripts/platform-admin.ts
  attach | detach | migrate-legacy` (dry run by default); audit actions `app_user.platform_admin_attached`, `app_user.platform_admin_entered`
  (union rule, H37) and platform actions `platform_admin.attached` / `detached`; the entry event in `select_tenant`;
  `public.platform_access_event` and `public.record_platform_access` called by `withApi` for `admin`; `public.audit_log(..., p_actor)` and
  the "Solo DigiAlto" filter on `/registro`; `app.mfa_needs_aal2` with `admin` always gated, `mfa_unenrol_check` refusing the last factor
  of `admin` in every mode, `mfa_enrol_check` issuer "Costì" for `admin` (FD31, FD34); the `app_user_insert` policy limited to
  `chef`/`waiter` (FD35); `begin_demo_data` without a demo admin and `app.demo_state.admin_user` nullable; `--actor` optional in
  `scripts/mfa-reset.ts` and `scripts/set-mfa-enforcement.ts`; the console finding `admin_row_foreign`.
- Acceptance tests:
  1. Attach: `platform_attach_admin(A)` creates exactly one active `admin` row (display name "DigiAlto") for the platform admin account and
     writes one `platform_admin.attached` platform audit row (ids and codes only) and one tenant `app_user.platform_admin_attached` row;
     a second call → `{changed:false}`, no row, no audit; with no active platform admin → P0001 `platform_admin_missing`; with a platform
     admin that has no verified factor → `mfa_factor_required`; not executable by `anon` or `authenticated`.
  2. Gate and RLS: the platform admin with rows in A and B, after `select_tenant(A)`, reads A's rows and 0 rows of B through every
     tenant table (catalogue loop); after switching, the reverse; `app.tenant_id()` returns exactly one tenant; with no selection the
     token has no tenant claim (SP2 test 2 applies).
  3. Second factor (FD31): with A's mode `off`, `enrolled` and `required` in turn, the account's token at `aal1` gets null from
     `app.tenant_id()`, `app.role()` and `app.app_user_id()` and 403 `mfa_required` from `withApi`, and at `aal2` it reads normally; the
     owner rows of #79's pgTAP 340 matrix pass unchanged and its `admin` rows are updated on purpose; `mfa_unenrol_check` refuses removing
     the account's last verified factor in each of the three modes (`mfa_last_factor`); a token refresh after `select_tenant(B)` keeps
     `aal2`.
  4. Audit as DigiAlto (FD29, FD32): `approve_invoice` by the account at A writes `invoice.approved` with `created_by` = the DigiAlto
     row; `select_tenant(A)` by the account writes one `app_user.platform_admin_entered` row in A, and none for an owner; each `/api/*`
     request of the account writes one `platform_access_event` row whose path has `:id` in place of every id and no query string, and an
     owner's request writes none; `audit_log(p_actor => 'digialto')` returns only entries whose actor is the DigiAlto row, plus access,
     attach and entry events, each labelled "DigiAlto"; chef and waiter → 42501 (unchanged reader rule); Playwright: the owner opens
     `/registro`, chooses "Solo DigiAlto" and sees exactly the fixture's DigiAlto entries.
  5. Capabilities (FD30, FD35): an authenticated insert of an `admin` row is refused for the owner (pgTAP 002 lines 53–57 unchanged) and
     for the platform admin's own session (new); an owner's insert of an `owner` row → 42501 (new); an owner's insert of a `waiter` row is
     still allowed (pgTAP 002 lines 47–51 unchanged); `update_staff` on the DigiAlto row → not found (chef/waiter filter); the account at
     A gets 42501 from the fixed-cost reader, `confirm_ingredient_allergens` and `raise_test_alert`, and reads 0 alert rows.
  6. Demo: `begin_demo_data` creates the demo owner only and `app.demo_state.admin_user` is null; `purge_demo_data` removes the demo data
     with a null admin (pgTAP 190 and 193 updated on purpose); the seed (`scripts/lib/demo/seed.ts`) creates no admin auth user.
  7. Legacy rows (§8 step 6): on a fixture tenant with the account's row and two other active `admin` rows, `migrate-legacy` without
     `--apply` prints counts and `app_user` ids only (no names, no addresses; output captured) and changes nothing, and the console shows
     `admin_row_foreign` for that tenant; with `--apply` the account's row is kept with display name "DigiAlto", the other two are
     deactivated with `app_user.deactivated` rows created by the DigiAlto row, one platform audit row is written, and the finding is gone.
     On a tenant without the account's row, `--apply` attaches it first (test 1 applies).
  8. MFA scripts: `scripts/mfa-reset.ts --user <id>` and `scripts/set-mfa-enforcement.ts --tenant <id> --mode <m>` without `--actor`
     resolve the actor to the account's row in that tenant and pass #79's own tests (pgTAP 343, A13); at a tenant whose only `admin` is
     the account they work; a deactivated legacy admin passed as `--actor` → `actor_invalid`; pgTAP 341 passes with #79's allowlist
     unchanged.
  9. Detach (FD33): `platform_detach_admin(A, 'contract_end')` is service-role only, deactivates the row (never deletes), and the
     account's next query at A returns no tenant; it writes `platform_admin.detached` and A's `app_user.deactivated`; the owner has no
     route or function that deactivates the DigiAlto row (route-list and `pg_proc` catalogue checks).
  10. TOTP issuer (FD34): `mfa_enrol_check` for the account returns issuer "Costì"; for an owner it returns the tenant's name
      (unchanged).

**SP5 — Entitlements** (M) — ADR-039
- In: `platform.feature`, `platform.plan`, `platform.plan_feature`, `tenant_subscription_event`, `tenant_feature_override`,
  `app.feature_enabled/require_feature/feature_limit`, `entitlement_mode`, `app.entitlement_observation`; `withApi({feature})`; cron
  skips; `/api/me.features`; console plan and override screens; plan `legacy-full`; the non-`public` tenant-table catalogue test.
- Acceptance tests:
  1. `reservations` off for B: `set_reservation_settings` → P0001 `feature_disabled`; the `POST` route → 403; A unaffected.
  2. An override with `expires_at` in the past falls back to the plan (fake clock).
  3. `kitchen` enabled while `orders` is off resolves to disabled (`requires`).
  4. `stock` off, `orders` on: `fire_course` still writes batch and stock movements and `order_line_cost` (integrity side effects).
  5. `observe` mode: a disabled call succeeds and writes one `entitlement_observation` row; `enforce` refuses it.
  6. `/api/me.features` for a waiter carries no money key (M0 test 10 fixture extended).
  7. Cron: `run_alert_rules` skips a tenant with `alerts` off; `run_ledger_invariants` still checks it.
  8. Catalogue (outside `public`, which pgTAP 001 already covers): every table in any other schema with a `tenant_id` column is in the
     named list (`app.entitlement_observation`, `app.session_tenant`), has RLS on, a non-null `tenant_id`, and no privilege for `anon` or
     `authenticated`; a new such table not in the list fails the test.

**SP6 — Tenant status and write gate** (M) — ADR-039
- In: `tenant_status_event`; `app.tenant_status()`; `app.require_writable()` (raising `tenant_read_only`) in the role helpers and write
  policies; exempt list (§3.1, including `record_platform_access`); `/api/me.status`; banner; console status actions; trial-end job
  (`trial` → `suspended` at the cut-off after `trial_ends_at`); audit entities (union rule).
- Acceptance tests:
  1. pgTAP catalogue: every volatile `public` function executable by `authenticated` calls the gate or is on the exempt list.
  2. `suspended`: `add_order_line`, `approve_invoice`, `produce_batch` → `tenant_read_only`, also for the platform admin's session;
     `GET` reports and CSV exports work, and the platform admin's access rows are still written.
  3. `cancelled`: chef and waiter read 0 rows; the owner reads and can request the full export.
  4. A suspension created at 21:00 with `effective_at` at the next cut-off leaves writes open until the cut-off (fake clock, a DST night
     included); the trial-end job uses the same rule.
  5. `/api/sync` with a suspended tenant: each op returns `tenant_read_only`, the outbox keeps them, nothing is applied.
  6. Status history is append-only; UPDATE/DELETE refused.

**SP7 — Provisioning and onboarding** (M) — invitation only (FD5), restaurant preset only (FD14)
- In: `platform_create_tenant` (with `platform_attach_admin`) and `tenant_invitation`; `scripts/tenant-invite.ts` and the service-role-only
  `bind_tenant_invitation`; `redeem_tenant_invitation`; wizard `/benvenuto` with the **restaurant** preset (service periods, booking
  defaults, demo set; the bar and coffee-shop presets are SP8's); `terms_acceptance` with the document set including the DigiAlto-access
  disclosure (key `digialto_admin_access`; text by the legal adviser, FD22); a config test pinning `[auth] enable_signup = false`; no
  sign-up page or route.
- Acceptance tests:
  1. Console invite → `scripts/tenant-invite.ts` → e-mail-code sign-in → redeem creates exactly one owner `app_user` and the
     `terms_acceptance` rows in one transaction; the script writes one platform audit row; the secret-key lint rule still passes (the new
     secret-key user is under `scripts/`). An invitation for the e-mail of an existing owner of tenant A binds that same auth user, and
     after redeem the user holds memberships in A and the new tenant (SP2 test 1 applies).
  2. An invitation is single-use and expires (fake clock); redeeming an invitation bound to another auth user, or not yet bound → 42501,
     no row written; `bind_tenant_invitation` is not executable by `anon`, `authenticated` or `platform_staff`.
  3. Redeeming while already a member of that tenant → 409; the platform admin account as invitee → refused by the script and by
     `bind_tenant_invitation`; **sign-up stays closed (FD5)**: a direct sign-up request to Supabase Auth with the publishable key is refused
     on the local stack, a config test fails if `[auth] enable_signup` in `supabase/config.toml` is `true`, and a route-list test finds no
     sign-up page or route.
  4. The restaurant preset saves today's two service periods (H21 values) and the restaurant booking defaults (H22); the wizard offers
     no bar or coffee-shop preset before SP8 (FD14).
  5. The wizard cannot finish without time zone, VAT and at least one service period; finish writes the `trial` (or `active`) status.
  6. Every wizard write goes through the existing settings procedures, except `redeem_tenant_invitation` (no new table write grant:
     catalogue test).
  7. `platform_create_tenant` attaches the platform admin (SP4 test 1 applies) and writes exactly one `platform_admin.attached`; redeem
     without accepting `digialto_admin_access` (or any other active document key) → 422, no row written.

**SP8 — Venue types: courses, counter, quick sale, tabs** (L; may split into SP8a courses and SP8b counter) — **scheduled when the first
bar or coffee shop signs (FD14)**
- In: `tenant_course` (seeded), enum → key migration; `table_session.kind`; nullable table/covers for counter/tab; `quick_sale`; tab
  label; offline op `quick_sale`; counter screens; kitchen routing per item; `tenant.service_mode` and the wizard's service-mode step; the
  bar and coffee-shop presets and demo sets (H22, H36); Bar Demo and Caffè Demo in the X fixture (§6.5 rule 4).
- Acceptance tests:
  1. Existing order lines and menu items keep their course (keys equal the old enum labels); the M17–M24 suites are green.
  2. A `table` session without a table or covers → check violation; a `counter` session without them → allowed.
  3. `quick_sale` with a fault injected at close → no line, movement or cost row remains (one transaction).
  4. `quick_sale` replayed with the same id → applied once (`applied_op`).
  5. A queued op from before the migration (enum course value) replays correctly after it.
  6. A tab label longer than the cap → 422; the "no names" hint is present.
  7. A waiter's counter payload has no cost key (waiter cost-column test extended).
  8. The bar preset saves one service period ending after midnight with the cut-off after it; the coffee-shop preset one all-day period.
  9. The wizard cannot finish without a service mode; every tenant created before SP8 has `service_mode = 'tables'` after the migration
     and its G payloads are unchanged.

**SP9 — Terminology, theme and venue name** (M)
- In: `tenant_term_override` (whitelist), `tenant_theme`, logo upload (private bucket, image checks as M2), per-host manifest; the venue
  name from `/api/me` replacing the `venue.name` string of QW13; a per-tenant sender display name for reservation e-mails; H29–H31,
  H39–H40.
- Acceptance tests:
  1. An override for a non-whitelisted key → 422; whitelisted text renders escaped.
  2. A theme failing the AA contrast pairs of `tests/lib/design/tokens.test.ts` → 422.
  3. Tenant #1's rendered tokens equal today's (visual snapshot of three screens), and its header wordmark still reads its name.
  4. Logo: a non-image file renamed `.png` → 415.
  5. Tenant B's header band and Home heading show B's name from `/api/me`, and its reservation e-mails carry B's name as sender display
     name; the manifest and `<title>` still say "Costì".

**SP10 — Export, erasure, per-tenant backups** (L) — ADR-040, FD12
- In: `export_request`; `scripts/tenant-export.ts`; `exports` bucket; `platform.erase_tenant`; `scripts/tenant-erase.ts`;
  `tenant.erasure_since`; `app.erasure_retention_days()` (returns null until FD13 is set; nothing is erased until then);
  `public.platform_record_erasure_request` and `public.platform_approve_erasure` (platform audit events `erasure.owner_request_recorded`
  and `erasure.approved`); per-tenant file packs (ADR-034 change); `scripts/backup/tenant-extract.ts`; and **the `CLAUDE.md` rule 6
  amendment**, approved by the founder on 2026-11-13 (FD12) as ADR-040 describes, committed in this milestone's PR together with the
  code (not before).
- Acceptance tests:
  1. Export of a fixture tenant: every tenant table has a CSV; row counts equal the database; file checksums match; formula cells
     escaped.
  2. Erasure is refused, with a P0001 code per reason and nothing deleted, when: the tenant is not `cancelled`;
     `app.erasure_retention_days()` returns null (the shipped state until FD13: `retention_not_set` for every tenant, whatever the
     dates); with a period set by a test-local replacement of that function inside the pgTAP transaction, the period since the
     cancellation has not passed (fake clock); the `erasure.owner_request_recorded` or the `erasure.approved` event is missing, names
     another tenant or predates the cancellation; the approver was not an active `platform_admin`; no export or waiver is recorded. With
     every condition met, erasure proceeds. `platform_record_erasure_request` and `platform_approve_erasure` each write exactly one
     platform audit row; a `platform_support` caller → 42501; a caller without `aal2` → `mfa_required`.
  3. After erasure: 0 rows with that `tenant_id` in every table with the column (catalogue query, all schemas); the other fixture
     tenant's ledger invariants pass; the platform admin account and its rows in the other tenant are intact.
  4. Outside `erase_tenant`, a DELETE on a ledger still raises, also while `erasure_since` is set on another tenant.
  5. File packs: the backup run writes packs per tenant; erasure deletes only that tenant's packs and manifest entries.
  6. `tenant-extract` from a restored copy yields the same export format and passes the ledger checks for that tenant.
  7. The PR's `CLAUDE.md` diff changes rule 6 only, adding the second exception in the wording of ADR-040 ("Rule 6 amendment"), with
     function and marker names equal to what the migration built; `code-reviewer` checks it and the PR description lists it.

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
- Precondition (FD1, FD29): the short written agreement between DigiAlto and Osteria Dei Rossi, including the DigiAlto-access
  disclosure, is in place; its text is the legal adviser's, not this plan's. SP4's legacy-row migration has run at tenant #1 (§8 step 6).
- In: organisation, `legacy-full`, the `active` status row, the observation review, `enforce`, a runbook update.
- Acceptance tests:
  1. The `entitlement_observation` log for tenant #1 is empty over the FD23 period (report attached to the PR).
  2. After `enforce`: G and X suites green; a Playwright full-service simulation (M25 style, including one offline waiter) passes.
  3. The platform admin account (fixture) signs in once, selects tenant #1 at `aal2` and works as `admin` (Playwright smoke); tenant #1
     has no other active `admin` row (`admin_row_foreign` empty); the owner's "Solo DigiAlto" filter lists the smoke's actions.

### 10b. Variants

**V1 — Platform console in a separate Supabase project** · Trigger: FD10b answered "separate project" · Replaces: SP3's
`platform_staff` role and SP3 tests 1 and 6 (the schema and audit move to the console project).
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | Console project with the `platform.*` tables; the product project exposes metadata through a `service_role`-only RPC set called by server routes under an amended secret-key rule (ADR amendment) | `supabase-console/…`, `src/server/platform/` | the metadata RPCs refuse `authenticated` and `anon`; a console request cannot read a `public` business table (permission test) |
| V1.2 | Secret-key lint rule extended to the console module | `eslint.config.mjs` | a lint fixture importing the admin client anywhere else fails |

**V2 — Console sessions as `authenticated` with a platform claim** · Trigger: spike T2 fails · Replaces: SP3's Postgres role
`platform_staff` and SP3 tests 1 and 12 (role part).
| # | Step | Files | Test |
|---|---|---|---|
| V2.1 | The hook adds a `platform_role` claim in console mode; `app.tenant_id()` returns null for a console-mode session | migration | pgTAP: a console-mode token reads 0 rows of every `public` table (catalogue loop) |
| V2.2 | `app.platform_role()` helper and its checks in every `platform_*` function | migration | an owner token calling `platform_tenants()` → 42501; a console token without `aal2` → `mfa_required` |

**V3 — Support write scope** · **Withdrawn by FD29 (2026-11-13, second set):** there are no support grants; the platform admin writes as
`admin`. No steps.

**V4 — Custom domains per tenant** · Trigger: the founder revisits FD18 with "yes" and the product domain is decided (Q188) · Replaces:
none.
| # | Step | Files | Test |
|---|---|---|---|
| V4.1 | `tenant_domain (tenant_id, host unique, verified_at)`; the proxy resolves a verified host to the tenant slug | migration, `src/proxy.ts` | a verified host serves that tenant's `/prenota`; an unverified host → 404; staff paths on a custom host → 404 (the C14-V5 test) |
| V4.2 | Domain add/verify by a platform-admin script using the hosting provider's API (API behaviour read at that time, not assumed) | `scripts/tenant-domain.ts` | a dry run against a recorded fixture; one platform audit row written |

**V5 — Billing provider integration** · Trigger: the founder revisits FD4 and names a provider · Replaces: the manual `active` setting in
SP6 for paying tenants.
| # | Step | Files | Test |
|---|---|---|---|
| V5.1 | Webhook route verifying the provider's signature; events → `tenant_subscription_event` / `tenant_status_event` through a `service_role` procedure | `src/app/api/cron/billing-webhook/route.ts` (under `/api/cron/*`, so the secret-key rule holds) | a bad signature → 401, nothing written; a replayed event id → applied once |
| V5.2 | Links to the provider's hosted checkout and portal from the console and the owner's settings; a `past_due` banner | `src/server/billing/` | no card field in any of our forms or payloads (grep test); `past_due` shows the banner; suspension still follows SP6's cut-off rule |

**V6 — Open sign-up with trial (parked)** · Status: **parked by FD5** (decided 2026-11-13: invitation only, no public sign-up); not
built unless the founder reverses FD5 · Trigger: the founder reverses FD5 · Replaces: the sign-up clause of SP7 test 3 (sign-up refused,
config pin, no sign-up route) and `scripts/tenant-invite.ts` as the only way an owner's login is created.
| # | Step | Files | Test |
|---|---|---|---|
| V6.1 | Supabase Auth sign-up switched on (`[auth] enable_signup = true`, reversing go-live item M-5; the SP7 config pin updated on purpose); `provision_tenant` for a confirmed user with no membership (attaching the platform admin, SP4 test 1); one trial tenant per user | `supabase/config.toml`, migration, `/registrati` | a second provisioning by the same user → 409; the platform admin account → refused; the config test now expects `true` and fails if V6.2's limit is absent |
| V6.2 | Abuse controls: a per-IP-hash daily limit (the reservation pattern); a CAPTCHA only after FD5b names a provider | route, migration | the limit reached → 429, nothing written; no CAPTCHA script on any page unless configured |

**V7 — Consolidated group reports** · Trigger: the founder revisits FD16 with "yes" · Replaces: none.
| # | Step | Files | Test |
|---|---|---|---|
| V7.1 | `public.org_kpis(period)`: a definer that loops over the caller's **owner** memberships and calls each tenant's KPI body | migration | an owner of A and B gets both; an owner of A and chef of B gets only A; the platform admin account (no owner rows) gets nothing |

**V8 — Tenant role `manager`** · Trigger: the founder reverses FD17 (decided "none" in the second set) with "manager" · Replaces: none.
| # | Step | Files | Test |
|---|---|---|---|
| V8.1 | Enum value and policies (owner-like operations, no user or billing management) | migrations | the full pgTAP role matrix; a manager cannot create an owner or admin |

**V9 — Tenant role `bar`** · Trigger: the founder reverses FD17 with "bar" (only meaningful once SP8 is scheduled, FD14) · Replaces: none.
| # | Step | Files | Test |
|---|---|---|---|
| V9.1 | Enum value, PIN login allowed, waiter-like policies plus counter sales | migrations | `waiter_cost_columns` run for `bar` finds no cost column; the M11 PIN tests pass for `bar` |

**V10 — Isolated database for one customer** · Trigger: a customer's contract requires physical separation (ADR-003 revisit) ·
Replaces: none (that customer only).
| # | Step | Files | Test |
|---|---|---|---|
| V10.1 | The same migrations deployed to a dedicated project; the console registers it as an external tenant (metadata pushed by a script) | `scripts/`, runbook | CI runs the full migration and pgTAP suite against an empty second project |

**V11 — The tenant `admin` may also approve support** · **Withdrawn by FD29 (second set):** there is no support approval. No steps.

**V12 — Public menu page** · Trigger: the founder revisits FD20 with "yes" · Replaces: none.
| # | Step | Files | Test |
|---|---|---|---|
| V12.1 | `public.public_menu(slug)` (anon, definer): available items, names, prices, allergen state; feature `public_menu` | migration | the payload holds no cost, margin or stock-quantity key (key whitelist test); an unknown or disabled slug → the same 404 |
| V12.2 | `/menu/[slug]` page under the nonce CSP (ADR-028) | `src/app/(public)/menu/[slug]/page.tsx` | Playwright renders the fixture menu; a staff path under the slug → 404 |

**V13 — Customer names on bar tabs** · Trigger: the founder revisits FD21 with "names allowed" (only meaningful once SP8 is scheduled,
FD14) · Replaces: SP8 test 6.
| # | Step | Files | Test |
|---|---|---|---|
| V13.1 | Tab label allowed to hold a name; the label is cleared (set to the tab number) at close + N hours by a retention job (N with the legal adviser) | migration | after the retention time the label equals the number; the chef reads no tab label (0 rows); the waiter cost-column test unchanged |
| V13.2 | Privacy note in the tenant's privacy texts list (the reservations pattern) | settings | readiness check refuses enabling named tabs until the privacy contact is set |

**V14 — Convert DigiAlto's admin rows at tenant #1 to support grants** · **Withdrawn by FD30 (second set):** those rows become, or give
way to, the platform admin membership (§8 step 6; SP4 test 7). No steps.

**V15 — One login for DigiAlto people with legacy admin rows (flagged trigger exemption)** · **Withdrawn by FD28–FD30 (second set):**
one account with two modes is the base plan (§2.2 point 1). No steps.

**V16 — The owner may pause DigiAlto's access** · Trigger: the founder revisits FD33 with "yes" · Replaces: the clause of SP4 test 9 "the
owner has no route or function that deactivates the DigiAlto row".
| # | Step | Files | Test |
|---|---|---|---|
| V16.1 | `public.pause_platform_admin(p_until timestamptz)` and `public.resume_platform_admin()` (owner only, `aal2`, write gate applies); the three membership helpers return null for the `admin` row while a pause is in force; both write a tenant audit row and a platform audit row | migration, `/impostazioni` | the owner pauses → the account's next query at that tenant returns no tenant, other tenants unaffected; chef, waiter and the account itself → 42501; resume (or `p_until` passing, fake clock) restores access; both audits written |
| V16.2 | The break-glass MFA scripts still accept the paused row as actor (the row stays `is_active`, `20261201100200_mfa_admin.sql` lines 53, 88, 118 check only that) | `scripts/lib/mfa-admin.ts` (no change), test | `scripts/mfa-reset.ts` without `--actor` succeeds at a paused tenant and writes its audit rows |

---

## 11. Risks and mitigations

**Security and privacy**
- *One account reaches every tenant (FD29).* A stolen platform admin login is the largest exposure in the system. Mitigations: `aal2`
  in every tenant mode, `off` included, and the last factor cannot be removed (FD31; SP4 test 3); bootstrap and attach refuse an account
  without a verified factor (SP3 test 11, SP4 test 1); every tenant entry, write and API read is recorded and visible to each owner (SP4
  test 4); detach by script (SP4 test 9); the address is never in the repo (FD28). Residual: the person's password manager and
  authenticator device; whether a hardware-backed second factor should be required for this account is a question for the founder, not
  assumed here (§12).
- *A request outside `/api/*` with the account's token* (straight to the Data API) is not in the per-request access log (§2.4 point 4).
  Mitigations: the entry event is written in Postgres whatever the path; writes carry the DigiAlto row; the app reads only `/api/*`
  (`CLAUDE.md` rule 6). Residual accepted (FD32 default).
- *An `admin` row for anyone else* would be labelled DigiAlto and gated like it. Mitigations: no tenant-session path can create one (SP4
  test 5), only `platform_attach_admin` can; the health finding `admin_row_foreign` (SP4 test 7).
- *Platform staff become a cross-tenant path through the console.* Mitigations: the `platform_staff` role with no table grants (V2 is its
  fallback), the metadata whitelist test, `aal2` always, the platform audit. Residual: secret-key holders (stated in the DPA).
- *Session-tenant confusion (one login, many tenants).* The tenant is chosen server-side only through `select_tenant` (membership
  checked); the hook never trusts incoming claims (as today); uniqueness and hook change ship in one migration (§2.4 point 3); SP2 tests
  1–4, SP4 test 2; the offline cache is cleared on switch (SP2 test 7).
- *Disclosure missing.* The standing access is lawful and fair only if the venue knows: the disclosure is part of the terms accepted at
  redeem (SP7 test 7) and of the FD1 agreement for tenant #1 (SP13 precondition); texts by the legal adviser (FD22). No legal claim here.
- *Someone creates an account without an invitation (FD5).* Supabase Auth sign-up stays off (`supabase/config.toml` line 180, go-live
  item M-5); owners' logins are created only by `scripts/tenant-invite.ts`; SP0 T5 and SP7 test 3 prove a direct sign-up is refused and
  pin the setting. Residual: the hosted dashboard setting can drift from `config.toml`; T5 checks staging, and the founder keeps M-5 on
  production.
- *Erasure is destructive.* Only under FD12's conditions (cancelled, retention period passed, owner's recorded written request, audited
  platform-admin approval), plus the export-or-waiver safeguard; `service_role` only, script-only, with an audit tombstone; nothing is
  erased while FD13 is unset; the `CLAUDE.md` amendment lands with the code in SP10's PR (SP10 tests 2–4, 7). Residual: with one platform
  admin (FD28), and at tenant #1 where the owner is also DigiAlto's owner (FD1), the request and the approval can come from the same
  person; the two audit events still record each role.
- *More personal data at scale* (many controllers' staff, suppliers, reservation contacts). One DPA template, sub-processor notices,
  per-tenant export and erasure, unchanged log rules (no personal data in logs or Sentry); `platform_access_event` stores paths with ids
  removed, no query strings.
- *Shared Supabase Auth limits* (rate-limits.md lines 16–18): a flood against one tenant's sign-in affects all; accepted today for one
  venue, **to re-decide before tenant #2** (the hosted values are read by the founder).
- *Legacy `admin` rows at tenant #1.* Handled by SP4's dry-run-first migration (§8 step 6, SP4 test 7); no names or addresses printed.

**Product and UX**
- *"Costì" next to "Costi".* The product name and the nav label for costs (`it.ts:1469`) differ by one accent, and a screen reader may
  read them alike. QW13 puts "Costì" only where the product speaks (§5.5), never in the nav; the tests match "Costi" exactly. Whether the
  nav label should change is for the UX quick-wins plan, not this one.

**Performance and cost**
- RLS cost grows with rows, not tenants, when `tenant_id` leads the indexes; the Supabase RLS guide recommends indexing policy columns
  and wrapping helpers in `select` (source S3), as the project already does. Spike T4 measures; SP2 reviews indexes. The status check is
  one indexed lookup per statement (init-plan); FD31 adds no lookup (role-based). The platform admin's API requests add one insert each
  (`record_platform_access`); owners' requests add none. The sale VAT trigger adds one indexed lookup per price or coperto write (not on
  the order path).
- Extraction cost scales per tenant: metered and capped (SP11); no price estimated.
- One global extraction queue: fairness in SP11.

**Operations**
- One migration hits every tenant: expand/contract, release rings, per-tenant backfills, the multi-venue CI fixture (§6.5).
- The production Supabase plan (FD11, source S2).
- One platform admin (FD28): a two-person erasure rule is impossible; FD12 (decided) asks for one audited platform-admin approval plus
  the owner's recorded request. If that person is unavailable, nobody can run console actions; the scripts with the secret key remain
  (founder-held). A second platform admin would need FD28 revisited (the partial unique index).
- Invitations are a manual step (the platform admin runs `scripts/tenant-invite.ts`), like export and erasure; automation only if volume
  needs it.
- A bar or coffee shop that signs before SP8 is built waits for SP8 (FD14); SP8 is the largest venue-type milestone.

**Dependencies (name, licence, why)**
- None added by the base plan or QW13. A billing SDK (V5) or a CAPTCHA script (V6, parked by FD5) would each need its one-line
  justification and the `no-new-deps` test updated at that time.

**Where every secret lives (new or changed)**

| Secret / credential | Lives in | Used by | When |
|---|---|---|---|
| none for the console, memberships, entitlements, status or the DigiAlto audit | — | Postgres roles and user sessions only | SP2–SP6 |
| `PLATFORM_ADMIN_EMAIL` (the platform admin account's address; not a key, but private: the repo is public) | GitHub environment `platform-ops` and Vercel environment variables, or the founder's local env when running scripts; never in the repo, `.env.example` holds a fake on `example.test`; never printed or logged | `scripts/platform-admin.ts` (bootstrap, attach, migrate-legacy); no server route needs it in the base plan (the app identifies the account by its `platform.staff` row) | SP3, SP4 |
| Supabase secret key, database URL (existing) | GitHub environment secrets (`production-backup`, and a new protected `platform-ops` environment) or the founder's local env for scripts | `scripts/platform-admin.ts` (SP3, SP4), `scripts/tenant-invite.ts` (SP7), `scripts/tenant-export.ts`, `scripts/tenant-erase.ts`, `scripts/backup/tenant-extract.ts`; the existing `scripts/mfa-reset.ts` and `scripts/set-mfa-enforcement.ts` (unchanged secret, `--actor` now optional) | SP3, SP4, SP7, SP10 |
| The platform admin account's login (e-mail, password, TOTP factor and backup factor) | Supabase Auth (hashed); the founder's password manager and authenticator app | the founder | SP3 |
| Auth SMTP credentials (existing Resend SMTP) and the sender display name "Costì" | Supabase Auth settings (dashboard) | sign-in codes for owners and the platform admin (no sign-up confirmation e-mails: sign-up stays off) | QW13 (display name), SP7 |
| `MAIL_FROM` (existing, reservation e-mails; not a secret) | Vercel env (`docs/runbook.md` line 57) | reservation mail cron; display name stays the venue's | unchanged |
| Billing provider API key, webhook signing secret | Vercel env, server-only, never `NEXT_PUBLIC_` | V5 webhook and links | V5 only |
| CAPTCHA secret key | Vercel env, server-only | V6.2 | V6 only (parked by FD5) |
| Hosting provider API token (domains) | GitHub environment secret for the script, never in the Vercel runtime | V4.2 | V4 only |
| Account logins: billing provider dashboard, CAPTCHA provider, domain registrar | the founder's password manager with MFA (Q26) | humans | when created |

---

## 12. Founder decisions and open questions

All FDs were answered on 2026-11-13 (§0a first set, §0b second set). **Decided** = an explicit founder answer. **Decided: default,
founder may revisit** = the recommended default stands; a later different answer triggers the variant in the last column or re-plans
the step named there. **Superseded** = replaced by a second-set decision; the row keeps the history.

| # | Decision | Answer (2026-11-13) | Status | Blocks / variant |
|---|---|---|---|---|
| FD1 | **Q11: who owns the code and IP** (a DigiAlto product with the osteria as tenant #1, or client-owned) | **DigiAlto owns the platform and sells it.** Osteria Dei Rossi is customer and tenant #1 under a short written agreement. DigiAlto and the osteria have the same owner (the founder's 2026-10-22 decision, relayed by the lead) | **decided** | the written agreement (with the DigiAlto-access disclosure) before SP13 and before selling (text by a legal adviser) |
| FD2 | Sequencing with Phase 2 | P2-1 TOTP is merged (#79); then SP0, SP1, SP2, SP3, SP4, SP5, SP6 before any second tenant; then SP7 and SP9–SP13 in your order; SP8 on FD14's trigger; Phase 2 items continue in your order in between; QW13 with the UX quick-wins PR | decided: default, founder may revisit | planning |
| FD3 | Tier names, contents, prices; add-ons | placeholders until you decide; the mapping in §4.2 as a starting point | decided: default, founder may revisit (names, contents and prices still to come from you) | SP5 seeding (plans can be added later) |
| FD4 | Billing provider | none at first: manual invoicing | decided: default, founder may revisit | V5 |
| FD5 | Sign-up model (FD5b: CAPTCHA provider under V6) | **Invitation only; no public sign-up.** Supabase Auth sign-up stays off; the owner's login is created by `scripts/tenant-invite.ts` (§3.2). FD5b is moot while V6 is parked | **decided** | SP7; V6 parked |
| FD6 | Trial: length, card upfront | a trial exists; its length is yours; no card; at the end → `suspended` (read-only), never deleted | decided: default, founder may revisit (length still to come from you) | SP6, SP7 |
| FD7 | Support write access (FD7b: may the tenant `admin` also approve support?) | first set: read-only, only the owner approves. **Second set: superseded by FD29**: no support grants; DigiAlto is standing `admin` with full audit | **superseded (FD29, decided)** | V3, V11 withdrawn |
| FD8 | Maximum support grant duration | first set: 8 hours. **Second set: superseded by FD29**: no grants, no duration | **superseded (FD29, decided)** | — |
| FD9 | DigiAlto's current `admin` rows at tenant #1 | first set: keep until the client agreement changes. **Second set (FD30):** they become, or give way to, the platform admin membership through SP4's dry-run-first migration (§8 step 6) | **decided (second set)** | SP4 test 7; V14 withdrawn |
| FD10 | Console host name (FD10b: separate Supabase project) | `console.<product domain>` in the same app; the product domain is still open (Q188) | decided: default, founder may revisit (the domain still to come from you) | SP3, V1 |
| FD11 | Supabase plan before tenant #2 | a paid plan (daily backups listed for paid plans only; source S2); you read the price | decided: default, founder may revisit | tenant #2 |
| FD12 | Erasure approvals and the `CLAUDE.md` rule 6 amendment (the second sanctioned exception to append-only, ADR-040) | **Yes, with safeguards.** Erasure only when all hold: (1) after cancellation plus the retention period (FD13; until it is set nothing is erased); (2) the owner's recorded written request; (3) a platform-admin approval, audited. The rule 6 amendment is approved as ADR-040 describes and goes into the SP10 PR, not now | **decided** | SP10 (tests 2, 7) |
| FD13 | Retention after cancellation before erasure | set with the legal adviser; until then nothing is erased (`app.erasure_retention_days()` returns null, SP10 test 2) | decided: default, founder may revisit (the period still to come, with the adviser) | SP10 |
| FD14 | Which venue types in the first sale | **Restaurants first.** SP8 (counter service, quick orders, tabs) is scheduled when the first bar or coffee shop signs | **decided** | SP8 timing; SP7 restaurant preset only |
| FD15 | Over the extraction limit | hold in the queue with a notice until next month or a DigiAlto override; no automatic extra charge | decided: default, founder may revisit | SP11 |
| FD16 | Groups: consolidated reports | not at first | decided: default, founder may revisit | V7 |
| FD17 | Extra tenant roles (`manager`, `bar`) | **none** (second set, FD30: the owner is the only venue-level admin besides DigiAlto; chef and waiter as today) | **decided (second set)** | V8, V9 only if reversed |
| FD18 | Custom domains per tenant | no; `<product domain>/prenota/<slug>` | decided: default, founder may revisit | V4 |
| FD19 | Countries | Italy only (IT VAT, EUR, Italian receipt types, Italian invoices) | decided: default, founder may revisit | — |
| FD20 | Public menu page `/menu/<slug>` | not built | decided: default, founder may revisit | V12 |
| FD21 | Names on bar tabs | no names; a number or short label | decided: default, founder may revisit | V13 |
| FD22 | Legal texts: terms, DPA, sub-processor list, DigiAlto privacy notice, the DigiAlto-access disclosure (FD29) | by a legal adviser before tenant #2 (the disclosure also before SP13, in the FD1 agreement) | decided: default, founder may revisit | tenant #2; SP7 test 7; SP13 |
| FD23 | Observe period before enforcing entitlements; release-ring order | observe until the log is empty for two full service weeks; an internal test tenant is ring 0, tenant #1 last | decided: default, founder may revisit | SP13 |
| FD24 | Platform notices by e-mail to DigiAlto | in-console only (consistent with ADR-006/D3) | decided: default, founder may revisit | SP11 |
| FD25 | Platform staff vs DigiAlto's legacy admin rows at tenant #1 | first set: separate console logins until V14. **Second set: superseded by FD28–FD30**: one platform admin account, one login, console and tenant modes | **superseded (FD30, decided)** | V15 withdrawn |
| FD26 | Actor of #79's emergency MFA reset and enforcement changes at tenants with no DigiAlto admin | first set: a platform-staff actor (`p_actor_staff`). **Second set: superseded by FD29/FD30**: every tenant has the DigiAlto `admin` row, which is the actor (`--actor` defaults to it) | **superseded (FD30, decided)** | SP4 test 8 |
| FD27 | Product name | **"Costì".** Osteria Dei Rossi is tenant #1; each venue keeps its own name and theme | **decided (second set)** | §5.5; QW13 |
| FD28 | Platform admin | **One overall platform admin: DigiAlto's founder account.** No address in the repo; identified by `--email`, `PLATFORM_ADMIN_EMAIL` (Vercel/GitHub env) or a founder-created `platform.staff` row | **decided (second set)** | SP3 |
| FD29 | DigiAlto's access to tenants | **Standing `admin` in every tenant; no ask-and-allow.** Audited as DigiAlto and visible to the owner by a filter; disclosed in contract and privacy terms; TOTP required; a platform audit entry on attach | **decided (second set)** | SP4, SP7, SP13 |
| FD30 | Tenant roles | **The owner is the venue's admin; no extra venue admins; chef and waiter as today; `admin` = the platform admin's role inside a tenant**; tenant #1's DigiAlto admin rows become this membership | **decided (second set)** | SP3, SP4 |
| FD31 | Second factor for the platform admin account in tenants not in `required` | `aal2` for `admin` in every mode, `off` included; last factor cannot be removed; attach needs a verified factor (§2.4 point 6) | decided: default, founder may revisit (another answer re-plans SP4 test 3; no variant drafted) | SP4 |
| FD32 | How DigiAlto's reads are recorded | per `/api/*` request (`platform_access_event`), plus the Postgres entry event and the existing `created_by` on writes | decided: default, founder may revisit (another answer re-plans SP4 test 4's access-log part) | SP4 |
| FD33 | May the owner remove or pause DigiAlto in the app? | no; detach by script on written request or contract end | decided: default, founder may revisit | V16 |
| FD34 | Where "Costì" and the venue's name appear | as §5.5 (product surfaces Costì; header band, Home, booking page and guest e-mails the venue's; TOTP issuer Costì for the platform admin) | decided: default, founder may revisit (another answer changes QW13's string list) | QW13; SP4 test 10; SP9 |
| FD35 | What the owner inherits from today's `admin` | nothing exclusive (§2.5); no tenant session creates `admin` or `owner` rows; no demo admin | decided: default, founder may revisit (another answer re-plans SP4 tests 5–6) | SP4 |

**Design points taken with their defaults (no FD number; default, founder may revisit):** the VAT two-list design (§5.2, SP1 test 1).
The first set's pgTAP 341 widening is **withdrawn** (§0b).

**Values still to come from the founder (none estimated here):** tier names, contents and prices (FD3); trial length (FD6); product
domain (FD10, Q188); the paid Supabase plan's price (FD11); the retention period, with a legal adviser (FD13); legal texts, including the
DigiAlto-access disclosure (FD22); the FD1 written agreement; `PLATFORM_ADMIN_EMAIL` set in the GitHub and Vercel environments (FD28); the
hosted Auth e-mail template, subject and sender display name "Costì" (QW13).

**Open questions (no default possible here)**
- Whether the hosted Supabase project accepts a custom `role` claim for PostgREST, Storage and Realtime (spike T2).
- Whether `session_id` is in the hook's input on every authentication method (spike T1).
- Data location and retention at Anthropic, Resend and Sentry for many controllers (project Q13, open).
- Each billing provider's prices, fees and retention (never estimated; V5); a CAPTCHA provider's likewise, only if V6 is ever revived.
- Per-tenant custom domains through the hosting provider's API (not verified; V4).
- Whether the name "Costì" is free to use as a product and domain name: not checked in this session; no claim is made.
- Whether the platform admin account should be required to use a particular kind of second factor beyond TOTP (for example a hardware
  key): Supabase factor types were not read in this session; nothing is assumed.

**Open items for the lead (not founder decisions):** (1) write the founder's 2026-11-13 SaaS decision and both sets of founder decisions
into DigiAlto-Ops `clients/osteria-dei-rossi/context.md` (decision, status "planning", FD1, FD5, FD12, FD14 and FD27–FD30 decided, the
others on their defaults, FD7, FD8, FD9, FD17, FD25, FD26 changed, and the values still to come), as this repo's `CLAUDE.md` requires;
(2) record the product name "Costì" in DigiAlto-Ops and as a line in `docs/client-facts.md` before QW13 ships; (3) approve QW13 (§5.5)
into the UX quick-wins PR.

---

## 13. Sources (fetched and read on 2026-11-13)

| ID | URL | What it says (as used here) |
|---|---|---|
| S1 | https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/content/guides/auth/auth-hooks/custom-access-token-hook.mdx | Required claims include `role`, `aal`, `session_id`; the hook receives `user_id`, `claims` and `authentication_method` (with `token_refresh` among the values) and "runs before a token is issued"; it can add, remove or change claims; examples copy `app_metadata.role` into `role`; required claims cannot be removed; token size is a concern; it can reject sign-in with an error. Nothing about several tenants per user |
| S2 | https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/content/guides/platform/backups.mdx | Daily backups for Pro, Team and Enterprise (7, 14, up to 30 days); PITR add-on; restores are whole-project and replace the current state; Storage objects are not in database backups; Free projects are advised to export regularly with `db dump` |
| S3 | https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/content/guides/database/postgres/row-level-security.mdx | Index policy filter columns; wrap helper calls in `select`; use `security definer` functions with `search_path = ''`, kept out of exposed schemas; always name the role with `to`; a secret key bypasses RLS only when the request carries no user token |
| S4 | https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/content/guides/platform/custom-domains.mdx | A custom domain replaces the project's API URL; paid add-on; one custom domain per project; subdomains only |
| S5 | https://raw.githubusercontent.com/vercel/platforms/main/README.md | Vercel's multi-tenant Next.js 16 example: "custom subdomains for each tenant"; "The proxy handles routing requests to the correct tenant"; the proxy (`proxy.ts`) detects subdomains; tenant data is stored in Redis; for deployment, "Set up a wildcard DNS record (`*.yourdomain.com`) on Vercel". It does not describe per-tenant custom domains; where the tenant lookup itself runs is not claimed here |

**Not reachable in this session (claims left out or marked unverified):** `vercel.com` (multi-tenant and domain API docs) and
`gdpr-info.eu` (GDPR Art. 28 text). `supabase.com` is blocked (read through GitHub instead). No billing provider's documentation was
read: no feature or fee of any provider is claimed. The Supabase Auth sign-up behaviour in §3.2 rests on the repo's own setting and
comment (`supabase/config.toml` lines 178–180) and is proven by spike T5, not by a fetched document. **The second set (§0b) used no new
web source:** every statement about the hook, the helpers, the `aal` gate and the TOTP rules is cited from this repo's migrations and
the merged TOTP plan (`docs/plans/2026-11-12-p2-1-totp.md`, e.g. line 371 for "a refresh keeps the session's `aal`").
