# ADR-038 — One login, many tenant memberships; the active tenant is chosen per session; venues are tenants grouped by organisation

- **Status:** proposed
- **Date:** 2026-11-13 · **Decided by:** founder (to accept with `docs/plans/2026-11-13-platform-saas.md`, §3.4 and §2.4)
- **Amends:** ADR-003 (the hook's claim source becomes the session's selected membership; DigiAlto's per-tenant rows; see below)

> **Change note, 2026-11-13 (second set of founder decisions, relayed by the lead; plan §0b).** DigiAlto's access is no longer a
> support membership that exists only while an owner's grant is valid: one platform admin account holds a standing `admin` membership in
> every tenant (FD28–FD30, ADR-037). That account is the main user of this ADR's mechanism. Changes here: `app.session_tenant` loses its
> `mode` column (console mode moves to `platform.console_session`, ADR-037); the "DigiAlto's per-tenant rows" amendment is rewritten; the
> check of the gate against the current hook and helpers is added under Context. The status stays **proposed**.

## Context
- The SaaS must serve groups: one owner, many venues (founder, 2026-11-13). The project plan put a "multi-venue UI (tenant switcher)" in
  Phase 3 (M43) with the test "data never mixes". The second set adds DigiAlto's platform admin account, which holds an `admin`
  membership in every tenant (FD29).
- Today `app_user.auth_id` is unique (`20261021120000_tenancy_baseline.sql` line 31). The access token hook strips incoming tenant claims
  (`20261025100500_access_token_hook_pin.sql` lines 64–66), keeps a separate branch for PIN accounts (lines 70–95), and for e-mail
  accounts selects *the* active membership by `auth_id` (lines 97–101) and adds its `tenant_id` and role (lines 103–106). With several
  active rows a PL/pgSQL `select … into` without `strict` would take one row in no defined order, so the uniqueness is what keeps this
  correct today. `tenant.vat_number` is unique (baseline line 17), so two venues of one company cannot both be tenants.
- The gate: `app.tenant_id()`, `app.role()` and `app.app_user_id()` select the active `app_user` row with `auth_id = auth.uid()` and
  `tenant_id` equal to the token's `tenant_id` claim, plus #79's `aal` condition (`20261201100000_mfa_gate.sql` lines 69–74, 81–86,
  93–98). Every policy compares a row's `tenant_id` with the scalar `(select app.tenant_id())` (e.g. baseline lines 85–94).
- ADR-003 keeps every row scoped by `tenant_id` and RLS; "a Custom Access Token Hook adds `tenant_id` and `app_role` claims from
  `app_user`"; DigiAlto reaches a tenant through "an explicit `app_user` row per tenant"; and it rejected separate Postgres roles per app
  role because all Supabase sessions map to `authenticated`. ADR-010 PIN accounts are bound to one tenant and one enrolled device.
- Supabase's token hook receives the current claims and the authentication method and runs before every token is issued; `session_id`
  is a required claim (Supabase docs `.../auth/auth-hooks/custom-access-token-hook.mdx`, read 2026-11-13 on GitHub). That `session_id`
  is present in the hook's input for every authentication method is **not verified** (plan spike T1). A token refresh keeps the
  session's `aal` (TOTP plan `docs/plans/2026-11-12-p2-1-totp.md` line 371).
- The offline read cache is keyed by path, not tenant (`src/lib/api/offline-cache.ts` line 8); `forgetUser()` exists.

## Decision
- **A venue is a tenant.** Nothing in tenant data spans tenants. A customer company is a `platform.organisation` that owns tenants and
  holds the subscription; its owner gets an `owner` membership in each tenant.
- `app_user` uniqueness becomes `(tenant_id, auth_id)`, **in the same migration** as the hook change below. The active tenant of a
  session lives in `app.session_tenant (session_id, auth_id, tenant_id, selected_at)`, written only by `public.select_tenant(id)` after a
  membership check; the hook reads it by the token's `session_id`, re-checks that the membership is active, and only then adds
  `tenant_id` and `app_role`. A session with no selection and exactly one membership gets that tenant (today's behaviour); with several,
  it gets none until one is selected. The platform admin account always has several and always selects. A session with a
  `platform.console_session` row is in console mode instead (ADR-037).
- **The gate keeps its form.** `app.tenant_id()`, `app.role()`, `app.app_user_id()` and every policy are unchanged in shape: with
  `(tenant_id, auth_id)` unique there is at most one row per claim, so each statement sees one tenant. RLS stays per tenant: no policy
  gains an organisation or platform branch, and a switch is a new token from the server, never a client-supplied tenant id.
- PIN accounts keep exactly one membership (check) and their hook branch unchanged.
- `tenant.vat_number` is no longer unique; the legal entity's VAT number sits on the organisation, and the tenant keeps a copy for the
  extraction buyer check.
- Switching tenant on a device clears the offline read cache (`forgetUser()`) first.
- When the platform admin account selects a tenant, `select_tenant` writes one tenant `audit_event` row `app_user.platform_admin_entered`
  (ADR-037).
- `app.session_tenant` is auth-session state outside `public`; it carries `tenant_id` (never null), has RLS on and no API grant, and it is
  named in the plan's catalogue test for tenant-linked tables outside `public` (pgTAP 001 checks `public` only).

### How this amends ADR-003
- **Claims.** ADR-003's hook still adds `tenant_id` and `app_role` from `app_user`; what changes is *which* row: the membership the
  session selected, instead of the user's only row. Every policy, `app.tenant_id()` and `app.role()` keep ADR-003's form.
- **No new Postgres roles for tenant users.** All tenant memberships, whichever tenant is selected, map to `authenticated`, as ADR-003
  decided when it rejected separate Postgres roles per app role. (ADR-037 adds one role for console sessions, which are not tenant
  sessions, and explains why that does not reopen ADR-003's rejection.)
- **DigiAlto's per-tenant rows (second set).** ADR-003's "explicit `app_user` row per tenant for DigiAlto admins" needed one login per
  tenant. With per-session selection, DigiAlto's **one** platform admin account holds one explicit, standing `admin` row per tenant and
  reaches each tenant by selecting it. It is still an explicit per-tenant row and still no global bypass. (The first version of this ADR
  said the row would be a `kind = 'support'` row existing only while an owner's grant was valid; the founder replaced that, plan FD29.)

## Alternatives
- **One auth user per tenant (today's model) with a picker that signs in again.** Pros: no hook change. Cons: several passwords and TOTP
  factors per person; DigiAlto's platform admin would need one account per tenant. Why not: poor for groups and impossible to manage for
  the platform admin.
- **Active tenant per user, not per session (e.g. in `app_metadata`).** Pros: simpler storage. Cons: two devices of one person cannot be
  in two venues; a switch on one phone changes the other. Why not: owners of two venues use two phones at once.
- **A cross-tenant "group" or "platform" role in RLS.** Pros: consolidated reads in one query; DigiAlto would not need to switch. Cons:
  every policy gains a branch and isolation depends on it. Why not: per-tenant isolation is the core guarantee; consolidated reports stay a
  separate definer (plan V7), and DigiAlto's cross-tenant view is the metadata-only console (ADR-037).
- **A Postgres role per tenant or per app role, switched per session.** Pros: grants instead of policies. Cons: exactly the role
  switching ADR-003 rejected; the role count grows with tenants. Why not: ADR-003's reasons still hold.
- **A tenant id passed by the client per request.** Why not: the hook never trusts incoming claims; tenant choice must be server-side.

## Consequences
- Good:
  - Multi-venue owners and DigiAlto's platform admin use one login with one TOTP setup.
  - RLS and every existing policy stay as they are.
  - Replaces milestone M43 with less new surface.
- Bad / accepted trade-offs:
  - The hook changes again (after ADR-036); every hook test is re-run and the pin updated on purpose.
  - A switch costs a session refresh (no new second-factor challenge: the refresh keeps `aal`).
  - Spike T1 must pass before the build.
  - The platform admin account's switcher lists every tenant; a search in the switcher is needed once tenants are many (not sized here).
- What would make us revisit this:
  - T1 fails (no `session_id` on some authentication method).
  - Supabase adds native organisation or multi-tenant membership support.
  - Consolidated cross-venue reporting becomes a core need (→ plan V7 or a group read model).
