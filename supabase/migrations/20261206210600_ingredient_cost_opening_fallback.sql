-- Opening stock, step 10 (docs/plans/2026-11-18-opening-stock.md §3.7, §5 step 10): the cost fallback.
--
-- app.ingredient_unit_costs is re-created with the SAME signature and return columns, and the body of 20261023110100 with one more lateral, `op`: the unit cost of the latest
-- non-reversed `opening` movement of the ingredient in force (effective_on <= the venue date of p_at, the rule of price_history; latest by effective_on, then created_at, then id,
-- across the tenant's locations: Q13). unit_cost takes it ONLY when no price_history row is in force (w.used = 0): from the first invoice price in force the basis value is
-- used as before, and the opening cost is ignored entirely (O3: never averaged). avg_cost, last_cost, max_cost, purchases_used and last_purchase_on still describe purchases
-- only. A reversed opening row never counts, even for an as-of date before its reversal; frozen costs are stored rows and never recomputed (R8).
-- After this migration a non-null unit_cost with zero purchases can only come from an opening row, which is how costSource (invoice | opening | null) is derived (step 16).
-- Callers inherit it without a change: post_stock_outflow's cost stamp, count_close, recipe_costs and recipe_cost_lines, the sale freeze (through the consumption rows),
-- avt_rows and public.ingredient_costs. Non-stock ingredients can never have an opening row.

create or replace function app.ingredient_unit_costs(p_tenant uuid, p_ids uuid[], p_at timestamptz)
  returns table (ingredient_id uuid, base_unit public.base_unit, basis public.cost_basis,
                 unit_cost numeric, avg_cost numeric, last_cost numeric, max_cost numeric,
                 purchases_used integer, last_purchase_on date)
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_n integer;
  v_tz text;
  v_date date;
begin
  select s.avg_cost_n into v_n from app.cost_settings(p_tenant) s; -- P0002 for an unknown tenant
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  v_date := case when p_at is null then null else app.venue_date(p_at, v_tz) end;

  return query
  select i.id, i.base_unit, bs.basis,
         case when w.used > 0 then (case when bs.basis = 'last_price' then w.last_price else w.avg_price end)
              else op.opening_cost end,
         w.avg_price, w.last_price, mx.max_price, w.used::integer, w.last_on
    from public.ingredient i
   cross join lateral (
      select coalesce((select b.basis
                         from public.ingredient_cost_basis b
                        where b.tenant_id = p_tenant and b.ingredient_id = i.id
                          and (p_at is null or b.valid_from <= p_at)
                        order by b.valid_from desc
                        limit 1), 'moving_average'::public.cost_basis) as basis
   ) bs
   cross join lateral (
      select avg(x.unit_price) as avg_price,
             count(*) as used,
             (array_agg(x.unit_price order by x.effective_on desc, x.seq desc))[1] as last_price,
             max(x.effective_on) as last_on
        from (select p.unit_price, p.effective_on, p.seq
                from public.price_history p
               where p.tenant_id = p_tenant and p.ingredient_id = i.id
                 and (v_date is null or p.effective_on <= v_date)
               order by p.effective_on desc, p.seq desc
               limit v_n) x
   ) w
   cross join lateral (
      select max(p.unit_price) as max_price
        from public.price_history p
       where p.tenant_id = p_tenant and p.ingredient_id = i.id
         and (v_date is null or p.effective_on <= v_date)
   ) mx
   left join lateral (
      select m.unit_cost as opening_cost
        from public.stock_movement m
       where m.tenant_id = p_tenant and m.ingredient_id = i.id and m.type::text = 'opening'
         and m.reverses_id is null
         and (v_date is null or m.effective_on <= v_date)
         and not exists (select 1 from public.stock_movement x where x.tenant_id = p_tenant and x.reverses_id = m.id)
       order by m.effective_on desc, m.created_at desc, m.id desc
       limit 1
   ) op on true
   where i.tenant_id = p_tenant and (p_ids is null or i.id = any (p_ids));
end
$$;

revoke all on function app.ingredient_unit_costs(uuid, uuid[], timestamptz) from public, anon, authenticated, service_role;
