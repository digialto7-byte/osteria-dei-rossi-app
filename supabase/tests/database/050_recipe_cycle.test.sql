-- M7 step 5: cycle detection (M7 plan §3.1.10). Covers AT2 at database level. Races are in
-- scripts/test-db-races.sh (cycle-crossed).
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

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


set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

-- Sub A uses sub B (AT2). B first, then A with a line to B.
select is(pg_temp.mk('b', 'sub', pg_temp.sub('Sub B (demo)', jsonb_build_array(pg_temp.li(902, 1)))), 'ok', 'sub B');
select is(pg_temp.mk('a', 'sub', pg_temp.sub('Sub A (demo)', jsonb_build_array(
    pg_temp.li(902, 1), pg_temp.lr(pg_temp.key('b'), 0.5)))), 'ok', 'sub A uses sub B');

create temporary table before_state as
  select (select count(*) from public.recipe) as versions, (select count(*) from public.recipe_line) as line_rows;
grant select on before_state to authenticated;

select matches(pg_temp.mkverr(pg_temp.key('b'), 1, pg_temp.sub('Sub B (demo)', jsonb_build_array(
    pg_temp.li(902, 1), pg_temp.lr(pg_temp.key('a'), 0.5)))), '^P0001 recipe_cycle',
  'a version of B that uses A closes a loop: recipe_cycle (AT2)');
select ok(pg_temp.mkverr(pg_temp.key('b'), 1, pg_temp.sub('Sub B (demo)', jsonb_build_array(
    pg_temp.li(902, 1), pg_temp.lr(pg_temp.key('a'), 0.5)))) like '%' || pg_temp.key('a')::text || '%'
  and pg_temp.mkverr(pg_temp.key('b'), 1, pg_temp.sub('Sub B (demo)', jsonb_build_array(
    pg_temp.li(902, 1), pg_temp.lr(pg_temp.key('a'), 0.5)))) like '%' || pg_temp.key('b')::text || '%',
  'the detail lists both keys');
select is((select current_version from public.recipe_key where id = pg_temp.key('b')), 1, 'B stays at its old version');
select is((select (versions, line_rows)::text from before_state),
  (select (count(*), (select count(*) from public.recipe_line))::text from public.recipe),
  'and no version or line row was added');

select matches(pg_temp.mkverr(pg_temp.key('a'), 1, pg_temp.sub('Sub A (demo)', jsonb_build_array(
    pg_temp.li(902, 1), pg_temp.lr(pg_temp.key('a'), 0.5)))), '^P0001 recipe_cycle', 'A that uses itself is a cycle');

-- A -> B -> C -> A.
select is(pg_temp.mk('c', 'sub', pg_temp.sub('Sub C (demo)', jsonb_build_array(pg_temp.li(902, 1)))), 'ok', 'sub C');
select is(pg_temp.mkv('b2', pg_temp.key('b'), 1, pg_temp.sub('Sub B (demo)', jsonb_build_array(
    pg_temp.li(902, 1), pg_temp.lr(pg_temp.key('c'), 0.5)))), 'ok', 'B uses C: A -> B -> C');
select matches(pg_temp.mkverr(pg_temp.key('c'), 1, pg_temp.sub('Sub C (demo)', jsonb_build_array(
    pg_temp.li(902, 1), pg_temp.lr(pg_temp.key('a'), 0.5)))), '^P0001 recipe_cycle', 'C using A closes A -> B -> C -> A');
select is((select count(*)::int from public.recipe where recipe_key = pg_temp.key('c')), 1, 'C has no new version');

-- A diamond is not a cycle.
select is(pg_temp.mk('z', 'sub', pg_temp.sub('Sub Z (demo)', jsonb_build_array(pg_temp.li(902, 1)))), 'ok', 'sub Z');
select is(pg_temp.mk('x', 'sub', pg_temp.sub('Sub X (demo)', jsonb_build_array(pg_temp.lr(pg_temp.key('z'), 1)))), 'ok', 'X uses Z');
select is(pg_temp.mk('y', 'sub', pg_temp.sub('Sub Y (demo)', jsonb_build_array(pg_temp.lr(pg_temp.key('z'), 1)))), 'ok', 'Y uses Z');
select is(pg_temp.mk('p', 'plate', pg_temp.plate('Piatto P (demo)', jsonb_build_array(
    pg_temp.lr(pg_temp.key('x'), 1), pg_temp.lr(pg_temp.key('y'), 1)))), 'ok', 'a plate that uses X and Y, both using Z, is accepted');

-- A new sub that uses A cannot close a loop: nothing points at it yet.
select is(pg_temp.mk('n', 'sub', pg_temp.sub('Sub N (demo)', jsonb_build_array(pg_temp.lr(pg_temp.key('a'), 1)))), 'ok',
  'create_recipe of a new sub that uses A is accepted');

-- Depth: a chain of 12 is fine, a 13th level is refused.
create function pg_temp.chain(p_levels int) returns text language plpgsql as $f$
declare
  r text;
  prev uuid;
  i int;
begin
  for i in 1..p_levels loop
    r := pg_temp.mk('lvl' || i, 'sub', pg_temp.sub('Livello ' || i || ' (demo)',
      case when i = 1 then jsonb_build_array(pg_temp.li(902, 1)) else jsonb_build_array(pg_temp.lr(prev, 1)) end));
    if r <> 'ok' then return 'level ' || i || ': ' || r; end if;
    prev := pg_temp.key('lvl' || i);
  end loop;
  return 'ok';
end
$f$;
grant execute on function pg_temp.chain(int) to authenticated;
select is(pg_temp.chain(12), 'ok', 'a chain of 12 levels is accepted');
select matches(pg_temp.mkerr('sub', pg_temp.sub('Livello 13 (demo)', jsonb_build_array(pg_temp.lr(pg_temp.key('lvl12'), 1)))),
  '^P0001 recipe_too_deep', 'a 13th level is refused: recipe_too_deep');

select * from finish();
rollback;
