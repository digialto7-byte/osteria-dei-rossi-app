-- M24 step 1 (docs/plans/2026-10-31-m24-exports.md §3.1.12, §3.2; Q177; M23 follow-up asked by the lead): a start with a temporary price on an item that has no menu
-- price in force at p_now now raises P0001 menu_price_missing, its own code, instead of push_price_above_menu (a price above a menu price that does not exist).
--
-- Replaces only app.push_menu_item_at (create or replace, same signature, security definer, empty search_path). The body is the one merged in
-- 20261114100200_push_menu_item.sql, except the price check of the Q156 block: no price in force -> menu_price_missing; otherwise a price above it ->
-- push_price_above_menu, as before. The order of the checks is unchanged: keys, item lock, inactive, price format, price in force.
-- A push without a temporary price on such an item still succeeds, exactly as merged (Q177 default). public.push_menu_item is not touched.

create or replace function app.push_menu_item_at(p_tenant uuid, p_user uuid, p_item uuid, p_body jsonb, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  m public.menu_item;
  v_pushed boolean;
  v_price numeric;
  v_menu_price numeric;
  v_until timestamptz;
  v_keys uuid[];
  v_at timestamptz;
  v_in_force boolean;
begin
  perform app.menu_keys_ok(p_body, array['pushed', 'pushPrice'], array['pushed']);
  v_pushed := app.menu_bool(p_body -> 'pushed');
  if not v_pushed and p_body ? 'pushPrice' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  select x.* into m from public.menu_item x
   where x.tenant_id = p_tenant and x.id = p_item
     for update;
  if not found then
    raise exception 'menu_item_not_found' using errcode = 'P0002';
  end if;
  v_in_force := m.push_until is not null and m.push_until > p_now;

  if not v_pushed then
    if not v_in_force then
      return jsonb_build_object('changed', false, 'item', (app.menu_items_json(p_tenant, array[m.id])) -> 0);
    end if;
    v_at := greatest(p_now, coalesce((select max(l.created_at) from public.menu_push l where l.tenant_id = p_tenant and l.menu_item_id = m.id),
                                     '-infinity'::timestamptz) + interval '1 microsecond');
    insert into public.menu_push (tenant_id, menu_item_id, action, created_at, created_by)
      values (p_tenant, m.id, 'stop', v_at, p_user);
    update public.menu_item set push_until = null, push_price = null where tenant_id = p_tenant and id = m.id;
    return jsonb_build_object('changed', true, 'item', (app.menu_items_json(p_tenant, array[m.id])) -> 0);
  end if;

  if not m.is_active then
    raise exception 'menu_item_inactive' using errcode = 'P0001';
  end if;
  if p_body ? 'pushPrice' and jsonb_typeof(p_body -> 'pushPrice') <> 'null' then
    begin
      v_price := app.menu_price(p_body -> 'pushPrice');
    exception when sqlstate 'P0001' then
      raise exception 'push_price_invalid' using errcode = 'P0001';
    end;
    if v_price <= 0 then
      raise exception 'push_price_invalid' using errcode = 'P0001';
    end if;
    -- Q156 default: not above the menu price in force. An item without a price in force cannot take a temporary price (M24 follow-up: its own code).
    select pr.price into v_menu_price from app.menu_item_price_at(p_tenant, array[m.id], p_now) pr;
    if v_menu_price is null then
      raise exception 'menu_price_missing' using errcode = 'P0001';
    end if;
    if v_price > v_menu_price then
      raise exception 'push_price_above_menu' using errcode = 'P0001';
    end if;
  end if;
  v_until := app.push_default_until(p_tenant, p_now);

  if v_in_force and m.push_until = v_until and m.push_price is not distinct from v_price then
    return jsonb_build_object('changed', false, 'item', (app.menu_items_json(p_tenant, array[m.id])) -> 0);
  end if;

  v_keys := coalesce(array(select n.batch_key from app.plate_batch_needs(p_tenant, array[m.recipe_key]) n order by n.batch_key), '{}');
  -- Row order follows lock order: the row is stamped p_now, or one microsecond after the item's newest row when that is later. Calling this twin with a
  -- p_now earlier than the newest row therefore stamps the row after p_now, and a start whose push_until (derived from p_now) is earlier than that stamp
  -- records an empty period (push_until before created_at). Only pgTAP calls the twin with such a p_now; the public function passes clock_timestamp().
  v_at := greatest(p_now, coalesce((select max(l.created_at) from public.menu_push l where l.tenant_id = p_tenant and l.menu_item_id = m.id),
                                   '-infinity'::timestamptz) + interval '1 microsecond');
  insert into public.menu_push (tenant_id, menu_item_id, action, push_until, push_price, batch_keys, created_at, created_by)
    values (p_tenant, m.id, 'start', v_until, v_price, v_keys, v_at, p_user);
  update public.menu_item set push_until = v_until, push_price = v_price where tenant_id = p_tenant and id = m.id;
  return jsonb_build_object('changed', true, 'item', (app.menu_items_json(p_tenant, array[m.id])) -> 0);
end
$$;

revoke all on function app.push_menu_item_at(uuid, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;
