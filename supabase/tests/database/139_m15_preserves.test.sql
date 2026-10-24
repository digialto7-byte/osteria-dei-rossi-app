-- M15 step 9: M15 changed nothing of what M8, M12 and M14 built. The engine, the stock lock, the lot lock and sequence,
-- the production core and procedure, the batch guards and readers, the M12 raw waste report and the reversal procedure are
-- pinned by md5 of their source text (the technique of 098 and 128, here over prosrc so the pin does not depend on the
-- Postgres version); each exists once; a raw staff-meal row cannot be reversed through reverse_movement; no alert kind and
-- no movement or batch enum value was added; and the staff-meal core consumes through the engine only. 122-125 and
-- 127-129 run unchanged beside this file. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
   'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount,
    field_confidence, extracted)
  values ('a2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
    'e1000000-0000-4000-8000-0000000000e1', 1, 'Riga demo', 1, 10, 10, '{}', '{}');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Pane (demo)', 'kg', true);
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on,
    qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
  values ('10700000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
    '1a000000-0000-4000-8000-00000000001a', '10000000-0000-4000-8000-0000000000a1',
    '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-000000000001', 'L-PANE', '2026-10-20', 5, 'kg', 5, 'kg', 1,
    'a1000000-0000-4000-8000-00000000000a');
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id,
    effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
    '10700000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'receipt', 5, 3, 'invoice_line',
    'a2000000-0000-4000-8000-000000000001', '2026-10-20', 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
create function pg_temp.src(p_schema text, p_name text) returns text language sql stable as $$
  select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = p_schema and p.proname = p_name $$;
create temporary table res (k text primary key, j jsonb);
create temporary table outs (k text primary key, v text);
grant all on res, outs to authenticated;
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text) to authenticated;

-- Exactly one definition of each (no overload, no second copy).
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname, p.proname) in (('app', 'post_stock_outflow'), ('app', 'lock_ingredient_stock'), ('app', 'lock_batch_lot'),
              ('app', 'next_lot_seq'), ('app', 'produce_batch_core'), ('public', 'produce_batch'), ('public', 'raw_waste_costs'),
              ('public', 'reverse_movement'))),
  8, 'post_stock_outflow, lock_ingredient_stock, lock_batch_lot, next_lot_seq, produce_batch_core, produce_batch, raw_waste_costs and reverse_movement: one definition each');

-- The pins (md5 of the source text, computed on the chain up to 20261028100500 = M14 on main).
select is(md5(pg_temp.src('app', 'post_stock_outflow')), '7c0933ea4b368c76d06202e833bf70fd', 'app.post_stock_outflow is the M12 engine (md5)');
select is(md5(pg_temp.src('app', 'lock_ingredient_stock')), 'a732cf452d0256989653453eb1ecf1f7', 'app.lock_ingredient_stock is the M12 lock (md5)');
select is(md5(pg_temp.src('public', 'reverse_movement')), 'e85dbf122c4c7e424f1f0780fa56a38f', 'public.reverse_movement is the M12 procedure (md5)');
select is(md5(pg_temp.src('public', 'raw_waste_costs')), 'e28c430cb29b7ab3d34fe7c1b80c9823', 'public.raw_waste_costs is the M12 report (md5)');
select is(md5(pg_temp.src('app', 'lock_batch_lot')), '2e94f43f38f9e4786b6d8f3df2216069', 'app.lock_batch_lot is the M14 lot lock (md5)');
select is(md5(pg_temp.src('app', 'next_lot_seq')), '1afd8c8994f01ff1de4a9dd97397d665', 'app.next_lot_seq is the M14 sequence (md5)');
select is(md5(pg_temp.src('app', 'produce_batch_core')), 'db2747533714443cdcaec4e4710ce64f', 'app.produce_batch_core is the M14 core (md5)');
select is(md5(pg_temp.src('public', 'produce_batch')), '02fef96a8ae90cb4a5adacb046c7b706', 'public.produce_batch is the M14 procedure (md5)');
select is(md5(pg_temp.src('app', 'batch_guard')), '095ad3d86f3f4af1388e5e19338462ae', 'app.batch_guard is the M14 guard (md5): only state may change');
select is(md5(pg_temp.src('app', 'batch_input_guard')), 'eed3af4262cc3dc21afce432a1da95e1', 'app.batch_input_guard is the M14 guard (md5)');
select is(md5(pg_temp.src('public', 'batch_list')), '7bd4160b02c0751cccaf47672d57813a', 'public.batch_list is the M14 read (md5)');
select is(md5(pg_temp.src('public', 'batch_costs')), 'd26007ee3eb9af704d759487b6386b60', 'public.batch_costs is the M14 read (md5)');
select is(md5(pg_temp.src('app', 'require_batch_writer')) || md5(pg_temp.src('app', 'require_batch_reader')),
  'c7ab5e54bc7e30d501e82f820256dadb03299e67dcc5ec15af2cd4b2f6765e2c', 'the M14 role checks are unchanged (md5)');

-- No alert kind was added, and no enum value.
select is((select string_agg(kind, ',' order by kind) from app.alert_kind),
  'device_locked,ledger_drift,negative_stock,payable_due_7d,payable_due_today,payable_overdue_3d,payables_weekly_digest,price_variance,test_alert,test_alert_kitchen',
  'the alert kinds are unchanged (M15 adds none)');
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.stock_movement_type'::regtype),
  'receipt,consumption,waste,transfer,count', 'stock_movement_type is unchanged');
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.batch_movement_type'::regtype),
  'produce,consume,count,waste,split', 'batch_movement_type is unchanged');
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.batch_state'::regtype),
  'fresh,open,finished,discarded', 'batch_state is unchanged');

-- The staff-meal core consumes raw stock through the engine only, and takes no stock lock before its batch locks.
select ok(pg_temp.src('app', 'confirm_staff_meal_core') ~ 'app\.post_stock_outflow\(' and pg_temp.src('app', 'confirm_staff_meal_core') ~ '''confirm_staff_meal''',
  'confirm_staff_meal_core consumes raw stock through the engine and names itself as the caller');
select ok(pg_temp.src('app', 'confirm_staff_meal_core') !~ 'insert into public\.stock_movement'
          and pg_temp.src('app', 'confirm_staff_meal_core') !~ 'app\.(try_)?raise_alert\('
          and position('app.lock_ingredient_stock(' in pg_temp.src('app', 'confirm_staff_meal_core')) = 0,
  'and writes no stock movement, raises no alert and takes no stock lock itself');
select ok(position('insert into public.staff_meal_confirmation' in pg_temp.src('app', 'confirm_staff_meal_core')) > 0
          and position('insert into public.staff_meal_confirmation' in pg_temp.src('app', 'confirm_staff_meal_core'))
              < position('app.lock_batch_rows(' in pg_temp.src('app', 'confirm_staff_meal_core')),
  'the confirmation is inserted before any batch row lock (a waiting second call holds nothing)');

-- A raw staff-meal row is not reversible through reverse_movement (M12 rule: only manual and transfer rows are).
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
insert into res select 'rule', public.set_staff_meal_rule(null, '1a000000-0000-4000-8000-00000000001a', 0.5, 'kg');
insert into res select 'conf', public.confirm_staff_meal((select (j->>'ruleId')::uuid from res where k = 'rule'));
reset role;
create temporary table target as select m.id from public.stock_movement m where m.ref_type = 'staff_meal';
grant all on target to authenticated;
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
insert into outs select 'rev_owner', pg_temp.err(format('select public.reverse_movement(%L)', (select id from target)));
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
insert into outs select 'rev_chef', pg_temp.err(format('select public.reverse_movement(%L)', (select id from target)));
reset role;
select is((select count(*)::int from target), 1, 'the staff meal wrote one raw row');
select is((select v from outs where k = 'rev_owner'), 'P0001 movement_not_reversible', 'the owner cannot reverse a raw staff-meal row');
select is((select v from outs where k = 'rev_chef'), 'P0001 movement_not_reversible', 'nor can the chef');
select is((select count(*)::int from public.stock_movement m where m.reverses_id is not null), 0, 'and no reversal row exists');

select * from finish();
rollback;
