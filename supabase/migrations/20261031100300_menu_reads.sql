-- M17 step 4: the menu reads (M17 plan §3.1.7, §3.2; ADR-016).
--   menu_list()         owner, admin, waiter: the service menu, a fixed cost-free shape (active items only)
--   menu_items_manage() owner, admin: every item with its mapping, price history head and push fields, plus the form data
-- The pushed state is derived (push_until in the future), never stored. A price is the row in force right now. Both are
-- security definer with an empty search_path, check the role first and filter every statement by tenant.

create function public.menu_list() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_now timestamptz := clock_timestamp();
begin
  perform app.require_service_reader();
  v_tenant := app.tenant_id();
  return jsonb_build_object('categories', coalesce((
    select jsonb_agg(jsonb_build_object('name', c.category, 'items', c.items) order by c.min_pos, c.category collate "C")
      from (
        select i.category, min(i.position) as min_pos,
               jsonb_agg(jsonb_build_object(
                 'id', i.id,
                 'name', i.name,
                 'category', i.category,
                 'course', i.course_default::text,
                 'price', trim_scale(pr.price),
                 'available', i.is_available,
                 'pushed', coalesce(i.push_until > v_now, false),
                 'pushPrice', case when i.push_until > v_now then trim_scale(i.push_price) end)
                 order by i.position, i.name collate "C", i.id) as items
          from public.menu_item i
          left join app.menu_item_price_at(
                 v_tenant, array(select m.id from public.menu_item m where m.tenant_id = v_tenant and m.is_active), v_now) pr
            on pr.menu_item_id = i.id
         where i.tenant_id = v_tenant and i.is_active
         group by i.category) c), '[]'::jsonb));
end
$$;

create function public.menu_items_manage() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  perform app.require_menu_writer();
  v_tenant := app.tenant_id();
  return jsonb_build_object(
    'defaults', jsonb_build_object('vatRate', app.default_vat_rate(v_tenant)),
    'vatRates', to_jsonb(app.allowed_vat_rates()),
    'courses', (select jsonb_agg(e::text order by o) from unnest(enum_range(null::public.course)) with ordinality x(e, o)),
    'categories', coalesce((select jsonb_agg(c.category order by c.category collate "C")
                              from (select distinct i.category from public.menu_item i where i.tenant_id = v_tenant) c),
                           '[]'::jsonb),
    'items', app.menu_items_json(v_tenant, null));
end
$$;

revoke all on function public.menu_list(), public.menu_items_manage() from public, anon, authenticated, service_role;
grant execute on function public.menu_list(), public.menu_items_manage() to authenticated;
