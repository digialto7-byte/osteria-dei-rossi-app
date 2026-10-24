-- M13 step 6: the activity log (M13 plan §3.1.11; PRD 2.1 and NFR Auditability). One newest-first feed for the owner
-- and admin of who changed what and when, built from rows that already exist, so there is no third copy to drift:
--   stock   one entry per operation and ingredient of stock_movement (waste, consumption, transfer, count, reversal);
--           receipts are not listed, they appear as the invoice.approved event
--   event   the audit_event rows (invoices, ingredients, recipes, settings, payables, counts)
-- No `before`, `after` or free-text `reason` is returned, and no entry carries a cost.

create function public.audit_log(
  p_from date default null, p_to date default null, p_kind text default 'all',
  p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 50
) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tz text;
  v_from date;
  v_to date;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_entries jsonb;
  v_n integer;
  v_next jsonb := null;
begin
  perform app.require_audit_reader();
  v_tenant := app.tenant_id();
  if p_kind is null or p_kind not in ('all', 'stock', 'events')
     or p_limit is null or p_limit < 1 or p_limit > 100
     or (p_before_at is null) <> (p_before_id is null) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;
  v_to := coalesce(p_to, (now() at time zone v_tz)::date);
  v_from := coalesce(p_from, date_trunc('month', v_to::timestamp)::date);
  if v_from > v_to then
    raise exception 'range_invalid' using errcode = 'P0001';
  end if;
  if v_to - v_from + 1 > 366 then
    raise exception 'range_too_long' using errcode = 'P0001';
  end if;
  -- The Rome days as instants, so the created_at indexes serve the filter.
  v_from_ts := v_from::timestamp at time zone v_tz;
  v_to_ts := (v_to + 1)::timestamp at time zone v_tz;

  with stock as (
    select (array_agg(m.id order by m.id))[1] as id, min(m.created_at) as at,
           (array_agg(m.created_by order by m.id))[1] as by_id,
           case when max(m.ref_type) = 'reversal' then 'reversal'
                when max(m.ref_type) = 'transfer' then 'transfer'
                when max(m.type::text) = 'count' then 'count'
                else max(m.type::text) end as action,
           m.ingredient_id,
           case when max(m.ref_type) = 'transfer' then sum(m.qty) filter (where m.qty > 0) else sum(m.qty) end as qty,
           max(m.reason_code) as reason_code,
           (array_agg(x.name order by (m.qty < 0) desc, x.name))[1] as first_loc,
           array_agg(distinct x.name) as loc_names,
           (array_agg(x.name order by m.qty asc))[1] as src_loc,
           (array_agg(x.name order by m.qty desc))[1] as dst_loc
      from public.stock_movement m
      join public.location x on x.tenant_id = m.tenant_id and x.id = m.location_id
     where m.tenant_id = v_tenant and m.type::text <> 'receipt'
       and m.created_at >= v_from_ts and m.created_at < v_to_ts
       and p_kind in ('all', 'stock')
     group by m.ref_type, m.ref_id, m.ingredient_id),
  feed as (
    select s.id, s.at, 'stock'::text as kind,
           jsonb_build_object(
             'id', s.id, 'at', s.at, 'byName', (select u.display_name from public.app_user u where u.tenant_id = v_tenant and u.id = s.by_id),
             'kind', 'stock', 'action', s.action, 'ingredientId', s.ingredient_id, 'ingredientName', i.name,
             'qty', s.qty, 'unit', i.base_unit::text, 'reasonCode', s.reason_code,
             'locationNames', case when s.action = 'transfer' then jsonb_build_array(s.src_loc, s.dst_loc)
                                   else to_jsonb(s.loc_names) end) as entry
      from stock s
      join public.ingredient i on i.tenant_id = v_tenant and i.id = s.ingredient_id
    union all
    select e.id, e.created_at, 'event',
           jsonb_build_object(
             'id', e.id, 'at', e.created_at, 'byName', (select u.display_name from public.app_user u where u.tenant_id = v_tenant and u.id = e.created_by),
             'kind', 'event', 'action', e.action, 'entityType', e.entity_type, 'entityId', e.entity_id,
             'entityLabel', case e.entity_type
               when 'invoice' then (select v.number_raw from public.invoice v where v.tenant_id = v_tenant and v.id = e.entity_id)
               when 'ingredient' then (select g.name from public.ingredient g where g.tenant_id = v_tenant and g.id = e.entity_id)
               when 'recipe' then (select r.name from public.recipe r where r.tenant_id = v_tenant and r.recipe_key = e.entity_id
                                    order by r.version desc limit 1)
               when 'count_session' then (select l.name from public.count_session c
                                            join public.location l on l.tenant_id = c.tenant_id and l.id = c.location_id
                                           where c.tenant_id = v_tenant and c.id = e.entity_id)
               when 'payable' then (select v.number_raw from public.payable p
                                      join public.invoice v on v.tenant_id = p.tenant_id and v.id = p.invoice_id
                                     where p.tenant_id = v_tenant and p.id = e.entity_id)
               else null end)
      from public.audit_event e
     where e.tenant_id = v_tenant and e.created_at >= v_from_ts and e.created_at < v_to_ts
       and p_kind in ('all', 'events')),
  page as (
    select f.* from feed f
     where p_before_at is null or (f.at, f.id) < (p_before_at, p_before_id)
     order by f.at desc, f.id desc
     limit p_limit + 1)
  select coalesce(jsonb_agg(jsonb_strip_nulls(p.entry) order by p.at desc, p.id desc), '[]'::jsonb), count(*)::integer
    into v_entries, v_n
    from page p;

  if v_n > p_limit then
    -- The extra row only tells that another page exists; the cursor is the last row shown.
    v_entries := v_entries - p_limit;
    v_next := jsonb_build_object('at', v_entries->(p_limit - 1)->'at', 'id', v_entries->(p_limit - 1)->'id');
  end if;
  return jsonb_build_object('from', v_from, 'to', v_to, 'entries', v_entries, 'nextCursor', v_next);
end
$$;

revoke all on function public.audit_log(date, date, text, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.audit_log(date, date, text, timestamptz, uuid, integer) to authenticated;
