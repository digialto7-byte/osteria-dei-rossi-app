-- M14 step 6: the read functions (M14 plan §3.1.12, §3.1.13, §3.2; ADR-013; founder Q16 = project V6).
--   batch_list, batch_label  - quantities only, owner / admin / chef
--   batch_costs              - EUR, owner / admin only (app.require_cost_reader, M8)
-- Batches carry no EUR value, so RLS would let the kitchen read the tables; the API still reads through these
-- definer functions: the role check comes FIRST (the waiter gets 42501, not an empty list), names and initials are
-- joined in one round trip (the chef cannot read app_user), the tenant comes from app.tenant_id(), the search_path
-- is empty and execute goes to `authenticated` only. The name batch_costs contains "cost", so pgTAP 059's
-- catalogue scan covers it (its expected list is extended in this commit).

-- Newest first by (produced_at, id). The cursor is both halves or none; nextCursor is {producedAt, id} of the
-- last item shown, or null. useByState is computed here (expired / due_soon / ok) so React never compares dates.
create function public.batch_list(
  p_recipe_key uuid default null, p_before_at timestamptz default null, p_before_id uuid default null,
  p_limit integer default 50
) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_me uuid;
  v_now timestamptz := now();
  v_rows jsonb;
  v_count integer;
begin
  perform app.require_batch_reader();
  if p_limit is null or p_limit < 1 or p_limit > 100 or (p_before_at is null) <> (p_before_id is null) then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  v_tenant := app.tenant_id();
  v_me := app.app_user_id();

  -- One more than the page, to know whether a next page exists.
  select coalesce(jsonb_agg(x.item order by x.produced_at desc, x.id desc), '[]'::jsonb), count(*)
    into v_rows, v_count
    from (select b.id, b.produced_at,
                 jsonb_build_object(
                   'batchId', b.id, 'lotCode', b.lot_code, 'recipeKey', b.recipe_key, 'recipeName', r.name,
                   'version', b.recipe_version, 'producedAt', b.produced_at, 'useBy', b.use_by,
                   'useByState', app.use_by_state(b.use_by, v_now), 'shelfLifeHours', b.shelf_life_hours,
                   'outputQty', b.output_qty, 'outputUnit', b.output_unit,
                   'portionsComputed', b.portions_computed, 'portionsInitial', b.portions_initial,
                   'portionsRemaining', coalesce(p.portions_remaining, 0), 'state', b.state,
                   'locationId', b.location_id, 'locationName', x.name,
                   'byInitials', app.initials(u.display_name), 'byMe', b.produced_by = v_me) as item
            from public.batch b
            join public.recipe r on r.tenant_id = b.tenant_id and r.id = b.recipe_id
            join public.location x on x.tenant_id = b.tenant_id and x.id = b.location_id
            join public.app_user u on u.tenant_id = b.tenant_id and u.id = b.produced_by
            left join public.v_batch_portions p on p.tenant_id = b.tenant_id and p.batch_id = b.id
           where b.tenant_id = v_tenant
             and (p_recipe_key is null or b.recipe_key = p_recipe_key)
             and (p_before_at is null or (b.produced_at, b.id) < (p_before_at, p_before_id))
           order by b.produced_at desc, b.id desc
           limit p_limit + 1) x;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb)
                from jsonb_array_elements(v_rows) with ordinality e (value, ord) where e.ord <= p_limit),
    'nextCursor', case when v_count > p_limit then
      (select jsonb_build_object('producedAt', e.value -> 'producedAt', 'id', e.value -> 'batchId')
         from jsonb_array_elements(v_rows) with ordinality e (value, ord) where e.ord = p_limit) end);
end
$$;

-- The label text (PRD 2.2): the recipe name of the pinned version, produced and use-by instants, the portions at
-- production (assumption A3), the lot code and the operator's initials. Dates are shown in Europe/Rome by the
-- screens.
create function public.batch_label(p_batch uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_label jsonb;
begin
  perform app.require_batch_reader();
  v_tenant := app.tenant_id();
  select jsonb_build_object('batchId', b.id, 'recipeName', r.name, 'version', b.recipe_version,
           'producedAt', b.produced_at, 'useBy', b.use_by, 'portions', b.portions_initial, 'lotCode', b.lot_code,
           'operatorInitials', app.initials(u.display_name), 'shelfLifeHours', b.shelf_life_hours)
    into v_label
    from public.batch b
    join public.recipe r on r.tenant_id = b.tenant_id and r.id = b.recipe_id
    join public.app_user u on u.tenant_id = b.tenant_id and u.id = b.produced_by
   where b.tenant_id = v_tenant and b.id = p_batch;
  if v_label is null then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;
  return v_label;
end
$$;

-- The frozen cost of batches (EUR, 4 decimals), owner and admin only. Unknown is null with incomplete = true,
-- never 0.
create function public.batch_costs(p_batch_ids uuid[])
  returns table (batch_id uuid, total_cost_eur numeric, unit_cost_eur numeric, incomplete boolean,
                 missing_ingredient_ids uuid[])
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant uuid;
begin
  perform app.require_cost_reader();
  if p_batch_ids is not null and cardinality(p_batch_ids) > 100 then
    raise exception 'too_many_ids' using errcode = 'P0001';
  end if;
  v_tenant := app.tenant_id();
  return query
  select c.batch_id, round(c.total_cost, 4), round(c.unit_cost_frozen, 4), c.incomplete, c.missing_ingredient_ids
    from public.batch_cost c
   where c.tenant_id = v_tenant and c.batch_id = any (coalesce(p_batch_ids, '{}'::uuid[]))
   order by c.batch_id;
end
$$;

revoke all on function public.batch_list(uuid, timestamptz, uuid, integer), public.batch_label(uuid),
  public.batch_costs(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.batch_list(uuid, timestamptz, uuid, integer), public.batch_label(uuid),
  public.batch_costs(uuid[])
  to authenticated;
