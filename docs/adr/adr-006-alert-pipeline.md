# ADR-006 — One in-app alert pipeline: `app.raise_alert`, cost-safe audiences, set-once acknowledgement; email later

- **Status:** proposed
- **Date:** 2026-10-22, revised 2026-10-23 · **Decided by:** founder. The channel was decided on 2026-10-23 (in-app only, recipient the owner in the app). The M6 plan §7 Q1–Q4 are open, with their defaults in force.

## Context
- The PRD (2.4) asks for:
  - alerts deduplicated "one per item per day";
  - acknowledgement with one tap;
  - delivery on the channel chosen in setup.
- On 2026-10-23 the founder chose **in-app alerts only**: no email and no third-party processor. The owner is the recipient, in the app.
- Later milestones (M8, M9, M10, M11, M13, M16, M19) each add rules that must reuse one pipeline (project plan §3.10).
- Rules run from pg_cron with no user JWT, so the tenant cannot come from `auth.jwt()`. M8's rule runs inside `approve_invoice`, which has a JWT.
- Waiters never see costs (project invariant). The chef never sees € costs (founder decision, 2026-10-22, M5 plan).
- Cron runs span tenants, while pgTAP `001` requires a non-null `tenant_id` on every `public` table.
- In plpgsql, an exception that is re-raised also rolls back any run record written in the same transaction.

## Decision
- **One entry point.** Every alert is raised through `app.raise_alert(p_tenant, p_kind, p_entity_type, p_entity_id, p_payload, …)`.
  - Only definer procedures can execute it; no API role can.
  - It deduplicates on `(tenant, kind, entity, Europe/Rome business date)`.
- **Cost-safe audiences.** A kind registry marks cost-bearing kinds. Postgres refuses:
  - the chef in the audience of a cost-bearing kind;
  - money keys (`*_eur`, `cost`, `price`, …) in the payloads of other kinds.

  RLS lets owner and admin read every alert, the chef only chef-audience non-cost alerts, and waiters none.
- **Immutable rows.** An alert row never changes, except for a set-once acknowledgement shared by everyone who can read it.
- **In-app delivery.** The only delivery is the `/avvisi` list, and nothing is configured.
  - There is no delivery table, no dispatcher route and no provider, so no alert data leaves the system.
- **Run records.** Run health lives in `app.job_run`, outside `public`, with no tenant. `withCron` records every authorised cron route run.
- **Hourly rules.** The `alert-rules` job calls `app.run_alert_rules()`. That function runs a replaceable `app.alert_rules_body()` inside a savepoint, so a failing rule is recorded as `rule_failed` rather than rolled away. Rule milestones replace only the body.

## Alternatives
- **Email now, through an outbox with a lease and an idempotency key (Resend):**
  - pros: notifies the owner outside the app;
  - cons: a third-party processor of addresses and € figures, a sender domain, quota, cost and DPA questions;
  - rejected by the founder (2026-10-23).
- **Email later (follow-up, not built).** It would be its own milestone, planned when the founder asks. It would add:
  - a channel column on the kind registry;
  - an `alert_delivery` outbox row written by `app.raise_alert` in the same transaction;
  - an owner/admin-only recipient table;
  - a `POST /api/cron/dispatch-alerts` route behind `withCron` that claims with `skip locked`, a lease and a claim token, and sends with the key `alert-email/<delivery id>`.

  The alert row stays immutable, so this decision does not block it. That milestone must first settle the provider, prices, data location and retention, DPA, sender domain and recipient address.
- **Web push:**
  - pros: no email address needed;
  - cons: needs a subscription flow and goes through the browser vendors' push services (third parties);
  - rejected under the same decision.
- **Rules runner that records the failure and re-raises:**
  - pros: pg_cron logs the failure;
  - cons: the re-raise rolls back the run record;
  - rejected.
- **A rule registry with dynamic dispatch:**
  - pros: isolates each rule;
  - cons: dynamic SQL and a table for zero rules today;
  - rejected for now.
- **`job_run` in `public` with a tenant:**
  - pros: satisfies the table rule;
  - cons: a cross-tenant run has no tenant;
  - rejected.
- **Dropping `job_run` because there is no dispatcher:**
  - cons: plan §3.9, M10 and M13 rely on it, and the extract route and the hourly job already write runs;
  - rejected.

## Consequences
- **Good:**
  - one interface for every rule milestone;
  - cost leaks are blocked in Postgres, not only in the UI;
  - no personal data leaves the system, and there is no provider cost, secret or DPA;
  - local, CI and staging stacks behave the same (no route call);
  - failed rule runs are recorded.
- **Bad / accepted trade-offs:**
  - nobody is notified outside the app, so alerts are seen only when someone opens `/avvisi`;
  - `app.job_run` is a documented exception to "every table has `tenant_id`";
  - one failing rule rolls back that hour's whole rule body;
  - each rule milestone replaces `app.alert_rules_body` and must test that earlier rules still run.
- **What would make us revisit this:**
  - the founder asking for an outbound channel (email, the follow-up above; Telegram, project plan V1/M26);
  - alerts being missed in practice;
  - enough rules that per-rule isolation is worth a registry.
