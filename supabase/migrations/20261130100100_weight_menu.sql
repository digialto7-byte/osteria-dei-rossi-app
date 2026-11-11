-- P2-0b A2 (sell by weight, plan §3.1 P-2, P-3, P-4, P-5, §3.3, §5 A2): the price unit and the reference portion weight on the menu item,
-- the tenant's maximum-weight setting and its two procedures, the sale terms read, the waiter menu, and the plate margin and plate cost reads.
--
--   app.menu_item_sale_terms_at   menu_item_price_at + price_unit + portion_weight_g (menu_item_price_at itself is unchanged: it is pinned)
--   public.weight_settings, public.set_weight_settings   owner/admin only; the maximum weight per line lives in sale_settings.weight_max_g
--   create_menu_item, update_menu_item, app.menu_items_json   priceUnit and portionWeightG (the M17 bodies with the weight rules added)
--   public.menu_list              items + priceUnit, portionWeightG, weightLeftG; top level + weightMaxG
--   app.plate_cost_rows           an etto price in force is priced as its reference portion (price x portion weight / 100, rounded once)
--   public.plate_costs            + price_unit, price_per_100g, portion_weight_g per plate. A function's output columns cannot change with
--                                 create or replace, so it is dropped and created again with the same arguments and grants.
--   public.plate_breakdown        the money block (owner and admin only) + salePriceEur, priceUnit, pricePer100g, portionWeightG. The chef's
--                                 reply is unchanged: it carries no price key (pgTAP 181 scans for one).
-- "Sold by weight" is derived: the unit of the price row in force (P-3). Nothing is granted on a table; no table is created.

create function app.menu_item_sale_terms_at(p_tenant uuid, p_items uuid[], p_at timestamptz)
  returns table (menu_item_id uuid, price numeric, vat_rate numeric, valid_from timestamptz, price_unit text, portion_weight_g integer)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select distinct on (p.menu_item_id) p.menu_item_id, p.price, p.vat_rate, p.valid_from, p.price_unit, i.portion_weight_g
    from public.menu_item_price p
    join public.menu_item i on i.tenant_id = p.tenant_id and i.id = p.menu_item_id
   where p.tenant_id = p_tenant and p.menu_item_id = any (p_items) and p.valid_from <= p_at
   order by p.menu_item_id, p.valid_from desc
$$;
revoke all on function app.menu_item_sale_terms_at(uuid, uuid[], timestamptz) from public, anon, authenticated, service_role;

create or replace function app.menu_items_json(p_tenant uuid, p_ids uuid[]) returns jsonb
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
           'priceUnit', pr.price_unit,
           'portionWeightG', i.portion_weight_g,
           'priceValidFrom', pr.valid_from,
           'available', i.is_available,
           'active', i.is_active,
           'pushUntil', i.push_until,
           'pushPrice', trim_scale(i.push_price))
         order by i.is_active desc, i.position, i.name collate "C", i.id), '[]'::jsonb)
    from public.menu_item i
    left join public.recipe_key k on k.tenant_id = i.tenant_id and k.id = i.recipe_key
    left join public.recipe r on r.tenant_id = k.tenant_id and r.recipe_key = k.id and r.version = k.current_version
    left join app.menu_item_sale_terms_at(
           p_tenant, coalesce(p_ids, array(select m.id from public.menu_item m where m.tenant_id = p_tenant)),
           clock_timestamp()) pr on pr.menu_item_id = i.id
   where i.tenant_id = p_tenant and (p_ids is null or i.id = any (p_ids))
$$;


-- ---------------------------------------------------------------------------------------------------------------------
-- The maximum weight per line (P-4, L-5): read and written by owner/admin only.
create function public.weight_settings() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_menu_writer();
  return jsonb_build_object(
    'weightMaxG', app.weight_max_g(app.tenant_id()),
    'defaultWeightMaxG', app.default_weight_max_g(),
    'minWeightG', app.weight_min_g(),
    'stepG', app.weight_step_g(),
    'settingMinG', (select b.min_g from app.weight_max_setting_bounds() b),
    'settingMaxG', (select b.max_g from app.weight_max_setting_bounds() b));
end
$$;

-- Body {weightMaxG: integer | null}, the key required; null = back to the app default. An identical value changes nothing.
create function public.set_weight_settings(p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_raw numeric;
  v_new integer;
  v_min integer;
  v_max integer;
  s public.sale_settings;
  v_found boolean;
  v_id uuid;
begin
  perform app.require_menu_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  perform app.menu_keys_ok(p_body, array['weightMaxG'], array['weightMaxG']);
  select b.min_g, b.max_g into v_min, v_max from app.weight_max_setting_bounds() b;

  if jsonb_typeof(p_body -> 'weightMaxG') = 'number' then
    v_raw := (p_body ->> 'weightMaxG')::numeric;
    if v_raw <> trunc(v_raw) or v_raw < v_min or v_raw > v_max or v_raw % 10 <> 0 then
      raise exception 'weight_max_invalid' using errcode = 'P0001';
    end if;
    v_new := v_raw::integer;
  elsif jsonb_typeof(p_body -> 'weightMaxG') <> 'null' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- One writer per tenant at a time: the settings row may not exist yet, so the tenant row is the lock (as set_sale_settings).
  perform 1 from public.tenant t where t.id = v_tenant for no key update;
  select x.* into s from public.sale_settings x where x.tenant_id = v_tenant;
  v_found := found;
  if (not v_found and v_new is null) or (v_found and s.weight_max_g is not distinct from v_new) then
    return jsonb_build_object('changed', false, 'weightMaxG', app.weight_max_g(v_tenant));
  end if;

  if v_found then
    update public.sale_settings
       set weight_max_g = v_new, updated_at = now(), updated_by = v_user
     where tenant_id = v_tenant
     returning id into v_id;
  else
    insert into public.sale_settings (tenant_id, weight_max_g, created_by, updated_by)
      values (v_tenant, v_new, v_user, v_user)
      returning id into v_id;
  end if;
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
    values (v_tenant, 'sale_settings', v_id, 'sale_settings.changed',
      jsonb_build_object('weight_max_g', s.weight_max_g), jsonb_build_object('weight_max_g', v_new), v_user);
  return jsonb_build_object('changed', true, 'weightMaxG', app.weight_max_g(v_tenant));
end
$$;

revoke all on function public.weight_settings(), public.set_weight_settings(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.weight_settings(), public.set_weight_settings(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.create_menu_item(p_body jsonb) returns jsonb
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
  v_unit text := 'portion';
  v_pw integer;
  v_position integer := 0;
  v_available boolean := true;
  v_id uuid;
  v_con text;
begin
  perform app.require_menu_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  perform app.menu_keys_ok(p_body,
    array['name', 'category', 'course', 'recipeKey', 'price', 'vatRate', 'position', 'available', 'priceUnit', 'portionWeightG'],
    array['name', 'category', 'course', 'recipeKey', 'price', 'vatRate']);

  v_name := app.menu_text(p_body -> 'name', 80, 'name_invalid');
  v_category := app.menu_text(p_body -> 'category', 40, 'category_invalid');
  v_course := app.menu_course(p_body -> 'course');
  v_recipe := app.menu_uuid_or_null(p_body -> 'recipeKey');
  v_price := app.menu_price(p_body -> 'price');
  v_vat := app.menu_vat(p_body -> 'vatRate', 'vat_rate_invalid');
  if p_body ? 'priceUnit' then
    if jsonb_typeof(p_body -> 'priceUnit') <> 'string' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    v_unit := p_body ->> 'priceUnit';
    if v_unit not in ('portion', 'etto') then
      raise exception 'price_unit_invalid' using errcode = 'P0001';
    end if;
  end if;
  if p_body ? 'portionWeightG' and jsonb_typeof(p_body -> 'portionWeightG') <> 'null' then
    v_pw := app.menu_int(p_body -> 'portionWeightG', 10, 3000, 'portion_weight_invalid');
  end if;
  -- P-2: a dish sold per etto needs the grams that make one portion of its recipe.
  if v_unit = 'etto' and v_pw is null then
    raise exception 'portion_weight_missing' using errcode = 'P0001';
  end if;
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
                                  portion_weight_g, created_by, updated_by)
      values (v_tenant, v_name, v_category, v_course, v_recipe, v_position, v_available, v_pw, v_user, v_user)
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
  insert into public.menu_item_price (tenant_id, menu_item_id, price, price_unit, vat_rate, created_by)
    values (v_tenant, v_id, v_price, v_unit, v_vat, v_user);

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values (v_tenant, 'menu_item', v_id, 'menu_item.created',
      jsonb_build_object('name', v_name, 'category', v_category, 'course_default', v_course::text,
                         'recipe_key', v_recipe, 'position', v_position, 'is_available', v_available,
                         'price', trim_scale(v_price), 'vat_rate', trim_scale(v_vat),
                         'price_unit', v_unit, 'portion_weight_g', v_pw),
      v_user);
  return jsonb_build_object('item', (app.menu_items_json(v_tenant, array[v_id])) -> 0);
end
$$;

create or replace function public.update_menu_item(p_item uuid, p_patch jsonb) returns jsonb
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
  v_cur_unit text;
  v_unit text;
  v_pw integer;
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
    array['name', 'category', 'course', 'recipeKey', 'price', 'vatRate', 'position', 'available', 'active', 'priceUnit', 'portionWeightG'], null);

  select x.* into m from public.menu_item x
   where x.tenant_id = v_tenant and x.id = p_item
     for update;
  if not found then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  select pr.price, pr.vat_rate, pr.price_unit into v_cur_price, v_cur_vat, v_cur_unit
    from app.menu_item_sale_terms_at(v_tenant, array[m.id], clock_timestamp()) pr;

  v_name := case when p_patch ? 'name' then app.menu_text(p_patch -> 'name', 80, 'name_invalid') else m.name end;
  v_category := case when p_patch ? 'category' then app.menu_text(p_patch -> 'category', 40, 'category_invalid')
                     else m.category end;
  v_course := case when p_patch ? 'course' then app.menu_course(p_patch -> 'course') else m.course_default end;
  v_recipe := case when p_patch ? 'recipeKey' then app.menu_uuid_or_null(p_patch -> 'recipeKey') else m.recipe_key end;
  v_price := case when p_patch ? 'price' then app.menu_price(p_patch -> 'price') else v_cur_price end;
  v_vat := case when p_patch ? 'vatRate' then app.menu_vat(p_patch -> 'vatRate', 'vat_rate_invalid') else v_cur_vat end;
  v_unit := coalesce(v_cur_unit, 'portion');
  if p_patch ? 'priceUnit' then
    if jsonb_typeof(p_patch -> 'priceUnit') <> 'string' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    v_unit := p_patch ->> 'priceUnit';
    if v_unit not in ('portion', 'etto') then
      raise exception 'price_unit_invalid' using errcode = 'P0001';
    end if;
  end if;
  v_pw := m.portion_weight_g;
  if p_patch ? 'portionWeightG' then
    v_pw := case when jsonb_typeof(p_patch -> 'portionWeightG') = 'null' then null
                 else app.menu_int(p_patch -> 'portionWeightG', 10, 3000, 'portion_weight_invalid') end;
  end if;
  -- P-3: switching to or from weight needs a new price in the same request, so the history says what each number meant.
  if v_unit is distinct from coalesce(v_cur_unit, 'portion') and not (p_patch ? 'price') then
    raise exception 'price_required' using errcode = 'P0001';
  end if;
  -- P-2: a dish sold per etto needs the grams that make one portion of its recipe.
  if v_unit = 'etto' and v_pw is null then
    raise exception 'portion_weight_missing' using errcode = 'P0001';
  end if;
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
  if v_pw is distinct from m.portion_weight_g then
    v_before := v_before || jsonb_build_object('portion_weight_g', m.portion_weight_g);
    v_after := v_after || jsonb_build_object('portion_weight_g', v_pw);
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
  if v_unit is distinct from coalesce(v_cur_unit, 'portion') then
    v_price_changed := true;
    v_before := v_before || jsonb_build_object('price_unit', coalesce(v_cur_unit, 'portion'));
    v_after := v_after || jsonb_build_object('price_unit', v_unit);
  end if;

  if not v_row_changed and not v_price_changed then
    return jsonb_build_object('changed', false, 'item', (app.menu_items_json(v_tenant, array[m.id])) -> 0);
  end if;

  if v_row_changed then
    begin
      update public.menu_item
         set name = v_name, category = v_category, course_default = v_course, recipe_key = v_recipe,
             portion_weight_g = v_pw, position = v_position, is_available = v_available, is_active = v_active,
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
    insert into public.menu_item_price (tenant_id, menu_item_id, price, price_unit, vat_rate, valid_from, created_by)
      values (v_tenant, m.id, v_price, v_unit, v_vat,
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

-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.menu_list() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  perform app.require_service_reader();
  v_tenant := app.tenant_id();
  with av as (
    select a.* from app.menu_item_availability(v_tenant, null, v_now) a
  ), shown as (
    select i.category, i.position, i.name, i.id, i.push_until,
           jsonb_build_object(
             'id', i.id,
             'name', i.name,
             'category', i.category,
             'course', i.course_default::text,
             'price', trim_scale(pr.price),
             'priceUnit', pr.price_unit,
             'portionWeightG', case when pr.price_unit = 'etto' then pr.portion_weight_g end,
             'weightLeftG', case when pr.price_unit = 'etto' and a.portions_left is not null
                                 then floor(a.portions_left * pr.portion_weight_g)::integer end,
             'available', a.available,
             'unavailableReason', a.reason,
             'portionsLeft', trim_scale(a.portions_left),
             'lowStock', a.low_stock,
             'pushed', coalesce(i.push_until > v_now, false),
             'pushPrice', case when i.push_until > v_now then trim_scale(i.push_price) end) as item
      from public.menu_item i
      join av a on a.menu_item_id = i.id
      join app.menu_item_sale_terms_at(
             v_tenant, array(select m.id from public.menu_item m where m.tenant_id = v_tenant and m.is_active), v_now) pr
        on pr.menu_item_id = i.id
     where i.tenant_id = v_tenant and i.is_active
  )
  select jsonb_build_object(
           'weightMaxG', app.weight_max_g(v_tenant),
           'pinned', coalesce((select jsonb_agg(s.item order by s.position, s.name collate "C", s.id)
                                 from shown s where s.push_until > v_now), '[]'::jsonb),
           'categories', coalesce((
             select jsonb_agg(jsonb_build_object('name', c.category, 'items', c.items) order by c.min_pos, c.category collate "C")
               from (select s.category, min(s.position) as min_pos,
                            jsonb_agg(s.item order by s.position, s.name collate "C", s.id) as items
                       from shown s
                      group by s.category) c), '[]'::jsonb))
    into v_result;
  return v_result;
end
$$;

create or replace function app.plate_cost_rows(
  p_tenant uuid, p_keys uuid[], p_date date, p_include_fixed boolean default true
) returns table (recipe_key uuid, name text, version integer, food_cost numeric, fixed_cost numeric,
                 full_cost numeric, sale_price numeric, vat_pct numeric, sale_price_ex_vat numeric,
                 gross_margin numeric, net_margin numeric, food_cost_pct numeric, gp_pct numeric,
                 target_gp_pct numeric, fixed_cost_allocated boolean, status text, reasons text[],
                 missing_ingredient_ids uuid[])
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_tz text;
  v_at timestamptz;
  v_vat numeric;
  v_fixed numeric;
begin
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  select s.sale_vat_pct into v_vat from app.cost_settings(p_tenant) s;
  v_at := case when p_date is null then null else app.venue_day_end(p_date, v_tz) end;
  if p_include_fixed then
    select f.per_plate into v_fixed
      from app.fixed_cost_at(p_tenant, coalesce(p_date, app.venue_date(now(), v_tz))) f;
  end if;

  return query
  select b.rkey, b.rname, b.rversion, b.food, v_fixed, x.full_c, b.price, b.vat, e.pex, x.gm, x.nm,
         x.fcp, x.gp, b.target, case when p_include_fixed then v_fixed is not null end, s.st,
         b.creasons || case when b.price is null or b.price <= 0 then array['no_sale_price'] else '{}'::text[] end,
         b.cmissing
    from (
      select c.recipe_key as rkey, c.name as rname, c.version as rversion, c.total_cost as food,
             c.incomplete as cinc, c.reasons as creasons, c.missing_ingredient_ids as cmissing,
             case when m.menu_price is not null then m.menu_price else rp.sale_price end as price,
             case when m.menu_price is not null then trim_scale(m.menu_vat) else v_vat end as vat,
             rp.target_gp_pct as target
        from app.recipe_costs(p_tenant,
               coalesce(p_keys, array(select k.id from public.recipe_key k
                                       where k.tenant_id = p_tenant and k.type = 'plate' and k.is_active)),
               v_at) c
        left join public.recipe_price rp on rp.tenant_id = p_tenant and rp.recipe_id = c.recipe_id
        left join lateral (
          select case when pr.price_unit = 'etto' then app.weight_line_price(pr.price, pr.portion_weight_g)
                      else pr.price end as menu_price, pr.vat_rate as menu_vat
            from public.menu_item mi
            join app.menu_item_sale_terms_at(p_tenant, array[mi.id], coalesce(v_at, clock_timestamp())) pr
              on pr.menu_item_id = mi.id
           where mi.tenant_id = p_tenant and mi.is_active and mi.recipe_key = c.recipe_key
           limit 1
        ) m on true
       where c.type = 'plate'
    ) b
   cross join lateral (select case when b.price > 0 then b.price / (1 + b.vat / 100) end as pex) e
   cross join lateral (
     select b.food + v_fixed as full_c,
            e.pex - b.food as gm,
            e.pex - (b.food + v_fixed) as nm,
            b.food / e.pex * 100 as fcp,
            (e.pex - b.food) / e.pex * 100 as gp
   ) x
   cross join lateral (
     select case when b.cinc or e.pex is null then 'incomplete'
                 when x.gp < b.target then 'below_target'
                 when p_include_fixed and v_fixed is null then 'fixed_cost_unallocated'
                 else 'ok' end as st
   ) s;
end
$$;

drop function public.plate_costs(date);
create function public.plate_costs(p_date date default null)
  returns table (recipe_key uuid, name text, version integer, food_cost_eur numeric,
                 fixed_cost_eur numeric, full_cost_eur numeric, sale_price_eur numeric, vat_pct numeric,
                 sale_price_ex_vat_eur numeric, gross_margin_eur numeric, net_margin_eur numeric,
                 food_cost_pct numeric, gp_pct numeric, target_gp_pct numeric,
                 fixed_cost_allocated boolean, status text, reasons text[],
                 missing_ingredient_ids uuid[], price_unit text, price_per_100g numeric, portion_weight_g integer)
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
  select p.recipe_key, p.name, p.version, round(p.food_cost, 4), round(p.fixed_cost, 4),
         round(p.full_cost, 4), p.sale_price, p.vat_pct, round(p.sale_price_ex_vat, 4),
         round(p.gross_margin, 4), round(p.net_margin, 4), round(p.food_cost_pct, 4), round(p.gp_pct, 4),
         p.target_gp_pct, p.fixed_cost_allocated, p.status, p.reasons, p.missing_ingredient_ids,
         t.price_unit, case when t.price_unit = 'etto' then t.price end, case when t.price_unit = 'etto' then t.portion_weight_g end
    from app.plate_cost_rows(v_tenant, null, p_date, app.role() = 'owner') p
    left join lateral (
      select x.price_unit, x.price, x.portion_weight_g
        from public.menu_item mi
        join app.menu_item_sale_terms_at(v_tenant, array[mi.id],
               case when p_date is null then clock_timestamp() else app.venue_day_end(p_date, v_tz) end) x
          on x.menu_item_id = mi.id
       where mi.tenant_id = v_tenant and mi.is_active and mi.recipe_key = p.recipe_key
       limit 1
    ) t on true
   order by p.name collate "C", p.recipe_key;
end
$$;

create or replace function public.plate_breakdown(p_key uuid, p_date date default null) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tz text;
  v_at timestamptz;
  v_money boolean;
  v_cost record;
  v_plate record;
  v_terms record;
  v_lines jsonb;
  v_out jsonb;
begin
  perform app.require_margin_reader();
  v_money := app.role() in ('owner', 'admin');
  v_tenant := app.tenant_id();
  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;
  -- The chef reads now (V6 gives the chef the current percentages only): a day other than the venue's today is refused
  -- here, not only by the route. Checked before the future-day rule so the chef cannot tell the two apart.
  if not v_money and p_date is not null and p_date <> app.venue_date(now(), v_tz) then
    raise exception 'chef_reads_today_only' using errcode = '42501';
  end if;
  if p_date is not null and p_date > app.venue_date(now(), v_tz) then
    raise exception 'date_in_future' using errcode = 'P0001';
  end if;
  perform 1 from public.recipe_key k where k.tenant_id = v_tenant and k.id = p_key;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_at := case when p_date is null then null else app.venue_day_end(p_date, v_tz) end;

  select * into v_cost from app.recipe_costs(v_tenant, array[p_key], v_at) c;
  if not found then
    raise exception 'recipe_not_in_force' using errcode = 'P0002';
  end if;
  if v_cost.type <> 'plate' then
    raise exception 'recipe_not_plate' using errcode = 'P0001';
  end if;
  select * into v_plate from app.plate_cost_rows(v_tenant, array[p_key], p_date, false) p;
  -- The sale terms of the item that maps the plate (D-11): only the owner and admin read them, in the money block.
  select x.price_unit, x.price, x.portion_weight_g into v_terms
    from public.menu_item mi
    join app.menu_item_sale_terms_at(v_tenant, array[mi.id], coalesce(v_at, clock_timestamp())) x on x.menu_item_id = mi.id
   where mi.tenant_id = v_tenant and mi.is_active and mi.recipe_key = p_key
   limit 1;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'position', x.line_position,
             'target', x.target,
             'sharePct', x.share,
             'incomplete', x.incomplete,
             'reason', x.reason)
           || case when v_money then jsonb_build_object('lineCostEur', round(x.line_cost, 4)) else '{}'::jsonb end
           order by x.line_cost desc nulls last, x.line_position), '[]'::jsonb)
    into v_lines
    from (
      select lc.line_position, lc.line_cost, lc.incomplete, lc.reason,
             case when lc.ingredient_id is not null
               then jsonb_build_object('kind', 'ingredient', 'id', lc.ingredient_id, 'name', i.name)
               else jsonb_build_object('kind', 'recipe', 'id', lc.sub_recipe_key,
                      'name', coalesce(sr.name, sk.name_norm)) end as target,
             case when not v_cost.incomplete and not lc.incomplete and v_cost.total_cost > 0
               then round(lc.line_cost / v_cost.total_cost * 100, 2) end as share
        from app.recipe_cost_lines(v_tenant, v_cost.recipe_id, v_at) lc
        left join public.ingredient i on i.tenant_id = v_tenant and i.id = lc.ingredient_id
        left join public.recipe_key sk on sk.tenant_id = v_tenant and sk.id = lc.sub_recipe_key
        left join public.recipe sr on sr.id = app.recipe_in_force(v_tenant, lc.sub_recipe_key, v_at)
    ) x;

  v_out := jsonb_build_object(
    'recipeKey', v_plate.recipe_key, 'name', v_plate.name, 'version', v_plate.version, 'at', p_date,
    'status', v_plate.status, 'incomplete', v_cost.incomplete, 'reasons', to_jsonb(v_plate.reasons),
    'missingIngredientIds', to_jsonb(v_plate.missing_ingredient_ids),
    'foodCostPct', round(v_plate.food_cost_pct, 4), 'gpPct', round(v_plate.gp_pct, 4),
    'targetGpPct', v_plate.target_gp_pct, 'lines', v_lines);
  if v_money then
    v_out := v_out || jsonb_build_object('money', jsonb_build_object(
      'foodCostEur', round(v_plate.food_cost, 4),
      'salePriceExVatEur', round(v_plate.sale_price_ex_vat, 4),
      'grossMarginEur', round(v_plate.gross_margin, 4),
      'salePriceEur', v_plate.sale_price,
      'priceUnit', v_terms.price_unit,
      'pricePer100g', case when v_terms.price_unit = 'etto' then trim_scale(v_terms.price) end,
      'portionWeightG', case when v_terms.price_unit = 'etto' then v_terms.portion_weight_g end));
  end if;
  return v_out;
end
$$;

revoke all on function app.menu_items_json(uuid, uuid[]), app.plate_cost_rows(uuid, uuid[], date, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.create_menu_item(jsonb), public.update_menu_item(uuid, jsonb), public.menu_list(),
  public.plate_costs(date), public.plate_breakdown(uuid, date) from public, anon, authenticated, service_role;
grant execute on function public.create_menu_item(jsonb), public.update_menu_item(uuid, jsonb), public.menu_list(),
  public.plate_costs(date), public.plate_breakdown(uuid, date) to authenticated;
