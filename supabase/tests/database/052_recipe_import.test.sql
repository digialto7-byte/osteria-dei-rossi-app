-- M7 step 7: import_recipes (with dry run) and export_recipes (M7 plan §3.1.11). Covers AT4 at
-- database level (a round trip through the template shape is stable) and T1 (a dry run is the real
-- import rolled back, and still returns the real preview). Acts as admin A, the usual importer.
begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

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
-- 'ok', or 'SQLSTATE message | detail'.
create function pg_temp.run(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  det text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg || coalesce(' | ' || nullif(det, ''), '');
end
$$;
create temporary table res (label text primary key, j jsonb);
grant all on res to authenticated;
-- Calls a procedure and stores its result under a label.
create function pg_temp.save(p_label text, p_call text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  det text;
  out jsonb;
begin
  execute p_call into out;
  insert into res values (p_label, out);
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg || coalesce(' | ' || nullif(det, ''), '');
end
$$;
create function pg_temp.key(p_label text) returns uuid language sql as $$
  select (j ->> 'key')::uuid from res where label = p_label $$;
create function pg_temp.rid(p_label text) returns uuid language sql as $$
  select (j ->> 'recipeId')::uuid from res where label = p_label $$;
create function pg_temp.q(v text) returns text language sql as $$ select quote_literal(v) $$;
create function pg_temp.mk(p_label text, p_type text, p_content jsonb) returns text language sql as $$
  select pg_temp.save(p_label, format('select public.create_recipe(%L, %L)', p_type, p_content)) $$;
create function pg_temp.mkv(p_label text, p_key uuid, p_base int, p_content jsonb) returns text language sql as $$
  select pg_temp.save(p_label, format('select public.create_recipe_version(%L, %s, %L)', p_key, p_base, p_content)) $$;
create function pg_temp.mkerr(p_type text, p_content jsonb) returns text language sql as $$
  select pg_temp.run(format('select public.create_recipe(%L, %L)', p_type, p_content)) $$;
create function pg_temp.mkverr(p_key uuid, p_base int, p_content jsonb) returns text language sql as $$
  select pg_temp.run(format('select public.create_recipe_version(%L, %s, %L)', p_key, p_base, p_content)) $$;
-- Content builders (camelCase, as the API sends them).
create function pg_temp.li(p_ing int, p_qty numeric, p_unit text default 'kg', p_yield numeric default null)
  returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('ingredientId', pg_temp.uid(p_ing), 'qty', p_qty,
    'unit', p_unit, 'yieldFactor', p_yield)) $$;
create function pg_temp.lr(p_key uuid, p_qty numeric, p_unit text default 'kg') returns jsonb language sql as $$
  select jsonb_build_object('recipeKey', p_key, 'qty', p_qty, 'unit', p_unit) $$;
create function pg_temp.stew(p_shelf int default 72, p_name text default 'Spezzatino (demo)',
    p_yield numeric default null) returns jsonb language sql as $$
  select jsonb_build_object('name', p_name, 'outputQty', 6, 'outputUnit', 'kg', 'portionsPerBatch', 30,
    'shelfLifeHours', p_shelf, 'prepTimeMin', 180, 'minPortions', 5, 'targetPortions', 30,
    'lines', jsonb_build_array(pg_temp.li(901, 5, 'kg', p_yield))) $$;
create function pg_temp.sub(p_name text, p_lines jsonb, p_unit text default 'kg') returns jsonb language sql as $$
  select jsonb_build_object('name', p_name, 'outputQty', 1, 'outputUnit', p_unit, 'lines', p_lines) $$;
create function pg_temp.plate(p_name text, p_lines jsonb, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('name', p_name, 'lines', p_lines) || p_extra $$;
create function pg_temp.audits(p_action text) returns int language sql as $$
  select count(*)::int from public.audit_event where action = p_action $$;
grant execute on function pg_temp.uid(int), pg_temp.act_as(uuid, uuid, text), pg_temp.run(text),
  pg_temp.save(text, text), pg_temp.key(text), pg_temp.rid(text), pg_temp.q(text),
  pg_temp.mk(text, text, jsonb), pg_temp.mkv(text, uuid, int, jsonb), pg_temp.mkerr(text, jsonb),
  pg_temp.mkverr(uuid, int, jsonb), pg_temp.li(int, numeric, text, numeric), pg_temp.lr(uuid, numeric, text),
  pg_temp.stew(int, text, numeric), pg_temp.sub(text, jsonb, text), pg_temp.plate(text, jsonb, jsonb),
  pg_temp.audits(text) to authenticated;

-- Ingredients (fake): 901 beef kg, 902 corn flour kg, 903 bread pz, 904 inactive kg; 906 in tenant B.
insert into public.ingredient (id, tenant_id, name, base_unit, allergens, is_active) values
  (pg_temp.uid(901), '11111111-1111-4111-8111-111111111111', 'Manzo muscolo (demo)', 'kg', null, true),
  (pg_temp.uid(902), '11111111-1111-4111-8111-111111111111', 'Farina di mais (demo)', 'kg', null, true),
  (pg_temp.uid(903), '11111111-1111-4111-8111-111111111111', 'Pane (demo)', 'pz', null, true),
  (pg_temp.uid(904), '11111111-1111-4111-8111-111111111111', 'Vecchio (demo)', 'kg', null, false),
  (pg_temp.uid(906), '22222222-2222-4222-8222-222222222222', 'Manzo muscolo (demo)', 'kg', null, true);

-- The template rows of the fixture (plan §3.9): the plate comes first, before the recipes it uses.
create function pg_temp.stew_row(p_shelf int default 72) returns jsonb language sql as $$
  select jsonb_build_object('name', 'Spezzatino (demo)', 'type', 'batch', 'outputQty', 6, 'outputUnit', 'kg',
    'portionsPerBatch', 30, 'shelfLifeHours', p_shelf, 'prepTimeMin', 180, 'minPortions', 5, 'targetPortions', 30,
    'lines', jsonb_build_array(jsonb_build_object('ingredient', 'Manzo muscolo (demo)', 'qty', 5, 'unit', 'kg',
      'yieldFactor', 1))) $$;
create function pg_temp.polenta_row() returns jsonb language sql as $$
  select jsonb_build_object('name', 'Polenta (demo)', 'type', 'sub', 'outputQty', 1, 'outputUnit', 'kg',
    'lines', jsonb_build_array(jsonb_build_object('ingredient', 'Farina di mais (demo)', 'qty', 0.3, 'unit', 'kg',
      'yieldFactor', 1))) $$;
create function pg_temp.plate_row(p_extra jsonb default '{"salePrice": 12, "targetGpPct": 70}', p_bread numeric default 1)
  returns jsonb language sql as $$
  select jsonb_build_object('name', 'Spezzatino con polenta (demo)', 'type', 'plate', 'lines', jsonb_build_array(
    jsonb_build_object('recipe', 'Spezzatino (demo)', 'qty', 1, 'unit', 'porz', 'yieldFactor', 1),
    jsonb_build_object('recipe', 'Polenta (demo)', 'qty', 0.2, 'unit', 'kg', 'yieldFactor', 1),
    jsonb_build_object('ingredient', 'Pane (demo)', 'qty', p_bread, 'unit', 'pz', 'yieldFactor', 1))) || p_extra $$;
create function pg_temp.file(p_extra jsonb default '{"salePrice": 12, "targetGpPct": 70}') returns jsonb language sql as $$
  select jsonb_build_array(pg_temp.plate_row(p_extra), pg_temp.polenta_row(), pg_temp.stew_row()) $$;
create function pg_temp.imp(p_label text, p_rows jsonb, p_dry boolean default false) returns text language sql as $$
  select pg_temp.save(p_label, format('select public.import_recipes(%L, %L)', p_rows, p_dry)) $$;
create function pg_temp.imperr(p_rows jsonb, p_dry boolean default false) returns text language sql as $$
  select pg_temp.run(format('select public.import_recipes(%L, %L)', p_rows, p_dry)) $$;
create function pg_temp.counts() returns text language sql as $$
  select (select count(*) from public.recipe_key) || '/' || (select count(*) from public.recipe) || '/'
      || (select count(*) from public.recipe_line) || '/' || (select count(*) from public.recipe_price) $$;
create function pg_temp.summary(p_label text) returns text language sql as $$
  select (j ->> 'created') || '/' || (j ->> 'newVersions') || '/' || (j ->> 'unchanged') from res where label = p_label $$;
grant execute on function pg_temp.stew_row(int), pg_temp.polenta_row(), pg_temp.plate_row(jsonb, numeric),
  pg_temp.file(jsonb), pg_temp.imp(text, jsonb, boolean), pg_temp.imperr(jsonb, boolean),
  pg_temp.counts(), pg_temp.summary(text) to authenticated;

select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']
                           and has_function_privilege('authenticated', p.oid, 'execute')
                           and not has_function_privilege('anon', p.oid, 'execute')
                           and not has_function_privilege('service_role', p.oid, 'execute')
                           and not has_function_privilege('public', p.oid, 'execute'))
             from pg_proc p where p.oid in ('public.import_recipes(jsonb, boolean)'::regprocedure,
                                            'public.export_recipes()'::regprocedure)),
  'both are SECURITY DEFINER with an empty search_path and executable by authenticated only');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'app' and p.proname in ('import_recipes_apply', 'recipe_lines_json', 'recipe_import_fail', 'recipe_import_tag')
                         and (has_function_privilege('authenticated', p.oid, 'execute')
                              or has_function_privilege('anon', p.oid, 'execute')
                              or has_function_privilege('service_role', p.oid, 'execute'))),
  'the import helpers are executable by no API role');

set local role authenticated;
-- Roles first.
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select matches(pg_temp.imperr(pg_temp.file()), '^42501 ', 'a chef cannot import');
select matches(pg_temp.run('select public.export_recipes()'), '^42501 ', 'a chef cannot export');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select matches(pg_temp.imperr(pg_temp.file()), '^42501 ', 'a waiter cannot import');
select matches(pg_temp.run('select public.export_recipes()'), '^42501 ', 'a waiter cannot export');
select set_config('request.jwt.claims', '', true);
select matches(pg_temp.imperr(pg_temp.file()), '^42501 ', 'no claims, no import');
select is(pg_temp.counts(), '0/0/0/0', 'nothing was written by the refused calls');

-- AT4: the fixture round trip.
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.imp('first', pg_temp.file()), 'ok', 'the admin imports the fixture');
select is(pg_temp.summary('first'), '3/0/0', 'created 3 (the plate before the recipes it uses)');
select is((select j ->> 'dryRun' from res where label = 'first'), 'false', 'not a dry run');
select is((select string_agg((e ->> 'action') || ':' || (e ->> 'version'), ',' order by (e ->> 'row')::int)
             from res, jsonb_array_elements(j -> 'recipes') e where label = 'first'),
  'create:1,create:1,create:1', 'every recipe is new, version 1');
select is((select string_agg(e ->> 'row', ',' order by ordinality) from res,
             jsonb_array_elements(j -> 'recipes') with ordinality as t(e, ordinality) where label = 'first'),
  '1,2,3', 'rows without a "row" key are numbered by position');
select is(pg_temp.counts(), '3/3/5/1', 'three keys, three versions, five lines, one price');
select is(public.export_recipes() -> 'recipes',
  jsonb_build_array(pg_temp.polenta_row(), pg_temp.stew_row(), pg_temp.plate_row()),
  'the export equals the input in canonical form, by name');
select is(pg_temp.imp('second', (public.export_recipes() -> 'recipes')), 'ok', 'importing the export');
select is(pg_temp.summary('second'), '0/0/3', 'changes nothing: unchanged 3');
select is(pg_temp.counts(), '3/3/5/1', 'and no row was added');
select is(pg_temp.imp('third', pg_temp.file()), 'ok', 'the original file again');
select is(pg_temp.summary('third'), '0/0/3', 'is unchanged too (idempotent)');
select is(pg_temp.imp('rows_keys', (select jsonb_agg(e || '{"row": 7}') from jsonb_array_elements(pg_temp.file()) e)),
  'ok', 'a "row" key is accepted');

-- Changes make versions.
select is(pg_temp.imp('shelf', jsonb_build_array(pg_temp.stew_row(48))), 'ok', 'a changed shelf life');
select is(pg_temp.summary('shelf'), '0/1/0', 'is one new version');
select is((select e ->> 'version' || ' ' || (e ->> 'action') from res, jsonb_array_elements(j -> 'recipes') e
            where label = 'shelf'), '2 new_version', 'version 2');
select is((select shelf_life_hours from public.v_recipe_current where name = 'Spezzatino (demo)'), 48, 'in force');
select is((select count(*)::int from public.recipe r join public.recipe_key k on k.id = r.recipe_key
            where k.name_norm = 'spezzatino (demo)'), 2, 'with version 1 kept');
select is(pg_temp.imp('mixed', jsonb_build_array(pg_temp.stew_row(48), pg_temp.polenta_row())), 'ok', 'a partial file');
select is(pg_temp.summary('mixed'), '0/0/2', 'only touches the recipes it names, unchanged');

-- Prices: blank keeps, null clears (a new version each time).
select is(pg_temp.imp('keep', jsonb_build_array(pg_temp.plate_row('{}', 2))), 'ok',
  'a plate row without price keys and one more bread');
select is(pg_temp.summary('keep'), '0/1/0', 'is a new version');
select is((select p.sale_price::text || ' ' || p.target_gp_pct::text from public.recipe_price p
            join public.recipe r on r.id = p.recipe_id join public.recipe_key k on k.id = r.recipe_key
            where k.name_norm = 'spezzatino con polenta (demo)' and r.version = 2), '12.00 70.00',
  'the price is kept from the base version');
select is(pg_temp.imp('same_blank', jsonb_build_array(pg_temp.plate_row('{}', 2))), 'ok', 'the same blank row again');
select is(pg_temp.summary('same_blank'), '0/0/1', 'is unchanged: a blank price key changes nothing');
select is(pg_temp.imp('clear', jsonb_build_array(pg_temp.plate_row('{"salePrice": null, "targetGpPct": null}', 2))), 'ok',
  'null price keys');
select is(pg_temp.summary('clear'), '0/1/0', 'are a new version');
select is((select count(*)::int from public.recipe_price p join public.recipe r on r.id = p.recipe_id
            where r.recipe_key = (select id from public.recipe_key where name_norm = 'spezzatino con polenta (demo)')
              and r.version = 3), 0, 'with no price row: cleared');
select is(pg_temp.imp('reprice', jsonb_build_array(pg_temp.plate_row('{"salePrice": 13.5}', 2))), 'ok', 'a price is set again');
select is((select p.sale_price::text || ' ' || coalesce(p.target_gp_pct::text, 'null') from public.recipe_price p
            join public.recipe r on r.id = p.recipe_id where r.version = 4 and r.recipe_key =
              (select id from public.recipe_key where name_norm = 'spezzatino con polenta (demo)')), '13.50 null',
  'the new price and no target (it was cleared)');

-- T1: a dry run is the real import rolled back, and returns the real preview.
create temporary table fresh_file as select jsonb_build_array(jsonb_build_object('name', 'Brodo (demo)', 'type', 'sub',
  'outputQty', 1, 'outputUnit', 'l', 'lines', jsonb_build_array(jsonb_build_object('ingredient', 'Manzo muscolo (demo)',
  'qty', 1, 'unit', 'kg', 'yieldFactor', 1.5)))) as rows;
grant select on fresh_file to authenticated;
create temporary table before_dry as select pg_temp.counts() as c;
grant select on before_dry to authenticated;
select is(pg_temp.imp('dry', (select rows from fresh_file), true), 'ok', 'a dry run of a file with one new recipe');
select is((select j ->> 'dryRun' || ' ' || pg_temp.summary('dry') from res where label = 'dry'), 'true 1/0/0',
  'reports dryRun true and created 1');
select is(pg_temp.counts(), (select c from before_dry), 'and afterwards no key, version, line or price exists');
select is((select count(*)::int from public.recipe_key where name_norm = 'brodo (demo)'), 0, 'the new key is gone');
select is(pg_temp.imp('real', (select rows from fresh_file)), 'ok', 'the same file for real');
select is((select (j - 'dryRun')::text from res where label = 'real'), (select (j - 'dryRun')::text from res where label = 'dry'),
  'gives exactly the preview (warnings included)');
select is((select e -> 'warnings' ->> 0 from res, jsonb_array_elements(j -> 'recipes') e where label = 'real'),
  '{"code": "yield_above_one", "line": 1}', 'the warning for yield 1.5 is in the result');

-- Errors roll everything back and carry the file row, never its contents.
create temporary table before_err as select pg_temp.counts() as c;
grant select on before_err to authenticated;
select is(pg_temp.imperr(jsonb_build_array(pg_temp.polenta_row(), jsonb_build_object('row', 9, 'name', 'Nuovo (demo)',
    'type', 'sub', 'outputQty', 1, 'outputUnit', 'kg', 'lines', jsonb_build_array(
      jsonb_build_object('ingredient', 'Segreto Mai Visto', 'qty', 1, 'unit', 'kg'))))),
  'P0001 recipe_invalid | [{"row": 9, "code": "unknown_ingredient", "field": "lines.0.ingredient"}]',
  'an unknown ingredient is recipe_invalid with the row and the field, not the name');
select is(pg_temp.counts(), (select c from before_err), 'nothing was written');
select matches(pg_temp.imperr(jsonb_build_array(jsonb_build_object('name', 'Nuovo (demo)', 'type', 'sub',
    'outputQty', 1, 'outputUnit', 'kg', 'lines', jsonb_build_array(jsonb_build_object('recipe', 'Ricetta Fantasma',
    'qty', 1, 'unit', 'kg'))))), '"code": "unknown_sub_recipe"', 'an unknown recipe name is refused');
select matches(pg_temp.imperr(jsonb_build_array(jsonb_build_object('name', 'Nuovo (demo)', 'type', 'sub',
    'outputQty', 1, 'outputUnit', 'kg', 'lines', jsonb_build_array(jsonb_build_object('ingredient', 'Vecchio (demo)',
    'qty', 1, 'unit', 'kg'))))), '"code": "ingredient_inactive"', 'an inactive ingredient is refused');
select matches(pg_temp.imperr(jsonb_build_array(jsonb_build_object('row', 4, 'name', 'Polenta (demo)', 'type', 'plate',
    'lines', jsonb_build_array(jsonb_build_object('ingredient', 'Pane (demo)', 'qty', 1, 'unit', 'pz'))))),
  '^P0001 recipe_type_conflict \| \[\{"row": 4', 'a sub named like an existing sub but given as a plate is a type conflict');
select matches(pg_temp.imperr(jsonb_build_array(jsonb_build_object('name', 'Nuovo (demo)', 'type', 'soup'))),
  '"field": "type"', 'an unknown type is refused');
select matches(pg_temp.imperr(jsonb_build_array(pg_temp.polenta_row(), pg_temp.polenta_row() || '{"row": 5}')),
  '"row": 5, "code": "duplicate_in_file"', 'the same name twice in one file is refused');
select matches(pg_temp.imperr(jsonb_build_array(jsonb_build_object('name', 'Nuovo (demo)', 'type', 'sub', 'outputQty', 1,
    'outputUnit', 'kg', 'lines', jsonb_build_array(jsonb_build_object('ingredient', 'Pane (demo)',
    'recipe', 'Polenta (demo)', 'qty', 1, 'unit', 'kg'))))), '"code": "line_target_required"',
  'a line with both an ingredient and a recipe is refused');
select matches(pg_temp.imperr(jsonb_build_array(jsonb_build_object('name', 'Nuovo (demo)', 'type', 'sub', 'outputQty', 1,
    'outputUnit', 'kg', 'colour', 'red', 'lines', jsonb_build_array(jsonb_build_object('ingredient', 'Pane (demo)',
    'qty', 1, 'unit', 'pz'))))), '"code": "unknown_field"', 'an unknown column is refused');
select matches(pg_temp.imperr((select jsonb_agg(jsonb_build_object('name', 'R' || g)) from generate_series(1, 1001) g)),
  '"code": "too_many_rows"', 'more than 1000 rows are refused');
select is(pg_temp.run(format('select public.set_recipe_active(%L, false)', (select id from public.recipe_key
    where name_norm = 'brodo (demo)'))), 'ok', 'a recipe is deactivated');
select matches(pg_temp.imperr(jsonb_build_array((select jsonb_set(r, '{type}', '"sub"') from jsonb_array_elements(
      jsonb_build_array(jsonb_build_object('name', 'Brodo (demo)', 'type', 'sub', 'outputQty', 1, 'outputUnit', 'l',
        'lines', jsonb_build_array(jsonb_build_object('ingredient', 'Manzo muscolo (demo)', 'qty', 2, 'unit', 'kg'))))) r))),
  '^P0001 recipe_inactive ', 'a file naming an inactive recipe is refused: reactivate first');
select is(jsonb_array_length(public.export_recipes() -> 'recipes'), 3, 'the export lists active recipes only');

-- A cycle inside a file, for real and as a dry run.
create temporary table cycle_file as select jsonb_build_array(
  jsonb_build_object('name', 'Ciclo A (demo)', 'type', 'sub', 'outputQty', 1, 'outputUnit', 'kg', 'lines',
    jsonb_build_array(jsonb_build_object('recipe', 'Ciclo B (demo)', 'qty', 1, 'unit', 'kg'))),
  jsonb_build_object('name', 'Ciclo B (demo)', 'type', 'sub', 'outputQty', 1, 'outputUnit', 'kg', 'lines',
    jsonb_build_array(jsonb_build_object('recipe', 'Ciclo A (demo)', 'qty', 1, 'unit', 'kg')))) as rows;
grant select on cycle_file to authenticated;
select matches(pg_temp.imperr((select rows from cycle_file)), '^P0001 recipe_cycle', 'A <-> B in a file is a cycle');
select matches(pg_temp.imperr((select rows from cycle_file), true), '^P0001 recipe_cycle',
  'and a dry run reports it like the real import');
select is((select count(*)::int from public.recipe_key where name_norm like 'ciclo%'), 0, 'nothing of it was written');

-- Tenants.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.imp('b', jsonb_build_array(pg_temp.stew_row())), 'ok',
  'tenant B imports a recipe with the same name as tenant A''s, using its own beef');
select matches(pg_temp.imperr(jsonb_build_array(pg_temp.polenta_row())), '"code": "unknown_ingredient"',
  'but tenant A''s corn flour is unknown to B');
select is(jsonb_array_length(public.export_recipes() -> 'recipes'), 1, 'tenant B exports only its own recipe');
select is(public.export_recipes() -> 'recipes' -> 0 ->> 'name', 'Spezzatino (demo)', 'which is the one it imported');

select * from finish();
rollback;
