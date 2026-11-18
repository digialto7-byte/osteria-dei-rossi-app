-- Opening stock, step 3 (docs/plans/2026-11-18-opening-stock.md §3.1, M1): the movement type for a venue's first-day stock.
-- Only this statement, in its own file: ALTER TYPE ... ADD VALUE inside a transaction leaves the new value unusable until commit
-- (see 20261026100000). The shape CHECK of the next file compares type::text, so it works whether or not the CLI wraps several
-- migrations in one transaction. Nothing writes an `opening` row yet. The enum order becomes receipt, consumption, waste, transfer, count, opening.
alter type public.stock_movement_type add value 'opening';
