-- M16 step 4: the rules reads (plan §3.2, §3.1.13). Public, security definer, stable, empty search_path; the role gate
-- (owner, admin, chef) runs first and the tenant comes from app.tenant_id(). No cost value is ever selected: supplier_item
-- is read for packs and flags only, never for last_price. Only owner and admin may choose the clock (p_at, for previews);
-- the chef's calls use now().

-- Portions still available per batch recipe key: the positive balance of each batch whose use-by is after p_at (an
-- expired batch is not available, a negative balance counts as 0). Used by rules_recipes and the prep rule.
create function app.remaining_portions(p_tenant uuid, p_at timestamptz)
  returns table (recipe_key uuid, remaining numeric)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select b.recipe_key, sum(greatest(coalesce(v.portions_remaining, 0), 0))
    from public.batch b
    left join public.v_batch_portions v on v.tenant_id = p_tenant and v.batch_id = b.id
   where b.tenant_id = p_tenant and b.use_by > p_at
   group by b.recipe_key
$$;
revoke all on function app.remaining_portions(uuid, timestamptz) from public, anon, authenticated, service_role;

create function public.rules_ingredients(p_at timestamptz default null)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_privileged boolean;
  v_at timestamptz;
  v_today date;
  v_items jsonb;
  v_out jsonb;
begin
  perform app.require_rules_reader();
  v_tenant := app.tenant_id();
  v_privileged := app.role() in ('owner', 'admin');
  v_at := case when v_privileged then coalesce(p_at, now()) else now() end;
  v_today := app.alert_business_date(v_tenant, v_at);

  select coalesce(jsonb_agg(x.j order by x.name collate "C", x.id), '[]'::jsonb) into v_items
    from (
      select i.id, i.name,
             jsonb_build_object(
               'ingredientId', i.id, 'name', i.name, 'baseUnit', i.base_unit, 'isCritical', i.is_critical,
               'minLevel', trim_scale(i.min_level), 'targetLevel', trim_scale(i.target_level),
               'onHandQty', trim_scale(coalesce(oh.on_hand_qty, 0)),
               'preferred', case when p.item_id is null then null else jsonb_build_object(
                  'supplierItemId', p.item_id, 'supplierId', p.supplier_id, 'supplierName', p.supplier_name,
                  'packQty', trim_scale(p.pack_base), 'packLabel', p.label) end,
               'nextWindow', case when w.delivery_date is null then null else jsonb_build_object(
                  'deliveryDate', w.delivery_date, 'orderByAt', app.iso_utc(w.order_by_at)) end,
               'status', case when i.min_level is null then 'off'
                              when cardinality(r.reasons) > 0 then 'incomplete' else 'ok' end,
               'reasons', to_jsonb(case when i.min_level is null then '{}'::text[] else r.reasons end)) as j
        from public.ingredient i
        left join app.usable_on_hand(v_tenant, v_today) oh on oh.ingredient_id = i.id
        left join lateral (
          select si.id as item_id, si.supplier_id, s.name as supplier_name, s.is_active as supplier_active,
                 s.lead_time_days, s.delivery_weekdays,
                 app.base_factor('conf', i.base_unit, si.pack_count, si.pack_qty, si.pack_unit) as pack_base,
                 case when si.pack_count = 1 then trim_scale(si.pack_qty)::text || ' ' || si.pack_unit::text
                      else trim_scale(si.pack_count)::text || ' × ' || trim_scale(si.pack_qty)::text || ' ' || si.pack_unit::text end as label
            from public.supplier_item si
            join public.supplier s on s.tenant_id = si.tenant_id and s.id = si.supplier_id
           where si.tenant_id = v_tenant and si.ingredient_id = i.id and si.is_preferred and si.is_active
        ) p on true
        left join lateral (
          select * from app.supplier_window(v_tenant, p.supplier_id, v_at) where p.supplier_active
        ) w on true
        cross join lateral (
          select array_remove(array[
            case when p.item_id is null then 'no_preferred_item' end,
            case when p.item_id is not null and not p.supplier_active then 'supplier_inactive' end,
            case when p.supplier_active and cardinality(p.delivery_weekdays) = 0 then 'supplier_no_weekdays' end,
            case when p.supplier_active and p.lead_time_days is null then 'supplier_no_lead_time' end], null) as reasons
        ) r
       where i.tenant_id = v_tenant and i.is_stock and i.is_active
    ) x;
  v_out := jsonb_build_object('today', v_today, 'items', v_items);

  if v_privileged then
    v_out := v_out || jsonb_build_object('supplierItems', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'supplierItemId', si.id, 'ingredientId', si.ingredient_id, 'supplierId', si.supplier_id,
               'supplierName', s.name,
               'packQty', trim_scale(app.base_factor('conf', i.base_unit, si.pack_count, si.pack_qty, si.pack_unit)),
               'packLabel', case when si.pack_count = 1 then trim_scale(si.pack_qty)::text || ' ' || si.pack_unit::text
                                 else trim_scale(si.pack_count)::text || ' × ' || trim_scale(si.pack_qty)::text || ' ' || si.pack_unit::text end)
             order by i.name collate "C", s.name collate "C", si.id), '[]'::jsonb)
        from public.supplier_item si
        join public.ingredient i on i.tenant_id = si.tenant_id and i.id = si.ingredient_id
        join public.supplier s on s.tenant_id = si.tenant_id and s.id = si.supplier_id
       where si.tenant_id = v_tenant and si.is_active and s.is_active and i.is_stock and i.is_active));
  end if;
  return v_out;
end
$$;

create function public.rules_suppliers()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  perform app.require_rules_reader();
  v_tenant := app.tenant_id();
  return jsonb_build_object('items', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'supplierId', s.id, 'name', s.name, 'leadTimeDays', s.lead_time_days,
             'deliveryWeekdays', to_jsonb(s.delivery_weekdays),
             'orderCutoffTime', to_char(s.order_cutoff_time, 'HH24:MI'),
             'nextWindow', case when w.delivery_date is null then null else jsonb_build_object(
                'deliveryDate', w.delivery_date, 'orderByAt', app.iso_utc(w.order_by_at)) end)
           order by s.name collate "C", s.id), '[]'::jsonb)
      from public.supplier s
      left join lateral app.supplier_window(v_tenant, s.id, now()) w on true
     where s.tenant_id = v_tenant and s.is_active));
end
$$;

create function public.rules_recipes()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  perform app.require_rules_reader();
  v_tenant := app.tenant_id();
  return jsonb_build_object('items', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'recipeKey', rr.recipe_key, 'name', r.name, 'version', rr.version,
             'portionsPerBatch', rr.portions_per_batch, 'minPortions', rr.min_portions,
             'targetPortions', rr.target_portions, 'prepTimeMin', rr.prep_time_min,
             'sources', jsonb_build_object('min', rr.min_source, 'target', rr.target_source, 'prep', rr.prep_source),
             'remainingPortions', trim_scale(coalesce(rp.remaining, 0)))
           order by r.name collate "C", rr.recipe_key), '[]'::jsonb)
      from app.recipe_rules(v_tenant) rr
      join public.recipe r on r.tenant_id = v_tenant and r.id = rr.recipe_id
      left join app.remaining_portions(v_tenant, now()) rp on rp.recipe_key = rr.recipe_key));
end
$$;

revoke all on function public.rules_ingredients(timestamptz), public.rules_suppliers(), public.rules_recipes()
  from public, anon, authenticated, service_role;
grant execute on function public.rules_ingredients(timestamptz), public.rules_suppliers(), public.rules_recipes()
  to authenticated;
