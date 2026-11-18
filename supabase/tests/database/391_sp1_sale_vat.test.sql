-- SP1 step 3 (docs/plans/2026-11-15-sp01-tenant-config.md §3.1.1, §3.1.4, §3.2, §5 step 3; AT1): each tenant's SALE VAT list.
-- public.tenant_vat_rate, app.sale_vat_rates, the trigger app.check_sale_vat_rate on menu_item_price and sale_settings, the seed trigger on tenant and
-- the backfill. Tenant B's sale list is [10, 22]; tenant A keeps today's five rates. The purchase side stays statutory. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '22222222-2222-4222-8222-222222222222', 'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere B Demo');

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
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', 'aal1')::text, true)
$$;

-- B's sale list becomes [10, 22] (table owner: no API role can write the table). B and A each have one menu item for the direct inserts.
update public.tenant_vat_rate set is_active = false where tenant_id = '22222222-2222-4222-8222-222222222222' and rate in (0, 4, 5);
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('31000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Pane A (demo)', 'Contorni', 'antipasti', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('32000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Grissini B (demo)', 'Contorni', 'antipasti', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

-- The first test of the step (AT1): the trigger refuses a direct insert at 4 % for B.
select is(pg_temp.err($$insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, created_by)
    values ('22222222-2222-4222-8222-222222222222', '32000000-0000-4000-8000-000000000001', 1.50, 4, 'b1000000-0000-4000-8000-00000000000b')$$),
  'P0001 vat_rate_invalid', 'tenant B with sale list [10, 22] refuses a direct menu_item_price insert at 4 % with P0001 vat_rate_invalid');
select is((select count(*)::int from public.menu_item_price where tenant_id = '22222222-2222-4222-8222-222222222222'), 0, 'and writes no price row');

-- The list itself.
select is(app.sale_vat_rates('22222222-2222-4222-8222-222222222222'), array[10, 22]::numeric[], 'app.sale_vat_rates(B) is [10, 22]');
select is(app.sale_vat_rates('11111111-1111-4111-8111-111111111111'), array[0, 4, 5, 10, 22]::numeric[], 'app.sale_vat_rates(A) is today''s five rates');
-- Text, not only numeric equality (which ignores scale): the list must serialise exactly as the statutory list does, or the vatRates payloads change.
select is(to_jsonb(app.sale_vat_rates('11111111-1111-4111-8111-111111111111'))::text, to_jsonb(app.allowed_vat_rates())::text,
  'to_jsonb(app.sale_vat_rates(A)) is the same text as to_jsonb(app.allowed_vat_rates()): [0, 4, 5, 10, 22], no trailing zeros');
select is(to_jsonb(app.sale_vat_rates('22222222-2222-4222-8222-222222222222'))::text, '[10, 22]', 'and B''s list serialises as [10, 22]');
select is(app.sale_vat_rates('99999999-9999-4999-8999-999999999999'), '{}'::numeric[], 'an unknown tenant has an empty list');
select is(pg_temp.err($$insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, created_by)
    values ('22222222-2222-4222-8222-222222222222', '32000000-0000-4000-8000-000000000001', 1.50, 10, 'b1000000-0000-4000-8000-00000000000b')$$),
  'ok', 'a direct insert at 10 % for B is accepted (in its list)');
select is(pg_temp.err($$insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, created_by)
    values ('22222222-2222-4222-8222-222222222222', '32000000-0000-4000-8000-000000000001', 1.50, 12, 'b1000000-0000-4000-8000-00000000000b')$$),
  '23514 new row for relation "menu_item_price" violates check constraint "menu_item_price_vat_rate_check"',
  'and 12 % (outside the statute) falls through the trigger to the statutory CHECK: 23514, as before SP1 (pgTAP 150)');
select is(pg_temp.err($$insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
    values ('22222222-2222-4222-8222-222222222222', 2, 12, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b')$$),
  '23514 new row for relation "sale_settings" violates check constraint "sale_settings_coperto_vat_rate_check"', 'the same for a coperto at 12 %: 23514');
select is(pg_temp.err($$insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, created_by)
    values ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000001', 1.50, 4, 'a1000000-0000-4000-8000-00000000000a')$$),
  'ok', 'a direct insert at 4 % for A is accepted');

-- The procedures meet the rule through the trigger, with the same code.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err($$select public.create_menu_item('{"name":"Acqua B (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":4}'::jsonb)$$),
  'P0001 vat_rate_invalid', 'create_menu_item at 4 % for B: P0001 vat_rate_invalid');
select is((select count(*)::int from public.menu_item where tenant_id = '22222222-2222-4222-8222-222222222222' and name = 'Acqua B (demo)'), 0, 'and the item was not created (one transaction)');
select is(pg_temp.err($$select public.create_menu_item('{"name":"Acqua B (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":22}'::jsonb)$$),
  'ok', 'create_menu_item at 22 % for B is accepted');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err($$select public.create_menu_item('{"name":"Acqua A (demo)","category":"Bevande","course":"bevande","recipeKey":null,"price":2,"vatRate":4}'::jsonb)$$),
  'ok', 'create_menu_item at 4 % for A is accepted');
select is(pg_temp.err(format($$select public.update_menu_item(%L::uuid, '{"price":2.5,"vatRate":5}'::jsonb)$$,
    (select id from public.menu_item where tenant_id = '11111111-1111-4111-8111-111111111111' and name = 'Acqua A (demo)'))), 'ok', 'update_menu_item to 5 % for A is accepted');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.err(format($$select public.update_menu_item(%L::uuid, '{"price":2.5,"vatRate":5}'::jsonb)$$,
    (select id from public.menu_item where tenant_id = '22222222-2222-4222-8222-222222222222' and name = 'Acqua B (demo)'))), 'P0001 vat_rate_invalid',
  'update_menu_item to 5 % for B: P0001 vat_rate_invalid');

-- Coperto: set_sale_settings and a direct insert.
select is(pg_temp.err($$select public.set_sale_settings('{"copertoAmount":2,"copertoVatRate":4}'::jsonb)$$), 'P0001 vat_rate_invalid', 'set_sale_settings coperto at 4 % for B is refused');
select is((select count(*)::int from public.sale_settings where tenant_id = '22222222-2222-4222-8222-222222222222'), 0, 'and writes no settings row');
select is(pg_temp.err($$select public.set_sale_settings('{"copertoAmount":2,"copertoVatRate":10}'::jsonb)$$), 'ok', 'set_sale_settings coperto at 10 % for B is accepted');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err($$select public.set_sale_settings('{"copertoAmount":2,"copertoVatRate":4}'::jsonb)$$), 'ok', 'set_sale_settings coperto at 4 % for A is accepted');
select is(pg_temp.err($$update public.sale_settings set coperto_vat_rate = 4 where tenant_id = '22222222-2222-4222-8222-222222222222'$$), 'P0001 vat_rate_invalid',
  'a direct update of B''s coperto rate to 4 % is refused too (the trigger fires on update of the column)');

-- A new tenant is seeded with five active rates; the backfill statement gives existing tenants the same and changes nothing else.
insert into public.tenant (id, name, vat_number) values ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222228');
select is((select count(*)::int from public.tenant_vat_rate where tenant_id = '33333333-3333-4333-8333-333333333333' and is_active), 5, 'a new tenant gets five active rates (the seed trigger)');
select is(app.sale_vat_rates('33333333-3333-4333-8333-333333333333'), array[0, 4, 5, 10, 22]::numeric[], 'which are today''s statutory five');
select is((select count(*)::int from public.tenant t where (select count(*) from public.tenant_vat_rate r where r.tenant_id = t.id) <> 5), 0, 'every tenant of the database holds exactly five rate rows');
-- The migration's backfill statement, run again after deleting C's rows (as table owner) and after B's rows were left alone: it restores C and
-- changes neither B's inactive flags nor anything else (on conflict do nothing).
delete from public.tenant_vat_rate where tenant_id = '33333333-3333-4333-8333-333333333333';
insert into public.tenant_vat_rate (tenant_id, rate)
  select t.id, r.rate from public.tenant t cross join unnest(app.allowed_vat_rates()) r (rate)
on conflict do nothing;
select is((select count(*)::int from public.tenant_vat_rate where tenant_id = '33333333-3333-4333-8333-333333333333' and is_active), 5, 'the backfill restores a tenant with no rows to five active rates');
select is(app.sale_vat_rates('22222222-2222-4222-8222-222222222222'), array[10, 22]::numeric[], 'and leaves B''s list [10, 22]');

-- Statute: the purchase side is not affected by B's list, and the table accepts only statutory rates.
select is(app.line_checks(1, 10, 10, 4), '{}'::text[], 'an invoice line of B at 4 %: app.line_checks gives no vat_rate_unexpected (the purchase side stays statutory)');
select is(app.line_checks(1, 10, 10, 12), array['vat_rate_unexpected'], 'and 12 % is still flagged');
select is(left(pg_temp.err($$insert into public.tenant_vat_rate (tenant_id, rate) values ('33333333-3333-4333-8333-333333333333', 12)$$), 5), '23514', 'inserting rate 12 into tenant_vat_rate: 23514 (the CHECK bounds it by the statutory list)');
select is(pg_temp.err($$insert into public.tenant_vat_rate (tenant_id, rate) values ('33333333-3333-4333-8333-333333333333', 4)$$), '23505 duplicate key value violates unique constraint "tenant_vat_rate_pkey"',
  'one row per tenant and rate');

-- An open session keeps its coperto snapshot when the list changes, and still closes.
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('43000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
-- Opened while 4 % was still in B's list (a snapshot, statutory CHECK only): reactivate 4, insert, deactivate again.
update public.tenant_vat_rate set is_active = true where tenant_id = '22222222-2222-4222-8222-222222222222' and rate = 4;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by) values
  ('44000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '43000000-0000-4000-8000-000000000001', 'Tavolo B (demo)', 2,
   'e1000000-0000-4000-8000-00000000000e', app.business_date('22222222-2222-4222-8222-222222222222', now()), 2.00, 4, 'e1000000-0000-4000-8000-00000000000e', 'e1000000-0000-4000-8000-00000000000e');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  values ('45000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '44000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001',
          'antipasti', 1, 1.50, 10, 'menu', now() - interval '1 hour', 'e1000000-0000-4000-8000-00000000000e', 'e1000000-0000-4000-8000-00000000000e', now(), 'e1000000-0000-4000-8000-00000000000e');
update public.tenant_vat_rate set is_active = false where tenant_id = '22222222-2222-4222-8222-222222222222' and rate = 4;
select is(app.sale_vat_rates('22222222-2222-4222-8222-222222222222'), array[10, 22]::numeric[], 'rate 4 is inactive for B again');
select is((select coperto_vat_rate from public.table_session where id = '44000000-0000-4000-8000-000000000001'), 4::numeric, 'the open session of B keeps coperto_vat_rate 4');
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '22222222-2222-4222-8222-222222222222', 'waiter');
select is(pg_temp.err($$select public.close_table('44000000-0000-4000-8000-000000000001'::uuid, jsonb_build_object('receiptType', 'scontrino', 'receiptNumber', '0012-0034',
    'paymentType', 'card', 'billToken', public.session_bill('44000000-0000-4000-8000-000000000001'::uuid, null) ->> 'billToken'))$$), 'ok', 'and it still closes');
select is((select coperto_vat_rate from public.table_session where id = '44000000-0000-4000-8000-000000000001'), 4::numeric, 'with its snapshot unchanged');

-- Q12 / Q-a (lead, 2026-11-18): the list is enforced only on a rate that is new or changed. A rate stored while it was in the list keeps
-- working unchanged (no silent change), and setting it fresh is refused. Both directions, for a price and for the coperto.
-- Stored while 4 % was still in B's list: a dish at 4 % and B's coperto at 4 %. Then 4 % leaves the list again.
update public.tenant_vat_rate set is_active = true where tenant_id = '22222222-2222-4222-8222-222222222222' and rate = 4;
insert into public.menu_item (id, tenant_id, name, category, course_default, position, created_by, updated_by) values
  ('32000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'Focaccia B (demo)', 'Contorni', 'antipasti', 4,
   'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  values ('22222222-2222-4222-8222-222222222222', '32000000-0000-4000-8000-000000000004', 1.50, 4, now() - interval '1 day', 'b1000000-0000-4000-8000-00000000000b');
update public.sale_settings set coperto_vat_rate = 4 where tenant_id = '22222222-2222-4222-8222-222222222222';
update public.tenant_vat_rate set is_active = false where tenant_id = '22222222-2222-4222-8222-222222222222' and rate = 4;
select is(app.sale_vat_rates('22222222-2222-4222-8222-222222222222'), array[10, 22]::numeric[], 'Q-a fixture: 4 % has left B''s list, with a dish and the coperto still stored at 4 %');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
-- Kept: unchanged rates still save.
select is(pg_temp.err($$select public.update_menu_item('32000000-0000-4000-8000-000000000004'::uuid, '{"price":1.8,"vatRate":4}'::jsonb)$$), 'ok',
  'Q-a kept: a new price for the dish stored at 4 % that keeps 4 % is accepted (a new version, same rate)');
select is((select vat_rate from app.menu_item_sale_terms_at('22222222-2222-4222-8222-222222222222', array['32000000-0000-4000-8000-000000000004'::uuid], clock_timestamp())),
  4::numeric, 'and the version in force is still at 4 % (nothing silently changed)');
select is(pg_temp.err($$select public.set_sale_settings('{"copertoAmount":3,"copertoVatRate":4}'::jsonb)$$), 'ok',
  'Q-a kept: changing only the coperto amount, with the stored 4 %, is accepted');
select is((select coperto_amount || '@' || coperto_vat_rate from public.sale_settings where tenant_id = '22222222-2222-4222-8222-222222222222'), '3.00@4.00',
  'and the coperto is 3,00 at 4 %');
-- Fresh: a rate that is new for the row is refused.
select is(pg_temp.err($$select public.update_menu_item('32000000-0000-4000-8000-000000000004'::uuid, '{"price":1.8,"vatRate":10}'::jsonb)$$), 'ok',
  'Q-a: moving the dish from 4 % to 10 % (in the list) is accepted');
select is(pg_temp.err($$select public.update_menu_item('32000000-0000-4000-8000-000000000004'::uuid, '{"price":1.8,"vatRate":4}'::jsonb)$$), 'P0001 vat_rate_invalid',
  'Q-a fresh: and moving it back to 4 % is refused (the rate is new against the version it supersedes)');
select is(pg_temp.err($$select public.set_sale_settings('{"copertoAmount":3,"copertoVatRate":10}'::jsonb)$$), 'ok', 'Q-a: moving the coperto to 10 % is accepted');
select is(pg_temp.err($$select public.set_sale_settings('{"copertoAmount":3,"copertoVatRate":4}'::jsonb)$$), 'P0001 vat_rate_invalid',
  'Q-a fresh: and setting it back to 4 % is refused');

-- RLS, grants and function ACLs (plan §3.1.1).
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
set local role authenticated;
select is((select count(*)::int from public.tenant_vat_rate), 5, 'B''s owner reads B''s five rate rows and no other tenant''s');
select is(left(pg_temp.err($$insert into public.tenant_vat_rate (tenant_id, rate) values ('22222222-2222-4222-8222-222222222222', 4)$$), 5), '42501', 'no API role inserts into tenant_vat_rate');
reset role;
select is((select bool_or(has_table_privilege(r, 'public.tenant_vat_rate', p)) from unnest(array['anon', 'authenticated', 'service_role']) r,
            unnest(array['insert', 'update', 'delete', 'truncate']) p), false, 'no write grant to anon, authenticated or service_role');
select is((select string_agg(polname || ':' || polcmd::text, ',') from pg_policy where polrelid = 'public.tenant_vat_rate'::regclass), 'tenant_vat_rate_select:r', 'one policy, select only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('sale_vat_rates', 'check_sale_vat_rate', 'seed_tenant_settings')
              and p.prosecdef and p.proconfig = array['search_path=""']
              and not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, p.oid, 'execute'))), 3,
  'the three functions are definers with an empty search_path and closed to every API role');

select * from finish();
rollback;
