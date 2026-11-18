-- SP1 step 7 (docs/plans/2026-11-15-sp01-tenant-config.md §3.1.3, §3.2, §3.3, §5 step 7; X row): tenant.default_locale, public.tenant_settings() (any role, no VAT key) and
-- public.set_tenant_settings(jsonb) (owner or admin, gated, strict, audited, one transaction). The two-session race on the tenant-row lock is in scripts/test-db-races.sh.
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(84);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('bd000000-0000-4000-8000-0000000000bd', 'admin-b@example.test'),
  ('bc000000-0000-4000-8000-0000000000bc', 'chef-b@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('bd100000-0000-4000-8000-0000000000bd', '22222222-2222-4222-8222-222222222222', 'bd000000-0000-4000-8000-0000000000bd', 'admin', 'Admin B Demo'),
  ('bc100000-0000-4000-8000-0000000000bc', '22222222-2222-4222-8222-222222222222', 'bc000000-0000-4000-8000-0000000000bc', 'chef', 'Chef B Demo'),
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
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text, aal text default 'aal2') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', aal)::text, true)
$$;
create function pg_temp.set(p_patch text) returns jsonb language plpgsql as $$ begin return public.set_tenant_settings(p_patch::jsonb); end $$;
create function pg_temp.audit_rows(p_tenant uuid) returns int language sql as $$
  select count(*)::int from public.audit_event where tenant_id = p_tenant and action = 'tenant.settings_changed' $$;

-- The first test of the step: a waiter of B reads exactly the five keys.
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '22222222-2222-4222-8222-222222222222', 'waiter', 'aal1');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.tenant_settings()) k), 'currency,locale,paymentTypes,receiptTypes,timeZone',
  'tenant_settings() as B''s waiter returns exactly the keys timeZone, locale, currency, receiptTypes, paymentTypes');
select is(public.tenant_settings(), '{"timeZone": "Europe/Rome", "locale": "it", "currency": "EUR", "receiptTypes": ["scontrino", "fattura"], "paymentTypes": ["cash", "card", "other"]}'::jsonb,
  'and the values of a new tenant are today''s: Europe/Rome, it, EUR, the two receipt and three payment codes in order');
select is((select count(*)::int from jsonb_object_keys(public.tenant_settings()) k where k ~* 'vat|cost|price'), 0, 'no key matches /vat|cost|price/');
select is(public.tenant_settings()::text ~* 'vat|cost|price|margin', false, 'and nothing in the payload does either');
select is(pg_typeof(public.tenant_settings())::text, 'jsonb', 'it is jsonb');
select pg_temp.act_as('bc000000-0000-4000-8000-0000000000bc', '22222222-2222-4222-8222-222222222222', 'chef', 'aal1');
select is((select public.tenant_settings() ->> 'locale'), 'it', 'a chef reads it too');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select public.tenant_settings() ->> 'timeZone'), 'Europe/Rome', 'and the owner');
select set_config('request.jwt.claims', '', true);
select is(left(pg_temp.err('select public.tenant_settings()'), 5), '42501', 'without a tenant (no token): 42501');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
-- Another tenant's value: B's locale is read from B's row only.
update public.tenant set default_locale = 'en' where id = '11111111-1111-4111-8111-111111111111';
select is((select public.tenant_settings() ->> 'locale'), 'it', 'B reads its own locale (it) while A is en');
update public.tenant set default_locale = 'it' where id = '11111111-1111-4111-8111-111111111111';

-- The column.
select is((select default_locale from public.tenant where id = '22222222-2222-4222-8222-222222222222'), 'it', 'tenant.default_locale defaults to it');
select is(left(pg_temp.err($$update public.tenant set default_locale = 'fr' where id = '22222222-2222-4222-8222-222222222222'$$), 5), '23514', 'a locale outside it and en: 23514');
select is((select pg_get_constraintdef(oid) from pg_constraint where conname = 'tenant_default_locale_check' and conrelid = 'public.tenant'::regclass), 'CHECK ((default_locale = ANY (ARRAY[''it''::text, ''en''::text])))',
  'the constraint is tenant_default_locale_check on (it, en)');
select is(has_column_privilege('anon', 'public.tenant', 'default_locale', 'select'), false, 'anon does not read the column (members read it through tenant_settings() or their own RLS row)');

-- set_tenant_settings: the owner at aal2.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.audit_rows('22222222-2222-4222-8222-222222222222'), 0, 'fixture: no settings audit row yet');
create temp table r1 as select pg_temp.set('{"locale": "en", "saleVatRates": [22, 10], "receiptTypes": ["fattura"], "paymentTypes": ["card", "cash"]}') as j;
grant select on r1 to public;
select is((select j ->> 'changed' from r1), 'true', 'set_tenant_settings as owner at aal2 changes the locale and the lists: changed true');
select is((select j -> 'settings' from r1), '{"timeZone": "Europe/Rome", "locale": "en", "currency": "EUR", "receiptTypes": ["fattura"], "paymentTypes": ["card", "cash"], "saleVatRates": [10, 22]}'::jsonb,
  'and answers the new settings, with saleVatRates (sorted ascending, no trailing zeros)');
select is((select public.tenant_settings()), '{"timeZone": "Europe/Rome", "locale": "en", "currency": "EUR", "receiptTypes": ["fattura"], "paymentTypes": ["card", "cash"]}'::jsonb, 'tenant_settings() reads them back, without saleVatRates');
select is(app.sale_vat_rates('22222222-2222-4222-8222-222222222222'), array[10, 22]::numeric[], 'the sale list of B is [10, 22]');
select is((select count(*)::int from public.tenant_vat_rate where tenant_id = '22222222-2222-4222-8222-222222222222'), 5, 'the five rate rows are still there (rows are never deleted)');
select is((select count(*)::int from public.tenant_close_code where tenant_id = '22222222-2222-4222-8222-222222222222'), 5, 'and the five code rows');
select is((select string_agg(code || '@' || position, ',' order by position) from public.tenant_close_code where tenant_id = '22222222-2222-4222-8222-222222222222' and kind = 'payment' and is_active), 'card@1,cash@2',
  'the array order is the position');
select is((select is_active from public.tenant_close_code where tenant_id = '22222222-2222-4222-8222-222222222222' and kind = 'receipt' and code = 'scontrino'), false, 'a code left out is switched off, not deleted');
select is((select count(*)::int from public.tenant_vat_rate where tenant_id = '22222222-2222-4222-8222-222222222222' and updated_by = 'b1000000-0000-4000-8000-00000000000b'), 3, 'the three rates switched off name the owner as author');
select is(pg_temp.audit_rows('22222222-2222-4222-8222-222222222222'), 1, 'one tenant.settings_changed audit row');
select is((select entity_type || '/' || entity_id::text || '/' || created_by::text from public.audit_event where tenant_id = '22222222-2222-4222-8222-222222222222' and action = 'tenant.settings_changed'),
  'tenant/22222222-2222-4222-8222-222222222222/b1000000-0000-4000-8000-00000000000b', 'about the tenant, by the owner');
select is((select before from public.audit_event where tenant_id = '22222222-2222-4222-8222-222222222222' and action = 'tenant.settings_changed'),
  '{"default_locale": "it", "sale_vat_rates": [0, 4, 5, 10, 22], "receipt_types": ["scontrino", "fattura"], "payment_types": ["cash", "card", "other"]}'::jsonb, 'before holds the changed keys, codes and numbers only');
select is((select after from public.audit_event where tenant_id = '22222222-2222-4222-8222-222222222222' and action = 'tenant.settings_changed'),
  '{"default_locale": "en", "sale_vat_rates": [10, 22], "receipt_types": ["fattura"], "payment_types": ["card", "cash"]}'::jsonb, 'and so does after');
select is((select (before::text || after::text) ~ '@|Demo|Titolare' from public.audit_event where tenant_id = '22222222-2222-4222-8222-222222222222' and action = 'tenant.settings_changed'), false,
  'the audit row holds no @ and no name');

-- A second identical call changes nothing and writes nothing.
create temp table stamp as select max(updated_at) as v, (select max(updated_at) from public.tenant_close_code where tenant_id = '22222222-2222-4222-8222-222222222222') as c
  from public.tenant_vat_rate where tenant_id = '22222222-2222-4222-8222-222222222222';
grant select on stamp to public;
select is((select pg_temp.set('{"locale": "en", "saleVatRates": [10, 22], "receiptTypes": ["fattura"], "paymentTypes": ["card", "cash"]}') ->> 'changed'), 'false', 'a second identical call answers changed false');
select is(pg_temp.audit_rows('22222222-2222-4222-8222-222222222222'), 1, 'and writes no audit row');
select is((select max(updated_at) = (select v from stamp) from public.tenant_vat_rate where tenant_id = '22222222-2222-4222-8222-222222222222'), true, 'and touches no rate row');
select is((select max(updated_at) = (select c from stamp) from public.tenant_close_code where tenant_id = '22222222-2222-4222-8222-222222222222'), true, 'nor any code row');
select is((select pg_temp.set('{"saleVatRates": [22.00, 10.0]}') ->> 'changed'), 'false', 'the same rates written as 22.00 and 10.0, in another order, are no change');

-- A partial patch changes and audits only its key; a reorder is a change; a switched-off code comes back at the array position.
select is((select pg_temp.set('{"locale": "it"}') ->> 'changed'), 'true', 'a locale-only patch changes the locale');
select is((select count(*)::int from public.audit_event where tenant_id = '22222222-2222-4222-8222-222222222222' and action = 'tenant.settings_changed' and before = '{"default_locale": "en"}' and after = '{"default_locale": "it"}'), 1,
  'and its audit row holds that key only');
select is((select pg_temp.set('{"paymentTypes": ["cash", "card"]}') ->> 'changed'), 'true', 'reordering the payment codes is a change');
select is((select public.tenant_settings() -> 'paymentTypes'), '["cash", "card"]'::jsonb, 'and the list follows');
select is((select pg_temp.set('{"receiptTypes": ["scontrino", "fattura"], "paymentTypes": ["other", "cash", "card"]}') ->> 'changed'), 'true', 'switching a code back on is a change');
select is((select public.tenant_settings()), '{"timeZone": "Europe/Rome", "locale": "it", "currency": "EUR", "receiptTypes": ["scontrino", "fattura"], "paymentTypes": ["other", "cash", "card"]}'::jsonb,
  'and the lists are read back in the new order');
select is((select count(*)::int from public.tenant_close_code where tenant_id = '22222222-2222-4222-8222-222222222222'), 5, 'still five code rows after all those changes');

-- Roles: chef and waiter are refused, a gated owner or admin too.
select pg_temp.act_as('bc000000-0000-4000-8000-0000000000bc', '22222222-2222-4222-8222-222222222222', 'chef');
select is(left(pg_temp.err($$select pg_temp.set('{"locale": "en"}')$$), 5), '42501', 'as a chef: 42501');
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '22222222-2222-4222-8222-222222222222', 'waiter');
select is(left(pg_temp.err($$select pg_temp.set('{"locale": "en"}')$$), 5), '42501', 'as a waiter: 42501');
select is((select default_locale from public.tenant where id = '22222222-2222-4222-8222-222222222222'), 'it', 'and nothing changed');
-- X row, by token: B's owner with a forged tenant claim naming A is refused (app.tenant_id() is null when the claim and the membership disagree), and A is untouched.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '11111111-1111-4111-8111-111111111111', 'owner');
select is(left(pg_temp.err($$select pg_temp.set('{"locale": "en"}')$$), 5), '42501', 'B''s owner with a forged claim for A: 42501');
select is((select default_locale from public.tenant where id = '11111111-1111-4111-8111-111111111111'), 'it', 'and A''s locale is unchanged');
-- #79: an owner with a verified factor at aal1 under mode required is gated; at aal2 the same call works.
update public.tenant set mfa_enforcement = 'required' where id = '22222222-2222-4222-8222-222222222222';
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values (gen_random_uuid(), 'b0000000-0000-4000-8000-00000000000b', 'Principale', 'totp', 'verified', now(), now(), 'fake-secret-value');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner', 'aal1');
select is(left(pg_temp.err($$select pg_temp.set('{"locale": "en"}')$$), 5), '42501', 'an owner with a verified factor at aal1 under mode required is gated: 42501');
select is(left(pg_temp.err('select public.tenant_settings()'), 5), '42501', 'and tenant_settings() answers 42501 for the gated token too (it has no tenant yet)');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner', 'aal2');
select is((select pg_temp.set('{"locale": "en"}') ->> 'changed'), 'true', 'at aal2 the same owner changes the settings');
update public.tenant set mfa_enforcement = 'off' where id = '22222222-2222-4222-8222-222222222222';
select pg_temp.act_as('bd000000-0000-4000-8000-0000000000bd', '22222222-2222-4222-8222-222222222222', 'admin', 'aal1');
select is(left(pg_temp.err($$select pg_temp.set('{"locale": "it"}')$$), 5), '42501', 'an admin at aal1 is gated in every mode, even off (FD31): 42501');
select pg_temp.act_as('bd000000-0000-4000-8000-0000000000bd', '22222222-2222-4222-8222-222222222222', 'admin', 'aal2');
select is((select pg_temp.set('{"locale": "it"}') ->> 'changed'), 'true', 'an admin at aal2 changes them');
select is((select count(*)::int from public.audit_event where tenant_id = '22222222-2222-4222-8222-222222222222' and action = 'tenant.settings_changed' and created_by = 'bd100000-0000-4000-8000-0000000000bd'
              and after = '{"default_locale": "it"}'), 1, 'and the audit row names the admin');

-- Validation: every refusal has its code, and writes nothing (one transaction).
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner', 'aal2');
create temp table before_all as select (select count(*) from public.audit_event where tenant_id = '22222222-2222-4222-8222-222222222222') as a,
  (select string_agg(rate::text || is_active::text, ',' order by rate) from public.tenant_vat_rate where tenant_id = '22222222-2222-4222-8222-222222222222') as v,
  (select string_agg(kind || code || position || is_active::text, ',' order by kind, code) from public.tenant_close_code where tenant_id = '22222222-2222-4222-8222-222222222222') as c,
  (select default_locale from public.tenant where id = '22222222-2222-4222-8222-222222222222') as l;
grant select on before_all to public;
select is(pg_temp.err($$select pg_temp.set('{"saleVatRates": []}')$$), 'P0001 settings_list_empty', 'an empty VAT list: P0001 settings_list_empty');
select is(pg_temp.err($$select pg_temp.set('{"receiptTypes": []}')$$), 'P0001 settings_list_empty', 'an empty receipt list: settings_list_empty');
select is(pg_temp.err($$select pg_temp.set('{"paymentTypes": []}')$$), 'P0001 settings_list_empty', 'an empty payment list: settings_list_empty');
select is(pg_temp.err($$select pg_temp.set('{"saleVatRates": [10, 10]}')$$), 'P0001 vat_rate_invalid', 'a duplicate rate: vat_rate_invalid');
select is(pg_temp.err($$select pg_temp.set('{"saleVatRates": [10, 12]}')$$), 'P0001 vat_rate_invalid', 'a rate outside the statutory list: vat_rate_invalid');
select is(pg_temp.err($$select pg_temp.set('{"saleVatRates": [10.5]}')$$), 'P0001 vat_rate_invalid', 'a fractional rate outside the statute: vat_rate_invalid');
select is(pg_temp.err($$select pg_temp.set('{"receiptTypes": ["fattura", "fattura"]}')$$), 'P0001 receipt_type_invalid', 'a duplicate receipt code: receipt_type_invalid');
select is(pg_temp.err($$select pg_temp.set('{"receiptTypes": ["assegno"]}')$$), 'P0001 receipt_type_invalid', 'a receipt code outside the catalogue: receipt_type_invalid');
select is(pg_temp.err($$select pg_temp.set('{"receiptTypes": ["cash"]}')$$), 'P0001 receipt_type_invalid', 'a payment code under receiptTypes: receipt_type_invalid (the catalogue is per kind)');
select is(pg_temp.err($$select pg_temp.set('{"paymentTypes": ["cash", "cash"]}')$$), 'P0001 payment_type_invalid', 'a duplicate payment code: payment_type_invalid');
select is(pg_temp.err($$select pg_temp.set('{"paymentTypes": ["bitcoin"]}')$$), 'P0001 payment_type_invalid', 'a payment code outside the catalogue: payment_type_invalid');
select is(pg_temp.err($$select pg_temp.set('{"locale": "fr"}')$$), 'P0001 locale_invalid', 'a locale outside it and en: locale_invalid');
select is(pg_temp.err($$select pg_temp.set('{"locale": "EN"}')$$), 'P0001 locale_invalid', 'and the case matters: locale_invalid');
select is(pg_temp.err($$select pg_temp.set('{"locale": 1}')$$), '22023 invalid_request', 'a locale that is not a string: 22023');
select is(pg_temp.err($$select pg_temp.set('{"saleVatRates": ["10"]}')$$), '22023 invalid_request', 'a rate given as a string: 22023');
select is(pg_temp.err($$select pg_temp.set('{"saleVatRates": 10}')$$), '22023 invalid_request', 'a list that is not an array: 22023');
select is(pg_temp.err($$select pg_temp.set('{"receiptTypes": [1]}')$$), '22023 invalid_request', 'a code that is not a string: 22023');
select is(pg_temp.err($$select pg_temp.set('{"paymentTypes": [' || (select string_agg('"cash"', ',') from generate_series(1, 21)) || ']}')$$), '22023 invalid_request', 'a list of more than 20: 22023');
select is(pg_temp.err($$select pg_temp.set('{"extra": 1}')$$), '22023 invalid_request', 'an unknown key: 22023');
select is(pg_temp.err($$select pg_temp.set('{"locale": "en", "extra": 1}')$$), '22023 invalid_request', 'a valid key with an unknown one: 22023');
select is(pg_temp.err($$select pg_temp.set('{}')$$), '22023 invalid_request', 'no key: 22023');
select is(pg_temp.err($$select public.set_tenant_settings(null)$$), '22023 invalid_request', 'a null patch: 22023');
select is(pg_temp.err($$select public.set_tenant_settings('[]'::jsonb)$$), '22023 invalid_request', 'an array patch: 22023');
select is(pg_temp.err($$select pg_temp.set('{"locale": "en", "saleVatRates": [12]}')$$), 'P0001 vat_rate_invalid', 'a good locale with a bad list is refused as a whole');
select is((select (select count(*) from public.audit_event where tenant_id = '22222222-2222-4222-8222-222222222222') = a
              and (select string_agg(rate::text || is_active::text, ',' order by rate) from public.tenant_vat_rate where tenant_id = '22222222-2222-4222-8222-222222222222') = v
              and (select string_agg(kind || code || position || is_active::text, ',' order by kind, code) from public.tenant_close_code where tenant_id = '22222222-2222-4222-8222-222222222222') = c
              and (select default_locale from public.tenant where id = '22222222-2222-4222-8222-222222222222') = l from before_all), true,
  'and every refusal above left the audit log, the rates, the codes and the locale as they were');

-- X: B's owner cannot touch A.
select is((select count(*)::int from public.tenant_close_code where tenant_id = '11111111-1111-4111-8111-111111111111' and is_active), 5, 'A still offers all five codes');
select is(app.sale_vat_rates('11111111-1111-4111-8111-111111111111'), array[0, 4, 5, 10, 22]::numeric[], 'A''s sale list is untouched by B''s changes');
select is(pg_temp.audit_rows('11111111-1111-4111-8111-111111111111'), 0, 'and A has no settings audit row');
select is((select default_locale from public.tenant where id = '11111111-1111-4111-8111-111111111111'), 'it', 'A''s locale is untouched');

-- The functions: definers, empty search_path, executable by authenticated only; the trigger function stays closed.
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('tenant_settings', 'set_tenant_settings')
              and p.prosecdef and p.proconfig = array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute')
              and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')
              and p.proowner = 'postgres'::regrole), 2, 'both functions are definers with an empty search_path, executable by authenticated only');
select is((select string_agg(proname::text || ':' || provolatile::text, ',' order by proname::text) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('tenant_settings', 'set_tenant_settings')),
  'set_tenant_settings:v,tenant_settings:s', 'tenant_settings is stable and set_tenant_settings volatile');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'check_sale_vat_rate' and p.prosecdef and p.proconfig = array['search_path=""']
              and not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, p.oid, 'execute'))), 1,
  'app.check_sale_vat_rate (re-created with the tenant-row lock) is still a definer closed to every API role');
select is((select pg_get_triggerdef(oid) from pg_trigger where tgname = 'menu_item_price_sale_vat'), 'CREATE TRIGGER menu_item_price_sale_vat BEFORE INSERT OR UPDATE OF vat_rate ON public.menu_item_price FOR EACH ROW EXECUTE FUNCTION app.check_sale_vat_rate()',
  'and its two triggers are the ones of step 3');

select * from finish();
rollback;
