-- M15 step 9 (Q16 = project V6, M12 Q1): the role catalogue of the batch actions. The waiter has no access at all; the
-- chef adjusts, discards, splits, confirms and sets rules, reads quantities, but cannot call waste_costs (EUR); admin and
-- owner are allowed all nine; nobody without claims gets in; no API role writes a table directly (so batch.state can only
-- be moved by the procedures); anon and service_role execute nothing. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
                           portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e1', 1, '2026-10-01T00:00Z', 'Ragù (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq,
    produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, state,
    location_id, created_by)
  values ('ba000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111',
    'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1,
    to_char((now() at time zone 'Europe/Rome')::date, 'YYMMDD') || '-RAGUDE-1', (now() at time zone 'Europe/Rome')::date, 'RAGUDE', 1,
    now() - interval '1 hour', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 10, 10, 48, now() + interval '47 hours', 'fresh',
    '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'produce', 10, 'batch',
    'ba000000-0000-4000-8000-0000000000b1', (now() at time zone 'Europe/Rome')::date, 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids, cost_at, created_by)
  values ('ba000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', 20, 2, false, '{}', now(),
    'a1000000-0000-4000-8000-00000000000a');
insert into public.staff_meal_rule (id, tenant_id, recipe_key, default_count, created_by, updated_by)
  values ('5e000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
    'ec000000-0000-4000-8000-0000000000e1', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.staff_meal_confirmation (tenant_id, rule_id, business_date, count, created_by)
  values ('11111111-1111-4111-8111-111111111111', '5e000000-0000-4000-8000-0000000000a1', '2026-01-01', 2,
    'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate;
  return state;
end
$$;
create function pg_temp.seen(rel text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute format('select count(*) from public.%I', rel) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end
$$;
-- The nine functions called with arguments of the right shape: the role check comes first in each.
create temporary table fn_result (who text, fn text, sqlstate text, primary key (who, fn));
grant all on fn_result to authenticated;
create function pg_temp.call_all(p_who text) returns void language plpgsql as $$
declare
  c record;
begin
  for c in
    select * from (values
      ('adjust_batch', $q$ select public.adjust_batch(gen_random_uuid(), 1) $q$),
      ('discard_batch', $q$ select public.discard_batch(gen_random_uuid(), 1, 'spoilage') $q$),
      ('split_batch', $q$ select public.split_batch(gen_random_uuid(), 1, 24) $q$),
      ('set_staff_meal_rule', $q$ select public.set_staff_meal_rule(null, null, 1) $q$),
      ('confirm_staff_meal', $q$ select public.confirm_staff_meal(gen_random_uuid()) $q$),
      ('batch_detail', $q$ select public.batch_detail(gen_random_uuid()) $q$),
      ('batch_label', $q$ select public.batch_label(gen_random_uuid()) $q$),
      ('staff_meal_rules', $q$ select public.staff_meal_rules() $q$),
      ('waste_costs', $q$ select public.waste_costs(current_date, current_date) $q$)) v (fn, stmt)
  loop
    insert into fn_result values (p_who, c.fn, pg_temp.err(c.stmt));
  end loop;
end
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text), pg_temp.seen(text), pg_temp.call_all(text) to authenticated;

set local role authenticated;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select pg_temp.call_all('waiter');
select is(pg_temp.seen('staff_meal_rule') + pg_temp.seen('staff_meal_confirmation'), 0::bigint, 'waiter: 0 rows of both staff-meal tables');
select pg_temp.act_as('00000000-0000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'none');
select pg_temp.call_all('none');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select pg_temp.call_all('chef');
select is(pg_temp.seen('staff_meal_rule') || '/' || pg_temp.seen('staff_meal_confirmation'), '1/1', 'chef: reads the rule and the confirmation');
select is(pg_temp.err($$ insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on)
    values ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b1', 'count', 1, 'batch_adjust',
    gen_random_uuid(), current_date) $$), '42501', 'chef: cannot insert a batch movement directly');
select is(pg_temp.err($$ update public.batch set state = 'finished' where id = 'ba000000-0000-4000-8000-0000000000b1' $$), '42501',
  'chef: cannot move batch.state directly (only the procedures do)');
select is(pg_temp.err($$ insert into public.staff_meal_confirmation (tenant_id, rule_id, business_date, count)
    values ('11111111-1111-4111-8111-111111111111', '5e000000-0000-4000-8000-0000000000a1', '2026-02-02', 1) $$), '42501',
  'chef: cannot insert a confirmation directly');
select is(pg_temp.err($$ update public.staff_meal_rule set is_active = false $$), '42501', 'chef: cannot update a rule directly');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select pg_temp.call_all('admin');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select pg_temp.call_all('owner');
select is(pg_temp.err($$ update public.batch set state = 'finished' where id = 'ba000000-0000-4000-8000-0000000000b1' $$), '42501',
  'owner: cannot move batch.state directly either');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.seen('staff_meal_rule') + pg_temp.seen('staff_meal_confirmation'), 0::bigint, 'owner B: none of A''s staff-meal rows');
reset role;

-- The matrix ---------------------------------------------------------------------------------------------------
select is((select count(*)::int from fn_result), 45, 'five callers times nine functions were exercised');
select is_empty($$ select fn from fn_result where who = 'waiter' and sqlstate <> '42501' $$, 'waiter: all nine are refused (42501)');
select is_empty($$ select fn from fn_result where who = 'none' and sqlstate <> '42501' $$, 'no claims: all nine are refused (42501)');
select is((select array_agg(fn order by fn) from fn_result where who = 'chef' and sqlstate = '42501'), array['waste_costs'],
  'chef: only waste_costs (EUR) is refused');
select is((select string_agg(fn || '=' || sqlstate, ',' order by fn) from fn_result where who = 'chef' and fn <> 'waste_costs'),
  'adjust_batch=P0002,batch_detail=P0002,batch_label=P0002,confirm_staff_meal=P0002,discard_batch=P0002,set_staff_meal_rule=P0001,split_batch=P0002,staff_meal_rules=ok',
  'chef: the other eight run (and fail only on the dummy ids)');
select is_empty($$ select fn from fn_result where who in ('admin', 'owner') and sqlstate = '42501' $$, 'admin and owner: none is refused');
select is((select string_agg(fn || '=' || sqlstate, ',' order by fn) from fn_result where who = 'owner'),
  'adjust_batch=P0002,batch_detail=P0002,batch_label=P0002,confirm_staff_meal=P0002,discard_batch=P0002,set_staff_meal_rule=P0001,split_batch=P0002,staff_meal_rules=ok,waste_costs=ok',
  'owner: the same results, and waste_costs runs');
select is((select string_agg(fn || '=' || sqlstate, ',' order by fn) from fn_result where who = 'admin'),
  (select string_agg(fn || '=' || sqlstate, ',' order by fn) from fn_result where who = 'owner'), 'admin: the same as the owner');

-- Grants ----------------------------------------------------------------------------------------------------
select is_empty(
  $$ select f || ':' || r from unnest(array['adjust_batch(uuid,numeric)', 'discard_batch(uuid,numeric,text)',
         'split_batch(uuid,integer,integer,uuid)', 'set_staff_meal_rule(uuid,uuid,numeric,text,uuid,boolean)',
         'confirm_staff_meal(uuid,numeric)', 'batch_detail(uuid)', 'batch_label(uuid)', 'staff_meal_rules()',
         'waste_costs(date,date)']) f, unnest(array['anon', 'service_role']) r
      where has_function_privilege(r, ('public.' || f)::regprocedure, 'execute') $$,
  'anon and service_role execute none of the nine');
select is_empty(
  $$ select f from unnest(array['adjust_batch(uuid,numeric)', 'discard_batch(uuid,numeric,text)',
         'split_batch(uuid,integer,integer,uuid)', 'set_staff_meal_rule(uuid,uuid,numeric,text,uuid,boolean)',
         'confirm_staff_meal(uuid,numeric)', 'batch_detail(uuid)', 'batch_label(uuid)', 'staff_meal_rules()',
         'waste_costs(date,date)']) f
      where not has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute')
         or has_function_privilege('public', ('public.' || f)::regprocedure, 'execute') $$,
  'authenticated executes all nine, and PUBLIC none');
select is_empty(
  $$ select f from unnest(array['adjust_batch(uuid,numeric)', 'discard_batch(uuid,numeric,text)',
         'split_batch(uuid,integer,integer,uuid)', 'set_staff_meal_rule(uuid,uuid,numeric,text,uuid,boolean)',
         'confirm_staff_meal(uuid,numeric)', 'batch_detail(uuid)', 'batch_label(uuid)', 'staff_meal_rules()',
         'waste_costs(date,date)']) f
      where not (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = ('public.' || f)::regprocedure) $$,
  'all nine are definer with an empty search_path');
select is_empty(
  $$ select p.proname || ':' || r from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
      where p.pronamespace = 'app'::regnamespace
        and p.proname in ('batch_waste_reason_codes', 'business_date', 'lock_batch_rows', 'batch_remaining', 'batch_settle_state',
                          'confirm_staff_meal_core', 'staff_meal_rule_guard')
        and has_function_privilege(r, p.oid, 'execute') $$,
  'no API role executes any app helper of M15');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
            and p.proname in ('batch_waste_reason_codes', 'business_date', 'lock_batch_rows', 'batch_remaining', 'batch_settle_state',
                              'confirm_staff_meal_core', 'staff_meal_rule_guard')), 7, 'the seven app helpers exist, once each');
select is_empty(
  $$ select t || ':' || p from unnest(array['batch', 'batch_movement', 'batch_cost', 'staff_meal_rule', 'staff_meal_confirmation']) t,
       unnest(array['insert', 'update', 'delete', 'truncate']) p, unnest(array['anon', 'authenticated', 'service_role']) r
      where has_table_privilege(r, 'public.' || t, p) $$,
  'no API role can write the batch ledger, the batch cost or the staff-meal tables');

select * from finish();
rollback;
