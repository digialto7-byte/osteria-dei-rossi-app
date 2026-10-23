-- M6 step 6 (migration 20261022150400_alert_rules.sql): the hourly rules runner. app.run_alert_rules records a
-- job_run around app.alert_rules_body (a replaceable body, empty in M6) and survives a failing body by
-- rolling back to a savepoint, so the failure is recorded. No route call and no network: AT3 (what remains
-- of it). The failure tests replace the body inside this transaction; the rollback restores it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');

-- The last alert-rules run, as "finished|ok|error_code|items", and how many there are.
create function pg_temp.last_run() returns text language sql as $$
  select (finished_at is not null)::text || '|' || coalesce(ok::text, '-') || '|' || coalesce(error_code, '-')
         || '|' || coalesce(items::text, '-')
    from app.job_run where job = 'alert-rules' order by id desc limit 1
$$;
create function pg_temp.runs() returns int language sql as $$
  select count(*)::int from app.job_run where job = 'alert-rules'
$$;

-- The M6 body: no rules yet ------------------------------------------------------------------------------------
select is(app.alert_rules_body('2026-11-02T09:00Z'), 0, 'the M6 body does nothing and returns 0');
select is(pg_temp.runs(), 0, 'calling the body alone records no run');
select lives_ok($$ select app.run_alert_rules('2026-11-02T09:00Z') $$, 'the runner runs');
select is(pg_temp.runs(), 1, 'it records one alert-rules run');
select is(pg_temp.last_run(), 'true|true|-|0', 'finished, ok, no error code, 0 items');
select lives_ok($$ select app.run_alert_rules() $$, 'it runs with the default clock too');
select is(pg_temp.runs(), 2, 'and records another run');

-- A body that raises -------------------------------------------------------------------------------------------
create or replace function app.alert_rules_body(p_at timestamptz) returns integer
  language plpgsql security definer set search_path = ''
as $$
begin
  perform app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'rule_fail', null, '{}',
    p_at => p_at);
  raise exception 'rule exploded';
end
$$;
select lives_ok($$ select app.run_alert_rules('2026-11-02T09:00Z') $$, 'a failing body does not make the runner fail');
select is(pg_temp.runs(), 3, 'the run is still recorded');
select is(pg_temp.last_run(), 'true|false|rule_failed|0', 'as failed with rule_failed and 0 items');
select is((select count(*)::int from public.alert where entity_type = 'rule_fail'), 0,
  'the alert the body raised before failing was rolled back');
select is((select count(*)::int from app.job_run where error_code = 'rule exploded' or error_code like '%explod%'), 0,
  'the error text is not stored');

-- A body that reports items --------------------------------------------------------------------------------------
create or replace function app.alert_rules_body(p_at timestamptz) returns integer
  language plpgsql security definer set search_path = ''
as $$
begin
  perform app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert', 'rule_ok', null, '{}', p_at => p_at);
  return 3;
end
$$;
select lives_ok($$ select app.run_alert_rules('2026-11-02T09:00Z') $$, 'a working stub runs');
select is(pg_temp.last_run(), 'true|true|-|3', 'its count is recorded');
select is((select count(*)::int from public.alert where entity_type = 'rule_ok'), 1, 'and its alert is kept');
select lives_ok($$ select app.run_alert_rules('2026-11-02T10:00Z') $$, 'the next hour runs it again');
select is((select count(*)::int from public.alert where entity_type = 'rule_ok'), 1, 'and dedup keeps one alert');

create or replace function app.alert_rules_body(p_at timestamptz) returns integer
  language plpgsql security definer set search_path = ''
as $$
begin
  return null;
end
$$;
select lives_ok($$ select app.run_alert_rules('2026-11-02T09:00Z') $$, 'a body that returns null runs');
select is(pg_temp.last_run(), 'true|true|-|0', 'and counts 0');

-- No network (AT3: nothing is sent) --------------------------------------------------------------------------------
delete from net.http_request_queue;
select vault.create_secret('http://app.test', 'app_base_url');
select vault.create_secret('test-cron-secret-0123456789abcdef0123', 'cron_secret');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a',
  'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text, true);
select lives_ok($$ select public.raise_test_alert(true) $$, 'the owner raises a test alert');
reset role;
select lives_ok($$ select app.run_alert_rules() $$, 'and the runner runs, with Vault configured');
select is((select count(*)::int from net.http_request_queue), 0,
  'no request was queued: an alert and the rules run send nothing');

-- Privileges ---------------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'app.run_alert_rules(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.run_alert_rules(timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'app.run_alert_rules(timestamptz)', 'execute'),
  'no API role can execute app.run_alert_rules');
select ok(not has_function_privilege('anon', 'app.alert_rules_body(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.alert_rules_body(timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'app.alert_rules_body(timestamptz)', 'execute'),
  'nor app.alert_rules_body');

-- The schedule ---------------------------------------------------------------------------------------------------------
select is((select schedule from cron.job where jobname = 'alert-rules'), '0 * * * *', 'alert-rules runs at the top of every hour');
select is((select command from cron.job where jobname = 'alert-rules'), 'select app.run_alert_rules()',
  'and calls the runner, not a route');
select is((select count(*)::int from cron.job where jobname = 'dispatch-alerts'), 0, 'there is no dispatch-alerts job');
select is((select schedule from cron.job where jobname = 'extract-invoices'), '* * * * *', 'extract-invoices is unchanged');

select * from finish();
rollback;
