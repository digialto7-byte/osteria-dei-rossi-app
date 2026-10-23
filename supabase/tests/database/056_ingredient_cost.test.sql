-- M8 step 2: the ingredient cost basis engine and public.ingredient_costs (M8 plan §3.1.1-3,
-- AT3 at database level). Fake data only; prices are invented (plan §3.10).
-- Beef ("Manzo muscolo (demo)"): 8, 9, 10, 11 EUR/kg on 2026-09-01, 09-10, 09-20, 10-01.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

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
  ('1f000000-0000-4000-8000-00000000001f', '11111111-1111-4111-8111-111111111111', 'Olio (demo)', 'l'),
  ('1e000000-0000-4000-8000-00000000001e', '22222222-2222-4222-8222-222222222222', 'Burro B (demo)', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number, payment_terms_days) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903', 30);
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count,
    pack_qty, pack_unit, invoice_unit) values
  ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1b000000-0000-4000-8000-00000000001b', 'FAR-1', 1, 1, 'kg', 'kg');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella');

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
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text) to authenticated, anon;

-- A purchase: one invoice line and its price row (rows are inserted in call order, so seq follows).
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  values ('00000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-0000000000f1.pdf',
          'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a');
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
select pg_temp.buy(1, '1a000000-0000-4000-8000-00000000001a', 8, '2026-09-01');
select pg_temp.buy(2, '1a000000-0000-4000-8000-00000000001a', 9, '2026-09-10');
select pg_temp.buy(3, '1a000000-0000-4000-8000-00000000001a', 10, '2026-09-20');
select pg_temp.buy(4, '1a000000-0000-4000-8000-00000000001a', 11, '2026-10-01');
-- Two purchases on one day: the later row (seq) is "last".
select pg_temp.buy(5, '1c000000-0000-4000-8000-00000000001c', 0.30, '2026-10-02', 'pz');
select pg_temp.buy(6, '1c000000-0000-4000-8000-00000000001c', 0.40, '2026-10-02', 'pz');
-- 1, 1, 2: the average has a repeating decimal.
select pg_temp.buy(7, '1f000000-0000-4000-8000-00000000001f', 1, '2026-09-01', 'l');
select pg_temp.buy(8, '1f000000-0000-4000-8000-00000000001f', 1, '2026-09-02', 'l');
select pg_temp.buy(9, '1f000000-0000-4000-8000-00000000001f', 2, '2026-09-03', 'l');

-- One row of the engine, as text: basis unit_cost avg last max used last_on ('-' for null).
create function pg_temp.row_of(p_ing uuid, p_at timestamptz default null) returns text language sql as $$
  select c.basis || ' ' || coalesce(trim_scale(round(c.unit_cost, 6))::text, '-') || ' '
      || coalesce(trim_scale(round(c.avg_cost, 6))::text, '-') || ' '
      || coalesce(trim_scale(c.last_cost)::text, '-') || ' ' || coalesce(trim_scale(c.max_cost)::text, '-')
      || ' ' || c.purchases_used || ' ' || coalesce(c.last_purchase_on::text, '-')
    from app.ingredient_unit_costs('11111111-1111-4111-8111-111111111111', array[p_ing], p_at) c $$;
-- Same, from the public function (rounded to 4 decimals).
create function pg_temp.pub(p_ing uuid, p_date date default null) returns text language sql as $$
  select c.basis || ' ' || coalesce(trim_scale(c.unit_cost_eur)::text, '-') || ' '
      || coalesce(trim_scale(c.avg_eur)::text, '-') || ' ' || coalesce(trim_scale(c.last_eur)::text, '-') || ' '
      || coalesce(trim_scale(c.max_eur)::text, '-') || ' ' || c.purchases_used
      || ' ' || coalesce(c.last_purchase_on::text, '-')
    from public.ingredient_costs(p_date) c where c.ingredient_id = p_ing $$;
grant execute on function pg_temp.pub(uuid, date) to authenticated;

-- 1. The engine (AT3): the average of the last three, last, max, count.
select is(pg_temp.row_of('1a000000-0000-4000-8000-00000000001a'),
  'moving_average 10 10 11 11 3 2026-10-01',
  'beef: average of the last 3 purchases (9, 10, 11) is 10; last 11; max 11; 3 used');
select is((select base_unit::text from app.ingredient_unit_costs('11111111-1111-4111-8111-111111111111',
  array['1a000000-0000-4000-8000-00000000001a'::uuid], null)), 'kg', 'it names the base unit');
update public.tenant set settings = '{"avg_cost_n":2}' where id = '11111111-1111-4111-8111-111111111111';
select is(pg_temp.row_of('1a000000-0000-4000-8000-00000000001a'),
  'moving_average 10.5 10.5 11 11 2 2026-10-01',
  'N = 2 from the tenant setting: average of 10 and 11 is 10.5; max still over all purchases');
update public.tenant set settings = '{"avg_cost_n":10}' where id = '11111111-1111-4111-8111-111111111111';
select is(pg_temp.row_of('1a000000-0000-4000-8000-00000000001a'),
  'moving_average 9.5 9.5 11 11 4 2026-10-01',
  'N = 10 with 4 purchases uses all 4 (fewer than N exist)');
update public.tenant set settings = '{}' where id = '11111111-1111-4111-8111-111111111111';

-- 2. The basis setting: last_price changes unit_cost only.
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select public.set_ingredient_cost_basis('1a000000-0000-4000-8000-00000000001a', 'last_price');
reset role;
select is(pg_temp.row_of('1a000000-0000-4000-8000-00000000001a'),
  'last_price 11 10 11 11 3 2026-10-01',
  'last_price: unit_cost 11 while the average stays 10');
-- In force: the instant is the end of 2026-09-20 (Rome). The basis row dated now does not apply, and
-- the purchases of 2026-10-01 are not yet in force.
select is(pg_temp.row_of('1a000000-0000-4000-8000-00000000001a', app.venue_day_end('2026-09-20', 'Europe/Rome')),
  'moving_average 9 9 10 10 3 2026-09-20',
  'as of 2026-09-20: average of 8, 9, 10 is 9; last 10; max 10; the later basis row does not apply');
select is(pg_temp.row_of('1a000000-0000-4000-8000-00000000001a', app.venue_day_end('2026-09-09', 'Europe/Rome')),
  'moving_average 8 8 8 8 1 2026-09-01',
  'as of 2026-09-09: one purchase');
select is(pg_temp.row_of('1a000000-0000-4000-8000-00000000001a', app.venue_day_end('2026-09-10', 'Europe/Rome')),
  'moving_average 8.5 8.5 9 9 2 2026-09-10',
  'the day of the purchase counts (effective_on <= the Rome date of the instant)');
select is(pg_temp.row_of('1a000000-0000-4000-8000-00000000001a', app.venue_day_end('2026-08-31', 'Europe/Rome')),
  'moving_average - - - - 0 -', 'before the first purchase: nothing in force, no cost');
-- A basis history: last_price from 2026-09-15 12:00Z on, moving_average again from 2026-10-05.
reset role;
insert into public.ingredient_cost_basis (tenant_id, ingredient_id, basis, valid_from, created_by) values
  ('11111111-1111-4111-8111-111111111111', '1b000000-0000-4000-8000-00000000001b', 'last_price',
   '2026-09-15T12:00:00Z', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '1b000000-0000-4000-8000-00000000001b', 'moving_average',
   '2026-10-05T12:00:00Z', 'a1000000-0000-4000-8000-00000000000a');
select pg_temp.buy(10, '1b000000-0000-4000-8000-00000000001b', 1.00, '2026-09-01');
select pg_temp.buy(11, '1b000000-0000-4000-8000-00000000001b', 2.00, '2026-09-20');
select pg_temp.buy(12, '1b000000-0000-4000-8000-00000000001b', 4.00, '2026-10-01');
select is((select c.basis::text from app.ingredient_unit_costs('11111111-1111-4111-8111-111111111111',
    array['1b000000-0000-4000-8000-00000000001b'::uuid], '2026-09-10T00:00:00Z') c), 'moving_average',
  'before the first basis row: moving_average');
select is((select c.basis::text || ' ' || c.unit_cost from app.ingredient_unit_costs('11111111-1111-4111-8111-111111111111',
    array['1b000000-0000-4000-8000-00000000001b'::uuid], '2026-09-30T00:00:00Z') c), 'last_price 2.0000',
  'between the rows: last_price, the last purchase in force (2) is the cost');
select is((select c.basis::text from app.ingredient_unit_costs('11111111-1111-4111-8111-111111111111',
    array['1b000000-0000-4000-8000-00000000001b'::uuid], null) c), 'moving_average',
  'now: the newest row (moving_average) wins');

-- 3. Order: the same effective_on, seq decides "last".
select is(pg_temp.row_of('1c000000-0000-4000-8000-00000000001c'),
  'moving_average 0.35 0.35 0.4 0.4 2 2026-10-02',
  'two purchases on one day: the later row is last (0.40), the average of 0.30 and 0.40 is 0.35');
select is(pg_temp.row_of('1f000000-0000-4000-8000-00000000001f'),
  'moving_average 1.333333 1.333333 2 2 3 2026-09-03',
  'the engine keeps full precision (1, 1, 2 gives 1.3333...)');

-- 4. Unknown is never zero.
select is(pg_temp.row_of('1d000000-0000-4000-8000-00000000001d'), 'moving_average - - - - 0 -',
  'salt has no purchase: no cost, no average, 0 purchases (never 0 EUR)');
select is((select count(*)::int from app.ingredient_unit_costs('11111111-1111-4111-8111-111111111111', null, null)), 5,
  'p_ids null lists every ingredient of the tenant (5; tenant B''s is not included)');
select is((select count(*)::int from app.ingredient_unit_costs('11111111-1111-4111-8111-111111111111',
    array['1e000000-0000-4000-8000-00000000001e'::uuid, '1a000000-0000-4000-8000-00000000001a'::uuid], null)), 1,
  'an id of another tenant returns no row');
select throws_ok($$ select * from app.ingredient_unit_costs('99999999-9999-4999-8999-999999999999', null, null) $$,
  'P0002', 'tenant_not_found', 'an unknown tenant is P0002');

-- 5. Purchases through approve_invoice: a partial credit does not change the price; a fully credited
-- line is not a purchase. Invoice 2 (2026-10-03) of flour, items as in 035.
create function pg_temp.iid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_vat,
    supplier_name, number_raw, invoice_date, due_date, net_total, vat_total, gross_total, supplier_id)
  values (pg_temp.iid(2), '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111/2026/' || pg_temp.iid(2) || '.pdf', 'application/pdf', 100,
    'review', 'IT12345678903', 'Fornitore Demo Srl', 'FT 2', '2026-10-03', '2026-11-30', 24, 2.4, 26.4,
    '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, line_amount,
    vat_rate, unit, ingredient_id, supplier_item_id, mapping_source, is_stock, credit_qty,
    field_confidence, extracted)
  values
  ('a2000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', pg_temp.iid(2), 1,
   'Farina', 2, 20, 10, 'kg', '1b000000-0000-4000-8000-00000000001b',
   '51000000-0000-4000-8000-000000000051', 'manual', true, 0.5, '{}', '{}'),
  ('a2000000-0000-4000-8000-0000000000b2', '11111111-1111-4111-8111-111111111111', pg_temp.iid(2), 2,
   'Farina', 1, 4, 10, 'kg', '1b000000-0000-4000-8000-00000000001b',
   '51000000-0000-4000-8000-000000000051', 'manual', true, 1, '{}', '{}');
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err(format('select public.approve_invoice(%L)', pg_temp.iid(2))), 'ok', 'the invoice with the credits is approved');
reset role;
select is((select count(*)::int from public.price_history where invoice_line_id in
    ('a2000000-0000-4000-8000-0000000000b1', 'a2000000-0000-4000-8000-0000000000b2')), 1,
  'one price row: the fully credited line is not a purchase');
select is((select unit_price from public.price_history where invoice_line_id = 'a2000000-0000-4000-8000-0000000000b1'),
  10.0000, 'the partially credited line (2 kg, credit 0.5, 20.00) is priced 10.0000 per kg: the credit does not change the price');
select is((select c.purchases_used || ' ' || c.last_cost from app.ingredient_unit_costs('11111111-1111-4111-8111-111111111111',
    array['1b000000-0000-4000-8000-00000000001b'::uuid], null) c), '3 10.0000',
  'flour: the approved purchase (10.00 on 2026-10-03) is the newest; the window of 3 is 2, 4 and 10');

-- 6. The public function: rounded, named, owner/admin only.
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.pub('1f000000-0000-4000-8000-00000000001f'),
  'moving_average 1.3333 1.3333 2 2 3 2026-09-03', 'the public function rounds to 4 decimals');
select is(pg_temp.pub('1a000000-0000-4000-8000-00000000001a', '2026-09-20'),
  'moving_average 9 9 10 10 3 2026-09-20',
  'as of a date: the owner''s basis row (dated now) does not apply to an earlier date');
select is(pg_temp.pub('1d000000-0000-4000-8000-00000000001d'), 'moving_average - - - - 0 -',
  'salt: null costs through the public function too');
select is((select array_agg(c.name) from public.ingredient_costs() c),
  (select array_agg(n order by n collate "C") from (select c.name n from public.ingredient_costs() c) x),
  'the list is ordered by name');
select is((select count(*)::int from public.ingredient_costs()), 5, 'owner A: the 5 ingredients of tenant A');
select is((select c.is_active from public.ingredient_costs() c where c.ingredient_id = '1d000000-0000-4000-8000-00000000001d'), true,
  'with is_active');
select is(pg_temp.err('select * from public.ingredient_costs(current_date + 2)'), 'P0001 date_in_future',
  'a future date is refused');
select is(pg_temp.err('select * from public.ingredient_costs(current_date)'), 'ok', 'today is allowed');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((select count(*)::int from public.ingredient_costs()), 5, 'the admin reads the same list');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(left(pg_temp.err('select * from public.ingredient_costs()'), 5), '42501', 'the chef is refused');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err('select * from public.ingredient_costs()'), 5), '42501', 'the waiter is refused');
select set_config('request.jwt.claims', '', true);
select is(left(pg_temp.err('select * from public.ingredient_costs()'), 5), '42501', 'no claims: refused');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select array_agg(c.name) from public.ingredient_costs() c), array['Burro B (demo)'],
  'owner B sees only tenant B''s ingredient');
select is((select c.unit_cost_eur from public.ingredient_costs() c), null, 'with no cost');
reset role;
set local role anon;
select is(left(pg_temp.err('select * from public.ingredient_costs()'), 5), '42501', 'anon is refused');
reset role;

-- 7. Closed to the API roles; shape.
select is_empty(
  $$ select f.fn || ' ' || r.rolname from (values
       ('app.ingredient_unit_costs(uuid, uuid[], timestamptz)'), ('app.venue_day_end(date, text)')) f (fn)
      cross join (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
      where has_function_privilege(r.rolname, f.fn, 'execute') $$,
  'no API role can execute the engine or venue_day_end');
select is_empty(
  $$ select 1 from (values ('anon'), ('service_role')) r (rolname)
      where has_function_privilege(r.rolname, 'public.ingredient_costs(date)', 'execute') $$,
  'anon and service_role cannot execute ingredient_costs');
select ok(has_function_privilege('authenticated', 'public.ingredient_costs(date)', 'execute'),
  'authenticated can');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] and p.provolatile = 's'
             from pg_proc p where p.oid = 'public.ingredient_costs(date)'::regprocedure),
  'ingredient_costs is stable, security definer, with an empty search_path');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] and p.provolatile = 's'
             from pg_proc p where p.oid = 'app.ingredient_unit_costs(uuid, uuid[], timestamptz)'::regprocedure),
  'the engine is stable, security definer, with an empty search_path');

-- 8. venue_day_end: the end of the Rome day, DST-safe.
select is(app.venue_day_end('2026-10-25', 'Europe/Rome'), '2026-10-25T22:59:59.999999Z'::timestamptz,
  'the 25-hour day 2026-10-25 ends at 22:59:59.999999Z');
select is(app.venue_day_end('2026-03-29', 'Europe/Rome'), '2026-03-29T21:59:59.999999Z'::timestamptz,
  'the 23-hour day 2026-03-29 ends at 21:59:59.999999Z');
select is(app.venue_day_end('2026-07-01', 'Europe/Rome'), '2026-07-01T21:59:59.999999Z'::timestamptz,
  'a summer day ends at 21:59:59.999999Z');
select is(app.venue_date(app.venue_day_end('2026-10-25', 'Europe/Rome'), 'Europe/Rome'), '2026-10-25'::date,
  'and that instant is still on the same Rome date');
select is(app.venue_date(app.venue_day_end('2026-10-25', 'Europe/Rome') + interval '1 microsecond', 'Europe/Rome'),
  '2026-10-26'::date, 'one microsecond later is the next date');

select * from finish();
rollback;
