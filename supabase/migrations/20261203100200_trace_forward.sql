-- P2-2 S3 (docs/plans/2026-11-14-p2-2-trace-sell-through.md section 3.3.1): the forward trace of a supplier lot. Read-only definer with an empty search_path;
-- public.trace_lot calls app.require_trace_reader() first and takes the tenant and the role from the session; executable by `authenticated` only.
--
--   app.trace_lot_json(p_tenant, p_role, p_lot) -> {
--     lot {lotId, ingredient, supplier, lotCode|null, expiry|null, receivedOn, qtyReceived, unit, location, invoice?, purchase?},
--     raw {received, intoBatches, intoPlates, wasted, counted, onHand, unit},
--     batches [{batchId, lotCode, recipeName, producedAt, useBy, qtyFromLot|null, portionsInitial, splitFrom|null, state, portions {sold, wasted, staffMeal, counted, remaining}}], batchesTruncated,
--     plates [{businessDate, menuItemId, name, lines, portions, firstAt, lastAt, via}], platesTruncated,
--     voided {lines, portions}, gaps {lotCodeMissing, unlottedSameIngredientBatches} }
--
--   Net of reversals (D-P4): an original movement counts with its reversal row added (a reversal is a row with reverses_id), so a consumption undone by a void is not "used"; the void's
--   waste row is a waste. The ledgers are folded at read time, never stored.
--   Batches (D-P5): every batch with a batch_input row of the lot, plus its split children (app.batch_family). A child has qtyFromLot null. Ordered by production time, depth, creation, id.
--   Portions of a batch (this batch only): sold = -sum(consume) (the reversal of a void is in the sum), wasted = -sum(waste other than staff meals), staffMeal = -sum(staff meal waste),
--   counted = sum(count) (signed), remaining = sum(all). With the split rows: initial = sold + wasted + staffMeal - counted + split out + remaining.
--   Plates (D-P6): consume rows (ref order_line, never reversed) of the family, and consumption rows (ref order_line, never reversed) of the lot itself (via direct), grouped by the business
--   date of the movement and the dish; a line counts once per group and its portions are app.order_line_portions (a weighed line counts its fraction). Voided: lines whose consume was reversed
--   by a void (ref order_void), in the family or on the lot. Ordered by business date, name, route.
--   Gaps (D-P3): lotCodeMissing, and the batches of the same ingredient with an unlotted input produced from the lot's receipt day on ("Da verificare a mano").
--   Roles (D-P7, D-P13): only owner and admin get `invoice` (id, number as printed, date) and `purchase` (the invoice line's supplier item, supplier code and description as approved; supplier_item
--   itself is mutable and is not read). No money key for any role. An unknown id or another tenant's id is the same P0002 not_found.

create function app.trace_lot_json(p_tenant uuid, p_role text, p_lot uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_max_batches integer := (app.trace_constants() ->> 'TRACE_MAX_BATCHES')::integer;
  v_max_plates integer := (app.trace_constants() ->> 'TRACE_MAX_PLATE_GROUPS')::integer;
  l public.raw_lot;
  v_lot jsonb;
  v_raw jsonb;
  v_roots uuid[];
  v_fam uuid[];
  v_batches jsonb;
  v_batches_n integer;
  v_plates jsonb;
  v_plates_n integer;
  v_voided jsonb;
  v_unlotted integer;
begin
  select * into l from public.raw_lot r where r.tenant_id = p_tenant and r.id = p_lot;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- The lot block.
  select jsonb_build_object(
           'lotId', l.id,
           'ingredient', jsonb_build_object('id', i.id, 'name', i.name),
           'supplier', jsonb_build_object('id', s.id, 'name', s.name),
           'lotCode', l.lot_code,
           'expiry', l.expiry,
           'receivedOn', l.received_on,
           'qtyReceived', l.qty_received,
           'unit', l.base_unit::text,
           'location', jsonb_build_object('id', loc.id, 'name', loc.name))
    into v_lot
    from public.ingredient i, public.supplier s, public.location loc
   where i.tenant_id = p_tenant and i.id = l.ingredient_id
     and s.tenant_id = p_tenant and s.id = l.supplier_id
     and loc.tenant_id = p_tenant and loc.id = l.location_id;
  if p_role in ('owner', 'admin') then
    v_lot := v_lot
      || (select jsonb_build_object('invoice', jsonb_build_object('id', inv.id, 'number', inv.number_raw, 'date', inv.invoice_date),
                                    'purchase', jsonb_build_object('supplierItemId', il.supplier_item_id, 'supplierCode', il.supplier_code, 'description', il.raw_description))
            from public.invoice_line il
            join public.invoice inv on inv.tenant_id = il.tenant_id and inv.id = il.invoice_id
           where il.tenant_id = p_tenant and il.id = l.invoice_line_id);
  end if;

  -- The raw side: originals with their reversal added, so a reversed movement is not counted.
  select jsonb_build_object(
           'received', coalesce(sum(o.net) filter (where o.t = 'receipt'), 0),
           'intoBatches', coalesce(-sum(o.net) filter (where o.t = 'consumption' and o.ref_type = 'batch'), 0),
           'intoPlates', coalesce(-sum(o.net) filter (where o.t = 'consumption' and o.ref_type = 'order_line'), 0),
           'wasted', coalesce(-sum(o.net) filter (where o.t = 'waste'), 0),
           'counted', coalesce(sum(o.net) filter (where o.t = 'count'), 0),
           'onHand', coalesce(sum(o.net), 0),
           'unit', l.base_unit::text)
    into v_raw
    from (select m.type::text as t, m.ref_type, m.qty + coalesce(r.qty, 0) as net
            from public.stock_movement m
            left join public.stock_movement r on r.tenant_id = m.tenant_id and r.reverses_id = m.id
           where m.tenant_id = p_tenant and m.raw_lot_id = l.id and m.reverses_id is null) o;

  -- The family of the batches made from the lot (D-P5), then the batches with their portions, oldest first.
  v_roots := coalesce(array(select distinct bi.batch_id from public.batch_input bi where bi.tenant_id = p_tenant and bi.raw_lot_id = l.id), '{}');
  v_fam := coalesce(array(select f.batch_id from app.batch_family(p_tenant, v_roots, null) f), '{}');

  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= v_max_batches), '[]'::jsonb), count(*)::integer
    into v_batches, v_batches_n
    from (
      select row_number() over (order by b.produced_at, f.depth, b.created_at, b.id) as rn,
             jsonb_build_object(
               'batchId', b.id,
               'lotCode', b.lot_code,
               'recipeName', rc.name,
               'producedAt', app.iso_utc(b.produced_at),
               'useBy', app.iso_utc(b.use_by),
               'qtyFromLot', (select sum(bi.qty) from public.batch_input bi where bi.tenant_id = p_tenant and bi.batch_id = b.id and bi.raw_lot_id = l.id),
               'portionsInitial', b.portions_initial,
               'splitFrom', case when pb.id is null then null else jsonb_build_object('batchId', pb.id, 'lotCode', pb.lot_code) end,
               'state', b.state::text,
               'portions', jsonb_build_object(
                 'sold', coalesce(-sum(m.portions) filter (where m.type::text = 'consume'), 0),
                 'wasted', coalesce(-sum(m.portions) filter (where m.type::text = 'waste' and m.ref_type <> 'staff_meal'), 0),
                 'staffMeal', coalesce(-sum(m.portions) filter (where m.type::text = 'waste' and m.ref_type = 'staff_meal'), 0),
                 'counted', coalesce(sum(m.portions) filter (where m.type::text = 'count'), 0),
                 'remaining', coalesce(sum(m.portions), 0))) as j
        from app.batch_family(p_tenant, v_roots, null) f
        join public.batch b on b.tenant_id = p_tenant and b.id = f.batch_id
        join public.recipe rc on rc.tenant_id = b.tenant_id and rc.id = b.recipe_id
        left join public.batch pb on pb.tenant_id = b.tenant_id and pb.id = b.split_from_batch_id
        left join public.batch_movement m on m.tenant_id = b.tenant_id and m.batch_id = b.id
       group by b.id, b.lot_code, rc.name, b.produced_at, b.use_by, b.portions_initial, pb.id, pb.lot_code, b.state, b.created_at, f.depth
       order by b.produced_at, f.depth, b.created_at, b.id
       limit v_max_batches + 1
    ) x;

  -- The plates: net consume rows of the family and net consumption rows of the lot itself, one line once per group.
  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= v_max_plates), '[]'::jsonb), count(*)::integer
    into v_plates, v_plates_n
    from (
      select row_number() over (order by g.bd, g.name collate "C", g.via, g.menu_item_id) as rn,
             jsonb_build_object('businessDate', g.bd, 'menuItemId', g.menu_item_id, 'name', g.name, 'lines', g.lines, 'portions', g.portions,
                                'firstAt', app.iso_utc(g.first_at), 'lastAt', app.iso_utc(g.last_at), 'via', g.via) as j
        from (
          select pl.bd, pl.menu_item_id, pl.name, pl.via, count(*)::integer as lines, sum(pl.portions) as portions, min(pl.first_at) as first_at, max(pl.last_at) as last_at
            from (
              select app.business_date(p_tenant, u.at) as bd, ol.menu_item_id, mi.name, u.via, u.line_id,
                     min(u.at) as first_at, max(u.at) as last_at, max(app.order_line_portions(ol.qty, ol.weight_g, ol.portion_weight_g)) as portions
                from (
                  select m.created_at as at, m.ref_id as line_id, 'batch'::text as via
                    from public.batch_movement m
                   where m.tenant_id = p_tenant and m.batch_id = any (v_fam) and m.type::text = 'consume' and m.ref_type = 'order_line' and m.reverses_id is null
                     and not exists (select 1 from public.batch_movement r where r.tenant_id = m.tenant_id and r.reverses_id = m.id)
                  union all
                  select m.created_at, m.ref_id, 'direct'::text
                    from public.stock_movement m
                   where m.tenant_id = p_tenant and m.raw_lot_id = l.id and m.type::text = 'consumption' and m.ref_type = 'order_line' and m.reverses_id is null
                     and not exists (select 1 from public.stock_movement r where r.tenant_id = m.tenant_id and r.reverses_id = m.id)
                ) u
                join public.order_line ol on ol.tenant_id = p_tenant and ol.id = u.line_id
                join public.menu_item mi on mi.tenant_id = ol.tenant_id and mi.id = ol.menu_item_id
               group by 1, 2, 3, 4, 5
            ) pl
           group by pl.bd, pl.menu_item_id, pl.name, pl.via
        ) g
       order by g.bd, g.name collate "C", g.via, g.menu_item_id
       limit v_max_plates + 1
    ) x;

  -- Voided after the send: lines whose consume was reversed by a void, on the family or on the lot.
  select jsonb_build_object('lines', count(*)::integer, 'portions', coalesce(sum(app.order_line_portions(ol.qty, ol.weight_g, ol.portion_weight_g)), 0))
    into v_voided
    from public.order_line ol
   where ol.tenant_id = p_tenant
     and ol.id in (
       select m.ref_id from public.batch_movement m
        where m.tenant_id = p_tenant and m.batch_id = any (v_fam) and m.type::text = 'consume' and m.ref_type = 'order_void' and m.reverses_id is not null
       union
       select m.ref_id from public.stock_movement m
        where m.tenant_id = p_tenant and m.raw_lot_id = l.id and m.type::text = 'consumption' and m.ref_type = 'order_void' and m.reverses_id is not null);

  -- Gaps (D-P3): batches of the same ingredient made from the receipt day on with an input that had no lot.
  select count(distinct bi.batch_id)::integer into v_unlotted
    from public.batch_input bi
    join public.batch b on b.tenant_id = bi.tenant_id and b.id = bi.batch_id
   where bi.tenant_id = p_tenant and bi.raw_lot_id is null and bi.ingredient_id = l.ingredient_id
     and app.business_date(p_tenant, b.produced_at) >= l.received_on;

  return jsonb_build_object(
    'lot', v_lot,
    'raw', v_raw,
    'batches', v_batches,
    'batchesTruncated', v_batches_n > v_max_batches,
    'plates', v_plates,
    'platesTruncated', v_plates_n > v_max_plates,
    'voided', v_voided,
    'gaps', jsonb_build_object('lotCodeMissing', l.lot_code is null, 'unlottedSameIngredientBatches', v_unlotted));
end
$$;

create function public.trace_lot(p_lot uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_trace_reader();
  return app.trace_lot_json(app.tenant_id(), app.role()::text, p_lot);
end
$$;

revoke all on function app.trace_lot_json(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.trace_lot(uuid) from public, anon, authenticated, service_role;
grant execute on function public.trace_lot(uuid) to authenticated;
