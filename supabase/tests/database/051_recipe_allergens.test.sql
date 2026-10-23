-- M7 step 6: recipe_allergen_summary (M7 plan §3.1.7). Covers AT6 at database level: a recipe
-- inherits "da confermare" from any ingredient below it, through sub-recipes and batches, and
-- follows the current versions. Acts as owner A unless stated.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

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

-- Ingredients (fake): 901 beef kg, 902 corn flour kg (not stated), 903 bread pz, 904 semolina kg.
insert into public.ingredient (id, tenant_id, name, base_unit, allergens) values
  (pg_temp.uid(901), '11111111-1111-4111-8111-111111111111', 'Manzo muscolo (demo)', 'kg', null),
  (pg_temp.uid(902), '11111111-1111-4111-8111-111111111111', 'Farina di mais (demo)', 'kg', null),
  (pg_temp.uid(903), '11111111-1111-4111-8111-111111111111', 'Pane (demo)', 'pz', null),
  (pg_temp.uid(904), '11111111-1111-4111-8111-111111111111', 'Semolino (demo)', 'kg', null);

create function pg_temp.summary(p_key uuid) returns text language sql as $$
  select coalesce(string_agg(allergens::text || ' ' || confirmed || ' ' || unconfirmed_ingredient_ids::text, ';'),
                  'no rows')
    from public.recipe_allergen_summary(array[p_key]) $$;
create function pg_temp.confirm(p_ing int, p_list public.allergen[]) returns text language sql as $$
  select pg_temp.run(format('select public.confirm_ingredient_allergens(%L, %L)', pg_temp.uid(p_ing), p_list)) $$;
grant execute on function pg_temp.summary(uuid), pg_temp.confirm(int, public.allergen[]) to authenticated;

select ok(not has_function_privilege('anon', 'public.recipe_allergen_summary(uuid[])', 'execute')
      and not has_function_privilege('public', 'public.recipe_allergen_summary(uuid[])', 'execute')
      and not has_function_privilege('service_role', 'public.recipe_allergen_summary(uuid[])', 'execute')
      and has_function_privilege('authenticated', 'public.recipe_allergen_summary(uuid[])', 'execute'),
  'only authenticated can execute the summary');
select ok((select not p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=""']
             from pg_proc p where p.oid = 'public.recipe_allergen_summary(uuid[])'::regprocedure),
  'it is SECURITY INVOKER, stable, with an empty search_path: the caller''s RLS applies');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.confirm(901, '{}'), 'ok', 'beef is confirmed: no allergen');
select is(pg_temp.confirm(903, '{glutine}'), 'ok', 'bread is confirmed: gluten');
select is(pg_temp.mk('stew', 'batch', pg_temp.stew()), 'ok', 'the stew batch (beef)');
select is(pg_temp.mk('polenta', 'sub', pg_temp.sub('Polenta (demo)', jsonb_build_array(pg_temp.li(902, 0.3)))), 'ok',
  'the polenta sub (corn flour, not stated)');
select is(pg_temp.mk('plate', 'plate', pg_temp.plate('Spezzatino con polenta (demo)', jsonb_build_array(
    pg_temp.lr(pg_temp.key('stew'), 1, 'porz'), pg_temp.lr(pg_temp.key('polenta'), 0.2), pg_temp.li(903, 1, 'pz')))),
  'ok', 'the plate uses the batch, the sub and the bread');

select is(pg_temp.summary(pg_temp.key('plate')), format('{glutine} false {%s}', pg_temp.uid(902)),
  'the plate: gluten from the bread, NOT confirmed, because corn flour (reached through the sub) is not stated');
select is(pg_temp.summary(pg_temp.key('stew')), '{} true {}', 'the batch: no allergen, confirmed');
select is(pg_temp.summary(pg_temp.key('polenta')), format('{} false {%s}', pg_temp.uid(902)),
  'the sub: nothing declared and not confirmed: "da confermare", not allergen-free');

select is(pg_temp.confirm(902, '{}'), 'ok', 'the owner confirms corn flour as allergen-free');
select is(pg_temp.summary(pg_temp.key('plate')), '{glutine} true {}', 'the plate is confirmed and still has gluten');
select is(pg_temp.summary(pg_temp.key('polenta')), '{} true {}', 'and so is the sub');

-- A declared but unconfirmed list on beef makes the batch and the plate "da confermare" (through the batch line).
update public.ingredient set allergens = '{latte}' where id = pg_temp.uid(901);
select is(pg_temp.summary(pg_temp.key('stew')), format('{latte} false {%s}', pg_temp.uid(901)),
  'beef edited to a declared list: the batch is unconfirmed and lists latte');
select is(pg_temp.summary(pg_temp.key('plate')), format('{glutine,latte} false {%s}', pg_temp.uid(901)),
  'the plate follows through the batch line');
select is(pg_temp.confirm(901, '{latte}'), 'ok', 'beef confirmed again');
select is(pg_temp.summary(pg_temp.key('plate')), '{glutine,latte} true {}', 'the plate is confirmed with both allergens');

-- Editing an ingredient clears its confirmation, and the recipes above notice.
update public.ingredient set allergens = null where id = pg_temp.uid(902);
select is(pg_temp.summary(pg_temp.key('plate')), format('{glutine,latte} false {%s}', pg_temp.uid(902)),
  'corn flour back to not stated: the plate is unconfirmed again');

-- The plate follows the current version of the sub.
select is(pg_temp.confirm(904, '{glutine}'), 'ok', 'semolina is confirmed');
select is(pg_temp.mkv('polenta2', pg_temp.key('polenta'), 1, pg_temp.sub('Polenta (demo)', jsonb_build_array(
    pg_temp.li(904, 0.3)))), 'ok', 'a new version of the sub replaces corn flour with semolina');
select is(pg_temp.summary(pg_temp.key('plate')), '{glutine,latte} true {}', 'the plate follows the sub''s current version');
select is(pg_temp.summary(pg_temp.key('polenta')), '{glutine} true {}', 'and so does the sub');

-- Several keys at once, an unknown key and the limit.
select is((select count(*)::int from public.recipe_allergen_summary(
    array[pg_temp.key('plate'), pg_temp.key('stew'), pg_temp.key('polenta'), pg_temp.uid(999)])), 3,
  'three known keys give three rows; the unknown key gives none');
select is((select count(*)::int from public.recipe_allergen_summary(null)), 0, 'a null list gives no rows');
select is((select count(*)::int from public.recipe_allergen_summary('{}')), 0, 'an empty list gives no rows');
select is(pg_temp.run($$ select * from public.recipe_allergen_summary(
    (select array_agg(gen_random_uuid()) from generate_series(1, 201))) $$), 'P0001 too_many_keys',
  'more than 200 keys are refused');
select is(pg_temp.run($$ select * from public.recipe_allergen_summary(
    (select array_agg(gen_random_uuid()) from generate_series(1, 200))) $$), 'ok', 'exactly 200 are fine');

-- Roles and tenants.
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.summary(pg_temp.key('plate')), '{glutine,latte} true {}', 'the admin gets the same rows');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.summary(pg_temp.key('plate')), '{glutine,latte} true {}', 'the chef gets the same rows');
select is((select count(*)::int from information_schema.columns where table_schema = 'public'
            and table_name = 'recipe_allergen_summary'), 0, 'the summary is a function, not a relation');
select ok(not exists (select 1 from pg_proc p, unnest(p.proargnames) n
                       where p.oid = 'public.recipe_allergen_summary(uuid[])'::regprocedure
                         and n ~* '(price|gp_pct|cost|margin)'),
  'the summary has no price, cost or margin column for the chef');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.summary(pg_temp.key('plate')), 'no rows', 'the waiter gets no rows');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.summary(pg_temp.key('plate')), 'no rows', 'owner B gets none for tenant A''s keys');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.summary(pg_temp.key('plate')), 'no rows', 'a caller with no claims gets none');

select * from finish();
rollback;
