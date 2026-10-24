-- M13 step 4: the count reads (M13 plan §3.1.8, §3.2, §3.4; V6, Q16 = the chef never sees EUR).
--   count_sessions, count_session_view, count_variance  - quantities only, owner / admin / chef
--   count_variance_costs                                - EUR, owner / admin only (app.require_cost_reader, M8)
-- Same rules as the M12 reads: role check FIRST, tenant from app.tenant_id(), an empty search_path, every query
-- filtered by the tenant, execute to `authenticated` only. The three quantity functions have no EUR column and no
-- cost key; the name count_variance_costs contains "cost", so pgTAP 059's catalogue scan covers it.

-- Newest first, a page at a time. nextCursor is {at, id} of the last session shown, or null.
create function public.count_sessions(
  p_status text default 'all', p_before_at timestamptz default null, p_before_id uuid default null,
  p_limit integer default 20
) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_ids uuid[];
  v_at timestamptz[];
  v_next jsonb := null;
begin
  perform app.require_stock_reader();
  v_tenant := app.tenant_id();
  if p_status is null or p_status not in ('all', 'open', 'closed', 'cancelled')
     or p_limit is null or p_limit < 1 or p_limit > 100
     or (p_before_at is null) <> (p_before_id is null) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- One more than the page, to know whether there is a next page.
  select array_agg(x.id order by x.started_at desc, x.id desc), array_agg(x.started_at order by x.started_at desc, x.id desc)
    into v_ids, v_at
    from (select s.id, s.started_at
            from public.count_session s
           where s.tenant_id = v_tenant
             and (p_status = 'all' or s.status = p_status)
             and (p_before_at is null or (s.started_at, s.id) < (p_before_at, p_before_id))
           order by s.started_at desc, s.id desc
           limit p_limit + 1) x;
  if coalesce(array_length(v_ids, 1), 0) > p_limit then
    v_next := jsonb_build_object('at', v_at[p_limit], 'id', v_ids[p_limit]);
    v_ids := v_ids[1:p_limit];
  end if;

  return jsonb_build_object(
    'sessions', coalesce((select jsonb_agg(app.count_session_json(v_tenant, t.id, false) order by t.ord)
                            from unnest(coalesce(v_ids, '{}')) with ordinality t (id, ord)), '[]'::jsonb),
    'nextCursor', v_next);
end
$$;

create function public.count_session_view(p_session uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_stock_reader();
  return app.count_session_json(app.tenant_id(), p_session, true);
end
$$;

-- Expected vs counted for a closed session; postedQty is what the ledger holds for the line (Sum of the session's
-- count rows), so the report and the ledger can be compared. Uncounted lines are not listed, only counted.
create function public.count_variance(p_session uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  s public.count_session;
begin
  perform app.require_stock_reader();
  v_tenant := app.tenant_id();
  select x.* into s from public.count_session x where x.tenant_id = v_tenant and x.id = p_session;
  if not found then
    raise exception 'count_not_found' using errcode = 'P0002';
  end if;
  if s.status <> 'closed' then
    raise exception 'count_not_closed' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'session', app.count_session_json(v_tenant, s.id, false),
    'linesSkipped', (select count(*) from public.count_line l
                      where l.tenant_id = v_tenant and l.session_id = s.id and l.counted_qty is null),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ingredientId', l.ingredient_id, 'name', g.name, 'baseUnit', g.base_unit::text,
               'expectedQty', l.expected_qty, 'countedQty', l.counted_qty,
               'differenceQty', l.counted_qty - l.expected_qty,
               'postedQty', (select coalesce(sum(m.qty), 0) from public.stock_movement m
                              where m.tenant_id = v_tenant and m.ref_type = 'count_session' and m.ref_id = s.id
                                and m.ingredient_id = l.ingredient_id)) order by l.position)
        from public.count_line l
        join public.ingredient g on g.tenant_id = l.tenant_id and g.id = l.ingredient_id
       where l.tenant_id = v_tenant and l.session_id = s.id and l.counted_qty is not null), '[]'::jsonb));
end
$$;

-- The same session in EUR, owner and admin only (the role check comes before anything is read). A line is worth
-- Sum(qty x unit_cost) of its count rows: 0 when it posted nothing, null when a row has no cost. Totals: the net
-- value of the valued lines, the losses (negative lines), the gains (positive lines) and how many lines have no value.
create function public.count_variance_costs(p_session uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  s public.count_session;
  v_out jsonb;
begin
  perform app.require_cost_reader();
  v_tenant := app.tenant_id();
  select x.* into s from public.count_session x where x.tenant_id = v_tenant and x.id = p_session;
  if not found then
    raise exception 'count_not_found' using errcode = 'P0002';
  end if;
  if s.status <> 'closed' then
    raise exception 'count_not_closed' using errcode = 'P0001';
  end if;
  with v as (
    select l.ingredient_id, l.position,
           case when exists (select 1 from public.stock_movement m
                              where m.tenant_id = v_tenant and m.ref_type = 'count_session' and m.ref_id = s.id
                                and m.ingredient_id = l.ingredient_id and m.unit_cost is null) then null
                else (select round(coalesce(sum(m.qty * m.unit_cost), 0), 4) from public.stock_movement m
                       where m.tenant_id = v_tenant and m.ref_type = 'count_session' and m.ref_id = s.id
                         and m.ingredient_id = l.ingredient_id) end as value_eur
      from public.count_line l
     where l.tenant_id = v_tenant and l.session_id = s.id and l.counted_qty is not null)
  select jsonb_build_object(
           'sessionId', s.id,
           'valueEur', coalesce(round(sum(v.value_eur), 4), 0),
           'lossEur', coalesce(round(sum(v.value_eur) filter (where v.value_eur < 0), 4), 0),
           'gainEur', coalesce(round(sum(v.value_eur) filter (where v.value_eur > 0), 4), 0),
           'unvaluedCount', count(*) filter (where v.value_eur is null),
           'lines', coalesce(jsonb_agg(jsonb_build_object('ingredientId', v.ingredient_id, 'valueEur', v.value_eur)
                                       order by v.position), '[]'::jsonb))
    into v_out
    from v;
  return v_out;
end
$$;

revoke all on function public.count_sessions(text, timestamptz, uuid, integer), public.count_session_view(uuid),
  public.count_variance(uuid), public.count_variance_costs(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.count_sessions(text, timestamptz, uuid, integer), public.count_session_view(uuid),
  public.count_variance(uuid), public.count_variance_costs(uuid)
  to authenticated;
