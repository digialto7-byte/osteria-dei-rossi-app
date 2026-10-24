-- M16 step 9: the hourly body runs the three rules of M16 after M9's two, and the service-role wrapper for the integration and
-- e2e suites (plan §3.1.9, §3.1.11, §3.2; ADR-015).
--
-- app.run_alert_rules (M6: job_run, savepoint, rule_failed) is NOT replaced; only the body it calls is. M9's two blocks are kept
-- verbatim (payable_reminders, payables_digest); the three new ones run in the same tenant loop, each in its own BEGIN ... EXCEPTION
-- block, so a failing rule of one tenant rolls back only that block and is recorded under its own caller (prep_rules,
-- purchase_rules, expiry_rules) with the SQLSTATE only. Replacing the body changes its md5, re-pinned on purpose in 089, 098, 119.
create or replace function app.alert_rules_body(p_at timestamptz) returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_items integer := 0;
  t record;
begin
  for t in select id from public.tenant order by id loop
    begin
      v_items := v_items + app.payable_reminder_rule(t.id, p_at);
    exception when others then
      perform app.record_alert_refusal(t.id, null, 'tenant', t.id, 'payable_reminders', 'rule_failed', sqlstate);
    end;
    begin
      v_items := v_items + app.payables_digest_rule(t.id, p_at);
    exception when others then
      perform app.record_alert_refusal(t.id, null, 'tenant', t.id, 'payables_digest', 'rule_failed', sqlstate);
    end;
    begin
      v_items := v_items + app.prep_rule(t.id, p_at);
    exception when others then
      perform app.record_alert_refusal(t.id, null, 'tenant', t.id, 'prep_rules', 'rule_failed', sqlstate);
    end;
    begin
      v_items := v_items + app.purchase_rule(t.id, p_at);
    exception when others then
      perform app.record_alert_refusal(t.id, null, 'tenant', t.id, 'purchase_rules', 'rule_failed', sqlstate);
    end;
    begin
      v_items := v_items + app.expiry_rule(t.id, p_at);
    exception when others then
      perform app.record_alert_refusal(t.id, null, 'tenant', t.id, 'expiry_rules', 'rule_failed', sqlstate);
    end;
  end loop;
  return v_items;
end
$$;

-- Runs the hourly job once at p_at and answers how it went. For the integration and e2e suites with the local stack's service key;
-- no browser, no user-facing route (like ledger_invariants_run). It reads back the run it started itself, not "the newest
-- alert-rules row": pg_cron may fire the job in another session meanwhile. The run's id is the identity value this session
-- just drew (currval is per session, so a concurrent insert cannot change it); app.run_alert_rules is untouched.
create function public.alert_rules_run(p_at timestamptz default now()) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_ok boolean;
  v_items integer;
begin
  perform app.run_alert_rules(p_at);
  select r.ok, r.items into v_ok, v_items
    from app.job_run r
   where r.id = currval(pg_get_serial_sequence('app.job_run', 'id'));
  return jsonb_build_object('ok', coalesce(v_ok, false), 'items', coalesce(v_items, 0));
end
$$;

revoke all on function public.alert_rules_run(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.alert_rules_run(timestamptz) to service_role;
