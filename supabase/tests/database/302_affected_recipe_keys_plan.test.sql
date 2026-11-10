-- Plan independence of app.affected_recipe_keys. After earlier test files' rolled-back inserts have been vacuumed, pg_class
-- holds reltuples = 0 with relpages > 0 for recipe, recipe_line and recipe_key; every estimate becomes one row and the
-- recursive walk was planned as a nested loop over a work-table scan (over a million work-table scans on a ladder of 241 recipes, 15 s in CI).
-- Here the ladder of 062 (10 layers of 4 subs, a top plate, here 3000 plates, all reaching ingredient 901) is built, the stats
-- are set the way autovacuum leaves them (pg_class updates roll back with the test), and the walk must still finish
-- within 2 s and return exactly the 3041 keys.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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

-- What autovacuum leaves behind after a rolled-back load: no live tuples counted, pages still there.
update pg_class set reltuples = 0, relpages = 50
 where oid in ('public.recipe'::regclass, 'public.recipe_line'::regclass, 'public.recipe_key'::regclass);
select is((select count(*)::int from pg_class
            where oid in ('public.recipe'::regclass, 'public.recipe_line'::regclass, 'public.recipe_key'::regclass)
              and reltuples = 0 and relpages = 50), 3, 'the planner statistics of the three tables are those of a vacuumed, emptied table');

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

-- Another tenant whose recipe uses a key of tenant A (fake ids). The foreign keys forbid that, so the line is inserted as the
-- superuser with session_replication_role = replica (it switches off the foreign-key triggers, nothing else of the table).
insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'a0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare Demo B');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  (pg_temp.kid(9001), '22222222-2222-4222-8222-222222222222', 'plate', 1, 'piatto altro locale (demo)', 'a1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  (pg_temp.rid(9001), '22222222-2222-4222-8222-222222222222', pg_temp.kid(9001), 1, '1998-01-01T00:00Z', 'Piatto altro locale (demo)',
   'a1000000-0000-4000-8000-00000000000b');
set local session_replication_role = replica;
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, created_by) values
  ('22222222-2222-4222-8222-222222222222', pg_temp.rid(9001), 1, pg_temp.kid(111), 0.1, 'kg', 'a1000000-0000-4000-8000-00000000000b');
set local session_replication_role = origin;
set local statement_timeout = '2s';
create temporary table walked_b as select pg_temp.walk('1a000000-0000-4000-8000-000000000901') as keys;
reset statement_timeout;
select is((select keys from walked_b), (select keys from walked),
  'a line of another tenant that uses a key of tenant A does not change the result of tenant A (every level filters by tenant)');
set local statement_timeout = '2s';
select is(pg_temp.has('1a000000-0000-4000-8000-000000000901', pg_temp.kid(9001)), 'false', 'and the other tenant''s plate is not in it');
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
