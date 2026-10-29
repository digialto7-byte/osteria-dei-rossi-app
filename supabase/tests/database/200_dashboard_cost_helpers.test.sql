-- Owner dashboard plan (docs/plans/2026-10-28-owner-dashboard.md) step 1: app.dashboard_plates and
-- app.dashboard_worst_plates (decisions 4 and 5; founder answers Q110, Q111 and Q112 defaults).
-- Fixture, tenant A, all prices VAT included at the default 10 %, food cost in EUR (ingredient "Base" costs 1.00 per kg):
--   P1 Tagliatelle  11.00 food 4.00 target 70 -> GP 60 gap -10      P4 Zuppa      8.80 food 2.40 target 80 -> GP 70 gap -10
--   P3 Bruschetta    5.50 food 2.00 target 65 -> GP 60 gap  -5      P6 Gnocchi    9.90 food 1.80 target 75 -> GP 80 gap +5
--   P2 Spezzatino   22.00 food 5.00 target 70 -> GP 75 gap  +5      P5 Tiramisu   6.60 food 1.20 no target   -> GP 80
--   P7 Ossobuco     15.40 an ingredient with no price: incomplete   P8 Vecchio piatto: inactive, never listed
-- Overall = (4 + 2.4 + 2 + 1.8 + 5 + 1.2) / (10 + 8 + 5 + 9 + 20 + 6) * 100 = 16.40 / 58.00 = 28.28.
-- Tenant B has one incomplete plate; tenant C has nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115'),
  ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222220');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Base (fixture)', 'kg'),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Senza prezzo (fixture)', 'kg'),
  ('1c000000-0000-4000-8000-00000000001c', '22222222-2222-4222-8222-222222222222', 'Senza prezzo B (fixture)', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Uno (demo)', 'IT12345678903'),
  ('5b000000-0000-4000-8000-00000000005b', '11111111-1111-4111-8111-111111111111', 'Fornitore Due (demo)', 'IT00000000000');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  values ('00000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-0000000000f1.pdf',
          'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
  values ('a2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000f1', 1,
          'Acquisto demo', 1, 1, 1, '{}', '{}');
insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', '5a000000-0000-4000-8000-00000000005a',
          'a2000000-0000-4000-8000-000000000001', 1.00, 'kg', '2026-09-01', 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.k(n int) returns uuid language sql immutable as $$
  select ('ec000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- A plate of tenant t with one line: qty kg of an ingredient, a sale price (VAT included) and a target (null = none).
create function pg_temp.plate(t uuid, n int, p_name text, p_ing uuid, p_qty numeric, p_sale numeric, p_target numeric)
  returns void language plpgsql as $$
declare
  v_owner uuid := (select u.id from public.app_user u where u.tenant_id = t and u.role = 'owner');
begin
  insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
    values (pg_temp.k(n), t, 'plate', 1, lower(p_name), v_owner);
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by)
    values (pg_temp.k(n + 1000), t, pg_temp.k(n), 1, '2026-01-01T00:00Z', p_name, v_owner);
  insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, yield_factor, created_by)
    values (t, pg_temp.k(n + 1000), 1, p_ing, p_qty, 'kg', 1, v_owner);
  if p_sale is not null then
    insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by)
      values (pg_temp.k(n + 1000), t, p_sale, p_target, v_owner);
  end if;
end
$$;
create function pg_temp.a() returns uuid language sql as $$ select '11111111-1111-4111-8111-111111111111'::uuid $$;
create function pg_temp.base() returns uuid language sql as $$ select '1a000000-0000-4000-8000-00000000001a'::uuid $$;
create function pg_temp.unpriced() returns uuid language sql as $$ select '1b000000-0000-4000-8000-00000000001b'::uuid $$;

select pg_temp.plate(pg_temp.a(), 1, 'Tagliatelle (fixture)', pg_temp.base(), 4, 11.00, 70);
select pg_temp.plate(pg_temp.a(), 2, 'Spezzatino (fixture)', pg_temp.base(), 5, 22.00, 70);
select pg_temp.plate(pg_temp.a(), 3, 'Bruschetta (fixture)', pg_temp.base(), 2, 5.50, 65);
select pg_temp.plate(pg_temp.a(), 4, 'Zuppa (fixture)', pg_temp.base(), 2.4, 8.80, 80);
select pg_temp.plate(pg_temp.a(), 5, 'Tiramisù (fixture)', pg_temp.base(), 1.2, 6.60, null);
select pg_temp.plate(pg_temp.a(), 6, 'Gnocchi (fixture)', pg_temp.base(), 1.8, 9.90, 75);
select pg_temp.plate(pg_temp.a(), 7, 'Ossobuco (fixture)', pg_temp.unpriced(), 1, 15.40, 70);
select pg_temp.plate(pg_temp.a(), 8, 'Vecchio piatto (fixture)', pg_temp.base(), 1, 10.00, null);
update public.recipe_key set is_active = false where id = pg_temp.k(8);
select pg_temp.plate('22222222-2222-4222-8222-222222222222', 21, 'Piatto B (fixture)', '1c000000-0000-4000-8000-00000000001c', 1, 10.00, 70);

create function pg_temp.worst(t uuid) returns jsonb language sql as $$ select app.dashboard_plates(t) -> 'plates' -> 'worst' $$;
create function pg_temp.keys(j jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((e.v ->> 'recipeKey')::uuid order by e.n), '{}') from jsonb_array_elements(j) with ordinality e(v, n) $$;
create function pg_temp.row_of(n int) returns jsonb language sql as $$
  select e from jsonb_array_elements(pg_temp.worst(pg_temp.a())) e where (e ->> 'recipeKey')::uuid = pg_temp.k(n) $$;

-- The constant and the privileges ----------------------------------------------------------------------------------------
select is(app.dashboard_worst_plates(), 5, 'the worst list holds 5 plates');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
            and p.proname in ('dashboard_plates', 'dashboard_worst_plates')), 2, 'both helpers exist');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r, pg_proc p
            where p.pronamespace = 'app'::regnamespace and p.proname in ('dashboard_plates', 'dashboard_worst_plates')
              and has_function_privilege(r, p.oid, 'execute')), 0, 'no API role can execute either helper');
select is((select p.prosecdef from pg_proc p where p.oid = 'app.dashboard_plates(uuid)'::regprocedure), true, 'dashboard_plates is SECURITY DEFINER (it calls the closed plate engine)');
select is((select p.proconfig from pg_proc p where p.oid = 'app.dashboard_plates(uuid)'::regprocedure), array['search_path=""'], 'with an empty search_path');

-- Food cost overall ------------------------------------------------------------------------------------------------------
select is(app.dashboard_plates(pg_temp.a()) -> 'foodCost' ->> 'overallPct', '28.28', 'overall food cost: 16.40 / 58.00, each plate once, 2 decimals');
select is((app.dashboard_plates(pg_temp.a()) -> 'foodCost' ->> 'platesCounted')::int, 6, 'six complete plates are counted');
select is((app.dashboard_plates(pg_temp.a()) -> 'foodCost' ->> 'platesIncomplete')::int, 1, 'one incomplete plate');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(app.dashboard_plates(pg_temp.a())) k), array['foodCost', 'plates'], 'top-level keys');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(app.dashboard_plates(pg_temp.a()) -> 'foodCost') k),
  array['overallPct', 'platesCounted', 'platesIncomplete'], 'foodCost keys');

-- Ranking ----------------------------------------------------------------------------------------------------------------
select is(pg_temp.keys(pg_temp.worst(pg_temp.a())), array[pg_temp.k(1), pg_temp.k(4), pg_temp.k(3), pg_temp.k(6), pg_temp.k(2)],
  'worst = P1, P4 (tie on -10, name order), P3, P6, P2 (tie on +5, name order); P5 is cut by the limit');
select is(pg_temp.row_of(1) - 'recipeKey', '{"name": "Tagliatelle (fixture)", "gpPct": 60.00, "gapPct": -10.00, "status": "below_target", "targetGpPct": 70.00}'::jsonb,
  'P1: GP 60, target 70, gap -10, below_target');
select is(pg_temp.row_of(2) - 'recipeKey', '{"name": "Spezzatino (fixture)", "gpPct": 75.00, "gapPct": 5.00, "status": "ok", "targetGpPct": 70.00}'::jsonb,
  'P2: GP 75, target 70, gap +5, ok');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(pg_temp.row_of(3)) k),
  array['gapPct', 'gpPct', 'name', 'recipeKey', 'status', 'targetGpPct'], 'a plate row carries only percentages (no EUR, no cost)');
select is(pg_temp.row_of(5), null, 'P5 (no target) is sixth, so the limit cuts it');
select is(pg_temp.row_of(8), null, 'the inactive plate is never listed');
select is(pg_temp.row_of(7), null, 'the incomplete plate is not ranked');

-- A plate without a target is ranked after the plates that have one (Q112 default) --------------------------------------
update public.recipe_key set is_active = false where id = pg_temp.k(2);
select is(pg_temp.keys(pg_temp.worst(pg_temp.a())), array[pg_temp.k(1), pg_temp.k(4), pg_temp.k(3), pg_temp.k(6), pg_temp.k(5)],
  'with P2 off, P5 appears last: after every plate with a target');
select is(pg_temp.row_of(5) - 'recipeKey', '{"name": "Tiramisù (fixture)", "gpPct": 80.00, "gapPct": null, "status": "ok", "targetGpPct": null}'::jsonb,
  'and has a null target and a null gap');
select is(app.dashboard_plates(pg_temp.a()) -> 'foodCost' ->> 'overallPct', '30.00', 'overall without P2: 11.40 / 38.00');
update public.recipe_key set is_active = true where id = pg_temp.k(2);

-- Incomplete list --------------------------------------------------------------------------------------------------------
select is(app.dashboard_plates(pg_temp.a()) -> 'plates' -> 'incomplete', jsonb_build_array(jsonb_build_object('recipeKey', pg_temp.k(7), 'name', 'Ossobuco (fixture)')),
  'incomplete = P7, by name, with no percentage key');
select is((app.dashboard_plates(pg_temp.a()) -> 'plates' ->> 'incompleteCount')::int, 1, 'incompleteCount 1');

-- Edges ------------------------------------------------------------------------------------------------------------------
select is(app.dashboard_plates('33333333-3333-4333-8333-333333333333'),
  '{"foodCost": {"overallPct": null, "platesCounted": 0, "platesIncomplete": 0},
    "plates": {"worst": [], "incomplete": [], "incompleteCount": 0}}'::jsonb, 'no plate at all: null, zero counts, empty lists');
select is(app.dashboard_plates('22222222-2222-4222-8222-222222222222'),
  jsonb_build_object('foodCost', '{"overallPct": null, "platesCounted": 0, "platesIncomplete": 1}'::jsonb,
    'plates', jsonb_build_object('worst', '[]'::jsonb, 'incomplete', jsonb_build_array(jsonb_build_object('recipeKey', pg_temp.k(21), 'name', 'Piatto B (fixture)')),
      'incompleteCount', 1)),
  'tenant B: all plates incomplete -> overallPct null, worst empty; and none of A''s plates');
select is((select count(*)::int from jsonb_array_elements(app.dashboard_plates('22222222-2222-4222-8222-222222222222') -> 'plates' -> 'incomplete') e
            where (e ->> 'recipeKey')::uuid = any (array[pg_temp.k(1), pg_temp.k(7)])), 0, 'tenant B does not list A''s plates');

-- More than five incomplete plates: the list is capped, the count is not -------------------------------------------------
select pg_temp.plate(pg_temp.a(), 30 + n, 'Incompleto ' || n || ' (fixture)', pg_temp.unpriced(), 1, 10.00, 70) from generate_series(1, 6) n;
select is(jsonb_array_length(app.dashboard_plates(pg_temp.a()) -> 'plates' -> 'incomplete'), 5, 'incomplete lists the first 5');
select is((app.dashboard_plates(pg_temp.a()) -> 'plates' ->> 'incompleteCount')::int, 7, 'and the count says 7');
select is((select array_agg(e ->> 'name' order by n) from jsonb_array_elements(app.dashboard_plates(pg_temp.a()) -> 'plates' -> 'incomplete') with ordinality x(e, n)),
  array['Incompleto 1 (fixture)', 'Incompleto 2 (fixture)', 'Incompleto 3 (fixture)', 'Incompleto 4 (fixture)', 'Incompleto 5 (fixture)'],
  'in name order (collate C)');

-- Fixed costs never enter ------------------------------------------------------------------------------------------------
create temp table before_fixed as select app.dashboard_plates(pg_temp.a()) as j;
insert into public.fixed_cost_period (tenant_id, month, rent, labour, utilities, created_by)
  values (pg_temp.a(), date_trunc('month', now() at time zone 'Europe/Rome')::date, 1500, 1200, 300, 'a1000000-0000-4000-8000-00000000000a');
select is(app.dashboard_plates(pg_temp.a()), (select j from before_fixed), 'a fixed-cost month changes nothing: p_include_fixed is false');
select is((select count(*)::int from jsonb_array_elements(app.dashboard_plates(pg_temp.a()) -> 'plates' -> 'worst') e where e ->> 'status' not in ('below_target', 'ok')), 0,
  'status is below_target or ok, never fixed_cost_unallocated');

-- A price unit mistake: 40 kg at 1.00 against a net price of 1.00 -> GP -3900 %. SQL does not bound it; the API must show it.
select pg_temp.plate(pg_temp.a(), 50, 'Errore di unita (fixture)', pg_temp.base(), 40, 1.10, 70);
select is(pg_temp.row_of(50) - 'recipeKey', '{"name": "Errore di unita (fixture)", "gpPct": -3900.00, "gapPct": -3970.00, "status": "below_target", "targetGpPct": 70.00}'::jsonb,
  'a plate with GP -3900 % is listed, unbounded, and ranks first');
select is((pg_temp.worst(pg_temp.a()) -> 0 ->> 'recipeKey')::uuid, pg_temp.k(50), 'it is the worst plate');
update public.recipe_key set is_active = false where id = pg_temp.k(50);

-- Plates all incomplete in A -> null overall -------------------------------------------------------------------------------
update public.recipe_key set is_active = false where id in (select pg_temp.k(n) from generate_series(1, 6) n);
select is(app.dashboard_plates(pg_temp.a()) -> 'foodCost' -> 'overallPct', 'null'::jsonb, 'only incomplete plates left -> overallPct null (not 0)');
select is(app.dashboard_plates(pg_temp.a()) -> 'plates' -> 'worst', '[]'::jsonb, 'and worst is empty');

select * from finish();
rollback;
