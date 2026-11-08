-- A5b (docs/plans/2026-11-08-a5b-raw-stock-business-date.md §3.5, ADR-033; follow-up of A5 §7.4): two indexes on effective_on have no reader left, and each costs a write on every ledger insert.
--   batch_movement_effective_idx (20261108100200)            A5 moved waste_costs and discards_vs_push_json to batch_movement_created_idx, so nothing reads batch_movement by effective_on.
--   stock_movement_consumption_idx (20261030100000)          app.weekday_consumption now reads a created_at range (20261127100000), served by stock_movement_tenant_at_idx.
-- Kept on purpose: stock_movement_effective_idx (receipts by invoice date, app.kpi_purchases; commented in 20261127100000), stock_movement_location_date_idx (stock_reconciliation's receipt
-- branch by location) and stock_movement_tenant_at_idx (raw waste, weekday consumption).
-- Plain DROP INDEX takes a short exclusive lock on the table inside the migration; both tables are small before go-live. Deploy outside service hours.

drop index public.batch_movement_effective_idx;
drop index public.stock_movement_consumption_idx;
