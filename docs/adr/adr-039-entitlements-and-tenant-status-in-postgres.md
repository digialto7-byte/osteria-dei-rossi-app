# ADR-039 — Feature entitlements and tenant status are append-only events, enforced in Postgres at every entry point

- **Status:** proposed
- **Date:** 2026-11-13 · **Decided by:** founder (to accept with `docs/plans/2026-11-13-platform-saas.md`, §3.1 and §4)

## Context
- Paid tiers need modules switched on and off per tenant, per tier, with overrides, "enforced in Postgres and the API, not only the UI"
  (founder, 2026-11-13). Tier names, prices and the billing provider are founder decisions not yet taken.
- Tenants need a lifecycle: provisioning, trial, active, suspended, cancelled, erased.
- `CLAUDE.md` rule 6: roles enforced in Postgres; ledgers append-only; procedures are single transactions; waiters never see costs.
  ADR-002: balances only derived. The Data API is reachable with the publishable key, so API-only checks are not enough.
- Writes already go through definer procedures that resolve the tenant and role through `app.tenant_id()`, `app.role()` and the
  `app.require_*` helpers; PR #79 shows a catalogue test over `pg_proc` source can prove a rule holds for every function.
- The offline queue (ADR-022) replays ops later; a refusal must be per op and kept on the phone.

## Decision
- **Entitlements:** a feature catalogue (`platform.feature`, with `requires`), plans (`platform.plan`, `platform.plan_feature` with
  optional monthly limits), the tenant's plan history (`tenant_subscription_event`) and overrides (`tenant_feature_override`, with
  expiry), all append-only. `app.feature_enabled(tenant, key)` resolves override → plan → off. Each module's write procedures call
  `app.require_feature(key)`; `withApi({feature})` answers 403 early; cron jobs skip tenants without the feature; the UI only hides.
- **Switches gate entry points, never integrity side effects**: a procedure of an enabled module keeps writing every ledger it writes
  today, whatever other modules are off. **Switching off never hides or deletes the tenant's own data from owner/admin**; reads stay under
  RLS and export is always allowed.
- **Rollout:** `entitlement_mode` per tenant, `observe` (log and allow) or `enforce`.
- **Status:** `tenant_status_event` (append-only; current = newest effective row). `app.require_writable()` refuses writes for
  `suspended` and `cancelled` tenants (and for read-only support members, ADR-037). It sits in the role helpers and remaining write
  policies; a pgTAP catalogue test fails if any volatile function executable by `authenticated` neither calls it nor is on a named
  exempt list. A suspension takes effect at the tenant's next business-day cut-off, never mid-service. Refused offline ops return
  `tenant_read_only` per op and stay on the phone.

## Alternatives
- **Flags in the API and UI only.** Pros: simple. Cons: the Data API bypasses them. Why not: rule 6.
- **Gating reads in every RLS policy.** Pros: a disabled module is invisible. Cons: hides the controller's own data when a plan lapses;
  a function call in every policy. Why not: data portability and cost.
- **Current plan and status as columns on `tenant`.** Pros: one read. Cons: no history of why and when. Why not: audit and the ADR-002
  spirit; the cost is one indexed lookup.
- **A third-party feature-flag service.** Why not: a new sub-processor, flags outside Postgres.
- **Immediate suspension.** Why not: it would cut a service in progress and strand offline ops mid-service.

## Consequences
- Good:
  - Plans and overrides are data; DigiAlto changes them without a deploy, and every change has a history.
  - Ledgers stay complete whatever is switched off.
  - Tenant #1 can run in `observe` until nothing would be refused.
- Bad / accepted trade-offs:
  - Every module procedure gains a feature check; new procedures must remember it (caught by review and, for writes, by the catalogue
    test of the write gate; the feature check itself is reviewed per module).
  - Two more lookups per write (feature, status), measured with the existing perf workflow.
  - A suspended tenant's offline ops wait on the phones until reactivation.
- What would make us revisit this:
  - A billing provider needs a different state model (plan variant V5).
  - Measured overhead of the checks on hot paths (`add_order_line`, `fire_course`).
