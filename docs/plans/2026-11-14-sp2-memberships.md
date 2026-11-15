# Tech plan: Costì / Osteria Digitalization · SP2, memberships (one login for many tenants, organisations, tenant switcher; replaces M43)

- **Status:** draft for the lead · **Author:** architect · **Date:** 2026-11-14
- **Repo and branch:** `osteria-dei-rossi-app`, branch `feat/sp2-memberships`, cut from `origin/main` 4870bf4d. One `/feature` run, one draft PR
  (Q-S1).
- **Milestone:** SP2 of `docs/plans/2026-11-13-platform-saas.md` (§10 row SP2 line 957; §10a "SP2" lines 1017–1031; ADR-038). It replaces
  project milestone M43 (platform plan §3.4 line 490).
- **Client slug / internal:** `osteria-dei-rossi` is tenant #1. Internal planning document (English); the Italian strings proposed for the UX
  builder are in §8.
- **Client facts used:** none. Fixtures are fake ("Osteria Demo A/B", `IT00000000000`-style VAT numbers, addresses on `example.test`).
- **Inputs read:** `CLAUDE.md`; platform plan §0a, §0b, §1.4, §2.1–§2.6, §3.4, §5.4 (H1, H5, H6, H33), §6.5, §8, §10, §10a, §10b, §11, §12, §13;
  ADR-003, ADR-010, ADR-037, ADR-038, ADR-039; the SP0 spike plan `docs/plans/2026-11-14-sp00-spike.md` (§3.3, §3.4, §8, §10) and its scratch
  SQL `scripts/spike/sp00/sql/03_memberships.sql`, `90_selfcheck_c.sql`; the format model `docs/plans/2026-11-14-ds-bq2-order-session-opener-coperto.md`;
  `templates/tech-plan.md`; skills `engineering-standards` and `security-checklist`; DigiAlto-Ops `knowledge/clients/osteria-dei-rossi/profile.md`
  (language `it`) and `clients/osteria-dei-rossi/context.md`. Every file:line below was read on this branch. **Where the platform plan and
  merged code differ, the code wins.**
- **ID scheme:** steps **S0–S13**; variants **V1–V10**; lead decisions **Q-S1–Q-S8**; founder questions **F-1–F-4**; risks **R1–R14**; SP2
  acceptance tests **AT1–AT8** (= platform plan §10a "SP2" tests 1–8, same order).

---

## 0. Summary

Today one login is one tenant: `app_user.auth_id` is unique and the access-token hook adds the tenant of *the* active row. SP2 lets one login
hold one membership per tenant and lets each **session** choose its tenant:

1. **Membership key** `(tenant_id, auth_id)` replaces the unique `auth_id`, in the **same migration** as the hook change (platform plan §2.4
   point 3). Three guards ship in that migration too: a PIN account keeps exactly one membership; an owner's direct insert can no longer
   attach a login that is a member elsewhere (a hole the uniqueness drop would otherwise open, §3.1.3); an index on `auth_id` replaces the one
   the unique gave.
2. **Session selection** `app.session_tenant (session_id pk, auth_id, tenant_id, selected_at)`, written only by `public.select_tenant(uuid)`
   after a membership check, read by the hook through the token's `session_id`.
3. **Hook rule:** a valid selection of an active membership wins; otherwise **exactly one** active membership gives that tenant (today's
   behaviour, so every tenant #1 user keeps identical claims with no selection row); otherwise no tenant claim. The PIN branch is byte-for-byte
   M11's. No new claim key.
4. **Switch:** `POST /api/me/tenant` → `select_tenant` → one server-side `refreshSession` → new claims. The client clears the read cache
   (`forgetUser()`) before and after, keeps the outbox (ops are bound to the per-tenant `app_user` id, so they cannot replay into another
   tenant), tells other tabs, and reloads.
5. **Organisation** `platform.organisation` (one per legal VAT number); `tenant.organisation_id` filled by a trigger; `tenant.vat_number` is no
   longer unique (H1).
6. **No selection with several memberships:** every tenant route answers **409 `tenant_selection_required`**; the client goes to the new page
   `/login/scegli-locale`.

**SP0 gating (§3.9):** S1, S2 and S8 can be built now. The membership migration (S3) and everything on it wait for **T1.H** (fail → **V1**)
and **T4.H isolation** (fail → stop everything). The switch route (S7) waits for **T3.H** (aal part fail → **V2**; claim part fail → stop and
re-plan ADR-038). The PR is not merged before the hosted SP0 run, which must apply `main`'s migrations without SP2's.

**Tenant #1 at every commit:** single-membership users get the same claims as today (pgTAP 003, 085 and 340:172–175 pass **unchanged**);
the hook change ships on a day without service with a fix-forward ready (§3.7).

Scope: four migrations (`20261207100000`–`20261207100300`), five pgTAP files (369–373), three API routes (two new, one changed), client
plumbing, one script flag, the switcher UI by the UX builder (§8). No new dependency, no new secret, no new cron job.

---

## 1. Goal and scope

**Goal:** an owner of two venues (and, from SP4, DigiAlto's platform admin account) signs in once and switches venue; each venue's data stays
fully separate; Osteria Dei Rossi notices nothing.

**In scope**
- Data model: membership key, PIN single-membership guard, insert-policy guard, `app.session_tenant`, `platform.organisation`,
  `tenant.organisation_id`, H1 (VAT unique dropped).
- The access-token hook (email branch), `public.select_tenant`, `public.my_memberships`, purge of old selections in the existing
  `auth-purge` job.
- API: `withApi`'s no-tenant branch (409), `GET /api/me` (+`tenantCount`), `GET /api/me/tenants`, `POST /api/me/tenant`.
- Client: the 409 redirect, the `useMe` state, `switchTenant()` (cache clean-up, outbox rule, other tabs, reload).
- `scripts/create-tenant.ts --existing-owner-id` (Q-S7).
- The SP0 scratch file `03_memberships.sql` made idempotent so the `sp0-spike` workflow stays green (Q-S8).
- Hand-off to the UX builder: `/login/scegli-locale` and the header switcher (§8).
- Every pin that moves (§3.8); rollout on a day without service (§3.7).

**Out of scope**
- Console mode, `platform.staff`, the console Postgres role (SP3); the platform admin's attach, entry audit and `aal2` listing rule (SP4); the
  `multi_venue` feature switch (SP5); invitations and `redeem_tenant_invitation` (SP7); the venue name and theme from `/api/me` everywhere (SP9,
  except Q-S5); consolidated group reports (platform plan V7).
- Any change to `src/server/staff-auth/**`, `public/sw.js`, `src/pwa/outbox.ts`, `src/pwa/lease.ts`, `app.tenant_id()`, `app.role()`,
  `app.app_user_id()`, `app.mfa_needs_aal2`.
- A new ADR: ADR-038 (proposed) already holds the decision; §7 lists the change note the lead adds when SP0 results are in.

---

## 2. Current state (4870bf4d)

| What | Where (file:line) | Fact that matters for SP2 |
|---|---|---|
| Tenant VAT unique (H1) | `supabase/migrations/20261021120000_tenancy_baseline.sql:17` | `vat_number text not null unique check (^IT[0-9]{11}$)`. Read per tenant only: XML buyer check `20261204100300_import_xml_invoices.sql:66, 220, 259`; reservation privacy `20261124100200_reservation_settings.sql:160`. No `on conflict (vat_number)` anywhere |
| One login = one tenant (H5) | baseline `:31` | `auth_id uuid not null unique references auth.users (id)`; the unique is also the only index on `auth_id` |
| Direct membership insert | baseline `:83`, `:96–103` | `authenticated` may insert `(tenant_id, auth_id, role, display_name)`; the policy checks tenant and role only. No `src/` code uses it (only definer procedures insert); pgTAP `002_cross_tenant.test.sql:41–57` pins it |
| Hook M0 / M11 (H6) | baseline `:109–139`; `20261025100500_access_token_hook_pin.sql:59–110` | strips `tenant_id, app_role, login, session_state` (`:64–66`); PIN branch `:70–95` (reads `session_id` at `:81`); email branch takes *the* active row (`:97–106`), correct only because of the unique. Hook reads `app_user` through column grants and policy `app_user_read_by_auth_hook` (baseline `:135–139`; `20261025100000_staff_auth_tables.sql:21`) |
| Gate helpers | `20261201100000_mfa_gate.sql:65–99`, `app.membership_ungated` `:50–62` | select the active row with `auth_id = auth.uid()` **and** `tenant_id = token claim` plus the aal condition: at most one row per claim once `(tenant_id, auth_id)` is unique. **Unchanged by SP2** (md5 pinned by `359_p22_preserves.test.sql:73–75`) |
| FD31 gate | `20261202100000_admin_mfa_always.sql:12–24` | `admin` always needs `aal2`; owner per mode and factor |
| MFA gate in the API | `src/lib/api/with-api.ts:183–207`; `src/server/auth/mfa-gate.ts:25–40`; `public.mfa_gate` `20261201100100_mfa_self.sql:71–86` | no tenant claim → `withApi` answers 403 `no_tenant` (`with-api.ts:196–198`) before any handler; `mfa_gate()` answers `ok` without a membership |
| `/api/me` | `src/app/api/me/route.ts:13–37` | roles route; reads the `app_user` row under RLS; offline-cacheable for owner, admin, waiter |
| Client 403 handling | `src/lib/api/client.ts:49–52, 107–111`; `src/components/use-me.ts:20–25, 45–50` | `mfa_required` / `mfa_enrol_required` redirect to `/login/codice`, `/login/attiva-codice`; MeState has no "choose a venue" state |
| `forgetUser()` | `src/components/forget-user.ts:9–22` | posts `clear-user-data` to the worker, resets `useMe`, clears the sync user; **keeps the outbox** |
| Read cache (H33) | `src/lib/api/offline-cache.ts:8–13`; `public/sw.js:11, 26, 397–402`; `src/pwa/register.ts:66–89` | four paths, keyed by path not tenant; `clear-user-data` deletes the cache and bumps a generation so a read begun before the clear is not stored after it |
| Outbox and lease (H33) | `src/pwa/outbox.ts:12–15, 59, 247, 250`; `src/pwa/lease.ts:9`; `src/lib/sync/sendable.ts:22–48`; `20261109100100_apply_op.sql:146–148` | every op carries `userId` = the `app_user` id; ops of another `userId` are **held** on the phone; the server refuses `user_mismatch` (42501) when `userId ≠ app.app_user_id()` |
| Staff PIN path | `src/server/staff-auth/**` (ADR-010); `pin-login.ts:132–143` reads the profile by `auth_id` with `maybeSingle()` | correct only while a PIN login has one row; `create_staff` refuses an auth id that has any row (`20261025100600_staff_management.sql:60`) |
| Session refresh in routes | `src/lib/supabase/server.ts:11–26` | the route client writes refreshed cookies; no route calls `refreshSession` today |
| Retention job | `20261025100800_auth_purge.sql:16–63`, re-created by `20261025101000_auth_purge_pending.sql:7` | `app.purge_auth_data` runs daily as `auth-purge`; pgTAP 088, 101 |
| Header venue name | `src/lib/design/venue-layer.ts:99`; `src/app/(owner)/app-shell.tsx:66–70`; `src/components/nav/account-control.tsx:13–36` | the wordmark is the constant `t("venue.name")`; the account control shows the person's name and "Esci" |
| Release order | `.github/workflows/deploy-production.yml:9–10` | migrations first, then the Vercel promotion: new code never meets an old schema |
| SP0 scratch shape | `scripts/spike/sp00/sql/03_memberships.sql:10–24`; `90_selfcheck_c.sql:20–33` | 03 raises when the `auth_id`-only unique is already gone; C1 expects a unique on `(tenant_id, auth_id)` in that order and none on `auth_id` alone; `.github/workflows/sp0-spike.yml:10–13` runs on any `supabase/migrations/**` change |
| Newest migration / pgTAP | `supabase/migrations/20261206100000_order_view_opener_coperto.sql` (no `202612[1-3]*` or `2027*` file); `supabase/tests/database/368_order_view_opener_coperto.test.sql` (no `37*`–`39*`) | **next migration `20261207100000`**, next pgTAP **369** |

---

## 3. Design

### 3.1 Data model

**3.1.1 `platform.organisation` (S1).** New schema `platform` (not in `[api] schemas`, `supabase/config.toml:13`; `revoke all on schema platform
from public, anon, authenticated, service_role`). Table `platform.organisation (id uuid pk default gen_random_uuid(), name text not null check
(length between 1 and 200), vat_number text not null unique check (vat_number ~ '^IT[0-9]{11}$'), created_at timestamptz not null default
now())`, RLS on, no policy, no privilege for any API role. It has **no `tenant_id`**: it is platform metadata above tenants, the exception
ADR-037 names for `platform.*` catalogue tables (Q-S6; SP3 adds the named-list catalogue test). The IT check stays (FD19).
- `app.ensure_organisation(p_name text, p_vat text) returns uuid`: definer, `search_path = ''`, insert on conflict `(vat_number)` do nothing,
  return the id; executable by no API role.
- `public.tenant.organisation_id uuid references platform.organisation (id)`, backfilled (one organisation per existing VAT, name = the
  tenant's name), then `set not null`.
- Trigger `tenant_set_organisation` (`before insert on public.tenant`, function `app.tenant_set_organisation()`, definer): when
  `organisation_id` is null it calls `app.ensure_organisation(new.name, new.vat_number)`. So `create_tenant_with_owner` and every pgTAP fixture
  that inserts a tenant stay unchanged, and two tenants with one VAT number land in one organisation (AT8; Q-S3).
- `alter table public.tenant drop constraint tenant_vat_number_key` (H1). `tenant.vat_number` stays: the per-tenant copy the extraction and XML
  buyer checks read.

**3.1.2 Membership key (S3, the hook migration).**
- `alter table public.app_user drop constraint app_user_auth_id_key`; `add constraint app_user_tenant_auth_key unique (tenant_id, auth_id)`;
  `create index app_user_auth_id_idx on public.app_user (auth_id)` (the hook's and `my_memberships`' per-user lookups lose the index the old
  unique gave; the helpers are served by the composite).
- Same key order as ADR-038 and as SP0 self-check C1 (`90_selfcheck_c.sql:20–27`), so the scratch checks keep meaning the same thing.

**3.1.3 Guards that ship with the key (S3).**
- **PIN accounts keep one membership** (ADR-010 decision 2; AT5). Trigger `app_user_pin_single_membership` (`before insert or update of
  auth_id, login_method on public.app_user`): refuses (P0001 `pin_single_membership`) when the row is `pin` and another row has its
  `auth_id`, or when another row with that `auth_id` is `pin`.
- **Owners cannot attach a foreign login.** Without the old unique, the direct-insert policy (baseline `:96–103`) would let an owner of B
  insert a row in B for *any* auth id it knows, e.g. the owner of A: that person would suddenly hold two memberships and lose their default
  tenant (R2). `app_user_insert` is re-created (same name, same roles) with one more condition: `not app.auth_member_elsewhere(auth_id,
  tenant_id)` (definer, true when that auth id has a row in another tenant). Memberships in a second tenant are created only by service-role
  paths (`create_tenant_with_owner`, later SP7's invitation, SP4's attach). pgTAP 002 passes **unchanged** (`:41–57`). Q-S2; V6.

**3.1.4 `app.session_tenant` (S3).** `(session_id uuid primary key, auth_id uuid not null, tenant_id uuid not null references public.tenant
(id), selected_at timestamptz not null default now(), foreign key (tenant_id, auth_id) references public.app_user (tenant_id, auth_id))`.
- The composite key means a selection always names a real membership; the hook still checks that it is **active**.
- RLS on; `grant select` and policy `session_tenant_read_by_auth_hook` (`for select to supabase_auth_admin using (true)`) for the hook only;
  no privilege for `anon`, `authenticated`, `service_role`. Written only by `public.select_tenant` (definer) and purged only by
  `app.purge_auth_data` (definer). It is session state, not a ledger: overwriting and purging are allowed.
- It carries `tenant_id` and RLS (CLAUDE.md rule 6) but lives in `app`, which pgTAP 001 does not scan; pgTAP 370 asserts its RLS and grants
  until SP5's catalogue test covers it (platform plan §4.1 line 527).
- **No foreign key to `auth.sessions`** (whether the hosted `postgres` role holds REFERENCES on a Supabase-managed table is unverified);
  retention is by age in the existing job instead (§3.1.5).

**3.1.5 Retention (S5).** `app.purge_auth_data` (re-created from `20261025101000_auth_purge_pending.sql:7` with one more delete) removes
selection rows whose `selected_at` is older than 31 days. Sessions are capped at 30 days from sign-in (ADR-029, `with-api.ts:169–181`) and a
row is never older than its session, so such a row belongs to a dead session. No new cron job (the cron list is pinned by
`346_p21_preserves.test.sql:101` and `359_p22_preserves.test.sql:164`). The counts in pgTAP 088 and 101 are unchanged (their fixtures hold
no selection).

### 3.2 The hook (S3), every case

`create or replace function app.custom_access_token_hook(event jsonb)`: same signature, owner, grants, `stable`, `search_path = ''`.

- **Strip** (unchanged, `:64–66`): `tenant_id`, `app_role`, `login`, `session_state` are never trusted.
- **PIN branch** (unchanged): the text of `:70–95` verbatim; S3's Vitest test compares it with the M11 file after whitespace normalisation.
- **Email branch** (replaces `:97–106`), in order:
  - **E1.** In its own `begin … exception when others` block: if the input `session_id` is a well-formed uuid, read `tenant_id` from
    `app.session_tenant` where `session_id` matches **and** `auth_id = user_id`. Any error counts as "no selection".
  - **E2.** If a selection was found and the user has an **active** row in that tenant: add that row's `tenant_id` and `role`. Done.
  - **E3.** Otherwise, if the user has **exactly one** active row: add it (today's behaviour).
  - **E4.** Otherwise (none, or two or more): add no tenant claim.
- No new claim key: the key sets pinned by `085_access_token_hook_pin.test.sql:44–53` stay exact.

| Case | Claims after SP2 | Proof |
|---|---|---|
| One active membership, no selection row (every tenant #1 e-mail user on the rollout day) | that tenant and role, as today | pgTAP 003, 085:44–56, 340:172–175 **unchanged**; 370 |
| One active membership, a selection of it | the same | 370 |
| Several, no selection | no tenant claim → API 409 `tenant_selection_required` | 370; S6 route tests |
| Several, a selection of an active one | the selected tenant and its role | 370; 372 |
| Selection of a membership deactivated since | the selection is ignored; E3/E4 apply (one other active → it; several → none) | 370 (Q-S4; V5) |
| Selection row of another auth user (forged `session_id`) | ignored (the `auth_id` filter) | 370 |
| No `session_id` in the input, or a malformed one | E3/E4: single-membership users unaffected | 370; T1.H decides whether multi-membership users can select (§3.9) |
| `session_tenant` unreadable (grant missing, error) | E3/E4 | 370 (the read is forced to fail by revoking the grant inside the test transaction) |
| PIN session (`login_method = 'pin'`) | M11 branch exactly; one membership by trigger | 085 unchanged; 370 trigger tests; source-equality test |
| Platform admin (SP4) | always several memberships → always selects | SP4 (not built here) |

The gate does not change form: `app.tenant_id()`, `app.role()`, `app.app_user_id()` and every policy compare with the token's single
`tenant_id` claim, so one statement sees one tenant (platform plan §2.4 point 3 lines 305–312).

### 3.3 Selection and listing functions (S4)

**`public.select_tenant(p_tenant uuid) returns jsonb`**, definer, `search_path = ''`, execute to `authenticated` only.
1. `v_auth := auth.uid()`; `v_session := (auth.jwt() ->> 'session_id')::uuid` (malformed or missing → P0001 `session_missing`).
2. A PIN session (`auth.jwt() ->> 'login' = 'pin'`, or the caller has a `pin` row) → 42501 `not_a_member`.
3. No **active** row `(p_tenant, v_auth)` → 42501 `not_a_member` (the same answer for an unknown tenant id); nothing written.
4. Throttle: an existing row of this session selected less than `app.tenant_switch_min_interval()` ago (an `immutable` function, `3 seconds`)
   for **another** tenant → P0001 `tenant_switch_too_soon` (R6).
5. Upsert on `session_id`: `tenant_id`, `selected_at = now()`.
6. Returns `{"tenantId": <uuid>, "changed": <bool>}`.
- It works at `aal1` on purpose: it only stores the choice; the gate applies to every query after the refresh (a gated owner then meets the
  existing `/login/codice` flow).
- No audit row for ordinary members; SP4 adds `app_user.platform_admin_entered` for `admin`.

**`public.my_memberships() returns jsonb`**, definer, `search_path = ''`, `stable`, execute to `authenticated` only: the caller's **active**
rows only, `[{"tenantId", "name", "role"}]`, ordered by tenant name then id. No money, no other person.

Both work without a tenant claim, so they cannot reach the gated helpers. pgTAP 341 gains a named exempt list for exactly these two signatures
(§3.8), with the reason "own identity only; no tenant data".

### 3.4 API

| Route | Access | Input | Output (strict Zod) | Errors |
|---|---|---|---|---|
| any `withApi({ roles })` route, token **without** tenant claim | — | — | — | e-mail session with ≥1 active membership (`my_memberships()` length): **409 `tenant_selection_required`**; otherwise 403 `no_tenant` (unchanged). PIN sessions never reach this (401 `session_ended` first, `with-api.ts:149–167`) |
| `GET /api/me` (changed) | roles, as today (MFA gate unchanged) | — | today's keys **plus `tenantCount: number` (int ≥ 1)** | as today |
| `GET /api/me/tenants` (new) | `{ authenticated: true }` | — | `{ tenants: [{ id, name, role, current }] }`, `current` = id equals the token's `tenant_id` | 401 unauthenticated; never offline-cached (not on `OFFLINE_CACHE_PATHS`) |
| `POST /api/me/tenant` (new) | `{ authenticated: true }`, JSON only (CSRF, `with-api.ts:229–235`) | `{ tenantId: uuid }` strict | 200 `{ tenantId }` | 400 `invalid_request`; 403 `forbidden` (PIN session, checked from claims before any SQL); 404 `tenant_not_found` (42501 from SQL); 429 `tenant_switch_too_soon`; 401 `unauthenticated` (`session_missing`); 503 `tenant_switch_failed` (refresh error, or the new token's `tenant_id` ≠ `tenantId`; reported with codes only) |

`POST /api/me/tenant` handler (`src/server/tenancy/switch.ts`): `rpc('select_tenant')` → `supabase.auth.refreshSession()` on the **same**
route client (its `setAll` writes the new cookies, `src/lib/supabase/server.ts:17–23`) → `getClaims()` must show `tenant_id = tenantId` →
200. New error codes join `src/lib/api/errors.ts`. Waiters never see costs: no route here returns money; the new routes join the cost-key
guard's route list (`tests/guards/waiter-weight-no-cost.test.ts`).

### 3.5 Client: switch, outbox, read cache, other tabs

`src/lib/tenancy/switch.ts` exports `switchTenant(tenantId, { next })` (dependencies injected for tests). The UI never re-implements it.

1. Offline (`navigator.onLine === false`) → `{ ok: false, code: "offline" }`; nothing else happens.
2. `forgetUser()` (`forget-user.ts:9`): the worker deletes the read cache and bumps its generation (`sw.js:26, 397–402`); `useMe` resets; the
   sync user is cleared.
3. `POST /api/me/tenant`.
4. **200, or an outcome where the server may have switched (0 network, 5xx, 503):** `forgetUser()` again (a read begun between steps 2 and 3
   still carried the old cookie), post `{type: "switched"}` on the BroadcastChannel `tenant-switch`, then a full load of
   `safeNextPath(next)` (`src/lib/api/safe-next.ts`) through `navigateTo` (`src/lib/nav/full-load.ts`); after a 5xx or a network error the
   full load goes to `/`.
5. **400, 403, 404, 429 (nothing changed on the server):** return `{ ok: false, code }`; the cleared cache refills on the next read.

- **Outbox (H33):** never cleared. Ops queued in A carry A's `app_user` id; in B the runner holds them (`sendable.ts:35`, "another person")
  and the server would refuse them with `user_mismatch` (`apply_op.sql:146–148`). They leave when the person is back in A. Two defences, no
  cross-tenant replay. The switcher shows how many of the person's ops are waiting (`useSyncView().mine`), as logout does
  (`logout-button.tsx:43–47`).
- **Lease:** unchanged; the lock name `osteria-sync-replay` (`lease.ts:9`) is per device, which is right: one runner per device.
- **Other tabs:** `useTenantSwitchListener()` (`src/components/use-tenant-switch-listener.ts`), mounted once in `AppShell`
  (`src/app/(owner)/app-shell.tsx:26–40`), does a full load of `/` on `switched`. Tabs share the session cookie, so without it a second tab
  would show A's screen while its next request runs as B.
- **409 redirect:** `client.ts` sends `409 tenant_selection_required` to `/login/scegli-locale?next=<current path>` (not from pages under
  `/login`, like `goToMfaPage`, `client.ts:67–72`). `useMe` gains the state `selectTenant`.

### 3.6 Sequence (a multi-venue owner with a TOTP factor)

1. Password sign-in → hook: two memberships, no selection → token without tenant (E4).
2. `/` → `GET /api/me` → 409 → `/login/scegli-locale` → `GET /api/me/tenants` (names and roles).
3. Tap "Osteria Demo B" → `switchTenant` → `select_tenant(B)` → `refreshSession` → hook E2 → claims B, `aal1`.
4. Full load of `/` → `GET /api/me` → MFA gate `challenge` → 403 `mfa_required` → `/login/codice` (unchanged P2-1 flow) → `aal2`.
5. Later, header switcher → A → `select_tenant(A)` → the refresh keeps `aal2` (T3.H; else V2) → claims A.

A tenant #1 user: step 1 gives the single membership (E3); nothing else changes.

### 3.7 Rollout: "a day without service" (platform plan §8 item 7)

- **What changes at deploy:** the hook's email branch. Every token issued or refreshed after the migration goes through it (tokens live
  `jwt_expiry = 3600` s, `config.toml:168`).
- **Why nobody is signed out:** at migration time every login has at most one active row (the old unique held until that statement), so E3
  gives everyone today's claims with no selection row. pgTAP 003, 085, 340 prove it unchanged.
- **Order:** staging first (`deploy-staging`), smoke (owner password + TOTP, PIN sign-in on an enrolled device, waiter `/tavoli`, a token
  refresh). Then production on a day the founder names with no service (F-1): `deploy-production` (migrations), promote Vercel, run
  `scripts/check-headers.ts`, the same smoke. Release order as `deploy-production.yml:9–10`.
- **Fix-forward (prepared, not committed):** a migration restoring the M11 hook body. It is valid as long as no login has two active rows; the
  runbook query `select count(*) from (select auth_id from public.app_user where is_active group by auth_id having count(*) > 1) x` must be 0
  before applying it. The app code works with either hook for single-membership users.
- `docs/runbook.md` gets this as a "SP2 rollout" subsection (S12).

### 3.8 Pins that move (each with the comment "re-pinned on purpose by SP2")

| File:line (4870bf4d) | Kind | Change | Step |
|---|---|---|---|
| `tests/config/m25-preserves.test.ts:22` `LAST_MIGRATION` | newest migration | `20261206100000_…` → each SP2 migration in turn, last `20261207100300_session_tenant_purge.sql`, plus a comment line like `:21` | S1, S3, S4, S5 |
| `tests/config/m25a-preserves.test.ts:28` | same | same | same |
| `tests/config/ux-quick-wins-preserves.test.ts:12` `NEWEST_MIGRATION` | same | same | same |
| `tests/config/m25b-preserves.test.ts:105–176` `ALLOWED_NEW_MIGRATIONS` | allowlist | append each SP2 file | same |
| `tests/config/m25b-preserves.test.ts:14–80` `PAGES` (61) and `:81` `ALLOWED_NEW_PUBLIC_PAGES` | page lists | add `login/scegli-locale` (62 pages) | S10 (UX builder) |
| `supabase/tests/database/346_p21_preserves.test.sql:12` | md5 of the hook | `f748cfaa…` → the new value (the builder computes it) | S3 |
| same `:66`, `:68` | public catalogue exclusions | add `select_tenant`, `my_memberships` to the left-out names | S4 |
| `supabase/tests/database/359_p22_preserves.test.sql:21–36` `p27_objs` | additions since main | add SP2's objects: column `tenant.organisation_id`; constraints `tenant.tenant_organisation_id_fkey`, `app_user.app_user_tenant_auth_key`; triggers `tenant.tenant_set_organisation`, `app_user.app_user_pin_single_membership`; index `app_user_auth_id_idx`; app functions `ensure_organisation`, `tenant_set_organisation`, `auth_member_elsewhere`, `app_user_pin_single_membership`, `tenant_switch_min_interval`; public functions `select_tenant`, `my_memberships`; and the app-schema table `session_tenant` under a **new kind `app_table`** (the existence check `:37–50` looks in `public` only; the new kind looks in `app`, and the table, column, constraint, trigger, policy and index exclusions honour it) | S1, S3, S4 |
| same `:142` | constraints by structure | value re-pinned: `tenant_vat_number_key` and `app_user_auth_id_key` are **removed** (an exclusion cannot hide a removal) | S1, S3 |
| same `:160` | index list | value re-pinned (the two unique indexes go) | S1, S3 |
| `supabase/tests/database/229_m19b_preserves.test.sql:73` | md5 of the sorted public function names (the left-out list above it) | **Added 2026-11-15 (SP3 plan #138, contradiction 2):** `select_tenant` and `my_memberships` change the hash; add both to the left-out list with the comment "SP2's selection and listing functions, added on purpose", as M23, M25c and P2-2 did | S4 |
| `supabase/tests/database/365_p27_roles_preserves.test.sql:127` | table and view count of public and app | **Added 2026-11-15 (SP3 plan #138, contradiction 2):** `71` → `72` (the table `app.session_tenant`); ratified in advance by the lead (2026-11-15) | S3 |
| `supabase/tests/database/365_p27_roles_preserves.test.sql:130` | trigger count of public and app | `127` → `128` (the trigger `tenant_set_organisation`). Added during the build; ratified by the lead 2026-11-14 | S1 |
| same `:54–75` | "unchanged" md5 list | **not moved**: `app.tenant_id`, `app.role`, `app.app_user_id` stay as they are (this pins "the gate keeps its form") | — |
| `supabase/tests/database/341_mfa_gate_coverage.test.sql:25–52` | exempt lists | new `exempt_session` list: `public.select_tenant(uuid)`, `public.my_memberships()`; scan 1 excludes it; a new test pins it at exactly two and asserts neither references `membership_ungated` | S4 |
| `supabase/tests/database/005_create_tenant.test.sql:29–36` | contract | "an auth user who already owns a tenant is rejected" → "an owner of A becomes owner of B too (two memberships); a PIN login as owner is refused and the tenant row is rolled back" | S3 |
| `scripts/spike/sp00/sql/03_memberships.sql:10–24` | scratch | skip the swap when `(tenant_id, auth_id)` is already unique (Q-S8; V10) | S2 |
| `tests/guards/waiter-weight-no-cost.test.ts` route list | cost guard | add `/api/me/tenants`, `/api/me/tenant` | S6, S7 |

**Must pass unchanged (preserves):** pgTAP 001, 002, 003, 085, 086, 088, 101, 340 (`:172–175` included), 343; `tests/lint/offline-cache-allowlist.test.ts`;
the `NAV_MODEL_MD5` pins (`m25-preserves.test.ts:24`, `m25a-preserves.test.ts:30`: the switcher is not a nav-model entry); every
prefix-scoped preserves test (`p2-1-preserves.test.ts:90`, `ds-bq2-preserves.test.ts:16`, …: they scan their own date prefix only);
`tests/config/sp00-scratch-isolated.test.ts` (SP2's migrations and tests must not contain `sp0_`, `sp0.` or `platform_staff`, comments
included). **Any other failing pin is a stop: report it to the lead, do not re-pin it silently.**

### 3.9 Which steps wait for which SP0 verdict

The hosted SP0 run (T1–T5) has not happened; its local parts are green in CI. SP0 plan §8 lines 598–609 name the consequences.

| Verdict | What it proves for SP2 | Steps gated | If it fails |
|---|---|---|---|
| **T1.H** (`session_id` in the hook input for password, e-mail code, magic link, refresh, TOTP; SP0 plan §3.4 lines 182–198) | a selection keyed by session can be read for every sign-in | S3, S4, S5, S6, S9, S11 (start after the verdict) | **V1** (active tenant per login; ADR-038 amended by the lead and founder). Tenant #1 is safe either way (E3 needs no `session_id`) |
| **T3.H** claim part (one server-side refresh after the selection returns the new claim in the same request; lines 222–237, b–d) | `POST /api/me/tenant` works as designed | S7, S11 | **Stop and re-plan** ADR-038's switch before S7 (SP0 plan §8). No variant is drafted: the cause decides the shape |
| **T3.H** aal part (the refresh keeps `aal2`) | no second code after a switch | S7 | **V2** (the switch is followed by the code page) |
| **T4.H isolation** (lines 239–247) | today's RLS is sound with many tenants | everything | **Stop everything**: an RLS defect PR on `main` first |
| T4.H numbers | input to the index review | none (S3 already adds `app_user_auth_id_idx`) | recorded in §11 by the lead; any further index is a new item |
| T2.H, T5.H | SP3, SP7 | none | — |

**Build now:** S0, S1, S2, S8 (no SP0 dependency). **Merge:** the PR stays draft until T1.H, T3.H and T4.H isolation are recorded pass in SP0
§10 (or V1/V2 applied), and **after** the hosted run, which must apply `main`'s migrations without SP2's (SP0 plan §3.8 A4 applies every
file in the repo at run time).

---

## 4. Alternatives considered

- **Active tenant per login, not per session** (ADR-038's rejected alternative): simpler storage, no T1 dependency; but two phones of one owner
  cannot be in two venues, and a switch on one phone moves the other mid-service. Rejected as default; it is V1 if T1.H fails.
- **A tenant id sent by the client on each request:** rejected (ADR-038): the hook never trusts claims from outside; RLS needs one claim per
  token.
- **One login per tenant with re-sign-in:** rejected (ADR-038): several passwords and TOTP factors per person.
- **Unique `(auth_id, tenant_id)` instead of `(tenant_id, auth_id)` plus an index:** saves one small index; rejected to keep ADR-038's key
  and SP0 self-check C1 (`90_selfcheck_c.sql:21–27`) meaning the same.
- **Revoke the direct `app_user` insert from `authenticated`:** the cleanest end state; but it rewrites pgTAP 002:41–57 and is SP4's
  territory (FD35 narrows the policy there). Rejected as default for a one-condition guard; it is V6.
- **Foreign key from `app.session_tenant` to `auth.sessions` with `on delete cascade`:** automatic clean-up; depends on a REFERENCES privilege
  on a Supabase-managed table that is unverified on the hosted project. Rejected for age-based purge in the existing job.
- **A new cron job for the purge:** rejected; it moves two cron pins and adds a job for one delete.
- **Clear the outbox on switch:** rejected: held ops must survive (`forget-user.ts:5–7`), and the user binding already stops cross-tenant
  replay.
- **A read cache keyed by tenant (cache name per tenant):** rejected: it changes `public/sw.js` and its tests; clearing on switch is enough.
- **Organisation chosen explicitly, not by VAT:** rejected as default (Q-S3): two tenants with one VAT number are one legal entity by
  definition; V4 keeps the explicit path.
- **Select-then-reload without a server refresh (the proxy refreshes when the token expires):** rejected: the old tenant would stay for up
  to an hour.
- **Header wordmark from `/api/me` for everyone now:** rejected as default (Q-S5): it is SP9's and could change tenant #1's visible name if the
  stored name differs from the catalogue string; V7.

---

## 5. Build plan

**Rules for all steps:** test first; write the named test, see it fail for the stated reason, then change the code. One commit per step.
Every step ends with `npm run lint`, `npx tsc --noEmit`, `npm test`, `npx supabase test db` green. Each migration step moves the four
newest-migration pins of §3.8 and adds its file to `tests/config/sp2-preserves.test.ts` (created in S1), which asserts: the `20261207*` files
are exactly the steps built so far; they sort after `20261206100000_order_view_opener_coperto.sql`; they create and replace only the listed
tables and functions; they never re-create `app.tenant_id`, `app.role`, `app.app_user_id`, `app.mfa_needs_aal2`, `app.staff_session_open`,
`app.pin_sign_in_allowed`, `public.pin_login_begin`, `public.pin_login_finish`; never `drop … cascade`; no `sp0_`, `sp0.` or `platform_staff`
text. **Gate** column: "now", or the SP0 verdict the step waits for (§3.9).

| # | Step (one commit) | Gate | Files | Test that proves it (fails first) |
|---|---|---|---|---|
| S0 | **Base check (no commit).** Branch at 4870bf4d; confirm newest migration `20261206100000` and pgTAP 368; read SP0 §10 (hosted cells empty today) | now | — | All suites green on the base; the last file of `supabase/migrations/` in name order is `20261206100000_order_view_opener_coperto.sql` |
| S1 | **Organisation and H1.** Schema `platform`, `platform.organisation`, `app.ensure_organisation`, trigger `tenant_set_organisation`, backfill, `organisation_id not null`, VAT unique dropped | now | `supabase/migrations/20261207100000_organisation.sql`; `supabase/tests/database/369_sp2_organisation.test.sql`; `tests/config/sp2-preserves.test.ts` (new); pins of §3.8 rows m25/m25a/ux/m25b and 359 (`:21–36`, `:142`, `:160`) | **369 first test: "two tenants with the same VAT number are accepted and share one organisation" (AT8; fails 23505 today).** Then: different VAT → two organisations; every tenant has `organisation_id` after the migration; a bad VAT is still refused (23514); `platform` usage and `platform.organisation` privileges are none for `anon`, `authenticated`, `service_role`; RLS on; `ensure_organisation` executable by no API role; `create_tenant_with_owner` still creates the tenant with its organisation (005 green). **Vitest** `sp2-preserves`: `platform` is not in `[api] schemas` of `supabase/config.toml` |
| S2 | **SP0 scratch stays green on SP2's shape.** 03 skips the constraint swap when a unique on `(tenant_id, auth_id)` exists (Q-S8) | now (merge with S3) | `scripts/spike/sp00/sql/03_memberships.sql`; `tests/config/sp00-memberships-shape.test.ts` (new) | Vitest: "03 swaps the key only when the `auth_id`-only unique exists and otherwise leaves the table alone" (source test over the guarded `do` block; fails on today's unconditional raise); the `sp0-spike` workflow run on the branch after S3 is green (self-checks A–C) |
| S3 | **Membership key, guards, selection table and hook (one migration, platform plan §2.4 point 3).** §3.1.2–§3.1.4, §3.2 | **T1.H**, T4.H isolation | `supabase/migrations/20261207100100_memberships.sql`; `supabase/tests/database/370_sp2_memberships_hook.test.sql`; `005_create_tenant.test.sql:29–36`; `346:12`; 359 rows of §3.8; `tests/config/sp2-hook-pin-branch.test.ts` (new); newest-migration pins | **370 first test: "one login with owner rows in A and B: the second insert succeeds" (fails 23505 today).** Then every row of the §3.2 table (AT2 hook half, AT5 database half), each by calling the hook with crafted events as 003 does; a PIN login cannot get a second row and an e-mail login with a row elsewhere cannot become PIN (`pin_single_membership`); an owner of B inserting a row for A's owner → 42501, for a fresh login → allowed; `app.session_tenant`: RLS on, `supabase_auth_admin` select only, no `anon`/`authenticated`/`service_role` privilege, the composite FK refuses a non-member pair; `app_user_auth_id_idx` exists. **Unchanged and green:** 002, 003, 085, 340. **005:** re-pinned contract. **Vitest** `sp2-hook-pin-branch`: the PIN block of the new hook equals `20261025100500_access_token_hook_pin.sql:70–95` after whitespace normalisation |
| S4 | **`select_tenant`, `my_memberships`, throttle; the isolation suite.** §3.3 | T1.H | `supabase/migrations/20261207100200_select_tenant.sql`; `supabase/tests/database/371_sp2_select_tenant.test.sql`; `supabase/tests/database/372_sp2_isolation.test.sql`; `341:25–52`; `346:66, 68`; 359 `p27_objs` | **371 first test: "select_tenant(A) by a member writes the session row and the hook then gives A" (fails: function missing).** Then: non-member, unknown tenant, inactive row → 42501 and no row (AT3); PIN session → 42501; no `session_id` → `session_missing`; a second switch within 3 s → `tenant_switch_too_soon`, after 3 s (row's `selected_at` moved back in the test) → ok; `changed` false when re-selecting; `my_memberships` lists only the caller's active rows with exactly `{tenantId, name, role}`; both are definers with `search_path=""`, executable by `authenticated` only. **372 (fake data):** AT1 (after selecting A, `app.tenant_id()` = A and a catalogue loop over every `public` table with `tenant_id` reads 0 rows of B; after switching, the reverse); AT4 (two `session_id`s of one login, one in A and one in B, each sees only its tenant); AT6 (owner with a verified factor at `aal1` gets null from `app.tenant_id()` in A and in B). **341:** `exempt_session` has exactly two signatures, neither references `membership_ungated`; scan 1 still green |
| S5 | **Retention of selections** | T1.H | `supabase/migrations/20261207100300_session_tenant_purge.sql`; `supabase/tests/database/373_sp2_session_tenant_purge.test.sql` | **373 first test: "a selection older than 31 days is purged, a fresh one stays" (fails: the purge ignores the table).** Then: the run is recorded in `app.job_run` as `auth-purge`; the cron command is unchanged; no API role can execute the purge. **088 and 101 unchanged and green** |
| S6 | **API: no-tenant branch, `/api/me` count, tenant list.** §3.4 rows 1–3 | T1.H (needs S4) | `src/lib/api/with-api.ts`; `src/lib/api/errors.ts`; `src/app/api/me/route.ts`; `src/app/api/me/tenants/route.ts` (new); `src/server/tenancy/memberships.ts` (new); `src/server/tenancy/output.ts` (new); `tests/lib/api/with-api-tenant.test.ts` (new); `tests/app/api/me-tenants.test.ts` (new); `tests/app/api/me-route.test.ts` (new); `tests/guards/waiter-weight-no-cost.test.ts` | **with-api-tenant first test: "a roles route, token without tenant, two memberships → 409 tenant_selection_required" (fails: 403 today).** Then: no memberships → 403 `no_tenant` unchanged; a PIN `session_state: ended` token → 401 before any RPC; the RPC is never called when the token has a tenant (spy); an RPC error → 500 reported with the code only. `me-route`: `tenantCount` equals the list length; old keys unchanged; still offline-cacheable for owner, admin, waiter and not for chef. `me-tenants`: strict schema, `current` true only for the token's tenant, no cost-like key (guard), 401 when signed out. Existing `with-api*.test.ts` green |
| S7 | **`POST /api/me/tenant`** | **T3.H** (claim and aal parts) | `src/app/api/me/tenant/route.ts` (new); `src/server/tenancy/switch.ts` (new); `tests/app/api/me-tenant.test.ts` (new); `tests/integration/memberships.int.ts` (new); `tests/integration/helpers/memberships.ts` (new); `tests/guards/waiter-weight-no-cost.test.ts` | **me-tenant first test: "200 with the new tenant after select_tenant and one refreshSession on the same client" (fails: route missing).** Then each error of §3.4 row 4; strict body (`{tenantId, extra}` → 400); a PIN claim → 403 with no RPC call; the new token's tenant ≠ requested → 503 reported once; no tenant name in any log. **Integration (local stack, real Auth):** a login with owner rows in A and B signs in → no tenant claim; switch to A → token has A, `aal` unchanged; switch to B; two sign-ins of the same login hold A and B at once (AT4 end-to-end); with a TOTP factor (`e2e/helpers/totp.ts`), the switch keeps `aal2`; a PIN staff login (M11 helpers) still signs in and refreshes with its tenant (AT5 end-to-end) |
| S8 | **Client plumbing.** §3.5 | now (mocked server) | `src/lib/api/client.ts`; `src/components/use-me.ts`; `src/lib/tenancy/switch.ts` (new); `src/components/use-tenant-switch-listener.ts` (new); `src/app/(owner)/app-shell.tsx` (mount the listener); `tests/lib/api/client.test.ts`; `tests/components/use-me.test.ts`; `tests/lib/tenancy/switch.test.ts` (new); `tests/components/tenant-switch-listener.test.ts` (new) | **switch first test: "forgetUser runs before the POST and again after a 200, then a full load of the safe next path" (fails: module missing).** Then: offline → nothing called; 404/429/403/400 → one `forgetUser`, no navigation, the code returned; network error or 503 → second `forgetUser` and a full load of `/`; a `switched` message is posted on success; an unsafe `next` (`//evil.test`) loads `/`; the outbox is never cleared (the injected outbox spy is not called). `client`: 409 `tenant_selection_required` goes to `/login/scegli-locale?next=…`, never from a `/login` page. `use-me`: 409 → `selectTenant`; other states unchanged. Listener: a `switched` message causes one full load of `/`; unmount closes the channel |
| S9 | **`scripts/create-tenant.ts --existing-owner-id <uuid>`** (Q-S7) | T1.H (needs S3) | `scripts/lib/create-tenant.ts`; `scripts/create-tenant.ts`; `tests/scripts/create-tenant.test.ts` | **First test: "with --existing-owner-id no auth user is created and none is deleted when the RPC fails" (fails: unknown flag).** Then: the flag must be a uuid; `--owner-email` and `--existing-owner-id` are mutually exclusive; the RPC receives that id; output names the tenant id only. Secret key unchanged: `SUPABASE_SECRET_KEY` in the script's environment only |
| S10 | **UX builder: `/login/scegli-locale` and the header switcher** (§8) | after S6–S8 (mocked API allowed earlier) | as listed in §8 | The component tests of §8 (`tests/components/venue-picker.test.ts`, `tests/components/tenant-switcher.test.ts`); `m25b-preserves` page lists moved |
| S11 | **Acceptance e2e: switching clears the read cache before the first read of B** (AT7) | after S7, S10 | `e2e/tenant-switch.spec.ts` (new); `e2e/helpers/seed-memberships.ts` (new, fixture login with owner rows in "Osteria Demo A" and "Osteria Demo B") | Playwright on the production build (worker active): sign in, pick A, open `/tavoli` (cached), switch to B; the first `/api/tables` answer seen after the switch is B's (a B-only table name) and the worker cache has no A entry (`e2e/helpers/offline.ts`); going offline then shows B's cached tables, never A's; an op queued offline in A is shown as held in B and is sent after switching back to A |
| S12 | **Runbook and rollout notes** (§3.7) | after S11 | `docs/runbook.md` (subsection "SP2 rollout": smoke list, fix-forward query); this plan §11 | `tests/config/runbook.test.ts` green (no new secret row needed: SP2 adds no secret) |
| S13 | **Verification and hand-off.** PR description: what changed, the SP0 verdicts relied on (with their §10 rows), the rollout day, the fix-forward, open questions | after S12 | PR description | `npm run lint`, `npx tsc --noEmit`, `npm test`, `npx supabase test db`, `npx playwright test` green; coverage of new code ≥ 80 % (`npm run test:coverage`); `code-reviewer` PASS |

**Order that keeps tenant #1 working at every commit:** S1 (additive; tenant inserts unchanged thanks to the trigger), S2 (scratch only), S8
(client paths that no server answer triggers yet), then S3 (single-membership claims identical, proven by 003/085/340 in the same commit),
S4, S5, S6 (409 only for logins with two or more memberships, which do not exist in production until a script creates one), S7, S9, S10, S11,
S12.

### 5b. Variants

**V1 — Active tenant per login (no `session_id` dependency)** · Trigger: T1.H fails (§3.9) and the lead and founder amend ADR-038 ·
Replaces: S3's `app.session_tenant` and hook E1, S4's upsert key, S5, AT4's wording, S7's "two sign-ins hold A and B at once".

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `app.user_tenant (auth_id pk, tenant_id, selected_at, fk (tenant_id, auth_id) → app_user)` instead of `app.session_tenant`; hook E1 reads it by `user_id` (no `session_id`); same RLS and grants | migration of S3; `370_…` | 370: every §3.2 row with the selection keyed by login; a malformed or missing `session_id` changes nothing |
| V1.2 | `select_tenant` upserts by `auth.uid()`; no `session_missing`; throttle per login | migration of S4; `371_…`; `372_…` | 371: as S4 minus `session_missing`; 372: AT4 becomes "two sessions of one login follow the latest selection at their next token" |
| V1.3 | No purge step (one row per login, overwritten); S5 is not built | `tests/config/sp2-preserves.test.ts` | the file list has no `…_session_tenant_purge.sql`; 088 and 101 unchanged |
| V1.4 | `memberships.int.ts`: the second sign-in follows the first's switch after a refresh | `tests/integration/memberships.int.ts` | the integration test asserts the shared selection |
| V1.5 | ADR-038 change note (by the lead): per-login selection and its trade-off (two phones cannot be in two venues) | `docs/adr/adr-038-memberships-and-organisations.md` | `code-reviewer` reads the note against V1.1–V1.4 |

**V2 — A switch asks for the second factor again** · Trigger: T3.H's aal part fails (the refresh drops `aal2`) · Replaces: S7's "keeps `aal2`"
assertion; S8's success navigation.

| # | Step | Files | Test |
|---|---|---|---|
| V2.1 | `POST /api/me/tenant` returns `{tenantId, secondFactor}`, with `secondFactor` = `challenge` when the new claims are `aal1` and `mfa_gate()` answers `challenge`, else `ok` | `src/server/tenancy/switch.ts`; `tests/app/api/me-tenant.test.ts` | a TOTP owner's switch answers `challenge`; a factor-less owner and a chef answer `ok` |
| V2.2 | `switchTenant` sends `challenge` to `/login/codice?next=<safe next>` after the second `forgetUser` | `src/lib/tenancy/switch.ts`; `tests/lib/tenancy/switch.test.ts` | with `challenge` the full load goes to the code page with the encoded next; with `ok` as S8 |
| V2.3 | Integration: the switch keeps the session; the next tenant read is 403 `mfa_required` until the code is entered | `tests/integration/memberships.int.ts` | the integration asserts `aal1` after the switch and `aal2` after the code |

**V3 — Two PRs** · Trigger: Q-S1 answered "split" · Replaces: the single PR of S13.

| # | Step | Files | Test |
|---|---|---|---|
| V3.1 | PR A (`feat/sp2a-organisation`): S1 and S8 only; mergeable before SP0's hosted run | as those steps | `sp2-preserves.test.ts` lists exactly `20261207100000_organisation.sql`; the S1 and S8 tests |
| V3.2 | PR B (`feat/sp2b-memberships`): S2–S7, S9–S13, gated as §3.9 | as those steps | `sp2-preserves.test.ts` lists the four files; the S2–S13 tests |

**V4 — Organisation set explicitly, not by VAT** · Trigger: Q-S3 answered "explicit" · Replaces: S1's trigger and AT8's wording.

| # | Step | Files | Test |
|---|---|---|---|
| V4.1 | No trigger; `tenant.organisation_id` stays nullable; backfill as S1; service-role-only `public.set_tenant_organisation(p_tenant, p_organisation)` | migration of S1; `369_…` | 369: a new tenant has no organisation until set; the same VAT in two tenants is allowed; the function refuses `authenticated` and `anon` |
| V4.2 | `scripts/create-tenant.ts --organisation <uuid>` calls it | `scripts/lib/create-tenant.ts`; `tests/scripts/create-tenant.test.ts` | the flag calls the RPC after the tenant RPC; a bad uuid is refused before any call |

**V5 — A stale selection gives no tenant** · Trigger: Q-S4 answered "no fallback" · Replaces: the fallback of §3.2 for a found selection
whose membership is inactive.

| # | Step | Files | Test |
|---|---|---|---|
| V5.1 | When a selection exists but its row is inactive, the hook adds no tenant claim (E3 is skipped) | migration of S3; `370_…` | 370: selected membership deactivated, one other active → no tenant claim; the API then answers 409 and the person chooses again |

**V6 — No direct membership insert for `authenticated`** · Trigger: Q-S2 answered "revoke" · Replaces: S3's insert-policy guard.

| # | Step | Files | Test |
|---|---|---|---|
| V6.1 | `revoke insert on public.app_user from authenticated`; drop `app_user_insert` | migration of S3; `002_cross_tenant.test.sql:41–57` (re-pinned on purpose); 359 policy pin | 002: each former insert case → 42501 permission denied; `create_staff` still creates staff (`086_staff_management.test.sql` green) |

**V7 — Header wordmark from `/api/me` for everyone** · Trigger: Q-S5 answered "wordmark now" · Replaces: §8 item 2's "current venue in the
account control only".

| # | Step | Files | Test |
|---|---|---|---|
| V7.1 | `AppShellView` passes `{...VENUE_LAYER_DEFAULT, name: me.tenant.name}` to `HeaderBand` once `/api/me` has answered | `src/app/(owner)/app-shell.tsx`; `tests/components/app-shell.test.ts` | the wordmark shows the fixture tenant's name; while loading it shows `t("venue.name")`; `e2e/app-shell.spec.ts:28, 38, 48` green with a tenant #1 fixture named as the catalogue string |

**V8 — Organisation deferred to SP3** · Trigger: Q-S6 answered "defer" · Replaces: S1 (keeps only the VAT unique drop) and AT8's "in one
organisation".

| # | Step | Files | Test |
|---|---|---|---|
| V8.1 | S1 becomes `20261207100000_tenant_vat_not_unique.sql`: only `drop constraint tenant_vat_number_key` | migration; `369_…` | 369: two tenants with one VAT are accepted; no `platform` schema exists |

**V9 — No script flag before SP7** · Trigger: Q-S7 answered "wait for SP7" · Replaces: S9.

| # | Step | Files | Test |
|---|---|---|---|
| V9.1 | S9 is not built; `sp2-preserves.test.ts` pins `scripts/lib/create-tenant.ts` unchanged | `tests/config/sp2-preserves.test.ts` | the sha256 of the script equals main's |

**V10 — Retire SP0's local T3 after SP2** · Trigger: Q-S8 answered "retire" · Replaces: S2.

| # | Step | Files | Test |
|---|---|---|---|
| V10.1 | `sp0-spike.yml` no longer runs `03_memberships.sql`, self-check C or T3.L; SP2's 370–372 and `memberships.int.ts` cover them | `.github/workflows/sp0-spike.yml`; `tests/config/sp0-spike-workflow.test.ts` | the workflow config test expects the step list without 03, C and T3.L; the workflow run is green |

---

## 6. Risks and mitigations

**Security and privacy**
- **R1. Tenant #1 locked out by a hook defect.** E3 reproduces today's rule; E1 cannot raise; no new claim key; 003, 085, 340 unchanged in
  the same commit; staging first; a day without service; the fix-forward and its precondition query (§3.7).
- **R2. Foreign membership injection.** Dropping the unique would let an owner attach any known auth id to their tenant. Closed in the same
  migration by `app.auth_member_elsewhere` in `app_user_insert` (370; Q-S2, V6). The PIN trigger stops a PIN login from gaining a second row.
- **R3. Cross-tenant replay of queued ops.** Held on the phone (`sendable.ts:35`) and refused by the server (`apply_op.sql:146–148`); S11
  proves both. The outbox is never cleared.
- **R4. Stale reads of the previous venue.** `forgetUser()` before and after the switch; the worker's generation stops late stores
  (`sw.js:26`); S11 checks the first read after the switch.
- **R5. Other tabs on the same device.** They share the cookie; the `tenant-switch` broadcast reloads them (S8). Residual: a tab that misses
  the message (a browser without BroadcastChannel) gets its next answer as B; ids of A then answer 404 under RLS, and ops of A are held.
- **R6. Auth refresh budget.** All refreshes already run server-side from Vercel's shared egress (cookies are HttpOnly; ADR-010 consequences;
  `docs/go-live/rate-limits.md:16–18`; local limit `token_refresh = 150` per 5 min, `config.toml:210–211`). The 3-second per-session throttle
  in `select_tenant` bounds what one person can add. The hosted values are the founder's to read (platform plan §11).
- **R7. The wrong venue on screen.** The wordmark is the constant `t("venue.name")` until SP9 (`venue-layer.ts:99`). For logins with two or
  more memberships the account control shows the current venue's name from `/api/me` (§8); Q-S5, V7.
- **R8. Venue names visible at `aal1`.** `my_memberships` lists the caller's own venues and roles before the second factor (the choice must
  come first, §3.6). For an owner this reveals only their own venues to someone who already has the password. For the platform admin
  (every tenant, SP4) it would list all customers: **SP4 must require `aal2` before listing for `admin` holders** (carried to SP4).
- **R9. A break-glass MFA reset signs the person out everywhere.** `mfa_reset_service_begin` deletes all of the login's sessions
  (`20261201100200_mfa_admin.sql:97`), across tenants. Accepted: the factor belongs to the login.
- **R10. TOTP issuer.** `mfa_enrol_check` names the tenant where the factor was enrolled (`20261201100100_mfa_self.sql:196`); one factor
  serves every venue. Cosmetic for owners; SP4 sets "Costì" for `admin`.
- **R11. SP0 interplay.** The hosted run must apply `main` without SP2 (§3.9); S2 keeps `sp0-spike.yml` green on the branch.
- **R12. Migration timestamp collision.** Another branch could take `20261207*`; `sp2-preserves.test.ts` and the newest-migration pins turn
  CI red; renumber before merging.
- **R13. A table without `tenant_id` (`platform.organisation`).** Platform metadata, not tenant data; no API privilege; RLS on; SP3's named
  list (Q-S6, V8).
- **R14. Personal data.** `app.session_tenant` holds pseudonymous ids (session, login, tenant) for at most 31 days; logs carry codes only;
  the tenant id travels in the POST body, never in a URL. No new category of data, no new processor.

**Performance:** the hook adds at most two indexed lookups (`session_tenant` primary key; `app_user_auth_id_idx`); `withApi` calls
`my_memberships` only for tokens without a tenant; `/api/me` adds one indexed RPC. T4.H's numbers are recorded for the lead (§3.9). No
target number is promised.

**Dependencies (name, licence, why):** none added.

**Where every secret lives (new or changed):** none new. `scripts/create-tenant.ts` keeps using the Supabase secret key from the script's
environment (`SUPABASE_SECRET_KEY`, `src/lib/supabase/admin.ts:9–22`), as CLAUDE.md rule 2 allows; the hosted SP0 run's key lives only in the
session's proxy credential store (SP0 plan §3.11). No browser or user-facing route gains the secret key; `/api/me/tenant` uses the user's
session client.

---

## 7. Lead decisions

| ID | Question | Recommended default |
|---|---|---|
| **Q-S1** | One PR, draft until the SP0 verdicts, or two PRs (V3)? | **One PR** (CLAUDE.md rule 5: one milestone, one PR). S1, S2, S8 are built now and reviewed early; the PR leaves draft only after §3.9's verdicts |
| **Q-S2** | After the unique drop, how is the direct `app_user` insert kept safe: refuse a login that is a member elsewhere (default), or revoke the insert (V6)? | **The guard.** One condition, pgTAP 002 unchanged; SP4 narrows the roles (FD35) |
| **Q-S3** | Organisation: found or created by VAT number in a tenant trigger, or set explicitly (V4)? | **By VAT.** One VAT number is one legal entity; every existing insert path stays unchanged |
| **Q-S4** | A selection whose membership was deactivated: fall back to the no-selection rule, or give no tenant until the person chooses again (V5)? | **Fall back.** The membership check still runs; a person with one remaining venue keeps working |
| **Q-S5** | How does a multi-venue person see which venue they are in before SP9: the current venue's name in the account control (default), or the wordmark from `/api/me` for everyone (V7)? | **Account control, multi-venue logins only.** Tenant #1 sees no change |
| **Q-S6** | `platform.organisation` has no `tenant_id` (ADR-037's platform-metadata exception; ADR status "proposed"). Build it in SP2, or defer it to SP3 and only drop the VAT unique (V8)? | **Build it in SP2**, as the milestone row says, closed to every API role, with SP3's named-list test to follow |
| **Q-S7** | Before SP7's invitations, may DigiAlto give an existing owner a second venue with `scripts/create-tenant.ts --existing-owner-id` (S9), or wait for SP7 (V9)? | **Add the flag.** It reuses the service-role path already allowed in `scripts/` |
| **Q-S8** | SP0's scratch 03 on SP2's schema: make it idempotent (S2), or retire SP0's local T3 once SP2 lands (V10)? | **Idempotent.** The spike keeps re-proving T1–T3 locally on SP2's hook whenever migrations change |

### 7a. Decided by the lead

Decided 2026-11-14. All defaults accepted. Build S0, S1, S2 and S8 now; the PR stays draft until the hosted SP0 verdicts gate the rest in.

| ID | Decision |
|---|---|
| **Q-S1** | One PR, draft until the SP0 verdicts. Mark it ready only when it is gated in. Merge nothing SP2-related to main before the hosted run, which tests main without SP2 |
| **Q-S2** | The "member elsewhere" guard. pgTAP must show two things. First, an owner of B who inserts A's owner into B is refused, both by a direct `INSERT` and on every API path. Second, the one-membership trigger refuses a second membership for a PIN login. A person reaches a second tenant only through the service script (Q-S7 `--existing-owner-id`), and later through the SP3 console, never through a tenant role |
| **Q-S3** | Group by VAT number. VAT values come only from `docs/client-facts.md` or the tenant's own data; never seed a made-up one |
| **Q-S4** | Yes, as a defined product rule, not a silent fallback (Rule B). The hook drops the stale selection. If no tenant claim is left, the API answers 409 `tenant_selection_required` and the client shows the chooser. A test must prove the 409 happens; never land the user somewhere quietly |
| **Q-S5** | Yes. Only multi-venue logins show the venue name in the account control |
| **Q-S6** | Yes. `platform.organisation` stays closed to every API role: no grants to `anon` or `authenticated`, and RLS on anyway, with pgTAP proof |
| **Q-S7** | Yes |
| **Q-S8** | Yes |
| **F-4** | `legal_name` is nullable and stays empty for tenant #1. It is a client fact, so it is filled only from `docs/client-facts.md`. The lead asks the founder. F-1, F-2 and F-3 are with the founder |

**Lead, after the S1/S2/S8 review (2026-11-14):** the 365 pin move (127 → 128) is ratified and listed in §3.8. The organisation/VAT drift
through `service_role` is closed inside SP2: the S1 trigger also fires on `update of organisation_id, vat_number` and refuses, for every role, an
organisation whose VAT number is not the tenant's (`organisation_vat_mismatch`, pgTAP 369 §4b). `crypto.randomUUID` gets no fallback (staging
and production are HTTPS only, Rule B); `tabId()` throws a clear error when it is missing. `/login/scegli-locale` stays a 404 until S10.

The SP3 plan carries five items: `my_memberships` before the second factor needs aal2 for the platform admin; the wordmark stays a constant until SP9; a break-glass MFA reset signs the person out of every venue, and the console's confirm text says so; console sessions never open Realtime (an SP0 finding); and, as a **must and SP3's first step** (lead, 2026-11-14), the organisation-side VAT guard: a trigger on `platform.organisation` that refuses a `vat_number` change while any tenant points at the row, proven by pgTAP, with pgTAP 365's trigger count moved from 128 to 129 and ratified. Until SP3 the only writer of `platform` is migrations, which the lead reads before merging. Process: grep `e2e/` and `tests/` for every list SP2 extends.

**ADR-038 change note for the lead (after the SP0 run):** "T1 and T3 proven on <date> (SP0 §10)"; the key `(tenant_id, auth_id)` plus
`app_user_auth_id_idx`; the stale-selection rule (Q-S4); the insert guard (Q-S2); under V1, the per-login selection.

---

## 8. Hand-off to the UX builder (venue choice and switcher)

**Forbidden paths:** `supabase/**`, `src/server/**`, `src/app/api/**`, `public/sw.js`, `src/proxy.ts`, `next.config.ts`, CI (`.github/**`),
dependencies (`package.json`, the lockfile). Also do not change `src/lib/tenancy/switch.ts`, `src/lib/api/client.ts`, `src/components/use-me.ts`
or `src/lib/nav/nav-model.ts` (S8 owns the first three; the fourth is md5-pinned). If something is missing, ask the lead.

**What the API gives** (built in S6–S8):

| Source | Shape | Use |
|---|---|---|
| `useMe()` | `me.tenant.{id, name}`, **`me.tenantCount: number`**; new state `status: "selectTenant"` | show the switcher only when `tenantCount >= 2`; a missing `tenantCount` (an old cached reply) counts as 1 |
| `GET /api/me/tenants` via `apiJson` | `{ tenants: [{ id, name, role, current }] }` | the list; the role label with `t("role.<role>")` |
| `switchTenant(tenantId, { next })` from `@/lib/tenancy/switch` | `Promise<{ ok: true } \| { ok: false; code: string }>`; on success it reloads the page itself | the only way to switch. Codes: `offline`, `tenant_not_found`, `tenant_switch_too_soon`, `forbidden`, `invalid_request` |
| `useSyncView().mine` | number of the person's waiting ops | the pending-ops line |
| `useRequestLeave()` | the leave guard | ask before switching, as "Esci" does (`account-control.tsx:24`) |

**Build:**
1. `src/app/(public)/login/scegli-locale/page.tsx` and `venue-picker.tsx`: heading, one full-width button per venue (name, role label), the
   current one marked; loading, error with retry, empty (`home.noAccess`), offline states; the `next` search param passed to `switchTenant`
   unchanged (the function validates it); a `LogoutButton` below, as `/login/codice` has (`challenge-form.tsx:6`).
2. `src/components/nav/tenant-switcher.tsx`, placed in `AccountControl` (`account-control.tsx:13–36`) and in the laptop sidebar, rendered only
   when `tenantCount >= 2`: a button showing the current venue's name (`me.tenant.name`), opening a list of the other venues; a tap runs the
   leave guard, then `switchTenant`; while it runs, the button is busy and, when `mine > 0`, shows the pending line.
3. Strings in `src/lib/i18n/messages/it.ts` and `en.ts` (proposals; Italian first):
   - `tenantSwitch.title`: "Scegli il locale" / "Choose the venue"
   - `tenantSwitch.open`: "Cambia locale" / "Switch venue"
   - `tenantSwitch.current`: "Locale attuale: {name}" / "Current venue: {name}"
   - `tenantSwitch.busy`: "Cambio locale…" / "Switching venue…"
   - `tenantSwitch.offline`: "Serve la connessione per cambiare locale." / "You need a connection to switch venue."
   - `tenantSwitch.failed`: "Non è stato possibile cambiare locale. Riprova." / "Could not switch venue. Try again."
   - `tenantSwitch.tooSoon`: "Attendi qualche secondo e riprova." / "Wait a few seconds and try again."
   - `tenantSwitch.pending` (plural, with `tn` as `sync.logout.pending`): one: "{count} operazione in attesa resta su questo telefono e
     partirà quando torni in questo locale." / other: "{count} operazioni in attesa restano su questo telefono e partiranno quando torni in
     questo locale." English: "{count} waiting operation stays on this phone and is sent when you are back in this venue." / "{count} waiting
     operations stay on this phone and are sent when you are back in this venue."
4. `tests/config/m25b-preserves.test.ts`: add `login/scegli-locale` to `PAGES` (62) and to `ALLOWED_NEW_PUBLIC_PAGES` (`:81`), with the comment
   "added on purpose by SP2".

**Their tests:**
- `tests/components/venue-picker.test.ts`: one button per venue with the role label; the current one marked; a tap calls `switchTenant` with
  the id and the page's `next`; `offline`, `tenant_switch_too_soon` and error codes show the matching string; an empty list shows
  `home.noAccess`.
- `tests/components/tenant-switcher.test.ts`: hidden with `tenantCount` 1 or missing; visible with 2; shows the current venue name; the leave
  guard runs before `switchTenant`; the pending line appears only when `mine > 0`.
- Accessibility: the switcher is a button with an accessible name containing the venue; the list is keyboard-reachable; no horizontal scroll
  at 360 px.
- `e2e/tenant-switch.spec.ts` (S11) uses their screens: pick a venue on `/login/scegli-locale`, switch from the header.

---

## 9. Open questions for the founder

- **F-1.** Which day without service the production rollout of S3 happens on (§3.7). No date is proposed here.
- **F-2.** ADR-038 is "proposed": accept it (with the lead's change note after SP0) before the SP2 PR merges.
- **F-3.** The slot for the hosted SP0 run (T1–T5); SP2 cannot merge before it (§3.9).
- **F-4.** Tenant #1's organisation is named after the tenant until SP3's console can edit it. If the legal entity's name should differ, the
  founder gives it (it is not in `docs/client-facts.md`).

No third-party provider is chosen or needed by SP2, so there are no prices, fees or retention questions for a provider.

---

## 10. Sources

Repository files only, cited by path and line above. No web source was needed: every statement about the hook input, `session_id`, refresh
and `aal` rests on the platform plan's sources (S1 there: the Supabase custom access token hook docs, read 2026-11-13) and is **unverified
until SP0's hosted verdicts** (T1.H, T3.H), which this plan gates on.

---

## 11. Build notes

(empty until the build: the SP0 verdicts relied on, T4.H's numbers, the re-pinned md5 and catalogue values, and the rollout date, filled in by
the builder and the lead in S12)

### S1 to S8 build notes (builder, 2026-11-14)

- **Backfill of `20261207100000_organisation.sql`, proven by hand** (pgTAP cannot run "before the migration"; every build applies it to an empty `tenant` table). Scratch database: native PG16, auth/storage/platform shims, every migration before `20261207100000`, then two tenants with different VAT numbers (the way tenant #1 exists), then the migration with `psql -v ON_ERROR_STOP=1 -f`. Result: each tenant got its own organisation (name = tenant name, VAT = tenant VAT, `legal_name` NULL), `tenant.organisation_id` is `not null`, two organisations in all.
- **The same-VAT branch of the backfill (`distinct on`) cannot occur in production**: before this migration `tenant_vat_number_key` holds, so a database cannot hold two tenants with one VAT. It was exercised once on a scratch database with that constraint dropped by hand before the data went in: A and B (same VAT) shared one organisation named after the older tenant A, C (other VAT) got its own.
- **pgTAP 365 trigger count, 127 → 128:** re-pinned in commit 3d103965 for `tenant_set_organisation`; not in the first §3.8 table, ratified by the lead and added to it. The drift guard below extends the same trigger, so the count stays 128.
- **Organisation/VAT drift guard (lead):** `tenant_set_organisation` now fires `before insert or update of organisation_id, vat_number` and raises `organisation_vat_mismatch` (P0001) when the organisation's VAT number is not the tenant's, for every role. A tenant changes legal entity only by updating both columns together. pgTAP 369 §4b proves it (red before the change: 5 of 34 failed, including a mismatched tenant left by `service_role`); 369 now proves the tenant's own VAT check with the trigger disabled inside the test transaction, since the trigger refuses a bad row before the checks run. Full pgTAP: 293 files green, no pin moved. Scope: the guard is on the tenant side. `platform.organisation.vat_number` can still be changed by the migration owner (no API role can reach `platform`); a guard there would add a trigger and move the 365 count again, so it is left to the lead (SP3's console is the first writer of `platform`). A tenant can move only to a VAT number that already has an organisation; a future "change the venue's VAT number" feature needs a privileged procedure. `tabId()` throwing means the app shell does not run on a plain-http origin (LAN testing on a phone): test on HTTPS.
- The re-pinned md5 and catalogue values so far: pgTAP 359 constraints `614,46cfcd4c…` to `613,599e87bc…` (`tenant_vat_number_key` removed), indexes `205,3526abba…` to `204,ce37649d…` (its unique index).
