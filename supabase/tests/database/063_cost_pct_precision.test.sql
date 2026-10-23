-- M8 follow-up: percentages are returned to 4 decimals so the screens round once (1 decimal), not twice.
-- Fixture as in 058: plate 4 "Spezzatino con polenta (demo)" food 2.0567, price 12.00 VAT incl. (10), GP 81.1472...
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

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

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select c.food_cost_pct::text || ' ' || c.gp_pct::text from public.plate_costs() c where c.recipe_key = pg_temp.k(4)),
  '18.8528 81.1472', 'plate_costs: food cost % and GP % to 4 decimals');
select is((select c.status from public.plate_costs() c where c.recipe_key = pg_temp.k(43)), 'fixed_cost_unallocated',
  'plate_costs: status still from the unrounded GP (on target is not below)');
select is(pg_temp.margin(4), '18.8528 81.1472 ok', 'plate_margins_pct (owner): 4 decimals');
select is(public.recipe_cost_at(pg_temp.k(4)) -> 'plate' ->> 'foodCostPct', '18.8528', 'recipe_cost_at: foodCostPct to 4 decimals');
select is(public.recipe_cost_at(pg_temp.k(4)) -> 'plate' ->> 'gpPct', '81.1472', 'recipe_cost_at: gpPct to 4 decimals');
select is((public.recipe_cost_at(pg_temp.k(4)) -> 'plate' ->> 'gpPct')::numeric, 81.1472, 'and it is a number');
select is(public.recipe_cost_at(pg_temp.k(4)) -> 'plate' ->> 'grossMarginEur', '8.8524', 'euro figures keep 4 decimals');
select is((select c.food_cost_pct::text || ' ' || c.gp_pct::text from public.plate_costs() c where c.recipe_key = pg_temp.k(40)),
  '18.8528 81.1472', 'a below-target plate as well');
select is((select c.status from public.plate_costs() c where c.recipe_key = pg_temp.k(40)), 'below_target', 'which stays below_target');

select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((select c.gp_pct::text || ' ' || coalesce(c.fixed_cost_eur::text, 'null') from public.plate_costs() c where c.recipe_key = pg_temp.k(4)),
  '81.1472 null', 'admin: 4 decimals, fixed cost still null');
select is(left(pg_temp.err('select * from public.fixed_cost_status()'), 5), '42501', 'admin: fixed_cost_status still refused');

select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.margin(4), '18.8528 81.1472 ok', 'chef: plate_margins_pct to 4 decimals');
select is(left(pg_temp.err('select * from public.plate_costs()'), 5), '42501', 'chef: plate_costs refused');
select is(left(pg_temp.err(format('select public.recipe_cost_at(%L)', pg_temp.k(4))), 5), '42501', 'chef: recipe_cost_at refused');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(left(pg_temp.err('select * from public.plate_margins_pct()'), 5), '42501', 'waiter: refused');
reset role;

-- The alert payload keeps 4 decimals.
create temporary table payload as
  select app.price_variance_payload('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000f1',
    '1a000000-0000-4000-8000-00000000001a', 11, 9.5, 4, 15.789473, 10) as p;
select is((select p ->> 'change_pct' from payload), '15.7895', 'alert payload: change_pct to 4 decimals');
select is((select e ->> 'gp_pct' from payload, jsonb_array_elements(p -> 'recipes') e where e ->> 'name' = 'Spezzatino con polenta (demo)'),
  '81.1472', 'alert payload: a plate''s gp_pct to 4 decimals');

select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and p.provolatile = 's')
             from pg_proc p where p.oid in ('public.plate_costs(date)'::regprocedure,
               'public.plate_margins_pct()'::regprocedure, 'public.recipe_cost_at(uuid, date)'::regprocedure,
               'app.price_variance_payload(uuid, uuid, uuid, numeric, numeric, integer, numeric, numeric)'::regprocedure)),
  'security definer, stable, empty search_path kept');
select is_empty(
  $$ select f.fn || ' ' || r.rolname from (values ('public.plate_costs(date)'), ('public.plate_margins_pct()'),
       ('public.recipe_cost_at(uuid, date)')) f (fn) cross join (values ('anon'), ('service_role')) r (rolname)
      where has_function_privilege(r.rolname, f.fn, 'execute') $$, 'anon and service_role still cannot execute them');
select is_empty(
  $$ select 1 where has_function_privilege('authenticated', 'app.price_variance_payload(uuid, uuid, uuid, numeric, numeric, integer, numeric, numeric)', 'execute') $$,
  'the payload builder stays closed to API roles');

select * from finish();
rollback;
