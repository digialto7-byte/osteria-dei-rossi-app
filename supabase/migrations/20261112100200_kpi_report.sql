-- M22 step 3 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.1.7, §3.2, §3.3; ADR-025; AT1, AT6): the KPI report of a day, a week, a month or a custom range, with the
-- comparison period and the deltas.
--
--   app.kpi_period          the period and its comparison (Q148): day -> D - 7, week -> the previous ISO week, month -> the previous calendar month, custom -> the same
--                           number of days just before. p_date null = yesterday's business date. Errors: 22023 invalid_request (unknown period), P0001 range_invalid,
--                           range_too_long (366 days), date_in_future (the anchor, or a custom `to`, after today's business date). A week or a month that contains
--                           today is allowed: its later days simply hold no sales and are not final.
--   app.kpi_range_agg       the sales facts of a range: the stored daily_kpi rows plus app.kpi_day_row for the dates that have none, so stored and live agree. final is
--                           true when every date of the range is stored.
--   app.kpi_purchases       receipts at cost by effective_on. A receipt always has a unit cost (stock_movement_receipt_ck) and is never reversed (a reversal must mirror
--                           its original, and a receipt row carries no reverses_id), so unvalued is 0 today; the count stays for the report's shape.
--   app.kpi_register_range  app total (closed sessions by closed_business_date) against the latest day_close of each date (the M21 rule). The difference is like for like:
--                           the app total of the dates that HAVE a register entry minus the register total, so a missing entry never shows as a false loss; the dates
--                           with sales and no entry are listed.
--   app.kpi_report_json     the twin (tenant, role, ..., now): {period, current, previous, delta}. Waste comes from public.waste_costs, which re-checks the role.
--   public.kpi_report       the wrapper: owner and admin only (checked first), then the twin with the caller's tenant and role and now().
-- Amounts keep four decimals (the internal precision); percentages are rounded to 2 decimals and delta percentages to 1, from the unrounded sums.

create function app.kpi_period(p_tenant uuid, p_period text, p_date date, p_from date, p_to date, p_now timestamptz)
  returns table (from_d date, to_d date, cmp_from date, cmp_to date)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_today date := app.business_date(p_tenant, p_now);
  v_d date;
  v_f date;
  v_n integer;
begin
  if p_period is null or p_period <> all (array['day', 'week', 'month', 'custom']) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_period = 'custom' then
    if p_from is null or p_to is null or p_from > p_to then
      raise exception 'range_invalid' using errcode = 'P0001';
    end if;
    if p_to - p_from + 1 > 366 then
      raise exception 'range_too_long' using errcode = 'P0001';
    end if;
    if p_to > v_today then
      raise exception 'date_in_future' using errcode = 'P0001';
    end if;
    v_n := p_to - p_from + 1;
    return query select p_from, p_to, p_from - v_n, p_from - 1;
    return;
  end if;
  v_d := coalesce(p_date, v_today - 1);
  if v_d > v_today then
    raise exception 'date_in_future' using errcode = 'P0001';
  end if;
  if p_period = 'day' then
    return query select v_d, v_d, v_d - 7, v_d - 7;
  elsif p_period = 'week' then
    v_f := v_d - (extract(isodow from v_d)::integer - 1);
    return query select v_f, v_f + 6, v_f - 7, v_f - 1;
  else
    v_f := date_trunc('month', v_d)::date;
    return query select v_f, (v_f + interval '1 month' - interval '1 day')::date, (v_f - interval '1 month')::date, v_f - 1;
  end if;
end
$$;

create function app.kpi_range_agg(p_tenant uuid, p_from date, p_to date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  a record;
  v_days integer := p_to - p_from + 1;
begin
  with days as (
    select gs.d::date as d from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') gs (d)
  ),
  stored as (
    select s.business_date, s.tables, s.covers, s.revenue_gross, s.items_net, s.coperto_net, s.plates, s.costed_net, s.food_cost, s.uncosted_net,
           s.covers_by_hour
      from public.daily_kpi s
     where s.tenant_id = p_tenant and s.business_date between p_from and p_to
  ),
  missing as (
    select k.business_date, k.tables, k.covers, k.revenue_gross, k.items_net, k.coperto_net, k.plates, k.costed_net, k.food_cost, k.uncosted_net,
           k.covers_by_hour
      from (select dd.d from days dd where not exists (select 1 from stored x where x.business_date = dd.d)) m,
           lateral app.kpi_day_row(p_tenant, m.d) k
  ),
  allrows as (
    select * from stored union all select * from missing
  ),
  tot as (
    select coalesce(sum(r.tables), 0) as tables, coalesce(sum(r.covers), 0) as covers, coalesce(sum(r.revenue_gross), 0) as revenue_gross,
           coalesce(sum(r.items_net), 0) as items_net, coalesce(sum(r.coperto_net), 0) as coperto_net, coalesce(sum(r.plates), 0) as plates,
           coalesce(sum(r.costed_net), 0) as costed_net, coalesce(sum(r.food_cost), 0) as food_cost, coalesce(sum(r.uncosted_net), 0) as uncosted_net
      from allrows r
  ),
  hours as (
    select jsonb_agg(coalesce(h.c, 0)::integer order by g.i) as j
      from generate_series(1, 24) g (i)
      left join (select u.i, sum(u.v) as c from allrows r, unnest(r.covers_by_hour) with ordinality u (v, i) group by u.i) h on h.i = g.i
  ),
  wdays as (
    select jsonb_agg(coalesce(w.c, 0)::integer order by g.i) as j
      from generate_series(1, 7) g (i)
      left join (select extract(isodow from r.business_date)::integer as i, sum(r.covers) as c from allrows r group by 1) w on w.i = g.i
  )
  select (select count(*) from stored)::integer as n_stored, tot.*, hours.j as hours, wdays.j as wdays
    into a
    from tot, hours, wdays;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'final', a.n_stored = v_days, 'daysFinal', a.n_stored, 'days', v_days,
    'covers', a.covers, 'tables', a.tables,
    'revenueGrossEur', round(a.revenue_gross, 4),
    'revenueNetEur', round(a.items_net + a.coperto_net, 4),
    'copertoNetEur', round(a.coperto_net, 4),
    'avgSpendPerCoverEur', case when a.covers > 0 then round((a.items_net + a.coperto_net) / a.covers, 4) end,
    'avgTicketEur', case when a.tables > 0 then round((a.items_net + a.coperto_net) / a.tables, 4) end,
    'plates', a.plates,
    'foodCostEur', round(a.food_cost, 4),
    -- Only the dishes whose cost is known (Q146); unknown is never zero, so no costed revenue means no percentage.
    'foodCostPct', case when a.costed_net > 0 then round(a.food_cost / a.costed_net * 100, 2) end,
    'costedRevenueNetEur', round(a.costed_net, 4),
    'uncostedRevenueNetEur', round(a.uncosted_net, 4),
    'costedSharePct', case when a.items_net > 0 then round(a.costed_net / a.items_net * 100, 2) end,
    'coversByHour', a.hours, 'coversByWeekday', a.wdays);
end
$$;

create function app.kpi_purchases(p_tenant uuid, p_from date, p_to date) returns table (value numeric, unvalued integer)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(sum(round(m.qty * m.unit_cost, 4)) filter (where m.unit_cost is not null), 0),
         (count(*) filter (where m.unit_cost is null))::integer
    from public.stock_movement m
   where m.tenant_id = p_tenant and m.type = 'receipt' and m.effective_on between p_from and p_to
$$;

create function app.kpi_register_range(p_tenant uuid, p_from date, p_to date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_app numeric;
  v_app_with numeric;
  v_reg numeric;
  v_n_reg integer;
  v_missing jsonb;
  v_amount numeric;
begin
  with sess as (
    select s.closed_business_date as d, sum(coalesce(s.total, 0)) as t
      from public.table_session s
     where s.tenant_id = p_tenant and s.closed_at is not null and s.closed_business_date between p_from and p_to
     group by s.closed_business_date
  ),
  reg as (
    select distinct on (z.business_date) z.business_date as d, z.register_total as r
      from public.day_close z
     where z.tenant_id = p_tenant and z.business_date between p_from and p_to
     order by z.business_date, z.created_at desc, z.id desc
  )
  select coalesce((select sum(t) from sess), 0),
         coalesce((select sum(s.t) from sess s join reg on reg.d = s.d), 0),
         (select sum(r) from reg), (select count(*) from reg)::integer,
         coalesce((select jsonb_agg(s.d order by s.d) from sess s where not exists (select 1 from reg where reg.d = s.d)), '[]'::jsonb)
    into v_app, v_app_with, v_reg, v_n_reg, v_missing;
  v_amount := v_app_with - coalesce(v_reg, 0);
  return jsonb_build_object(
    'appTotalEur', v_app,
    'registerTotalEur', v_reg,
    'difference', case when v_n_reg = 0 then null
                       else jsonb_build_object('amount', v_amount, 'pct', case when v_reg = 0 then null else round(v_amount / v_reg * 100, 1) end) end,
    'datesWithoutRegister', v_missing);
end
$$;

-- One block of the report: the sales facts plus the figures that stay live.
create function app.kpi_block(p_tenant uuid, p_from date, p_to date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_pur record;
  v_waste jsonb := public.waste_costs(p_from, p_to);
begin
  select * into v_pur from app.kpi_purchases(p_tenant, p_from, p_to);
  return app.kpi_range_agg(p_tenant, p_from, p_to) || jsonb_build_object(
    'purchasesEur', round(v_pur.value, 4), 'purchasesUnvaluedCount', v_pur.unvalued,
    'waste', jsonb_build_object(
      'valueEur', v_waste -> 'valueEur', 'unvaluedCount', v_waste -> 'unvaluedCount',
      'reasons', coalesce((select jsonb_agg(jsonb_build_object('reasonCode', e.value -> 'reasonCode', 'valueEur', e.value -> 'valueEur') order by e.ord)
                             from jsonb_array_elements(v_waste -> 'reasons') with ordinality e (value, ord)), '[]'::jsonb)),
    'appVsRegister', app.kpi_register_range(p_tenant, p_from, p_to));
end
$$;

create function app.kpi_report_json(p_tenant uuid, p_role text, p_period text, p_date date, p_from date, p_to date, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  per record;
  v_cur jsonb;
  v_prev jsonb;
  v_delta jsonb;
begin
  select * into per from app.kpi_period(p_tenant, p_period, p_date, p_from, p_to, p_now);
  v_cur := app.kpi_block(p_tenant, per.from_d, per.to_d);
  v_prev := app.kpi_block(p_tenant, per.cmp_from, per.cmp_to);
  -- One entry per DELTA_KEYS (src/server/reports/constants.ts): {abs, pct} or null when either side is unknown. pct is null at a previous value of 0.
  select jsonb_object_agg(x.k, case when x.c is null or x.p is null then null
                                    else jsonb_build_object('abs', round(x.c - x.p, 4),
                                                            'pct', case when x.p = 0 then null else round((x.c - x.p) / x.p * 100, 1) end) end)
    into v_delta
    from (select k.key as k, (v_cur #>> k.path)::numeric as c, (v_prev #>> k.path)::numeric as p
            from (values ('covers', '{covers}'::text[]), ('tables', '{tables}'), ('revenueGrossEur', '{revenueGrossEur}'), ('revenueNetEur', '{revenueNetEur}'),
                         ('avgSpendPerCoverEur', '{avgSpendPerCoverEur}'), ('avgTicketEur', '{avgTicketEur}'), ('plates', '{plates}'),
                         ('foodCostEur', '{foodCostEur}'), ('foodCostPct', '{foodCostPct}'), ('purchasesEur', '{purchasesEur}'),
                         ('wasteEur', '{waste,valueEur}'), ('appTotalEur', '{appVsRegister,appTotalEur}')) k (key, path)) x;
  return jsonb_build_object('period', p_period, 'current', v_cur, 'previous', v_prev, 'delta', v_delta);
end
$$;

create function public.kpi_report(p_period text, p_date date, p_from date, p_to date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.kpi_report_json(app.tenant_id(), app.role()::text, p_period, p_date, p_from, p_to, now());
end
$$;

revoke all on function app.kpi_period(uuid, text, date, date, date, timestamptz), app.kpi_range_agg(uuid, date, date), app.kpi_purchases(uuid, date, date),
  app.kpi_register_range(uuid, date, date), app.kpi_block(uuid, date, date), app.kpi_report_json(uuid, text, text, date, date, date, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.kpi_report(text, date, date, date) from public, anon, authenticated, service_role;
grant execute on function public.kpi_report(text, date, date, date) to authenticated;
