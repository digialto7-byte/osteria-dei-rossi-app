# Tech plan: Costì / Osteria Digitalization · SP2, memberships (one login for many tenants, organisations, tenant switcher; replaces M43)

- **Status:** draft for the lead · **Author:** SP2 builder · **Date:** 2026-11-26
- **Supersedes:** `docs/plans/2026-11-14-sp2-memberships.md` on draft PR #131 (`feat/sp2-memberships`, base `f1f80236`, never merged).
  This file brings that plan up to date with today's `main` (`e304a0b4`: SP1, opening stock and Comanda per uscita merged since). The
  **design is #131's, unchanged** (§3). What changed is the base facts, the numbering, the pins and the PR split (§0, §3.8, §5). #131's
  lead decisions of 2026-11-14 (Q-S2–Q-S8, F-4) are carried over unchanged (§7). Q-S1 ("one PR") is replaced by the lead's three-PR split
  of 2026-11-26.
- **Milestone:** SP2 of `docs/plans/2026-11-13-platform-saas.md` (§10 row SP2; §10a "SP2", acceptance tests 1–8; §2.4 point 3; §3.4;
  §5.4 H1, H5, H6, H33; §8 item 7); ADR-038; ADR-037 (one identity, two modes); ADR-036 / #79 (MFA gate). Replaces project milestone M43.
- **Client slug / internal:** `osteria-dei-rossi` is tenant #1. Internal planning document (English). The Italian strings are in §8.
- **Client facts used:** none. Fixtures are fake ("Osteria Demo A/B", `IT00000000000`-style VAT numbers, `example.test` addresses). The
  platform admin's e-mail address appears nowhere: SP2 needs no platform account (SP3).
- **ID scheme:** steps **S0–S13** (the same as #131); variants **V1–V10** (the same; V3 is now the default and dropped); lead decisions
  **Q-S2–Q-S8**, new questions **Q-N1–Q-N3**; founder questions **F-1–F-4**; risks **R1–R14** (#131 §6, unchanged); acceptance tests
  **AT1–AT8** (= platform plan §10a "SP2" tests 1–8).

---

## 0. Summary

Today one login is one tenant: `app_user.auth_id` is unique and the access-token hook adds the tenant of *the* active row. SP2 lets one
login hold one membership per tenant, and lets each **session** choose its tenant:

1. **Membership key** `(tenant_id, auth_id)` replaces the unique on `auth_id`, in the **same migration** as the hook change. With it come a
   PIN single-membership trigger, a "member elsewhere" guard on the direct insert policy, and an index on `auth_id`.
2. **Selection** `app.session_tenant (session_id pk, auth_id, tenant_id, selected_at)`. It is written only by `public.select_tenant(uuid)`
   and read by the hook through the token's `session_id`.
3. **Hook rule (e-mail branch):** a selection of an active membership wins. Otherwise **exactly one** active membership gives that tenant
   (today's behaviour). Otherwise there is no tenant claim. The **PIN branch is kept word for word**.
4. **Switch:** `POST /api/me/tenant` → `select_tenant` → one server-side `refreshSession` → new claims. The client calls `forgetUser()`
   before and after, keeps the outbox, tells other tabs, and reloads.
5. **Organisation:** `platform.organisation`, one row per VAT number; `tenant.organisation_id` is filled by a trigger; the unique on
   `tenant.vat_number` is dropped (H1).
6. **Several memberships, no selection:** every tenant route answers **409 `tenant_selection_required`**, and the client goes to
   `/login/scegli-locale`.

**Three PRs (lead, 2026-11-26):**

| PR | Branch | Steps | Waits for SP0 hosted? |
|---|---|---|---|
| 1 | `feat/sp02-memberships-1` | S1 organisation and H1; S8 client plumbing | no |
| 2 | `feat/sp02-memberships-2` | S2 scratch; S3 key, guards, `session_tenant`, hook; S4 `select_tenant`, `my_memberships`, isolation suite; S5 purge; S6 API no-tenant branch, `/api/me` count, tenant list; S7 `POST /api/me/tenant`; S9 `create-tenant --existing-owner-id` | **merge waits for T1.H and T3.H** (and T4.H isolation). Built and reviewed now on the local evidence |
| 3 | `feat/sp02-memberships-3` | S10 picker page and header switcher; S11 Playwright AT7; S12 runbook; S13 hand-off | stacked on PR 2 (Q-N1) |

**SP0 today:** the local parts are green: CI run 44467573793 (2026-11-19, the same migrations as main) passes T1.L–T5.L and T4.L
isolation. Those results are now written in `docs/plans/2026-11-14-sp00-spike.md` §10 (docs only, in this PR). The **hosted run is
owed**: it is a founder step and is not scheduled. A push to `main` migrates hosted staging, so a wrong hook would break sign-in on
staging. That is why PR 2 does not merge before the hosted verdicts (§3.9).

**Tenant #1 at every commit:** every single-membership user gets the same claims as today. pgTAP 003, 085 and 340 pass **unchanged** in
the same commit as the hook change. The tenant #1 golden suites (389, 417) and the cross-tenant suites (390, 418) pass unchanged.

**Scope:** four migrations (`20261207100000`–`20261207100300`), five pgTAP files (**430–434**), three API routes (two new, one changed),
client plumbing, one script flag, two screens. No new dependency, secret or cron job, and nothing for `anon`.

---

## 1. Goal and scope

**Goal:** an owner of two venues (and, from SP4, DigiAlto's platform admin account) signs in once and switches venue. Each venue's data
stays separate, and Osteria Dei Rossi notices nothing.

**In scope** (as #131 §1): the membership key and its guards, `app.session_tenant`, `platform.organisation`, `tenant.organisation_id`, H1;
the hook's e-mail branch; `select_tenant`, `my_memberships`; the purge of old selections in the existing `auth-purge` job; `withApi`'s 409;
`GET /api/me` (+`tenantCount`), `GET /api/me/tenants`, `POST /api/me/tenant`; client switch plumbing; `scripts/create-tenant.ts
--existing-owner-id`; making the SP0 scratch file idempotent; the picker page and header switcher; the rollout notes.

**Out of scope:** console mode, `platform.staff`, the `platform_staff` role, the platform audit (SP3); the platform admin attach, the entry
audit, `aal2` before listing for `admin` (SP4); `multi_venue` switch and the non-`public` catalogue test (SP5); invitations (SP7); the
wordmark from `/api/me` (SP9). No change to `src/server/staff-auth/**`, `public/sw.js`, `src/pwa/outbox.ts`, `src/pwa/lease.ts`,
`app.tenant_id()`, `app.role()`, `app.app_user_id()`, `app.membership_ungated()`, `app.mfa_needs_aal2`. No new ADR: ADR-038 holds the
decision; the lead adds its change note after the hosted run (§7).

---

## 2. Current state (`main` `e304a0b4`, re-read 2026-11-26)

Only what differs from #131 §2, or what SP2 depends on directly. Every other row of #131 §2 was re-checked and still holds.

| What | Where (file:line) | Fact that matters |
|---|---|---|
| Newest migration | `supabase/migrations/20261206220700_uscita_close.sql` | SP2's range `20261207100000`–`…100300` sorts after it. Main's guards already expect SP2's first file by name: `BEFORE = "20261207100000_organisation.sql"` in `tests/config/sp1-preserves.test.ts:16`, `opening-preserves.test.ts:17`, `uscite-preserves.test.ts:16`. No guard claims a `20261207` prefix (ds-bq2 filters `2026120610`, sp1 `20261206200`, opening `2026120621`, uscite `2026120622`) |
| Newest pgTAP | `supabase/tests/database/429_uscita_close.test.sql` | SP2 uses **430–434** (#131's 369–373 are taken) |
| Hook | `20261025100500_access_token_hook_pin.sql:59–110` | Not re-created since M11. Strip `:64–66`, PIN branch `:70–95`, e-mail branch `:97–106`. Its md5 `f748cfaa…` is pinned at `346_p21_preserves.test.sql:12`: **one pin over both branches** |
| Membership uniqueness | baseline `:31` (`auth_id … unique`); `app_user_select` baseline `:89–94` (tenant-scoped) | `/api/me` reads `app_user` `.eq("auth_id")…maybeSingle()` (`src/app/api/me/route.ts:15–19`). RLS limits that read to the claim's tenant, so it stays one row. S6 adds `.eq("tenant_id", session.tenantId)` anyway |
| `/api/me` after SP1 | `src/app/api/me/route.ts:14–45`; strict schema `src/server/me/output.ts`; test `tests/app/api/me-settings.test.ts` | S6 adds `tenantCount` to `meOutput` and tests it in a new file `tests/app/api/me-tenant-count.test.ts` |
| `withApi` no tenant | `src/lib/api/with-api.ts:202–204` | answers 403 `no_tenant`; S6 inserts the 409 branch before it |
| FD31 gate | `20261202100000_admin_mfa_always.sql` | `admin` always needs `aal2`; unchanged by SP2 |
| #79 | `20261201100000_mfa_gate.sql:50–99`; `20261201100200_mfa_admin.sql:97` (`mfa_reset_service_begin` deletes `auth.sessions`) | the gate keeps its form; a reset leaves `session_tenant` rows behind for dead sessions, removed by S5's purge |
| Catalogue counts | `365_p27_roles_preserves.test.sql:127` tables 76, `:130` triggers 134, `:135` policies 77 | moved on purpose by PR 1 and PR 2 (§3.8) |
| Owned schemas | `359_p22_preserves.test.sql:167` ("public, and app, the only schema they create") | `platform` is a new schema; the 359 constraint pin covers `public` and `app` only. `tenant.organisation_id`'s FK points into `platform`, so it counts as `external` in that pin (§3.8) |
| SP3 on main | `src/app/(platform)/console/**` (#140, UI shell only); no `platform` schema in any migration | S1 creates the schema. Nothing on main conflicts |
| #131 built code | `20261207100000_organisation.sql` (with the lead's drift guard), `369_sp2_organisation.test.sql`, `src/lib/tenancy/switch.ts`, `src/components/use-tenant-switch-listener.ts`, `scripts/spike/sp00/sql/03_memberships.sql` change and their tests | reused (§5, "Reuse") |

---

## 3. Design

**Unchanged from #131 §3.1–§3.7.** In short:

- **3.1 Data model:** `platform.organisation (id, name, legal_name null, vat_number unique ^IT[0-9]{11}$, created_at)`. RLS is on, there is
  no policy, and no API role has a privilege. `app.ensure_organisation`. The trigger `tenant_set_organisation` runs `before insert or update
  of organisation_id, vat_number` and refuses an organisation whose VAT number is not the tenant's (P0001 `organisation_vat_mismatch`, the
  lead's drift guard). Then a backfill and `organisation_id not null`, and `drop constraint tenant_vat_number_key`. In S3:
  `app_user_auth_id_key` becomes `app_user_tenant_auth_key unique (tenant_id, auth_id)`, plus `app_user_auth_id_idx`. The trigger
  `app_user_pin_single_membership` raises P0001 `pin_single_membership`. `app_user_insert` is re-created with the same name and one more
  condition, `not app.auth_member_elsewhere(auth_id, tenant_id)`. `app.session_tenant` has a composite FK to `app_user (tenant_id,
  auth_id)`, RLS on, select for `supabase_auth_admin` only and no API privilege. Retention: rows older than 31 days are deleted in
  `app.purge_auth_data`.
- **3.2 Hook:** strip unchanged; **PIN branch verbatim** (a source-equality test against `:70–95`). E-mail branch: E1 reads the selection
  in its own exception block (any error counts as no selection), E2 uses the selected **active** membership, E3 uses exactly one active
  membership, E4 adds no tenant claim. No new claim key. Every case is in #131 §3.2's table and gets a test in 431.
- **3.3 Functions:** `public.select_tenant(uuid) → {tenantId, changed}` is a definer with `search_path = ''`, executable by `authenticated`
  only. It checks in this order: role/session first (PIN session → 42501; missing `session_id` → `session_missing`), then active membership
  (42501 `not_a_member`, nothing written), then the 3 s throttle (`tenant_switch_too_soon`), then the upsert. It works at `aal1` on
  purpose: the gate applies to every query after the refresh. `public.my_memberships()` returns the caller's active rows only,
  `{tenantId, name, role}`.
- **3.4 API:** the 409 branch, `GET /api/me` + `tenantCount`, `GET /api/me/tenants` (never offline-cached), and `POST /api/me/tenant`. Each
  error is in #131 §3.4. Logs carry codes only, never a tenant name.
- **3.5 Client:** `switchTenant()` (forgetUser → POST → forgetUser → broadcast → full load of the safe next path). The outbox is never
  cleared: ops are bound to the per-tenant `app_user` id, so they are held on the phone and refused by `apply_op` with `user_mismatch`. A
  listener in `AppShell` handles the other tabs. The client sends a 409 to `/login/scegli-locale?next=…`, and `useMe` gains `selectTenant`.
- **3.6 Sequence** and **3.7 Rollout** (a day without service, staging first, a fix-forward that restores the M11 body, valid while no
  login has two active rows): as #131. S12 copies the rollout into `docs/runbook.md`.

**What re-reading main added to the design:**
- `/api/me` adds `.eq("tenant_id", session.tenantId)` to its row query (S6). RLS already limits the read to one row, so this is
  belt-and-braces: a later policy change cannot make `maybeSingle` see two rows.
- Rule B (no silent fallbacks): a selection whose membership is inactive is dropped, and if no tenant claim is left, the API answers
  409. A test proves the 409 (Q-S4 as decided). `crypto.randomUUID` has no fallback: `tabId()` throws a clear error (as decided on #131).

### 3.8 Pins that move (each with a "re-pinned on purpose by SP2 (step N; was …)" comment; each listed in its PR body)

| File:line (`e304a0b4`) | Kind | Change | PR / step |
|---|---|---|---|
| `tests/config/m25-preserves.test.ts:44` `LAST_MIGRATION` | newest migration | `20261206220700_uscita_close.sql` → each SP2 file in turn; last `20261207100300_session_tenant_purge.sql` | 1/S1, 2/S3–S5 |
| `tests/config/m25a-preserves.test.ts:50` | same | same | same |
| `tests/config/ux-quick-wins-preserves.test.ts:34` `NEWEST_MIGRATION` | same | same | same |
| `tests/config/m25b-preserves.test.ts:105` `ALLOWED_NEW_MIGRATIONS` | allowlist | append each SP2 file | same |
| `tests/config/m25b-preserves.test.ts:14` `PAGES`, `:81` `ALLOWED_NEW_PUBLIC_PAGES` | page lists | add `login/scegli-locale` | 3/S10 |
| `supabase/tests/database/346_p21_preserves.test.sql:12` | **md5 of the hook (both branches, one pin)** | `f748cfaa…` → the new value. The claim tests of both branches do **not** move: 003 (e-mail) and 085 (PIN, `:44–56`) pass unchanged, and a Vitest source-equality test pins the PIN block to M11's text | 2/S3 |
| same `:66–70` | public functions left out | add `select_tenant`, `my_memberships` | 2/S4 |
| `supabase/tests/database/341_mfa_gate_coverage.test.sql:27–37` (#79) | exempt lists | new `exempt_session` list: `public.select_tenant(uuid)`, `public.my_memberships()` (own identity only, no tenant data). Scan 1 excludes it. A new test pins it at exactly two and asserts that neither reads `membership_ungated` | 2/S4 |
| `supabase/tests/database/340_*` (#79 gate matrix), `342`/`343` (#79) | — | **not moved**: they must pass unchanged | — |
| `supabase/tests/database/359_p22_preserves.test.sql` `p27_objs` (`:21–65`) | additions since main | S1: column `tenant.organisation_id`; constraint `tenant_organisation_id_fkey`; trigger `tenant_set_organisation`; functions `app.ensure_organisation`, `app.tenant_set_organisation`. S3: constraint `app_user_tenant_auth_key`; index `app_user_auth_id_idx`; trigger `app_user_pin_single_membership`; functions `app.auth_member_elsewhere`, `app.app_user_pin_single_membership`; the table `app.session_tenant` under a new kind `app_table` (the existence check looks in `public` only). S4: `app.tenant_switch_min_interval`, `public.select_tenant`, `public.my_memberships`. S5: none (`app.purge_auth_data` is re-created; see the next row) | 1, 2 |
| same, constraint and index pins (`:167–195` and the index pin after it) | structure | re-pinned: `tenant_vat_number_key` (S1) and `app_user_auth_id_key` (S3) are **removed**, and an exclusion cannot hide a removal. Values come from a native build | 1/S1, 2/S3 |
| same, md5 of `app.purge_auth_data` if it is in 359's or 346's unchanged list | md5 | re-pinned if listed (checked in S5; #131 found none) | 2/S5 |
| `supabase/tests/database/365_p27_roles_preserves.test.sql:130` | trigger count | 134 → 135 (`tenant_set_organisation`) → 136 (`app_user_pin_single_membership`) | 1/S1, 2/S3 |
| same `:127` | table and view count, public + app | 76 → 77 (`app.session_tenant`) | 2/S3 |
| same `:135` | policy count, public + app | 77 → 78 (`session_tenant_read_by_auth_hook`; `app_user_insert` is re-created under its own name, so it does not change the count) | 2/S3 |
| same `:54–75`, unchanged-md5 list | — | **not moved**: `app.tenant_id`, `app.role`, `app.app_user_id` stay. This pin is the proof that the gate keeps its form | — |
| `supabase/tests/database/229_m19b_preserves.test.sql` public function-name hash and its left-out list | hash | add `select_tenant`, `my_memberships` to the left-out list | 2/S4 |
| `supabase/tests/database/005_create_tenant.test.sql` (the "already owns a tenant is rejected" case) | contract | becomes "an owner of A becomes owner of B too (two memberships); a PIN login as owner is refused and the tenant row is rolled back" | 2/S3 |
| `tests/guards/waiter-weight-no-cost.test.ts` route list | cost guard | add `/api/me/tenants`, `/api/me/tenant` | 2/S6, S7 |
| `scripts/spike/sp00/sql/03_memberships.sql` | scratch | skip the swap when `(tenant_id, auth_id)` is already unique (Q-S8) | 2/S2 |

**Must pass unchanged:** pgTAP 001, 002, 003, 085, 086, 088, 101, 340, 342, 343, 389, 390, 417, 418;
`tests/lint/offline-cache-allowlist.test.ts`; the `NAV_MODEL_MD5` pins; every prefix-scoped preserves test;
`tests/config/sp00-scratch-isolated.test.ts`; `sp3-preserves`. **Any other failing pin is a stop: I report it to the lead and do not re-pin
it.** The build adds every pin it finds outside this table to the PR body and to §11.

### 3.9 SP0 gating

| Verdict | Local (CI 44467573793) | Hosted | Gates | If hosted fails |
|---|---|---|---|---|
| T1 `session_id` on every method | pass (5 of 5) | owed | **PR 2 merge** | V1 (selection per login; ADR-038 amended) |
| T3 claim part (one refresh gives the new claim) | pass (b–d) | owed | **PR 2 merge** | stop and re-plan the switch |
| T3 aal part (the refresh keeps `aal2`) | pass | owed | **PR 2 merge** | V2 (the code page after a switch) |
| T4 isolation | pass | owed | **every SP2 merge** (SP0 §8) | stop everything; an RLS fix lands first |
| T2, T5 | pass | owed | SP3, SP7 | — |

The hosted run applies every migration in the repo (SP0 A4). PR 1 is additive and changes no auth path, so the hosted run may include it.
PR 2 must not be on `main` when that run happens.

---

## 4. Alternatives considered

As #131 §4 (per-login selection, client-sent tenant, one login per tenant, `(auth_id, tenant_id)` key, revoking the direct insert, an FK
to `auth.sessions`, a new cron job, clearing the outbox, a cache per tenant, an explicit organisation, no server refresh, the wordmark
now). One alternative is new:
- **One PR held as a draft until the hosted run** (#131's Q-S1). The lead rejected it on 2026-11-26: PR 1 can merge now, and smaller PRs
  are cheaper to review.

---

## 5. Build plan

**Rules for every step:** test first. Write the named test, see it fail for the stated reason, then write the code. One commit per step.
Each step runs only its targeted local tests: the new or changed Vitest files and the pgTAP files it touches. CI runs the full suites. Each
migration step moves the four newest-migration pins and adds its file to `tests/config/sp2-preserves.test.ts`. That test asserts: the
`20261207*` files are exactly the steps built so far; they sort after `20261206220700_uscita_close.sql`; they never re-create
`app.tenant_id`, `app.role`, `app.app_user_id`, `app.membership_ungated`, `app.mfa_needs_aal2`, `app.staff_session_open`,
`app.pin_sign_in_allowed`, `public.pin_login_begin`, `public.pin_login_finish`; they never use `drop … cascade`; and they contain no
`sp0_`, `sp0.` or `platform_staff` text. Every SECURITY DEFINER function sets `search_path = ''` and checks the caller's role or session
first. Nothing is granted to `anon`.

**Reuse from #131 (cherry-pick, then re-apply on conflict):**
- New files, taken as they are: `20261207100000_organisation.sql` (with the drift guard), `src/lib/tenancy/switch.ts`,
  `src/components/use-tenant-switch-listener.ts`, `tests/lib/tenancy/switch*.test.ts`, `tests/components/tenant-switch-listener.test.ts`,
  `tests/config/sp00-memberships-shape.test.ts`.
- Renumbered: `369_sp2_organisation.test.sql` → `430_sp2_organisation.test.sql`.
- Re-applied by hand on today's files, because they changed on main: `src/lib/api/client.ts`, `src/components/use-me.ts` (SP1 added
  `settings`), `src/components/me-problem.tsx`, `src/app/(owner)/app-shell.tsx`, the i18n files, and the pins (new values from a native
  build, never #131's).
- `tests/config/sp2-preserves.test.ts` is rewritten for the new base.

| # | Step (one commit) | PR | Files | Test that fails first, then the rest |
|---|---|---|---|---|
| S0 | **Base check (no commit).** Branch from `main`; confirm newest migration `20261206220700` and pgTAP 429 | each | — | targeted suites green on the base |
| S1 | **Organisation and H1** (#131 §3.1.1 and the drift guard) | 1 | `20261207100000_organisation.sql`; `430_sp2_organisation.test.sql`; `tests/config/sp2-preserves.test.ts`; pins m25/m25a/ux/m25b, 359 (`p27_objs`, constraints, indexes), 365 `:130` | **430: "two tenants with the same VAT number are accepted and share one organisation" (AT8; 23505 today).** Then: different VAT → two organisations; every tenant has an organisation after the migration; a bad VAT → 23514; `organisation_vat_mismatch` on drift, for every role; no privilege on `platform` or `platform.organisation` for `anon`, `authenticated`, `service_role`; RLS on; `ensure_organisation` executable by no API role; 005 green. Vitest: `platform` is not in `[api] schemas` |
| S8 | **Client plumbing** (#131 §3.5), against a mocked server | 1 | `src/lib/api/client.ts`; `src/components/use-me.ts`; `src/lib/tenancy/switch.ts`; `src/components/use-tenant-switch-listener.ts`; `src/app/(owner)/app-shell.tsx`; their tests | **switch: "forgetUser runs before the POST and again after a 200, then a full load of the safe next path".** Then #131's S8 list: offline does nothing; 4xx → one forgetUser and no navigation; network error or 5xx → a second forgetUser and a load of `/`; unsafe `next` → `/`; the outbox is never cleared; the client sends 409 to `/login/scegli-locale?next=…` (never from `/login`); `useMe` → `selectTenant`; the listener reloads once and closes on unmount |
| S2 | **SP0 scratch idempotent** (Q-S8) | 2 | `scripts/spike/sp00/sql/03_memberships.sql`; `tests/config/sp00-memberships-shape.test.ts` | Vitest: "03 swaps the key only when the `auth_id`-only unique exists". The `sp0-spike` run on PR 2 is green |
| S3 | **Key, guards, `session_tenant`, hook: one migration** (#131 §3.1.2–§3.1.4, §3.2) | 2 | `20261207100100_memberships.sql`; `431_sp2_memberships_hook.test.sql`; `tests/config/sp2-hook-pin-branch.test.ts`; 005; 346 `:12`; 359; 365 `:127, :130, :135` | **431: "one login with owner rows in A and B: the second insert succeeds" (23505 today).** Then every row of #131 §3.2's table, by calling the hook with crafted events as 003 does (AT2's hook half, AT5's database half). A PIN login cannot get a second row. An owner of B inserting A's owner → 42501; a fresh login → allowed. `session_tenant`: RLS on, hook-only read, no API privilege, the FK refuses a non-member pair. **Unchanged and green: 002, 003, 085, 340.** Vitest: the PIN block equals M11's `:70–95` after whitespace normalisation |
| S4 | **`select_tenant`, `my_memberships`, throttle; isolation suite** (#131 §3.3) | 2 | `20261207100200_select_tenant.sql`; `432_sp2_select_tenant.test.sql`; `433_sp2_isolation.test.sql`; 341; 346 `:66–70`; 229; 359 | **432: "select_tenant(A) by a member writes the session row and the hook then gives A".** Then: AT3 (non-member, unknown or inactive → 42501, no row); PIN → 42501; no `session_id` → `session_missing`; throttle; `changed`; `my_memberships`' exact keys; definers with `search_path=""`, `authenticated` only. **433:** AT1 (catalogue loop over every `public` table with `tenant_id`: 0 rows of B after selecting A, then the reverse); AT4 (two sessions of one login in A and B at once); AT6 (#79: an owner with a verified factor at `aal1` gets null from `app.tenant_id()` in A and in B). **341:** `exempt_session` holds exactly two |
| S5 | **Purge of old selections** | 2 | `20261207100300_session_tenant_purge.sql`; `434_sp2_session_tenant_purge.test.sql` | **434: "a selection older than 31 days is purged, a fresh one stays".** The run is recorded as `auth-purge`; the cron command and job list are unchanged; 088 and 101 green |
| S6 | **API: 409, `/api/me` count, tenant list** (#131 §3.4 rows 1–3) | 2 | `src/lib/api/with-api.ts`; `src/lib/api/errors.ts`; `src/app/api/me/route.ts`; `src/server/me/output.ts`; `src/app/api/me/tenants/route.ts`; `src/server/tenancy/memberships.ts`; `src/server/tenancy/output.ts`; `tests/lib/api/with-api-tenant.test.ts`; `tests/app/api/me-tenant-count.test.ts`; `tests/app/api/me-tenants.test.ts`; cost guard | **with-api-tenant: "a roles route, a token without tenant, two memberships → 409 tenant_selection_required" (403 today).** Then: none → 403 `no_tenant`; an ended PIN session → 401 before any RPC; no RPC when the token has a tenant; an RPC error → 500 with its code only. `/api/me`: `tenantCount`, the `tenant_id` filter, `settings` unchanged (`me-settings.test.ts` green), still offline-cacheable for owner, admin and waiter. `/api/me/tenants`: strict schema, `current`, no cost key, 401 when signed out |
| S7 | **`POST /api/me/tenant`** | 2 | `src/app/api/me/tenant/route.ts`; `src/server/tenancy/switch.ts`; `tests/app/api/me-tenant.test.ts`; `tests/integration/memberships.int.ts`; `tests/integration/helpers/memberships.ts`; cost guard | **me-tenant: "200 with the new tenant after select_tenant and one refreshSession on the same client".** Then each error (400, 403 PIN with no RPC, 404, 429, 401, 503 when the new claim does not match). Integration on the local stack: no claim at sign-in with two memberships; switch A ↔ B with the same `aal`; two sign-ins in A and B at once; the TOTP switch keeps `aal2`; a PIN staff login still signs in and refreshes (AT5 end to end) |
| S9 | **`scripts/create-tenant.ts --existing-owner-id <uuid>`** (Q-S7) | 2 | `scripts/lib/create-tenant.ts`; `scripts/create-tenant.ts`; `tests/scripts/create-tenant.test.ts` | **"with --existing-owner-id no auth user is created, and none is deleted when the RPC fails".** Then: a uuid only; mutually exclusive with `--owner-email`; the output names the tenant id only. The secret key stays in the script's environment |
| S10 | **Picker page and header switcher** (§8) | 3 | as §8 | `tests/components/venue-picker.test.ts`; `tests/components/tenant-switcher.test.ts`; m25b page lists |
| S11 | **AT7 Playwright: the switch clears the read cache before the first read of B** | 3 | `e2e/tenant-switch.spec.ts`; `e2e/helpers/seed-memberships.ts` | as #131 S11. Run once locally, then `supabase db reset` |
| S12 | **Runbook: SP2 rollout** (smoke list, fix-forward and its precondition query) | 3 | `docs/runbook.md`; §11 | `tests/config/runbook.test.ts` green |
| S13 | **Hand-off.** The PR body: what changed, the SP0 verdicts relied on, the pins moved, open questions | each | PR bodies | one `code-reviewer` round per PR; coverage of new code ≥ 80 % |

**Order that keeps tenant #1 working at every commit:** PR 1 is additive (tenant inserts are unchanged thanks to the trigger; the client
paths have no server answer that triggers them yet). PR 2 S3 gives single-membership users identical claims, proven by 003, 085 and 340 in
the same commit. The 409 only fires for logins with two memberships, and none exists in production until S9's script creates one.

### 5b. Variants

V1, V2 and V4–V10 as #131 §5b, with pgTAP numbers renamed (369 → 430, 370 → 431, 371 → 432, 372 → 433, 373 → 434). V3 (two PRs) is
withdrawn: the three-PR split is now the plan.

---

## 6. Risks and mitigations

As #131 §6 (R1–R14), with two updates:
- **R11 (SP0 interplay):** the hosted run is owed and not scheduled. PR 2 stays unmerged until it passes (§3.9). PR 1 and PR 3's UI do not
  depend on it.
- **R12 (timestamp collision):** main's guards already name `20261207100000_organisation.sql` as SP2's first file, so any other branch
  that takes `20261207*` turns CI red. `sp2-preserves` adds a second check.

**Security walk for PR 2 (security-checklist):** auth (hook, session selection, the 409); RLS on the new table; definer functions
(`search_path = ''`, the role or session check first); no new `anon` path; the secret key only in `scripts/`; logs carry codes only.
**Dependencies:** none added. **Secrets:** none new.

---

## 7. Decisions

**Carried over from #131 (lead, 2026-11-14), unchanged:** Q-S2 the "member elsewhere" guard; Q-S3 organisation by VAT number; Q-S4 a
stale selection is dropped, and with no claim left the API answers 409 (a test proves it, Rule B); Q-S5 the venue name in the account
control for multi-venue logins only; Q-S6 build `platform.organisation` now, closed to every API role; Q-S7 add the script flag; Q-S8 make
the scratch idempotent; F-4 `legal_name` stays nullable and empty for tenant #1.

**Decided by the lead, 2026-11-26:** supersede #131 with this file; the three-PR split; build PR 2 now and review it on the local evidence;
**do not merge PR 2 before T1.H and T3.H pass**.

**New questions for the lead:**
- **Q-N1.** PR 3's screens call PR 2's API, and AT7 needs the real switch route. My recommendation: stack PR 3 on PR 2. Build and review
  the components now against a mocked API; AT7 runs once PR 2 is in the stack; PR 3 merges after PR 2. The alternative is to move S10's
  components into PR 1, hidden until `tenantCount ≥ 2`, which keeps PR 3 to AT7 and the runbook.
- **Q-N2.** PR 2 marked ready vs draft: draft PRs skip the database CI. My recommendation: mark PR 2 ready when its review passes, so the
  full database CI runs, with "do not merge before SP0 hosted T1.H/T3.H" as the first line of its body and its title.
- **Q-N3.** The ADR-038 change note (T1 and T3 proven on a date, the key and index, Q-S2, Q-S4) waits for the hosted run. The lead writes
  it then; it is not in any SP2 PR.

**For the founder (unchanged from #131):** F-1 the rollout day without service for PR 2; F-2 accept ADR-038 before PR 2 merges; F-3 a slot
for the hosted SP0 run, which now blocks PR 2.

---

## 8. Picker page and switcher (S10)

As #131 §8: the forbidden paths, what the API gives, the build (`src/app/(public)/login/scegli-locale/page.tsx` and `venue-picker.tsx`;
`src/components/nav/tenant-switcher.tsx` in `AccountControl` and the laptop sidebar, shown only when `tenantCount >= 2`), the Italian and
English strings (`tenantSwitch.*`), the tests and the accessibility checks. The builder of PR 3 re-checks the `AccountControl` and sidebar
line numbers on its base.

---

## 9. Sources

Repository files only, cited above, and the SP0 CI run 44467573793 (job 135368991057). The hook input, `session_id`, refresh and `aal`
behaviour on hosted Supabase are **unverified until the hosted SP0 run** (T1.H, T3.H).

---

## 10. Hand-off log

(Filled by the builder per PR: the pins moved with their old and new values, any pin found outside §3.8, the CI result, and the review
verdict.)

## 11. Build notes

(empty)
