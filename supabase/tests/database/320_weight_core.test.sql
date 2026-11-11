-- P2-0b A1 (sell by weight, plan §3.2, §5 A1): the weight columns, the one rounding function, the portion fraction, the constants,
-- the tenant's maximum-weight setting column, the line-price trigger (L-4) and the replaced order_line guard.
-- Fake data only. The rows are inserted by the migration owner; the procedures that write them come in A3.
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

-- Before any fixture: the back-fill. Nothing in the migrated database carries a weight.
select is((select count(*)::int from public.order_line where weight_g is not null or price_per_100g is not null or portion_weight_g is not null),
  0, 'back-fill: no order_line row carries a weight column');

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tagliatelle (demo)', 'Primi', 'primi',
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item (id, tenant_id, name, category, course_default, portion_weight_g, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Bistecca a peso (demo)', 'Secondi', 'secondi', 400,
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (id, tenant_id, menu_item_id, price, vat_rate, valid_from, created_by) values
  ('12000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 14, 10, '1998-01-01', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (id, tenant_id, menu_item_id, price, price_unit, vat_rate, valid_from, created_by) values
  ('12000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000002', 5.5, 'etto', 10, '1998-01-01', 'a1000000-0000-4000-8000-00000000000a');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1,
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001',
   'Tavolo 1 (demo)', 4, 'a1000000-0000-4000-8000-00000000000a', '1998-10-24',
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');

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
-- One line on the open session. Item 1 is the portion dish, item 2 the weighted one.
create function pg_temp.ins(p_id text, p_item int, p_qty text, p_unit_price text, p_weight text default 'null', p_per100 text default 'null',
                            p_portion text default 'null') returns text language plpgsql as $$
begin
  return pg_temp.err(format($f$
    insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at,
                                   weight_g, price_per_100g, portion_weight_g, created_by, updated_by)
    values (%L, '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001', %L, 'secondi', %s, %s, 10, 'menu',
            '1998-10-24 12:00+00', %s, %s, %s, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d')$f$,
    p_id, '11000000-0000-4000-8000-00000000000' || p_item, p_qty, p_unit_price, p_weight, p_per100, p_portion));
end
$$;

-- Back-fill (continued): prices read 'portion', the setting column is null.
select is((select price_unit from public.menu_item_price where id = '12000000-0000-4000-8000-000000000001'), 'portion', 'a price row without a unit reads portion');
insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
  values ('11111111-1111-4111-8111-111111111111', 2, 10, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
select is((select weight_max_g from public.sale_settings where tenant_id = '11111111-1111-4111-8111-111111111111'), null, 'a sale_settings row has weight_max_g null');

-- Rounding vectors (D-4): half-up to the cent, the one place.
select is(app.weight_line_price(5.50, 1200), 66.00, '5,50 x 1200 g = 66,00');
select is(app.weight_line_price(9.00, 1200), 108.00, '9,00 x 1200 g = 108,00');
select is(app.weight_line_price(4.25, 1230), 52.28, '4,25 x 1230 g = 52,275 rounds up to 52,28');
select is(app.weight_line_price(3.35, 250), 8.38, '3,35 x 250 g = 8,375 rounds up to 8,38');
select is(app.weight_line_price(2.99, 50), 1.50, '2,99 x 50 g = 1,495 rounds up to 1,50');
select is(app.weight_line_price(7.77, 3000), 233.10, '7,77 x 3000 g = 233,10');
select is(app.weight_line_price(0, 500), 0.00, '0 x 500 g = 0,00');
select is((select provolatile::text from pg_proc where oid = 'app.weight_line_price(numeric,integer)'::regprocedure), 'i', 'weight_line_price is immutable');

-- Portion fraction (D-7).
select is(app.order_line_portions(2, null, null), 2::numeric, 'a portion line: the portions are its qty');
select is(app.order_line_portions(1, 1200, 400), 3::numeric, '1200 g on a 400 g reference = 3 portions');
select is(app.order_line_portions(1, 1000, 300), 1000::numeric / 300, '1000 g on 300 g = 3.3333... (unrounded)');
select ok(app.order_line_portions(1, 1000, 300) > 3.33333333, 'and the fraction keeps its digits');

-- Constants (P-4).
select is(app.weight_min_g(), 50, 'the minimum weight is 50 g');
select is(app.weight_step_g(), 10, 'the step is 10 g');
select is(app.default_weight_max_g(), 3000, 'the default maximum is 3000 g');
select is((select b::text from app.weight_max_setting_bounds() b), '(500,10000)', 'the setting bounds are (500, 10000)');

-- app.weight_max_g (P-4): default, a row with a null coperto, tenant isolation.
select is(app.weight_max_g('22222222-2222-4222-8222-222222222222'), 3000, 'no sale_settings row: the default 3000');
select is(app.weight_max_g('11111111-1111-4111-8111-111111111111'), 3000, 'a row with a null weight_max_g: the default');
update public.sale_settings set weight_max_g = 4000 where tenant_id = '11111111-1111-4111-8111-111111111111';
select is(app.weight_max_g('11111111-1111-4111-8111-111111111111'), 4000, 'a row with weight_max_g 4000: 4000');
select is(app.weight_max_g('22222222-2222-4222-8222-222222222222'), 3000, 'tenant B is unaffected');
-- A row with a weight and no coperto does not create a coperto.
insert into public.sale_settings (tenant_id, weight_max_g, created_by, updated_by)
  values ('22222222-2222-4222-8222-222222222222', 5000, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
select is((select count(*)::int from app.coperto_settings('22222222-2222-4222-8222-222222222222')), 0, 'a row with a null coperto and a weight: coperto_settings gives no row');
select is(app.weight_max_g('22222222-2222-4222-8222-222222222222'), 5000, 'and weight_max_g reads that tenant''s 5000');

-- sale_settings CHECK.
select is(left(pg_temp.err($$ update public.sale_settings set weight_max_g = 490 where tenant_id = '11111111-1111-4111-8111-111111111111' $$), 5), '23514', 'weight_max_g 490 is refused');
select is(left(pg_temp.err($$ update public.sale_settings set weight_max_g = 10010 where tenant_id = '11111111-1111-4111-8111-111111111111' $$), 5), '23514', 'weight_max_g 10 010 is refused');
select is(left(pg_temp.err($$ update public.sale_settings set weight_max_g = 1005 where tenant_id = '11111111-1111-4111-8111-111111111111' $$), 5), '23514', 'weight_max_g 1 005 is refused (not a multiple of 10)');

-- menu_item and menu_item_price checks.
select is(left(pg_temp.err($$ update public.menu_item set portion_weight_g = 9 where id = '11000000-0000-4000-8000-000000000001' $$), 5), '23514', 'portion_weight_g 9 is refused');
select is(left(pg_temp.err($$ update public.menu_item set portion_weight_g = 3001 where id = '11000000-0000-4000-8000-000000000001' $$), 5), '23514', 'portion_weight_g 3 001 is refused');
select is(left(pg_temp.err($$ insert into public.menu_item_price (tenant_id, menu_item_id, price, price_unit, vat_rate, created_by)
  values ('11111111-1111-4111-8111-111111111111', '11000000-0000-4000-8000-000000000001', 1, 'kg', 10, 'a1000000-0000-4000-8000-00000000000a') $$), 5), '23514', 'a price unit other than portion or etto is refused');
select is(left(pg_temp.err($$ update public.menu_item_price set price = 6 where id = '12000000-0000-4000-8000-000000000002' $$), 17), 'P0001 append_only', 'menu_item_price update still raises (append-only)');
select is(left(pg_temp.err($$ delete from public.menu_item_price where id = '12000000-0000-4000-8000-000000000002' $$), 17), 'P0001 append_only', 'menu_item_price delete still raises (append-only)');

-- order_line checks.
select is(pg_temp.ins('e1000000-0000-4000-8000-000000000001', 2, '2', '66.00', '1200', '5.50', '400'),
  '23514 new row for relation "order_line" violates check constraint "order_line_weight_ck"', 'a weighted row with qty 2 is refused (order_line_weight_ck)');
select is(pg_temp.ins('e1000000-0000-4000-8000-000000000002', 2, '1', '66.00', '1200', 'null', '400'),
  '23514 new row for relation "order_line" violates check constraint "order_line_weight_set_ck"', 'two of the three weight columns (no price_per_100g) is refused (order_line_weight_set_ck)');
select is(pg_temp.ins('e1000000-0000-4000-8000-000000000003', 2, '1', '66.00', 'null', '5.50', '400'),
  '23514 new row for relation "order_line" violates check constraint "order_line_weight_set_ck"', 'two of the three weight columns (no weight_g) is refused (order_line_weight_set_ck)');

-- Price trigger (L-4).
select is(pg_temp.ins('e1000000-0000-4000-8000-000000000004', 2, '1', '66.01', '1200', '5.50', '400'), 'P0001 order_line_price_mismatch', 'a line price that is not the formula is refused on insert');
select is(pg_temp.ins('e1000000-0000-4000-8000-000000000005', 2, '1', '66.00', '1200', '5.50', '400'), 'ok', 'the matching line price is accepted');
select is(pg_temp.ins('e1000000-0000-4000-8000-000000000006', 1, '1', '14.00'), 'ok', 'a portion line is untouched by the trigger');
-- Guard on the draft weighted line.
select is(pg_temp.err($$ update public.order_line set weight_g = 1300, unit_price = 71.50 where id = 'e1000000-0000-4000-8000-000000000005' $$), 'ok',
  'a draft weighted line may change weight_g and unit_price together');
select is((select weight_g || '/' || unit_price from public.order_line where id = 'e1000000-0000-4000-8000-000000000005'), '1300/71.50', 'and both are stored');
select is(pg_temp.err($$ update public.order_line set weight_g = 1400 where id = 'e1000000-0000-4000-8000-000000000005' $$), 'P0001 order_line_price_mismatch', 'a weight change without the matching price is refused');
select is(pg_temp.err($$ update public.order_line set unit_price = 70 where id = 'e1000000-0000-4000-8000-000000000005' $$), 'P0001 order_line_immutable', 'unit_price alone is immutable');
select is(pg_temp.err($$ update public.order_line set price_per_100g = 6 where id = 'e1000000-0000-4000-8000-000000000005' $$), 'P0001 order_line_immutable', 'price_per_100g is immutable');
select is(pg_temp.err($$ update public.order_line set portion_weight_g = 500 where id = 'e1000000-0000-4000-8000-000000000005' $$), 'P0001 order_line_immutable', 'portion_weight_g is immutable');
select is(pg_temp.err($$ update public.order_line set note = 'ben cotta' where id = 'e1000000-0000-4000-8000-000000000005' $$), 'ok', 'a note edit on a weighted draft is fine (no price check)');
-- Portion line: unit_price still immutable (M18).
select is(pg_temp.err($$ update public.order_line set unit_price = 15 where id = 'e1000000-0000-4000-8000-000000000006' $$), 'P0001 order_line_immutable', 'a portion line''s unit_price is immutable (M18)');
select is(pg_temp.err($$ update public.order_line set weight_g = 500, unit_price = 5.00 where id = 'e1000000-0000-4000-8000-000000000006' $$), 'P0001 order_line_immutable', 'a portion line cannot gain a weight');
-- Fired weighted line.
update public.order_line set fired_at = now(), fired_by = 'd1000000-0000-4000-8000-00000000000d' where id = 'e1000000-0000-4000-8000-000000000005';
select is(pg_temp.err($$ update public.order_line set weight_g = 1200 where id = 'e1000000-0000-4000-8000-000000000005' $$), 'P0001 order_line_fired', 'on a fired weighted line any weight change is refused');
select is(pg_temp.err($$ update public.order_line set voided_at = now(), voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'customer_left'
  where id = 'e1000000-0000-4000-8000-000000000005' $$), 'ok', 'voiding a fired weighted line does not fire the price check');
select is((select state from public.order_line where id = 'e1000000-0000-4000-8000-000000000005'), 'voided', 'and the line is voided');

-- A weight set, 3 columns: bounds backstop.
select is(left(pg_temp.ins('e1000000-0000-4000-8000-000000000007', 2, '1', '0.00', '0', '0', '400'), 5), '23514', 'weight_g 0 is refused');
select is(left(pg_temp.ins('e1000000-0000-4000-8000-000000000008', 2, '1', '0.00', '20001', '0', '400'), 5), '23514', 'weight_g above the 20 000 backstop is refused');

select * from finish();
rollback;
