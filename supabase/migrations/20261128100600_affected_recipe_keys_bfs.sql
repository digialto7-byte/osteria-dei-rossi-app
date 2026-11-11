-- app.affected_recipe_keys as an iterative breadth-first walk over in-memory arrays, so its cost no longer depends on
-- the plan.
--
-- Why: the recursive CTE of 20261023110600 joined the work table to recipe_line and recipe. When autovacuum has
-- vacuumed the rolled-back rows of earlier tests, pg_class holds reltuples = 0 and relpages > 0 for recipe,
-- recipe_line and recipe_key; every estimate becomes one row and the planner may nest recipe x recipe_line x
-- work-table scan with only tenant_id as the index condition: 1.5 million work-table scans, 15 s on a ladder of 241
-- recipes (and the 5 s limit of 062 test 12 failed intermittently on CI).
--
-- What the plans do, measured with auto_explain under those statistics: with every estimate at one row, all the
-- indexes of a table cost the same and the planner picks one of them by order of creation, whatever the query says
-- (it read recipe_line by recipe_line_ingredient_idx with only tenant_id in the index condition for a lookup by
-- sub_recipe_key, and recipe by recipe_key_version_uq for a lookup by id). A lookup per id or per level therefore
-- cannot be made cheap by the shape of the query. So the cost is bounded instead of steered: each of recipe_line
-- (sub-recipe lines), recipe and recipe_key is read once per call by tenant_id, never joined to another table, into arrays (linear in
-- the rows of the tenant whichever index or scan the planner picks), and the walk is done over those arrays. The
-- statements of the loop read no table. Their joins are between small in-memory sets, whose worst join method is
-- the product of two array lengths, not a multiplication through an index.
--
-- Same result as the CTE: the CTE kept distinct (key, depth) rows and reached depth 14 (base depth 1, the
-- recursive step runs while depth <= 13). A key reachable by some path of at most 14 recipes is reachable by a
-- shortest one, and the walk below reaches every key at its shortest distance, so within the same cap the set is
-- the same. A visited set makes cycles end. A recipe counts only at the current version of its key, as in the CTE.
-- Signature, volatility, security definer, empty search_path and the grants are unchanged (create or replace keeps
-- them; the revoke is restated as the house style does).
create or replace function app.affected_recipe_keys(p_tenant uuid, p_ingredient uuid) returns uuid[]
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_ids uuid[];
  v_line_recipes uuid[];
  v_line_subs uuid[];
  v_recipes uuid[];
  v_recipe_keys uuid[];
  v_recipe_versions integer[];
  v_key_ids uuid[];
  v_key_versions integer[];
  v_cur_recipes uuid[];
  v_cur_keys uuid[];
  v_active_keys uuid[];
  v_frontier uuid[];
  v_visited uuid[] := '{}'::uuid[];
  v_depth integer := 1;
begin
  -- The four reads of tables, one statement each, one table each. Only recipes whose version is the current version of
  -- their key count.
  select coalesce(array_agg(l.recipe_id), '{}'::uuid[]) into v_ids
    from public.recipe_line l
   where l.tenant_id = p_tenant and l.ingredient_id = p_ingredient;
  select coalesce(array_agg(l.recipe_id), '{}'::uuid[]), coalesce(array_agg(l.sub_recipe_key), '{}'::uuid[])
    into v_line_recipes, v_line_subs
    from public.recipe_line l
   where l.tenant_id = p_tenant and l.sub_recipe_key is not null;
  select coalesce(array_agg(r.id), '{}'::uuid[]), coalesce(array_agg(r.recipe_key), '{}'::uuid[]),
         coalesce(array_agg(r.version), '{}'::integer[])
    into v_recipes, v_recipe_keys, v_recipe_versions
    from public.recipe r
   where r.tenant_id = p_tenant;
  select coalesce(array_agg(k.id), '{}'::uuid[]), coalesce(array_agg(k.current_version), '{}'::integer[]),
         coalesce(array_agg(k.id) filter (where k.is_active), '{}'::uuid[])
    into v_key_ids, v_key_versions, v_active_keys
    from public.recipe_key k
   where k.tenant_id = p_tenant;
  -- Matched in memory (never as a join of the two tables, which is the plan that went wrong).
  select coalesce(array_agg(r.id), '{}'::uuid[]), coalesce(array_agg(r.key), '{}'::uuid[])
    into v_cur_recipes, v_cur_keys
    from unnest(v_recipes, v_recipe_keys, v_recipe_versions) as r(id, key, ver)
    join unnest(v_key_ids, v_key_versions) as k(id, ver) on k.id = r.key and k.ver = r.ver;

  loop
    -- Keys of the recipes in v_ids, not seen at a shorter distance.
    select coalesce(array_agg(f.key), '{}'::uuid[]) into v_frontier
      from (select m.key
              from unnest(v_ids) as i(id)
              join unnest(v_cur_recipes, v_cur_keys) as m(id, key) on m.id = i.id
            except
            select unnest(v_visited)) f;
    exit when cardinality(v_frontier) = 0;
    v_visited := v_visited || v_frontier;
    exit when v_depth > 13;
    v_depth := v_depth + 1;
    select coalesce(array_agg(l.recipe_id), '{}'::uuid[]) into v_ids
      from unnest(v_line_recipes, v_line_subs) as l(recipe_id, sub_key)
      join unnest(v_frontier) as f(key) on f.key = l.sub_key;
  end loop;

  return (select coalesce(array_agg(a.id order by a.id), '{}'::uuid[])
            from unnest(v_active_keys) as a(id)
            join unnest(v_visited) as v(id) on v.id = a.id);
end
$$;

revoke all on function app.affected_recipe_keys(uuid, uuid) from public, anon, authenticated, service_role;
