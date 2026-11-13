# ADR-037 — A platform layer outside tenant RLS, and support access only by the tenant's time-boxed consent

- **Status:** proposed
- **Date:** 2026-11-13 · **Decided by:** founder (to accept with `docs/plans/2026-11-13-platform-saas.md`, §2)
- **Amends:** ADR-003 ("Admin access: an explicit `app_user` row per tenant for DigiAlto admins"; and the rejected alternative
  "separate Postgres roles", see below)

## Context
- The founder decided on 2026-11-13 that the app becomes a DigiAlto SaaS product for other venues. DigiAlto then needs to create and
  manage tenants, see their health and give support, across many tenants.
- Today DigiAlto reaches a tenant only through an explicit `app_user` row with role `admin` in that tenant, with "no global bypass"
  (ADR-003); the policy comment "Only an admin (DigiAlto) can create another admin" (`20261021120000_tenancy_baseline.sql` lines 96–103)
  shows that the tenant role `admin` means DigiAlto. One login belongs to one tenant (`app_user.auth_id` unique, line 31).
- ADR-003 rejected "Separate Postgres roles per app role, with column GRANTs" because "Supabase sessions all map to `authenticated`,
  so it would need role switching or custom connection handling".
- `CLAUDE.md` rule 6: every table has `tenant_id` and RLS; roles are enforced in Postgres; waiters never see costs. Rule 2: the Supabase
  secret key only in `/api/cron/*`, `scripts/` and `src/server/staff-auth/privileged.ts`.
- PR #79 (ADR-036, TOTP, merged) puts an `aal` gate inside `app.tenant_id()`, `app.role()` and `app.app_user_id()`. Its
  `set_mfa_enforcement` and break-glass `mfa_reset_service_begin/failed` (service role, run by `scripts/set-mfa-enforcement.ts` and
  `scripts/mfa-reset.ts`) require an active admin of the tenant as actor; `mfa_reset_service_begin` deletes the target's `auth.sessions`
  and is the only `public`/`app` function writing `auth.*` (its pgTAP 341).
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
  on the next query. All tenant users see a banner while it is active (an offline phone shows it on its first online `/api/me`, since
  `/api/me` is in the offline cache). Grant events go to the tenant's `audit_event` and to the platform audit. There is no "log in as
  user".
- **Ending support sessions widens #79's `auth.*` rule on purpose.** The expiry job calls `app.support_end_sessions(grant)`, a second
  function writing `auth.sessions`, under the same scope rules as `mfa_reset_service_begin`: the grant's staff user only (and only the
  sessions selected into that tenant in support mode), no API role may execute it, the count only is audited. pgTAP 341's allowlist
  names exactly the two functions.
- A platform staff auth user cannot be an ordinary member of any tenant (triggers both ways, no exemption). DigiAlto's legacy `admin`
  rows at tenant #1 are kept (plan FD9); the people behind them use **separate console logins** until those rows are converted (plan
  FD25 default, V14). A one-login exemption is only the plan's variant V15.
- **Second-factor actor:** #79's enforcement and break-glass reset functions accept a platform-admin actor (`p_actor_staff`), recorded
  in `platform.audit_event` and in the tenant's `audit_event` (new column `created_by_staff`), so they work at tenants with no DigiAlto
  admin (plan FD26). The tenant-admin actor keeps working where it exists.
- **Invariant scope, made explicit:** "every table has `tenant_id` and RLS" applies to tenant data. The `platform` schema's catalogue
  tables (`staff`, `organisation`, `plan`, `plan_feature`, `feature`, `audit_event`, `notice`) are not tenant data; they have RLS on, no
  grant to `anon` or `authenticated`, and a pgTAP test lists them by name so no tenant table can hide there. Tenant data that lives
  outside `public` (`app.entitlement_observation`, `app.session_tenant`) carries `tenant_id` and RLS and is checked by its own catalogue
  test, because pgTAP 001 checks `public` only.

### How this amends ADR-003
- **DigiAlto access.** ADR-003 decided "an explicit `app_user` row per tenant for DigiAlto admins. There is no global bypass." The
  "no global bypass" part stays: platform staff hold no table grant and no `bypassrls`. The "explicit `app_user` row" part changes: for
  new tenants DigiAlto gets no standing row; it gets a per-tenant `app_user` row of `kind = 'support'` only while the owner's grant is
  valid. Tenant #1's existing rows are a transitional exception (FD9, V14).
- **The rejected "separate Postgres roles" alternative.** ADR-003 rejected one Postgres role *per app role* to separate *tenant users
  by column grants*, because Supabase sessions map to `authenticated` and role switching would be needed. This ADR does not reopen that:
  tenant roles (owner, admin, chef, waiter, support) all stay on `authenticated` with policies and split cost tables, exactly as
  ADR-003 decided. It adds **one** role for a population that is not a tenant user at all, holding **no** table grant, so no column-level
  design is involved. ADR-003's objection (role switching) is the open risk, and it is tested before any build (spike T2); if the hosted
  stack refuses the role, the plan falls back to V2, which is ADR-003's own model (`authenticated` plus a claim).

## Alternatives
- **Keep DigiAlto as `admin` rows in every tenant (ADR-003 as written).** Pros: nothing to build. Cons: standing access without consent;
  one login per tenant; the venue cannot have its own admin. Why not: the consent requirement and multi-venue logins.
- **Separate Supabase project for the console.** Pros: physical separation. Cons: the console then needs the product project's secret key
  to read metadata, widening rule 2. Why not: kept as the plan's variant V1.
- **Staff as `authenticated` with a claim checked by every policy.** Pros: no custom Postgres role; stays inside ADR-003's model. Cons:
  one missing check leaks to staff. Why not: kept as the fallback V2 if the custom role is not supported.
- **Impersonation (minting a session as the venue user).** Pros: support sees exactly what the user sees. Cons: the audit names the
  wrong person; silent; needs session minting the project plan already rejected. Why not: never silent is a requirement.
- **A `bypassrls` support role.** Why not: contradicts ADR-003's "no global bypass" and consent.
- **A trigger exemption so legacy tenant-#1 logins can also be staff.** Pros: one login per person. Cons: an exception to the
  staff/member separation. Why not by default: kept as variant V15 (FD25).

## Consequences
- Good:
  - A missing or wrong tenant policy cannot leak to console sessions (no table grants for `platform_staff`).
  - Every support action carries support's own identity in the existing audit columns.
  - Owners control and can end support access at any time.
  - Emergency MFA resets work at venues where DigiAlto has no account, with the staff member named in both audits.
- Bad / accepted trade-offs:
  - The hook gains a console mode and is re-pinned (ADR-036's pin changes on purpose).
  - A second function writes `auth.sessions` (pgTAP 341 allowlist widened, same scope rules).
  - Secret-key holders can still read everything; this is organisational, stated in the DPA, and scripts write platform audit rows.
  - Tenant #1 keeps DigiAlto's legacy `admin` rows until the founder decides otherwise (plan V14); until then those people have two
    logins (FD25 default).
  - An offline phone shows the support banner late.
- What would make us revisit this:
  - Spike T2 shows the hosted stack refuses a custom role claim (→ V2).
  - A customer requires DigiAlto staff to be physically separated from its data (→ V1 or V10).
  - Supabase changes how the hook or the `role` claim works.
