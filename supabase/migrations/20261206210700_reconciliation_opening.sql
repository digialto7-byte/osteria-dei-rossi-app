-- Opening stock, step 11 (docs/plans/2026-11-18-opening-stock.md §3.8, §5 step 11): the reconciliation folds the carico into the opening quantity by its date.
--
-- public.stock_reconciliation is re-created from 20261127100000 with two changes in the `z` subquery, nothing else:
--   * before_period: an `opening` row is always before the period (receipts: effective_on < p_from; every other type: created_at before the period's first business instant);
--   * the row filter: `receipt` and `opening` rows are read by effective_on <= p_to (every other type by created_at, as ADR-033 requires).
-- An opening dated on or before p_to is part of openingQty ("the stock the venue started with", spec §4), never receiptsQty and never otherQty. Its mirror rows carry the
-- original's date (step 9), so they fold the same way and a correction nets inside the carico's period. balanced still holds by construction (the closing quantity sums the same
-- rows). The JSON keys are unchanged, so the TS schema, the CSV export and the screen need no change. A period with no opening row reads exactly as before.
-- Every other report keeps ADR-033's created_at rule; O2 keeps opening rows before the location's first closed count, so the AVT never sees one.
-- The comment of stock_movement.effective_on says how opening rows are read.

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
  -- A5b: a movement counts on the business day of created_at: [start of p_from's business day, end of p_to's), computed once. Receipts keep the invoice date (effective_on, founder M5 Q1);
  -- opening rows (and their mirrors) are read by effective_on too, and fold into the opening quantity (opening stock, step 11).
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
                   -- opening stock (step 11): an opening row and its mirrors are the stock the venue started with, so they are always opening stock of a period that
                   -- reaches their date (filter below), never a receipt and never "other"
                   case when m.type::text = 'receipt' then m.effective_on < p_from
                        when m.type::text = 'opening' then true
                        else m.created_at < v_lo end as before_period
              from public.stock_movement m
             where m.tenant_id = v_tenant and m.location_id = v_loc
               and case when m.type::text in ('receipt', 'opening') then m.effective_on <= p_to else m.created_at < v_hi end) z
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

comment on column public.stock_movement.effective_on is
  'Receipt and opening: the date the reports read (receipts: the invoice date, read by stock_reconciliation and app.kpi_purchases; opening rows and their mirrors: the "Data del carico", read by stock_reconciliation). Every other type: the calendar date (venue time zone) of the write, not read by reports, which count those rows by the business day of created_at (app.business_day_start, app.kpi_cutoff_end). Writers must leave created_at at now().';
