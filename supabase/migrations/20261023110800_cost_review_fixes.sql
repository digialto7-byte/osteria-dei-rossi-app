-- M8 review fixes (code review of 831e534). Same signatures, grants, security definer and empty
-- search_path as the functions they replace; `create or replace` keeps the privileges.
--
-- 1. app.recipe_costs: the depth cap. The body of 20261023110200_recipe_cost.sql expanded rows up to
--    depth 13 and failed closed only at 14, so a chain of 13 recipes was costed. The cap is the M7 one
--    (20261023100800 recipe_allergen_summary, plan §3.1.5.4): a recipe first reached at depth 13 means a
--    path of more than 12 recipes, so it is produced, never expanded, never priced, and fails closed
--    (incomplete, graph_too_deep) with everything above it. A chain of 12 is still costed. The only
--    changes are the three bounds 13 -> 12 (expansion, ingredient pricing, fail-closed test).

-- The costs of the recipes behind p_keys at p_at (null = now). p_keys null means every active key
-- of the tenant. A key with no version in force at p_at returns no row. unit_cost: per portion for
-- a batch (cost_unit porz), per output unit for a sub (kg, l or pz), per plate for a plate.
create or replace function app.recipe_costs(p_tenant uuid, p_keys uuid[], p_at timestamptz)
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
     where w.depth <= 12 -- depth 13 is produced, never expanded
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
            where l.ingredient_id is not null and (e.value ->> 'depth')::int <= 12), p_at) c;

  -- Nodes first reached at depth 13 are deeper than the guard of 12 allows: fail closed.
  select coalesce(jsonb_object_agg(e.key, jsonb_build_object('type', e.value -> 'type', 'u', e.value -> 'cu',
           'uc', null, 'total', null, 'incomplete', true, 'reasons', '["graph_too_deep"]'::jsonb,
           'missing', '[]'::jsonb)), '{}'::jsonb)
    into v_add
    from jsonb_each(v_nodes) e
   where (e.value ->> 'depth')::int > 12;
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
