-- M7 step 4: recipe_key, recipe, recipe_line, recipe_price, v_recipe_current (M7 plan §3.2).
-- Covers AT1 (database half: versions are immutable), AT3 (yield check) and AT5 (price columns).
-- Fixture rows are inserted as the migration owner: no API role can write these tables.
-- Founder decision Q16 = V6 (2026-10-23): the chef reads sale_price and target_gp_pct (the menu
-- price and a percentage), never a cost or margin in euros.
begin;
create extension if not exists pgtap with schema extensions;
select plan(62);

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
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Supporto Demo');

create function pg_temp.uid(n int) returns uuid language sql immutable as $$
  select ('ee000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
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
create function pg_temp.n(rel text) returns int language plpgsql as $$
declare c int;
begin
  execute format('select count(*) from public.%I', rel) into c;
  return c;
end
$$;
grant execute on function pg_temp.uid(int), pg_temp.act_as(uuid, uuid, text), pg_temp.err(text),
  pg_temp.n(text) to authenticated;

-- Fake ingredients: 901 in tenant A, 902 in tenant B.
insert into public.ingredient (id, tenant_id, name, base_unit, allergens) values
  (pg_temp.uid(901), '11111111-1111-4111-8111-111111111111', 'Manzo muscolo (demo)', 'kg', '{}'),
  (pg_temp.uid(902), '22222222-2222-4222-8222-222222222222', 'Manzo B (demo)', 'kg', '{}');

-- Keys: 1 stew (batch), 2 polenta (sub), 3 plate.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  (pg_temp.uid(1), '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino (demo)',
   'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.uid(2), '11111111-1111-4111-8111-111111111111', 'sub', 1, 'polenta (demo)',
   'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.uid(3), '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta (demo)',
   'a1000000-0000-4000-8000-00000000000a');
-- Versions: 11 stew v1, 12 polenta v1, 13 plate v1.
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
                           portions_per_batch, shelf_life_hours, prep_time_min, min_portions,
                           target_portions, created_by) values
  (pg_temp.uid(11), '11111111-1111-4111-8111-111111111111', pg_temp.uid(1), 1, '2026-10-23 10:00:00+02',
   'Spezzatino (demo)', 6, 'kg', 30, 72, 180, 5, 30, 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.uid(12), '11111111-1111-4111-8111-111111111111', pg_temp.uid(2), 1, '2026-10-23 10:00:00+02',
   'Polenta (demo)', 1, 'kg', null, null, null, null, null, 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.uid(13), '11111111-1111-4111-8111-111111111111', pg_temp.uid(3), 1, '2026-10-23 10:00:00+02',
   'Spezzatino con polenta (demo)', null, null, null, null, null, null, null,
   'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (id, tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit,
                                created_by) values
  (pg_temp.uid(21), '11111111-1111-4111-8111-111111111111', pg_temp.uid(11), 1, pg_temp.uid(901), null,
   5, 'kg', 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.uid(22), '11111111-1111-4111-8111-111111111111', pg_temp.uid(13), 1, null, pg_temp.uid(2),
   0.2, 'kg', 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.uid(23), '11111111-1111-4111-8111-111111111111', pg_temp.uid(13), 2, null, pg_temp.uid(1),
   1, 'porz', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by)
  values (pg_temp.uid(13), '11111111-1111-4111-8111-111111111111', 12.00, 70,
          'a1000000-0000-4000-8000-00000000000a');

-- Immutability (AT1, database half): even the migration owner cannot rewrite or delete history.
select throws_ok(format($$ update public.recipe set name = 'Altro' where id = %L $$, pg_temp.uid(11)),
  'P0001', 'append_only', 'a version row cannot be updated (name)');
select throws_ok(format($$ update public.recipe set shelf_life_hours = 48 where id = %L $$, pg_temp.uid(11)),
  'P0001', 'append_only', 'nor its shelf life');
select throws_ok(format($$ update public.recipe_line set qty = 6 where id = %L $$, pg_temp.uid(21)),
  'P0001', 'append_only', 'a line cannot be updated');
select throws_ok(format($$ update public.recipe_price set sale_price = 13 where recipe_id = %L $$, pg_temp.uid(13)),
  'P0001', 'append_only', 'a price row cannot be updated');
select throws_ok($$ delete from public.recipe_key $$, 'P0001', 'append_only', 'recipe_key rows cannot be deleted');
select throws_ok($$ delete from public.recipe $$, 'P0001', 'append_only', 'recipe rows cannot be deleted');
select throws_ok($$ delete from public.recipe_line $$, 'P0001', 'append_only', 'recipe_line rows cannot be deleted');
select throws_ok($$ delete from public.recipe_price $$, 'P0001', 'append_only', 'recipe_price rows cannot be deleted');
select throws_ok($$ truncate public.recipe_key cascade $$, 'P0001', 'append_only', 'recipe_key cannot be truncated');
select throws_ok($$ truncate public.recipe cascade $$, 'P0001', 'append_only', 'recipe cannot be truncated');
select throws_ok($$ truncate public.recipe_line $$, 'P0001', 'append_only', 'recipe_line cannot be truncated');
select throws_ok($$ truncate public.recipe_price $$, 'P0001', 'append_only', 'recipe_price cannot be truncated');

-- recipe_key: identity fields never change; the version counter only grows by one.
select throws_ok(format($$ update public.recipe_key set type = 'sub' where id = %L $$, pg_temp.uid(1)),
  'P0001', 'recipe_key_immutable', 'the type of a recipe never changes');
select throws_ok(format($$ update public.recipe_key set created_by = 'c1000000-0000-4000-8000-00000000000c'
    where id = %L $$, pg_temp.uid(1)), 'P0001', 'recipe_key_immutable', 'nor its creator');
select throws_ok(format($$ update public.recipe_key set current_version = 3 where id = %L $$, pg_temp.uid(1)),
  'P0001', 'recipe_key_immutable', 'current_version 1 -> 3 is refused');
select throws_ok(format($$ update public.recipe_key set current_version = 0 where id = %L $$, pg_temp.uid(1)),
  'P0001', 'recipe_key_immutable', 'and so is going back');
select matches(pg_temp.err($$ insert into public.recipe_key (tenant_id, type, current_version, name_norm, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'sub', 0, 'zero', 'a1000000-0000-4000-8000-00000000000a') $$),
  '^23514 ', 'a version counter below 1 fails the check');
select lives_ok(format($$ update public.recipe_key set is_active = false where id = %L $$, pg_temp.uid(3)),
  'deactivating is allowed');
select lives_ok(format($$ update public.recipe_key set is_active = true where id = %L $$, pg_temp.uid(3)),
  'and so is reactivating');

-- Checks.
create function pg_temp.line(p_pos int, p_ing uuid, p_sub uuid, p_qty numeric, p_yield numeric default 1)
  returns text language sql as $$
  select pg_temp.err(format($f$ insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id,
      sub_recipe_key, qty, unit, yield_factor, created_by)
    values ('11111111-1111-4111-8111-111111111111', %L, %s, %L, %L, %s, 'kg', %s,
            'a1000000-0000-4000-8000-00000000000a') $f$,
    pg_temp.uid(11), p_pos, p_ing, p_sub, p_qty, p_yield)) $$;
grant execute on function pg_temp.line(int, uuid, uuid, numeric, numeric) to authenticated;
select matches(pg_temp.line(2, pg_temp.uid(901), pg_temp.uid(2), 1), '^23514 ', 'a line with both targets is refused');
select matches(pg_temp.line(2, null, null, 1), '^23514 ', 'a line with neither target is refused');
select matches(pg_temp.line(2, pg_temp.uid(901), null, 1, 0), '^23514 .*recipe_line_yield_factor_check', 'yield 0 is refused (AT3)');
select matches(pg_temp.line(2, pg_temp.uid(901), null, 1, -1), '^23514 .*recipe_line_yield_factor_check', 'yield -1 is refused');
select matches(pg_temp.line(2, pg_temp.uid(901), null, 1, 10.5), '^23514 .*recipe_line_yield_factor_check', 'yield 10.5 is refused');
select is(pg_temp.line(2, pg_temp.uid(901), null, 1, 10), 'ok', 'yield 10 is accepted');
select matches(pg_temp.line(3, pg_temp.uid(901), null, 0), '^23514 ', 'qty 0 is refused');
select matches(pg_temp.line(3, pg_temp.uid(902), null, 1), '^23503 ', 'a line to tenant B''s ingredient is refused');
select matches(pg_temp.line(3, null, pg_temp.uid(1000), 1), '^23503 ', 'a line to an unknown recipe key is refused');
select matches(pg_temp.line(1, pg_temp.uid(901), null, 1), '^23505 ', 'a position used twice in a version is refused');
select throws_ok(format($$ insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by)
    values (%L, '11111111-1111-4111-8111-111111111111', 1, 100, 'a1000000-0000-4000-8000-00000000000a') $$,
    pg_temp.uid(13)), '23514', null, 'target_gp_pct 100 is refused');

create function pg_temp.version(p_key uuid, p_version int, p_out numeric, p_unit text, p_portions int, p_shelf int,
    p_min int, p_target int) returns text language sql as $$
  select pg_temp.err(format($f$ insert into public.recipe (tenant_id, recipe_key, version, valid_from, name,
      output_qty, output_unit, portions_per_batch, shelf_life_hours, min_portions, target_portions, created_by)
    values ('11111111-1111-4111-8111-111111111111', %L, %s, now(), 'Prova (demo)', %L, %L, %L, %L, %L, %L,
            'a1000000-0000-4000-8000-00000000000a') $f$,
    p_key, p_version, p_out, p_unit, p_portions, p_shelf, p_min, p_target)) $$;
grant execute on function pg_temp.version(uuid, int, numeric, text, int, int, int, int) to authenticated;
select matches(pg_temp.version(pg_temp.uid(1), 2, 6, 'kg', 30, 72, 10, 5), '^23514 ', 'target_portions below min_portions is refused');
select matches(pg_temp.version(pg_temp.uid(1), 2, 6, null, 30, 72, 5, 30), '^23514 ', 'an output quantity without a unit is refused');
select matches(pg_temp.version(pg_temp.uid(1), 1, 6, 'kg', 30, 72, 5, 30), '^23505 ', 'the same version number twice is refused');
select is(pg_temp.version(pg_temp.uid(3), 2, 6, 'kg', null, null, null, null), 'P0001 field_not_for_type',
  'a plate version with an output quantity is refused');
select is(pg_temp.version(pg_temp.uid(1), 2, 6, 'kg', null, 72, 5, 30), 'P0001 field_not_for_type',
  'a batch version without portions is refused');
select is(pg_temp.version(pg_temp.uid(1), 2, 6, 'kg', 30, null, 5, 30), 'P0001 field_not_for_type',
  'a batch version without a shelf life is refused');
select is(pg_temp.version(pg_temp.uid(2), 2, 1, 'kg', 30, null, null, null), 'P0001 field_not_for_type',
  'a sub version with portions is refused');
select is(pg_temp.version(pg_temp.uid(2), 2, 1, 'kg', null, null, null, null), 'ok', 'a sub with an output is accepted');
select is(pg_temp.version(pg_temp.uid(1), 2, 6, 'kg', 30, 72, 5, 30), 'ok', 'a complete batch version is accepted');

select is(pg_temp.err(format($$ insert into public.recipe_price (recipe_id, tenant_id, sale_price, created_by)
    values (%L, '11111111-1111-4111-8111-111111111111', 1, 'a1000000-0000-4000-8000-00000000000a') $$,
    pg_temp.uid(11))), 'P0001 price_not_for_type', 'a price row for a batch version is refused');
select matches(pg_temp.err($$ insert into public.recipe_key (tenant_id, type, current_version, name_norm, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'sub', 1, 'polenta (demo)',
            'a1000000-0000-4000-8000-00000000000a') $$), '^23505 ', 'two keys with one normalised name are refused');
select is(pg_temp.err($$ insert into public.recipe_key (tenant_id, type, current_version, name_norm, created_by)
    values ('22222222-2222-4222-8222-222222222222', 'sub', 1, 'polenta (demo)',
            'b1000000-0000-4000-8000-00000000000b') $$), 'ok', 'another tenant may use the same name');
select matches(pg_temp.err($$ insert into public.recipe_key (tenant_id, type, current_version, name_norm, created_by)
    values ('22222222-2222-4222-8222-222222222222', 'sub', 1, 'altro (demo)',
            'a1000000-0000-4000-8000-00000000000a') $$), '^23503 ',
  'a creator from another tenant is refused (composite foreign key)');

-- Roles: the single place that lets the chef read the price rows is the recipe_price_select policy.
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(array[pg_temp.n('recipe_key'), pg_temp.n('recipe'), pg_temp.n('recipe_line'), pg_temp.n('recipe_price')],
  array[3, 5, 4, 1], 'owner A reads every table (the checks above added two versions and a line)');
select is((select count(*)::int from public.v_recipe_current), 3, 'owner A: v_recipe_current has one row per recipe');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(array[pg_temp.n('recipe_key'), pg_temp.n('recipe'), pg_temp.n('recipe_line'), pg_temp.n('recipe_price')],
  array[3, 5, 4, 1], 'admin A reads every table');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(array[pg_temp.n('recipe_key'), pg_temp.n('recipe'), pg_temp.n('recipe_line'), pg_temp.n('recipe_price')],
  array[3, 5, 4, 1], 'chef A reads every table, recipe_price included (Q16 = V6)');
select is((select count(*)::int from public.v_recipe_current), 3, 'chef A reads v_recipe_current');
select is((select sale_price::text || ' ' || target_gp_pct::text from public.recipe_price), '12.00 70.00',
  'the chef reads the menu price and the target GP percentage');
select is(pg_temp.err($$ update public.recipe_price set sale_price = 1 $$), '42501 permission denied for table recipe_price',
  'but cannot change the price (AT5, database level)');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(array[pg_temp.n('recipe_key'), pg_temp.n('recipe'), pg_temp.n('recipe_line'), pg_temp.n('recipe_price'),
                pg_temp.n('v_recipe_current')], array[0, 0, 0, 0, 0], 'waiter A reads no recipe data');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(array[pg_temp.n('recipe'), pg_temp.n('recipe_line'), pg_temp.n('recipe_price'), pg_temp.n('v_recipe_current')],
  array[0, 0, 0, 0], 'owner B reads none of tenant A''s recipes');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err($$ insert into public.recipe_key (tenant_id, type, current_version, name_norm, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'sub', 1, 'x', 'a1000000-0000-4000-8000-00000000000a') $$),
  '42501 permission denied for table recipe_key', 'even the owner cannot insert directly');
select is(pg_temp.err($$ update public.recipe set name = 'x' $$), '42501 permission denied for table recipe',
  'nor update');
select is(pg_temp.err($$ delete from public.recipe_line $$), '42501 permission denied for table recipe_line',
  'nor delete');

-- Q16 = V6: no column the chef can read carries a cost or a margin (no euro cost exists in M7).
create temporary table chef_visible_column (relation text, column_name text);
grant insert on chef_visible_column to authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
do $$
declare
  rel record;
  visible_rows bigint;
begin
  for rel in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
       and has_table_privilege('authenticated', c.oid, 'select')
  loop
    execute format('select count(*) from public.%I', rel.relname) into visible_rows;
    if visible_rows > 0 then
      insert into chef_visible_column
        select rel.relname, a.attname
          from pg_attribute a
         where a.attrelid = format('public.%I', rel.relname)::regclass
           and a.attnum > 0 and not a.attisdropped
           and has_column_privilege('authenticated', a.attrelid, a.attnum, 'select');
    end if;
  end loop;
end
$$;
reset role;
select is_empty(
  $$ select relation || '.' || column_name from chef_visible_column
      where column_name ~* '(cost|margin|euro|eur$)' $$,
  'no chef-readable column carries a cost or a margin');
select isnt_empty(
  $$ select 1 from chef_visible_column where relation = 'recipe_price' and column_name = 'sale_price' $$,
  'the chef can read sale_price (the test is not vacuous)');

-- Grants and view.
select ok(not has_table_privilege('anon', 'public.v_recipe_current', 'select'), 'anon cannot read the view');
select ok((select c.reloptions @> array['security_invoker=true'] from pg_class c
            where c.oid = 'public.v_recipe_current'::regclass), 'v_recipe_current is security_invoker');
select is_empty(
  $$ select a.attname::text from pg_attribute a
      where a.attrelid = 'public.v_recipe_current'::regclass and a.attnum > 0 and not a.attisdropped
        and a.attname ~* '(price|gp_pct|cost|margin)' $$,
  'the current-version view carries no price column');
select is(col_description('public.recipe_price'::regclass, (select attnum from pg_attribute
    where attrelid = 'public.recipe_price'::regclass and attname = 'sale_price')),
  'menu price per plate, VAT included (M7 Q3)', 'sale_price says it is VAT included');
select ok(not exists (select 1 from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name in ('recipe_key', 'recipe', 'recipe_line', 'recipe_price')
      and g.grantee in ('authenticated', 'service_role', 'anon') and g.privilege_type <> 'SELECT'),
  'no API role has a write privilege on a recipe table');

select * from finish();
rollback;
