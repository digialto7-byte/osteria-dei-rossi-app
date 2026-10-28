-- Owner dashboard (docs/plans/2026-10-28-owner-dashboard.md) step 3: an index for each dashboard read that has none today.
-- All start with tenant_id. Plain `create index`: the tables are small before go-live; on a large real tenant this
-- migration would be rerun as `create index concurrently` outside a transaction (runbook note in the PR).

-- The expiring-lots read only touches lots that expire by tomorrow, as expiry_rule does.
create index raw_lot_expiry_idx on public.raw_lot (tenant_id, expiry) where expiry is not null;

-- Overdue and due-soon payables: unpaid rows by due date.
create index payable_unpaid_due_idx on public.payable (tenant_id, due_date) where status <> 'paid';

-- The week's waste. waste_costs filters `type::text = 'waste'`, which a partial index on `type = 'waste'` would not
-- match, so these two are not partial and waste_costs is not changed.
create index stock_movement_effective_idx on public.stock_movement (tenant_id, effective_on);
create index batch_movement_effective_idx on public.batch_movement (tenant_id, effective_on);
