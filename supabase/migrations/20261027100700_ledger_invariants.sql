-- M13 step 8: the nightly invariant check (M13 plan §3.1.10, §3.9; ADR-012; plan §3.6 rule 7).
--   app.ledger_checks_body   the ledger checks: ONE SQL statement, so every check reads the same snapshot and a
--                            transaction that is half committed is never seen. Later milestones replace this body
--                            with `create or replace`, keeping every check below and adding their own
--   app.job_health_checks    scheduled jobs that stopped, failed or are not scheduled, an invoice waiting for
--                            extraction, refused alerts (job_run has no tenant, so job findings reach every tenant)
--   app.run_ledger_invariants  the fixed runner, as run_alert_rules: a job_run, then each tenant in its own block,
--                            one ledger_drift alert per tenant per Rome day listing every failing check
--   public.ledger_invariants_run  a service_role wrapper for the integration suite
-- Everything in `app` is closed to every API role. The alert is in the app for the owner (M6): there is no email.
-- Finding drift is not a job failure: the run is recorded as failed only when a tenant's check itself raised.

-- Each check returns at most one row: how many offenders and up to 5 of their ids. Comments in this body carry no
-- semicolons (the pgTAP source check counts them).
create function app.ledger_checks_body(p_tenant uuid, p_at timestamptz)
  returns table (check_key text, rows_count integer, sample_ids uuid[])
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with
  -- a lot without exactly one receipt that matches it (lot, ingredient, location, invoice line, quantity)
  lot_missing as (
    select l.id
      from public.raw_lot l
     where l.tenant_id = p_tenant
       and (select count(*)
              from public.stock_movement m
             where m.tenant_id = l.tenant_id and m.type::text = 'receipt' and m.raw_lot_id = l.id
               and m.ingredient_id = l.ingredient_id and m.location_id = l.location_id
               and m.ref_id = l.invoice_line_id and m.qty = l.qty_received) <> 1),
  -- a receipt whose lot is missing or differs
  receipt_bad as (
    select m.id
      from public.stock_movement m
     where m.tenant_id = p_tenant and m.type::text = 'receipt'
       and not exists (select 1 from public.raw_lot l
                        where l.tenant_id = m.tenant_id and l.id = m.raw_lot_id and l.ingredient_id = m.ingredient_id
                          and l.location_id = m.location_id and l.invoice_line_id = m.ref_id
                          and l.qty_received = m.qty)),
  -- every user reference must be a user of the same tenant (the foreign keys of the ledgers are not tenant-composite)
  user_bad as (
    select m.id from public.stock_movement m
     where m.tenant_id = p_tenant
       and not exists (select 1 from public.app_user u where u.id = m.created_by and u.tenant_id = m.tenant_id)
    union all
    select l.id from public.raw_lot l
     where l.tenant_id = p_tenant
       and not exists (select 1 from public.app_user u where u.id = l.created_by and u.tenant_id = l.tenant_id)
    union all
    select e.id from public.audit_event e
     where e.tenant_id = p_tenant
       and not exists (select 1 from public.app_user u where u.id = e.created_by and u.tenant_id = e.tenant_id)
    union all
    select c.id from public.count_session c
     where c.tenant_id = p_tenant
       and (not exists (select 1 from public.app_user u where u.id = c.started_by and u.tenant_id = c.tenant_id)
            or (c.closed_by is not null
                and not exists (select 1 from public.app_user u where u.id = c.closed_by and u.tenant_id = c.tenant_id))
            or (c.cancelled_by is not null
                and not exists (select 1 from public.app_user u where u.id = c.cancelled_by and u.tenant_id = c.tenant_id)))),
  -- a lot bucket (ingredient, location, lot) below zero
  lot_neg as (
    select b.raw_lot_id as id
      from (select m.raw_lot_id, m.ingredient_id, m.location_id, sum(m.qty) as q
              from public.stock_movement m
             where m.tenant_id = p_tenant and m.raw_lot_id is not null
             group by m.raw_lot_id, m.ingredient_id, m.location_id) b
     where b.q < 0),
  -- a reversal that does not mirror its original
  rev_bad as (
    select m.id
      from public.stock_movement m
      left join public.stock_movement o on o.tenant_id = m.tenant_id and o.id = m.reverses_id
     where m.tenant_id = p_tenant and m.reverses_id is not null
       and (o.id is null or o.reverses_id is not null or o.ingredient_id <> m.ingredient_id
            or o.location_id <> m.location_id or o.raw_lot_id is distinct from m.raw_lot_id or o.type <> m.type
            or o.reason_code is distinct from m.reason_code or o.unit_cost is distinct from m.unit_cost
            or o.qty <> -m.qty)),
  -- a transfer operation (reversals included) whose rows do not sum to zero, per ingredient
  transfer_bad as (
    select (array_agg(m.id order by m.id))[1] as id
      from public.stock_movement m
     where m.tenant_id = p_tenant and m.type::text = 'transfer'
     group by m.ref_type, m.ref_id, m.ingredient_id
    having sum(m.qty) <> 0),
  -- a closed line whose posted rows differ from counted minus expected (zero for an uncounted line), or a count row
  -- whose session is missing, at another location, not closed, or without a line for the ingredient
  count_bad as (
    select l.id
      from public.count_line l
      join public.count_session s on s.tenant_id = l.tenant_id and s.id = l.session_id
     where l.tenant_id = p_tenant and s.status = 'closed'
       and coalesce((select sum(m.qty) from public.stock_movement m
                      where m.tenant_id = l.tenant_id and m.type::text = 'count' and m.ref_type = 'count_session'
                        and m.ref_id = l.session_id and m.ingredient_id = l.ingredient_id
                        and m.location_id = s.location_id), 0)
           <> coalesce(l.counted_qty - l.expected_qty, 0)
    union all
    select m.id
      from public.stock_movement m
     where m.tenant_id = p_tenant and m.type::text = 'count' and m.ref_type = 'count_session'
       and not exists (select 1
                         from public.count_session s
                         join public.count_line l on l.tenant_id = s.tenant_id and l.session_id = s.id
                        where s.tenant_id = m.tenant_id and s.id = m.ref_id and s.status = 'closed'
                          and s.location_id = m.location_id and l.ingredient_id = m.ingredient_id))
  select 'lot_receipt_missing'::text, count(*)::integer, (array_agg(x.id order by x.id))[1:5] from lot_missing x having count(*) > 0
  union all
  select 'receipt_lot_mismatch', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from receipt_bad x having count(*) > 0
  union all
  select 'movement_user', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from user_bad x having count(*) > 0
  union all
  select 'lot_negative', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from lot_neg x having count(*) > 0
  union all
  select 'reversal_mirror', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from rev_bad x having count(*) > 0
  union all
  select 'transfer_unbalanced', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from transfer_bad x having count(*) > 0
  union all
  select 'count_mismatch', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from count_bad x having count(*) > 0;
end
$$;

-- The health of the scheduled jobs. A job is not judged before the oldest finished run record plus its own window,
-- so a fresh database never alerts on its first night. The run being executed is unfinished, so it never counts as
-- a previous run. Findings that come from job_run have no tenant: every tenant's alert lists them.
create function app.job_health_checks(p_tenant uuid, p_at timestamptz)
  returns table (check_key text, rows_count integer, sample_ids uuid[], job_key text)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
#variable_conflict use_column
declare
  v_since timestamptz;
begin
  select min(r.started_at) into v_since from app.job_run r where r.finished_at is not null;

  -- alert-rules runs hourly: stale after 3 hours without a successful run
  if v_since is not null and p_at >= v_since + interval '3 hours'
     and not exists (select 1 from app.job_run r
                      where r.job = 'alert-rules' and r.ok and r.started_at >= p_at - interval '3 hours') then
    return query select 'job_stale'::text, 1, '{}'::uuid[], 'alert-rules'::text;
  end if;
  -- ledger-invariants runs nightly: stale when its previous run started more than 26 hours ago
  if v_since is not null and p_at >= v_since + interval '26 hours'
     and not exists (select 1 from app.job_run r
                      where r.job = 'ledger-invariants' and r.finished_at is not null
                        and r.started_at >= p_at - interval '26 hours') then
    return query select 'job_stale'::text, 1, '{}'::uuid[], 'ledger-invariants'::text;
  end if;

  return query
    select 'job_failed'::text, count(*)::integer, '{}'::uuid[], r.job
      from app.job_run r
     where r.ok = false and r.started_at >= p_at - interval '24 hours' and r.started_at <= p_at
     group by r.job
     order by r.job;

  return query
    select 'job_unscheduled'::text, 1, '{}'::uuid[], j.name
      from unnest(array['alert-rules', 'extract-invoices', 'ledger-invariants']) j (name)
     where not exists (select 1 from cron.job c where c.jobname = j.name and c.active)
     order by j.name;

  -- the extract job runs only when there is work, so an invoice that keeps waiting is the signal
  return query
    select 'extract_backlog'::text, count(*)::integer, (array_agg(i.id order by i.id))[1:5], null::text
      from public.invoice i
     where i.tenant_id = p_tenant and i.status = 'received' and i.created_at < p_at - interval '60 minutes'
       and (i.next_attempt_at is null or i.next_attempt_at <= p_at)
    having count(*) > 0;

  return query
    select 'alerts_refused'::text, count(*)::integer, '{}'::uuid[], null::text
      from app.alert_refusal a
     where a.tenant_id = p_tenant and a.at >= p_at - interval '24 hours' and a.at <= p_at
    having count(*) > 0;
end
$$;

-- The runner. A tenant whose check raises is recorded in app.alert_refusal (check_failed, with the SQLSTATE) and does
-- not stop the others. Returns the number of tenants with findings.
create function app.run_ledger_invariants(p_at timestamptz default now()) returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_run bigint := app.job_run_begin('ledger-invariants');
  v_with integer := 0;
  v_failed boolean := false;
  v_checks jsonb;
  t record;
begin
  for t in select x.id from public.tenant x order by x.id loop
    begin
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'check_key', f.check_key, 'rows_count', f.rows_count, 'sample_ids', to_jsonb(f.sample_ids),
               'job_key', f.job_key)) order by f.check_key, f.job_key)
        into v_checks
        from (select b.check_key, b.rows_count, b.sample_ids, null::text as job_key
                from app.ledger_checks_body(t.id, p_at) b
              union all
              select h.check_key, h.rows_count, h.sample_ids, h.job_key
                from app.job_health_checks(t.id, p_at) h) f;
      if v_checks is not null then
        perform app.try_raise_alert(t.id, 'ledger_drift', 'tenant', t.id,
                                    jsonb_build_object('checks', v_checks, 'checked_at', p_at),
                                    null, null, p_at, null, 'ledger_invariants');
        v_with := v_with + 1;
      end if;
    exception when others then
      v_failed := true;
      perform app.record_alert_refusal(t.id, 'ledger_drift', 'tenant', t.id, 'ledger_invariants', 'check_failed', sqlstate);
      raise warning 'ledger invariant check failed: %', sqlstate;
    end;
  end loop;
  perform app.job_run_end(v_run, not v_failed, case when v_failed then 'check_failed' end, v_with);
  return v_with;
end
$$;

create function public.ledger_invariants_run(p_at timestamptz default now()) returns jsonb
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  select jsonb_build_object('tenantsWithFindings', app.run_ledger_invariants(p_at))
$$;

revoke all on function app.ledger_checks_body(uuid, timestamptz), app.job_health_checks(uuid, timestamptz),
  app.run_ledger_invariants(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.ledger_invariants_run(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.ledger_invariants_run(timestamptz) to service_role;

select cron.schedule('ledger-invariants', '45 2 * * *', $job$select app.run_ledger_invariants()$job$);
