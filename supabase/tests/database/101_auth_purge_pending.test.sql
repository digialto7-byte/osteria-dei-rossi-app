-- M11 review fix (migration 20261025101000_auth_purge_pending.sql): an attempt left `pending` (a crashed request
-- never finished it) is a security-log row of personal data like any other, so the purge removes it after 30
-- days too (project Q14). Recent pending attempts stay: they still serve the in-flight limit for 30 seconds.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('90000000-0000-4000-8000-000000000001', 'staff-91000000-0000-4000-8000-000000000001@staff.invalid');
insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo', 'email'),
  ('91000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '90000000-0000-4000-8000-000000000001', 'waiter', 'Cameriere Demo', 'pin');
insert into public.venue_device (id, tenant_id, label, token_hash, created_by) values
  ('d0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Telefono sala (demo)', repeat('1', 64), 'a1000000-0000-4000-8000-00000000000a');

-- Pending attempts started 31 days, 30 days + 1 minute, 29 days and 1 minute before the purge time.
insert into public.auth_attempt (id, tenant_id, device_id, app_user_id, started_at) values
  ('a1000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '2026-09-23T19:00:00Z'),
  ('a1000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '2026-09-24T18:59:00Z'),
  ('a1000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '2026-09-25T19:01:00Z'),
  ('a1000000-0000-4000-8000-0000000000b2', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '2026-10-24T18:59:50Z');
-- A recent finished attempt, which must be kept.
insert into public.auth_attempt (id, tenant_id, device_id, app_user_id, outcome, started_at, finished_at) values
  ('a1000000-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'failure', '2026-10-20T10:00:00Z', '2026-10-20T10:00:01Z');

select is(app.purge_auth_data('2026-10-24T19:00:00Z'), 2, 'the purge deletes the two pending attempts older than 30 days');
select is((select string_agg(right(id::text, 2), ',' order by id) from public.auth_attempt), 'b1,b2,c1',
  'a pending attempt of 29 days and one of 10 seconds are kept, and so is the recent finished one');
select is((select count(*)::int from public.auth_attempt where outcome = 'pending'), 2, 'the kept pending attempts are still pending');
select is((select job || ' ' || ok::text || ' ' || items::text from app.job_run order by id desc limit 1), 'auth-purge true 2',
  'recorded in job_run with the count');
select is(app.purge_auth_data('2026-10-24T19:00:00Z'), 0, 'a second run deletes nothing');
-- Just past the boundary: the 29-day one is purged once it is older than 30 days.
select is(app.purge_auth_data('2026-10-26T19:00:00Z'), 1, 'two days later the former 29-day pending attempt goes too (the 10-second one stays)');
select is((select count(*)::int from public.auth_attempt), 2, 'two attempts left: the recent pending and the recent failure');
select is((select schedule from cron.job where jobname = 'auth-purge'), '30 3 * * *', 'the cron job is unchanged');

select * from finish();
rollback;
