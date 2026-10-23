-- M12 step 1a: the movement types M12 and its followers write (M12 plan §3.2; ADR-011).
-- Only these statements, in their own file: ALTER TYPE ... ADD VALUE inside a transaction leaves the
-- new value unusable until commit (plan §6 T1). The shape checks of the next file compare type::text,
-- so they work whether or not the CLI wraps several migrations in one transaction.
-- `count` is defined here and posted by M13.
alter type public.stock_movement_type add value 'consumption';
alter type public.stock_movement_type add value 'waste';
alter type public.stock_movement_type add value 'transfer';
alter type public.stock_movement_type add value 'count';
