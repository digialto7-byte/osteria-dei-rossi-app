-- M17 step 5: the dining table procedures and the coperto settings (plan §3.1.2, §3.1.3, §3.2; AT3 coperto set or none).
-- Names, ordering, deactivation of a table in use, the settings upsert and its audit, two tenants that differ (lesson 1),
-- roles. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(72);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number, settings) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000', '{"sale_vat_pct": 10}'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115', '{"sale_vat_pct": 22}');
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
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');

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
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
create function pg_temp.mk(p_body text) returns text language sql as $$
  select pg_temp.err(format('select public.create_dining_table(%L::jsonb)', p_body)) $$;
create function pg_temp.up(p_id uuid, p_patch text) returns text language sql as $$
  select pg_temp.err(format('select public.update_dining_table(%L::uuid, %L::jsonb)', p_id, p_patch)) $$;
create function pg_temp.set_cop(p_patch text) returns text language sql as $$
  select pg_temp.err(format('select public.set_sale_settings(%L::jsonb)', p_patch)) $$;
create temp table res (k text primary key, j jsonb);
create function pg_temp.create_as(p_k text, p_body text) returns void language sql as $$
  insert into res select p_k, public.create_dining_table(p_body::jsonb) $$;
create function pg_temp.update_as(p_k text, p_id uuid, p_patch text) returns void language sql as $$
  insert into res select p_k, public.update_dining_table(p_id, p_patch::jsonb) $$;
create function pg_temp.tid(p_k text) returns uuid language sql as $$ select (j -> 'table' ->> 'id')::uuid from res where k = p_k $$;
create function pg_temp.table_of(j jsonb, p_id uuid) returns jsonb language sql as $$
  select jsonb_path_query_first(j, '$.tables[*] ? (@.id == $id)', jsonb_build_object('id', p_id::text)) $$;

select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

-- ----------------------------------------------------------------------------------------------------------------
-- Create.
select pg_temp.create_as('t1', '{"name":"Tavolo 1 (demo)","position":1}');
select is((select j -> 'table' ->> 'name' from res where k = 't1'), 'Tavolo 1 (demo)', 'the created table is returned');
select is((select (j -> 'table' ->> 'position') || '/' || (j -> 'table' ->> 'active') || '/' || (j -> 'table' ->> 'open') from res where k = 't1'),
  '1/true/false', 'position 1, active, not open');
select is((select array_agg(x order by x collate "C") from jsonb_object_keys((select j -> 'table' from res where k = 't1')) x),
  array['active', 'id', 'name', 'open', 'position'], 'a table has exactly {id, name, position, active, open}');
select is((select count(*)::int from public.audit_event where entity_type = 'dining_table' and action = 'dining_table.created'
            and entity_id = pg_temp.tid('t1') and created_by = 'a1000000-0000-4000-8000-00000000000a'), 1, 'one dining_table.created audit row');
select pg_temp.create_as('t2', '{"name":"Tavolo 2 (demo)"}');
select is((select (j -> 'table' ->> 'position')::int from res where k = 't2'), 0, 'position defaults to 0');
select is(pg_temp.mk('{"name":" tavolo 1 (DEMO) "}'), 'P0001 table_name_taken', 'the same name (case and spaces): table_name_taken');
select is(pg_temp.mk('{"name":""}'), 'P0001 name_invalid', 'an empty name: name_invalid');
select is(pg_temp.mk(format('{"name":"%s"}', repeat('x', 41))), 'P0001 name_invalid', 'a 41-character name: name_invalid');
select is(pg_temp.mk('{"name":"Tavolo 3 (demo)","position":10000}'), 'P0001 position_invalid', 'position 10000: position_invalid');
select is(pg_temp.mk('{"name":"Tavolo 3 (demo)","position":-1}'), 'P0001 position_invalid', 'position -1: position_invalid');
select is(pg_temp.mk('{"name":5}'), '22023 invalid_request', 'a numeric name: invalid_request');
select is(pg_temp.mk('{"position":3}'), '22023 invalid_request', 'a missing name: invalid_request');
select is(pg_temp.mk('{"name":"Tavolo 3 (demo)","active":false}'), '22023 invalid_request', 'an unknown key: invalid_request');
select is(pg_temp.mk('{}'), '22023 invalid_request', 'an empty body: invalid_request');
select is((select count(*)::int from public.dining_table), 2, 'no refused call wrote a table');

-- Update.
select pg_temp.update_as('r1', pg_temp.tid('t1'), '{"name":"Tavolo Uno (demo)","position":7}');
select is((select name || '/' || position from public.dining_table where id = pg_temp.tid('t1')), 'Tavolo Uno (demo)/7', 'rename and reorder');
select is((select count(*)::int from public.audit_event where entity_id = pg_temp.tid('t1') and action = 'dining_table.updated'
            and before = '{"name":"Tavolo 1 (demo)","position":1}'::jsonb and after = '{"name":"Tavolo Uno (demo)","position":7}'::jsonb), 1,
  'one audit row with before and after');
select pg_temp.update_as('r2', pg_temp.tid('t1'), '{"name":"Tavolo Uno (demo)"}');
select is((select (j ->> 'changed')::boolean from res where k = 'r2'), false, 'the same name again: changed false');
select is((select count(*)::int from public.audit_event where entity_id = pg_temp.tid('t1') and action = 'dining_table.updated'), 1, 'and no new audit row');
select is(pg_temp.up(pg_temp.tid('t2'), '{"name":"TAVOLO UNO (demo)"}'), 'P0001 table_name_taken', 'renaming onto another active name: table_name_taken');
select is(pg_temp.up(pg_temp.tid('t2'), '{"name":"Tavolo 2 (demo)"}'), 'ok', 'keeping one''s own name is fine');
select is(pg_temp.up(pg_temp.tid('t2'), '{}'), '22023 invalid_request', 'an empty patch: invalid_request');
select is(pg_temp.up(pg_temp.tid('t2'), '{"opened":true}'), '22023 invalid_request', 'an unknown key: invalid_request');
select is(pg_temp.up(pg_temp.tid('t2'), '{"active":"no"}'), '22023 invalid_request', 'a non-boolean active: invalid_request');
select is(pg_temp.up(pg_temp.tid('t2'), '{"position":10000}'), 'P0001 position_invalid', 'position 10000: position_invalid');
select is(pg_temp.up('99999999-9999-4999-8999-999999999999', '{"position":1}'), 'P0002 table_not_found', 'an unknown table: table_not_found');

-- Deactivation: refused while a session is open, accepted when free; reactivation re-checks the name.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  values ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', pg_temp.tid('t2'), 'Tavolo 2 (demo)', 2,
          'd1000000-0000-4000-8000-00000000000d', '2026-10-24', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
select is(pg_temp.up(pg_temp.tid('t2'), '{"active":false}'), 'P0001 table_open', 'deactivating a table with an open session: table_open');
select is((select is_active from public.dining_table where id = pg_temp.tid('t2')), true, 'the table is still active');
select is((select (pg_temp.table_of(public.dining_tables_manage(), pg_temp.tid('t2')) ->> 'open')::boolean), true, 'the manage list shows the table as open');
select is((select (pg_temp.table_of(public.dining_tables_manage(), pg_temp.tid('t1')) ->> 'open')::boolean), false, 'and the other as not open');
select is(pg_temp.up(pg_temp.tid('t2'), '{"name":"Tavolo Due (demo)"}'), 'ok', 'a table in use can be renamed');
select is((select table_name from public.table_session where id = '14000000-0000-4000-8000-000000000001'), 'Tavolo 2 (demo)', 'the open session keeps its name snapshot');
select pg_temp.update_as('off', pg_temp.tid('t1'), '{"active":false}');
select is((select is_active from public.dining_table where id = pg_temp.tid('t1')), false, 'a free table can be deactivated (the row stays)');
select pg_temp.create_as('t1b', '{"name":"Tavolo Uno (demo)"}');
select is(pg_temp.up(pg_temp.tid('t1'), '{"active":true}'), 'P0001 table_name_taken', 'reactivating onto a name now used by an active table: table_name_taken');
select is((select array_agg(t ->> 'name' order by ord) from jsonb_array_elements(public.dining_tables_manage() -> 'tables') with ordinality x(t, ord)),
  array['Tavolo Due (demo)', 'Tavolo Uno (demo)', 'Tavolo Uno (demo)'], 'manage: active tables first (by position, then name), the inactive one last');
select is((select array_agg(t ->> 'active' order by ord) from jsonb_array_elements(public.dining_tables_manage() -> 'tables') with ordinality x(t, ord)),
  array['true', 'true', 'false'], 'with the inactive table last');

-- ----------------------------------------------------------------------------------------------------------------
-- Coperto settings (two tenants that differ).
select is((public.sale_settings_read() -> 'coperto'), 'null'::jsonb, 'before any setting: coperto null (no coperto)');
select is((public.sale_settings_read() -> 'defaults' ->> 'vatRate')::numeric, 10::numeric, 'tenant A default VAT rate 10');
select is(public.sale_settings_read() -> 'vatRates', '[0,4,5,10,22]'::jsonb, 'the allowed rates are listed');
select is(pg_temp.set_cop('{"copertoAmount":null,"copertoVatRate":null}'), 'ok', 'clearing an unset coperto is accepted');
select is((select count(*)::int from public.sale_settings) + (select count(*)::int from public.audit_event where entity_type = 'sale_settings'), 0,
  'and writes nothing');
select is((public.set_sale_settings('{"copertoAmount":1.5,"copertoVatRate":10}') ->> 'changed')::boolean, true, 'setting 1,50 at 10 %: changed true');
select is((select coperto_amount || '/' || coperto_vat_rate from public.sale_settings where tenant_id = '11111111-1111-4111-8111-111111111111'), '1.50/10.00', 'the row holds the values');
select is((select count(*)::int from public.audit_event where entity_type = 'sale_settings' and action = 'sale_settings.changed'
            and before = '{"coperto_amount":null,"coperto_vat_rate":null}'::jsonb and after = '{"coperto_amount":1.5,"coperto_vat_rate":10}'::jsonb), 1,
  'one sale_settings.changed audit row with before and after');
select is((public.sale_settings_read() -> 'coperto'), '{"amount":1.5,"vatRate":10}'::jsonb, 'sale_settings_read shows the coperto');
select is((public.set_sale_settings('{"copertoAmount":1.5,"copertoVatRate":10}') ->> 'changed')::boolean, false, 'the same values again: changed false');
select is((select count(*)::int from public.audit_event where entity_type = 'sale_settings'), 1, 'no new audit row');
select is((public.set_sale_settings('{"copertoAmount":2,"copertoVatRate":22}') ->> 'changed')::boolean, true, 'a new amount and rate: changed true');
select is((select count(*)::int from public.sale_settings), 1, 'still one settings row per tenant (upsert)');
select is((public.set_sale_settings('{"copertoAmount":null,"copertoVatRate":null}') -> 'coperto'), 'null'::jsonb, 'both null clears the coperto');
select is((public.sale_settings_read() -> 'coperto'), 'null'::jsonb, 'and sale_settings_read shows none');
select is(pg_temp.set_cop('{"copertoAmount":1.5,"copertoVatRate":null}'), 'P0001 coperto_invalid', 'an amount without a rate: coperto_invalid');
select is(pg_temp.set_cop('{"copertoAmount":null,"copertoVatRate":10}'), 'P0001 coperto_invalid', 'a rate without an amount: coperto_invalid');
select is(pg_temp.set_cop('{"copertoAmount":0,"copertoVatRate":10}'), 'P0001 coperto_invalid', 'amount 0: coperto_invalid');
select is(pg_temp.set_cop('{"copertoAmount":100.01,"copertoVatRate":10}'), 'P0001 coperto_invalid', 'amount 100,01: coperto_invalid');
select is(pg_temp.set_cop('{"copertoAmount":1.505,"copertoVatRate":10}'), 'P0001 coperto_invalid', 'amount with three decimals: coperto_invalid');
select is(pg_temp.set_cop('{"copertoAmount":1.5,"copertoVatRate":12}'), 'P0001 vat_rate_invalid', 'VAT 12: vat_rate_invalid');
select is(pg_temp.set_cop('{"copertoAmount":"1.5","copertoVatRate":10}'), '22023 invalid_request', 'a string amount: invalid_request');
select is(pg_temp.set_cop('{"copertoAmount":1.5}'), '22023 invalid_request', 'a missing key: invalid_request');
select is(pg_temp.set_cop('{"copertoAmount":1.5,"copertoVatRate":10,"x":1}'), '22023 invalid_request', 'an unknown key: invalid_request');
select is(pg_temp.set_cop('{"copertoAmount":100,"copertoVatRate":0}'), 'ok', 'amount 100 at rate 0 is accepted (the bounds)');

-- Tenant B differs.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((public.sale_settings_read() -> 'coperto'), 'null'::jsonb, 'tenant B: no coperto while A has one');
select is((public.sale_settings_read() -> 'defaults' ->> 'vatRate')::numeric, 22::numeric, 'tenant B default VAT rate 22');
select is(jsonb_array_length(public.dining_tables_manage() -> 'tables'), 0, 'tenant B lists none of A''s tables');
select is(pg_temp.up(pg_temp.tid('t2'), '{"position":3}'), 'P0002 table_not_found', 'tenant B cannot update A''s table');

-- Roles.
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.mk('{"name":"Tavolo Admin (demo)"}'), 'ok', 'admin can create a table');
select is(pg_temp.set_cop('{"copertoAmount":1.5,"copertoVatRate":10}'), 'ok', 'and set the coperto');
select is((select created_by from public.audit_event where entity_type = 'sale_settings' and before ->> 'coperto_amount' = '100' and after ->> 'coperto_amount' = '1.5'), 'f1000000-0000-4000-8000-00000000000f'::uuid, 'the audit row names the admin');
create temp table role_errs (who text, f text, e text);
create function pg_temp.probe(p_who text, p_auth uuid, p_role text) returns void language plpgsql as $$
declare
  t constant text := '11111111-1111-4111-8111-111111111111';
begin
  perform pg_temp.act_as(p_auth, t::uuid, p_role);
  insert into role_errs values
    (p_who, 'create', pg_temp.mk('{"name":"Altro (demo)"}')),
    (p_who, 'update', pg_temp.up('13000000-0000-4000-8000-000000000001', '{"position":1}')),
    (p_who, 'manage', pg_temp.err('select public.dining_tables_manage()')),
    (p_who, 'read', pg_temp.err('select public.sale_settings_read()')),
    (p_who, 'set', pg_temp.set_cop('{"copertoAmount":3,"copertoVatRate":10}'));
end
$$;
select pg_temp.probe('chef', 'c0000000-0000-4000-8000-00000000000c', 'chef');
select pg_temp.probe('waiter', 'd0000000-0000-4000-8000-00000000000d', 'waiter');
select is((select count(*)::int from role_errs where e = '42501 permission denied: the menu and table settings need owner or admin'), 10,
  'chef and waiter get 42501 on all five functions');
select is((select coperto_amount from public.sale_settings where tenant_id = '11111111-1111-4111-8111-111111111111'), 1.50::numeric, 'and nothing was written');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r,
                  unnest(array['public.create_dining_table(jsonb)', 'public.update_dining_table(uuid, jsonb)', 'public.dining_tables_manage()',
                               'public.sale_settings_read()', 'public.set_sale_settings(jsonb)']) f
            where has_function_privilege(r, f, 'execute')), 5, 'only authenticated executes the five functions');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('create_dining_table', 'update_dining_table', 'dining_tables_manage', 'sale_settings_read', 'set_sale_settings')
              and p.prosecdef and p.proconfig = array['search_path=""']), 5, 'all five are security definer with an empty search_path');

select * from finish();
rollback;
