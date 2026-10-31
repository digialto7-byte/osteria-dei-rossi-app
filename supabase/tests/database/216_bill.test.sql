-- M21 step 2 (docs/plans/2026-10-30-m21-bill-close.md §3.1.1-3.1.2, §3.2, §5; ADR-023; AT2): app.split_cents, app.session_bill_json and
-- public.session_bill: the bill (non-voided lines, half portions, coperto, VAT-inclusive total), the split by covers and by items exact to
-- the cent, the billToken, the shape (no cost-like key) and the roles. Two sessions and two tenants everywhere. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(83);

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
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');

-- Menu: invented prices (plan §3.1.2). Item 5 only exists to make 100,01 and the 7,25 rounding case.
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle al ragù (demo)', 'Primi', 'primi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Vino rosso (demo)', 'Bevande', 'bevande', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Dolce del giorno (demo)', 'Dolci', 'dolci', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('21000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Acqua B (demo)', 'Bevande', 'bevande', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 6) n;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('23000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
-- S1 AT2 (3 covers, coperto 2,00 at 10 %), S2 no coperto (2 covers), S3 drafts (2 covers, coperto 2,00), S4 tokens (2 covers, coperto 2,00),
-- S5 for 100,01 (no coperto, 1 cover), SB tenant B.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, coperto_amount, coperto_vat_rate, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 3, 'd1000000-0000-4000-8000-00000000000d', '2026-11-04', 2.00, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '2026-11-04', null, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000003', 'Tavolo 3 (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '2026-11-04', 2.00, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000004', 'Tavolo 4 (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '2026-11-04', 2.00, 10, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('14000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000005', 'Tavolo 5 (demo)', 1, 'd1000000-0000-4000-8000-00000000000d', '2026-11-04', null, null, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('24000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '23000000-0000-4000-8000-000000000001', 'Tavolo B (demo)', 2, 'b1000000-0000-4000-8000-00000000000b', '2026-11-04', null, null, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

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
create function pg_temp.detail_of(stmt text) returns jsonb language plpgsql as $$
declare
  d text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d::jsonb;
end
$$;
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
-- One order line (the owner fixture writes states no procedure can write directly): state is draft, fired, voided (after fire) or removed (before fire).
create function pg_temp.addl(p_id uuid, p_session uuid, p_item uuid, p_course public.course, p_qty numeric, p_price numeric, p_state text,
                             p_at timestamptz, p_shared boolean default false) returns void language sql as $$
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, is_shared,
                                 client_updated_at, created_at, created_by, updated_by, fired_at, fired_by, voided_at, voided_by, void_reason)
  values (p_id, '11111111-1111-4111-8111-111111111111', p_session, p_item, p_course, p_qty, p_price, 10, 'menu', p_shared,
          '2026-11-04 20:00+00', p_at, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
          case when p_state in ('fired', 'voided') then p_at end, case when p_state in ('fired', 'voided') then 'd1000000-0000-4000-8000-00000000000d'::uuid end,
          case when p_state in ('voided', 'removed') then p_at + interval '1 minute' end,
          case when p_state in ('voided', 'removed') then 'd1000000-0000-4000-8000-00000000000d'::uuid end,
          case when p_state = 'voided' then 'wrong_dish' when p_state = 'removed' then 'entry_removed' end)
$$;
create temporary table reg (k text primary key, id uuid not null);
insert into reg select 'l' || n, ('15000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 30) n;
insert into reg select 's' || n, ('14000000-0000-4000-8000-00000000000' || n)::uuid from generate_series(1, 5) n;
insert into reg values ('sb', '24000000-0000-4000-8000-000000000001');
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;

-- S1: the AT2 table. 2 x Spezzatino, 1/2 Spezzatino, 1,5 x Tagliatelle, 1 x Vino (shared), a Tagliatelle voided after firing, a removed draft.
select pg_temp.addl(pg_temp.id('l1'), pg_temp.id('s1'), '11000000-0000-4000-8000-000000000001', 'secondi', 2, 14.00, 'fired', '2026-11-04 20:01+00');
select pg_temp.addl(pg_temp.id('l2'), pg_temp.id('s1'), '11000000-0000-4000-8000-000000000001', 'secondi', 0.5, 14.00, 'fired', '2026-11-04 20:02+00');
select pg_temp.addl(pg_temp.id('l3'), pg_temp.id('s1'), '11000000-0000-4000-8000-000000000002', 'primi', 1.5, 12.50, 'fired', '2026-11-04 20:03+00');
select pg_temp.addl(pg_temp.id('l4'), pg_temp.id('s1'), '11000000-0000-4000-8000-000000000004', 'bevande', 1, 40.25, 'fired', '2026-11-04 20:04+00', true);
select pg_temp.addl(pg_temp.id('l5'), pg_temp.id('s1'), '11000000-0000-4000-8000-000000000002', 'primi', 1, 12.50, 'voided', '2026-11-04 20:05+00');
select pg_temp.addl(pg_temp.id('l6'), pg_temp.id('s1'), '11000000-0000-4000-8000-000000000003', 'bevande', 1, 3.00, 'removed', '2026-11-04 20:06+00');
-- S2: no coperto; half a 7,25 dessert (3,625 rounds to 3,63) and an Acqua.
select pg_temp.addl(pg_temp.id('l7'), pg_temp.id('s2'), '11000000-0000-4000-8000-000000000005', 'dolci', 0.5, 7.25, 'fired', '2026-11-04 20:01+00');
select pg_temp.addl(pg_temp.id('l8'), pg_temp.id('s2'), '11000000-0000-4000-8000-000000000003', 'bevande', 1, 3.00, 'fired', '2026-11-04 20:02+00');
-- S3: one fired, one draft, one removed before firing.
select pg_temp.addl(pg_temp.id('l9'), pg_temp.id('s3'), '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14.00, 'fired', '2026-11-04 20:01+00');
select pg_temp.addl(pg_temp.id('l10'), pg_temp.id('s3'), '11000000-0000-4000-8000-000000000003', 'bevande', 1, 3.00, 'draft', '2026-11-04 20:02+00');
select pg_temp.addl(pg_temp.id('l11'), pg_temp.id('s3'), '11000000-0000-4000-8000-000000000002', 'primi', 1, 12.50, 'removed', '2026-11-04 20:03+00');
-- S4: tokens. One fired line and two drafts.
select pg_temp.addl(pg_temp.id('l12'), pg_temp.id('s4'), '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14.00, 'fired', '2026-11-04 20:01+00');
select pg_temp.addl(pg_temp.id('l13'), pg_temp.id('s4'), '11000000-0000-4000-8000-000000000003', 'bevande', 1, 3.00, 'draft', '2026-11-04 20:02+00');
select pg_temp.addl(pg_temp.id('l14'), pg_temp.id('s4'), '11000000-0000-4000-8000-000000000002', 'primi', 1, 12.50, 'draft', '2026-11-04 20:03+00');
-- S5: 100,01 in one line.
select pg_temp.addl(pg_temp.id('l15'), pg_temp.id('s5'), '11000000-0000-4000-8000-000000000004', 'bevande', 1, 100.01, 'fired', '2026-11-04 20:01+00');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  values (pg_temp.id('l16'), '22222222-2222-4222-8222-222222222222', pg_temp.id('sb'), '21000000-0000-4000-8000-000000000001', 'bevande', 1, 3.00, 10, 'menu',
          '2026-11-04 20:00+00', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

-- app.split_cents ------------------------------------------------------------------------------------------------------------------
select is(app.split_cents(10000, 3), array[3334, 3333, 3333]::bigint[], 'split_cents(10000, 3) gives the remainder cent to the first part');
select is(app.split_cents(0, 4), array[0, 0, 0, 0]::bigint[], 'split_cents(0, 4) is four zeros');
select is(app.split_cents(5, 7), array[1, 1, 1, 1, 1, 0, 0]::bigint[], 'split_cents(5, 7) is five 1s then two 0s');
select is(app.split_cents(10001, 3), array[3334, 3334, 3333]::bigint[], 'split_cents(10001, 3) gives two remainder cents to the first two parts');
select is(app.split_cents(7, 1), array[7]::bigint[], 'one part holds everything');
select is(pg_temp.err($$select app.split_cents(100, 0)$$), '22023 invalid_request', 'zero parts is refused');
select is(pg_temp.err($$select app.split_cents(100, 100)$$), '22023 invalid_request', '100 parts is refused (bound 99)');
select is(pg_temp.err($$select app.split_cents(-1, 2)$$), '22023 invalid_request', 'negative cents are refused');
select is((select provolatile::text from pg_proc where oid = 'app.split_cents(bigint, integer)'::regprocedure), 'i', 'split_cents is immutable');

-- AT2: the bill of S1 ---------------------------------------------------------------------------------------------------------------
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
create temporary table b1 as select public.session_bill(pg_temp.id('s1'), null) as j;
select is((select (j ->> 'total')::numeric from b1), 100.00, 'AT2: the total is 100,00 (94,00 of dishes + 3 x 2,00 coperto)');
select is((select (j ->> 'subtotal')::numeric from b1), 94.00, 'the subtotal is the dishes only');
select is((select array_agg((e ->> 'amount')::numeric order by o) from b1, jsonb_array_elements(j -> 'lines') with ordinality t(e, o)),
          array[18.75, 28.00, 7.00, 40.25], 'line amounts: 1,5 x 12,50, 2 x 14,00, 1/2 x 14,00, 1 x 40,25 (course, then entry order)');
select is((select array_agg((e ->> 'id')::uuid order by o) from b1, jsonb_array_elements(j -> 'lines') with ordinality t(e, o)),
          array[pg_temp.id('l3'), pg_temp.id('l1'), pg_temp.id('l2'), pg_temp.id('l4')],
          'the voided-after-fire line and the removed draft are not on the bill');
select is((select j -> 'coperto' from b1), '{"perPerson": 2.00, "covers": 3, "amount": 6.00}'::jsonb, 'the coperto is per person, covers and amount');
select is((select j -> 'unsentLineIds' from b1), '[]'::jsonb, 'no unsent lines on a fully fired table');
select is((select array[(j ->> 'closed'), (j ->> 'sessionId'), (j ->> 'tableName'), (j ->> 'covers'), (j -> 'receipt')::text, (j -> 'split')::text] from b1),
          array['false', pg_temp.id('s1')::text, 'Tavolo 1 (demo)', '3', 'null', 'null'], 'session facts, no receipt, no split');
select is((select (e ->> 'isShared')::boolean from b1, jsonb_array_elements(j -> 'lines') e where e ->> 'id' = pg_temp.id('l4')::text), true,
  'the shared flag of the line is carried');
select is((select e ->> 'name' from b1, jsonb_array_elements(j -> 'lines') e where e ->> 'id' = pg_temp.id('l3')::text), 'Tagliatelle al ragù (demo)',
  'the line carries the dish name');

-- Rounding, no coperto, drafts, second session -------------------------------------------------------------------------------------
select is((select (e ->> 'amount')::numeric from jsonb_array_elements(public.session_bill(pg_temp.id('s2'), null) -> 'lines') e where e ->> 'id' = pg_temp.id('l7')::text),
          3.63, '0,5 x 7,25 = 3,625 rounds half up to 3,63');
select is((select (e ->> 'amount')::numeric from jsonb_array_elements(public.session_bill(pg_temp.id('s1'), null) -> 'lines') e where e ->> 'id' = pg_temp.id('l3')::text),
          18.75, '1,5 x 12,50 = 18,75');
select is((select public.session_bill(pg_temp.id('s2'), null) -> 'coperto'), 'null'::jsonb, 'a session without coperto has coperto null');
select is((select (public.session_bill(pg_temp.id('s2'), null) ->> 'total')::numeric), 6.63, 'without coperto the total is the subtotal (3,63 + 3,00)');
select is((select public.session_bill(pg_temp.id('s3'), null) -> 'unsentLineIds'), to_jsonb(array[pg_temp.id('l10')]), 'a draft is listed as unsent');
select is((select (public.session_bill(pg_temp.id('s3'), null) ->> 'total')::numeric), 21.00, 'a draft counts in the total: 14,00 + 3,00 + coperto 2 x 2,00; the removed draft does not');
select is((select jsonb_array_length(public.session_bill(pg_temp.id('s3'), null) -> 'lines')), 2, 'S3 bills two lines (fired and draft)');
select is((select jsonb_array_length(public.session_bill(pg_temp.id('s2'), null) -> 'lines')), 2, 'S2 bills its own two lines, none of S1''s');
select is((select (e ->> 'state') from jsonb_array_elements(public.session_bill(pg_temp.id('s3'), null) -> 'lines') e where e ->> 'id' = pg_temp.id('l10')::text),
          'draft', 'the draft line shows state draft');

-- Split by covers ------------------------------------------------------------------------------------------------------------------
select is((select array_agg((e ->> 'amount')::numeric order by (e ->> 'index')::int)
             from jsonb_array_elements(public.session_bill(pg_temp.id('s1'), '{"mode": "covers", "parts": 3}') -> 'split' -> 'parts') e),
          array[33.34, 33.33, 33.33], 'AT2: 100,00 by 3 covers = 33,34 + 33,33 + 33,33');
select is((select array_agg((e ->> 'index')::int order by (e ->> 'index')::int)
             from jsonb_array_elements(public.session_bill(pg_temp.id('s1'), '{"mode": "covers", "parts": 3}') -> 'split' -> 'parts') e),
          array[1, 2, 3], 'part indexes are 1-based');
select is((select array_agg((e ->> 'amount')::numeric order by (e ->> 'index')::int)
             from jsonb_array_elements(public.session_bill(pg_temp.id('s1'), '{"mode": "covers", "parts": 2}') -> 'split' -> 'parts') e),
          array[50.00, 50.00], '100,00 by 2 = 50,00 + 50,00');
select is((select array_agg((e ->> 'amount')::numeric order by (e ->> 'index')::int)
             from jsonb_array_elements(public.session_bill(pg_temp.id('s5'), '{"mode": "covers", "parts": 3}') -> 'split' -> 'parts') e),
          array[33.34, 33.34, 33.33], '100,01 by 3 = 33,34 + 33,34 + 33,33 (two remainder cents)');
select is((select sum((e ->> 'amount')::numeric) from jsonb_array_elements(public.session_bill(pg_temp.id('s5'), '{"mode": "covers", "parts": 7}') -> 'split' -> 'parts') e),
          100.01, 'the parts of any split add up to the total (100,01 by 7)');
select is(public.session_bill(pg_temp.id('s1'), '{"mode": "covers", "parts": 3}') -> 'split' ->> 'mode', 'covers', 'the split mode is echoed');
select is(pg_temp.err(format($f$select public.session_bill(%L, '{"mode": "covers", "parts": 1}')$f$, pg_temp.id('s1'))), 'P0001 parts_invalid', 'one part is parts_invalid');
select is(pg_temp.err(format($f$select public.session_bill(%L, '{"mode": "covers", "parts": 100}')$f$, pg_temp.id('s1'))), 'P0001 parts_invalid', '100 parts is parts_invalid');
select is(pg_temp.err(format($f$select public.session_bill(%L, '{"mode": "covers", "parts": "3"}')$f$, pg_temp.id('s1'))), '22023 invalid_request', 'parts as a string is invalid_request');
select is(pg_temp.err(format($f$select public.session_bill(%L, '{"mode": "covers", "parts": 2, "x": 1}')$f$, pg_temp.id('s1'))), '22023 invalid_request', 'an extra key is invalid_request');
select is(pg_temp.err(format($f$select public.session_bill(%L, '{"mode": "other"}')$f$, pg_temp.id('s1'))), '22023 invalid_request', 'an unknown mode is invalid_request');

-- Split by items (AT2): A {l1, 1 cover}, B {l3, 1}, C {l2, 1}, shared {l4} ---------------------------------------------------------
create temporary table items as
  select public.session_bill(pg_temp.id('s1'), jsonb_build_object('mode', 'items', 'groups', jsonb_build_array(
    jsonb_build_object('lineIds', jsonb_build_array(pg_temp.id('l1')), 'covers', 1),
    jsonb_build_object('lineIds', jsonb_build_array(pg_temp.id('l3')), 'covers', 1),
    jsonb_build_object('lineIds', jsonb_build_array(pg_temp.id('l2')), 'covers', 1)), 'sharedLineIds', jsonb_build_array(pg_temp.id('l4')))) as j;
select is((select array_agg((e ->> 'amount')::numeric order by (e ->> 'index')::int) from items, jsonb_array_elements(j -> 'split' -> 'parts') e),
          array[43.42, 34.17, 22.41], 'AT2 by items: 43,42 / 34,17 / 22,41');
select is((select array_agg((e ->> 'sharedAmount')::numeric order by (e ->> 'index')::int) from items, jsonb_array_elements(j -> 'split' -> 'parts') e),
          array[13.42, 13.42, 13.41], 'the shared Vino (40,25) is split 13,42 / 13,42 / 13,41');
select is((select sum((e ->> 'amount')::numeric) from items, jsonb_array_elements(j -> 'split' -> 'parts') e), 100.00, 'the items split adds up to 100,00');
select is((select array_agg((e ->> 'covers')::int order by (e ->> 'index')::int) from items, jsonb_array_elements(j -> 'split' -> 'parts') e), array[1, 1, 1],
  'each part carries its covers');
select is((select j -> 'split' -> 'parts' -> 0 -> 'lineIds' from items), to_jsonb(array[pg_temp.id('l1')]), 'each part lists its line ids');
select is((select j -> 'split' ->> 'mode' from items), 'items', 'the mode is items');

-- JSON 2.0 is a whole number: it works as 2 (the shape check accepts it, so the cast must too).
select is(pg_temp.err(format($f$select public.session_bill(%L, %L::jsonb)$f$, pg_temp.id('s1'),
            ('{"mode": "items", "groups": [{"lineIds": ["' || pg_temp.id('l1') || '", "' || pg_temp.id('l2') || '"], "covers": 2.0}, {"lineIds": ["' || pg_temp.id('l3') || '"], "covers": 1.0}], "sharedLineIds": ["' || pg_temp.id('l4') || '"]}'))),
          'ok', 'covers written as 2.0 and 1.0 are accepted');
select is((select array_agg((e ->> 'amount')::numeric order by (e ->> 'index')::int)
             from jsonb_array_elements(public.session_bill(pg_temp.id('s1'), ('{"mode": "items", "groups": [{"lineIds": ["' || pg_temp.id('l1') || '", "' || pg_temp.id('l2') || '"], "covers": 2.0}, {"lineIds": ["' || pg_temp.id('l3') || '"], "covers": 1.0}], "sharedLineIds": ["' || pg_temp.id('l4') || '"]}')::jsonb) -> 'split' -> 'parts') e),
          (select array_agg((e ->> 'amount')::numeric order by (e ->> 'index')::int)
             from jsonb_array_elements(public.session_bill(pg_temp.id('s1'), ('{"mode": "items", "groups": [{"lineIds": ["' || pg_temp.id('l1') || '", "' || pg_temp.id('l2') || '"], "covers": 2}, {"lineIds": ["' || pg_temp.id('l3') || '"], "covers": 1}], "sharedLineIds": ["' || pg_temp.id('l4') || '"]}')::jsonb) -> 'split' -> 'parts') e),
          'and give the same parts as 2 and 1');
create function pg_temp.items_sql(p_groups jsonb, p_shared jsonb) returns text language sql as $$
  select format($f$select public.session_bill(%L, %L::jsonb)$f$, pg_temp.id('s1'),
                jsonb_build_object('mode', 'items', 'groups', p_groups, 'sharedLineIds', p_shared)::text)
$$;
create function pg_temp.g(p_ids uuid[], p_covers int) returns jsonb language sql as $$
  select jsonb_build_object('lineIds', to_jsonb(p_ids), 'covers', p_covers)
$$;
select is(pg_temp.detail_of(pg_temp.items_sql(jsonb_build_array(pg_temp.g(array[pg_temp.id('l1'), pg_temp.id('l2')], 2), pg_temp.g(array[pg_temp.id('l1'), pg_temp.id('l3')], 1)),
            jsonb_build_array(pg_temp.id('l4')))), '{"reason": "line_twice"}'::jsonb, 'a line in two groups is split_invalid line_twice');
select is(pg_temp.err(pg_temp.items_sql(jsonb_build_array(pg_temp.g(array[pg_temp.id('l1'), pg_temp.id('l2')], 2), pg_temp.g(array[pg_temp.id('l1'), pg_temp.id('l3')], 1)),
            jsonb_build_array(pg_temp.id('l4')))), 'P0001 split_invalid', 'and it is raised P0001');
select is(pg_temp.detail_of(pg_temp.items_sql(jsonb_build_array(pg_temp.g(array[pg_temp.id('l1'), pg_temp.id('l2')], 2), pg_temp.g(array[pg_temp.id('l3')], 1)),
            jsonb_build_array())), '{"reason": "line_missing"}'::jsonb, 'a line in none is line_missing');
select is(pg_temp.detail_of(pg_temp.items_sql(jsonb_build_array(pg_temp.g(array[pg_temp.id('l1'), pg_temp.id('l2'), pg_temp.id('l5')], 2), pg_temp.g(array[pg_temp.id('l3')], 1)),
            jsonb_build_array(pg_temp.id('l4')))), '{"reason": "line_unknown"}'::jsonb, 'a voided line is line_unknown');
select is(pg_temp.detail_of(pg_temp.items_sql(jsonb_build_array(pg_temp.g(array[pg_temp.id('l1'), pg_temp.id('l2'), pg_temp.id('l7')], 2), pg_temp.g(array[pg_temp.id('l3')], 1)),
            jsonb_build_array(pg_temp.id('l4')))), '{"reason": "line_unknown"}'::jsonb, 'another session''s line is line_unknown');
select is(pg_temp.detail_of(pg_temp.items_sql(jsonb_build_array(pg_temp.g(array[pg_temp.id('l1'), pg_temp.id('l2'), pg_temp.id('l16')], 2), pg_temp.g(array[pg_temp.id('l3')], 1)),
            jsonb_build_array(pg_temp.id('l4')))), '{"reason": "line_unknown"}'::jsonb, 'another tenant''s line is line_unknown');
select is(pg_temp.detail_of(pg_temp.items_sql(jsonb_build_array(pg_temp.g(array[pg_temp.id('l1')], 1), pg_temp.g(array[pg_temp.id('l2'), pg_temp.id('l3')], 1), pg_temp.g(array[]::uuid[], 0)),
            jsonb_build_array(pg_temp.id('l4')))), '{"reason": "covers_mismatch"}'::jsonb, 'covers 1 + 1 + 0 against 3 is covers_mismatch');
select is(pg_temp.err(pg_temp.items_sql(jsonb_build_array(pg_temp.g(array[pg_temp.id('l1')], 3)), jsonb_build_array(pg_temp.id('l2'), pg_temp.id('l3'), pg_temp.id('l4')))),
          '22023 invalid_request', 'one group is invalid_request');
select is(pg_temp.err(pg_temp.items_sql((select jsonb_agg(pg_temp.g(array[]::uuid[], 0)) from generate_series(1, 21)),
          jsonb_build_array(pg_temp.id('l1'), pg_temp.id('l2'), pg_temp.id('l3'), pg_temp.id('l4')))), '22023 invalid_request', '21 groups is invalid_request');
select is(pg_temp.err(pg_temp.items_sql((select jsonb_agg(pg_temp.g(array[]::uuid[], 0)) from generate_series(1, 20)),
          jsonb_build_array(pg_temp.id('l1'), pg_temp.id('l2'), pg_temp.id('l3'), pg_temp.id('l4')))), 'P0001 split_invalid', '20 groups is accepted by the shape (covers_mismatch here)');
select is(pg_temp.err(format($f$select public.session_bill(%L, '{"mode": "items", "groups": [{"lineIds": [], "covers": 1}, {"lineIds": [], "covers": 2}]}')$f$, pg_temp.id('s1'))),
          '22023 invalid_request', 'items without sharedLineIds is invalid_request');
select is(pg_temp.err(format($f$select public.session_bill(%L, '{"mode": "items", "groups": [{"lineIds": ["x"], "covers": 1}, {"lineIds": [], "covers": 2}], "sharedLineIds": []}')$f$, pg_temp.id('s1'))),
          '22023 invalid_request', 'a malformed line id is invalid_request');

-- billToken ------------------------------------------------------------------------------------------------------------------------
create function pg_temp.tok(p_s text) returns text language sql as $$ select public.session_bill(pg_temp.id(p_s), null) ->> 'billToken' $$;
create temporary table tk (k text primary key, v text);
insert into tk values ('base', pg_temp.tok('s4'));
select is(pg_temp.tok('s4'), (select v from tk where k = 'base'), 'the token is equal across two reads');
select matches((select v from tk where k = 'base'), '^[0-9a-f]{32}$', 'the token is 32 lowercase hex digits');
select isnt(pg_temp.tok('s3'), (select v from tk where k = 'base'), 'another session has another token');
-- The qty enters the token without trailing zeros, so 1 and 1.0 are one value whatever the column scale is.
select is((select v from tk where k = 'base'),
          (select md5(coalesce((select string_agg(l.id::text || ':' || l.state || ':' || trim_scale(l.qty)::text || ':' || l.unit_price::text, ',' order by l.id)
                                  from public.order_line l where l.table_session_id = s.id and l.voided_at is null), '')
                      || '|' || s.covers::text || '|' || coalesce(s.coperto_amount::text, '-'))
             from public.table_session s where s.id = pg_temp.id('s4')),
          'the token is built from the qty without trailing zeros (1 and 1.0 give one token)');

update public.order_line set note = note, client_updated_at = client_updated_at where id = pg_temp.id('l13');
select is(pg_temp.tok('s4'), (select v from tk where k = 'base'), 'the token is equal after a no-op edit');
update public.order_line set qty = 2 where id = pg_temp.id('l13');
select isnt(pg_temp.tok('s4'), (select v from tk where k = 'base'), 'the token changes after a qty edit');
update public.order_line set qty = 1 where id = pg_temp.id('l13');
select is(pg_temp.tok('s4'), (select v from tk where k = 'base'), 'and returns when the qty returns');
update public.order_line set fired_at = now(), fired_by = 'd1000000-0000-4000-8000-00000000000d' where id = pg_temp.id('l13');
select isnt(pg_temp.tok('s4'), (select v from tk where k = 'base'), 'the token changes after a fire');
update tk set v = pg_temp.tok('s4') where k = 'base';
update public.order_line set voided_at = now(), voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'wrong_dish' where id = pg_temp.id('l13');
select isnt(pg_temp.tok('s4'), (select v from tk where k = 'base'), 'the token changes after a void');
update tk set v = pg_temp.tok('s4') where k = 'base';
select pg_temp.addl(pg_temp.id('l17'), pg_temp.id('s4'), '11000000-0000-4000-8000-000000000003', 'bevande', 1, 3.00, 'draft', '2026-11-04 20:09+00');
select isnt(pg_temp.tok('s4'), (select v from tk where k = 'base'), 'the token changes after an add');
update tk set v = pg_temp.tok('s4') where k = 'base';
update public.table_session set covers = 3 where id = pg_temp.id('s4');
select isnt(pg_temp.tok('s4'), (select v from tk where k = 'base'), 'the token changes after a covers change');

-- Shape and roles ------------------------------------------------------------------------------------------------------------------
select is((select array_agg(k order by k collate "C") from b1, jsonb_object_keys(j) k),
          array['billToken', 'closed', 'coperto', 'covers', 'lines', 'receipt', 'sessionId', 'split', 'subtotal', 'tableName', 'total', 'unsentLineIds'],
          'the bill has exactly the keys of plan §3.2');
select is((select array_agg(k order by k collate "C") from b1, jsonb_array_elements(j -> 'lines') e, jsonb_object_keys(e) k where e ->> 'id' = pg_temp.id('l1')::text),
          array['amount', 'course', 'id', 'isShared', 'name', 'qty', 'state', 'unitPrice'], 'a line has exactly the keys of plan §3.2');
select is((select (b1.j::text ~* '"[A-Za-z]*(cost|margin|gp|food|recipe|vat)[A-Za-z]*":') or (items.j::text ~* '"[A-Za-z]*(cost|margin|gp|food|recipe|vat)[A-Za-z]*":') from b1, items),
          false, 'no key of the bill or of the split names a cost, margin, GP, food cost, recipe or VAT');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.err(format($f$select public.session_bill(%L, null)$f$, pg_temp.id('s1'))), '42501 permission denied: opening tables needs owner, admin or waiter', 'the chef gets 42501');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((public.session_bill(pg_temp.id('s1'), null) ->> 'total')::numeric, 100.00, 'the owner reads the bill');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is((public.session_bill(pg_temp.id('s1'), null) ->> 'total')::numeric, 100.00, 'the admin reads the bill');
select is(pg_temp.err(format($f$select public.session_bill(%L, null)$f$, pg_temp.id('sb'))), 'P0002 session_not_found', 'tenant B''s session is session_not_found for tenant A');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((public.session_bill(pg_temp.id('sb'), null) ->> 'total')::numeric, 3.00, 'tenant B reads its own bill');
select is(pg_temp.err(format($f$select public.session_bill(%L, null)$f$, pg_temp.id('s1'))), 'P0002 session_not_found', 'and not tenant A''s');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.err(format($f$select public.session_bill(%L, null)$f$, pg_temp.id('s1'))), '42501 permission denied: opening tables needs owner, admin or waiter', 'no claims: 42501');
select is(pg_temp.err(format($f$select public.session_bill(%L, null)$f$, 'ffffffff-ffff-4fff-8fff-ffffffffffff')), '42501 permission denied: opening tables needs owner, admin or waiter',
  'no claims: the role check comes before the lookup');
select is((select bool_or(has_function_privilege(r, f, 'execute')) from unnest(array['anon', 'service_role']) r,
            unnest(array['public.session_bill(uuid, jsonb)']) f), false, 'anon and service_role cannot execute session_bill');
select is((select has_function_privilege('authenticated', 'public.session_bill(uuid, jsonb)', 'execute')), true, 'authenticated can');
select is((select bool_or(has_function_privilege(r, f, 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r,
            unnest(array['app.session_bill_json(uuid, uuid, jsonb)', 'app.split_cents(bigint, integer)']) f), false, 'no API role executes the app.* bill functions');

select * from finish();
rollback;
