-- M11 step 7 (migration 20261025100600_staff_management.sql): staff and device management procedures for the
-- owner and admin: create_staff, update_staff, prepare/record_pin_change, staff_list, device_overview,
-- revoke_device, unlock_device. Acceptance test 6 (database half). All execute to authenticated only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(72);

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
create function pg_temp.as_owner() returns void language sql as $$
  select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner') $$;

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001');
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('90000000-0000-4000-8000-000000000001', 'staff-91000000-0000-4000-8000-000000000001@staff.invalid'),
  ('90000000-0000-4000-8000-000000000002', 'staff-91000000-0000-4000-8000-000000000002@staff.invalid'),
  ('90000000-0000-4000-8000-000000000003', 'staff-91000000-0000-4000-8000-000000000003@staff.invalid'),
  ('90000000-0000-4000-8000-000000000009', 'staff-91000000-0000-4000-8000-000000000009@staff.invalid');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method, is_active, deactivated_at) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo', 'email', true, null),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo', 'email', true, null),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco Email', 'email', true, null),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Email', 'email', true, null),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare Demo B', 'email', true, null),
  ('91000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '90000000-0000-4000-8000-000000000002', 'waiter', 'Cameriere Inattivo', 'pin', false, now()),
  ('91000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', '90000000-0000-4000-8000-000000000003', 'waiter', 'Cameriere Demo B', 'pin', true, null);
insert into public.venue_device (id, tenant_id, label, token_hash, created_by) values
  ('d0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Telefono sala (demo)', repeat('1', 64), 'a1000000-0000-4000-8000-00000000000a'),
  ('d0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tablet cucina (demo)', repeat('2', 64), 'a1000000-0000-4000-8000-00000000000a'),
  ('d0000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'Telefono B (demo)', repeat('3', 64), 'b1000000-0000-4000-8000-00000000000b');
update public.venue_device set locked_at = now() where id = 'd0000000-0000-4000-8000-000000000002';
insert into public.device_enrolment (tenant_id, label, code_hash, expires_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'Codice valido (demo)', repeat('a', 64), now() + interval '10 minutes', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'Codice scaduto (demo)', repeat('b', 64), now() - interval '10 minutes', 'a1000000-0000-4000-8000-00000000000a');

create temporary table out (k text primary key, v text);
grant all on out to authenticated;

-- Roles: chef, waiter, no claims -> 42501 for every procedure --------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((select count(*)::int from unnest(array[
    'select public.assert_staff_manager()',
    'select * from public.staff_list()',
    $$select public.create_staff(gen_random_uuid(), '90000000-0000-4000-8000-000000000009', 'X', 'waiter')$$,
    $$select public.update_staff('91000000-0000-4000-8000-000000000002', 'X')$$,
    $$select public.prepare_pin_change('91000000-0000-4000-8000-000000000002')$$,
    $$select public.record_pin_change('91000000-0000-4000-8000-000000000002')$$,
    'select public.device_overview()',
    $$select public.revoke_device('d0000000-0000-4000-8000-000000000001')$$,
    $$select public.unlock_device('d0000000-0000-4000-8000-000000000001')$$]) s(stmt)
  where left(pg_temp.err(s.stmt), 5) = '42501'), 9, 'a chef gets 42501 from all nine procedures');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(*)::int from unnest(array[
    'select public.assert_staff_manager()',
    'select * from public.staff_list()',
    $$select public.create_staff(gen_random_uuid(), '90000000-0000-4000-8000-000000000009', 'X', 'waiter')$$,
    $$select public.update_staff('91000000-0000-4000-8000-000000000002', 'X')$$,
    $$select public.prepare_pin_change('91000000-0000-4000-8000-000000000002')$$,
    $$select public.record_pin_change('91000000-0000-4000-8000-000000000002')$$,
    'select public.device_overview()',
    $$select public.revoke_device('d0000000-0000-4000-8000-000000000001')$$,
    $$select public.unlock_device('d0000000-0000-4000-8000-000000000001')$$]) s(stmt)
  where left(pg_temp.err(s.stmt), 5) = '42501'), 9, 'a waiter gets 42501 from all nine');
select set_config('request.jwt.claims', '', true);
select is(left(pg_temp.err('select public.assert_staff_manager()'), 5), '42501', 'no claims: 42501');
reset role;

-- assert_staff_manager and create_staff --------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_owner();
select lives_ok('select public.assert_staff_manager()', 'the owner passes assert_staff_manager');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select lives_ok('select public.assert_staff_manager()', 'and the admin');
select pg_temp.as_owner();
insert into out select 'c1', public.create_staff('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', '  Cameriere Demo  ', 'waiter')::text;
reset role;
select is((select v::jsonb ->> 'displayName' from out where k = 'c1'), 'Cameriere Demo', 'create_staff returns the trimmed name');
select is((select login_method::text || ' ' || role::text || ' ' || tenant_id::text || ' ' || created_by::text || ' ' || is_active::text
             from public.app_user where id = '91000000-0000-4000-8000-000000000001'),
  'pin waiter 11111111-1111-4111-8111-111111111111 a1000000-0000-4000-8000-00000000000a true',
  'the row: login_method pin, role, tenant from the session, created_by the owner');
select is((select auth_id::text from public.app_user where id = '91000000-0000-4000-8000-000000000001'),
  '90000000-0000-4000-8000-000000000001', 'linked to the auth user');
select is((select after::text from public.audit_event where action = 'app_user.created'),
  '{"role": "waiter", "display_name": "Cameriere Demo"}', 'audit app_user.created holds display_name and role only');
select is((select entity_type || ' ' || entity_id::text from public.audit_event where action = 'app_user.created'),
  'app_user 91000000-0000-4000-8000-000000000001', 'about the new user');

set local role authenticated;
select pg_temp.as_owner();
select is(pg_temp.err($$ select public.create_staff(gen_random_uuid(), '90000000-0000-4000-8000-000000000009', 'X', 'owner') $$), 'P0001 staff_role_invalid', 'role owner: staff_role_invalid');
select is(pg_temp.err($$ select public.create_staff(gen_random_uuid(), '90000000-0000-4000-8000-000000000009', 'X', 'admin') $$), 'P0001 staff_role_invalid', 'role admin: staff_role_invalid');
select is(pg_temp.err($$ select public.create_staff(gen_random_uuid(), '90000000-0000-4000-8000-000000000009', '  ', 'chef') $$), 'P0001 display_name_invalid', 'blank name: display_name_invalid');
select is(pg_temp.err(format($$ select public.create_staff(gen_random_uuid(), '90000000-0000-4000-8000-000000000009', %L, 'chef') $$, repeat('x', 61))), 'P0001 display_name_invalid', '61-character name: display_name_invalid');
select is(pg_temp.err($$ select public.create_staff('91000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-00000000000c', 'X', 'chef') $$), 'P0001 auth_user_invalid', 'an auth user whose email is not staff-<id>@: auth_user_invalid');
select is(pg_temp.err($$ select public.create_staff('91000000-0000-4000-8000-000000000009', '99999999-9999-4999-8999-999999999999', 'X', 'chef') $$), 'P0001 auth_user_invalid', 'an unknown auth user: auth_user_invalid');
select is(pg_temp.err($$ select public.create_staff('91000000-0000-4000-8000-0000000000aa', '90000000-0000-4000-8000-000000000001', 'X', 'chef') $$), 'P0001 auth_user_invalid', 'an auth user that is already linked (or whose email names another id): auth_user_invalid');
select is(pg_temp.err($$ select public.create_staff('91000000-0000-4000-8000-000000000009', '90000000-0000-4000-8000-000000000009', 'Cuoco Demo', 'chef') $$), 'ok', 'a second staff member is created');
-- Owner B with A's ids: created in B only.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err($$ select public.create_staff('91000000-0000-4000-8000-0000000000bb', '90000000-0000-4000-8000-000000000003', 'X', 'chef') $$), 'P0001 auth_user_invalid', 'owner B cannot link an auth user already linked in A or B');
reset role;
select is((select tenant_id::text from public.app_user where id = '91000000-0000-4000-8000-000000000009'), '11111111-1111-4111-8111-111111111111', 'the tenant always comes from the session');

-- staff_list ------------------------------------------------------------------------------------------------------------------------
insert into public.auth_attempt (tenant_id, device_id, app_user_id, outcome, started_at, finished_at)
  select '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'failure',
         now() - interval '5 minutes' + g * interval '1 second', now() from generate_series(1, 5) g;
set local role authenticated;
select pg_temp.as_owner();
insert into out select 'list', (select jsonb_agg(to_jsonb(l) order by l.display_name)::text from public.staff_list() l);
reset role;
select is((select jsonb_array_length(v::jsonb) from out where k = 'list'), 5, 'staff_list: the chef/waiter rows of the tenant (2 email + 3 pin), no owner, admin or tenant B');
select is((select (e ->> 'locked_until') is not null from out, jsonb_array_elements(v::jsonb) e where k = 'list' and e ->> 'display_name' = 'Cameriere Demo'), true, 'a user with five failures in a row shows locked_until');
select is((select count(*)::int from out, jsonb_array_elements(v::jsonb) e where k = 'list' and e ->> 'locked_until' is not null), 1, 'and nobody else does');
select is((select string_agg(p.proargnames[i], ',' order by i)
             from pg_proc p, generate_subscripts(p.proargnames, 1) i
            where p.oid = 'public.staff_list()'::regprocedure and p.proargmodes[i] = 't'),
  'id,display_name,role,login_method,is_active,locked_until', 'staff_list columns: no login time of any person');

-- update_staff ------------------------------------------------------------------------------------------------------------------------
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, ends_at) values
  ('57000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '91000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001', now() + interval '1 hour'),
  ('57000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '91000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000002', now() + interval '1 hour');
set local role authenticated;
select pg_temp.as_owner();
select is(pg_temp.err($$ select public.update_staff('91000000-0000-4000-8000-000000000009', 'Cuoco Demo Nuovo') $$), 'ok', 'rename');
reset role;
select is((select before::text || ' ' || after::text from public.audit_event where action = 'app_user.updated'),
  '{"display_name": "Cuoco Demo"} {"display_name": "Cuoco Demo Nuovo"}', 'audit app_user.updated holds before and after of the changed field only');
set local role authenticated;
select pg_temp.as_owner();
select is(pg_temp.err($$ select public.update_staff('91000000-0000-4000-8000-000000000009', null, 'waiter') $$), 'ok', 'role chef to waiter');
select pg_temp.act_as('90000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', 'chef');
select is((select app.role()::text), 'waiter', 'app.role() for that user is waiter at once (the token still says chef)');
select pg_temp.as_owner();
select is(pg_temp.err($$ select public.update_staff('91000000-0000-4000-8000-000000000009', null, 'owner') $$), 'P0001 staff_role_invalid', 'a role change to owner is refused');
select is(pg_temp.err($$ select public.update_staff('91000000-0000-4000-8000-000000000009') $$), 'P0001 nothing_to_change', 'nothing to change');
select is(pg_temp.err($$ select public.update_staff('91000000-0000-4000-8000-000000000009', 'Cuoco Demo Nuovo') $$), 'P0001 nothing_to_change', 'the same name is nothing to change');
select is(pg_temp.err($$ select public.update_staff('f1000000-0000-4000-8000-00000000000f', 'X') $$), 'P0002 staff_not_found', 'targeting an admin: P0002');
select is(pg_temp.err($$ select public.update_staff('a1000000-0000-4000-8000-00000000000a', 'X') $$), 'P0002 staff_not_found', 'targeting an owner: P0002');
select is(pg_temp.err($$ select public.update_staff('91000000-0000-4000-8000-000000000003', 'X') $$), 'P0002 staff_not_found', 'targeting a tenant B user: P0002');
select is(pg_temp.err($$ select public.update_staff('91000000-0000-4000-8000-000000000009', null, null, false) $$), 'ok', 'deactivate');
reset role;
select is((select is_active::text || ' ' || (deactivated_at is not null)::text from public.app_user where id = '91000000-0000-4000-8000-000000000009'), 'false true', 'is_active false with deactivated_at');
select is((select end_reason::text from public.staff_session where id = '57000000-0000-4000-8000-000000000001'), 'deactivated', 'its open session ended with deactivated');
select is((select ended_at is null from public.staff_session where id = '57000000-0000-4000-8000-000000000002'), true, 'another user''s session is untouched');
select is((select count(*)::int from public.audit_event where action = 'app_user.deactivated'), 1, 'audited');
set local role authenticated;
select pg_temp.as_owner();
select is(pg_temp.err($$ select public.update_staff('91000000-0000-4000-8000-000000000009', null, null, true) $$), 'ok', 'reactivate');
reset role;
select is((select count(*)::int from public.audit_event where action = 'app_user.reactivated'), 1, 'audited');
select is((select is_active from public.app_user where id = '91000000-0000-4000-8000-000000000009'), true, 'active again');

-- prepare_pin_change and record_pin_change (AT6 database) -------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_owner();
insert into out select 'prep', public.prepare_pin_change('91000000-0000-4000-8000-000000000001')::text;
select is(pg_temp.err($$ select public.prepare_pin_change('91000000-0000-4000-8000-000000000002') $$), 'P0001 staff_inactive', 'inactive: staff_inactive');
select is(pg_temp.err($$ select public.prepare_pin_change('c1000000-0000-4000-8000-00000000000c') $$), 'P0001 staff_not_pin', 'an email chef: staff_not_pin');
select is(pg_temp.err($$ select public.prepare_pin_change('91000000-0000-4000-8000-000000000003') $$), 'P0002 staff_not_found', 'tenant B: P0002');
select is(pg_temp.err($$ select public.prepare_pin_change('a1000000-0000-4000-8000-00000000000a') $$), 'P0002 staff_not_found', 'the owner: P0002');
select is(pg_temp.err($$ select public.record_pin_change('91000000-0000-4000-8000-000000000002') $$), 'P0001 staff_inactive', 'record on an inactive user: staff_inactive');
select is(pg_temp.err($$ select public.record_pin_change('91000000-0000-4000-8000-000000000001') $$), 'ok', 'record_pin_change');
reset role;
select is((select v::jsonb ->> 'authId' from out where k = 'prep'), '90000000-0000-4000-8000-000000000001', 'prepare returns the auth id');
select is((select count(*)::int from public.auth_attempt where outcome = 'pin_reset' and app_user_id = '91000000-0000-4000-8000-000000000001' and device_id is null), 1, 'one pin_reset attempt');
select is((select end_reason::text from public.staff_session where id = '57000000-0000-4000-8000-000000000002'), 'pin_reset', 'the open sessions ended with pin_reset');
select is((select before is null and after is null from public.audit_event where action = 'app_user.pin_set'), true, 'audit app_user.pin_set has no before or after');
select is(app.user_lock_until('91000000-0000-4000-8000-000000000001', clock_timestamp()), null, 'a locked user is unlocked by the reset');

-- Devices ----------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_owner();
insert into out select 'ov', public.device_overview()::text;
reset role;
select is((select jsonb_array_length(v::jsonb -> 'devices') from out where k = 'ov'), 2, 'device_overview: two devices of tenant A');
select is((select string_agg(e ->> 'label' || ':' || (e ->> 'status'), ',' order by e ->> 'label') from out, jsonb_array_elements(v::jsonb -> 'devices') e where k = 'ov'),
  'Tablet cucina (demo):bloccato,Telefono sala (demo):attivo', 'with their status');
select is((select jsonb_array_length(v::jsonb -> 'pendingCodes') from out where k = 'ov'), 1, 'one unused unexpired code');
select is((select string_agg(k2, ',' order by k2) from out, jsonb_array_elements(v::jsonb -> 'pendingCodes') e, jsonb_object_keys(e) k2 where k = 'ov'),
  'expiresAt,id,label', 'the code entry never holds the code or its hash');
select is((select (v::jsonb -> 'devices' -> 0) ? 'token_hash' or v ~ 'code_hash|tokenHash|codeHash' from out where k = 'ov'), false, 'no hash anywhere in the overview');

set local role authenticated;
select pg_temp.as_owner();
insert into out select 'rev', public.revoke_device('d0000000-0000-4000-8000-000000000001')::text;
reset role;
select is((select v::jsonb ->> 'status' from out where k = 'rev'), 'revocato', 'revoke_device returns the device as revoked');
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, ends_at) values
  ('57000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '91000000-0000-4000-8000-000000000009', 'd0000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000003', now() + interval '1 hour');
select is((select count(*)::int from public.audit_event where action = 'venue_device.revoked'), 1, 'revoke is audited');
set local role authenticated;
select pg_temp.as_owner();
select is(pg_temp.err($$ select public.revoke_device('d0000000-0000-4000-8000-000000000001') $$), 'ok', 'a second revoke is accepted (idempotent)');
select is(pg_temp.err($$ select public.revoke_device('d0000000-0000-4000-8000-000000000003') $$), 'P0002 device_not_found', 'tenant B''s device: P0002');
select is(pg_temp.err($$ select public.unlock_device('d0000000-0000-4000-8000-000000000001') $$), 'P0001 device_revoked', 'unlock on a revoked device: device_revoked');
select is(pg_temp.err($$ select public.unlock_device('d0000000-0000-4000-8000-000000000003') $$), 'P0002 device_not_found', 'unlock on tenant B''s device: P0002');
insert into out select 'unl', public.unlock_device('d0000000-0000-4000-8000-000000000002')::text;
reset role;
select is((select count(*)::int from public.audit_event where action = 'venue_device.revoked'), 1, 'the second revoke wrote no second audit row');
select is((select v::jsonb ->> 'status' from out where k = 'unl'), 'attivo', 'unlock_device returns the device as active');
select is((select (locked_at is null)::text || ' ' || (unlocked_at is not null)::text from public.venue_device where id = 'd0000000-0000-4000-8000-000000000002'), 'true true', 'locked_at cleared, unlocked_at set');
select is((select count(*)::int from public.audit_event where action = 'venue_device.unlocked'), 1, 'unlock is audited');
set local role authenticated;
select pg_temp.as_owner();
select is(pg_temp.err($$ select public.unlock_device('d0000000-0000-4000-8000-000000000002') $$), 'ok', 'unlocking a device that is not locked is accepted');
reset role;
select is((select count(*)::int from public.audit_event where action = 'venue_device.unlocked'), 1, 'and writes no second audit row');

-- Execute grants -----------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from unnest(array['anon', 'service_role']) r(role),
                unnest(array['public.assert_staff_manager()', 'public.staff_list()', 'public.create_staff(uuid,uuid,text,public.app_role)',
                  'public.update_staff(uuid,text,public.app_role,boolean)', 'public.prepare_pin_change(uuid)',
                  'public.record_pin_change(uuid)', 'public.device_overview()', 'public.revoke_device(uuid)',
                  'public.unlock_device(uuid)']) f(name)
           where has_function_privilege(r.role, f.name, 'execute')), 0, 'anon and service_role execute none of them');
select is((select count(*)::int from unnest(array['public.assert_staff_manager()', 'public.staff_list()', 'public.create_staff(uuid,uuid,text,public.app_role)',
                  'public.update_staff(uuid,text,public.app_role,boolean)', 'public.prepare_pin_change(uuid)',
                  'public.record_pin_change(uuid)', 'public.device_overview()', 'public.revoke_device(uuid)',
                  'public.unlock_device(uuid)']) f(name)
           where has_function_privilege('authenticated', f.name, 'execute')), 9, 'authenticated executes all nine');

select * from finish();
rollback;
