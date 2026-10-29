-- M11 step 1 (migration 20261025100000_staff_auth_tables.sql): login_method, the device, enrolment, attempt and
-- staff-session tables, their guards, RLS and grants, the audit list widening, and the catalogue scan that proves
-- no column holds a PIN or anything derived from it (acceptance test 5, schema half).
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

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
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;

-- Shape ----------------------------------------------------------------------------------------------------------
select has_type('public', 'login_method', 'enum login_method exists');
select has_type('public', 'auth_attempt_outcome', 'enum auth_attempt_outcome exists');
select has_type('public', 'staff_session_end', 'enum staff_session_end exists');
select has_table('public', 'venue_device', 'venue_device exists');
select has_table('public', 'device_enrolment', 'device_enrolment exists');
select has_table('public', 'auth_attempt', 'auth_attempt exists');
select has_table('public', 'staff_session', 'staff_session exists');
select has_table('app', 'enrol_failure', 'app.enrol_failure exists');

-- Fixture --------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'staff-c1000000-0000-4000-8000-00000000000c@staff.invalid'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare Demo B');

-- app_user.login_method ------------------------------------------------------------------------------------------
select is((select login_method::text from public.app_user where id = 'd1000000-0000-4000-8000-00000000000d'),
  'email', 'login_method defaults to email');
select is(pg_temp.err($$ insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method)
    values (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f',
            'owner', 'X', 'pin') $$), '23514', 'login_method pin with role owner violates the check');
select lives_ok($$ insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method)
    values ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
            'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco Demo', 'pin') $$,
  'login_method pin is allowed for a chef');
select ok(not has_column_privilege('authenticated', 'public.app_user', 'login_method', 'insert'),
  'authenticated cannot set login_method on insert (M0 insert grant is unchanged)');

-- Catalogue scan (AT5 schema) ----------------------------------------------------------------------------------------
-- "pin" is matched as a whole word: it would otherwise hit invoice_line.mapping_source.
select is_empty(
  $$ select table_schema || '.' || table_name || '.' || column_name from information_schema.columns
      where table_schema in ('public', 'app')
        and column_name ~* '(^|_)pin(_|$)|passw|secret|pepper|hmac|derived' $$,
  'no column of any public or app table is named like a PIN, password, secret, pepper or derived value');
select is((select string_agg(table_schema || '.' || table_name || '.' || column_name, ' ' order by table_schema || '.' || table_name || '.' || column_name collate "C")
             from information_schema.columns
            where table_schema in ('public', 'app') and column_name ~* 'hash'),
  'app.enrol_failure.ip_hash public.applied_op.payload_hash public.device_enrolment.code_hash public.supplier_item.description_hash public.venue_device.token_hash',
  'the only hash columns are the device token hash, the code hash, the IP hash, M1''s description hash and M20''s applied_op.payload_hash (a SHA-256 of the op payload, not a credential)');

-- Seed rows (as the migration owner) -----------------------------------------------------------------------------------
insert into public.device_enrolment (id, tenant_id, label, code_hash, expires_at, created_by) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'Telefono sala (demo)',
   repeat('a', 64), now() + interval '15 minutes', 'a1000000-0000-4000-8000-00000000000a'),
  ('e2000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'Tablet cucina (demo)',
   repeat('b', 64), now() + interval '15 minutes', 'a1000000-0000-4000-8000-00000000000a');
insert into public.venue_device (id, tenant_id, label, token_hash, created_by) values
  ('d2000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'Telefono sala (demo)',
   repeat('c', 64), 'a1000000-0000-4000-8000-00000000000a');
update public.device_enrolment set used_at = now(), device_id = 'd2000000-0000-4000-8000-0000000000d2'
 where id = 'e1000000-0000-4000-8000-0000000000e1';
insert into public.auth_attempt (id, tenant_id, device_id, app_user_id, outcome, finished_at) values
  ('a7000000-0000-4000-8000-0000000000a7', '11111111-1111-4111-8111-111111111111',
   'd2000000-0000-4000-8000-0000000000d2', 'c1000000-0000-4000-8000-00000000000c', 'success', now());
insert into public.auth_attempt (id, tenant_id, device_id, app_user_id) values
  ('a8000000-0000-4000-8000-0000000000a8', '11111111-1111-4111-8111-111111111111',
   'd2000000-0000-4000-8000-0000000000d2', 'c1000000-0000-4000-8000-00000000000c');
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, ends_at) values
  ('57000000-0000-4000-8000-000000000057', '11111111-1111-4111-8111-111111111111',
   'c1000000-0000-4000-8000-00000000000c', 'd2000000-0000-4000-8000-0000000000d2',
   '5e000000-0000-4000-8000-0000000000e5', now() + interval '1 day');
insert into app.enrol_failure (ip_hash) values (repeat('d', 64));

-- Check constraints ----------------------------------------------------------------------------------------------------
select is(pg_temp.err($$ insert into public.venue_device (tenant_id, label, token_hash, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'x', 'not-hex', 'a1000000-0000-4000-8000-00000000000a') $$),
  '23514', 'a token hash must be 64 hex characters');
select is(pg_temp.err($$ insert into public.venue_device (tenant_id, label, token_hash, created_by)
    values ('11111111-1111-4111-8111-111111111111', repeat('x', 61), repeat('e', 64),
            'a1000000-0000-4000-8000-00000000000a') $$),
  '23514', 'a device label is 1 to 60 characters');
select is(pg_temp.err($$ insert into public.auth_attempt (tenant_id, device_id, app_user_id, outcome)
    values ('11111111-1111-4111-8111-111111111111', 'd2000000-0000-4000-8000-0000000000d2', null, 'failure') $$),
  '23514', 'a finished outcome needs finished_at');
select is(pg_temp.err($$ insert into public.auth_attempt (tenant_id, device_id, outcome, finished_at)
    values ('11111111-1111-4111-8111-111111111111', null, 'success', now()) $$),
  '23514', 'only pin_reset may have no device');

-- Guards (migration owner) ---------------------------------------------------------------------------------------------
select lives_ok($$ update public.auth_attempt set outcome = 'success', finished_at = now()
    where id = 'a8000000-0000-4000-8000-0000000000a8' $$, 'a pending attempt becomes success once');
select is(pg_temp.err($$ update public.auth_attempt set outcome = 'failure'
    where id = 'a8000000-0000-4000-8000-0000000000a8' $$), 'P0001', 'success to failure is refused');
insert into public.auth_attempt (id, tenant_id, device_id, app_user_id) values
  ('a9000000-0000-4000-8000-0000000000a9', '11111111-1111-4111-8111-111111111111',
   'd2000000-0000-4000-8000-0000000000d2', 'c1000000-0000-4000-8000-00000000000c');
select is(pg_temp.err($$ update public.auth_attempt set app_user_id = null
    where id = 'a9000000-0000-4000-8000-0000000000a9' $$), 'P0001', 'changing app_user_id is refused');
select is(pg_temp.err($$ delete from public.auth_attempt where id = 'a7000000-0000-4000-8000-0000000000a7' $$),
  'P0001', 'delete without the purge setting is refused');
select is(pg_temp.err($$ truncate public.auth_attempt $$), 'P0001', 'truncate is refused');
select lives_ok($$ update public.staff_session set ended_at = now(), end_reason = 'logout'
    where id = '57000000-0000-4000-8000-000000000057' $$, 'a staff session ends once');
select is(pg_temp.err($$ update public.staff_session set ended_at = now(), end_reason = 'device_revoked'
    where id = '57000000-0000-4000-8000-000000000057' $$), 'P0001', 'ending it twice is refused');
select is(pg_temp.err($$ truncate public.staff_session $$), 'P0001', 'truncate of staff_session is refused');
select is(pg_temp.err($$ update public.venue_device set token_hash = repeat('f', 64)
    where id = 'd2000000-0000-4000-8000-0000000000d2' $$), 'P0001', 'token_hash is immutable');
select is(pg_temp.err($$ delete from public.venue_device $$), 'P0001', 'a device is never deleted');
select is(pg_temp.err($$ delete from public.device_enrolment where id = 'e2000000-0000-4000-8000-0000000000e2' $$),
  'P0001', 'an unused code cannot be deleted without the purge setting');
select is(pg_temp.err($$ update public.device_enrolment set code_hash = repeat('9', 64)
    where id = 'e2000000-0000-4000-8000-0000000000e2' $$), 'P0001', 'code_hash is immutable');
select set_config('app.auth_purge', 'on', true);
select is(pg_temp.err($$ delete from public.device_enrolment where id = 'e1000000-0000-4000-8000-0000000000e1' $$),
  'P0001', 'a used code is never deleted, even with the purge setting');
select is(pg_temp.err($$ delete from public.device_enrolment where id = 'e2000000-0000-4000-8000-0000000000e2' $$),
  'ok', 'an unused code can be deleted with the purge setting');
select set_config('app.auth_purge', '', true);

-- RLS and grants ---------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where (n.nspname, c.relname) in (('public', 'venue_device'), ('public', 'device_enrolment'),
              ('public', 'auth_attempt'), ('public', 'staff_session'), ('app', 'enrol_failure'))
              and c.relrowsecurity), 5, 'RLS is on for all five tables');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role),
                unnest(array['public.venue_device', 'public.device_enrolment', 'public.auth_attempt',
                             'public.staff_session', 'app.enrol_failure']) t(name),
                unnest(array['insert', 'update', 'delete', 'truncate']) p(priv)
           where has_table_privilege(r.role, t.name, p.priv)), 0,
  'no API role has INSERT, UPDATE, DELETE or TRUNCATE on any of the five tables');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role),
                unnest(array['public.venue_device', 'public.device_enrolment', 'public.auth_attempt',
                             'public.staff_session', 'app.enrol_failure']) t(name)
           where has_any_column_privilege(r.role, t.name, 'insert, update')), 0,
  'and no column-level INSERT or UPDATE either');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role)
           where has_any_column_privilege(r.role, 'public.auth_attempt', 'select')
              or has_any_column_privilege(r.role, 'public.staff_session', 'select')
              or has_any_column_privilege(r.role, 'app.enrol_failure', 'select')), 0,
  'no API role reads auth_attempt, staff_session or app.enrol_failure');
select ok(has_table_privilege('supabase_auth_admin', 'public.auth_attempt', 'select')
      and has_table_privilege('supabase_auth_admin', 'public.staff_session', 'select'),
  'supabase_auth_admin can select auth_attempt and staff_session');
select ok(has_column_privilege('supabase_auth_admin', 'public.venue_device', 'revoked_at', 'select')
      and has_column_privilege('supabase_auth_admin', 'public.app_user', 'login_method', 'select'),
  'and the hook columns of venue_device and app_user');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select count(id)::int from public.venue_device), 1, 'owner A reads A''s device');
select is((select count(id)::int from public.device_enrolment), 1, 'owner A reads A''s codes');
select is(pg_temp.err($$ select token_hash from public.venue_device $$), '42501', 'token_hash is not selectable');
select is(pg_temp.err($$ select code_hash from public.device_enrolment $$), '42501', 'code_hash is not selectable');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((select count(id)::int from public.venue_device), 1, 'admin A reads A''s device');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(id)::int from public.venue_device) + (select count(id)::int from public.device_enrolment),
  0, 'a waiter reads no device and no code');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select count(id)::int from public.venue_device) + (select count(id)::int from public.device_enrolment),
  0, 'owner B reads none of A''s');
reset role;

-- Audit lists --------------------------------------------------------------------------------------------------------------
select is((select array_agg(m[1] order by m[1]) from pg_constraint c,
                lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_.]+)''', 'g') m
            where c.conname = 'audit_event_entity_type_check'),
  array['app_user', 'count_session', 'device_enrolment', 'dining_table', 'ingredient', 'invoice', 'menu_item',
        'payable', 'recipe', 'sale_settings', 'staff_meal_rule', 'supplier', 'table_session', 'tenant', 'venue_device'],
  'the audit entity types: every earlier one plus app_user, venue_device, device_enrolment (and M13 count_session, M15 staff_meal_rule, M16 supplier, M17 menu_item, dining_table, table_session, sale_settings)');
select is((select array_agg(m[1] order by m[1]) from pg_constraint c,
                lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_.]+)''', 'g') m
            where c.conname = 'audit_event_action_check'),
  array['app_user.created', 'app_user.deactivated', 'app_user.pin_set', 'app_user.reactivated',
        'app_user.updated', 'count_session.cancelled', 'count_session.closed', 'device_enrolment.created',
        'dining_table.created', 'dining_table.updated',
        'ingredient.allergens_confirmed', 'ingredient.critical_changed',
        'ingredient.rules_changed', 'invoice.approved',
        'invoice.duplicate_cleared', 'invoice.rejected', 'menu_item.created', 'menu_item.updated',
        'payable.payment_reversed', 'payable.status_changed',
        'recipe.deactivated', 'recipe.reactivated', 'recipe.rules_changed', 'sale_settings.changed',
        'staff_meal_rule.created',
        'staff_meal_rule.updated', 'supplier.delivery_changed', 'table_session.covers_changed',
        'tenant.demo_data_loaded', 'tenant.demo_data_removed', 'tenant.settings_changed', 'venue_device.enrolled',
        'venue_device.revoked', 'venue_device.unlocked'],
  'the audit actions: all nine earlier ones, the nine M11 ones (and the three M13 ones, the two M15 staff_meal_rule ones, the three M16 ones, the six M17 ones, the two demo-data tenant.demo_data_* ones)');
select lives_ok($$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'venue_device', 'd2000000-0000-4000-8000-0000000000d2',
            'venue_device.revoked', 'a1000000-0000-4000-8000-00000000000a') $$,
  'a new action is accepted');

select * from finish();
rollback;
