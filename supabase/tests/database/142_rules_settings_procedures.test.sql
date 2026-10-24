-- M16 step 3: the audited settings procedures set_ingredient_rules, set_supplier_delivery and set_recipe_rules, and the
-- role gates require_rules_reader / require_rules_writer (plan §3.1.1, §3.1.13, §3.2). Owner and admin write; chef and
-- waiter are refused before anything is read; every change is one audit row; nothing creates a recipe version.
begin;
create extension if not exists pgtap with schema extensions;
select plan(96);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Macelleria X (demo)', 'IT12345678903'),
  ('5a000000-0000-4000-8000-0000000000b5', '22222222-2222-4222-8222-222222222222', 'Macelleria B (demo)', 'IT11111111115');
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('1a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Manzo muscolo (demo)', 'kg', true),
  ('1a000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Cipolla (demo)', 'kg', true),
  ('1a000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'l', false),
  ('1b000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Manzo B (demo)', 'kg', true);
-- Beef: item 1 (1 x 5 kg, preferred), item 2 (1 x 10 kg), item 3 (inactive); onion: item 4; tenant B beef: item 5 (preferred).
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count, pack_qty, pack_unit, is_preferred, is_active) values
  ('51000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-000000000001', 'MZ5', 1, 5, 'kg', true, true),
  ('51000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-000000000001', 'MZ10', 1, 10, 'kg', false, true),
  ('51000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-000000000001', 'MZ3', 1, 3, 'kg', false, false),
  ('51000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-000000000002', 'CI1', 1, 1, 'kg', false, true),
  ('51000000-0000-4000-8000-000000000005', '22222222-2222-4222-8222-222222222222', '5a000000-0000-4000-8000-0000000000b5', '1b000000-0000-4000-8000-000000000001', 'MB5', 1, 5, 'kg', true, true);
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('b2000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('b2000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'tagliata (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('b2000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'batch', 1, 'spezzatino b (demo)', 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch,
    shelf_life_hours, prep_time_min, min_portions, target_portions, created_by) values
  ('c2000000-0000-4000-8000-000000000011', '11111111-1111-4111-8111-111111111111', 'b2000000-0000-4000-8000-000000000001', 1, '2026-10-01T00:00Z',
   'Spezzatino (demo)', 6, 'kg', 30, 72, 60, 3, 10, 'a1000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-000000000021', '11111111-1111-4111-8111-111111111111', 'b2000000-0000-4000-8000-000000000002', 1, '2026-10-01T00:00Z',
   'Tagliata (demo)', null, null, null, null, null, null, null, 'a1000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'b2000000-0000-4000-8000-0000000000b1', 1, '2026-10-01T00:00Z',
   'Spezzatino B (demo)', 6, 'kg', 30, 72, null, null, null, 'b1000000-0000-4000-8000-00000000000b');

create temporary table outs (k text primary key, v text);
-- Runs one expression and returns its text, or 'SQLSTATE message' when it raises.
create function pg_temp.q(stmt text) returns text language plpgsql as $$
declare
  r text;
  state text;
  msg text;
begin
  execute 'select (' || stmt || ')::text' into r;
  return r;
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true) $$;
create function pg_temp.as_owner() returns void language sql as $$
  select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner') $$;
create function pg_temp.as_admin() returns void language sql as $$
  select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin') $$;
create function pg_temp.as_chef() returns void language sql as $$
  select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef') $$;
create function pg_temp.as_waiter() returns void language sql as $$
  select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter') $$;
create function pg_temp.as_none() returns void language sql as $$ select set_config('request.jwt.claims', '', true) $$;
grant all on outs to authenticated;
grant execute on function pg_temp.q(text), pg_temp.as_owner(), pg_temp.as_admin(), pg_temp.as_chef(), pg_temp.as_waiter(),
  pg_temp.as_none(), pg_temp.act_as(uuid, uuid, text) to authenticated;

create function pg_temp.ing(p_patch text, p_id text default '1a000000-0000-4000-8000-000000000001') returns text language sql as $$
  select pg_temp.q(format('public.set_ingredient_rules(%L, %L::jsonb)', p_id, p_patch)) $$;
create function pg_temp.sup(p_patch text, p_id text default '5a000000-0000-4000-8000-00000000005a') returns text language sql as $$
  select pg_temp.q(format('public.set_supplier_delivery(%L, %L::jsonb)', p_id, p_patch)) $$;
create function pg_temp.rec(p_patch text, p_id text default 'b2000000-0000-4000-8000-000000000001') returns text language sql as $$
  select pg_temp.q(format('public.set_recipe_rules(%L, %L::jsonb)', p_id, p_patch)) $$;
grant execute on function pg_temp.ing(text, text), pg_temp.sup(text, text), pg_temp.rec(text, text) to authenticated;

-- Shape of the API roles' access to the procedures.
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('set_ingredient_rules', 'set_supplier_delivery', 'set_recipe_rules')
            and has_function_privilege('authenticated', p.oid, 'execute') and p.prosecdef and p.proconfig @> array['search_path=""']), 3,
  'the three procedures are security definer with an empty search_path and executable by authenticated');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('set_ingredient_rules', 'set_supplier_delivery', 'set_recipe_rules')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0,
  'anon and service_role cannot execute them');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
            and p.proname in ('require_rules_reader', 'require_rules_writer')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                 or has_function_privilege('service_role', p.oid, 'execute'))), 0,
  'the two gates are closed to every API role');

-- ====== Owner: set_ingredient_rules =====================================================================================
set local role authenticated;
select pg_temp.as_owner();
insert into outs select 'i1', pg_temp.ing('{"minLevel":5,"targetLevel":12,"preferredSupplierItemId":"51000000-0000-4000-8000-000000000002"}');
reset role;
select is((select v::jsonb ->> 'changed' from outs where k = 'i1'), 'true', 'the owner''s first patch changes the ingredient');
select is((select v::jsonb - 'changed' from outs where k = 'i1'),
  '{"ingredientId":"1a000000-0000-4000-8000-000000000001","minLevel":5,"targetLevel":12,"preferredSupplierItemId":"51000000-0000-4000-8000-000000000002"}'::jsonb,
  'and returns the settings as camelCase JSON');
select is((select min_level::text || '/' || target_level::text from public.ingredient where id = '1a000000-0000-4000-8000-000000000001'), '5.0000/12.0000', 'the levels are stored');
select is((select string_agg(supplier_code, ',' order by supplier_code) from public.supplier_item
            where ingredient_id = '1a000000-0000-4000-8000-000000000001' and is_preferred), 'MZ10', 'item 2 is now the only preferred item of beef (item 1 unset)');
select is((select count(*)::int from public.audit_event where action = 'ingredient.rules_changed'), 1, 'one audit row');
select is((select before::text || after::text from public.audit_event where action = 'ingredient.rules_changed'),
  '{"min_level": null, "target_level": null, "preferred_supplier_item_id": "51000000-0000-4000-8000-000000000001"}'
  || '{"min_level": 5, "target_level": 12, "preferred_supplier_item_id": "51000000-0000-4000-8000-000000000002"}',
  'with before and after: the levels and the preferred item id');
select is((select entity_type || ' ' || entity_id::text || ' ' || created_by::text from public.audit_event where action = 'ingredient.rules_changed'),
  'ingredient 1a000000-0000-4000-8000-000000000001 a1000000-0000-4000-8000-00000000000a', 'on the ingredient, by the owner');
select is((select is_preferred::text from public.supplier_item where id = '51000000-0000-4000-8000-000000000005'), 'true',
  'tenant B''s preferred item for its own beef is unchanged');

set local role authenticated;
select pg_temp.as_owner();
insert into outs select 'i2', pg_temp.ing('{"minLevel":5,"targetLevel":12,"preferredSupplierItemId":"51000000-0000-4000-8000-000000000002"}');
insert into outs select 'i3', pg_temp.ing('{"minLevel":5.0}');
insert into outs select 'i4', pg_temp.ing('{"targetLevel":4}');
insert into outs select 'i5', pg_temp.ing('{"minLevel":13}');
insert into outs select 'i6', pg_temp.ing('{"minLevel":4.12345}');
insert into outs select 'i7', pg_temp.ing('{"minLevel":"5"}');
insert into outs select 'i8', pg_temp.ing('{"minLevel":-1}');
insert into outs select 'i9', pg_temp.ing('{"minLevel":100001}');
insert into outs select 'i10', pg_temp.ing('{"minLevel":5,"bogus":1}');
insert into outs select 'i11', pg_temp.ing('{}');
insert into outs select 'i12', pg_temp.ing('[]');
insert into outs select 'i13', pg_temp.ing('null');
insert into outs select 'i14', pg_temp.ing('{"preferredSupplierItemId":"51000000-0000-4000-8000-000000000004"}');
insert into outs select 'i15', pg_temp.ing('{"preferredSupplierItemId":"51000000-0000-4000-8000-000000000005"}');
insert into outs select 'i16', pg_temp.ing('{"preferredSupplierItemId":"51000000-0000-4000-8000-0000000000ff"}');
insert into outs select 'i17', pg_temp.ing('{"preferredSupplierItemId":"not-a-uuid"}');
insert into outs select 'i18', pg_temp.ing('{"preferredSupplierItemId":"51000000-0000-4000-8000-000000000003"}');
insert into outs select 'i19', pg_temp.ing('{"minLevel":1}', '1a000000-0000-4000-8000-000000000003');
insert into outs select 'i20', pg_temp.ing('{"minLevel":1}', '1a000000-0000-4000-8000-0000000000ff');
insert into outs select 'i21', pg_temp.ing('{"minLevel":1}', '1b000000-0000-4000-8000-000000000001');
insert into outs select 'i22', pg_temp.ing('{"targetLevel":1,"preferredSupplierItemId":"51000000-0000-4000-8000-000000000001"}');
reset role;
select is((select v::jsonb ->> 'changed' from outs where k = 'i2'), 'false', 'the same patch again changes nothing');
select is((select count(*)::int from public.audit_event where action = 'ingredient.rules_changed'), 1, 'and writes no audit row');
select is((select v::jsonb ->> 'changed' from outs where k = 'i3'), 'false', '5.0 equals the stored 5: no change');
select is((select v from outs where k = 'i4'), 'P0001 levels_invalid', 'target 4 with min 5 -> levels_invalid');
select is((select v from outs where k = 'i5'), 'P0001 levels_invalid', 'min 13 with target 12 -> levels_invalid');
select is((select v from outs where k = 'i6'), '22023 invalid_request', '5 decimals -> invalid_request');
select is((select v from outs where k = 'i7'), '22023 invalid_request', 'a string level -> invalid_request');
select is((select v from outs where k = 'i8'), '22023 invalid_request', 'a negative level -> invalid_request');
select is((select v from outs where k = 'i9'), '22023 invalid_request', 'a level above 100 000 -> invalid_request');
select is((select v from outs where k = 'i10'), '22023 invalid_request', 'an unknown key -> invalid_request');
select is((select v from outs where k = 'i11'), '22023 invalid_request', 'an empty patch -> invalid_request');
select is((select v from outs where k = 'i12'), '22023 invalid_request', 'an array patch -> invalid_request');
select is((select v from outs where k = 'i13'), '22023 invalid_request', 'a null patch -> invalid_request');
select is((select v from outs where k = 'i14'), 'P0002 supplier_item_not_found', 'another ingredient''s item -> supplier_item_not_found');
select is((select v from outs where k = 'i15'), 'P0002 supplier_item_not_found', 'tenant B''s item -> supplier_item_not_found');
select is((select v from outs where k = 'i16'), 'P0002 supplier_item_not_found', 'an unknown item -> supplier_item_not_found');
select is((select v from outs where k = 'i17'), '22023 invalid_request', 'a non-uuid item -> invalid_request');
select is((select v from outs where k = 'i18'), 'P0001 supplier_item_inactive', 'an inactive item -> supplier_item_inactive');
select is((select v from outs where k = 'i19'), 'P0001 ingredient_not_stock', 'water -> ingredient_not_stock');
select is((select v from outs where k = 'i20'), 'P0002 ingredient_not_found', 'an unknown ingredient -> ingredient_not_found');
select is((select v from outs where k = 'i21'), 'P0002 ingredient_not_found', 'tenant B''s ingredient -> ingredient_not_found');
select is((select v from outs where k = 'i22'), 'P0001 levels_invalid', 'a refused patch with a preferred item...');
select is((select supplier_code from public.supplier_item where ingredient_id = '1a000000-0000-4000-8000-000000000001' and is_preferred),
  'MZ10', '...leaves the preferred item untouched (one transaction)');

set local role authenticated;
select pg_temp.as_owner();
insert into outs select 'i23', pg_temp.ing('{"minLevel":1e1}');
reset role;
select is((select v::jsonb ->> 'changed' from outs where k = 'i23'), 'true', '1e1 is a valid number (10) and is below the target 12');

-- Clearing.
set local role authenticated;
select pg_temp.as_owner();
insert into outs select 'c1', pg_temp.ing('{"minLevel":null,"preferredSupplierItemId":null}');
reset role;
select is((select v::jsonb - 'changed' - 'ingredientId' from outs where k = 'c1'),
  '{"minLevel":null,"targetLevel":12,"preferredSupplierItemId":null}'::jsonb, 'null clears the minimum and unsets the preferred item');
select is((select count(*)::int from public.supplier_item where ingredient_id = '1a000000-0000-4000-8000-000000000001' and is_preferred), 0, 'no beef item is preferred');

-- ====== Owner: set_supplier_delivery ====================================================================================
set local role authenticated;
select pg_temp.as_owner();
insert into outs select 's1', pg_temp.sup('{"deliveryWeekdays":[4,1],"orderCutoffTime":"11:00","leadTimeDays":2}');
insert into outs select 's2', pg_temp.sup('{"deliveryWeekdays":[1,4],"orderCutoffTime":"11:00","leadTimeDays":2}');
reset role;
select is((select delivery_weekdays::text || ' ' || order_cutoff_time::text || ' ' || lead_time_days::text from public.supplier where id = '5a000000-0000-4000-8000-00000000005a'),
  '{1,4} 11:00:00 2', 'the row holds {1,4}, 11:00 and 2');
select is((select before::text || after::text from public.audit_event where action = 'supplier.delivery_changed'),
  '{"lead_time_days": null, "delivery_weekdays": [], "order_cutoff_time": null}{"lead_time_days": 2, "delivery_weekdays": [1, 4], "order_cutoff_time": "11:00"}',
  'one supplier.delivery_changed audit row with before and after');
select is((select entity_type || ' ' || entity_id::text from public.audit_event where action = 'supplier.delivery_changed'), 'supplier 5a000000-0000-4000-8000-00000000005a', 'on the supplier');
select is((select count(*)::int from public.audit_event where action = 'supplier.delivery_changed'), 1, 'and the repeat wrote no second audit row');
set local role authenticated;
select pg_temp.as_owner();
insert into outs select 's3', pg_temp.sup('{"deliveryWeekdays":[0]}');
insert into outs select 's4', pg_temp.sup('{"deliveryWeekdays":[8]}');
insert into outs select 's5', pg_temp.sup('{"deliveryWeekdays":[1,1]}');
insert into outs select 's6', pg_temp.sup('{"deliveryWeekdays":[1,2,3,4,5,6,7,1]}');
insert into outs select 's7', pg_temp.sup('{"deliveryWeekdays":null}');
insert into outs select 's8', pg_temp.sup('{"orderCutoffTime":"24:00"}');
insert into outs select 's9', pg_temp.sup('{"orderCutoffTime":"11:0"}');
insert into outs select 's10', pg_temp.sup('{"leadTimeDays":366}');
insert into outs select 's11', pg_temp.sup('{"leadTimeDays":-1}');
insert into outs select 's12', pg_temp.sup('{"leadTimeDays":1.5}');
insert into outs select 's13', pg_temp.sup('{"bogus":1}');
insert into outs select 's14', pg_temp.sup('{}');
insert into outs select 's15', pg_temp.sup('{"leadTimeDays":1}', '5a000000-0000-4000-8000-0000000000b5');
insert into outs select 's16', pg_temp.sup('{"leadTimeDays":1}', '5a000000-0000-4000-8000-0000000000ff');
reset role;
select is((select v::jsonb - 'changed' from outs where k = 's1'),
  '{"supplierId":"5a000000-0000-4000-8000-00000000005a","leadTimeDays":2,"deliveryWeekdays":[1,4],"orderCutoffTime":"11:00"}'::jsonb,
  'weekdays [4,1] are stored sorted; the result is camelCase with HH:MM');
select is((select v::jsonb ->> 'changed' from outs where k = 's1'), 'true', 'the first change is a change');
select is((select v::jsonb ->> 'changed' from outs where k = 's2'), 'false', 'the same values in another order change nothing');
select is((select v from outs where k = 's3'), 'P0001 weekdays_invalid', '[0] -> weekdays_invalid');
select is((select v from outs where k = 's4'), 'P0001 weekdays_invalid', '[8] -> weekdays_invalid');
select is((select v from outs where k = 's5'), 'P0001 weekdays_invalid', '[1,1] -> weekdays_invalid');
select is((select v from outs where k = 's6'), 'P0001 weekdays_invalid', 'eight entries -> weekdays_invalid');
select is((select v from outs where k = 's7'), 'P0001 weekdays_invalid', 'null weekdays -> weekdays_invalid');
select is((select v from outs where k = 's8'), 'P0001 cutoff_invalid', '"24:00" -> cutoff_invalid');
select is((select v from outs where k = 's9'), 'P0001 cutoff_invalid', '"11:0" -> cutoff_invalid');
select is((select v from outs where k = 's10'), 'P0001 lead_time_invalid', '366 -> lead_time_invalid');
select is((select v from outs where k = 's11'), 'P0001 lead_time_invalid', '-1 -> lead_time_invalid');
select is((select v from outs where k = 's12'), 'P0001 lead_time_invalid', '1.5 -> lead_time_invalid');
select is((select v from outs where k = 's13'), '22023 invalid_request', 'an unknown key -> invalid_request');
select is((select v from outs where k = 's14'), '22023 invalid_request', 'an empty patch -> invalid_request');
select is((select v from outs where k = 's15'), 'P0002 supplier_not_found', 'tenant B''s supplier -> supplier_not_found');
select is((select v from outs where k = 's16'), 'P0002 supplier_not_found', 'an unknown supplier -> supplier_not_found');
set local role authenticated;
select pg_temp.as_owner();
insert into outs select 's17', pg_temp.sup('{"leadTimeDays":null,"orderCutoffTime":null}');
insert into outs select 's18', pg_temp.sup('{"deliveryWeekdays":[]}');
insert into outs select 's19', pg_temp.sup('{"orderCutoffTime":"23:59"}');
insert into outs select 's20', pg_temp.sup('{"orderCutoffTime":"00:00"}');
reset role;
select is((select v::jsonb ->> 'leadTimeDays' is null and v::jsonb ->> 'orderCutoffTime' is null from outs where k = 's17'), true, 'null clears the lead time and the cut-off');
select is((select v::jsonb -> 'deliveryWeekdays' from outs where k = 's18'), '[]'::jsonb, 'an empty weekday list is valid: the supplier is incomplete');
select is((select v::jsonb ->> 'orderCutoffTime' from outs where k = 's19'), '23:59', '"23:59" is valid');
select is((select v::jsonb ->> 'orderCutoffTime' from outs where k = 's20'), '00:00', '"00:00" is valid');
select is((select lead_time_days::text from public.supplier where id = '5a000000-0000-4000-8000-0000000000b5'), null, 'tenant B''s supplier was not touched');

-- ====== Owner: set_recipe_rules =========================================================================================
select is((select count(*)::int from public.recipe), 3, 'three recipe versions before');
set local role authenticated;
select pg_temp.as_owner();
insert into outs select 'r1', pg_temp.rec('{"minPortions":5,"targetPortions":30,"prepTimeMin":180}');
insert into outs select 'r2', pg_temp.rec('{"minPortions":5,"targetPortions":30,"prepTimeMin":180}');
insert into outs select 'r3', pg_temp.rec('{"minPortions":1}', 'b2000000-0000-4000-8000-000000000002');
insert into outs select 'r4', pg_temp.rec('{"targetPortions":4}');
insert into outs select 'r5', pg_temp.rec('{"minPortions":31}');
insert into outs select 'r6', pg_temp.rec('{"minPortions":-1}');
insert into outs select 'r7', pg_temp.rec('{"targetPortions":10001}');
insert into outs select 'r8', pg_temp.rec('{"prepTimeMin":1441}');
insert into outs select 'r9', pg_temp.rec('{"prepTimeMin":-1}');
insert into outs select 'r10', pg_temp.rec('{"bogus":1}');
insert into outs select 'r11', pg_temp.rec('{}');
insert into outs select 'r12', pg_temp.rec('{"minPortions":1}', 'b2000000-0000-4000-8000-0000000000b1');
insert into outs select 'r13', pg_temp.rec('{"minPortions":1}', 'b2000000-0000-4000-8000-0000000000ff');
insert into outs select 'r14', pg_temp.rec('{"minPortions":"5"}');
insert into outs select 'r15', pg_temp.rec('{"minPortions":2.5}');
reset role;
select is((select v::jsonb ->> 'changed' from outs where k = 'r1'), 'true', 'the owner sets the stew rules');
select is((select v::jsonb - 'changed' from outs where k = 'r1'),
  '{"recipeKey":"b2000000-0000-4000-8000-000000000001","minPortions":5,"targetPortions":30,"prepTimeMin":180,"sources":{"min":"rule","target":"rule","prep":"rule"}}'::jsonb,
  'and gets the effective values with their sources');
select is((select rule_min_portions::text || '/' || rule_target_portions::text || '/' || rule_prep_time_min::text from public.recipe_key
            where id = 'b2000000-0000-4000-8000-000000000001'), '5/30/180', 'the recipe_key columns hold them');
select is((select count(*)::int from public.recipe), 3, 'no new recipe version');
select is((select current_version from public.recipe_key where id = 'b2000000-0000-4000-8000-000000000001'), 1, 'and current_version is unchanged');
select is((select count(*)::int from public.audit_event where action = 'recipe.rules_changed' and entity_type = 'recipe'
                and entity_id = 'b2000000-0000-4000-8000-000000000001'), 1, 'one audit row so far');
select is((select v::jsonb ->> 'changed' from outs where k = 'r2'), 'false', 'the same patch again changes nothing');
select is((select v from outs where k = 'r3'), 'P0001 recipe_not_batch', 'a plate key -> recipe_not_batch');
select is((select v from outs where k = 'r4'), 'P0001 portions_invalid', 'target 4 with min 5 -> portions_invalid');
select is((select v from outs where k = 'r5'), 'P0001 portions_invalid', 'min 31 with target 30 -> portions_invalid');
select is((select v from outs where k = 'r6'), 'P0001 portions_invalid', 'min -1 -> portions_invalid');
select is((select v from outs where k = 'r7'), 'P0001 portions_invalid', 'target 10001 -> portions_invalid');
select is((select v from outs where k = 'r8'), 'P0001 prep_time_invalid', 'prep 1441 -> prep_time_invalid');
select is((select v from outs where k = 'r9'), 'P0001 prep_time_invalid', 'prep -1 -> prep_time_invalid');
select is((select v from outs where k = 'r10'), '22023 invalid_request', 'an unknown key -> invalid_request');
select is((select v from outs where k = 'r11'), '22023 invalid_request', 'an empty patch -> invalid_request');
select is((select v from outs where k = 'r12'), 'P0002 recipe_not_found', 'tenant B''s key -> recipe_not_found');
select is((select v from outs where k = 'r13'), 'P0002 recipe_not_found', 'an unknown key -> recipe_not_found');
select is((select v from outs where k = 'r14'), 'P0001 portions_invalid', 'a string -> portions_invalid');
select is((select v from outs where k = 'r15'), 'P0001 portions_invalid', '2.5 portions -> portions_invalid');
set local role authenticated;
select pg_temp.as_owner();
insert into outs select 'r16', pg_temp.rec('{"targetPortions":null,"prepTimeMin":null}');
insert into outs select 'r17', pg_temp.rec('{"minPortions":null}');
insert into outs select 'r18', pg_temp.rec('{"minPortions":0}');
reset role;
select is((select v::jsonb - 'changed' - 'recipeKey' from outs where k = 'r16'),
  '{"minPortions":5,"targetPortions":10,"prepTimeMin":60,"sources":{"min":"rule","target":"version","prep":"version"}}'::jsonb,
  'null falls back to the version''s values (target 10, prep 60)');
select is((select v::jsonb - 'changed' - 'recipeKey' from outs where k = 'r17'),
  '{"minPortions":3,"targetPortions":10,"prepTimeMin":60,"sources":{"min":"version","target":"version","prep":"version"}}'::jsonb,
  'clearing the min falls back to the version''s 3, which is below the version''s target 10');
select is((select v::jsonb -> 'minPortions' from outs where k = 'r18'), '0'::jsonb, 'min 0 (rule off) is valid');

select is((select count(*)::int from public.audit_event where action = 'recipe.rules_changed' and entity_type = 'recipe'
                and entity_id = 'b2000000-0000-4000-8000-000000000001'), 4, 'audit: r1, r16, r17 and r18 each wrote one row (r2 and the refusals none)');

-- ====== Admin ===========================================================================================================
set local role authenticated;
select pg_temp.as_admin();
insert into outs select 'a1', pg_temp.ing('{"minLevel":6}');
insert into outs select 'a2', pg_temp.sup('{"leadTimeDays":3}');
insert into outs select 'a3', pg_temp.rec('{"minPortions":6}');
reset role;
select is((select v::jsonb ->> 'changed' from outs where k = 'a1') || (select v::jsonb ->> 'changed' from outs where k = 'a2')
          || (select v::jsonb ->> 'changed' from outs where k = 'a3'), 'truetruetrue', 'the admin can write all three');
select is((select string_agg(action, ',' order by action) from public.audit_event where created_by = 'f1000000-0000-4000-8000-00000000000f'),
  'ingredient.rules_changed,recipe.rules_changed,supplier.delivery_changed', 'the audit rows carry the admin''s id');

-- ====== Chef, waiter, no claims =========================================================================================
create temp table audit_before as select count(*)::int n from public.audit_event;
create temp table state_before as
  select (select string_agg(coalesce(min_level::text, 'n') || coalesce(target_level::text, 'n'), ',' order by id) from public.ingredient)
      || (select string_agg(coalesce(lead_time_days::text, 'n') || delivery_weekdays::text, ',' order by id) from public.supplier)
      || (select string_agg(coalesce(rule_min_portions::text, 'n'), ',' order by id) from public.recipe_key) s;
grant select on audit_before, state_before to authenticated;
set local role authenticated;
select pg_temp.as_chef();
insert into outs select 'ch1', pg_temp.ing('{"minLevel":1}');
insert into outs select 'ch2', pg_temp.sup('{"leadTimeDays":9}');
insert into outs select 'ch3', pg_temp.rec('{"minPortions":1}');
select pg_temp.as_waiter();
insert into outs select 'w1', pg_temp.ing('{"minLevel":1}');
insert into outs select 'w2', pg_temp.sup('{"leadTimeDays":9}');
insert into outs select 'w3', pg_temp.rec('{"minPortions":1}');
select pg_temp.as_none();
insert into outs select 'n1', pg_temp.ing('{"minLevel":1}');
insert into outs select 'n2', pg_temp.sup('{"leadTimeDays":9}');
insert into outs select 'n3', pg_temp.rec('{"minPortions":1}');
-- With an invalid patch AND no right: the role is checked first.
select pg_temp.as_chef();
insert into outs select 'ch4', pg_temp.ing('{"bogus":1}', '1a000000-0000-4000-8000-0000000000ff');
reset role;
select is((select string_agg(v, ';' order by k) from outs where k in ('ch1', 'ch2', 'ch3')),
  '42501 permission denied: rules settings need owner or admin;42501 permission denied: rules settings need owner or admin;42501 permission denied: rules settings need owner or admin',
  'the chef gets 42501 from all three');
select is((select string_agg(v, ';' order by k) from outs where k in ('w1', 'w2', 'w3')),
  '42501 permission denied: rules settings need owner or admin;42501 permission denied: rules settings need owner or admin;42501 permission denied: rules settings need owner or admin',
  'the waiter gets 42501 from all three');
select is((select count(*)::int from outs where k in ('n1', 'n2', 'n3') and v like '42501 %'), 3, 'no claims: 42501 from all three');
select is((select v from outs where k = 'ch4') like '42501 %', true, 'the role is checked before the patch and the ingredient');
select is((select n from audit_before), (select count(*)::int from public.audit_event), 'the refused calls wrote no audit row');
select is((select s from state_before),
  (select (select string_agg(coalesce(min_level::text, 'n') || coalesce(target_level::text, 'n'), ',' order by id) from public.ingredient)
       || (select string_agg(coalesce(lead_time_days::text, 'n') || delivery_weekdays::text, ',' order by id) from public.supplier)
       || (select string_agg(coalesce(rule_min_portions::text, 'n'), ',' order by id) from public.recipe_key)),
  'and changed no setting');

select * from finish();
rollback;
