-- M18 step 8 (found by the performance net, plan T1): app.menu_item_availability as written in 20261101100100 let the
-- planner hash-join every live-state batch and aggregate the whole movement ledger, so its cost grew with the history.
-- The live batches of the plate's batch keys are now read by a helper that gets the key array as an argument, which
-- gives batch_live_idx (tenant_id, recipe_key, use_by), and each batch's balance is a correlated read of the view
-- through batch_movement_batch_idx (the batch-id qual is pushed below the view's grouping). pgTAP 168 checks both
-- indexes in the plan of the helper. Same signature, same semantics: portions_left, reason and low_stock are unchanged
-- (pgTAP 161 and 162 still pass).

-- The live balance per batch key: fresh or open batches whose use_by is after p_at, a negative balance counted as 0.
-- A key without a live batch has no row (the caller reads it as 0). Volatile, like app.batch_remaining.
create function app.live_batch_remaining(p_tenant uuid, p_keys uuid[], p_at timestamptz)
  returns table (batch_key uuid, remaining numeric)
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  select b.recipe_key,
         sum(greatest(coalesce((select pv.portions_remaining
                                  from public.v_batch_portions pv
                                 where pv.tenant_id = b.tenant_id and pv.batch_id = b.id), 0), 0))
    from public.batch b
   where b.tenant_id = p_tenant and b.recipe_key = any (p_keys) and b.state in ('fresh', 'open') and b.use_by > p_at
   group by b.recipe_key
$$;

create or replace function app.menu_item_availability(p_tenant uuid, p_items uuid[], p_at timestamptz)
  returns table (menu_item_id uuid, available boolean, reason text, portions_left numeric, low_stock boolean)
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  with items as (
    select i.id, i.recipe_key, i.is_active, i.is_available
      from public.menu_item i
     where i.tenant_id = p_tenant and (p_items is null or i.id = any (p_items))
  ), needs as (
    select i.id as item_id, n.batch_key, n.need
      from items i
      join app.plate_batch_needs(p_tenant, array(select x.recipe_key from items x where x.recipe_key is not null)) n
        on n.recipe_key = i.recipe_key
  ), remaining as (
    select k.batch_key, coalesce(r.remaining, 0) as remaining
      from (select distinct n.batch_key from needs n) k
      left join app.live_batch_remaining(p_tenant, array(select distinct n.batch_key from needs n), p_at) r
        on r.batch_key = k.batch_key
  ), per_item as (
    select n.item_id, min(floor(2 * r.remaining / n.need) / 2) as portions_left
      from needs n
      join remaining r on r.batch_key = n.batch_key
     group by n.item_id
  ), shown as (
    select i.id, i.is_active, i.is_available, p.portions_left,
           case when not i.is_active then 'inactive'
                when not i.is_available then 'manual'
                when p.portions_left = 0 then 'no_portions' end as reason
      from items i
      left join per_item p on p.item_id = i.id
  )
  select s.id, s.reason is null, s.reason, s.portions_left,
         coalesce(s.portions_left > 0 and s.portions_left <= app.low_stock_hint_portions(), false)
    from shown s
$$;

revoke all on function app.live_batch_remaining(uuid, uuid[], timestamptz) from public, anon, authenticated, service_role;
