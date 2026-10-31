-- M19b step 1 (docs/plans/2026-10-31-m19b-kitchen-done.md §3.2; ADR-024): public.kitchen_event, the append-only record of kitchen done/undone/closed/reopened.
-- Shape check, tenant FKs, identity seq, append-only triggers, RLS (owner and admin read), grants and the two partial indexes. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-a2@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere Due Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Bruschetta (demo)', 'Antipasti', 'antipasti', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Zuppa del giorno (demo)', 'Primi', 'primi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Solo B (demo)', 'Altro', 'dolci', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Tavolo 3 (demo)', 3, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
-- T1 (4 covers) and T2 (2 covers) open, T3 closed, B1 of tenant B.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, closed_at, closed_by, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 4, 'a1000000-0000-4000-8000-00000000000a', '2026-11-04', null, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000002', 'Tavolo 2 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', '2026-11-04', null, null, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000003', 'Tavolo 3 (demo)', 2, 'a1000000-0000-4000-8000-00000000000a', '2026-11-04', now(), 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '13000000-0000-4000-8000-0000000000b1', 'Tavolo B (demo)', 2, 'b1000000-0000-4000-8000-00000000000b', '2026-11-04', null, null, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

create temporary table reg (k text primary key, id uuid not null);
insert into reg values ('t1', '14000000-0000-4000-8000-000000000001'), ('t2', '14000000-0000-4000-8000-000000000002'),
  ('t3', '14000000-0000-4000-8000-000000000003'), ('tb', '14000000-0000-4000-8000-0000000000b1');
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
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
-- An order line fired at p_fired (null = draft). Item 1 secondi, 2 antipasti, 3 primi; the waiter who sent it is p_by.
create function pg_temp.mkl(p_k text, p_session text, p_course text, p_item int, p_fired timestamptz, p_segue boolean default false,
    p_qty numeric default 1, p_note text default null, p_shared boolean default false, p_void text default null, p_by text default 'd1000000-0000-4000-8000-00000000000d',
    p_tenant text default '11111111-1111-4111-8111-111111111111', p_created timestamptz default null) returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, segue, note, is_shared, unit_price, vat_rate, price_source,
      client_updated_at, created_at, created_by, updated_by, fired_at, fired_by, voided_at, voided_by, void_reason)
    values (pg_temp.id(p_k), p_tenant::uuid, pg_temp.id(p_session),
      case when p_tenant = '22222222-2222-4222-8222-222222222222' then '11000000-0000-4000-8000-0000000000b1'::uuid
           else ('11000000-0000-4000-8000-00000000000' || p_item)::uuid end,
      p_course::public.course, p_qty, p_segue, p_note, p_shared, 14, 10, 'menu', '2026-11-04 18:00+00',
      coalesce(p_created, '2026-11-04 18:00+00'),
      case when p_tenant = '22222222-2222-4222-8222-222222222222' then 'b1000000-0000-4000-8000-00000000000b'::uuid else 'd1000000-0000-4000-8000-00000000000d'::uuid end,
      case when p_tenant = '22222222-2222-4222-8222-222222222222' then 'b1000000-0000-4000-8000-00000000000b'::uuid else 'd1000000-0000-4000-8000-00000000000d'::uuid end,
      p_fired, case when p_fired is null then null else p_by::uuid end,
      case when p_void is null then null else p_fired + interval '1 minute' end,
      case when p_void is null then null else p_by::uuid end, p_void);
end
$$;

select pg_temp.mkl('l1', 't1', 'primi', 3, '2026-11-04 20:10:00+00');
select pg_temp.mkl('l2', 't1', 'primi', 3, '2026-11-04 20:10:00+00');
select pg_temp.mkl('lb', 'tb', 'dolci', 1, '2026-11-04 20:00:00+00', false, 1, null, false, null, 'b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222');

-- One helper per event kind; every insert names tenant and user (no claims here, so the column defaults are null).
create function pg_temp.ev(p_subject text, p_action text, p_cause text default 'tap', p_line text default null, p_session text default null,
    p_segue boolean default null, p_course text default null, p_fired timestamptz default null, p_tenant text default '11111111-1111-4111-8111-111111111111',
    p_by text default 'c1000000-0000-4000-8000-00000000000c') returns void language plpgsql as $$
begin
  insert into public.kitchen_event (tenant_id, subject, action, cause, order_line_id, table_session_id, fired_at, course, segue, created_by)
    values (p_tenant::uuid, p_subject, p_action, p_cause, case when p_line is null then null else pg_temp.id(p_line) end,
            case when p_session is null then null else pg_temp.id(p_session) end, p_fired, p_course::public.course, p_segue, p_by::uuid);
end
$$;

-- Shape ---------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$select pg_temp.ev('line', 'done', 'tap', 'l1')$$), 'ok', 'a line done event with a line id is accepted');
select is(pg_temp.err($$select pg_temp.ev('line', 'undone', 'tap', 'l1')$$), 'ok', 'a line undone event is accepted');
select is(split_part(pg_temp.err($$select pg_temp.ev('line', 'done', 'auto', 'l1')$$), ' ', 1), '23514', 'a line event with cause auto is refused');
select is(split_part(pg_temp.err($$select pg_temp.ev('line', 'done', 'tap', 'l1', 't1')$$), ' ', 1), '23514', 'a line event carrying a session id is refused');
select is(split_part(pg_temp.err($$select pg_temp.ev('line', 'closed', 'tap', 'l1')$$), ' ', 1), '23514', 'a line event with a ticket action is refused');
select is(pg_temp.err($$select pg_temp.ev('ticket', 'closed', 'tap', null, 't1', false, 'primi', '2026-11-04 20:10:00+00')$$), 'ok', 'a ticket closed event with all four key columns is accepted');
select is(pg_temp.err($$select pg_temp.ev('ticket', 'reopened', 'auto', null, 't1', true, 'primi', '2026-11-04 20:10:00+00')$$), 'ok', 'a ticket reopened event with cause auto is accepted');
select is(split_part(pg_temp.err($$select pg_temp.ev('ticket', 'closed', 'tap', null, 't1', null, 'primi', '2026-11-04 20:10:00+00')$$), ' ', 1), '23514', 'a ticket event missing segue is refused');
select is(split_part(pg_temp.err($$select pg_temp.ev('ticket', 'closed', 'tap', 'l1', 't1', false, 'primi', '2026-11-04 20:10:00+00')$$), ' ', 1), '23514', 'a ticket event with a line id is refused');
select is(split_part(pg_temp.err($$select pg_temp.ev('x', 'closed', 'tap', null, 't1', false, 'primi', '2026-11-04 20:10:00+00')$$), ' ', 1), '23514', 'an unknown subject is refused');
select is(split_part(pg_temp.err($$select pg_temp.ev('ticket', 'done', 'tap', null, 't1', false, 'primi', '2026-11-04 20:10:00+00')$$), ' ', 1), '23514', 'a ticket event with a line action is refused');

-- Tenant foreign keys ---------------------------------------------------------------------------------------------------------
select is(split_part(pg_temp.err($$select pg_temp.ev('line', 'done', 'tap', 'lb')$$), ' ', 1), '23503', 'a line of tenant B cannot be referenced by tenant A');
select is(split_part(pg_temp.err($$select pg_temp.ev('ticket', 'closed', 'tap', null, 'tb', false, 'dolci', '2026-11-04 20:00:00+00')$$), ' ', 1), '23503', 'a session of tenant B cannot be referenced by tenant A');
select is(split_part(pg_temp.err($$select pg_temp.ev('line', 'done', 'tap', 'l1', null, null, null, null, '11111111-1111-4111-8111-111111111111', 'b1000000-0000-4000-8000-00000000000b')$$), ' ', 1), '23503', 'a user of tenant B cannot be the author in tenant A');

-- seq -------------------------------------------------------------------------------------------------------------------------
select pg_temp.ev('line', 'done', 'tap', 'l2');
select pg_temp.ev('line', 'undone', 'tap', 'l2');
select ok((select (array_agg(seq order by created_at, seq))[1] < (array_agg(seq order by created_at, seq))[2]
             from public.kitchen_event where order_line_id = pg_temp.id('l2')), 'two inserts get increasing seq');
select is(split_part(pg_temp.err($$insert into public.kitchen_event (seq, tenant_id, subject, action, order_line_id, created_by)
  values (1, '11111111-1111-4111-8111-111111111111', 'line', 'done', pg_temp.id('l1'), 'c1000000-0000-4000-8000-00000000000c')$$), ' ', 1), '428C9', 'an explicit seq is refused');

-- Append-only -----------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$update public.kitchen_event set action = 'undone'$$), 'P0001 append_only', 'UPDATE is refused');
select is(pg_temp.err($$delete from public.kitchen_event$$), 'P0001 append_only', 'DELETE is refused');
select is(pg_temp.err($$truncate public.kitchen_event$$), 'P0001 append_only', 'TRUNCATE is refused');

-- RLS: owner and admin of the tenant read; chef, waiter and the other tenant read nothing -----------------------------------
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select cmp_ok((select count(*)::int from public.kitchen_event), '>', 0, 'owner A reads the events');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select cmp_ok((select count(*)::int from public.kitchen_event), '>', 0, 'admin A reads the events');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((select count(*)::int from public.kitchen_event), 0, 'chef A reads no event row');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(*)::int from public.kitchen_event), 0, 'waiter A reads no event row');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select count(*)::int from public.kitchen_event), 0, 'owner B reads none of A''s events');
reset role;

-- Privileges --------------------------------------------------------------------------------------------------------------------
select is((select has_table_privilege('authenticated', 'public.kitchen_event', 'insert') or has_table_privilege('authenticated', 'public.kitchen_event', 'update')
                  or has_table_privilege('authenticated', 'public.kitchen_event', 'delete') or has_table_privilege('authenticated', 'public.kitchen_event', 'truncate')),
          false, 'authenticated has no write privilege');
select is((select has_table_privilege('service_role', 'public.kitchen_event', 'select')), true, 'service_role may select');
select is((select has_table_privilege('service_role', 'public.kitchen_event', 'insert') or has_table_privilege('service_role', 'public.kitchen_event', 'update')
                  or has_table_privilege('service_role', 'public.kitchen_event', 'delete')), false, 'service_role has no write privilege');
select is((select has_table_privilege('anon', 'public.kitchen_event', 'select') or has_table_privilege('anon', 'public.kitchen_event', 'insert')), false, 'anon has no privilege');

-- Indexes -----------------------------------------------------------------------------------------------------------------------
select is((select regexp_replace(indexdef, '^.* USING ', '') from pg_indexes where schemaname = 'public' and indexname = 'kitchen_event_line_idx'),
          'btree (tenant_id, order_line_id, seq DESC) WHERE (subject = ''line''::text)', 'the line index covers (tenant, line, seq desc) for line events');
select is((select regexp_replace(indexdef, '^.* USING ', '') from pg_indexes where schemaname = 'public' and indexname = 'kitchen_event_ticket_idx'),
          'btree (tenant_id, table_session_id, fired_at, course, segue, seq DESC) WHERE (subject = ''ticket''::text)', 'the ticket index covers the key and seq desc for ticket events');

select * from finish();
rollback;
