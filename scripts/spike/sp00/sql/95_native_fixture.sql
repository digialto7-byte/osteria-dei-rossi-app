select sp0.guard();

-- Run it ONLY with `psql -v ON_ERROR_STOP=1 -f` on the native or local database, never on the temporary hosted project: it refuses unless the
-- marker says `local`, and refuses if the fixture tenant already exists (a second run, or a database that already holds the real seed).
do $$
begin
  if (select m.project_ref from sp0.target_marker m) is distinct from 'local' then
    raise exception '95_native_fixture: refused, the marker is not "local": this fixture is for the native or local database only';
  end if;
  if exists (select 1 from public.tenant t where t.name = 'Osteria Demo SP0') then
    raise exception '95_native_fixture: refused, "Osteria Demo SP0" already exists';
  end if;
end
$$;

-- NATIVE-ONLY test aid, applied by hand on a scratch PG16 database (CI uses the real seed through sp00-t4-seed.ts): a stand-in for the seeded
-- measured tenant "Osteria Demo SP0", built with the repo's own procedures as its owner (jwt claims + role authenticated), with rows in the
-- core tables: location, supplier, ingredient, supplier_item, dining_table, menu_item, table_session, order_line, kitchen_event.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'titolare.demo@example.test');
select public.create_tenant_with_owner('Osteria Demo SP0', 'IT00000000000', '00000000-0000-4000-8000-0000000000a1', 'Titolare Demo') as t \gset
insert into public.location (tenant_id, name, created_by) select :'t', 'Cucina', id from public.app_user where tenant_id = :'t';
insert into public.supplier (tenant_id, name, created_by) select :'t', 'Fornitore A', id from public.app_user where tenant_id = :'t';
insert into public.ingredient (tenant_id, name, base_unit, created_by) select :'t', 'Farina', 'kg', id from public.app_user where tenant_id = :'t';
insert into public.supplier_item (tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty, pack_unit)
  select :'t', s.id, i.id, 'X1', 1, 'kg' from public.supplier s join public.ingredient i on i.tenant_id = s.tenant_id where s.tenant_id = :'t';
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000000a1', 'role', 'authenticated', 'tenant_id', :'t',
  'app_role', 'owner', 'aal', 'aal2', 'session_id', gen_random_uuid())::text, false);
set role authenticated;
select public.create_dining_table('{"name":"T1"}'::jsonb);
select public.create_menu_item('{"name":"Tagliata","category":"Secondi","course":"secondi","recipeKey":null,"price":18,"vatRate":10}'::jsonb);
select public.open_table((select id from public.dining_table limit 1), '10000000-0000-4000-8000-000000000001', 2);
select public.add_order_line('10000000-0000-4000-8000-000000000001', jsonb_build_object('lineId', '20000000-0000-4000-8000-000000000001',
  'menuItemId', (select id from public.menu_item limit 1), 'course', 'secondi', 'clientUpdatedAt', to_char(now() - interval '5 seconds', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
select public.fire_course('10000000-0000-4000-8000-000000000001', '{"lineIds":["20000000-0000-4000-8000-000000000001"]}'::jsonb);
select public.kitchen_mark_line('20000000-0000-4000-8000-000000000001', '{"done":true}'::jsonb);
reset role;
select set_config('request.jwt.claims', '', false);
