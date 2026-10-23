-- M7 review round 2 (NOTE): the recipe graph walks visit distinct recipes, not every path.
-- A "diamond" ladder (L layers of W subs, each sub using all W subs of the next layer, a plate on
-- top) has W^L paths but only W x L recipes. The cycle check in app.assert_recipe_acyclic and the
-- walk in recipe_allergen_summary used to enumerate every path: at W = 4, L = 10 the summary took
-- over a minute and at W = 5 the save itself timed out. Every step below runs under a 5 s limit.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');

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
exception when query_canceled or others then
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
exception when query_canceled or others then
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

insert into public.ingredient (id, tenant_id, name, base_unit, allergens, is_active) values
  (pg_temp.uid(901), '11111111-1111-4111-8111-111111111111', 'Sale (demo)', 'kg', '{}', true),
  (pg_temp.uid(902), '11111111-1111-4111-8111-111111111111', 'Ignoto (demo)', 'kg', null, true);

-- Layer i (1 = top, L = bottom), sub j: label 'g<i>_<j>'. Layers are built bottom-up.
create function pg_temp.diamond(p_w int, p_l int) returns text language plpgsql as $f$
declare
  r text;
  i int;
  j int;
  refs jsonb;
begin
  for i in reverse p_l..1 loop
    for j in 1..p_w loop
      refs := '[]';
      if i < p_l then
        select jsonb_agg(pg_temp.lr(pg_temp.key('g' || (i + 1) || '_' || x), 0.1)) into refs
          from generate_series(1, p_w) x;
      end if;
      r := pg_temp.mk('g' || i || '_' || j, 'sub', pg_temp.sub('Strato ' || i || '/' || j || ' (demo)',
        jsonb_build_array(pg_temp.li(901, 1)) || refs));
      if r <> 'ok' then return 'g' || i || '_' || j || ': ' || r; end if;
    end loop;
  end loop;
  select jsonb_agg(pg_temp.lr(pg_temp.key('g1_' || x), 0.1)) into refs from generate_series(1, p_w) x;
  return pg_temp.mk('top', 'plate', pg_temp.plate('Piatto diamante (demo)', refs));
end
$f$;
-- 'true' / 'false' (the summary's confirmed flag), or the error text.
create function pg_temp.confirmed(p_key uuid) returns text language plpgsql as $f$
declare
  out text;
begin
  select s.confirmed::text into out from public.recipe_allergen_summary(array[p_key]) s;
  return out;
exception when query_canceled or others then
  return sqlstate || ' ' || sqlerrm;
end
$f$;
create function pg_temp.unconfirmed(p_key uuid) returns text language plpgsql as $f$
declare
  out text;
begin
  select s.unconfirmed_ingredient_ids::text into out from public.recipe_allergen_summary(array[p_key]) s;
  return out;
exception when query_canceled or others then
  return sqlstate || ' ' || sqlerrm;
end
$f$;
grant execute on function pg_temp.diamond(int, int), pg_temp.confirmed(uuid), pg_temp.unconfirmed(uuid) to authenticated;

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.run(format('select public.confirm_ingredient_allergens(%L, %L)', pg_temp.uid(901), '{}')), 'ok',
  'the owner confirms ingredient 901 as allergen-free');

-- Building is not what is measured: a generous limit here.
set local statement_timeout = '120s';
select is(pg_temp.diamond(4, 10), 'ok', '40 subs in 10 layers (4^10 paths) plus a plate: every save is accepted');

set local statement_timeout = '5s';
select is(pg_temp.confirmed(pg_temp.key('top')), 'true',
  'the summary of the plate answers within 5 s and is confirmed (11 recipes on the longest path)');
select is(pg_temp.confirmed(pg_temp.key('g1_1')), 'true', 'and so does the summary of a top-layer sub');
select is(pg_temp.mkverr(pg_temp.key('top'), 1, pg_temp.plate('Piatto diamante (demo)', (
    select jsonb_agg(pg_temp.lr(pg_temp.key('g1_' || x), 0.2)) from generate_series(1, 4) x))), 'ok',
  'a new version of the plate saves within 5 s (cycle and depth checks)');
select is(pg_temp.mkverr(pg_temp.key('g1_1'), 1, pg_temp.sub('Strato 1/1 (demo)', jsonb_build_array(
    pg_temp.li(901, 2)) || (select jsonb_agg(pg_temp.lr(pg_temp.key('g2_' || x), 0.2)) from generate_series(1, 4) x))), 'ok',
  'a new version of a top-layer sub saves within 5 s');
-- The bottom layer is used through 4^9 paths: the walk upwards must not enumerate them either.
select is(pg_temp.mkverr(pg_temp.key('g10_1'), 1, pg_temp.sub('Strato 10/1 (demo)', jsonb_build_array(
    pg_temp.li(901, 1), pg_temp.li(902, 1)))), 'ok',
  'a new version of a bottom-layer sub (used by every path) saves within 5 s');
select is(pg_temp.confirmed(pg_temp.key('top')), 'false',
  'the unconfirmed ingredient at the bottom of the diamond makes the plate unconfirmed');
select is(pg_temp.unconfirmed(pg_temp.key('top')), format('{%s}', pg_temp.uid(902)),
  'and it is the only ingredient named');

select * from finish();
rollback;
