-- M17 step 2: the helpers behind the menu and table procedures (M17 plan §3.1.6, §3.1.9, §3.2; ADR-016). All in schema
-- app with an empty search_path; none is executable by an API role.
--   require_service_reader / require_table_operator / require_menu_writer   the role gates (42501 otherwise)
--   table_status          the one place the status words are derived (closed > bill_requested > courses_sent > open > free)
--   session_fired_lines   STUB, returns no row. M19 replaces it on purpose (same signature) with the count of fired
--                         order lines per session and re-pins it in pgTAP 159. M18 does not touch it.
--   session_statuses      sessions joined to the stub, then table_status
--   menu_item_price_at    the price in force at an instant (newest row with valid_from <= instant)
--   coperto_settings      the tenant's coperto (zero rows when unset)
--   default_vat_rate      the tenant's sale VAT setting when it is an allowed rate, else null

create function app.require_service_reader() returns void
  language plpgsql
  stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin', 'waiter') then
    raise exception 'permission denied: the service menu and tables need owner, admin or waiter' using errcode = '42501';
  end if;
end
$$;

create function app.require_table_operator() returns void
  language plpgsql
  stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin', 'waiter') then
    raise exception 'permission denied: opening tables needs owner, admin or waiter' using errcode = '42501';
  end if;
end
$$;

create function app.require_menu_writer() returns void
  language plpgsql
  stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin') then
    raise exception 'permission denied: the menu and table settings need owner or admin' using errcode = '42501';
  end if;
end
$$;

create function app.table_status(
  p_has_session boolean, p_closed_at timestamptz, p_bill_requested_at timestamptz, p_fired_lines integer
) returns text
  language sql
  immutable
  set search_path = ''
as $$
  select case
           when not coalesce(p_has_session, false) then 'free'
           when p_closed_at is not null then 'closed'
           when p_bill_requested_at is not null then 'bill_requested'
           when coalesce(p_fired_lines, 0) > 0 then 'courses_sent'
           else 'open'
         end
$$;

-- The M17 stub: no order line exists yet, so no course is ever sent. M19 runs `create or replace function
-- app.session_fired_lines` with this signature in the migration that adds order_line.fired_at writes.
create function app.session_fired_lines(p_tenant uuid, p_session_ids uuid[])
  returns table (table_session_id uuid, fired_lines integer)
  language sql
  stable
  set search_path = ''
as $$
  select null::uuid, null::integer where false
$$;

create function app.session_statuses(p_tenant uuid, p_session_ids uuid[])
  returns table (table_session_id uuid, status text)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select s.id, app.table_status(true, s.closed_at, s.bill_requested_at, f.fired_lines)
    from public.table_session s
    left join app.session_fired_lines(p_tenant, p_session_ids) f on f.table_session_id = s.id
   where s.tenant_id = p_tenant and s.id = any (p_session_ids)
$$;

create function app.menu_item_price_at(p_tenant uuid, p_items uuid[], p_at timestamptz)
  returns table (menu_item_id uuid, price numeric, vat_rate numeric, valid_from timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select distinct on (p.menu_item_id) p.menu_item_id, p.price, p.vat_rate, p.valid_from
    from public.menu_item_price p
   where p.tenant_id = p_tenant and p.menu_item_id = any (p_items) and p.valid_from <= p_at
   order by p.menu_item_id, p.valid_from desc
$$;

create function app.coperto_settings(p_tenant uuid)
  returns table (amount numeric, vat_rate numeric)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select s.coperto_amount, s.coperto_vat_rate
    from public.sale_settings s
   where s.tenant_id = p_tenant and s.coperto_amount is not null
$$;

create function app.default_vat_rate(p_tenant uuid) returns numeric
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select c.sale_vat_pct
    from app.cost_settings(p_tenant) c
   where c.sale_vat_pct = any (app.allowed_vat_rates())
$$;

revoke all on function
  app.require_service_reader(), app.require_table_operator(), app.require_menu_writer(),
  app.table_status(boolean, timestamptz, timestamptz, integer),
  app.session_fired_lines(uuid, uuid[]), app.session_statuses(uuid, uuid[]),
  app.menu_item_price_at(uuid, uuid[], timestamptz), app.coperto_settings(uuid), app.default_vat_rate(uuid)
  from public, anon, authenticated, service_role;
