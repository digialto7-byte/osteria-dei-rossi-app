# ADR-031: Service periods (Pranzo / Cena) are versioned tenant data; a table's service is derived from its opening time, with append-only overrides; the per-service split is computed live, not stored

- **Status:** accepted
- **Date:** 2026-11-01
- **Decided by:** architect, on the M25c plan (`docs/plans/2026-11-01-m25c-services.md`). Accepted by the founder with the plan on 2026-11-01.

## Context

- **Founder's request (2026-11-01, through the lead):**
  - service periods within a business day, configurable per tenant, default Pranzo and Cena;
  - every table session and its orders belong to a service, by opening time, overridable;
  - daily totals split by service plus the day total (day close, KPIs, dashboard, exports, forecast if it makes sense);
  - a third service (e.g. aperitivo) must be data, not code.
- **Existing rules that constrain the design:**
  - M21 (ADR-023): a table counts on the business date of its **close** (`closed_business_date`); a closed session is final; `app.table_session_guard` refuses any change to it; `open_table` and `close_table` are md5-pinned (pgTAP `214`, `222`, `229`, `240`).
  - M22 (ADR-025): `daily_kpi` holds one immutable row per business date, written only by `app.rollup_daily_kpi` (md5-pinned in `255`). A date is final at its cut-off plus 10 minutes. `app.kpi_sales_lines` and `app.kpi_session_rows` are the one line and session source (pinned in `255`).
  - M11: the business day runs from cut-off to cut-off (default 02:00, Europe/Rome, DST-safe).
  - Invariants: append-only ledgers, balances derived, single-transaction procedures, `tenant_id` + RLS everywhere, definer functions with the role check first and `search_path = ''`.
- **Existing data:** every session on staging (and later production) has `opened_at` and no service.

## Decision

1. **A service schedule is a versioned, append-only tenant record.**
   - `public.service_schedule`: one row per saved version, with `periods jsonb` = 1–6 entries `{key, name, startsAt}`. Rows are never updated or deleted (except by the demo purge, ADR-018).
   - A version applies to **sessions opened at or after its `created_at`**. Saving never changes the past.
   - A tenant with no row uses the built-in default `app.default_service_periods()`: `pranzo` "Pranzo" from 11:00, `cena` "Cena" from 16:00. That function is md5-pinned: changing it would re-assign the history of every tenant that never saved a schedule.
   - A third service is one more entry in `periods`. No code, enum or check constraint lists service names or keys.
2. **Windows are defined by start times only.** A service runs from its start to the next service's start; the last one ends at the cut-off; anything opened between the cut-off and the first start belongs to the first service. Order is by minutes after the cut-off. **Gaps and overlaps cannot exist**, so the services of a day always add up to the day.
3. **A session's service is derived at read time** from `opened_at` (local wall time in the tenant's time zone), the tenant's cut-off and the schedule version in force at `opened_at`. Nothing is written when a table opens; `open_table` is not touched; existing sessions need no backfill.
4. **Overrides are append-only events** in `public.service_override` (`table_session_id`, `service_key` or null for "back to automatic", `created_by`, `created_at`). The latest event wins. Owner and admin only; refused once the session's business date is final (the same instant `daily_kpi` freezes).
5. **Every order line follows its session's service.** A bill is never split across services.
6. **The per-service split is computed live** from `app.kpi_sales_lines`, `app.kpi_session_rows` and the derived service, with one SQL function (`app.kpi_service_split`) feeding the report, the day close, the dashboard and the CSV. It is not stored: after finality every input is frozen (closed sessions are final, schedules apply only forward, overrides are refused), so the live figure cannot move. `daily_kpi` and the rollup are unchanged.
7. **The register (RCH) total stays per business day.** The day close shows the app's split by service and the one day-level variance.

## Alternatives

- **A `service_key` column on `table_session`, set by `open_table`.**
  - Pros: frozen at open; trivially indexed.
  - Cons: replaces the pinned `open_table` and `table_session_guard` and touches the offline path (`apply_op` dispatches `open_table`); a backfill would update closed, immutable sessions, which the guard forbids.
  - Why not: invasive for no gain, since the derived value is already stable (decision 6).
- **A backfill into an assignment table at migration time.**
  - Why not: it needs a writer at every open anyway (the same `open_table` change), and it creates two sources of truth for old and new rows.
- **Derived from the current windows only (no versions).**
  - Why not: editing a window would silently re-assign every past table.
- **Start and end per service, with gaps ("fuori servizio") and overlaps.**
  - Why not as default: overlaps are ambiguous and gaps break "Pranzo + Cena = day". A gap bucket is variant V1 of the plan.
- **A per-service snapshot table filled by the rollup.**
  - Why not: the rollup is pinned, and the inputs are frozen after finality anyway. Revisit if the live split ever differs from `daily_kpi` (a CI parity check guards this).
- **Service keys stored in `tenant.settings`.**
  - Why not: not versioned, not append-only, and restored wholesale by the demo purge.
- **Assignment by closing time.**
  - Why not: the founder asked for opening time, and a lunch closed at 16:10 would become dinner.

## Consequences

- **Good:** no change to sessions, lines, bills, closes, the offline queue or the rollup; no backfill; history is stable by construction; a third service is data; Σ services = day total by construction.
- **Bad / accepted trade-offs:**
  - **Changing the cut-off** re-orders the business clock, so a session opened between the old and the new cut-off can change service. Cut-off changes are rare (M11) and are flagged in the settings screen.
  - **A table opened offline** gets the server's arrival time as `opened_at` (M20), so it can land in the next service; an override fixes it (Q230).
  - Each split read recomputes from lines (as the items report already does).
  - Two more tables on the demo purge list; a tenant that saved a schedule counts as having data and cannot start a demo (like the coperto).
- **What would make us revisit this:**
  - a per-service register entry (plan V4);
  - assignment per line instead of per table;
  - the live split drifting from `daily_kpi`, or becoming slow on real data (then a snapshot).
