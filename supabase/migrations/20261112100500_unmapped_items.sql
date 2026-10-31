-- M22 step 6 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.2; ADR-025; AT5): the items sold without a recipe in an ISO week.
--
--   app.unmapped_items_json(tenant, week, now)   the lines of the sessions closed in the week (by closed_business_date, so the week edge follows the cut-off) whose
--                                                frozen order_line_cost.recipe_id is null, i.e. unmapped AT SALE: an item mapped later is still listed for the week it
--                                                was sold without a recipe. A line voided after firing is not sold and is not here. Rows by plates descending, then name.
--                                                p_week is any date of the ISO week; null is the week of p_now's business date; a date after that business date is refused
--                                                (P0001 date_in_future).
--   public.unmapped_items(p_week)                the wrapper: owner and admin only, checked first.

create function app.unmapped_items_json(p_tenant uuid, p_week date, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_today date := app.business_date(p_tenant, p_now);
  v_d date := coalesce(p_week, v_today);
  v_from date;
  v_to date;
  v_rows jsonb;
  v_totals jsonb;
begin
  if v_d > v_today then
    raise exception 'date_in_future' using errcode = 'P0001';
  end if;
  v_from := v_d - (extract(isodow from v_d)::integer - 1);
  v_to := v_from + 6;
  with u as (
    select l.menu_item_id, min(l.item_name) as name, sum(l.qty) as plates, sum(l.gross) as gross, max(l.business_date) as last_on
      from app.kpi_sales_lines(p_tenant, v_from, v_to) l
     where not l.mapped
     group by l.menu_item_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('menuItemId', u.menu_item_id, 'name', u.name, 'plates', u.plates, 'revenueGrossEur', u.gross, 'lastSoldOn', u.last_on)
                            order by u.plates desc, u.name collate "C", u.menu_item_id), '[]'::jsonb),
         jsonb_build_object('plates', coalesce(sum(u.plates), 0), 'revenueGrossEur', coalesce(sum(u.gross), 0))
    into v_rows, v_totals
    from u;
  return jsonb_build_object('weekFrom', v_from, 'weekTo', v_to, 'rows', v_rows, 'totals', v_totals);
end
$$;

create function public.unmapped_items(p_week date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.unmapped_items_json(app.tenant_id(), p_week, now());
end
$$;

revoke all on function app.unmapped_items_json(uuid, date, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.unmapped_items(date) from public, anon, authenticated, service_role;
grant execute on function public.unmapped_items(date) to authenticated;
