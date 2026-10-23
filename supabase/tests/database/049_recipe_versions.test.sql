-- M7 step 5: create_recipe, create_recipe_version, set_recipe_active (M7 plan §3.1, §3.2).
-- Covers AT1 (a new version, history unchanged, valid_from increasing), AT3 (yield), AT5 (a chef
-- can create versions but not change the price fields) and the definer rules (role first, empty
-- search_path, tenant from the token, execute for authenticated only).
begin;
create extension if not exists pgtap with schema extensions;
select plan(102);

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

-- Fake ingredients: 901 beef kg, 902 corn flour kg, 903 bread pz, 904 inactive kg, 905 water l; 906 in B.
insert into public.ingredient (id, tenant_id, name, base_unit, allergens, is_active) values
  (pg_temp.uid(901), '11111111-1111-4111-8111-111111111111', 'Manzo muscolo (demo)', 'kg', '{}', true),
  (pg_temp.uid(902), '11111111-1111-4111-8111-111111111111', 'Farina di mais (demo)', 'kg', null, true),
  (pg_temp.uid(903), '11111111-1111-4111-8111-111111111111', 'Pane (demo)', 'pz', '{glutine}', true),
  (pg_temp.uid(904), '11111111-1111-4111-8111-111111111111', 'Vecchio (demo)', 'kg', '{}', false),
  (pg_temp.uid(905), '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'l', '{}', true),
  (pg_temp.uid(906), '22222222-2222-4222-8222-222222222222', 'Manzo B (demo)', 'kg', '{}', true);

-- Definer rules and privileges.
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
             from pg_proc p where p.oid in ('public.create_recipe(public.recipe_type, jsonb)'::regprocedure,
               'public.create_recipe_version(uuid, integer, jsonb)'::regprocedure,
               'public.set_recipe_active(uuid, boolean)'::regprocedure)),
  'the three procedures are SECURITY DEFINER with an empty search_path');
select ok((select bool_and(has_function_privilege('authenticated', f, 'execute')
                           and not has_function_privilege('anon', f, 'execute')
                           and not has_function_privilege('service_role', f, 'execute')
                           and not has_function_privilege('public', f, 'execute'))
             from unnest(array['public.create_recipe(public.recipe_type, jsonb)',
               'public.create_recipe_version(uuid, integer, jsonb)',
               'public.set_recipe_active(uuid, boolean)']) f),
  'only authenticated can execute them');
select ok((select bool_and(not has_function_privilege('authenticated', p.oid, 'execute')
                           and not has_function_privilege('anon', p.oid, 'execute')
                           and not has_function_privilege('service_role', p.oid, 'execute')
                           and not has_function_privilege('public', p.oid, 'execute'))
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app'
              and p.proname in ('recipe_graph_lock_key', 'lock_recipe_graph', 'require_recipe_writer',
                'require_recipe_admin', 'recipe_content_parse', 'insert_recipe_version',
                'validate_recipe_lines', 'assert_recipe_acyclic', 'recipe_version_content',
                'write_recipe_version', 'recipe_unit_dimension')),
  'no API role can execute an app.* recipe helper');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname in ('recipe_graph_lock_key', 'lock_recipe_graph',
              'require_recipe_writer', 'require_recipe_admin', 'recipe_content_parse',
              'insert_recipe_version', 'validate_recipe_lines', 'assert_recipe_acyclic',
              'recipe_version_content', 'write_recipe_version', 'recipe_unit_dimension')), 11,
  'all eleven helpers exist');

create temporary table lock_key as
  select * from app.recipe_graph_lock_key('11111111-1111-4111-8111-111111111111');
grant select on lock_key to authenticated;

-- Roles first: nothing is parsed or locked for a caller who may not write.
set local role authenticated;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select matches(pg_temp.mkerr('batch', pg_temp.stew()), '^42501 ', 'a waiter cannot create a recipe');
select matches(pg_temp.mkverr(pg_temp.uid(1), 1, pg_temp.stew()), '^42501 ', 'a waiter cannot create a version');
select matches(pg_temp.run(format('select public.set_recipe_active(%L, false)', pg_temp.uid(1))), '^42501 ',
  'a waiter cannot deactivate');
select set_config('request.jwt.claims', '', true);
select matches(pg_temp.mkerr('batch', pg_temp.stew()), '^42501 ', 'a caller with no claims cannot create');
select matches(pg_temp.mkverr(pg_temp.uid(1), 1, pg_temp.stew()), '^42501 ', 'nor create a version');
select matches(pg_temp.run(format('select public.set_recipe_active(%L, false)', pg_temp.uid(1))), '^42501 ',
  'nor deactivate');
select is((select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()), 0,
  'and none of these calls took the recipe lock');

-- AT1: owner A creates the stew, then a version 2.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.mk('stew', 'batch', pg_temp.stew()), 'ok', 'the owner creates the stew batch');
select is((select j ->> 'version' from res where label = 'stew'), '1', 'as version 1');
select is((select (j -> 'warnings')::text from res where label = 'stew'), '[]', 'with no warnings');
select is((select count(*)::int from pg_locks l
            where l.locktype = 'advisory' and l.pid = pg_backend_pid()
              and exists (select 1 from lock_key k where k.class = l.classid::int and k.obj = l.objid::int)),
  1, 'the call holds the tenant''s recipe-graph lock');
create temporary table v1_snapshot as
  select r.*::text as row_text,
         (select string_agg(l.*::text, ';' order by l.position) from public.recipe_line l where l.recipe_id = r.id) as lines_text
    from public.recipe r where r.id = pg_temp.rid('stew');
grant select on v1_snapshot to authenticated;
select is(pg_temp.mkv('stew2', pg_temp.key('stew'), 1, pg_temp.stew(48)), 'ok', 'a version 2 with a new shelf life');
select is((select j ->> 'version' from res where label = 'stew2'), '2', 'is version 2');
select ok((select v2.valid_from > v1.valid_from
             from public.recipe v1, public.recipe v2
            where v1.id = pg_temp.rid('stew') and v2.id = pg_temp.rid('stew2')),
  'its valid_from is later than version 1''s, even inside one transaction');
select is((select r.*::text from public.recipe r where r.id = pg_temp.rid('stew')),
  (select row_text from v1_snapshot), 'version 1''s row is unchanged');
select is((select string_agg(l.*::text, ';' order by l.position) from public.recipe_line l
            where l.recipe_id = pg_temp.rid('stew')), (select lines_text from v1_snapshot),
  'and so are its lines');
select is((select current_version from public.recipe_key where id = pg_temp.key('stew')), 2, 'current_version is 2');
select is((select shelf_life_hours from public.v_recipe_current where recipe_key = pg_temp.key('stew')), 48,
  'v_recipe_current returns version 2');
select is((select shelf_life_hours from public.recipe where id = pg_temp.rid('stew')), 72,
  'while version 1 still says 72 hours');
select is(pg_temp.mkverr(pg_temp.key('stew'), 1, pg_temp.stew(24)),
  'P0001 version_conflict | {"currentVersion":2}', 'a second editor still on version 1 gets version_conflict');
select is((select count(*)::int from public.recipe where recipe_key = pg_temp.key('stew')), 2,
  'and no third version exists');
select is(pg_temp.mkverr(pg_temp.key('stew'), 2, pg_temp.stew(48)), 'P0001 recipe_unchanged',
  'identical content is refused');
select is(pg_temp.mkv('stew3', pg_temp.key('stew'), 2, pg_temp.stew(24)), 'ok', 'a third version');
select ok((select bool_and(valid_from > prev) from (select valid_from, lag(valid_from) over (order by version) prev
            from public.recipe where recipe_key = pg_temp.key('stew')) t where prev is not null),
  'valid_from rises with every version');

-- Names.
select is(pg_temp.mk('polenta', 'sub', pg_temp.sub('Polenta (demo)', jsonb_build_array(pg_temp.li(902, 0.3)))), 'ok',
  'a sub-recipe');
select is(pg_temp.mkerr('sub', pg_temp.sub('  polenta   (DEMO) ', jsonb_build_array(pg_temp.li(902, 0.3)))),
  'P0001 recipe_name_taken', 'a new recipe cannot take an existing name, whatever the case and spacing');
select is(pg_temp.mkverr(pg_temp.key('stew'), 3, pg_temp.stew(24, 'Polenta (demo)')), 'P0001 recipe_name_taken',
  'nor can a rename');
select is(pg_temp.mkv('stew4', pg_temp.key('stew'), 3, pg_temp.stew(24, 'Spezzatino di manzo (demo)')), 'ok',
  'a rename to a free name is a new version');
select is((select name_norm from public.recipe_key where id = pg_temp.key('stew')), 'spezzatino di manzo (demo)',
  'and the key follows the name');

-- Deactivating.
select is(pg_temp.run(format('select public.set_recipe_active(%L, false)', pg_temp.key('polenta'))), 'ok',
  'the owner deactivates a recipe');
select is((select is_active from public.recipe_key where id = pg_temp.key('polenta')), false, 'it is inactive');
select is(pg_temp.audits('recipe.deactivated'), 1, 'with one audit event');
select is(pg_temp.run(format('select public.set_recipe_active(%L, false)', pg_temp.key('polenta'))), 'ok',
  'deactivating again is a no-op');
select is(pg_temp.audits('recipe.deactivated'), 1, 'with no second audit event');
select is(pg_temp.mkverr(pg_temp.key('polenta'), 1, pg_temp.sub('Polenta (demo)', jsonb_build_array(pg_temp.li(902, 0.4)))),
  'P0001 recipe_inactive', 'an inactive recipe takes no new version');
select is(pg_temp.run(format('select public.set_recipe_active(%L, true)', pg_temp.key('polenta'))), 'ok', 'reactivating works');
select is(pg_temp.audits('recipe.reactivated'), 1, 'and is audited');
select is((select before::text || ' ' || after::text from public.audit_event where action = 'recipe.reactivated'),
  '{"isActive": false} {"isActive": true}', 'with the before and after states');
select is(pg_temp.run(format('select public.set_recipe_active(%L, true)', pg_temp.uid(999))), 'P0002 not_found',
  'an unknown key is not found');

-- AT3: yield factor.
select is(pg_temp.mkerr('sub', pg_temp.sub('Brodo (demo)', jsonb_build_array(pg_temp.li(905, 2, 'l', 0)), 'l')),
  'P0001 recipe_invalid | [{"code": "yield_factor_not_positive", "field": "lines.0.yieldFactor"}]',
  'yield 0 is refused (AT3)');
select matches(pg_temp.mkerr('sub', pg_temp.sub('Brodo (demo)', jsonb_build_array(pg_temp.li(905, 2, 'l', -0.5)), 'l')),
  'yield_factor_not_positive', 'a negative yield is refused');
select matches(pg_temp.mkerr('sub', pg_temp.sub('Brodo (demo)', jsonb_build_array(pg_temp.li(905, 2, 'l', 11)), 'l')),
  'yield_factor_too_large', 'yield 11 is refused as too large');
select is(pg_temp.mk('brodo', 'sub', pg_temp.sub('Brodo (demo)', jsonb_build_array(pg_temp.li(905, 2, 'l', 1.5)), 'l')),
  'ok', 'yield 1.5 is saved');
select is((select (j -> 'warnings')::text from res where label = 'brodo'),
  '[{"code": "yield_above_one", "line": 1}]', 'with a warning');
select is((select yield_factor from public.recipe_line where recipe_id = pg_temp.rid('brodo')), 1.5000,
  'the yield is stored');
select is(pg_temp.mkerr('sub', pg_temp.sub('Brodo 2 (demo)', jsonb_build_array(pg_temp.li(905, 2, 'l', 10)), 'l')),
  'ok', 'yield 10 (the upper bound) is accepted');

-- Types, fields and units.
select matches(pg_temp.mkerr('batch', pg_temp.stew() - 'portionsPerBatch'), '"code": "required", "field": "portionsPerBatch"',
  'a batch without portions is refused');
select matches(pg_temp.mkerr('plate', pg_temp.plate('Piatto (demo)', jsonb_build_array(pg_temp.li(903, 1, 'pz')),
    '{"outputQty": 1}')), '"code": "field_not_for_type", "field": "outputQty"', 'a plate with an output quantity is refused');
select matches(pg_temp.mkerr('sub', pg_temp.sub('X (demo)', jsonb_build_array(pg_temp.li(902, 1)))
    || '{"shelfLifeHours": 5}'), '"code": "field_not_for_type", "field": "shelfLifeHours"', 'a sub with a shelf life is refused');
select matches(pg_temp.mkerr('sub', pg_temp.sub('X (demo)', jsonb_build_array(pg_temp.li(902, 1))) || '{"colour": "red"}'),
  '"code": "unknown_field", "field": "colour"', 'an unknown field is refused');
select matches(pg_temp.mkerr('batch', pg_temp.stew() || '{"minPortions": 10, "targetPortions": 5}'),
  '"field": "targetPortions"', 'target portions below the minimum are refused');
select matches(pg_temp.mkerr('batch', pg_temp.stew() - 'lines'), '"code": "no_lines"', 'a recipe needs lines');
select matches(pg_temp.mkerr('batch', pg_temp.stew() || '{"salePrice": 5}'), '"code": "price_not_for_type", "field": "salePrice"',
  'a price on a batch is refused');
select matches(pg_temp.mkerr('sub', pg_temp.sub('X (demo)', jsonb_build_array(pg_temp.li(902, 1, 'pz')))),
  '"code": "incompatible_units", "field": "lines.0.unit"', 'pz on a kg ingredient is refused');
select is(pg_temp.mk('gram', 'sub', pg_temp.sub('Farina in grammi (demo)', jsonb_build_array(pg_temp.li(902, 300, 'g')))),
  'ok', 'g on a kg ingredient is accepted');
select matches(pg_temp.mkerr('sub', pg_temp.sub('X (demo)', jsonb_build_array(pg_temp.li(904, 1)))),
  '"code": "ingredient_inactive"', 'an inactive ingredient is refused');
select matches(pg_temp.mkerr('sub', pg_temp.sub('X (demo)', jsonb_build_array(pg_temp.li(906, 1)))),
  '"code": "unknown_ingredient"', 'another tenant''s ingredient is unknown');
select matches(pg_temp.mkerr('sub', pg_temp.sub('X (demo)', jsonb_build_array(pg_temp.li(999, 1)))),
  '"code": "unknown_ingredient"', 'so is a missing one');
select matches(pg_temp.mkerr('sub', pg_temp.sub('X (demo)', jsonb_build_array(pg_temp.lr(pg_temp.key('brodo'), 1, 'kg')))),
  '"code": "incompatible_units", "field": "lines.0.unit"', 'a sub line in kg on a litre sub is refused');
select matches(pg_temp.mkerr('batch', pg_temp.stew() || jsonb_build_object('lines',
    jsonb_build_array(pg_temp.lr(pg_temp.key('stew'), 1, 'porz')))),
  '"code": "line_target_not_allowed", "field": "lines.0.recipeKey"', 'a batch inside a batch is refused');
select is(pg_temp.mk('plate1', 'plate', pg_temp.plate('Piatto 1 (demo)', jsonb_build_array(
    pg_temp.lr(pg_temp.key('stew'), 1, 'porz'), pg_temp.lr(pg_temp.key('polenta'), 0.2), pg_temp.li(903, 1, 'pz')))),
  'ok', 'a plate uses a batch in portions, a sub and an ingredient');
select matches(pg_temp.mkerr('sub', pg_temp.sub('X (demo)', jsonb_build_array(pg_temp.lr(pg_temp.key('plate1'), 1, 'kg')))),
  '"code": "line_target_not_allowed"', 'a line to a plate is refused');
select matches(pg_temp.mkerr('plate', pg_temp.plate('Piatto 2 (demo)', jsonb_build_array(pg_temp.lr(pg_temp.key('stew'), 1, 'kg')))),
  '"code": "incompatible_units"', 'a batch is used in portions only');
select matches(pg_temp.mkerr('plate', pg_temp.plate('Piatto 2 (demo)', jsonb_build_array(pg_temp.li(903, 1, 'porz')))),
  '"code": "incompatible_units"', 'porz on an ingredient is refused');
select matches(pg_temp.mkerr('plate', pg_temp.plate('Piatto 2 (demo)', jsonb_build_array(
    pg_temp.lr(pg_temp.uid(999), 1, 'porz')))), '"code": "unknown_sub_recipe"', 'an unknown recipe key is refused');
select is(pg_temp.run(format('select public.set_recipe_active(%L, false)', pg_temp.key('brodo'))), 'ok', 'brodo off');
select matches(pg_temp.mkerr('sub', pg_temp.sub('X (demo)', jsonb_build_array(pg_temp.lr(pg_temp.key('brodo'), 1, 'l')))),
  '"code": "sub_recipe_inactive"', 'an inactive sub-recipe cannot be used');
select is(pg_temp.mkerr('sub', pg_temp.sub('X (demo)', jsonb_build_array(pg_temp.li(901, 0, 'kg')))) ~ 'qty_not_positive', true,
  'a quantity of 0 is refused');
select matches(pg_temp.mkerr('sub', pg_temp.sub('X (demo)', jsonb_build_array(
    pg_temp.li(901, 1) || jsonb_build_object('recipeKey', pg_temp.key('stew'))))),
  '"code": "line_target_required"', 'a line with two targets is refused');

-- AT5: the chef and the price fields.
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.mk('plate2', 'plate', pg_temp.plate('Piatto del giorno (demo)', jsonb_build_array(
    pg_temp.lr(pg_temp.key('stew'), 1, 'porz'), pg_temp.li(903, 1, 'pz')))), 'ok', 'a chef creates a plate without a price');
select is(pg_temp.mkv('stew5', pg_temp.key('stew'), 4, pg_temp.stew(36, 'Spezzatino di manzo (demo)')), 'ok',
  'a chef creates a version with a new shelf life (AT5)');
select is((select shelf_life_hours from public.v_recipe_current where recipe_key = pg_temp.key('stew')), 36, 'it is in force');
select is(pg_temp.mkerr('plate', pg_temp.plate('Piatto 3 (demo)', jsonb_build_array(pg_temp.li(903, 1, 'pz')),
    '{"salePrice": 12}')), '42501 recipe_price_forbidden', 'a chef cannot create a plate with a sale price');
select is(pg_temp.mkverr(pg_temp.key('plate2'), 1, pg_temp.plate('Piatto del giorno (demo)', jsonb_build_array(
    pg_temp.li(903, 2, 'pz')), '{"salePrice": 12}')), '42501 recipe_price_forbidden',
  'a chef version naming salePrice is refused (AT5)');
select is(pg_temp.mkverr(pg_temp.key('plate2'), 1, pg_temp.plate('Piatto del giorno (demo)', jsonb_build_array(
    pg_temp.li(903, 2, 'pz')), '{"targetGpPct": 70}')), '42501 recipe_price_forbidden', 'and so is targetGpPct');
select is(pg_temp.mkverr(pg_temp.key('plate2'), 1, pg_temp.plate('Piatto del giorno (demo)', jsonb_build_array(
    pg_temp.li(903, 2, 'pz')), '{"salePrice": null}')), '42501 recipe_price_forbidden',
  'even an explicit null price key from a chef');
select is(pg_temp.run(format('select public.set_recipe_active(%L, false)', pg_temp.key('plate2'))), '42501 permission denied: recipes need owner or admin to change this',
  'a chef cannot deactivate');

-- Owner prices; the chef's later version keeps the price.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.mkv('plate2b', pg_temp.key('plate2'), 1, pg_temp.plate('Piatto del giorno (demo)', jsonb_build_array(
    pg_temp.lr(pg_temp.key('stew'), 1, 'porz'), pg_temp.li(903, 1, 'pz')), '{"salePrice": 12, "targetGpPct": 70}')),
  'ok', 'the owner sets the price: a new version');
select is((select sale_price::text || ' ' || target_gp_pct::text from public.recipe_price where recipe_id = pg_temp.rid('plate2b')),
  '12.00 70.00', 'with its own price row');
select is((select count(*)::int from public.recipe_price where recipe_id = pg_temp.rid('plate2')), 0,
  'while version 1 has no price row');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.mkv('plate2c', pg_temp.key('plate2'), 2, pg_temp.plate('Piatto del giorno (demo)', jsonb_build_array(
    pg_temp.lr(pg_temp.key('stew'), 1, 'porz'), pg_temp.li(903, 2, 'pz')))), 'ok', 'the chef changes a line');
select is((select sale_price::text || ' ' || target_gp_pct::text from public.recipe_price where recipe_id = pg_temp.rid('plate2c')),
  '12.00 70.00', 'the chef''s version copies the price row');
select is((select count(*)::int from public.recipe_price where recipe_id = pg_temp.rid('plate2c')), 1,
  'and the chef reads it (Q16 = V6)');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.mkv('plate2d', pg_temp.key('plate2'), 3, pg_temp.plate('Piatto del giorno (demo)', jsonb_build_array(
    pg_temp.lr(pg_temp.key('stew'), 1, 'porz'), pg_temp.li(903, 2, 'pz')), '{"salePrice": 13}')), 'ok',
  'a price change alone is a new version');
select is((select sale_price::text || ' ' || target_gp_pct::text from public.recipe_price where recipe_id = pg_temp.rid('plate2d')),
  '13.00 70.00', 'the omitted target GP% is kept');
select is(pg_temp.mkv('plate2e', pg_temp.key('plate2'), 4, pg_temp.plate('Piatto del giorno (demo)', jsonb_build_array(
    pg_temp.lr(pg_temp.key('stew'), 1, 'porz'), pg_temp.li(903, 3, 'pz')))), 'ok', 'omitting the price keys copies the price');
select is((select sale_price::text from public.recipe_price where recipe_id = pg_temp.rid('plate2e')), '13.00', 'the price is 13');
select is(pg_temp.mkv('plate2f', pg_temp.key('plate2'), 5, pg_temp.plate('Piatto del giorno (demo)', jsonb_build_array(
    pg_temp.lr(pg_temp.key('stew'), 1, 'porz'), pg_temp.li(903, 3, 'pz')), '{"salePrice": null, "targetGpPct": null}')), 'ok',
  'null clears both');
select is((select count(*)::int from public.recipe_price where recipe_id = pg_temp.rid('plate2f')), 0, 'leaving no price row');
select matches(pg_temp.mkerr('plate', pg_temp.plate('P (demo)', jsonb_build_array(pg_temp.li(903, 1, 'pz')),
    '{"salePrice": 12.345}')), '"field": "salePrice"', 'a price with three decimals is refused');
select matches(pg_temp.mkerr('plate', pg_temp.plate('P (demo)', jsonb_build_array(pg_temp.li(903, 1, 'pz')),
    '{"targetGpPct": 100}')), '"field": "targetGpPct"', 'a target GP of 100 is refused');

-- Tenants and the other roles.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.mkverr(pg_temp.key('stew'), 5, pg_temp.stew(10)), 'P0002 not_found',
  'owner B cannot version tenant A''s recipe');
select is(pg_temp.run(format('select public.set_recipe_active(%L, false)', pg_temp.key('stew'))), 'P0002 not_found',
  'nor deactivate it');
select is(pg_temp.mk('b_sub', 'sub', pg_temp.sub('Brodo B (demo)', jsonb_build_array(pg_temp.li(906, 1)))), 'ok',
  'owner B has recipes of their own');
select matches(pg_temp.mkerr('plate', pg_temp.plate('Piatto B (demo)', jsonb_build_array(
    pg_temp.lr(pg_temp.key('stew'), 1, 'porz')))), '"code": "unknown_sub_recipe"', 'owner B cannot use tenant A''s batch');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select matches(pg_temp.mkerr('plate', pg_temp.plate('Piatto A (demo)', jsonb_build_array(
    pg_temp.lr(pg_temp.key('b_sub'), 1, 'kg')))), '"code": "unknown_sub_recipe"', 'nor owner A tenant B''s sub');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.mkv('stew6', pg_temp.key('stew'), 5, pg_temp.stew(30, 'Spezzatino di manzo (demo)')), 'ok',
  'the admin creates versions');
select is(pg_temp.run(format('select public.set_recipe_active(%L, true)', pg_temp.key('stew'))), 'ok', 'and may use set_recipe_active');

select * from finish();
rollback;
