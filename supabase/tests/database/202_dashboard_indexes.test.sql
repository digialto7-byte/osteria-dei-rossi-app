-- Owner dashboard plan step 3: the four indexes behind the dashboard's reads (plan §3.2). Each starts with tenant_id.
-- The waste indexes are not partial on purpose: waste_costs filters type::text = 'waste', which a partial index on
-- type = 'waste' would not match, and waste_costs is not changed.
begin;
create extension if not exists pgtap with schema extensions;
-- A5b (20261127100100_drop_unused_effective_indexes.sql, ADR-033): batch_movement_effective_idx has no reader since A5 moved the batch reports to created_at, so it is dropped on purpose; the
-- other three stay (stock_movement_effective_idx serves receipts by invoice date). The assertions about the dropped index became a hasnt_index and the counts went from four to three.
select plan(11);

select has_index('public', 'raw_lot', 'raw_lot_expiry_idx', 'raw_lot_expiry_idx exists');
select has_index('public', 'payable', 'payable_unpaid_due_idx', 'payable_unpaid_due_idx exists');
select has_index('public', 'stock_movement', 'stock_movement_effective_idx', 'stock_movement_effective_idx exists');
select hasnt_index('public', 'batch_movement', 'batch_movement_effective_idx', 'batch_movement_effective_idx is gone (A5b: no reader since A5)');

select matches(pg_get_indexdef('public.raw_lot_expiry_idx'::regclass),
  '^CREATE INDEX raw_lot_expiry_idx ON public\.raw_lot USING btree \(tenant_id, expiry\) WHERE \(expiry IS NOT NULL\)$',
  'raw_lot: (tenant_id, expiry) where expiry is not null');
select matches(pg_get_indexdef('public.payable_unpaid_due_idx'::regclass),
  '^CREATE INDEX payable_unpaid_due_idx ON public\.payable USING btree \(tenant_id, due_date\) WHERE \(status <> ''paid''::(public\.)?payable_status\)$',
  'payable: (tenant_id, due_date) where status <> paid');
select matches(pg_get_indexdef('public.stock_movement_effective_idx'::regclass),
  '^CREATE INDEX stock_movement_effective_idx ON public\.stock_movement USING btree \(tenant_id, effective_on\)$',
  'stock_movement: (tenant_id, effective_on), not partial');

select is((select count(*)::int from pg_index i where i.indrelid = any (array['public.raw_lot'::regclass, 'public.payable'::regclass,
  'public.stock_movement'::regclass, 'public.batch_movement'::regclass]) and i.indexrelid::regclass::text in
  ('raw_lot_expiry_idx', 'payable_unpaid_due_idx', 'stock_movement_effective_idx') and i.indisvalid), 3,
  'all three are valid');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind = 'i' and n.nspname = 'public' and c.relname in
            ('raw_lot_expiry_idx', 'payable_unpaid_due_idx', 'stock_movement_effective_idx')), 3,
  'and live in public');
select is((select count(*)::int from pg_index i join pg_class c on c.oid = i.indexrelid
            where c.relname in ('raw_lot_expiry_idx', 'payable_unpaid_due_idx', 'stock_movement_effective_idx')
              and i.indisunique), 0, 'none is unique: they cannot refuse a write');
-- The ledgers stay append-only (037 pins it in full): an index changes no trigger.
select is((select count(*)::int from pg_trigger t where t.tgrelid = 'public.stock_movement'::regclass and not t.tgisinternal
            and t.tgname in ('stock_movement_append_only', 'stock_movement_no_truncate')), 2, 'stock_movement keeps its append-only triggers');

select * from finish();
rollback;
