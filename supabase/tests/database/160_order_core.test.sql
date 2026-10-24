-- M18 step 1: order_line (plan §3.1.1, §3.2; ADR-017). Bounds (23514), the derived state, the guard, append-only,
-- composite FKs, RLS (owner/admin only), privileges (service_role select pinned, lesson 2) and the two indexes.
-- Fake data only. Lines are found by id, never by position.
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

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
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi',
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Bruschetta (demo)', 'Antipasti', 'antipasti',
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Solo B (demo)', 'Altro', 'dolci',
   'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1,
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1,
   'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001',
   'Tavolo 1 (demo)', 4, 'a1000000-0000-4000-8000-00000000000a', '2026-10-24',
   'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '13000000-0000-4000-8000-0000000000b1',
   'Tavolo B (demo)', 2, 'b1000000-0000-4000-8000-00000000000b', '2026-10-24',
   'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
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
-- Inserts one line of tenant A on the open session with the given id; p_cols/p_vals add or override columns.
create function pg_temp.ins(p_id text, p_qty text default '1', p_extra_cols text default '', p_extra_vals text default '',
                            p_note text default 'null', p_price text default '14') returns text language plpgsql as $$
begin
  return pg_temp.err(format($f$
    insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, note, unit_price, vat_rate,
                                   price_source, client_updated_at, created_by, updated_by %s)
    values (%L, '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001',
            '11000000-0000-4000-8000-000000000001', 'secondi', %s, %s, %s, 10, 'menu', '2026-10-24 12:00+00',
            'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d' %s)$f$,
    p_extra_cols, p_id, p_qty, p_note, p_price, p_extra_vals));
end
$$;

-- Bounds.
select is(pg_temp.ins('e1000000-0000-4000-8000-000000000001', '0'), '23514 new row for relation "order_line" violates check constraint "order_line_qty_ck"', 'qty 0 is refused');
select is(left(pg_temp.ins('e1000000-0000-4000-8000-000000000002', '0.4'), 5), '23514', 'qty 0.4 is refused');
select is(left(pg_temp.ins('e1000000-0000-4000-8000-000000000003', '0.7'), 5), '23514', 'qty 0.7 is refused (not a half step)');
select is(left(pg_temp.ins('e1000000-0000-4000-8000-000000000004', '99.5'), 5), '23514', 'qty 99.5 is refused');
select is(pg_temp.ins('e1000000-0000-4000-8000-000000000005', '0.5'), 'ok', 'qty 0.5 (half portion) is accepted');
select is(pg_temp.ins('e1000000-0000-4000-8000-000000000006', '1.5'), 'ok', 'qty 1.5 is accepted');
select is(pg_temp.ins('e1000000-0000-4000-8000-000000000007', '99'), 'ok', 'qty 99 is accepted');
select is(left(pg_temp.ins('e1000000-0000-4000-8000-000000000008', '1', '', '', quote_literal('')), 5), '23514', 'an empty note is refused (the procedures store null)');
select is(left(pg_temp.ins('e1000000-0000-4000-8000-000000000009', '1', '', '', quote_literal(repeat('x', 141))), 5), '23514', 'a 141-character note is refused');
select is(pg_temp.ins('e1000000-0000-4000-8000-00000000000a', '1', '', '', quote_literal(repeat('x', 140))), 'ok', 'a 140-character note is accepted');
select is(left(pg_temp.ins('e1000000-0000-4000-8000-00000000000b', '1', '', '', quote_literal('a' || chr(9) || 'b')), 5), '23514', 'a control character in the note is refused');
select is(left(pg_temp.ins('e1000000-0000-4000-8000-00000000000c', '1', '', '', 'null', '-0.01'), 5), '23514', 'a negative unit price is refused');
select is(left(pg_temp.ins('e1000000-0000-4000-8000-00000000000d', '1', ', fired_at', ', now()'), 5), '23514', 'fired_at without fired_by is refused');
select is(left(pg_temp.ins('e1000000-0000-4000-8000-00000000000e', '1', ', voided_at', ', now()'), 5), '23514', 'voided_at without reason and user is refused');
select is(left(pg_temp.ins('e1000000-0000-4000-8000-00000000000f', '1', ', voided_at, voided_by, void_reason',
  ', now(), ''d1000000-0000-4000-8000-00000000000d'', ''Bad Reason'''), 5), '23514', 'a void reason that is not a lower-case code is refused');
select is(left(pg_temp.err($$ insert into public.order_line (id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate,
    price_source, client_updated_at, tenant_id, created_by, updated_by)
  values ('e1000000-0000-4000-8000-0000000000f0', '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001',
    'secondi', 1, 14, 10, 'free', now(), '11111111-1111-4111-8111-111111111111', 'd1000000-0000-4000-8000-00000000000d',
    'd1000000-0000-4000-8000-00000000000d') $$), 5), '23514', 'a price source other than menu or push is refused');

-- Derived state.
select is((select state from public.order_line where id = 'e1000000-0000-4000-8000-000000000005'), 'draft', 'a new line is a draft');
update public.order_line set fired_at = now(), fired_by = 'd1000000-0000-4000-8000-00000000000d' where id = 'e1000000-0000-4000-8000-000000000005';
select is((select state from public.order_line where id = 'e1000000-0000-4000-8000-000000000005'), 'fired', 'fired_at set: state fired (generated column follows)');
update public.order_line set voided_at = now(), voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'customer_left'
  where id = 'e1000000-0000-4000-8000-000000000005';
select is((select state || '/' || (fired_at is not null)::text from public.order_line where id = 'e1000000-0000-4000-8000-000000000005'),
  'voided/true', 'fired then voided: state voided, fired_at kept');
select is(left(pg_temp.err($$ update public.order_line set state = 'fired' where id = 'e1000000-0000-4000-8000-000000000006' $$), 5), '428C9', 'state cannot be written (update)');
select is(left(pg_temp.ins('e1000000-0000-4000-8000-000000000010', '1', ', state', ', ''fired'''), 5), '428C9', 'state cannot be written (insert)');

-- Guard: identity, tenant, links, price and creation facts never change.
select is(pg_temp.err($$ update public.order_line set menu_item_id = '11000000-0000-4000-8000-000000000002' where id = 'e1000000-0000-4000-8000-000000000006' $$),
  'P0001 order_line_immutable', 'menu_item_id is immutable');
select is(pg_temp.err($$ update public.order_line set table_session_id = '14000000-0000-4000-8000-0000000000b1' where id = 'e1000000-0000-4000-8000-000000000006' $$),
  'P0001 order_line_immutable', 'table_session_id is immutable');
select is(pg_temp.err($$ update public.order_line set unit_price = 15 where id = 'e1000000-0000-4000-8000-000000000006' $$),
  'P0001 order_line_immutable', 'unit_price is immutable (frozen at entry)');
select is(pg_temp.err($$ update public.order_line set vat_rate = 22 where id = 'e1000000-0000-4000-8000-000000000006' $$),
  'P0001 order_line_immutable', 'vat_rate is immutable');
select is(pg_temp.err($$ update public.order_line set price_source = 'push' where id = 'e1000000-0000-4000-8000-000000000006' $$),
  'P0001 order_line_immutable', 'price_source is immutable');
select is(pg_temp.err($$ update public.order_line set created_by = 'a1000000-0000-4000-8000-00000000000a' where id = 'e1000000-0000-4000-8000-000000000006' $$),
  'P0001 order_line_immutable', 'created_by is immutable');
select is(pg_temp.err($$ update public.order_line set qty = 2, course = 'primi', note = 'ben cotto', segue = true, is_shared = true,
    updated_by = 'a1000000-0000-4000-8000-00000000000a', client_updated_at = '2026-10-24 12:05+00', updated_at = now()
  where id = 'e1000000-0000-4000-8000-000000000006' $$), 'ok', 'qty, course, note, flags and the update stamps change on a draft');
select is(pg_temp.err($$ update public.order_line set qty = 3 where id = 'e1000000-0000-4000-8000-000000000005' $$),
  'P0001 order_line_voided', 'any change to a voided line is refused');

-- A fired line (line ...07 is a fresh draft fired by the owner fixture).
update public.order_line set fired_at = now(), fired_by = 'd1000000-0000-4000-8000-00000000000d' where id = 'e1000000-0000-4000-8000-000000000007';
select is(pg_temp.err($$ update public.order_line set qty = 2 where id = 'e1000000-0000-4000-8000-000000000007' $$),
  'P0001 order_line_fired', 'a fired line refuses a quantity change');
select is(pg_temp.err($$ update public.order_line set fired_at = null, fired_by = null where id = 'e1000000-0000-4000-8000-000000000007' $$),
  'P0001 order_line_fired', 'fired_at cannot be cleared');
select is(pg_temp.err($$ update public.order_line set voided_at = now(), voided_by = 'd1000000-0000-4000-8000-00000000000d',
    void_reason = 'kitchen_error', updated_at = now(), updated_by = 'a1000000-0000-4000-8000-00000000000a'
  where id = 'e1000000-0000-4000-8000-000000000007' $$), 'ok', 'a fired line can be voided (M19)');
select is((select state from public.order_line where id = 'e1000000-0000-4000-8000-000000000007'), 'voided', 'and is then voided');
-- voided_at is set once: clearing it on a draft is refused too (a draft voided before fire).
update public.order_line set voided_at = now(), voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'entry_removed'
  where id = 'e1000000-0000-4000-8000-00000000000a';
select is(pg_temp.err($$ update public.order_line set voided_at = null, voided_by = null, void_reason = null where id = 'e1000000-0000-4000-8000-00000000000a' $$),
  'P0001 order_line_voided', 'voided_at cannot be cleared');

-- Append-only.
select is(pg_temp.err($$ delete from public.order_line where id = 'e1000000-0000-4000-8000-000000000006' $$), 'P0001 append_only', 'DELETE is refused');
select is(pg_temp.err($$ truncate public.order_line $$), 'P0001 append_only', 'TRUNCATE is refused');

-- Composite FKs.
select is(left(pg_temp.err($$ insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate,
    price_source, client_updated_at, created_by, updated_by)
  values ('e1000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-0000000000b1',
    '11000000-0000-4000-8000-000000000001', 'secondi', 1, 14, 10, 'menu', now(), 'd1000000-0000-4000-8000-00000000000d',
    'd1000000-0000-4000-8000-00000000000d') $$), 5), '23503', 'a line of tenant A on tenant B''s session is refused');
select is(left(pg_temp.err($$ insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate,
    price_source, client_updated_at, created_by, updated_by)
  values ('e1000000-0000-4000-8000-0000000000f2', '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-0000000000b1', 'secondi', 1, 14, 10, 'menu', now(), 'd1000000-0000-4000-8000-00000000000d',
    'd1000000-0000-4000-8000-00000000000d') $$), 5), '23503', 'a line of tenant A for tenant B''s menu item is refused');
select is((select count(*)::int from pg_constraint where conrelid = 'public.order_line'::regclass and contype = 'f'
            and conname in ('order_line_session_fkey', 'order_line_menu_item_fkey', 'order_line_created_by_fkey',
                            'order_line_updated_by_fkey', 'order_line_fired_by_fkey', 'order_line_voided_by_fkey')), 6,
  'the six named foreign keys exist');

-- RLS: owner and admin read; chef and waiter read nothing; tenant B reads nothing of A's.
create temp table seen (who text primary key, n int);
grant all on seen to authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
set local role authenticated;
insert into seen select 'owner', count(*) from public.order_line;
reset role;
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
set local role authenticated;
insert into seen select 'admin', count(*) from public.order_line;
reset role;
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
set local role authenticated;
insert into seen select 'chef', count(*) from public.order_line;
reset role;
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
set local role authenticated;
insert into seen select 'waiter', count(*) from public.order_line;
reset role;
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
set local role authenticated;
insert into seen select 'ownerb', count(*) from public.order_line;
reset role;
select is((select n from seen where who = 'owner'), (select count(*)::int from public.order_line), 'owner A reads all of A''s lines');
select cmp_ok((select n from seen where who = 'owner'), '>', 0, 'and there are lines to read');
select is((select n from seen where who = 'admin'), (select n from seen where who = 'owner'), 'admin A reads the same');
select is((select n from seen where who = 'chef'), 0, 'chef A reads no line');
select is((select n from seen where who = 'waiter'), 0, 'waiter A reads no line (unit_price would reach the waiter)');
select is((select n from seen where who = 'ownerb'), 0, 'owner B reads none of A''s lines');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'order_line'), 1, 'exactly one policy exists');

-- Privileges (lesson 2).
select is((select count(*)::int from unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
            where has_table_privilege('authenticated', 'public.order_line', p) or has_table_privilege('anon', 'public.order_line', p)), 0,
  'authenticated and anon have no write privilege');
select ok(has_table_privilege('service_role', 'public.order_line', 'select'), 'service_role can select order_line (pinned)');
select is((select count(*)::int from unnest(array['INSERT', 'UPDATE', 'DELETE']) p where has_table_privilege('service_role', 'public.order_line', p)), 0,
  'service_role cannot write order_line');
select ok(not has_table_privilege('anon', 'public.order_line', 'select'), 'anon cannot select');

-- Indexes.
select is((select count(*)::int from pg_indexes where schemaname = 'public' and indexname = 'order_line_session_idx'
            and indexdef like '%(tenant_id, table_session_id, created_at, id)%'), 1, 'order_line_session_idx has the documented columns');
select is((select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'batch' and indexname = 'batch_live_idx'
            and indexdef like '%(tenant_id, recipe_key, use_by)%' and indexdef like '%fresh%' and indexdef like '%open%'
            and indexdef not like '%finished%' and indexdef not like '%discarded%'), 1, 'batch_live_idx is partial on fresh and open');
select ok((select relrowsecurity from pg_class where oid = 'public.order_line'::regclass), 'RLS is enabled on order_line');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_function_privilege(r, 'app.order_line_guard()', 'execute')), 0, 'no API role executes the guard');

select * from finish();
rollback;
