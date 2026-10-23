-- M7 review round 1, finding 1: the depth cap holds for every writer, measured through the changed
-- recipe (users above + levels below), and recipe_allergen_summary fails closed when a walk meets
-- more than the cap (it never reports "confirmed" over a part it did not read). The cap is 12
-- recipes on any path (plate, subs, ingredients not counted).
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

-- Fake ingredients: 901 confirmed (no allergens), 902 not stated.
insert into public.ingredient (id, tenant_id, name, base_unit, allergens, is_active) values
  (pg_temp.uid(901), '11111111-1111-4111-8111-111111111111', 'Sale (demo)', 'kg', '{}', true),
  (pg_temp.uid(902), '11111111-1111-4111-8111-111111111111', 'Ignoto (demo)', 'kg', null, true);

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.run(format('select public.confirm_ingredient_allergens(%L, %L)', pg_temp.uid(901), '{}')), 'ok',
  'the owner confirms ingredient 901 as allergen-free');

-- Plate P uses S1; S1..S11 are built bottom-up: each new Si is saved first, then a new version of
-- S(i-1) adds it. S11 uses the unconfirmed ingredient 902. P, S1 ... S11 are 12 recipes on one path.
create function pg_temp.bottom_up(p_last int) returns text language plpgsql as $f$
declare
  r text;
  i int;
begin
  r := pg_temp.mk('s1', 'sub', pg_temp.sub('Livello 1 (demo)', jsonb_build_array(pg_temp.li(901, 1))));
  if r <> 'ok' then return 's1: ' || r; end if;
  r := pg_temp.mk('p', 'plate', pg_temp.plate('Piatto P (demo)', jsonb_build_array(pg_temp.lr(pg_temp.key('s1'), 0.2))));
  if r <> 'ok' then return 'p: ' || r; end if;
  for i in 2..p_last loop
    r := pg_temp.mk('s' || i, 'sub', pg_temp.sub('Livello ' || i || ' (demo)',
      jsonb_build_array(pg_temp.li(case when i = p_last then 902 else 901 end, 1))));
    if r <> 'ok' then return 'create s' || i || ': ' || r; end if;
    r := pg_temp.mkv('s' || (i - 1) || 'v2', pg_temp.key('s' || (i - 1)), 1,
      pg_temp.sub('Livello ' || (i - 1) || ' (demo)', jsonb_build_array(
        pg_temp.li(case when i - 1 = p_last then 902 else 901 end, 1), pg_temp.lr(pg_temp.key('s' || i), 0.5))));
    if r <> 'ok' then return 'version of s' || (i - 1) || ': ' || r; end if;
  end loop;
  return 'ok';
end
$f$;
grant execute on function pg_temp.bottom_up(int) to authenticated;
select is(pg_temp.bottom_up(11), 'ok', 'a bottom-up chain of exactly 12 recipes on one path (P, S1 .. S11) is accepted');

-- Above: U is a lone sub that P also uses (P, U are 2 recipes). Saving U with a line to S1 would make
-- P, U, S1 .. S11 = 13 recipes on one path. Looked at from U alone it is only 12 (U, S1 .. S11), so
-- the old check, which measured below the changed recipe only, accepted it.
select is(pg_temp.mk('u', 'sub', pg_temp.sub('Livello U (demo)', jsonb_build_array(pg_temp.li(901, 1)))), 'ok', 'U on its own');
select is(pg_temp.mkv('pv2', pg_temp.key('p'), 1, pg_temp.plate('Piatto P (demo)', jsonb_build_array(
    pg_temp.lr(pg_temp.key('s1'), 0.2), pg_temp.lr(pg_temp.key('s2'), 0.1), pg_temp.lr(pg_temp.key('u'), 0.1)))), 'ok',
  'a new version of P with shorter branches to S2 and U is accepted (the longest path is still 12)');
select matches(pg_temp.mkverr(pg_temp.key('u'), 1, pg_temp.sub('Livello U (demo)', jsonb_build_array(
    pg_temp.li(901, 1), pg_temp.lr(pg_temp.key('s1'), 0.5)))), '^P0001 recipe_too_deep',
  'a new version of U that puts 12 recipes below a recipe used by P is refused: the depth is measured above as well');
select is((select current_version from public.recipe_key where id = pg_temp.key('u')), 1, 'U stays at its version');

-- The import is a writer too (a new version of U by name).
select matches(pg_temp.run(format('select public.import_recipes(%L, false)', jsonb_build_array(
    jsonb_build_object('name', 'Livello U (demo)', 'type', 'sub', 'outputQty', 1, 'outputUnit', 'kg',
      'lines', jsonb_build_array(
        jsonb_build_object('ingredient', 'Sale (demo)', 'qty', 1, 'unit', 'kg'),
        jsonb_build_object('recipe', 'Livello 1 (demo)', 'qty', 0.5, 'unit', 'kg')))))),
  '^P0001 recipe_too_deep', 'import_recipes of the same new version of U is refused too');
select is((select count(*)::int from public.recipe where recipe_key = pg_temp.key('u')), 1,
  'and the import wrote no version');

-- The 13th: S12 is created alone, then S11 gets a new version that uses it.
select is(pg_temp.mk('s12', 'sub', pg_temp.sub('Livello 12 (demo)', jsonb_build_array(pg_temp.li(901, 1)))), 'ok',
  'S12 on its own is fine');
select matches(pg_temp.mkverr(pg_temp.key('s11'), 1, pg_temp.sub('Livello 11 (demo)', jsonb_build_array(
    pg_temp.li(902, 1), pg_temp.lr(pg_temp.key('s12'), 0.5)))), '^P0001 recipe_too_deep',
  'a new version of S11 that makes the path through it 13 recipes long is refused: recipe_too_deep');
select is((select current_version from public.recipe_key where id = pg_temp.key('s11')), 1,
  'S11 stays at its version');
select is((select count(*)::int from public.recipe where recipe_key = pg_temp.key('s11')), 1,
  'and no version row was written');

-- The same through another sub: S11 is the bottom whichever 13th recipe is added.
select is(pg_temp.mk('s12b', 'sub', pg_temp.sub('Livello 12b (demo)', jsonb_build_array(pg_temp.li(901, 1)))), 'ok',
  'S12b on its own is fine');
select matches(pg_temp.mkverr(pg_temp.key('s11'), 1, pg_temp.sub('Livello 11 (demo)', jsonb_build_array(
    pg_temp.li(902, 1), pg_temp.lr(pg_temp.key('s12b'), 0.5)))), '^P0001 recipe_too_deep',
  'the same through any other sub');
-- Summary at the cap: all 12 recipes are read, so the unconfirmed ingredient at the bottom shows.
select is((select (s.confirmed, s.unconfirmed_ingredient_ids)::text
             from public.recipe_allergen_summary(array[pg_temp.key('p')]) s),
  format('(f,{%s})', pg_temp.uid(902)), 'a path at the cap is read to the bottom: P reports ingredient 902 as unconfirmed');

-- Data that already breaks the cap (written before this guard, or by a bug): craft S11 v2 -> S12 as
-- the table owner, bypassing the procedures. P now reaches 13 recipes; everything below is confirmed.
reset role;
insert into public.recipe (tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.key('s11'), 2, now() + interval '1 hour',
          'Livello 11 (demo)', 1, 'kg', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, yield_factor, created_by)
  select '11111111-1111-4111-8111-111111111111', r.id, 1, pg_temp.uid(901), 1, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a'
    from public.recipe r where r.recipe_key = pg_temp.key('s11') and r.version = 2;
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by)
  select '11111111-1111-4111-8111-111111111111', r.id, 2, pg_temp.key('s12'), 1, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a'
    from public.recipe r where r.recipe_key = pg_temp.key('s11') and r.version = 2;
update public.recipe_key set current_version = 2 where id = pg_temp.key('s11');
set local role authenticated;

select is((select s.confirmed from public.recipe_allergen_summary(array[pg_temp.key('p')]) s), false,
  'P now reaches 13 recipes, all confirmed: the summary fails closed (confirmed = false)');
select is((select s.confirmed from public.recipe_allergen_summary(array[pg_temp.key('s1')]) s), true,
  'S1 reaches 12 recipes: still read in full and confirmed');
select is((select s.confirmed from public.recipe_allergen_summary(array[pg_temp.key('s12')]) s), true,
  'a recipe nowhere near the cap is not affected');

select * from finish();
rollback;
