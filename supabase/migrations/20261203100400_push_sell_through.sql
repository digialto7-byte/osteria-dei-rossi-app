-- P2-2 S5 (docs/plans/2026-11-14-p2-2-trace-sell-through.md section 3.4, D-P8): how pushed dishes sold on a business day. Read-only definer with an empty search_path;
-- public.push_sell_through calls app.require_push_reader() first (owner, admin, chef; a waiter is 42501), takes the tenant and the role from the session and is executable by `authenticated` only.
--
--   app.push_sell_through_json(p_tenant, p_role, p_date, p_now) -> {businessDate, ongoing, pushes [card], summary {pushes, lines, portions}}
--   Day: p_date null is yesterday's business date; a date after the business today is P0001 date_in_future; today is allowed (figures so far, ongoing true). The day window is
--   [kpi_cutoff_end(D-1), kpi_cutoff_end(D)), DST-safe. A push is a period of app.menu_push_periods; its window is the period clipped to the day and to now (a push over two days appears on both,
--   clipped; empty windows are dropped). startedAt and endedAt are the clipped window (ISO UTC), `ongoing` says the window is still open at now.
--   Card: {menuItemId, name, startedAt, endedAt, ongoing, hasDayRate, pushPrice (owner and admin only; the key is absent for the chef), plates {lines, portions}, atRisk [...]}.
--   plates: the fired, not voided lines of the dish fired inside the window, in portions (app.order_line_portions, a weighed line counts its fraction).
--   atRisk, per recipe key of the push's batch_keys snapshot with at least one batch that was due soon at the window start (app.use_by_state), produced before it, with portions left at that
--   moment: the batches plus their split children created inside the window.
--     atStart         portions of those batches from movements strictly before the window start
--     soldDuring      consume rows of any plate created in the window and never reversed (the screen says "any plate")
--     wastedDuring    waste rows of batch_discard and order_void created in the window
--     leftAtEnd       portions from movements before the window end
--     otherDuring     leftAtEnd - atStart + soldDuring + wastedDuring (staff meals, counts and the like), so the four figures always add up
--     discardedAfter  batch_discard waste from the window end to now
--     sellThroughPct  round(100 * soldDuring / atStart) when atStart > 0, else null (computed here, once)
--   The summary adds only pushes, lines and portions of the plates: portions at risk are not summed (two dishes can share a batch). No cost is read; pushPrice is the frozen push price.

create function app.push_sell_through_json(p_tenant uuid, p_role text, p_date date, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_today date := app.business_date(p_tenant, p_now);
  v_date date;
  v_ds timestamptz;
  v_de timestamptz;
  v_cards jsonb := '[]'::jsonb;
  v_card jsonb;
  v_at_risk jsonb;
  v_lines integer;
  v_portions numeric;
  v_total_lines integer := 0;
  v_total_portions numeric := 0;
  v_n integer := 0;
  v_base uuid[];
  v_members uuid[];
  v_name text;
  v_start numeric;
  v_sold numeric;
  v_wasted numeric;
  v_left numeric;
  v_after numeric;
  r record;
  k record;
begin
  v_date := coalesce(p_date, v_today - 1);
  if v_date > v_today then
    raise exception 'date_in_future' using errcode = 'P0001';
  end if;
  v_ds := app.kpi_cutoff_end(p_tenant, v_date - 1);
  v_de := app.kpi_cutoff_end(p_tenant, v_date);

  for r in
    select p.menu_item_id, mi.name, greatest(p.started_at, v_ds) as w_start, least(p.effective_end, v_de, p_now) as w_end,
           p.effective_end, p.push_price, p.batch_keys
      from app.menu_push_periods(p_tenant, v_ds, least(v_de, p_now)) p
      join public.menu_item mi on mi.tenant_id = p_tenant and mi.id = p.menu_item_id
     where greatest(p.started_at, v_ds) < least(p.effective_end, v_de, p_now)
     order by greatest(p.started_at, v_ds), mi.name collate "C", p.menu_item_id
  loop
    select count(*)::integer, coalesce(sum(app.order_line_portions(ol.qty, ol.weight_g, ol.portion_weight_g)), 0)
      into v_lines, v_portions
      from public.order_line ol
     where ol.tenant_id = p_tenant and ol.menu_item_id = r.menu_item_id and ol.voided_at is null
       and ol.fired_at >= r.w_start and ol.fired_at < r.w_end;

    v_at_risk := '[]'::jsonb;
    for k in
      select rk.id as key_id, rc.name
        from public.recipe_key rk
        join public.recipe rc on rc.tenant_id = rk.tenant_id and rc.recipe_key = rk.id and rc.version = rk.current_version
       where rk.tenant_id = p_tenant and rk.id = any (r.batch_keys)
       order by rc.name collate "C", rk.id
    loop
      v_base := coalesce(array(
        select b.id
          from public.batch b
         where b.tenant_id = p_tenant and b.recipe_key = k.key_id and b.produced_at < r.w_start
           and app.use_by_state(b.use_by, r.w_start) = 'due_soon'
           and coalesce((select sum(m.portions) from public.batch_movement m where m.tenant_id = p_tenant and m.batch_id = b.id and m.created_at < r.w_start), 0) > 0), '{}');
      if cardinality(v_base) = 0 then
        continue;
      end if;
      v_members := array(
        select distinct f.batch_id
          from app.batch_family(p_tenant, v_base, r.w_end) f
          join public.batch b on b.tenant_id = p_tenant and b.id = f.batch_id
         where f.depth = 0 or b.created_at >= r.w_start);

      select coalesce(sum(m.portions) filter (where m.created_at < r.w_start), 0),
             coalesce(-sum(m.portions) filter (where m.type::text = 'consume' and m.ref_type = 'order_line' and m.reverses_id is null and rv.id is null
                                                 and m.created_at >= r.w_start and m.created_at < r.w_end), 0),
             coalesce(-sum(m.portions) filter (where m.type::text = 'waste' and m.ref_type in ('batch_discard', 'order_void') and m.created_at >= r.w_start and m.created_at < r.w_end), 0),
             coalesce(sum(m.portions) filter (where m.created_at < r.w_end), 0),
             coalesce(-sum(m.portions) filter (where m.type::text = 'waste' and m.ref_type = 'batch_discard' and m.created_at >= r.w_end and m.created_at <= p_now), 0)
        into v_start, v_sold, v_wasted, v_left, v_after
        from public.batch_movement m
        left join public.batch_movement rv on rv.tenant_id = m.tenant_id and rv.reverses_id = m.id
       where m.tenant_id = p_tenant and m.batch_id = any (v_members);

      v_at_risk := v_at_risk || jsonb_build_object(
        'recipeKey', k.key_id,
        'name', k.name,
        'batches', cardinality(v_members),
        'atStart', v_start,
        'soldDuring', v_sold,
        'wastedDuring', v_wasted,
        'otherDuring', v_left - v_start + v_sold + v_wasted,
        'leftAtEnd', v_left,
        'discardedAfter', v_after,
        'sellThroughPct', case when v_start > 0 then round(100 * v_sold / v_start)::integer end);
    end loop;

    v_card := jsonb_build_object(
      'menuItemId', r.menu_item_id,
      'name', r.name,
      'startedAt', app.iso_utc(r.w_start),
      'endedAt', app.iso_utc(r.w_end),
      'ongoing', v_date = v_today and r.effective_end > p_now,
      'hasDayRate', r.push_price is not null,
      'plates', jsonb_build_object('lines', v_lines, 'portions', v_portions),
      'atRisk', v_at_risk);
    if p_role in ('owner', 'admin') then
      v_card := v_card || jsonb_build_object('pushPrice', r.push_price);
    end if;
    v_cards := v_cards || v_card;
    v_n := v_n + 1;
    v_total_lines := v_total_lines + v_lines;
    v_total_portions := v_total_portions + v_portions;
  end loop;

  return jsonb_build_object(
    'businessDate', v_date,
    'ongoing', v_date = v_today,
    'pushes', v_cards,
    'summary', jsonb_build_object('pushes', v_n, 'lines', v_total_lines, 'portions', v_total_portions));
end
$$;

create function public.push_sell_through(p_date date default null) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_push_reader();
  return app.push_sell_through_json(app.tenant_id(), app.role()::text, p_date, clock_timestamp());
end
$$;

revoke all on function app.push_sell_through_json(uuid, text, date, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.push_sell_through(date) from public, anon, authenticated, service_role;
grant execute on function public.push_sell_through(date) to authenticated;
