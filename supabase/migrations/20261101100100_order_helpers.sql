-- M18 step 2: the helpers behind the order procedures (M18 plan §3.1.5, §3.1.9, §3.2; ADR-017). All in schema app with an
-- empty search_path; none is executable by an API role.
--   low_stock_hint_portions   the "Ne restano N" threshold (3, Q77)
--   client_clock_tolerance    how far ahead of the server a client instant may be (120 s, Q80)
--   plate_batch_needs         the portions of each batch a plate needs, from its current version (M19 depletes with the same)
--   menu_item_availability    portions left, reason and low-stock flag per menu item; VOLATILE so a call after a lock sees
--                             what the previous lock holder committed (the technique of app.batch_remaining)
--   lock_live_batches         FOR SHARE on the live batch rows of some keys, in id order (discard/adjust/split/M19 take
--                             them FOR UPDATE, so an add and a stock drop serialise; adds do not block each other)
--   order_line_json           the waiter-safe shape of one line (no cost, margin, VAT or recipe key)
--   parse_client_time         an ISO 8601 instant with offset; client_time_invalid beyond the tolerance

create function app.low_stock_hint_portions() returns numeric
  language sql
  immutable
  set search_path = ''
as $$ select 3::numeric $$;

create function app.client_clock_tolerance() returns interval
  language sql
  immutable
  set search_path = ''
as $$ select interval '120 seconds' $$;

-- A plate's batch needs: its current version's top-level lines whose sub-recipe key is of type batch (a batch is used by
-- plates only, always in porz: 20261023100300). need = qty / yield_factor, summed when a batch appears twice.
create function app.plate_batch_needs(p_tenant uuid, p_recipe_keys uuid[])
  returns table (recipe_key uuid, batch_key uuid, need numeric)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select k.id, l.sub_recipe_key, sum(l.qty / l.yield_factor)
    from public.recipe_key k
    join public.recipe r on r.tenant_id = k.tenant_id and r.recipe_key = k.id and r.version = k.current_version
    join public.recipe_line l on l.tenant_id = r.tenant_id and l.recipe_id = r.id and l.sub_recipe_key is not null
    join public.recipe_key bk on bk.tenant_id = l.tenant_id and bk.id = l.sub_recipe_key and bk.type = 'batch'
   where k.tenant_id = p_tenant and k.id = any (p_recipe_keys)
   group by k.id, l.sub_recipe_key
$$;

-- Availability. portions_left is null when the item is unmapped or its plate uses no batch (always available: only
-- batches limit an order, raw stock never does). Otherwise it is the minimum over the plate's needs of
-- floor(2 x remaining / need) / 2, in half portions, where remaining sums the live batches of the key (fresh or open,
-- use_by after p_at) with a negative balance counted as 0. Reason, first match: inactive, manual (the owner's
-- "esaurito"), no_portions (0 left). Drafts reserve nothing (Q76).
create function app.menu_item_availability(p_tenant uuid, p_items uuid[], p_at timestamptz)
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
    select k.batch_key, coalesce(sum(greatest(coalesce(v.portions_remaining, 0), 0)), 0) as remaining
      from (select distinct n.batch_key from needs n) k
      left join public.batch b
        on b.tenant_id = p_tenant and b.recipe_key = k.batch_key and b.state in ('fresh', 'open') and b.use_by > p_at
      left join lateral (select pv.portions_remaining
                           from public.v_batch_portions pv
                          where pv.tenant_id = p_tenant and pv.batch_id = b.id) v on true
     group by k.batch_key
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

-- Shared row locks on the live batches of the given keys; the number of rows locked.
create function app.lock_live_batches(p_tenant uuid, p_batch_keys uuid[]) returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_n integer;
begin
  perform 1
    from public.batch b
   where b.tenant_id = p_tenant and b.recipe_key = any (p_batch_keys) and b.state in ('fresh', 'open') and b.use_by > now()
   order by b.id
     for share;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

create function app.order_line_json(p_line public.order_line) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select jsonb_build_object(
           'id', p_line.id,
           'menuItemId', p_line.menu_item_id,
           'name', (select i.name from public.menu_item i where i.tenant_id = p_line.tenant_id and i.id = p_line.menu_item_id),
           'course', p_line.course::text,
           'qty', trim_scale(p_line.qty),
           'segue', p_line.segue,
           'note', p_line.note,
           'isShared', p_line.is_shared,
           'unitPrice', trim_scale(p_line.unit_price),
           'state', p_line.state,
           'clientUpdatedAt', p_line.client_updated_at,
           'updatedAt', p_line.updated_at,
           'updatedBy', (select jsonb_build_object('id', u.id, 'displayName', u.display_name)
                           from public.app_user u where u.tenant_id = p_line.tenant_id and u.id = p_line.updated_by))
$$;

-- An ISO 8601 instant with an offset ("2026-11-01T10:00:00+01:00", "...Z"). Anything else is invalid_request (22023);
-- an instant more than the tolerance ahead of the server is client_time_invalid (a phone set far ahead would win every
-- race). There is no lower bound: M20 replays old operations.
create function app.parse_client_time(p_value jsonb) returns timestamptz
  language plpgsql
  volatile
  set search_path = ''
as $$
declare
  v_text text;
  v_at timestamptz;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_text := p_value #>> '{}';
  if v_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  begin
    v_at := v_text::timestamptz;
  exception when others then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  if v_at > clock_timestamp() + app.client_clock_tolerance() then
    raise exception 'client_time_invalid' using errcode = 'P0001';
  end if;
  return v_at;
end
$$;

revoke all on function
  app.low_stock_hint_portions(), app.client_clock_tolerance(), app.plate_batch_needs(uuid, uuid[]),
  app.menu_item_availability(uuid, uuid[], timestamptz), app.lock_live_batches(uuid, uuid[]),
  app.order_line_json(public.order_line), app.parse_client_time(jsonb)
  from public, anon, authenticated, service_role;
