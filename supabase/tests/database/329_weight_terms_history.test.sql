-- P2-0b review fix (versioning, Q-W15 decided by the lead 2026-11-11): the reference portion weight lives on the menu price row with the unit, so
-- a report for a past day reads the price, the unit and the reference weight that were in force that day. A change of the reference weight or the unit
-- writes a new terms row from now, as a price change does; yesterday's plate_costs and plate_breakdown do not move. Clearing the weight on a weighted
-- item stays refused (portion_weight_missing, and a table check), so no_sale_price cannot appear retroactively. The menu reads return the current terms.
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number, settings) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000', '{"sale_vat_pct": 10}'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115', '{"sale_vat_pct": 22}');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');

-- Cost fixture (as pgTAP 158): two flour plates at a food cost of 3,00 (2 kg at 1,50), recipe price 12,00, target GP 70.
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Farina di mais (demo)', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  values ('00000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-0000000000f1.pdf', 'application/pdf', 100, 'review',
          '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
  values ('a2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000f1', 1,
          'Acquisto demo', 1, 1.5, 1.5, '{}', '{}');
insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1b000000-0000-4000-8000-00000000001b', '5a000000-0000-4000-8000-00000000005a',
          'a2000000-0000-4000-8000-000000000001', 1.5, 'kg', '1998-09-01', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto uno (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto due (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'brasato (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'brasato con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-000000000101', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-000000000001', 1, '1998-01-01T00:00Z', 'Piatto uno (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-000000000201', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-000000000002', 1, '1998-01-01T00:00Z', 'Piatto due (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, now() - interval '5 days', 'Brasato con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, now() - interval '5 days', 'Brasato (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-000000000101', 1, '1b000000-0000-4000-8000-00000000001b', 2, 'kg', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-000000000201', 1, '1b000000-0000-4000-8000-00000000001b', 2, 'kg', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 1, 'ec000000-0000-4000-8000-0000000000e1', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by) values
  ('ed000000-0000-4000-8000-000000000101', '11111111-1111-4111-8111-111111111111', 12, 70, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-000000000201', '11111111-1111-4111-8111-111111111111', 12, 70, 'a1000000-0000-4000-8000-00000000000a');
insert into public.location (id, tenant_id, name) values ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
-- One live batch of the brasato: 3,5 portions left.
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by,
    output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by)
  values ('b4000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1',
    'ed000000-0000-4000-8000-0000000000d1', 1, '981023-LOT-1', '1998-10-23', 'LOT', 1, now() + interval '40 hours' - interval '48 hours',
    'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 4, 4, 48, now() + interval '40 hours', 'fresh', '10000000-0000-4000-8000-0000000000a1',
    'a1000000-0000-4000-8000-00000000000a');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'b4000000-0000-4000-8000-000000000001', 'produce', 3.5, 'batch', 'b4000000-0000-4000-8000-000000000001',
    '1998-10-23', 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', case when app_role = 'admin' then 'aal2' else 'aal1' end)::text, true)
$$;
create function pg_temp.as_owner() returns void language sql as $$ select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner') $$;
create function pg_temp.as_admin() returns void language sql as $$ select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin') $$;
create function pg_temp.as_waiter() returns void language sql as $$ select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter') $$;
create function pg_temp.as_chef() returns void language sql as $$ select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef') $$;
create function pg_temp.as_owner_b() returns void language sql as $$ select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner') $$;
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
create function pg_temp.keys(j jsonb) returns setof text language plpgsql as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    for k, v in select * from jsonb_each(j) loop
      return next k;
      return query select * from pg_temp.keys(v);
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    for v in select * from jsonb_array_elements(j) loop
      return query select * from pg_temp.keys(v);
    end loop;
  end if;
end
$$;
create function pg_temp.item_of(j jsonb, p_id uuid) returns jsonb language sql as $$
  select jsonb_path_query_first(j, '$.categories[*].items[*] ? (@.id == $id)', jsonb_build_object('id', p_id::text)) $$;
create temp table ids (k text primary key, id uuid);
create temp table seen (k text primary key, j jsonb);
grant all on ids, seen to public;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from ids where ids.k = $1 $$;
create function pg_temp.upd(p_patch text) returns text language sql as $$
  select pg_temp.err(format($f$ select public.update_menu_item(%L, %L::jsonb) $f$, pg_temp.id('w'), p_patch)) $$;

-- Fixture: the weighted item maps plate one (food cost 3,00). Its price history is written directly, as the migration owner: the terms row three days
-- ago was 5,50 per etto on a 400 g reference portion. The changes below go through update_menu_item, i.e. "today".
create function pg_temp.yday() returns date language sql as $$ select app.venue_date(now(), 'Europe/Rome') - 1 $$;
create function pg_temp.row_count() returns bigint language sql as $$ select count(*) from public.menu_item_price where menu_item_id = pg_temp.id('w') $$;
create function pg_temp.costs(p_date date) returns text language sql as $$
  select c.sale_price_eur::text || ' ' || c.gp_pct::text || ' ' || c.price_unit || ' ' || coalesce(c.portion_weight_g::text, '-')
    from public.plate_costs(p_date) c where c.recipe_key = 'ec000000-0000-4000-8000-000000000001' $$;
create function pg_temp.money(p_date date) returns text language sql as $$
  select (b -> 'money' ->> 'salePriceEur') || ' ' || (b ->> 'gpPct') || ' ' || (b -> 'money' ->> 'priceUnit') || ' ' || coalesce(b -> 'money' ->> 'portionWeightG', '-')
    from (select public.plate_breakdown('ec000000-0000-4000-8000-000000000001', p_date) as b) x $$;
insert into ids values ('w', 'a9000000-0000-4000-8000-000000000001');
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, created_by, updated_by)
  values (pg_temp.id('w'), '11111111-1111-4111-8111-111111111111', 'Bistecca a peso (demo)', 'Secondi', 'secondi', 'ec000000-0000-4000-8000-000000000001',
          'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (tenant_id, menu_item_id, price, price_unit, portion_weight_g, vat_rate, valid_from, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.id('w'), 5.5, 'etto', 400, 10, now() - interval '3 days', 'a1000000-0000-4000-8000-00000000000a');

-- The terms row carries the unit and the reference weight; the DB refuses an etto row without a weight or with one out of range -------------------------
select pg_temp.as_owner();
select is((select t.price_unit || '/' || t.portion_weight_g from app.menu_item_sale_terms_at('11111111-1111-4111-8111-111111111111', array[pg_temp.id('w')], clock_timestamp()) t), 'etto/400',
  'menu_item_sale_terms_at reads the reference weight from the terms row');
select is(left(pg_temp.err($$ insert into public.menu_item_price (tenant_id, menu_item_id, price, price_unit, vat_rate, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'a9000000-0000-4000-8000-000000000001', 5.5, 'etto', 10, 'a1000000-0000-4000-8000-00000000000a') $$), 5), '23514', 'a price row per etto without a reference weight is refused by the table');
select is(left(pg_temp.err($$ insert into public.menu_item_price (tenant_id, menu_item_id, price, price_unit, portion_weight_g, vat_rate, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'a9000000-0000-4000-8000-000000000001', 5.5, 'etto', 9, 10, 'a1000000-0000-4000-8000-00000000000a') $$), 5), '23514', 'a reference weight of 9 is refused by the table');
select is(left(pg_temp.err($$ insert into public.menu_item_price (tenant_id, menu_item_id, price, price_unit, portion_weight_g, vat_rate, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'a9000000-0000-4000-8000-000000000001', 5.5, 'etto', 3001, 10, 'a1000000-0000-4000-8000-00000000000a') $$), 5), '23514', 'and 3001 too');

-- Before any change today ------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.costs(pg_temp.yday()), '22.00 85.0000 etto 400', 'plate_costs yesterday: 5,50 x 400 g = 22,00, GP 85 %');
select is(pg_temp.money(pg_temp.yday()), '22.00 85.0000 etto 400', 'plate_breakdown yesterday: the same');

-- Clearing the reference weight on a weighted item stays refused ------------------------------------------------------------------------------------
select is(pg_temp.upd('{"portionWeightG":null}'), 'P0001 portion_weight_missing', 'clearing the reference weight while the price is per etto is refused');
select is(pg_temp.row_count(), 1::bigint, 'and no terms row was written');

-- The reference weight changes today -----------------------------------------------------------------------------------------------------------------
select is(pg_temp.upd('{"portionWeightG":500}'), 'ok', 'the owner changes the reference weight to 500 g');
select is(pg_temp.row_count(), 2::bigint, 'it writes a new terms row, as a price change does');
select is((select string_agg(p.portion_weight_g::text || ':' || trim_scale(p.price)::text, ',' order by p.valid_from) from public.menu_item_price p where p.menu_item_id = pg_temp.id('w')), '400:5.5,500:5.5',
  'the history keeps both, with the same price');
select is((select (a.before ->> 'portion_weight_g') || '>' || (a.after ->> 'portion_weight_g') from public.audit_event a where a.entity_id = pg_temp.id('w') and a.action = 'menu_item.updated'),
  '400>500', 'and the audit says 400 to 500');
select is(pg_temp.costs(pg_temp.yday()), '22.00 85.0000 etto 400', 'plate_costs yesterday is unchanged: 22,00, GP 85 %, 400 g');
select is(pg_temp.money(pg_temp.yday()), '22.00 85.0000 etto 400', 'plate_breakdown yesterday is unchanged');
select is(pg_temp.costs(null), '27.50 88.0000 etto 500', 'plate_costs today uses 500 g: 27,50, GP 88 %');
select is(pg_temp.money(null), '27.50 88.0000 etto 500', 'plate_breakdown today uses 500 g');
select is((select t.portion_weight_g from app.menu_item_sale_terms_at('11111111-1111-4111-8111-111111111111', array[pg_temp.id('w')], now() - interval '1 day') t), 400, 'menu_item_sale_terms_at a day ago says 400');
select is((select t.portion_weight_g from app.menu_item_sale_terms_at('11111111-1111-4111-8111-111111111111', array[pg_temp.id('w')], clock_timestamp()) t), 500, 'and now says 500');
-- The menu reads return the current terms.
select is((select app.menu_items_json('11111111-1111-4111-8111-111111111111', array[pg_temp.id('w')]) -> 0 ->> 'portionWeightG'), '500', 'the manage item reads the current reference weight');
select pg_temp.as_waiter();
select is((select pg_temp.item_of(public.menu_list(), pg_temp.id('w')) ->> 'portionWeightG'), '500', 'menu_list reads the current reference weight');
select pg_temp.as_owner();
-- A weight change while a push runs is allowed (the push price stays per etto).
select is((select public.push_menu_item(pg_temp.id('w'), '{"pushed":true,"pushPrice":5}'::jsonb) ->> 'changed'), 'true', 'a push at 5,00 per etto starts');
select is(pg_temp.upd('{"portionWeightG":450}'), 'ok', 'a reference weight change during the push is accepted');
select is((select trim_scale(push_price)::text from public.menu_item where id = pg_temp.id('w')), '5', 'and the push is untouched');
select is(pg_temp.upd('{"portionWeightG":500}'), 'ok', 'the weight is put back to 500 g');

-- A unit switch today (after stopping the push, as push_active requires) ---------------------------------------------------------------------------------
select is(pg_temp.upd('{"priceUnit":"portion","price":14}'), 'P0001 push_active', 'the switch is refused while the push runs');
select is((select public.push_menu_item(pg_temp.id('w'), '{"pushed":false}'::jsonb) ->> 'changed'), 'true', 'the push is stopped');
select is(pg_temp.upd('{"priceUnit":"portion","price":14}'), 'ok', 'the owner switches the dish to portion at 14,00');
select is(pg_temp.costs(pg_temp.yday()), '22.00 85.0000 etto 400', 'plate_costs yesterday is unchanged by the switch (etto, 22,00, 400 g)');
select is(pg_temp.money(pg_temp.yday()), '22.00 85.0000 etto 400', 'plate_breakdown yesterday is unchanged by the switch');
select is(pg_temp.costs(null), '14.00 76.4286 portion -', 'plate_costs today is per portion: 14,00, GP 76,4286 % (no reference weight is reported for a per-portion price)');
select is(pg_temp.money(null), '14.00 76.4286 portion -', 'plate_breakdown today is per portion');
select is(pg_temp.upd('{"priceUnit":"etto","price":6}'), 'ok', 'switching back to etto keeps the reference weight of the row in force (500 g)');
select is(pg_temp.costs(null), '30.00 89.0000 etto 500', 'plate_costs today: 6,00 x 500 g = 30,00, GP 89 %');
select is(pg_temp.costs(pg_temp.yday()), '22.00 85.0000 etto 400', 'and yesterday is still 22,00 at 400 g');

select * from finish();
rollback;
