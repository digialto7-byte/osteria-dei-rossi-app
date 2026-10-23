-- M12 step 7 (AT7, V6): the role catalogue of the stock functions. The waiter has no access at all; the chef calls
-- the four write procedures and reads quantities through the three read functions, but cannot insert, update or
-- delete a movement or a lot, reads no stock_movement or v_stock_on_hand row and no EUR; admin and owner are allowed
-- everything (Q1 = owner+chef+admin write) but still cannot write the tables directly. Nobody without claims gets in.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

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

grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text) to authenticated, anon;
create function pg_temp.as_waiter() returns void language sql as $$
  select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter') $$;
create function pg_temp.as_none() returns void language sql as $$ select set_config('request.jwt.claims', '', true) $$;
insert into auth.users (id, email) values ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');
create function pg_temp.all_keys(p_json jsonb) returns text[] language sql as $$
  with recursive walk (node) as (
    select p_json
    union all
    select c.value from walk w cross join lateral (
      select o.value from jsonb_each(case when jsonb_typeof(w.node) = 'object' then w.node else '{}'::jsonb end) o
      union all
      select a.value from jsonb_array_elements(case when jsonb_typeof(w.node) = 'array' then w.node else '[]'::jsonb end) a) c)
  select coalesce(array_agg(distinct k.key), '{}') from walk w
    cross join lateral jsonb_object_keys(case when jsonb_typeof(w.node) = 'object' then w.node else '{}'::jsonb end) k (key) $$;

select pg_temp.std('r1');
select pg_temp.buy('r1', 10, '2026-10-01');
-- One waste per role to reverse, written through the owner's procedure (the only way to write).
create temporary table targets (role text primary key, movement uuid);
select pg_temp.as_owner();
select pg_temp.waste('t_chef', 'r1', 0.1, 'comp', 'cella');
select pg_temp.waste('t_admin', 'r1', 0.1, 'comp', 'cella');
select pg_temp.waste('t_owner', 'r1', 0.1, 'comp', 'cella');
select pg_temp.waste('t_waiter', 'r1', 0.1, 'comp', 'cella');
insert into targets
  select r, (select m.id from public.stock_movement m where m.ref_id = pg_temp.op('t_' || r) limit 1)
    from unnest(array['chef', 'admin', 'owner', 'waiter']) r;
grant select on targets to authenticated;

-- The eight functions, called with plausible arguments; the outcome of each is 'ok' or its SQLSTATE.
create function pg_temp.outcomes(p_role text) returns text language plpgsql as $$
declare
  v_ing text := quote_literal((select id from reg where k = 'r1'));
  v_cella text := quote_literal((select id from reg where k = 'cella'));
  v_freezer text := quote_literal((select id from reg where k = 'freezer'));
  v_target text := quote_literal((select movement from targets where role = p_role));
  v_sql text[];
  v_out text := '';
  e text;
  s text;
begin
  v_sql := array[
    format('select public.consume_raw_fefo(%s, 0.1, ''kg'', %s, null)', v_ing, v_cella),
    format('select public.post_waste(%s, 0.1, ''kg'', ''comp'', %s, null)', v_ing, v_cella),
    format('select public.post_transfer(%s, 0.1, ''kg'', %s, %s, null)', v_ing, v_cella, v_freezer),
    format('select public.reverse_movement(%s)', v_target),
    'select * from public.stock_on_hand()',
    format('select * from public.stock_lots(%s, false)', v_ing),
    format('select public.stock_movements(%s, null, null, 10)', v_ing),
    'select public.raw_waste_costs(current_date, current_date)'];
  foreach s in array v_sql loop
    e := pg_temp.err(s);
    v_out := v_out || case when e = 'ok' then 'ok' else left(e, 5) end || ' ';
  end loop;
  return rtrim(v_out);
end
$$;
grant execute on function pg_temp.outcomes(text) to authenticated, anon;
-- A direct write of each kind, by the role in force: the outcome of INSERT / UPDATE / DELETE on the two tables.
create function pg_temp.direct_writes() returns text language plpgsql as $$
declare
  v_out text := '';
  e text;
  s text;
begin
  foreach s in array array[
    $q$ insert into public.stock_movement (tenant_id, ingredient_id, location_id, type, qty, ref_type, ref_id, effective_on, created_by)
        values ('11111111-1111-4111-8111-111111111111', (select id from reg where k = 'r1'), (select id from reg where k = 'cella'),
                'consumption', -1, 'manual', gen_random_uuid(), '2026-10-23', 'a1000000-0000-4000-8000-00000000000a') $q$,
    $q$ update public.stock_movement set qty = -9 $q$,
    $q$ delete from public.stock_movement $q$,
    $q$ insert into public.raw_lot (tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, received_on, qty_received,
          base_unit, source_qty, source_unit, base_factor, created_by)
        values ('11111111-1111-4111-8111-111111111111', (select id from reg where k = 'r1'), (select id from reg where k = 'cella'),
                '5a000000-0000-4000-8000-00000000005a', gen_random_uuid(), '2026-10-23', 1, 'kg', 1, 'kg', 1,
                'a1000000-0000-4000-8000-00000000000a') $q$,
    $q$ update public.raw_lot set qty_received = 9 $q$,
    $q$ delete from public.raw_lot $q$] loop
    e := pg_temp.err(s);
    v_out := v_out || case when e = 'ok' then 'ok' else left(e, 5) end || ' ';
  end loop;
  return rtrim(v_out);
end
$$;
grant execute on function pg_temp.direct_writes() to authenticated;
grant select on reg to authenticated;
create function pg_temp.seen(rel text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I', rel) into n;
  return n;
exception when insufficient_privilege then
  return -1;
end
$$;
grant execute on function pg_temp.seen(text) to authenticated;

-- The waiter: nothing -----------------------------------------------------------------------------------------------
select pg_temp.as_waiter();
set local role authenticated;
select is(pg_temp.outcomes('waiter'), '42501 42501 42501 42501 42501 42501 42501 42501', 'waiter: 42501 from all eight functions');
select is(pg_temp.seen('raw_lot') || ' ' || pg_temp.seen('stock_movement') || ' ' || pg_temp.seen('v_stock_on_hand'), '0 0 0',
  'waiter: 0 rows from raw_lot, stock_movement and v_stock_on_hand');
select is(pg_temp.direct_writes(), '42501 42501 42501 42501 42501 42501', 'waiter: direct INSERT, UPDATE and DELETE are refused');
reset role;

-- The chef: quantities, never EUR ----------------------------------------------------------------------------------------
select pg_temp.as_chef();
set local role authenticated;
select is(pg_temp.outcomes('chef'), 'ok ok ok ok ok ok ok 42501', 'chef: the four writes and the three reads work; raw_waste_costs is 42501');
select is(pg_temp.direct_writes(), '42501 42501 42501 42501 42501 42501', 'chef: direct INSERT, UPDATE and DELETE are refused');
select is(pg_temp.seen('stock_movement') || ' ' || pg_temp.seen('v_stock_on_hand'), '0 0', 'chef: 0 rows from stock_movement and v_stock_on_hand');
select cmp_ok(pg_temp.seen('raw_lot'), '>', 0::bigint, 'chef: reads raw_lot (no cost column)');
reset role;
select is_empty($$ select a.attname from pg_attribute a where a.attrelid = 'public.raw_lot'::regclass and a.attnum > 0 and not a.attisdropped
    and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')
    and a.attname ~* '(cost|margin|price|prezz|gp_pct|_eur$|amount|total|importo)' $$, 'no readable raw_lot column has a cost-like name');
select is((select array_agg(c.relname::text order by c.relname::text collate "C") from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') and c.relname ~ '(stock|lot)'),
  array['raw_lot', 'stock_movement', 'v_stock_on_hand'], 'M12 added no relation: the stock relations are the three of M5');
-- What the chef is handed carries no cost key and no euro sign.
select pg_temp.as_chef();
create temporary table chef_answers (k text, r jsonb);
insert into chef_answers select 'waste', public.post_waste((select id from reg where k = 'r1'), 0.2, 'kg', 'spoilage', (select id from reg where k = 'cella'));
insert into chef_answers select 'transfer', public.post_transfer((select id from reg where k = 'r1'), 0.2, 'kg', (select id from reg where k = 'cella'), (select id from reg where k = 'freezer'));
insert into chef_answers select 'consume', public.consume_raw_fefo((select id from reg where k = 'r1'), 0.2, 'kg', (select id from reg where k = 'cella'));
insert into chef_answers select 'hand', coalesce(jsonb_agg(to_jsonb(h)), '[]') from public.stock_on_hand() h;
insert into chef_answers select 'lots', coalesce(jsonb_agg(to_jsonb(l)), '[]') from public.stock_lots((select id from reg where k = 'r1'), true) l;
insert into chef_answers select 'history', public.stock_movements((select id from reg where k = 'r1'), null, null, 100);
insert into chef_answers select 'reverse', public.reverse_movement((select movement from targets where role = 'waiter'));
select isnt_empty($$ select 1 from chef_answers where jsonb_typeof(r) in ('object', 'array') and r <> '[]' $$, 'the chef answers are not empty (the scan is not vacuous)');
select is_empty($$ select k, app.payload_money_keys(r) from chef_answers where app.payload_money_keys(r) <> '{}' $$,
  'V6: no key of any chef answer looks like money');
select is_empty($$ select k from chef_answers where r::text ~* '(€|"[a-z_]*(eur|cost|price|amount)[a-z_]*")' $$,
  'and no answer holds a euro sign or a cost-named key');
select is_empty($$ select k from chef_answers where 'unit_cost' = any (pg_temp.all_keys(r)) $$, 'in particular no unit_cost');

-- Admin and owner: everything, but no direct write --------------------------------------------------------------------------------
select pg_temp.as_admin();
set local role authenticated;
select is(pg_temp.outcomes('admin'), 'ok ok ok ok ok ok ok ok', 'admin: every function is allowed (Q1)');
select is(pg_temp.direct_writes(), '42501 42501 42501 42501 42501 42501', 'admin: direct INSERT, UPDATE and DELETE are refused');
reset role;
select pg_temp.as_owner();
set local role authenticated;
select is(pg_temp.outcomes('owner'), 'ok ok ok ok ok ok ok ok', 'owner: every function is allowed');
select is(pg_temp.direct_writes(), '42501 42501 42501 42501 42501 42501', 'owner: direct INSERT, UPDATE and DELETE are refused');
select cmp_ok(pg_temp.seen('stock_movement'), '>', 0::bigint, 'owner: reads stock_movement (it carries unit_cost)');
reset role;

-- No claims ------------------------------------------------------------------------------------------------------------------------------
select pg_temp.as_none();
set local role authenticated;
select is(pg_temp.outcomes('chef'), '42501 42501 42501 42501 42501 42501 42501 42501', 'no claims: 42501 from all eight functions');
select is(pg_temp.direct_writes(), '42501 42501 42501 42501 42501 42501', 'no claims: direct writes are refused');
reset role;

-- Grants and result columns ------------------------------------------------------------------------------------------------------------------
select is_empty($$ select f.proname, r.rolname
    from pg_proc f cross join (values ('anon'), ('service_role')) r (rolname)
   where f.pronamespace = 'public'::regnamespace
     and f.proname in ('consume_raw_fefo', 'post_waste', 'post_transfer', 'reverse_movement', 'stock_on_hand', 'stock_lots',
                       'stock_movements', 'raw_waste_costs')
     and has_function_privilege(r.rolname, f.oid, 'execute') $$, 'anon and service_role cannot execute any of the eight functions');
select is((select count(*)::int from pg_proc f where f.pronamespace = 'public'::regnamespace
            and f.proname in ('consume_raw_fefo', 'post_waste', 'post_transfer', 'reverse_movement', 'stock_on_hand', 'stock_lots',
                              'stock_movements', 'raw_waste_costs')
            and has_function_privilege('authenticated', f.oid, 'execute') and f.prosecdef and f.proconfig @> array['search_path=""']), 8,
  'all eight are executable by authenticated, definer, with an empty search_path');
select is_empty($$ select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('consume_raw_fefo', 'post_waste', 'post_transfer', 'reverse_movement', 'stock_on_hand', 'stock_lots', 'stock_movements')
    and (pg_get_function_result(p.oid) ~* '(cost|price|eur|value|amount|margin)') $$,
  'none of the seven quantity functions has a cost-like result column');
select is_empty($$ select f.proname from pg_proc f where f.pronamespace = 'app'::regnamespace
    and f.proname in ('require_stock_reader', 'require_stock_writer', 'lock_ingredient_stock', 'stock_qty_base', 'expiry_state', 'fefo_buckets',
                      'location_on_hand', 'raise_negative_stock', 'post_stock_outflow', 'run_stock_outflow', 'chef_payload_allowed',
                      'stock_reason_codes', 'stock_movement_reversal_guard')
    and (has_function_privilege('authenticated', f.oid, 'execute') or has_function_privilege('anon', f.oid, 'execute')
         or has_function_privilege('service_role', f.oid, 'execute')) $$, 'no API role can execute any app.* function of M12');
select is_empty($$ select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname in ('raw_lot', 'stock_movement')
    and (has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update')
         or has_table_privilege('authenticated', c.oid, 'delete') or has_table_privilege('service_role', c.oid, 'insert')
         or has_table_privilege('anon', c.oid, 'select')) $$, 'no API role has INSERT, UPDATE or DELETE on the two tables, and anon cannot read them');

select * from finish();
rollback;
