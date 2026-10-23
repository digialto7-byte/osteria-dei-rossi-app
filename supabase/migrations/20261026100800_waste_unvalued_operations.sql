-- M12 review fix 2: raw_waste_costs.unvaluedCount counts OPERATIONS, not rows, and does not net across ingredients.
-- Before: rows without a cost minus their reversal rows, summed over every line, so one FEFO waste over 3 lots
-- counted 3 and the reversal of one ingredient's unpriced waste (from another period) hid another's.
-- Now: the distinct unpriced waste operations (ref_type, ref_id) with effective_on in the range that have not been
-- reversed. A reversal counts only if it is dated inside the range too (on or before p_to): that is when the
-- lines shown stop containing the waste, so the hint and the lines agree. The name and type are unchanged.
-- Everything else is the 20261026100600 body, verbatim. create or replace keeps the grants.

create or replace function public.raw_waste_costs(p_from date, p_to date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
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

  with lines as (
    select m.reason_code, m.ingredient_id, i.name as ingredient_name, i.base_unit,
           -sum(m.qty) as qty,
           case when count(m.unit_cost) = 0 then null else round(-sum(m.qty * m.unit_cost), 4) end as value_eur
      from public.stock_movement m
      join public.ingredient i on i.tenant_id = m.tenant_id and i.id = m.ingredient_id
     where m.tenant_id = v_tenant and m.type::text = 'waste' and m.effective_on between p_from and p_to
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
                and u.reverses_id is null and u.effective_on between p_from and p_to
                and not exists (select 1
                                  from public.stock_movement x
                                 where x.tenant_id = u.tenant_id and x.reverses_id = u.id
                                   and x.effective_on <= p_to)),
           'reasons', coalesce((select jsonb_agg(jsonb_build_object('reasonCode', r.reason_code,
                                    'valueEur', round(r.value_eur, 4), 'lines', r.lines)
                                  order by r.value_eur desc, r.reason_code collate "C") from reasons r), '[]'::jsonb))
    into v_result;
  return v_result;
end
$$;
