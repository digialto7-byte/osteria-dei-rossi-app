-- Plan independence of app.affected_recipe_keys. After earlier test files' rolled-back inserts have been vacuumed, pg_class
-- holds reltuples = 0 with relpages > 0 for recipe, recipe_line and recipe_key; every estimate becomes one row and the
-- recursive walk was planned as a nested loop over a work-table scan (over a million work-table scans on a ladder of 241 recipes, 15 s in CI).
-- Here the ladder of 062 (10 layers of 4 subs, a top plate, here 3000 plates, all reaching ingredient 901) is built, the stats
-- are brought to the state autovacuum leaves (a rolled-back copy of the ladder, then ANALYZE), and the walk must still finish
-- within 2 s and return exactly the 3041 keys.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-000000000901', '11111111-1111-4111-8111-111111111111', 'Sale (demo)', 'kg');

-- The ladder. Key and version ids: layer i, sub j -> 100 + 10 i + j; top plate 100; extra plates 1000 + n.
create function pg_temp.kid(n int) returns uuid language sql immutable as $$
  select ('ec000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.rid(n int) returns uuid language sql immutable as $$
  select ('ed000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
set local statement_timeout = '120s';
create temporary table ladder as
  select 100 + 10 * i + j as n, i, j from generate_series(1, 10) i, generate_series(1, 4) j;
-- First the same ladder in a savepoint that is rolled back: its pages stay, its rows are dead. ANALYZE (allowed to the
-- tables' owner inside a transaction, unlike VACUUM or a pg_class update) then records reltuples = 0 with relpages > 0, which
-- is what autovacuum leaves after earlier test files' rolled-back loads. Then the ladder is built for real.
savepoint bloat;
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
  select pg_temp.kid(n), '11111111-1111-4111-8111-111111111111'::uuid, 'sub'::public.recipe_type, 1,
         'strato ' || i || '/' || j || ' (demo)', 'a1000000-0000-4000-8000-00000000000a'::uuid from ladder
  union all select pg_temp.kid(100), '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto diamante (demo)',
         'a1000000-0000-4000-8000-00000000000a'
  union all select pg_temp.kid(1000 + n), '11111111-1111-4111-8111-111111111111', 'plate', 1,
         'piatto extra ' || n || ' (demo)', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 3000) n;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, created_by)
  select pg_temp.rid(n), '11111111-1111-4111-8111-111111111111', pg_temp.kid(n), 1, '1998-01-01T00:00Z',
         'Strato ' || i || '/' || j || ' (demo)', 1, 'kg', 'a1000000-0000-4000-8000-00000000000a' from ladder;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
  select pg_temp.rid(100), '11111111-1111-4111-8111-111111111111'::uuid, pg_temp.kid(100), 1, '1998-01-01T00:00Z'::timestamptz,
         'Piatto diamante (demo)', 'a1000000-0000-4000-8000-00000000000a'::uuid
  union all select pg_temp.rid(1000 + n), '11111111-1111-4111-8111-111111111111', pg_temp.kid(1000 + n), 1,
         '1998-01-01T00:00Z', 'Piatto extra ' || n || ' (demo)', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 3000) n;
-- Every sub: 1 kg of ingredient 901 (position 1) and 0.1 kg of each sub of the next layer (positions 2 to 5).
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by)
  select '11111111-1111-4111-8111-111111111111', pg_temp.rid(n), 1, '1a000000-0000-4000-8000-000000000901', 1, 'kg',
         'a1000000-0000-4000-8000-00000000000a' from ladder;
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, created_by)
  select '11111111-1111-4111-8111-111111111111', pg_temp.rid(a.n), 1 + b.j, pg_temp.kid(100 + 10 * (a.i + 1) + b.j), 0.1,
         'kg', 'a1000000-0000-4000-8000-00000000000a'
    from ladder a join ladder b on b.i = a.i + 1;
-- The top plate: 0.1 kg of each top-layer sub. Extra plates: 0.1 kg of sub 111 and 0.05 kg of ingredient 901.
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, created_by)
  select '11111111-1111-4111-8111-111111111111', pg_temp.rid(100), j, pg_temp.kid(110 + j), 0.1, 'kg',
         'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 4) j;
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, ingredient_id, qty, unit, created_by)
  select '11111111-1111-4111-8111-111111111111'::uuid, pg_temp.rid(1000 + n), 1, pg_temp.kid(111), null::uuid, 0.1,
         'kg'::public.recipe_unit, 'a1000000-0000-4000-8000-00000000000a'::uuid from generate_series(1, 3000) n
  union all select '11111111-1111-4111-8111-111111111111', pg_temp.rid(1000 + n), 2, null,
         '1a000000-0000-4000-8000-000000000901', 0.05, 'kg', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 3000) n;
rollback to savepoint bloat;
analyze public.recipe, public.recipe_line, public.recipe_key;
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
  select pg_temp.kid(n), '11111111-1111-4111-8111-111111111111'::uuid, 'sub'::public.recipe_type, 1,
         'strato ' || i || '/' || j || ' (demo)', 'a1000000-0000-4000-8000-00000000000a'::uuid from ladder
  union all select pg_temp.kid(100), '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto diamante (demo)',
         'a1000000-0000-4000-8000-00000000000a'
  union all select pg_temp.kid(1000 + n), '11111111-1111-4111-8111-111111111111', 'plate', 1,
         'piatto extra ' || n || ' (demo)', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 3000) n;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, created_by)
  select pg_temp.rid(n), '11111111-1111-4111-8111-111111111111', pg_temp.kid(n), 1, '1998-01-01T00:00Z',
         'Strato ' || i || '/' || j || ' (demo)', 1, 'kg', 'a1000000-0000-4000-8000-00000000000a' from ladder;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
  select pg_temp.rid(100), '11111111-1111-4111-8111-111111111111'::uuid, pg_temp.kid(100), 1, '1998-01-01T00:00Z'::timestamptz,
         'Piatto diamante (demo)', 'a1000000-0000-4000-8000-00000000000a'::uuid
  union all select pg_temp.rid(1000 + n), '11111111-1111-4111-8111-111111111111', pg_temp.kid(1000 + n), 1,
         '1998-01-01T00:00Z', 'Piatto extra ' || n || ' (demo)', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 3000) n;
-- Every sub: 1 kg of ingredient 901 (position 1) and 0.1 kg of each sub of the next layer (positions 2 to 5).
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by)
  select '11111111-1111-4111-8111-111111111111', pg_temp.rid(n), 1, '1a000000-0000-4000-8000-000000000901', 1, 'kg',
         'a1000000-0000-4000-8000-00000000000a' from ladder;
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, created_by)
  select '11111111-1111-4111-8111-111111111111', pg_temp.rid(a.n), 1 + b.j, pg_temp.kid(100 + 10 * (a.i + 1) + b.j), 0.1,
         'kg', 'a1000000-0000-4000-8000-00000000000a'
    from ladder a join ladder b on b.i = a.i + 1;
-- The top plate: 0.1 kg of each top-layer sub. Extra plates: 0.1 kg of sub 111 and 0.05 kg of ingredient 901.
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, created_by)
  select '11111111-1111-4111-8111-111111111111', pg_temp.rid(100), j, pg_temp.kid(110 + j), 0.1, 'kg',
         'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 4) j;
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, ingredient_id, qty, unit, created_by)
  select '11111111-1111-4111-8111-111111111111'::uuid, pg_temp.rid(1000 + n), 1, pg_temp.kid(111), null::uuid, 0.1,
         'kg'::public.recipe_unit, 'a1000000-0000-4000-8000-00000000000a'::uuid from generate_series(1, 3000) n
  union all select '11111111-1111-4111-8111-111111111111', pg_temp.rid(1000 + n), 2, null,
         '1a000000-0000-4000-8000-000000000901', 0.05, 'kg', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 3000) n;

select is((select count(*)::int from public.recipe_key), 3041, 'the ladder is built: 40 subs, the top plate and 3000 plates');

select is((select count(*)::int from pg_class
            where oid in ('public.recipe'::regclass, 'public.recipe_line'::regclass, 'public.recipe_key'::regclass)
              and reltuples = 0 and relpages > 0), 3, 'the planner statistics of the three tables are those of a vacuumed, emptied table');

-- 'SQLSTATE message' on failure (57014 is the statement timeout), else the number of keys and the md5 of the sorted keys.
create function pg_temp.walk(p_ingredient uuid) returns text language plpgsql as $$
begin
  return (select count(*) || ' ' || md5(string_agg(k::text, ',' order by k)) from unnest(
    app.affected_recipe_keys('11111111-1111-4111-8111-111111111111', p_ingredient)) k);
exception when query_canceled or others then
  return sqlstate || ' ' || sqlerrm;
end
$$;
create function pg_temp.has(p_ingredient uuid, p_key uuid) returns text language plpgsql as $$
begin
  return (p_key = any(app.affected_recipe_keys('11111111-1111-4111-8111-111111111111', p_ingredient)))::text;
exception when query_canceled or others then
  return sqlstate || ' ' || sqlerrm;
end
$$;
set local statement_timeout = '2s';
create temporary table walked as select pg_temp.walk('1a000000-0000-4000-8000-000000000901') as keys;
reset statement_timeout;

select is((select keys from walked),
  (select count(*) || ' ' || md5(string_agg(pg_temp.kid(n)::text, ',' order by pg_temp.kid(n)))
     from (select 100 + 10 * i + j as n from generate_series(1, 10) i, generate_series(1, 4) j
           union all select 100 union all select 1000 + n from generate_series(1, 3000) n) e),
  'the walk from ingredient 901 returns the 40 subs, the top plate and the 3000 plates within 2 s');
select is((select cardinality(app.affected_recipe_keys('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-0000000000ff'))),
  0, 'an ingredient no recipe uses reaches nothing');

-- Edges across tenants. The foreign keys forbid every one of them, so the foreign keys of recipe and recipe_line are
-- dropped inside this test's transaction (the tables' owner may; it rolls back with the test, and on Supabase the tests
-- do not run as a superuser, so session_replication_role is not available). Each edge leads back
-- into tenant A at a record that is otherwise unreachable, so that a missing tenant filter shows as a wrong result
-- (a key that must not be in the walk is in it), not as a timeout:
--   L  a line of tenant B (recipe_id = A recipe 9101) that uses key 111, a key on the walk. Without the tenant filter
--      on the lines of a level, recipe 9101 is reached and key 9101 appears.
--   B  a line of tenant B (recipe_id = A recipe 9102) on ingredient 904, which no recipe of A uses. Without the tenant
--      filter on the first level, key 9102 appears in the walk of ingredient 904.
--   R  a recipe row of tenant B (id 9201) whose recipe_key is the A key 9201 at its current version, named by a line of
--      tenant A that uses key 111. Without the tenant filter on recipe, key 9201 appears.
--   K  an A recipe (9301) whose recipe_key is the key 9301 of tenant B, named by a line of A that uses key 111. Without
--      the tenant filter on recipe_key, key 9301 appears.
insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'a0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare Demo B');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-000000000904', '11111111-1111-4111-8111-111111111111', 'Origano (demo)', 'kg');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
  select pg_temp.kid(n), '11111111-1111-4111-8111-111111111111', 'sub', 1, 'altro ' || n || ' (demo)', 'a1000000-0000-4000-8000-00000000000a'
    from unnest(array[9101, 9102, 9201]) n;
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  (pg_temp.kid(9301), '22222222-2222-4222-8222-222222222222', 'sub', 1, 'altro 9301 (demo)', 'a1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, created_by)
  select pg_temp.rid(n), '11111111-1111-4111-8111-111111111111', pg_temp.kid(n), 1, '1998-01-01T00:00Z', 'Altro ' || n || ' (demo)',
         1, 'kg', 'a1000000-0000-4000-8000-00000000000a' from unnest(array[9101, 9102]) n;
do $$
declare c record;
begin
  for c in select conrelid::regclass as tbl, conname from pg_constraint
            where contype = 'f' and conrelid in ('public.recipe'::regclass, 'public.recipe_line'::regclass) loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end
$$;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, created_by) values
  (pg_temp.rid(9201), '22222222-2222-4222-8222-222222222222', pg_temp.kid(9201), 1, '1998-01-01T00:00Z', 'Altro 9201 (demo)', 1, 'kg',
   'a1000000-0000-4000-8000-00000000000b'),
  (pg_temp.rid(9301), '11111111-1111-4111-8111-111111111111', pg_temp.kid(9301), 1, '1998-01-01T00:00Z', 'Altro 9301 (demo)', 1, 'kg',
   'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, created_by) values
  ('22222222-2222-4222-8222-222222222222', pg_temp.rid(9101), 1, null, pg_temp.kid(111), 0.1, 'kg', 'a1000000-0000-4000-8000-00000000000b'),
  ('22222222-2222-4222-8222-222222222222', pg_temp.rid(9102), 1, '1a000000-0000-4000-8000-000000000904', null, 1, 'kg', 'a1000000-0000-4000-8000-00000000000b'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.rid(9201), 1, null, pg_temp.kid(111), 0.1, 'kg', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.rid(9301), 1, null, pg_temp.kid(111), 0.1, 'kg', 'a1000000-0000-4000-8000-00000000000a');
set local statement_timeout = '2s';
create temporary table walked_b as select pg_temp.walk('1a000000-0000-4000-8000-000000000901') as keys;
reset statement_timeout;
select is((select keys from walked_b),
  (select count(*) || ' ' || md5(string_agg(pg_temp.kid(n)::text, ',' order by pg_temp.kid(n)))
     from (select 100 + 10 * i + j as n from generate_series(1, 10) i, generate_series(1, 4) j
           union all select 100 union all select 1000 + n from generate_series(1, 3000) n) e),
  'edges across tenants do not change the walk of tenant A: still the 3041 keys, no more, no fewer');
set local statement_timeout = '2s';
select is(pg_temp.has('1a000000-0000-4000-8000-000000000901', pg_temp.kid(9101)), 'false',
  'a line of tenant B that uses a key on the walk does not reach the recipe it names in tenant A (the lines of a level filter by tenant)');
select is(pg_temp.has('1a000000-0000-4000-8000-000000000904', pg_temp.kid(9102)), 'false',
  'a line of tenant B on the ingredient does not reach the recipe it names in tenant A (the first level filters by tenant)');
select is(pg_temp.has('1a000000-0000-4000-8000-000000000901', pg_temp.kid(9201)), 'false',
  'a recipe row of tenant B whose key is a key of tenant A is not followed (recipe filters by tenant)');
select is(pg_temp.has('1a000000-0000-4000-8000-000000000901', pg_temp.kid(9301)), 'false',
  'a recipe of tenant A whose key belongs to tenant B is not returned (recipe_key filters by tenant)');
reset statement_timeout;

-- Depth limit. The CTE this walk replaces reached depth 14 (base depth 1; the recursive step ran while depth <= 13).
-- A chain of 16 recipes on ingredient 903: recipe 1 uses the ingredient, recipe i + 1 uses recipe i as a sub-recipe.
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-000000000903', '11111111-1111-4111-8111-111111111111', 'Salvia (demo)', 'kg');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
  select pg_temp.kid(7000 + n), '11111111-1111-4111-8111-111111111111', 'sub', 1, 'catena ' || n || ' (demo)', 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 16) n;
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, created_by)
  select pg_temp.rid(7000 + n), '11111111-1111-4111-8111-111111111111', pg_temp.kid(7000 + n), 1, '1998-01-01T00:00Z', 'Catena ' || n || ' (demo)',
         1, 'kg', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 16) n;
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, created_by)
  select '11111111-1111-4111-8111-111111111111'::uuid, pg_temp.rid(7001), 1::smallint, '1a000000-0000-4000-8000-000000000903'::uuid,
         null::uuid, 1::numeric, 'kg'::public.recipe_unit, 'a1000000-0000-4000-8000-00000000000a'::uuid
  union all select '11111111-1111-4111-8111-111111111111', pg_temp.rid(7000 + n + 1), 1, null, pg_temp.kid(7000 + n), 0.1, 'kg',
         'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 15) n;
set local statement_timeout = '2s';
select is(pg_temp.has('1a000000-0000-4000-8000-000000000903', pg_temp.kid(7014)), 'true', 'the recipe at depth 14 of a chain is reached');
select is(pg_temp.has('1a000000-0000-4000-8000-000000000903', pg_temp.kid(7015)), 'false', 'the recipe at depth 15 is not (the limit of the CTE)');
select is((select cardinality(app.affected_recipe_keys('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000903'))), 14,
  'and the chain of 16 returns exactly 14 keys');
reset statement_timeout;

-- A cycle (the tables do not forbid one, the procedures do): X uses Y and ingredient 902, Y uses X. Both are reached, at once.
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-000000000902', '11111111-1111-4111-8111-111111111111', 'Pepe (demo)', 'kg');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  (pg_temp.kid(5001), '11111111-1111-4111-8111-111111111111', 'sub', 1, 'ciclo x (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.kid(5002), '11111111-1111-4111-8111-111111111111', 'sub', 1, 'ciclo y (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, created_by) values
  (pg_temp.rid(5001), '11111111-1111-4111-8111-111111111111', pg_temp.kid(5001), 1, '1998-01-01T00:00Z', 'Ciclo X (demo)', 1, 'kg', 'a1000000-0000-4000-8000-00000000000a'),
  (pg_temp.rid(5002), '11111111-1111-4111-8111-111111111111', pg_temp.kid(5002), 1, '1998-01-01T00:00Z', 'Ciclo Y (demo)', 1, 'kg', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, created_by) values
  ('11111111-1111-4111-8111-111111111111', pg_temp.rid(5001), 1, '1a000000-0000-4000-8000-000000000902', null, 1, 'kg', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.rid(5001), 2, null, pg_temp.kid(5002), 0.1, 'kg', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', pg_temp.rid(5002), 1, null, pg_temp.kid(5001), 0.1, 'kg', 'a1000000-0000-4000-8000-00000000000a');
set local statement_timeout = '2s';
create temporary table walked_cycle as select pg_temp.walk('1a000000-0000-4000-8000-000000000902') as keys;
reset statement_timeout;
select is((select keys from walked_cycle),
  (select count(*) || ' ' || md5(string_agg(k::text, ',' order by k)) from (values (pg_temp.kid(5001)), (pg_temp.kid(5002))) v(k)),
  'a cycle of two sub-recipes, one using the ingredient, returns both keys and ends');
set local statement_timeout = '2s';
select is(pg_temp.has('1a000000-0000-4000-8000-000000000901', pg_temp.kid(5001)), 'false', 'and the cycle does not leak into the walk of another ingredient');
reset statement_timeout;

select * from finish();
rollback;
