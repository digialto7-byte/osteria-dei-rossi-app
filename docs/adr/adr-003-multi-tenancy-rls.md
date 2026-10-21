# ADR-003 — tenant_id and row-level security from day one, with role policies in Postgres

- **Status:** proposed
- **Date:** 2026-10-21 · **Decided by:** founder

## Context
- The PRD's "Guiding constraints" ask for "multi-tenant from day one where it costs nothing extra, single-venue UX now". It also gives a marginal running-cost target per additional venue (under €10/month) and puts the multi-venue UI in Phase 3.
- NFR Security requires:
  - "RLS on every table by tenant";
  - "roles enforced in Postgres policies, not only in the UI";
  - "waiters never see costs".
- The chef sees "margins only". What exactly the chef may see is an open question (plan Q16, variant V6).
- There are four roles: owner, chef, waiter and admin (DigiAlto). An accountant role comes in Phase 2.
- Supabase supports a Custom Access Token Hook that adds custom claims, such as a role, to the JWT. RLS policies can read these claims ([custom access token hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook), [RBAC](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac)).
- Every Supabase user shares the `authenticated` database role. Column-level GRANTs therefore cannot separate a waiter from an owner.
- Who owns the multi-tenant code (a DigiAlto product, or client-owned) is open (plan Q11).

## Decision
- **Tenant scoping:**
  - Every table carries `tenant_id` (plus `created_at` and `created_by`) and has RLS enabled.
  - A Custom Access Token Hook adds `tenant_id` and `app_role` claims from `app_user`.
  - Policies use `app.tenant_id()` and `app.role()`, wrapped in `(select …)`.
- **Role scoping:** policies check both the tenant and the role.
- **Cost isolation:**
  - Cost-bearing data lives in tables the waiter role has no policy on. `batch_cost` and `order_line_cost` are split out of `batch` and `order_line` so cost never sits beside waiter-visible columns.
  - Waiter-facing reads (`/api/menu`, `menu_availability()`) return no cost fields.
- **CI checks (pgTAP):**
  - every `public` table has RLS, `tenant_id` and a policy;
  - users cannot cross tenants;
  - no waiter-readable column has a cost or margin name.
- **Admin access:** an explicit `app_user` row per tenant for DigiAlto admins. There is no global bypass.
- **Secret key:** used only in cron services and scripts, enforced by a lint rule.
- **Staff PIN login** keeps Supabase sessions, and so keeps RLS, through a peppered password derivation on enrolled devices (plan §3.11.3). App tables store nothing derived from the PIN.

## Alternatives
- **Database or schema per tenant.** Pros: hard isolation. Cons: migrations fan out across tenants, cost rises per venue, and cross-venue reporting gets harder. Why not: the PRD wants multi-tenancy at no extra cost.
- **Single-tenant now, add tenant_id later.** Pros: slightly less work now. Cons: retrofitting every table, policy and test later is risky and costly. Why not: the PRD says from day one.
- **Authorisation only in the API layer, using the secret key for all queries.** Pros: simpler SQL. Cons: one missed check leaks data across tenants or roles; it contradicts the PRD's "roles enforced in Postgres". Why not: defence in depth is a requirement.
- **Separate Postgres roles per app role, with column GRANTs.** Pros: column-level control. Cons: Supabase sessions all map to `authenticated`, so it would need role switching or custom connection handling. Why not: splitting the cost tables gets the same isolation with standard Supabase.
- **App-signed JWTs for staff.** Pros: full control of the PIN flow. Cons: needs the project's JWT signing secret and bypasses Supabase Auth's session handling. Why not: more security-critical code to own.

## Consequences
- Good:
  - Tenant and role isolation hold even if an API check is missed.
  - Adding a venue is a data change.
  - The Phase 3 assistant inherits tenant and role scoping automatically.
  - The isolation tests run in CI on every PR.
- Bad / accepted trade-offs:
  - Every new table needs policies and tests; the CI guard enforces this.
  - Split cost tables add joins for owner reports.
  - The JWT claims refresh only when the session refreshes, so a role change takes effect on the next refresh. Revoking a user also ends their sessions.
  - The chef policy depends on Q16.
- What would make us revisit this:
  - A client needs physical data separation (for example a group with a contractual isolation requirement).
  - Tenant count grows to where per-tenant RLS predicates hurt query plans.
  - Supabase changes how the hook or claims work.
