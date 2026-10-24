-- M16 step 2: the helpers of schema app (plan §3.1.3, §3.1.5, §3.1.6, §3.2; AT3 window, AT6 DST, AT7 weekday average):
-- the delivery window and order-by deadline, usable on hand, the trailing-14-day weekday consumption, the forecast sum,
-- the supplier window and the effective recipe rules. Hand-computed vectors from plan §3.8. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(56);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number, lead_time_days, delivery_weekdays, order_cutoff_time) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Macelleria X (demo)', 'IT12345678903',
   2, '{1,4}', '11:00'),
  ('5a000000-0000-4000-8000-0000000000b5', '22222222-2222-4222-8222-222222222222', 'Macelleria B (demo)', 'IT11111111115',
   1, '{2}', '09:30');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
   'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a'),
  ('e1000000-0000-4000-8000-0000000000e2', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/2026/e1000000-0000-4000-8000-0000000000e2.pdf',
   'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-0000000000b5');

create temporary table reg (k text primary key, id uuid not null);
insert into reg values ('cella', '10000000-0000-4000-8000-0000000000a1'), ('cellab', '10000000-0000-4000-8000-0000000000b1');
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
create sequence pg_temp.line_seq;
create function pg_temp.new_line(p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns uuid language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
      line_amount, field_confidence, extracted)
    values (v_line, p_tenant,
      case when p_tenant = '11111111-1111-4111-8111-111111111111' then 'e1000000-0000-4000-8000-0000000000e1'::uuid
           else 'e1000000-0000-4000-8000-0000000000e2'::uuid end, v_n, 'Riga demo', 1, 10, 10, '{}', '{}');
  return v_line;
end
$$;
create function pg_temp.mk_ing(p_k text, p_name text, p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values (pg_temp.id(p_k), p_tenant, p_name, 'kg', true);
end
$$;
-- A lot with its receipt (effective 2026-10-01).
create function pg_temp.mk_lot(p_key text, p_ing text, p_expiry date, p_qty numeric, p_tenant uuid default '11111111-1111-4111-8111-111111111111')
  returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_line(p_tenant);
  v_lot uuid := gen_random_uuid();
  v_loc uuid := case when p_tenant = '11111111-1111-4111-8111-111111111111' then pg_temp.id('cella') else pg_temp.id('cellab') end;
  v_by uuid := case when p_tenant = '11111111-1111-4111-8111-111111111111' then 'a1000000-0000-4000-8000-00000000000a'::uuid
                    else 'b1000000-0000-4000-8000-00000000000b'::uuid end;
  v_sup uuid := case when p_tenant = '11111111-1111-4111-8111-111111111111' then '5a000000-0000-4000-8000-00000000005a'::uuid
                     else '5a000000-0000-4000-8000-0000000000b5'::uuid end;
begin
  insert into reg values (p_key, v_lot);
  insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code,
      expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
    values (v_lot, p_tenant, pg_temp.id(p_ing), v_loc, v_sup, v_line, upper(p_key), p_expiry, '2026-10-01', p_qty, 'kg', p_qty, 'kg', 1, v_by);
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type,
      ref_id, effective_on, created_by)
    values (p_tenant, pg_temp.id(p_ing), v_lot, v_loc, 'receipt', p_qty, 10, 'invoice_line', v_line, '2026-10-01', v_by);
end
$$;
-- An outflow (negative qty) of an ingredient on a date, from a lot or unlotted.
create function pg_temp.out_(p_ing text, p_type text, p_qty numeric, p_on date, p_lot text default null,
    p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_loc uuid := case when p_tenant = '11111111-1111-4111-8111-111111111111' then pg_temp.id('cella') else pg_temp.id('cellab') end;
begin
  insert into public.stock_movement (id, tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, reason_code,
      ref_type, ref_id, effective_on, created_by)
    values (v_id, p_tenant, pg_temp.id(p_ing), case when p_lot is null then null else pg_temp.id(p_lot) end, v_loc,
      p_type::public.stock_movement_type, -p_qty, case when p_type = 'waste' then 'spoilage' end, 'manual', gen_random_uuid(), p_on,
      case when p_tenant = '11111111-1111-4111-8111-111111111111' then 'a1000000-0000-4000-8000-00000000000a'::uuid
           else 'b1000000-0000-4000-8000-00000000000b'::uuid end);
  return v_id;
end
$$;
-- The reversal of one of them, posted on a date (same lot, location, type, reason).
create function pg_temp.reverse_(p_id uuid, p_on date) returns void language plpgsql as $$
begin
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, reason_code, unit_cost,
      ref_type, ref_id, reverses_id, effective_on, created_by)
    select m.tenant_id, m.ingredient_id, m.raw_lot_id, m.location_id, m.type, -m.qty, m.reason_code, m.unit_cost,
           'reversal', m.id, m.id, p_on, m.created_by
      from public.stock_movement m where m.id = p_id;
end
$$;

-- The window as 'delivery_date order_by_at' (or 'none').
create function pg_temp.win(p_at text, p_wd smallint[], p_cut time, p_lead smallint, p_tz text default 'Europe/Rome') returns text language sql as $$
  select coalesce((select w.delivery_date::text || ' ' || app.iso_utc(w.order_by_at)
                     from app.next_delivery_window(p_at::timestamptz, p_tz, p_wd, p_cut, p_lead) w), 'none') $$;

-- AT3: Monday 2026-11-02 15:00 Rome. Monday 2 Nov: order by Sat 31 Oct 11:00, passed; Thursday 5 Nov: order by Tue 3 Nov 11:00.
select is(pg_temp.win('2026-11-02T14:00:00Z', '{1,4}', '11:00', 2::smallint), '2026-11-05 2026-11-03T10:00:00Z',
  'AT3: Monday afternoon, Mon/Thu, cut-off 11:00, lead 2 -> Thursday delivery, order by Tuesday 11:00 Rome');
select is(pg_temp.win('2026-11-03T10:00:00Z', '{1,4}', '11:00', 2::smallint), '2026-11-05 2026-11-03T10:00:00Z',
  'exactly at the deadline the window is still open');
select is(pg_temp.win('2026-11-03T10:00:01Z', '{1,4}', '11:00', 2::smallint), '2026-11-09 2026-11-07T10:00:00Z',
  'one second later the next delivery (Monday 9 Nov) is the window, order by Saturday 7 Nov 11:00');
select is(pg_temp.win('2026-11-09T08:00:00Z', '{1}', '11:00', 0::smallint), '2026-11-09 2026-11-09T10:00:00Z',
  'lead 0, Monday 09:00 Rome: today is the delivery, order by today 11:00');
select is(pg_temp.win('2026-11-09T10:30:00Z', '{1}', '11:00', 0::smallint), '2026-11-16 2026-11-16T10:00:00Z',
  'lead 0, Monday 11:30 Rome: next Monday');
select is(pg_temp.win('2026-11-02T14:00:00Z', '{4}', null, 2::smallint), '2026-11-05 2026-11-03T23:00:00Z',
  'a null cut-off means any time that day: order by local midnight at the end of the order date (Tue 3 Nov, 24:00 Rome = 23:00Z)');
select is(pg_temp.win('2026-11-02T14:00:00Z', '{}', '11:00', 2::smallint), 'none', 'no weekdays: no window');
select is(pg_temp.win('2026-11-02T14:00:00Z', '{1,4}', '11:00', null), 'none', 'a null lead time: no window');
select is(pg_temp.win('2026-11-02T14:00:00Z', null, '11:00', 2::smallint), 'none', 'null weekdays: no window');
select is(pg_temp.win('2026-11-02T14:00:00Z', '{4}', '11:00', 0::smallint), '2026-11-05 2026-11-05T10:00:00Z', 'lead 0 on a Thursday-only supplier');
select is(pg_temp.win('2026-11-02T14:00:00Z', '{1}', '11:00', 365::smallint), '2027-11-08 2026-11-08T10:00:00Z',
  'a 365-day lead time still finds a window (the horizon scan covers lead + 7 days)');

-- DST (AT6, T1): the deadline is the local date and time converted through the zone database.
select is(pg_temp.win('2026-10-24T08:00:00Z', '{2}', '11:00', 2::smallint), '2026-10-27 2026-10-25T10:00:00Z',
  'DST end: order by Sunday 25 Oct 11:00 is 10:00Z (CET), not 09:00Z');
select is(pg_temp.win('2026-10-24T08:00:00Z', '{7}', '02:30', 0::smallint), '2026-10-25 2026-10-25T01:30:00Z',
  'T1: a cut-off in the autumn repeated hour (02:30 on 25 Oct) takes the standard-time reading, 01:30Z');
select is(pg_temp.win('2027-03-27T08:00:00Z', '{7}', '02:30', 0::smallint), '2027-03-28 2027-03-28T01:30:00Z',
  'T1: a cut-off in the spring gap (02:30 on 28 Mar) takes the pre-transition offset, 01:30Z');
select is(pg_temp.win('2027-03-27T08:00:00Z', '{2}', '11:00', 2::smallint), '2027-03-30 2027-03-28T09:00:00Z',
  'DST start: order by Sunday 28 Mar 11:00 is 09:00Z (CEST)');
select is(pg_temp.win('2026-10-25T00:30:00Z', '{7}', '11:00', 0::smallint), '2026-10-25 2026-10-25T10:00:00Z',
  'a run at 02:30 CEST on the 25-hour day still sees today');
select is(pg_temp.win('2026-10-25T22:30:00Z', '{1}', '11:00', 0::smallint), '2026-10-26 2026-10-26T10:00:00Z',
  'a run at 23:30 CET on the 25 Oct sees Monday 26 Oct as the next delivery');

-- Session-zone independence: the same eight vectors under three session time zones.
create temp table zonerun (zone text, v text);
do $$
declare
  z text;
begin
  foreach z in array array['Europe/Rome', 'UTC', 'America/New_York'] loop
    perform set_config('TimeZone', z, true);
    insert into zonerun select z, concat_ws('|',
      pg_temp.win('2026-11-02T14:00:00Z', '{1,4}', '11:00', 2::smallint),
      pg_temp.win('2026-11-03T10:00:01Z', '{1,4}', '11:00', 2::smallint),
      pg_temp.win('2026-10-24T08:00:00Z', '{2}', '11:00', 2::smallint),
      pg_temp.win('2026-10-24T08:00:00Z', '{7}', '02:30', 0::smallint),
      pg_temp.win('2027-03-27T08:00:00Z', '{7}', '02:30', 0::smallint),
      pg_temp.win('2027-03-27T08:00:00Z', '{2}', '11:00', 2::smallint),
      pg_temp.win('2026-11-02T14:00:00Z', '{4}', null, 2::smallint),
      app.iso_utc('2026-10-25T10:00:00Z'::timestamptz));
  end loop;
  perform set_config('TimeZone', 'Europe/Rome', true);
end
$$;
select is((select count(distinct v)::int from zonerun), 1, 'windows and iso_utc are the same under Europe/Rome, UTC and America/New_York');
select is((select v from zonerun where zone = 'America/New_York'),
  '2026-11-05 2026-11-03T10:00:00Z|2026-11-09 2026-11-07T10:00:00Z|2026-10-27 2026-10-25T10:00:00Z|2026-10-25 2026-10-25T01:30:00Z|2027-03-28 2027-03-28T01:30:00Z|2027-03-30 2027-03-28T09:00:00Z|2026-11-05 2026-11-03T23:00:00Z|2026-10-25T10:00:00Z',
  'and equal to the expected values');
select is(app.iso_utc('2026-11-03T11:00:00+01:00'::timestamptz), '2026-11-03T10:00:00Z', 'iso_utc writes the UTC instant with a Z');
select is(app.iso_utc(null), null, 'iso_utc of null is null');

-- The Macelleria fixture (plan §3.8). Clock Monday 2026-11-02. On hand 9,0 after every movement, noise included.
select pg_temp.mk_ing('beef', 'Manzo muscolo (demo)');
select pg_temp.mk_lot('lbeef', 'beef', null, 42.5);
select pg_temp.out_('beef', 'consumption', q, d::date) from (values
  (2.0, '2026-10-19'), (2.0, '2026-10-26'),
  (2.5, '2026-10-20'), (3.5, '2026-10-27'),
  (1.0, '2026-10-21'), (3.0, '2026-10-28'),
  (1.0, '2026-10-22'), (1.0, '2026-10-29'),
  (2.0, '2026-10-23'), (4.0, '2026-10-30'),
  (6.0, '2026-10-31')) v (q, d);
-- Noise that must be ignored: waste, a row outside the window, a row of today, and a consumption reversed later.
select pg_temp.out_('beef', 'waste', 0.5, '2026-10-21');
select pg_temp.out_('beef', 'consumption', 4.0, '2026-10-18');
select pg_temp.out_('beef', 'consumption', 1.0, '2026-11-02');
select pg_temp.reverse_(pg_temp.out_('beef', 'consumption', 1.0, '2026-10-28'), '2026-10-30');

select is((select string_agg(w.isodow || ':' || trim_scale(w.avg_qty), ' ' order by w.isodow)
             from app.weekday_consumption('11111111-1111-4111-8111-111111111111', '2026-11-02') w where w.ingredient_id = pg_temp.id('beef')),
  '1:2 2:3 3:2 4:1 5:3 6:3', 'AT7: the weekday averages are Mon 2,0 Tue 3,0 Wed 2,0 Thu 1,0 Fri 3,0 Sat 3,0 and Sunday has no row');
select is((select count(*)::int from app.weekday_consumption('11111111-1111-4111-8111-111111111111', '2026-11-02') w where w.avg_qty = 0), 0,
  'no row has a zero average');
select is((select trim_scale(w.avg_qty) from app.weekday_consumption('11111111-1111-4111-8111-111111111111', '2026-11-02') w where w.isodow = 3),
  2.0::numeric, 'Wednesday: the -1/+1 pair nets to 0 on its original date, so (1,0 + 3,0) / 2');
select is((select trim_scale(w.avg_qty) from app.weekday_consumption('11111111-1111-4111-8111-111111111111', '2026-11-02') w where w.isodow = 1),
  2.0::numeric, 'Monday ignores the -1,0 of today (a partial day)');
select is((select string_agg(w.isodow || ':' || trim_scale(w.avg_qty), ' ' order by w.isodow)
             from app.weekday_consumption('11111111-1111-4111-8111-111111111111', '2026-11-03') w where w.ingredient_id = pg_temp.id('beef')),
  '1:1.5 2:3 3:2 4:1 5:3 6:3', 'a day later the window moves: 19/10 drops out and 02/11, now complete, comes in (Monday = (2,0 + 1,0) / 2)');
select is((select count(*)::int from app.weekday_consumption('22222222-2222-4222-8222-222222222222', '2026-11-02')), 0,
  'tenant B sees none of tenant A''s consumption');

-- The forecast sum.
create temp table fx as
  select jsonb_object_agg(w.isodow::text, w.avg_qty) as avgs
    from app.weekday_consumption('11111111-1111-4111-8111-111111111111', '2026-11-02') w where w.ingredient_id = pg_temp.id('beef');
select is(app.forecast_qty((select avgs from fx), '2026-11-02', 3), 7.0::numeric, 'AT7: forecast over Mon, Tue, Wed = 7,0');
select is(app.forecast_qty((select avgs from fx), '2026-11-02', 7), 14.0::numeric, 'horizon 7 from a Monday is the sum of all seven averages');
select is(app.forecast_qty((select avgs from fx), '2026-11-04', 3), 6.0::numeric, 'Wednesday to Friday = 2 + 1 + 3');
select is(app.forecast_qty((select avgs from fx), '2026-11-01', 2), 2.0::numeric, 'a horizon over Sunday (no row) and Monday = 0 + 2');
select is(app.forecast_qty((select avgs from fx), '2026-11-02', 0), 0::numeric, 'a horizon of 0 days is 0');
select is(app.forecast_qty('{}'::jsonb, '2026-11-02', 5), 0::numeric, 'no history is 0');
select is(app.forecast_qty('{"1": 0.33333}'::jsonb, '2026-11-02', 1), 0.3333::numeric, 'the sum is rounded to 4 decimals');
select is(app.forecast_qty((select avgs from fx), '2026-11-02', 10), 21.0::numeric, 'ten days wrap around the week');

-- Usable on hand.
select is((select trim_scale(u.on_hand_qty) from app.usable_on_hand('11111111-1111-4111-8111-111111111111', '2026-11-02') u where u.ingredient_id = pg_temp.id('beef')),
  9.0::numeric, 'the fixture has 9,0 on hand');
select pg_temp.mk_ing('onion', 'Cipolla (demo)');
select pg_temp.mk_lot('lonionold', 'onion', '2026-11-01', 2);
select pg_temp.mk_lot('lonionok', 'onion', '2026-11-07', 1);
select pg_temp.out_('onion', 'consumption', 1, '2026-10-30');
select is((select trim_scale(u.on_hand_qty) from app.usable_on_hand('11111111-1111-4111-8111-111111111111', '2026-11-02') u where u.ingredient_id = pg_temp.id('onion')),
  0::numeric, 'a lot that expired yesterday (2 kg) is excluded, and the unlotted -1 counts: 2 + 1 - 1 - 2 = 0');
select pg_temp.mk_ing('carrot', 'Carota (demo)');
select pg_temp.mk_lot('lcarold', 'carrot', '2026-11-01', 3);
select pg_temp.mk_lot('lcarok', 'carrot', '2026-11-20', 5);
select pg_temp.out_('carrot', 'consumption', 1, '2026-10-30', 'lcarold');
select is((select trim_scale(u.on_hand_qty) from app.usable_on_hand('11111111-1111-4111-8111-111111111111', '2026-11-02') u where u.ingredient_id = pg_temp.id('carrot')),
  5::numeric, 'only the positive balance of the expired lot (3 - 1 = 2) is removed: 7 - 2 = 5');
select is((select trim_scale(u.on_hand_qty) from app.usable_on_hand('11111111-1111-4111-8111-111111111111', '2026-11-01') u where u.ingredient_id = pg_temp.id('onion')),
  2::numeric, 'a lot expiring today is still usable today: on 2026-11-01 nothing is removed (2 + 1 - 1)');
select pg_temp.mk_ing('beefb', 'Manzo B (demo)', '22222222-2222-4222-8222-222222222222');
select pg_temp.mk_lot('lbeefb', 'beefb', null, 7, '22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from app.usable_on_hand('11111111-1111-4111-8111-111111111111', '2026-11-02') u where u.ingredient_id = pg_temp.id('beefb')), 0,
  'tenant B''s movements are ignored for tenant A');
select is((select string_agg(trim_scale(u.on_hand_qty)::text, ',') from app.usable_on_hand('22222222-2222-4222-8222-222222222222', '2026-11-02') u), '7',
  'and tenant B has its own 7');

-- The supplier window uses the tenant's zone.
select is((select w.delivery_date::text || ' ' || app.iso_utc(w.order_by_at) from app.supplier_window('11111111-1111-4111-8111-111111111111',
  '5a000000-0000-4000-8000-00000000005a', '2026-11-02T14:00:00Z') w), '2026-11-05 2026-11-03T10:00:00Z', 'supplier_window: the AT3 window from the supplier row');
select is((select count(*)::int from app.supplier_window('11111111-1111-4111-8111-111111111111',
  '5a000000-0000-4000-8000-0000000000b5', '2026-11-02T14:00:00Z')), 0, 'supplier_window ignores another tenant''s supplier');
update public.supplier set delivery_weekdays = '{}' where id = '5a000000-0000-4000-8000-00000000005a';
select is((select count(*)::int from app.supplier_window('11111111-1111-4111-8111-111111111111',
  '5a000000-0000-4000-8000-00000000005a', '2026-11-02T14:00:00Z')), 0, 'and a supplier without weekdays has no window');

-- Effective recipe rules.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('b2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'batch', 2, 'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('b2000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'tagliata (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('b2000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'sub', 1, 'soffritto (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('b2000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'brodo (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch,
    shelf_life_hours, prep_time_min, min_portions, target_portions, created_by) values
  ('c2000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'b2000000-0000-4000-8000-000000000001', 1, '2026-10-01T00:00Z',
   'Spezzatino (demo)', 6, 'kg', 30, 72, 60, 3, 10, 'a1000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-000000000012', '11111111-1111-4111-8111-111111111111', 'b2000000-0000-4000-8000-000000000001', 2, '2026-10-10T00:00Z',
   'Spezzatino (demo)', 6, 'kg', 30, 72, 90, 4, 20, 'a1000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-000000000021', '11111111-1111-4111-8111-111111111111', 'b2000000-0000-4000-8000-000000000002', 1, '2026-10-01T00:00Z',
   'Tagliata (demo)', null, null, null, null, null, null, null, 'a1000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-000000000031', '11111111-1111-4111-8111-111111111111', 'b2000000-0000-4000-8000-000000000003', 1, '2026-10-01T00:00Z',
   'Soffritto (demo)', 1, 'kg', null, null, null, null, null, 'a1000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-000000000041', '11111111-1111-4111-8111-111111111111', 'b2000000-0000-4000-8000-000000000004', 1, '2026-10-01T00:00Z',
   'Brodo (demo)', 5, 'l', 20, 48, null, null, null, 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.rr(p_key text) returns text language sql as $$
  select coalesce((select concat_ws('|', r.version, r.recipe_id, r.portions_per_batch, coalesce(r.min_portions::text, '-') || ' ' || coalesce(r.min_source, '-'),
                    coalesce(r.target_portions::text, '-') || ' ' || coalesce(r.target_source, '-'),
                    coalesce(r.prep_time_min::text, '-') || ' ' || coalesce(r.prep_source, '-'))
                    from app.recipe_rules('11111111-1111-4111-8111-111111111111') r where r.recipe_key = p_key::uuid), 'none') $$;
select is(pg_temp.rr('b2000000-0000-4000-8000-000000000001'),
  '2|c2000000-0000-4000-8000-000000000012|30|4 version|20 version|90 version', 'no rule: the current version''s values, each with source version');
select is(pg_temp.rr('b2000000-0000-4000-8000-000000000004'), '1|c2000000-0000-4000-8000-000000000041|20|- -|- -|- -',
  'a batch with no values anywhere: null values and null sources');
update public.recipe_key set rule_min_portions = 5 where id = 'b2000000-0000-4000-8000-000000000001';
select is(pg_temp.rr('b2000000-0000-4000-8000-000000000001'),
  '2|c2000000-0000-4000-8000-000000000012|30|5 rule|20 version|90 version', 'a rule minimum 5 wins over the version''s 4 (source rule); the others stay');
update public.recipe_key set rule_min_portions = 0, rule_target_portions = 30, rule_prep_time_min = 180 where id = 'b2000000-0000-4000-8000-000000000001';
select is(pg_temp.rr('b2000000-0000-4000-8000-000000000001'),
  '2|c2000000-0000-4000-8000-000000000012|30|0 rule|30 rule|180 rule', 'a rule of 0 is a value, not "unset": 0 rule');
select is(pg_temp.rr('b2000000-0000-4000-8000-000000000002'), 'none', 'a plate key is not listed');
select is(pg_temp.rr('b2000000-0000-4000-8000-000000000003'), 'none', 'nor a sub key');
update public.recipe_key set is_active = false where id = 'b2000000-0000-4000-8000-000000000004';
select is(pg_temp.rr('b2000000-0000-4000-8000-000000000004'), 'none', 'nor an inactive key');
select is((select count(*)::int from app.recipe_rules('22222222-2222-4222-8222-222222222222')), 0, 'another tenant gets none of them');

-- Closed to every API role.
select is_empty(
  $$ select p.proname || ':' || r from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
      where p.pronamespace = 'app'::regnamespace
        and p.proname in ('iso_utc', 'next_delivery_window', 'usable_on_hand', 'weekday_consumption', 'forecast_qty',
                          'supplier_window', 'recipe_rules')
        and has_function_privilege(r, p.oid, 'execute') $$,
  'no API role can execute any helper of this migration');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
            and p.proname in ('iso_utc', 'next_delivery_window', 'usable_on_hand', 'weekday_consumption', 'forecast_qty',
                              'supplier_window', 'recipe_rules')), 7, 'the seven helpers exist, once each');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
            and p.proname in ('usable_on_hand', 'weekday_consumption', 'supplier_window', 'recipe_rules')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 4, 'the four readers are security definer with an empty search_path');

-- Volatility: a zone given as text is looked up in the zone database at run time, so next_delivery_window is stable, not
-- immutable; iso_utc uses the literal zone 'UTC' and stays immutable; forecast_qty has no zone.
select is((select string_agg(p.proname || ':' || p.provolatile::text, ',' order by p.proname) from pg_proc p
            where p.pronamespace = 'app'::regnamespace and p.proname in ('iso_utc', 'next_delivery_window', 'forecast_qty')),
          'forecast_qty:i,iso_utc:i,next_delivery_window:s', 'volatility: next_delivery_window is stable; iso_utc and forecast_qty immutable');

select * from finish();
rollback;
