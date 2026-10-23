-- M9 step 11: the payable reminder rule, the weekly digest rule, and an isolated alert_rules_body
-- (M9 plan §3.1.5-3.1.7, §3.2; ADR-009).
--
-- Only app.alert_rules_body is replaced here (M6 contract: rule milestones replace the body, never
-- app.run_alert_rules, which stays as 20261022150600 left it). Before this migration the body held no rule
-- (it returned 0), so there is nothing from an earlier milestone to keep. Later rule milestones start from
-- this version and keep both calls.
--
-- Reminders. For an `open` payable due on D, today being the Europe/Rome business date, the stage is the
-- latest one reached: payable_overdue_3d from D+3, else payable_due_today from D, else payable_due_7d from D-7.
-- The alert's business date is the stage's NOMINAL date (D-7, D, D+3), so the M6 dedup key fires each stage
-- once per payable whenever it is first seen: a missed run or a late approval catches up with the latest stage,
-- an earlier stage that was missed is not fired late, and a repeated run adds nothing. Rows are read with
-- `for share skip locked`: a payable whose status is being changed right now is skipped and caught up on the
-- next run.
--
-- Digest. One payables_weekly_digest per tenant per ISO week, dated the ISO Monday, listing the unpaid payables
-- (open, scheduled, disputed) by supplier. No unpaid payable, no digest.
--
-- Isolation. Each tenant x rule runs in its own BEGIN ... EXCEPTION block (a savepoint): a failure rolls back that
-- tenant's run of that rule and is recorded through app.record_alert_refusal (code rule_failed, the SQLSTATE
-- only, never the message). Alerts go through app.try_raise_alert, so a guard refusal of one payable is
-- recorded and the loop goes on. job_run therefore stays ok when only some blocks failed: M13's job health
-- check must also read app.alert_refusal rows with code rule_failed.

-- Returns the number of reminders raised for the tenant at p_at.
create function app.payable_reminder_rule(p_tenant uuid, p_at timestamptz) returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_today date := app.alert_business_date(p_tenant, p_at);
  v_items integer := 0;
  v_kind text;
  v_nominal date;
  v_id uuid;
  r record;
begin
  for r in
    select p.id, p.invoice_id, p.supplier_id, p.amount, p.due_date
      from public.payable p
     where p.tenant_id = p_tenant and p.status = 'open' and p.due_date <= v_today + 7
     order by p.due_date, p.id
       for share of p skip locked
  loop
    if v_today >= r.due_date + 3 then
      v_kind := 'payable_overdue_3d';
      v_nominal := r.due_date + 3;
    elsif v_today >= r.due_date then
      v_kind := 'payable_due_today';
      v_nominal := r.due_date;
    else
      v_kind := 'payable_due_7d';
      v_nominal := r.due_date - 7;
    end if;

    -- Already raised for this stage: skip it, and build no payload.
    continue when exists (
      select 1 from public.alert a
       where a.tenant_id = p_tenant and a.kind = v_kind and a.entity_type = 'payable'
         and a.entity_id = r.id and a.business_date = v_nominal);

    v_id := app.try_raise_alert(
      p_tenant, v_kind, 'payable', r.id,
      (select jsonb_build_object(
                'payable_id', r.id,
                'invoice_id', r.invoice_id,
                'invoice_number', left(coalesce(i.number_raw, ''), 80),
                'supplier_id', r.supplier_id,
                'supplier_name', left(s.name, 80),
                'amount_eur', r.amount,
                'due_date', r.due_date)
         from public.invoice i, public.supplier s
        where i.id = r.invoice_id and i.tenant_id = p_tenant
          and s.id = r.supplier_id and s.tenant_id = p_tenant),
      null, null, p_at, v_nominal, 'payable_reminders');
    if v_id is not null then
      v_items := v_items + 1;
    end if;
  end loop;
  return v_items;
end
$$;

-- The digest payload, or null when the tenant has no unpaid payable. At most 15 suppliers are listed, ordered
-- by their earliest due date, then name (C collation), then id; entries are dropped from the end until the
-- payload is at most 7 680 bytes (the table allows 8 192).
create function app.payables_digest_payload(p_tenant uuid, p_today date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_totals record;
  v_sup jsonb;
  v_n integer;
  v_payload jsonb;
begin
  select count(*)::int as n, coalesce(sum(p.amount), 0) as amount,
         count(*) filter (where p.due_date < p_today)::int as overdue_n,
         coalesce(sum(p.amount) filter (where p.due_date < p_today), 0) as overdue_amount,
         count(distinct p.supplier_id)::int as suppliers
    into v_totals
    from public.payable p
   where p.tenant_id = p_tenant and p.status in ('open', 'scheduled', 'disputed');
  if v_totals.n = 0 then
    return null;
  end if;

  select jsonb_agg(e.entry order by e.next_due, e.name collate "C", e.supplier_id)
    into v_sup
    from (
      select g.supplier_id, g.name, g.next_due,
             jsonb_build_object(
               'supplier_id', g.supplier_id,
               'supplier_name', g.name,
               'payables_count', g.n,
               'amount_eur', g.amount,
               'overdue_count', g.overdue_n,
               'next_due_date', g.next_due) as entry
        from (
          select p.supplier_id, left(s.name, 80) as name, count(*)::int as n, sum(p.amount) as amount,
                 count(*) filter (where p.due_date < p_today)::int as overdue_n, min(p.due_date) as next_due
            from public.payable p
            join public.supplier s on s.id = p.supplier_id and s.tenant_id = p.tenant_id
           where p.tenant_id = p_tenant and p.status in ('open', 'scheduled', 'disputed')
           group by p.supplier_id, s.name
        ) g
    ) e;

  v_n := least(15, jsonb_array_length(v_sup));
  loop
    v_payload := jsonb_build_object(
      'week_start_date', date_trunc('week', p_today::timestamp)::date,
      'as_of_date', p_today,
      'payables_count', v_totals.n,
      'amount_eur', v_totals.amount,
      'overdue_count', v_totals.overdue_n,
      'overdue_amount_eur', v_totals.overdue_amount,
      'suppliers_count', v_totals.suppliers,
      'suppliers_listed', v_n,
      'suppliers', (select coalesce(jsonb_agg(x.value order by x.ord), '[]'::jsonb)
                      from jsonb_array_elements(v_sup) with ordinality x (value, ord)
                     where x.ord <= v_n));
    exit when octet_length(v_payload::text) <= 7680 or v_n <= 1;
    v_n := v_n - 1;
  end loop;
  return v_payload;
end
$$;

-- Returns 1 when this run raised the tenant's digest of the ISO week, else 0.
create function app.payables_digest_rule(p_tenant uuid, p_at timestamptz) returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_today date := app.alert_business_date(p_tenant, p_at);
  v_monday date := date_trunc('week', v_today::timestamp)::date;
  v_payload jsonb;
  v_id uuid;
begin
  perform 1 from public.alert a
    where a.tenant_id = p_tenant and a.kind = 'payables_weekly_digest' and a.entity_type = 'tenant'
      and a.entity_id = p_tenant and a.business_date = v_monday;
  if found then
    return 0;
  end if;
  v_payload := app.payables_digest_payload(p_tenant, v_today);
  if v_payload is null then
    return 0;
  end if;
  v_id := app.try_raise_alert(p_tenant, 'payables_weekly_digest', 'tenant', p_tenant, v_payload, null, null,
                              p_at, v_monday, 'payables_digest');
  return case when v_id is null then 0 else 1 end;
end
$$;

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
  end loop;
  return v_items;
end
$$;

revoke all on function app.payable_reminder_rule(uuid, timestamptz),
  app.payables_digest_payload(uuid, date),
  app.payables_digest_rule(uuid, timestamptz)
  from public, anon, authenticated, service_role;
