-- M16 step 6: the prep rule and the helper that raises a rule alert (plan §3.1.4, §3.1.9, §3.1.11; PRD stew example; AT1, AT2).
-- Both are closed to every API role; the hourly body (step 9) calls them inside its own isolated block.

-- Raises one rule alert through the M6 pipeline (guard failures are absorbed into app.alert_refusal under p_caller) and says
-- whether THIS call created the row: try_raise_alert also returns the id of an alert that already existed, and two runs that
-- overlap must not both count it. A row created by this transaction carries created_at = now() (the default).
create function app.raise_rule_alert(p_tenant uuid, p_kind text, p_entity_type text, p_entity_id uuid, p_payload jsonb,
                                     p_severity public.alert_severity, p_at timestamptz, p_caller text)
  returns boolean
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_id uuid;
begin
  v_id := app.try_raise_alert(p_tenant, p_kind, p_entity_type, p_entity_id, p_payload, p_severity, null, p_at, null, p_caller);
  return v_id is not null
    and exists (select 1 from public.alert a where a.tenant_id = p_tenant and a.id = v_id and a.created_at = now());
end
$$;

-- For every active batch recipe whose effective minimum is above 0 and whose remaining portions (in-date batches, negative
-- balances as 0) are below it: prep_due when at least one batch can be made from the usable stock, otherwise prep_raw_short
-- (the PRD's "purchase suggestion instead"). Returns the number of NEW alerts.
create function app.prep_rule(p_tenant uuid, p_at timestamptz)
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_today date := app.alert_business_date(p_tenant, p_at);
  v_items integer := 0;
  v_onhand jsonb;
  v_msg text;
  v_has boolean;
  r record;
  b record;
  v_delivery date;
  v_order_by timestamptz;
  v_wanted integer;
  v_possible integer;
  v_batches integer;
  v_supplier uuid;
  v_kind text;
  v_payload jsonb;
begin
  for r in
    select rr.recipe_key, rr.recipe_id, rr.portions_per_batch, rr.min_portions, rr.target_portions, rr.prep_time_min,
           coalesce(rp.remaining, 0) as remaining
      from app.recipe_rules(p_tenant) rr
      left join app.remaining_portions(p_tenant, p_at) rp on rp.recipe_key = rr.recipe_key
     where rr.min_portions > 0 and coalesce(rp.remaining, 0) < rr.min_portions
     order by rr.recipe_key
  loop
    -- One ledger aggregate per run, only when some recipe is below its minimum.
    if v_onhand is null then
      select coalesce(jsonb_object_agg(u.ingredient_id::text, u.on_hand_qty), '{}'::jsonb) into v_onhand
        from app.usable_on_hand(p_tenant, v_today) u;
    end if;

    begin
      select x.ingredient_id, x.needed, x.have, x.ratio, x.unit, x.n_short
        into b
        from (select y.*, count(*) filter (where y.ratio < 1) over () as n_short,
                     row_number() over (order by y.ratio, y.ingredient_id) as rn
                from (select q.ingredient_id, round(q.qty_per_batch, 4) as needed, i.base_unit::text as unit,
                             coalesce((v_onhand ->> q.ingredient_id::text)::numeric, 0) as have,
                             greatest(coalesce((v_onhand ->> q.ingredient_id::text)::numeric, 0), 0) / round(q.qty_per_batch, 4) as ratio
                        from app.batch_requirements(p_tenant, r.recipe_id, p_at) q
                        join public.ingredient i on i.tenant_id = p_tenant and i.id = q.ingredient_id and i.is_stock
                       where round(q.qty_per_batch, 4) > 0) y) x
       where x.rn = 1;
      v_has := found;
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_msg = message_text;
      if v_msg <> 'recipe_not_producible' then
        raise;
      end if;
      perform app.record_alert_refusal(p_tenant, null, 'recipe_key', r.recipe_key, 'prep_rules', 'recipe_not_producible', sqlstate);
      continue;
    end;

    v_wanted := greatest(1, ceil((coalesce(r.target_portions, r.min_portions) - r.remaining)
                                 / greatest(coalesce(r.portions_per_batch, 1), 1))::integer);
    v_possible := case when v_has then floor(b.ratio)::integer end;
    if not v_has or v_possible >= 1 then
      v_kind := 'prep_due';
      v_batches := least(v_wanted, coalesce(v_possible, v_wanted));
    else
      v_kind := 'prep_raw_short';
    end if;

    -- Already raised today: skip it and build no payload.
    continue when exists (
      select 1 from public.alert a
       where a.tenant_id = p_tenant and a.kind = v_kind and a.entity_type = 'recipe_key'
         and a.entity_id = r.recipe_key and a.business_date = v_today);

    if v_kind = 'prep_due' then
      v_payload := jsonb_build_object(
        'recipe_key', r.recipe_key, 'recipe_id', r.recipe_id,
        'remaining_portions_qty', trim_scale(r.remaining), 'min_portions_count', r.min_portions,
        'target_portions_count', r.target_portions, 'batches_count', v_batches,
        'prep_hours', case when r.prep_time_min is null then null else trim_scale(round(r.prep_time_min / 60.0, 2)) end,
        'ingredient_id', case when v_has then b.ingredient_id end,
        'needed_qty', case when v_has then trim_scale(b.needed * v_batches) end,
        'on_hand_qty', case when v_has then trim_scale(b.have) end,
        'unit', case when v_has then b.unit end);
    else
      -- The binding ingredient's preferred supplier, when its window is known.
      v_supplier := null;
      v_delivery := null;
      v_order_by := null;
      select si.supplier_id into v_supplier
        from public.supplier_item si
        join public.supplier s on s.tenant_id = si.tenant_id and s.id = si.supplier_id
       where si.tenant_id = p_tenant and si.ingredient_id = b.ingredient_id and si.is_preferred and si.is_active and s.is_active;
      if v_supplier is not null then
        select sw.delivery_date, sw.order_by_at into v_delivery, v_order_by from app.supplier_window(p_tenant, v_supplier, p_at) sw;
        if not found then
          v_supplier := null;
        end if;
      end if;
      v_payload := jsonb_build_object(
        'recipe_key', r.recipe_key, 'recipe_id', r.recipe_id,
        'remaining_portions_qty', trim_scale(r.remaining), 'min_portions_count', r.min_portions,
        'ingredient_id', b.ingredient_id, 'needed_qty', trim_scale(b.needed), 'on_hand_qty', trim_scale(b.have),
        'unit', b.unit, 'short_count', b.n_short,
        'supplier_id', v_supplier,
        'order_by_at', app.iso_utc(v_order_by),
        'delivery_date', v_delivery);
    end if;

    if app.raise_rule_alert(p_tenant, v_kind, 'recipe_key', r.recipe_key, v_payload, null, p_at, 'prep_rules') then
      v_items := v_items + 1;
    end if;
  end loop;
  return v_items;
end
$$;

revoke all on function app.raise_rule_alert(uuid, text, text, uuid, jsonb, public.alert_severity, timestamptz, text),
  app.prep_rule(uuid, timestamptz) from public, anon, authenticated, service_role;
