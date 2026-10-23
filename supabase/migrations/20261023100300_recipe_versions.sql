-- M7 step 5: the recipe version procedures (M7 plan §3.1, §3.2; ADR-007).
--   public.create_recipe, public.create_recipe_version, public.set_recipe_active (SECURITY DEFINER)
-- Every definer procedure checks the role first, has an empty search_path, takes the tenant from
-- app.tenant_id(), and is executable by `authenticated` only. The app.* helpers are executable by
-- no API role.
--
-- One lock order for every recipe writer (plan §3.1.8): (1) app.lock_recipe_graph(tenant), one
-- advisory lock per tenant; (2) the recipe_key row FOR NO KEY UPDATE (the line foreign keys take
-- KEY SHARE, which does not conflict); (3) inserts. Once a writer holds the tenant lock, each of
-- its later statements sees every version committed before it (READ COMMITTED), so two concurrent
-- versions that would close a loop cannot both pass the cycle check.
--
-- Content is JSON in the API's camelCase: {name, outputQty, outputUnit, portionsPerBatch,
-- shelfLifeHours, prepTimeMin, minPortions, targetPortions, salePrice, targetGpPct,
-- lines: [{ingredientId | recipeKey, qty, unit, yieldFactor}]}. Errors are P0001 with the code as the
-- message and a JSON detail: recipe_invalid [{field, code}], version_conflict {"currentVersion": n}.

create function app.recipe_graph_lock_key(p_tenant uuid) returns table (class int, obj int)
  language sql immutable
  set search_path = ''
as $$
  select hashtext('recipe_graph'), hashtext(p_tenant::text)
$$;

-- A collision with another advisory lock key only adds a wait, never a wrong result.
create function app.lock_recipe_graph(p_tenant uuid) returns void
  language plpgsql
  set search_path = ''
as $$
declare
  k record;
begin
  select * into k from app.recipe_graph_lock_key(p_tenant);
  perform pg_advisory_xact_lock(k.class, k.obj);
end
$$;

create function app.require_recipe_writer() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin', 'chef') then
    raise exception 'permission denied: recipes need owner, admin or chef' using errcode = '42501';
  end if;
end
$$;

create function app.require_recipe_admin() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin') then
    raise exception 'permission denied: recipes need owner or admin to change this' using errcode = '42501';
  end if;
end
$$;

-- Strict parse of a recipe body for a type. Collects every problem, then raises recipe_invalid with
-- [{field, code}]. Returns the normalised body: price keys appear only when the caller sent them
-- (a JSON null means "clear"), and lines carry their position.
create function app.recipe_content_parse(p_type public.recipe_type, p_content jsonb) returns jsonb
  language plpgsql stable
  set search_path = ''
as $$
declare
  errs jsonb := '[]';
  out jsonb := '{}';
  spec record;
  k text;
  val jsonb;
  num numeric;
  bad boolean;
  lines_in jsonb;
  lines_out jsonb := '[]';
  line jsonb;
  n int;
  i int;
  ing_id text;
  rec_id text;
  yield_factor numeric;
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  top_keys constant text[] := array['name', 'outputQty', 'outputUnit', 'portionsPerBatch', 'shelfLifeHours',
    'prepTimeMin', 'minPortions', 'targetPortions', 'salePrice', 'targetGpPct', 'lines'];
  line_keys constant text[] := array['ingredientId', 'recipeKey', 'qty', 'unit', 'yieldFactor'];
begin
  if jsonb_typeof(p_content) is distinct from 'object' then
    raise exception 'recipe_invalid' using errcode = 'P0001',
      detail = '[{"code": "invalid_value", "field": "(body)"}]';
  end if;

  for k in select jsonb_object_keys(p_content) loop
    if not (k = any (top_keys)) then
      errs := errs || jsonb_build_object('field', k, 'code', 'unknown_field');
    end if;
  end loop;

  -- name
  val := p_content -> 'name';
  if val is null or jsonb_typeof(val) = 'null' then
    errs := errs || jsonb_build_object('field', 'name', 'code', 'required');
  elsif jsonb_typeof(val) <> 'string' or length(btrim(val #>> '{}')) > 120 then
    errs := errs || jsonb_build_object('field', 'name', 'code', 'invalid_value');
  elsif length(btrim(val #>> '{}')) = 0 then
    errs := errs || jsonb_build_object('field', 'name', 'code', 'required');
  else
    out := out || jsonb_build_object('name', btrim(val #>> '{}'));
  end if;

  -- Numeric fields: key, min, min exclusive, max, max exclusive, decimals, integer, types, required for.
  for spec in
    select * from (values
      ('outputQty', 0::numeric, true, 100000::numeric, false, 4, false, array['batch', 'sub'], array['batch', 'sub']),
      ('portionsPerBatch', 1, false, 10000, false, 0, true, array['batch'], array['batch']),
      ('shelfLifeHours', 1, false, 8760, false, 0, true, array['batch'], array['batch']),
      ('prepTimeMin', 0, false, 1440, false, 0, true, array['batch', 'sub'], array[]::text[]),
      ('minPortions', 0, false, 10000, false, 0, true, array['batch'], array[]::text[]),
      ('targetPortions', 0, false, 10000, false, 0, true, array['batch'], array[]::text[]),
      ('salePrice', 0, false, 100000, false, 2, false, array['plate'], array[]::text[]),
      ('targetGpPct', 0, false, 100, true, 2, false, array['plate'], array[]::text[])
    ) as t(k, lo, lo_x, hi, hi_x, sc, is_int, types, req)
  loop
    val := p_content -> spec.k;
    if val is null or jsonb_typeof(val) = 'null' then
      if p_type::text = any (spec.req) then
        errs := errs || jsonb_build_object('field', spec.k, 'code', 'required');
      elsif val is not null and p_type = 'plate' and spec.k in ('salePrice', 'targetGpPct') then
        out := out || jsonb_build_object(spec.k, 'null'::jsonb); -- present and null: clear
      end if;
      continue;
    end if;
    if not (p_type::text = any (spec.types)) then
      errs := errs || jsonb_build_object('field', spec.k,
        'code', case when spec.k in ('salePrice', 'targetGpPct') then 'price_not_for_type'
                     else 'field_not_for_type' end);
      continue;
    end if;
    if jsonb_typeof(val) <> 'number' then
      errs := errs || jsonb_build_object('field', spec.k, 'code', 'invalid_value');
      continue;
    end if;
    num := (val #>> '{}')::numeric;
    bad := (case when spec.lo_x then num <= spec.lo else num < spec.lo end)
        or (case when spec.hi_x then num >= spec.hi else num > spec.hi end)
        or num <> round(num, spec.sc);
    if bad then
      errs := errs || jsonb_build_object('field', spec.k, 'code', 'invalid_value');
    else
      out := out || jsonb_build_object(spec.k, val);
    end if;
  end loop;

  -- outputUnit
  val := p_content -> 'outputUnit';
  if val is null or jsonb_typeof(val) = 'null' then
    if p_type in ('batch', 'sub') then
      errs := errs || jsonb_build_object('field', 'outputUnit', 'code', 'required');
    end if;
  elsif p_type = 'plate' then
    errs := errs || jsonb_build_object('field', 'outputUnit', 'code', 'field_not_for_type');
  elsif jsonb_typeof(val) <> 'string' or (val #>> '{}') not in ('kg', 'l', 'pz') then
    errs := errs || jsonb_build_object('field', 'outputUnit', 'code', 'invalid_value');
  else
    out := out || jsonb_build_object('outputUnit', val);
  end if;

  if out ? 'minPortions' and out ? 'targetPortions'
     and (out ->> 'targetPortions')::numeric < (out ->> 'minPortions')::numeric then
    errs := errs || jsonb_build_object('field', 'targetPortions', 'code', 'invalid_value');
  end if;

  -- lines
  lines_in := p_content -> 'lines';
  if lines_in is null or jsonb_typeof(lines_in) <> 'array' or jsonb_array_length(lines_in) = 0 then
    errs := errs || jsonb_build_object('field', 'lines', 'code', 'no_lines');
  elsif jsonb_array_length(lines_in) > 100 then
    errs := errs || jsonb_build_object('field', 'lines', 'code', 'too_many_lines');
  else
    n := jsonb_array_length(lines_in);
    for i in 0 .. n - 1 loop
      line := lines_in -> i;
      if jsonb_typeof(line) <> 'object' then
        errs := errs || jsonb_build_object('field', 'lines.' || i, 'code', 'invalid_value');
        continue;
      end if;
      for k in select jsonb_object_keys(line) loop
        if not (k = any (line_keys)) then
          errs := errs || jsonb_build_object('field', 'lines.' || i || '.' || k, 'code', 'unknown_field');
        end if;
      end loop;

      ing_id := null;
      rec_id := null;
      val := line -> 'ingredientId';
      if val is not null and jsonb_typeof(val) <> 'null' then
        if jsonb_typeof(val) <> 'string' or (val #>> '{}') !~ uuid_re then
          errs := errs || jsonb_build_object('field', 'lines.' || i || '.ingredientId', 'code', 'invalid_value');
        else
          ing_id := lower(val #>> '{}');
        end if;
      end if;
      val := line -> 'recipeKey';
      if val is not null and jsonb_typeof(val) <> 'null' then
        if jsonb_typeof(val) <> 'string' or (val #>> '{}') !~ uuid_re then
          errs := errs || jsonb_build_object('field', 'lines.' || i || '.recipeKey', 'code', 'invalid_value');
        else
          rec_id := lower(val #>> '{}');
        end if;
      end if;
      if (coalesce(jsonb_typeof(line -> 'ingredientId'), 'null') <> 'null')
         = (coalesce(jsonb_typeof(line -> 'recipeKey'), 'null') <> 'null') then
        errs := errs || jsonb_build_object('field', 'lines.' || i, 'code', 'line_target_required');
      end if;

      num := null;
      val := line -> 'qty';
      if val is null or jsonb_typeof(val) = 'null' then
        errs := errs || jsonb_build_object('field', 'lines.' || i || '.qty', 'code', 'required');
      elsif jsonb_typeof(val) <> 'number' then
        errs := errs || jsonb_build_object('field', 'lines.' || i || '.qty', 'code', 'invalid_value');
      else
        num := (val #>> '{}')::numeric;
        if num <= 0 then
          errs := errs || jsonb_build_object('field', 'lines.' || i || '.qty', 'code', 'qty_not_positive');
        elsif num > 100000 or num <> round(num, 4) then
          errs := errs || jsonb_build_object('field', 'lines.' || i || '.qty', 'code', 'invalid_value');
        end if;
      end if;

      val := line -> 'unit';
      if val is null or jsonb_typeof(val) = 'null' then
        errs := errs || jsonb_build_object('field', 'lines.' || i || '.unit', 'code', 'required');
      elsif jsonb_typeof(val) <> 'string' or (val #>> '{}') not in ('kg', 'g', 'l', 'ml', 'pz', 'porz') then
        errs := errs || jsonb_build_object('field', 'lines.' || i || '.unit', 'code', 'invalid_value');
      end if;

      yield_factor := 1;
      val := line -> 'yieldFactor';
      if val is not null and jsonb_typeof(val) <> 'null' then
        if jsonb_typeof(val) <> 'number' then
          errs := errs || jsonb_build_object('field', 'lines.' || i || '.yieldFactor', 'code', 'invalid_value');
        else
          yield_factor := (val #>> '{}')::numeric;
          if yield_factor <= 0 then
            errs := errs || jsonb_build_object('field', 'lines.' || i || '.yieldFactor',
              'code', 'yield_factor_not_positive');
          elsif yield_factor > 10 then
            errs := errs || jsonb_build_object('field', 'lines.' || i || '.yieldFactor',
              'code', 'yield_factor_too_large');
          elsif yield_factor <> round(yield_factor, 4) then
            errs := errs || jsonb_build_object('field', 'lines.' || i || '.yieldFactor', 'code', 'invalid_value');
          end if;
        end if;
      end if;

      lines_out := lines_out || jsonb_build_object('position', i + 1, 'ingredientId', ing_id,
        'recipeKey', rec_id, 'qty', num, 'unit', line ->> 'unit', 'yieldFactor', yield_factor);
    end loop;
  end if;

  if jsonb_array_length(errs) > 0 then
    raise exception 'recipe_invalid' using errcode = 'P0001', detail = errs::text;
  end if;
  return out || jsonb_build_object('lines', lines_out);
end
$$;

-- Checks every line's target in the caller's tenant (it exists, is active, may be used by this type of
-- recipe, and the unit fits) before anything is inserted, so a bad reference is a coded recipe_invalid
-- and not a foreign key error. Returns the warnings.
create function app.validate_recipe_lines(p_tenant uuid, p_type public.recipe_type, p_lines jsonb)
  returns jsonb
  language plpgsql stable
  set search_path = ''
as $$
declare
  errs jsonb := '[]';
  warnings jsonb := '[]';
  l record;
  ing record;
  tgt record;
  v_unit public.recipe_unit;
  v_field text;
begin
  for l in
    select e.value as line, (e.ord - 1)::int as i
      from jsonb_array_elements(p_lines) with ordinality as e(value, ord)
     order by e.ord
  loop
    v_unit := (l.line ->> 'unit')::public.recipe_unit;
    if l.line ->> 'ingredientId' is not null then
      v_field := 'lines.' || l.i || '.ingredientId';
      select i.base_unit, i.is_active into ing from public.ingredient i
       where i.tenant_id = p_tenant and i.id = (l.line ->> 'ingredientId')::uuid;
      if not found then
        errs := errs || jsonb_build_object('field', v_field, 'code', 'unknown_ingredient');
      elsif not ing.is_active then
        errs := errs || jsonb_build_object('field', v_field, 'code', 'ingredient_inactive');
      elsif app.recipe_unit_dimension(v_unit) is distinct from
            (case ing.base_unit when 'kg' then 'mass' when 'l' then 'volume' else 'count' end) then
        errs := errs || jsonb_build_object('field', 'lines.' || l.i || '.unit', 'code', 'incompatible_units');
      end if;
    else
      v_field := 'lines.' || l.i || '.recipeKey';
      select k.type, k.is_active, v.output_unit into tgt
        from public.recipe_key k
        left join public.recipe v
          on v.tenant_id = k.tenant_id and v.recipe_key = k.id and v.version = k.current_version
       where k.tenant_id = p_tenant and k.id = (l.line ->> 'recipeKey')::uuid;
      if not found then
        errs := errs || jsonb_build_object('field', v_field, 'code', 'unknown_sub_recipe');
      elsif tgt.type = 'plate' or (tgt.type = 'batch' and p_type <> 'plate') then
        -- Nothing uses a plate; a batch is used only by plates, in portions.
        errs := errs || jsonb_build_object('field', v_field, 'code', 'line_target_not_allowed');
      elsif not tgt.is_active then
        errs := errs || jsonb_build_object('field', v_field, 'code', 'sub_recipe_inactive');
      elsif tgt.type = 'batch' then
        if v_unit <> 'porz' then
          errs := errs || jsonb_build_object('field', 'lines.' || l.i || '.unit', 'code', 'incompatible_units');
        end if;
      elsif app.recipe_unit_dimension(v_unit) is distinct from
            (case tgt.output_unit when 'kg' then 'mass' when 'l' then 'volume' else 'count' end) then
        errs := errs || jsonb_build_object('field', 'lines.' || l.i || '.unit', 'code', 'incompatible_units');
      end if;
    end if;
    if (l.line ->> 'yieldFactor')::numeric > 1 then
      warnings := warnings || jsonb_build_object('line', l.i + 1, 'code', 'yield_above_one');
    end if;
  end loop;
  if jsonb_array_length(errs) > 0 then
    raise exception 'recipe_invalid' using errcode = 'P0001', detail = errs::text;
  end if;
  return warnings;
end
$$;

-- Inserts one version with its lines and, for a plate, its price row. valid_from is the server clock,
-- strictly after the key's previous version. A price key in the body sets that value; an absent one
-- is copied from the version p_price_from.
create function app.insert_recipe_version(p_key uuid, p_version int, p_parsed jsonb, p_price_from uuid)
  returns uuid
  language plpgsql
  set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_user uuid := app.app_user_id();
  v_type public.recipe_type;
  v_prev timestamptz;
  v_id uuid;
  v_sale numeric;
  v_gp numeric;
begin
  select k.type into v_type from public.recipe_key k where k.tenant_id = v_tenant and k.id = p_key;
  select max(r.valid_from) into v_prev from public.recipe r where r.tenant_id = v_tenant and r.recipe_key = p_key;

  insert into public.recipe (tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
      portions_per_batch, shelf_life_hours, prep_time_min, min_portions, target_portions, created_by)
    values (v_tenant, p_key, p_version,
            greatest(clock_timestamp(), coalesce(v_prev + interval '1 microsecond', clock_timestamp())),
            p_parsed ->> 'name', (p_parsed ->> 'outputQty')::numeric, (p_parsed ->> 'outputUnit')::public.base_unit,
            (p_parsed ->> 'portionsPerBatch')::int, (p_parsed ->> 'shelfLifeHours')::int,
            (p_parsed ->> 'prepTimeMin')::int, (p_parsed ->> 'minPortions')::int,
            (p_parsed ->> 'targetPortions')::int, v_user)
    returning id into v_id;

  insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit,
      yield_factor, created_by)
    select v_tenant, v_id, (e.value ->> 'position')::smallint, (e.value ->> 'ingredientId')::uuid,
           (e.value ->> 'recipeKey')::uuid, (e.value ->> 'qty')::numeric, (e.value ->> 'unit')::public.recipe_unit,
           (e.value ->> 'yieldFactor')::numeric, v_user
      from jsonb_array_elements(p_parsed -> 'lines') as e(value);

  if v_type = 'plate' then
    if p_price_from is not null then
      select p.sale_price, p.target_gp_pct into v_sale, v_gp
        from public.recipe_price p where p.tenant_id = v_tenant and p.recipe_id = p_price_from;
    end if;
    if p_parsed ? 'salePrice' then v_sale := (p_parsed ->> 'salePrice')::numeric; end if;
    if p_parsed ? 'targetGpPct' then v_gp := (p_parsed ->> 'targetGpPct')::numeric; end if;
    if v_sale is not null or v_gp is not null then
      insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by)
        values (v_id, v_tenant, v_sale, v_gp, v_user);
    end if;
  end if;
  return v_id;
end
$$;

-- The canonical content of a version: names instead of ids, numbers without trailing zeros, lines
-- by position, null fields left out. Used to see whether a new version changes anything, and (step 7)
-- for the export, so import -> export -> import is stable.
create function app.recipe_version_content(p_recipe uuid, p_include_price boolean) returns jsonb
  language sql stable
  set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
      'name', r.name,
      'type', k.type,
      'outputQty', trim_scale(r.output_qty),
      'outputUnit', r.output_unit,
      'portionsPerBatch', r.portions_per_batch,
      'shelfLifeHours', r.shelf_life_hours,
      'prepTimeMin', r.prep_time_min,
      'minPortions', r.min_portions,
      'targetPortions', r.target_portions,
      'salePrice', case when p_include_price then trim_scale(p.sale_price) end,
      'targetGpPct', case when p_include_price then trim_scale(p.target_gp_pct) end,
      'lines', coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'ingredient', i.name, 'recipe', sv.name, 'qty', trim_scale(l.qty), 'unit', l.unit,
                 'yieldFactor', trim_scale(l.yield_factor))) order by l.position)
          from public.recipe_line l
          left join public.ingredient i on i.tenant_id = l.tenant_id and i.id = l.ingredient_id
          left join public.recipe_key sk on sk.tenant_id = l.tenant_id and sk.id = l.sub_recipe_key
          left join public.recipe sv
            on sv.tenant_id = sk.tenant_id and sv.recipe_key = sk.id and sv.version = sk.current_version
         where l.tenant_id = r.tenant_id and l.recipe_id = r.id), '[]'::jsonb)))
    from public.recipe r
    join public.recipe_key k on k.tenant_id = r.tenant_id and k.id = r.recipe_key
    left join public.recipe_price p on p.tenant_id = r.tenant_id and p.recipe_id = r.id
   where r.id = p_recipe and r.tenant_id = app.tenant_id()
$$;

-- Refuses a loop of sub-recipes reachable from the changed keys (current versions only), and
-- nesting deeper than 12 levels. The path array stops infinite recursion.
create function app.assert_recipe_acyclic(p_tenant uuid, p_keys uuid[]) returns void
  language plpgsql
  set search_path = ''
as $$
declare
  v_cycle uuid[];
  v_deep boolean;
begin
  with recursive walk (root, key, path, closes) as (
    select k, k, array[k], false from unnest(p_keys) as k
    union all
    select w.root, l.sub_recipe_key, w.path || l.sub_recipe_key, l.sub_recipe_key = any (w.path)
      from walk w
      join public.recipe_key rk on rk.tenant_id = p_tenant and rk.id = w.key
      join public.recipe r
        on r.tenant_id = p_tenant and r.recipe_key = rk.id and r.version = rk.current_version
      join public.recipe_line l
        on l.tenant_id = p_tenant and l.recipe_id = r.id and l.sub_recipe_key is not null
     where not w.closes and cardinality(w.path) <= 13
  )
  select (select x.path from walk x where x.closes order by cardinality(x.path), x.path::text limit 1),
         exists (select 1 from walk x where cardinality(x.path) > 12)
    into v_cycle, v_deep;
  if v_cycle is not null then
    raise exception 'recipe_cycle' using errcode = 'P0001', detail = array_to_string(v_cycle, ',');
  end if;
  if v_deep then
    raise exception 'recipe_too_deep' using errcode = 'P0001';
  end if;
end
$$;

-- Writes version n+1 of a key. The caller holds the tenant lock; this takes the key row, checks the
-- base version, the name and the content, and refuses a body that changes nothing. Shared by
-- create_recipe_version and the import.
create function app.write_recipe_version(p_key uuid, p_parsed jsonb, p_base_version int) returns jsonb
  language plpgsql
  set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  k public.recipe_key;
  v_base uuid;
  v_new uuid;
  v_norm text := app.normalise_name(p_parsed ->> 'name');
  v_warnings jsonb;
begin
  select * into k from public.recipe_key rk
   where rk.tenant_id = v_tenant and rk.id = p_key
     for no key update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not k.is_active then
    raise exception 'recipe_inactive' using errcode = 'P0001';
  end if;
  if p_base_version is distinct from k.current_version then
    raise exception 'version_conflict' using errcode = 'P0001',
      detail = format('{"currentVersion":%s}', k.current_version);
  end if;
  if v_norm <> k.name_norm and exists (
      select 1 from public.recipe_key o where o.tenant_id = v_tenant and o.name_norm = v_norm and o.id <> k.id) then
    raise exception 'recipe_name_taken' using errcode = 'P0001';
  end if;

  v_warnings := app.validate_recipe_lines(v_tenant, k.type, p_parsed -> 'lines');
  select r.id into v_base from public.recipe r
   where r.tenant_id = v_tenant and r.recipe_key = k.id and r.version = k.current_version;
  v_new := app.insert_recipe_version(k.id, k.current_version + 1, p_parsed, v_base);
  if app.recipe_version_content(v_new, true) = app.recipe_version_content(v_base, true) then
    raise exception 'recipe_unchanged' using errcode = 'P0001';
  end if;

  update public.recipe_key set current_version = k.current_version + 1, name_norm = v_norm where id = k.id;
  perform app.assert_recipe_acyclic(v_tenant, array[k.id]);
  return jsonb_build_object('key', k.id, 'version', k.current_version + 1, 'recipeId', v_new,
                            'warnings', v_warnings);
end
$$;

create function public.create_recipe(p_type public.recipe_type, p_content jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_parsed jsonb;
  v_key uuid;
  v_id uuid;
  v_norm text;
  v_warnings jsonb;
begin
  perform app.require_recipe_writer();
  if app.role() = 'chef' and p_content is not null and jsonb_typeof(p_content) = 'object'
     and (p_content ? 'salePrice' or p_content ? 'targetGpPct') then
    raise exception 'recipe_price_forbidden' using errcode = '42501';
  end if;
  if p_type is null then
    raise exception 'recipe_invalid' using errcode = 'P0001', detail = '[{"code": "required", "field": "type"}]';
  end if;
  v_tenant := app.tenant_id();
  v_parsed := app.recipe_content_parse(p_type, p_content);
  perform app.lock_recipe_graph(v_tenant);

  v_norm := app.normalise_name(v_parsed ->> 'name');
  if exists (select 1 from public.recipe_key k where k.tenant_id = v_tenant and k.name_norm = v_norm) then
    raise exception 'recipe_name_taken' using errcode = 'P0001';
  end if;
  v_warnings := app.validate_recipe_lines(v_tenant, p_type, v_parsed -> 'lines');

  insert into public.recipe_key (tenant_id, type, current_version, name_norm, created_by)
    values (v_tenant, p_type, 1, v_norm, app.app_user_id())
    returning id into v_key;
  v_id := app.insert_recipe_version(v_key, 1, v_parsed, null);
  perform app.assert_recipe_acyclic(v_tenant, array[v_key]);
  return jsonb_build_object('key', v_key, 'version', 1, 'recipeId', v_id, 'warnings', v_warnings);
end
$$;

create function public.create_recipe_version(p_key uuid, p_base_version int, p_content jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_type public.recipe_type;
  v_parsed jsonb;
begin
  perform app.require_recipe_writer();
  -- AT5 / Q16 = V6: the chef reads the prices but never sets them, not even to the stored value.
  if app.role() = 'chef' and p_content is not null and jsonb_typeof(p_content) = 'object'
     and (p_content ? 'salePrice' or p_content ? 'targetGpPct') then
    raise exception 'recipe_price_forbidden' using errcode = '42501';
  end if;
  if p_base_version is null then
    raise exception 'recipe_invalid' using errcode = 'P0001',
      detail = '[{"code": "required", "field": "baseVersion"}]';
  end if;
  v_tenant := app.tenant_id();
  -- The type never changes, so it can be read before the lock.
  select k.type into v_type from public.recipe_key k where k.tenant_id = v_tenant and k.id = p_key;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_parsed := app.recipe_content_parse(v_type, p_content);
  perform app.lock_recipe_graph(v_tenant);
  return app.write_recipe_version(p_key, v_parsed, p_base_version);
end
$$;

create function public.set_recipe_active(p_key uuid, p_active boolean) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  k public.recipe_key;
begin
  perform app.require_recipe_admin();
  if p_active is null then
    raise exception 'recipe_invalid' using errcode = 'P0001', detail = '[{"code": "required", "field": "isActive"}]';
  end if;
  v_tenant := app.tenant_id();
  perform app.lock_recipe_graph(v_tenant);
  select * into k from public.recipe_key rk where rk.tenant_id = v_tenant and rk.id = p_key for no key update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if k.is_active is distinct from p_active then
    update public.recipe_key set is_active = p_active where id = k.id;
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
      values (v_tenant, 'recipe', k.id,
              case when p_active then 'recipe.reactivated' else 'recipe.deactivated' end,
              jsonb_build_object('isActive', k.is_active), jsonb_build_object('isActive', p_active),
              app.app_user_id());
  end if;
  return jsonb_build_object('key', k.id, 'isActive', p_active, 'version', k.current_version);
end
$$;

revoke all on function app.recipe_graph_lock_key(uuid), app.lock_recipe_graph(uuid),
  app.require_recipe_writer(), app.require_recipe_admin(),
  app.recipe_content_parse(public.recipe_type, jsonb), app.validate_recipe_lines(uuid, public.recipe_type, jsonb),
  app.insert_recipe_version(uuid, int, jsonb, uuid), app.recipe_version_content(uuid, boolean),
  app.assert_recipe_acyclic(uuid, uuid[]), app.write_recipe_version(uuid, jsonb, int)
  from public, anon, authenticated, service_role;
revoke all on function public.create_recipe(public.recipe_type, jsonb),
  public.create_recipe_version(uuid, int, jsonb), public.set_recipe_active(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.create_recipe(public.recipe_type, jsonb),
  public.create_recipe_version(uuid, int, jsonb), public.set_recipe_active(uuid, boolean) to authenticated;
