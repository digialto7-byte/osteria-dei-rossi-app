# ADR-037 — A platform layer outside tenant RLS, and DigiAlto's standing, audited `admin` membership in every tenant

- **Status:** proposed
- **Date:** 2026-11-13 · **Decided by:** founder (to accept with `docs/plans/2026-11-13-platform-saas.md`, §2; founder decisions of
  2026-11-13 applied: first set plan §0a, second set plan §0b)
- **Amends:** ADR-003 ("Admin access: an explicit `app_user` row per tenant for DigiAlto admins"; and the rejected alternative
  "separate Postgres roles", see below)
- **File name** kept as `adr-037-platform-layer-and-support-access.md` so that links stay valid; the title changed with the note below.

> **Change note, 2026-11-13 (second set of founder decisions, relayed by the lead; plan §0b).** The first version of this ADR decided
> that DigiAlto reaches a tenant only through **support grants**: a time-boxed, read-only `kind = 'support'` membership the owner
> approves, with a banner, an expiry job and a second function writing `auth.sessions` (`app.support_end_sessions`, widening #79's
> pgTAP 341). The founder replaced that with **standing `admin` access in every tenant for one platform admin account** (FD28–FD30),
> with full audit visible to each owner, disclosure in the venue contract and privacy terms, a required second factor, and a platform
> audit entry on attach. This ADR is rewritten to match; the dropped parts are listed under "What the second set removed". The status
> stays **proposed**.

## Context
- The founder decided on 2026-11-13 that the app becomes a DigiAlto SaaS product, named **Costì** (FD27, second set), for other venues.
  DigiAlto then needs to create and manage tenants, see their health and work inside them, across many tenants.
- **Ownership (plan FD1, decided 2026-11-13):** DigiAlto owns the platform and sells it; Osteria Dei Rossi is a customer and tenant #1
  under a short written agreement. DigiAlto and the osteria have the same owner (the founder's 2026-10-22 decision, relayed by the lead).
  This answers the ownership question ADR-003 left open (its plan Q11).
- **Platform admin (FD28, second set):** one overall platform admin, DigiAlto's founder account. No e-mail address is written in the
  repo (it is public); the account is identified at provisioning by a script argument, by `PLATFORM_ADMIN_EMAIL` (held only in
  Vercel/GitHub environments), or by a `platform.staff` row the founder creates.
- **Access model (FD29, FD30, second set):** that account has standing `admin` in every tenant; no ask-and-allow support access. Every
  action it takes in a tenant is audited as "DigiAlto" and visible to that tenant's owner through a filter in the audit view; the access
  is disclosed in the venue contract and privacy terms (legal adviser); TOTP is required; a platform-level audit entry is written when the
  account is attached to a new tenant. Each venue's owner is its own admin and the only venue-level admin besides DigiAlto; `admin` is
  redefined as "the platform admin's role inside a tenant".
- Today DigiAlto reaches a tenant only through an explicit `app_user` row with role `admin` in that tenant, with "no global bypass"
  (ADR-003, which already names the roles "owner, chef, waiter and admin (DigiAlto)"); the policy comment "Only an admin (DigiAlto) can
  create another admin" (`20261021120000_tenancy_baseline.sql` lines 96–103) and the comments "Admin (DigiAlto support)"
  (`20261022150100_alert.sql` line 162; `20261023100600_allergen_confirm_owner_only.sql` line 2) show the same meaning. One login belongs
  to one tenant (`app_user.auth_id` unique, baseline line 31).
- ADR-003 rejected "Separate Postgres roles per app role, with column GRANTs" because "Supabase sessions all map to `authenticated`,
  so it would need role switching or custom connection handling".
- `CLAUDE.md` rule 6: every table has `tenant_id` and RLS; roles are enforced in Postgres; waiters never see costs. Rule 2: the Supabase
  secret key only in `/api/cron/*`, `scripts/` and `src/server/staff-auth/privileged.ts`.
- PR #79 (ADR-036, TOTP, merged) puts an `aal` gate inside `app.tenant_id()`, `app.role()` and `app.app_user_id()`
  (`20261201100000_mfa_gate.sql` lines 65–99). Its rule `app.mfa_needs_aal2` (lines 36–47) gates an `admin` when the tenant's mode is not
  `off` and (it has a verified factor or the mode is `required`); the default mode after its migration is `enrolled` (line 17). Its
  `set_mfa_enforcement` and break-glass `mfa_reset_service_begin/failed` require an active `admin` of the tenant as actor
  (`20261201100200_mfa_admin.sql` lines 53, 88, 118); `mfa_reset_service_begin` deletes the target's `auth.sessions` (line 97) and is the
  only `public`/`app` function writing `auth.*` (pgTAP 341).
- Supabase's access token hook can add, remove or change claims, including `role`, before a token is issued (Supabase docs,
  `apps/docs/content/guides/auth/auth-hooks/custom-access-token-hook.mdx`, read 2026-11-13 on GitHub). Supabase's RLS guide says to
  always name the role a policy applies to with `to` (`.../database/postgres/row-level-security.mdx`, same date). Whether the hosted
  Data API, Storage and Realtime accept a custom role claim is **not verified** (plan spike T2).

## Decision
- **Platform staff** live in `platform.staff` (schema `platform`, not exposed by the Data API) with roles `platform_admin` and
  `platform_support`. A partial unique index allows **one** active `platform_admin` (FD28); no account holds `platform_support` now, and
  a `platform_support` user can never hold a tenant membership. Every platform action needs `aal2` and writes a row to the append-only
  `platform.audit_event` (codes and ids only, never an e-mail address).
- **One account, two modes.** The platform admin account is the only auth user that is both platform staff and a tenant member, and all
  of its memberships are `role = 'admin'` (triggers on `app_user` and `platform.staff`). A session is in one mode at a time:
  - **console mode** (`public.select_console()`, row in `platform.console_session`): the hook gives the token the dedicated NOLOGIN
    Postgres role `platform_staff`, which holds no grant on any `public` table and `execute` only on `public.platform_*` definer
    functions returning tenant **metadata**; the `(platform)` route group is served only on a console host;
  - **tenant mode** (`public.select_tenant(id)`, ADR-038): an ordinary `authenticated` token with that tenant's claims, under the same
    policies as any `admin`.
- **Standing membership.** `public.platform_attach_admin(p_tenant)` gives the account its `admin` row (display name "DigiAlto") in a
  tenant and writes a **platform audit entry `platform_admin.attached`** plus a tenant `audit_event` row the owner can see. It runs for
  every new tenant inside `platform_create_tenant`, and by script for existing ones. `public.platform_detach_admin` (service role, by
  script, on the owner's written request or at contract end) deactivates the row; nothing is deleted. The owner has no in-app switch to
  remove or pause DigiAlto (plan FD33 default; plan V16 adds one).
- **`admin` is the platform admin's role inside a tenant (FD30).** No tenant session can create an `admin` row (the `app_user_insert`
  policy allows only `chef` and `waiter`); only `platform_attach_admin` can. The owner is the venue's admin and inherits nothing that is
  exclusive to `admin` today (plan §2.5). Owner-only data stays owner-only for DigiAlto too (fixed costs, alerts, allergen confirmation).
  A console health finding (`admin_row_foreign`) reports any active `admin` row that is not the platform admin account's.
- **Recording (FD29; FD32 default).** Writes carry the DigiAlto row as `created_by` (existing columns). `select_tenant` writes one tenant
  `audit_event` row `app_user.platform_admin_entered` in Postgres. Each `/api/*` request of the account writes one
  `public.platform_access_event` (method and path pattern, ids removed, no query, no body). The owner's activity log gains the filter
  "Solo DigiAlto" (`public.audit_log(..., p_actor => 'digialto')`). A request sent straight to the Data API with the account's token is
  not in the per-request log; its entry and writes are (accepted residual).
- **Second factor (FD29; FD31 default).** Under #79 as built the account needs `aal2` at every `required` tenant, and at `enrolled`
  tenants only while it keeps a verified factor, and never at `off` tenants. Decided default: `app.mfa_needs_aal2` gates `admin` in every
  mode, `off` included; `mfa_unenrol_check` refuses removing the account's last factor in every mode; bootstrap and attach refuse an
  account without a verified factor. Because `admin` is the platform admin account by construction, this needs no extra lookup. The
  kill switch `off` then affects owners only. The account's TOTP issuer is "Costì".
- **#79's actor.** The account's `admin` row exists in every tenant, so `set_mfa_enforcement` and `mfa_reset_service_begin/failed` work
  everywhere with their existing `p_actor` rule; the scripts default `--actor` to that row. No new argument, no new `auth.*` writer:
  pgTAP 341's allowlist stays #79's.
- **Invariant scope, made explicit:** "every table has `tenant_id` and RLS" applies to tenant data. The `platform` schema's catalogue
  tables (`staff`, `organisation`, `plan`, `plan_feature`, `feature`, `audit_event`, `notice`, `console_session`) are not tenant data;
  they have RLS on, no grant to `anon` or `authenticated`, and a pgTAP test lists them by name so no tenant table can hide there. Tenant
  data that lives outside `public` (`app.entitlement_observation`, `app.session_tenant`) carries `tenant_id` and RLS and is checked by its
  own catalogue test, because pgTAP 001 checks `public` only. `public.platform_access_event` is ordinary tenant data in `public`.

### What the second set removed (from the first version of this ADR)
- `support_grant`, `platform_request_support`, `approve_support_grant`, `revoke_support_grant`, the owner's consent screen, the support
  banner and the maximum grant duration (plan FD7, FD8: superseded).
- `app_user.kind = 'support'`, `support_grant_id` and the grant check inside the membership helpers.
- The `support-grant-expiry` job and `app.support_end_sessions`; pgTAP 341 is **not** widened.
- The read-only support scope and the write gate's `support_read_only`.
- `audit_event.created_by_staff`, `p_actor_staff` and `--staff` (plan FD26: superseded).
- Separate console logins for DigiAlto people (plan FD25: superseded) and the one-login exemption variant (plan V15: withdrawn).
- Kept unchanged: the `platform` schema, the `platform_staff` role and console host, the metadata whitelist, the platform audit, the
  "no global bypass" rule.

### How this amends ADR-003
- **DigiAlto access.** ADR-003 decided "an explicit `app_user` row per tenant for DigiAlto admins. There is no global bypass." Both parts
  stay: one explicit `admin` row per tenant, no `bypassrls`, no table grant for console sessions. What changes: the rows belong to **one**
  platform admin account (one login across tenants, ADR-038), every tenant gets one automatically at creation with a platform audit entry,
  the role `admin` is reserved to that account, and its actions are labelled DigiAlto in the owner's activity log.
- **The rejected "separate Postgres roles" alternative.** ADR-003 rejected one Postgres role *per app role* to separate *tenant users
  by column grants*, because Supabase sessions map to `authenticated` and role switching would be needed. This ADR does not reopen that:
  tenant roles (owner, admin, chef, waiter) all stay on `authenticated` with policies and split cost tables, exactly as ADR-003 decided. It
  adds **one** role for console sessions, which are not tenant sessions at all, holding **no** table grant, so no column-level design is
  involved. ADR-003's objection (role switching) is the open risk, and it is tested before any build (spike T2); if the hosted stack
  refuses the role, the plan falls back to V2, which is ADR-003's own model (`authenticated` plus a claim).

## Alternatives
- **Consented, time-boxed, read-only support grants** (this ADR's first version). Pros: no standing access; the owner decides each
  entry. Cons: friction for every support case; a second `auth.*` writer; more moving parts. Why not: replaced by the founder (FD29) with
  standing access plus audit, disclosure and a second factor.
- **Separate console logins for each DigiAlto person** (first-version default). Why not: one platform admin account (FD28) with two
  modes removes the need.
- **Separate Supabase project for the console.** Pros: physical separation. Cons: the console then needs the product project's secret key
  to read metadata, widening rule 2. Why not: kept as the plan's variant V1.
- **Console sessions as `authenticated` with a claim checked by every policy.** Pros: no custom Postgres role; stays inside ADR-003's
  model. Cons: one missing check leaks to console sessions. Why not: kept as the fallback V2 if the custom role is not supported.
- **Impersonation (minting a session as the venue user).** Pros: DigiAlto sees exactly what the user sees. Cons: the audit names the
  wrong person; silent; needs session minting the project plan already rejected. Why not: every DigiAlto action must be labelled as such.
- **A `bypassrls` role for DigiAlto.** Why not: contradicts ADR-003's "no global bypass"; the standing access goes through one ordinary
  `admin` row per tenant, under the same policies.
- **A trigger reserving `role = 'admin'` to the platform admin account.** Pros: the strongest guarantee. Cons: 148 pgTAP files contain
  the literal `'admin'`, nearly all inserting their own fixture admin users directly, and the demo seed inserts one. Why not: the creation
  paths are closed instead (policy, attach function) and the `admin_row_foreign` finding reports anything else.

## Consequences
- Good:
  - A missing or wrong tenant policy cannot leak to console sessions (no table grants for `platform_staff`).
  - DigiAlto can help any venue at once, and every action it takes there carries its own identity ("DigiAlto") in the existing audit
    columns, visible to the owner.
  - #79's break-glass scripts work at every tenant without new arguments; pgTAP 341 keeps one `auth.*` writer.
  - Fewer moving parts than support grants (no grant table, no expiry job, no banner, no second `auth.*` writer).
- Bad / accepted trade-offs:
  - **One account reaches every tenant.** It is the strongest credential in the system; the controls are the second factor everywhere
    (FD31), the owner-visible audit, the attach audit and the disclosure. Its loss would expose every tenant.
  - Standing access must be disclosed and agreed contractually (legal adviser, FD22); without that the venue cannot know.
  - The owner cannot switch DigiAlto off in the app (FD33 default); ending it is a script on request or at contract end.
  - Direct Data API reads with the account's token are not in the per-request log.
  - The hook gains a console mode and is re-pinned (ADR-036's pin changes on purpose).
  - Secret-key holders can still read everything; this is organisational, stated in the DPA, and scripts write platform audit rows.
  - At tenant #1 the owner is also DigiAlto's owner (FD1); the platform admin account and the owner's login must be two different auth
    users. The controls record roles, not distinct people.
- What would make us revisit this:
  - Spike T2 shows the hosted stack refuses a custom role claim (→ V2).
  - A customer requires DigiAlto to be physically separated from its data (→ V1 or V10), or refuses standing access contractually.
  - DigiAlto needs a second platform admin (FD28 revisited; the partial unique index changes).
  - The founder revisits FD31, FD32 or FD33 (→ SP4 re-planned, or V16).
  - Supabase changes how the hook or the `role` claim works.
