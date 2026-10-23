-- M8 step 5 (V6.1, Q16 = V6): the chef reads no euro cost anywhere, and the waiter nothing. A catalogue
-- scan over everything the chef can read: every public relation, every public function whose name
-- speaks of cost, margin or price. Fixture: one row in every public table (as 004), so the scan is not
-- vacuous. The only cost-derived read left to the chef is plate_margins_pct (percentages), and the
-- only price he reads is recipe_price (sale_price, target_gp_pct), which M7 granted him.
-- Fixed costs are the owner's alone: the admin sees none of them either.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

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
-- M1 master data (one row per table).
insert into public.location (tenant_id, name) values ('11111111-1111-4111-8111-111111111111', 'Cella');
insert into public.ingredient (id, tenant_id, name, base_unit, allergens) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg', '{}');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903');
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty,
                                  pack_unit, last_price)
  values ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a',
          '1a000000-0000-4000-8000-00000000001a', 'MAN-1', 1, 'kg', 12.5);

-- M2 invoices.
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, original_filename)
  values ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
          'application/pdf', 2048, 'fattura.pdf');

-- M4 cost centres.
insert into public.cost_centre (id, tenant_id, name)
  values ('c5000000-0000-4000-8000-0000000000c5', '11111111-1111-4111-8111-111111111111', 'Pulizie');

-- M3 extracted invoice lines, with the M4 review states: a mapped line (position 1), a non-stock
-- line (position 2), and a split line with one child (position 3).
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
                                 line_amount, field_confidence, extracted, unit, suggested_unit,
                                 ingredient_id, supplier_item_id, suggested_ingredient_id,
                                 suggested_supplier_item_id, mapping_source, credit_qty,
                                 corrected_fields, reviewed_at)
  values ('a2000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
          'e1000000-0000-4000-8000-0000000000e1', 1, 'Manzo fesa', 2, 12.75, 25.5, '{}', '{}',
          'kg', 'kg', '1a000000-0000-4000-8000-00000000001a',
          '51000000-0000-4000-8000-000000000051', '1a000000-0000-4000-8000-00000000001a',
          '51000000-0000-4000-8000-000000000051', 'auto', 1, '{qty}', now());
insert into public.invoice_line (tenant_id, invoice_id, position, raw_description, qty, unit_price,
                                 line_amount, field_confidence, extracted, is_stock, cost_centre_id)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', 2,
          'Detersivo piatti', 1, 8, 8, '{}', '{}', false, 'c5000000-0000-4000-8000-0000000000c5');
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
                                 line_amount, field_confidence, extracted, split_at)
  values ('a2000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111',
          'e1000000-0000-4000-8000-0000000000e1', 3, 'Olio', 3, 10, 30, '{}', '{}', now());
insert into public.invoice_line (tenant_id, invoice_id, position, sub_position, parent_line_id,
                                 raw_description, qty, unit_price, line_amount, field_confidence,
                                 extracted)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1', 3, 1,
          'a2000000-0000-4000-8000-0000000000a3', 'Olio', 1, 10, 10, '{}', '{}');

-- M5 review fix round 3: a duplicate decision (owner/admin only). Needs a second invoice.
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, original_filename)
  values ('e2000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/e2000000-0000-4000-8000-0000000000e2.pdf',
          'application/pdf', 2048, 'fattura2.pdf');
insert into public.invoice_duplicate_decision (tenant_id, invoice_id, other_id, decided_by)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1',
          'e2000000-0000-4000-8000-0000000000e2', (select id from public.app_user limit 1));

-- M5 audit events (owner/admin only).
insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'invoice', 'e1000000-0000-4000-8000-0000000000e1',
          'invoice.approved', '{"status":"approved"}', (select id from public.app_user limit 1));

-- M6 alert (the owner reads it; a waiter has no policy, so nothing of it is visible to the waiter).
insert into public.alert (tenant_id, kind, entity_type, entity_id, business_date, severity, audience_roles,
                          cost_bearing, payload)
  values ('11111111-1111-4111-8111-111111111111', 'test_alert', 'tenant',
          '11111111-1111-4111-8111-111111111111', '2026-11-02', 'info', '{owner}', false, '{}');

-- M5 stock ledger: a lot (chef-readable, no cost) and its receipt movement (owner/admin only).
insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id,
                            received_on, qty_received, base_unit, source_qty, source_unit,
                            base_factor, created_by)
  values ('10700000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
          '1a000000-0000-4000-8000-00000000001a', (select id from public.location limit 1),
          '5a000000-0000-4000-8000-00000000005a', 'a2000000-0000-4000-8000-0000000000a1',
          '2026-09-29', 2, 'kg', 2, 'kg', 1, (select id from public.app_user limit 1));
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty,
                                   unit_cost, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
          '10700000-0000-4000-8000-0000000000a1', (select id from public.location limit 1),
          'receipt', 2, 12.75, 'invoice_line', 'a2000000-0000-4000-8000-0000000000a1',
          '2026-09-29', (select id from public.app_user limit 1));

-- M5 price history and payable (owner/admin only).
insert into public.price_history (tenant_id, ingredient_id, supplier_id, supplier_item_id,
                                  invoice_line_id, unit_price, base_unit, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a',
          '5a000000-0000-4000-8000-00000000005a', '51000000-0000-4000-8000-000000000051',
          'a2000000-0000-4000-8000-0000000000a1', 12.75, 'kg', '2026-09-29',
          (select id from public.app_user limit 1));
insert into public.payable (tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount,
                            due_date, due_date_source, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1',
          '5a000000-0000-4000-8000-00000000005a', 28.05, 0, 28.05, '2026-10-29', 'supplier_terms',
          (select id from public.app_user limit 1));

-- M7 recipes: a stew batch, a plate that uses it, and the plate's price (readable by owner, admin and
-- chef under Q16 = V6; the waiter reads none of it).
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1,
   'spezzatino (demo)', (select id from public.app_user limit 1)),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1,
   'spezzatino con polenta (demo)', (select id from public.app_user limit 1));
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
                           portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e1', 1, now(), 'Spezzatino (demo)', 6, 'kg', 30, 72,
   (select id from public.app_user limit 1));
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111',
   'ec000000-0000-4000-8000-0000000000e2', 1, now(), 'Spezzatino con polenta (demo)',
   (select id from public.app_user limit 1));
insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, qty, unit, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d1', 1,
          '1a000000-0000-4000-8000-00000000001a', 5, 'kg', (select id from public.app_user limit 1));
insert into public.recipe_price (recipe_id, tenant_id, sale_price, target_gp_pct, created_by)
  values ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 12, 70,
          (select id from public.app_user limit 1));

-- M8 cost basis history and fixed costs (owner/admin only; the waiter has no policy).
insert into public.ingredient_cost_basis (tenant_id, ingredient_id, basis, valid_from, created_by)
  values ('11111111-1111-4111-8111-111111111111', '1a000000-0000-4000-8000-00000000001a', 'last_price',
          now(), (select id from public.app_user limit 1));
insert into public.fixed_cost_period (tenant_id, month, rent, labour, utilities, created_by)
  values ('11111111-1111-4111-8111-111111111111', '2026-10-01', 3000, 9000, 1500,
          (select id from public.app_user limit 1));


-- M8 price_variance alert (cost-bearing, owner only; the kind is registered by step 7, so here only if absent).
insert into app.alert_kind (kind, cost_bearing, default_severity, default_audience)
  values ('price_variance', true, 'warning', '{owner}') on conflict do nothing;
insert into public.alert (tenant_id, kind, entity_type, entity_id, business_date, severity, audience_roles,
                          cost_bearing, payload)
  values ('11111111-1111-4111-8111-111111111111', 'price_variance', 'price_history',
          '11111111-1111-4111-8111-111111111111', '2026-11-02', 'warning', '{owner}', true,
          '{"change_pct":11}');

select is_empty(
  $$ select t.tablename::text from pg_tables t
      where t.schemaname = 'public'
        and (xpath('/row/c/text()',
               query_to_xml(format('select count(*) as c from public.%I', t.tablename),
                            false, true, '')))[1]::text::int = 0 $$,
  'every public table has a fixture row (extend the fixture when adding a table)');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate;
  return state;
end
$$;
-- The row count of a public relation as the current role sees it; a permission error counts as 0.
create function pg_temp.seen(rel text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute format('select count(*) from public.%I', rel) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end
$$;
-- Every public function whose name speaks of cost, margin or price, called with null arguments (the
-- role check comes first in each): name -> sqlstate.
create temporary table fn_result (fn text, sqlstate text);
grant all on fn_result to authenticated;
create function pg_temp.call_cost_functions() returns void language plpgsql as $$
declare
  f record;
  state text;
begin
  delete from fn_result;
  for f in
    select p.proname, p.pronargs from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname ~* '(cost|margin|price)'
       and p.proname <> 'plate_margins_pct'
     order by p.proname
  loop
    begin
      execute format('select * from public.%I(%s)', f.proname,
        array_to_string(array_fill('null'::text, array[f.pronargs]), ', '));
      state := 'ok';
    exception when others then
      get stacked diagnostics state = returned_sqlstate;
    end;
    insert into fn_result values (f.proname, state);
  end loop;
end
$$;
create temporary table chef_visible_column (relation text, column_name text);
create temporary table waiter_visible_column (relation text, column_name text);
create temporary table admin_visible_column (relation text, column_name text);
grant all on chef_visible_column, waiter_visible_column, admin_visible_column to authenticated;
create function pg_temp.collect(target text) returns void language plpgsql as $$
declare
  rel record;
begin
  for rel in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
       and has_table_privilege('authenticated', c.oid, 'select')
  loop
    if pg_temp.seen(rel.relname) > 0 then
      execute format('insert into %I select %L, a.attname from pg_attribute a
         where a.attrelid = format(%L, %L)::regclass and a.attnum > 0 and not a.attisdropped
           and has_column_privilege(%L, a.attrelid, a.attnum, %L)',
        target, rel.relname, 'public.%I', rel.relname, 'authenticated', 'select');
    end if;
  end loop;
end
$$;
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text), pg_temp.seen(text),
  pg_temp.call_cost_functions(), pg_temp.collect(text) to authenticated;

-- The chef.
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select pg_temp.collect('chef_visible_column');
select pg_temp.call_cost_functions();
reset role;

select isnt_empty($$ select 1 from chef_visible_column $$, 'the chef reads rows somewhere (the scan is not vacuous)');
select isnt_empty($$ select 1 from chef_visible_column where relation = 'recipe_price' and column_name = 'sale_price' $$,
  'the chef reads recipe_price.sale_price (the allow-list entry is real)');
select is_empty(
  $$ select relation || '.' || column_name from chef_visible_column
      where column_name ~* '(cost|margin|price|prezz|gp_pct|_eur$|amount|total|importo)'
        and (relation, column_name) not in (('recipe_price', 'sale_price'), ('recipe_price', 'target_gp_pct')) $$,
  'V6.1: no chef-readable column has a cost-like name, except recipe_price.sale_price and target_gp_pct');
select is_empty(
  $$ select relation from chef_visible_column
      where relation in ('price_history', 'stock_movement', 'supplier_item', 'payable', 'invoice_line',
                         'ingredient_cost_basis', 'fixed_cost_period', 'alert', 'audit_event') $$,
  'the chef reads no row of any cost table (and no alert of the fixture, no audit event)');
select is((select count(*)::int from chef_visible_column where relation = 'alert'), 0,
  'the cost-bearing price_variance alert is invisible to the chef');

set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.seen('price_history'), 0::bigint, 'chef: price_history 0 rows');
select is(pg_temp.seen('stock_movement'), 0::bigint, 'chef: stock_movement 0 rows');
select is(pg_temp.seen('supplier_item'), 0::bigint, 'chef: supplier_item 0 rows');
select is(pg_temp.seen('payable'), 0::bigint, 'chef: payable 0 rows');
select is(pg_temp.seen('invoice_line'), 0::bigint, 'chef: invoice_line 0 rows');
select is(pg_temp.seen('ingredient_cost_basis'), 0::bigint, 'chef: ingredient_cost_basis 0 rows');
select is(pg_temp.seen('fixed_cost_period'), 0::bigint, 'chef: fixed_cost_period 0 rows');
select is((select count(*)::int from public.alert where kind = 'price_variance'), 0, 'chef: no price_variance alert');
select is(pg_temp.err('select * from public.v_recipe_cost'), '42501', 'chef: v_recipe_cost is a permission error');
reset role;
select is((select array_agg(fn order by fn collate "C") from fn_result),
  array['cost_settings', 'enter_fixed_costs', 'fixed_cost_status', 'ingredient_costs', 'plate_costs',
        'raw_waste_costs', 'recipe_cost_at', 'recipe_costs', 'set_ingredient_cost_basis', 'update_cost_settings'],
  'the cost-named functions are exactly the M8 ones plus M12''s raw_waste_costs (a new one without a case here fails this test)');
select is_empty($$ select fn from fn_result where sqlstate <> '42501' $$,
  'V6.1: every one of them raises 42501 for the chef');
select is_empty(
  $$ select a from unnest((select proargnames from pg_proc where oid = 'public.plate_margins_pct()'::regprocedure)) a
      where a !~ '^(recipe_key|food_cost_pct|gp_pct|status)$' $$,
  'V6.2: plate_margins_pct has only the key, food_cost_pct, gp_pct and status');
select is_empty(
  $$ select a from unnest((select proargnames from pg_proc where oid = 'public.plate_margins_pct()'::regprocedure)) a
      where a ~ '_eur$' $$, 'and no column ends in _eur');
set local role authenticated;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err('select * from public.plate_margins_pct()'), 'ok', 'the chef can call plate_margins_pct');
reset role;

-- The waiter: nothing.
set local role authenticated;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select pg_temp.collect('waiter_visible_column');
select pg_temp.call_cost_functions();
select is(pg_temp.err('select * from public.plate_margins_pct()'), '42501', 'waiter: plate_margins_pct is refused');
select is(pg_temp.err('select * from public.v_recipe_cost'), '42501', 'waiter: v_recipe_cost is refused');
select is(pg_temp.seen('recipe_price') + pg_temp.seen('ingredient_cost_basis') + pg_temp.seen('fixed_cost_period')
  + pg_temp.seen('price_history') + pg_temp.seen('alert'), 0::bigint, 'waiter: 0 rows in the price, cost and alert tables');
reset role;
select is_empty(
  $$ select relation || '.' || column_name from waiter_visible_column
      where column_name ~* '(cost|margin|price|prezz|gp_pct|_eur$|amount|total|importo)' $$,
  'waiter: no readable column has a cost-like name');
select is_empty($$ select fn from fn_result where sqlstate <> '42501' $$, 'waiter: every cost function raises 42501');

-- The admin reads costs, but no fixed cost.
set local role authenticated;
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select pg_temp.collect('admin_visible_column');
reset role;
select is_empty($$ select relation from admin_visible_column where relation = 'fixed_cost_period' $$,
  'admin: fixed_cost_period is invisible');
set local role authenticated;
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.err('select public.fixed_cost_status()'), '42501', 'admin: fixed_cost_status is refused');
select is(pg_temp.err('select public.enter_fixed_costs(date_trunc(''month'', now())::date, 1, 1, 1)'), '42501',
  'admin: enter_fixed_costs is refused');
select is(pg_temp.err('select * from public.plate_costs()'), 'ok', 'admin: plate_costs works');
reset role;

select * from finish();
rollback;
