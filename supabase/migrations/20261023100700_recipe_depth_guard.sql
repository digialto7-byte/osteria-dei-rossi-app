-- M7 code-review round 1: the nesting cap holds through the changed recipe, and the allergen
-- summary fails closed.
--
-- Finding: assert_recipe_acyclic (20261023100300) measured only the levels BELOW the recipe being
-- saved. A chain could be built bottom-up, one new version at a time, each step looking short from
-- where it was saved, until a plate sat 14+ recipes above an ingredient. recipe_allergen_summary
-- (20261023100400) walked at most 14 and silently dropped the rest, so it could say "confirmed"
-- over an ingredient it never read.
--
-- 1. app.assert_recipe_acyclic now measures the longest path THROUGH each changed recipe: the
--    longest chain of recipes that use it (current versions, counting itself) plus the longest chain
--    below it, minus the shared recipe itself. More than 12 recipes on one path is recipe_too_deep
--    (P0001, 422 in the API). The cap is unchanged: 12 recipes on a path, a plate counts as one.
--    Every writer already calls this helper after its version is current (create_recipe,
--    create_recipe_version through write_recipe_version, import_recipes_apply), so all three are
--    covered with no change to them. Levels are collected as distinct (key, depth) pairs, so the
--    work is bounded by keys x 13 and does not grow with the number of paths through a diamond.
--    Signature, search_path, grants and the lock order (tenant graph lock first) are unchanged.
-- 2. public.recipe_allergen_summary reads one level further than the cap allows. If any path from
--    the key reaches 13 recipes, data exists that the guard would refuse (written before this
--    migration, or by a bug), so the summary cannot claim to have read everything: that key reports
--    confirmed = false. Chosen form: no new column and no sentinel in the id list. The allergens
--    are the union of what was read, confirmed is false, and unconfirmed_ingredient_ids lists only
--    ingredients really found unconfirmed (it may be empty: "da confermare", nothing named).
--
-- Supersedes the comments in 20261023100300 ("nesting deeper than 12 levels" below the changed key)
-- and 20261023100400 (walk of at most 14), which are committed and not edited. It also supersedes
-- the comments at 20261023100000:106 and :115 that name admin as a confirmer: since
-- 20261023100600 only the owner confirms allergens (Q6).

create or replace function app.assert_recipe_acyclic(p_tenant uuid, p_keys uuid[]) returns void
  language plpgsql
  set search_path = ''
as $$
declare
  v_cycle uuid[];
  v_deep boolean;
begin
  -- Loops first: the path array stops infinite recursion.
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
  select (select x.path from walk x where x.closes order by cardinality(x.path), x.path::text limit 1)
    into v_cycle;
  if v_cycle is not null then
    raise exception 'recipe_cycle' using errcode = 'P0001', detail = array_to_string(v_cycle, ',');
  end if;

  -- Depth: for each changed key, levels below (itself = 1) + levels above (itself = 1) - 1 <= 12.
  -- "distinct" rows (union) keep this polynomial; the depth bound of 14 only stops a loop that the
  -- check above would already have refused.
  with recursive below (root, key, depth) as (
    select k, k, 1 from unnest(p_keys) as k
    union
    select b.root, l.sub_recipe_key, b.depth + 1
      from below b
      join public.recipe_key rk on rk.tenant_id = p_tenant and rk.id = b.key
      join public.recipe r
        on r.tenant_id = p_tenant and r.recipe_key = rk.id and r.version = rk.current_version
      join public.recipe_line l
        on l.tenant_id = p_tenant and l.recipe_id = r.id and l.sub_recipe_key is not null
     where b.depth <= 13
  ),
  above (root, key, depth) as (
    select k, k, 1 from unnest(p_keys) as k
    union
    select a.root, r.recipe_key, a.depth + 1
      from above a
      join public.recipe_line l
        on l.tenant_id = p_tenant and l.sub_recipe_key = a.key
      join public.recipe r on r.tenant_id = p_tenant and r.id = l.recipe_id
      join public.recipe_key rk on rk.tenant_id = p_tenant and rk.id = r.recipe_key
       and r.version = rk.current_version
     where a.depth <= 13
  )
  select exists (
    select 1
      from (select root, max(depth) as d from below group by root) lo
      join (select root, max(depth) as d from above group by root) hi using (root)
     where lo.d + hi.d - 1 > 12)
    into v_deep;
  if v_deep then
    raise exception 'recipe_too_deep' using errcode = 'P0001';
  end if;
end
$$;

create or replace function public.recipe_allergen_summary(p_keys uuid[])
  returns table (recipe_key uuid, allergens public.allergen[], confirmed boolean,
                 unconfirmed_ingredient_ids uuid[])
  language plpgsql stable
  set search_path = ''
as $$
begin
  if cardinality(p_keys) > 200 then
    raise exception 'too_many_keys' using errcode = 'P0001';
  end if;
  return query
  with recursive walk (root, key, path) as (
    select v.recipe_key, v.recipe_key, array[v.recipe_key]
      from public.v_recipe_current v
     where v.recipe_key = any (p_keys)
    union all
    select w.root, l.sub_recipe_key, w.path || l.sub_recipe_key
      from walk w
      join public.v_recipe_current v on v.recipe_key = w.key
      join public.recipe_line l on l.recipe_id = v.id
     where l.sub_recipe_key is not null
       and not (l.sub_recipe_key = any (w.path))
       and cardinality(w.path) <= 12 -- a path of 13 is produced, never extended: it only flags
  ),
  too_deep as (
    select distinct w.root from walk w where cardinality(w.path) > 12
  ),
  reached as (
    select distinct w.root, l.ingredient_id
      from walk w
      join public.v_recipe_current v on v.recipe_key = w.key
      join public.recipe_line l on l.recipe_id = v.id
     where l.ingredient_id is not null
  )
  select roots.root,
         coalesce((select array_agg(distinct a order by a)
                     from reached r
                     join public.ingredient i on i.id = r.ingredient_id
                    cross join lateral unnest(i.allergens) as a
                    where r.root = roots.root), '{}'::public.allergen[]),
         coalesce((select bool_and(i.allergen_status = 'confirmed')
                     from reached r join public.ingredient i on i.id = r.ingredient_id
                    where r.root = roots.root), true)
           and not exists (select 1 from too_deep d where d.root = roots.root),
         coalesce((select array_agg(i.id order by i.id)
                     from reached r join public.ingredient i on i.id = r.ingredient_id
                    where r.root = roots.root and i.allergen_status <> 'confirmed'), '{}'::uuid[])
    from (select distinct root from walk) as roots
   order by roots.root;
end
$$;

-- app.recipe_unit_dimension is called only from SECURITY DEFINER procedures (through
-- app.validate_recipe_lines), which run as the owner, so no API role needs to execute it. Like the
-- other app.* recipe helpers it is now executable by none of them.
revoke all on function app.recipe_unit_dimension(public.recipe_unit) from public, anon, authenticated, service_role;

-- app.allergen_set keeps its grant to authenticated and service_role on purpose: it is called by
-- the ingredient allergen guard trigger, which is SECURITY INVOKER and fires in the caller's role
-- (any role that edits an ingredient), and by import_ingredients' change test. Revoking it would
-- break those statements for the caller. It is a pure normalising function and reads no table.
comment on function app.allergen_set(public.allergen[]) is
  'Normalises an allergen list (null stays null, else sorted and de-duplicated). Executable by authenticated and service_role on purpose: the invoker trigger ingredient_allergen_guard and import_ingredients call it in the caller''s role.';
