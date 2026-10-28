-- UX plan B12 (docs/plans/2026-10-28-ux-flows.md, P1-10; migration 20261107100100_plate_breakdown.sql): public.plate_breakdown(),
-- one plate's cost split by line, largest first, with each line's share of the plate in percent. Owner and admin also get
-- the euro figures; the chef gets percentages only (variant V6, ADR-008) and not one euro key or figure; the waiter nothing.
-- Fixture as 058 (fake data): beef 10 EUR/kg, flour 1,50, bread 0,30, salt unpriced. Plate 4 costs 2,0567 =
-- stew 1,6667 + bread 0,30 + polenta 0,09; price 12,00 VAT included (10), target GP 70. Plate 5 has an unpriced salt line.
-- Plate 41 has no sale price. Key 2 is a batch recipe, key 3 a sub-recipe.
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

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


-- Helpers for this file ----------------------------------------------------------------------------------------------
-- Every key of a jsonb document, at any depth.
create function pg_temp.keys(j jsonb) returns setof text language sql as $$
  select k from (
    select jsonb_object_keys(j) as k where jsonb_typeof(j) = 'object'
    union all
    select pg_temp.keys(v) from jsonb_each(case when jsonb_typeof(j) = 'object' then j else '{}'::jsonb end) e(k, v)
    union all
    select pg_temp.keys(v) from jsonb_array_elements(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end) a(v)
  ) x $$;
create function pg_temp.names(j jsonb) returns text language sql as $$
  select string_agg(l -> 'target' ->> 'name', ' | ' order by o) from jsonb_array_elements(j -> 'lines') with ordinality t(l, o) $$;
create function pg_temp.shares(j jsonb) returns text language sql as $$
  select string_agg(coalesce(l ->> 'sharePct', '-'), ' ' order by o) from jsonb_array_elements(j -> 'lines') with ordinality t(l, o) $$;
grant execute on function pg_temp.keys(jsonb), pg_temp.names(jsonb), pg_temp.shares(jsonb) to authenticated;

-- The function: kind, search path, grants ------------------------------------------------------------------------------
select is((select p.prosecdef from pg_proc p where p.oid = 'public.plate_breakdown(uuid, date)'::regprocedure), true,
  'plate_breakdown is SECURITY DEFINER: the chef has no select on the cost tables');
select is((select p.proconfig from pg_proc p where p.oid = 'public.plate_breakdown(uuid, date)'::regprocedure), array['search_path=""'],
  'with an empty search_path');
select is((select count(*)::int from unnest(array['anon', 'service_role']) r
            where has_function_privilege(r, 'public.plate_breakdown(uuid, date)', 'execute')), 0, 'anon and service_role cannot execute it');
select is(has_function_privilege('authenticated', 'public.plate_breakdown(uuid, date)', 'execute'), true, 'authenticated can');
select is((select pg_get_functiondef('public.plate_breakdown(uuid, date)'::regprocedure) ~ 'app\.tenant_id\(\)'), true, 'the tenant comes from app.tenant_id()');
select is((select pg_get_functiondef('public.plate_breakdown(uuid, date)'::regprocedure) ~ 'app\.require_margin_reader\(\)'), true,
  'and the role gate is the margin reader (owner, admin, chef), checked first');

-- Owner ------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
create temp table own as select public.plate_breakdown(pg_temp.k(4)) as j;
grant select on own to authenticated;
select is((select pg_temp.names(j) from own), 'Spezzatino (demo) | Pane (demo) | Polenta (demo)', 'owner: the lines are sorted largest first');
select is((select pg_temp.shares(j) from own), '81.04 14.59 4.38', 'owner: each line''s share of the plate in percent');
select ok((select abs(sum((l ->> 'sharePct')::numeric) - 100) <= 0.05 from own, jsonb_array_elements(j -> 'lines') l), 'owner: the shares add up to 100 within rounding');
select is((select string_agg(l ->> 'lineCostEur', ' ' order by o) from own, jsonb_array_elements(j -> 'lines') with ordinality t(l, o)),
  '1.6667 0.3000 0.0900', 'owner: each line''s cost in euro');
select is((select (j -> 'money' ->> 'foodCostEur') from own), '2.0567', 'owner: the plate''s food cost');
select is((select j -> 'money' from own),
  (select jsonb_build_object('foodCostEur', c.food_cost_eur, 'salePriceExVatEur', c.sale_price_ex_vat_eur, 'grossMarginEur', c.gross_margin_eur)
     from public.plate_costs() c where c.recipe_key = pg_temp.k(4)),
  'owner: food cost, price without VAT and margin are the same numbers as plate_costs');
select is((select j ->> 'foodCostPct' || ' ' || (j ->> 'gpPct') || ' ' || (j ->> 'targetGpPct') from own),
  (select c.food_cost_pct::text || ' ' || c.gp_pct::text || ' ' || c.target_gp_pct::text from public.plate_costs() c where c.recipe_key = pg_temp.k(4)),
  'owner: food cost %, GP % and the target are those of plate_costs');
select is((select j ->> 'status' from own), (select m.status from public.plate_margins_pct() m where m.recipe_key = pg_temp.k(4)),
  'owner: the status is the food-cost one of plate_margins_pct (no fixed cost is read here)');
select is((select sum((l ->> 'lineCostEur')::numeric) from own, jsonb_array_elements(j -> 'lines') l), (select (j -> 'money' ->> 'foodCostEur')::numeric from own),
  'owner: the lines add up to the food cost (the engine has one answer)');
select is((select j ->> 'incomplete' from own), 'false', 'owner: a complete plate is not incomplete');
-- No fixed cost in this document (owner only, other screens).
select is((select count(*)::int from own, pg_temp.keys(j) k where k ~* 'fixed|netMargin|fullCost'), 0, 'owner: no fixed-cost key');

-- Incomplete plate, no sale price, a sub-recipe, other kinds ----------------------------------------------------------------
create temp table inc as select public.plate_breakdown(pg_temp.k(5)) as j;
grant select on inc to authenticated;
select is((select j ->> 'incomplete' from inc), 'true', 'plate 5 (unpriced salt): incomplete');
select is((select j ->> 'status' from inc), 'incomplete', 'with the status incomplete');
select is((select pg_temp.shares(j) from inc), '- -', 'no share is claimed when the plate''s cost is unknown');
select is((select pg_temp.names(j) from inc), 'Polenta (demo) | Sale grosso (demo)', 'the priced line first, the unpriced one last');
select is((select l ->> 'incomplete' from inc, jsonb_array_elements(j -> 'lines') l where l -> 'target' ->> 'name' = 'Sale grosso (demo)'), 'true', 'the unpriced line is flagged');
select is((select l ->> 'reason' from inc, jsonb_array_elements(j -> 'lines') l where l -> 'target' ->> 'name' = 'Sale grosso (demo)'),
  (select l ->> 'reason' from jsonb_array_elements(public.recipe_cost_at(pg_temp.k(5)) -> 'lines') l where (l ->> 'position') = '2'),
  'with the same reason code the cost screen uses');
select is((select l ->> 'reason' from inc, jsonb_array_elements(j -> 'lines') l where l -> 'target' ->> 'name' = 'Polenta (demo)'), null, 'a priced line has no reason');
select is((select j -> 'missingIngredientIds' from inc), '["1d000000-0000-4000-8000-00000000001d"]'::jsonb, 'the missing ingredient is named by id');
select is((select j -> 'money' ->> 'foodCostEur' from inc), null, 'the owner''s food cost of an incomplete plate is null, never 0');

create temp table noprice as select public.plate_breakdown(pg_temp.k(41)) as j;
grant select on noprice to authenticated;
select is((select pg_temp.shares(j) from noprice), '100.00', 'plate 41 (no sale price): the cost is known, so the one line is 100 %');
select is((select j -> 'reasons' from noprice), '["no_sale_price"]'::jsonb, 'and the missing price is a reason');
select is((select j ->> 'status' || ' ' || coalesce(j -> 'money' ->> 'salePriceExVatEur', '-') from noprice), 'incomplete -', 'its status is incomplete and the price without VAT is null');

select is(pg_temp.err('select public.plate_breakdown(pg_temp.k(2))'), 'P0001 recipe_not_plate', 'a batch recipe is not a plate');
select is(pg_temp.err('select public.plate_breakdown(pg_temp.k(3))'), 'P0001 recipe_not_plate', 'nor is a sub-recipe');
select is(pg_temp.err('select public.plate_breakdown(gen_random_uuid())'), 'P0002 not_found', 'an unknown key is not_found');
select is(pg_temp.err('select public.plate_breakdown(pg_temp.k(4), pg_temp.today() + 1)'), 'P0001 date_in_future', 'a future date is refused');
select is((select public.plate_breakdown(pg_temp.k(4), date '2026-08-01') ->> 'incomplete'), 'true', 'on a day before any purchase the plate is incomplete: unknown, not zero');
select is((select public.plate_breakdown(pg_temp.k(4), date '2026-08-01') ->> 'at'), '2026-08-01', 'and the day asked is echoed');
reset role;

-- Admin ------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((select public.plate_breakdown(pg_temp.k(4)) -> 'money' ->> 'foodCostEur'), '2.0567', 'admin: the euro figures too');
reset role;

-- Chef: percentages and words, never euro ---------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
create temp table cf as select public.plate_breakdown(pg_temp.k(4)) as j;
grant select on cf to authenticated;
select is((select pg_temp.names(j) from cf), 'Spezzatino (demo) | Pane (demo) | Polenta (demo)', 'chef: the same order, largest first');
select is((select pg_temp.shares(j) from cf), '81.04 14.59 4.38', 'chef: the same shares');
select is((select count(*)::int from cf, pg_temp.keys(j) k where k ~* 'eur$|^money$|fixed|price|margin(?!s)'), 0, 'chef: no key anywhere is a euro figure, the money block, a price or a margin');
select is((select count(*)::int from cf, pg_temp.keys(j) k where k ~* 'eur'), 0, 'chef: no key mentions eur at all');
select is((select j::text ~ '(?<![0-9.])(2\.0567|10\.9091|8\.8524|1\.6667|0\.3000|0\.0900)(?![0-9])' from cf), false, 'chef: none of the euro figures appears as a value');
select is((select j::text ~ '(?<![0-9.])(2\.0567|10\.9091|8\.8524|1\.6667|0\.3000|0\.0900)(?![0-9])' from own), true,
  'control: the same pattern does find the euro figures in the owner''s document');
select is((select j ->> 'foodCostPct' || ' ' || (j ->> 'gpPct') || ' ' || (j ->> 'targetGpPct') || ' ' || (j ->> 'status' ) from cf),
  (select m.food_cost_pct::text || ' ' || m.gp_pct::text || ' ' || (select rp.target_gp_pct::text from public.recipe_price rp where rp.recipe_id = pg_temp.v(4, 1)) || ' ' || m.status
     from public.plate_margins_pct() m where m.recipe_key = pg_temp.k(4)),
  'chef: the percentages are those plate_margins_pct gives');
select is((select (public.plate_breakdown(pg_temp.k(5)) -> 'lines' -> 1 ->> 'incomplete')), 'true', 'chef: an unpriced line is flagged too');
select is((select count(*)::int from jsonb_array_elements(public.plate_breakdown(pg_temp.k(5)) -> 'lines') l where l ? 'lineCostEur'), 0, 'chef: an incomplete plate shows no line cost either');
reset role;

-- Chef: today only, enforced here and not only by the route -----------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((select public.plate_breakdown(pg_temp.k(4), pg_temp.today()) ->> 'name'), 'Spezzatino con polenta (demo)', 'chef: the venue''s today is allowed');
select is((select public.plate_breakdown(pg_temp.k(4), null) ->> 'name'), 'Spezzatino con polenta (demo)', 'chef: no date (now) is allowed');
select is(pg_temp.err('select public.plate_breakdown(pg_temp.k(4), pg_temp.today() - 1)'), '42501 chef_reads_today_only', 'chef: yesterday is refused with 42501 chef_reads_today_only');
select is(pg_temp.err('select public.plate_breakdown(pg_temp.k(4), date ''2026-08-01'')'), '42501 chef_reads_today_only', 'chef: any past day is refused');
select is(pg_temp.err('select public.plate_breakdown(pg_temp.k(4), pg_temp.today() + 1)'), '42501 chef_reads_today_only', 'chef: tomorrow is refused by the role rule, not told apart from a past day');
reset role;
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select public.plate_breakdown(pg_temp.k(4), pg_temp.today() - 1) ->> 'at'), (pg_temp.today() - 1)::text, 'owner: a past day is still allowed');
reset role;

-- Waiter and strangers ---------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.err('select public.plate_breakdown(pg_temp.k(4))'), '42501 permission denied: margins need owner, admin or chef', 'waiter: refused with 42501');
select set_config('request.jwt.claims', '', true);
select is(substr(pg_temp.err('select public.plate_breakdown(pg_temp.k(4))'), 1, 5), '42501', 'no session: refused');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err('select public.plate_breakdown(pg_temp.k(4))'), 'P0002 not_found', 'another tenant''s owner: not_found, not a leak');
reset role;

select * from finish();
rollback;
