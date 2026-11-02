-- M25b step 6 (docs/plans/2026-11-01-m25b-navigation.md §3.2): the payables list learns a date range, for the founder's "Dal"/"Al" filter
-- on Pagamenti. Only public.payable_list changes. A function cannot gain parameters through create or replace, so it is dropped and created
-- again with p_from and p_to (both default null). The body is the one of 20261024100100_payable_reads.sql with three additions:
-- the range check (from after to is invalid_request), the range on the list's own key date (due date, or payment date for 'paid'), and the
-- same range on the unpaid totals. Callers with one, two or five positional arguments keep working through the defaults.
-- The role check, the explicit tenant filter, security definer and the empty search_path are unchanged. No table, policy, index or check.

drop function public.payable_list(text, uuid, date, uuid, integer);

create function public.payable_list(
  p_filter text default 'unpaid',
  p_supplier uuid default null,
  p_cursor_date date default null,
  p_cursor_id uuid default null,
  p_limit integer default 50,
  p_from date default null,
  p_to date default null
) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid := app.tenant_id();
  v_today date;
  v_asc boolean := p_filter = 'unpaid';
  v_items jsonb;
  v_cursor jsonb;
  v_totals jsonb := null;
begin
  perform app.require_payables_reader();
  if p_filter is null or p_filter not in ('unpaid', 'paid', 'all')
     or p_limit is null or p_limit < 1 or p_limit > 200
     or (p_cursor_date is null) <> (p_cursor_id is null)
     or (p_from is not null and p_to is not null and p_from > p_to) then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  select app.venue_date(now(), t.timezone) into v_today
    from public.tenant t where t.id = v_tenant;

  with ranked as (
    select p, i.number_raw, i.invoice_date, s.name as supplier_name,
           case when p_filter = 'paid' then p.paid_on else p.due_date end as k,
           row_number() over (
             order by case when v_asc then case when p_filter = 'paid' then p.paid_on else p.due_date end end asc,
                      case when not v_asc then case when p_filter = 'paid' then p.paid_on else p.due_date end end desc,
                      case when v_asc then p.id end asc,
                      case when not v_asc then p.id end desc) as rn
      from public.payable p
      join public.invoice i on i.tenant_id = p.tenant_id and i.id = p.invoice_id
      join public.supplier s on s.tenant_id = p.tenant_id and s.id = p.supplier_id
     where p.tenant_id = v_tenant
       and (p_supplier is null or p.supplier_id = p_supplier)
       -- M25b: the range is on the list's own key date (the payment date for 'paid', else the due date).
       and (p_from is null or (case when p_filter = 'paid' then p.paid_on else p.due_date end) >= p_from)
       and (p_to is null or (case when p_filter = 'paid' then p.paid_on else p.due_date end) <= p_to)
       and case p_filter when 'unpaid' then p.status <> 'paid'
                         when 'paid' then p.status = 'paid'
                         else true end
       and (p_cursor_date is null
            or (v_asc and (case when p_filter = 'paid' then p.paid_on else p.due_date end, p.id)
                          > (p_cursor_date, p_cursor_id))
            or (not v_asc and (case when p_filter = 'paid' then p.paid_on else p.due_date end, p.id)
                          < (p_cursor_date, p_cursor_id)))
  ), page as (
    select * from ranked where rn <= p_limit + 1
  )
  select coalesce(jsonb_agg(app.payable_item(page.p, page.number_raw, page.invoice_date,
                                             page.supplier_name, v_today) order by page.rn)
                    filter (where page.rn <= p_limit), '[]'::jsonb),
         (select jsonb_build_object('date', x.k, 'id', (x.p).id)
            from page x
           where x.rn = p_limit and exists (select 1 from page y where y.rn = p_limit + 1))
    into v_items, v_cursor
    from page;

  if p_filter = 'unpaid' then
    select jsonb_build_object('count', count(*), 'amount', coalesce(sum(p.amount), 0::numeric(12, 2)))
      into v_totals
      from public.payable p
     where p.tenant_id = v_tenant and p.status <> 'paid'
       and (p_supplier is null or p.supplier_id = p_supplier)
       and (p_from is null or p.due_date >= p_from) and (p_to is null or p.due_date <= p_to);
  end if;

  return jsonb_build_object('items', v_items, 'nextCursor', v_cursor, 'totals', v_totals,
                            'today', v_today);
end
$$;

revoke all on function public.payable_list(text, uuid, date, uuid, integer, date, date)
  from public, anon, service_role;
grant execute on function public.payable_list(text, uuid, date, uuid, integer, date, date)
  to authenticated;
