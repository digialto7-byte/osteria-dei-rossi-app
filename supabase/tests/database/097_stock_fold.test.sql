-- M12 step 8 (AT2, database side): a scripted sequence of 40 operations over two ingredients, three lots and two
-- locations (wastes over and beyond stock, overrides, transfers, refused transfers, reversals of each kind, a refused
-- double reversal). After EACH step, v_stock_on_hand is compared with a fold of stock_movement written in this test
-- (not the view's own query), joined with IS NOT DISTINCT FROM on the lot, and no lot bucket may be below zero. At steps
-- 10, 25 and 40 the totals per ingredient and location equal constants worked out by hand (comments below). The random
-- version of the property runs in tests/integration/stock-property.int.ts (M12 step 15).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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


-- Fixture: ingredient A with lots A1 (expires D+2, 5 kg) and A2 (expires D+5, 4 kg) at Cella; ingredient B with lot B1 (6 kg, no
-- expiry) at Cella. Freezer starts empty. A has a price (10), B has none.
select pg_temp.mk_ing('fa');
select pg_temp.mk_lot('fa_1', 'A1', 'fa', 'cella', '2026-10-25', '2026-10-20', 5);
select pg_temp.mk_lot('fa_2', 'A2', 'fa', 'cella', '2026-10-28', '2026-10-20', 4);
select pg_temp.buy('fa', 10, '2026-10-01');
select pg_temp.mk_ing('fb');
select pg_temp.mk_lot('fb_1', 'B1', 'fb', 'cella', null, '2026-10-20', 6);

create temporary table script (n int primary key, act text, ing text, qty numeric, loc text, loc2 text, lot text, ref int, err text);
insert into script values
  (1, 'waste', 'fa', 1, 'cella', null, null, null, null),
  (2, 'waste', 'fa', 2, 'cella', null, 'fa_2', null, null),
  (3, 'consume', 'fb', 1.5, 'cella', null, null, null, null),
  (4, 'transfer', 'fa', 3, 'cella', 'freezer', null, null, null),
  (5, 'waste', 'fa', 2, 'freezer', null, null, null, null),
  (6, 'reverse', null, null, null, null, null, 2, null),
  (7, 'transfer', 'fb', 2, 'cella', 'freezer', null, null, null),
  (8, 'waste', 'fb', 3, 'cella', null, null, null, null),
  (9, 'consume', 'fb', 1, 'freezer', null, null, null, null),
  (10, 'reverse', null, null, null, null, null, 8, null),
  (11, 'waste', 'fa', 4, 'cella', null, null, null, null),
  (12, 'transfer', 'fa', 1, 'freezer', 'cella', null, null, null),
  (13, 'waste', 'fa', 1, 'cella', null, 'fa_2', null, null),
  (14, 'consume', 'fa', 3, 'cella', null, null, null, null),
  (15, 'transfer', 'fa', 1, 'cella', 'freezer', null, null, 'insufficient_stock'),
  (16, 'reverse', null, null, null, null, null, 14, null),
  (17, 'waste', 'fa', 0.5, 'cella', null, null, null, null),
  (18, 'reverse', null, null, null, null, null, 17, null),
  (19, 'reverse', null, null, null, null, null, 17, 'already_reversed'),
  (20, 'transfer', 'fb', 2.5, 'cella', 'freezer', null, null, null),
  (21, 'reverse', null, null, null, null, null, 20, null),
  (22, 'consume', 'fb', 2.5, 'cella', null, null, null, null),
  (23, 'consume', 'fb', 1, 'cella', null, null, null, null),
  (24, 'waste', 'fb', 1, 'freezer', null, 'fb_1', null, null),
  (25, 'waste', 'fa', 1, 'freezer', null, null, null, null),
  (26, 'reverse', null, null, null, null, null, 25, null),
  (27, 'reverse', null, null, null, null, null, 23, null),
  (28, 'reverse', null, null, null, null, null, 22, null),
  (29, 'transfer', 'fb', 1, 'freezer', 'cella', null, null, 'insufficient_stock'),
  (30, 'reverse', null, null, null, null, null, 24, null),
  (31, 'transfer', 'fb', 1, 'freezer', 'cella', null, null, null),
  (32, 'waste', 'fb', 3.5, 'cella', null, null, null, null),
  (33, 'reverse', null, null, null, null, null, 31, 'transfer_already_used'),
  (34, 'reverse', null, null, null, null, null, 32, null),
  (35, 'reverse', null, null, null, null, null, 31, null),
  (36, 'waste', 'fa', 1, 'cella', null, 'fa_1', null, null),
  (37, 'consume', 'fa', 2, 'freezer', null, null, null, null),
  (38, 'transfer', 'fa', 1, 'cella', 'freezer', null, null, 'insufficient_stock'),
  (39, 'reverse', null, null, null, null, null, 36, null),
  (40, 'transfer', 'fa', 1, 'cella', 'freezer', null, null, null);

create temporary table ops (n int primary key, operation uuid);
create temporary table fold_check (n int primary key, diffs int, neg_lots int, outcome text);
create temporary table checkpoint (n int primary key, totals text);

-- The fold, written here: Sum(qty) per ingredient, location and lot straight from the ledger.
create function pg_temp.diffs() returns int language sql as $$
  select count(*)::int
    from (select * from public.v_stock_on_hand where tenant_id = '11111111-1111-4111-8111-111111111111') v
    full outer join (select m.ingredient_id, m.location_id, m.raw_lot_id, sum(m.qty) as q
                       from public.stock_movement m where m.tenant_id = '11111111-1111-4111-8111-111111111111'
                      group by m.ingredient_id, m.location_id, m.raw_lot_id) f
      on f.ingredient_id = v.ingredient_id and f.location_id = v.location_id and f.raw_lot_id is not distinct from v.raw_lot_id
   where v.qty_on_hand is distinct from f.q $$;
create function pg_temp.neg_lots() returns int language sql as $$
  select count(*)::int from (select m.ingredient_id, m.location_id, m.raw_lot_id, sum(m.qty) as q
                               from public.stock_movement m where m.tenant_id = '11111111-1111-4111-8111-111111111111'
                              group by 1, 2, 3) f where f.raw_lot_id is not null and f.q < 0 $$;
create function pg_temp.totals() returns text language sql as $$
  select string_agg(left(i.name, 2) || '@' || left(x.name, 1) || '=' || trim_scale(f.q)::text, ' ' order by i.name collate "C", x.name collate "C")
    from (select m.ingredient_id, m.location_id, sum(m.qty) as q from public.stock_movement m
           where m.tenant_id = '11111111-1111-4111-8111-111111111111' group by 1, 2) f
    join public.ingredient i on i.id = f.ingredient_id join public.location x on x.id = f.location_id $$;

create function pg_temp.run_script() returns void language plpgsql as $$
declare
  s record;
  v_res jsonb;
  v_err text;
  v_row uuid;
begin
  for s in select * from script order by n loop
    v_res := null;
    v_err := null;
    begin
      if s.act = 'waste' then
        v_res := public.post_waste(pg_temp.id(s.ing), s.qty, 'kg', 'spoilage', pg_temp.id(s.loc),
                                   case when s.lot is null then null else pg_temp.id(s.lot) end);
      elsif s.act = 'consume' then
        v_res := public.consume_raw_fefo(pg_temp.id(s.ing), s.qty, 'kg', pg_temp.id(s.loc),
                                         case when s.lot is null then null else pg_temp.id(s.lot) end);
      elsif s.act = 'transfer' then
        v_res := public.post_transfer(pg_temp.id(s.ing), s.qty, 'kg', pg_temp.id(s.loc), pg_temp.id(s.loc2));
      else
        -- Through the first row of the operation for even steps, the last for odd ones.
        select m.id into v_row from public.stock_movement m
         where m.ref_id = (select o.operation from ops o where o.n = s.ref)
         order by case when s.n % 2 = 0 then m.id::text end asc nulls last, m.id::text desc limit 1;
        v_res := public.reverse_movement(v_row);
      end if;
      insert into ops values (s.n, (v_res ->> 'operationId')::uuid);
    exception when others then
      get stacked diagnostics v_err = message_text;
    end;
    if v_err is distinct from s.err then
      raise exception 'step %: expected %, got %', s.n, coalesce(s.err, 'success'), coalesce(v_err, 'success');
    end if;
    insert into fold_check values (s.n, pg_temp.diffs(), pg_temp.neg_lots(), coalesce(v_err, 'ok'));
    if s.n in (10, 25, 40) then
      insert into checkpoint values (s.n, pg_temp.totals());
    end if;
  end loop;
end
$$;

select pg_temp.as_owner();
select lives_ok($$ select pg_temp.run_script() $$, 'all 40 steps ran, and every refused step was refused with its expected code');
select is((select count(*)::int from fold_check), 40, 'the fold was compared after each of the 40 steps');
select is_empty($$ select n from fold_check where diffs <> 0 $$, 'v_stock_on_hand equals the fold of the movements after every step');
select is_empty($$ select n from fold_check where neg_lots <> 0 $$, 'no lot bucket was below zero after any step');
select is((select outcome from fold_check where n = 33), 'transfer_already_used', 'step 33 (reverse a used transfer) was refused and changed nothing');
-- Hand-computed constants (ingredient fa = A with lots A1, A2; fb = B with lot B1; C = Cella, F = Freezer):
--   after 10: A: C 5 (A1 1, A2 4), F 1 (A1 1); B: C 2.5, F 1
--   after 25: A: C 1, F -1 (unlotted shortfall); B: C -1 (unlotted shortfall), F 0
--   after 40: A: C 0, F -1 (A1 1, unlotted -2); B: C 2.5, F 1
select is((select totals from checkpoint where n = 10), 'fa@C=5 fa@F=1 fb@C=2.5 fb@F=1', 'checkpoint after step 10 equals the hand-computed totals');
select is((select totals from checkpoint where n = 25), 'fa@C=1 fa@F=-1 fb@C=-1 fb@F=0', 'checkpoint after step 25 equals the hand-computed totals');
select is((select totals from checkpoint where n = 40), 'fa@C=0 fa@F=-1 fb@C=2.5 fb@F=1', 'checkpoint after step 40 equals the hand-computed totals');

select * from finish();
rollback;
