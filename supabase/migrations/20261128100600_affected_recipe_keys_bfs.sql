-- app.affected_recipe_keys as an iterative breadth-first walk, so its cost no longer depends on the plan.
--
-- Why: the recursive CTE of 20261023110600 joined the work table to recipe_line and recipe. When autovacuum has
-- vacuumed the rolled-back rows of earlier tests, pg_class holds reltuples = 0 and relpages > 0 for recipe,
-- recipe_line and recipe_key; every estimate becomes one row and the planner may nest recipe x recipe_line x
-- work-table scan with only tenant_id as the index condition: 1.5 million work-table scans, 15 s on a ladder of 241
-- recipes (and the 5 s limit of 062 test 12 failed intermittently on CI). Here each level is its own statement
-- over the sub_recipe_key index with the frontier as an array, and a plan can only differ in how it finds the rows
-- of that one level, never in how many times it runs.
--
-- Same result as the CTE: the CTE kept distinct (key, depth) rows and reached depth 14 (base depth 1, the
-- recursive step runs while depth <= 13). A key reachable by some path of at most 14 recipes is reachable by a
-- shortest one, and the walk below reaches every key at its shortest distance, so within the same cap the set is
-- the same. A visited set makes cycles end. Signature, volatility, security definer, empty search_path and the
-- grants are unchanged (create or replace keeps them; the revoke is restated as the house style does).
create or replace function app.affected_recipe_keys(p_tenant uuid, p_ingredient uuid) returns uuid[]
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_ids uuid[];
  v_frontier uuid[];
  v_visited uuid[] := '{}'::uuid[];
  v_depth integer := 1;
begin
  -- Base case: the recipes with a line on the ingredient. Every step reads one table by an indexed array
  -- lookup (lines by id array, then recipes by id array with a semi-join to the key table on its primary key),
  -- so there is no join order to get wrong when the statistics say "empty".
  select array_agg(l.recipe_id) into v_ids
    from public.recipe_line l
   where l.tenant_id = p_tenant and l.ingredient_id = p_ingredient;

  loop
    select coalesce(array_agg(distinct r.recipe_key), '{}'::uuid[]) into v_frontier
      from public.recipe r
     where r.tenant_id = p_tenant and r.id = any(coalesce(v_ids, '{}'::uuid[]))
       and r.recipe_key <> all(v_visited)
       and exists (select 1 from public.recipe_key k
                    where k.tenant_id = r.tenant_id and k.id = r.recipe_key and k.current_version = r.version);
    exit when cardinality(v_frontier) = 0;
    v_visited := v_visited || v_frontier;
    exit when v_depth > 13;
    v_depth := v_depth + 1;
    select array_agg(l.recipe_id) into v_ids
      from public.recipe_line l
     where l.tenant_id = p_tenant and l.sub_recipe_key = any(v_frontier);
  end loop;

  return (select coalesce(array_agg(k.id order by k.id), '{}'::uuid[])
            from public.recipe_key k
           where k.tenant_id = p_tenant and k.id = any(v_visited) and k.is_active);
end
$$;

revoke all on function app.affected_recipe_keys(uuid, uuid) from public, anon, authenticated, service_role;
