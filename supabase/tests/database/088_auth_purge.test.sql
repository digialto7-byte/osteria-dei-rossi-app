-- M11 step 9 (migration 20261025100800_auth_purge.sql): the retention purge of the security logs and its cron job.
-- Attempts and sessions are kept 30 days, unused codes 30 days past expiry, the enrolment IP log 1 day. This is
-- retention, not ledger editing: no API role can delete these rows, and the purge only deletes rows past retention.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

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

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('90000000-0000-4000-8000-000000000001', 'staff-1@staff.invalid');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo', 'email'),
  ('91000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '90000000-0000-4000-8000-000000000001', 'waiter', 'Cameriere Demo', 'pin');
insert into public.venue_device (id, tenant_id, label, token_hash, created_by) values
  ('d0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Telefono sala (demo)', repeat('1', 64), 'a1000000-0000-4000-8000-00000000000a');

-- Attempts: 31 and 29 days old (success, failure, pin_reset), and a 31-day-old pending (purged too since migration 20261025101000).
insert into public.auth_attempt (id, tenant_id, device_id, app_user_id, outcome, started_at, finished_at) values
  ('a1000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'success', '2026-09-23T10:00:00Z', '2026-09-23T10:00:01Z'),
  ('a1000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'failure', '2026-09-23T10:01:00Z', '2026-09-23T10:01:01Z'),
  ('a1000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', null, '91000000-0000-4000-8000-000000000001', 'pin_reset', '2026-09-23T10:02:00Z', '2026-09-23T10:02:00Z'),
  ('a1000000-0000-4000-8000-0000000000a4', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'error', '2026-09-23T10:03:00Z', '2026-09-23T10:03:01Z'),
  ('a1000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'success', '2026-09-25T10:00:00Z', '2026-09-25T10:00:01Z'),
  ('a1000000-0000-4000-8000-0000000000b2', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'failure', '2026-09-25T10:01:00Z', '2026-09-25T10:01:01Z'),
  ('a1000000-0000-4000-8000-0000000000b3', '11111111-1111-4111-8111-111111111111', null, '91000000-0000-4000-8000-000000000001', 'pin_reset', '2026-09-25T10:02:00Z', '2026-09-25T10:02:00Z');
insert into public.auth_attempt (id, tenant_id, device_id, app_user_id, started_at) values
  ('a1000000-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '2026-09-23T10:05:00Z');
-- Sessions: ended 31 days ago, ended 29 days ago, open with a future end.
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, started_at, ends_at, ended_at, end_reason) values
  ('57000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', '91000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-0000000000a1', '2026-09-22T10:00:00Z', '2026-09-23T00:00:00Z', '2026-09-23T10:00:00Z', 'logout'),
  ('57000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', '91000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-0000000000b1', '2026-09-24T10:00:00Z', '2026-09-26T00:00:00Z', '2026-09-25T10:00:00Z', 'logout');
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, started_at, ends_at) values
  ('57000000-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', '91000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-0000000000c1', '2026-10-23T10:00:00Z', '2026-10-25T00:00:00Z');
-- Codes: unused expired 31 days ago, unused expired 29 days ago, used (old).
insert into public.device_enrolment (id, tenant_id, label, code_hash, expires_at, created_by) values
  ('e1000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Vecchio (demo)', repeat('a', 64), '2026-09-23T10:00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('e1000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', 'Recente (demo)', repeat('b', 64), '2026-09-25T10:00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('e1000000-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', 'Usato (demo)', repeat('c', 64), '2026-09-01T10:00:00Z', 'a1000000-0000-4000-8000-00000000000a');
update public.device_enrolment set used_at = '2026-09-01T09:50:00Z', device_id = 'd0000000-0000-4000-8000-000000000001' where id = 'e1000000-0000-4000-8000-0000000000c1';
-- IP failures: 25 h and 23 h old.
insert into app.enrol_failure (ip_hash, at) values (repeat('1', 64), '2026-10-23T18:00:00Z'), (repeat('2', 64), '2026-10-23T20:00:00Z');
-- Audit rows about staff and devices.
insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_at, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'app_user', '91000000-0000-4000-8000-000000000001', 'app_user.created', '2026-08-01T10:00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'venue_device', 'd0000000-0000-4000-8000-000000000001', 'venue_device.enrolled', '2026-08-01T10:00:00Z', 'a1000000-0000-4000-8000-00000000000a');

-- Append-only stance before the purge -------------------------------------------------------------------------------------------
select is(pg_temp.err($$ delete from public.auth_attempt $$), 'P0001', 'the migration owner cannot delete attempts without the purge setting');
set local role authenticated;
select is(pg_temp.err($$ delete from public.auth_attempt $$), '42501', 'authenticated: permission denied');
reset role;
set local role service_role;
select is(pg_temp.err($$ delete from public.auth_attempt $$), '42501', 'service_role: permission denied');
select is(pg_temp.err($$ delete from public.staff_session $$), '42501', 'and for staff_session');
reset role;

select is(app.purge_auth_data('2026-10-24T19:00:00Z'), 8, 'the purge returns the rows deleted: 5 attempts (the stale pending one included), 1 session, 1 code, 1 IP row');
select is((select string_agg(right(id::text, 2), ',' order by id) from public.auth_attempt), 'b1,b2,b3', 'attempts: 31 days old (success, failure, pin_reset, error, pending) deleted; 29 days old kept');
select is((select string_agg(right(id::text, 2), ',' order by id) from public.staff_session), 'b1,c1', 'sessions: ended 31 days ago deleted; recent and open ones kept');
select is((select string_agg(right(id::text, 2), ',' order by id) from public.device_enrolment), 'b1,c1', 'codes: the unused one expired 31 days ago deleted; the recent and the used kept');
select is((select string_agg(left(ip_hash, 1), ',') from app.enrol_failure), '2', 'IP failures: 25 h old deleted, 23 h kept');
select is((select count(*)::int from public.audit_event where entity_type in ('app_user', 'venue_device')), 2, 'audit rows about staff and devices are untouched');
select is((select count(*)::int from public.venue_device), 1, 'devices are never deleted');
select is((select count(*)::int from public.app_user), 2, 'nor users');

select is((select job || ' ' || ok::text || ' ' || items::text from app.job_run order by id desc limit 1), 'auth-purge true 8', 'one job_run row: auth-purge, ok, with the item count');
select is((select count(*)::int from app.job_run where job = 'auth-purge'), 1, 'exactly one');
select is(app.purge_auth_data('2026-10-24T19:00:00Z'), 0, 'a second run deletes nothing');

-- The setting is local to the purge ---------------------------------------------------------------------------------------------------
select is(coalesce(current_setting('app.auth_purge', true), ''), '', 'app.auth_purge is not left on after the purge');
select is(pg_temp.err($$ delete from public.auth_attempt where id = 'a1000000-0000-4000-8000-0000000000b1' $$), 'P0001', 'so a plain delete is still refused');

-- Never-ended sessions ---------------------------------------------------------------------------------------------------------------------------------
-- An open session never ended with ends_at 31 days ago is deleted too (coalesce(ended_at, ends_at)).
insert into public.staff_session (id, tenant_id, app_user_id, device_id, auth_session_id, started_at, ends_at) values
  ('57000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', '91000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-0000000000d1', '2026-09-20T10:00:00Z', '2026-09-21T00:00:00Z');
select is(app.purge_auth_data('2026-10-24T19:00:00Z'), 1, 'a never-ended session past its end by more than 30 days is purged');

-- Job and cron -------------------------------------------------------------------------------------------------------------------------------------
select lives_ok($$ select public.job_run_start('auth-purge') $$, 'job_run_start accepts auth-purge (042 stays green)');
select is(left(pg_temp.err($$ select public.job_run_start('foo') $$), 5), '23514', 'and still refuses unknown jobs');
select is((select schedule from cron.job where jobname = 'auth-purge'), '30 3 * * *', 'cron job auth-purge at 03:30 UTC');
select is((select command from cron.job where jobname = 'auth-purge'), 'select app.purge_auth_data()', 'running app.purge_auth_data()');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role)
           where has_function_privilege(r.role, 'app.purge_auth_data(timestamptz)', 'execute')), 0, 'no API role can execute the purge');
select is(pg_temp.err($$ truncate public.auth_attempt $$), 'P0001', 'truncate is still refused');
select is(pg_temp.err($$ truncate public.staff_session $$), 'P0001', 'also for staff_session');
select ok(pg_temp.err($$ truncate public.device_enrolment $$) in ('P0001', '0A000'), 'and for device_enrolment (the guard, or the foreign key from venue_device)');
select is(pg_temp.err($$ delete from public.device_enrolment $$), 'P0001', 'a direct delete of codes is refused');

select * from finish();
rollback;
