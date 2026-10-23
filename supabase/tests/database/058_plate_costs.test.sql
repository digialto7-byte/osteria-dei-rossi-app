-- M8 step 4: fixed cost, plate outputs, plate_costs, fixed_cost_status and plate_margins_pct (M8 plan
-- §3.1.6-7, AT6, AT8, V6.2; founder decisions 2026-10-23: Q16 = V6 percentages for the chef, fixed costs
-- are the owner's alone). Fake data only. Beef averages 10 EUR/kg, flour 1.50, bread 0.30, salt unpriced.
-- Plate 4 "Spezzatino con polenta (demo)": food cost 2.0567, price 12.00 VAT included (VAT 10), target GP 70.
begin;
create extension if not exists pgtap with schema extensions;
select plan(74);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Supporto Demo');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo muscolo (demo)', 'kg'),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Farina di mais (demo)', 'kg'),
  ('1c000000-0000-4000-8000-00000000001c', '11111111-1111-4111-8111-111111111111', 'Pane (demo)', 'pz'),
  ('1d000000-0000-4000-8000-00000000001d', '11111111-1111-4111-8111-111111111111', 'Sale grosso (demo)', 'kg'),
  ('1e000000-0000-4000-8000-00000000001e', '22222222-2222-4222-8222-222222222222', 'Burro B (demo)', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  values ('00000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-0000000000f1.pdf',
          'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
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
create function pg_temp.buy(n int, p_ing uuid, p_price numeric, p_on date, p_unit text default 'kg')
  returns void language plpgsql as $$
declare
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
      line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000f1', n,
      'Acquisto demo', 1, p_price, p_price, '{}', '{}');
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price,
      base_unit, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_ing, '5a000000-0000-4000-8000-00000000005a', v_line,
      p_price, p_unit::public.base_unit, p_on, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
select pg_temp.buy(1, '1a000000-0000-4000-8000-00000000001a', 8, '2026-09-18');
select pg_temp.buy(2, '1a000000-0000-4000-8000-00000000001a', 9, '2026-09-19');
select pg_temp.buy(3, '1a000000-0000-4000-8000-00000000001a', 10, '2026-09-20');
select pg_temp.buy(4, '1a000000-0000-4000-8000-00000000001a', 11, '2026-10-01');
select pg_temp.buy(5, '1b000000-0000-4000-8000-00000000001b', 1.50, '2026-09-01');
select pg_temp.buy(6, '1c000000-0000-4000-8000-00000000001c', 0.30, '2026-09-01', 'pz');

-- Recipe fixtures. k(n) is the key, v(n, ver) the version row.
create function pg_temp.k(n int) returns uuid language sql immutable as $$
  select ('ec000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.v(n int, ver int) returns uuid language sql immutable as $$
  select ('ed000000-0000-4000-8000-' || lpad((n * 100 + ver)::text, 12, '0'))::uuid $$;
create function pg_temp.mkkey(n int, t public.recipe_type, p_name text) returns void language sql as $$
  insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
  values (pg_temp.k(n), '11111111-1111-4111-8111-111111111111', t, 1, lower(p_name),
          'a1000000-0000-4000-8000-00000000000a') $$;
create function pg_temp.mkver(n int, ver int, p_from timestamptz, p_name text, oq numeric default null,
    ou public.base_unit default null, ppb int default null) returns void language plpgsql as $$
begin
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
      portions_per_batch, shelf_life_hours, created_by)
    values (pg_temp.v(n, ver), '11111111-1111-4111-8111-111111111111', pg_temp.k(n), ver, p_from, p_name,
      oq, ou, ppb, case when ppb is not null then 72 end, 'a1000000-0000-4000-8000-00000000000a');
  update public.recipe_key set current_version = ver where id = pg_temp.k(n) and current_version < ver;
end
$$;
-- A line: an ingredient (p_ing) or a sub-recipe key (p_sub).
create function pg_temp.li(n int, ver int, pos int, p_ing uuid, p_sub int, p_qty numeric,
    p_unit public.recipe_unit, p_yield numeric default 1) returns void language sql as $$
  insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit,
      yield_factor, created_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.v(n, ver), pos, p_ing,
          case when p_sub is not null then pg_temp.k(p_sub) end, p_qty, p_unit, p_yield,
          'a1000000-0000-4000-8000-00000000000a') $$;
-- The engine's answer for one key: total unit_cost cost_unit incomplete reasons missing.
create function pg_temp.cost(n int, p_at timestamptz default null) returns text language sql as $$
  select coalesce(trim_scale(round(c.total_cost, 4))::text, '-') || ' ' || coalesce(trim_scale(round(c.unit_cost, 4))::text, '-')
      || ' ' || c.cost_unit || ' ' || c.incomplete || ' ' || c.reasons::text || ' ' || c.missing_ingredient_ids::text
    from app.recipe_costs('11111111-1111-4111-8111-111111111111', array[pg_temp.k(n)], p_at) c $$;
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text), pg_temp.k(int)
  to authenticated, anon;


create function pg_temp.salt() returns text language sql as $$ select '{1d000000-0000-4000-8000-00000000001d}' $$;
create function pg_temp.beef() returns uuid language sql as $$ select '1a000000-0000-4000-8000-00000000001a'::uuid $$;
create function pg_temp.flour() returns uuid language sql as $$ select '1b000000-0000-4000-8000-00000000001b'::uuid $$;
create function pg_temp.bread() returns uuid language sql as $$ select '1c000000-0000-4000-8000-00000000001c'::uuid $$;
create function pg_temp.saltid() returns uuid language sql as $$ select '1d000000-0000-4000-8000-00000000001d'::uuid $$;
create function pg_temp.price(n int, p_sale numeric, p_target numeric) returns void language sql as $$
  insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by)
  values (pg_temp.v(n, 1), '11111111-1111-4111-8111-111111111111', p_sale, p_target,
          'a1000000-0000-4000-8000-00000000000a') $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Europe/Rome')::date $$;
create function pg_temp.this_month() returns date language sql as $$ select date_trunc('month', pg_temp.today())::date $$;
grant execute on function pg_temp.today(), pg_temp.this_month() to authenticated;

select pg_temp.mkkey(2, 'batch', 'Spezzatino (demo)');
select pg_temp.mkver(2, 1, '2026-01-01T00:00Z', 'Spezzatino (demo)', 6, 'kg', 30);
select pg_temp.li(2, 1, 1, pg_temp.beef(), null, 5, 'kg');
select pg_temp.mkkey(3, 'sub', 'Polenta (demo)');
select pg_temp.mkver(3, 1, '2026-01-01T00:00Z', 'Polenta (demo)', 1, 'kg');
select pg_temp.li(3, 1, 1, pg_temp.flour(), null, 0.3, 'kg');
-- Plates 4 and 40 (target 85) use the stew, the polenta and bread: food cost 2.0567.
select pg_temp.mkkey(4, 'plate', 'Spezzatino con polenta (demo)');
select pg_temp.mkver(4, 1, '2026-01-01T00:00Z', 'Spezzatino con polenta (demo)');
select pg_temp.li(4, 1, 1, null, 2, 1, 'porz');
select pg_temp.li(4, 1, 2, null, 3, 0.2, 'kg');
select pg_temp.li(4, 1, 3, pg_temp.bread(), null, 1, 'pz');
select pg_temp.price(4, 12.00, 70);
select pg_temp.mkkey(40, 'plate', 'Spezzatino al vino (demo)');
select pg_temp.mkver(40, 1, '2026-01-01T00:00Z', 'Spezzatino al vino (demo)');
select pg_temp.li(40, 1, 1, null, 2, 1, 'porz');
select pg_temp.li(40, 1, 2, null, 3, 0.2, 'kg');
select pg_temp.li(40, 1, 3, pg_temp.bread(), null, 1, 'pz');
select pg_temp.price(40, 12.00, 85);
-- 5: salt, unpriced. 41: no price row. 42: price 0. 43: GP exactly on target (11.00 / 1.1 = 10; food 3; GP 70).
select pg_temp.mkkey(5, 'plate', 'Polenta e sale (demo)');
select pg_temp.mkver(5, 1, '2026-01-01T00:00Z', 'Polenta e sale (demo)');
select pg_temp.li(5, 1, 1, null, 3, 0.3, 'kg');
select pg_temp.li(5, 1, 2, pg_temp.saltid(), null, 0.01, 'kg');
select pg_temp.price(5, 9.00, 70);
select pg_temp.mkkey(41, 'plate', 'Senza prezzo (demo)');
select pg_temp.mkver(41, 1, '2026-01-01T00:00Z', 'Senza prezzo (demo)');
select pg_temp.li(41, 1, 1, pg_temp.flour(), null, 1, 'kg');
select pg_temp.mkkey(42, 'plate', 'Prezzo zero (demo)');
select pg_temp.mkver(42, 1, '2026-01-01T00:00Z', 'Prezzo zero (demo)');
select pg_temp.li(42, 1, 1, pg_temp.flour(), null, 1, 'kg');
select pg_temp.price(42, 0, 70);
select pg_temp.mkkey(43, 'plate', 'Sul bersaglio (demo)');
select pg_temp.mkver(43, 1, '2026-01-01T00:00Z', 'Sul bersaglio (demo)');
select pg_temp.li(43, 1, 1, pg_temp.flour(), null, 2, 'kg');
select pg_temp.price(43, 11.00, 70);
-- An inactive plate is left out of the lists.
select pg_temp.mkkey(44, 'plate', 'Piatto spento (demo)');
select pg_temp.mkver(44, 1, '2026-01-01T00:00Z', 'Piatto spento (demo)');
select pg_temp.li(44, 1, 1, pg_temp.flour(), null, 1, 'kg');
select pg_temp.price(44, 10, 70);
update public.recipe_key set is_active = false where id = pg_temp.k(44);

-- One plate row of the owner's function as text: food fixed full ex gross net fc% gp% target allocated status.
create function pg_temp.plate(n int) returns text language sql as $$
  select concat_ws(' ', coalesce(c.food_cost_eur::text, '-'), coalesce(c.fixed_cost_eur::text, '-'),
      coalesce(c.full_cost_eur::text, '-'), coalesce(c.sale_price_ex_vat_eur::text, '-'),
      coalesce(c.gross_margin_eur::text, '-'), coalesce(c.net_margin_eur::text, '-'),
      coalesce(c.food_cost_pct::text, '-'), coalesce(c.gp_pct::text, '-'), coalesce(c.target_gp_pct::text, '-'),
      coalesce(c.fixed_cost_allocated::text, '-'), c.status)
    from public.plate_costs() c where c.recipe_key = pg_temp.k(n) $$;
create function pg_temp.margin(n int) returns text language sql as $$
  select concat_ws(' ', coalesce(m.food_cost_pct::text, '-'), coalesce(m.gp_pct::text, '-'), m.status)
    from public.plate_margins_pct() m where m.recipe_key = pg_temp.k(n) $$;
grant execute on function pg_temp.plate(int), pg_temp.margin(int) to authenticated;

-- 1. Outputs, no fixed costs entered yet.
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select count(*)::int from public.plate_costs()), 6, 'the owner''s list holds the 6 active plates (the inactive one is left out)');
select is(pg_temp.plate(4), '2.0567 - - 10.9091 8.8524 - 18.8528 81.1472 70.00 false fixed_cost_unallocated',
  'the stew plate: food 2.0567, ex VAT 10.9091, gross margin 8.8524, food cost 18.8528 %, GP 81.1472 %, no fixed cost yet');
select is((select c.sale_price_eur::text || ' ' || c.vat_pct::text from public.plate_costs() c where c.recipe_key = pg_temp.k(4)),
  '12.00 10', 'with the VAT-included price and the VAT rate used (default 10)');
select is(pg_temp.err('select * from public.fixed_cost_status()'), 'ok', 'the owner reads the fixed cost status');
select is(public.fixed_cost_status() ->> 'reason', 'no_fixed_costs', 'without any fixed cost month: no_fixed_costs');
select is(public.fixed_cost_status() -> 'perPlateEur', 'null'::jsonb, 'and no per-plate figure');
-- Incomplete plates.
select is(pg_temp.plate(5), '- - - 8.1818 - - - - 70.00 false incomplete', 'salt plate: food cost unknown (never 0), so no margin and no percentage: incomplete');
select is((select c.reasons::text || ' ' || c.missing_ingredient_ids::text from public.plate_costs() c where c.recipe_key = pg_temp.k(5)),
  '{missing_price} ' || pg_temp.salt(), 'with the reason and the missing ingredient');
select is(pg_temp.plate(41), '1.5000 - - - - - - - - false incomplete', 'no sale price: food cost known, nothing else; incomplete');
select is((select c.reasons::text from public.plate_costs() c where c.recipe_key = pg_temp.k(41)), '{no_sale_price}', 'reason no_sale_price');
select is(pg_temp.plate(42), '1.5000 - - - - - - - 70.00 false incomplete', 'a price of 0 is incomplete as well (no division by zero)');
select is((select c.reasons::text from public.plate_costs() c where c.recipe_key = pg_temp.k(42)), '{no_sale_price}', 'also no_sale_price');
-- AT8: below target, even while fixed costs are unallocated; GP equal to the target is not below.
select is(pg_temp.plate(40), '2.0567 - - 10.9091 8.8524 - 18.8528 81.1472 85.00 false below_target',
  'AT8: target 85 -> below_target, which outranks fixed_cost_unallocated');
select is(pg_temp.plate(43), '3.0000 - - 10.0000 7.0000 - 30.0000 70.0000 70.00 false fixed_cost_unallocated',
  'GP equal to the target is not below it');

-- 2. Fixed costs: the real plates_sold returns 0 (until M19/M21), so nothing is allocated.
reset role;
insert into public.fixed_cost_period (tenant_id, month, rent, labour, utilities, created_by) values
  ('11111111-1111-4111-8111-111111111111', pg_temp.this_month(), 3000, 9000, 1500, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', (pg_temp.this_month() - interval '3 months')::date, 2000, 3000, 1000,
   'a1000000-0000-4000-8000-00000000000a');
select is(app.plates_sold('11111111-1111-4111-8111-111111111111', '2000-01-01', '2100-01-01'), 0::numeric,
  'the real app.plates_sold returns 0 for any window');
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(public.fixed_cost_status() ->> 'reason', 'no_sales', 'AT6: fixed costs entered, no sales: no_sales');
select is(public.fixed_cost_status() ->> 'monthlyTotalEur', '13500.00', 'the month''s total is shown');
select is(public.fixed_cost_status() ->> 'platesSold', '0', 'with 0 plates sold');
select is(public.fixed_cost_status() ->> 'periodMonth', pg_temp.this_month()::text, 'and the month in force');
select is(pg_temp.plate(4), '2.0567 - - 10.9091 8.8524 - 18.8528 81.1472 70.00 false fixed_cost_unallocated',
  'AT6: fixed cost, full cost and net margin are null, status fixed_cost_unallocated, food cost % still 18.8528');

-- 3. With sales (the stub replaces app.plates_sold and records its arguments).
reset role;
create temporary table plates_args (n serial, p_from date, p_to date);
create or replace function app.plates_sold(p_tenant uuid, p_from date, p_to date) returns numeric
  language plpgsql set search_path = ''
as $$
begin
  insert into pg_temp.plates_args (p_from, p_to) values (p_from, p_to);
  return 1500;
end
$$;
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.plate(4), '2.0567 9.0000 11.0567 10.9091 8.8524 -0.1476 18.8528 81.1472 70.00 true ok',
  'with 1 500 plates sold: 13 500 / 1 500 = 9.00 fixed, full cost 11.0567, net margin -0.1476, status ok');
select is(public.fixed_cost_status() ->> 'perPlateEur', '9.0000', 'fixed_cost_status says 9.0000 per plate');
select is(public.fixed_cost_status() -> 'reason', 'null'::jsonb, 'with no reason');
reset role;
select is((select p_from::text || ' ' || p_to::text from plates_args order by n desc limit 1),
  (pg_temp.today() - 30)::text || ' ' || (pg_temp.today() - 1)::text, 'the stub received the window D-30 to D-1');
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.plate(40), '2.0567 9.0000 11.0567 10.9091 8.8524 -0.1476 18.8528 81.1472 85.00 true below_target', 'below_target with an allocated fixed cost');
select public.enter_fixed_costs(pg_temp.this_month(), 3000, 9500, 1500);
select is(pg_temp.plate(4), '2.0567 9.3333 11.3900 10.9091 8.8524 -0.4809 18.8528 81.1472 70.00 true ok',
  'a correction (14 000) for the same month wins over the first entry: 14 000 / 1 500 = 9.3333');
-- Carry forward: a date in the previous month has no row of its own; the row of three months back is in force.
select is((select public.fixed_cost_status((pg_temp.this_month() - interval '1 month')::date + 5) ->> 'periodMonth'),
  (pg_temp.this_month() - interval '3 months')::date::text, 'a month without an entry uses the last month entered');
select is((select public.fixed_cost_status((pg_temp.this_month() - interval '1 month')::date + 5) ->> 'perPlateEur'),
  '4.0000', 'and divides its total (6 000) by the plates sold: 4.0000');
select is(pg_temp.err('select public.fixed_cost_status(current_date + 2)'), 'P0001 date_in_future', 'a future date is refused');
select is((select count(*)::int from public.plate_costs((pg_temp.this_month() - interval '1 month')::date + 5)), 6,
  'plate_costs for a past date lists the plates');
-- VAT setting.
reset role;
update public.tenant set settings = '{"sale_vat_pct":22}' where id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select c.sale_price_ex_vat_eur::text || ' ' || c.vat_pct::text from public.plate_costs() c where c.recipe_key = pg_temp.k(4)),
  '9.8361 22', 'sale_vat_pct 22: 12.00 / 1.22 = 9.8361');
reset role;
update public.tenant set settings = '{}' where id = '11111111-1111-4111-8111-111111111111';

-- 4. The admin: food cost, margins and percentages, but no fixed cost figure and no fixed-cost status.
set local role authenticated;
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.plate(4), '2.0567 - - 10.9091 8.8524 - 18.8528 81.1472 70.00 - ok',
  'the admin sees food cost, gross margin and percentages; fixed cost, full cost, net margin and allocation are null; status ok');
select is(pg_temp.plate(43), '3.0000 - - 10.0000 7.0000 - 30.0000 70.0000 70.00 - ok',
  'the admin''s status never is fixed_cost_unallocated (plate 43 would be for the owner without sales)');
select is(pg_temp.plate(40), '2.0567 - - 10.9091 8.8524 - 18.8528 81.1472 85.00 - below_target', 'below_target for the admin');
select is(pg_temp.plate(5), '- - - 8.1818 - - - - 70.00 - incomplete', 'incomplete for the admin');
select is((select count(*)::int from public.plate_costs() c where c.status = 'fixed_cost_unallocated'), 0,
  'the admin''s list has no fixed_cost_unallocated');
select is(left(pg_temp.err('select * from public.fixed_cost_status()'), 5), '42501', 'the admin cannot read fixed_cost_status');
select is((select count(*)::int from public.fixed_cost_period), 0, 'nor fixed_cost_period');
select is(public.recipe_cost_at(pg_temp.k(4)) -> 'plate' ->> 'fixedCostEur', null, 'recipe_cost_at for the admin: no fixed cost in the plate object');
select is(public.recipe_cost_at(pg_temp.k(4)) -> 'plate' ->> 'fixedCostAllocated', null, 'nor the allocation');
select is(public.recipe_cost_at(pg_temp.k(4)) -> 'plate' ->> 'status', 'ok', 'and a status without the fixed-cost state');
select is(public.recipe_cost_at(pg_temp.k(4)) -> 'plate' ->> 'grossMarginEur', '8.8524', 'but the gross margin');

-- 5. The owner's recipe_cost_at carries the plate outputs.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(public.recipe_cost_at(pg_temp.k(4)) -> 'plate' ->> 'fixedCostEur', '9.3333', 'recipe_cost_at: the plate has a fixed cost for the owner');
select is(public.recipe_cost_at(pg_temp.k(4)) -> 'plate' ->> 'netMarginEur', '-0.4809', 'a net margin');
select is(public.recipe_cost_at(pg_temp.k(4)) -> 'plate' ->> 'fixedCostAllocated', 'true', 'and the allocation flag');
select is(public.recipe_cost_at(pg_temp.k(4)) -> 'plate' ->> 'foodCostPct', '18.8528', 'food cost %');
select is(public.recipe_cost_at(pg_temp.k(4)) -> 'plate' ->> 'targetGpPct', '70.00', 'target GP %');
select is(public.recipe_cost_at(pg_temp.k(2)) -> 'plate', 'null'::jsonb, 'a batch has no plate object');
select is(public.recipe_cost_at(pg_temp.k(5)) -> 'plate' ->> 'status', 'incomplete', 'the incomplete plate says so');

-- 6. The chef: percentages only (V6.2).
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.margin(4), '18.8528 81.1472 ok', 'V6.2: the chef gets food cost % 18.8528, GP 81.1472, ok');
select is(pg_temp.margin(40), '18.8528 81.1472 below_target', 'the 85 % plate is below_target');
select is(pg_temp.margin(5), '- - incomplete', 'the salt plate has nulls and is incomplete');
select is(pg_temp.margin(43), '30.0000 70.0000 ok', 'status is never fixed_cost_unallocated for the chef');
select is((select count(*)::int from public.plate_margins_pct()), 6, 'all 6 active plates are listed');
select is((select count(*)::int from public.plate_margins_pct() m where m.status not in ('ok', 'below_target', 'incomplete')), 0,
  'only the three status words');
select is(left(pg_temp.err('select * from public.plate_costs()'), 5), '42501', 'the chef cannot read plate_costs');
select is(left(pg_temp.err('select * from public.fixed_cost_status()'), 5), '42501', 'nor fixed_cost_status');
select is(left(pg_temp.err(format('select public.recipe_cost_at(%L)', pg_temp.k(4))), 5), '42501', 'nor recipe_cost_at');
select is((select count(*)::int from public.fixed_cost_period), 0, 'nor fixed_cost_period');
-- The chef still reads the price and the target through M7's recipe_price.
select is((select r.sale_price::text || ' ' || r.target_gp_pct::text from public.recipe_price r where r.recipe_id = pg_temp.v(4, 1)),
  '12.00 70.00', 'the chef reads sale_price and target_gp_pct from recipe_price');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err('select * from public.plate_margins_pct()'), 5), '42501', 'the waiter cannot read plate_margins_pct');
select is(left(pg_temp.err('select * from public.plate_costs()'), 5), '42501', 'nor plate_costs');
select is(left(pg_temp.err('select * from public.fixed_cost_status()'), 5), '42501', 'nor fixed_cost_status');
select set_config('request.jwt.claims', '', true);
select is(left(pg_temp.err('select * from public.plate_margins_pct()'), 5), '42501', 'no claims: refused');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select count(*)::int from public.plate_costs()), 0, 'owner B sees no plate of tenant A');
select is((select count(*)::int from public.plate_margins_pct()), 0, 'and no margin');
select is(public.fixed_cost_status() ->> 'reason', 'no_fixed_costs', 'and no fixed cost of tenant A');
reset role;
set local role anon;
select is(left(pg_temp.err('select * from public.plate_margins_pct()'), 5), '42501', 'anon: plate_margins_pct refused');
select is(left(pg_temp.err('select * from public.plate_costs()'), 5), '42501', 'anon: plate_costs refused');
reset role;

-- Shape and privileges.
select is(pg_get_function_result('public.plate_margins_pct()'::regprocedure),
  'TABLE(recipe_key uuid, food_cost_pct numeric, gp_pct numeric, status text)',
  'V6.2: plate_margins_pct returns exactly the key, food cost %, GP % and a status word');
select is_empty($$ select a from unnest((select proargnames from pg_proc where oid = 'public.plate_margins_pct()'::regprocedure)) a
                   where a ~ '(eur|cost$|margin$|price)' $$, 'none of its columns is a euro field');
select is_empty(
  $$ select f.fn || ' ' || r.rolname from (values
       ('app.plates_sold(uuid, date, date)'), ('app.fixed_cost_at(uuid, date)'),
       ('app.plate_cost_rows(uuid, uuid[], date, boolean)')) f (fn)
      cross join (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
      where has_function_privilege(r.rolname, f.fn, 'execute') $$,
  'no API role can execute the plate engine, app.plates_sold or app.fixed_cost_at');
select is_empty(
  $$ select f.fn || ' ' || r.rolname from (values ('public.plate_costs(date)'), ('public.fixed_cost_status(date)'),
       ('public.plate_margins_pct()')) f (fn)
      cross join (values ('anon'), ('service_role')) r (rolname)
      where has_function_privilege(r.rolname, f.fn, 'execute') $$,
  'anon and service_role cannot execute the public functions');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and p.provolatile = 's')
             from pg_proc p where p.oid in ('public.plate_costs(date)'::regprocedure,
               'public.fixed_cost_status(date)'::regprocedure, 'public.plate_margins_pct()'::regprocedure)),
  'they are stable, security definer, with an empty search_path');

select * from finish();
rollback;
