-- SP1 step 4 (docs/plans/2026-11-15-sp01-tenant-config.md §3.2, §5 step 4; AT1 "reads"): the owner's two sale reads and the default rate follow the tenant's
-- SALE VAT list (app.sale_vat_rates) instead of the statutory one. Tenant B's list is [10, 22]; tenant A keeps today's five rates, and its payload text is the
-- same as before (pgTAP 389 pins it). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-b@example.test');
insert into public.tenant (id, name, vat_number, settings) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000', '{"sale_vat_pct": 10}'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115', '{"sale_vat_pct": 4}');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
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

-- B's sale list becomes [10, 22] (table owner: no API role can write the table).
update public.tenant_vat_rate set is_active = false where tenant_id = '22222222-2222-4222-8222-222222222222' and rate in (0, 4, 5);

-- The first test of the step: the manage read lists B's own list.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select public.menu_items_manage() -> 'vatRates')::text, '[10, 22]', 'menu_items_manage() for B lists vatRates [10, 22]');
select is((select public.sale_settings_read() -> 'vatRates')::text, '[10, 22]', 'sale_settings_read() for B lists vatRates [10, 22]');

-- Tenant A: the statutory five, with the same text as before.
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select public.menu_items_manage() -> 'vatRates')::text, '[0, 4, 5, 10, 22]', 'menu_items_manage() for A lists today''s five rates, same text');
select is((select public.sale_settings_read() -> 'vatRates')::text, '[0, 4, 5, 10, 22]', 'sale_settings_read() for A lists today''s five rates, same text');
select is((select public.menu_items_manage() -> 'vatRates')::text, to_jsonb(app.allowed_vat_rates())::text, 'and it is the text of the statutory list');
select is((select public.menu_items_manage() -> 'defaults' ->> 'vatRate'), '10', 'A''s default rate is 10 (sale_vat_pct 10 is in its list)');
select is((select public.sale_settings_read() -> 'defaults' ->> 'vatRate'), '10', 'in the settings read too');

-- default_vat_rate: B with sale_vat_pct 4 (not in its list) gets null, with 10 gets 10; A unchanged.
select is(app.default_vat_rate('22222222-2222-4222-8222-222222222222'), null, 'default_vat_rate(B) with sale_vat_pct 4 (outside its list) is null');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select public.menu_items_manage() -> 'defaults' ->> 'vatRate'), null, 'and menu_items_manage() shows no default for B');
select is((select public.menu_items_manage() -> 'defaults' ? 'vatRate'), true, 'the vatRate key is there, with a null value (not missing)');
update public.tenant set settings = settings || '{"sale_vat_pct": 10}' where id = '22222222-2222-4222-8222-222222222222';
select is(app.default_vat_rate('22222222-2222-4222-8222-222222222222'), 10::numeric, 'default_vat_rate(B) with sale_vat_pct 10 is 10');
update public.tenant set settings = settings || '{"sale_vat_pct": 22}' where id = '22222222-2222-4222-8222-222222222222';
select is(app.default_vat_rate('22222222-2222-4222-8222-222222222222'), 22::numeric, 'and with 22 it is 22');
select is(app.default_vat_rate('11111111-1111-4111-8111-111111111111'), 10::numeric, 'default_vat_rate(A) is unchanged: 10');
-- sale_vat_pct 12 is outside the statute, so it is outside every tenant list as well.
update public.tenant set settings = settings || '{"sale_vat_pct": 12}' where id = '11111111-1111-4111-8111-111111111111';
select is(app.default_vat_rate('11111111-1111-4111-8111-111111111111'), null, 'default_vat_rate(A) with sale_vat_pct 12 (outside the statute) is null, as before');

-- Roles: the reads stay owner/admin only; a waiter is refused.
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '22222222-2222-4222-8222-222222222222', 'waiter');
select is(left(pg_temp.err('select public.menu_items_manage()'), 5), '42501', 'a waiter still cannot call menu_items_manage()');
select is(left(pg_temp.err('select public.sale_settings_read()'), 5), '42501', 'nor sale_settings_read()');

-- Grants and definitions: unchanged shape (definers, empty search_path, authenticated only; the helper closed).
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('menu_items_manage', 'sale_settings_read')
              and p.prosecdef and p.proconfig = array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute')
              and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 2,
  'both reads are definers with an empty search_path, executable by authenticated only');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'default_vat_rate' and p.prosecdef and p.provolatile = 's'
              and p.proconfig = array['search_path=""'] and not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, p.oid, 'execute'))), 1,
  'app.default_vat_rate stays a stable definer, closed to every API role');

select * from finish();
rollback;
