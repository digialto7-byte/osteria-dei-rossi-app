-- Owner dashboard (docs/plans/2026-10-28-owner-dashboard.md) step 2: the week, payables, stock-at-risk, alert and name
-- helpers, and the cap constants. Every helper takes the tenant as a parameter, is SECURITY DEFINER with an empty
-- search_path, filters every statement by that tenant explicitly, and is closed to every API role: only
-- public.dashboard_summary() (step 4), which takes the tenant from app.tenant_id(), calls them.
--
-- Each metric follows the predicate or function of the screen it links to, so a number on the tile matches the screen:
--   * payables: app.payable_is_overdue (UX PR B's shared predicate, the 'overdue' flag of payable_list); unpaid is
--     status <> 'paid' (scheduled and disputed count); due soon is not overdue and due within app.payable_due_soon_days();
--   * below minimum: usable stock (app.usable_on_hand) at the venue date, as /riordino/ingredienti (rules_ingredients);
--   * expiring lots: a positive lot balance and app.expiry_state in (expired, due_soon), as expiry_rule and /magazzino;
--   * expiring batches: app.use_by_is_pending (PR B) with portions left, so the count equals today_counts().batchesUseBy.

-- Constants (immutable, so the plan checks and the TS twins can pin them).
create function app.payable_due_soon_days() returns integer language sql immutable set search_path = '' as $$ select 7 $$;
create function app.dashboard_list_cap() returns integer language sql immutable set search_path = '' as $$ select 5 $$;
create function app.dashboard_alert_cap() returns integer language sql immutable set search_path = '' as $$ select 50 $$;

-- The Monday and the Sunday of the ISO week that holds the venue date of p_at (Q109).
create function app.dashboard_week(p_tenant uuid, p_at timestamptz) returns table (week_from date, week_to date)
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_day date := app.alert_business_date(p_tenant, p_at);  -- raises tenant_not_found (P0002)
  v_monday date := v_day - (extract(isodow from v_day)::integer - 1);
begin
  return query select v_monday, v_monday + 6;
end
$$;

create function app.dashboard_payables(p_tenant uuid, p_today date) returns jsonb
  language sql stable
  security definer
  set search_path = ''
as $$
  with u as (
    -- Only rows due within the window can be overdue or due soon: this is the range payable_unpaid_due_idx serves.
    select p.id, p.amount, p.due_date, p.status, i.number_raw, s.name as supplier_name,
           app.payable_is_overdue(p.status, p.due_date, p_today) as overdue
      from public.payable p
      join public.invoice i on i.tenant_id = p.tenant_id and i.id = p.invoice_id
      join public.supplier s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
     where p.tenant_id = p_tenant and p.status <> 'paid'
       and p.due_date <= p_today + app.payable_due_soon_days()
  )
  select jsonb_build_object(
    'dueSoonDays', app.payable_due_soon_days(),
    'overdue', jsonb_build_object(
      'count', (select count(*)::int from u where u.overdue),
      'amountEur', (select coalesce(sum(u.amount), 0::numeric(12, 2)) from u where u.overdue)),
    'dueSoon', jsonb_build_object(
      'count', (select count(*)::int from u where not u.overdue),
      'amountEur', (select coalesce(sum(u.amount), 0::numeric(12, 2)) from u where not u.overdue)),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'supplierName', x.supplier_name, 'invoiceNumber', x.number_raw, 'amountEur', x.amount,
               'dueDate', x.due_date, 'daysToDue', x.due_date - p_today, 'overdue', x.overdue)
             order by x.overdue desc, x.due_date, x.id)
        from (select * from u order by u.overdue desc, u.due_date, u.id limit app.dashboard_list_cap()) x), '[]'::jsonb))
$$;

create function app.dashboard_stock_at_risk(p_tenant uuid, p_at timestamptz) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_today date := app.alert_business_date(p_tenant, p_at);
  v_cap integer := app.dashboard_list_cap();
  v_below jsonb;
  v_lots jsonb;
  v_batches jsonb;
begin
  with b as (
    select i.id, i.name, i.base_unit, i.min_level, coalesce(oh.on_hand_qty, 0) as on_hand
      from public.ingredient i
      left join app.usable_on_hand(p_tenant, v_today) oh on oh.ingredient_id = i.id
     where i.tenant_id = p_tenant and i.is_stock and i.is_active and i.min_level is not null
       and coalesce(oh.on_hand_qty, 0) < i.min_level
  )
  select jsonb_build_object(
           'count', (select count(*)::int from b),
           'items', coalesce((select jsonb_agg(jsonb_build_object(
                        'ingredientId', y.id, 'name', y.name, 'onHandQty', trim_scale(y.on_hand), 'minQty', trim_scale(y.min_level),
                        'unit', y.base_unit::text) order by y.name collate "C", y.id)
                      from (select * from b order by b.name collate "C", b.id limit v_cap) y), '[]'::jsonb))
    into v_below;

  with l as (
    select c.id, c.ingredient_id, i.name, c.lot_code, c.expiry, c.base_unit, c.qty,
           app.expiry_state(c.expiry, v_today) as state
      from (select rl.id, rl.ingredient_id, rl.lot_code, rl.expiry, rl.base_unit,
                   (select sum(m.qty) from public.stock_movement m where m.tenant_id = p_tenant and m.raw_lot_id = rl.id) as qty
              from public.raw_lot rl
             where rl.tenant_id = p_tenant and rl.expiry is not null and rl.expiry <= v_today + 1) c
      join public.ingredient i on i.tenant_id = p_tenant and i.id = c.ingredient_id
     where c.qty > 0
  )
  select jsonb_build_object(
           'count', (select count(*)::int from l),
           'items', coalesce((select jsonb_agg(jsonb_build_object(
                        'rawLotId', y.id, 'ingredientId', y.ingredient_id, 'ingredientName', y.name, 'lotCode', y.lot_code,
                        'expiry', y.expiry, 'state', y.state, 'qty', trim_scale(y.qty), 'unit', y.base_unit::text)
                      order by y.expiry, y.id)
                      from (select * from l order by l.expiry, l.id limit v_cap) y), '[]'::jsonb))
    into v_lots;

  with q as (
    select b.id, rv.name, b.lot_code, b.use_by, app.use_by_state(b.use_by, p_at) as state, p.portions
      from public.batch b
      join (select m.batch_id, sum(m.portions) as portions from public.batch_movement m
             where m.tenant_id = p_tenant group by m.batch_id) p on p.batch_id = b.id
      join public.recipe_key k on k.tenant_id = b.tenant_id and k.id = b.recipe_key
      join public.recipe rv on rv.tenant_id = k.tenant_id and rv.recipe_key = k.id and rv.version = k.current_version
     where b.tenant_id = p_tenant and app.use_by_is_pending(b.use_by, p_at) and p.portions > 0
  )
  select jsonb_build_object(
           'count', (select count(*)::int from q),
           'items', coalesce((select jsonb_agg(jsonb_build_object(
                        'batchId', y.id, 'recipeName', y.name, 'lotCode', y.lot_code, 'useBy', app.iso_utc(y.use_by),
                        'state', y.state, 'portions', y.portions) order by y.use_by, y.id)
                      from (select * from q order by q.use_by, q.id limit v_cap) y), '[]'::jsonb))
    into v_batches;

  return jsonb_build_object('belowMin', v_below, 'expiringLots', v_lots, 'expiringBatches', v_batches);
end
$$;

-- An alert as the dashboard returns it: the raw fields, camelCase. No acknowledger (no name of a person leaves here).
create function app.dashboard_alert_json(a public.alert) returns jsonb
  language sql immutable
  set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'severity', a.severity, 'entityType', a.entity_type, 'entityId', a.entity_id,
    'businessDate', a.business_date, 'createdAt', app.iso_utc(a.created_at), 'payload', a.payload,
    'costBearing', a.cost_bearing,
    'acknowledgedAt', case when a.acknowledged_at is not null then app.iso_utc(a.acknowledged_at) end)
$$;

create function app.dashboard_alerts(p_tenant uuid, p_at timestamptz) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  c_variance_items constant integer := 3;
  c_today_items constant integer := 10;
  v_cap integer := app.dashboard_alert_cap();
  v_today date := app.alert_business_date(p_tenant, p_at);
  v_open integer;
  v_prep jsonb;
  v_purchase jsonb;
begin
  -- One row more than the cap says whether there are more (the same rule as PR B's countAlerts for the owner).
  select count(*)::int into v_open from (
    select 1 from public.alert a where a.tenant_id = p_tenant and a.acknowledged_at is null
     order by a.created_at desc, a.id desc limit v_cap + 1) o;

  select coalesce(jsonb_agg(app.dashboard_alert_json(x) order by x.created_at desc, x.id desc), '[]'::jsonb) into v_prep
    from (select * from public.alert a where a.tenant_id = p_tenant and a.business_date = v_today
             and a.kind in ('prep_due', 'prep_raw_short') order by a.created_at desc, a.id desc limit c_today_items) x;
  select coalesce(jsonb_agg(app.dashboard_alert_json(x) order by x.created_at desc, x.id desc), '[]'::jsonb) into v_purchase
    from (select * from public.alert a where a.tenant_id = p_tenant and a.business_date = v_today
             and a.kind = 'purchase_due' order by a.created_at desc, a.id desc limit c_today_items) x;

  return jsonb_build_object(
    'alertsOpen', jsonb_build_object('count', least(v_open, v_cap), 'more', v_open > v_cap),
    'priceVariance', jsonb_build_object(
      'count', (select count(*)::int from public.alert a
                 where a.tenant_id = p_tenant and a.kind = 'price_variance' and a.acknowledged_at is null),
      'items', coalesce((
        select jsonb_agg(app.dashboard_alert_json(x) order by x.created_at desc, x.id desc)
          from (select * from public.alert a where a.tenant_id = p_tenant and a.kind = 'price_variance'
                   and a.acknowledged_at is null order by a.created_at desc, a.id desc limit c_variance_items) x), '[]'::jsonb)),
    'todayLists', jsonb_build_object(
      'businessDate', v_today,
      'prepCount', (select count(*)::int from public.alert a where a.tenant_id = p_tenant and a.business_date = v_today
                     and a.kind in ('prep_due', 'prep_raw_short')),
      'prep', v_prep,
      'purchaseCount', (select count(*)::int from public.alert a where a.tenant_id = p_tenant and a.business_date = v_today
                         and a.kind = 'purchase_due'),
      'purchase', v_purchase));
end
$$;

-- The labels of the records the given alert rows point at, in the same call. Every uuid-valued top-level payload field is
-- looked up in the six sources the alert list uses (a recipe is named by its stable key, through its current version),
-- always filtered by the tenant: an id of another tenant resolves to nothing. Over-fetching a name is harmless (the
-- caller is the owner of this tenant); it saves up to six reads.
create function app.dashboard_alert_names(p_tenant uuid, p_rows jsonb) returns jsonb
  language sql stable
  security definer
  set search_path = ''
as $$
  with ids as (
    select distinct (v.value #>> '{}')::uuid as id
      from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) r
      cross join lateral jsonb_each(case when jsonb_typeof(r -> 'payload') = 'object' then r -> 'payload' else '{}'::jsonb end) v
     where jsonb_typeof(v.value) = 'string'
       and (v.value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  select jsonb_build_object(
    'ingredient', coalesce((select jsonb_object_agg(i.id, i.name) from public.ingredient i
                             where i.tenant_id = p_tenant and i.id in (select id from ids)), '{}'::jsonb),
    'location', coalesce((select jsonb_object_agg(l.id, l.name) from public.location l
                           where l.tenant_id = p_tenant and l.id in (select id from ids)), '{}'::jsonb),
    'recipe', coalesce((select jsonb_object_agg(k.id, rv.name) from public.recipe_key k
                          join public.recipe rv on rv.tenant_id = k.tenant_id and rv.recipe_key = k.id and rv.version = k.current_version
                         where k.tenant_id = p_tenant and k.id in (select id from ids)), '{}'::jsonb),
    'supplier', coalesce((select jsonb_object_agg(s.id, s.name) from public.supplier s
                           where s.tenant_id = p_tenant and s.id in (select id from ids)), '{}'::jsonb),
    'raw_lot', coalesce((select jsonb_object_agg(rl.id, rl.lot_code) from public.raw_lot rl
                          where rl.tenant_id = p_tenant and rl.lot_code is not null and rl.id in (select id from ids)), '{}'::jsonb),
    'batch', coalesce((select jsonb_object_agg(b.id, b.lot_code) from public.batch b
                        where b.tenant_id = p_tenant and b.id in (select id from ids)), '{}'::jsonb))
$$;

revoke all on function
  app.payable_due_soon_days(), app.dashboard_list_cap(), app.dashboard_alert_cap(),
  app.dashboard_week(uuid, timestamptz), app.dashboard_payables(uuid, date),
  app.dashboard_stock_at_risk(uuid, timestamptz), app.dashboard_alert_json(public.alert),
  app.dashboard_alerts(uuid, timestamptz), app.dashboard_alert_names(uuid, jsonb)
  from public, anon, authenticated, service_role;
