-- M16 step 8: app.expiry_rule (plan §3.1.8; AT5). Clock 2026-11-02T14:00Z (15:00 Rome). Batches: use-by in 20 h with 6
-- portions alerts, with 0 portions does not; raw lots: expiry tomorrow alerts, in two days does not. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'), ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Macelleria X (demo)', 'IT12345678903'),
  ('5a000000-0000-4000-8000-0000000000b5', '22222222-2222-4222-8222-222222222222', 'Macelleria B (demo)', 'IT11111111115');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a'),
  ('e1000000-0000-4000-8000-0000000000e2', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/2026/e1000000-0000-4000-8000-0000000000e2.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-0000000000b5');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Cipolla (demo)', 'kg', true),
  ('1b000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Cipolla B (demo)', 'kg', true);
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('b2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('b2000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'batch', 1, 'spezzatino b (demo)', 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('c2000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'b2000000-0000-4000-8000-000000000001', 1, '2026-10-01T00:00Z', 'Spezzatino (demo)', 6, 'kg', 30, 72, 'a1000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'b2000000-0000-4000-8000-0000000000b1', 1, '2026-10-01T00:00Z', 'Spezzatino B (demo)', 6, 'kg', 30, 72, 'b1000000-0000-4000-8000-00000000000b');

create temporary table reg (k text primary key, id uuid not null);
insert into reg values ('cella', '10000000-0000-4000-8000-0000000000a1'), ('cellab', '10000000-0000-4000-8000-0000000000b1');
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
create sequence pg_temp.line_seq;
create sequence pg_temp.seq;
create function pg_temp.new_line(p_tenant uuid) returns uuid language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, p_tenant, case when p_tenant = '11111111-1111-4111-8111-111111111111' then 'e1000000-0000-4000-8000-0000000000e1'::uuid
                                   else 'e1000000-0000-4000-8000-0000000000e2'::uuid end, v_n, 'Riga demo', 1, 10, 10, '{}', '{}');
  return v_line;
end
$$;
-- A lot of onion with its receipt; the key names the lot.
create function pg_temp.mk_lot(p_key text, p_expiry date, p_qty numeric, p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_line(p_tenant);
  v_lot uuid := gen_random_uuid();
  v_a boolean := p_tenant = '11111111-1111-4111-8111-111111111111';
  v_ing uuid := case when v_a then '1a000000-0000-4000-8000-000000000002'::uuid else '1b000000-0000-4000-8000-000000000002'::uuid end;
  v_loc uuid := case when v_a then pg_temp.id('cella') else pg_temp.id('cellab') end;
  v_by uuid := case when v_a then 'a1000000-0000-4000-8000-00000000000a'::uuid else 'b1000000-0000-4000-8000-00000000000b'::uuid end;
  v_sup uuid := case when v_a then '5a000000-0000-4000-8000-00000000005a'::uuid else '5a000000-0000-4000-8000-0000000000b5'::uuid end;
begin
  insert into reg values (p_key, v_lot);
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, expiry, received_on, qty_received,
      base_unit, source_qty, source_unit, base_factor, created_by)
    values (v_lot, p_tenant, v_ing, v_loc, v_sup, v_line, upper(p_key), p_expiry, '2026-10-01', p_qty, 'kg', p_qty, 'kg', 1, v_by);
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
    values (p_tenant, v_ing, v_lot, v_loc, 'receipt', p_qty, 10, 'invoice_line', v_line, '2026-10-01', v_by);
end
$$;
create function pg_temp.use_lot(p_key text, p_qty numeric) returns void language plpgsql as $$
begin
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000002', pg_temp.id(p_key), pg_temp.id('cella'), 'consumption', -p_qty,
      'manual', gen_random_uuid(), '2026-11-01', 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- A batch of the stew (tenant A) with its use-by and portions.
create function pg_temp.mk_batch(p_key text, p_portions int, p_use_by timestamptz, p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_n int := nextval('pg_temp.seq');
  v_a boolean := p_tenant = '11111111-1111-4111-8111-111111111111';
  v_by uuid := case when v_a then 'c1000000-0000-4000-8000-00000000000c'::uuid else 'b1000000-0000-4000-8000-00000000000b'::uuid end;
begin
  insert into reg values (p_key, v_id);
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by,
      output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, location_id, created_by)
    values (v_id, p_tenant, case when v_a then 'b2000000-0000-4000-8000-000000000001'::uuid else 'b2000000-0000-4000-8000-0000000000b1'::uuid end,
      case when v_a then 'c2000000-0000-4000-8000-000000000011'::uuid else 'c2000000-0000-4000-8000-0000000000b1'::uuid end, 1,
      '261023-SPEZZA-' || v_n, '2026-10-23', 'SPEZZA', v_n, p_use_by - interval '72 hours', v_by, 6, 'kg', greatest(p_portions, 1), greatest(p_portions, 1), 72,
      p_use_by, case when v_a then pg_temp.id('cella') else pg_temp.id('cellab') end, v_by);
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
    values (p_tenant, v_id, 'produce', greatest(p_portions, 1), 'batch', v_id, '2026-10-23', v_by);
end
$$;
create function pg_temp.al(p_key text) returns text language sql as $$
  select coalesce(string_agg(a.kind || ' ' || a.severity::text || ' ' || (a.payload ->> 'state_key') || ' ' || a.audience_roles::text, '; '), '-')
    from public.alert a where a.entity_id = pg_temp.id(p_key) $$;
create function pg_temp.pl(p_key text) returns jsonb language sql as $$ select a.payload from public.alert a where a.entity_id = pg_temp.id(p_key) $$;

-- Batches (AT5): use-by in 20 h with 6 portions; the same with 0 portions; 24 h exactly; 24 h + 1 s; 25 h; now; passed.
select pg_temp.mk_batch('b20', 6, '2026-11-03T10:00:00Z');
select pg_temp.mk_batch('b20zero', 6, '2026-11-03T10:00:00Z');
select pg_temp.mk_batch('b24', 3, '2026-11-03T14:00:00Z');
select pg_temp.mk_batch('b24s', 3, '2026-11-03T14:00:01Z');
select pg_temp.mk_batch('b25', 3, '2026-11-03T15:00:00Z');
select pg_temp.mk_batch('bnow', 1, '2026-11-02T14:00:00Z');
select pg_temp.mk_batch('bpast', 2, '2026-11-02T13:00:00Z');
select pg_temp.mk_batch('bpastzero', 2, '2026-11-02T13:00:00Z');
-- Zero portions left: a waste row of -6 (the M14 shape check only allows produce rows, so the constraint is dropped inside this rolled-back transaction).
alter table public.batch_movement drop constraint if exists batch_movement_m14_ck;
insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.id('b20zero'), 'waste', -6, 'spoilage', 'waste', pg_temp.id('b20zero'), '2026-11-02', 'c1000000-0000-4000-8000-00000000000c'),
         ('11111111-1111-4111-8111-111111111111', pg_temp.id('bpastzero'), 'waste', -2, 'spoilage', 'waste', pg_temp.id('bpastzero'), '2026-11-02', 'c1000000-0000-4000-8000-00000000000c');

-- Raw lots: expiry tomorrow, in two days, today, yesterday with 0,5 left, fully used, no expiry.
select pg_temp.mk_lot('l-exp', '2026-11-03', 1);
select pg_temp.mk_lot('l-two', '2026-11-04', 1);
select pg_temp.mk_lot('l-today', '2026-11-02', 2);
select pg_temp.mk_lot('l-old', '2026-11-01', 1);
select pg_temp.use_lot('l-old', 0.5);
select pg_temp.mk_lot('l-used', '2026-11-03', 1);
select pg_temp.use_lot('l-used', 1);
select pg_temp.mk_lot('l-none', null, 1);
select pg_temp.mk_lot('l-oldzero', '2026-10-01', 1);
select pg_temp.use_lot('l-oldzero', 1);
-- Tenant B: the same lot and batch as tenant A's alerting ones.
select pg_temp.mk_lot('b-lot', '2026-11-03', 1, '22222222-2222-4222-8222-222222222222');
select pg_temp.mk_batch('b-batch', 6, '2026-11-03T10:00:00Z', '22222222-2222-4222-8222-222222222222');

create temporary table res (k text primary key, v integer);
insert into res select 'r1', app.expiry_rule('11111111-1111-4111-8111-111111111111', '2026-11-02T14:00:00Z');

select is(pg_temp.al('b20'), 'batch_expiring warning due_soon {owner,chef}', 'AT5: use-by in 20 h with 6 portions: one batch_expiring, due soon, warning, owner and chef');
select is(pg_temp.pl('b20'), ('{"batch_id":"' || pg_temp.id('b20') || '","recipe_key":"b2000000-0000-4000-8000-000000000001","remaining_portions_qty":6,"use_by_at":"2026-11-03T10:00:00Z","state_key":"due_soon"}')::jsonb,
  'AT5: the payload holds the batch, the recipe key, 6 portions, the UTC use-by instant and the state');
select is(pg_temp.al('b20zero'), '-', 'AT5: the same batch with 0 portions: no alert');
select is(pg_temp.al('b24'), 'batch_expiring warning due_soon {owner,chef}', 'use-by exactly 24 h away is due soon');
select is(pg_temp.al('b24s'), '-', '24 h and one second away is not');
select is(pg_temp.al('b25'), '-', 'use-by in 25 h: no alert');
select is(pg_temp.al('bnow'), 'batch_expiring critical expired {owner,chef}', 'use-by exactly now is expired, critical');
select is(pg_temp.al('bpast'), 'batch_expiring critical expired {owner,chef}', 'use-by passed with 2 portions: expired, critical');
select is(pg_temp.al('bpastzero'), '-', 'use-by passed with 0 portions left (discarded): no alert');
select is((pg_temp.pl('bpast') ->> 'use_by_at'), '2026-11-02T13:00:00Z', 'the use-by instant is written in UTC with a Z');

select is(pg_temp.al('l-exp'), 'raw_lot_expiring warning due_soon {owner,chef}', 'AT5: a lot expiring tomorrow: due soon, warning, owner and chef');
select is(pg_temp.pl('l-exp'), ('{"raw_lot_id":"' || pg_temp.id('l-exp') || '","ingredient_id":"1a000000-0000-4000-8000-000000000002","remaining_qty":1,"unit":"kg","expiry_date":"2026-11-03","state_key":"due_soon"}')::jsonb,
  'with the lot, the ingredient, the balance, the unit, the expiry date and the state');
select is(pg_temp.al('l-two'), '-', 'a lot expiring in two days: no alert');
select is(pg_temp.al('l-today'), 'raw_lot_expiring warning due_soon {owner,chef}', 'a lot expiring today (not yet expired) is due soon');
select is(pg_temp.al('l-old'), 'raw_lot_expiring critical expired {owner,chef}', 'a lot that expired yesterday with 0,5 kg left: expired, critical');
select is((pg_temp.pl('l-old') ->> 'remaining_qty')::numeric, 0.5::numeric, 'with the balance of the lot (1 - 0,5)');
select is(pg_temp.al('l-used'), '-', 'a lot fully consumed (balance 0): no alert');
select is(pg_temp.al('l-none'), '-', 'a lot without an expiry: no alert (no expiry is invented)');
select is(pg_temp.al('l-oldzero'), '-', 'an old expired lot with nothing left: no alert');
select is((select v from res where k = 'r1'), 7, 'the first run raised seven alerts: four batches (20 h, 24 h, now, passed) and three lots (expiring tomorrow, today, yesterday)');

select is((select count(*)::int from public.alert a where a.tenant_id = '22222222-2222-4222-8222-222222222222'), 0, 'tenant A''s run raised nothing for tenant B');
insert into res select 'r2', app.expiry_rule('11111111-1111-4111-8111-111111111111', '2026-11-02T15:00:00Z');
insert into res select 'r3', app.expiry_rule('11111111-1111-4111-8111-111111111111', '2026-11-02T22:30:00Z');
select is((select v from res where k = 'r2'), 2, 'an hour later, the two batches that have just come within 24 h (24 h + 1 s and 25 h away) alert; the others are not repeated');
select is((select v from res where k = 'r3'), 0, 'AT4 part: a run at 23:30 Rome the same day raises nothing new');
select is((select count(*)::int from public.alert a where a.business_date = '2026-11-02'), 9, 'nine alerts for the day');
insert into res select 'r4', app.expiry_rule('11111111-1111-4111-8111-111111111111', '2026-11-02T23:30:00Z');
select is((select v from res where k = 'r4'), 10, 'a run at 00:30 Rome the next day raises a new set dated 3 Nov: six batches and four lots in the window');
select is((select count(*)::int from public.alert a where a.business_date = '2026-11-03' and a.kind = 'batch_expiring'), 6, 'batches: 20 h, 24 h, 24 h + 1 s, 25 h, now and passed (the two with 0 portions stay out)');
select is((select count(*)::int from public.alert a where a.business_date = '2026-11-03' and a.kind = 'raw_lot_expiring'), 4, 'lots: expiring 3 Nov and 4 Nov (due soon), and the two expired ones that still have stock');

insert into res select 'rb', app.expiry_rule('22222222-2222-4222-8222-222222222222', '2026-11-02T14:00:00Z');
select is((select v from res where k = 'rb'), 2, 'tenant B''s run raises its own two alerts');
select is((select count(*)::int from public.alert a where a.tenant_id = '22222222-2222-4222-8222-222222222222' and a.entity_id in (pg_temp.id('b-lot'), pg_temp.id('b-batch'))), 2, 'for its own lot and batch');
select is((select count(*)::int from public.alert a where a.tenant_id = '11111111-1111-4111-8111-111111111111' and a.entity_id in (pg_temp.id('b-lot'), pg_temp.id('b-batch'))), 0, 'and none for tenant A');

-- Same answer under another session time zone (elapsed hours and Rome dates, not session arithmetic).
select pg_temp.mk_batch('tz', 4, '2026-11-10T10:00:00Z');
set local timezone = 'America/New_York';
insert into res select 'tz', app.expiry_rule('11111111-1111-4111-8111-111111111111', '2026-11-09T14:00:00Z');
set local timezone = 'Europe/Rome';
select is(pg_temp.al('tz'), 'batch_expiring warning due_soon {owner,chef}', 'the batch 20 h away alerts under America/New_York too');

-- Payloads.
select is((select count(*)::int from public.alert a where not app.chef_payload_allowed(a.payload)), 0, 'every payload passes the chef allow-list');
select is((select count(*)::int from public.alert a where app.payload_money_keys(a.payload) <> '{}' or a.cost_bearing), 0, 'and has no money key');
select is((select count(*)::int from public.alert a, jsonb_each(a.payload) e where jsonb_typeof(e.value) = 'string'
             and e.key not in ('batch_id', 'recipe_key', 'raw_lot_id', 'ingredient_id', 'use_by_at', 'expiry_date', 'state_key', 'unit')), 0,
  'strings only under id, date, instant, state and unit keys');
select is((select count(*)::int from public.alert a where a.kind = 'raw_lot_expiring' and a.severity = 'critical' and a.payload ->> 'state_key' <> 'expired'), 0, 'critical goes with expired only');
select is_empty(
  $$ select p.proname || ':' || r from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
      where p.pronamespace = 'app'::regnamespace and p.proname = 'expiry_rule' and has_function_privilege(r, p.oid, 'execute') $$,
  'no API role can execute app.expiry_rule');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'expiry_rule' and p.prosecdef
            and p.proconfig @> array['search_path=""']), 1, 'it is security definer with an empty search_path');

select * from finish();
rollback;
