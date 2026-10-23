-- M8 step 3: the recursive recipe cost engine, recipe_cost_at, recipe_costs and v_recipe_cost
-- (M8 plan §3.1.4-5, §3.2; ADR-008). Derived on read at an explicit instant, nothing stored.
--
-- Graph walk: distinct nodes, then levels (the M7 pattern of 20261023100800). The reachable
-- recipes are collected with a recursive CTE whose rows are (key, depth) joined with UNION, so a
-- recipe is expanded once per depth however many paths reach it (a diamond of W x L recipes costs
-- W x L rows, not W^L). Costs are then computed bottom-up in rounds, each round one set-based
-- query over every recipe whose sub-recipes are all costed (Kahn's order). Paths are never
-- enumerated. Depth 13 is produced and never expanded: a recipe first reached there is deeper
-- than the guard of 12 allows and fails closed (graph_too_deep), as does anything left over after
-- the rounds (a hand-written loop).
--
-- Unknown is never zero: a line without a price, a unit that cannot convert or a sub-recipe with
-- no version in force makes the line, and every recipe above it, incomplete (null cost, reasons,
-- the missing ingredient ids).

-- Base units per one recipe unit (the factors of app.base_factor and the M7 units).
create function app.recipe_unit_factor(p_unit public.recipe_unit) returns numeric
  language sql immutable
  set search_path = ''
as $$
  select case p_unit when 'g' then 0.001 when 'ml' then 0.001 else 1 end
$$;

-- The version of a recipe key in force at an instant: the current version when p_at is null, else
-- the highest version whose valid_from is not after p_at (valid_from grows with the version).
create function app.recipe_in_force(p_tenant uuid, p_key uuid, p_at timestamptz) returns uuid
  language sql stable
  set search_path = ''
as $$
  select r.id
    from public.recipe r
   where r.tenant_id = p_tenant and r.recipe_key = p_key
     and ((p_at is null and r.version = (select k.current_version from public.recipe_key k
                                          where k.tenant_id = p_tenant and k.id = p_key))
          or (p_at is not null and r.valid_from <= p_at))
   order by r.version desc
   limit 1
$$;

-- Every line of the given recipe versions priced from two maps built by the callers:
--   p_ing  ingredient id -> {"c": unit cost or null, "u": base unit}
--   p_subs sub-recipe key -> {"type", "u" (output unit, or porz for a batch), "uc" (unit cost),
--                             "incomplete", "reasons", "missing"}
-- A sub-recipe missing from p_subs has no version in force. Reasons: missing_price, unit_mismatch,
-- sub_not_in_force, and the reasons of an incomplete sub-recipe, inherited.
create function app.recipe_line_costs(p_tenant uuid, p_recipe_ids uuid[], p_ing jsonb, p_subs jsonb)
  returns table (recipe_id uuid, line_position smallint, ingredient_id uuid, sub_recipe_key uuid,
                 qty numeric, unit public.recipe_unit, yield_factor numeric, unit_cost numeric,
                 line_cost numeric, incomplete boolean, reasons text[], missing uuid[])
  language sql stable
  set search_path = ''
as $$
  with base as (
    select l.recipe_id, l.position, l.ingredient_id, l.sub_recipe_key, l.qty, l.unit, l.yield_factor,
           p_ing -> l.ingredient_id::text as i, p_subs -> l.sub_recipe_key::text as s
      from public.recipe_line l
     where l.tenant_id = p_tenant and l.recipe_id = any (p_recipe_ids)
  ), cls as (
    select b.*,
           case
             when b.ingredient_id is not null then
               case when b.i is null then 'missing_price'
                    when app.recipe_unit_dimension(b.unit)
                         is distinct from app.recipe_unit_dimension((b.i ->> 'u')::public.recipe_unit)
                      then 'unit_mismatch'
                    when jsonb_typeof(b.i -> 'c') <> 'number' then 'missing_price'
               end
             when b.s is null then 'sub_not_in_force'
             else
               case b.s ->> 'type'
                 when 'batch' then
                   case when b.unit <> 'porz' then 'unit_mismatch'
                        when (b.s ->> 'incomplete')::boolean then 'inherited' end
                 when 'sub' then
                   case when app.recipe_unit_dimension(b.unit)
                             is distinct from app.recipe_unit_dimension((b.s ->> 'u')::public.recipe_unit)
                          then 'unit_mismatch'
                        when (b.s ->> 'incomplete')::boolean then 'inherited' end
                 else 'unit_mismatch'
               end
           end as code
      from base b
  )
  select c.recipe_id, c.position, c.ingredient_id, c.sub_recipe_key, c.qty, c.unit, c.yield_factor,
         x.uc, x.uc * c.qty * app.recipe_unit_factor(c.unit) / c.yield_factor,
         c.code is not null,
         case when c.code = 'inherited' then array(select jsonb_array_elements_text(c.s -> 'reasons'))
              when c.code is null then '{}'::text[]
              else array[c.code]
         end,
         case
           when c.code = 'missing_price' and c.ingredient_id is not null then array[c.ingredient_id]
           when c.code = 'inherited' then array(select (jsonb_array_elements_text(c.s -> 'missing'))::uuid)
           else '{}'::uuid[]
         end
    from cls c
   cross join lateral (
     select case when c.code is not null then null::numeric
                 when c.ingredient_id is not null then (c.i ->> 'c')::numeric
                 else (c.s ->> 'uc')::numeric end as uc
   ) x
$$;

-- The costs of the recipes behind p_keys at p_at (null = now). p_keys null means every active key
-- of the tenant. A key with no version in force at p_at returns no row. unit_cost: per portion for
-- a batch (cost_unit porz), per output unit for a sub (kg, l or pz), per plate for a plate.
create function app.recipe_costs(p_tenant uuid, p_keys uuid[], p_at timestamptz)
  returns table (recipe_key uuid, recipe_id uuid, version integer, type public.recipe_type, name text,
                 total_cost numeric, unit_cost numeric, cost_unit text, incomplete boolean,
                 reasons text[], missing_ingredient_ids uuid[])
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_roots uuid[];
  v_nodes jsonb;
  v_ing jsonb;
  v_done jsonb := '{}';
  v_add jsonb;
  v_added integer;
  v_round integer := 0;
begin
  if p_keys is not null and cardinality(p_keys) > 1000 then
    raise exception 'too_many_keys' using errcode = 'P0001';
  end if;
  v_roots := coalesce(p_keys, array(select k.id from public.recipe_key k
                                     where k.tenant_id = p_tenant and k.is_active));

  -- 1. Distinct nodes: (key, depth) rows with UNION, each key resolved to its version in force.
  with recursive walk (key, depth) as (
    select k, 1 from unnest(v_roots) k
    union
    select l.sub_recipe_key, w.depth + 1
      from walk w
      join public.recipe_line l
        on l.tenant_id = p_tenant and l.recipe_id = app.recipe_in_force(p_tenant, w.key, p_at)
       and l.sub_recipe_key is not null
     where w.depth <= 13 -- depth 14 is produced, never expanded
  ), nodes as (
    select w.key, min(w.depth) as depth from walk w group by w.key
  )
  select coalesce(jsonb_object_agg(n.key::text, jsonb_build_object(
           'key', n.key, 'id', r.id, 'depth', n.depth, 'version', r.version, 'name', r.name,
           'type', k.type, 'oq', r.output_qty, 'ou', r.output_unit, 'ppb', r.portions_per_batch,
           'cu', case k.type when 'batch' then 'porz' when 'sub' then r.output_unit::text else 'piatto' end)),
         '{}'::jsonb)
    into v_nodes
    from nodes n
    join public.recipe r on r.id = app.recipe_in_force(p_tenant, n.key, p_at)
    join public.recipe_key k on k.tenant_id = p_tenant and k.id = n.key;

  -- 2. One call for the unit cost of every ingredient reached.
  select coalesce(jsonb_object_agg(c.ingredient_id::text,
           jsonb_build_object('c', c.unit_cost, 'u', c.base_unit)), '{}'::jsonb)
    into v_ing
    from app.ingredient_unit_costs(p_tenant, array(
           select distinct l.ingredient_id
             from jsonb_each(v_nodes) e
             join public.recipe_line l
               on l.tenant_id = p_tenant and l.recipe_id = (e.value ->> 'id')::uuid
            where l.ingredient_id is not null and (e.value ->> 'depth')::int <= 13), p_at) c;

  -- Nodes first reached at depth 14 are deeper than the guard allows: fail closed.
  select coalesce(jsonb_object_agg(e.key, jsonb_build_object('type', e.value -> 'type', 'u', e.value -> 'cu',
           'uc', null, 'total', null, 'incomplete', true, 'reasons', '["graph_too_deep"]'::jsonb,
           'missing', '[]'::jsonb)), '{}'::jsonb)
    into v_add
    from jsonb_each(v_nodes) e
   where (e.value ->> 'depth')::int > 13;
  v_done := v_done || v_add;

  -- 3. Bottom-up rounds.
  loop
    v_round := v_round + 1;
    exit when v_round > 14;
    with ready as (
      select e.value as n
        from jsonb_each(v_nodes) e
       where not (v_done ? e.key)
         and not exists (
           select 1
             from public.recipe_line l
            where l.tenant_id = p_tenant and l.recipe_id = (e.value ->> 'id')::uuid
              and l.sub_recipe_key is not null
              and v_nodes ? l.sub_recipe_key::text
              and not (v_done ? l.sub_recipe_key::text))
    ), lc as (
      select * from app.recipe_line_costs(p_tenant, array(select (r.n ->> 'id')::uuid from ready r),
                                          v_ing, v_done)
    ), agg as (
      select lc.recipe_id as rid,
             bool_or(lc.incomplete) as inc,
             sum(lc.line_cost) as total,
             coalesce((select array_agg(x.r order by x.r collate "C")
                         from (select distinct r from lc l2, unnest(l2.reasons) r
                                where l2.recipe_id = lc.recipe_id) x), '{}'::text[]) as reasons,
             coalesce((select array_agg(x.m order by x.m)
                         from (select distinct m from lc l2, unnest(l2.missing) m
                                where l2.recipe_id = lc.recipe_id) x), '{}'::uuid[]) as missing
        from lc
       group by lc.recipe_id
    ), res as (
      select r.n,
             coalesce(a.inc, true) as inc,
             case when coalesce(a.inc, true) then null else a.total end as total,
             case when a.rid is null then array['no_lines'] else a.reasons end as reasons,
             coalesce(a.missing, '{}'::uuid[]) as missing
        from ready r
        left join agg a on a.rid = (r.n ->> 'id')::uuid
    )
    select coalesce(jsonb_object_agg(res.n ->> 'key', jsonb_build_object(
             'type', res.n -> 'type', 'u', res.n -> 'cu', 'incomplete', res.inc,
             'total', res.total,
             'uc', case res.n ->> 'type'
                     when 'batch' then res.total / (res.n ->> 'ppb')::numeric
                     when 'sub' then res.total / (res.n ->> 'oq')::numeric
                     else res.total end,
             'reasons', to_jsonb(res.reasons), 'missing', to_jsonb(res.missing))), '{}'::jsonb),
           count(*)
      into v_add, v_added
      from res;
    exit when v_added = 0;
    v_done := v_done || v_add;
  end loop;

  -- Whatever is still open sits on a loop (or below one).
  select coalesce(jsonb_object_agg(e.key, jsonb_build_object('type', e.value -> 'type', 'u', e.value -> 'cu',
           'uc', null, 'total', null, 'incomplete', true, 'reasons', '["graph_too_deep"]'::jsonb,
           'missing', '[]'::jsonb)), '{}'::jsonb)
    into v_add
    from jsonb_each(v_nodes) e
   where not (v_done ? e.key);
  v_done := v_done || v_add;

  return query
  select (n.value ->> 'key')::uuid, (n.value ->> 'id')::uuid, (n.value ->> 'version')::integer,
         (n.value ->> 'type')::public.recipe_type, n.value ->> 'name',
         (v_done -> n.key ->> 'total')::numeric, (v_done -> n.key ->> 'uc')::numeric,
         n.value ->> 'cu', (v_done -> n.key ->> 'incomplete')::boolean,
         array(select jsonb_array_elements_text(v_done -> n.key -> 'reasons')),
         array(select (jsonb_array_elements_text(v_done -> n.key -> 'missing'))::uuid)
    from jsonb_each(v_nodes) n
   where (n.value ->> 'key')::uuid = any (v_roots)
   order by n.value ->> 'name' collate "C", n.key;
end
$$;

-- One version's lines priced with the engine (sub-recipes through app.recipe_costs, ingredients
-- through app.ingredient_unit_costs), for recipe_cost_at now and for M19's frozen sale cost.
create function app.recipe_cost_lines(p_tenant uuid, p_recipe_id uuid, p_at timestamptz)
  returns table (line_position smallint, ingredient_id uuid, sub_recipe_key uuid, qty numeric,
                 unit public.recipe_unit, yield_factor numeric, unit_cost numeric, line_cost numeric,
                 incomplete boolean, reason text)
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_subs jsonb;
  v_ing jsonb;
begin
  select coalesce(jsonb_object_agg(rc.recipe_key::text, jsonb_build_object(
           'type', rc.type, 'u', rc.cost_unit, 'uc', rc.unit_cost, 'incomplete', rc.incomplete,
           'reasons', to_jsonb(rc.reasons), 'missing', to_jsonb(rc.missing_ingredient_ids))), '{}'::jsonb)
    into v_subs
    from app.recipe_costs(p_tenant, array(
           select distinct l.sub_recipe_key from public.recipe_line l
            where l.tenant_id = p_tenant and l.recipe_id = p_recipe_id and l.sub_recipe_key is not null),
         p_at) rc;
  select coalesce(jsonb_object_agg(c.ingredient_id::text,
           jsonb_build_object('c', c.unit_cost, 'u', c.base_unit)), '{}'::jsonb)
    into v_ing
    from app.ingredient_unit_costs(p_tenant, array(
           select distinct l.ingredient_id from public.recipe_line l
            where l.tenant_id = p_tenant and l.recipe_id = p_recipe_id and l.ingredient_id is not null),
         p_at) c;
  return query
  select lc.line_position, lc.ingredient_id, lc.sub_recipe_key, lc.qty, lc.unit, lc.yield_factor,
         lc.unit_cost, lc.line_cost, lc.incomplete, lc.reasons[1]
    from app.recipe_line_costs(p_tenant, array[p_recipe_id], v_ing, v_subs) lc
   order by lc.line_position;
end
$$;

revoke all on function app.recipe_unit_factor(public.recipe_unit),
  app.recipe_in_force(uuid, uuid, timestamptz),
  app.recipe_line_costs(uuid, uuid[], jsonb, jsonb),
  app.recipe_costs(uuid, uuid[], timestamptz),
  app.recipe_cost_lines(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;

-- The cost of one recipe on a Rome date (end of that day), or now when the date is null.
-- plate is filled in by the plate outputs (step 4).
create function public.recipe_cost_at(p_key uuid, p_date date default null) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tz text;
  v_at timestamptz;
  v_cost record;
  v_lines jsonb;
begin
  perform app.require_cost_reader();
  v_tenant := app.tenant_id();
  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'position', lc.line_position,
           'target', case when lc.ingredient_id is not null
                       then jsonb_build_object('kind', 'ingredient', 'id', lc.ingredient_id, 'name', i.name)
                       else jsonb_build_object('kind', 'recipe', 'id', lc.sub_recipe_key,
                              'name', coalesce(sr.name, sk.name_norm)) end,
           'qty', lc.qty, 'unit', lc.unit, 'yieldFactor', lc.yield_factor,
           'unitCostEur', round(lc.unit_cost, 4), 'lineCostEur', round(lc.line_cost, 4),
           'incomplete', lc.incomplete, 'reason', lc.reason) order by lc.line_position), '[]'::jsonb)
    into v_lines
    from app.recipe_cost_lines(v_tenant, v_cost.recipe_id, v_at) lc
    left join public.ingredient i on i.tenant_id = v_tenant and i.id = lc.ingredient_id
    left join public.recipe_key sk on sk.tenant_id = v_tenant and sk.id = lc.sub_recipe_key
    left join public.recipe sr on sr.id = app.recipe_in_force(v_tenant, lc.sub_recipe_key, v_at);

  return jsonb_build_object(
    'recipeKey', v_cost.recipe_key, 'recipeId', v_cost.recipe_id, 'version', v_cost.version,
    'type', v_cost.type, 'name', v_cost.name, 'at', p_date,
    'totalCostEur', round(v_cost.total_cost, 4), 'unitCostEur', round(v_cost.unit_cost, 4),
    'costUnit', v_cost.cost_unit, 'incomplete', v_cost.incomplete, 'reasons', to_jsonb(v_cost.reasons),
    'missingIngredientIds', to_jsonb(v_cost.missing_ingredient_ids), 'lines', v_lines, 'plate', null);
end
$$;

-- The current cost of every active recipe of the tenant.
create function public.recipe_costs()
  returns table (recipe_key uuid, version integer, type public.recipe_type, name text,
                 total_cost_eur numeric, unit_cost_eur numeric, cost_unit text, incomplete boolean,
                 reasons text[], missing_ingredient_ids uuid[])
  language plpgsql stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_cost_reader();
  return query
  select c.recipe_key, c.version, c.type, c.name, round(c.total_cost, 4), round(c.unit_cost, 4),
         c.cost_unit, c.incomplete, c.reasons, c.missing_ingredient_ids
    from app.recipe_costs(app.tenant_id(), null, null) c;
end
$$;

revoke all on function public.recipe_cost_at(uuid, date), public.recipe_costs()
  from public, anon, authenticated, service_role;
grant execute on function public.recipe_cost_at(uuid, date), public.recipe_costs() to authenticated;

-- A view over the definer function: the chef and the waiter get 42501 from it, whatever the
-- table policies say (Q16 = V6).
create view public.v_recipe_cost with (security_invoker = true) as
  select * from public.recipe_costs();
revoke all on public.v_recipe_cost from public, anon, authenticated, service_role;
grant select on public.v_recipe_cost to authenticated;
