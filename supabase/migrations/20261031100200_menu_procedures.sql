-- M17 step 3: create_menu_item and update_menu_item (M17 plan §3.1.1, §3.2; ADR-016).
-- Every public function is security definer with an empty search_path, checks the role FIRST (owner, admin), takes the
-- tenant from app.tenant_id() and the user from app.app_user_id(), and filters every statement by tenant. Errors:
-- 42501 (role), 22023 invalid_request (shape, unknown key, wrong JSON type), P0002 *_not_found, P0001 for the business
-- codes (the API maps them to 409 or 422). A price or VAT change inserts a menu_item_price row (the history is
-- append-only); every change writes one audit_event; a patch that changes nothing writes nothing.

-- ---------------------------------------------------------------------------------------------------------------------
-- Value parsers (not executable by an API role).
-- A JSON string, trimmed, 1..p_max characters; a non-string is invalid_request, a bad length raises p_code.
create function app.menu_text(p_val jsonb, p_max integer, p_code text) returns text
  language plpgsql
  immutable
  set search_path = ''
as $$
declare
  v text;
begin
  if p_val is null or jsonb_typeof(p_val) <> 'string' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v := btrim(p_val #>> '{}');
  if char_length(v) < 1 or char_length(v) > p_max then
    raise exception '%', p_code using errcode = 'P0001';
  end if;
  return v;
end
$$;

-- A JSON number 0..10 000 with at most two decimals.
create function app.menu_price(p_val jsonb) returns numeric
  language plpgsql
  immutable
  set search_path = ''
as $$
declare
  v numeric;
begin
  if p_val is null or jsonb_typeof(p_val) <> 'number' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v := (p_val #>> '{}')::numeric;
  if v < 0 or v > 10000 or v <> round(v, 2) then
    raise exception 'price_invalid' using errcode = 'P0001';
  end if;
  return v;
end
$$;

-- A JSON number in the allowed VAT list.
create function app.menu_vat(p_val jsonb, p_code text) returns numeric
  language plpgsql
  immutable
  set search_path = ''
as $$
declare
  v numeric;
begin
  if p_val is null or jsonb_typeof(p_val) <> 'number' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v := (p_val #>> '{}')::numeric;
  if not (v = any (app.allowed_vat_rates())) then
    raise exception '%', p_code using errcode = 'P0001';
  end if;
  return v;
end
$$;

-- A JSON whole number p_min..p_max.
create function app.menu_int(p_val jsonb, p_min integer, p_max integer, p_code text) returns integer
  language plpgsql
  immutable
  set search_path = ''
as $$
declare
  v numeric;
begin
  if p_val is null or jsonb_typeof(p_val) <> 'number' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v := (p_val #>> '{}')::numeric;
  if v <> trunc(v) or v < p_min or v > p_max then
    raise exception '%', p_code using errcode = 'P0001';
  end if;
  return v::integer;
end
$$;

create function app.menu_bool(p_val jsonb) returns boolean
  language plpgsql
  immutable
  set search_path = ''
as $$
begin
  if p_val is null or jsonb_typeof(p_val) <> 'boolean' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  return (p_val #>> '{}')::boolean;
end
$$;

-- A JSON uuid string, or JSON null (gives null).
create function app.menu_uuid_or_null(p_val jsonb) returns uuid
  language plpgsql
  immutable
  set search_path = ''
as $$
begin
  if p_val is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if jsonb_typeof(p_val) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_val) <> 'string'
     or (p_val #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  return (p_val #>> '{}')::uuid;
end
$$;

-- The course word of a JSON string; anything else is invalid_request.
create function app.menu_course(p_val jsonb) returns public.course
  language plpgsql
  immutable
  set search_path = ''
as $$
begin
  if p_val is null or jsonb_typeof(p_val) <> 'string'
     or not ((p_val #>> '{}') = any (array(select e::text from unnest(enum_range(null::public.course)) e))) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  return (p_val #>> '{}')::public.course;
end
$$;

-- The body or patch must be a JSON object whose keys are all in p_allowed (and, when p_required is given, include them).
create function app.menu_keys_ok(p_obj jsonb, p_allowed text[], p_required text[]) returns void
  language plpgsql
  immutable
  set search_path = ''
as $$
begin
  if p_obj is null or jsonb_typeof(p_obj) <> 'object' or p_obj = '{}'::jsonb then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_obj) k where k <> all (p_allowed)) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_required is not null and exists (select 1 from unnest(p_required) r where not (p_obj ? r)) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
end
$$;

-- The recipe a menu item may map: an active plate of the tenant. Unknown (or another tenant's) key: recipe_not_found.
create function app.menu_check_recipe(p_tenant uuid, p_key uuid) returns void
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  k public.recipe_key;
begin
  select x.* into k from public.recipe_key x where x.tenant_id = p_tenant and x.id = p_key;
  if not found then
    raise exception 'recipe_not_found' using errcode = 'P0002';
  end if;
  if k.type::text <> 'plate' then
    raise exception 'recipe_not_plate' using errcode = 'P0001';
  end if;
  if not k.is_active then
    raise exception 'recipe_inactive' using errcode = 'P0001';
  end if;
end
$$;

-- The manage shape of menu items (all of the tenant's when p_ids is null): active first, then position, name, id.
-- The price is the row in force right now (clock_timestamp, so a row written earlier in the same transaction counts).
-- The recipe name is the current version's. No cost, margin or GP key (owner costs stay on /costi).
create function app.menu_items_json(p_tenant uuid, p_ids uuid[]) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id,
           'name', i.name,
           'category', i.category,
           'course', i.course_default::text,
           'position', i.position,
           'recipeKey', i.recipe_key,
           'recipeName', r.name,
           'recipeActive', k.is_active,
           'unmapped', i.recipe_key is null,
           'price', trim_scale(pr.price),
           'vatRate', trim_scale(pr.vat_rate),
           'priceValidFrom', pr.valid_from,
           'available', i.is_available,
           'active', i.is_active,
           'pushUntil', i.push_until,
           'pushPrice', trim_scale(i.push_price))
         order by i.is_active desc, i.position, i.name collate "C", i.id), '[]'::jsonb)
    from public.menu_item i
    left join public.recipe_key k on k.tenant_id = i.tenant_id and k.id = i.recipe_key
    left join public.recipe r on r.tenant_id = k.tenant_id and r.recipe_key = k.id and r.version = k.current_version
    left join app.menu_item_price_at(
           p_tenant, coalesce(p_ids, array(select m.id from public.menu_item m where m.tenant_id = p_tenant)),
           clock_timestamp()) pr on pr.menu_item_id = i.id
   where i.tenant_id = p_tenant and (p_ids is null or i.id = any (p_ids))
$$;

revoke all on function
  app.menu_text(jsonb, integer, text), app.menu_price(jsonb), app.menu_vat(jsonb, text),
  app.menu_int(jsonb, integer, integer, text), app.menu_bool(jsonb), app.menu_uuid_or_null(jsonb),
  app.menu_course(jsonb), app.menu_keys_ok(jsonb, text[], text[]), app.menu_check_recipe(uuid, uuid),
  app.menu_items_json(uuid, uuid[])
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
create function public.create_menu_item(p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_name text;
  v_category text;
  v_course public.course;
  v_recipe uuid;
  v_price numeric;
  v_vat numeric;
  v_position integer := 0;
  v_available boolean := true;
  v_id uuid;
  v_con text;
begin
  perform app.require_menu_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  perform app.menu_keys_ok(p_body,
    array['name', 'category', 'course', 'recipeKey', 'price', 'vatRate', 'position', 'available'],
    array['name', 'category', 'course', 'recipeKey', 'price', 'vatRate']);

  v_name := app.menu_text(p_body -> 'name', 80, 'name_invalid');
  v_category := app.menu_text(p_body -> 'category', 40, 'category_invalid');
  v_course := app.menu_course(p_body -> 'course');
  v_recipe := app.menu_uuid_or_null(p_body -> 'recipeKey');
  v_price := app.menu_price(p_body -> 'price');
  v_vat := app.menu_vat(p_body -> 'vatRate', 'vat_rate_invalid');
  if p_body ? 'position' then
    v_position := app.menu_int(p_body -> 'position', 0, 9999, 'position_invalid');
  end if;
  if p_body ? 'available' then
    v_available := app.menu_bool(p_body -> 'available');
  end if;

  if v_recipe is not null then
    perform app.menu_check_recipe(v_tenant, v_recipe);
    if exists (select 1 from public.menu_item o
                where o.tenant_id = v_tenant and o.is_active and o.recipe_key = v_recipe) then
      raise exception 'recipe_already_on_menu' using errcode = 'P0001';
    end if;
  end if;
  if exists (select 1 from public.menu_item o
              where o.tenant_id = v_tenant and o.is_active and o.name_norm = app.normalise_name(v_name)) then
    raise exception 'menu_item_name_taken' using errcode = 'P0001';
  end if;

  begin
    insert into public.menu_item (tenant_id, name, category, course_default, recipe_key, position, is_available,
                                  created_by, updated_by)
      values (v_tenant, v_name, v_category, v_course, v_recipe, v_position, v_available, v_user, v_user)
      returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'menu_item_recipe_uq' then
      raise exception 'recipe_already_on_menu' using errcode = 'P0001';
    elsif v_con = 'menu_item_name_uq' then
      raise exception 'menu_item_name_taken' using errcode = 'P0001';
    end if;
    raise;
  end;
  insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, created_by)
    values (v_tenant, v_id, v_price, v_vat, v_user);

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values (v_tenant, 'menu_item', v_id, 'menu_item.created',
      jsonb_build_object('name', v_name, 'category', v_category, 'course_default', v_course::text,
                         'recipe_key', v_recipe, 'position', v_position, 'is_available', v_available,
                         'price', trim_scale(v_price), 'vat_rate', trim_scale(v_vat)),
      v_user);
  return jsonb_build_object('item', (app.menu_items_json(v_tenant, array[v_id])) -> 0);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
create function public.update_menu_item(p_item uuid, p_patch jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  m public.menu_item;
  v_cur_price numeric;
  v_cur_vat numeric;
  v_name text;
  v_category text;
  v_course public.course;
  v_recipe uuid;
  v_price numeric;
  v_vat numeric;
  v_position integer;
  v_available boolean;
  v_active boolean;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_row_changed boolean := false;
  v_price_changed boolean := false;
  v_con text;
begin
  perform app.require_menu_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  perform app.menu_keys_ok(p_patch,
    array['name', 'category', 'course', 'recipeKey', 'price', 'vatRate', 'position', 'available', 'active'], null);

  select x.* into m from public.menu_item x
   where x.tenant_id = v_tenant and x.id = p_item
     for update;
  if not found then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  select pr.price, pr.vat_rate into v_cur_price, v_cur_vat
    from app.menu_item_price_at(v_tenant, array[m.id], clock_timestamp()) pr;

  v_name := case when p_patch ? 'name' then app.menu_text(p_patch -> 'name', 80, 'name_invalid') else m.name end;
  v_category := case when p_patch ? 'category' then app.menu_text(p_patch -> 'category', 40, 'category_invalid')
                     else m.category end;
  v_course := case when p_patch ? 'course' then app.menu_course(p_patch -> 'course') else m.course_default end;
  v_recipe := case when p_patch ? 'recipeKey' then app.menu_uuid_or_null(p_patch -> 'recipeKey') else m.recipe_key end;
  v_price := case when p_patch ? 'price' then app.menu_price(p_patch -> 'price') else v_cur_price end;
  v_vat := case when p_patch ? 'vatRate' then app.menu_vat(p_patch -> 'vatRate', 'vat_rate_invalid') else v_cur_vat end;
  v_position := case when p_patch ? 'position' then app.menu_int(p_patch -> 'position', 0, 9999, 'position_invalid')
                     else m.position end;
  v_available := case when p_patch ? 'available' then app.menu_bool(p_patch -> 'available') else m.is_available end;
  v_active := case when p_patch ? 'active' then app.menu_bool(p_patch -> 'active') else m.is_active end;

  -- A new mapping must be an active plate; an unchanged mapping is kept even when the recipe was deactivated later.
  if v_recipe is not null and v_recipe is distinct from m.recipe_key then
    perform app.menu_check_recipe(v_tenant, v_recipe);
  end if;
  -- Uniqueness among active items is re-checked when the item is (re)activated or the key or the name changes.
  if v_active and v_recipe is not null and (v_recipe is distinct from m.recipe_key or not m.is_active)
     and exists (select 1 from public.menu_item o
                  where o.tenant_id = v_tenant and o.is_active and o.recipe_key = v_recipe and o.id <> m.id) then
    raise exception 'recipe_already_on_menu' using errcode = 'P0001';
  end if;
  if v_active and (app.normalise_name(v_name) <> m.name_norm or not m.is_active)
     and exists (select 1 from public.menu_item o
                  where o.tenant_id = v_tenant and o.is_active and o.name_norm = app.normalise_name(v_name)
                    and o.id <> m.id) then
    raise exception 'menu_item_name_taken' using errcode = 'P0001';
  end if;

  if v_name is distinct from m.name then
    v_before := v_before || jsonb_build_object('name', m.name);
    v_after := v_after || jsonb_build_object('name', v_name);
  end if;
  if v_category is distinct from m.category then
    v_before := v_before || jsonb_build_object('category', m.category);
    v_after := v_after || jsonb_build_object('category', v_category);
  end if;
  if v_course is distinct from m.course_default then
    v_before := v_before || jsonb_build_object('course_default', m.course_default::text);
    v_after := v_after || jsonb_build_object('course_default', v_course::text);
  end if;
  if v_recipe is distinct from m.recipe_key then
    v_before := v_before || jsonb_build_object('recipe_key', m.recipe_key);
    v_after := v_after || jsonb_build_object('recipe_key', v_recipe);
  end if;
  if v_position is distinct from m.position then
    v_before := v_before || jsonb_build_object('position', m.position);
    v_after := v_after || jsonb_build_object('position', v_position);
  end if;
  if v_available is distinct from m.is_available then
    v_before := v_before || jsonb_build_object('is_available', m.is_available);
    v_after := v_after || jsonb_build_object('is_available', v_available);
  end if;
  if v_active is distinct from m.is_active then
    v_before := v_before || jsonb_build_object('is_active', m.is_active);
    v_after := v_after || jsonb_build_object('is_active', v_active);
  end if;
  v_row_changed := v_before <> '{}'::jsonb;
  if v_price is distinct from v_cur_price then
    v_price_changed := true;
    v_before := v_before || jsonb_build_object('price', trim_scale(v_cur_price));
    v_after := v_after || jsonb_build_object('price', trim_scale(v_price));
  end if;
  if v_vat is distinct from v_cur_vat then
    v_price_changed := true;
    v_before := v_before || jsonb_build_object('vat_rate', trim_scale(v_cur_vat));
    v_after := v_after || jsonb_build_object('vat_rate', trim_scale(v_vat));
  end if;

  if not v_row_changed and not v_price_changed then
    return jsonb_build_object('changed', false, 'item', (app.menu_items_json(v_tenant, array[m.id])) -> 0);
  end if;

  if v_row_changed then
    begin
      update public.menu_item
         set name = v_name, category = v_category, course_default = v_course, recipe_key = v_recipe,
             position = v_position, is_available = v_available, is_active = v_active,
             updated_at = now(), updated_by = v_user
       where tenant_id = v_tenant and id = m.id;
    exception when unique_violation then
      get stacked diagnostics v_con = constraint_name;
      if v_con = 'menu_item_recipe_uq' then
        raise exception 'recipe_already_on_menu' using errcode = 'P0001';
      elsif v_con = 'menu_item_name_uq' then
        raise exception 'menu_item_name_taken' using errcode = 'P0001';
      end if;
      raise;
    end;
  end if;
  if v_price_changed then
    -- Strictly after every earlier row of the item, the M8 pattern.
    insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
      values (v_tenant, m.id, v_price, v_vat,
              greatest(clock_timestamp(),
                       coalesce((select max(p.valid_from) from public.menu_item_price p
                                  where p.tenant_id = v_tenant and p.menu_item_id = m.id), '-infinity'::timestamptz)
                       + interval '1 microsecond'),
              v_user);
  end if;

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
    values (v_tenant, 'menu_item', m.id, 'menu_item.updated', v_before, v_after, v_user);
  return jsonb_build_object('changed', true, 'item', (app.menu_items_json(v_tenant, array[m.id])) -> 0);
end
$$;

revoke all on function public.create_menu_item(jsonb), public.update_menu_item(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_menu_item(jsonb), public.update_menu_item(uuid, jsonb) to authenticated;
