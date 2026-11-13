# ADR-038 — One login, many tenant memberships; the active tenant is chosen per session; venues are tenants grouped by organisation

- **Status:** Proposed
- **Date:** 2026-11-13 · **Decided by:** founder (to accept with `docs/plans/2026-11-13-platform-saas.md`, §3.4)

## Context
- The SaaS must serve groups: one owner, many venues (founder, 2026-11-13). The project plan put a "multi-venue UI (tenant switcher)" in
  Phase 3 (M43) with the test "data never mixes".
- Today `app_user.auth_id` is unique (`20261021120000_tenancy_baseline.sql` line 31) and the access token hook selects the single active
  membership (same file lines 117–121; PIN version `20261025100500_access_token_hook_pin.sql` lines 97–101). `tenant.vat_number` is
  unique (line 17), so two venues of one company cannot both be tenants.
- ADR-003 keeps every row scoped by `tenant_id` and RLS; ADR-010 PIN accounts are bound to one tenant and one enrolled device.
- Supabase's token hook receives the current claims and the authentication method and runs before every token is issued; `session_id`
  is a required claim (Supabase docs `.../auth/auth-hooks/custom-access-token-hook.mdx`, read 2026-11-13 on GitHub). That `session_id`
  is present in the hook's input for every authentication method is **not verified** (plan spike T1).
- The offline read cache is keyed by path, not tenant (`src/lib/api/offline-cache.ts` line 8); `forgetUser()` exists.

## Decision
- **A venue is a tenant.** Nothing in tenant data spans tenants. A customer company is an `platform.organisation` that owns tenants and
  holds the subscription; its owner gets an `owner` membership in each tenant.
- `app_user` uniqueness becomes `(tenant_id, auth_id)`. The active tenant of a session lives in `app.session_tenant (session_id, auth_id,
  tenant_id, mode, selected_at)`, written only by `public.select_tenant(id)` after a membership check; the hook reads it by the token's
  `session_id`. A session with no selection and exactly one membership gets that tenant (today's behaviour); with several, it gets none
  until one is selected.
- PIN accounts keep exactly one membership (check) and their hook branch unchanged.
- `tenant.vat_number` is no longer unique; the legal entity's VAT number sits on the organisation, and the tenant keeps a copy for the
  extraction buyer check.
- Switching tenant on a device clears the offline read cache (`forgetUser()`) first.
- `app.session_tenant` is auth-session state, not tenant data; it has RLS on and no API grant, and it is named in the plan's pgTAP list of
  non-tenant tables.

## Alternatives
- **One auth user per tenant (today's model) with a picker that signs in again.** Pros: no hook change. Cons: several passwords and TOTP
  factors per person; DigiAlto staff would need one account per tenant. Why not: poor for groups and support.
- **Active tenant per user, not per session (e.g. in `app_metadata`).** Pros: simpler storage. Cons: two devices of one person cannot be
  in two venues; a switch on one phone changes the other. Why not: owners of two venues use two phones at once.
- **A cross-tenant "group" role in RLS.** Pros: consolidated reads in one query. Cons: every policy gains an organisation branch and
  isolation depends on it. Why not: per-tenant isolation is the core guarantee; consolidated reports stay a separate definer (plan V7).
- **A tenant id passed by the client per request.** Why not: the hook never trusts incoming claims; tenant choice must be server-side.

## Consequences
- Good:
  - Multi-venue owners and DigiAlto support use one login with one TOTP setup.
  - RLS and every existing policy stay as they are.
  - Replaces milestone M43 with less new surface.
- Bad / accepted trade-offs:
  - The hook changes again (after ADR-036); every hook test is re-run and the pin updated on purpose.
  - A switch costs a session refresh.
  - Spike T1 must pass before the build.
- What would make us revisit this:
  - T1 fails (no `session_id` on some authentication method).
  - Supabase adds native organisation or multi-tenant membership support.
  - Consolidated cross-venue reporting becomes a core need (→ plan V7 or a group read model).
