-- M14 step 8: M14 changed nothing of what M8 and M12 built. The engine, the stock lock, the reversal procedure, the
-- cost reader and the alert pipeline are pinned by md5 of their definitions (the technique of 098); each exists
-- once; a batch consumption row cannot be reversed through reverse_movement; no alert kind was added; and the
-- production core raises no alert itself. 075, 076 and 098 run unchanged beside this file. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

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
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
   'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');

create temporary table reg (k text primary key, id uuid not null);
insert into reg values ('cella', '10000000-0000-4000-8000-0000000000a1');
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  detail text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, detail = pg_exception_detail;
  return state || ' ' || msg || coalesce(' / ' || nullif(detail, ''), '');
end
$$;

create sequence pg_temp.line_seq;
create function pg_temp.new_line() returns uuid language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
      line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', v_n, 'Riga demo', 1,
      10, 10, '{}', '{}');
  return v_line;
end
$$;
create function pg_temp.mk_ing(p_k text, p_name text, p_unit text default 'kg', p_stock boolean default true) returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.ingredient (id, tenant_id, name, base_unit, is_stock)
    values (pg_temp.id(p_k), '11111111-1111-4111-8111-111111111111', p_name, p_unit::public.base_unit, p_stock);
end
$$;
-- A lot at Cella with its receipt.
create function pg_temp.mk_lot(p_key text, p_code text, p_ing text, p_expiry date, p_qty numeric) returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_line();
  v_lot uuid := gen_random_uuid();
begin
  insert into reg values (p_key, v_lot);
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code,
      expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    select v_lot, '11111111-1111-4111-8111-111111111111', i.id, pg_temp.id('cella'),
           '5a000000-0000-4000-8000-00000000005a', v_line, p_code, p_expiry, '2026-10-20', p_qty, i.base_unit, p_qty,
           i.base_unit::text, 1, 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = pg_temp.id(p_ing);
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
      ref_type, ref_id, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_ing), v_lot, pg_temp.id('cella'), 'receipt', p_qty, 10,
      'invoice_line', v_line, '2026-10-20', 'a1000000-0000-4000-8000-00000000000a');
end
$$;
create function pg_temp.buy(p_ing text, p_price numeric, p_on date) returns void language sql as $$
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit,
      effective_on, created_by)
    select '11111111-1111-4111-8111-111111111111', i.id, '5a000000-0000-4000-8000-00000000005a', pg_temp.new_line(),
           p_price, i.base_unit, p_on, 'a1000000-0000-4000-8000-00000000000a'
      from public.ingredient i where i.id = pg_temp.id(p_ing)
$$;
-- A recipe key with its version 1 (a batch gets the output, portions and shelf life given).
create function pg_temp.mk_rec(p_k text, p_name text, p_type text, p_out numeric, p_unit text default 'kg',
    p_ppb int default null, p_shelf int default null) returns void language plpgsql as $$
begin
  insert into reg values ('k_' || p_k, gen_random_uuid()), ('r_' || p_k, gen_random_uuid());
  insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
    values (pg_temp.id('k_' || p_k), '11111111-1111-4111-8111-111111111111', p_type::public.recipe_type, 1,
            lower(p_name), 'a1000000-0000-4000-8000-00000000000a');
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
      portions_per_batch, shelf_life_hours, created_by)
    values (pg_temp.id('r_' || p_k), '11111111-1111-4111-8111-111111111111', pg_temp.id('k_' || p_k), 1,
            '2026-10-01T00:00Z', p_name, p_out, p_unit::public.base_unit, p_ppb, p_shelf,
            'a1000000-0000-4000-8000-00000000000a');
end
$$;
create function pg_temp.ln(p_rec text, p_pos int, p_target text, p_qty numeric, p_unit text default 'kg') returns void language plpgsql as $$
begin
  insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id('r_' || p_rec), p_pos,
      (select id from reg where k = p_target and k !~ '^k_'), (select id from reg where k = p_target and k ~ '^k_'),
      p_qty, p_unit::public.recipe_unit, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- A world: ingredients beef/onion/carrot/salt (kg), water (l, not stock); beef lots L-D2 3 kg and L-D5 3 kg, onion
-- L-CIP 2 kg, carrot L-CAR 2 kg, salt L-SAL 1 kg; three purchases each of beef (10), onion (1) and carrot (1);
-- recipes: soffritto (sub), stew (batch 6 kg, 30 portions, 72 h), brodo (batch 5 l, 20 portions, 48 h) and a second
-- stew (3 kg, 15 portions, 72 h) whose name shares the lot code SPEZZA.
create function pg_temp.world(p text) returns void language plpgsql as $$
declare
  v_d date := app.venue_date(now(), 'Europe/Rome');
begin
  perform pg_temp.mk_ing('beef_' || p, 'Manzo muscolo ' || p || ' (demo)');
  perform pg_temp.mk_ing('onion_' || p, 'Cipolla ' || p || ' (demo)');
  perform pg_temp.mk_ing('carrot_' || p, 'Carota ' || p || ' (demo)');
  perform pg_temp.mk_ing('salt_' || p, 'Sale grosso ' || p || ' (demo)');
  perform pg_temp.mk_ing('water_' || p, 'Acqua ' || p || ' (demo)', 'l', false);
  perform pg_temp.mk_lot('d2_' || p, 'L-D2', 'beef_' || p, v_d + 2, 3);
  perform pg_temp.mk_lot('d5_' || p, 'L-D5', 'beef_' || p, v_d + 5, 3);
  perform pg_temp.mk_lot('cip_' || p, 'L-CIP', 'onion_' || p, v_d + 7, 2);
  perform pg_temp.mk_lot('car_' || p, 'L-CAR', 'carrot_' || p, v_d + 7, 2);
  perform pg_temp.mk_lot('old_' || p, 'L-OLD', 'carrot_' || p, v_d - 1, 1);
  perform pg_temp.mk_lot('sal_' || p, 'L-SAL', 'salt_' || p, null, 1);
  perform pg_temp.buy('beef_' || p, 10, d) from unnest(array['2026-09-01', '2026-09-02', '2026-09-03']::date[]) d;
  perform pg_temp.buy('onion_' || p, 1, d) from unnest(array['2026-09-01', '2026-09-02', '2026-09-03']::date[]) d;
  perform pg_temp.buy('carrot_' || p, 1, d) from unnest(array['2026-09-01', '2026-09-02', '2026-09-03']::date[]) d;
  perform pg_temp.mk_rec('sof_' || p, 'Soffritto ' || p || ' (demo)', 'sub', 1);
  perform pg_temp.ln('sof_' || p, 1, 'onion_' || p, 0.6); perform pg_temp.ln('sof_' || p, 2, 'carrot_' || p, 0.4);
  perform pg_temp.mk_rec('stew_' || p, 'Spezzatino ' || p || ' (demo)', 'batch', 6, 'kg', 30, 72);
  perform pg_temp.ln('stew_' || p, 1, 'beef_' || p, 5); perform pg_temp.ln('stew_' || p, 2, 'k_sof_' || p, 0.5);
  perform pg_temp.ln('stew_' || p, 3, 'water_' || p, 1, 'l');
  perform pg_temp.mk_rec('brodo_' || p, 'Brodo ' || p || ' (demo)', 'batch', 5, 'l', 20, 48);
  perform pg_temp.ln('brodo_' || p, 1, 'onion_' || p, 0.2); perform pg_temp.ln('brodo_' || p, 2, 'salt_' || p, 30, 'g');
  perform pg_temp.mk_rec('manzo_' || p, 'Spezzatino di manzo ' || p || ' (demo)', 'batch', 3, 'kg', 15, 72);
  perform pg_temp.ln('manzo_' || p, 1, 'beef_' || p, 2.5);
end
$$;

-- The stew's inputs: beef, onion, carrot in kg (a lot override for the beef and a location for each when given).
create function pg_temp.inp(p text, beef numeric, onion numeric, carrot numeric, lot text default null, loc uuid default null)
  returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_strip_nulls(jsonb_build_object('ingredientId', pg_temp.id('beef_' || p), 'qty', beef, 'unit', 'kg',
                                         'lotId', case when lot is null then null else pg_temp.id(lot) end, 'locationId', loc)),
    jsonb_strip_nulls(jsonb_build_object('ingredientId', pg_temp.id('onion_' || p), 'qty', onion, 'unit', 'kg', 'locationId', loc)),
    jsonb_strip_nulls(jsonb_build_object('ingredientId', pg_temp.id('carrot_' || p), 'qty', carrot, 'unit', 'kg', 'locationId', loc)))
$$;
-- Claims for each role, and the objects the role may touch.
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
create function pg_temp.as_chef() returns void language sql as $$
  select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef') $$;
create function pg_temp.as_owner() returns void language sql as $$
  select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner') $$;
create function pg_temp.as_admin() returns void language sql as $$
  select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin') $$;
create function pg_temp.as_waiter() returns void language sql as $$
  select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter') $$;
create function pg_temp.as_ownerb() returns void language sql as $$
  select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner') $$;
create function pg_temp.as_none() returns void language sql as $$ select set_config('request.jwt.claims', '', true) $$;
insert into auth.users (id, email) values ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
-- One public production; the answer is kept by key. The rows it writes are read by LATER statements.
create temporary table res (k text primary key, r jsonb);
create function pg_temp.prod(p_k text, p_recipe text, p_output numeric, p_inputs jsonb, p_portions int default null,
    p_shelf int default null, p_loc uuid default null)
  returns void language sql as $$
  insert into res select p_k, public.produce_batch(pg_temp.id(p_recipe), p_output, p_inputs, p_portions, p_shelf, p_loc)
$$;
create function pg_temp.prop(p_k text, p_recipe_key text, p_output numeric default null, p_shelf int default null)
  returns void language sql as $$
  insert into res select p_k, public.batch_proposal(pg_temp.id(p_recipe_key), p_output, p_shelf)
$$;
create function pg_temp.bid(p_k text) returns uuid language sql as $$ select (r ->> 'batchId')::uuid from res where k = p_k $$;
-- 'lotcode qty, lotcode qty' of a batch's consumption of one ingredient, sorted by lot code ('null' = the shortfall).
create function pg_temp.rows_of(p_k text, p_ing text) returns text language sql as $$
  select coalesce(string_agg(coalesce(l.lot_code, 'null') || ' ' || trim_scale(m.qty)::text, ', '
                             order by coalesce(l.lot_code, 'null') collate "C"), '-')
    from public.stock_movement m left join public.raw_lot l on l.id = m.raw_lot_id
   where m.ref_type = 'batch' and m.ref_id = pg_temp.bid(p_k) and m.ingredient_id = pg_temp.id(p_ing) $$;
create function pg_temp.counts() returns text language sql as $$
  select (select count(*) from public.stock_movement) || '/' || (select count(*) from public.batch) || '/'
      || (select count(*) from public.batch_input) || '/' || (select count(*) from public.batch_movement) || '/'
      || (select count(*) from public.batch_cost) || '/' || (select count(*) from public.alert) $$;
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

create temporary table outs (k text primary key, v text);
create function pg_temp.fn(p_schema text, p_name text) returns oid language sql stable as $$
  select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = p_schema and p.proname = p_name $$;
create function pg_temp.src(p_schema text, p_name text) returns text language sql stable as $$
  select pg_get_functiondef(pg_temp.fn(p_schema, p_name)) $$;

-- Exactly one definition of each (no overload, no second copy).
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname, p.proname) in (('app', 'post_stock_outflow'), ('app', 'lock_ingredient_stock'),
              ('public', 'reverse_movement'), ('app', 'raise_alert'), ('app', 'try_raise_alert'), ('public', 'approve_invoice'),
              ('app', 'ingredient_unit_costs'))),
  7, 'post_stock_outflow, lock_ingredient_stock, reverse_movement, raise_alert, try_raise_alert, approve_invoice and ingredient_unit_costs: one definition each');

-- The md5 of pg_get_functiondef under an empty search_path was computed on the chain up to 20261026100900 (M12);
-- it must be the same on the full chain.
set local search_path = '';
create temp table pin_md5 on commit drop as
select 'post_stock_outflow' as k, md5(pg_get_functiondef('app.post_stock_outflow(uuid,uuid,uuid,uuid,numeric,public.stock_movement_type,text,uuid,text,uuid,timestamptz,timestamptz,text)'::regprocedure)) as h
union all select 'lock_ingredient_stock', md5(pg_get_functiondef('app.lock_ingredient_stock(uuid,uuid[])'::regprocedure))
union all select 'reverse_movement', md5(pg_get_functiondef('public.reverse_movement(uuid)'::regprocedure))
union all select 'ingredient_unit_costs', md5(pg_get_functiondef('app.ingredient_unit_costs(uuid,uuid[],timestamptz)'::regprocedure));
set local search_path = "$user", public, extensions;
select is((select h from pin_md5 where k = 'post_stock_outflow'), 'b50e1690b47e3b3f89dd1da533c59463', 'app.post_stock_outflow is the M12 engine (md5)');
select is((select h from pin_md5 where k = 'lock_ingredient_stock'), '3ff1f9612e96a6b9a79484e374c4f09c', 'app.lock_ingredient_stock is the M12 lock (md5)');
select is((select h from pin_md5 where k = 'reverse_movement'), '86315a44ad8596241d21beab13ec00ab', 'public.reverse_movement is the M12 procedure (md5)');
select is((select h from pin_md5 where k = 'ingredient_unit_costs'), 'c33bfb730c5711aa7bcb9fd4fb9c62bb', 'app.ingredient_unit_costs is the M8 reader (md5)');

-- No alert kind was added.
select is((select string_agg(kind, ',' order by kind) from app.alert_kind),
  'device_locked,negative_stock,payable_due_7d,payable_due_today,payable_overdue_3d,payables_weekly_digest,price_variance,test_alert,test_alert_kitchen',
  'the alert kinds are unchanged (M14 adds none; device_locked is M11)');

-- The core calls the engine and never an alert function itself.
select ok(pg_temp.src('app', 'produce_batch_core') ~ 'app\.post_stock_outflow\(' and pg_temp.src('app', 'produce_batch_core') ~ '''produce_batch''',
  'produce_batch_core consumes through the engine and names itself as the caller');
select ok(pg_temp.src('app', 'produce_batch_core') !~ 'app\.(try_)?raise_alert\(' and pg_temp.src('app', 'produce_batch_core') !~ 'insert into public\.stock_movement',
  'and neither raises an alert nor writes a stock movement itself');
select ok(position('app.lock_ingredient_costs(' in pg_temp.src('app', 'produce_batch_core')) = 0
          and position('app.lock_recipe_graph' in pg_temp.src('app', 'produce_batch_core')) = 0,
  'and takes neither the cost locks nor the recipe-graph lock (plan §3.1.11)');

-- A batch consumption row is not reversible through reverse_movement (M12 rule).
select pg_temp.world('a');
select app.produce_batch_core('11111111-1111-4111-8111-111111111111', 'c1000000-0000-4000-8000-00000000000c', pg_temp.id('r_stew_a'),
  0.6, pg_temp.inp('a', 0.5, 0.03, 0.02), null, null, null, now() - interval '1 hour');
create temporary table target as
  select m.id from public.stock_movement m where m.ref_type = 'batch' and m.ingredient_id = pg_temp.id('beef_a') limit 1;
grant all on target, outs to authenticated;
grant execute on function pg_temp.err(text), pg_temp.as_owner(), pg_temp.as_chef(), pg_temp.act_as(uuid, uuid, text) to authenticated;
set local role authenticated;
select pg_temp.as_owner();
insert into outs select 'rev_owner', pg_temp.err(format('select public.reverse_movement(%L)', (select id from target)));
select pg_temp.as_chef();
insert into outs select 'rev_chef', pg_temp.err(format('select public.reverse_movement(%L)', (select id from target)));
reset role;
select is((select v from outs where k = 'rev_owner'), 'P0001 movement_not_reversible', 'the owner cannot reverse a batch consumption row');
select is((select v from outs where k = 'rev_chef'), 'P0001 movement_not_reversible', 'nor can the chef');
select is((select count(*)::int from public.stock_movement m where m.reverses_id is not null), 0, 'and no reversal row exists');

-- A batch consumption is an ordinary consumption movement mirrored by batch_input.
select is((select count(*)::int from public.stock_movement m where m.ref_type = 'batch' and m.type::text = 'consumption' and m.qty < 0), 3,
  'the three consumption rows of the batch are ordinary consumption movements (ref_type batch)');
select is((select count(*)::int from public.batch_input bi join public.stock_movement m on m.id = bi.stock_movement_id
            where m.ref_type = 'batch' and m.ref_id = bi.batch_id), 3, 'each is mirrored by a batch_input');

-- The movement types M12 knows were not extended.
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.stock_movement_type'::regtype),
  'receipt,consumption,waste,transfer,count', 'stock_movement_type is unchanged');

select * from finish();
rollback;
