-- M23 step 4 (docs/plans/2026-10-31-m23-push-forecast.md §3.1.4, §3.2; PRD 4.4; Q162-Q164): the MVP forecast. For a date D (today .. today + 6) the same weekday of the last four weeks
-- (D - 7 .. D - 28), from the lines of CLOSED tables by closed_business_date (the KPI source, so the figures agree with the reports). Nothing is stored.
--
--   app.forecast_weeks()/forecast_days_ahead()  4 (PRD 4.4) and 6: named constants (the TS twins are read by a parity test).
--   app.forecast_portion_lines(tenant, dates)   per business date and batch key, the portions the plates SOLD drew: qty x recipe_line.qty / yield_factor for each batch line of
--                                               the plate version of the line (order_line_cost.recipe_id), with the filters of app.kpi_sales_lines (closed table, not voided).
--   app.forecast_json(tenant, role, date, now)  open weeks = source dates with at least one closed table; the divisor is their count (Q162); with none every expected value is
--                                               null. On hand = app.live_batch_remaining at now (even for a later D). covers only for owner and admin (Q163).
--                                               Rows: active batch recipes with expected > 0 or portions on hand, by gap desc (nulls last), name, key. Plates: mapped lines,
--                                               expected > 0, by plates desc, name, id. P0001 date_out_of_range outside today .. today + 6.
--   public.forecast(date)                       owner, admin, chef (app.require_push_reader first); the role shaping the JSON is the session's.

create function app.forecast_weeks() returns integer language sql immutable set search_path = '' as $$ select 4 $$;
create function app.forecast_days_ahead() returns integer language sql immutable set search_path = '' as $$ select 6 $$;

create function app.forecast_portion_lines(p_tenant uuid, p_dates date[]) returns table (business_date date, batch_key uuid, portions numeric)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select s.closed_business_date, rl.sub_recipe_key, sum(l.qty * rl.qty / rl.yield_factor)
    from public.table_session s
    join public.order_line l on l.tenant_id = s.tenant_id and l.table_session_id = s.id
    join public.order_line_cost c on c.tenant_id = l.tenant_id and c.order_line_id = l.id and c.recipe_id is not null
    join public.recipe_line rl on rl.tenant_id = c.tenant_id and rl.recipe_id = c.recipe_id and rl.sub_recipe_key is not null
    join public.recipe_key bk on bk.tenant_id = rl.tenant_id and bk.id = rl.sub_recipe_key and bk.type::text = 'batch'
   where s.tenant_id = p_tenant and s.closed_at is not null
     and s.closed_business_date = any (p_dates)
     and l.voided_at is null
   group by s.closed_business_date, rl.sub_recipe_key
$$;

create function app.forecast_json(p_tenant uuid, p_role text, p_date date, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_today date := app.business_date(p_tenant, p_now);
  v_date date;
  v_sources date[];
  v_weeks integer;
  v_covers numeric;
  v_batches jsonb;
  v_plates jsonb;
  v_result jsonb;
begin
  v_date := coalesce(p_date, v_today);
  if v_date < v_today or v_date > v_today + app.forecast_days_ahead() then
    raise exception 'date_out_of_range' using errcode = 'P0001';
  end if;
  v_sources := array(select v_date - 7 * g from generate_series(1, app.forecast_weeks()) g order by g);

  select count(distinct x.business_date)::integer, coalesce(sum(x.covers), 0)
    into v_weeks, v_covers
    from app.kpi_session_rows(p_tenant, v_date - 7 * app.forecast_weeks(), v_date - 7) x
   where x.business_date = any (v_sources);

  with src as (
    select * from app.forecast_portion_lines(p_tenant, v_sources)
  ), keys as (
    select k.id as batch_key, rv.name
      from public.recipe_key k
      join public.recipe rv on rv.tenant_id = k.tenant_id and rv.recipe_key = k.id and rv.version = k.current_version
     where k.tenant_id = p_tenant and k.type::text = 'batch' and k.is_active
  ), hand as (
    select h.batch_key, h.remaining from app.live_batch_remaining(p_tenant, array(select kk.batch_key from keys kk), p_now) h
  ), rws as (
    select kk.batch_key, kk.name,
           case when v_weeks > 0 then round(coalesce((select sum(s.portions) from src s where s.batch_key = kk.batch_key), 0) / v_weeks, 2) end as expected,
           coalesce(h.remaining, 0) as on_hand
      from keys kk
      left join hand h on h.batch_key = kk.batch_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'recipeKey', r.batch_key, 'name', r.name, 'expectedPortions', r.expected, 'onHandPortions', trim_scale(r.on_hand),
           'gap', case when r.expected is not null then r.expected - r.on_hand end)
         order by case when r.expected is not null then r.expected - r.on_hand end desc nulls last, r.name collate "C", r.batch_key), '[]'::jsonb)
    into v_batches
    from rws r
   where coalesce(r.expected, 0) > 0 or r.on_hand > 0;

  select coalesce(jsonb_agg(jsonb_build_object('menuItemId', q.menu_item_id, 'name', q.item_name, 'expectedPlates', q.expected)
                            order by q.expected desc, q.item_name collate "C", q.menu_item_id), '[]'::jsonb)
    into v_plates
    from (select k.menu_item_id, min(k.item_name) as item_name, round(sum(k.qty) / v_weeks, 2) as expected
            from app.kpi_sales_lines(p_tenant, v_date - 7 * app.forecast_weeks(), v_date - 7) k
           where v_weeks > 0 and k.mapped and k.business_date = any (v_sources)
           group by k.menu_item_id) q
   where q.expected > 0;

  v_result := jsonb_build_object(
    'role', p_role, 'date', v_date, 'today', v_today, 'tomorrow', v_today + 1, 'weekday', extract(isodow from v_date)::integer,
    'sourceDates', to_jsonb(v_sources), 'weeksUsed', v_weeks, 'batches', v_batches, 'plates', v_plates);
  if p_role in ('owner', 'admin') then
    v_result := v_result || jsonb_build_object('covers', jsonb_build_object('expected', case when v_weeks > 0 then round(v_covers / v_weeks, 2) end));
  end if;
  return v_result;
end
$$;

create function public.forecast(p_date date default null) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_push_reader();
  return app.forecast_json(app.tenant_id(), app.role()::text, p_date, clock_timestamp());
end
$$;

revoke all on function app.forecast_weeks(), app.forecast_days_ahead(), app.forecast_portion_lines(uuid, date[]), app.forecast_json(uuid, text, date, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.forecast(date) from public, anon, authenticated, service_role;
grant execute on function public.forecast(date) to authenticated;
