-- M13 step 5: stock_reconciliation (M13 plan §3.1.9, §3.8, §5 step 5; AT1). The fixture month is October 2026 at
-- Cella (it contains the DST change of 2026-10-25): receipts, consumption with a shortfall, waste with a reversal, a
-- transfer in each direction, a prior count, a daily count and the monthly count of 2026-10-31. Rows are inserted as
-- the migration owner with chosen dates; the checks call the function under claims. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('e0000000-0000-4000-8000-0000000000e0', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('e1000000-0000-4000-8000-0000000000e0', '11111111-1111-4111-8111-111111111111',
   'e0000000-0000-4000-8000-0000000000e0', 'waiter', 'Cameriere Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Freezer (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903'),
  ('5b000000-0000-4000-8000-00000000005b', '22222222-2222-4222-8222-222222222222', 'Fornitore B Demo', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
   'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a'),
  ('e2000000-0000-4000-8000-0000000000e2', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/2026/e2000000-0000-4000-8000-0000000000e2.pdf',
   'application/pdf', 2048, 'review', '5b000000-0000-4000-8000-00000000005b');

create temporary table reg (k text primary key, id uuid not null);
create temporary table results (k text primary key, j jsonb);
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
create function pg_temp.res(p_k text) returns jsonb language sql as $$ select j from results where k = p_k $$;
create function pg_temp.as_(p_who text) returns void language plpgsql as $$
declare
  v record;
begin
  if p_who = 'super' then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'none', true);
    return;
  end if;
  select * into v from (values
    ('owner', 'a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111'),
    ('chef', 'c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111'),
    ('waiter', 'e0000000-0000-4000-8000-0000000000e0', '11111111-1111-4111-8111-111111111111'),
    ('ownerb', 'b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222')) w (who, auth_id, tenant)
   where w.who = p_who;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v.auth_id, 'role', 'authenticated',
    'tenant_id', v.tenant, 'app_role', case p_who when 'ownerb' then 'owner' else p_who end)::text, true);
end
$$;
create function pg_temp.run(p_key text, p_who text, p_sql text) returns text language plpgsql as $$
declare
  v jsonb;
  state text;
  msg text;
begin
  perform pg_temp.as_(p_who);
  begin
    execute p_sql into v;
  exception when others then
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    perform pg_temp.as_('super');
    return state || ' ' || msg;
  end;
  perform pg_temp.as_('super');
  insert into results values (p_key, v) on conflict (k) do update set j = excluded.j;
  return 'ok';
end
$$;
-- Runs a call for its effect: a bare select would print 'ok', which pg_prove reads as a TAP line.
create function pg_temp.quiet(p text) returns void language plpgsql as $$ begin return; end $$;

create sequence pg_temp.line_seq;
create function pg_temp.new_line(p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns uuid language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
      line_amount, field_confidence, extracted)
    values (v_line, p_tenant,
      case when p_tenant = '11111111-1111-4111-8111-111111111111' then 'e1000000-0000-4000-8000-0000000000e1'
           else 'e2000000-0000-4000-8000-0000000000e2' end::uuid,
      v_n, 'Riga demo', 1, 10, 10, '{}', '{}');
  return v_line;
end
$$;
create function pg_temp.mk_ing(p_k text, p_name text, p_unit text default 'kg') returns void language sql as $$
  with r as (insert into reg values (p_k, gen_random_uuid()) returning id)
  insert into public.ingredient (id, tenant_id, name, base_unit)
    select r.id, '11111111-1111-4111-8111-111111111111', p_name, p_unit::public.base_unit from r
$$;
-- A lot with its receipt (unit_cost 10) at a location on a date.
create function pg_temp.lot(p_key text, p_ing text, p_loc text, p_qty numeric, p_on date, p_expiry date) returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_line();
  v_lot uuid := gen_random_uuid();
  v_loc uuid := case p_loc when 'cella' then '10000000-0000-4000-8000-0000000000a1' else '10000000-0000-4000-8000-0000000000a2' end;
begin
  insert into reg values (p_key, v_lot);
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code,
      expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    select v_lot, '11111111-1111-4111-8111-111111111111', i.id, v_loc, '5a000000-0000-4000-8000-00000000005a', v_line,
           upper(p_key), p_expiry, p_on, p_qty, i.base_unit, p_qty, i.base_unit::text, 1, 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = pg_temp.id(p_ing);
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
      ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), v_lot, v_loc, 'receipt', p_qty, 10,
      'invoice_line', v_line, p_on, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- One movement of tenant A at a location on a date.
create function pg_temp.mv(p_ing text, p_type text, p_qty numeric, p_on date, p_lot text default null, p_loc text default 'cella',
    p_ref_type text default 'manual', p_ref uuid default gen_random_uuid(), p_reason text default null,
    p_cost numeric default null) returns uuid language sql as $$
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code,
      ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), case when p_lot is null then null else pg_temp.id(p_lot) end,
      case p_loc when 'cella' then '10000000-0000-4000-8000-0000000000a1' else '10000000-0000-4000-8000-0000000000a2' end::uuid,
      p_type::public.stock_movement_type, p_qty, p_cost, p_reason, p_ref_type, p_ref, p_on, 'c1000000-0000-4000-8000-00000000000c')
  returning id
$$;
-- A closed count session at Cella with its lines (key, expected, counted). Lines are written while it is open.
create function pg_temp.count_session(p_key text, p_type text, p_closed timestamptz, p_lines jsonb) returns void language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  e jsonb;
  n int := 0;
begin
  insert into reg values (p_key, v_id);
  insert into public.count_session (id, tenant_id, location_id, type, started_by, started_at)
    values (v_id, '11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1', p_type,
            'c1000000-0000-4000-8000-00000000000c', p_closed - interval '1 hour');
  for e in select x from jsonb_array_elements(p_lines) x loop
    n := n + 1;
    insert into public.count_line (tenant_id, session_id, ingredient_id, position, expected_qty, counted_qty, entered_at,
        entered_by, created_by)
      values ('11111111-1111-4111-8111-111111111111', v_id, pg_temp.id(e->>'k'), n, (e->>'expected')::numeric,
              (e->>'counted')::numeric, p_closed - interval '30 minutes', 'c1000000-0000-4000-8000-00000000000c',
              'c1000000-0000-4000-8000-00000000000c');
  end loop;
  update public.count_session set status = 'closed', closed_at = p_closed, closed_by = 'c1000000-0000-4000-8000-00000000000c'
   where id = v_id;
end
$$;

-- The month ----------------------------------------------------------------------------------------------
select pg_temp.mk_ing('beef', 'Manzo muscolo (demo)');
select pg_temp.mk_ing('farina', 'Farina di mais (demo)');
select pg_temp.mk_ing('uova', 'Uova (demo)', 'pz');
select pg_temp.mk_ing('sale', 'Sale grosso (demo)');
select pg_temp.mk_ing('burro', 'Burro (demo)');
select pg_temp.mk_ing('olio', 'Olio EVO (demo)', 'l');

select pg_temp.count_session('p', 'monthly', '2026-09-30T20:00Z', '[{"k":"beef","expected":6,"counted":4}]');
select pg_temp.count_session('d', 'daily', '2026-10-20T14:00Z', '[{"k":"farina","expected":21,"counted":20}]');
select pg_temp.count_session('m', 'monthly', '2026-10-31T10:00Z', jsonb_build_array(
  jsonb_build_object('k', 'beef', 'expected', 7, 'counted', 6.8), jsonb_build_object('k', 'farina', 'expected', 20, 'counted', 20),
  jsonb_build_object('k', 'olio', 'expected', 9, 'counted', 9), jsonb_build_object('k', 'sale', 'expected', 1, 'counted', 1.5),
  jsonb_build_object('k', 'burro', 'expected', 2, 'counted', 1.75), jsonb_build_object('k', 'uova', 'expected', -6, 'counted', 0)));

-- Beef: opening 4 (6 received in September, count -2), receipts 10, consumption 3, waste 2 (a 0,5 operation reversed), 2 to the Freezer
select pg_temp.lot('b1', 'beef', 'cella', 6, '2026-09-10', '2026-11-01');
select pg_temp.mv('beef', 'count', -2, '2026-09-30', 'b1', 'cella', 'count_session', pg_temp.id('p'));
select pg_temp.lot('b2', 'beef', 'cella', 10, '2026-10-05', '2026-11-20');
select pg_temp.mv('beef', 'consumption', -3, '2026-10-08', 'b1');
select pg_temp.mv('beef', 'waste', -1, '2026-10-09', 'b1', 'cella', 'manual', '99000000-0000-4000-8000-000000000001', 'spoilage');
select pg_temp.mv('beef', 'waste', -1, '2026-10-09', 'b2', 'cella', 'manual', '99000000-0000-4000-8000-000000000001', 'spoilage');
select pg_temp.mv('beef', 'waste', -0.5, '2026-10-09', 'b2', 'cella', 'manual', '99000000-0000-4000-8000-000000000002', 'spoilage');
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, reason_code, ref_type, ref_id,
    reverses_id, effective_on, created_by)
  select tenant_id, ingredient_id, raw_lot_id, location_id, type, 0.5, reason_code, 'reversal', gen_random_uuid(), id, '2026-10-10', created_by
    from public.stock_movement where ref_id = '99000000-0000-4000-8000-000000000002';
select pg_temp.mv('beef', 'transfer', -2, '2026-10-12', 'b2', 'cella', 'transfer', '99000000-0000-4000-8000-000000000003');
select pg_temp.mv('beef', 'transfer', 2, '2026-10-12', 'b2', 'freezer', 'transfer', '99000000-0000-4000-8000-000000000003');
select pg_temp.mv('beef', 'count', -0.2, '2026-10-31', 'b2', 'cella', 'count_session', pg_temp.id('m'), null, 10);

-- Farina: receipts 25, consumption 4, daily count -1 on 20 October, no difference at the monthly count
select pg_temp.lot('f1', 'farina', 'cella', 25, '2026-10-03', '2026-12-01');
select pg_temp.mv('farina', 'consumption', -4, '2026-10-10', 'f1');
select pg_temp.mv('farina', 'count', -1, '2026-10-20', 'f1', 'cella', 'count_session', pg_temp.id('d'), null, 10);

-- Uova: opening 30, receipts 60, consumption 90, waste 6 on top of an empty stock (unlotted -6), count +6
select pg_temp.lot('u1', 'uova', 'cella', 30, '2026-09-12', '2026-10-30');
select pg_temp.lot('u2', 'uova', 'cella', 60, '2026-10-04', '2026-11-10');
select pg_temp.mv('uova', 'consumption', -30, '2026-10-15', 'u1');
select pg_temp.mv('uova', 'consumption', -60, '2026-10-15', 'u2');
select pg_temp.mv('uova', 'waste', -6, '2026-10-16', null, 'cella', 'manual', gen_random_uuid(), 'breakage');
select pg_temp.mv('uova', 'count', 6, '2026-10-31', null, 'cella', 'count_session', pg_temp.id('m'), null, 10);

-- Sale: 1 kg from the Freezer, count +0,5 without a price
select pg_temp.lot('s1', 'sale', 'freezer', 1, '2026-09-15', null);
select pg_temp.mv('sale', 'transfer', -1, '2026-10-15', 's1', 'freezer', 'transfer', '99000000-0000-4000-8000-000000000004');
select pg_temp.mv('sale', 'transfer', 1, '2026-10-15', 's1', 'cella', 'transfer', '99000000-0000-4000-8000-000000000004');
select pg_temp.mv('sale', 'count', 0.5, '2026-10-31', null, 'cella', 'count_session', pg_temp.id('m'));

-- Burro: opening 2, count -0,25
select pg_temp.lot('r1', 'burro', 'cella', 2, '2026-09-20', '2026-11-30');
select pg_temp.mv('burro', 'count', -0.25, '2026-10-31', 'r1', 'cella', 'count_session', pg_temp.id('m'), null, 10);

-- Olio: opening 5, receipts 10, consumption 6 dated on the DST day
select pg_temp.lot('o1', 'olio', 'cella', 5, '2026-09-18', null);
select pg_temp.lot('o2', 'olio', 'cella', 10, '2026-10-06', null);
select pg_temp.mv('olio', 'consumption', -5, '2026-10-25', 'o1');
select pg_temp.mv('olio', 'consumption', -1, '2026-10-25', 'o2');

-- Tenant B: one ingredient, one receipt
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('2a000000-0000-4000-8000-00000000002a', '22222222-2222-4222-8222-222222222222', 'Burro B (demo)', 'kg');
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on,
    qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
  values ('10700000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222',
    '2a000000-0000-4000-8000-00000000002a', '10000000-0000-4000-8000-0000000000b1',
    '5b000000-0000-4000-8000-00000000005b', pg_temp.new_line('22222222-2222-4222-8222-222222222222'), 'L-B1',
    '2026-10-02', 2, 'kg', 2, 'kg', 1, 'b1000000-0000-4000-8000-00000000000b');
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id,
    effective_on, created_by)
  values ('22222222-2222-4222-8222-222222222222', '2a000000-0000-4000-8000-00000000002a',
    '10700000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'receipt', 2, 10, 'invoice_line',
    (select id from public.invoice_line where tenant_id = '22222222-2222-4222-8222-222222222222' limit 1),
    '2026-10-02', 'b1000000-0000-4000-8000-00000000000b');

-- AT1 ------------------------------------------------------------------------------------------------------
select is(pg_temp.run('r', 'owner', $$ select public.stock_reconciliation('2026-10-01', '2026-10-31', '10000000-0000-4000-8000-0000000000a1') $$),
  'ok', 'the owner reconciles Cella for October');
select is(pg_temp.res('r')->>'from' || '..' || (pg_temp.res('r')->>'to'), '2026-10-01..2026-10-31', 'the answer carries the period');
select is(pg_temp.res('r')->'location'->>'name', 'Cella (demo)', '... and the location');
select is((select string_agg(e->>'name', '|' order by ord) from jsonb_array_elements(pg_temp.res('r')->'items') with ordinality x (e, ord)),
  'Burro (demo)|Farina di mais (demo)|Manzo muscolo (demo)|Olio EVO (demo)|Sale grosso (demo)|Uova (demo)',
  'exactly the six ingredients, ordered by name');

-- One row per ingredient: opening, receipts, consumption, waste, in, out, count adjustments, closing (all written here).
create temporary table want (k text, opening numeric, receipts numeric, consumption numeric, waste numeric, tin numeric,
  tout numeric, adj numeric, closing numeric);
insert into want values
  ('beef', 4, 10, 3, 2, 0, 2, -0.2, 6.8), ('farina', 0, 25, 4, 0, 0, 0, -1, 20), ('uova', 30, 60, 90, 6, 0, 0, 6, 0),
  ('sale', 0, 0, 0, 0, 1, 0, 0.5, 1.5), ('burro', 2, 0, 0, 0, 0, 0, -0.25, 1.75), ('olio', 5, 10, 6, 0, 0, 0, 0, 9);
select is((select count(*)::int from want w join jsonb_array_elements(pg_temp.res('r')->'items') e on e->>'ingredientId' = pg_temp.id(w.k)::text
            where (e->>'openingQty')::numeric = w.opening and (e->>'receiptsQty')::numeric = w.receipts
              and (e->>'consumptionQty')::numeric = w.consumption and (e->>'wasteQty')::numeric = w.waste
              and (e->>'transfersInQty')::numeric = w.tin and (e->>'transfersOutQty')::numeric = w.tout
              and (e->>'countAdjustmentsQty')::numeric = w.adj and (e->>'closingQty')::numeric = w.closing
              and (e->>'otherQty')::numeric = 0), 6, 'every column of every row equals the constants of the fixture');
select is((select count(*)::int from jsonb_array_elements(pg_temp.res('r')->'items') e
            where (e->>'balanced')::boolean and (e->>'matchesCount')::boolean and (e->>'otherQty')::numeric = 0), 6,
  'for every row: balanced, matchesCount true and otherQty 0');
select is((select count(*)::int from jsonb_array_elements(pg_temp.res('r')->'items') e
            where (e->>'openingQty')::numeric + (e->>'receiptsQty')::numeric - (e->>'consumptionQty')::numeric
                  - (e->>'wasteQty')::numeric + (e->>'transfersInQty')::numeric - (e->>'transfersOutQty')::numeric
                  + (e->>'countAdjustmentsQty')::numeric = (e->>'countedQty')::numeric), 6,
  'the PRD identity holds for every row: opening + receipts - consumption - waste +/- adjustments = counted');
select is((select (e->>'countedQty')::numeric from jsonb_array_elements(pg_temp.res('r')->'items') e where e->>'ingredientId' = pg_temp.id('farina')::text),
  20::numeric, 'Farina is counted 20 by the monthly count');
select is((select e->>'countSessionId' from jsonb_array_elements(pg_temp.res('r')->'items') e where e->>'ingredientId' = pg_temp.id('farina')::text),
  pg_temp.id('m')::text, '... from the monthly session, not the daily one');
select is((select (e->>'consumptionQty')::numeric from jsonb_array_elements(pg_temp.res('r')->'items') e where e->>'ingredientId' = pg_temp.id('olio')::text),
  6::numeric, 'Olio''s consumption of 25 October (the DST day) is in the period');
select is((select count(*)::int from jsonb_array_elements(pg_temp.res('r')->'items') e
            where (e->>'closingQty')::numeric = (select coalesce(sum(m.qty), 0) from public.stock_movement m
               where m.tenant_id = '11111111-1111-4111-8111-111111111111' and m.ingredient_id = (e->>'ingredientId')::uuid
                 and m.location_id = '10000000-0000-4000-8000-0000000000a1' and m.effective_on <= '2026-10-31')), 6,
  'closingQty equals an independent fold of the ledger');
select is((select e->>'countedAt' is not null from jsonb_array_elements(pg_temp.res('r')->'items') e where e->>'ingredientId' = pg_temp.id('beef')::text),
  true, 'countedAt is set');

-- Freezer ---------------------------------------------------------------------------------------------------
select pg_temp.quiet(pg_temp.run('fr', 'owner', $$ select public.stock_reconciliation('2026-10-01', '2026-10-31', '10000000-0000-4000-8000-0000000000a2') $$));
select is((select trim_scale((e->>'openingQty')::numeric)::text || '/' || trim_scale((e->>'transfersInQty')::numeric)::text || '/'
                    || trim_scale((e->>'closingQty')::numeric)::text
             from jsonb_array_elements(pg_temp.res('fr')->'items') e where e->>'ingredientId' = pg_temp.id('beef')::text),
  '0/2/2', 'Freezer: beef opening 0, in 2, closing 2');
select is((select (e->'countedQty')::text || ',' || (e->'matchesCount')::text from jsonb_array_elements(pg_temp.res('fr')->'items') e
            where e->>'ingredientId' = pg_temp.id('beef')::text), 'null,null', '... not counted');
select is((select count(*)::int from jsonb_array_elements(pg_temp.res('fr')->'items') e where (e->>'balanced')::boolean), 2,
  'Freezer rows balance too (beef and sale)');

-- After the count ------------------------------------------------------------------------------------------
select pg_temp.mv('beef', 'waste', -0.5, '2026-11-01', 'b2', 'cella', 'manual', gen_random_uuid(), 'spoilage');
select pg_temp.quiet(pg_temp.run('r2', 'owner', $$ select public.stock_reconciliation('2026-10-01', '2026-11-02', '10000000-0000-4000-8000-0000000000a1') $$));
select is((select e->>'afterCountQty' || '/' || (e->>'matchesCount') || '/' || (e->>'balanced')
             from jsonb_array_elements(pg_temp.res('r2')->'items') e where e->>'ingredientId' = pg_temp.id('beef')::text),
  '-0.5000/false/true', 'a waste after the count: afterCountQty -0,5, matchesCount false, still balanced');

-- Errors, roles --------------------------------------------------------------------------------------------
select is(pg_temp.run('x', 'owner', $$ select public.stock_reconciliation('2026-10-31', '2026-10-01', '10000000-0000-4000-8000-0000000000a1') $$),
  'P0001 range_invalid', 'from after to is range_invalid');
select is(pg_temp.run('x', 'owner', $$ select public.stock_reconciliation('2026-01-01', '2027-01-02', '10000000-0000-4000-8000-0000000000a1') $$),
  'P0001 range_too_long', '367 days is range_too_long');
select is(pg_temp.run('x', 'owner', $$ select public.stock_reconciliation('2026-01-01', '2026-12-31', '10000000-0000-4000-8000-0000000000a1') $$),
  'ok', '365 days is accepted');
select is(pg_temp.run('x', 'owner', $$ select public.stock_reconciliation('2026-10-01', '2026-10-31') $$), 'P0001 location_required',
  'two locations and none chosen: location_required');
select is(pg_temp.run('x', 'owner', $$ select public.stock_reconciliation(null, '2026-10-31', '10000000-0000-4000-8000-0000000000a1') $$),
  '22023 invalid_request', 'a missing date is invalid');
select is(pg_temp.run('x', 'owner', $$ select public.stock_reconciliation('2026-10-01', '2026-10-31', '10000000-0000-4000-8000-0000000000b1') $$),
  'P0001 location_not_found', 'tenant B''s location is not found');
select is(pg_temp.run('rc', 'chef', $$ select public.stock_reconciliation('2026-10-01', '2026-10-31', '10000000-0000-4000-8000-0000000000a1') $$),
  'ok', 'the chef may reconcile');
select is(pg_temp.res('rc')->'items', pg_temp.res('r')->'items' , 'the chef gets the same numbers');
select ok(not (pg_temp.res('rc')::text ~* '"[^"]*(cost|price|eur|value|amount|margin)[^"]*"\s*:'), '... with no cost-like key');
select is(pg_temp.run('x', 'waiter', $$ select public.stock_reconciliation('2026-10-01', '2026-10-31', '10000000-0000-4000-8000-0000000000a1') $$),
  '42501 permission denied: stock needs owner, admin or chef', 'the waiter is refused');
select is(pg_temp.run('rb', 'ownerb', $$ select public.stock_reconciliation('2026-10-01', '2026-10-31') $$), 'ok', 'owner B reconciles');
select is((select string_agg(e->>'name', '|') from jsonb_array_elements(pg_temp.res('rb')->'items') e), 'Burro B (demo)',
  '... and sees only B''s ingredient');
select is((select count(*)::int from (values ('public.stock_reconciliation(date, date, uuid)')) f (sig)
            cross join (values ('anon'), ('service_role')) r (rolname) where has_function_privilege(r.rolname, f.sig, 'execute')), 0,
  'anon and service_role cannot execute it');

select * from finish();
rollback;
