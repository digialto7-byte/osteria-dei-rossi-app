-- M16 step 1: the per-recipe rule columns on recipe_key, the revoked direct grants on the reorder columns (the
-- audited procedures of step 3 are the only way to change them), the consumption index, and the audit checks as the
-- union of every earlier value plus M16's. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('b2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino (demo)',
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

-- The three columns exist, are nullable integers and default to null.
select col_type_is('public', 'recipe_key', 'rule_min_portions', 'integer', 'rule_min_portions is an integer');
select col_type_is('public', 'recipe_key', 'rule_target_portions', 'integer', 'rule_target_portions is an integer');
select col_type_is('public', 'recipe_key', 'rule_prep_time_min', 'integer', 'rule_prep_time_min is an integer');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'recipe_key'
              and column_name in ('rule_min_portions', 'rule_target_portions', 'rule_prep_time_min')
              and is_nullable = 'YES' and column_default is null), 3, 'all three are nullable with no default');
select is((select rule_min_portions::text || rule_target_portions::text || rule_prep_time_min::text
             from public.recipe_key where id = 'b2000000-0000-4000-8000-000000000001'), null, 'an existing key has all three null');

-- Bounds.
select is(pg_temp.err($$update public.recipe_key set rule_min_portions = -1$$), '23514 new row for relation "recipe_key" violates check constraint "recipe_key_rule_min_portions_check"', 'min -1 is refused');
select is(pg_temp.err($$update public.recipe_key set rule_min_portions = 10001$$), '23514 new row for relation "recipe_key" violates check constraint "recipe_key_rule_min_portions_check"', 'min 10001 is refused');
select is(pg_temp.err($$update public.recipe_key set rule_target_portions = 10001$$), '23514 new row for relation "recipe_key" violates check constraint "recipe_key_rule_target_portions_check"', 'target 10001 is refused');
select is(pg_temp.err($$update public.recipe_key set rule_prep_time_min = 1441$$), '23514 new row for relation "recipe_key" violates check constraint "recipe_key_rule_prep_time_min_check"', 'prep time 1441 is refused');
select is(pg_temp.err($$update public.recipe_key set rule_prep_time_min = -1$$), '23514 new row for relation "recipe_key" violates check constraint "recipe_key_rule_prep_time_min_check"', 'prep time -1 is refused');
select is(pg_temp.err($$update public.recipe_key set rule_min_portions = 5, rule_target_portions = 4$$), '23514 new row for relation "recipe_key" violates check constraint "recipe_key_rule_portions_ck"', 'target below min is refused');
select is(pg_temp.err($$update public.recipe_key set rule_min_portions = 0, rule_target_portions = 0, rule_prep_time_min = 0$$), 'ok', 'zeros are valid (min 0 switches the rule off)');
select is(pg_temp.err($$update public.recipe_key set rule_min_portions = 5, rule_target_portions = 30, rule_prep_time_min = 180$$), 'ok', 'the stew values are valid');
select is(pg_temp.err($$update public.recipe_key set rule_min_portions = 7, rule_target_portions = null$$), 'ok', 'a min without a target is valid');
select is(pg_temp.err($$update public.recipe_key set rule_min_portions = null, rule_target_portions = 3$$), 'ok', 'a target without a min is valid');
select is(pg_temp.err($$update public.recipe_key set rule_min_portions = null, rule_target_portions = null$$), 'ok', 'both can be cleared');

-- No API role has a grant on the new columns; the identity trigger still guards the key.
select is((select count(*)::int from unnest(array['authenticated', 'anon', 'service_role']) r,
                  unnest(array['rule_min_portions', 'rule_target_portions', 'rule_prep_time_min']) c
            where has_column_privilege(r, 'public.recipe_key', c, 'insert') or has_column_privilege(r, 'public.recipe_key', c, 'update')), 0,
  'no API role can insert or update the recipe rule columns');

-- The direct reorder grants are gone; the M1 columns that stay are untouched.
select is((select count(*)::int from unnest(array['min_level', 'target_level']) c
            where has_column_privilege('authenticated', 'public.ingredient', c, 'insert')
               or has_column_privilege('authenticated', 'public.ingredient', c, 'update')), 0,
  'authenticated cannot insert or update ingredient.min_level or target_level');
select is((select count(*)::int from unnest(array['lead_time_days', 'delivery_weekdays', 'order_cutoff_time']) c
            where has_column_privilege('authenticated', 'public.supplier', c, 'insert')
               or has_column_privilege('authenticated', 'public.supplier', c, 'update')), 0,
  'authenticated cannot insert or update the three supplier delivery columns');
select ok(has_column_privilege('authenticated', 'public.ingredient', 'name', 'update'), 'authenticated can still update ingredient.name');
select ok(has_column_privilege('authenticated', 'public.ingredient', 'is_critical', 'update'), 'and ingredient.is_critical (M13 reads it)');
select ok(has_column_privilege('authenticated', 'public.supplier', 'name', 'update'), 'and supplier.name');
select ok(has_column_privilege('authenticated', 'public.ingredient', 'min_level', 'select')
      and has_column_privilege('authenticated', 'public.supplier', 'lead_time_days', 'select'), 'and still select the reorder columns');

-- The partial index.
select is((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'stock_movement_consumption_idx'),
  'CREATE INDEX stock_movement_consumption_idx ON public.stock_movement USING btree (tenant_id, effective_on) WHERE (type = ''consumption''::stock_movement_type)',
  'the partial consumption index exists');

-- Audit checks: every value of 20261027100800's two lists is still accepted, plus supplier and the three new actions.
create temp table old_entities (v text);
insert into old_entities values ('invoice'), ('ingredient'), ('recipe'), ('tenant'), ('payable'), ('app_user'),
  ('venue_device'), ('device_enrolment'), ('count_session'), ('supplier');
create temp table old_actions (v text);
insert into old_actions values ('invoice.approved'), ('invoice.rejected'), ('invoice.duplicate_cleared'),
  ('ingredient.allergens_confirmed'), ('recipe.deactivated'), ('recipe.reactivated'), ('tenant.settings_changed'),
  ('payable.status_changed'), ('payable.payment_reversed'), ('app_user.created'), ('app_user.updated'),
  ('app_user.deactivated'), ('app_user.reactivated'), ('app_user.pin_set'), ('device_enrolment.created'),
  ('venue_device.enrolled'), ('venue_device.revoked'), ('venue_device.unlocked'), ('count_session.closed'),
  ('count_session.cancelled'), ('ingredient.critical_changed'),
  ('ingredient.rules_changed'), ('supplier.delivery_changed'), ('recipe.rules_changed');
select is(pg_temp.err($$insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
  select '11111111-1111-4111-8111-111111111111', e.v, gen_random_uuid(), 'tenant.settings_changed', 'a1000000-0000-4000-8000-00000000000a'
    from old_entities e$$), 'ok', 'every earlier entity type and supplier are accepted');
select is(pg_temp.err($$insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
  select '11111111-1111-4111-8111-111111111111', 'tenant', gen_random_uuid(), a.v, 'a1000000-0000-4000-8000-00000000000a'
    from old_actions a$$), 'ok', 'every earlier action and the three new ones are accepted');
select is((select count(*)::int from public.audit_event), 34, 'one audit row per value was written (10 entity types, 24 actions)');
select is(pg_temp.err($$insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'bogus', gen_random_uuid(), 'tenant.settings_changed', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "audit_event" violates check constraint "audit_event_entity_type_check"', 'an unknown entity type is still refused');
select is(pg_temp.err($$insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'tenant', gen_random_uuid(), 'bogus.action', 'a1000000-0000-4000-8000-00000000000a')$$),
  '23514 new row for relation "audit_event" violates check constraint "audit_event_action_check"', 'and an unknown action');
select is((select pg_get_constraintdef(oid) ~ 'count_session' from pg_constraint where conname = 'audit_event_entity_type_check'), true, 'the entity check keeps M13''s count_session');
select is((select pg_get_constraintdef(oid) ~ 'venue_device' from pg_constraint where conname = 'audit_event_entity_type_check'), true, 'and M11''s venue_device');
select is((select pg_get_constraintdef(oid) ~ 'ledger-invariants' and pg_get_constraintdef(oid) ~ 'auth-purge' from pg_constraint where conname = 'job_run_job_check'), true, 'job_run_job_check is untouched');

select * from finish();
rollback;
