-- P2-0b step A5 (docs/plans/2026-11-11-p2-0b-sell-by-weight.md §3.3, §5 A5): the reads carry the weight. Four functions are replaced with the same signatures,
-- security definer and empty search_path, and every figure they already computed is unchanged:
--   app.session_bill_json    the line JSON gains weightG and pricePer100g (null on portion lines). The bill token string gains ':' || weight_g for a WEIGHTED line
--                            only, so a session without weighted lines keeps the exact token it had (pgTAP 216, 324); the plan's coalesce(weight_g::text, '-') for every
--                            line would have changed every portion token. Amounts, splits and totals are byte-identical.
--   app.kitchen_ticket_rows  the line JSON gains weightG; no money key.
--   app.kpi_sales_lines      DROPPED (no cascade) and created again with one more output column, weight_g, last; its ACL is restated (no API role). Nothing depends
--                            on it: its callers are SQL/plpgsql function bodies, resolved at run time.
--   app.kpi_items_json       rows gain weightG (the sum of the item's line weights) and avgWeightG (round(sum / weighted lines)), null when the item has no weighted
--                            line; totals unchanged. A weighted line counts as one plate (qty 1).

create or replace function app.session_bill_json(p_tenant uuid, p_session uuid, p_split jsonb) returns jsonb
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
                    'amount', round(l.qty * l.unit_price, 2), 'state', l.state, 'isShared', l.is_shared,
                    'weightG', l.weight_g, 'pricePer100g', l.price_per_100g)
                  order by l.course, l.created_at, l.id), '[]'::jsonb),
         coalesce(array_agg(l.id order by l.course, l.created_at, l.id), '{}'::uuid[]),
         coalesce(array_agg((round(l.qty * l.unit_price, 2) * 100)::bigint order by l.course, l.created_at, l.id), '{}'::bigint[]),
         coalesce(jsonb_agg(l.id order by l.course, l.created_at, l.id) filter (where l.state = 'draft'), '[]'::jsonb),
         md5(coalesce(string_agg(l.id::text || ':' || l.state || ':' || trim_scale(l.qty)::text || ':' || l.unit_price::text
                                           || case when l.weight_g is null then '' else ':' || l.weight_g::text end, ',' order by l.id), '')
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

create or replace function app.kitchen_ticket_rows(p_tenant uuid, p_at timestamptz) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with cand as (
    select l.*, s.table_name, s.covers
      from public.order_line l
      join public.table_session s on s.tenant_id = l.tenant_id and s.id = l.table_session_id
     where l.tenant_id = p_tenant and l.fired_at is not null
       and l.fired_at > p_at - interval '30 hours' and l.fired_at <= p_at
       and s.closed_at is null
       and app.business_date(p_tenant, l.fired_at) = app.business_date(p_tenant, p_at)
  ), cl as (
    select c.*,
           (c.voided_at is null and coalesce((select e.action = 'done'
                                                from public.kitchen_event e
                                               where e.tenant_id = c.tenant_id and e.subject = 'line' and e.order_line_id = c.id
                                                 and e.created_at <= p_at
                                               order by e.seq desc limit 1), false)) as is_done
      from cand c
  ), grp as (
    select c.table_session_id, c.fired_at, c.course, c.segue, min(c.table_name) as table_name, min(c.covers) as covers,
           (array_agg(c.fired_by order by c.id))[1] as fired_by,
           (count(*) filter (where c.voided_at is null))::integer as line_count,
           (count(*) filter (where c.is_done))::integer as done_count,
           jsonb_agg(jsonb_build_object(
               'id', c.id,
               'name', (select i.name from public.menu_item i where i.tenant_id = c.tenant_id and i.id = c.menu_item_id),
               'qty', trim_scale(c.qty),
               'weightG', c.weight_g,
               'note', c.note,
               'isShared', c.is_shared,
               'voided', c.voided_at is not null,
               'voidReason', c.void_reason,
               'done', c.is_done)
             order by case when c.voided_at is not null then 1 when c.is_done then 2 else 0 end, c.created_at, c.id) as lines
      from cl c
     group by c.table_session_id, c.fired_at, c.course, c.segue
  ), st as (
    select g.*, t.action, t.cause, t.created_at as ev_at, t.created_by as ev_by,
           g.table_session_id::text || '|' || to_char(g.fired_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             || '|' || g.course::text || '|' || g.segue::text as key,
           coalesce(t.action = 'closed', false) as is_closed
      from grp g
      left join lateral (select e.action, e.cause, e.created_at, e.created_by
                           from public.kitchen_event e
                          where e.tenant_id = p_tenant and e.subject = 'ticket' and e.table_session_id = g.table_session_id
                            and e.fired_at = g.fired_at and e.course = g.course and e.segue = g.segue and e.created_at <= p_at
                          order by e.seq desc limit 1) t on true
  ), ranked as (
    select s.*,
           row_number() over (partition by s.is_closed
                              order by case when s.is_closed then null else s.fired_at end desc nulls last,
                                       case when s.is_closed then null else s.table_name end collate "C" desc nulls last,
                                       case when s.is_closed then null else s.course end desc nulls last,
                                       case when s.is_closed then null else s.segue end desc nulls last,
                                       case when s.is_closed then null else s.table_session_id end desc nulls last) as rn_active,
           row_number() over (partition by s.is_closed order by s.ev_at desc, s.key collate "C") as rn_closed,
           count(*) over (partition by s.is_closed) as total,
           jsonb_build_object(
             'key', s.key,
             'sessionId', s.table_session_id,
             'tableName', s.table_name,
             'covers', s.covers,
             'course', s.course::text,
             'segue', s.segue,
             'firedAt', to_char(s.fired_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
             'firedBy', (select jsonb_build_object('id', u.id, 'displayName', u.display_name)
                           from public.app_user u where u.tenant_id = p_tenant and u.id = s.fired_by),
             'lineCount', s.line_count,
             'doneCount', s.done_count,
             'closedAt', case when s.is_closed then to_jsonb(s.ev_at) else 'null'::jsonb end,
             'closedBy', case when s.is_closed then (select jsonb_build_object('id', u.id, 'displayName', u.display_name)
                                                      from public.app_user u where u.tenant_id = p_tenant and u.id = s.ev_by) end,
             'autoClosed', s.is_closed and s.cause = 'auto',
             'lines', s.lines) as tj
      from st s
  )
  select jsonb_build_object(
           'truncated', coalesce(bool_or(r.total > 200), false),
           'remaining', coalesce(sum(r.line_count - r.done_count) filter (where not r.is_closed), 0)::integer,
           'tickets', coalesce(jsonb_agg(r.tj order by r.fired_at, r.table_name collate "C", r.course, r.segue, r.table_session_id)
                                 filter (where not r.is_closed and r.rn_active <= 200), '[]'::jsonb),
           'closedTickets', coalesce(jsonb_agg(r.tj order by r.ev_at desc, r.key collate "C")
                                       filter (where r.is_closed and r.rn_closed <= 200), '[]'::jsonb))
    from ranked r
$$;

drop function app.kpi_sales_lines(uuid, date, date);

create function app.kpi_sales_lines(p_tenant uuid, p_from date, p_to date)
  returns table (business_date date, session_id uuid, menu_item_id uuid, item_name text, course text, qty numeric,
                 gross numeric, net numeric, mapped boolean, costed boolean, food_cost numeric, weight_g integer)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select s.closed_business_date, s.id, l.menu_item_id, m.name, l.course::text, l.qty::numeric,
         round(l.qty * l.unit_price, 2),
         round(round(l.qty * l.unit_price, 2) / (1 + l.vat_rate / 100), 4),
         c.recipe_id is not null,
         c.recipe_id is not null and c.total_cost is not null,
         case when c.recipe_id is not null then c.total_cost end,
         l.weight_g
    from public.table_session s
    join public.order_line l on l.tenant_id = s.tenant_id and l.table_session_id = s.id
    join public.menu_item m on m.tenant_id = l.tenant_id and m.id = l.menu_item_id
    left join public.order_line_cost c on c.tenant_id = l.tenant_id and c.order_line_id = l.id
   where s.tenant_id = p_tenant and s.closed_at is not null
     and s.closed_business_date between p_from and p_to
     and l.voided_at is null
$$;
revoke all on function app.kpi_sales_lines(uuid, date, date) from public, anon, authenticated, service_role;

create or replace function app.kpi_items_json(p_tenant uuid, p_role text, p_period text, p_date date, p_from date, p_to date, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  per record;
  v_owner boolean := p_role = 'owner';
  v_rows jsonb;
  v_totals jsonb;
  v_final boolean;
begin
  select * into per from app.kpi_period(p_tenant, p_period, p_date, p_from, p_to, p_now);
  v_final := (select count(*) from public.daily_kpi s where s.tenant_id = p_tenant and s.business_date between per.from_d and per.to_d) = per.to_d - per.from_d + 1;

  with l as (
    select x.* from app.kpi_sales_lines(p_tenant, per.from_d, per.to_d) x
  ),
  -- Only the owner's call reads the fixed costs: the distinct dates of the costed lines, and none for anyone else.
  fc as (
    select d.business_date, f.per_plate, f.reason
      from (select distinct l2.business_date from l l2 where l2.costed and v_owner) d,
           lateral app.fixed_cost_at(p_tenant, d.business_date) f
  ),
  it as (
    select l.menu_item_id,
           min(l.item_name) as name,
           sum(l.qty) as plates,
           sum(l.net) as net,
           coalesce(sum(l.qty) filter (where l.costed), 0) as c_plates,
           coalesce(sum(l.net) filter (where l.costed), 0) as c_net,
           sum(l.food_cost) filter (where l.costed) as f_cost,
           coalesce(sum(l.qty) filter (where l.mapped), 0) as m_plates,
           sum(l.qty * fc.per_plate) filter (where l.costed) as fx,
           coalesce(bool_or(fc.per_plate is null) filter (where l.costed), false) as fx_missing,
           min(fc.reason) filter (where l.costed and fc.per_plate is null) as fx_reason,
           sum(l.weight_g) as w_g,
           count(l.weight_g) as w_n
      from l
      left join fc on fc.business_date = l.business_date
     group by l.menu_item_id
  ),
  tot as (
    select coalesce(sum(it.plates), 0) as plates, coalesce(sum(it.net), 0) as net, coalesce(sum(it.c_net), 0) as c_net, coalesce(sum(it.f_cost), 0) as f_cost
      from it
  ),
  rowj as (
    select it.plates as sort_plates, it.name, it.menu_item_id,
           jsonb_build_object(
             'menuItemId', it.menu_item_id, 'name', it.name, 'course', mi.course_default::text, 'plates', it.plates,
             'mixPct', case when tot.plates > 0 then round(it.plates / tot.plates * 100, 2) end,
             'revenueNetEur', round(it.net, 4), 'costedPlates', it.c_plates, 'costedRevenueNetEur', round(it.c_net, 4),
             'foodCostEur', round(it.f_cost, 4),
             'foodCostPct', case when it.c_net > 0 then round(it.f_cost / it.c_net * 100, 2) end,
             'foodMarginPerPlateEur', case when it.c_plates > 0 then round((it.c_net - it.f_cost) / it.c_plates, 4) end,
             'weightG', it.w_g, 'avgWeightG', case when it.w_n > 0 then round(it.w_g::numeric / it.w_n) end,
             'status', case when it.c_plates = it.plates then 'costed'
                            when it.c_plates > 0 then 'partial'
                            when it.m_plates > 0 then 'incomplete'
                            else 'unmapped' end)
           || case when v_owner then jsonb_build_object(
                'fixedCostPerPlateEur',
                  case when it.c_plates > 0 and not it.fx_missing then round(it.fx / it.c_plates, 4) end,
                'grossMarginPerPlateEur',
                  case when it.c_plates > 0 and not it.fx_missing then round((it.c_net - it.f_cost) / it.c_plates - it.fx / it.c_plates, 4) end,
                'contributionEur',
                  case when it.c_plates > 0 and not it.fx_missing then round(((it.c_net - it.f_cost) / it.c_plates - it.fx / it.c_plates) * it.plates, 4) end,
                'fixedCostReason', case when it.c_plates > 0 and it.fx_missing then it.fx_reason end)
              else '{}'::jsonb end as j
      from it
      join public.menu_item mi on mi.tenant_id = p_tenant and mi.id = it.menu_item_id
     cross join tot
  )
  select coalesce((select jsonb_agg(r.j order by r.sort_plates desc, r.name collate "C", r.menu_item_id) from rowj r), '[]'::jsonb),
         (select jsonb_build_object('plates', t.plates, 'revenueNetEur', round(t.net, 4), 'costedRevenueNetEur', round(t.c_net, 4),
                                    'foodCostEur', round(t.f_cost, 4),
                                    'foodCostPct', case when t.c_net > 0 then round(t.f_cost / t.c_net * 100, 2) end)
            from tot t)
    into v_rows, v_totals;

  return jsonb_build_object('role', case when v_owner then 'owner' else 'admin' end, 'period', p_period, 'from', per.from_d, 'to', per.to_d,
                            'final', v_final, 'rows', v_rows, 'totals', v_totals);
end
$$;
revoke all on function app.session_bill_json(uuid, uuid, jsonb), app.kitchen_ticket_rows(uuid, timestamptz),
  app.kpi_items_json(uuid, text, text, date, date, date, timestamptz) from public, anon, authenticated, service_role;
