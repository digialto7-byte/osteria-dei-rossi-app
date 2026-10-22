# ADR-006 — One alert pipeline: `app.raise_alert`, cost-safe audiences, an email outbox with lease and idempotency key

- **Status:** proposed
- **Date:** 2026-10-22 · **Decided by:** founder (pending; see the M6 plan §7 Q3–Q9)

## Context
- The PRD (2.4) asks for alerts deduplicated "one per item per day", acknowledged with one tap, delivered by email to one address by default. Later milestones (M8, M9, M10, M11, M13, M16, M19) each add rules that must reuse one pipeline (project plan §3.10).
- Rules run from pg_cron with no user JWT, so the tenant cannot come from `auth.jwt()`; M8's rule runs inside `approve_invoice` with a JWT.
- Waiters never see costs (project invariant) and the chef never sees € costs (founder decision, 2026-10-22, M5 plan).
- `tenant.settings` is readable by every role of a tenant.
- Resend documents an `Idempotency-Key` header kept for 24 hours on `POST /emails` (<https://resend.com/docs/dashboard/emails/idempotency-keys>).
- pg_net is fire-and-forget; M3 already uses a lease and claim token for the extraction worker (ADR-004).
- Cron runs span tenants, while pgTAP `001` requires a non-null `tenant_id` on every `public` table.

## Decision
- Every alert is raised through `app.raise_alert(p_tenant, p_kind, p_entity_type, p_entity_id, p_payload, …)`, executable only by definer procedures (no API role). It deduplicates on `(tenant, kind, entity, Europe/Rome business date)`.
- A kind registry marks cost-bearing kinds. Postgres refuses the chef in their audience and refuses money keys (`*_eur`, `cost`, `price`, …) in other kinds' payloads. RLS shows the chef only chef-audience, non-cost alerts; waiters see none.
- Alert rows are immutable except a set-once acknowledgement. Email delivery is a separate outbox row, claimed with `skip locked`, a lease and a claim token, and sent with the idempotency key `alert-email/<delivery id>` through plain `fetch`. All retries end within 24 hours, and older alerts are never emailed.
- The alert address lives in an owner/admin-only table. Run health lives in `app.job_run`, outside `public`, with no tenant.

## Alternatives
- Delivery columns on `alert`: simpler, but the alert would be mutable, and a second channel (Telegram) would need new columns. Rejected.
- Marking `sent` before calling the provider: never duplicates, but loses an email on a crash. Rejected.
- The `resend` SDK: convenient, but a dependency for one POST and harder to fake at the HTTP boundary. Rejected.
- `alert_email` in `tenant.settings`: one place for settings, but readable by waiters. Rejected.
- `job_run` in `public` with a tenant: satisfies the table rule, but a cross-tenant run has no tenant. Rejected.
- Sending from SQL with pg_net: no route needed, but the API key would sit in Vault and the retry logic in plpgsql. Rejected.

## Consequences
- Good: one interface for every rule milestone; cost leaks are blocked in Postgres, not only in the UI; a crashed or concurrent dispatcher cannot double-send within Resend's key window; staging stays inert without the Vault secrets.
- Bad / accepted trade-offs: "exactly once" relies on Resend's documented 24-hour key behaviour; an alert not emailed within 24 hours stays in-app only; `app.job_run` is a documented exception to "every table has `tenant_id`"; each rule milestone replaces `app.run_alert_rules` and must test that earlier rules still run.
- What would make us revisit this: a second channel needing per-recipient state (Telegram, M26); the founder choosing grouped emails or quiet hours (M6 V1, V2); Resend's key behaviour differing from its documentation (M6 step 18); a provider change.
