-- M23 step 3 (docs/plans/2026-10-31-m23-push-forecast.md §3.1.2-3, §3.2; Q159-Q161): the push list.
--
--   batch_use_by_idx            (tenant_id, use_by): a use-by range across recipe keys had no index (batch_live_idx leads with recipe_key). A plain create index,
--                               as in 20261108100200 (rerun as `create index concurrently` outside a transaction on a large real tenant). Lots use raw_lot_expiry_idx.
--   app.require_push_reader     owner, admin, chef; 42501 otherwise.
--   app.push_list_window        the candidates, read only where the use-by / expiry falls in the window (PRD 2.4, Q159):
--                                 a batch: portions left (the ledger fold) above 0 and app.use_by_state = 'due_soon' (after now, within 24 h);
--                                 a raw lot: balance (all locations) above 0, app.expiry_state(expiry, business date) = 'due_soon' and its use-by instant after now.
--                               A lot's use-by instant is the local midnight that ends its expiry date (app.local_instant, DST-safe). Hours are elapsed seconds.
--                               ref_id is the batch recipe key (a batch) or the ingredient (a lot): the key the plates and batch recipes are matched on.
--   app.push_list_expired       stock past its use-by with quantity above 0: counted (Q160), never offered as a push.
--   app.push_item_plates        the active menu items whose plate (current version) uses a candidate batch key or ingredient. Each plate's graph is resolved on its
--                               own: a P0001 (recipe_not_producible) skips the plate everywhere and flags one row `unresolved`, so the list never fails on one recipe.
--   app.push_lot_batch_recipes  the active batch recipes whose current version needs a candidate ingredient (app.batch_requirements), same skip-and-flag rule.
--   app.push_list_json          the document; the cost keys and pushPrice exist only for owner and admin (unknown cost is null, never zero).
--   public.push_list            owner, admin, chef (app.require_push_reader first); the role shaping the JSON is the session's, not a parameter.

create index batch_use_by_idx on public.batch (tenant_id, use_by);

create function app.require_push_reader() returns void
  language plpgsql
  stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin', 'chef') then
    raise exception 'permission denied: the push list needs owner, admin or chef' using errcode = '42501';
  end if;
end
$$;

create function app.push_list_window(p_tenant uuid, p_now timestamptz)
  returns table (kind text, id uuid, name text, lot_code text, made_on date, use_by_at timestamptz, expiry_date date, hours_to_use_by numeric,
                 quantity numeric, unit text, unit_cost numeric, ref_id uuid)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz text;
  v_today date;
begin
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  if not found then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;
  v_today := app.business_date(p_tenant, p_now);
  return query
  select 'batch'::text, b.id, rv.name, b.lot_code, app.business_date(p_tenant, b.produced_at), b.use_by, null::date,
         round(extract(epoch from (b.use_by - p_now)) / 3600, 1), c.portions, 'porz'::text, bc.unit_cost_frozen, b.recipe_key
    from public.batch b
    cross join lateral (select sum(m.portions) as portions from public.batch_movement m where m.tenant_id = p_tenant and m.batch_id = b.id) c
    join public.recipe_key k on k.tenant_id = b.tenant_id and k.id = b.recipe_key
    join public.recipe rv on rv.tenant_id = k.tenant_id and rv.recipe_key = k.id and rv.version = k.current_version
    left join public.batch_cost bc on bc.tenant_id = b.tenant_id and bc.batch_id = b.id
   where b.tenant_id = p_tenant
     and b.use_by > p_now and b.use_by <= p_now + make_interval(hours => 24)
     and app.use_by_state(b.use_by, p_now) = 'due_soon'
     and c.portions > 0
  union all
  select 'lot'::text, l.id, i.name, l.lot_code, l.received_on, u.use_by_at, l.expiry,
         round(extract(epoch from (u.use_by_at - p_now)) / 3600, 1), c.qty, l.base_unit::text, rc.unit_cost, l.ingredient_id
    from public.raw_lot l
    join public.ingredient i on i.tenant_id = l.tenant_id and i.id = l.ingredient_id
    cross join lateral (select app.local_instant(l.expiry + 1, time '00:00', v_tz) as use_by_at) u
    cross join lateral (select sum(m.qty) as qty from public.stock_movement m where m.tenant_id = p_tenant and m.raw_lot_id = l.id) c
    left join lateral (select m.unit_cost from public.stock_movement m
                        where m.tenant_id = p_tenant and m.raw_lot_id = l.id and m.type::text = 'receipt'
                        order by m.created_at, m.id limit 1) rc on true
   where l.tenant_id = p_tenant and l.expiry is not null and l.expiry >= v_today and l.expiry <= v_today + 1
     and app.expiry_state(l.expiry, v_today) = 'due_soon'
     and u.use_by_at > p_now
     and c.qty > 0;
end
$$;

-- A batch is expired when its use-by has passed; a lot when its expiry date is before the venue's calendar date (its midnight has passed, which includes the hours
-- between that midnight and the cut-off, while the business date is still the expiry date).
create function app.push_list_expired(p_tenant uuid, p_now timestamptz) returns table (batches integer, lots integer)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tz text;
  v_local date;
begin
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  if not found then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;
  v_local := (p_now at time zone v_tz)::date;
  return query
  select (select count(*)::integer from public.batch b
           where b.tenant_id = p_tenant and b.use_by <= p_now
             and (select coalesce(sum(m.portions), 0) from public.batch_movement m where m.tenant_id = p_tenant and m.batch_id = b.id) > 0),
         (select count(*)::integer from public.raw_lot l
           where l.tenant_id = p_tenant and l.expiry is not null and l.expiry < v_local
             and (select coalesce(sum(m.qty), 0) from public.stock_movement m where m.tenant_id = p_tenant and m.raw_lot_id = l.id) > 0);
end
$$;

create function app.push_item_plates(p_tenant uuid, p_batch_keys uuid[], p_ingredients uuid[])
  returns table (menu_item_id uuid, item_name text, push_until timestamptz, push_price numeric, batch_key uuid, ingredient_id uuid, unresolved boolean)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
#variable_conflict use_column
declare
  rec record;
  v_ing uuid[];
  x uuid;
begin
  if cardinality(p_batch_keys) = 0 and cardinality(p_ingredients) = 0 then
    return;
  end if;
  for rec in
    select i.id, i.name, i.push_until, i.push_price, i.recipe_key, r.id as rid
      from public.menu_item i
      join public.recipe_key k on k.tenant_id = i.tenant_id and k.id = i.recipe_key and k.type::text = 'plate'
      join public.recipe r on r.tenant_id = k.tenant_id and r.recipe_key = k.id and r.version = k.current_version
     where i.tenant_id = p_tenant and i.is_active and i.recipe_key is not null
     order by i.name collate "C", i.id
  loop
    menu_item_id := rec.id;
    item_name := rec.name;
    push_until := rec.push_until;
    push_price := rec.push_price;
    batch_key := null;
    ingredient_id := null;
    unresolved := false;
    begin
      v_ing := coalesce(array(select n.ingredient_id from app.plate_raw_needs(p_tenant, rec.rid) n), '{}');
    exception when sqlstate 'P0001' then
      unresolved := true;
      return next;
      continue;
    end;
    for x in select n.batch_key from app.plate_batch_needs(p_tenant, array[rec.recipe_key]) n where n.batch_key = any (p_batch_keys) order by n.batch_key loop
      batch_key := x;
      ingredient_id := null;
      return next;
    end loop;
    for x in select u from unnest(v_ing) u where u = any (p_ingredients) order by u loop
      batch_key := null;
      ingredient_id := x;
      return next;
    end loop;
  end loop;
end
$$;

create function app.push_lot_batch_recipes(p_tenant uuid, p_ingredients uuid[], p_now timestamptz)
  returns table (recipe_key uuid, recipe_name text, ingredient_id uuid, unresolved boolean)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
#variable_conflict use_column
declare
  rec record;
  v_ing uuid[];
  x uuid;
begin
  if cardinality(p_ingredients) = 0 then
    return;
  end if;
  for rec in
    select k.id as key_id, rv.name, rv.id as rid
      from public.recipe_key k
      join public.recipe rv on rv.tenant_id = k.tenant_id and rv.recipe_key = k.id and rv.version = k.current_version
     where k.tenant_id = p_tenant and k.type::text = 'batch' and k.is_active
     order by rv.name collate "C", k.id
  loop
    recipe_key := rec.key_id;
    recipe_name := rec.name;
    ingredient_id := null;
    unresolved := false;
    begin
      v_ing := coalesce(array(select n.ingredient_id from app.batch_requirements(p_tenant, rec.rid, p_now) n), '{}');
    exception when sqlstate 'P0001' then
      unresolved := true;
      return next;
      continue;
    end;
    for x in select u from unnest(v_ing) u where u = any (p_ingredients) order by u loop
      ingredient_id := x;
      return next;
    end loop;
  end loop;
end
$$;

create function app.push_list_json(p_tenant uuid, p_role text, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_mgr boolean := p_role in ('owner', 'admin');
  v_result jsonb;
begin
  with w as materialized (
    select * from app.push_list_window(p_tenant, p_now)
  ), pl as materialized (
    select * from app.push_item_plates(
      p_tenant,
      coalesce((select array_agg(w.ref_id) from w where w.kind = 'batch'), '{}'),
      coalesce((select array_agg(w.ref_id) from w where w.kind = 'lot'), '{}'))
  ), br as materialized (
    select * from app.push_lot_batch_recipes(p_tenant, coalesce((select array_agg(w.ref_id) from w where w.kind = 'lot'), '{}'), p_now)
  ), ex as (
    select * from app.push_list_expired(p_tenant, p_now)
  ), rws as (
    select w.hours_to_use_by, w.name, w.id,
           jsonb_build_object(
             'kind', w.kind, 'id', w.id, 'name', w.name, 'lotCode', w.lot_code, 'madeOn', w.made_on,
             'useByAt', app.iso_utc(w.use_by_at), 'expiryDate', w.expiry_date, 'hoursToUseBy', w.hours_to_use_by,
             'quantity', trim_scale(w.quantity), 'unit', w.unit,
             'batchRecipes', coalesce((select jsonb_agg(jsonb_build_object('recipeKey', b.recipe_key, 'name', b.recipe_name) order by b.recipe_name collate "C", b.recipe_key)
                                         from br b where not b.unresolved and w.kind = 'lot' and b.ingredient_id = w.ref_id), '[]'::jsonb),
             'plates', coalesce((select jsonb_agg(
                                   jsonb_build_object('menuItemId', p.menu_item_id, 'name', p.item_name, 'pushed', coalesce(p.push_until > p_now, false),
                                                      'pushUntil', case when p.push_until > p_now then app.iso_utc(p.push_until) end)
                                   || case when v_mgr then jsonb_build_object('pushPrice', case when p.push_until > p_now then trim_scale(p.push_price) end) else '{}'::jsonb end
                                   order by p.item_name collate "C", p.menu_item_id)
                                  from pl p
                                 where not p.unresolved
                                   and ((w.kind = 'batch' and p.batch_key = w.ref_id) or (w.kind = 'lot' and p.ingredient_id = w.ref_id))), '[]'::jsonb))
           || case when v_mgr then jsonb_build_object('costAtRiskEur', round(w.quantity * w.unit_cost, 4)) else '{}'::jsonb end as j
      from w
  )
  select jsonb_build_object(
           'role', p_role,
           'asOf', app.iso_utc(p_now),
           'businessDate', app.business_date(p_tenant, p_now),
           'rows', coalesce((select jsonb_agg(r.j order by r.hours_to_use_by, r.name collate "C", r.id) from rws r), '[]'::jsonb),
           'expired', (select jsonb_build_object('batches', e.batches, 'lots', e.lots) from ex e),
           'unresolvedRecipes', (select count(*) from pl where pl.unresolved) + (select count(*) from br where br.unresolved),
           'totals', jsonb_build_object('count', (select count(*) from w))
                     || case when v_mgr
                             then jsonb_build_object('costAtRiskEur', coalesce((select sum(round(w.quantity * w.unit_cost, 4)) from w where w.unit_cost is not null), 0),
                                                     'unvaluedCount', (select count(*) from w where w.unit_cost is null))
                             else '{}'::jsonb end)
    into v_result;
  return v_result;
end
$$;

create function public.push_list() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_push_reader();
  return app.push_list_json(app.tenant_id(), app.role()::text, clock_timestamp());
end
$$;

revoke all on function app.require_push_reader(), app.push_list_window(uuid, timestamptz), app.push_list_expired(uuid, timestamptz),
  app.push_item_plates(uuid, uuid[], uuid[]), app.push_lot_batch_recipes(uuid, uuid[], timestamptz), app.push_list_json(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.push_list() from public, anon, authenticated, service_role;
grant execute on function public.push_list() to authenticated;
