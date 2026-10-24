-- M16 step 2: the helpers of the rules (plan §3.1.3, §3.1.5, §3.1.6, §3.2; ADR-015). Schema app, empty search_path,
-- closed to every API role. Every function that depends on time takes the instant or the date as a parameter and never
-- calls now(); nothing adds an interval of days to a timestamptz (DST, AT6).

-- An instant as YYYY-MM-DDTHH:MM:SSZ, whatever the session zone (alert payloads, plan §3.1.12).
create function app.iso_utc(p_at timestamptz)
  returns text
  language sql
  immutable
  set search_path = ''
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

-- The next delivery and the moment to order by (plan §3.1.6). Candidates are the days today .. today + lead + 7 whose
-- ISO weekday is delivered; the order date is the delivery date minus the lead time; the deadline is that local date
-- plus the cut-off, converted through the zone database (a null cut-off means local midnight at the end of that day).
-- The result is the first candidate whose deadline has not passed (p_at <= deadline). No weekday or no lead time: none.
create function app.next_delivery_window(p_at timestamptz, p_tz text, p_weekdays smallint[], p_cutoff time, p_lead smallint)
  returns table (delivery_date date, order_by_at timestamptz)
  language sql
  immutable
  set search_path = ''
as $$
  select c.d, c.ob
    from (select s.d,
                 (case when p_cutoff is null then ((s.d - p_lead) + 1)::timestamp
                       else (s.d - p_lead) + p_cutoff end) at time zone p_tz as ob
            from (select (p_at at time zone p_tz)::date + k as d
                    from generate_series(0, p_lead + 7) k) s
           where extract(isodow from s.d)::smallint = any (p_weekdays)) c
   where p_at <= c.ob
   order by c.d
   limit 1
$$;

-- Usable stock per ingredient, every location (plan §3.1.3): the ledger sum minus the positive balance of each lot whose
-- expiry is before p_today. The unlotted bucket counts, even when negative.
create function app.usable_on_hand(p_tenant uuid, p_today date)
  returns table (ingredient_id uuid, on_hand_qty numeric)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select l.ingredient_id,
         sum(l.q) - coalesce(sum(greatest(l.q, 0)) filter (where rl.expiry < p_today), 0)
    from (select m.ingredient_id, m.raw_lot_id, sum(m.qty) as q
            from public.stock_movement m
           where m.tenant_id = p_tenant
           group by m.ingredient_id, m.raw_lot_id) l
    left join public.raw_lot rl on rl.tenant_id = p_tenant and rl.id = l.raw_lot_id
   group by l.ingredient_id
$$;

-- The trailing-14-day weekday average of consumption (plan §3.1.5; AT7). The window is the 14 complete dates before
-- p_today, so each ISO weekday occurs twice and the divisor is always 2. A reversal counts on its original's date.
-- Waste, counts, transfers and receipts are not consumption. Rows only where the average is not zero.
create function app.weekday_consumption(p_tenant uuid, p_today date)
  returns table (ingredient_id uuid, isodow integer, avg_qty numeric)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select c.ingredient_id, extract(isodow from c.d)::integer, sum(c.q) / 2
    from (select m.ingredient_id, coalesce(o.effective_on, m.effective_on) as d, -m.qty as q
            from public.stock_movement m
            left join public.stock_movement o on o.tenant_id = p_tenant and o.id = m.reverses_id
           where m.tenant_id = p_tenant and m.type = 'consumption'
             and m.effective_on >= p_today - 14
             and coalesce(o.effective_on, m.effective_on) between p_today - 14 and p_today - 1) c
   group by c.ingredient_id, extract(isodow from c.d)
  having sum(c.q) <> 0
$$;

-- Σ of the weekday averages over the horizon days p_today .. p_today + p_days - 1; p_avgs is {"<isodow>": avg}.
create function app.forecast_qty(p_avgs jsonb, p_today date, p_days integer)
  returns numeric
  language sql
  immutable
  set search_path = ''
as $$
  select round(coalesce(sum(coalesce((p_avgs ->> extract(isodow from p_today + k)::integer::text)::numeric, 0)), 0), 4)
    from generate_series(0, p_days - 1) k
$$;

-- The window of one supplier of the tenant, in the tenant's zone; no row when the supplier is not the tenant's or is
-- incomplete. It does not look at is_active: the callers decide.
create function app.supplier_window(p_tenant uuid, p_supplier uuid, p_at timestamptz)
  returns table (delivery_date date, order_by_at timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select w.delivery_date, w.order_by_at
    from public.supplier s
    join public.tenant t on t.id = s.tenant_id
   cross join lateral app.next_delivery_window(p_at, t.timezone, s.delivery_weekdays, s.order_cutoff_time, s.lead_time_days) w
   where s.tenant_id = p_tenant and s.id = p_supplier
$$;

-- The effective rule values of every active batch recipe (plan §3.1.1): the key's setting wins, else the current
-- version's value; each source is 'rule', 'version' or null.
create function app.recipe_rules(p_tenant uuid)
  returns table (recipe_key uuid, recipe_id uuid, version integer, portions_per_batch integer, min_portions integer,
                 target_portions integer, prep_time_min integer, min_source text, target_source text, prep_source text)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select k.id, r.id, r.version, r.portions_per_batch,
         coalesce(k.rule_min_portions, r.min_portions), coalesce(k.rule_target_portions, r.target_portions),
         coalesce(k.rule_prep_time_min, r.prep_time_min),
         case when k.rule_min_portions is not null then 'rule' when r.min_portions is not null then 'version' end,
         case when k.rule_target_portions is not null then 'rule' when r.target_portions is not null then 'version' end,
         case when k.rule_prep_time_min is not null then 'rule' when r.prep_time_min is not null then 'version' end
    from public.recipe_key k
    join public.recipe r on r.tenant_id = k.tenant_id and r.recipe_key = k.id and r.version = k.current_version
   where k.tenant_id = p_tenant and k.type = 'batch' and k.is_active
$$;

revoke all on function
  app.iso_utc(timestamptz), app.next_delivery_window(timestamptz, text, smallint[], time, smallint),
  app.usable_on_hand(uuid, date), app.weekday_consumption(uuid, date), app.forecast_qty(jsonb, date, integer),
  app.supplier_window(uuid, uuid, timestamptz), app.recipe_rules(uuid)
  from public, anon, authenticated, service_role;
