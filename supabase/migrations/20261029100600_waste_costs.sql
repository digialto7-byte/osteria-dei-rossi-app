-- M15 step 7: waste_costs, the waste report in EUR for raw stock and batches together (M15 plan §3.1.9, §3.8; AT2 value,
-- AT6; ADR-014; founder Q16 = project V6: owner and admin only).
--
-- The raw side is the unchanged public.raw_waste_costs (its lines and unvaluedCount are used as they are, so the M12
-- logic exists once). The batch side values the `waste` movements of batch_movement at read time: portions x the
-- frozen unit cost of the batch (batch_cost is append-only, so the value never moves when a price changes). A batch
-- with an incomplete cost is not valued and its operation is counted in unvaluedCount (and in its line's), but it never
-- takes the value of its complete neighbours with it: a line's value is the sum of its valued movements, null (never 0)
-- only when none is valued, and the totals add every valued movement.
-- The name contains "cost", so pgTAP 059's catalogue scan covers it (its expected list is extended in this commit).
--
--   {from, to, valueEur, rawValueEur, batchValueEur, unvaluedCount,
--    reasons: [{reasonCode, valueEur, rawValueEur, batchValueEur, lines: [raw lines],
--               batchLines: [{recipeKey, recipeName, portions, valueEur|null, unvaluedCount}]}]}
-- Reasons are ordered by valueEur desc, then reasonCode.
create function public.waste_costs(p_from date, p_to date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_raw jsonb;
  v_result jsonb;
begin
  perform app.require_cost_reader();
  v_tenant := app.tenant_id();
  -- The range rules (range_invalid, range_too_long) are the raw report's.
  v_raw := public.raw_waste_costs(p_from, p_to);

  with raw as (
    select e.value ->> 'reasonCode' as reason_code, (e.value ->> 'valueEur')::numeric as value_eur,
           e.value -> 'lines' as lines
      from jsonb_array_elements(v_raw -> 'reasons') e
  ),
  bl as (
    -- Per (reason, recipe) line. The value is the sum of the valued (complete-cost) movements only: a batch with an
    -- incomplete cost adds its portions and one unvalued operation to the line, and takes nothing from the rest. The
    -- value is null only when no movement of the line is valued.
    select m.reason_code, k.id as recipe_key, rv.name as recipe_name, sum(-m.portions) as portions,
           round(sum(-m.portions * c.unit_cost_frozen) filter (where c.unit_cost_frozen is not null), 4) as value_eur,
           count(distinct (m.ref_type, m.ref_id)) filter (where c.unit_cost_frozen is null) as unvalued_count
      from public.batch_movement m
      join public.batch b on b.tenant_id = m.tenant_id and b.id = m.batch_id
      join public.recipe_key k on k.tenant_id = b.tenant_id and k.id = b.recipe_key
      join public.recipe rv on rv.tenant_id = k.tenant_id and rv.recipe_key = k.id and rv.version = k.current_version
      left join public.batch_cost c on c.tenant_id = b.tenant_id and c.batch_id = b.id
     where m.tenant_id = v_tenant and m.type::text = 'waste' and m.effective_on between p_from and p_to
     group by m.reason_code, k.id, rv.name
    having sum(-m.portions) <> 0
  ),
  codes as (
    select r.reason_code from raw r union select b.reason_code from bl b
  ),
  per as (
    select c.reason_code,
           coalesce((select r.value_eur from raw r where r.reason_code = c.reason_code), 0) as raw_value,
           coalesce((select sum(b.value_eur) from bl b where b.reason_code = c.reason_code), 0) as batch_value,
           coalesce((select r.lines from raw r where r.reason_code = c.reason_code), '[]'::jsonb) as lines,
           coalesce((select jsonb_agg(jsonb_build_object('recipeKey', b.recipe_key, 'recipeName', b.recipe_name,
                                        'portions', round(b.portions, 4), 'valueEur', b.value_eur,
                                        'unvaluedCount', b.unvalued_count)
                                      order by b.recipe_name collate "C", b.recipe_key)
                       from bl b where b.reason_code = c.reason_code), '[]'::jsonb) as batch_lines
      from codes c
  )
  select jsonb_build_object(
           'from', p_from, 'to', p_to,
           'valueEur', round((v_raw ->> 'valueEur')::numeric + coalesce((select sum(b.value_eur) from bl b), 0), 4),
           'rawValueEur', round((v_raw ->> 'valueEur')::numeric, 4),
           'batchValueEur', round(coalesce((select sum(b.value_eur) from bl b), 0), 4),
           'unvaluedCount', (v_raw ->> 'unvaluedCount')::integer + (
             select count(distinct (u.ref_type, u.ref_id))
               from public.batch_movement u
               left join public.batch_cost c on c.tenant_id = u.tenant_id and c.batch_id = u.batch_id
              where u.tenant_id = v_tenant and u.type::text = 'waste' and u.effective_on between p_from and p_to
                and c.unit_cost_frozen is null),
           'reasons', coalesce((select jsonb_agg(jsonb_build_object(
                                  'reasonCode', p.reason_code,
                                  'valueEur', round(p.raw_value + p.batch_value, 4),
                                  'rawValueEur', round(p.raw_value, 4),
                                  'batchValueEur', round(p.batch_value, 4),
                                  'lines', p.lines, 'batchLines', p.batch_lines)
                                order by p.raw_value + p.batch_value desc, p.reason_code collate "C")
                                 from per p), '[]'::jsonb))
    into v_result;
  return v_result;
end
$$;

revoke all on function public.waste_costs(date, date) from public, anon, authenticated, service_role;
grant execute on function public.waste_costs(date, date) to authenticated;
