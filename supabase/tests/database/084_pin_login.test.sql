-- M11 step 5 (migration 20261025100400_pin_login.sql): PIN login begin and finish, the user and device
-- lockouts and the device_locked alert. Acceptance tests 1, 2 and 3 (database half). The `_at` functions take a
-- fake clock; the public wrappers are service_role only (decision D1).
begin;
create extension if not exists pgtap with schema extensions;
select plan(78);

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

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT00000000001');
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare Demo B');

-- User n: auth 90..n, app 91..n, email staff-<id>@staff.invalid.
create function pg_temp.uid(n int) returns uuid language sql as $$
  select ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.mkuser(n int, p_tenant uuid, p_role public.app_role, p_name text,
                               p_login public.login_method default 'pin', p_active boolean default true)
  returns void language plpgsql as $$
begin
  insert into auth.users (id, email) values (('90000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
    'staff-' || pg_temp.uid(n) || '@staff.invalid');
  insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method, is_active, deactivated_at)
    values (pg_temp.uid(n), p_tenant, ('90000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, p_role, p_name,
            p_login, p_active, case when p_active then null else now() end);
end $$;
-- Device n: token hash = n repeated (n < 16), tenant A.
create function pg_temp.dev(n int) returns uuid language sql as $$
  select ('d0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.hash(n int) returns text language sql as $$ select repeat(to_hex(n), 64) $$;
create function pg_temp.mkdev(n int, p_label text) returns void language sql as $$
  insert into public.venue_device (id, tenant_id, label, token_hash, created_by)
  values (pg_temp.dev(n), '11111111-1111-4111-8111-111111111111', p_label, pg_temp.hash(n),
          'a1000000-0000-4000-8000-00000000000a') $$;

select pg_temp.mkuser(1, '11111111-1111-4111-8111-111111111111', 'waiter', 'Cameriere Demo');
select pg_temp.mkuser(2, '11111111-1111-4111-8111-111111111111', 'chef', 'Cuoco Demo');
select pg_temp.mkuser(3, '11111111-1111-4111-8111-111111111111', 'chef', 'Cuoco Email', 'email');
select pg_temp.mkuser(4, '11111111-1111-4111-8111-111111111111', 'waiter', 'Cameriere Inattivo', 'pin', false);
select pg_temp.mkuser(5, '22222222-2222-4222-8222-222222222222', 'chef', 'Cuoco Demo B');
select pg_temp.mkuser(6, '11111111-1111-4111-8111-111111111111', 'waiter', 'Cameriere Demo Due');
select pg_temp.mkuser(7, '11111111-1111-4111-8111-111111111111', 'waiter', 'Cameriere Demo Tre');
select pg_temp.mkuser(8, '11111111-1111-4111-8111-111111111111', 'waiter', 'Cameriere Demo Quattro');

select pg_temp.mkdev(1, 'Telefono sala (demo)');
select pg_temp.mkdev(2, 'Tablet cucina (demo)');
select pg_temp.mkdev(3, 'Revocato (demo)');
update public.venue_device set revoked_at = now(), revoked_by = 'a1000000-0000-4000-8000-00000000000a' where id = pg_temp.dev(3);
select pg_temp.mkdev(4, 'Bloccato (demo)');
update public.venue_device set locked_at = now() where id = pg_temp.dev(4);
select pg_temp.mkdev(5, 'Vecchi errori (demo)');
select pg_temp.mkdev(6, 'Dopo lo sblocco (demo)');
update public.venue_device set unlocked_at = '2026-10-24T18:50:00Z' where id = pg_temp.dev(6);
select pg_temp.mkdev(7, 'Rifiuto avviso (demo)');
select pg_temp.mkdev(8, 'Sonde (demo)');
select pg_temp.mkdev(9, 'Errori (demo)');

-- Begin and finish through the fake clock. begin/finish results are kept in a table for assertions.
create temporary table res (k text primary key, v jsonb);
create function pg_temp.b(p_dev int, p_user uuid, p_at timestamptz) returns jsonb language sql as $$
  select app.pin_login_begin_at(pg_temp.hash(p_dev), p_user, p_at) $$;
create function pg_temp.f(p_attempt jsonb, p_outcome text, p_at timestamptz, p_session uuid default null)
  returns jsonb language sql as $$
  select app.pin_login_finish_at((p_attempt ->> 'attemptId')::uuid, p_outcome::public.auth_attempt_outcome, p_session, p_at) $$;
-- One wrong PIN: begin then finish failure.
create function pg_temp.wrong(p_dev int, p_user uuid, p_at timestamptz) returns jsonb language plpgsql as $$
declare b jsonb;
begin
  b := pg_temp.b(p_dev, p_user, p_at);
  if b ->> 'status' <> 'proceed' then return b; end if;
  return pg_temp.f(b, 'failure', p_at + interval '1 second');
end $$;

-- Device checks ---------------------------------------------------------------------------------------------------
select is(app.pin_login_begin_at(repeat('0', 64), pg_temp.uid(1), '2026-10-24T19:00:00Z') ->> 'status', 'device_unknown', 'unknown token hash: device_unknown');
select is(app.pin_login_begin_at('not-a-hash', pg_temp.uid(1), '2026-10-24T19:00:00Z') ->> 'status', 'device_unknown', 'a malformed hash is just unknown');
select is(pg_temp.b(3, pg_temp.uid(1), '2026-10-24T19:00:00Z') ->> 'status', 'device_revoked', 'revoked device: device_revoked');
select is(pg_temp.b(4, pg_temp.uid(1), '2026-10-24T19:00:00Z') ->> 'status', 'device_locked', 'locked device: device_locked');
select is((select count(*)::int from public.auth_attempt), 0, 'none of them inserts an attempt');

-- Invalid users: one finished failure row, answered as pin_invalid -----------------------------------------------------
select is(pg_temp.b(1, '99999999-9999-4999-8999-999999999999', '2026-10-24T19:00:00Z') ->> 'status', 'pin_invalid', 'unknown user id: pin_invalid');
select is(pg_temp.b(1, 'a1000000-0000-4000-8000-00000000000a', '2026-10-24T19:00:01Z') ->> 'status', 'pin_invalid', 'the owner id: pin_invalid');
select is(pg_temp.b(1, pg_temp.uid(3), '2026-10-24T19:00:02Z') ->> 'status', 'pin_invalid', 'an email chef: pin_invalid');
select is(pg_temp.b(1, pg_temp.uid(4), '2026-10-24T19:00:03Z') ->> 'status', 'pin_invalid', 'an inactive pin waiter: pin_invalid');
select is(pg_temp.b(1, pg_temp.uid(5), '2026-10-24T19:00:04Z') ->> 'status', 'pin_invalid', 'a tenant B chef: pin_invalid');
select is((select count(*)::int from public.auth_attempt where device_id = pg_temp.dev(1) and outcome = 'failure'
             and finished_at is not null), 5, 'five finished failure rows, one per refused user');
select is((select count(*)::int from public.auth_attempt where device_id = pg_temp.dev(1) and outcome = 'pending'), 0, 'and no pending row (no Auth call follows)');

-- Proceed ---------------------------------------------------------------------------------------------------------------
insert into res select 'p1', pg_temp.b(2, pg_temp.uid(1), '2026-10-24T19:10:00Z');
select is((select v ->> 'status' from res where k = 'p1'), 'proceed', 'an active pin waiter proceeds');
select is((select v ->> 'authEmail' from res where k = 'p1'), 'staff-' || pg_temp.uid(1) || '@staff.invalid', 'with the auth email');
select is((select count(*)::int from public.auth_attempt where id = (select (v ->> 'attemptId')::uuid from res where k = 'p1')
             and outcome = 'pending' and device_id = pg_temp.dev(2) and app_user_id = pg_temp.uid(1)), 1, 'and a pending attempt');
select is(pg_temp.b(1, pg_temp.uid(1), '2026-10-24T19:10:20Z') ->> 'status', 'attempt_in_progress', 'same user, other device, within 30 s: attempt_in_progress');
select is(pg_temp.b(2, pg_temp.uid(2), '2026-10-24T19:10:20Z') ->> 'status', 'attempt_in_progress', 'same device, other user, within 30 s: attempt_in_progress');
insert into res select 'p2', pg_temp.b(2, pg_temp.uid(2), '2026-10-24T19:10:31Z');
select is((select v ->> 'status' from res where k = 'p2'), 'proceed', 'after 31 s it proceeds');
select is(pg_temp.f((select v from res where k = 'p2'), 'error', '2026-10-24T19:10:32Z') ->> 'status', 'auth_error', 'an Auth error closes it without counting');
select is(app.user_failure_run(pg_temp.uid(1), '2026-10-24T19:10:31Z'), 1, 'and the stale pending of the first now counts as a failure');
select is(app.user_failure_run(pg_temp.uid(1), '2026-10-24T19:10:20Z'), 0, 'but not while it is still within 30 s');

-- Finish ---------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err(format($$ select pg_temp.f('{"attemptId": "%s"}', 'success', '2026-10-24T19:11:00Z') $$,
  (select v ->> 'attemptId' from res where k = 'p2'))), '22023 session_required', 'success without a session id: 22023');
select is(pg_temp.err(format($$ select pg_temp.f('{"attemptId": "%s"}', 'pending', '2026-10-24T19:11:00Z') $$,
  (select v ->> 'attemptId' from res where k = 'p2'))), '22023 invalid_outcome', 'outcome pending: 22023');
select is(pg_temp.err(format($$ select pg_temp.f('{"attemptId": "%s"}', 'pin_reset', '2026-10-24T19:11:00Z') $$,
  (select v ->> 'attemptId' from res where k = 'p2'))), '22023 invalid_outcome', 'outcome pin_reset: 22023');
select is(pg_temp.err($$ select pg_temp.f('{"attemptId": "99999999-9999-4999-8999-999999999999"}', 'failure', '2026-10-24T19:11:00Z') $$),
  'P0002 attempt_not_found', 'an unknown attempt: P0002');

-- A login at 2026-10-24T23:30Z ends at the cut-off (00:00Z).
insert into res select 'p3', pg_temp.b(1, pg_temp.uid(6), '2026-10-24T23:30:00Z');
insert into res select 'f3', pg_temp.f((select v from res where k = 'p3'), 'success', '2026-10-24T23:30:01Z', '5e000000-0000-4000-8000-0000000000e1');
select is((select v ->> 'status' from res where k = 'f3'), 'ok', 'finish success: ok');
select is((select (v ->> 'endsAt')::timestamptz from res where k = 'f3'), '2026-10-25T00:00:00Z'::timestamptz, 'endsAt is the next cut-off');
select is((select ends_at from public.staff_session where auth_session_id = '5e000000-0000-4000-8000-0000000000e1'),
  '2026-10-25T00:00:00Z'::timestamptz, 'the staff_session holds it');
select is((select count(*)::int from public.staff_session where app_user_id = pg_temp.uid(6) and device_id = pg_temp.dev(1)
             and tenant_id = '11111111-1111-4111-8111-111111111111' and ended_at is null), 1, 'one open session of that user on that device');
select is((select last_login_at from public.venue_device where id = pg_temp.dev(1)), '2026-10-24T23:30:01Z'::timestamptz, 'last_login_at is set');
select is(pg_temp.err(format($$ select pg_temp.f('{"attemptId": "%s"}', 'failure', '2026-10-24T23:31:00Z') $$,
  (select v ->> 'attemptId' from res where k = 'p3'))), 'P0001 attempt_not_pending', 'finishing twice: attempt_not_pending');

-- User lock (AT3): user 7 on device 1 ----------------------------------------------------------------------------------------
select is(pg_temp.wrong(1, pg_temp.uid(7), '2026-10-24T20:00:00Z') ->> 'attemptsLeft', '4', 'wrong PIN 1: 4 left');
select is(pg_temp.wrong(1, pg_temp.uid(7), '2026-10-24T20:01:00Z') ->> 'attemptsLeft', '3', 'wrong PIN 2: 3 left');
select is(pg_temp.wrong(1, pg_temp.uid(7), '2026-10-24T20:02:00Z') ->> 'attemptsLeft', '2', 'wrong PIN 3: 2 left');
select is(pg_temp.wrong(1, pg_temp.uid(7), '2026-10-24T20:03:00Z') ->> 'attemptsLeft', '1', 'wrong PIN 4: 1 left');
insert into res select 'w5', pg_temp.wrong(1, pg_temp.uid(7), '2026-10-24T20:04:00Z');
select is((select v ->> 'status' from res where k = 'w5'), 'user_locked', 'the 5th wrong PIN already answers user_locked');
select is((select (v ->> 'lockedUntil')::timestamptz from res where k = 'w5'), '2026-10-24T20:19:00Z'::timestamptz, 'locked until the 5th start + 15 min');
select is(pg_temp.b(1, pg_temp.uid(7), '2026-10-24T20:18:00Z') ->> 'status', 'user_locked', 'a begin 14 min later: user_locked (even a correct PIN never reaches Auth)');
select is((select count(*)::int from public.auth_attempt where app_user_id = pg_temp.uid(7) and outcome = 'pending'), 0, 'it inserted no pending row');
select is(pg_temp.b(2, pg_temp.uid(7), '2026-10-24T20:18:59Z') ->> 'status', 'user_locked', 'the lock is per user, on any device');
insert into res select 'after15', pg_temp.b(1, pg_temp.uid(7), '2026-10-24T20:19:01Z');
select is((select v ->> 'status' from res where k = 'after15'), 'proceed', '15 min + 1 s after the 5th start: proceed');
select is(pg_temp.f((select v from res where k = 'after15'), 'failure', '2026-10-24T20:19:02Z') ->> 'status', 'user_locked', 'one more wrong PIN locks again');
select is(pg_temp.b(1, pg_temp.uid(7), '2026-10-24T20:30:00Z') ->> 'status', 'user_locked', 'for another 15 minutes');

-- A success in the run resets the count (user 8) --------------------------------------------------------------------------------
select pg_temp.wrong(1, pg_temp.uid(8), '2026-10-24T21:00:00Z');
select pg_temp.wrong(1, pg_temp.uid(8), '2026-10-24T21:01:00Z');
select pg_temp.wrong(1, pg_temp.uid(8), '2026-10-24T21:02:00Z');
insert into res select 'ok8', pg_temp.b(1, pg_temp.uid(8), '2026-10-24T21:03:00Z');
select is(pg_temp.f((select v from res where k = 'ok8'), 'success', '2026-10-24T21:03:01Z', '5e000000-0000-4000-8000-0000000000e8') ->> 'status', 'ok', 'a correct PIN after three wrong ones');
select is(pg_temp.wrong(1, pg_temp.uid(8), '2026-10-24T21:04:00Z') ->> 'attemptsLeft', '4', 'the success reset the count');
select is(pg_temp.wrong(1, pg_temp.uid(8), '2026-10-24T21:05:00Z') ->> 'attemptsLeft', '3', 'and it counts again from there');
-- A pin_reset row ends the run.
insert into public.auth_attempt (tenant_id, device_id, app_user_id, outcome, started_at, finished_at)
  values ('11111111-1111-4111-8111-111111111111', null, pg_temp.uid(8), 'pin_reset', '2026-10-24T21:06:00Z', '2026-10-24T21:06:00Z');
select is(pg_temp.wrong(1, pg_temp.uid(8), '2026-10-24T21:07:00Z') ->> 'attemptsLeft', '4', 'a pin_reset row resets the count too');

-- An error outcome is not counted ---------------------------------------------------------------------------------------------------
insert into res select 'e1', pg_temp.b(9, pg_temp.uid(2), '2026-10-24T22:00:00Z');
select is(pg_temp.f((select v from res where k = 'e1'), 'error', '2026-10-24T22:00:02Z') ->> 'status', 'auth_error', 'error outcome: auth_error');
select is(app.user_failure_run(pg_temp.uid(2), '2026-10-24T22:00:03Z'), 0, 'it is not a failure for the user');
select is(app.device_failures(pg_temp.dev(9), '2026-10-24T22:00:03Z'), 0, 'nor for the device');
select is(pg_temp.b(9, pg_temp.uid(2), '2026-10-24T22:00:04Z') ->> 'status', 'proceed', 'and the user can try again at once');
-- Finish on a device revoked or locked while Auth was running opens no session.
insert into res select 'late', pg_temp.b(5, pg_temp.uid(2), '2026-10-24T22:10:00Z');
update public.venue_device set revoked_at = '2026-10-24T22:10:05Z', revoked_by = 'a1000000-0000-4000-8000-00000000000a' where id = pg_temp.dev(5);
select is(pg_temp.f((select v from res where k = 'late'), 'success', '2026-10-24T22:10:06Z', '5e000000-0000-4000-8000-0000000000e9') ->> 'status', 'device_revoked', 'success on a device revoked meanwhile: device_revoked');
select is((select count(*)::int from public.staff_session where auth_session_id = '5e000000-0000-4000-8000-0000000000e9'), 0, 'and no session is opened');

-- Device lock (AT3) on device 8: probes with invalid user ids count ---------------------------------------------------------------------
insert into public.auth_attempt (tenant_id, device_id, app_user_id, outcome, started_at, finished_at)
  select '11111111-1111-4111-8111-111111111111', pg_temp.dev(8), null, 'failure',
         '2026-10-24T22:00:00Z'::timestamptz + g * interval '10 seconds', '2026-10-24T22:00:00Z'::timestamptz + g * interval '10 seconds'
    from generate_series(1, 18) g;
select is(pg_temp.b(8, '99999999-9999-4999-8999-999999999999', '2026-10-24T22:10:00Z') ->> 'status', 'pin_invalid', 'failure 19 (a probe) is just pin_invalid');
select is(app.device_failures(pg_temp.dev(8), '2026-10-24T22:10:01Z'), 19, '19 failures on the device');
select is((select locked_at from public.venue_device where id = pg_temp.dev(8)), null, 'not locked at 19');
select is(pg_temp.b(8, '99999999-9999-4999-8999-999999999999', '2026-10-24T22:11:00Z') ->> 'status', 'device_locked', 'the 20th, a probe, locks the device');
select is((select locked_at from public.venue_device where id = pg_temp.dev(8)), '2026-10-24T22:11:00Z'::timestamptz, 'locked_at is set');

-- Device lock through finish on device 1 (open sessions end) -----------------------------------------------------------------------------
insert into public.auth_attempt (tenant_id, device_id, app_user_id, outcome, started_at, finished_at)
  select '11111111-1111-4111-8111-111111111111', pg_temp.dev(2), null, 'failure',
         '2026-10-24T23:00:00Z'::timestamptz + g * interval '10 seconds', '2026-10-24T23:00:00Z'::timestamptz + g * interval '10 seconds'
    from generate_series(1, 19) g;
insert into public.staff_session (tenant_id, app_user_id, device_id, auth_session_id, ends_at)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.uid(6), pg_temp.dev(2), '5e000000-0000-4000-8000-0000000000ea', '2026-10-25T00:00:00Z');
insert into res select 'lock', pg_temp.wrong(2, pg_temp.uid(2), '2026-10-24T23:10:00Z');
select is((select v ->> 'status' from res where k = 'lock'), 'device_locked', 'the 20th failure through finish: device_locked');
select is((select locked_at is not null from public.venue_device where id = pg_temp.dev(2)), true, 'locked_at set');
select is((select end_reason::text from public.staff_session where auth_session_id = '5e000000-0000-4000-8000-0000000000ea'), 'device_locked', 'the open session of the device ended with device_locked');
select is((select count(*)::int from public.alert where kind = 'device_locked' and entity_id = pg_temp.dev(2)), 1, 'exactly one device_locked alert');
select is((select audience_roles::text from public.alert where kind = 'device_locked' and entity_id = pg_temp.dev(2)), '{owner}', 'for the owner');
select is((select array_agg(k order by k) from public.alert a, jsonb_object_keys(a.payload) k where a.kind = 'device_locked' and a.entity_id = pg_temp.dev(2)),
  array['device_id', 'device_label', 'failures_count', 'locked_at', 'window_minutes'], 'with exactly the five payload keys');
select is((select (payload ->> 'failures_count')::int || ' ' || (payload ->> 'window_minutes') || ' ' || (payload ->> 'device_label')
             from public.alert where kind = 'device_locked' and entity_id = pg_temp.dev(2)), '20 60 Tablet cucina (demo)', 'failures_count 20, window 60, the device label');
select is(pg_temp.b(2, pg_temp.uid(2), '2026-10-24T23:11:00Z') ->> 'status', 'device_locked', 'a locked device refuses further begins');

-- Failures older than 60 minutes do not count (device 5 is revoked: use device 6 for the restart rule) ------------------------------------------
insert into public.auth_attempt (tenant_id, device_id, app_user_id, outcome, started_at, finished_at)
  select '11111111-1111-4111-8111-111111111111', pg_temp.dev(6), null, 'failure',
         '2026-10-24T18:00:00Z'::timestamptz + g * interval '10 seconds', '2026-10-24T18:00:00Z'::timestamptz + g * interval '10 seconds'
    from generate_series(1, 25) g;
select is(app.device_failures(pg_temp.dev(6), '2026-10-24T19:00:00Z'), 0, 'failures before unlocked_at (18:50) do not count: the count restarts after an unlock');
select is(app.device_failures(pg_temp.dev(6), '2026-10-24T18:05:00Z'), 0, 'and neither before it was ever unlocked at that time');
insert into public.auth_attempt (tenant_id, device_id, app_user_id, outcome, started_at, finished_at)
  select '11111111-1111-4111-8111-111111111111', pg_temp.dev(1), null, 'failure',
         '2026-10-25T10:00:00Z'::timestamptz + g * interval '10 seconds', '2026-10-25T10:00:00Z'::timestamptz + g * interval '10 seconds'
    from generate_series(1, 25) g;
select is(app.device_failures(pg_temp.dev(1), '2026-10-25T10:30:00Z'), 25, 'recent failures count');
select is(app.device_failures(pg_temp.dev(1), '2026-10-25T11:05:00Z'), 0, 'failures older than 60 minutes do not');

-- Alert refusal does not undo the lock ---------------------------------------------------------------------------------------------------------
insert into public.auth_attempt (tenant_id, device_id, app_user_id, outcome, started_at, finished_at)
  select '11111111-1111-4111-8111-111111111111', pg_temp.dev(7), null, 'failure',
         '2026-10-24T22:00:00Z'::timestamptz + g * interval '10 seconds', '2026-10-24T22:00:00Z'::timestamptz + g * interval '10 seconds'
    from generate_series(1, 19) g;
-- Earlier alerts reference the kind: the foreign key is dropped for this test only (the transaction rolls back).
alter table public.alert drop constraint alert_kind_fkey;
delete from app.alert_kind where kind = 'device_locked';
select is(pg_temp.wrong(7, pg_temp.uid(2), '2026-10-24T22:10:00Z') ->> 'status', 'device_locked', 'with the kind missing, the 20th failure still answers device_locked');
select is((select locked_at is not null from public.venue_device where id = pg_temp.dev(7)), true, 'and the device is locked');
select is((select code || ' ' || caller from app.alert_refusal order by id desc limit 1), 'unknown_alert_kind pin_login_finish', 'one refusal is recorded');
select is((select count(*)::int from public.alert where kind = 'device_locked' and entity_id = pg_temp.dev(7)), 0, 'and no alert exists');

-- Grants ------------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from unnest(array['anon', 'authenticated']) r(role),
                unnest(array['public.pin_login_begin(text,uuid)', 'public.pin_login_finish(uuid,text,uuid)']) f(name)
           where has_function_privilege(r.role, f.name, 'execute')), 0, 'anon and authenticated cannot execute the wrappers');
select ok(has_function_privilege('service_role', 'public.pin_login_begin(text,uuid)', 'execute')
      and has_function_privilege('service_role', 'public.pin_login_finish(uuid,text,uuid)', 'execute'), 'service_role can');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r(role),
                unnest(array['app.pin_login_begin_at(text,uuid,timestamptz)',
                             'app.pin_login_finish_at(uuid,public.auth_attempt_outcome,uuid,timestamptz)',
                             'app.lock_pin_login(uuid,uuid)', 'app.user_lock_until(uuid,timestamptz)',
                             'app.user_failure_run(uuid,timestamptz)', 'app.device_failures(uuid,timestamptz)',
                             'app.end_staff_sessions(uuid,uuid,public.staff_session_end,timestamptz)']) f(name)
           where has_function_privilege(r.role, f.name, 'execute')), 0, 'no API role executes the app.* helpers');
select is(pg_temp.err($$ select public.pin_login_finish('99999999-9999-4999-8999-999999999999', 'bogus', null) $$),
  '22023 invalid_outcome', 'the wrapper refuses an unknown outcome text');

select * from finish();
rollback;
