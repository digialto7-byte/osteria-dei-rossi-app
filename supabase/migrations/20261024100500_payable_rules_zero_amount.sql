-- M9 review fix: no reminder and no digest line for a payable whose amount is 0 (fully credited).
--
-- The filter lives in the two helpers, not in app.alert_rules_body: the body of 20261024100300 only loops over
-- tenants and calls app.payable_reminder_rule and app.payables_digest_rule, so it is left as it is (same
-- signature, same ACL) and so is app.run_alert_rules (M6 contract). Only `p.amount > 0` is added, in the reminder
-- query and in both digest queries (totals and supplier list); everything else is the body of 20261024100300.
-- A tenant whose only unpaid payables are 0,00 EUR gets no digest. The payable stays open and listed in the
-- payables screens; it simply raises no alert.

create or replace function app.payable_reminder_rule(p_tenant uuid, p_at timestamptz) returns integer
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
     where p.tenant_id = p_tenant and p.status = 'open' and p.amount > 0 and p.due_date <= v_today + 7
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

create or replace function app.payables_digest_payload(p_tenant uuid, p_today date) returns jsonb
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
   where p.tenant_id = p_tenant and p.status in ('open', 'scheduled', 'disputed') and p.amount > 0;
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
           where p.tenant_id = p_tenant and p.status in ('open', 'scheduled', 'disputed') and p.amount > 0
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

-- create or replace keeps the ACL; restated so a fresh clone ends in the same state.
revoke all on function app.payable_reminder_rule(uuid, timestamptz), app.payables_digest_payload(uuid, date)
  from public, anon, authenticated, service_role;
