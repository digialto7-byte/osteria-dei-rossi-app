-- M7 step 7: recipe import (with a dry run) and export (M7 plan §3.1.11). Rows use the template
-- shape: {row?, name, type, outputQty?, ..., salePrice?, targetGpPct?, lines: [{ingredient | recipe,
-- qty, unit, yieldFactor?}]}, targets by name. The export returns the same shape (canonical content),
-- so import -> export -> import changes nothing.
--
-- Matching is by normalised name. A recipe whose content equals the current version is "unchanged"
-- (nothing is written); a different one becomes version n+1; an unknown name becomes a new recipe.
-- A blank price key keeps the base version's price, a JSON null clears it. The order of the rows in
-- the file does not matter: keys are created first, then versions, then every line and the whole
-- graph are checked once. One call is one transaction: any error rolls everything back.
-- The dry run is the same code path, rolled back: the apply step ends with a sentinel exception, the
-- block rolls back to its savepoint, and the result built inside it (a plpgsql variable, which the
-- rollback does not touch) is returned.
-- Errors carry the file row in the detail ([{row, field, code}]), never the contents of the row.

create function app.recipe_import_fail(p_message text, p_row int, p_field text, p_code text) returns void
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception using message = p_message, errcode = 'P0001',
    detail = jsonb_build_array(jsonb_build_object('row', p_row, 'field', p_field, 'code', p_code))::text;
end
$$;

-- Adds the file row to every problem of a recipe_invalid detail.
create function app.recipe_import_tag(p_detail text, p_row int) returns text
  language sql immutable
  set search_path = ''
as $$
  select jsonb_agg(e || jsonb_build_object('row', p_row))::text from jsonb_array_elements(p_detail::jsonb) as e
$$;

-- The stored lines of a version, in the shape app.validate_recipe_lines reads.
create function app.recipe_lines_json(p_recipe uuid) returns jsonb
  language sql stable
  set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('position', l.position, 'ingredientId', l.ingredient_id,
           'recipeKey', l.sub_recipe_key, 'qty', l.qty, 'unit', l.unit, 'yieldFactor', l.yield_factor)
           order by l.position), '[]'::jsonb)
    from public.recipe_line l
   where l.recipe_id = p_recipe and l.tenant_id = app.tenant_id()
$$;

create function app.import_recipes_apply(p_tenant uuid, p_rows jsonb) returns jsonb
  language plpgsql
  set search_path = ''
as $$
declare
  v_user uuid := app.app_user_id();
  n int := jsonb_array_length(p_rows);
  e record;
  i int;
  j int;
  k public.recipe_key;
  v_norm text;
  v_name text;
  v_content jsonb;
  v_lines_in jsonb;
  v_lines jsonb;
  v_line jsonb;
  v_target uuid;
  v_unresolved jsonb;
  v_base uuid;
  v_ver int;
  v_new uuid;
  v_key uuid;
  v_msg text;
  v_det text;
  seen text[] := '{}';
  keys uuid[] := '{}';
  ids uuid[] := '{}';
  vers int[] := '{}';
  rownums int[] := '{}';
  types text[] := '{}';
  actions text[] := '{}';
  parsed jsonb[] := '{}';
  warns jsonb[] := '{}';
  changed uuid[] := '{}';
  recipes jsonb := '[]';
  created int := 0;
  new_versions int := 0;
  unchanged int := 0;
begin
  -- Pass 0: shape, matching, and the keys of the new recipes.
  for e in select t.value, t.ord from jsonb_array_elements(p_rows) with ordinality as t(value, ord) order by t.ord loop
    i := e.ord;
    rownums[i] := case when jsonb_typeof(e.value -> 'row') = 'number' then (e.value ->> 'row')::numeric::int else i end;
    if jsonb_typeof(e.value) <> 'object' then
      perform app.recipe_import_fail('recipe_invalid', rownums[i], '(row)', 'invalid_value');
    end if;
    if jsonb_typeof(e.value -> 'name') is distinct from 'string' or btrim(e.value ->> 'name') = '' then
      perform app.recipe_import_fail('recipe_invalid', rownums[i], 'name', 'required');
    end if;
    v_name := btrim(e.value ->> 'name');
    if length(v_name) > 120 then
      perform app.recipe_import_fail('recipe_invalid', rownums[i], 'name', 'invalid_value');
    end if;
    if (e.value ->> 'type') is null or (e.value ->> 'type') not in ('batch', 'plate', 'sub') then
      perform app.recipe_import_fail('recipe_invalid', rownums[i], 'type', 'invalid_value');
    end if;
    types[i] := e.value ->> 'type';
    v_norm := app.normalise_name(v_name);
    if v_norm = any (seen) then
      perform app.recipe_import_fail('recipe_invalid', rownums[i], 'name', 'duplicate_in_file');
    end if;
    seen := seen || v_norm;

    select * into k from public.recipe_key rk
     where rk.tenant_id = p_tenant and rk.name_norm = v_norm
       for no key update;
    if found then
      if k.type::text <> types[i] then
        perform app.recipe_import_fail('recipe_type_conflict', rownums[i], 'type', 'recipe_type_conflict');
      elsif not k.is_active then
        perform app.recipe_import_fail('recipe_inactive', rownums[i], 'name', 'recipe_inactive');
      end if;
      keys[i] := k.id;
      actions[i] := 'existing';
    else
      insert into public.recipe_key (tenant_id, type, current_version, name_norm, created_by)
        values (p_tenant, types[i]::public.recipe_type, 1, v_norm, v_user)
        returning id into v_key;
      keys[i] := v_key;
      actions[i] := 'create';
    end if;
  end loop;

  -- Pass 1: names to ids, then the same strict parse as create_recipe.
  for e in select t.value, t.ord from jsonb_array_elements(p_rows) with ordinality as t(value, ord) order by t.ord loop
    i := e.ord;
    v_content := e.value - 'row' - 'type';
    v_lines_in := e.value -> 'lines';
    v_unresolved := '[]';
    if jsonb_typeof(v_lines_in) = 'array' then
      v_lines := '[]';
      for j in 0 .. jsonb_array_length(v_lines_in) - 1 loop
        v_line := v_lines_in -> j;
        if jsonb_typeof(v_line) = 'object' then
          if v_line ? 'ingredient' then
            if jsonb_typeof(v_line -> 'ingredient') = 'string' then
              select ing.id into v_target from public.ingredient ing
               where ing.tenant_id = p_tenant
                 and app.normalise_name(ing.name) = app.normalise_name(v_line ->> 'ingredient');
              if v_target is null then
                v_unresolved := v_unresolved || jsonb_build_object('field', 'lines.' || j || '.ingredient',
                                                                   'code', 'unknown_ingredient');
              end if;
              v_line := (v_line - 'ingredient') || jsonb_build_object('ingredientId', v_target);
            else
              v_line := (v_line - 'ingredient') || jsonb_build_object('ingredientId', v_line -> 'ingredient');
            end if;
          end if;
          if v_line ? 'recipe' then
            if jsonb_typeof(v_line -> 'recipe') = 'string' then
              v_target := null;
              select rk.id into v_target from public.recipe_key rk
               where rk.tenant_id = p_tenant and rk.name_norm = app.normalise_name(v_line ->> 'recipe');
              if v_target is null then
                v_unresolved := v_unresolved || jsonb_build_object('field', 'lines.' || j || '.recipe',
                                                                   'code', 'unknown_sub_recipe');
              end if;
              v_line := (v_line - 'recipe') || jsonb_build_object('recipeKey', v_target);
            else
              v_line := (v_line - 'recipe') || jsonb_build_object('recipeKey', v_line -> 'recipe');
            end if;
          end if;
        end if;
        v_target := null;
        v_lines := v_lines || v_line;
      end loop;
      v_content := v_content || jsonb_build_object('lines', v_lines);
    end if;
    if jsonb_array_length(v_unresolved) > 0 then
      raise exception 'recipe_invalid' using errcode = 'P0001',
        detail = app.recipe_import_tag(v_unresolved::text, rownums[i]);
    end if;
    begin
      parsed[i] := app.recipe_content_parse(types[i]::public.recipe_type, v_content);
    exception when sqlstate 'P0001' then
      get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail;
      if v_msg = 'recipe_invalid' then
        raise exception 'recipe_invalid' using errcode = 'P0001', detail = app.recipe_import_tag(v_det, rownums[i]);
      end if;
      raise;
    end;
  end loop;

  -- Pass 2: version 1 of every new recipe.
  for i in 1 .. n loop
    if actions[i] = 'create' then
      ids[i] := app.insert_recipe_version(keys[i], 1, parsed[i], null);
      vers[i] := 1;
    end if;
  end loop;

  -- Pass 3: existing recipes get version n+1 unless nothing changes (then it is rolled back).
  for i in 1 .. n loop
    if actions[i] = 'existing' then
      select r.id, r.version into v_base, v_ver
        from public.recipe r join public.recipe_key rk on rk.tenant_id = r.tenant_id and rk.id = r.recipe_key
       where rk.id = keys[i] and r.version = rk.current_version;
      begin
        v_new := app.insert_recipe_version(keys[i], v_ver + 1, parsed[i], v_base);
        if app.recipe_version_content(v_new, true) = app.recipe_version_content(v_base, true) then
          raise exception 'recipe_unchanged' using errcode = 'P0001';
        end if;
        update public.recipe_key set current_version = v_ver + 1 where id = keys[i];
        actions[i] := 'new_version';
        ids[i] := v_new;
        vers[i] := v_ver + 1;
      exception when sqlstate 'P0001' then
        if sqlerrm <> 'recipe_unchanged' then
          raise;
        end if;
        actions[i] := 'unchanged';
        ids[i] := v_base;
        vers[i] := v_ver;
      end;
    end if;
  end loop;

  -- Pass 4: every written version is checked once all the versions exist.
  for i in 1 .. n loop
    if actions[i] in ('create', 'new_version') then
      begin
        warns[i] := app.validate_recipe_lines(p_tenant, types[i]::public.recipe_type, app.recipe_lines_json(ids[i]));
      exception when sqlstate 'P0001' then
        get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail;
        if v_msg = 'recipe_invalid' then
          raise exception 'recipe_invalid' using errcode = 'P0001', detail = app.recipe_import_tag(v_det, rownums[i]);
        end if;
        raise;
      end;
      changed := changed || keys[i];
    end if;
  end loop;

  -- Pass 5: the whole graph, once.
  if cardinality(changed) > 0 then
    perform app.assert_recipe_acyclic(p_tenant, changed);
  end if;

  for i in 1 .. n loop
    recipes := recipes || jsonb_build_object('row', rownums[i], 'name', parsed[i] ->> 'name',
      'action', actions[i], 'version', vers[i], 'warnings', coalesce(warns[i], '[]'::jsonb));
    if actions[i] = 'create' then created := created + 1;
    elsif actions[i] = 'new_version' then new_versions := new_versions + 1;
    else unchanged := unchanged + 1;
    end if;
  end loop;
  return jsonb_build_object('created', created, 'newVersions', new_versions, 'unchanged', unchanged,
                            'recipes', recipes);
end
$$;

create function public.import_recipes(p_rows jsonb, p_dry_run boolean default false) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_result jsonb;
begin
  perform app.require_recipe_admin();
  v_tenant := app.tenant_id();
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'recipe_invalid' using errcode = 'P0001', detail = '[{"code": "invalid_value", "field": "rows"}]';
  end if;
  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'recipe_invalid' using errcode = 'P0001', detail = '[{"code": "too_many_rows", "field": "rows"}]';
  end if;
  perform app.lock_recipe_graph(v_tenant);
  begin
    v_result := app.import_recipes_apply(v_tenant, p_rows);
    if p_dry_run then
      raise exception 'recipe_import_dry_run' using errcode = 'P0001';
    end if;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'recipe_import_dry_run' then
      raise;
    end if;
  end;
  return jsonb_build_object('dryRun', coalesce(p_dry_run, false)) || v_result;
end
$$;

-- Every active recipe's current version in the template shape, by name, with its price.
create function public.export_recipes() returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_recipe_admin();
  return jsonb_build_object('recipes', coalesce((
    select jsonb_agg(app.recipe_version_content(r.id, true) order by k.name_norm collate "C")
      from public.recipe_key k
      join public.recipe r on r.tenant_id = k.tenant_id and r.recipe_key = k.id and r.version = k.current_version
     where k.tenant_id = app.tenant_id() and k.is_active), '[]'::jsonb));
end
$$;

revoke all on function app.recipe_import_fail(text, int, text, text), app.recipe_import_tag(text, int),
  app.recipe_lines_json(uuid), app.import_recipes_apply(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.import_recipes(jsonb, boolean), public.export_recipes()
  from public, anon, authenticated, service_role;
grant execute on function public.import_recipes(jsonb, boolean), public.export_recipes() to authenticated;
