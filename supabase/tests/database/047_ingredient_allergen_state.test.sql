-- M7 step 1: ingredient allergen state (M7 plan §3.1.6, §3.2). null = not stated, '{}' = declared
-- none; a confirmation is set only by confirm_ingredient_allergens (owner, admin) and cleared by
-- any change of the list. Covers AT6 (database half, existing rows and confirmation).
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

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
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco A'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere A'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Supporto Demo');

create function pg_temp.iid(n int) returns uuid language sql immutable as $$
  select ('1a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
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
create function pg_temp.confirm(n int, p_allergens public.allergen[]) returns text language sql as $$
  select pg_temp.err(format('select public.confirm_ingredient_allergens(%L, %L)', pg_temp.iid(n), p_allergens)) $$;
create function pg_temp.st(n int) returns text language sql as $$
  select coalesce(allergens::text, 'null') || ' ' || allergen_status
    from public.ingredient where id = pg_temp.iid(n) $$;
create function pg_temp.audit_count(n int) returns int language sql as $$
  select count(*)::int from public.audit_event
   where entity_id = pg_temp.iid(n) and action = 'ingredient.allergens_confirmed' $$;
grant execute on function pg_temp.iid(int), pg_temp.act_as(uuid, uuid, text), pg_temp.err(text),
  pg_temp.confirm(int, public.allergen[]), pg_temp.st(int), pg_temp.audit_count(int) to authenticated;

-- Ingredients (fake): 1 declared none '{}', 2 '{glutine}', 3 not stated (null), 4 confirmed none,
-- 5 to confirm, 6 to confirm as admin, 7 for the double tap, 8 for the guard, 9 tenant A chef/waiter target.
insert into public.ingredient (id, tenant_id, name, base_unit, allergens) values
  (pg_temp.iid(1), '11111111-1111-4111-8111-111111111111', 'Sale (demo)', 'kg', '{}'),
  (pg_temp.iid(2), '11111111-1111-4111-8111-111111111111', 'Farina (demo)', 'kg', '{glutine}'),
  (pg_temp.iid(3), '11111111-1111-4111-8111-111111111111', 'Mais (demo)', 'kg', null);
insert into public.ingredient (id, tenant_id, name, base_unit, allergens, allergens_confirmed_at,
                               allergens_confirmed_by)
  values (pg_temp.iid(4), '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'l', '{}', now(),
          'a1000000-0000-4000-8000-00000000000a');
insert into public.ingredient (id, tenant_id, name, base_unit, allergens) values
  (pg_temp.iid(5), '11111111-1111-4111-8111-111111111111', 'Burro (demo)', 'kg', '{latte}'),
  (pg_temp.iid(6), '11111111-1111-4111-8111-111111111111', 'Uova (demo)', 'pz', '{uova}'),
  (pg_temp.iid(7), '11111111-1111-4111-8111-111111111111', 'Latte (demo)', 'l', '{latte}'),
  (pg_temp.iid(8), '11111111-1111-4111-8111-111111111111', 'Pane (demo)', 'pz', '{glutine}'),
  (pg_temp.iid(9), '11111111-1111-4111-8111-111111111111', 'Olio (demo)', 'l', '{}');

-- AT6, existing rows: the conversion turns unconfirmed '{}' into unknown, and only those.
select is(app.allergens_blank_to_unknown(), 2, 'the conversion changes the two unconfirmed empty lists');
select is(pg_temp.st(1), 'null unknown', 'an empty list becomes not stated');
select is(pg_temp.st(2), '{glutine} declared', 'a stated list stays, as declared');
select is(pg_temp.st(3), 'null unknown', 'null stays null');
select is(pg_temp.st(4), '{} confirmed', 'a confirmed empty list is kept: it is a person''s statement');
select is(app.allergens_blank_to_unknown(), 0, 'a second call changes nothing');

-- Columns (T2).
select is((select allergen_status from public.ingredient where id = pg_temp.iid(5)), 'declared',
  'status declared: a list, not confirmed');
select is((select allergen_status from public.ingredient where id = pg_temp.iid(4)), 'confirmed', 'status confirmed');
insert into public.ingredient (id, tenant_id, name, base_unit)
  values (pg_temp.iid(20), '11111111-1111-4111-8111-111111111111', 'Senza lista (demo)', 'kg');
select is(pg_temp.st(20), 'null unknown', 'an insert without allergens is not stated: the column has no default');
select throws_ok(format($$ update public.ingredient set allergens_confirmed_at = now() where id = %L $$, pg_temp.iid(20)),
  '23514', null, 'a confirmation time without a person is refused');
select throws_ok(format($$ update public.ingredient set allergens_confirmed_at = now(),
    allergens_confirmed_by = 'a1000000-0000-4000-8000-00000000000a' where id = %L $$, pg_temp.iid(20)),
  '23514', null, 'a confirmation with no list is refused');
select throws_ok(format($$ update public.ingredient set allergens_confirmed_by = 'a1000000-0000-4000-8000-00000000000a'
    where id = %L $$, pg_temp.iid(5)),
  '23514', null, 'a person without a confirmation time is refused');
select throws_ok(format($$ update public.ingredient set allergens_confirmed_at = now(),
    allergens_confirmed_by = 'b1000000-0000-4000-8000-00000000000b' where id = %L $$, pg_temp.iid(5)),
  '23503', null, 'the confirming user must belong to the same tenant');

select ok(not has_column_privilege('authenticated', 'public.ingredient', 'allergens_confirmed_at', 'insert')
      and not has_column_privilege('authenticated', 'public.ingredient', 'allergens_confirmed_at', 'update')
      and not has_column_privilege('authenticated', 'public.ingredient', 'allergens_confirmed_by', 'insert')
      and not has_column_privilege('authenticated', 'public.ingredient', 'allergens_confirmed_by', 'update'),
  'authenticated cannot write the confirmation columns');
select ok(has_column_privilege('authenticated', 'public.ingredient', 'allergens', 'update')
      and has_column_privilege('authenticated', 'public.ingredient', 'allergens', 'insert')
      and has_column_privilege('authenticated', 'public.ingredient', 'allergen_status', 'select')
      and has_column_privilege('authenticated', 'public.ingredient', 'allergens_confirmed_at', 'select'),
  'the list stays writable (M1) and the new columns are readable');

-- Confirm.
select ok((select bool_and(has_function_privilege('authenticated', f, 'execute')
                           and not has_function_privilege('anon', f, 'execute')
                           and not has_function_privilege('service_role', f, 'execute')
                           and not has_function_privilege('public', f, 'execute'))
             from unnest(array['public.confirm_ingredient_allergens(uuid, public.allergen[])']) f),
  'only authenticated can execute confirm_ingredient_allergens');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
             from pg_proc p where p.oid = 'public.confirm_ingredient_allergens(uuid, public.allergen[])'::regprocedure),
  'confirm_ingredient_allergens is SECURITY DEFINER with an empty search_path');
select ok(not has_function_privilege('authenticated', 'app.allergens_blank_to_unknown()', 'execute')
      and not has_function_privilege('anon', 'app.allergens_blank_to_unknown()', 'execute')
      and not has_function_privilege('service_role', 'app.allergens_blank_to_unknown()', 'execute'),
  'no API role can run the conversion');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.confirm(5, '{latte,glutine}'), 'ok', 'the owner confirms a list');
select is(pg_temp.st(5), '{glutine,latte} confirmed', 'stored de-duplicated in enum order, status confirmed');
select is((select allergens_confirmed_by from public.ingredient where id = pg_temp.iid(5)),
  'a1000000-0000-4000-8000-00000000000a'::uuid, 'confirmed by the owner''s app_user id');
select is((select allergens_confirmed_at is not null from public.ingredient where id = pg_temp.iid(5)), true,
  'with a time');
select is(pg_temp.audit_count(5), 1, 'one audit event');
select is((select before::text || ' ' || after::text from public.audit_event
            where entity_id = pg_temp.iid(5) and action = 'ingredient.allergens_confirmed'),
  '{"status": "declared", "allergens": ["latte"]} {"allergens": ["glutine", "latte"]}',
  'before: the old list and state; after: the confirmed list');
select is(pg_temp.confirm(1, '{}'), 'ok', 'an empty array confirms "none"');
select is(pg_temp.st(1), '{} confirmed', 'declared none and confirmed');

-- A double tap is a no-op: same time, no second audit row.
create temporary table first_confirm as select public.confirm_ingredient_allergens(pg_temp.iid(7), '{latte}') as r;
grant select on first_confirm to authenticated;
select is(public.confirm_ingredient_allergens(pg_temp.iid(7), '{latte,latte}'), (select r from first_confirm),
  'confirming the same set again returns the stored confirmation');
select is(pg_temp.audit_count(7), 1, 'and writes no second audit row');
select is((select r ->> 'status' from first_confirm), 'confirmed', 'the result carries the status');

select is(pg_temp.err(format('select public.confirm_ingredient_allergens(%L, null)', pg_temp.iid(8))),
  'P0001 allergens_required', 'a null list is refused: an empty array is the way to say none');
select is(pg_temp.err(format('select public.confirm_ingredient_allergens(%L, ''{}'')',
  '1a000000-0000-4000-8000-0000000000ff')), 'P0002 not_found', 'an unknown ingredient is not found');

select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.confirm(6, '{uova}'), 'ok', 'the admin may confirm (founder Q6 default)');
select is(pg_temp.st(6), '{uova} confirmed', 'and it is confirmed');

select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.confirm(8, '{glutine}'), '42501 permission denied: confirming allergens needs owner or admin',
  'a chef cannot confirm');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.confirm(8, '{glutine}'), 5), '42501', 'a waiter cannot confirm');
select set_config('request.jwt.claims', '', true);
select is(left(pg_temp.confirm(8, '{glutine}'), 5), '42501', 'a caller with no claims cannot confirm');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.confirm(8, '{glutine}'), 'P0002 not_found', 'owner B cannot confirm tenant A''s ingredient');
select is(pg_temp.confirm(5, '{glutine}'), 'P0002 not_found', 'nor a confirmed one');

-- Guard: a changed list clears the confirmation; an unrelated column keeps it.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select public.confirm_ingredient_allergens(pg_temp.iid(8), '{glutine}');
update public.ingredient set category = 'Panetteria' where id = pg_temp.iid(8);
select is(pg_temp.st(8), '{glutine} confirmed', 'an update of the category keeps the confirmation');
update public.ingredient set allergens = '{glutine}' where id = pg_temp.iid(8);
select is(pg_temp.st(8), '{glutine} confirmed', 'writing the same list keeps it');
update public.ingredient set allergens = '{glutine,latte}' where id = pg_temp.iid(8);
select is(pg_temp.st(8), '{glutine,latte} declared', 'a changed list clears the confirmation');
select is((select allergens_confirmed_by is null from public.ingredient where id = pg_temp.iid(8)), true,
  'and the person');
select public.confirm_ingredient_allergens(pg_temp.iid(8), '{glutine,latte}');
update public.ingredient set allergens = null where id = pg_temp.iid(8);
select is(pg_temp.st(8), 'null unknown', 'back to not stated also clears it');
select public.confirm_ingredient_allergens(pg_temp.iid(8), '{}');
update public.ingredient set allergens = '{latte,glutine}' where id = pg_temp.iid(9);
select is(pg_temp.st(9), '{latte,glutine} declared', 'an unconfirmed row can be edited freely (the order is the caller''s)');

reset role;
select lives_ok($$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'recipe', gen_random_uuid(), 'recipe.deactivated',
            'a1000000-0000-4000-8000-00000000000a') $$,
  'audit_event accepts recipe events');
select lives_ok($$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'recipe', gen_random_uuid(), 'recipe.reactivated',
            'a1000000-0000-4000-8000-00000000000a') $$,
  'and recipe.reactivated');
select throws_ok($$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'recipe', gen_random_uuid(), 'recipe.deleted',
            'a1000000-0000-4000-8000-00000000000a') $$,
  '23514', null, 'the action list is still closed');

select * from finish();
rollback;
