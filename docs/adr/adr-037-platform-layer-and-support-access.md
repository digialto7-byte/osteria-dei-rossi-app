# ADR-037 — A platform layer outside tenant RLS, and support access only by the tenant's time-boxed consent

- **Status:** Proposed
- **Date:** 2026-11-13 · **Decided by:** founder (to accept with `docs/plans/2026-11-13-platform-saas.md`, §2)

## Context
- The founder decided on 2026-11-13 that the app becomes a DigiAlto SaaS product for other venues. DigiAlto then needs to create and
  manage tenants, see their health and give support, across many tenants.
- Today DigiAlto reaches a tenant only through an explicit `app_user` row with role `admin` in that tenant, with "no global bypass"
  (ADR-003); the policy comment "Only an admin (DigiAlto) can create another admin" (`20261021120000_tenancy_baseline.sql` lines 96–103)
  shows that the tenant role `admin` means DigiAlto. One login belongs to one tenant (`app_user.auth_id` unique, line 31).
- `CLAUDE.md` rule 6: every table has `tenant_id` and RLS; roles are enforced in Postgres; waiters never see costs. Rule 2: the Supabase
  secret key only in `/api/cron/*`, `scripts/` and `src/server/staff-auth/privileged.ts`.
- PR #79 (ADR-036, TOTP) puts an `aal` gate inside `app.tenant_id()`, `app.role()` and `app.app_user_id()`.
- Supabase's access token hook can add, remove or change claims, including `role`, before a token is issued (Supabase docs,
  `apps/docs/content/guides/auth/auth-hooks/custom-access-token-hook.mdx`, read 2026-11-13 on GitHub). Supabase's RLS guide says to
  always name the role a policy applies to with `to` (`.../database/postgres/row-level-security.mdx`, same date). Whether the hosted
  Data API, Storage and Realtime accept a custom role claim is **not verified** (plan spike T2).
- Support must be audited, time-boxed and consented by the tenant, never silent (founder requirement, 2026-11-13).

## Decision
- **Platform staff** live in `platform.staff` (schema `platform`, not exposed by the Data API) with roles `platform_admin` and
  `platform_support`. In console mode the hook gives them a dedicated NOLOGIN Postgres role `platform_staff` that holds no grant on any
  `public` table and `execute` only on `public.platform_*` definer functions returning tenant **metadata**. Every platform action needs
  `aal2`, and writes a row to the append-only `platform.audit_event`. Console screens are a `(platform)` route group served only on a
  console host.
- **Support access** is a tenant `app_user` row of `kind = 'support'` (role `admin`, read-only) tied to a `support_grant` the tenant's
  owner approves for a limited time. The grant is checked inside the membership helpers at every statement, so expiry and revocation act
  on the next query. All tenant users see a banner while it is active. Grant events go to the tenant's `audit_event` and to the platform
  audit. There is no "log in as user".
- A platform staff auth user cannot be an ordinary member of any tenant (triggers both ways).
- **Invariant scope, made explicit:** "every table has `tenant_id` and RLS" applies to tenant data. The `platform` schema's catalogue
  tables (`staff`, `organisation`, `plan`, `plan_feature`, `feature`, `audit_event`, `notice`) are not tenant data; they have RLS on, no
  grant to `anon` or `authenticated`, and a pgTAP test lists them by name so no tenant table can hide there.

## Alternatives
- **Keep DigiAlto as `admin` rows in every tenant.** Pros: nothing to build. Cons: standing access without consent; one login per tenant;
  the venue cannot have its own admin. Why not: the consent requirement and multi-venue logins.
- **Separate Supabase project for the console.** Pros: physical separation. Cons: the console then needs the product project's secret key
  to read metadata, widening rule 2. Why not: kept as the plan's variant V1.
- **Staff as `authenticated` with a claim checked by every policy.** Pros: no custom Postgres role. Cons: one missing check leaks to
  staff. Why not: kept as the fallback V2 if the custom role is not supported.
- **Impersonation (minting a session as the venue user).** Pros: support sees exactly what the user sees. Cons: the audit names the
  wrong person; silent; needs session minting the project plan already rejected. Why not: never silent is a requirement.
- **A `bypassrls` support role.** Why not: contradicts ADR-003's "no global bypass" and consent.

## Consequences
- Good:
  - A missing or wrong tenant policy cannot leak to console sessions (no table grants for `platform_staff`).
  - Every support action carries support's own identity in the existing audit columns.
  - Owners control and can end support access at any time.
- Bad / accepted trade-offs:
  - The hook gains a console mode and is re-pinned (ADR-036's pin changes on purpose).
  - Secret-key holders can still read everything; this is organisational, stated in the DPA, and scripts write platform audit rows.
  - Tenant #1 keeps DigiAlto's legacy `admin` rows until the founder decides otherwise (plan V14).
- What would make us revisit this:
  - Spike T2 shows the hosted stack refuses a custom role claim (→ V2).
  - A customer requires DigiAlto staff to be physically separated from its data (→ V1 or V10).
  - Supabase changes how the hook or the `role` claim works.
