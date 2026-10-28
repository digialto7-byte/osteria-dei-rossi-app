-- M13 merge fix: the checks M11 and M13 both re-created, as the union of the two, and M11's job watched.
--
-- M11 (20261025100000_staff_auth_tables.sql) and M13 (20261027100000_count_tables.sql) each re-created
-- audit_event_entity_type_check and audit_event_action_check from the M9 lists. Built in parallel, the
-- later M13 migration first dropped M11's staff and device entries, so revoke_device, the PIN reset and
-- the other staff procedures failed their audit insert. That list in 20261027100000 was then restored in
-- place (fix/m13-check-union), so this file now restates the union and is a no-op on a fresh chain.
alter table public.audit_event
  drop constraint audit_event_entity_type_check,
  drop constraint audit_event_action_check;
alter table public.audit_event
  add constraint audit_event_entity_type_check
    check (entity_type in ('invoice', 'ingredient', 'recipe', 'tenant', 'payable', 'app_user',
                           'venue_device', 'device_enrolment', 'count_session')),
  add constraint audit_event_action_check
    check (action in ('invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared',
                      'ingredient.allergens_confirmed', 'recipe.deactivated', 'recipe.reactivated',
                      'tenant.settings_changed', 'payable.status_changed', 'payable.payment_reversed',
                      'app_user.created', 'app_user.updated', 'app_user.deactivated',
                      'app_user.reactivated', 'app_user.pin_set', 'device_enrolment.created',
                      'venue_device.enrolled', 'venue_device.revoked', 'venue_device.unlocked',
                      'count_session.closed', 'count_session.cancelled', 'ingredient.critical_changed'));

-- The same for app.job_run: M11 added auth-purge, M13 ledger-invariants.
alter table app.job_run drop constraint job_run_job_check;
alter table app.job_run
  add constraint job_run_job_check check (job in ('extract', 'alert-rules', 'auth-purge', 'ledger-invariants'));

-- The nightly check also watches M11's auth-purge cron job (job_unscheduled); otherwise unchanged from
-- 20261027100700_ledger_invariants.sql. create or replace keeps the owner and the grants.
create or replace function app.job_health_checks(p_tenant uuid, p_at timestamptz)
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
      from unnest(array['alert-rules', 'auth-purge', 'extract-invoices', 'ledger-invariants']) j (name)
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
