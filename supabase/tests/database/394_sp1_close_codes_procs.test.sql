-- SP1 step 6 (docs/plans/2026-11-15-sp01-tenant-config.md §3.2, §5 step 6): close_table (app.close_session_at) and the day report (app.app_vs_register_json) read the
-- tenant's receipt and payment lists (step 5). Tenant B offers receipt [scontrino] and payment [other, cash] (fattura and card switched off); tenant A offers everything.
-- Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
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
-- The body of a close for a session: the receipt and payment code given, the session's own bill token.
create function pg_temp.body(p_session uuid, p_receipt text, p_payment text) returns jsonb language sql as $$
  select jsonb_build_object('receiptType', p_receipt, 'receiptNumber', '0012-0034', 'paymentType', p_payment,
    'billToken', app.session_bill_json('22222222-2222-4222-8222-222222222222', p_session, null) ->> 'billToken')
$$;

-- B has one menu item, two tables and two open sessions with one fired line each (S1, S2).
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('32000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Grissini B (demo)', 'Contorni', 'antipasti', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, created_by)
  values ('22222222-2222-4222-8222-222222222222', '32000000-0000-4000-8000-000000000001', 1.50, 10, 'b1000000-0000-4000-8000-00000000000b');
create function pg_temp.mk_session(n int) returns void language plpgsql as $$
declare
  suffix text := lpad(n::text, 12, '0');
begin
  insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
    values (('43000000-0000-4000-8000-' || suffix)::uuid, '22222222-2222-4222-8222-222222222222', 'Tavolo B' || n || ' (demo)', n, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
  insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by)
    values (('44000000-0000-4000-8000-' || suffix)::uuid, '22222222-2222-4222-8222-222222222222', ('43000000-0000-4000-8000-' || suffix)::uuid, 'Tavolo B' || n || ' (demo)', 2,
            'e1000000-0000-4000-8000-00000000000e', app.business_date('22222222-2222-4222-8222-222222222222', now()), null, null, 'e1000000-0000-4000-8000-00000000000e', 'e1000000-0000-4000-8000-00000000000e');
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
    values (('45000000-0000-4000-8000-' || suffix)::uuid, '22222222-2222-4222-8222-222222222222', ('44000000-0000-4000-8000-' || suffix)::uuid, '32000000-0000-4000-8000-000000000001',
            'antipasti', 1, 1.50, 10, 'menu', now() - interval '1 hour', 'e1000000-0000-4000-8000-00000000000e', 'e1000000-0000-4000-8000-00000000000e', now(), 'e1000000-0000-4000-8000-00000000000e');
end
$$;
select pg_temp.mk_session(1);
select pg_temp.mk_session(2);

-- S2 closes first, while every code is still offered: fattura paid by card (the later report must still show both after B stops offering them).
select pg_temp.act_as('e0000000-0000-4000-8000-00000000000e', '22222222-2222-4222-8222-222222222222', 'waiter');
select is(pg_temp.err($$select public.close_table('44000000-0000-4000-8000-000000000002'::uuid, pg_temp.body('44000000-0000-4000-8000-000000000002'::uuid, 'fattura', 'card'))$$), 'ok',
  'B closes S2 as fattura by card while both are offered');

-- B now offers receipt [scontrino] and payment [other, cash] (table owner: no API role can write the table).
update public.tenant_close_code set is_active = false where tenant_id = '22222222-2222-4222-8222-222222222222' and ((kind = 'receipt' and code = 'fattura') or (kind = 'payment' and code = 'card'));
update public.tenant_close_code set position = 1 where tenant_id = '22222222-2222-4222-8222-222222222222' and kind = 'payment' and code = 'other';
update public.tenant_close_code set position = 2 where tenant_id = '22222222-2222-4222-8222-222222222222' and kind = 'payment' and code = 'cash';
select is(app.tenant_payment_types('22222222-2222-4222-8222-222222222222'), array['other', 'cash'], 'fixture: B offers payment [other, cash]');

-- The first test of the step: fattura is inactive for B.
select is(pg_temp.err($$select public.close_table('44000000-0000-4000-8000-000000000001'::uuid, pg_temp.body('44000000-0000-4000-8000-000000000001'::uuid, 'fattura', 'cash'))$$), 'P0001 receipt_type_invalid',
  'close_table for B with fattura inactive: P0001 receipt_type_invalid');
select is((select closed_at is null from public.table_session where id = '44000000-0000-4000-8000-000000000001'), true, 'the session stays open');
select is((select receipt_type is null and payment_type is null and total is null from public.table_session where id = '44000000-0000-4000-8000-000000000001'), true, 'and nothing is written on it');
select is(pg_temp.err($$select public.close_table('44000000-0000-4000-8000-000000000001'::uuid, pg_temp.body('44000000-0000-4000-8000-000000000001'::uuid, 'scontrino', 'card'))$$), 'P0001 payment_type_invalid',
  'close_table for B with card inactive: P0001 payment_type_invalid');
select is((select closed_at is null from public.table_session where id = '44000000-0000-4000-8000-000000000001'), true, 'the session stays open again');

-- Error order: the catalogue checks stay where they were (before the session lookup and before the tenant check).
select is(pg_temp.err($$select public.close_table('44000000-0000-4000-8000-000000000001'::uuid, pg_temp.body('44000000-0000-4000-8000-000000000001'::uuid, 'fattura', 'bitcoin'))$$), 'P0001 payment_type_invalid',
  'an unknown payment code with an inactive receipt: the catalogue check on the payment fires first (payment_type_invalid, not receipt_type_invalid)');
select is(pg_temp.err($$select public.close_table('44000000-0000-4000-8000-0000000000ff'::uuid, pg_temp.body('44000000-0000-4000-8000-000000000001'::uuid, 'assegno', 'cash'))$$), 'P0001 receipt_type_invalid',
  'an unknown receipt code on an unknown session: the catalogue check fires before the session is looked up');
select is(pg_temp.err($$select public.close_table('44000000-0000-4000-8000-0000000000ff'::uuid, pg_temp.body('44000000-0000-4000-8000-000000000001'::uuid, 'fattura', 'cash'))$$), 'P0002 session_not_found',
  'an inactive (but catalogued) receipt on an unknown session: session_not_found, the tenant check comes after the lookup');
select is(pg_temp.err($$select public.close_table('44000000-0000-4000-8000-000000000001'::uuid, '{"receiptType":"scontrino","receiptNumber":"1","paymentType":"cash","billToken":"nothex"}'::jsonb)$$), '22023 invalid_request',
  'the shape check is still first');
select is(pg_temp.err($$select public.close_table('44000000-0000-4000-8000-000000000001'::uuid, jsonb_set(pg_temp.body('44000000-0000-4000-8000-000000000001'::uuid, 'scontrino', 'cash'), '{billToken}', '"00000000000000000000000000000000"'))$$),
  'P0001 bill_changed', 'an offered code with a stale bill token is refused for the bill, after the tenant check passed');

-- Replay: S2 was closed with fattura and card before they were switched off. The same close again answers changed false.
select is((select public.close_table('44000000-0000-4000-8000-000000000002'::uuid, pg_temp.body('44000000-0000-4000-8000-000000000002'::uuid, 'fattura', 'card')) ->> 'changed'), 'false',
  'a replay of a session closed with fattura and card before they were deactivated answers changed false');
select is(pg_temp.err($$select public.close_table('44000000-0000-4000-8000-000000000002'::uuid, pg_temp.body('44000000-0000-4000-8000-000000000002'::uuid, 'scontrino', 'card'))$$), 'P0001 session_closed',
  'and a different close of that session is still session_closed');

-- Offered codes close.
select is((select public.close_table('44000000-0000-4000-8000-000000000001'::uuid, pg_temp.body('44000000-0000-4000-8000-000000000001'::uuid, 'scontrino', 'other')) ->> 'changed'), 'true',
  'S1 closes with scontrino and other (both offered)');

-- The day report. B: active codes in position order, then a deactivated code that the day used, in catalogue order.
select is((select jsonb_agg(e ->> 'type') from jsonb_array_elements(app.app_vs_register_json('22222222-2222-4222-8222-222222222222',
        app.business_date('22222222-2222-4222-8222-222222222222', now())) -> 'app' -> 'byPaymentType') e), '["other", "cash", "card"]'::jsonb,
  'B''s report lists its active payment codes in position order (other, cash) and then the deactivated card that the day used');
select is((select jsonb_agg(e ->> 'type') from jsonb_array_elements(app.app_vs_register_json('22222222-2222-4222-8222-222222222222',
        app.business_date('22222222-2222-4222-8222-222222222222', now())) -> 'app' -> 'byReceiptType') e), '["scontrino", "fattura"]'::jsonb,
  'and its receipt codes: scontrino, then the deactivated fattura that the day used');
select is((select jsonb_agg((e ->> 'type') || ':' || (e ->> 'tables')) from jsonb_array_elements(app.app_vs_register_json('22222222-2222-4222-8222-222222222222',
        app.business_date('22222222-2222-4222-8222-222222222222', now())) -> 'app' -> 'byPaymentType') e), '["other:1", "cash:0", "card:1"]'::jsonb,
  'the deactivated code never hides the day''s tables: card shows the one table closed with it');
select is((select (r -> 'app' ->> 'tables')::int = (select sum((e ->> 'tables')::int) from jsonb_array_elements(r -> 'app' -> 'byPaymentType') e)
              and (r -> 'app' ->> 'tables')::int = (select sum((e ->> 'tables')::int) from jsonb_array_elements(r -> 'app' -> 'byReceiptType') e)
          from (select app.app_vs_register_json('22222222-2222-4222-8222-222222222222', app.business_date('22222222-2222-4222-8222-222222222222', now())) r) x), true,
  'and the buckets add up to the day''s table count, by receipt and by payment');
select is((select jsonb_agg(e ->> 'type') from jsonb_array_elements(app.app_vs_register_json('22222222-2222-4222-8222-222222222222',
        app.business_date('22222222-2222-4222-8222-222222222222', now()) - 1) -> 'app' -> 'byReceiptType') e), '["scontrino"]'::jsonb,
  'a day with no sessions lists only B''s active receipt codes (an unused deactivated code is hidden)');
select is((select jsonb_agg(e ->> 'type') from jsonb_array_elements(app.app_vs_register_json('22222222-2222-4222-8222-222222222222',
        app.business_date('22222222-2222-4222-8222-222222222222', now()) - 1) -> 'app' -> 'byPaymentType') e), '["other", "cash"]'::jsonb,
  'and its active payment codes in position order');
-- Tenant A offers everything: the report is the catalogue, in catalogue order.
select is((select jsonb_agg(e ->> 'type') from jsonb_array_elements(app.app_vs_register_json('11111111-1111-4111-8111-111111111111',
        app.business_date('11111111-1111-4111-8111-111111111111', now())) -> 'app' -> 'byReceiptType') e), to_jsonb(app.receipt_types()),
  'tenant A''s report lists the receipt catalogue in its order');
select is((select jsonb_agg(e ->> 'type') from jsonb_array_elements(app.app_vs_register_json('11111111-1111-4111-8111-111111111111',
        app.business_date('11111111-1111-4111-8111-111111111111', now())) -> 'app' -> 'byPaymentType') e), to_jsonb(app.payment_type_codes()),
  'and the payment catalogue in its order');

-- Grants and shape are unchanged.
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('close_session_at', 'app_vs_register_json')
              and p.prosecdef and p.proconfig = array['search_path=""']
              and not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, p.oid, 'execute'))), 2,
  'app.close_session_at and app.app_vs_register_json are definers with an empty search_path, closed to every API role');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'close_table' and p.prosecdef and p.proconfig = array['search_path=""']
              and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), 1,
  'close_table is unchanged: executable by authenticated only');

select * from finish();
rollback;
