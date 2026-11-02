-- Founder decision A5, extended to RAW waste by the lead (docs/plans/2026-11-02-a5-business-date-discards.md): raw waste counts on the BUSINESS day, so public.waste_costs never mixes a
-- calendar-dated raw part with the business-dated batch part.
--   public.raw_waste_costs   the waste rows (lines, valueEur and unvaluedCount) are filtered by created_at over [app.business_day_start(from), app.kpi_cutoff_end(to)), the technique of
--                            20261117100000. A reversal is dated when it is posted (its created_at), as before. No UPDATE, no backfill: rows already stored with the calendar effective_on
--                            count like new ones. Everything else is the 20261026100800 body, verbatim (role check first, range rules, SECURITY DEFINER, search_path '').
-- Why created_at is the event time of every waste row: post_waste (app.run_stock_outflow, now()), app.confirm_staff_meal_core (post_stock_outflow; its p_at only feeds effective_on),
-- public.void_line's raw half and the reversal rows of reverse_movement all leave created_at at its default now(); no writer takes a date or a client time for a waste row.
-- Index: stock_movement_tenant_at_idx (tenant_id, created_at desc, id desc) from the count tables already serves the (tenant_id, created_at) range; pgTAP 206 pins that, so no new index.
-- Not changed here (follow-up PR, see the plan): receipts, counts, transfers, void_line's consumption half, staff-meal raw halves, stock_reconciliation, AVT, app.kpi_purchases, the rules helpers.

create or replace function public.raw_waste_costs(p_from date, p_to date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_lo timestamptz;
  v_hi timestamptz;
  v_result jsonb;
begin
  perform app.require_cost_reader();
  v_tenant := app.tenant_id();
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'range_invalid' using errcode = 'P0001';
  end if;
  if p_to - p_from + 1 > 366 then
    raise exception 'range_too_long' using errcode = 'P0001';
  end if;
  -- A5: the rows count on the business day of created_at: [start of p_from's business day, end of p_to's), computed once.
  v_lo := app.business_day_start(v_tenant, p_from);
  v_hi := app.kpi_cutoff_end(v_tenant, p_to);

  with lines as (
    select m.reason_code, m.ingredient_id, i.name as ingredient_name, i.base_unit,
           -sum(m.qty) as qty,
           case when count(m.unit_cost) = 0 then null else round(-sum(m.qty * m.unit_cost), 4) end as value_eur
      from public.stock_movement m
      join public.ingredient i on i.tenant_id = m.tenant_id and i.id = m.ingredient_id
     where m.tenant_id = v_tenant and m.type::text = 'waste' and m.created_at >= v_lo and m.created_at < v_hi
     group by m.reason_code, m.ingredient_id, i.name, i.base_unit
    having sum(m.qty) <> 0
  ),
  reasons as (
    select l.reason_code, coalesce(sum(l.value_eur), 0) as value_eur,
           jsonb_agg(jsonb_build_object('ingredientId', l.ingredient_id, 'ingredientName', l.ingredient_name,
                                        'baseUnit', l.base_unit::text, 'qty', round(l.qty, 4), 'valueEur', l.value_eur)
                     order by l.ingredient_name collate "C", l.ingredient_id) as lines
      from lines l
     group by l.reason_code
  )
  select jsonb_build_object(
           'from', p_from, 'to', p_to,
           'valueEur', round(coalesce((select sum(r.value_eur) from reasons r), 0), 4),
           'unvaluedCount', (
             select count(distinct (u.ref_type, u.ref_id))
               from public.stock_movement u
              where u.tenant_id = v_tenant and u.type::text = 'waste' and u.unit_cost is null
                and u.reverses_id is null and u.created_at >= v_lo and u.created_at < v_hi
                and not exists (select 1
                                  from public.stock_movement x
                                 where x.tenant_id = u.tenant_id and x.reverses_id = u.id
                                   and x.created_at < v_hi)),
           'reasons', coalesce((select jsonb_agg(jsonb_build_object('reasonCode', r.reason_code,
                                    'valueEur', round(r.value_eur, 4), 'lines', r.lines)
                                  order by r.value_eur desc, r.reason_code collate "C") from reasons r), '[]'::jsonb))
    into v_result;
  return v_result;
end
$$;

-- Grants restated (create or replace keeps them; this makes the migration self-contained).
revoke all on function public.raw_waste_costs(date, date) from public, anon, authenticated, service_role;
grant execute on function public.raw_waste_costs(date, date) to authenticated;
