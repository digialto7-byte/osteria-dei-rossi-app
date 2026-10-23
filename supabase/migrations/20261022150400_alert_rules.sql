-- M6 step 6: the hourly alert-rules runner (M6 plan §3.1.9, §3.4; ADR-006).
--
-- app.run_alert_rules is a fixed wrapper: it begins a job_run, calls app.alert_rules_body inside a
-- BEGIN ... EXCEPTION block (a savepoint) and ends the run. If the body raises, its work is rolled back
-- to the savepoint, the run is recorded as failed (rule_failed) and the function returns normally, so
-- the record survives. Re-raising would roll the job_run row back too.
--
-- Rule milestones (M9, M16, ...) replace only app.alert_rules_body with `create or replace`, adding their
-- rule call and its count to the return value; they never replace app.run_alert_rules. M6 has no rules.
-- A rule that raises rolls back the whole body of that hour; the next hour retries it, and dedup makes
-- the retry safe. No route call, no pg_net request, no Vault secret: nothing leaves the database.

-- Returns the number of alerts the rules inserted.
create function app.alert_rules_body(p_at timestamptz) returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  return 0;
end
$$;

create function app.run_alert_rules(p_at timestamptz default now()) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_run bigint := app.job_run_begin('alert-rules');
  v_items integer;
  v_failed boolean := false;
begin
  begin
    v_items := app.alert_rules_body(p_at);
  exception when others then
    v_failed := true;
  end;
  perform app.job_run_end(v_run, not v_failed, case when v_failed then 'rule_failed' end,
    case when v_failed then 0 else coalesce(v_items, 0) end);
end
$$;

revoke all on function app.alert_rules_body(timestamptz), app.run_alert_rules(timestamptz)
  from public, anon, authenticated, service_role;

select cron.schedule('alert-rules', '0 * * * *', $job$select app.run_alert_rules()$job$);
