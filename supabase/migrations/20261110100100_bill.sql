-- M21 step 2 (docs/plans/2026-10-30-m21-bill-close.md §3.1.1-3.1.2, §3.2; ADR-023): the bill, computed once in SQL.
--
--   app.split_cents          the one integer-cent split (remainder cents go one each to the first parts).
--   app.session_bill_json    lines (non-voided, round(qty x unit_price, 2)), frozen coperto, VAT-inclusive total, unsent drafts, billToken,
--                            the optional split and, for a closed table, the receipt. Used by the preview, the split and close_table.
--   public.session_bill      the role check and the shape check of the split, then the above.
-- Every amount is numeric(12,2); the split works on integer cents so its parts always add up to the total. The payload carries sale prices
-- only: no cost, margin, GP, food cost, recipe key or VAT rate. A split is a computation, never stored.

create function app.cents_to_num(p_cents bigint) returns numeric
  language sql immutable
  set search_path = ''
as $$ select round(p_cents::numeric / 100, 2) $$;

-- p_parts 1..99 and p_cents >= 0, else 22023. Part i gets base + 1 for i <= remainder: 10000 / 3 -> 3334, 3333, 3333.
create function app.split_cents(p_cents bigint, p_parts integer) returns bigint[]
  language plpgsql immutable
  set search_path = ''
as $$
declare
  v_base bigint;
  v_rem bigint;
begin
  if p_cents is null or p_parts is null or p_cents < 0 or p_parts < 1 or p_parts > 99 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  v_base := p_cents / p_parts;
  v_rem := p_cents - p_parts * v_base;
  return array(select v_base + case when i <= v_rem then 1 else 0 end from generate_series(1, p_parts) i order by i);
end
$$;

-- The shape of a split body: {mode: "covers", parts} or {mode: "items", groups, sharedLineIds}. 22023 for a wrong shape, P0001 parts_invalid
-- for a parts count outside 2..99. Which lines belong to the session is judged later, against the lines.
create function app.bill_split_check(p_split jsonb) returns void
  language plpgsql immutable
  set search_path = ''
as $$
declare
  v_group jsonb;
  v_id jsonb;
  v_ids integer := 0;
  v_covers numeric;
begin
  if p_split is null or jsonb_typeof(p_split) <> 'object' or jsonb_typeof(p_split -> 'mode') is distinct from 'string' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_split ->> 'mode' = 'covers' then
    perform app.menu_keys_ok(p_split, array['mode', 'parts'], array['mode', 'parts']);
    perform app.menu_int(p_split -> 'parts', 2, 99, 'parts_invalid');
  elsif p_split ->> 'mode' = 'items' then
    perform app.menu_keys_ok(p_split, array['mode', 'groups', 'sharedLineIds'], array['mode', 'groups', 'sharedLineIds']);
    if jsonb_typeof(p_split -> 'groups') is distinct from 'array' or jsonb_array_length(p_split -> 'groups') not between 2 and 20
       or jsonb_typeof(p_split -> 'sharedLineIds') is distinct from 'array' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    for v_group in select e from jsonb_array_elements(p_split -> 'groups') e loop
      perform app.menu_keys_ok(v_group, array['lineIds', 'covers'], array['lineIds', 'covers']);
      if jsonb_typeof(v_group -> 'lineIds') is distinct from 'array' or jsonb_typeof(v_group -> 'covers') is distinct from 'number' then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
      v_covers := (v_group ->> 'covers')::numeric;
      if v_covers <> trunc(v_covers) or v_covers < 0 or v_covers > 99 then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
      for v_id in select e from jsonb_array_elements(v_group -> 'lineIds') e loop
        perform app.order_uuid(v_id);
        v_ids := v_ids + 1;
      end loop;
    end loop;
    for v_id in select e from jsonb_array_elements(p_split -> 'sharedLineIds') e loop
      perform app.order_uuid(v_id);
      v_ids := v_ids + 1;
    end loop;
    if v_ids > 200 then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
  else
    raise exception 'invalid_request' using errcode = '22023';
  end if;
end
$$;

-- The split by items. p_ids / p_cents are the billed lines (same order). Every billed line must appear exactly once across the groups and
-- the shared list; the covers of the groups must add up to the session's covers. A group pays its lines, the coperto of its covers and its
-- share of the shared lines (split_cents over the groups in the given order). Errors: P0001 split_invalid, DETAIL {"reason": ...}.
create function app.bill_split_items(p_covers integer, p_coperto_cents bigint, p_ids uuid[], p_cents bigint[], p_split jsonb) returns jsonb
  language plpgsql immutable
  set search_path = ''
as $$
declare
  v_groups jsonb := p_split -> 'groups';
  v_shared jsonb := p_split -> 'sharedLineIds';
  v_refs uuid[];
  v_reason text;
  v_shared_cents bigint;
  v_shares bigint[];
  v_parts jsonb;
begin
  select coalesce(array_agg(t.x::uuid), '{}'::uuid[]) into v_refs
    from (select jsonb_array_elements_text(g -> 'lineIds') as x from jsonb_array_elements(v_groups) g
          union all
          select jsonb_array_elements_text(v_shared)) t;
  v_reason := case
    when exists (select 1 from unnest(v_refs) r where r <> all (p_ids)) then 'line_unknown'
    when exists (select 1 from unnest(v_refs) r group by r having count(*) > 1) then 'line_twice'
    when exists (select 1 from unnest(p_ids) i where i <> all (v_refs)) then 'line_missing'
    when (select sum((g ->> 'covers')::integer) from jsonb_array_elements(v_groups) g) <> p_covers then 'covers_mismatch'
  end;
  if v_reason is not null then
    raise exception 'split_invalid' using errcode = 'P0001', detail = jsonb_build_object('reason', v_reason)::text;
  end if;

  select coalesce(sum(c.cents), 0) into v_shared_cents
    from unnest(p_ids, p_cents) c (id, cents)
   where c.id = any (array(select x::uuid from jsonb_array_elements_text(v_shared) x));
  v_shares := app.split_cents(v_shared_cents, jsonb_array_length(v_groups));

  select jsonb_agg(jsonb_build_object(
           'index', g.idx,
           'covers', g.covers,
           'lineIds', g.obj -> 'lineIds',
           'sharedAmount', app.cents_to_num(v_shares[g.idx]),
           'amount', app.cents_to_num(g.line_cents + g.covers * p_coperto_cents + v_shares[g.idx])) order by g.idx)
    into v_parts
    from (select t.ord::integer as idx, t.obj, (t.obj ->> 'covers')::integer as covers,
                 coalesce((select sum(c.cents) from unnest(p_ids, p_cents) c (id, cents)
                            where c.id = any (array(select x::uuid from jsonb_array_elements_text(t.obj -> 'lineIds') x))), 0)::bigint as line_cents
            from jsonb_array_elements(v_groups) with ordinality t (obj, ord)) g;
  return jsonb_build_object('mode', 'items', 'parts', v_parts);
end
$$;

create function app.session_bill_json(p_tenant uuid, p_session uuid, p_split jsonb) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  s public.table_session;
  v_lines jsonb;
  v_ids uuid[];
  v_cents bigint[];
  v_unsent jsonb;
  v_token text;
  v_subtotal_c bigint;
  v_coperto_c bigint;
  v_total_c bigint;
  v_coperto jsonb := null;
  v_split jsonb := null;
  v_receipt jsonb := null;
  v_parts integer;
  v_arr bigint[];
begin
  select z.* into s from public.table_session z where z.tenant_id = p_tenant and z.id = p_session;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  -- One statement for the lines and every figure derived from them.
  select coalesce(jsonb_agg(jsonb_build_object(
                    'id', l.id, 'name', mi.name, 'course', l.course::text, 'qty', trim_scale(l.qty), 'unitPrice', l.unit_price,
                    'amount', round(l.qty * l.unit_price, 2), 'state', l.state, 'isShared', l.is_shared)
                  order by l.course, l.created_at, l.id), '[]'::jsonb),
         coalesce(array_agg(l.id order by l.course, l.created_at, l.id), '{}'::uuid[]),
         coalesce(array_agg((round(l.qty * l.unit_price, 2) * 100)::bigint order by l.course, l.created_at, l.id), '{}'::bigint[]),
         coalesce(jsonb_agg(l.id order by l.course, l.created_at, l.id) filter (where l.state = 'draft'), '[]'::jsonb),
         md5(coalesce(string_agg(l.id::text || ':' || l.state || ':' || l.qty::text || ':' || l.unit_price::text, ',' order by l.id), '')
             || '|' || s.covers::text || '|' || coalesce(s.coperto_amount::text, '-'))
    into v_lines, v_ids, v_cents, v_unsent, v_token
    from public.order_line l
    join public.menu_item mi on mi.tenant_id = l.tenant_id and mi.id = l.menu_item_id
   where l.tenant_id = p_tenant and l.table_session_id = p_session and l.voided_at is null;

  v_subtotal_c := coalesce((select sum(c) from unnest(v_cents) c), 0);
  v_coperto_c := case when s.coperto_amount is null then 0 else (s.coperto_amount * 100)::bigint end;
  v_total_c := v_subtotal_c + s.covers * v_coperto_c;
  if s.coperto_amount is not null then
    v_coperto := jsonb_build_object('perPerson', s.coperto_amount, 'covers', s.covers, 'amount', app.cents_to_num(s.covers * v_coperto_c));
  end if;

  if p_split is not null then
    if p_split ->> 'mode' = 'covers' then
      v_parts := (p_split ->> 'parts')::integer;
      if v_parts not between 2 and 99 then
        raise exception 'parts_invalid' using errcode = 'P0001';
      end if;
      v_arr := app.split_cents(v_total_c, v_parts);
      v_split := jsonb_build_object('mode', 'covers', 'parts',
        (select jsonb_agg(jsonb_build_object('index', i, 'amount', app.cents_to_num(v_arr[i])) order by i) from generate_series(1, v_parts) i));
    else
      v_split := app.bill_split_items(s.covers, v_coperto_c, v_ids, v_cents, p_split);
    end if;
  end if;

  if s.closed_at is not null and s.receipt_type is not null then
    v_receipt := jsonb_build_object(
      'type', s.receipt_type, 'number', s.receipt_number, 'paymentType', s.payment_type, 'missingReceipt', s.missing_receipt,
      'closedAt', s.closed_at,
      'closedBy', (select jsonb_build_object('id', u.id, 'displayName', u.display_name)
                     from public.app_user u where u.tenant_id = p_tenant and u.id = s.closed_by),
      'businessDate', s.closed_business_date);
  end if;

  return jsonb_build_object(
    'sessionId', s.id, 'tableName', s.table_name, 'covers', s.covers, 'closed', s.closed_at is not null,
    'billToken', v_token, 'lines', v_lines, 'coperto', v_coperto,
    'subtotal', app.cents_to_num(v_subtotal_c), 'total', app.cents_to_num(v_total_c),
    'unsentLineIds', v_unsent, 'split', v_split, 'receipt', v_receipt);
end
$$;

create function public.session_bill(p_session uuid, p_split jsonb default null) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_table_operator();
  if p_split is not null then
    perform app.bill_split_check(p_split);
  end if;
  return app.session_bill_json(app.tenant_id(), p_session, p_split);
end
$$;

revoke all on function app.cents_to_num(bigint), app.split_cents(bigint, integer), app.bill_split_check(jsonb),
  app.bill_split_items(integer, bigint, uuid[], bigint[], jsonb), app.session_bill_json(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.session_bill(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.session_bill(uuid, jsonb) to authenticated;
