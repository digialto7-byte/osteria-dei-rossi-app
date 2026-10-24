-- M16 step 3: the audited procedures that write the rule settings (plan §3.1.1, §3.1.13, §3.2; ADR-015).
-- Every public function is security definer with an empty search_path, checks the role FIRST, takes the tenant from
-- app.tenant_id() and the user from app.app_user_id(), and filters every statement by tenant. The direct column grants
-- were revoked in 20261030100000, so these are the only way to change a setting. Each change writes one audit_event;
-- an unchanged value writes nothing and answers changed: false. Errors: 42501 (role), 22023 invalid_request (shape),
-- P0002 *_not_found, P0001 for the business codes.

-- Role gates (not executable by any API role; called from the definer procedures and reads).
create function app.require_rules_reader()
  returns void
  language plpgsql
  stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin', 'chef') then
    raise exception 'permission denied: rules need owner, admin or chef' using errcode = '42501';
  end if;
end
$$;

create function app.require_rules_writer()
  returns void
  language plpgsql
  stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin') then
    raise exception 'permission denied: rules settings need owner or admin' using errcode = '42501';
  end if;
end
$$;

-- A JSON number within [0, p_max] with at most p_dp decimals; JSON null or SQL null gives null. Anything else:
-- invalid_request (22023).
create function app.rules_numeric(p_val jsonb, p_max numeric, p_dp integer)
  returns numeric
  language plpgsql
  immutable
  set search_path = ''
as $$
declare
  v numeric;
begin
  if p_val is null or jsonb_typeof(p_val) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_val) <> 'number' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v := (p_val #>> '{}')::numeric;
  if v < 0 or v > p_max or v <> round(v, p_dp) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  return v;
end
$$;

-- A JSON whole number within [p_min, p_max]; JSON null or SQL null gives null. Anything else raises p_code (P0001).
create function app.rules_int(p_val jsonb, p_min integer, p_max integer, p_code text)
  returns integer
  language plpgsql
  immutable
  set search_path = ''
as $$
declare
  v numeric;
begin
  if p_val is null or jsonb_typeof(p_val) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_val) <> 'number' then
    raise exception '%', p_code using errcode = 'P0001';
  end if;
  v := (p_val #>> '{}')::numeric;
  if v <> trunc(v) or v < p_min or v > p_max then
    raise exception '%', p_code using errcode = 'P0001';
  end if;
  return v::integer;
end
$$;

-- The patch must be a non-empty object whose keys are all in p_allowed.
create function app.rules_patch_ok(p_patch jsonb, p_allowed text[])
  returns void
  language plpgsql
  immutable
  set search_path = ''
as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k <> all (p_allowed)) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
end
$$;

revoke all on function
  app.require_rules_reader(), app.require_rules_writer(), app.rules_numeric(jsonb, numeric, integer),
  app.rules_int(jsonb, integer, integer, text), app.rules_patch_ok(jsonb, text[])
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
create function public.set_ingredient_rules(p_ingredient uuid, p_patch jsonb)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  i public.ingredient;
  v_min numeric;
  v_target numeric;
  v_item_given boolean := false;
  v_item uuid;
  v_cur uuid;
  v_new uuid;
  s public.supplier_item;
  v_changed boolean;
begin
  perform app.require_rules_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  perform app.rules_patch_ok(p_patch, array['minLevel', 'targetLevel', 'preferredSupplierItemId']);

  if p_patch ? 'preferredSupplierItemId' then
    v_item_given := true;
    if jsonb_typeof(p_patch -> 'preferredSupplierItemId') = 'string'
       and (p_patch ->> 'preferredSupplierItemId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_item := (p_patch ->> 'preferredSupplierItemId')::uuid;
    elsif jsonb_typeof(p_patch -> 'preferredSupplierItemId') <> 'null' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
  end if;

  select x.* into i from public.ingredient x
   where x.tenant_id = v_tenant and x.id = p_ingredient
     for update;
  if not found then
    raise exception 'ingredient_not_found' using errcode = 'P0002';
  end if;
  if not i.is_stock then
    raise exception 'ingredient_not_stock' using errcode = 'P0001';
  end if;

  v_min := case when p_patch ? 'minLevel' then app.rules_numeric(p_patch -> 'minLevel', 100000, 4) else i.min_level end;
  v_target := case when p_patch ? 'targetLevel' then app.rules_numeric(p_patch -> 'targetLevel', 100000, 4) else i.target_level end;
  if v_min is not null and v_target is not null and v_target < v_min then
    raise exception 'levels_invalid' using errcode = 'P0001';
  end if;

  select si.id into v_cur from public.supplier_item si
   where si.tenant_id = v_tenant and si.ingredient_id = i.id and si.is_preferred and si.is_active;
  if v_item_given and v_item is not null then
    select si.* into s from public.supplier_item si
     where si.tenant_id = v_tenant and si.id = v_item and si.ingredient_id = i.id;
    if not found then
      raise exception 'supplier_item_not_found' using errcode = 'P0002';
    end if;
    if not s.is_active then
      raise exception 'supplier_item_inactive' using errcode = 'P0001';
    end if;
  end if;

  v_changed := v_min is distinct from i.min_level or v_target is distinct from i.target_level
               or (v_item_given and v_item is distinct from v_cur);
  if not v_changed then
    return jsonb_build_object('ingredientId', i.id, 'changed', false, 'minLevel', trim_scale(i.min_level),
                              'targetLevel', trim_scale(i.target_level), 'preferredSupplierItemId', v_cur);
  end if;

  update public.ingredient set min_level = v_min, target_level = v_target
   where tenant_id = v_tenant and id = i.id;
  if v_item_given and v_item is distinct from v_cur then
    -- Unset every other flagged item of this tenant's ingredient first (the unique index allows one active preferred).
    update public.supplier_item set is_preferred = false
     where tenant_id = v_tenant and ingredient_id = i.id and is_preferred and id is distinct from v_item;
    if v_item is not null then
      update public.supplier_item set is_preferred = true where tenant_id = v_tenant and id = v_item;
    end if;
  end if;
  v_new := case when v_item_given then v_item else v_cur end;

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
    values (v_tenant, 'ingredient', i.id, 'ingredient.rules_changed',
      jsonb_build_object('min_level', trim_scale(i.min_level), 'target_level', trim_scale(i.target_level),
                         'preferred_supplier_item_id', v_cur),
      jsonb_build_object('min_level', trim_scale(v_min), 'target_level', trim_scale(v_target),
                         'preferred_supplier_item_id', v_new),
      v_user);
  return jsonb_build_object('ingredientId', i.id, 'changed', true, 'minLevel', trim_scale(v_min),
                            'targetLevel', trim_scale(v_target), 'preferredSupplierItemId', v_new);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
create function public.set_supplier_delivery(p_supplier uuid, p_patch jsonb)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  s public.supplier;
  v_lead smallint;
  v_days smallint[];
  v_cut time;
  v_arr jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  perform app.require_rules_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  perform app.rules_patch_ok(p_patch, array['leadTimeDays', 'deliveryWeekdays', 'orderCutoffTime']);

  select x.* into s from public.supplier x
   where x.tenant_id = v_tenant and x.id = p_supplier
     for update;
  if not found then
    raise exception 'supplier_not_found' using errcode = 'P0002';
  end if;

  v_lead := case when p_patch ? 'leadTimeDays' then app.rules_int(p_patch -> 'leadTimeDays', 0, 365, 'lead_time_invalid')
                 else s.lead_time_days end;
  v_days := s.delivery_weekdays;
  if p_patch ? 'deliveryWeekdays' then
    v_arr := p_patch -> 'deliveryWeekdays';
    if jsonb_typeof(v_arr) <> 'array' or jsonb_array_length(v_arr) > 7
       or exists (select 1 from jsonb_array_elements(v_arr) e (v)
                   where case when jsonb_typeof(e.v) <> 'number' then true
                              else (e.v #>> '{}')::numeric not between 1 and 7
                                   or (e.v #>> '{}')::numeric <> trunc((e.v #>> '{}')::numeric) end) then
      raise exception 'weekdays_invalid' using errcode = 'P0001';
    end if;
    select coalesce(array_agg(((e.v #>> '{}')::numeric)::smallint order by (e.v #>> '{}')::numeric), '{}'::smallint[])
      into v_days from jsonb_array_elements(v_arr) e (v);
    if (select count(distinct d) from unnest(v_days) d) <> coalesce(array_length(v_days, 1), 0) then
      raise exception 'weekdays_invalid' using errcode = 'P0001';
    end if;
  end if;
  v_cut := s.order_cutoff_time;
  if p_patch ? 'orderCutoffTime' then
    if jsonb_typeof(p_patch -> 'orderCutoffTime') = 'null' then
      v_cut := null;
    elsif jsonb_typeof(p_patch -> 'orderCutoffTime') = 'string'
          and (p_patch ->> 'orderCutoffTime') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      v_cut := (p_patch ->> 'orderCutoffTime')::time;
    else
      raise exception 'cutoff_invalid' using errcode = 'P0001';
    end if;
  end if;

  v_before := jsonb_build_object('lead_time_days', s.lead_time_days, 'delivery_weekdays', to_jsonb(s.delivery_weekdays),
                                 'order_cutoff_time', to_char(s.order_cutoff_time, 'HH24:MI'));
  v_after := jsonb_build_object('lead_time_days', v_lead, 'delivery_weekdays', to_jsonb(v_days),
                                'order_cutoff_time', to_char(v_cut, 'HH24:MI'));
  if v_before is distinct from v_after then
    update public.supplier set lead_time_days = v_lead, delivery_weekdays = v_days, order_cutoff_time = v_cut
     where tenant_id = v_tenant and id = s.id;
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
      values (v_tenant, 'supplier', s.id, 'supplier.delivery_changed', v_before, v_after, v_user);
  end if;
  return jsonb_build_object('supplierId', s.id, 'changed', v_before is distinct from v_after, 'leadTimeDays', v_lead,
                            'deliveryWeekdays', to_jsonb(v_days), 'orderCutoffTime', to_char(v_cut, 'HH24:MI'));
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
create function public.set_recipe_rules(p_recipe_key uuid, p_patch jsonb)
  returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  k public.recipe_key;
  r public.recipe;
  v_min integer;
  v_target integer;
  v_prep integer;
  v_emin integer;
  v_etarget integer;
  v_changed boolean;
begin
  perform app.require_rules_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  perform app.rules_patch_ok(p_patch, array['minPortions', 'targetPortions', 'prepTimeMin']);

  select x.* into k from public.recipe_key x
   where x.tenant_id = v_tenant and x.id = p_recipe_key
     for update;
  if not found then
    raise exception 'recipe_not_found' using errcode = 'P0002';
  end if;
  if k.type <> 'batch' then
    raise exception 'recipe_not_batch' using errcode = 'P0001';
  end if;
  select x.* into r from public.recipe x
   where x.tenant_id = v_tenant and x.recipe_key = k.id and x.version = k.current_version;

  v_min := case when p_patch ? 'minPortions' then app.rules_int(p_patch -> 'minPortions', 0, 10000, 'portions_invalid')
                else k.rule_min_portions end;
  v_target := case when p_patch ? 'targetPortions' then app.rules_int(p_patch -> 'targetPortions', 0, 10000, 'portions_invalid')
                   else k.rule_target_portions end;
  v_prep := case when p_patch ? 'prepTimeMin' then app.rules_int(p_patch -> 'prepTimeMin', 0, 1440, 'prep_time_invalid')
                 else k.rule_prep_time_min end;
  v_emin := coalesce(v_min, r.min_portions);
  v_etarget := coalesce(v_target, r.target_portions);
  if v_emin is not null and v_etarget is not null and v_etarget < v_emin then
    raise exception 'portions_invalid' using errcode = 'P0001';
  end if;

  v_changed := v_min is distinct from k.rule_min_portions or v_target is distinct from k.rule_target_portions
               or v_prep is distinct from k.rule_prep_time_min;
  if v_changed then
    update public.recipe_key set rule_min_portions = v_min, rule_target_portions = v_target, rule_prep_time_min = v_prep
     where tenant_id = v_tenant and id = k.id;
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
      values (v_tenant, 'recipe', k.id, 'recipe.rules_changed',
        jsonb_build_object('rule_min_portions', k.rule_min_portions, 'rule_target_portions', k.rule_target_portions,
                           'rule_prep_time_min', k.rule_prep_time_min),
        jsonb_build_object('rule_min_portions', v_min, 'rule_target_portions', v_target, 'rule_prep_time_min', v_prep),
        v_user);
  end if;
  return jsonb_build_object('recipeKey', k.id, 'changed', v_changed,
    'minPortions', v_emin, 'targetPortions', v_etarget, 'prepTimeMin', coalesce(v_prep, r.prep_time_min),
    'sources', jsonb_build_object(
      'min', case when v_min is not null then 'rule' when r.min_portions is not null then 'version' end,
      'target', case when v_target is not null then 'rule' when r.target_portions is not null then 'version' end,
      'prep', case when v_prep is not null then 'rule' when r.prep_time_min is not null then 'version' end));
end
$$;

revoke all on function public.set_ingredient_rules(uuid, jsonb), public.set_supplier_delivery(uuid, jsonb),
  public.set_recipe_rules(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_ingredient_rules(uuid, jsonb), public.set_supplier_delivery(uuid, jsonb),
  public.set_recipe_rules(uuid, jsonb) to authenticated;
