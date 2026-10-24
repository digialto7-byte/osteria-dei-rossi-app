-- M18 step 3: menu_list with availability and the pinned list (M18 plan §3.1.5, §3.1.7, §3.1.9, §3.2; ADR-017).
-- Replaces public.menu_list() of 20261031100300 with the same signature, role gate, category and item ordering and
-- attributes. Differences, on purpose:
--   * every item gains unavailableReason, portionsLeft and lowStock from app.menu_item_availability (one call for the
--     whole menu), and `available` now combines the owner's manual flag with the stock (inactive items are not listed);
--   * the top level gains `pinned`: the active items pushed now (push_until in the future), ordered by position, name,
--     id. A pinned item is the same object as in its category and stays there; a pushed item with no portions stays
--     pinned with available false.
--   * as in M17, an active item with no price in force yet is left out (inner join with the price lookup), so one such
--     item cannot turn the waiter's whole menu into an error.
-- The item shape carries no cost, margin, VAT, GP, food or recipe key (pgTAP 162 scans for them).

create or replace function public.menu_list() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  perform app.require_service_reader();
  v_tenant := app.tenant_id();
  with av as (
    select a.* from app.menu_item_availability(v_tenant, null, v_now) a
  ), shown as (
    select i.category, i.position, i.name, i.id, i.push_until,
           jsonb_build_object(
             'id', i.id,
             'name', i.name,
             'category', i.category,
             'course', i.course_default::text,
             'price', trim_scale(pr.price),
             'available', a.available,
             'unavailableReason', a.reason,
             'portionsLeft', trim_scale(a.portions_left),
             'lowStock', a.low_stock,
             'pushed', coalesce(i.push_until > v_now, false),
             'pushPrice', case when i.push_until > v_now then trim_scale(i.push_price) end) as item
      from public.menu_item i
      join av a on a.menu_item_id = i.id
      join app.menu_item_price_at(
             v_tenant, array(select m.id from public.menu_item m where m.tenant_id = v_tenant and m.is_active), v_now) pr
        on pr.menu_item_id = i.id
     where i.tenant_id = v_tenant and i.is_active
  )
  select jsonb_build_object(
           'pinned', coalesce((select jsonb_agg(s.item order by s.position, s.name collate "C", s.id)
                                 from shown s where s.push_until > v_now), '[]'::jsonb),
           'categories', coalesce((
             select jsonb_agg(jsonb_build_object('name', c.category, 'items', c.items) order by c.min_pos, c.category collate "C")
               from (select s.category, min(s.position) as min_pos,
                            jsonb_agg(s.item order by s.position, s.name collate "C", s.id) as items
                       from shown s
                      group by s.category) c), '[]'::jsonb))
    into v_result;
  return v_result;
end
$$;

revoke all on function public.menu_list() from public, anon, authenticated, service_role;
grant execute on function public.menu_list() to authenticated;
