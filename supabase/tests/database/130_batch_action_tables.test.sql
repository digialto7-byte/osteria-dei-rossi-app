-- M15 step 1: the batch movement shapes, the batch waste reasons and the staff-meal tables (M15 plan §3.1.1, §3.1.7,
-- §3.2; ADR-014). Rows are inserted as the migration owner, as 120 does. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

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
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Pane (demo)', 'kg', true),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Detersivo (demo)', 'kg', false);
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1,
   'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'sub', 1,
   'soffritto (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e4', '22222222-2222-4222-8222-222222222222', 'batch', 1,
   'brodo b (demo)', 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
                           portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e1', 1, '2026-10-01T00:00Z', 'Spezzatino (demo)', 6, 'kg', 30, 72,
   'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, created_by)
  values ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e3', 1, '2026-10-01T00:00Z', 'Soffritto (demo)', 1, 'kg',
   'a1000000-0000-4000-8000-00000000000a');

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
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text), pg_temp.seen(text) to authenticated;

insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code,
    lot_seq, produced_at, produced_by, output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours,
    use_by, location_id, created_by)
  values ('ba000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111',
    'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1, '261023-SPEZZA-1',
    '2026-10-23', 'SPEZZA', 1, '2026-10-23T08:00Z', 'c1000000-0000-4000-8000-00000000000c', 6.2, 'kg', 31, 31, 72,
    '2026-10-26T08:00Z', '10000000-0000-4000-8000-0000000000a1', 'c1000000-0000-4000-8000-00000000000c'),
    ('ba000000-0000-4000-8000-0000000000b2', '11111111-1111-4111-8111-111111111111',
    'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1, '261023-SPEZZA-2',
    '2026-10-23', 'SPEZZA', 2, '2026-10-23T08:00Z', 'c1000000-0000-4000-8000-00000000000c', 6.2, 'kg', 31, 31, 72,
    '2026-10-26T08:00Z', '10000000-0000-4000-8000-0000000000a1', 'c1000000-0000-4000-8000-00000000000c');

-- A batch_movement of batch b1 (ref_id null = the batch itself).
create function pg_temp.mkmove(
  p_type text, p_portions numeric, p_ref_type text, p_ref_id uuid default null, p_reason text default null,
  p_batch uuid default 'ba000000-0000-4000-8000-0000000000b1', p_reverses uuid default null
) returns uuid language sql as $$
  insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, reverses_id,
      effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_batch, p_type::public.batch_movement_type, p_portions, p_reason,
      p_ref_type, coalesce(p_ref_id, p_batch), p_reverses, '2026-10-23', 'c1000000-0000-4000-8000-00000000000c')
  returning id
$$;
create function pg_temp.mkrule(
  p_key uuid default null, p_ing uuid default null, p_count numeric default 2, p_loc uuid default null,
  p_id uuid default gen_random_uuid()
) returns uuid language sql as $$
  insert into public.staff_meal_rule (id, tenant_id, recipe_key, ingredient_id, default_count, location_id, created_by,
      updated_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', p_key, p_ing, p_count, p_loc,
      'c1000000-0000-4000-8000-00000000000c', 'c1000000-0000-4000-8000-00000000000c')
  returning id
$$;
create function pg_temp.mkconf(p_rule uuid, p_date date, p_count numeric default 2) returns uuid language sql as $$
  insert into public.staff_meal_confirmation (tenant_id, rule_id, business_date, count, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_rule, p_date, p_count, 'c1000000-0000-4000-8000-00000000000c')
  returning id
$$;

-- Batch waste reasons ---------------------------------------------------------------------------------------
select is(app.batch_waste_reason_codes(),
  array['spoilage', 'expired', 'over_production', 'plating_error', 'staff_meal', 'comp', 'breakage'],
  'the seven batch waste reasons, in order (the PRD list minus count_correction)');
select is((select provolatile from pg_proc where oid = 'app.batch_waste_reason_codes()'::regprocedure), 'i'::"char",
  'batch_waste_reason_codes is immutable');
select is_empty(
  $$ select r from unnest(app.batch_waste_reason_codes()) r where r <> all (app.stock_reason_codes()) $$,
  'every batch reason is also a raw stock reason');

-- Shapes: produce -------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select pg_temp.mkmove('produce', 31, 'batch') $$), 'ok', 'M14 produce rows are still valid');

-- count
select is(pg_temp.err($$ select pg_temp.mkmove('count', -1, 'batch_adjust', gen_random_uuid()) $$), 'ok',
  'a count of -1 with ref batch_adjust is accepted');
select is(pg_temp.err($$ select pg_temp.mkmove('count', 2, 'batch_adjust', gen_random_uuid()) $$), 'ok',
  'a count of +2 with ref batch_adjust is accepted');
select alike(pg_temp.err($$ select pg_temp.mkmove('count', -1, 'batch_adjust', gen_random_uuid(), 'spoilage') $$),
  '23514%batch_movement_shape_ck%', 'a count with a reason is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('count', -1, 'batch_discard', gen_random_uuid()) $$),
  '23514%batch_movement_shape_ck%', 'a count with another ref_type is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('count', 0, 'batch_adjust', gen_random_uuid()) $$),
  '23514%', 'a count of 0 is refused');

-- waste
select is(pg_temp.err($$ select pg_temp.mkmove('waste', -3, 'batch_discard', gen_random_uuid(), 'spoilage') $$), 'ok',
  'a waste of -3 spoilage with ref batch_discard is accepted');
select is(pg_temp.err($$ select pg_temp.mkmove('waste', -2, 'staff_meal', gen_random_uuid(), 'staff_meal') $$), 'ok',
  'a waste with ref staff_meal and reason staff_meal is accepted');
select alike(pg_temp.err($$ select pg_temp.mkmove('waste', 3, 'batch_discard', gen_random_uuid(), 'spoilage') $$),
  '23514%batch_movement_shape_ck%', 'a waste of +3 is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('waste', -3, 'batch_discard', gen_random_uuid(), 'count_correction') $$),
  '23514%batch_movement_shape_ck%', 'a waste with count_correction is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('waste', -3, 'batch_discard', gen_random_uuid(), 'foo') $$),
  '23514%batch_movement_shape_ck%', 'a waste with an unknown reason is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('waste', -3, 'batch_discard') $$),
  '23514%batch_movement_shape_ck%', 'a waste without a reason is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('waste', -2, 'staff_meal', gen_random_uuid(), 'spoilage') $$),
  '23514%batch_movement_shape_ck%', 'a waste with ref staff_meal and reason spoilage is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('waste', -2, 'batch', gen_random_uuid(), 'spoilage') $$),
  '23514%batch_movement_shape_ck%', 'a waste with another ref_type is refused');

-- split
select is(pg_temp.err($$ select pg_temp.mkmove('split', -4, 'batch_split', gen_random_uuid()) $$), 'ok',
  'a split of -4 with ref_id other than the batch is accepted');
select is(pg_temp.err($$ select pg_temp.mkmove('split', 4, 'batch_split', 'ba000000-0000-4000-8000-0000000000b2',
    p_batch => 'ba000000-0000-4000-8000-0000000000b2') $$), 'ok',
  'a split of +4 whose ref_id is its own batch is accepted');
select alike(pg_temp.err($$ select pg_temp.mkmove('split', -4, 'batch_split') $$),
  '23514%batch_movement_shape_ck%', 'a split of -4 whose ref_id is its own batch is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('split', 4, 'batch_split', gen_random_uuid()) $$),
  '23514%batch_movement_shape_ck%', 'a split of +4 whose ref_id is another batch is refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('split', -4, 'batch_split', gen_random_uuid(), 'spoilage') $$),
  '23514%batch_movement_shape_ck%', 'a split with a reason is refused');

-- consume and reversals
select alike(pg_temp.err($$ select pg_temp.mkmove('consume', -1, 'order_line', gen_random_uuid()) $$),
  '23514%batch_movement_shape_ck%', 'consume is refused until M19');
select alike(pg_temp.err($$ select pg_temp.mkmove('consume', -1, 'batch') $$),
  '23514%batch_movement_shape_ck%', 'consume with the produce ref is refused too');
select alike(pg_temp.err($$ select pg_temp.mkmove('count', 1, 'batch_adjust', gen_random_uuid(),
    p_reverses => (select id from public.batch_movement where type = 'produce')) $$),
  '23514%batch_movement_shape_ck%', 'any reverses_id is refused (M15 writes no reversal)');
select alike(pg_temp.err($$ select pg_temp.mkmove('produce', -1, 'batch', p_batch => 'ba000000-0000-4000-8000-0000000000b2') $$),
  '23514%batch_movement_shape_ck%', 'a produce of -1 is still refused');
select alike(pg_temp.err($$ select pg_temp.mkmove('produce', 31, 'batch') $$),
  '23505%batch_movement_produce_uq%', 'a second produce for the same batch is still refused');

-- staff_meal_rule -------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select pg_temp.mkrule(p_key => 'ec000000-0000-4000-8000-0000000000e1',
    p_id => '5e000000-0000-4000-8000-0000000000a1') $$), 'ok', 'a rule on a batch recipe is accepted');
select is(pg_temp.err($$ select pg_temp.mkrule(p_ing => '1a000000-0000-4000-8000-00000000001a', p_count => 0.5,
    p_loc => '10000000-0000-4000-8000-0000000000a1', p_id => '5e000000-0000-4000-8000-0000000000a2') $$), 'ok',
  'a rule on a stock ingredient with a location is accepted');
select alike(pg_temp.err($$ select pg_temp.mkrule(p_key => 'ec000000-0000-4000-8000-0000000000e1',
    p_ing => '1a000000-0000-4000-8000-00000000001a') $$),
  '23514%', 'both targets are refused');
select alike(pg_temp.err($$ select pg_temp.mkrule() $$), '23514%', 'no target is refused');
select alike(pg_temp.err($$ select pg_temp.mkrule(p_key => 'ec000000-0000-4000-8000-0000000000e1',
    p_loc => '10000000-0000-4000-8000-0000000000a1') $$),
  '23514%', 'a recipe rule with a location is refused');
select alike(pg_temp.err($$ select pg_temp.mkrule(p_ing => '1a000000-0000-4000-8000-00000000001a', p_count => 0) $$),
  '23514%', 'a default count of 0 is refused');
select alike(pg_temp.err($$ select pg_temp.mkrule(p_ing => '1a000000-0000-4000-8000-00000000001a', p_count => 1000.0001) $$),
  '23514%', 'a default count above 1000 is refused');
select is(pg_temp.err($$ select pg_temp.mkrule(p_key => 'ec000000-0000-4000-8000-0000000000e3') $$),
  'P0001 staff_meal_target_invalid', 'a sub recipe key is refused');
select is(pg_temp.err($$ select pg_temp.mkrule(p_ing => '1b000000-0000-4000-8000-00000000001b') $$),
  'P0001 staff_meal_target_invalid', 'a non-stock ingredient is refused');
select alike(pg_temp.err($$ select pg_temp.mkrule(p_key => 'ec000000-0000-4000-8000-0000000000e1') $$),
  '23505%', 'a second rule for the same recipe is refused');
select alike(pg_temp.err($$ select pg_temp.mkrule(p_ing => '1a000000-0000-4000-8000-00000000001a') $$),
  '23505%', 'a second rule for the same ingredient is refused');
select is(pg_temp.err($$ select pg_temp.mkrule(p_key => 'ec000000-0000-4000-8000-0000000000e4') $$),
  'P0001 staff_meal_target_invalid', 'a recipe key of another tenant is refused');
select is(pg_temp.err($$ update public.staff_meal_rule set recipe_key = 'ec000000-0000-4000-8000-0000000000e3'
    where id = '5e000000-0000-4000-8000-0000000000a1' $$), 'P0001 staff_meal_rule_immutable',
  'the target of a rule never changes');
select is(pg_temp.err($$ update public.staff_meal_rule set created_by = 'a1000000-0000-4000-8000-00000000000a'
    where id = '5e000000-0000-4000-8000-0000000000a1' $$), 'P0001 staff_meal_rule_immutable',
  'created_by of a rule never changes');
select is(pg_temp.err($$ update public.staff_meal_rule set default_count = 3, is_active = false, updated_at = now()
    where id = '5e000000-0000-4000-8000-0000000000a1' $$), 'ok', 'count, active flag and updated_* may change');
select is(pg_temp.err($$ delete from public.staff_meal_rule $$), 'P0001 append_only', 'DELETE of a rule is refused');
select is(pg_temp.err($$ truncate public.staff_meal_rule cascade $$), 'P0001 append_only', 'TRUNCATE of a rule is refused');

-- staff_meal_confirmation -----------------------------------------------------------------------------------
select is(pg_temp.err($$ select pg_temp.mkconf('5e000000-0000-4000-8000-0000000000a1', '2026-10-24') $$), 'ok',
  'a confirmation is accepted');
select alike(pg_temp.err($$ select pg_temp.mkconf('5e000000-0000-4000-8000-0000000000a1', '2026-10-24') $$),
  '23505%staff_meal_confirmation_day_uq%', 'a second confirmation of the same rule and business date is refused');
select is(pg_temp.err($$ select pg_temp.mkconf('5e000000-0000-4000-8000-0000000000a1', '2026-10-25') $$), 'ok',
  'the next business date is accepted');
select alike(pg_temp.err($$ select pg_temp.mkconf('5e000000-0000-4000-8000-0000000000a2', '2026-10-24', 0) $$),
  '23514%', 'a confirmed count of 0 is refused');
select alike(pg_temp.err($$ select pg_temp.mkconf(gen_random_uuid(), '2026-10-24') $$),
  '23503%', 'a confirmation of an unknown rule is refused');
select is(pg_temp.err($$ update public.staff_meal_confirmation set count = 1 $$), 'P0001 append_only',
  'UPDATE of a confirmation is refused');
select is(pg_temp.err($$ delete from public.staff_meal_confirmation $$), 'P0001 append_only',
  'DELETE of a confirmation is refused');
select is(pg_temp.err($$ truncate public.staff_meal_confirmation cascade $$), 'P0001 append_only',
  'TRUNCATE of a confirmation is refused');

-- Audit lists -----------------------------------------------------------------------------------------------
select is(pg_temp.err($$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'staff_meal_rule', '5e000000-0000-4000-8000-0000000000a1',
    'staff_meal_rule.updated', '{}', 'c1000000-0000-4000-8000-00000000000c') $$), 'ok',
  'staff_meal_rule.updated is an accepted audit action');
select is(pg_temp.err($$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'staff_meal_rule', '5e000000-0000-4000-8000-0000000000a1',
    'staff_meal_rule.created', '{}', 'c1000000-0000-4000-8000-00000000000c') $$), 'ok',
  'staff_meal_rule.created is an accepted audit action');
select is_empty(
  $$ select v from unnest(array['invoice', 'ingredient', 'recipe', 'tenant', 'payable', 'app_user', 'venue_device',
                               'device_enrolment', 'count_session']) v
      where pg_temp.err(format('insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
        values (%L, %L, gen_random_uuid(), %L, ''{}'', %L)', '11111111-1111-4111-8111-111111111111', v,
        'tenant.settings_changed', 'c1000000-0000-4000-8000-00000000000c')) <> 'ok' $$,
  'every earlier audit entity type is still accepted');
select is_empty(
  $$ select v from unnest(array['invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared',
       'ingredient.allergens_confirmed', 'recipe.deactivated', 'recipe.reactivated', 'tenant.settings_changed',
       'payable.status_changed', 'payable.payment_reversed', 'app_user.created', 'app_user.updated',
       'app_user.deactivated', 'app_user.reactivated', 'app_user.pin_set', 'device_enrolment.created',
       'venue_device.enrolled', 'venue_device.revoked', 'venue_device.unlocked', 'count_session.closed',
       'count_session.cancelled', 'ingredient.critical_changed'
      ]) v
      where pg_temp.err(format('insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
        values (%L, %L, gen_random_uuid(), %L, ''{}'', %L)', '11111111-1111-4111-8111-111111111111', 'tenant', v,
        'c1000000-0000-4000-8000-00000000000c')) <> 'ok' $$,
  'every earlier audit action is still accepted');

-- RLS and grants --------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.seen('staff_meal_rule') || '/' || pg_temp.seen('staff_meal_confirmation'), '2/2',
  'chef A reads the rules and the confirmations');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.seen('staff_meal_rule') || '/' || pg_temp.seen('staff_meal_confirmation'), '2/2',
  'owner A reads the rules and the confirmations');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.seen('staff_meal_rule') + pg_temp.seen('staff_meal_confirmation'), 0::bigint,
  'waiter A reads 0 rows of both');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.seen('staff_meal_rule') + pg_temp.seen('staff_meal_confirmation'), 0::bigint,
  'owner B reads none of A''s rows');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err($$ insert into public.staff_meal_rule (recipe_key, default_count) values
    ('ec000000-0000-4000-8000-0000000000e1', 1) $$) ~ '^42501', true, 'the chef cannot insert a rule');
reset role;

select is_empty(
  $$ select t || ':' || p from unnest(array['staff_meal_rule', 'staff_meal_confirmation']) t,
       unnest(array['insert', 'update', 'delete', 'truncate']) p
      where has_table_privilege('authenticated', 'public.' || t, p)
         or has_table_privilege('anon', 'public.' || t, p)
         or has_table_privilege('service_role', 'public.' || t, p) $$,
  'no API role can insert, update, delete or truncate the two staff-meal tables');
select is_empty(
  $$ select t from unnest(array['staff_meal_rule', 'staff_meal_confirmation']) t
      where not has_table_privilege('authenticated', 'public.' || t, 'select')
         or has_table_privilege('anon', 'public.' || t, 'select') $$,
  'authenticated selects both tables; anon selects none');
select is_empty(
  $$ select t from unnest(array['staff_meal_rule', 'staff_meal_confirmation']) t
      where not has_table_privilege('service_role', 'public.' || t, 'select') $$,
  'service_role selects both tables (the integration suite reads them with the secret key, as it does the batch tables)');
select is_empty(
  $$ select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace
      and c.relname in ('staff_meal_rule', 'staff_meal_confirmation')
      and not (c.relrowsecurity
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id')) $$,
  'both tables have RLS and a tenant_id');

select * from finish();
rollback;
