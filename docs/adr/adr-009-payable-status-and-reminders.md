# ADR-009 — Payable status as an audited column; reminders that catch up and fire once per stage; rules isolated per tenant × rule

- **Status:** proposed
- **Date:** 2026-10-23 · **Decided by:** architect, within the founder's decisions of 2026-10-23 (in-app alerts only, the owner the only recipient) and the lead's M9 guardrails (M8 merges first; M9 replaces only `app.alert_rules_body`). The M9 plan §7 Q29–Q32 are open, with their defaults in force.

## Context
- **PRD 1.5:**
  - a payable per invoice with a status (open, scheduled, paid, disputed) and a paid date entered by the owner;
  - reminders 7 days before, on the due date and 3 days after "if still open";
  - a weekly digest by supplier;
  - a supplier statement.
- **M5** created `payable` with a mutable `status` column and a guard that left `status`, `paid_at` and `due_date` writable "for M9". `audit_event` is the append-only history.
- **Invariants:**
  - ledgers are append-only;
  - balances are derived;
  - procedures are single transactions;
  - roles are enforced in Postgres.
- **M6 (ADR-006):**
  - deduplicates alerts on (tenant, kind, entity, business date);
  - runs `app.alert_rules_body` inside one savepoint of `app.run_alert_rules`;
  - its runner contract says rule milestones replace only the body.
- **M8 adds:**
  - `app.try_raise_alert`, which absorbs guard refusals into `app.alert_refusal`;
  - `app.record_alert_refusal`.
- **Failure modes to avoid:** the hourly job can fail for a whole day, and a payable can be approved after its 7-day mark. In either case an "exactly on the day" reminder is lost for good.

## Decision
- **Status as an audited column.**
  - `payable.status` stays a column. A new `paid_on date` holds the owner's paid date, and `paid_at` records when the payment was entered.
  - Every change goes through `public.set_payable_status`, which:
    - checks the role first (owner, admin) and takes the tenant from `app.tenant_id()`;
    - locks the row and validates the transition matrix;
    - writes one `audit_event` in the same transaction.
  - The guard trigger refuses any change of `status`, `paid_on` or `paid_at` outside a transaction-local flag that only the procedure sets, for every role, including the migration owner. `due_date` becomes immutable.
  - A paid payable can only go back to `open` as a **reversal with a reason** (`payable.payment_reversed`); any other move from `paid` returns 409.
- **Reminders that catch up and fire once per stage.**
  - On each hourly run, an `open` payable gets the latest stage it has reached (D−7, D, D+3).
  - The alert's business date is the stage's **nominal date**, so the M6 dedup key fires each stage once, whatever day the payable is first seen.
  - Earlier stages that were missed are not fired late.
  - The weekly digest uses the ISO Monday as its business date: one alert per tenant per ISO week, in the app, owner only.
- **Isolation per tenant × rule.**
  - `app.alert_rules_body` loops over tenants and calls each rule inside its own `begin … exception` block. A failure is recorded through `app.record_alert_refusal` with code `rule_failed`.
  - Every alert is raised through `app.try_raise_alert`, so one refused payload never affects other payables, rules or tenants.
  - `app.run_alert_rules` is not replaced, so `job_run` reports the body's outcome only. Partial failures are read from `app.alert_refusal`.
- **Statement from the frozen payable amounts.**
  - The balance is Σ gross − Σ credited over the unpaid payables, which equals Σ amount.
  - Credits are never recomputed from invoice lines.

## Alternatives
- **Append-only `payable_status_event` table, with the status derived from the latest event:**
  - pros: status history in a dedicated ledger;
  - cons: it duplicates `audit_event`, and every reader and the hourly rule needs a "latest event" join. No invariant requires it, because a status is not a quantity balance;
  - rejected.
- **Reminders only on the exact day:**
  - pros: simplest to state;
  - cons: a failed day of the job, or a late approval, loses the reminder for good;
  - rejected.
- **Dedup on the raise day (the M6 default):**
  - cons: the same stage would fire every day of a catch-up window;
  - rejected.
- **Replacing `app.run_alert_rules` to record `rule_partial` (the M7 §8 proposal):**
  - pros: `job_run` would show partial failures;
  - cons: it breaks the M6 runner contract, which the lead's guardrail forbids;
  - rejected. Failures go to `app.alert_refusal`.
- **An M9-owned isolated-raise helper and failure table:**
  - cons: it duplicates M8's `try_raise_alert` and `alert_refusal` once M8 merges first;
  - rejected.

## Consequences
- **Good:**
  - every status change has exactly one audit row, enforced in Postgres;
  - reminders survive missed runs and late approvals and never duplicate;
  - one bad tenant or payload no longer silences the other tenants' alerts;
  - no new table, dependency, secret or job.
- **Bad / accepted trade-offs:**
  - an alert's business date can be earlier than the day it appeared (the nominal stage date);
  - `job_run` can read `ok` while some tenant × rule blocks failed, so M13's job-health check must also read `app.alert_refusal` (`rule_failed`);
  - the digest is a weekly snapshot;
  - each later rule milestone replaces `app.alert_rules_body` and must keep the payable rules (re-running M9's pgTAP cases).
- **What would make us revisit this:**
  - a need to edit due dates or amounts after approval;
  - an approval reversal (M5 V8) that needs a `cancelled` payable state;
  - an outbound channel (email or Telegram) for reminders;
  - enough rules that a rule registry with per-rule run records is worth it.
