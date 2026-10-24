# ADR-018 — Demo data in a flagged tenant, removed by a purge that only that flag allows

- **Status:** proposed
- **Date:** 2026-10-24 · **Decided by:** founder (on review of `docs/plans/2026-10-24-demo-data.md`)

## Context

- The founder wants sample data to show the work done so far. It must be removable before go-live, by DigiAlto or by the owner.
- **Ledgers are append-only, and nothing is deleted, only reversed** (CLAUDE.md invariant; ADR-002, ADR-011).
  - `app.append_only()` refuses UPDATE and DELETE on 21 tables, for every role.
  - The staff-auth guards refuse DELETE outside M11's retention purge (`app.auth_purge`).
  - No API role has DELETE or TRUNCATE (pgTAP `001`).
- Every table has `tenant_id` and RLS (ADR-003), so a tenant is a complete, isolated unit of data.
- `audit_event.created_by` references `app_user`. A record that must survive the deletion of a tenant's users cannot live in `audit_event`.
- Auth users and Storage objects cannot be removed from SQL. Only the Supabase APIs remove them, with the secret key, which is allowed only in `scripts/`, the cron routes and one staff-auth module (CLAUDE.md rule 2).

## Decision

**The demo lives in its own tenant, flagged by `tenant.is_demo`. The flag is set only when the tenant is created, and no role can ever change it.**

- **How the guards allow the purge.** The append-only and staff-auth guards allow a DELETE only when **both** of these hold:
  - the transaction-local setting `app.demo_purge` equals that row's `tenant_id`;
  - that tenant has `is_demo = true` (`app.demo_purge_allows`).

  UPDATE and TRUNCATE stay refused, and no grant changes.
- **Who can purge.** The setting is set only by `app.purge_demo_tenant_core`, in one transaction, reached in two ways:
  - **in the app:** the owner of the demo tenant calls `purge_demo_tenant(name)` and must type the tenant name;
  - **by script:** the secret-key script calls `purge_demo_tenant_by_id`.
- **What the purge does.** It locks the tenant, deletes every tenant table in a fixed child-first order, records the purge in `app.demo_purge_log` (no FK, no API privilege), and removes the tenant.
- **Afterwards:** the script removes the Storage objects under the tenant's prefix and the Auth users whose ids were recorded, then marks the log row clean.

## Alternatives

- **Demo rows tagged inside the real tenant.**
  - Pro: one tenant to show.
  - Con: every table, read and report needs the tag, and a missed one mixes fake and real figures in the ledgers.
  - Rejected.
- **Disabling triggers (`session_replication_role = replica`, `alter table … disable trigger`) during the purge.**
  - Pro: no guard changes.
  - Con: it switches off every guard and foreign key, for every row the transaction touches; it may need privileges the hosted `postgres` role lacks; DDL inside a purge takes locks on shared tables; pgTAP cannot show it is narrow.
  - Rejected.
- **A boolean flag "on", like M11's `app.auth_purge`.**
  - Pro: simplest.
  - Con: a wrong WHERE clause could then delete a real tenant's ledger. Binding the flag to one tenant id and to `is_demo` makes that impossible.
  - Rejected.
- **Dropping and recreating the database or schema (local style).** Impossible on a shared staging project with real tenants. Rejected.
- **The app's purge route also deleting Auth users and Storage objects.**
  - Pro: one step.
  - Con: it needs a second secret-key exception in user-facing code.
  - Deferred to the founder (plan Q92 → V1).

## Consequences

- **Good:**
  - real tenants keep exactly today's guarantees: their rows can never be deleted or updated, by any role;
  - the demo is one command to create and one action to remove;
  - every demo row was written by the real procedures, so the nightly invariant check stays clean.
- **Bad / accepted trade-offs:**
  - five guard functions gain one branch, and the purge's table list must grow with every new tenant table. pgTAP `194` and `196` fail until it does.
  - A purge from the app leaves the demo Auth accounts (which see nothing) and the fake PDFs until DigiAlto's cleanup runs.
  - The purge record lives outside `audit_event`.
- **What would make us revisit this:**
  - a need for several demo tenants, or for demo data on production (plan V3);
  - Supabase allowing Auth and Storage deletion from SQL;
  - the founder approving the secret-key exception for the app route (plan V1).
