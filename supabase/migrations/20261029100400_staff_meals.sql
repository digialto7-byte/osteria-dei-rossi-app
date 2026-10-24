-- M15 step 5: set_staff_meal_rule and confirm_staff_meal (M15 plan §3.1.7, §3.1.8, §3.1.12, §3.2; AT5; ADR-014).
-- Each public function is SECURITY DEFINER with an empty search_path, checks the role FIRST (owner, admin or chef; the
-- waiter never), takes the tenant from app.tenant_id() and the user from app.app_user_id(), filters every query by the
-- tenant, and is executable by `authenticated` only. Answers carry quantities only (no value, cost or price).
--
-- confirm_staff_meal is a thin wrapper over app.confirm_staff_meal_core(..., p_at) so the business date can be proved
-- with a fixed instant (the M14 produce_batch_core pattern). The core inserts the confirmation FIRST: the unique
-- (tenant, rule, business date) is the once-per-day guard, and a concurrent second call waits on that index, then fails
-- with 23505 (plan T1) holding no other lock. Then it writes the consumption:
--   recipe rule      FEFO portions from the recipe's fresh/open, unexpired batches, locked in id order, as `waste` rows
--                    (reason staff_meal, ref staff_meal -> the confirmation); short of portions -> portions_insufficient
--                    and the whole call, confirmation included, rolls back (founder Q50 default)
--   ingredient rule  app.post_stock_outflow (M12): a shortfall is recorded and alerted, never refused (plan rule 8)

-- A rule per target (a batch recipe or a stock ingredient): created, or changed in place (one row per target ever).
-- default_count is portions for a recipe and base units for an ingredient (converted with the unit given here).
create function public.set_staff_meal_rule(
  p_recipe_key uuid, p_ingredient_id uuid, p_default_count numeric, p_unit text default null,
  p_location uuid default null, p_is_active boolean default true
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_count numeric;
  v_location uuid;
  v_old public.staff_meal_rule;
  v_new public.staff_meal_rule;
  v_created boolean;
begin
  perform app.require_batch_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();

  -- The target: exactly one, of the right kind.
  if num_nonnulls(p_recipe_key, p_ingredient_id) <> 1 then
    raise exception 'staff_meal_target_invalid' using errcode = 'P0001';
  end if;
  if p_recipe_key is not null then
    perform 1 from public.recipe_key k where k.tenant_id = v_tenant and k.id = p_recipe_key and k.type = 'batch';
  else
    perform 1 from public.ingredient i where i.tenant_id = v_tenant and i.id = p_ingredient_id and i.is_stock;
  end if;
  if not found or (p_recipe_key is not null and p_location is not null) then
    raise exception 'staff_meal_target_invalid' using errcode = 'P0001';
  end if;

  -- The count: portions for a recipe, base units for an ingredient (converted from the given unit).
  if p_default_count is null or p_default_count <= 0 or round(p_default_count, 4) <> p_default_count then
    raise exception 'count_invalid' using errcode = 'P0001';
  end if;
  if p_recipe_key is not null then
    v_count := p_default_count;
  else
    begin
      v_count := app.stock_qty_base(v_tenant, p_ingredient_id, p_default_count, p_unit);
    exception when others then
      if sqlerrm = 'qty_invalid' then
        raise exception 'count_invalid' using errcode = 'P0001';
      end if;
      raise;
    end;
  end if;
  if v_count <= 0 or v_count > 1000 then
    raise exception 'count_invalid' using errcode = 'P0001';
  end if;

  if p_location is not null then
    v_location := app.resolve_location(v_tenant, p_location);
  end if;

  -- All rule writes of a tenant are serialised on its row (NO KEY UPDATE does not block the foreign-key checks of
  -- other inserts), so two creators of the same target, or of the 50th and 51st rule, cannot race.
  perform 1 from public.tenant t where t.id = v_tenant for no key update;

  select * into v_old
    from public.staff_meal_rule r
   where r.tenant_id = v_tenant
     and ((p_recipe_key is not null and r.recipe_key = p_recipe_key)
          or (p_ingredient_id is not null and r.ingredient_id = p_ingredient_id))
     for update;
  v_created := not found;

  if v_created then
    if (select count(*) from public.staff_meal_rule r where r.tenant_id = v_tenant) >= 50 then
      raise exception 'rules_limit' using errcode = 'P0001';
    end if;
    insert into public.staff_meal_rule (tenant_id, recipe_key, ingredient_id, default_count, location_id, is_active,
                                        created_by, updated_by)
      values (v_tenant, p_recipe_key, p_ingredient_id, v_count, v_location, coalesce(p_is_active, true), v_user, v_user)
      returning * into v_new;
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
      values (v_tenant, 'staff_meal_rule', v_new.id, 'staff_meal_rule.created',
              jsonb_build_object('recipeKey', v_new.recipe_key, 'ingredientId', v_new.ingredient_id,
                                 'defaultCount', v_new.default_count, 'locationId', v_new.location_id,
                                 'isActive', v_new.is_active), v_user);
  else
    update public.staff_meal_rule
       set default_count = v_count, location_id = v_location, is_active = coalesce(p_is_active, true),
           updated_at = now(), updated_by = v_user
     where tenant_id = v_tenant and id = v_old.id
     returning * into v_new;
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
      values (v_tenant, 'staff_meal_rule', v_new.id, 'staff_meal_rule.updated',
              jsonb_build_object('defaultCount', v_old.default_count, 'locationId', v_old.location_id,
                                 'isActive', v_old.is_active),
              jsonb_build_object('defaultCount', v_new.default_count, 'locationId', v_new.location_id,
                                 'isActive', v_new.is_active), v_user);
  end if;

  return jsonb_build_object('ruleId', v_new.id, 'created', v_created,
                            'kind', case when v_new.recipe_key is not null then 'recipe' else 'ingredient' end,
                            'targetId', coalesce(v_new.recipe_key, v_new.ingredient_id),
                            'defaultCount', v_new.default_count, 'locationId', v_new.location_id,
                            'isActive', v_new.is_active);
end
$$;

create function app.confirm_staff_meal_core(
  p_tenant uuid, p_user uuid, p_rule uuid, p_count numeric, p_at timestamptz
) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  r public.staff_meal_rule;
  v_count numeric;
  v_bd date;
  v_tz text;
  v_date date;
  v_conf uuid := gen_random_uuid();
  v_ids uuid[];
  v_left numeric;
  v_take numeric;
  v_loc uuid;
  v_moves jsonb := '[]'::jsonb;
  v_negs jsonb := '[]'::jsonb;
  b record;
  o record;
begin
  select * into r from public.staff_meal_rule x where x.tenant_id = p_tenant and x.id = p_rule;
  if not found then
    raise exception 'staff_meal_rule_not_found' using errcode = 'P0002';
  end if;
  if not r.is_active then
    raise exception 'staff_meal_rule_inactive' using errcode = 'P0001';
  end if;
  v_count := coalesce(p_count, r.default_count);
  if v_count <= 0 or v_count > 1000 or round(v_count, 4) <> v_count then
    raise exception 'count_invalid' using errcode = 'P0001';
  end if;

  v_bd := app.business_date(p_tenant, p_at);
  if exists (select 1 from public.staff_meal_confirmation c
              where c.tenant_id = p_tenant and c.rule_id = r.id and c.business_date = v_bd) then
    raise exception 'staff_meal_already_confirmed' using errcode = 'P0001';
  end if;
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  v_date := app.venue_date(p_at, v_tz);

  -- The guard first: a concurrent second confirmation waits here, then fails with 23505.
  insert into public.staff_meal_confirmation (id, tenant_id, rule_id, business_date, count, created_at, created_by)
    values (v_conf, p_tenant, r.id, v_bd, v_count, p_at, p_user);

  if r.recipe_key is not null then
    select coalesce(array_agg(x.id order by x.id), '{}') into v_ids
      from public.batch x
     where x.tenant_id = p_tenant and x.recipe_key = r.recipe_key and x.state in ('fresh', 'open') and x.use_by > p_at;
    if cardinality(v_ids) > 0 then
      perform app.lock_batch_rows(p_tenant, v_ids);
    end if;
    v_left := v_count;
    -- A new statement after the locks: the remaining portions are what the previous holders committed (plan T2).
    for b in
      select x.id, app.batch_remaining(p_tenant, x.id) as remaining
        from public.batch x
       where x.tenant_id = p_tenant and x.id = any (v_ids) and x.state in ('fresh', 'open') and x.use_by > p_at
       order by x.use_by, x.produced_at, x.id
    loop
      exit when v_left <= 0;
      continue when b.remaining <= 0;
      v_take := least(b.remaining, v_left);
      insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id,
                                         effective_on, created_by)
        values (p_tenant, b.id, 'waste', -v_take, 'staff_meal', 'staff_meal', v_conf, v_date, p_user);
      perform app.batch_settle_state(p_tenant, b.id, 'staff_meal');
      v_moves := v_moves || jsonb_build_object('batchId', b.id, 'portions', v_take);
      v_left := v_left - v_take;
    end loop;
    if v_left > 0 then
      raise exception 'portions_insufficient' using errcode = 'P0001';
    end if;
  else
    v_loc := app.resolve_location(p_tenant, r.location_id);
    for o in
      select * from app.post_stock_outflow(p_tenant, p_user, r.ingredient_id, v_loc, v_count, 'waste', 'staff_meal',
                                           null, 'staff_meal', v_conf, p_at, null, 'confirm_staff_meal')
    loop
      v_moves := v_moves || jsonb_build_object('ingredientId', r.ingredient_id, 'qty', -o.qty);
    end loop;
    if app.location_on_hand(p_tenant, r.ingredient_id, v_loc) < 0 then
      v_negs := jsonb_build_array(jsonb_build_object('ingredientId', r.ingredient_id, 'locationId', v_loc,
                                    'onHandQty', app.location_on_hand(p_tenant, r.ingredient_id, v_loc)));
    end if;
  end if;

  return jsonb_build_object('confirmationId', v_conf, 'ruleId', r.id, 'businessDate', v_bd, 'count', v_count,
                            'movements', v_moves, 'negatives', v_negs);
end
$$;

create function public.confirm_staff_meal(p_rule uuid, p_count numeric default null) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_batch_writer();
  return app.confirm_staff_meal_core(app.tenant_id(), app.app_user_id(), p_rule, p_count, now());
end
$$;

revoke all on function public.set_staff_meal_rule(uuid, uuid, numeric, text, uuid, boolean),
  public.confirm_staff_meal(uuid, numeric),
  app.confirm_staff_meal_core(uuid, uuid, uuid, numeric, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.set_staff_meal_rule(uuid, uuid, numeric, text, uuid, boolean),
  public.confirm_staff_meal(uuid, numeric)
  to authenticated;
