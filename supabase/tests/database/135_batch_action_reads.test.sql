-- M15 step 6: batch_detail, the extended batch_label and staff_meal_rules (M15 plan §3.1.6, §3.2, §3.4; ADR-014).
-- Called under claims, as the API does. The batches are produced by direct inserts (the owner "Titolare Demo" is the
-- producer), the split and the staff meal by the real procedures run by the chef "Chef Demo". Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
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
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Congelatore (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Pane (demo)', 'kg', true),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Sale grosso (demo)', 'kg', true);
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'brodo (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
                           portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e1', 1, '2026-10-01T00:00Z', 'Ragù (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e2', 1, '2026-10-01T00:00Z', 'Brodo (demo)', 5, 'l', 20, 48, 'a1000000-0000-4000-8000-00000000000a');

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
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
create function pg_temp.as_chef() returns void language sql as $$
  select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef') $$;
create function pg_temp.keys(j jsonb) returns setof text language sql as $$
  select k from (select jsonb_object_keys(j) k) a
  union all
  select pg_temp.keys(v) from jsonb_each(j) e (k, v) where jsonb_typeof(v) = 'object'
  union all
  select pg_temp.keys(v) from jsonb_each(j) e (k, a), lateral jsonb_array_elements(a) v
   where jsonb_typeof(a) = 'array' and jsonb_typeof(v) = 'object'
$$;
-- A batch made by the owner p_age ago with p_shelf hours of shelf life, 10 portions, its produce movement and cost.
create sequence pg_temp.lot_seq;
create function pg_temp.mkbatch(p_id uuid, p_key text, p_code text, p_age interval, p_shelf int)
  returns void language plpgsql as $$
declare
  v_seq int := nextval('pg_temp.lot_seq');
begin
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
      lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial,
      shelf_life_hours, use_by, state, location_id, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', ('ec000000-0000-4000-8000-0000000000' || p_key)::uuid,
      ('ed000000-0000-4000-8000-0000000000d' || right(p_key, 1))::uuid, 1,
      to_char((now() at time zone 'Europe/Rome')::date, 'YYMMDD') || '-' || p_code || '-' || v_seq,
      (now() at time zone 'Europe/Rome')::date, p_code, v_seq, now() - p_age, 'a1000000-0000-4000-8000-00000000000a', 2, 'kg',
      10, 10, p_shelf, now() - p_age + make_interval(hours => p_shelf), 'fresh',
      '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_id, 'produce', 10, 'batch', p_id,
      (now() at time zone 'Europe/Rome')::date, now() - p_age, 'a1000000-0000-4000-8000-00000000000a');
  insert into public.batch_cost (batch_id, tenant_id, total_cost, unit_cost_frozen, incomplete, missing_ingredient_ids,
      cost_at, created_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', 20, 2, false, '{}', now() - p_age,
      'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- A movement of a batch with an explicit time.
create function pg_temp.mv(p_batch uuid, p_type text, p_portions numeric, p_ref_type text, p_reason text, p_ago interval,
    p_by uuid default 'c1000000-0000-4000-8000-00000000000c') returns void language sql as $$
  insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on,
      created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_batch, p_type::public.batch_movement_type, p_portions, p_reason,
      p_ref_type, gen_random_uuid(), (now() at time zone 'Europe/Rome')::date, now() - p_ago, p_by)
$$;
create temporary table res (k text primary key, j jsonb);
grant all on res to authenticated;
grant execute on function pg_temp.err(text), pg_temp.act_as(uuid, uuid, text), pg_temp.as_chef(), pg_temp.keys(jsonb) to authenticated;

-- R2: Ragù, made 2 h ago (10 portions, valid 46 h more). EX: expired. FIN: finished (counted to 0). MV: Brodo with a
-- history of movements at known times. BIG: 105 movements.
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b2', 'e1', 'RAGUDE', interval '2 hours', 48);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b4', 'e1', 'RAGUDE', interval '50 hours', 48);
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b5', 'e1', 'RAGUDE', interval '3 hours', 48);
select pg_temp.mv('ba000000-0000-4000-8000-0000000000b5', 'count', -10, 'batch_adjust', null, interval '1 hour');
update public.batch set state = 'finished' where id = 'ba000000-0000-4000-8000-0000000000b5';
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b6', 'e2', 'BRODOD', interval '6 hours', 48);
select pg_temp.mv('ba000000-0000-4000-8000-0000000000b6', 'count', -1, 'batch_adjust', null, interval '5 hours');
select pg_temp.mv('ba000000-0000-4000-8000-0000000000b6', 'waste', -3, 'batch_discard', 'spoilage', interval '4 hours',
  'a1000000-0000-4000-8000-00000000000a');
select pg_temp.mv('ba000000-0000-4000-8000-0000000000b6', 'waste', -2, 'staff_meal', 'staff_meal', interval '3 hours');
select pg_temp.mv('ba000000-0000-4000-8000-0000000000b6', 'split', -1, 'batch_split', null, interval '2 hours');
select pg_temp.mkbatch('ba000000-0000-4000-8000-0000000000b7', 'e2', 'BRODOD', interval '7 hours', 48);
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by)
  select '11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-0000000000b7', 'count', 1, 'batch_adjust',
         gen_random_uuid(), (now() at time zone 'Europe/Rome')::date, now() - make_interval(mins => n),
         'c1000000-0000-4000-8000-00000000000c' from generate_series(1, 105) n;

-- Grants -----------------------------------------------------------------------------------------------------
select is_empty(
  $$ select p.proname from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('batch_detail', 'staff_meal_rules', 'batch_label')
        and not (p.prosecdef and p.proconfig @> array['search_path=""']
                 and has_function_privilege('authenticated', p.oid, 'execute')
                 and not has_function_privilege('anon', p.oid, 'execute')
                 and not has_function_privilege('service_role', p.oid, 'execute')) $$,
  'the three reads are definer, have an empty search_path and are executable by authenticated only');

-- The split and the staff meal are done by the chef.
set local role authenticated;
select pg_temp.as_chef();
insert into res select 'sp', public.split_batch('ba000000-0000-4000-8000-0000000000b2', 4, 2160, '10000000-0000-4000-8000-0000000000a2');
insert into res select 'd0', public.batch_detail('ba000000-0000-4000-8000-0000000000b2');
insert into res select 'dc', public.batch_detail((select (j->>'newBatchId')::uuid from res where k = 'sp'));
insert into res select 'lc', public.batch_label((select (j->>'newBatchId')::uuid from res where k = 'sp'));
insert into res select 'lp', public.batch_label('ba000000-0000-4000-8000-0000000000b2');
insert into res select 'dx', public.batch_detail('ba000000-0000-4000-8000-0000000000b4');
insert into res select 'df', public.batch_detail('ba000000-0000-4000-8000-0000000000b5');
insert into res select 'dm', public.batch_detail('ba000000-0000-4000-8000-0000000000b6');
insert into res select 'db', public.batch_detail('ba000000-0000-4000-8000-0000000000b7');

-- batch_detail: the parent after the split ----------------------------------------------------------------------
select is((select (j->>'portionsRemaining')::numeric from res where k = 'd0'), 6::numeric, 'detail: the parent has 6 remaining after the split');
select is((select j->>'state' || '/' || (j->>'portionsInitial') || '/' || (j->>'lotCode') || '/' || (j->>'recipeName') || '/' || (j->>'locationName')
             from res where k = 'd0'),
  'open/10/' || to_char((now() at time zone 'Europe/Rome')::date, 'YYMMDD') || '-RAGUDE-1/Ragù (demo)/Cella (demo)',
  'detail: state, portions at production, lot, recipe and location name');
select is((select j->>'byInitials' || '/' || (j->>'byMe') || '/' || (j->>'createdByInitials') from res where k = 'd0'), 'TD/false/TD',
  'detail: made by the owner (TD), not by me, created by TD');
select is((select jsonb_array_length(j->'splits') from res where k = 'd0'), 1, 'detail: one split part');
select is((select (j->'splits'->0->>'batchId') = (select j->>'newBatchId' from res where k = 'sp')
                  and (j->'splits'->0->>'lotCode') = (select j->>'lotCode' from res where k = 'sp')
                  and (j->'splits'->0->>'portions')::numeric = 4 and (j->'splits'->0->>'locationName') = 'Congelatore (demo)'
             from res where k = 'd0'), true, 'detail: the split part names the child lot, 4 portions and the freezer');
select is((select j->'splitFrom' from res where k = 'd0'), 'null'::jsonb, 'detail: the parent has no splitFrom');
select is((select (j->'can'->>'adjust') || '/' || (j->'can'->>'discard') || '/' || (j->'can'->>'split') from res where k = 'd0'),
  'true/true/true', 'detail: can adjust, discard and split');
select is((select (j->'defaults'->>'hoursLeft')::int from res where k = 'd0'), 46, 'detail: 46 hours left (valid 48 h, made 2 h ago)');
select is((select jsonb_array_length(j->'movements') from res where k = 'd0'), 2, 'detail: two movements (produce, split)');
select is((select (j->'movements'->0->>'type') || '/' || trim_scale((j->'movements'->0->>'portions')::numeric) || '/' || (j->'movements'->0->>'refType')
                  || '/' || (j->'movements'->0->>'byInitials') || '/' || (j->'movements'->0->>'byMe')
             from res where k = 'd0'), 'split/-4/batch_split/CD/true', 'detail: the split row (-4, by me) comes first');
select is((select (j->'movements'->1->>'type') || '/' || (j->'movements'->1->>'byInitials') || '/' || (j->'movements'->1->>'byMe')
             from res where k = 'd0'), 'produce/TD/false', 'detail: then the produce row (by TD)');

-- batch_detail: the child ---------------------------------------------------------------------------------------
select is((select j->'splitFrom'->>'lotCode' || '/' || (j->'splitFrom'->>'batchId') from res where k = 'dc'),
  to_char((now() at time zone 'Europe/Rome')::date, 'YYMMDD') || '-RAGUDE-1/ba000000-0000-4000-8000-0000000000b2',
  'child: splitFrom names the parent lot and id');
select is((select j->>'createdByInitials' || '/' || (j->>'byInitials') || '/' || (j->>'state') || '/' || trim_scale((j->>'portionsRemaining')::numeric)
             from res where k = 'dc'), 'CD/TD/fresh/4', 'child: created by the chef (CD), produced by TD, fresh, 4 remaining');
select is((select (c.j->>'producedAt')::timestamptz = (select produced_at from public.batch where id = 'ba000000-0000-4000-8000-0000000000b2')
             from res c where c.k = 'dc'), true, 'child: producedAt is the parent''s');
select is((select (j->'movements'->0->>'type') || '/' || trim_scale((j->'movements'->0->>'portions')::numeric) from res where k = 'dc'), 'split/4',
  'child: its only movement is the +4 split');
select is((select jsonb_array_length(j->'splits') from res where k = 'dc'), 0, 'child: no split parts');

-- batch_detail: expired, finished -------------------------------------------------------------------------------
select is((select (j->'can'->>'adjust') || '/' || (j->'can'->>'discard') || '/' || (j->'can'->>'split') || '/' || (j->>'useByState')
             from res where k = 'dx'), 'true/true/false/expired', 'expired: can adjust and discard but not split');
select is((select j->'defaults'->'hoursLeft' from res where k = 'dx'), 'null'::jsonb, 'expired: hoursLeft is null');
select is((select (j->'can'->>'adjust') || '/' || (j->'can'->>'discard') || '/' || (j->'can'->>'split') || '/' || (j->>'state')
             from res where k = 'df'), 'true/false/false/finished', 'finished: can adjust (reopen) but not discard or split');

-- batch_detail: movements newest first, with reasons and initials ------------------------------------------------
select is((select string_agg(e->>'type' || ':' || coalesce(e->>'reasonCode', ''), ',' order by ord)
             from res r, jsonb_array_elements(r.j->'movements') with ordinality t (e, ord) where r.k = 'dm'),
  'split:,waste:staff_meal,waste:spoilage,count:,produce:', 'movements newest first: split, staff meal, discard, count, produce');
select is((select string_agg(coalesce(e->>'reasonCode', '-'), ',' order by ord)
             from res r, jsonb_array_elements(r.j->'movements') with ordinality t (e, ord) where r.k = 'dm'),
  '-,staff_meal,spoilage,-,-', 'reasonCode is null where there is none');
select is((select string_agg(e->>'byInitials' || ':' || (e->>'byMe'), ',' order by ord)
             from res r, jsonb_array_elements(r.j->'movements') with ordinality t (e, ord) where r.k = 'dm'),
  'CD:true,CD:true,TD:false,CD:true,TD:false', 'byInitials and byMe per movement');
select is((select jsonb_array_length(j->'movements') from res where k = 'db'), 100, 'at most 100 movements are listed');
select is((select (j->>'portionsRemaining')::numeric from res where k = 'db'), 115::numeric, 'while portionsRemaining still folds all 106 rows');

-- batch_detail: keys ----------------------------------------------------------------------------------------------
select is((select array_agg(x order by x collate "C") from res r, jsonb_object_keys(r.j) x where r.k = 'd0'),
  array['batchId', 'byInitials', 'byMe', 'can', 'createdAt', 'createdByInitials', 'defaults', 'locationId', 'locationName',
        'lotCode', 'movements', 'outputQty', 'outputUnit', 'portionsComputed', 'portionsInitial', 'portionsRemaining',
        'producedAt', 'recipeKey', 'recipeName', 'shelfLifeHours', 'splitFrom', 'splits', 'state', 'useBy', 'useByState',
        'version'],
  'detail has exactly the planned keys');
select is_empty($$ select kk.k from res r, lateral pg_temp.keys(r.j) kk (k)
                    where r.k in ('d0', 'dc', 'dx', 'df', 'dm', 'db', 'lc', 'lp') and kk.k ~* '(eur|cost|price|value|amount)' $$,
  'no key of the detail or the label looks like a value, a cost or a price');

-- batch_label (extended) ------------------------------------------------------------------------------------------
select is((select array_agg(x order by x collate "C") from res r, jsonb_object_keys(r.j) x where r.k = 'lp'),
  array['batchId', 'lotCode', 'operatorInitials', 'portions', 'portionsRemaining', 'producedAt', 'recipeName',
        'shelfLifeHours', 'splitFrom', 'useBy', 'version'],
  'the label keeps its M14 keys and gains portionsRemaining and splitFrom');
select is((select (j->>'portions')::int || '/' || trim_scale((j->>'portionsRemaining')::numeric) || '/' || (j->>'operatorInitials')
                  || '/' || (j->'splitFrom'->>'lotCode') from res where k = 'lc'),
  '4/4/TD/' || to_char((now() at time zone 'Europe/Rome')::date, 'YYMMDD') || '-RAGUDE-1',
  'reprint of the child: 4 portions, 4 remaining, the producer''s initials, "Diviso da" the parent lot');
select is((select (c.j->>'producedAt')::timestamptz = (p.j->>'producedAt')::timestamptz from res c, res p where c.k = 'lc' and p.k = 'lp'),
  true, 'the child label shows the original production time');
select is((select (j->>'portions')::int || '/' || trim_scale((j->>'portionsRemaining')::numeric) || '/' || (j->'splitFrom')::text from res where k = 'lp'),
  '10/6/null', 'the parent label: 10 at production, 6 remaining, no splitFrom');

-- Roles and tenancy ----------------------------------------------------------------------------------------------
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err($$ select public.batch_detail('ba000000-0000-4000-8000-0000000000b2') $$) ~ '^42501', true, 'waiter: batch_detail is refused');
select is(pg_temp.err($$ select public.staff_meal_rules() $$) ~ '^42501', true, 'waiter: staff_meal_rules is refused');
select is(pg_temp.err($$ select public.batch_label('ba000000-0000-4000-8000-0000000000b2') $$) ~ '^42501', true, 'waiter: batch_label is refused');
select pg_temp.act_as('00000000-0000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'none');
select is(pg_temp.err($$ select public.batch_detail('ba000000-0000-4000-8000-0000000000b2') $$) ~ '^42501', true, 'no role: batch_detail is refused');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err($$ select public.batch_detail('ba000000-0000-4000-8000-0000000000b2') $$), 'P0002 batch_not_found',
  'owner B: A''s batch -> P0002');
select is(pg_temp.err($$ select public.batch_label('ba000000-0000-4000-8000-0000000000b2') $$), 'P0002 batch_not_found',
  'owner B: A''s label -> P0002');
select is(pg_temp.err($$ select public.batch_detail(gen_random_uuid()) $$), 'P0002 batch_not_found', 'an unknown batch -> P0002');
select is(pg_temp.err($$ select public.batch_detail(null) $$), 'P0002 batch_not_found', 'a null batch -> P0002');
select is((public.staff_meal_rules()->'rules'), '[]'::jsonb, 'owner B sees no rule of A');

-- staff_meal_rules ------------------------------------------------------------------------------------------------
select pg_temp.as_chef();
insert into res select 'r1', public.set_staff_meal_rule('ec000000-0000-4000-8000-0000000000e1', null, 2);
insert into res select 'r2', public.set_staff_meal_rule(null, '1a000000-0000-4000-8000-00000000001a', 500, 'g',
  '10000000-0000-4000-8000-0000000000a1');
insert into res select 'r3', public.set_staff_meal_rule(null, '1b000000-0000-4000-8000-00000000001b', 1, 'kg',
  '10000000-0000-4000-8000-0000000000a1', false);
insert into res select 'm0', public.staff_meal_rules();
insert into res select 'cf', public.confirm_staff_meal((select (j->>'ruleId')::uuid from res where k = 'r1'));
insert into res select 'm1', public.staff_meal_rules();
reset role;

select is((select j->>'businessDate' from res where k = 'm0')::date, app.business_date('11111111-1111-4111-8111-111111111111', now()),
  'rules: businessDate is the business date of now');
select is((select array_agg(x order by x collate "C") from res r, jsonb_object_keys(r.j) x where r.k = 'm0'), array['businessDate', 'rules'],
  'rules: the answer has two keys');
select is((select string_agg(e->>'name', ',' order by ord) from res r, jsonb_array_elements(r.j->'rules') with ordinality t (e, ord)
            where r.k = 'm0'), 'Pane (demo),Ragù (demo),Sale grosso (demo)', 'rules: ordered by name; ingredient and recipe names');
select is((select array_agg(x order by x collate "C") from res r, jsonb_array_elements(r.j->'rules') e, jsonb_object_keys(e) x
            where r.k = 'm0' and e->>'name' = 'Ragù (demo)'),
  array['available', 'defaultCount', 'isActive', 'kind', 'locationId', 'name', 'ruleId', 'targetId', 'today', 'unit'],
  'rules: a rule has exactly the planned keys');
select is((select e->>'kind' || '/' || (e->>'unit') || '/' || trim_scale((e->>'defaultCount')::numeric) || '/' || (e->>'isActive')
                  || '/' || trim_scale((e->>'available')::numeric)
             from res r, jsonb_array_elements(r.j->'rules') e where r.k = 'm0' and e->>'name' = 'Ragù (demo)'),
  'recipe/porzioni/2/true/10', 'rules: Ragù is a recipe rule in portions with 10 available (6 + 4; the expired and finished batches do not count)');
select is((select e->>'kind' || '/' || (e->>'unit') || '/' || trim_scale((e->>'defaultCount')::numeric) || '/' || coalesce(e->>'available', 'null')
             from res r, jsonb_array_elements(r.j->'rules') e where r.k = 'm0' and e->>'name' = 'Pane (demo)'),
  'ingredient/kg/0.5/null', 'rules: Pane is an ingredient rule in kg (0.5), with no available figure');
select is((select e->>'isActive' from res r, jsonb_array_elements(r.j->'rules') e where r.k = 'm0' and e->>'name' = 'Sale grosso (demo)'),
  'false', 'rules: an inactive rule is listed with isActive false');
select is((select e->'today' from res r, jsonb_array_elements(r.j->'rules') e where r.k = 'm0' and e->>'name' = 'Ragù (demo)'),
  'null'::jsonb, 'rules: today is null before a confirmation');
select is((select e->'today'->>'byInitials' || '/' || trim_scale((e->'today'->>'count')::numeric) || '/' || (e->'today'->>'confirmationId')
                  || '/' || trim_scale((e->>'available')::numeric)
             from res r, jsonb_array_elements(r.j->'rules') e where r.k = 'm1' and e->>'name' = 'Ragù (demo)'),
  'CD/2/' || (select j->>'confirmationId' from res where k = 'cf') || '/8',
  'rules: after the confirmation, today names the chef (CD), the count and the confirmation; 8 are left');
select is((select (e->'today'->>'at')::timestamptz is not null from res r, jsonb_array_elements(r.j->'rules') e
            where r.k = 'm1' and e->>'name' = 'Ragù (demo)'), true, 'rules: today carries the time of the confirmation');
select is((select e->'today' from res r, jsonb_array_elements(r.j->'rules') e where r.k = 'm1' and e->>'name' = 'Pane (demo)'),
  'null'::jsonb, 'rules: the other rules have no confirmation today');
select is_empty($$ select kk.k from res r, lateral pg_temp.keys(r.j) kk (k)
                    where r.k in ('m0', 'm1', 'r1', 'r2', 'r3') and kk.k ~* '(eur|cost|price|value|amount)' $$,
  'rules: no key looks like a value, a cost or a price');

select * from finish();
rollback;
