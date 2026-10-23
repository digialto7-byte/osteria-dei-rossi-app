-- M7 step 6: recipe allergens are derived on read, never stored (M7 plan §3.1.7; ADR-007).
-- For each key, walk the current version, then the current versions of every sub-recipe and batch
-- below it, down to the ingredients: the allergens are the union of the declared lists; the recipe
-- is confirmed only if every ingredient reached is confirmed. An ingredient that is not stated or
-- only declared (not confirmed) makes the recipe "da confermare". Allergens are a present-tense
-- safety statement, so a past version also reports through today's data (plan A3).
-- SECURITY INVOKER: the caller's RLS decides what is visible, so a waiter or another tenant gets no
-- rows. No price, cost or margin column exists here.

create function public.recipe_allergen_summary(p_keys uuid[])
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
       and cardinality(w.path) <= 13
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
                    where r.root = roots.root), true),
         coalesce((select array_agg(i.id order by i.id)
                     from reached r join public.ingredient i on i.id = r.ingredient_id
                    where r.root = roots.root and i.allergen_status <> 'confirmed'), '{}'::uuid[])
    from (select distinct root from walk) as roots
   order by roots.root;
end
$$;

revoke all on function public.recipe_allergen_summary(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.recipe_allergen_summary(uuid[]) to authenticated;
