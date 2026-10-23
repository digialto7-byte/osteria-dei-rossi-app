-- M9 step 11: rule isolation (lead guardrail 3, ADR-009). Each tenant x rule runs in its own savepoint: a rule
-- that fails for one tenant rolls back that tenant's run of that rule only, and is recorded as rule_failed in
-- app.alert_refusal; a guard refusal of one payable is absorbed by app.try_raise_alert and the loop goes on.
-- The runner app.run_alert_rules and the cron job are the M6 ones, unchanged.
-- Tenant C comes first (the guard case: payable_due_7d is removed from the registry for one run), then
-- tenants A and B (the stub case: the reminder rule fails for A only).
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'owner-c@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115'),
  ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222220');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('e1000000-0000-4000-8000-00000000000e', '33333333-3333-4333-8333-333333333333',
   'e0000000-0000-4000-8000-00000000000e', 'owner', 'Titolare C');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903'),
  ('5b000000-0000-4000-8000-00000000005b', '22222222-2222-4222-8222-222222222222', 'Fornitore B Srl', 'IT00000000000'),
  ('5c000000-0000-4000-8000-00000000005c', '33333333-3333-4333-8333-333333333333', 'Fornitore C Srl', 'IT00000000000');

create function pg_temp.id(prefix text, n int) returns uuid language sql as $$
  select (prefix || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.mk(n int, tenant uuid, supplier uuid, due date) returns void language plpgsql as $$
begin
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, number_raw, invoice_date)
  values (pg_temp.id('e0000000', n), tenant, tenant || '/2026/' || pg_temp.id('e0000000', n) || '.pdf',
          'application/pdf', 2048, 'FT ' || n, '2026-10-01');
  insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount,
                              due_date, due_date_source, created_by)
  values (pg_temp.id('90000000', n), tenant, pg_temp.id('e0000000', n), supplier, 100, 0, 100, due, 'invoice',
          (select u.id from public.app_user u where u.tenant_id = mk.tenant));
end
$$;
create function pg_temp.n_alerts(tenant uuid, k text default null) returns int language sql as $$
  select count(*)::int from public.alert where tenant_id = tenant and (k is null or kind = k)
$$;
create function pg_temp.last_run() returns text language sql as $$
  select ok::text || '|' || coalesce(error_code, '-') || '|' || items from app.job_run
   where job = 'alert-rules' order by id desc limit 1
$$;
create function pg_temp.refusals(tenant uuid) returns text language sql as $$
  select coalesce(string_agg(caller || ' ' || code || ' ' || sqlstate || ' ' || kind || ' ' || coalesce(entity_type, '-'),
                             ' / ' order by id), '-')
    from app.alert_refusal where tenant_id = tenant
$$;

-- Guard refusal: the kind is gone, so every 7-day reminder of tenant C is refused ----------------------------------------------
-- Run date 2026-12-03 (Rome): C1 and C2 are in their 7-day window (due 12-10); C3 is due today (12-03).
select pg_temp.mk(1, '33333333-3333-4333-8333-333333333333', '5c000000-0000-4000-8000-00000000005c', '2026-12-10');
select pg_temp.mk(2, '33333333-3333-4333-8333-333333333333', '5c000000-0000-4000-8000-00000000005c', '2026-12-10');
select pg_temp.mk(3, '33333333-3333-4333-8333-333333333333', '5c000000-0000-4000-8000-00000000005c', '2026-12-03');
delete from app.alert_kind where kind = 'payable_due_7d';
select lives_ok($$ select app.run_alert_rules('2026-12-03T09:00Z') $$, 'the run completes although a kind is unknown');
select is(pg_temp.refusals('33333333-3333-4333-8333-333333333333'),
  'payable_reminders unknown_alert_kind P0001 payable_due_7d payable / payable_reminders unknown_alert_kind P0001 payable_due_7d payable',
  'one unknown_alert_kind refusal per affected payable (two)');
select is((select string_agg(kind, ',' order by kind) from public.alert
            where tenant_id = '33333333-3333-4333-8333-333333333333' and entity_type = 'payable'), 'payable_due_today',
  'and the due-today reminder of another payable in the same tenant and run still commits');
select is((select ok::text || '|' || items from app.job_run where job = 'alert-rules' order by id desc limit 1),
  'true|2', 'job_run ok; items = the digest and the due-today reminder');
insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience)
  values ('payable_due_7d', true, 'info', '{owner}');
delete from app.alert_refusal;

-- Stub: the reminder rule fails for tenant A (SQLSTATE 22012) ------------------------------------------------------------------
select pg_temp.mk(11, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '2026-12-10');
select pg_temp.mk(12, '22222222-2222-4222-8222-222222222222', '5b000000-0000-4000-8000-00000000005b', '2026-12-10');
alter function app.payable_reminder_rule(uuid, timestamptz) rename to payable_reminder_rule_real;
create function app.payable_reminder_rule(p_tenant uuid, p_at timestamptz) returns integer
  language plpgsql security definer set search_path = ''
as $$
begin
  if p_tenant = '11111111-1111-4111-8111-111111111111' then
    perform 1 / (p_at is null)::int;
  end if;
  return app.payable_reminder_rule_real(p_tenant, p_at);
end
$$;
create temporary table before_run as
  select (select count(*)::int from public.alert) as n;
select lives_ok($$ select app.run_alert_rules('2026-12-03T09:00Z') $$,
  'the runner returns normally although the rule failed for tenant A');
select is(pg_temp.n_alerts('22222222-2222-4222-8222-222222222222', 'payable_due_7d'), 1, 'tenant B''s reminder was raised');
select is(pg_temp.n_alerts('11111111-1111-4111-8111-111111111111', 'payable_due_7d'), 0, 'tenant A has no reminder');
select is(pg_temp.n_alerts('11111111-1111-4111-8111-111111111111', 'payables_weekly_digest'), 1,
  'but tenant A''s digest exists: the digest rule is its own block');
select is(pg_temp.n_alerts('22222222-2222-4222-8222-222222222222', 'payables_weekly_digest'), 1, 'and so does B''s');
select is(pg_temp.refusals('11111111-1111-4111-8111-111111111111'), 'payable_reminders rule_failed 22012  tenant',
  'one rule_failed refusal for A: caller payable_reminders, SQLSTATE 22012, no kind, entity tenant');
select is(pg_temp.refusals('22222222-2222-4222-8222-222222222222'), '-', 'none for B');
select is((select count(*)::int from app.alert_refusal), 1, 'one refusal row in all');
select is(pg_temp.last_run(), 'true|-|' || ((select count(*)::int from public.alert) - (select n from before_run)),
  'job_run is ok, with items = the alerts that committed (B''s reminder and the two digests, and C''s)');
select is(pg_temp.n_alerts('33333333-3333-4333-8333-333333333333', 'payable_due_7d'), 2,
  'tenant C, whose kind is back, gets its two 7-day reminders in the same run');

-- Restore the real rule; a failing digest rule leaves the reminders alone --------------------------------------------------------
drop function app.payable_reminder_rule(uuid, timestamptz);
alter function app.payable_reminder_rule_real(uuid, timestamptz) rename to payable_reminder_rule;
alter function app.payables_digest_rule(uuid, timestamptz) rename to payables_digest_rule_real;
create function app.payables_digest_rule(p_tenant uuid, p_at timestamptz) returns integer
  language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'digest exploded' using errcode = 'P0001';
end
$$;
select pg_temp.mk(21, '22222222-2222-4222-8222-222222222222', '5b000000-0000-4000-8000-00000000005b', '2026-12-13');
delete from app.alert_refusal;
select app.run_alert_rules('2026-12-06T09:00Z');
select is(pg_temp.n_alerts('22222222-2222-4222-8222-222222222222', 'payable_due_7d'), 2,
  'with the digest rule failing, the reminder rule of the same tenant and run still commits');
select is((select string_agg(distinct caller || ' ' || code || ' ' || sqlstate, ',') from app.alert_refusal),
  'payables_digest rule_failed P0001', 'and the failures are recorded as payables_digest / rule_failed');
select is((select count(*)::int from app.alert_refusal), 3, 'one per tenant');
select ok(not exists (select 1 from app.alert_refusal where code ilike '%explod%' or kind ilike '%explod%'),
  'the error text is not stored');

drop function app.payables_digest_rule(uuid, timestamptz);
alter function app.payables_digest_rule_real(uuid, timestamptz) rename to payables_digest_rule;

-- The runner and the schedule are the M6 ones -------------------------------------------------------------------------------------
select is((select md5(prosrc) from pg_proc where oid = 'app.run_alert_rules(timestamptz)'::regprocedure),
  'ff878123053f643e184b4a6dd537bb27', 'app.run_alert_rules is the M6 body of 20261022150600 (md5)');
select is((select schedule || ' | ' || command from cron.job where jobname = 'alert-rules'),
  '0 * * * * | select app.run_alert_rules()', 'the cron job alert-rules is unchanged');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r,
    unnest(array['app.payable_reminder_rule(uuid, timestamptz)', 'app.payables_digest_rule(uuid, timestamptz)',
                 'app.payables_digest_payload(uuid, date)', 'app.alert_rules_body(timestamptz)',
                 'app.run_alert_rules(timestamptz)']) f
   where has_function_privilege(r, f, 'execute')), 0, 'no API role can execute any of them');

select * from finish();
rollback;
