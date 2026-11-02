-- M25c step 5 (docs/plans/2026-11-01-m25c-services.md §3.1.6, §3.1.7, §3.1.8, §3.2; ADR-031): the per-service split of a period and of a day.
--
--   app.kpi_service_block   one block of figures from unrounded sums, with the expressions of app.kpi_range_agg (amounts at 4 decimals, percentages at 2, null on a 0 divisor).
--   app.kpi_service_split   {services: [block + key, name, position], total: block}: app.kpi_sales_lines and app.kpi_session_rows (unchanged) joined with app.session_services, so
--                           the services add up to the total by construction and the total equals kpi_report's current block. Keys: those of the versions in force during the
--                           range, plus any key with data. Order: the current version's business-clock order (the version in force at the end of the range), then removed keys by name.
--   app.kpi_services_json   {period, from, to, final, daysFinal, days, services, total} with app.kpi_period's rules and errors; final from app.kpi_last_final_date.
--   app.day_services_json   the day close's split: per service tables, covers, totalEur (frozen session totals, the M21 app figure), net revenue and open tables, plus the day's
--                           sessions with their service, the keys they can move to and canChange. The date rule is app.day_close_range_ok's, read at p_now. No staff name is returned.
--   public.kpi_services, public.day_services   wrappers: app.require_day_closer() first (owner, admin; the same keys for both).
-- Nothing is stored: after finality every input is frozen (closed sessions are final, versions apply forward, overrides are refused), so the live split cannot move.

create function app.kpi_service_block(p_tables integer, p_covers integer, p_gross numeric, p_items_net numeric, p_coperto_net numeric, p_plates numeric,
                                      p_costed_net numeric, p_food_cost numeric, p_total_net numeric) returns jsonb
  language sql
  immutable
  security definer
  set search_path = ''
as $$
  select jsonb_build_object(
    'covers', p_covers, 'tables', p_tables,
    'revenueGrossEur', round(p_gross, 4),
    'revenueNetEur', round(p_items_net + p_coperto_net, 4),
    'avgSpendPerCoverEur', case when p_covers > 0 then round((p_items_net + p_coperto_net) / p_covers, 4) end,
    'avgTicketEur', case when p_tables > 0 then round((p_items_net + p_coperto_net) / p_tables, 4) end,
    'plates', p_plates,
    'foodCostEur', round(p_food_cost, 4),
    'foodCostPct', case when p_costed_net > 0 then round(p_food_cost / p_costed_net * 100, 2) end,
    'costedRevenueNetEur', round(p_costed_net, 4),
    'costedSharePct', case when p_items_net > 0 then round(p_costed_net / p_items_net * 100, 2) end,
    'revenueSharePct', case when p_total_net > 0 then round((p_items_net + p_coperto_net) / p_total_net * 100, 2) end)
$$;

create function app.kpi_service_split(p_tenant uuid, p_from date, p_to date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_start timestamptz := app.kpi_cutoff_end(p_tenant, p_from - 1);
  v_end timestamptz := app.kpi_cutoff_end(p_tenant, p_to);
  v_labels jsonb;
  v_services jsonb;
  v_total jsonb;
begin
  v_labels := app.service_labels(p_tenant, v_end);
  with svc as materialized (
    select ss.session_id, ss.service_key from app.session_services(p_tenant, p_from, p_to) ss
  ),
  sess as (
    select sv.service_key as k, count(*)::integer as tables, coalesce(sum(x.covers), 0)::integer as covers, coalesce(sum(x.total), 0) as gross,
           coalesce(sum(x.coperto_net), 0) as coperto_net
      from app.kpi_session_rows(p_tenant, p_from, p_to) x join svc sv on sv.session_id = x.session_id
     group by sv.service_key
  ),
  ln as (
    select sv.service_key as k, coalesce(sum(l.net), 0) as items_net, coalesce(sum(l.qty), 0) as plates,
           coalesce(sum(l.net) filter (where l.costed), 0) as costed_net, coalesce(sum(l.food_cost) filter (where l.costed), 0) as food_cost
      from app.kpi_sales_lines(p_tenant, p_from, p_to) l join svc sv on sv.session_id = l.session_id
     group by sv.service_key
  ),
  keys as (
    select e ->> 'key' as k from jsonb_array_elements(app.service_periods_at(p_tenant, v_start)) e
    union
    select e ->> 'key' from public.service_schedule v cross join lateral jsonb_array_elements(v.periods) e
     where v.tenant_id = p_tenant and v.created_at > v_start and v.created_at <= v_end
    union
    select k from sess
  ),
  agg as (
    select keys.k, coalesce(sess.tables, 0) as tables, coalesce(sess.covers, 0) as covers, coalesce(sess.gross, 0) as gross,
           coalesce(sess.coperto_net, 0) as coperto_net, coalesce(ln.items_net, 0) as items_net, coalesce(ln.plates, 0) as plates,
           coalesce(ln.costed_net, 0) as costed_net, coalesce(ln.food_cost, 0) as food_cost
      from keys left join sess on sess.k = keys.k left join ln on ln.k = keys.k
  ),
  tot as (
    select coalesce(sum(tables), 0)::integer as tables, coalesce(sum(covers), 0)::integer as covers, coalesce(sum(gross), 0) as gross,
           coalesce(sum(items_net), 0) as items_net, coalesce(sum(coperto_net), 0) as coperto_net, coalesce(sum(plates), 0) as plates,
           coalesce(sum(costed_net), 0) as costed_net, coalesce(sum(food_cost), 0) as food_cost
      from agg
  )
  select (select coalesce(jsonb_agg(
                 jsonb_build_object('key', a.k, 'name', coalesce(v_labels -> a.k ->> 'name', a.k), 'position', (v_labels -> a.k ->> 'position')::integer)
                 || app.kpi_service_block(a.tables, a.covers, a.gross, a.items_net, a.coperto_net, a.plates, a.costed_net, a.food_cost, t.items_net + t.coperto_net)
                 order by (v_labels -> a.k ->> 'position')::integer nulls last, lower(coalesce(v_labels -> a.k ->> 'name', a.k)), a.k), '[]'::jsonb)
            from agg a, tot t),
         (select app.kpi_service_block(t.tables, t.covers, t.gross, t.items_net, t.coperto_net, t.plates, t.costed_net, t.food_cost, t.items_net + t.coperto_net) from tot t)
    into v_services, v_total;
  return jsonb_build_object('services', v_services, 'total', v_total);
end
$$;

create function app.kpi_services_json(p_tenant uuid, p_period text, p_date date, p_from date, p_to date, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  per record;
  v_last date;
begin
  select * into per from app.kpi_period(p_tenant, p_period, p_date, p_from, p_to, p_now);
  v_last := app.kpi_last_final_date(p_tenant, p_now);
  return jsonb_build_object('period', p_period, 'from', per.from_d, 'to', per.to_d, 'final', per.to_d <= v_last,
                            'daysFinal', greatest(0, least(per.to_d, v_last) - per.from_d + 1), 'days', per.to_d - per.from_d + 1)
         || app.kpi_service_split(p_tenant, per.from_d, per.to_d);
end
$$;

-- The sessions of a day: D's closed sessions plus the open ones opened on or before D (the openTables rule of M21), each with its service.
create function app.day_service_sessions(p_tenant uuid, p_date date)
  returns table (session_id uuid, table_name text, opened_at timestamptz, closed_at timestamptz, covers integer, total numeric, closed_business_date date,
                 service_key text, overridden boolean, choices text[])
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select s.id, s.table_name, s.opened_at, s.closed_at, s.covers::integer, s.total, s.closed_business_date, sv.service_key, sv.overridden, sv.choices
    from public.table_session s
   cross join lateral app.session_service_one(p_tenant, s.id) sv
   where s.tenant_id = p_tenant
     and ((s.closed_at is not null and s.closed_business_date = p_date) or (s.closed_at is null and s.business_date <= p_date))
$$;

create function app.day_services_json(p_tenant uuid, p_date date, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_today date := app.business_date(p_tenant, p_now);
  v_date date := coalesce(p_date, app.business_date(p_tenant, p_now));
  v_end timestamptz;
  v_split jsonb;
  v_labels jsonb;
  v_windows jsonb;
  v_services jsonb;
  v_sessions jsonb;
  v_open integer;
begin
  -- The rule of app.day_close_range_ok (today back to 62 days), read at p_now so a test can fix it.
  if v_date > v_today or v_date < v_today - 62 then
    raise exception 'business_date_invalid' using errcode = 'P0001';
  end if;
  v_end := app.kpi_cutoff_end(p_tenant, v_date);
  v_split := app.kpi_service_split(p_tenant, v_date, v_date);
  v_labels := app.service_labels(p_tenant, v_end);
  v_windows := app.service_windows(app.service_periods_at(p_tenant, v_end), app.business_day_cutoff(p_tenant));

  select count(*)::integer into v_open from app.day_service_sessions(p_tenant, v_date) r where r.closed_at is null;

  with base as (
    select s ->> 'key' as k, s ->> 'name' as n, (s ->> 'position')::integer as pos, (s ->> 'tables')::integer as tables, (s ->> 'covers')::integer as covers,
           (s ->> 'revenueGrossEur')::numeric as gross, (s ->> 'revenueNetEur')::numeric as net, o as ord
      from jsonb_array_elements(v_split -> 'services') with ordinality t (s, o)
  ),
  extra as (
    select r.service_key as k, coalesce(v_labels -> r.service_key ->> 'name', r.service_key) as n, (v_labels -> r.service_key ->> 'position')::integer as pos
      from app.day_service_sessions(p_tenant, v_date) r where r.closed_at is null and r.service_key not in (select b.k from base b)
     group by r.service_key
  ),
  allsvc as (
    select k, n, pos, tables, covers, gross, net, ord from base
    union all
    select k, n, pos, 0, 0, 0::numeric, 0::numeric, 1000 from extra
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', a.k, 'name', a.n, 'position', a.pos,
           'startsAt', (select w ->> 'startsAt' from jsonb_array_elements(v_windows) w where w ->> 'key' = a.k),
           'endsAt', (select w ->> 'endsAt' from jsonb_array_elements(v_windows) w where w ->> 'key' = a.k),
           'tables', a.tables, 'covers', a.covers, 'totalEur', round(a.gross, 2), 'revenueNetEur', round(a.net, 4),
           'openTables', (select count(*) from app.day_service_sessions(p_tenant, v_date) r where r.closed_at is null and r.service_key = a.k)) order by a.ord), '[]'::jsonb)
    into v_services
    from allsvc a;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sessionId', r.session_id, 'tableName', r.table_name, 'openedAt', r.opened_at, 'closedAt', r.closed_at, 'covers', r.covers,
           'totalEur', case when r.closed_at is not null then round(r.total, 2) end,
           'serviceKey', r.service_key, 'source', case when r.overridden then 'override' else 'auto' end, 'choices', to_jsonb(r.choices),
           'canChange', r.closed_at is null or p_now < app.kpi_cutoff_end(p_tenant, r.closed_business_date) + app.kpi_finalise_grace())
           order by r.opened_at, r.session_id), '[]'::jsonb)
    into v_sessions
    from app.day_service_sessions(p_tenant, v_date) r;

  return jsonb_build_object(
    'businessDate', v_date,
    'final', p_now >= v_end + app.kpi_finalise_grace(),
    'services', v_services,
    'total', jsonb_build_object('tables', (v_split -> 'total' ->> 'tables')::integer, 'covers', (v_split -> 'total' ->> 'covers')::integer,
                                'totalEur', round((v_split -> 'total' ->> 'revenueGrossEur')::numeric, 2),
                                'revenueNetEur', (v_split -> 'total' ->> 'revenueNetEur')::numeric, 'openTables', v_open),
    'sessions', v_sessions);
end
$$;

create function public.kpi_services(p_period text, p_date date, p_from date, p_to date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.kpi_services_json(app.tenant_id(), p_period, p_date, p_from, p_to, clock_timestamp());
end
$$;

create function public.day_services(p_date date default null) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.day_services_json(app.tenant_id(), p_date, clock_timestamp());
end
$$;

revoke all on function app.kpi_service_block(integer, integer, numeric, numeric, numeric, numeric, numeric, numeric, numeric), app.kpi_service_split(uuid, date, date),
  app.kpi_services_json(uuid, text, date, date, date, timestamptz), app.day_service_sessions(uuid, date), app.day_services_json(uuid, date, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.kpi_services(text, date, date, date), public.day_services(date) from public, anon, service_role;
grant execute on function public.kpi_services(text, date, date, date), public.day_services(date) to authenticated;
