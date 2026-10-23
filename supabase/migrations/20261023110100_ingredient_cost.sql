-- M8 step 2: the ingredient cost basis engine and public.ingredient_costs (M8 plan §3.1.1-3, §3.2;
-- ADR-008). Nothing is stored: the unit cost of an ingredient is derived on read, at an explicit
-- instant, from price_history (one row per received invoice line, EUR per base unit, net of VAT),
-- the ingredient_cost_basis history and the tenant's avg_cost_n.
--
-- "In force at p_at": prices count when effective_on <= the Rome date of the instant (the invoice
-- date, M5 Q1); the basis is the newest ingredient_cost_basis row with valid_from <= p_at, else
-- moving_average. p_at null means now: every price row and the newest basis row.
-- Unknown is never zero: an ingredient with no purchase in force has a null cost.

-- The last instant of a calendar day at the venue: the start of the next day minus 1 microsecond.
-- DST-safe because the zone database converts the local midnight (the 25-hour day 2026-10-25 ends
-- at 22:59:59.999999Z).
create function app.venue_day_end(p_date date, p_tz text) returns timestamptz
  language sql immutable
  set search_path = ''
as $$
  select ((p_date + 1)::timestamp at time zone p_tz) - interval '1 microsecond'
$$;

-- avg_cost: the plain mean of the unit_price of the last N purchases in force (N = avg_cost_n, fewer
-- if fewer exist; ties on effective_on go to seq). last_cost: the newest purchase. max_cost: the
-- highest price of all purchases in force. unit_cost follows the basis. Full precision (rounding is
-- done by the public functions). p_ids null means every ingredient of the tenant.
create function app.ingredient_unit_costs(p_tenant uuid, p_ids uuid[], p_at timestamptz)
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
         case when bs.basis = 'last_price' then w.last_price else w.avg_price end,
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
   where i.tenant_id = p_tenant and (p_ids is null or i.id = any (p_ids));
end
$$;

revoke all on function app.venue_day_end(date, text), app.ingredient_unit_costs(uuid, uuid[], timestamptz)
  from public, anon, authenticated, service_role;

-- Every ingredient of the tenant with its costs (EUR per base unit, 4 decimals) on a Rome date, or
-- today when the date is null. Owner and admin only (Q16 = V6).
create function public.ingredient_costs(p_date date default null)
  returns table (ingredient_id uuid, name text, base_unit public.base_unit, is_active boolean,
                 basis public.cost_basis, unit_cost_eur numeric, avg_eur numeric, last_eur numeric,
                 max_eur numeric, purchases_used integer, last_purchase_on date)
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tz text;
begin
  perform app.require_cost_reader();
  v_tenant := app.tenant_id();
  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;
  if p_date is not null and p_date > app.venue_date(now(), v_tz) then
    raise exception 'date_in_future' using errcode = 'P0001';
  end if;
  return query
  select c.ingredient_id, i.name, c.base_unit, i.is_active, c.basis,
         round(c.unit_cost, 4), round(c.avg_cost, 4), round(c.last_cost, 4), round(c.max_cost, 4),
         c.purchases_used, c.last_purchase_on
    from app.ingredient_unit_costs(v_tenant, null,
           case when p_date is null then null else app.venue_day_end(p_date, v_tz) end) c
    join public.ingredient i on i.tenant_id = v_tenant and i.id = c.ingredient_id
   order by i.name collate "C", i.id;
end
$$;

revoke all on function public.ingredient_costs(date) from public, anon, authenticated, service_role;
grant execute on function public.ingredient_costs(date) to authenticated;
