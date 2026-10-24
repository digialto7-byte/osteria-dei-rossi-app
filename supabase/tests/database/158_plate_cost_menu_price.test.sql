-- M17 step 8: app.plate_cost_rows takes the price and VAT rate of the active menu item that maps a plate (M8 plan §3.8
-- contract; M17 plan §3.1.8, Q74 default), at the row in force on the date, and falls back to recipe_price and
-- sale_vat_pct when no item maps the plate or none was in force yet. Plate 1 (mapped in the cases below) and plate 2
-- (never mapped) are costed together: only the mapped one changes. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Farina di mais (demo)', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  values ('00000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-0000000000f1.pdf',
          'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price, line_amount, field_confidence, extracted)
  values ('a2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-0000000000f1', 1,
          'Acquisto demo', 1, 1.5, 1.5, '{}', '{}');
insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1b000000-0000-4000-8000-00000000001b', '5a000000-0000-4000-8000-00000000005a',
          'a2000000-0000-4000-8000-000000000001', 1.5, 'kg', '2026-09-01', 'a1000000-0000-4000-8000-00000000000a');

-- Two plates: food cost 3,00 each (2 kg of flour at 1,50), recipe price 12,00 and target GP 70.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto uno (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'piatto due (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-000000000101', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-000000000001', 1, '2026-01-01T00:00Z', 'Piatto uno (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-000000000201', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-000000000002', 1, '2026-01-01T00:00Z', 'Piatto due (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-000000000101', 1, '1b000000-0000-4000-8000-00000000001b', 2, 'kg', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-000000000201', 1, '1b000000-0000-4000-8000-00000000001b', 2, 'kg', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by) values
  ('ed000000-0000-4000-8000-000000000101', '11111111-1111-4111-8111-111111111111', 12, 70, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-000000000201', '11111111-1111-4111-8111-111111111111', 12, 70, 'a1000000-0000-4000-8000-00000000000a');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
create function pg_temp.k(n int) returns uuid language sql immutable as $$ select ('ec000000-0000-4000-8000-00000000000' || n)::uuid $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Europe/Rome')::date $$;
-- sale price, VAT, price ex VAT, GP % of a plate as the owner sees them on a date (null = now).
create function pg_temp.row_of(n int, p_date date default null) returns text language sql as $$
  select c.sale_price_eur::text || ' ' || c.vat_pct::text || ' ' || c.sale_price_ex_vat_eur::text || ' ' || c.gp_pct::text
    from public.plate_costs(p_date) c where c.recipe_key = pg_temp.k(n) $$;
create function pg_temp.menu_item(p_id uuid, p_name text, p_key uuid, p_active boolean default true) returns void language sql as $$
  insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, is_active, created_by, updated_by)
  values (p_id, '11111111-1111-4111-8111-111111111111', p_name, 'Secondi', 'secondi', p_key, p_active,
          'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a') $$;
create function pg_temp.mprice(p_id uuid, p_price numeric, p_vat numeric, p_from timestamptz) returns void language sql as $$
  insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  values ('11111111-1111-4111-8111-111111111111', p_id, p_price, p_vat, p_from, 'a1000000-0000-4000-8000-00000000000a') $$;

-- Signature and shape are untouched (captured from main before this step).
select is((select pg_get_function_result(p.oid) from pg_proc p where p.proname = 'plate_cost_rows' and p.pronamespace = 'app'::regnamespace),
  'TABLE(recipe_key uuid, name text, version integer, food_cost numeric, fixed_cost numeric, full_cost numeric, sale_price numeric, vat_pct numeric, sale_price_ex_vat numeric, gross_margin numeric, net_margin numeric, food_cost_pct numeric, gp_pct numeric, target_gp_pct numeric, fixed_cost_allocated boolean, status text, reasons text[], missing_ingredient_ids uuid[])',
  'the output columns are identical to the M8 definition');
select is((select pg_get_function_identity_arguments(p.oid) from pg_proc p where p.proname = 'plate_cost_rows' and p.pronamespace = 'app'::regnamespace),
  'p_tenant uuid, p_keys uuid[], p_date date, p_include_fixed boolean', 'and the arguments');
select is((select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""'] from pg_proc p where p.proname = 'plate_cost_rows' and p.pronamespace = 'app'::regnamespace),
  true, 'security definer, stable, empty search_path');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_function_privilege(r, 'app.plate_cost_rows(uuid, uuid[], date, boolean)', 'execute')), 0, 'no API role executes it');

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

-- No menu item: the recipe price and the tenant VAT setting (the M8 path).
select is(pg_temp.row_of(1), '12.00 10 10.9091 72.5000'::text, 'plate 1, no menu item: 12,00 at 10 % (recipe price)');
select is(pg_temp.row_of(2), '12.00 10 10.9091 72.5000'::text, 'plate 2, no menu item: the same');

-- An unmapped item changes nothing.
select pg_temp.menu_item('11000000-0000-4000-8000-0000000000aa', 'Acqua (demo)', null);
select pg_temp.mprice('11000000-0000-4000-8000-0000000000aa', 2, 10, now() - interval '10 days');
select is(pg_temp.row_of(1), '12.00 10 10.9091 72.5000'::text, 'an unmapped item does not affect plate 1');
select is(pg_temp.row_of(2), '12.00 10 10.9091 72.5000'::text, 'nor plate 2');

-- An active item on plate 1: 14,00 at 22 % since ten days ago.
select pg_temp.menu_item('11000000-0000-4000-8000-000000000001', 'Piatto uno (demo)', pg_temp.k(1));
select pg_temp.mprice('11000000-0000-4000-8000-000000000001', 14, 22, now() - interval '10 days');
select is(pg_temp.row_of(1), '14.00 22 11.4754 73.8571'::text, 'plate 1 with a menu item: 14,00 at 22 %, ex VAT 11,4754, GP 73,8571');
select is(pg_temp.row_of(2), '12.00 10 10.9091 72.5000'::text, 'plate 2 (not on the menu) keeps the recipe price');
select is((select c.sale_price_eur from public.plate_costs() c where c.recipe_key = pg_temp.k(1)), 14.00::numeric, 'sale_price_eur is the menu price');
select is((select c.gross_margin_eur::text || ' ' || c.food_cost_pct::text from public.plate_costs() c where c.recipe_key = pg_temp.k(1)), '8.4754 26.1429',
  'gross margin and food cost % follow the menu price');
select is((select c.status from public.plate_costs() c where c.recipe_key = pg_temp.k(1)), 'fixed_cost_unallocated', 'and the status (no fixed cost entered; the target GP of 70 is met)');

-- recipe_cost_at (the single-plate read) agrees.
select is((select (public.recipe_cost_at(pg_temp.k(1), null) -> 'plate' ->> 'salePriceEur') || ' ' || (public.recipe_cost_at(pg_temp.k(1), null) -> 'plate' ->> 'vatPct')), '14.00 22',
  'recipe_cost_at shows the menu price and VAT of the plate');

-- History: a new price from local midnight today (16,00 at 22 %); the day before still has 14,00.
select pg_temp.mprice('11000000-0000-4000-8000-000000000001', 16, 22, date_trunc('day', now() at time zone 'Europe/Rome') at time zone 'Europe/Rome');
select is(pg_temp.row_of(1), '16.00 22 13.1148 77.1250'::text, 'plate_costs() takes the newest row (16,00)');
select is(pg_temp.row_of(1, pg_temp.today() - 1), '14.00 22 11.4754 73.8571'::text, 'plate_costs(yesterday) still takes 14,00');
select is(pg_temp.row_of(1, pg_temp.today()), '16.00 22 13.1148 77.1250'::text, 'plate_costs(today) takes 16,00');
select is(pg_temp.row_of(1, pg_temp.today() - 20), '12.00 10 10.9091 72.5000'::text, 'before the first menu price: the recipe price again (nothing was on the menu yet)');
select is(pg_temp.row_of(2, pg_temp.today() - 1), '12.00 10 10.9091 72.5000'::text, 'plate 2 is not affected on any date');

-- The chef's percentages equal the owner's.
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((select m.gp_pct::text || ' ' || m.food_cost_pct::text || ' ' || m.status from public.plate_margins_pct() m where m.recipe_key = pg_temp.k(1)), '77.1250 22.8750 ok',
  'the chef''s plate_margins_pct uses the menu price (GP 77,125, food cost 22,875)');
select is((select m.gp_pct::text from public.plate_margins_pct() m where m.recipe_key = pg_temp.k(2)), '72.5000', 'and the recipe price for plate 2');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select c.gp_pct::text from public.plate_costs() c where c.recipe_key = pg_temp.k(1)), '77.1250', 'the owner''s GP is the same figure');

-- Deactivating the item returns the plate to the recipe price and the VAT setting, for every date.
update public.menu_item set is_active = false where id = '11000000-0000-4000-8000-000000000001';
select is(pg_temp.row_of(1), '12.00 10 10.9091 72.5000'::text, 'a deactivated item: back to 12,00 at 10 %');
select is(pg_temp.row_of(1, pg_temp.today() - 1), '12.00 10 10.9091 72.5000'::text, 'and for yesterday too (the item''s active state is the current one)');

-- A second active item for the same key cannot exist (index), so the choice is unambiguous; a new item takes over.
select pg_temp.menu_item('11000000-0000-4000-8000-000000000002', 'Piatto uno bis (demo)', pg_temp.k(1));
select pg_temp.mprice('11000000-0000-4000-8000-000000000002', 13, 4, now() - interval '1 day');
select is(pg_temp.row_of(1), '13.00 4 12.5000 76.0000'::text, 'a new active item on the plate: 13,00 at 4 %');
-- An item whose only price starts in the future is not in force yet: the recipe price.
update public.menu_item set is_active = false where id = '11000000-0000-4000-8000-000000000002';
select pg_temp.menu_item('11000000-0000-4000-8000-000000000003', 'Piatto uno ter (demo)', pg_temp.k(1));
select pg_temp.mprice('11000000-0000-4000-8000-000000000003', 20, 22, now() + interval '2 days');
select is(pg_temp.row_of(1), '12.00 10 10.9091 72.5000'::text, 'an item with only a future price: the recipe price');
-- A price of 0 on the menu makes the plate incomplete (no sale price), as a zero recipe price does.
update public.menu_item set is_active = false where id = '11000000-0000-4000-8000-000000000003';
select pg_temp.menu_item('11000000-0000-4000-8000-000000000004', 'Piatto uno quater (demo)', pg_temp.k(1));
select pg_temp.mprice('11000000-0000-4000-8000-000000000004', 0, 10, now() - interval '1 day');
select is((select c.status || ' ' || c.reasons::text from public.plate_costs() c where c.recipe_key = pg_temp.k(1)), 'incomplete {no_sale_price}', 'a menu price of 0: incomplete, no_sale_price');
-- Roles are unchanged.
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~* '(cost|margin|price)' and p.proname <> 'plate_margins_pct'), 13, 'the public functions named cost, margin or price are still the 13 of 059 (plate_margins_pct aside)');

select * from finish();
rollback;
