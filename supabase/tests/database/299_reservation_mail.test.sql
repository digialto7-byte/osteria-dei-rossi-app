-- Reservations B3 (docs/plans/2026-11-08-reservations.md §3.1.11, §3.3.2, §5 B3; ADR-032): the e-mail outbox. app.reservation_mail_due says whether a row is ready; reservation_mail_claim
-- (service_role only) takes due queued or failed rows, and rows whose lease ran out, FOR UPDATE SKIP LOCKED with a 120 s lease and returns what the route needs to write the mail;
-- reservation_mail_finish records the outcome: sent, or a retry after 1, 5, 15 and 60 minutes, or failed for good at the fifth attempt (or at once for a rejected mail). A row whose
-- contact is gone is skipped without a send. The pg_cron job reservation-mail runs every minute only when work is due. p_now is fixed on the twins. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(70);

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  v_out text;
  state text;
  msg text;
  det text;
begin
  execute stmt into v_out;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg || coalesce(' ' || nullif(det, ''), '');
end
$$;
-- Runs a statement as a role and returns its text, or 'SQLSTATE message'.
create function pg_temp.as_role(p_role text, stmt text) returns text language plpgsql as $$
declare
  v_out text;
  state text;
  msg text;
begin
  execute format('set local role %I', p_role);
  execute stmt into v_out;
  reset role;
  return v_out;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  reset role;
  return state || ' ' || msg;
end
$$;
create function pg_temp.rid(p_n integer) returns uuid language sql as $$ select ('c0000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;
create function pg_temp.eid(p_n integer) returns uuid language sql as $$ select ('d0000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;
create function pg_temp.claim(p_limit integer, p_now timestamptz) returns jsonb language sql as $$ select app.reservation_mail_claim_at(p_limit, p_now) $$;
create function pg_temp.fin(p_n integer, p_ok boolean, p_err text, p_now timestamptz, p_provider text default null) returns text language sql as $$
  select pg_temp.err(format('select app.reservation_mail_finish_at(%L, %L, %L, %L, %L)::text', pg_temp.eid(p_n), p_ok, p_provider, p_err, p_now))
$$;
create function pg_temp.epoch(p_at timestamptz) returns bigint language sql as $$ select extract(epoch from p_at)::bigint $$;

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.reservation_settings (tenant_id, public_slug, privacy_controller_name, privacy_contact_email, enabled) values
  ('11111111-1111-4111-8111-111111111111', 'osteria-demo-a', 'Osteria Demo S.r.l. (demo)', 'privacy@example.com', true),
  ('22222222-2222-4222-8222-222222222222', 'osteria-demo-b', 'Osteria Demo B S.r.l. (demo)', 'privacy-b@example.com', true);

-- A booking n of a tenant at 2026-11-20 20:00 Rome (19:00Z) with a contact (or none), and an outbox row n of a kind.
create function pg_temp.mk(p_n integer, p_kind text default 'received', p_tenant uuid default '11111111-1111-4111-8111-111111111111', p_contact boolean default true, p_email text default 'cliente.demo@example.com') returns void language plpgsql as $$
begin
  insert into public.reservation (tenant_id, id, status, business_date, service_key, starts_at, ends_at, party, privacy_notice_version, privacy_ack_at)
    values (p_tenant, pg_temp.rid(p_n), 'pending', '2026-11-20', 'cena', '2026-11-20 19:00+00', '2026-11-20 21:00+00', 4, 'v1', '2026-11-08 09:00+00');
  if p_contact then
    insert into public.reservation_contact (tenant_id, reservation_id, name, phone, email, locale)
      values (p_tenant, pg_temp.rid(p_n), 'Cliente Demo', '390000000001', p_email, 'en');
  end if;
  insert into public.reservation_email (tenant_id, id, reservation_id, kind, next_attempt_at)
    values (p_tenant, pg_temp.eid(p_n), pg_temp.rid(p_n), p_kind, timestamptz '2026-11-08 09:00+00' + make_interval(secs => p_n));
end
$$;
create function pg_temp.st(p_n integer) returns text language sql as $$
  select status || ':' || attempts || ':' || coalesce(error_code, '-') from public.reservation_email where id = pg_temp.eid(p_n)
$$;

-- Due -----------------------------------------------------------------------------------------------------------------------------------------------------------------------
select is(app.reservation_mail_due('2026-11-08 10:00+00'), false, 'nothing due: false');
select pg_temp.mk(90);
select is(app.reservation_mail_due('2026-11-08 10:00+00'), true, 'a queued row whose time has come: true');
select is(app.reservation_mail_due('2026-11-08 08:59:59+00'), false, 'the same row one second before its next_attempt_at: false');
update public.reservation_email set status = 'sending', lease_until = '2026-11-08 10:02+00', attempts = 1 where id = pg_temp.eid(90);
select is(app.reservation_mail_due('2026-11-08 10:00+00'), false, 'a row under a live lease: false');
select is(app.reservation_mail_due('2026-11-08 10:02+00'), true, 'at the end of the lease: true (claimable again)');
update public.reservation_email set status = 'failed', lease_until = null, attempts = 2, next_attempt_at = '2026-11-08 10:05+00' where id = pg_temp.eid(90);
select is(app.reservation_mail_due('2026-11-08 10:04:59+00'), false, 'a failed row before its backoff: false');
select is(app.reservation_mail_due('2026-11-08 10:05+00'), true, 'and at its backoff: true');
update public.reservation_email set attempts = 5 where id = pg_temp.eid(90);
select is(app.reservation_mail_due('2026-11-08 11:00+00'), false, 'a failed row at the fifth attempt is failed for good: false');
update public.reservation_email set status = 'sent', attempts = 1, sent_at = '2026-11-08 10:00+00' where id = pg_temp.eid(90);
select is(app.reservation_mail_due('2026-11-08 11:00+00'), false, 'a sent row: false');
update public.reservation_email set status = 'skipped' where id = pg_temp.eid(90);
select is(app.reservation_mail_due('2026-11-08 11:00+00'), false, 'a skipped row: false');

-- Claim ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
update public.reservation_email set status = 'skipped', lease_until = null where status <> 'skipped'; -- the outbox is append-only: earlier rows are parked
select pg_temp.mk(n) from generate_series(1, 12) n;
create temp table c1 as select pg_temp.claim(10, '2026-11-08 10:00+00') as j;
select is((select jsonb_array_length(j) from c1), 10, 'claim(10) returns at most 10 of 12 due rows');
select is((select count(*)::int from public.reservation_email where status = 'sending' and lease_until = '2026-11-08 10:02+00' and attempts = 1), 10, 'they are sending, with a 120 s lease and one attempt');
select is((select count(*)::int from public.reservation_email where status = 'queued' and attempts = 0), 2, 'the other two stay queued');
select is((select jsonb_agg((e ->> 'id')::uuid order by o) from c1, jsonb_array_elements(j) with ordinality t(e, o)), (select jsonb_agg(pg_temp.eid(n) order by n) from generate_series(1, 10) n), 'oldest next_attempt_at first');
select is((select array_agg(k order by k collate "C") from c1, jsonb_array_elements(j) with ordinality t(e, o), jsonb_object_keys(e) k where o = 1),
          array['cancelExp', 'date', 'id', 'kind', 'locale', 'name', 'party', 'reservationId', 'serviceName', 'slug', 'time', 'to', 'venueName'],
          'a row carries exactly what the route needs to write the mail');
select is((select e from c1, jsonb_array_elements(j) e where e ->> 'id' = pg_temp.eid(1)::text),
          jsonb_build_object('id', pg_temp.eid(1), 'kind', 'received', 'to', 'cliente.demo@example.com', 'locale', 'en', 'name', 'Cliente Demo', 'venueName', 'Osteria Demo A', 'slug', 'osteria-demo-a',
                             'reservationId', pg_temp.rid(1), 'date', '2026-11-20', 'time', '20:00', 'party', 4, 'serviceName', 'Cena', 'cancelExp', pg_temp.epoch('2026-11-20 19:00+00')),
          'its values: local date and time, service name, venue, and cancelExp = the start (cancel_until 0)');
create temp table c2 as select pg_temp.claim(10, '2026-11-08 10:00:30+00') as j;
select is((select jsonb_agg((e ->> 'id')::uuid order by o) from c2, jsonb_array_elements(j) with ordinality t(e, o)), jsonb_build_array(pg_temp.eid(11), pg_temp.eid(12)), 'a second claim skips the rows under a lease and takes the remaining two');
select is(pg_temp.claim(10, '2026-11-08 10:00:40+00'), '[]'::jsonb, 'a third claim finds nothing: an empty array');
select is(pg_temp.st(3), 'sending:1:-', 'a claimed row reads sending, attempt 1');
-- An expired lease is claimable again; the attempt counts.
create temp table c3 as select pg_temp.claim(10, '2026-11-08 10:02:00+00') as j;
select is((select jsonb_array_length(j) from c3), 10, 'at the end of the lease the first ten are claimable again');
select is(pg_temp.st(3), 'sending:2:-', 'with their attempt count raised to 2');
select is((select lease_until from public.reservation_email where id = pg_temp.eid(3)), '2026-11-08 10:04+00'::timestamptz, 'and a new lease');

-- Cancel link and declined -------------------------------------------------------------------------------------------------------------------------------------------------
update public.reservation_email set status = 'skipped', lease_until = null where status <> 'skipped'; -- the outbox is append-only: earlier rows are parked
select pg_temp.mk(21, 'declined');
select pg_temp.mk(22, 'accepted');
update public.reservation_settings set cancel_until_minutes = 60 where tenant_id = '11111111-1111-4111-8111-111111111111';
create temp table c4 as select pg_temp.claim(10, '2026-11-08 10:00+00') as j;
select is((select e -> 'cancelExp' from c4, jsonb_array_elements(j) e where e ->> 'id' = pg_temp.eid(21)::text), 'null'::jsonb, 'a declined mail has no cancelExp (it carries no link)');
select is((select e ->> 'cancelExp' from c4, jsonb_array_elements(j) e where e ->> 'id' = pg_temp.eid(22)::text), (pg_temp.epoch('2026-11-20 19:00+00') - 3600)::text, 'cancelExp is the start minus cancel_until_minutes');
update public.reservation_settings set cancel_until_minutes = 0 where tenant_id = '11111111-1111-4111-8111-111111111111';

-- A contact that is gone, another tenant ---------------------------------------------------------------------------------------------------------------------------------------
update public.reservation_email set status = 'skipped', lease_until = null where status <> 'skipped'; -- the outbox is append-only: earlier rows are parked
select pg_temp.mk(31, 'received', '11111111-1111-4111-8111-111111111111', false);
select pg_temp.mk(32, 'accepted', '22222222-2222-4222-8222-222222222222');
select pg_temp.mk(33, 'received', '11111111-1111-4111-8111-111111111111', true, null);
create temp table c5 as select pg_temp.claim(10, '2026-11-08 10:00+00') as j;
select is((select jsonb_array_length(j) from c5), 1, 'a row with no contact and a row with no address are not returned');
select is(pg_temp.st(31), 'skipped:0:contact_gone', 'the row without a contact is skipped (contact_gone), with no attempt');
select is(pg_temp.st(33), 'skipped:0:contact_gone', 'so is the row whose contact has no address');
select is((select e ->> 'venueName' from c5, jsonb_array_elements(j) e), 'Osteria Demo B', 'tenant B''s row carries tenant B''s venue name');
select is((select e ->> 'slug' from c5, jsonb_array_elements(j) e), 'osteria-demo-b', 'and its slug');

-- The limit -------------------------------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$ select app.reservation_mail_claim_at(0, now())::text $$), '22023 invalid_request', 'a limit of 0 is invalid_request');
select is(pg_temp.err($$ select app.reservation_mail_claim_at(51, now())::text $$), '22023 invalid_request', 'a limit of 51 is invalid_request');
select is(pg_temp.err($$ select app.reservation_mail_claim_at(null, now())::text $$), '22023 invalid_request', 'a null limit is invalid_request');

-- Finish: sent, retries, failed for good -------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.fin(32, true, null, '2026-11-08 10:00:05+00', 'provider-id-0001'), '{"status": "sent", "changed": true}', 'finish(ok) answers {status: sent, changed: true}');
select is((select status || ',' || sent_at::text || ',' || provider_message_id || ',' || coalesce(lease_until::text, '-') || ',' || coalesce(error_code, '-') from public.reservation_email where id = pg_temp.eid(32)),
          'sent,2026-11-08 10:00:05+00,provider-id-0001,-,-', 'the row is sent, with its time and provider id, no lease and no error');
select is(pg_temp.fin(32, true, null, '2026-11-08 10:00:06+00', 'other'), '{"status": "sent", "changed": false}', 'a second finish of the same row changes nothing');
select is((select provider_message_id from public.reservation_email where id = pg_temp.eid(32)), 'provider-id-0001', 'and keeps the first provider id');
select is(pg_temp.fin(31, true, null, now()), '{"status": "skipped", "changed": false}', 'finish of a row that is not sending changes nothing');
select is(pg_temp.fin(98, true, null, now()), 'P0002 not_found', 'finish of an unknown id: not_found');

update public.reservation_email set status = 'skipped', lease_until = null where status <> 'skipped'; -- the outbox is append-only: earlier rows are parked
select pg_temp.mk(41);
select pg_temp.claim(10, '2026-11-08 10:00+00');
select is(pg_temp.fin(41, false, 'retry', '2026-11-08 10:00:10+00'), '{"status": "failed", "changed": true}', 'finish(error) on attempt 1: failed, to be retried');
select is((select status || ',' || next_attempt_at::text || ',' || error_code || ',' || coalesce(lease_until::text, '-') from public.reservation_email where id = pg_temp.eid(41)), 'failed,2026-11-08 10:01:10+00,retry,-', 'attempt 1: the next attempt is 1 minute later; the lease is cleared');
select is(pg_temp.claim(10, '2026-11-08 10:01:09+00'), '[]'::jsonb, 'it is not claimed before its backoff');
select is(jsonb_array_length(pg_temp.claim(10, '2026-11-08 10:01:10+00')), 1, 'and is at it (attempt 2)');
select pg_temp.fin(41, false, 'retry', '2026-11-08 10:01:20+00');
select is((select next_attempt_at from public.reservation_email where id = pg_temp.eid(41)), '2026-11-08 10:06:20+00'::timestamptz, 'attempt 2: 5 minutes');
select pg_temp.claim(10, '2026-11-08 10:06:20+00');
select pg_temp.fin(41, false, 'retry', '2026-11-08 10:06:30+00');
select is((select next_attempt_at from public.reservation_email where id = pg_temp.eid(41)), '2026-11-08 10:21:30+00'::timestamptz, 'attempt 3: 15 minutes');
select pg_temp.claim(10, '2026-11-08 10:21:30+00');
select pg_temp.fin(41, false, 'retry', '2026-11-08 10:21:40+00');
select is((select next_attempt_at from public.reservation_email where id = pg_temp.eid(41)), '2026-11-08 11:21:40+00'::timestamptz, 'attempt 4: 60 minutes');
select pg_temp.claim(10, '2026-11-08 11:21:40+00');
select is(pg_temp.st(41), 'sending:5:retry', 'the fifth claim: attempt 5');
select pg_temp.fin(41, false, 'retry', '2026-11-08 11:21:50+00');
select is(pg_temp.st(41), 'failed:5:retry', 'attempt 5 failed: failed for good');
select is(app.reservation_mail_due('2027-01-01 00:00+00'), false, 'and never due again');
select is(pg_temp.claim(10, '2027-01-01 00:00+00'), '[]'::jsonb, 'nor claimed');

-- A rejected mail is final at once; the error code is a code ----------------------------------------------------------------------------------------------------------
update public.reservation_email set status = 'skipped', lease_until = null where status <> 'skipped'; -- the outbox is append-only: earlier rows are parked
select pg_temp.mk(51);
select pg_temp.mk(52);
select pg_temp.claim(10, '2026-11-08 10:00+00');
select pg_temp.fin(51, false, 'rejected', '2026-11-08 10:00:05+00');
select is(pg_temp.st(51), 'failed:1:rejected', 'a rejected mail (a 4xx) is failed at once, on attempt 1');
select is((select next_attempt_at from public.reservation_email where id = pg_temp.eid(51)), '2026-11-08 09:00:51+00'::timestamptz, 'with no new attempt time (it is not due again)');
select pg_temp.fin(52, false, 'Bad Code: cliente.demo@example.com', '2026-11-08 10:00:05+00');
select is(pg_temp.st(52), 'failed:1:error', 'an error code that is not a plain code is stored as "error": nothing personal can leak in');

-- A lease that ran out at the attempt cap: failed for good by the next claim -------------------------------------------------------------------------------------------------
update public.reservation_email set status = 'skipped', lease_until = null where status <> 'skipped'; -- the outbox is append-only: earlier rows are parked
select pg_temp.mk(61);
update public.reservation_email set status = 'sending', attempts = 5, lease_until = '2026-11-08 10:00+00' where id = pg_temp.eid(61);
select is(app.reservation_mail_due('2026-11-08 10:00:01+00'), true, 'a dead lease at attempt 5 counts as due work (so that it is cleaned up)');
select is(pg_temp.claim(10, '2026-11-08 10:00:01+00'), '[]'::jsonb, 'the claim returns nothing for it');
select is(pg_temp.st(61), 'failed:5:lease_expired', 'and marks it failed (lease_expired)');
select is(app.reservation_mail_due('2026-11-08 10:00:02+00'), false, 'after which nothing is due');

-- Roles -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.mk(71);
select is(pg_temp.as_role('anon', $$ select public.reservation_mail_claim(1)::text $$), '42501 permission denied for function reservation_mail_claim', 'anon cannot claim');
select is(pg_temp.as_role('authenticated', $$ select public.reservation_mail_claim(1)::text $$), '42501 permission denied for function reservation_mail_claim', 'authenticated cannot claim');
select is(pg_temp.as_role('anon', format('select public.reservation_mail_finish(%L, true, null, null)::text', pg_temp.eid(71))), '42501 permission denied for function reservation_mail_finish', 'anon cannot finish');
select is(pg_temp.as_role('authenticated', format('select public.reservation_mail_finish(%L, true, null, null)::text', pg_temp.eid(71))), '42501 permission denied for function reservation_mail_finish', 'authenticated cannot finish');
select is(jsonb_array_length(pg_temp.as_role('service_role', $$ select public.reservation_mail_claim(5)::text $$)::jsonb), 1, 'service_role claims');
select is(pg_temp.as_role('service_role', format('select public.reservation_mail_finish(%L, true, %L, null)::text', pg_temp.eid(71), 'provider-id-0071')), '{"status": "sent", "changed": true}', 'and finishes');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('reservation_mail_claim', 'reservation_mail_finish') and p.prosecdef and p.proconfig @> array['search_path=""']
            and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')), 2,
          'the two public functions are definers with an empty search_path, for service_role only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('reservation_mail_claim', 'reservation_mail_finish') and p.proacl::text ~ '[{,]=X/'), 0, 'PUBLIC has no execute on them');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('reservation_mail_due', 'reservation_mail_claim_at', 'reservation_mail_finish_at') and p.prosecdef and p.proconfig @> array['search_path=""']
            and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 3,
          'the app functions are definers with an empty search_path, closed to every API role');

-- The cron job and the job check -----------------------------------------------------------------------------------------------------------------------------------------------
select is((select schedule from cron.job where jobname = 'reservation-mail'), '* * * * *', 'the cron job reservation-mail runs every minute');
select is((select command from cron.job where jobname = 'reservation-mail'), $c$select app.call_cron_route('/api/cron/reservation-mail') where app.reservation_mail_due()$c$, 'and calls the route only when a row is due');
select is((select count(*)::int from cron.job where jobname = 'reservation-mail'), 1, 'once');
select lives_ok($$ insert into app.job_run (job, started_at, finished_at, ok, items) values ('reservation-mail', now(), now(), true, 3) $$, 'job_run accepts the job reservation-mail');
select is((select count(*)::int from app.job_run where job = 'reservation-mail'), 1, 'and stores it');

select * from finish();
rollback;
