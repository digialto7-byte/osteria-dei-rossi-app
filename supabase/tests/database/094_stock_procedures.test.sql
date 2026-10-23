-- M12 step 5: the public stock procedures consume_raw_fefo, post_waste, post_transfer and reverse_movement
-- (M12 plan §3.1.4-6, §3.2; AT1, AT3, AT4, AT5, AT6 at procedure level; Q1 = owner+chef+admin write).
-- Chef A calls unless stated. Fixtures are inserted as the migration owner; calls run with request claims.
begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
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

-- Registry of fixture ids by key ------------------------------------------------------------------------
create temporary table reg (k text primary key, id uuid not null);
insert into reg values ('cella', '10000000-0000-4000-8000-0000000000a1'), ('freezer', '10000000-0000-4000-8000-0000000000a2'),
  ('cellab', '10000000-0000-4000-8000-0000000000b1');
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
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
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;

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
create function pg_temp.mk_ing(p_k text, p_unit text default 'kg', p_stock boolean default true) returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.ingredient (id, tenant_id, name, base_unit, is_stock)
    values (pg_temp.id(p_k), '11111111-1111-4111-8111-111111111111', p_k || ' (demo)', p_unit::public.base_unit, p_stock);
end
$$;
-- A lot with its receipt (unit_cost 10) at a location.
create function pg_temp.mk_lot(p_key text, p_code text, p_ing text, p_loc text, p_expiry date, p_recv date, p_qty numeric)
  returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_line();
  v_lot uuid := gen_random_uuid();
begin
  insert into reg values (p_key, v_lot);
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code,
      expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    select v_lot, '11111111-1111-4111-8111-111111111111', i.id, pg_temp.id(p_loc),
           '5a000000-0000-4000-8000-00000000005a', v_line, p_code, p_expiry, p_recv, p_qty, i.base_unit, p_qty,
           i.base_unit::text, 1, 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = pg_temp.id(p_ing);
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
      ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), v_lot, pg_temp.id(p_loc), 'receipt', p_qty, 10,
      'invoice_line', v_line, p_recv, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- The AT1 fixture: three lots of 2 kg at Cella, received the same day; inserted out of FEFO order.
create function pg_temp.std(p_k text) returns void language plpgsql as $$
begin
  perform pg_temp.mk_ing(p_k);
  perform pg_temp.mk_lot(p_k || '_d5', 'L-D5', p_k, 'cella', '2026-10-28', '2026-10-20', 2);
  perform pg_temp.mk_lot(p_k || '_d2', 'L-D2', p_k, 'cella', '2026-10-25', '2026-10-20', 2);
  perform pg_temp.mk_lot(p_k || '_none', 'L-NONE', p_k, 'cella', null, '2026-10-20', 2);
end
$$;
create function pg_temp.buy(p_ing text, p_price numeric, p_on date) returns void language sql as $$
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit,
      effective_on, created_by)
    select '11111111-1111-4111-8111-111111111111', i.id, '5a000000-0000-4000-8000-00000000005a', pg_temp.new_line(),
           p_price, i.base_unit, p_on, 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = pg_temp.id(p_ing)
$$;

create function pg_temp.alerts(p_ing text) returns int language sql as $$
  select count(*)::int from public.alert where kind = 'negative_stock' and entity_id = pg_temp.id(p_ing)
$$;
create function pg_temp.on_hand(p_ing text, p_loc text default 'cella') returns numeric language sql as $$
  select app.location_on_hand('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), pg_temp.id(p_loc))
$$;

-- Tenant B: one location, one ingredient, one lot (isolation) ---------------------------------------------
insert into public.ingredient (id, tenant_id, name, base_unit)
  values ('1b000000-0000-4000-8000-00000000001b', '22222222-2222-4222-8222-222222222222', 'Burro B (demo)', 'kg');
insert into reg values ('lotb', '10700000-0000-4000-8000-0000000000b1');
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code, received_on,
    qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
  values ('10700000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222',
    '1b000000-0000-4000-8000-00000000001b', '10000000-0000-4000-8000-0000000000b1',
    '5b000000-0000-4000-8000-00000000005b', pg_temp.new_line('22222222-2222-4222-8222-222222222222'), 'L-B1',
    '2026-10-20', 2, 'kg', 2, 'kg', 1, 'b1000000-0000-4000-8000-00000000000b');


insert into auth.users (id, email) values ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Supporto Demo');
insert into public.location (id, tenant_id, name, is_active)
  values ('10000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)', false);
insert into reg values ('dispensa', '10000000-0000-4000-8000-0000000000a3');

create function pg_temp.as_chef() returns void language sql as $$
  select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef') $$;
create function pg_temp.as_owner() returns void language sql as $$
  select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner') $$;
create function pg_temp.as_admin() returns void language sql as $$
  select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin') $$;
create function pg_temp.as_ownerb() returns void language sql as $$
  select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner') $$;

-- The answer of each call, by key.
create temporary table res (k text primary key, r jsonb);
create function pg_temp.waste(p_k text, p_ing text, p_qty numeric, p_reason text default 'spoilage', p_loc text default null,
    p_lot text default null, p_unit text default 'kg') returns void language sql as $$
  insert into res select p_k, public.post_waste(pg_temp.id(p_ing), p_qty, p_unit, p_reason,
    case when p_loc is null then null else pg_temp.id(p_loc) end, case when p_lot is null then null else pg_temp.id(p_lot) end) $$;
create function pg_temp.consume(p_k text, p_ing text, p_qty numeric, p_loc text default null, p_lot text default null)
  returns void language sql as $$
  insert into res select p_k, public.consume_raw_fefo(pg_temp.id(p_ing), p_qty, 'kg',
    case when p_loc is null then null else pg_temp.id(p_loc) end, case when p_lot is null then null else pg_temp.id(p_lot) end) $$;
create function pg_temp.transfer(p_k text, p_ing text, p_qty numeric, p_from text, p_to text, p_lot text default null)
  returns void language sql as $$
  insert into res select p_k, public.post_transfer(pg_temp.id(p_ing), p_qty, 'kg', pg_temp.id(p_from), pg_temp.id(p_to),
    case when p_lot is null then null else pg_temp.id(p_lot) end) $$;
create function pg_temp.reverse(p_k text, p_movement uuid) returns void language sql as $$
  insert into res select p_k, public.reverse_movement(p_movement) $$;
create function pg_temp.op(p_k text) returns uuid language sql as $$ select (r ->> 'operationId')::uuid from res where k = p_k $$;
-- The rows of an operation as 'lotcode@location qty' sorted (a shortfall has the lot code 'null').
create function pg_temp.rows_of(p_op uuid) returns text language sql as $$
  select coalesce(string_agg(coalesce(l.lot_code, 'null') || '@' || left(x.name, 1) || ' ' || trim_scale(m.qty)::text, ', '
                             order by coalesce(l.lot_code, 'null') collate "C", x.name collate "C", m.qty), '-')
    from public.stock_movement m
    join public.location x on x.id = m.location_id
    left join public.raw_lot l on l.id = m.raw_lot_id
   where m.ref_id = p_op $$;
-- The buckets of an ingredient as 'location/lotcode=qty' sorted, from the canonical view.
create function pg_temp.buckets(p_ing text) returns text language sql as $$
  select coalesce(string_agg(left(x.name, 1) || '/' || coalesce(l.lot_code, 'null') || '=' || trim_scale(v.qty_on_hand)::text, ' '
                             order by x.name collate "C", coalesce(l.lot_code, 'null') collate "C"), '-')
    from public.v_stock_on_hand v
    join public.location x on x.id = v.location_id
    left join public.raw_lot l on l.id = v.raw_lot_id
   where v.ingredient_id = pg_temp.id(p_ing) and v.qty_on_hand <> 0 $$;
create function pg_temp.rowcount(p_ing text) returns int language sql as $$
  select count(*)::int from public.stock_movement where ingredient_id = pg_temp.id(p_ing) $$;

-- Waste: shape, validation, cost ---------------------------------------------------------------------------------
select pg_temp.std('w1');
select pg_temp.buy('w1', 10, '2026-10-01');
select pg_temp.buy('w1', 10, '2026-10-02');
select pg_temp.buy('w1', 10, '2026-10-03');
select pg_temp.as_chef();
select pg_temp.waste('w1a', 'w1', 1.5, 'spoilage', 'cella');
select is((select string_agg(jk.key, ',' order by jk.key collate "C") from res, jsonb_object_keys(r) jk (key) where res.k = 'w1a'),
  'movements,negative,onHandQty,operationId', 'post_waste returns exactly operationId, movements, onHandQty, negative');
select is((select string_agg(jk.key, ',' order by jk.key collate "C") from res, jsonb_array_elements(r -> 'movements') e,
            jsonb_object_keys(e) jk (key) where res.k = 'w1a'), 'id,locationId,qty,rawLotId', 'each movement has exactly id, rawLotId, locationId, qty');
select ok((select r::text !~* '(eur|cost|price|value|amount)' from res where k = 'w1a'), 'and no key or value looks like money');
select is(pg_temp.rows_of(pg_temp.op('w1a')), 'L-D2@C -1.5', 'waste of 1,5 kg takes the first-expiring lot');
select is((select m.type::text || ' ' || m.ref_type || ' ' || m.reason_code || ' ' || m.created_by::text
             from public.stock_movement m where m.ref_id = pg_temp.op('w1a')),
  'waste manual spoilage c1000000-0000-4000-8000-00000000000c', 'type waste, ref_type manual, the reason, created_by the chef');
select is((select count(distinct m.ref_id)::int from public.stock_movement m where m.ref_type = 'manual' and m.ingredient_id = pg_temp.id('w1')),
  1, 'the rows of one call share one ref_id');
select is((select -sum(m.qty * m.unit_cost) from public.stock_movement m where m.ref_id = pg_temp.op('w1a')), 15.0000::numeric,
  'AT3: the waste of 1,5 kg at basis 10 is worth 15.0000 (owner view of the cost)');
select is((select m.unit_cost::text from public.stock_movement m where m.ref_id = pg_temp.op('w1a')), '10.0000', 'unit_cost 10.0000 on the row');
select is((select (r ->> 'onHandQty')::numeric || ' ' || (r ->> 'negative') from res where k = 'w1a'), '4.5000 false',
  'onHandQty is the location total, negative false');
select is(pg_temp.err($$ select pg_temp.waste('x', 'w1', 1, 'foo') $$), 'P0001 reason_invalid', 'reason foo: reason_invalid');
select is(pg_temp.rowcount('w1'), 4, 'and nothing was written by the refused call (3 receipts + the waste)');
select is(pg_temp.err($$ select pg_temp.waste('x', 'w1', 1, 'spoilage', 'cella', null, 'conf') $$), 'P0001 unit_mismatch', 'unit conf: unit_mismatch');
select is(pg_temp.err($$ select pg_temp.waste('x', 'w1', 1, 'spoilage', 'dispensa') $$), 'P0001 location_not_found', 'an inactive location: location_not_found');
select is(pg_temp.err($$ select pg_temp.waste('x', 'w1', 1) $$), 'P0001 location_required', 'two active locations and none given: location_required');

-- consume_raw_fefo and AT1 through the procedures -------------------------------------------------------------------------------
select pg_temp.std('w2');
select pg_temp.consume('w2a', 'w2', 5, 'cella');
select is(pg_temp.rows_of(pg_temp.op('w2a')), 'L-D2@C -2, L-D5@C -2, L-NONE@C -1', 'AT1: consume 5 takes L-D2, L-D5, L-NONE');
select is((select string_agg(distinct m.type::text || ' ' || m.ref_type || ' ' || coalesce(m.reason_code, '-'), ',') from public.stock_movement m
            where m.ref_id = pg_temp.op('w2a')), 'consumption manual -', 'type consumption, ref_type manual, no reason');
select pg_temp.std('w3');
select pg_temp.waste('w3a', 'w3', 3, 'spoilage', 'cella', 'w3_none');
select is(pg_temp.rows_of(pg_temp.op('w3a')), 'L-D2@C -1, L-NONE@C -2', 'a waste with an override lot takes that lot first');

-- Location default ---------------------------------------------------------------------------------------------------
select pg_temp.mk_ing('loc2');
select pg_temp.mk_lot('loc2_l', 'L-LC', 'loc2', 'cella', null, '2026-10-20', 2);
update public.location set is_active = false where id = pg_temp.id('freezer');
select pg_temp.waste('loc2a', 'loc2', 1);
select is(pg_temp.rows_of(pg_temp.op('loc2a')), 'L-LC@C -1', 'with exactly one active location it is used');
update public.location set is_active = true where id = pg_temp.id('freezer');

-- AT6: a waste beyond stock ---------------------------------------------------------------------------------------------------
select pg_temp.mk_ing('ng1');
select pg_temp.mk_lot('ng1_l', 'L-NG', 'ng1', 'cella', '2026-10-25', '2026-10-20', 2);
select pg_temp.waste('ng1a', 'ng1', 3, 'spoilage', 'cella');
select is((select (r ->> 'onHandQty')::numeric || ' ' || (r ->> 'negative') from res where k = 'ng1a'), '-1.0000 true',
  'AT6: a waste of 3 kg on 2 kg answers onHandQty -1 and negative true');
select is(pg_temp.rows_of(pg_temp.op('ng1a')), 'L-NG@C -2, null@C -1', 'the lot and one unlotted shortfall row');
select is(pg_temp.alerts('ng1'), 1, 'and one negative_stock alert');

-- AT4: transfers ---------------------------------------------------------------------------------------------------------------------
select pg_temp.mk_ing('tr1');
select pg_temp.mk_lot('tr1_l', 'L-T', 'tr1', 'cella', '2026-10-25', '2026-10-20', 2);
select pg_temp.transfer('tr1a', 'tr1', 1.5, 'cella', 'freezer');
select is(pg_temp.rows_of(pg_temp.op('tr1a')), 'L-T@C -1.5, L-T@F 1.5', 'AT4: two legs on the same lot');
select is((select count(distinct m.ref_id)::int || ' ' || count(m.unit_cost) || ' ' || min(m.ref_type) from public.stock_movement m
            where m.ref_id = pg_temp.op('tr1a')), '1 0 transfer', 'one ref_id, ref_type transfer, no unit_cost');
select is(pg_temp.buckets('tr1'), 'C/L-T=0.5 F/L-T=1.5', 'Cella 0,5 and Freezer 1,5');
select is((select sum(v.qty_on_hand) from public.v_stock_on_hand v where v.ingredient_id = pg_temp.id('tr1')), 2.0000::numeric,
  'the ingredient total is unchanged');
select is((select (r ->> 'fromOnHandQty')::numeric || ' ' || (r ->> 'toOnHandQty')::numeric from res where k = 'tr1a'), '0.5000 1.5000',
  'the answer carries the two location totals');
select is((select string_agg(jk.key, ',' order by jk.key collate "C") from res, jsonb_object_keys(r) jk (key) where res.k = 'tr1a'),
  'fromOnHandQty,movements,operationId,toOnHandQty', 'the answer has exactly the planned keys');
select pg_temp.std('tr2');
select pg_temp.transfer('tr2a', 'tr2', 5, 'cella', 'freezer');
select is(pg_temp.rows_of(pg_temp.op('tr2a')),
  'L-D2@C -2, L-D2@F 2, L-D5@C -2, L-D5@F 2, L-NONE@C -1, L-NONE@F 1', 'a transfer of 5 kg without a lot follows FEFO over the lots');
select pg_temp.std('tr3');
select pg_temp.transfer('tr3a', 'tr3', 1, 'cella', 'freezer', 'tr3_none');
select is(pg_temp.rows_of(pg_temp.op('tr3a')), 'L-NONE@C -1, L-NONE@F 1', 'an override lot is moved first');
select pg_temp.mk_ing('tr4');
select pg_temp.mk_lot('tr4_l', 'L-T4', 'tr4', 'cella', null, '2026-10-20', 2);
select is(pg_temp.err($$ select pg_temp.transfer('x', 'tr4', 3, 'cella', 'freezer') $$), 'P0001 insufficient_stock', 'moving more than is recorded: insufficient_stock');
select is(pg_temp.rowcount('tr4'), 1, 'and nothing was written');
select is(pg_temp.err($$ select pg_temp.transfer('x', 'tr4', 1, 'cella', 'cella') $$), 'P0001 same_location', 'the same location: same_location');
select is(pg_temp.err($$ select pg_temp.transfer('x', 'tr4', 1, 'cella', 'dispensa') $$), 'P0001 location_not_found', 'an inactive destination: location_not_found');
select is(pg_temp.err($$ select pg_temp.transfer('x', 'tr4', 1, 'cella', 'cellab') $$), 'P0001 location_not_found', 'tenant B''s location: location_not_found');

-- AT5: reversals --------------------------------------------------------------------------------------------------------------------------
select pg_temp.mk_ing('rv1');
select pg_temp.mk_lot('rv1_l', 'L-R1', 'rv1', 'cella', '2026-10-25', '2026-10-20', 2);
select pg_temp.buy('rv1', 10, '2026-10-03');
create temporary table before_state as select pg_temp.buckets('rv1') as b;
select pg_temp.waste('rv1a', 'rv1', 3, 'spoilage', 'cella');
create temporary table orig_rows as
  select m.id, to_jsonb(m) as j from public.stock_movement m where m.ref_id = pg_temp.op('rv1a');
select pg_temp.reverse('rv1r', (select m.id from public.stock_movement m where m.ref_id = pg_temp.op('rv1a') and m.raw_lot_id is null));
select is(pg_temp.rows_of(pg_temp.op('rv1r')), 'L-R1@C 2, null@C 1', 'AT5: reversing through the shortfall row mirrors both rows');
select is((select count(*)::int from public.stock_movement m join public.stock_movement o on o.id = m.reverses_id
            where m.ref_id = pg_temp.op('rv1r') and m.type = o.type and m.qty = -o.qty and m.raw_lot_id is not distinct from o.raw_lot_id
              and m.location_id = o.location_id and m.reason_code = o.reason_code and m.unit_cost is not distinct from o.unit_cost
              and m.ref_type = 'reversal'), 2, 'each reversal row has the opposite qty and the same lot, location, reason and unit_cost');
select is(pg_temp.buckets('rv1'), (select b from before_state), 'every bucket equals its value before the waste');
select is((select count(*)::int from orig_rows o join public.stock_movement m on m.id = o.id where to_jsonb(m) = o.j), 2, 'the original rows are untouched');
select is((select r ->> 'reversedOperationId' from res where k = 'rv1r'), pg_temp.op('rv1a')::text, 'the answer names the reversed operation');
select is((select string_agg(distinct m.effective_on::text, ',') from public.stock_movement m where m.ref_id = pg_temp.op('rv1r')),
  app.venue_date(now(), 'Europe/Rome')::text, 'the reversal is dated today (Rome)');
select is(pg_temp.err($$ select pg_temp.reverse('x', (select m.id from public.stock_movement m where m.ref_id = pg_temp.op('rv1a') and m.raw_lot_id is not null)) $$),
  'P0001 already_reversed', 'again, through the other row of the operation: already_reversed');
select is(pg_temp.err($$ select pg_temp.reverse('x', (select m.id from public.stock_movement m where m.ref_id = pg_temp.op('rv1r') limit 1)) $$),
  'P0001 movement_is_reversal', 'reversing the reversal: movement_is_reversal');
select is(pg_temp.err($$ select pg_temp.reverse('x', (select m.id from public.stock_movement m where m.ref_type = 'invoice_line' and m.ingredient_id = pg_temp.id('rv1'))) $$),
  'P0001 movement_not_reversible', 'a receipt: movement_not_reversible');
select pg_temp.mk_ing('rv2');
select pg_temp.mk_lot('rv2_l', 'L-R2', 'rv2', 'cella', null, '2026-10-20', 2);
insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, ref_type, ref_id, effective_on, created_by)
  values ('0e000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', pg_temp.id('rv2'), pg_temp.id('rv2_l'),
    pg_temp.id('cella'), 'consumption', -1, 'batch', gen_random_uuid(), '2026-10-23', 'a1000000-0000-4000-8000-00000000000a');
select is(pg_temp.err($$ select pg_temp.reverse('x', '0e000000-0000-4000-8000-0000000000b1') $$), 'P0001 movement_not_reversible',
  'a consumption of a batch (ref_type batch): movement_not_reversible');
select is(pg_temp.err($$ select pg_temp.reverse('x', gen_random_uuid()) $$), 'P0002 movement_not_found', 'an unknown movement: P0002');
-- A transfer is reversed leg by leg.
select pg_temp.reverse('tr1r', (select m.id from public.stock_movement m where m.ref_id = pg_temp.op('tr1a') and m.qty > 0));
select is(pg_temp.rows_of(pg_temp.op('tr1r')), 'L-T@C 1.5, L-T@F -1.5', 'a transfer reversal mirrors both legs');
select is(pg_temp.buckets('tr1'), 'C/L-T=2', 'and the buckets are back to the original');
select pg_temp.mk_ing('tu1');
select pg_temp.mk_lot('tu1_l', 'L-TU', 'tu1', 'cella', null, '2026-10-20', 2);
select pg_temp.transfer('tu1a', 'tu1', 2, 'cella', 'freezer');
select pg_temp.waste('tu1w', 'tu1', 1.5, 'spoilage', 'freezer');
select is(pg_temp.err($$ select pg_temp.reverse('x', (select m.id from public.stock_movement m where m.ref_id = pg_temp.op('tu1a') limit 1)) $$),
  'P0001 transfer_already_used', 'a transfer whose destination was then used: transfer_already_used');
select is(pg_temp.rowcount('tu1'), 4, 'and nothing was written (receipt, 2 legs, the waste)');
-- The reversal of a consume.
select pg_temp.reverse('w2r', (select m.id from public.stock_movement m where m.ref_id = pg_temp.op('w2a') limit 1));
select is(pg_temp.buckets('w2'), 'C/L-D2=2 C/L-D5=2 C/L-NONE=2', 'a consumption of three lots is reversed whole');

-- Admin and owner (Q1) ----------------------------------------------------------------------------------------------------------------------
select pg_temp.mk_ing('ad1');
select pg_temp.mk_lot('ad1_l', 'L-AD', 'ad1', 'cella', null, '2026-10-20', 5);
select pg_temp.as_admin();
select pg_temp.waste('ad1a', 'ad1', 1, 'breakage', 'cella');
select pg_temp.reverse('ad1r', (select m.id from public.stock_movement m where m.ref_id = pg_temp.op('ad1a')));
select is(pg_temp.buckets('ad1'), 'C/L-AD=5', 'admin A posts a waste and reverses it');
select pg_temp.as_owner();
select pg_temp.waste('ad1b', 'ad1', 1, 'comp', 'cella');
select pg_temp.reverse('ad1s', (select m.id from public.stock_movement m where m.ref_id = pg_temp.op('ad1b')));
select is(pg_temp.buckets('ad1'), 'C/L-AD=5', 'owner A posts a waste and reverses it');
select pg_temp.as_chef();

-- Single transactions -----------------------------------------------------------------------------------------------------------------------
create function public.test_fail_second_reversal() returns trigger language plpgsql as $$
begin
  if new.ref_type = 'reversal' and exists (select 1 from public.stock_movement m where m.ref_id = new.ref_id) then
    raise exception 'test_boom' using errcode = 'P0001';
  end if;
  return new;
end $$;
create function public.test_fail_plus_leg() returns trigger language plpgsql as $$
begin
  if new.ref_type = 'transfer' and new.qty > 0 then
    raise exception 'test_boom' using errcode = 'P0001';
  end if;
  return new;
end $$;
select pg_temp.mk_ing('sx1');
select pg_temp.mk_lot('sx1_a', 'L-SA', 'sx1', 'cella', '2026-10-25', '2026-10-20', 1);
select pg_temp.mk_lot('sx1_b', 'L-SB', 'sx1', 'cella', '2026-10-30', '2026-10-20', 1);
select pg_temp.waste('sx1a', 'sx1', 2, 'spoilage', 'cella');
create trigger test_fail_second_reversal before insert on public.stock_movement
  for each row execute function public.test_fail_second_reversal();
select is(pg_temp.err($$ select pg_temp.reverse('x', (select m.id from public.stock_movement m where m.ref_id = pg_temp.op('sx1a') limit 1)) $$),
  'P0001 test_boom', 'a failure on the second reversal row fails the call');
select is((select count(*)::int from public.stock_movement m where m.ingredient_id = pg_temp.id('sx1') and m.ref_type = 'reversal'), 0,
  'and no reversal row exists (single transaction)');
drop trigger test_fail_second_reversal on public.stock_movement;
create trigger test_fail_plus_leg before insert on public.stock_movement for each row execute function public.test_fail_plus_leg();
select pg_temp.mk_ing('sx2');
select pg_temp.mk_lot('sx2_a', 'L-S2', 'sx2', 'cella', null, '2026-10-20', 2);
select is(pg_temp.err($$ select pg_temp.transfer('x', 'sx2', 1, 'cella', 'freezer') $$), 'P0001 test_boom', 'a failure on the + leg fails the transfer');
select is(pg_temp.rowcount('sx2'), 1, 'and the - leg is absent (single transaction)');
drop trigger test_fail_plus_leg on public.stock_movement;

-- Tenancy ---------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.as_ownerb();
select is(pg_temp.err($$ select pg_temp.waste('x', 'w1', 1, 'spoilage', 'cellab') $$), 'P0002 ingredient_not_found',
  'tenant B posting a waste on tenant A''s ingredient: P0002');
select is(pg_temp.err($$ select pg_temp.reverse('x', (select m.id from public.stock_movement m where m.ref_id = pg_temp.op('w1a') limit 1)) $$),
  'P0002 movement_not_found', 'tenant B reversing tenant A''s movement: P0002');
select is(pg_temp.err($$ select pg_temp.transfer('x', 'w1', 1, 'cella', 'freezer') $$), 'P0002 ingredient_not_found',
  'tenant B transferring tenant A''s ingredient: P0002');
select pg_temp.as_chef();

-- Grants ----------------------------------------------------------------------------------------------------------------------------------------------
select is_empty($$ select f.proname, r.rolname
    from pg_proc f cross join (values ('anon'), ('service_role')) r (rolname)
   where f.pronamespace = 'public'::regnamespace
     and f.proname in ('consume_raw_fefo', 'post_waste', 'post_transfer', 'reverse_movement')
     and has_function_privilege(r.rolname, f.oid, 'execute') $$,
  'anon and service_role cannot execute the four procedures');
select ok((select bool_and(has_function_privilege('authenticated', f.oid, 'execute')
                           and not has_function_privilege('public', f.oid, 'execute') and f.prosecdef
                           and f.proconfig @> array['search_path=""'])
             from pg_proc f where f.pronamespace = 'public'::regnamespace
              and f.proname in ('consume_raw_fefo', 'post_waste', 'post_transfer', 'reverse_movement')),
  'authenticated only, security definer, empty search_path');
select is((select count(*)::int from pg_proc f where f.pronamespace = 'public'::regnamespace
            and f.proname in ('consume_raw_fefo', 'post_waste', 'post_transfer', 'reverse_movement')), 4, 'one definition of each');

-- One call as the API role: the grant, the definer rights and the claims work together ----------------------------------------------
select pg_temp.mk_ing('api1');
select pg_temp.mk_lot('api1_l', 'L-API', 'api1', 'cella', null, '2026-10-20', 2);
select pg_temp.as_chef();
grant select on reg to authenticated;
set local role authenticated;
select is((select public.post_waste((select id from reg where k = 'api1'), 500, 'g', 'staff_meal', '10000000-0000-4000-8000-0000000000a1'::uuid, null::uuid) ->> 'onHandQty')::numeric,
  1.5000::numeric, 'the chef posts 500 g as the API role: 1,5 kg left');
reset role;

select * from finish();
rollback;
