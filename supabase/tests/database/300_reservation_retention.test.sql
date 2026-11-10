-- Reservations B4 (docs/plans/1998-11-08-reservations.md §3.3.6, §3.9, §5 B4; ADR-032): the retention job. app.run_reservation_retention(p_now), in order and per tenant in its own
-- sub-transaction: pending requests whose start has come -> expired (event expired); contacts of bookings whose business date is before the tenant's local today minus
-- retention_days -> deleted (event contact_purged, queued e-mails skipped), for every status, the booking row stays; throttle rows older than 2 days -> deleted. One job_run row
-- per run (ok false, retention_failed when a tenant failed; the others are still done). pg_cron runs it daily at 03:20 UTC. app.job_health_checks names it when it has had no
-- successful run for 48 hours (own-history rule) or when it is not scheduled. p_now is fixed. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);
-- Hold off pg_cron's own job_run inserts until this file rolls back (the health checks below read the log).
lock table app.job_run in share row exclusive mode;
delete from app.job_run where job = 'reservation-retention';

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  v_out text;
  state text;
  msg text;
begin
  execute stmt into v_out;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
create function pg_temp.rid(p_n integer) returns uuid language sql as $$ select ('c0000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
-- A has no settings row (retention 30, the default); B keeps contacts 7 days.
insert into public.reservation_settings (tenant_id, retention_days) values ('22222222-2222-4222-8222-222222222222', 7);

-- Booking n of a tenant on a business date, a status and a start (default 20:00 Rome of that date), with its contact and a queued 'received' e-mail.
create function pg_temp.mk(p_n integer, p_date date, p_status public.reservation_status default 'declined', p_tenant uuid default '11111111-1111-4111-8111-111111111111', p_start timestamptz default null) returns void language plpgsql as $$
declare
  v_start timestamptz := coalesce(p_start, ((p_date + time '20:00') at time zone 'Europe/Rome'));
begin
  insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
    values (p_tenant, pg_temp.rid(p_n), 'pending', p_date, 'cena', v_start, v_start + interval '2 hours', 2, 'v1', v_start - interval '10 days');
  insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale)
    values (p_tenant, pg_temp.rid(p_n), 'Cliente Demo', '390000000001', 'cliente.demo@example.com', 'it');
  insert into public.reservation_email (tenant_id, reservation_id, kind) values (p_tenant, pg_temp.rid(p_n), 'received');
  if p_status in ('seated', 'no_show') then
    update public.reservation set status = 'accepted' where tenant_id = p_tenant and id = pg_temp.rid(p_n);
  end if;
  if p_status <> 'pending' then
    update public.reservation set status = p_status where tenant_id = p_tenant and id = pg_temp.rid(p_n);
  end if;
end
$$;
create function pg_temp.has_contact(p_n integer) returns boolean language sql as $$ select exists (select 1 from public.reservation_contact where reservation_id = pg_temp.rid(p_n)) $$;
create function pg_temp.ev(p_n integer, p_kind text) returns integer language sql as $$ select count(*)::int from public.reservation_event where reservation_id = pg_temp.rid(p_n) and kind = p_kind $$;

-- Today is 1998-11-20 (Rome); the run is at 03:20 UTC. A: 30 days of retention, so 1998-10-21 (today - 30) is kept and 1998-10-20 (today - 31) is purged.
select pg_temp.mk(1, '1998-10-20', 'declined');
select pg_temp.mk(2, '1998-10-21', 'declined');
select pg_temp.mk(3, '1998-10-20', 'cancelled');
select pg_temp.mk(4, '1998-10-06', 'seated');
select pg_temp.mk(5, '1998-10-20', 'no_show');
select pg_temp.mk(6, '1998-10-20', 'accepted');
select pg_temp.mk(7, '1998-10-20', 'pending');                                  -- never expired by anyone: expired first, then purged
select pg_temp.mk(8, '1998-11-19', 'pending');                                  -- started yesterday: expired, contact kept (recent)
select pg_temp.mk(9, '1998-11-25', 'pending');                                  -- in the future: untouched
select pg_temp.mk(10, '1998-11-20', 'pending', '11111111-1111-4111-8111-111111111111', '1998-11-20 03:20:00+00');  -- starts exactly now: expired
select pg_temp.mk(11, '1998-11-20', 'pending', '11111111-1111-4111-8111-111111111111', '1998-11-20 03:20:01+00');  -- one second later: stays pending
-- B: 7 days. 1998-11-12 is today - 8, 1998-11-13 is today - 7.
select pg_temp.mk(21, '1998-11-12', 'declined', '22222222-2222-4222-8222-222222222222');
select pg_temp.mk(22, '1998-11-13', 'declined', '22222222-2222-4222-8222-222222222222');
-- Throttle rows (hashes only): the day of a tenant is its local day.
insert into app.reservation_throttle (tenant_id, day, kind, key_hash, hits) values
  ('11111111-1111-4111-8111-111111111111', '1998-11-17', 'ip', repeat('a', 64), 1),
  ('11111111-1111-4111-8111-111111111111', '1998-11-18', 'ip', repeat('b', 64), 1),
  ('11111111-1111-4111-8111-111111111111', '1998-11-20', 'ip', repeat('c', 64), 1),
  ('22222222-2222-4222-8222-222222222222', '1998-11-16', 'email', repeat('d', 64), 2),
  ('22222222-2222-4222-8222-222222222222', '1998-11-18', 'email', repeat('e', 64), 2);
-- The mail of a purged booking that is queued, one that is being sent, and one already sent.
update public.reservation_email set status = 'sending', lease_until = '1998-11-20 03:22+00', attempts = 1 where reservation_id = pg_temp.rid(3);
update public.reservation_email set status = 'sent', sent_at = '1998-10-10 10:00+00', attempts = 1 where reservation_id = pg_temp.rid(5);

-- The run ----------------------------------------------------------------------------------------------------------------------------------------------------------------------
create temp table run1 as select app.run_reservation_retention('1998-11-20 03:20+00') as n;
-- items: expired 7, 8, 10 (3) + purged 1, 3, 4, 5, 6, 7, 21 (7) + throttle a, d (2) = 12
select is((select n from run1), 12, 'the run reports the rows it touched: 3 expired, 7 contacts purged, 2 throttle rows');

-- Contacts: day N + 1 purged, day N kept
select is((select array_agg(n order by n) from generate_series(1, 22) n where not pg_temp.has_contact(n) and n in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 21, 22)), array[1, 3, 4, 5, 6, 7, 21], 'the contacts of the bookings dated before today - retention are deleted: 1, 3, 4, 5, 6, 7 (A) and 21 (B)');
select is(pg_temp.has_contact(2), true, 'A: a booking dated today - 30 keeps its contact (the edge)');
select is(pg_temp.has_contact(22), true, 'B: a booking dated today - 7 keeps its contact (retention_days 7 is respected)');
select is(pg_temp.has_contact(8), true, 'a recent expired request keeps its contact');
select is(pg_temp.has_contact(9), true, 'a future request keeps its contact');
select is((select count(*)::int from public.reservation where id in (select pg_temp.rid(n) from generate_series(1, 22) n)), 13, 'every reservation row is still there (the anonymous row stays)');
select is((select status::text from public.reservation where id = pg_temp.rid(1)), 'declined', 'a declined booking keeps its status');
select is((select status::text from public.reservation where id = pg_temp.rid(4)), 'seated', 'and so does a seated one');
select is((select count(*)::int from public.reservation_event where kind = 'contact_purged'), 7, 'one contact_purged event per purged contact');
select is((select count(*)::int from public.reservation_event where kind = 'contact_purged' and (data <> '{}'::jsonb or created_by is not null)), 0, 'with no data and no user');
select is(pg_temp.ev(2, 'contact_purged'), 0, 'no event for a kept contact');

-- Expiry
select is((select string_agg(n::text, ',' order by n) from generate_series(1, 22) n where (select status from public.reservation where id = pg_temp.rid(n)) = 'expired'), '7,8,10', 'pending requests whose start has come are expired: 7, 8 and 10 (starting exactly now)');
select is((select status::text from public.reservation where id = pg_temp.rid(11)), 'pending', 'a request one second before its start stays pending');
select is((select status::text from public.reservation where id = pg_temp.rid(9)), 'pending', 'a future request stays pending');
select is(pg_temp.ev(8, 'expired'), 1, 'an expired event for each');
select is((select count(*)::int from public.reservation_event where kind = 'expired'), 3, 'three in all');
select is((select data::text from public.reservation_event where kind = 'expired' and reservation_id = pg_temp.rid(8)), '{}', 'with nothing personal in it');
select is((select string_agg(kind, ',' order by seq) from public.reservation_event where reservation_id = pg_temp.rid(7)), 'expired,contact_purged', 'a request that expires and is purged in the same run: expired first, then contact_purged');

-- E-mails of purged contacts
select is((select status || ':' || error_code from public.reservation_email where reservation_id = pg_temp.rid(1)), 'skipped:contact_purged', 'a queued e-mail of a purged contact is skipped (contact_purged)');
select is((select status || ':' || error_code from public.reservation_email where reservation_id = pg_temp.rid(3)), 'skipped:contact_purged', 'so is one that was being sent');
select is((select status from public.reservation_email where reservation_id = pg_temp.rid(5)), 'sent', 'an e-mail already sent stays sent');
select is((select lease_until from public.reservation_email where reservation_id = pg_temp.rid(3)), null, 'and the lease of a skipped one is cleared');
select is((select status from public.reservation_email where reservation_id = pg_temp.rid(2)), 'queued', 'the e-mail of a kept contact stays queued');

-- Throttle
select is((select string_agg(key_hash, ',' order by key_hash) from app.reservation_throttle), repeat('b', 64) || ',' || repeat('c', 64) || ',' || repeat('e', 64), 'throttle rows older than today - 2 are deleted (1998-11-17, 1998-11-16); today - 2 and today stay');

-- The job record
select is((select count(*)::int from app.job_run where job = 'reservation-retention'), 1, 'one job_run row reservation-retention');
select is((select ok::text || ',' || coalesce(error_code, '-') || ',' || items from app.job_run where job = 'reservation-retention'), 'true,-,12', 'ok, no error code, 12 items');
select is((select finished_at is not null from app.job_run where job = 'reservation-retention'), true, 'and it is finished');

-- Idempotent
create temp table run2 as select app.run_reservation_retention('1998-11-20 03:20+00') as n;
select is((select n from run2), 0, 'a second run touches nothing');
select is((select count(*)::int from public.reservation_event where kind in ('expired', 'contact_purged')), 10, 'and writes no event');
select is((select count(*)::int from app.job_run where job = 'reservation-retention'), 2, 'but is recorded');

-- Tomorrow, the kept contacts are purged: day N + 1
select is(app.run_reservation_retention('1998-11-21 03:20+00'), 5, 'the next day: request 11 expires, A''s 1998-10-21 contact and B''s 1998-11-13 contact are purged, and two throttle rows (1998-11-18) go');
select is((select pg_temp.has_contact(2) or pg_temp.has_contact(22)), false, 'the contacts that were on day N are gone on day N + 1');
select is((select count(*)::int from app.reservation_throttle), 1, 'throttle: only the row of today (1998-11-20) is left');

-- A failing tenant does not stop the others ----------------------------------------------------------------------------------------------------------------------------------
select pg_temp.mk(31, '1998-10-01', 'declined', '22222222-2222-4222-8222-222222222222');
select pg_temp.mk(32, '1998-10-01', 'declined');
create function public.tmp_retention_fail() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
create trigger tmp_retention_fail before delete on public.reservation_contact for each row when (old.tenant_id = '22222222-2222-4222-8222-222222222222') execute function public.tmp_retention_fail();
create temp table run3 as select app.run_reservation_retention('1998-11-22 03:20+00') as n;
select is(pg_temp.has_contact(32), false, 'tenant A is done although tenant B failed');
select is(pg_temp.has_contact(31), true, 'tenant B''s sub-transaction was rolled back: its contact is still there');
select is(pg_temp.ev(31, 'contact_purged'), 0, 'with no event');
select is((select ok::text || ',' || error_code from app.job_run where job = 'reservation-retention' order by id desc limit 1), 'false,retention_failed', 'the run is recorded ok = false with the code retention_failed');
drop trigger tmp_retention_fail on public.reservation_contact;
drop function public.tmp_retention_fail();

-- Roles, definer, schedule, job check ---------------------------------------------------------------------------------------------------------------------------------------------
select is((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'app.run_reservation_retention(timestamptz)'::regprocedure), true, 'app.run_reservation_retention is a definer with an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'run_reservation_retention'
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'and no API role can execute it');
select is((select schedule || ' | ' || command from cron.job where jobname = 'reservation-retention'), '20 3 * * * | select app.run_reservation_retention()', 'the cron job reservation-retention runs daily at 03:20 UTC and calls it');
select lives_ok($$ insert into app.job_run (job, started_at, finished_at, ok, items) values ('reservation-retention', now(), now(), true, 0) $$, 'job_run accepts reservation-retention');
select is((select count(*)::int from pg_proc where proname = 'job_health_checks' and pronamespace = 'app'::regnamespace), 1, 'app.job_health_checks has one definition');

-- The health check: stale after 48 hours without a successful run, unscheduled, failed ----------------------------------------------------------------------------------------
delete from app.job_run where job = 'reservation-retention';
create function pg_temp.hc(p_at timestamptz) returns text language sql as $$
  select coalesce(string_agg(c.check_key || '/' || c.job_key, ',' order by c.check_key collate "C"), '-')
    from app.job_health_checks('11111111-1111-4111-8111-111111111111', p_at) c where c.job_key = 'reservation-retention'
$$;
select is(pg_temp.hc('1998-12-06 12:00+00'), '-', 'a database where the job never finished: neither stale nor unscheduled');
insert into app.job_run (job, started_at, finished_at, ok, items) values ('reservation-retention', '1998-12-01 03:20+00', '1998-12-01 03:20:05+00', true, 0);
select is(pg_temp.hc('1998-12-03 03:20+00'), '-', 'a successful run exactly 48 hours ago: not stale');
select is(pg_temp.hc('1998-12-03 03:21+00'), 'job_stale/reservation-retention', 'just over 48 hours: job_stale');
insert into app.job_run (job, started_at, finished_at, ok, error_code, items) values ('reservation-retention', '1998-12-02 12:00+00', '1998-12-02 12:00:05+00', false, 'retention_failed', 0);
select is(pg_temp.hc('1998-12-02 20:00+00'), 'job_failed/reservation-retention', 'a failed run is named; the last success is 40 hours old, so the job is not stale yet');
select is(pg_temp.hc('1998-12-03 03:21+00'), 'job_failed/reservation-retention,job_stale/reservation-retention', 'at 48 hours and a minute the failed run does not count: stale as well as failed (the failure is in the look-back)');
delete from app.job_run where job = 'reservation-retention' and ok = false;
select is(cron.unschedule('reservation-retention'), true, 'the test unschedules the job');
select is(pg_temp.hc('1998-12-02 03:20+00'), 'job_unscheduled/reservation-retention', 'job_unscheduled lists it');
select cron.schedule('reservation-retention', '20 3 * * *', 'select app.run_reservation_retention()');
select cron.alter_job((select jobid from cron.job where jobname = 'reservation-retention'), active := false);
select is(pg_temp.hc('1998-12-02 03:20+00'), 'job_unscheduled/reservation-retention', 'an inactive job is listed too');
select cron.alter_job((select jobid from cron.job where jobname = 'reservation-retention'), active := true);
select is(pg_temp.hc('1998-12-02 03:20+00'), '-', 'and an active one is not');
select is((select count(*)::int from app.job_health_checks('11111111-1111-4111-8111-111111111111', '1998-12-02 03:20+00') c where c.job_key in ('alert-rules', 'auth-purge', 'extract-invoices', 'ledger-invariants', 'kpi-rollup') and c.check_key = 'job_unscheduled'), 0, 'the other jobs'' unscheduled rules are unchanged');

select * from finish();
rollback;
