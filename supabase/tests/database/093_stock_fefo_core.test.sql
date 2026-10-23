-- M12 step 4: the stock core in schema app (M12 plan §3.1.4, §3.2; AT1, AT3, AT6 at engine level; ADR-011).
-- The engine app.post_stock_outflow is called as the migration owner with an explicit tenant, user and
-- instant. Fake data only (tenants "Osteria Demo A/B", ingredients suffixed "(demo)", invented lots).
-- "D" = 2026-10-23 (Rome), the date of the default instant 2026-10-23T10:00Z.
begin;
create extension if not exists pgtap with schema extensions;
select plan(56);

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

-- One call of the engine; the result is 'lotcode qty,lotcode qty' in insert order ('null' = no lot), or the
-- unit costs / effective dates of the rows. The rows are collected first and read back by a LATER statement:
-- rows written by a function are not visible to the statement that called it.
create temporary table lastout (ord bigint, movement_id uuid, raw_lot_id uuid, qty numeric);
create function pg_temp.out(p_ing text, p_qty numeric, p_lot text default null, p_loc text default 'cella',
    p_at timestamptz default '2026-10-23T10:00Z', p_type text default 'consumption',
    p_cost_at timestamptz default null, p_what text default 'lots') returns text language plpgsql as $$
declare
  v_out text;
begin
  truncate lastout;
  insert into lastout
    select r.ord, r.movement_id, r.raw_lot_id, r.qty
      from app.post_stock_outflow('11111111-1111-4111-8111-111111111111', 'c1000000-0000-4000-8000-00000000000c',
             pg_temp.id(p_ing), pg_temp.id(p_loc), p_qty, p_type::public.stock_movement_type,
             case when p_type = 'waste' then 'spoilage' end,
             case when p_lot is null then null else pg_temp.id(p_lot) end,
             'manual', gen_random_uuid(), p_at, p_cost_at, 'test_caller') with ordinality r (movement_id, raw_lot_id, qty, ord);
  select coalesce(string_agg(
           case p_what when 'lots' then coalesce(l.lot_code, 'null') || ' ' || trim_scale(o.qty)::text
                       when 'cost' then coalesce(m.unit_cost::text, 'null')
                       when 'date' then m.effective_on::text end,
           ',' order by o.ord), '-')
    into v_out
    from lastout o
    left join public.raw_lot l on l.id = o.raw_lot_id
    left join public.stock_movement m on m.id = o.movement_id;
  return v_out;
end
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

-- AT1: FEFO order -------------------------------------------------------------------------------------------
select pg_temp.std('a1');
select is(pg_temp.out('a1', 5), 'L-D2 -2,L-D5 -2,L-NONE -1', 'AT1: outflow 5 takes L-D2, then L-D5, then the lot without expiry');
select pg_temp.std('a2');
select is(pg_temp.out('a2', 1), 'L-D2 -1', 'a fresh fixture, outflow 1: L-D2 only');
select pg_temp.std('a3');
select is(pg_temp.out('a3', 1, 'a3_none'), 'L-NONE -1', 'override L-NONE, qty 1: L-NONE only');
select pg_temp.std('a4');
select is(pg_temp.out('a4', 3, 'a4_none'), 'L-NONE -2,L-D2 -1', 'override L-NONE, qty 3: L-NONE (2), then L-D2 (1)');
select pg_temp.std('a5');
select pg_temp.out('a5', 2, 'a5_d5');
select is(pg_temp.err($$ select pg_temp.out('a5', 1, 'a5_d5') $$), 'P0001 lot_empty', 'an override lot that is empty at Cella: lot_empty');
select is((select count(*)::int from public.stock_movement where ingredient_id = pg_temp.id('a5') and type::text = 'consumption'),
  1, 'and nothing was written by the refused call');
select pg_temp.std('a6');
select is(pg_temp.err($$ select pg_temp.out('a6', 1, 'a1_d2') $$), 'P0002 lot_not_found', 'a lot of another ingredient: lot_not_found');
select is(pg_temp.err($$ select pg_temp.out('a6', 1, 'lotb') $$), 'P0002 lot_not_found', 'a lot of tenant B: lot_not_found');
select is(pg_temp.err($$ select pg_temp.out('a6', 1, 'a6_d2', 'freezer') $$), 'P0001 lot_empty',
  'a lot that sits at Cella is empty at Freezer');

-- Ties: the earlier received_on first; lots at other locations are ignored; a positive unlotted bucket last ---
select pg_temp.mk_ing('t1');
select pg_temp.mk_lot('t1_t2', 'L-T2', 't1', 'cella', '2026-10-26', '2026-10-22', 1);
select pg_temp.mk_lot('t1_t1', 'L-T1', 't1', 'cella', '2026-10-26', '2026-10-20', 1);
select is(pg_temp.out('t1', 1), 'L-T1 -1', 'same expiry: the lot received earlier goes first');
select pg_temp.mk_ing('loc1');
select pg_temp.mk_lot('loc1_f', 'L-FZ', 'loc1', 'freezer', '2026-10-24', '2026-10-20', 2);
select pg_temp.mk_lot('loc1_c', 'L-CE', 'loc1', 'cella', '2026-10-30', '2026-10-20', 2);
select is(pg_temp.out('loc1', 1), 'L-CE -1', 'a lot with stock at Freezer only is ignored for an outflow at Cella');
select pg_temp.mk_ing('un1');
select pg_temp.mk_lot('un1_l', 'L-U1', 'un1', 'cella', '2026-10-25', '2026-10-20', 1);
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.id('un1'), null, pg_temp.id('cella'), 'count', 1, 'count_session',
    gen_random_uuid(), '2026-10-22', 'a1000000-0000-4000-8000-00000000000a');
select is(pg_temp.out('un1', 2), 'L-U1 -1,null -1', 'a positive unlotted bucket is taken after the lots');

-- Shortfall --------------------------------------------------------------------------------------------------
select pg_temp.mk_ing('s1');
select pg_temp.mk_lot('s1_l', 'L-S1', 's1', 'cella', '2026-10-25', '2026-10-20', 2);
select is(pg_temp.out('s1', 3), 'L-S1 -2,null -1', 'shortfall: 2 kg left, outflow 3: the lot, then one unlotted row');
select is((select count(*)::int from public.v_stock_on_hand where ingredient_id = pg_temp.id('s1') and raw_lot_id is not null and qty_on_hand < 0),
  0, 'after a shortfall no lot bucket is below zero');
select is(pg_temp.on_hand('s1'), -1.0000::numeric, 'the location total is -1');

-- AT3: the cost on the row ------------------------------------------------------------------------------------
select pg_temp.std('c1');
select pg_temp.buy('c1', 10, '2026-10-01');
select pg_temp.buy('c1', 10, '2026-10-02');
select pg_temp.buy('c1', 10, '2026-10-03');
select is(pg_temp.out('c1', 3, p_what => 'cost'), '10.0000,10.0000', 'AT3: three purchases at 10: every row carries unit_cost 10.0000');
select pg_temp.buy('c1', 11, '2026-10-04');
select is(pg_temp.out('c1', 1, p_what => 'cost'), '10.3333', 'a fourth purchase at 11: the moving average of the last three, 10.3333');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select public.set_ingredient_cost_basis(pg_temp.id('c1'), 'last_price');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.out('c1', 1, p_what => 'cost'), '11.0000', 'with the last_price basis the next outflow carries 11.0000');
select is((select string_agg(distinct m.unit_cost::text, ',' order by m.unit_cost::text) from public.stock_movement m
            where m.ingredient_id = pg_temp.id('c1') and m.type::text = 'consumption'), '10.0000,10.3333,11.0000',
  'earlier rows keep the cost they were written with');
select pg_temp.mk_ing('nocost');
select pg_temp.mk_lot('nocost_l', 'L-NC', 'nocost', 'cella', null, '2026-10-20', 2);
select is(pg_temp.out('nocost', 1, p_what => 'cost'), 'null', 'an ingredient with no purchase: unit_cost null, never 0');

-- Units ----------------------------------------------------------------------------------------------------------
select pg_temp.mk_ing('u_kg');
select pg_temp.mk_ing('u_l', 'l');
select pg_temp.mk_ing('u_pz', 'pz');
select pg_temp.mk_ing('u_nostock', 'kg', false);
select is(app.stock_qty_base('11111111-1111-4111-8111-111111111111', pg_temp.id('u_kg'), 500, 'g'), 0.5000::numeric, '500 g on a kg ingredient is 0.5 kg');
select is(app.stock_qty_base('11111111-1111-4111-8111-111111111111', pg_temp.id('u_l'), 250, 'ml'), 0.2500::numeric, '250 ml on a litre ingredient is 0.25 l');
select is(app.stock_qty_base('11111111-1111-4111-8111-111111111111', pg_temp.id('u_pz'), 3, 'pz'), 3.0000::numeric, '3 pz on a piece ingredient');
select is(pg_temp.err($$ select app.stock_qty_base('11111111-1111-4111-8111-111111111111', pg_temp.id('u_kg'), 1, 'conf') $$),
  'P0001 unit_mismatch', 'conf without a pack: unit_mismatch');
select is(pg_temp.err($$ select app.stock_qty_base('11111111-1111-4111-8111-111111111111', pg_temp.id('u_kg'), 1, 'ml') $$),
  'P0001 unit_mismatch', 'ml on a kg ingredient: unit_mismatch');
select is(pg_temp.err($$ select app.stock_qty_base('11111111-1111-4111-8111-111111111111', pg_temp.id('u_kg'), 0, 'kg') $$),
  'P0001 qty_invalid', 'zero: qty_invalid');
select is(pg_temp.err($$ select app.stock_qty_base('11111111-1111-4111-8111-111111111111', pg_temp.id('u_kg'), 100001, 'kg') $$),
  'P0001 qty_invalid', '100001: qty_invalid');
select is(pg_temp.err($$ select app.stock_qty_base('11111111-1111-4111-8111-111111111111', pg_temp.id('u_kg'), 0.00004, 'kg') $$),
  'P0001 qty_invalid', 'a quantity that rounds to 0: qty_invalid');
select is(pg_temp.err($$ select app.stock_qty_base('11111111-1111-4111-8111-111111111111', pg_temp.id('u_nostock'), 1, 'kg') $$),
  'P0001 ingredient_not_stock', 'is_stock false: ingredient_not_stock');
select is(pg_temp.err($$ select app.stock_qty_base('11111111-1111-4111-8111-111111111111', gen_random_uuid(), 1, 'kg') $$),
  'P0002 ingredient_not_found', 'an unknown ingredient: ingredient_not_found');
select is(pg_temp.err($$ select app.stock_qty_base('11111111-1111-4111-8111-111111111111', '1b000000-0000-4000-8000-00000000001b', 1, 'kg') $$),
  'P0002 ingredient_not_found', 'tenant B''s ingredient: ingredient_not_found');

-- effective_on across the DST change of 2026-10-25 -----------------------------------------------------------------
select pg_temp.mk_ing('dst');
select pg_temp.mk_lot('dst_l', 'L-DST', 'dst', 'cella', null, '2026-10-20', 5);
select is(pg_temp.out('dst', 1, p_at => '2026-10-25T22:30Z', p_what => 'date'), '2026-10-25', '22:30Z on 25 Oct is still 25 Oct in Rome');
select is(pg_temp.out('dst', 1, p_at => '2026-10-25T23:30Z', p_what => 'date'), '2026-10-26', '23:30Z on 25 Oct is already 26 Oct in Rome');

-- AT6: negative stock and its alert ----------------------------------------------------------------------------------
select pg_temp.mk_ing('n1');
select pg_temp.mk_lot('n1_l', 'L-N1', 'n1', 'cella', '2026-10-25', '2026-10-20', 2);
select is(pg_temp.out('n1', 1), 'L-N1 -1', 'an outflow that leaves stock >= 0');
select is(pg_temp.alerts('n1'), 0, 'raises no alert');
select pg_temp.out('n1', 2);
select is(pg_temp.on_hand('n1'), -1.0000::numeric, 'AT6: an outflow beyond stock leaves the location at -1');
select is(pg_temp.alerts('n1'), 1, 'and raises exactly one negative_stock alert');
select is((select a.entity_type || ' ' || a.business_date || ' ' || a.audience_roles::text || ' ' || a.severity::text || ' ' || a.cost_bearing::text
             from public.alert a where a.kind = 'negative_stock' and a.entity_id = pg_temp.id('n1')),
  'ingredient 2026-10-23 {owner,chef} warning false', 'entity, Rome business date, audience, severity, not cost-bearing');
select is((select string_agg(k, ',' order by k collate "C") from public.alert a, jsonb_object_keys(a.payload) k
            where a.kind = 'negative_stock' and a.entity_id = pg_temp.id('n1')),
  'ingredient_id,location_id,movement_id,on_hand_qty,unit', 'the payload keys are exactly the five quantity-only keys');
select is((select (a.payload ->> 'on_hand_qty')::numeric || ' ' || (a.payload ->> 'unit') || ' ' || (a.payload ->> 'location_id')
             from public.alert a where a.kind = 'negative_stock' and a.entity_id = pg_temp.id('n1')),
  '-1.0000 kg 10000000-0000-4000-8000-0000000000a1', 'on_hand_qty -1, unit kg, the location');
select is((select (a.payload ->> 'movement_id')::uuid from public.alert a where a.kind = 'negative_stock' and a.entity_id = pg_temp.id('n1')),
  (select m.id from public.stock_movement m where m.ingredient_id = pg_temp.id('n1') and m.raw_lot_id is null), 'movement_id is the shortfall row');
select pg_temp.out('n1', 1);
select is(pg_temp.alerts('n1'), 1, 'a second shortfall the same day: still one alert');
select pg_temp.out('n1', 1, p_at => '2026-10-24T10:00Z');
select is(pg_temp.alerts('n1'), 2, 'the next day: a second alert');
-- A location already negative through its unlotted bucket stays negative while a lot still has stock.
select pg_temp.mk_ing('n2');
select pg_temp.mk_lot('n2_a', 'L-N2A', 'n2', 'cella', '2026-10-25', '2026-10-20', 1);
select pg_temp.out('n2', 4);
select pg_temp.mk_lot('n2_b', 'L-N2B', 'n2', 'cella', '2026-10-30', '2026-10-21', 2);
select is(pg_temp.on_hand('n2'), -1.0000::numeric, 'setup: lot +2, unlotted -3, location -1');
select pg_temp.out('n2', 0.5, p_at => '2026-10-26T10:00Z');
select is((select count(*)::int from public.alert a where a.kind = 'negative_stock' and a.entity_id = pg_temp.id('n2')), 2,
  'an outflow served by a lot at a location that is already negative is alerted');

-- Containment: a refusal or a bug in the check never undoes the movement -----------------------------------------------
select pg_temp.mk_ing('k1');
select pg_temp.mk_lot('k1_l', 'L-K1', 'k1', 'cella', null, '2026-10-20', 1);
alter table public.alert drop constraint alert_kind_fkey;
delete from app.alert_kind where kind = 'negative_stock';
select is(pg_temp.out('k1', 3), 'L-K1 -1,null -2', 'containment: with the kind missing the movement rows are still written');
select is(pg_temp.alerts('k1'), 0, 'no alert exists');
select is((select r.code || ' ' || r.caller from app.alert_refusal r where r.kind = 'negative_stock'
             and r.entity_id = pg_temp.id('k1') order by r.id desc limit 1), 'unknown_alert_kind test_caller',
  'one refusal: unknown_alert_kind with the caller as passed');
insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience) values ('negative_stock', false, 'warning', '{owner,chef}');
create or replace function app.raise_negative_stock(p_tenant uuid, p_ingredient uuid, p_location uuid, p_movement uuid,
    p_at timestamptz, p_caller text) returns uuid language plpgsql as $$
begin
  raise exception 'boom' using errcode = '22012';
end
$$;
select is(pg_temp.out('k1', 1), 'null -1', 'a check that raises 22012: the movement is still written');
select is((select r.code || ' ' || r.sqlstate from app.alert_refusal r where r.entity_id = pg_temp.id('k1') order by r.id desc limit 1),
  'check_failed 22012', 'and one refusal check_failed 22012 is recorded');

-- Structure ---------------------------------------------------------------------------------------------------------------
select ok(position('app.lock_ingredient_stock(' in p.prosrc) > 0
    and position('app.lock_ingredient_stock(' in p.prosrc) < position('app.fefo_buckets(' in p.prosrc),
  'post_stock_outflow takes the stock lock before it reads the buckets')
  from pg_proc p where p.proname = 'post_stock_outflow' and p.pronamespace = 'app'::regnamespace;
select is(app.expiry_state(null, '2026-10-23'), 'none', 'expiry_state: no expiry');
select is(app.expiry_state('2026-10-22', '2026-10-23'), 'expired', 'expiry_state: yesterday is expired');
select is(app.expiry_state('2026-10-23', '2026-10-23') || ' ' || app.expiry_state('2026-10-24', '2026-10-23'), 'due_soon due_soon',
  'expiry_state: today and tomorrow are due soon');
select is(app.expiry_state('2026-10-25', '2026-10-23'), 'ok', 'expiry_state: in two days is ok');
select is_empty($$ select f.proname, r.rolname
    from pg_proc f cross join (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
   where f.pronamespace = 'app'::regnamespace
     and f.proname in ('require_stock_reader', 'require_stock_writer', 'lock_ingredient_stock', 'stock_qty_base', 'expiry_state',
                       'fefo_buckets', 'location_on_hand', 'raise_negative_stock', 'post_stock_outflow')
     and has_function_privilege(r.rolname, f.oid, 'execute') $$,
  'no API role can execute any of the stock core functions');

select * from finish();
rollback;
