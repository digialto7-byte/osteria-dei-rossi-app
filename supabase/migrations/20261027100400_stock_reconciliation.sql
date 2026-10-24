-- M13 step 5: the reconciliation report (M13 plan §3.1.9; PRD Module 2 acceptance). For one location and a period:
--   opening + receipts - consumption - waste + transfers in - transfers out + count adjustments (+ other) = closing
-- computed as a fold of the movement ledger by type and by effective_on, so it holds by construction. Alongside, the
-- latest closed count of each ingredient in the period, and whether anything was recorded after it (the PRD's
-- "= counted" holds when matchesCount is true). Quantities only; owner, admin and chef. A movement type this report
-- does not classify lands in otherQty, which the screen shows (the guard for future types).

create function public.stock_reconciliation(p_from date, p_to date, p_location uuid default null) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_loc uuid;
  v_name text;
  v_tz text;
  v_items jsonb;
begin
  perform app.require_stock_reader();
  v_tenant := app.tenant_id();
  if p_from is null or p_to is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_from > p_to then
    raise exception 'range_invalid' using errcode = 'P0001';
  end if;
  if p_to - p_from + 1 > 366 then
    raise exception 'range_too_long' using errcode = 'P0001';
  end if;
  v_loc := app.resolve_location(v_tenant, p_location);
  select x.name into v_name from public.location x where x.tenant_id = v_tenant and x.id = v_loc;
  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;

  with mv as (
    select m.ingredient_id,
           coalesce(sum(m.qty) filter (where m.effective_on < p_from), 0) as opening,
           coalesce(sum(m.qty) filter (where m.effective_on >= p_from and m.type::text = 'receipt'), 0) as receipts,
           coalesce(-sum(m.qty) filter (where m.effective_on >= p_from and m.type::text = 'consumption'), 0) as consumption,
           coalesce(-sum(m.qty) filter (where m.effective_on >= p_from and m.type::text = 'waste'), 0) as waste,
           coalesce(sum(m.qty) filter (where m.effective_on >= p_from and m.type::text = 'transfer' and m.qty > 0), 0) as t_in,
           coalesce(-sum(m.qty) filter (where m.effective_on >= p_from and m.type::text = 'transfer' and m.qty < 0), 0) as t_out,
           coalesce(sum(m.qty) filter (where m.effective_on >= p_from and m.type::text = 'count'), 0) as adj,
           coalesce(sum(m.qty) filter (where m.effective_on >= p_from
                                         and m.type::text not in ('receipt', 'consumption', 'waste', 'transfer', 'count')), 0) as other,
           sum(m.qty) as closing
      from public.stock_movement m
     where m.tenant_id = v_tenant and m.location_id = v_loc and m.effective_on <= p_to
     group by m.ingredient_id),
  cnt as (
    select distinct on (l.ingredient_id) l.ingredient_id, l.counted_qty, l.entered_at, s.id as session_id
      from public.count_line l
      join public.count_session s on s.tenant_id = l.tenant_id and s.id = l.session_id
     where l.tenant_id = v_tenant and s.location_id = v_loc and s.status = 'closed' and l.counted_qty is not null
       and app.venue_date(s.closed_at, v_tz) between p_from and p_to
     order by l.ingredient_id, s.closed_at desc, s.id desc),
  ids as (select mv.ingredient_id from mv union select cnt.ingredient_id from cnt),
  rows_ as (
    select i.name, i.id, i.base_unit,
           coalesce(mv.opening, 0) as opening, coalesce(mv.receipts, 0) as receipts,
           coalesce(mv.consumption, 0) as consumption, coalesce(mv.waste, 0) as waste,
           coalesce(mv.t_in, 0) as t_in, coalesce(mv.t_out, 0) as t_out, coalesce(mv.adj, 0) as adj,
           coalesce(mv.other, 0) as other, coalesce(mv.closing, 0) as closing,
           cnt.counted_qty, cnt.entered_at, cnt.session_id
      from ids
      join public.ingredient i on i.tenant_id = v_tenant and i.id = ids.ingredient_id
      left join mv on mv.ingredient_id = ids.ingredient_id
      left join cnt on cnt.ingredient_id = ids.ingredient_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredientId', r.id, 'name', r.name, 'baseUnit', r.base_unit::text,
           'openingQty', r.opening, 'receiptsQty', r.receipts, 'consumptionQty', r.consumption, 'wasteQty', r.waste,
           'transfersInQty', r.t_in, 'transfersOutQty', r.t_out, 'countAdjustmentsQty', r.adj, 'otherQty', r.other,
           'closingQty', r.closing,
           'balanced', r.opening + r.receipts - r.consumption - r.waste + r.t_in - r.t_out + r.adj + r.other = r.closing,
           'countedQty', r.counted_qty, 'countedAt', r.entered_at, 'countSessionId', r.session_id,
           'afterCountQty', r.closing - r.counted_qty,
           'matchesCount', case when r.counted_qty is null then null else r.closing - r.counted_qty = 0 end)
         order by r.name collate "C", r.id), '[]'::jsonb)
    into v_items
    from rows_ r;

  return jsonb_build_object('from', p_from, 'to', p_to,
                            'location', jsonb_build_object('id', v_loc, 'name', v_name), 'items', v_items);
end
$$;

revoke all on function public.stock_reconciliation(date, date, uuid) from public, anon, authenticated, service_role;
grant execute on function public.stock_reconciliation(date, date, uuid) to authenticated;
