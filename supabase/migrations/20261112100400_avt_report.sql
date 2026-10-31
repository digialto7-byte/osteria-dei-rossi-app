-- M22 step 5 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.1.6, §3.2; ADR-025; AT4): actual against theoretical consumption, in EUR, between two closed
-- monthly counts of one location (PRD Feature 1: what the count says disappeared minus what the recipes say).
--
--   Window: the movements of the location with created_at > O.closed_at and <= C.closed_at, where C is the closing count and O the previous closed monthly count of the same
--   location (by closed_at, then id). Count rows are chosen by reference as well: C's rows are in, O's rows are out whatever their created_at (T2).
--   Actual (counted) = minus the sum of the window's movements of every type except receipt and transfer. Because each count adjustment brings the ledger to the counted
--   quantity, this equals counted(O) + receipts + transfers in - transfers out - counted(C). Recorded waste is part of it and is also shown as wasteQty (Q149).
--   Theoretical (recipe) = (a) the batches produced in the window whose input movements are at the location: app.batch_requirements(recipe, produced_at) x output made /
--   recipe output (T1: the requirement is per ONE batch of the recipe, and the proposal of the batch screen scales it the same way), plus (b) the plate raw booked at fire
--   (consumption with ref_type order_line), net of its reversal (order_void): the raw of a line voided after firing is not theoretical, it became waste.
--   Only stock ingredients counted in BOTH counts are listed; those counted in one only are counted in notCountedCount.
--   varianceQty = actual - theoretical (positive: more disappeared than the recipes say); varianceEur = varianceQty x unit cost at C.closed_at, null when the cost is unknown.
-- public.avt_report: owner and admin (checked first). p_count null = the latest closed monthly count of the tenant.
-- Errors: P0002 count_not_found (also another tenant's count, and no monthly count at all for null); P0001 avt_count_not_monthly, avt_count_not_closed, avt_no_opening_count.

create function app.avt_available_counts() returns integer
  language sql immutable
  set search_path = ''
as $$ select 12 $$;

create function app.avt_rows(p_tenant uuid, p_open uuid, p_close uuid)
  returns table (ingredient_id uuid, name text, base_unit text, actual_qty numeric, theoretical_qty numeric, waste_qty numeric, variance_qty numeric,
                 unit_cost numeric, variance_eur numeric)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_o public.count_session;
  v_c public.count_session;
begin
  select x.* into v_o from public.count_session x where x.tenant_id = p_tenant and x.id = p_open;
  select x.* into v_c from public.count_session x where x.tenant_id = p_tenant and x.id = p_close;
  return query
  with listed as (
    select co.ingredient_id as ing
      from public.count_line co
      join public.count_line cc on cc.tenant_id = co.tenant_id and cc.ingredient_id = co.ingredient_id and cc.session_id = v_c.id
      join public.ingredient i on i.tenant_id = co.tenant_id and i.id = co.ingredient_id and i.is_stock
     where co.tenant_id = p_tenant and co.session_id = v_o.id and co.counted_qty is not null and cc.counted_qty is not null
  ),
  win as (
    select m.ingredient_id as ing, m.type::text as t, m.qty, m.ref_type
      from public.stock_movement m
     where m.tenant_id = p_tenant and m.location_id = v_c.location_id
       and m.ingredient_id in (select l.ing from listed l)
       and ((m.created_at > v_o.closed_at and m.created_at <= v_c.closed_at
             and not (m.type::text = 'count' and m.ref_type = 'count_session' and m.ref_id = v_o.id))
            or (m.type::text = 'count' and m.ref_type = 'count_session' and m.ref_id = v_c.id))
  ),
  agg as (
    select w.ing,
           coalesce(-sum(w.qty) filter (where w.t not in ('receipt', 'transfer')), 0) as act,
           coalesce(-sum(w.qty) filter (where w.t = 'waste'), 0) as wst,
           coalesce(-sum(w.qty) filter (where w.t = 'consumption' and w.ref_type in ('order_line', 'order_void')), 0) as plate
      from win w
     group by w.ing
  ),
  bt as (
    select q.ingredient_id as ing, sum(q.qty_per_batch * b.output_qty / r.output_qty) as qty
      from public.batch b
      join public.recipe r on r.tenant_id = b.tenant_id and r.id = b.recipe_id
     cross join lateral app.batch_requirements(p_tenant, b.recipe_id, b.produced_at) q
     where b.tenant_id = p_tenant and b.produced_at > v_o.closed_at and b.produced_at <= v_c.closed_at
       and q.ingredient_id in (select l.ing from listed l)
       and exists (select 1 from public.batch_input bi
                    where bi.tenant_id = b.tenant_id and bi.batch_id = b.id and bi.ingredient_id = q.ingredient_id and bi.location_id = v_c.location_id)
     group by q.ingredient_id
  ),
  costs as (
    select k.ingredient_id as ing, k.unit_cost
      from app.ingredient_unit_costs(p_tenant, (select array_agg(l.ing) from listed l), v_c.closed_at) k
  ),
  rows as (
    select l.ing, i.name as nm, i.base_unit::text as bu,
           coalesce(a.act, 0) as act, coalesce(a.plate, 0) + coalesce(t.qty, 0) as theo, coalesce(a.wst, 0) as wst,
           k.unit_cost as uc
      from listed l
      join public.ingredient i on i.tenant_id = p_tenant and i.id = l.ing
      left join agg a on a.ing = l.ing
      left join bt t on t.ing = l.ing
      left join costs k on k.ing = l.ing
  )
  select r.ing, r.nm, r.bu, round(r.act, 4), round(r.theo, 4), round(r.wst, 4), round(r.act - r.theo, 4), r.uc,
         case when r.uc is null then null else round((r.act - r.theo) * r.uc, 4) end
    from rows r;
end
$$;

create function public.avt_report(p_count uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_c public.count_session;
  v_o public.count_session;
  v_rows jsonb;
  v_totals jsonb;
  v_not_counted integer;
  v_avail jsonb;
begin
  perform app.require_day_closer();
  v_tenant := app.tenant_id();
  if p_count is null then
    select x.* into v_c from public.count_session x
     where x.tenant_id = v_tenant and x.type = 'monthly' and x.status = 'closed'
     order by x.closed_at desc, x.id desc limit 1;
  else
    select x.* into v_c from public.count_session x where x.tenant_id = v_tenant and x.id = p_count;
  end if;
  if not found then
    raise exception 'count_not_found' using errcode = 'P0002';
  end if;
  if v_c.type <> 'monthly' then
    raise exception 'avt_count_not_monthly' using errcode = 'P0001';
  end if;
  if v_c.status <> 'closed' then
    raise exception 'avt_count_not_closed' using errcode = 'P0001';
  end if;
  select x.* into v_o from public.count_session x
   where x.tenant_id = v_tenant and x.location_id = v_c.location_id and x.type = 'monthly' and x.status = 'closed'
     and (x.closed_at, x.id) < (v_c.closed_at, v_c.id)
   order by x.closed_at desc, x.id desc limit 1;
  if not found then
    raise exception 'avt_no_opening_count' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredientId', r.ingredient_id, 'name', r.name, 'baseUnit', r.base_unit, 'actualQty', r.actual_qty, 'theoreticalQty', r.theoretical_qty,
           'wasteQty', r.waste_qty, 'varianceQty', r.variance_qty, 'unitCostEur', round(r.unit_cost, 4), 'varianceEur', r.variance_eur)
           order by abs(r.variance_eur) desc nulls last, r.name collate "C", r.ingredient_id), '[]'::jsonb),
         jsonb_build_object('varianceEur', coalesce(sum(r.variance_eur), 0),
                            'lossEur', coalesce(sum(r.variance_eur) filter (where r.variance_eur > 0), 0),
                            'gainEur', coalesce(-sum(r.variance_eur) filter (where r.variance_eur < 0), 0),
                            'unvaluedCount', count(*) filter (where r.variance_eur is null))
    into v_rows, v_totals
    from app.avt_rows(v_tenant, v_o.id, v_c.id) r;

  -- Counted in one of the two counts only.
  select count(*)::integer into v_not_counted
    from (select l.ingredient_id
            from public.count_line l
            join public.ingredient i on i.tenant_id = l.tenant_id and i.id = l.ingredient_id and i.is_stock
           where l.tenant_id = v_tenant and l.session_id in (v_o.id, v_c.id) and l.counted_qty is not null
           group by l.ingredient_id having count(*) = 1) x;

  select coalesce(jsonb_agg(jsonb_build_object('id', z.id, 'closedAt', z.closed_at, 'locationName', z.name) order by z.closed_at desc, z.id desc), '[]'::jsonb)
    into v_avail
    from (select s.id, s.closed_at, loc.name
            from public.count_session s
            join public.location loc on loc.tenant_id = s.tenant_id and loc.id = s.location_id
           where s.tenant_id = v_tenant and s.type = 'monthly' and s.status = 'closed'
           order by s.closed_at desc, s.id desc limit app.avt_available_counts()) z;

  return jsonb_build_object(
    'count', (select jsonb_build_object('id', v_c.id, 'closedAt', v_c.closed_at, 'locationName', loc.name)
                from public.location loc where loc.tenant_id = v_tenant and loc.id = v_c.location_id),
    'openingCount', jsonb_build_object('id', v_o.id, 'closedAt', v_o.closed_at),
    'locationsActive', (select count(*) from public.location x where x.tenant_id = v_tenant and x.is_active),
    'rows', v_rows,
    'totals', v_totals || jsonb_build_object('notCountedCount', v_not_counted),
    'availableCounts', v_avail);
end
$$;

revoke all on function app.avt_available_counts(), app.avt_rows(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.avt_report(uuid) from public, anon, authenticated, service_role;
grant execute on function public.avt_report(uuid) to authenticated;
