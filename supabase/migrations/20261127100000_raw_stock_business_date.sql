-- A5b (docs/plans/2026-11-08-a5b-raw-stock-business-date.md, ADR-033): raw stock is dated by the BUSINESS day (cut-off from tenant settings, 02:00 by default), like the batch side and raw
-- waste since A5. Option (b): the readers derive the business day from stock_movement.created_at over [app.business_day_start(D), app.kpi_cutoff_end(D)); no UPDATE, no backfill (the ledger
-- refuses it), so rows already stored with the calendar effective_on count like new ones. Receipts keep the invoice date in effective_on (founder M5 Q1) and are read by it.
-- Writers do not change: every one leaves created_at at now() (pgTAP 259 G1 guards that).
--   public.stock_reconciliation   the 20261027100400 body with the dates changed: movements by the business day of created_at (receipts by effective_on); the period's counts by closed_at over the
--                                 same range (a count closed at 01:45 writes its count rows at 01:45, so both land on the same day). Everything else is unchanged: role check first, range rules,
--                                 quantities only, SECURITY DEFINER, search_path '', grants restated.
--   app.weekday_consumption       the 20261030100100 body with the dates changed (used only by app.purchase_rule): the 14 days p_today - 14 .. p_today - 1 are 14 business-day instant ranges, a
--                                 consumption counts on the business day of its created_at, a reversal on its original's. p_today stays what app.purchase_rule passes (the calendar alert date,
--                                 Q109; plan Q-A5b-2). Same signature and shape, divisor 2, closed to every API role.

create or replace function public.stock_reconciliation(p_from date, p_to date, p_location uuid default null) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_loc uuid;
  v_name text;
  v_lo timestamptz;
  v_hi timestamptz;
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
  -- A5b: a movement counts on the business day of created_at: [start of p_from's business day, end of p_to's), computed once. Receipts keep the invoice date (effective_on, founder M5 Q1).
  v_lo := app.business_day_start(v_tenant, p_from);
  v_hi := app.kpi_cutoff_end(v_tenant, p_to);

  with mv as (
    select z.ingredient_id,
           coalesce(sum(z.qty) filter (where z.before_period), 0) as opening,
           coalesce(sum(z.qty) filter (where not z.before_period and z.type = 'receipt'), 0) as receipts,
           coalesce(-sum(z.qty) filter (where not z.before_period and z.type = 'consumption'), 0) as consumption,
           coalesce(-sum(z.qty) filter (where not z.before_period and z.type = 'waste'), 0) as waste,
           coalesce(sum(z.qty) filter (where not z.before_period and z.type = 'transfer' and z.qty > 0), 0) as t_in,
           coalesce(-sum(z.qty) filter (where not z.before_period and z.type = 'transfer' and z.qty < 0), 0) as t_out,
           coalesce(sum(z.qty) filter (where not z.before_period and z.type = 'count'), 0) as adj,
           coalesce(sum(z.qty) filter (where not z.before_period
                                         and z.type not in ('receipt', 'consumption', 'waste', 'transfer', 'count')), 0) as other,
           sum(z.qty) as closing
      from (select m.ingredient_id, m.qty, m.type::text as type,
                   case when m.type::text = 'receipt' then m.effective_on < p_from else m.created_at < v_lo end as before_period
              from public.stock_movement m
             where m.tenant_id = v_tenant and m.location_id = v_loc
               and case when m.type::text = 'receipt' then m.effective_on <= p_to else m.created_at < v_hi end) z
     group by z.ingredient_id),
  cnt as (
    select distinct on (l.ingredient_id) l.ingredient_id, l.counted_qty, l.entered_at, s.id as session_id
      from public.count_line l
      join public.count_session s on s.tenant_id = l.tenant_id and s.id = l.session_id
     where l.tenant_id = v_tenant and s.location_id = v_loc and s.status = 'closed' and l.counted_qty is not null
       and s.closed_at >= v_lo and s.closed_at < v_hi
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

-- The trailing-14-day weekday average of consumption (M16 plan §3.1.5), on business days. The window is the 14 business days before p_today, so each ISO weekday occurs twice and the divisor is
-- always 2. Each day is the instant range [business_day_start, kpi_cutoff_end) (28 helper calls per call, none per row); a row counts on the day whose range holds created_at, a reversal on its
-- original's created_at. Waste, counts, transfers and receipts are not consumption. Rows only where the average is not zero.
create or replace function app.weekday_consumption(p_tenant uuid, p_today date)
  returns table (ingredient_id uuid, isodow integer, avg_qty numeric)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with days as (
    select p_today - k as d, app.business_day_start(p_tenant, p_today - k) as lo, app.kpi_cutoff_end(p_tenant, p_today - k) as hi
      from generate_series(1, 14) k)
  select c.ingredient_id, extract(isodow from c.d)::integer, sum(c.q) / 2
    from (select m.ingredient_id, y.d, -m.qty as q
            from public.stock_movement m
            left join public.stock_movement o on o.tenant_id = p_tenant and o.id = m.reverses_id
            join days y on coalesce(o.created_at, m.created_at) >= y.lo and coalesce(o.created_at, m.created_at) < y.hi
           where m.tenant_id = p_tenant and m.type = 'consumption'
             and m.created_at >= (select min(z.lo) from days z)) c
   group by c.ingredient_id, extract(isodow from c.d)
  having sum(c.q) <> 0
$$;

-- Closed to every API role (restated: create or replace keeps it, this makes the migration self-contained).
revoke all on function app.weekday_consumption(uuid, date) from public, anon, authenticated, service_role;
