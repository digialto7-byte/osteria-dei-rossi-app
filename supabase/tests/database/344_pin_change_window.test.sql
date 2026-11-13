-- P2-1 A5 (docs/plans/2026-11-12-p2-1-totp.md section 3.10, 5 A5; follow-up F13): the PIN-change window. A PIN sign-in that started before the new PIN was in
-- place is refused (pin_login_finish) or ended (finish_pin_change); a failed change is recorded as failed. Uses the real clock: the order of the rows is the
-- order of the calls. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('ad000000-0000-4000-8000-0000000000ad', 'admin-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('90000000-0000-4000-8000-000000000001', 'staff-91000000-0000-4000-8000-000000000001@staff.invalid'),
  ('90000000-0000-4000-8000-000000000002', 'staff-91000000-0000-4000-8000-000000000002@staff.invalid'),
  ('90000000-0000-4000-8000-000000000003', 'staff-91000000-0000-4000-8000-000000000003@staff.invalid');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo', 'email'),
  ('ad100000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'ad000000-0000-4000-8000-0000000000ad', 'admin', 'Admin Demo', 'email'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo', 'email'),
  ('91000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '90000000-0000-4000-8000-000000000001', 'waiter', 'Cameriere Demo Uno', 'pin'),
  ('91000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '90000000-0000-4000-8000-000000000002', 'waiter', 'Cameriere Demo Due', 'pin'),
  ('91000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '90000000-0000-4000-8000-000000000003', 'chef', 'Chef Demo', 'pin');
insert into public.venue_device (id, tenant_id, label, token_hash, created_by) values
  ('d0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Telefono sala (demo)', repeat('1', 64), 'a1000000-0000-4000-8000-00000000000a'),
  ('d0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tablet sala (demo)', repeat('2', 64), 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.as_owner() returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner', 'aal', 'aal1')::text, true) $$;
create function pg_temp.as_waiter() returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', '90000000-0000-4000-8000-000000000001', 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'waiter', 'login', 'pin')::text, true) $$;
create function pg_temp.out(p_role text, stmt text) returns text language plpgsql as $$
declare state text; msg text;
begin
  execute format('set local role %I', p_role);
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  reset role;
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end $$;
create function pg_temp.starts(a text, b text, d text) returns text language sql as $$ select is(left(a, length(b)), b, d) $$;
create function pg_temp.j(p_role text, stmt text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  execute format('set local role %I', p_role);
  execute stmt into r;
  reset role;
  return r;
end $$;
-- begin a PIN login of user n on device 1 (real clock), returns the attempt id
create function pg_temp.begin_login(n int) returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := pg_temp.j('service_role', format($f$select public.pin_login_begin(repeat('1', 64), '91000000-0000-4000-8000-00000000000%s')$f$, n));
  if r ->> 'status' <> 'proceed' then raise exception 'begin answered %', r; end if;
  return (r ->> 'attemptId')::uuid;
end $$;
create function pg_temp.finish_login(p_attempt uuid, p_session uuid) returns jsonb language sql as $$
  select pg_temp.j('service_role', format($f$select public.pin_login_finish('%s', 'success', '%s')$f$, p_attempt, p_session)) $$;
create temp table att (k text primary key, id uuid);
grant all on att to public;

-- 1. An attempt that started before record_pin_change and finished after it is refused.
insert into att values ('old', pg_temp.begin_login(1));
select pg_temp.as_owner();
select pg_temp.out('authenticated', $$select public.record_pin_change('91000000-0000-4000-8000-000000000001')$$) is null;
select is(pg_temp.finish_login((select id from att where k = 'old'), gen_random_uuid()) ->> 'status', 'pin_invalid', 'an attempt started before the reset, finished after it: refused as a wrong PIN');
select is((select outcome::text from public.auth_attempt where id = (select id from att where k = 'old')), 'failure', 'the attempt is stored as a failure');
select is((select count(*)::int from public.staff_session where app_user_id = '91000000-0000-4000-8000-000000000001'), 0, 'and no session is opened');

-- The reply names the reason.
insert into att values ('old2', pg_temp.begin_login(2));
select pg_temp.out('authenticated', $$select public.record_pin_change('91000000-0000-4000-8000-000000000002')$$) is null;
select is(pg_temp.finish_login((select id from att where k = 'old2'), gen_random_uuid()), '{"status": "pin_invalid", "attemptsLeft": 5, "reason": "superseded"}'::jsonb, 'the reply is a wrong-PIN reply that carries reason superseded');
select is((select count(*)::int from public.staff_session where app_user_id = '91000000-0000-4000-8000-000000000002'), 0, 'again no session');

-- 2. An attempt that started after record_pin_change and finished success gets a session, which finish_pin_change ends.
insert into att values ('mid', pg_temp.begin_login(1));
select is(pg_temp.finish_login((select id from att where k = 'mid'), '5e000000-0000-4000-8000-000000000001') ->> 'status', 'ok', 'an attempt started after the reset opens a session (the old PIN was still valid in the window)');
select is((select count(*)::int from public.staff_session where app_user_id = '91000000-0000-4000-8000-000000000001' and ended_at is null), 1, 'the session is open');
select pg_temp.as_owner();
select is(pg_temp.out('authenticated', $$select public.finish_pin_change('91000000-0000-4000-8000-000000000001', 'success')$$), 'ok', 'finish_pin_change(success) by the owner');
select is((select end_reason::text from public.staff_session where auth_session_id = '5e000000-0000-4000-8000-000000000001'), 'pin_reset', 'it ended the session with the reason pin_reset');
select is((select count(*)::int from public.auth_attempt where app_user_id = '91000000-0000-4000-8000-000000000001' and outcome = 'pin_reset'), 2, 'and left a second pin_reset row (the first came from record_pin_change)');

-- A second attempt started between the reset and finish_pin_change, finished after it: refused (the second reset row is newer than its start).
select pg_temp.out('authenticated', $$select public.record_pin_change('91000000-0000-4000-8000-000000000001')$$) is null;
insert into att values ('between', pg_temp.begin_login(1));
select pg_temp.out('authenticated', $$select public.finish_pin_change('91000000-0000-4000-8000-000000000001', 'success')$$) is null;
select is(pg_temp.finish_login((select id from att where k = 'between'), gen_random_uuid()) ->> 'reason', 'superseded', 'an attempt started before finish_pin_change is refused after it');

-- 3. An attempt that started after finish_pin_change keeps its session.
insert into att values ('new', pg_temp.begin_login(1));
select is(pg_temp.finish_login((select id from att where k = 'new'), '5e000000-0000-4000-8000-000000000002') ->> 'status', 'ok', 'an attempt started after finish_pin_change signs in (the new PIN)');
select is((select ended_at is null from public.staff_session where auth_session_id = '5e000000-0000-4000-8000-000000000002'), true, 'and its session survives');

-- 4. finish_pin_change(failure): one audit row, sessions untouched.
select is((select count(*)::int from public.audit_event where action = 'app_user.pin_set_failed'), 0, 'no pin_set_failed row yet');
select is(pg_temp.out('authenticated', $$select public.finish_pin_change('91000000-0000-4000-8000-000000000001', 'failure')$$), 'ok', 'finish_pin_change(failure)');
select is((select jsonb_build_object('type', entity_type, 'id', entity_id, 'tenant', tenant_id, 'by', created_by, 'after', after) from public.audit_event where action = 'app_user.pin_set_failed'),
          '{"type": "app_user", "id": "91000000-0000-4000-8000-000000000001", "tenant": "11111111-1111-4111-8111-111111111111", "by": "a1000000-0000-4000-8000-00000000000a", "after": null}'::jsonb, 'one pin_set_failed row: the user, the tenant, the actor, nothing else');
select is((select ended_at is null from public.staff_session where auth_session_id = '5e000000-0000-4000-8000-000000000002'), true, 'sessions are untouched by a failure');
select is((select count(*)::int from public.auth_attempt where app_user_id = '91000000-0000-4000-8000-000000000001' and outcome = 'pin_reset'), 4, 'and a failure adds no pin_reset row (four so far: two record_pin_change, two finish_pin_change(success))');

-- 5. Errors and roles.
select pg_temp.starts(pg_temp.out('authenticated', $$select public.finish_pin_change('91000000-0000-4000-8000-000000000001', 'other')$$), '22023', 'an outcome other than success or failure is 22023');
select pg_temp.starts(pg_temp.out('authenticated', $$select public.finish_pin_change('91000000-0000-4000-8000-000000000001', null)$$), '22023', 'a null outcome is 22023');
select pg_temp.starts(pg_temp.out('authenticated', $$select public.finish_pin_change('b1000000-0000-4000-8000-00000000000b', 'success')$$), 'P0002', 'another tenant''s user is staff_not_found');
select pg_temp.starts(pg_temp.out('authenticated', $$select public.finish_pin_change('ad100000-0000-4000-8000-0000000000ad', 'success')$$), 'P0002', 'an admin or owner account is not a PIN account: staff_not_found');
select pg_temp.as_waiter();
select pg_temp.starts(pg_temp.out('authenticated', $$select public.finish_pin_change('91000000-0000-4000-8000-000000000001', 'success')$$), '42501', 'a waiter is refused');
-- A gated admin (required mode, no factor, aal1) is refused like everywhere else.
update public.tenant set mfa_enforcement = 'required' where id = '11111111-1111-4111-8111-111111111111';
select set_config('request.jwt.claims', jsonb_build_object('sub', 'ad000000-0000-4000-8000-0000000000ad', 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'admin', 'aal', 'aal1')::text, true) is null;
select pg_temp.starts(pg_temp.out('authenticated', $$select public.finish_pin_change('91000000-0000-4000-8000-000000000001', 'success')$$), '42501', 'a gated admin is refused');
update public.tenant set mfa_enforcement = 'enrolled' where id = '11111111-1111-4111-8111-111111111111';

-- Grants and shape.
select ok(has_function_privilege('authenticated', 'public.finish_pin_change(uuid, text)', 'EXECUTE') and not has_function_privilege('anon', 'public.finish_pin_change(uuid, text)', 'EXECUTE')
          and not has_function_privilege('service_role', 'public.finish_pin_change(uuid, text)', 'EXECUTE'), 'finish_pin_change: authenticated only');
select ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.finish_pin_change(uuid, text)'::regprocedure), 'finish_pin_change is a definer with an empty search_path');
select ok(has_function_privilege('service_role', 'public.pin_login_finish(uuid, text, uuid)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.pin_login_finish(uuid, text, uuid)', 'EXECUTE'), 'pin_login_finish is still service role only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'pin_login_finish_at' and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))), 0, 'and the core app.pin_login_finish_at stays closed to every API role');

select * from finish();
rollback;
