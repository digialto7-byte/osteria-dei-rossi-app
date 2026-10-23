-- M7 code-review round 2 (NOTE): the two recursive walks over the recipe graph visit distinct
-- recipes, not every path.
--
-- Finding: app.assert_recipe_acyclic (cycle part) and public.recipe_allergen_summary carried a path
-- array per row (20261023100700), so a "diamond" ladder (L layers of W subs, each using all W subs of
-- the next layer) cost W^L rows although it holds only W x L recipes. Measured with W = 4, L = 10 and
-- a plate on top: every save was accepted but the summary of the plate ran over 60 s (the
-- `authenticated` role stops at 8 s, so /ricette and the plate page would fail for the tenant); at
-- W = 5 the cycle check itself timed out on save. An owner or chef can build this with normal saves.
--
-- 1. app.assert_recipe_acyclic, cycle part: rows are (root, key, depth, parent), joined with UNION
--    (not UNION ALL), so a recipe is expanded once per depth no matter how many paths reach it. A
--    cycle is a row where the walk comes back to its root. The exception detail (the keys of a
--    shortest closing loop, root first and last) is rebuilt from the least-depth row of each key, so
--    the message is unchanged in shape. The depth part (below and above, distinct (root, key, depth))
--    was already deduplicated in both directions and is kept as it was.
-- 2. public.recipe_allergen_summary: rows are (root, key, depth) with UNION. The cap rule is the
--    guard's: a row at depth 13 means some path from the root reaches more than 12 recipes, so that
--    root reports confirmed = false (fail closed). Rows at depth 13 are produced, never expanded.
--    Output is identical for every graph the guard allows. One difference, on data the guard refuses
--    anyway (a loop written by hand): the old walk skipped a recipe already on its own path; this one
--    walks the loop until depth 13 and so reports confirmed = false for roots that reach it.
--
-- Signatures, volatility, search_path = '', owner, grants and the lock order (tenant graph lock taken
-- by the writers before they call the helper) are unchanged; create or replace keeps the ACLs.

create or replace function app.assert_recipe_acyclic(p_tenant uuid, p_keys uuid[]) returns void
  language plpgsql
  set search_path = ''
as $$
declare
  v_cycle uuid[];
  v_deep boolean;
begin
  -- Loops first. A row is (root, key, depth, parent); "union" removes repeated rows, so each recipe
  -- is expanded once per depth. The depth bound only stops a loop (rows repeat after at most 14).
  with recursive walk (root, key, depth, parent) as (
    select k, k, 1, null::uuid from unnest(p_keys) as k
    union
    select w.root, l.sub_recipe_key, w.depth + 1, w.key
      from walk w
      join public.recipe_key rk on rk.tenant_id = p_tenant and rk.id = w.key
      join public.recipe r
        on r.tenant_id = p_tenant and r.recipe_key = rk.id and r.version = rk.current_version
      join public.recipe_line l
        on l.tenant_id = p_tenant and l.recipe_id = r.id and l.sub_recipe_key is not null
     where w.depth <= 13
  ),
  -- The shortest way back to a root (ties: lowest ids).
  hit as (
    select x.root, x.parent
      from walk x
     where x.key = x.root and x.depth > 1
     order by x.depth, x.root, x.parent
     limit 1
  ),
  best as (
    select distinct on (x.key) x.key, x.parent
      from walk x
     where x.root = (select root from hit)
     order by x.key, x.depth, x.parent
  ),
  chain (key, n) as (
    select h.parent, 1 from hit h
    union all
    select b.parent, c.n + 1
      from chain c
      join best b on b.key = c.key
     where b.parent is not null
  )
  select case when exists (select 1 from hit)
              then (select array_agg(c.key order by c.n desc) from chain c) || (select h.root from hit h)
         end
    into v_cycle;
  if v_cycle is not null then
    raise exception 'recipe_cycle' using errcode = 'P0001', detail = array_to_string(v_cycle, ',');
  end if;

  -- Depth: for each changed key, levels below (itself = 1) + levels above (itself = 1) - 1 <= 12.
  -- "distinct" rows (union) keep this polynomial in both directions; the depth bound of 14 only
  -- stops a loop that the check above would already have refused.
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
  with recursive walk (root, key, depth) as (
    select v.recipe_key, v.recipe_key, 1
      from public.v_recipe_current v
     where v.recipe_key = any (p_keys)
    union
    select w.root, l.sub_recipe_key, w.depth + 1
      from walk w
      join public.v_recipe_current v on v.recipe_key = w.key
      join public.recipe_line l on l.recipe_id = v.id
     where l.sub_recipe_key is not null
       and w.depth <= 12 -- depth 13 is produced, never extended: it only flags
  ),
  too_deep as (
    select distinct w.root from walk w where w.depth > 12
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
