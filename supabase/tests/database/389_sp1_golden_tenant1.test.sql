-- SP1 step 1 (docs/plans/2026-11-15-sp01-tenant-config.md §5 step 1; platform plan §6.5 rule 5): G, the tenant #1 golden payloads.
-- A tenant-#1-shaped FAKE fixture (coperto on, prices at the five statutory rates, two receipt codes and three payment codes in use),
-- inserted as table owner with fixed ids and fixed instants, and the md5 of the jsonb text of each payload pinned. It was taken on main
-- BEFORE any SP1 change and passes there by design; it must stay green, unchanged, through every later SP1 step (AT6) and every later
-- platform milestone unless that milestone's plan says a payload changes.
--   menu_list(), menu_items_manage(), sale_settings_read(), tables_list()   as called by 153, 154, 157
--   app.session_bill_json (an open and a closed session)                    as called by 216
--   app.app_vs_register_json                                                as called by 220
-- Only two volatile values are removed before hashing, because they are the clock itself: `asOf` (clock_timestamp()) and the business
-- date of today (computed in the test with app.business_date, and used as the fixture's business date). Today's date appears in three
-- places, all removed: tables_list().businessDate, the day report's businessDate, and the closed bill's receipt.businessDate (each has a
-- readable anchor below instead). The billToken holds no date (lines, covers and coperto only).
-- Every other date is fixed in 1997-1998 (the fakes' years; tests/guards/no-date-bombs.test.ts), so the hashes never depend on today.
-- The proof that the pins can fail is the mutation block at the end: one price changes and the menu hashes must differ.
begin;
-- The pins render timestamptz as text: a session time zone other than UTC (a non-UTC PGTZ) would move the pins, so it is fixed here.
set local timezone = 'UTC';
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-g@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-g@example.test');
insert into public.tenant (id, name, vat_number, settings) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo G', 'IT00000000000', '{"sale_vat_pct": 10}');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', 'aal1')::text, true)
$$;
create temp table today (d date not null);
insert into today select app.business_date('11111111-1111-4111-8111-111111111111', clock_timestamp());

-- Menu: one item per statutory rate (0, 4, 5, 10, 22), two categories shared by several items, one item with two price rows.
insert into public.menu_item (id, tenant_id, name, category, course_default, position, created_by, updated_by) values
  ('31000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('31000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle al ragù (demo)', 'Primi', 'primi', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('31000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', 5, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('31000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Vino rosso (demo)', 'Bevande', 'bevande', 6, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('31000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Pane (demo)', 'Contorni', 'antipasti', 3, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('31000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'Dolce del giorno (demo)', 'Dolci', 'dolci', 4, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('31000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'Servizio extra (demo)', 'Contorni', 'antipasti', 4, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by) values
  ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000001', 13.00, 10, '1997-01-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000001', 14.00, 10, '1998-01-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000002', 12.50, 10, '1998-01-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000003', 2.00, 22, '1998-01-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000004', 40.25, 22, '1998-01-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000005', 1.50, 4, '1998-01-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000006', 6.00, 5, '1998-01-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000007', 1.00, 0, '1998-01-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a');
-- Coperto on: 2,50 per person at 10 %.
insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by, created_at, updated_at)
  values ('11111111-1111-4111-8111-111111111111', 2.50, 10, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a',
          '1998-01-01 00:00+00', '1998-01-01 00:00+00');
-- Six tables: 1 and 2 open, 3, 4 and 6 closed today, 5 free.
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('33000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 6) n;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, coperto_amount, coperto_vat_rate,
                                  created_by, updated_by)
  select ('34000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', ('33000000-0000-4000-8000-00000000000' || n)::uuid,
         'Tavolo ' || n || ' (demo)', case n when 1 then 3 else 2 end, '1998-01-02 19:00+00', 'd1000000-0000-4000-8000-00000000000d', (select d from today),
         2.50, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 4) n;
-- Table 6: a session of today without a coperto (a table opened before the coperto was set).
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by)
  values ('34000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', '33000000-0000-4000-8000-000000000006', 'Tavolo 6 (demo)', 1,
          '1998-01-02 19:00+00', 'd1000000-0000-4000-8000-00000000000d', (select d from today), 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
-- Order lines: fixed ids and instants. State is derived (fired_at, voided_at).
create function pg_temp.addl(p_n int, p_session int, p_item int, p_course public.course, p_qty numeric, p_price numeric, p_vat numeric, p_state text) returns void language sql as $$
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, is_shared,
                                 client_updated_at, created_at, created_by, updated_by, fired_at, fired_by, voided_at, voided_by, void_reason)
  values (('35000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
          ('34000000-0000-4000-8000-00000000000' || p_session)::uuid, ('31000000-0000-4000-8000-00000000000' || p_item)::uuid, p_course, p_qty, p_price, p_vat, 'menu', false,
          '1998-01-02 20:00+00', '1998-01-02 20:00+00'::timestamptz + p_n * interval '1 minute', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
          case when p_state in ('fired', 'voided') then '1998-01-02 20:00+00'::timestamptz + p_n * interval '1 minute' end,
          case when p_state in ('fired', 'voided') then 'd1000000-0000-4000-8000-00000000000d'::uuid end,
          case when p_state = 'voided' then '1998-01-02 20:00+00'::timestamptz + p_n * interval '1 minute' + interval '1 minute' end,
          case when p_state = 'voided' then 'd1000000-0000-4000-8000-00000000000d'::uuid end,
          case when p_state = 'voided' then 'wrong_dish' end)
$$;
-- Table 1: two plates, half a plate, a wine and a voided plate. Table 2: a fired plate and a draft. Tables 3, 4, 6: fired lines, then closed.
select pg_temp.addl(1, 1, 1, 'secondi', 2, 14.00, 10, 'fired');
select pg_temp.addl(2, 1, 1, 'secondi', 0.5, 14.00, 10, 'fired');
select pg_temp.addl(3, 1, 2, 'primi', 1.5, 12.50, 10, 'fired');
select pg_temp.addl(4, 1, 4, 'bevande', 1, 40.25, 22, 'fired');
select pg_temp.addl(5, 1, 2, 'primi', 1, 12.50, 10, 'voided');
select pg_temp.addl(6, 2, 1, 'secondi', 1, 14.00, 10, 'fired');
select pg_temp.addl(7, 2, 3, 'bevande', 1, 2.00, 22, 'draft');
select pg_temp.addl(8, 3, 1, 'secondi', 2, 14.00, 10, 'fired');
select pg_temp.addl(9, 4, 6, 'dolci', 2, 6.00, 5, 'fired');
select pg_temp.addl(10, 4, 5, 'antipasti', 2, 1.50, 4, 'fired');
select pg_temp.addl(11, 6, 4, 'bevande', 1, 40.25, 22, 'fired');
-- Closing, as the procedure's final UPDATE does (the guard wants all four details): both receipt codes, all three payment codes, one without a number.
update public.table_session set closed_at = '1998-01-02 21:00+00', closed_by = 'd1000000-0000-4000-8000-00000000000d', closed_business_date = (select d from today),
       receipt_type = 'scontrino', receipt_number = '0012-0034', payment_type = 'card', total = 33.00 where id = '34000000-0000-4000-8000-000000000003';
update public.table_session set closed_at = '1998-01-02 21:05+00', closed_by = 'd1000000-0000-4000-8000-00000000000d', closed_business_date = (select d from today),
       receipt_type = 'fattura', payment_type = 'cash', total = 20.00 where id = '34000000-0000-4000-8000-000000000004';
update public.table_session set closed_at = '1998-01-02 21:10+00', closed_by = 'd1000000-0000-4000-8000-00000000000d', closed_business_date = (select d from today),
       receipt_type = 'scontrino', receipt_number = '0012-0035', payment_type = 'other', total = 40.25 where id = '34000000-0000-4000-8000-000000000006';
-- The register entry of the day.
insert into public.day_close (tenant_id, business_date, register_total, created_at, created_by)
  values ('11111111-1111-4111-8111-111111111111', (select d from today), 93.00, '1998-01-02 22:00+00', 'a1000000-0000-4000-8000-00000000000a');

-- Sanity on the fixture, so a failing pin below has a readable cause.
select is((select count(*)::int from public.menu_item_price where tenant_id = '11111111-1111-4111-8111-111111111111'), 8, 'fixture: eight price rows');
select is((select array_agg(distinct vat_rate order by vat_rate) from public.menu_item_price where tenant_id = '11111111-1111-4111-8111-111111111111'),
  array[0, 4, 5, 10, 22]::numeric[], 'fixture: prices at the five statutory rates');
select is((select array_agg(distinct receipt_type order by receipt_type) || array_agg(distinct payment_type order by payment_type) from public.table_session
            where closed_at is not null), array['fattura', 'scontrino', 'card', 'cash', 'other'], 'fixture: two receipt codes and three payment codes in use');

create temp table g (k text primary key, j jsonb not null);
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
insert into g select 'menu_list', public.menu_list();
insert into g select 'tables_list', public.tables_list() - 'businessDate';
insert into g select 'bill_open', app.session_bill_json('11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', null);
insert into g select 'bill_closed_raw', app.session_bill_json('11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000003', null);
insert into g select 'bill_closed', j #- '{receipt,businessDate}' from g where k = 'bill_closed_raw';
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
insert into g select 'menu_items_manage', public.menu_items_manage();
insert into g select 'sale_settings_read', public.sale_settings_read();
insert into g select 'day_report', app.app_vs_register_json('11111111-1111-4111-8111-111111111111', (select d from today)) - 'asOf' - 'businessDate';

-- The pins (md5 of the jsonb text), taken on main before any SP1 change.
select is((select md5(j::text) from g where k = 'menu_list'), 'e8aaf7b372b1ceeb68727af4df3dc10f', 'G: menu_list() payload');
select is((select md5(j::text) from g where k = 'menu_items_manage'), '88d08bb5dcaf51d10e19a8dc8ecea317', 'G: menu_items_manage() payload (vatRates, defaults, items)');
select is((select md5(j::text) from g where k = 'sale_settings_read'), 'b7fc06840c7017dc8d9e77b0751eff51', 'G: sale_settings_read() payload (coperto, vatRates)');
select is((select md5(j::text) from g where k = 'tables_list'), 'de747e37221d98278854897c89b867a6', 'G: tables_list() payload (without the business date of today)');
select is((select md5(j::text) from g where k = 'bill_open'), 'ce41449545f6df3ec956c1c379ad339a', 'G: the bill of an open session with coperto (app.session_bill_json)');
select is((select md5(j::text) from g where k = 'bill_closed'), '6807963ece6973da138997ea1f110027', 'G: the bill of a closed session (receipt block)');
select is((select md5(j::text) from g where k = 'day_report'), '9a910a8c69bbea8a6e87a067e09f7693', 'G: the day report (app.app_vs_register_json, without asOf and the date)');

-- Readable anchors next to the hashes.
select is((select (j ->> 'total')::numeric from g where k = 'bill_open'), 101.50, 'the open bill totals 101,50 (94,00 + 3 x 2,50 coperto; one plate voided)');
select is((select j -> 'vatRates' from g where k = 'menu_items_manage'), '[0,4,5,10,22]'::jsonb, 'the manage list offers the five rates');
select is((select j -> 'coperto' from g where k = 'sale_settings_read'), '{"amount":2.5,"vatRate":10}'::jsonb, 'the coperto is 2,50 at 10 %');
select is((select (j -> 'app' ->> 'total')::numeric from g where k = 'day_report'), 93.25, 'the day report counts the three closed sessions');
select is((select (j #>> '{receipt,businessDate}')::date from g where k = 'bill_closed_raw'), (select d from today),
  'the closed bill''s receipt carries today''s business date (removed before hashing)');

-- Mutation: change one price of the fixture and the menu payloads must leave their pins. This is what proves the pins can fail.
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  values ('11111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000001', 14.01, 10, '1998-06-01 00:00+00', 'a1000000-0000-4000-8000-00000000000a');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select isnt(md5(public.menu_list()::text), (select md5(j::text) from g where k = 'menu_list'), 'mutation: one price changed, the menu_list() hash differs from its pin');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select isnt(md5(public.menu_items_manage()::text), (select md5(j::text) from g where k = 'menu_items_manage'), 'mutation: and so does the menu_items_manage() hash');
select is((select jsonb_path_query_first(public.menu_items_manage(), '$.items[*] ? (@.id == "31000000-0000-4000-8000-000000000001")') ->> 'price')::numeric, 14.01::numeric,
  'mutation sanity: the new price of the stew is the one the manage list shows (14,01)');

select * from finish();
rollback;
