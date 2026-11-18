-- Opening stock, step 10 (docs/plans/2026-11-18-opening-stock.md §3.7, §5 step 10; AT6): the cost fallback in app.ingredient_unit_costs. An ingredient with no price_history row in
-- force costs the unit cost of its latest non-reversed opening movement in force (latest by effective_on, then created_at, across locations: Q13). From its first price row in
-- force the invoice price wins outright: the moving average and the last price read purchases only, and avg/last/max/purchases_used describe purchases only (O3).
-- Callers inherit the fallback: the outflow cost stamp (post_stock_outflow), count_close, the recipe costs and public.ingredient_costs. This file reads the real clock, so its
-- dates are computed from today. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
set local timezone = 'UTC';
select plan(19);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Dispensa (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Frigo 1 (demo)');
-- 1 Farina: carico then invoice (moving average). 2 Mozzarella: nothing. 3 Pomodoro: two carichi at two locations. 4 Basilico: carico then invoice (last-price basis).
-- 5 Sale grosso: carico only, for the inherited readers.
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Farina 00 (demo)', 'kg', true),
  ('1a000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Mozzarella (demo)', 'kg', true),
  ('1a000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Pomodoro pelato (demo)', 'kg', true),
  ('1a000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Basilico (demo)', 'kg', true),
  ('1a000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Sale grosso (demo)', 'kg', true);
insert into public.ingredient_cost_basis (tenant_id, ingredient_id, basis, valid_from, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-000000000004', 'last_price', '2000-01-01T00:00Z', 'a1000000-0000-4000-8000-00000000000a');
insert into public.supplier (id, tenant_id, name, vat_number) values ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore X (demo)', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf', 'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');
-- today (the business date), D = today - 5 (the invoice date), and the carico dates.
create temp table ctx as select app.business_date('11111111-1111-4111-8111-111111111111', now()) as today;
alter table ctx add column d date;
update ctx set d = today - 5;
grant select on ctx to authenticated;

create function pg_temp.act_as() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
    'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner', 'aal', 'aal1')::text, true)
$$;
-- A carico of one line at a location, through the procedures; returns the opening id.
create function pg_temp.carico(p_loc text, p_ing text, p_qty numeric, p_cost numeric, p_date date) returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform public.opening_draft_put(jsonb_build_array(jsonb_build_object('id', v_id, 'locationId', p_loc, 'ingredientId', p_ing, 'qty', p_qty, 'unitCostEur', p_cost)));
  return (public.post_opening_stock(p_loc::uuid, p_date, gen_random_uuid(),
            jsonb_build_array(jsonb_build_object('id', v_id, 'ingredientId', p_ing, 'qty', p_qty, 'unitCostEur', p_cost))) ->> 'openingId')::uuid;
end
$$;
-- A price row (what approve_invoice writes per received line), as the table owner.
create sequence pg_temp.line_seq;
create function pg_temp.price(p_ing uuid, p_price numeric, p_on date) returns void language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', v_n, 'Riga demo', 1, p_price, p_price, '{}', '{}');
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit, effective_on, created_by)
    values ('11111111-1111-4111-8111-111111111111', p_ing, '5a000000-0000-4000-8000-00000000005a', v_line, p_price, 'kg', p_on, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- The cost of one ingredient at the end of a venue day (null p_date: now), as "unit|avg|last|max|used".
create function pg_temp.cost(p_ing text, p_date date default null) returns text language sql as $$
  select coalesce(c.unit_cost::numeric(12, 4)::text, '-') || '|' || coalesce(c.avg_cost::numeric(12, 4)::text, '-') || '|' || coalesce(c.last_cost::numeric(12, 4)::text, '-')
      || '|' || coalesce(c.max_cost::numeric(12, 4)::text, '-') || '|' || c.purchases_used
    from app.ingredient_unit_costs('11111111-1111-4111-8111-111111111111', array[p_ing::uuid],
                                   case when p_date is null then null else app.venue_day_end(p_date, 'Europe/Rome') end) c
$$;
create temp table ops (label text primary key, id uuid);
grant all on ops to authenticated;
grant execute on function pg_temp.act_as(), pg_temp.carico(text, text, numeric, numeric, date) to authenticated;

set local role authenticated;
select pg_temp.act_as();
insert into ops select 'farina', pg_temp.carico('10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000001', 25, 0.8, (select today - 10 from ctx));
insert into ops select 'pom_disp', pg_temp.carico('10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000003', 10, 0.8, (select today - 20 from ctx));
insert into ops select 'pom_frigo', pg_temp.carico('10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000003', 5, 0.9, (select today - 15 from ctx));
insert into ops select 'basilico', pg_temp.carico('10000000-0000-4000-8000-0000000000a2', '1a000000-0000-4000-8000-000000000004', 1, 2, (select today - 10 from ctx));
insert into ops select 'sale', pg_temp.carico('10000000-0000-4000-8000-0000000000a1', '1a000000-0000-4000-8000-000000000005', 10, 0.8, (select today - 3 from ctx));
reset role;

-- 1. The fallback --------------------------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.cost('1a000000-0000-4000-8000-000000000001'), '0.8000|-|-|-|0',
  'an ingredient with no price_history and a Dispensa opening at 0.80 costs 0.80, with purchases_used 0 (avg, last and max stay null: they describe purchases only)');
select is(pg_temp.cost('1a000000-0000-4000-8000-000000000002'), '-|-|-|-|0', 'an ingredient with neither an invoice nor an opening keeps a null cost');
select is((select count(*)::int from app.ingredient_unit_costs('11111111-1111-4111-8111-111111111111', null, null)), 5, 'and every ingredient keeps its row (5)');

-- 2. AT6: the hand-over to the first invoice price (moving average), and the as-of read -------------------------------------------------------------------------------------
select pg_temp.price('1a000000-0000-4000-8000-000000000001', 1.10, (select d from ctx));
select is(pg_temp.cost('1a000000-0000-4000-8000-000000000001', (select d from ctx)), '1.1000|1.1000|1.1000|1.1000|1',
  'after an invoice at 1.10 dated D: at D the cost is 1.10, the moving average over that one row only (no blending with the carico)');
select is(pg_temp.cost('1a000000-0000-4000-8000-000000000001', (select d - 1 from ctx)), '0.8000|-|-|-|0', 'at D - 1 it is still the carico''s 0.80');
select is(pg_temp.cost('1a000000-0000-4000-8000-000000000001'), '1.1000|1.1000|1.1000|1.1000|1', 'and now it is the invoice price');
-- the same with a last-price basis
select pg_temp.price('1a000000-0000-4000-8000-000000000004', 3, (select d from ctx));
select is(pg_temp.cost('1a000000-0000-4000-8000-000000000004', (select d - 1 from ctx)) || ' / ' || pg_temp.cost('1a000000-0000-4000-8000-000000000004', (select d from ctx)),
  '2.0000|-|-|-|0 / 3.0000|3.0000|3.0000|3.0000|1', 'with a last-price basis the same hand-over holds: 2.00 from the carico before D, the invoice''s 3.00 from D');

-- 3. Several carichi, reversals, dates (Q13) ----------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.cost('1a000000-0000-4000-8000-000000000003'), '0.9000|-|-|-|0', 'two carichi (Dispensa 0.80 on today-20, Frigo 1 0.90 on today-15): the later one wins, 0.90');
select is(pg_temp.cost('1a000000-0000-4000-8000-000000000003', (select today - 16 from ctx)), '0.8000|-|-|-|0', 'as of today-16 only the Dispensa carico is in force: 0.80');
select is(pg_temp.cost('1a000000-0000-4000-8000-000000000003', (select today - 21 from ctx)), '-|-|-|-|0', 'as of today-21 no carico is in force: null');
set local role authenticated;
select pg_temp.act_as();
select public.reverse_opening_stock((select id from ops where label = 'pom_frigo'), 'cost_wrong');
reset role;
select is(pg_temp.cost('1a000000-0000-4000-8000-000000000003'), '0.8000|-|-|-|0', 'after reversing the Frigo 1 carico: 0.80');
select is(pg_temp.cost('1a000000-0000-4000-8000-000000000003', (select today - 15 from ctx)), '0.8000|-|-|-|0', 'a reversed row never counts, even as of a date before its reversal');
set local role authenticated;
select pg_temp.act_as();
select public.opening_draft_clear('10000000-0000-4000-8000-0000000000a2');
select public.reverse_opening_stock((select id from ops where label = 'pom_disp'), 'cost_wrong');
reset role;
select is(pg_temp.cost('1a000000-0000-4000-8000-000000000003'), '-|-|-|-|0', 'after reversing both: null again');

-- 4. The invariant (costSource is derived from it in step 16) --------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from app.ingredient_unit_costs('11111111-1111-4111-8111-111111111111', null, null) c
            where c.purchases_used = 0 and (c.unit_cost is not null)
                  <> exists (select 1 from public.stock_movement m
                              where m.ingredient_id = c.ingredient_id and m.type::text = 'opening' and m.reverses_id is null
                                and not exists (select 1 from public.stock_movement x where x.reverses_id = m.id))), 0,
  'for every ingredient with zero purchases: a non-null cost <=> a non-reversed opening row is in force (with a purchase the invoice price is the cost)');

-- 5. Inheritance (no caller changes) -----------------------------------------------------------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as();
select public.post_waste('1a000000-0000-4000-8000-000000000005', 1, 'kg', 'spoilage', '10000000-0000-4000-8000-0000000000a1', null);
select is((select string_agg(c.unit_cost_eur::text, ',') from public.ingredient_costs() c where c.ingredient_id = '1a000000-0000-4000-8000-000000000005'), '0.8000',
  'public.ingredient_costs() lists the carico cost');
reset role;
select is((select string_agg(m.unit_cost::numeric(12, 2)::text, ',') from public.stock_movement m where m.ingredient_id = '1a000000-0000-4000-8000-000000000005' and m.type::text = 'waste'),
  '0.80', 'a waste posted after the carico (post_stock_outflow) carries 0.80');
-- A plate using the salt is costed completely.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'salato (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, '2000-01-01T00:00Z', 'Salato (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d1', 1, '1a000000-0000-4000-8000-000000000005', 500, 'g', 'a1000000-0000-4000-8000-00000000000a');
set local role authenticated;
select pg_temp.act_as();
select is((select r.total_cost_eur::numeric(12, 2)::text || '|' || r.incomplete from public.recipe_costs() r where r.name = 'Salato (demo)'), '0.40|false',
  'recipe_costs: a plate with 0,5 kg of the salt costs 0,40 and is complete');
-- count_close stamps the carico cost on its count row (the count also closes Dispensa's carico window, so it comes last).
select public.count_start('monthly', '10000000-0000-4000-8000-0000000000a1');
select public.count_record_lines((select id from public.count_session where status = 'open'),
  '[{"ingredient_id": "1a000000-0000-4000-8000-000000000005", "qty": 8, "unit": "kg"}]'::jsonb);
select public.count_close((select id from public.count_session where status = 'open'));
reset role;
select is((select string_agg(m.qty::numeric(12, 2)::text || '@' || m.unit_cost::numeric(12, 2)::text, ',') from public.stock_movement m
            where m.ingredient_id = '1a000000-0000-4000-8000-000000000005' and m.type::text = 'count'), '-1.00@0.80',
  'count_close stamps 0.80 on its count row (9 kg expected, 8 counted)');

-- 6. Unchanged shape ---------------------------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int || '|' || bool_and(p.prosecdef)::text || '|' || bool_and(p.proconfig = array['search_path=""'])::text
                  || '|' || bool_or(has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))::text
                  || '|' || pg_get_function_result(min(p.oid::text)::oid)
             from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'ingredient_unit_costs'),
  '1|true|true|false|TABLE(ingredient_id uuid, base_unit base_unit, basis cost_basis, unit_cost numeric, avg_cost numeric, last_cost numeric, max_cost numeric, purchases_used integer, last_purchase_on date)',
  'app.ingredient_unit_costs: one definition, a definer with an empty search_path, no API role, the same return columns');

select * from finish();
rollback;
