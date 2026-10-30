-- M17 step 1: the course type, the five menu/table tables, their guards, RLS, privileges and the audit checks as the
-- union of every earlier value plus M17's (plan §3.2, §5 step 1; ADR-016). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(91);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1,
   'spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');

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

-- The course enum, in service order.
select is((select array_agg(e::text) from unnest(enum_range(null::public.course)) e),
  array['antipasti', 'primi', 'secondi', 'dolci', 'bevande'], 'course has the five values in service order');

-- ----------------------------------------------------------------------------------------------------------------
-- menu_item: bounds
select is(pg_temp.err($$insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by)
  values ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)',
          'Secondi', 'secondi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  'ok', 'a minimal item is accepted (recipe_key null = unmapped)');
select is((select name_norm from public.menu_item where id = '11000000-0000-4000-8000-000000000001'),
  app.normalise_name('Spezzatino con polenta (demo)'), 'name_norm is app.normalise_name(name)');
select is((select is_available and is_active and position = 0 and push_until is null and push_price is null
             from public.menu_item where id = '11000000-0000-4000-8000-000000000001'), true,
  'defaults: available, active, position 0, no push');
select is(pg_temp.err(format($$insert into public.menu_item (tenant_id, name, category, course_default, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', %L, 'Secondi', 'secondi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$, repeat('x', 81))),
  '23514 new row for relation "menu_item" violates check constraint "menu_item_name_check"', 'name of 81 characters is refused');
select is(pg_temp.err($$insert into public.menu_item (tenant_id, name, category, course_default, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', '   ', 'Secondi', 'secondi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "menu_item" violates check constraint "menu_item_name_check"', 'a blank name is refused');
select is(pg_temp.err($$insert into public.menu_item (tenant_id, name, category, course_default, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 'Acqua (demo)', '', 'bevande', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "menu_item" violates check constraint "menu_item_category_check"', 'an empty category is refused');
select is(pg_temp.err($$insert into public.menu_item (tenant_id, name, category, course_default, position, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', 10000, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "menu_item" violates check constraint "menu_item_position_check"', 'position 10000 is refused');
select is(pg_temp.err($$insert into public.menu_item (tenant_id, name, category, course_default, position, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', -1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "menu_item" violates check constraint "menu_item_position_check"', 'position -1 is refused');
select is(pg_temp.err($$insert into public.menu_item (tenant_id, name, category, course_default, push_price, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', 12, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "menu_item" violates check constraint "menu_item_push_ck"', 'push_price without push_until is refused');
select is(pg_temp.err($$insert into public.menu_item (tenant_id, name, category, course_default, push_until, push_price, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', now() + interval '1 hour', 12, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  'ok', 'push_until with push_price is accepted');
select is(pg_temp.err($$insert into public.menu_item (tenant_id, name, category, course_default, recipe_key, created_by, updated_by)
  values ('22222222-2222-4222-8222-222222222222', 'Zuppa (demo)', 'Primi', 'primi', 'ec000000-0000-4000-8000-0000000000e2', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b')$$),
  '23503 insert or update on table "menu_item" violates foreign key constraint "menu_item_recipe_key_fkey"',
  'tenant B cannot map tenant A''s recipe key (composite foreign key)');

-- uniqueness: active names and active recipe keys
select is(pg_temp.err($$insert into public.menu_item (tenant_id, name, category, course_default, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', ' SPEZZATINO  con polenta (demo) ', 'Secondi', 'secondi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23505 duplicate key value violates unique constraint "menu_item_name_uq"', 'two active items with the same normalised name are refused');
select is(pg_temp.err($$insert into public.menu_item (tenant_id, name, category, course_default, is_active, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', false, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  'ok', 'an inactive duplicate name is accepted');
select is(pg_temp.err($$insert into public.menu_item (tenant_id, name, category, course_default, created_by, updated_by)
  values ('22222222-2222-4222-8222-222222222222', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b')$$),
  'ok', 'the same name in another tenant is accepted');
select is(pg_temp.err($$insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, created_by, updated_by)
  values ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Piatto uno (demo)', 'Secondi', 'secondi',
          'ec000000-0000-4000-8000-0000000000e2', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  'ok', 'a mapped item is accepted');
select is(pg_temp.err($$insert into public.menu_item (tenant_id, name, category, course_default, recipe_key, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 'Piatto due (demo)', 'Secondi', 'secondi',
          'ec000000-0000-4000-8000-0000000000e2', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23505 duplicate key value violates unique constraint "menu_item_recipe_uq"', 'two active items on one recipe key are refused');
select is(pg_temp.err($$insert into public.menu_item (tenant_id, name, category, course_default, recipe_key, is_active, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 'Piatto tre (demo)', 'Secondi', 'secondi',
          'ec000000-0000-4000-8000-0000000000e2', false, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  'ok', 'an inactive item on the same recipe key is accepted');
select is(pg_temp.err($$insert into public.menu_item (tenant_id, name, category, course_default, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 'Senza ricetta uno (demo)', 'Bevande', 'bevande', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
         ('11111111-1111-4111-8111-111111111111', 'Senza ricetta due (demo)', 'Bevande', 'bevande', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  'ok', 'several unmapped items (recipe_key null) are accepted');

-- guard
select is(pg_temp.err($$update public.menu_item set created_by = 'f1000000-0000-4000-8000-00000000000f' where id = '11000000-0000-4000-8000-000000000001'$$),
  'P0001 menu_item_immutable', 'created_by never changes');
select is(pg_temp.err($$update public.menu_item set tenant_id = '22222222-2222-4222-8222-222222222222' where id = '11000000-0000-4000-8000-000000000001'$$),
  'P0001 menu_item_immutable', 'tenant_id never changes');
select hasnt_column('public', 'menu_item', 'price', 'there is no price column on menu_item (the price lives in the history)');
select is(pg_temp.err($$update public.menu_item set name = 'Spezzatino (demo)', is_available = false where id = '11000000-0000-4000-8000-000000000001'$$),
  'ok', 'name and availability can change');

-- ----------------------------------------------------------------------------------------------------------------
-- menu_item_price
select is(pg_temp.err($$insert into public.menu_item_price (id, tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  values ('12000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 14, 10,
          '2026-10-01T08:00Z', 'a1000000-0000-4000-8000-00000000000a')$$), 'ok', 'a price row is accepted');
select is(pg_temp.err($$insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, created_by)
  values ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', -0.01, 10, 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "menu_item_price" violates check constraint "menu_item_price_price_check"', 'price -0,01 is refused');
select is(pg_temp.err($$insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, created_by)
  values ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 10000.01, 10, 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "menu_item_price" violates check constraint "menu_item_price_price_check"', 'price 10 000,01 is refused');
select is(pg_temp.err($$insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  values ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 0, 0, '2026-10-02T08:00Z', 'a1000000-0000-4000-8000-00000000000a'),
         ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 10000, 22, '2026-10-03T08:00Z', 'a1000000-0000-4000-8000-00000000000a')$$),
  'ok', 'the bounds 0 and 10 000 are accepted, as are VAT rates 0 and 22');
select is(pg_temp.err($$insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, created_by)
  values ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 14, 12, 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "menu_item_price" violates check constraint "menu_item_price_vat_rate_check"', 'VAT 12 is refused');
select is(pg_temp.err($$insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, created_by)
  values ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000999', 14, 10, 'a1000000-0000-4000-8000-00000000000a')$$),
  '23503 insert or update on table "menu_item_price" violates foreign key constraint "menu_item_price_item_fkey"', 'a price needs an item of the same tenant');
select is(pg_temp.err($$insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, created_by)
  values ('22222222-2222-4222-8222-222222222222', '11000000-0000-4000-8000-000000000001', 14, 10, 'b1000000-0000-4000-8000-00000000000b')$$),
  '23503 insert or update on table "menu_item_price" violates foreign key constraint "menu_item_price_item_fkey"', 'and not an item of another tenant');
select is(pg_temp.err($$insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  values ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 15, 10, '2026-10-01T08:00Z', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23505 duplicate key value violates unique constraint "menu_item_price_valid_uq"', 'two prices of one item cannot start at the same instant');
select is(pg_temp.err($$update public.menu_item_price set price = 1$$), 'P0001 append_only', 'menu_item_price UPDATE is refused');
select is(pg_temp.err($$delete from public.menu_item_price$$), 'P0001 append_only', 'menu_item_price DELETE is refused');
select is(pg_temp.err($$truncate public.menu_item_price$$), 'P0001 append_only', 'menu_item_price TRUNCATE is refused');

-- ----------------------------------------------------------------------------------------------------------------
-- dining_table
select is(pg_temp.err($$insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  values ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1,
          'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$), 'ok', 'a table is accepted');
select is((select name_norm from public.dining_table where id = '13000000-0000-4000-8000-000000000001'), 'tavolo 1 (demo)', 'dining_table.name_norm is derived');
select is(pg_temp.err(format($$insert into public.dining_table (tenant_id, name, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', %L, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$, repeat('x', 41))),
  '23514 new row for relation "dining_table" violates check constraint "dining_table_name_check"', 'a table name of 41 characters is refused');
select is(pg_temp.err($$insert into public.dining_table (tenant_id, name, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', ' TAVOLO 1 (demo)', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23505 duplicate key value violates unique constraint "dining_table_name_uq"', 'two active tables with one name are refused');
select is(pg_temp.err($$insert into public.dining_table (tenant_id, name, is_active, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', false, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  'ok', 'an inactive table may repeat the name');
select is(pg_temp.err($$insert into public.dining_table (tenant_id, name, position, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 'Tavolo 9 (demo)', 10000, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "dining_table" violates check constraint "dining_table_position_check"', 'table position 10000 is refused');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 2,
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo 1 (demo)', 1,
   'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
select is(pg_temp.err($$update public.dining_table set created_by = 'f1000000-0000-4000-8000-00000000000f' where id = '13000000-0000-4000-8000-000000000001'$$),
  'P0001 dining_table_immutable', 'dining_table.created_by never changes');
select is(pg_temp.err($$update public.dining_table set name = 'Tavolo Uno (demo)' where id = '13000000-0000-4000-8000-000000000001'$$), 'ok', 'a table can be renamed');

-- ----------------------------------------------------------------------------------------------------------------
-- sale_settings
select is(pg_temp.err($$insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 0, 10, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "sale_settings" violates check constraint "sale_settings_coperto_amount_check"', 'coperto 0 is refused');
select is(pg_temp.err($$insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 100.01, 10, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "sale_settings" violates check constraint "sale_settings_coperto_amount_check"', 'coperto 100,01 is refused');
select is(pg_temp.err($$insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 1.5, 12, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "sale_settings" violates check constraint "sale_settings_coperto_vat_rate_check"', 'coperto VAT 12 is refused');
select is(pg_temp.err($$insert into public.sale_settings (tenant_id, coperto_amount, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 1.5, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "sale_settings" violates check constraint "sale_settings_pair_ck"', 'a coperto amount without a VAT rate is refused');
select is(pg_temp.err($$insert into public.sale_settings (tenant_id, coperto_vat_rate, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 10, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "sale_settings" violates check constraint "sale_settings_pair_ck"', 'and a VAT rate without an amount');
select is(pg_temp.err($$insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 1.5, 10, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
         ('22222222-2222-4222-8222-222222222222', 100, 22, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b')$$),
  'ok', 'amounts 1,50 and 100 are accepted (one row per tenant)');
select is(pg_temp.err($$insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 2, 10, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23505 duplicate key value violates unique constraint "sale_settings_tenant_uq"', 'a second settings row for a tenant is refused');

-- ----------------------------------------------------------------------------------------------------------------
-- table_session
select is(pg_temp.err($$insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date,
                                                         coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001',
          'Tavolo 1 (demo)', 4, 'd1000000-0000-4000-8000-00000000000d', '2026-10-24', 1.5, 10,
          'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d')$$), 'ok', 'an open session is accepted');
select is((select coperto_total from public.table_session where id = '14000000-0000-4000-8000-000000000001'), 6.00::numeric,
  'coperto_total is 4 x 1,50 = 6,00');
select is(pg_temp.err($$insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date,
                                                         created_by, updated_by)
  values ('14000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002',
          'Tavolo 2 (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '2026-10-24',
          'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d')$$), 'ok', 'a session without coperto is accepted');
select is((select coperto_total is null from public.table_session where id = '14000000-0000-4000-8000-000000000002'), true,
  'coperto_total is null when no coperto is set');
select is(pg_temp.err($$insert into public.table_session (tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 2,
          'd1000000-0000-4000-8000-00000000000d', '2026-10-24', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d')$$),
  '23505 duplicate key value violates unique constraint "table_session_open_uq"', 'two open sessions of one table are refused');
select is(pg_temp.err($$insert into public.table_session (tenant_id, dining_table_id, table_name, covers, opened_by, business_date, closed_at, closed_by, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 2,
          'd1000000-0000-4000-8000-00000000000d', '2026-10-23', now(), 'd1000000-0000-4000-8000-00000000000d',
          'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
         ('11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 3,
          'd1000000-0000-4000-8000-00000000000d', '2026-10-22', now(), 'd1000000-0000-4000-8000-00000000000d',
          'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d')$$),
  'ok', 'closed sessions of a table with an open one are accepted (any number)');
select is(pg_temp.err($$insert into public.table_session (tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 0,
          'd1000000-0000-4000-8000-00000000000d', '2026-10-24', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d')$$),
  '23514 new row for relation "table_session" violates check constraint "table_session_covers_check"', 'covers 0 is refused');
select is(pg_temp.err($$insert into public.table_session (tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 100,
          'd1000000-0000-4000-8000-00000000000d', '2026-10-24', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d')$$),
  '23514 new row for relation "table_session" violates check constraint "table_session_covers_check"', 'covers 100 is refused');
select is(pg_temp.err($$insert into public.table_session (tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', '23000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 2,
          'd1000000-0000-4000-8000-00000000000d', '2026-10-24', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d')$$),
  '23503 insert or update on table "table_session" violates foreign key constraint "table_session_table_fkey"', 'a session needs a table of the same tenant');
select is(pg_temp.err($$insert into public.table_session (tenant_id, dining_table_id, table_name, covers, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 2,
          'd1000000-0000-4000-8000-00000000000d', '2026-10-24', 1.5, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d')$$),
  '23514 new row for relation "table_session" violates check constraint "table_session_coperto_ck"', 'a frozen coperto amount without its VAT rate is refused');

-- guard: opening facts never change; covers and the bill flag do
select is(pg_temp.err($$update public.table_session set opened_by = 'f1000000-0000-4000-8000-00000000000f' where id = '14000000-0000-4000-8000-000000000001'$$),
  'P0001 table_session_immutable', 'opened_by never changes');
select is(pg_temp.err($$update public.table_session set table_name = 'Altro (demo)' where id = '14000000-0000-4000-8000-000000000001'$$),
  'P0001 table_session_immutable', 'table_name never changes');
select is(pg_temp.err($$update public.table_session set coperto_amount = 2 where id = '14000000-0000-4000-8000-000000000001'$$),
  'P0001 table_session_immutable', 'coperto_amount never changes');
select is(pg_temp.err($$update public.table_session set business_date = '2026-10-25' where id = '14000000-0000-4000-8000-000000000001'$$),
  'P0001 table_session_immutable', 'business_date never changes');
select is(pg_temp.err($$update public.table_session set dining_table_id = '13000000-0000-4000-8000-000000000002' where id = '14000000-0000-4000-8000-000000000001'$$),
  'P0001 table_session_immutable', 'the table never changes');
select is(pg_temp.err($$update public.table_session set closed_at = now(), closed_by = 'd1000000-0000-4000-8000-00000000000d' where id = '14000000-0000-4000-8000-000000000001'$$),
  'P0001 table_session_close_incomplete', 'closing without receipt type, payment, total and business date is refused (M21 replaced the guard)');
select is(pg_temp.err($$update public.table_session set covers = 5 where id = '14000000-0000-4000-8000-000000000001'$$), 'ok', 'covers change is accepted');
select is((select coperto_total from public.table_session where id = '14000000-0000-4000-8000-000000000001'), 7.50::numeric,
  'coperto_total follows the covers change from the frozen amount (T1)');
select is(pg_temp.err($$update public.table_session set bill_requested_at = now(), bill_requested_by = 'd1000000-0000-4000-8000-00000000000d'
                         where id = '14000000-0000-4000-8000-000000000001'$$), 'ok', 'the bill flag can be set');
select is(pg_temp.err($$update public.table_session set covers = 3 where tenant_id = '11111111-1111-4111-8111-111111111111' and closed_at is not null$$),
  'P0001 table_session_closed', 'a closed session cannot change');
select is(pg_temp.err($$delete from public.table_session$$), 'P0001 append_only', 'table_session DELETE is refused');
select is(pg_temp.err($$delete from public.menu_item$$), 'P0001 append_only', 'menu_item DELETE is refused');
select is(pg_temp.err($$delete from public.dining_table$$), 'P0001 append_only', 'dining_table DELETE is refused');
select is(pg_temp.err($$delete from public.sale_settings$$), 'P0001 append_only', 'sale_settings DELETE is refused');
-- M18 (on purpose): order_line references table_session, so PostgreSQL refuses the TRUNCATE itself (0A000) before the
-- trigger would; the trigger stays and is checked directly.
select is(pg_temp.err($$truncate public.table_session$$), '0A000 cannot truncate a table referenced in a foreign key constraint', 'table_session TRUNCATE is refused (by the foreign key of order_line since M18)');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.table_session'::regclass and tgname = 'table_session_no_truncate' and not tgisinternal), 1, 'the table_session TRUNCATE trigger is still there');
select is(pg_temp.err($$truncate public.sale_settings$$), 'P0001 append_only', 'sale_settings TRUNCATE is refused');

-- ----------------------------------------------------------------------------------------------------------------
-- RLS: owner and admin read their tenant's rows; chef and waiter read none; tenant B reads none of A's
create temp table probe (who text, tbl text, n int);
grant all on probe to authenticated;
create function pg_temp.count_as(p_who text, p_auth uuid, p_tenant uuid, p_role text) returns void language plpgsql as $$
declare t text;
begin
  perform pg_temp.act_as(p_auth, p_tenant, p_role);
  set local role authenticated;
  foreach t in array array['menu_item', 'menu_item_price', 'dining_table', 'table_session', 'sale_settings'] loop
    execute format('insert into pg_temp.probe select %L, %L, count(*)::int from public.%I', p_who, t, t);
  end loop;
  reset role;
end
$$;
select pg_temp.count_as('owner', 'a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select pg_temp.count_as('admin', 'f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select pg_temp.count_as('chef', 'c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select pg_temp.count_as('waiter', 'd0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select pg_temp.count_as('ownerB', 'b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select count(*)::int from probe where who = 'owner' and n > 0), 5, 'owner A reads rows of all five tables');
select is((select count(*)::int from probe where who = 'admin' and n > 0), 5, 'admin A reads rows of all five tables');
select is((select sum(n)::int from probe where who = 'chef'), 0, 'chef A reads no row of any of the five');
select is((select sum(n)::int from probe where who = 'waiter'), 0, 'waiter A reads no row of any of the five');
select is((select n from probe where who = 'ownerB' and tbl = 'menu_item'), 1, 'owner B reads only its own menu item');
select is((select n from probe where who = 'ownerB' and tbl = 'table_session'), 0, 'owner B reads none of A''s sessions');
select is((select n from probe where who = 'ownerB' and tbl = 'dining_table'), 1, 'owner B reads only its own table');

-- privileges
select is((select count(*)::int from unnest(array['authenticated', 'anon', 'service_role']) r,
                  unnest(array['menu_item', 'menu_item_price', 'dining_table', 'table_session', 'sale_settings']) t,
                  unnest(array['insert', 'update', 'delete', 'truncate']) p
            where has_table_privilege(r, format('public.%I', t), p)), 0,
  'no API role can insert, update, delete or truncate any of the five tables');
select is((select count(*)::int from unnest(array['menu_item', 'menu_item_price', 'dining_table', 'table_session', 'sale_settings']) t
            where has_table_privilege('service_role', format('public.%I', t), 'select')
              and has_table_privilege('authenticated', format('public.%I', t), 'select')), 5,
  'service_role and authenticated can select all five (lesson 2: pinned)');
select is((select count(*)::int from unnest(array['menu_item', 'menu_item_price', 'dining_table', 'table_session', 'sale_settings']) t
            where has_table_privilege('anon', format('public.%I', t), 'select')), 0, 'anon reads none');

-- ----------------------------------------------------------------------------------------------------------------
-- Audit checks: every value of 20261030100000's two lists is still accepted, plus M17's.
create temp table old_entities (v text);
insert into old_entities values ('invoice'), ('ingredient'), ('recipe'), ('tenant'), ('payable'), ('app_user'),
  ('venue_device'), ('device_enrolment'), ('count_session'), ('staff_meal_rule'), ('supplier'),
  ('menu_item'), ('dining_table'), ('table_session'), ('sale_settings');
create temp table old_actions (v text);
insert into old_actions values ('invoice.approved'), ('invoice.rejected'), ('invoice.duplicate_cleared'),
  ('ingredient.allergens_confirmed'), ('recipe.deactivated'), ('recipe.reactivated'), ('tenant.settings_changed'),
  ('payable.status_changed'), ('payable.payment_reversed'), ('app_user.created'), ('app_user.updated'),
  ('app_user.deactivated'), ('app_user.reactivated'), ('app_user.pin_set'), ('device_enrolment.created'),
  ('venue_device.enrolled'), ('venue_device.revoked'), ('venue_device.unlocked'), ('count_session.closed'),
  ('count_session.cancelled'), ('ingredient.critical_changed'), ('staff_meal_rule.created'), ('staff_meal_rule.updated'),
  ('ingredient.rules_changed'), ('supplier.delivery_changed'), ('recipe.rules_changed'),
  ('menu_item.created'), ('menu_item.updated'), ('dining_table.created'), ('dining_table.updated'),
  ('table_session.covers_changed'), ('sale_settings.changed');
select is(pg_temp.err($$insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
  select '11111111-1111-4111-8111-111111111111', e.v, gen_random_uuid(), 'tenant.settings_changed', 'a1000000-0000-4000-8000-00000000000a'
    from old_entities e$$), 'ok', 'every earlier entity type and the four new ones are accepted');
select is(pg_temp.err($$insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
  select '11111111-1111-4111-8111-111111111111', 'tenant', gen_random_uuid(), a.v, 'a1000000-0000-4000-8000-00000000000a'
    from old_actions a$$), 'ok', 'every earlier action and the six new ones are accepted');
select is((select count(*)::int from public.audit_event), 47, 'one audit row per value was written (15 entity types, 32 actions)');
select is(pg_temp.err($$insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'not_an_entity', gen_random_uuid(), 'tenant.settings_changed', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "audit_event" violates check constraint "audit_event_entity_type_check"', 'an unknown entity type is still refused');
select is(pg_temp.err($$insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'tenant', gen_random_uuid(), 'bogus.action', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "audit_event" violates check constraint "audit_event_action_check"', 'and an unknown action');

select * from finish();
rollback;
