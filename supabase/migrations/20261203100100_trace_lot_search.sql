-- P2-2 S2 (docs/plans/2026-11-14-p2-2-trace-sell-through.md section 3.3.4): the lot search and the lot-capture rate. Read-only definers with an empty search_path; the
-- public wrappers call app.require_trace_reader() first, take the tenant and the role from the session, and are executable by `authenticated` only.
--
--   app.trace_lot_search_json   {lots: [{lotId, ingredient:{id,name}, supplier:{id,name}, lotCode|null, expiry|null, receivedOn, qtyReceived, unit, onHand}], truncated}.
--                               At least one of p_q, p_ingredient, p_supplier (else 22023 query_invalid). p_q is normalised by app.lot_code_norm (1 to 64 characters as typed),
--                               matched as a prefix with %, _ and \ escaped (Q-P13). Without p_q the date range applies (default: the 30 business days to today); with p_q the
--                               dates apply only when given. A `to` after the business today is P0001 date_in_future; from after to is 22023; more than TRACE_MAX_RANGE_DAYS
--                               days (both ends included) is P0001 range_too_long. Newest receipt first, then id; at most TRACE_MAX_LOTS, `truncated` says there were more.
--                               onHand is the ledger fold of the lot (a consumption and its reversal net to zero; a transfer nets to zero). No money key.
--   app.lot_capture_json        {from, to, lots, withLotCode, bySupplier: [{supplierId, name, lots, withLotCode}]} over raw_lot.received_on, same range rules; the suppliers
--                               with the most lots missing a code come first, then by name.

create function app.trace_lot_search_json(p_tenant uuid, p_role text, p_q text, p_ingredient uuid, p_supplier uuid, p_from date, p_to date, p_now timestamptz)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_max integer := (app.trace_constants() ->> 'TRACE_MAX_LOTS')::integer;
  v_days integer := (app.trace_constants() ->> 'TRACE_MAX_RANGE_DAYS')::integer;
  v_today date;
  v_norm text;
  v_pattern text;
  v_from date := p_from;
  v_to date := p_to;
  v_lots jsonb;
  v_found integer;
begin
  if p_q is null and p_ingredient is null and p_supplier is null then
    raise exception 'query_invalid' using errcode = '22023';
  end if;
  if p_q is not null then
    v_norm := app.lot_code_norm(p_q);
    if length(p_q) > 64 or v_norm = '' then
      raise exception 'query_invalid' using errcode = '22023';
    end if;
    v_pattern := replace(replace(replace(v_norm, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  v_today := app.business_date(p_tenant, p_now);
  if p_q is null then
    v_to := coalesce(p_to, v_today);
    v_from := coalesce(p_from, v_to - 29);
  end if;
  if v_to is not null and v_to > v_today then
    raise exception 'date_in_future' using errcode = 'P0001';
  end if;
  if v_from is not null and v_to is not null then
    if v_from > v_to then
      raise exception 'query_invalid' using errcode = '22023';
    end if;
    if v_to - v_from + 1 > v_days then
      raise exception 'range_too_long' using errcode = 'P0001';
    end if;
  end if;

  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= v_max), '[]'::jsonb), count(*)::integer
    into v_lots, v_found
    from (
      select row_number() over (order by l.received_on desc, l.id) as rn,
             jsonb_build_object(
               'lotId', l.id,
               'ingredient', jsonb_build_object('id', i.id, 'name', i.name),
               'supplier', jsonb_build_object('id', s.id, 'name', s.name),
               'lotCode', l.lot_code,
               'expiry', l.expiry,
               'receivedOn', l.received_on,
               'qtyReceived', l.qty_received,
               'unit', l.base_unit::text,
               'onHand', coalesce((select sum(m.qty) from public.stock_movement m where m.tenant_id = p_tenant and m.raw_lot_id = l.id), 0)) as j
        from public.raw_lot l
        join public.ingredient i on i.tenant_id = l.tenant_id and i.id = l.ingredient_id
        join public.supplier s on s.tenant_id = l.tenant_id and s.id = l.supplier_id
       where l.tenant_id = p_tenant
         and (p_q is null or (l.lot_code is not null and app.lot_code_norm(l.lot_code) like v_pattern))
         and (p_ingredient is null or l.ingredient_id = p_ingredient)
         and (p_supplier is null or l.supplier_id = p_supplier)
         and (v_from is null or l.received_on >= v_from)
         and (v_to is null or l.received_on <= v_to)
       order by l.received_on desc, l.id
       limit v_max + 1
    ) x;
  return jsonb_build_object('lots', v_lots, 'truncated', v_found > v_max);
end
$$;

create function app.lot_capture_json(p_tenant uuid, p_from date, p_to date, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_days integer := (app.trace_constants() ->> 'TRACE_MAX_RANGE_DAYS')::integer;
  v_today date := app.business_date(p_tenant, p_now);
  v_to date := coalesce(p_to, app.business_date(p_tenant, p_now));
  v_from date;
  v_lots integer;
  v_coded integer;
  v_by jsonb;
begin
  v_from := coalesce(p_from, v_to - 29);
  if v_to > v_today then
    raise exception 'date_in_future' using errcode = 'P0001';
  end if;
  if v_from > v_to then
    raise exception 'query_invalid' using errcode = '22023';
  end if;
  if v_to - v_from + 1 > v_days then
    raise exception 'range_too_long' using errcode = 'P0001';
  end if;

  select coalesce(sum(g.lots), 0)::integer, coalesce(sum(g.coded), 0)::integer,
         coalesce(jsonb_agg(jsonb_build_object('supplierId', g.supplier_id, 'name', g.name, 'lots', g.lots, 'withLotCode', g.coded)
                            order by g.lots - g.coded desc, g.name collate "C", g.supplier_id), '[]'::jsonb)
    into v_lots, v_coded, v_by
    from (
      select s.id as supplier_id, s.name, count(*)::integer as lots, count(l.lot_code)::integer as coded
        from public.raw_lot l
        join public.supplier s on s.tenant_id = l.tenant_id and s.id = l.supplier_id
       where l.tenant_id = p_tenant and l.received_on >= v_from and l.received_on <= v_to
       group by s.id, s.name
    ) g;
  return jsonb_build_object('from', v_from, 'to', v_to, 'lots', v_lots, 'withLotCode', v_coded, 'bySupplier', v_by);
end
$$;

create function public.trace_lot_search(p_q text, p_ingredient uuid, p_supplier uuid, p_from date, p_to date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_trace_reader();
  return app.trace_lot_search_json(app.tenant_id(), app.role()::text, p_q, p_ingredient, p_supplier, p_from, p_to, clock_timestamp());
end
$$;

create function public.lot_capture(p_from date, p_to date) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_trace_reader();
  return app.lot_capture_json(app.tenant_id(), p_from, p_to, clock_timestamp());
end
$$;

revoke all on function app.trace_lot_search_json(uuid, text, text, uuid, uuid, date, date, timestamptz), app.lot_capture_json(uuid, date, date, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.trace_lot_search(text, uuid, uuid, date, date), public.lot_capture(date, date) from public, anon, authenticated, service_role;
grant execute on function public.trace_lot_search(text, uuid, uuid, date, date), public.lot_capture(date, date) to authenticated;
