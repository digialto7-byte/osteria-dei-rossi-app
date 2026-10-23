-- M6 code-review round 1 follow-up.
-- 20261022150400 and 20261022150500 are already pushed, so nothing is edited there; this migration
-- replaces functions with `create or replace` (same signatures).
--
-- 1. app.run_alert_rules: `exception when others` recorded only rule_failed, so the SQLSTATE was lost.
--    It now also raises a warning with the SQLSTATE before recording the run. SQLSTATE only: the message,
--    detail and context of the error may carry payload text, so they are never read. The warning goes
--    to the database log; the job_run record is unchanged (rule_failed, items 0) and the function still
--    returns normally, so the record survives.

create or replace function app.run_alert_rules(p_at timestamptz default now()) returns void
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
    raise warning 'alert rule failed: %', sqlstate;
  end;
  perform app.job_run_end(v_run, not v_failed, case when v_failed then 'rule_failed' end,
    case when v_failed then 0 else coalesce(v_items, 0) end);
end
$$;
