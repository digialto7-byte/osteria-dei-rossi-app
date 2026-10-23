-- M8 step 3: recursive recipe cost, recipe_cost_at, recipe_costs and v_recipe_cost (M8 plan §3.1.4-5;
-- AT1, AT2, AT7). Fake data only. Prices: beef 8, 9, 10 on 2026-09-18/25/20 and 11 on 2026-10-01 (the
-- average of the last 3 is 10 today); flour 1.50; bread 0.30; salt has no purchase.
-- Recipe versions are inserted as the table owner so that valid_from is under the test's control.
begin;
create extension if not exists pgtap with schema extensions;
select plan(84);

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
-- The public function's JSON.
create function pg_temp.at(n int, p_date date default null) returns jsonb language sql as $$
  select public.recipe_cost_at(pg_temp.k(n), p_date) $$;
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text), pg_temp.k(int),
  pg_temp.at(int, date) to authenticated, anon;

create function pg_temp.salt() returns text language sql as $$ select '{1d000000-0000-4000-8000-00000000001d}' $$;
create function pg_temp.beef() returns uuid language sql as $$ select '1a000000-0000-4000-8000-00000000001a'::uuid $$;
create function pg_temp.flour() returns uuid language sql as $$ select '1b000000-0000-4000-8000-00000000001b'::uuid $$;
create function pg_temp.bread() returns uuid language sql as $$ select '1c000000-0000-4000-8000-00000000001c'::uuid $$;
create function pg_temp.saltid() returns uuid language sql as $$ select '1d000000-0000-4000-8000-00000000001d'::uuid $$;

-- 1 Manzo pulito (sub, 1 kg beef at yield 0.82); 24 beef in grams; 2 stew; 3 polenta; 4 plate; 25 plate in g.
select pg_temp.mkkey(1, 'sub', 'Manzo pulito (demo)');
select pg_temp.mkver(1, 1, '2026-09-01T00:00Z', 'Manzo pulito (demo)', 1, 'kg');
select pg_temp.li(1, 1, 1, pg_temp.beef(), null, 1, 'kg', 0.82);
select pg_temp.mkkey(24, 'sub', 'Manzo grammi (demo)');
select pg_temp.mkver(24, 1, '2026-09-01T00:00Z', 'Manzo grammi (demo)', 1, 'kg');
select pg_temp.li(24, 1, 1, pg_temp.beef(), null, 500, 'g');
select pg_temp.mkkey(2, 'batch', 'Spezzatino (demo)');
select pg_temp.mkver(2, 1, '2026-09-01T00:00Z', 'Spezzatino (demo)', 6, 'kg', 30);
select pg_temp.li(2, 1, 1, pg_temp.beef(), null, 5, 'kg');
select pg_temp.mkkey(3, 'sub', 'Polenta (demo)');
select pg_temp.mkver(3, 1, '2026-09-01T00:00Z', 'Polenta (demo)', 1, 'kg');
select pg_temp.li(3, 1, 1, pg_temp.flour(), null, 0.3, 'kg');
select pg_temp.mkkey(4, 'plate', 'Spezzatino con polenta (demo)');
select pg_temp.mkver(4, 1, '2026-09-01T00:00Z', 'Spezzatino con polenta (demo)');
select pg_temp.li(4, 1, 1, null, 2, 1, 'porz');
select pg_temp.li(4, 1, 2, null, 3, 0.2, 'kg');
select pg_temp.li(4, 1, 3, pg_temp.bread(), null, 1, 'pz');
select pg_temp.mkkey(25, 'plate', 'Polenta in grammi (demo)');
select pg_temp.mkver(25, 1, '2026-09-01T00:00Z', 'Polenta in grammi (demo)');
select pg_temp.li(25, 1, 1, null, 3, 200, 'g');
-- 5 plate with salt (no purchase); 6 sub with salt; 7 plate above it.
select pg_temp.mkkey(5, 'plate', 'Polenta e sale (demo)');
select pg_temp.mkver(5, 1, '2026-09-01T00:00Z', 'Polenta e sale (demo)');
select pg_temp.li(5, 1, 1, null, 3, 0.3, 'kg');
select pg_temp.li(5, 1, 2, pg_temp.saltid(), null, 0.01, 'kg');
select pg_temp.mkkey(6, 'sub', 'Salsa (demo)');
select pg_temp.mkver(6, 1, '2026-09-01T00:00Z', 'Salsa (demo)', 1, 'kg');
select pg_temp.li(6, 1, 1, pg_temp.saltid(), null, 0.1, 'kg');
select pg_temp.mkkey(7, 'plate', 'Piatto con salsa (demo)');
select pg_temp.mkver(7, 1, '2026-09-01T00:00Z', 'Piatto con salsa (demo)');
select pg_temp.li(7, 1, 1, null, 6, 0.2, 'kg');
-- 9 sub whose only version starts 2026-10-10; 8 plate (from 2026-09-01) that uses it.
select pg_temp.mkkey(9, 'sub', 'Sugo (demo)');
select pg_temp.mkver(9, 1, '2026-10-10T00:00Z', 'Sugo (demo)', 1, 'kg');
select pg_temp.li(9, 1, 1, pg_temp.flour(), null, 1, 'kg');
select pg_temp.mkkey(8, 'plate', 'Piatto con sugo (demo)');
select pg_temp.mkver(8, 1, '2026-09-01T00:00Z', 'Piatto con sugo (demo)');
select pg_temp.li(8, 1, 1, null, 9, 1, 'kg');
-- 10 sub: v1 (from 2026-09-01) outputs litres, v2 (from 2026-10-01) kg; 11 plate (from 2026-09-05) uses 1 kg.
select pg_temp.mkkey(10, 'sub', 'Brodo (demo)');
select pg_temp.mkver(10, 1, '2026-09-01T00:00Z', 'Brodo (demo)', 1, 'l');
select pg_temp.li(10, 1, 1, pg_temp.flour(), null, 1, 'kg');
select pg_temp.mkver(10, 2, '2026-10-01T00:00Z', 'Brodo (demo)', 1, 'kg');
select pg_temp.li(10, 2, 1, pg_temp.flour(), null, 1, 'kg');
select pg_temp.mkkey(11, 'plate', 'Piatto con brodo (demo)');
select pg_temp.mkver(11, 1, '2026-09-05T00:00Z', 'Piatto con brodo (demo)');
select pg_temp.li(11, 1, 1, null, 10, 1, 'kg');
-- 12 and 13 form a loop (written by hand: the M7 guard refuses it); 14 plate above it.
select pg_temp.mkkey(12, 'sub', 'Anello A (demo)');
select pg_temp.mkkey(13, 'sub', 'Anello B (demo)');
select pg_temp.mkver(12, 1, '2026-09-01T00:00Z', 'Anello A (demo)', 1, 'kg');
select pg_temp.mkver(13, 1, '2026-09-01T00:00Z', 'Anello B (demo)', 1, 'kg');
select pg_temp.li(12, 1, 1, pg_temp.flour(), null, 1, 'kg');
select pg_temp.li(12, 1, 2, null, 13, 1, 'kg');
select pg_temp.li(13, 1, 1, null, 12, 1, 'kg');
select pg_temp.mkkey(14, 'plate', 'Piatto con anello (demo)');
select pg_temp.mkver(14, 1, '2026-09-01T00:00Z', 'Piatto con anello (demo)');
select pg_temp.li(14, 1, 1, null, 12, 1, 'kg');
-- AT7: 15 batch Brasato, v1 from 2026-09-20T10:00Z (beef 5 kg), v2 from 2026-10-01T10:00Z (beef 6 kg).
select pg_temp.mkkey(15, 'batch', 'Brasato (demo)');
select pg_temp.mkver(15, 1, '2026-09-20T10:00Z', 'Brasato (demo)', 6, 'kg', 30);
select pg_temp.li(15, 1, 1, pg_temp.beef(), null, 5, 'kg');
select pg_temp.mkver(15, 2, '2026-10-01T10:00Z', 'Brasato (demo)', 6, 'kg', 30);
select pg_temp.li(15, 2, 1, pg_temp.beef(), null, 6, 'kg');
-- 16 sub Fondo: v1 flour 1 kg, v2 (from 2026-10-01T10:00Z) flour 2 kg; 17 plate uses 1 kg of it.
select pg_temp.mkkey(16, 'sub', 'Fondo (demo)');
select pg_temp.mkver(16, 1, '2026-09-01T00:00Z', 'Fondo (demo)', 1, 'kg');
select pg_temp.li(16, 1, 1, pg_temp.flour(), null, 1, 'kg');
select pg_temp.mkver(16, 2, '2026-10-01T10:00Z', 'Fondo (demo)', 1, 'kg');
select pg_temp.li(16, 2, 1, pg_temp.flour(), null, 2, 'kg');
select pg_temp.mkkey(17, 'plate', 'Piatto con fondo (demo)');
select pg_temp.mkver(17, 1, '2026-09-01T00:00Z', 'Piatto con fondo (demo)');
select pg_temp.li(17, 1, 1, null, 16, 1, 'kg');
-- Diamond: P (20) = A (21) + B (22); A = 0.5 kg of C (23) + 1 kg flour; B = 0.2 kg of C; C = 1 kg beef.
select pg_temp.mkkey(23, 'sub', 'Base C (demo)');
select pg_temp.mkver(23, 1, '2026-09-01T00:00Z', 'Base C (demo)', 1, 'kg');
select pg_temp.li(23, 1, 1, pg_temp.beef(), null, 1, 'kg');
select pg_temp.mkkey(21, 'sub', 'Base A (demo)');
select pg_temp.mkver(21, 1, '2026-09-01T00:00Z', 'Base A (demo)', 1, 'kg');
select pg_temp.li(21, 1, 1, null, 23, 0.5, 'kg');
select pg_temp.li(21, 1, 2, pg_temp.flour(), null, 1, 'kg');
select pg_temp.mkkey(22, 'sub', 'Base B (demo)');
select pg_temp.mkver(22, 1, '2026-09-01T00:00Z', 'Base B (demo)', 1, 'kg');
select pg_temp.li(22, 1, 1, null, 23, 0.2, 'kg');
select pg_temp.mkkey(20, 'plate', 'Piatto diamante (demo)');
select pg_temp.mkver(20, 1, '2026-09-01T00:00Z', 'Piatto diamante (demo)');
select pg_temp.li(20, 1, 1, null, 21, 1, 'kg');
select pg_temp.li(20, 1, 2, null, 22, 1, 'kg');
-- 26: an ingredient line in litres on a kg ingredient (the M7 procedures refuse it); inactive afterwards.
select pg_temp.mkkey(26, 'plate', 'Piatto unita sbagliata (demo)');
select pg_temp.mkver(26, 1, '2026-09-01T00:00Z', 'Piatto unita sbagliata (demo)');
select pg_temp.li(26, 1, 1, pg_temp.beef(), null, 1, 'l');
-- 30 and 31: the Rome day boundary on 2026-10-25 (CEST ends that night: 25 hours).
select pg_temp.mkkey(30, 'sub', 'Giorno A (demo)');
select pg_temp.mkver(30, 1, '2026-10-25T22:30Z', 'Giorno A (demo)', 1, 'kg');
select pg_temp.li(30, 1, 1, pg_temp.flour(), null, 1, 'kg');
select pg_temp.mkkey(31, 'sub', 'Giorno B (demo)');
select pg_temp.mkver(31, 1, '2026-10-25T23:00Z', 'Giorno B (demo)', 1, 'kg');
select pg_temp.li(31, 1, 1, pg_temp.flour(), null, 1, 'kg');

-- AT1: yield.
select is(pg_temp.cost(1), '12.1951 12.1951 kg false {} {}', 'AT1: 1 kg beef at yield 0.82 costs 10 / 0.82 = 12.1951 per usable kg');
select is(pg_temp.cost(24), '5 5 kg false {} {}', 'a line in grams converts: 500 g of beef at 10 per kg = 5.0000');
-- AT2: batch, sub, plate.
select is(pg_temp.cost(2), '50 1.6667 porz false {} {}', 'AT2: the stew costs 50 per batch, 50 / 30 portions = 1.6667 per portion');
select is(pg_temp.cost(3), '0.45 0.45 kg false {} {}', 'a sub costs per output kg: 0.3 kg of flour at 1.50 = 0.45');
select is(pg_temp.cost(4), '2.0567 2.0567 piatto false {} {}', 'AT2: the plate = 1 portion of stew 1.6667 + 0.2 kg polenta 0.09 + bread 0.30 = 2.0567');
select is(pg_temp.cost(25), '0.09 0.09 piatto false {} {}', 'a sub line in g on a kg sub converts: 200 g of polenta = 0.09');
-- Incomplete.
select is(pg_temp.cost(5), '- - piatto true {missing_price} ' || pg_temp.salt(), 'a plate with an unpriced ingredient is incomplete: no total, the ingredient named');
select is(pg_temp.cost(6), '- - kg true {missing_price} ' || pg_temp.salt(), 'a sub with salt is incomplete');
select is(pg_temp.cost(7), '- - piatto true {missing_price} ' || pg_temp.salt(), 'a plate above an incomplete sub inherits it');
select is(pg_temp.cost(8), '1.5 1.5 piatto false {} {}', 'today the sub with a later start is in force');
select is(pg_temp.cost(8, app.venue_day_end('2026-09-15', 'Europe/Rome')), '- - piatto true {sub_not_in_force} {}',
  'a plate whose sub has no version in force at that instant: sub_not_in_force');
select is(pg_temp.cost(11), '1.5 1.5 piatto false {} {}', 'today the broth is in kg');
select is(pg_temp.cost(11, app.venue_day_end('2026-09-15', 'Europe/Rome')), '- - piatto true {unit_mismatch} {}',
  'a past sub version with output unit l used in kg: unit_mismatch');
select is(pg_temp.cost(26), '- - piatto true {unit_mismatch} {}', 'an ingredient line of another dimension: unit_mismatch');
select is(pg_temp.cost(12), '- - kg true {graph_too_deep} {}', 'a hand-written loop fails closed: graph_too_deep');
select is(pg_temp.cost(14), '- - piatto true {graph_too_deep} {}', 'and so does a plate above it');
-- AT7: the version and the prices in force on a date.
select is(pg_temp.cost(15, app.venue_day_end('2026-09-20', 'Europe/Rome')), '45 1.5 porz false {} {}',
  'AT7: on 2026-09-20 version 1 (5 kg) at the average of 8, 9, 10 = 9 gives 45');
select is(pg_temp.cost(15, app.venue_day_end('2026-10-01', 'Europe/Rome')), '60 2 porz false {} {}',
  'on 2026-10-01 version 2 (6 kg) at the average of 9, 10, 11 = 10 gives 60');
select is(pg_temp.cost(15), '60 2 porz false {} {}', 'no date: the current version at the current prices');
select is((select count(*)::int from app.recipe_costs('11111111-1111-4111-8111-111111111111',
    array[pg_temp.k(15)], app.venue_day_end('2026-09-19', 'Europe/Rome'))), 0, 'before version 1 there is no row');
select is(pg_temp.cost(17, app.venue_day_end('2026-09-20', 'Europe/Rome')), '1.5 1.5 piatto false {} {}',
  'a sub changed between the dates: the plate on 2026-09-20 uses the sub''s version 1');
select is(pg_temp.cost(17, app.venue_day_end('2026-10-01', 'Europe/Rome')), '3 3 piatto false {} {}',
  'and on 2026-10-01 version 2 (the sub''s version starts at 10:00Z that day)');
-- Diamond: cost(P) = cost(A) + cost(B), each including C.
select is(pg_temp.cost(21), '6.5 6.5 kg false {} {}', 'diamond: A = 0.5 kg of C (5) + flour 1.50 = 6.5');
select is(pg_temp.cost(22), '2 2 kg false {} {}', 'B = 0.2 kg of C = 2');
select is(pg_temp.cost(20), '8.5 8.5 piatto false {} {}', 'P = A + B = 8.5 (C counted once for each path)');
-- DST: the end of the Rome day 2026-10-25 is 22:59:59.999999Z.
select is(pg_temp.cost(30, app.venue_day_end('2026-10-25', 'Europe/Rome')), '1.5 1.5 kg false {} {}',
  'a version from 22:30Z (23:30 CET) is in force on 2026-10-25');
select is((select count(*)::int from app.recipe_costs('11111111-1111-4111-8111-111111111111',
    array[pg_temp.k(31)], app.venue_day_end('2026-10-25', 'Europe/Rome'))), 0,
  'one from 23:00Z (00:00 CET) is not');
select is(pg_temp.cost(31, app.venue_day_end('2026-10-26', 'Europe/Rome')), '1.5 1.5 kg false {} {}',
  'but it is on 2026-10-26');
-- Engine input checks.
select throws_ok(format('select * from app.recipe_costs(%L, (select array_agg(gen_random_uuid()) from generate_series(1, 1001)), null)',
    '11111111-1111-4111-8111-111111111111'), 'P0001', 'too_many_keys', 'more than 1000 keys are refused');
select is((select count(*)::int from app.recipe_costs('11111111-1111-4111-8111-111111111111', array[]::uuid[], null)), 0,
  'no keys, no rows');
select is((select count(*)::int from app.recipe_costs('22222222-2222-4222-8222-222222222222', array[pg_temp.k(2)], null)), 0,
  'a key of another tenant returns no row');
select is((select count(*)::int from app.recipe_costs('11111111-1111-4111-8111-111111111111',
    array[pg_temp.k(2), pg_temp.k(4), pg_temp.k(5)], null)), 3, 'several keys in one call');
select is((select version::text || ' ' || type::text || ' ' || name || ' ' || (recipe_id = pg_temp.v(15, 2)) from app.recipe_costs(
    '11111111-1111-4111-8111-111111111111', array[pg_temp.k(15)], null)), '2 batch Brasato (demo) true',
  'the row names the version in force, its type and name');

-- Public functions: recipe_cost_at.
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.at(2) ->> 'totalCostEur', '50.0000', 'recipe_cost_at: total of the stew');
select is(pg_temp.at(2) ->> 'unitCostEur', '1.6667', 'per portion');
select is(pg_temp.at(2) ->> 'costUnit', 'porz', 'in portions');
select is(pg_temp.at(2) -> 'at', 'null'::jsonb, 'no date: at is null');
select is(pg_temp.at(15, '2026-09-20') ->> 'totalCostEur', '45.0000', 'AT7 through the public function: 2026-09-20');
select is(pg_temp.at(15, '2026-09-20') ->> 'at', '2026-09-20', 'and it echoes the date');
select is(pg_temp.at(15, '2026-09-20') ->> 'version', '1', 'version 1');
select is(pg_temp.at(15, '2026-10-01') ->> 'totalCostEur', '60.0000', '2026-10-01: version 2, 60');
select is(pg_temp.at(15) ->> 'totalCostEur', '60.0000', 'no date: 60');
select is(pg_temp.err(format('select public.recipe_cost_at(%L, %L)', pg_temp.k(15), '2026-09-19')),
  'P0002 recipe_not_in_force', 'a date before the first version: recipe_not_in_force');
select is(pg_temp.err(format('select public.recipe_cost_at(%L, current_date + 2)', pg_temp.k(15))),
  'P0001 date_in_future', 'a future date');
select is(pg_temp.err(format('select public.recipe_cost_at(%L)', gen_random_uuid())), 'P0002 not_found', 'an unknown key');
select is(jsonb_array_length(pg_temp.at(4) -> 'lines'), 3, 'the plate has 3 lines');
select is(pg_temp.at(4) #>> '{lines,0,target,name}', 'Spezzatino (demo)', 'line 1 names the batch');
select is(pg_temp.at(4) #>> '{lines,0,target,kind}', 'recipe', 'as a recipe');
select is(pg_temp.at(4) #>> '{lines,0,unitCostEur}', '1.6667', 'at 1.6667 per portion');
select is(pg_temp.at(4) #>> '{lines,2,target,name}', 'Pane (demo)', 'line 3 names the ingredient');
select is(pg_temp.at(4) #>> '{lines,2,lineCostEur}', '0.3000', 'costing 0.30');
select is(pg_temp.at(2) -> 'plate', 'null'::jsonb, 'a batch has no plate outputs');
select is(pg_temp.at(4) #>> '{plate,status}', 'incomplete', 'a plate has them (step 4); this fixture gives it no sale price');
select is(pg_temp.at(5) -> 'incomplete', 'true'::jsonb, 'the salt plate is incomplete');
select is(pg_temp.at(5) -> 'totalCostEur', 'null'::jsonb, 'with no total');
select is(pg_temp.at(5) -> 'missingIngredientIds', '["1d000000-0000-4000-8000-00000000001d"]'::jsonb, 'naming salt');
select is(pg_temp.at(5) #>> '{lines,1,reason}', 'missing_price', 'and the line says why');
select is(pg_temp.at(5) #>> '{lines,0,lineCostEur}', '0.1350', 'while the priced line keeps its cost');

-- recipe_costs() and the view: active keys only.
reset role;
update public.recipe_key set is_active = false where id = pg_temp.k(26);
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select count(*)::int from public.recipe_costs()), 25, 'recipe_costs lists the 25 active recipes');
select is((select count(*)::int from public.v_recipe_cost), 25, 'the view shows the same');
select is((select total_cost_eur || ' ' || unit_cost_eur || ' ' || cost_unit from public.recipe_costs() c
            where c.recipe_key = pg_temp.k(2)), '50.0000 1.6667 porz', 'with 4-decimal amounts');
select is((select incomplete from public.v_recipe_cost where recipe_key = pg_temp.k(5)), true, 'incomplete is carried');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((select count(*)::int from public.recipe_costs()), 25, 'the admin reads them too');
select is((select count(*)::int from public.v_recipe_cost), 25, 'and the view');
select is(pg_temp.at(2) ->> 'totalCostEur', '50.0000', 'and recipe_cost_at');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(left(pg_temp.err('select * from public.recipe_costs()'), 5), '42501', 'the chef: recipe_costs refused');
select is(left(pg_temp.err('select * from public.v_recipe_cost'), 5), '42501', 'the chef: the view refused');
select is(left(pg_temp.err(format('select public.recipe_cost_at(%L)', pg_temp.k(2))), 5), '42501', 'the chef: recipe_cost_at refused');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err('select * from public.recipe_costs()'), 5), '42501', 'the waiter: recipe_costs refused');
select is(left(pg_temp.err('select * from public.v_recipe_cost'), 5), '42501', 'the waiter: the view refused');
select is(left(pg_temp.err(format('select public.recipe_cost_at(%L)', pg_temp.k(2))), 5), '42501', 'the waiter: recipe_cost_at refused');
select set_config('request.jwt.claims', '', true);
select is(left(pg_temp.err('select * from public.recipe_costs()'), 5), '42501', 'no claims: refused');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select count(*)::int from public.recipe_costs()), 0, 'owner B sees no recipe of tenant A');
select is(pg_temp.err(format('select public.recipe_cost_at(%L)', pg_temp.k(2))), 'P0002 not_found', 'and A''s key is not found for him');
reset role;
set local role anon;
select is(left(pg_temp.err('select * from public.recipe_costs()'), 5), '42501', 'anon: refused');
select is(left(pg_temp.err('select * from public.v_recipe_cost'), 5), '42501', 'anon: the view refused');
reset role;

-- Shape and privileges.
select is_empty(
  $$ select f.fn || ' ' || r.rolname from (values
       ('app.recipe_costs(uuid, uuid[], timestamptz)'), ('app.recipe_in_force(uuid, uuid, timestamptz)'),
       ('app.recipe_unit_factor(public.recipe_unit)'),
       ('app.recipe_line_costs(uuid, uuid[], jsonb, jsonb)'),
       ('app.recipe_cost_lines(uuid, uuid, timestamptz)')) f (fn)
      cross join (values ('anon'), ('authenticated'), ('service_role')) r (rolname)
      where has_function_privilege(r.rolname, f.fn, 'execute') $$,
  'no API role can execute the recipe cost engine');
select is_empty(
  $$ select f.fn || ' ' || r.rolname from (values ('public.recipe_cost_at(uuid, date)'), ('public.recipe_costs()')) f (fn)
      cross join (values ('anon'), ('service_role')) r (rolname)
      where has_function_privilege(r.rolname, f.fn, 'execute') $$,
  'anon and service_role cannot execute the public cost functions');
select ok(has_function_privilege('authenticated', 'public.recipe_cost_at(uuid, date)', 'execute')
      and has_function_privilege('authenticated', 'public.recipe_costs()', 'execute'),
  'authenticated can');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and p.provolatile = 's')
             from pg_proc p where p.oid in ('public.recipe_cost_at(uuid, date)'::regprocedure,
               'public.recipe_costs()'::regprocedure, 'app.recipe_costs(uuid, uuid[], timestamptz)'::regprocedure)),
  'the cost functions are stable, security definer, with an empty search_path');
select is(app.recipe_unit_factor('g'), 0.001, 'unit factor g');
select is(app.recipe_unit_factor('ml'), 0.001, 'unit factor ml');
select is((select array_agg(app.recipe_unit_factor(u) order by u) from unnest(enum_range(null::public.recipe_unit)) u
            where u not in ('g', 'ml')), array[1, 1, 1, 1]::numeric[], 'kg, l, pz, porz are 1');
select is((select reloptions::text from pg_class where oid = 'public.v_recipe_cost'::regclass), '{security_invoker=true}',
  'the view is security_invoker');

select * from finish();
rollback;
