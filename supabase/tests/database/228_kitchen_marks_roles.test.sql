-- M19b step 6 (docs/plans/2026-10-31-m19b-kitchen-done.md §3.1.8; AT7): who may call what. Owner, admin and chef A mark and close; both waiters of A are refused with 42501 and write
-- nothing; no claims is refused; tenant B (owner and chef) reaches nothing of A; the chef and the waiter read no kitchen_event row; the three public functions are
-- executable by authenticated only; no API role executes any M19b app.* function. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-a2@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('b2000000-0000-4000-8000-00000000000c', 'chef-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere Due Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo'),
  ('b3000000-0000-4000-8000-00000000000c', '22222222-2222-4222-8222-222222222222', 'b2000000-0000-4000-8000-00000000000c', 'chef', 'Chef B Demo');
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

-- The instant lines are fired at: the start of the current business day, clamped to now (the 217 pattern).
create function pg_temp.day_start() returns timestamptz language sql as $$
  select least(app.local_instant(app.business_date(t.id, now()), app.business_day_cutoff(t.id), t.timezone), clock_timestamp())
    from public.tenant t where t.id = '11111111-1111-4111-8111-111111111111' $$;
create function pg_temp.claims(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', case p_who
    when 'chef' then json_build_object('sub', 'c0000000-0000-4000-8000-00000000000c', 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'chef')::text
    when 'owner' then json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text
    when 'waiter' then json_build_object('sub', 'd0000000-0000-4000-8000-00000000000d', 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'waiter')::text
    when 'ownerb' then json_build_object('sub', 'b0000000-0000-4000-8000-00000000000b', 'role', 'authenticated', 'tenant_id', '22222222-2222-4222-8222-222222222222', 'app_role', 'owner')::text
    when 'admin' then json_build_object('sub', 'f0000000-0000-4000-8000-00000000000f', 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'admin')::text
    when 'waiter2' then json_build_object('sub', 'e0000000-0000-4000-8000-00000000000e', 'role', 'authenticated', 'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'waiter')::text
    when 'chefb' then json_build_object('sub', 'b2000000-0000-4000-8000-00000000000c', 'role', 'authenticated', 'tenant_id', '22222222-2222-4222-8222-222222222222', 'app_role', 'chef')::text
    else '' end, true) $$;
create function pg_temp.mark(p_line text, p_done boolean) returns jsonb language sql as $$
  select public.kitchen_mark_line(pg_temp.id(p_line), jsonb_build_object('done', p_done)) $$;
-- The five-field body of the comanda a line belongs to.
create function pg_temp.kbody(p_line text, p_closed boolean) returns jsonb language sql as $$
  select jsonb_build_object('sessionId', l.table_session_id, 'firedAt', to_char(l.fired_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                            'course', l.course::text, 'segue', l.segue, 'closed', p_closed)
    from public.order_line l where l.id = pg_temp.id(p_line) $$;
create function pg_temp.setk(p_line text, p_closed boolean) returns jsonb language sql as $$
  select public.kitchen_set_ticket(pg_temp.kbody(p_line, p_closed)) $$;
-- Events of a line, or of the comanda of a line, as 'subject:action:cause' in seq order.
create function pg_temp.lev(p_line text) returns text language sql as $$
  select coalesce(string_agg(e.subject || ':' || e.action || ':' || e.cause, ',' order by e.seq), '-') from public.kitchen_event e where e.order_line_id = pg_temp.id(p_line) $$;
create function pg_temp.tev(p_line text) returns text language sql as $$
  select coalesce(string_agg(e.subject || ':' || e.action || ':' || e.cause, ',' order by e.seq), '-')
    from public.kitchen_event e join public.order_line l on l.id = pg_temp.id(p_line)
   where e.subject = 'ticket' and e.table_session_id = l.table_session_id and e.fired_at = l.fired_at and e.course = l.course and e.segue = l.segue $$;
create function pg_temp.nev() returns integer language sql as $$ select count(*)::int from public.kitchen_event $$;
-- A comanda of a board (from a reply), found by one of its line ids; list = tickets / closedTickets. Null when absent.
create function pg_temp.bt(p_board jsonb, p_list text, p_line text) returns jsonb language sql as $$
  select t from jsonb_array_elements(p_board -> p_list) t, jsonb_array_elements(t -> 'lines') e where e ->> 'id' = pg_temp.id(p_line)::text limit 1 $$;
-- 'SQLSTATE message|detail' of a statement.
create function pg_temp.errd(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  det text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  return state || ' ' || msg || '|' || coalesce(det, '');
end
$$;

select pg_temp.mkl('p1', 't1', 'primi', 3, pg_temp.day_start());
select pg_temp.mkl('p2', 't1', 'primi', 3, pg_temp.day_start());
select pg_temp.mkl('q1', 't1', 'secondi', 1, pg_temp.day_start());
select pg_temp.mkl('q2', 't1', 'secondi', 1, pg_temp.day_start());
select pg_temp.mkl('r1', 't1', 'antipasti', 2, pg_temp.day_start());
select pg_temp.mkl('r2', 't1', 'dolci', 1, pg_temp.day_start());
select pg_temp.mkl('s1', 't1', 'secondi', 1, pg_temp.day_start(), true);   -- the segue comanda of the same course
select pg_temp.mkl('b1', 'tb', 'dolci', 1, pg_temp.day_start(), false, 1, null, false, null, 'b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222');

-- Allowed: owner, admin, chef -------------------------------------------------------------------------------------------------------------------
select pg_temp.claims('owner');
select is((pg_temp.mark('p1', true) ->> 'changed') || '/' || (pg_temp.setk('q1', true) ->> 'changed'), 'true/true', 'owner A may mark and close');
select pg_temp.claims('admin');
select is((pg_temp.mark('p2', true) ->> 'changed') || '/' || (pg_temp.setk('r2', true) ->> 'changed'), 'true/true', 'admin A may mark and close');
select pg_temp.claims('chef');
select is((pg_temp.mark('r1', true) ->> 'changed') || '/' || (pg_temp.setk('s1', true) ->> 'changed'), 'true/true', 'chef A may mark and close');
select is((select string_agg(distinct u.display_name, ',' order by u.display_name) from public.kitchen_event e join public.app_user u on u.id = e.created_by),
  'Admin Demo,Chef Demo,Titolare Demo', 'each event carries the user who tapped');

-- Refused: both waiters, no claims -------------------------------------------------------------------------------------------------------------
create temporary table n0 as select count(*)::int n, md5(string_agg(to_jsonb(e)::text, '|' order by e.seq)) h from public.kitchen_event e;
select pg_temp.claims('waiter');
select is(pg_temp.err($$select pg_temp.mark('r1', false)$$), '42501 permission denied: kitchen marks need owner, admin or chef', 'waiter A: mark_line is refused');
select is(pg_temp.err($$select pg_temp.setk('r2', false)$$), '42501 permission denied: kitchen marks need owner, admin or chef', 'waiter A: set_ticket is refused');
select pg_temp.claims('waiter2');
select is(split_part(pg_temp.err($$select pg_temp.mark('r1', false)$$), ' ', 1) || '/' || split_part(pg_temp.err($$select pg_temp.setk('r2', false)$$), ' ', 1), '42501/42501', 'waiter A2: both refused');
select pg_temp.claims('none');
select is(split_part(pg_temp.err($$select pg_temp.mark('r1', false)$$), ' ', 1) || '/' || split_part(pg_temp.err($$select pg_temp.setk('r2', false)$$), ' ', 1), '42501/42501', 'no claims: both refused');
select is((select count(*)::int || '/' || md5(string_agg(to_jsonb(e)::text, '|' order by e.seq)) from public.kitchen_event e), (select n || '/' || h from n0), 'no row was added or changed by the refusals');

-- Tenant B: owner and chef reach nothing of A ---------------------------------------------------------------------------------------------------
select pg_temp.claims('ownerb');
select is(pg_temp.err($$select pg_temp.mark('p1', false)$$) || ' / ' || pg_temp.err($$select pg_temp.setk('p1', false)$$), 'P0002 line_not_found / P0002 ticket_not_found', 'owner B: A''s line and A''s key do not exist');
select pg_temp.claims('chefb');
select is(pg_temp.err($$select pg_temp.mark('q1', false)$$) || ' / ' || pg_temp.err($$select pg_temp.setk('q1', false)$$), 'P0002 line_not_found / P0002 ticket_not_found', 'chef B: the same');
select is((select count(*)::int || '/' || md5(string_agg(to_jsonb(e)::text, '|' order by e.seq)) from public.kitchen_event e), (select n || '/' || h from n0), 'A''s rows are unchanged by tenant B');
select pg_temp.claims('chef');
select is(pg_temp.err($$select pg_temp.mark('b1', true)$$), 'P0002 line_not_found', 'and chef A cannot reach tenant B''s line either');

-- The board: the waiter stays out (unchanged) -----------------------------------------------------------------------------------------------------
select pg_temp.claims('waiter');
select is(pg_temp.err($$select public.kitchen_tickets()$$), '42501 permission denied: the kitchen list needs owner, admin or chef', 'kitchen_tickets: the waiter is refused');
select pg_temp.claims('chef');
select is(pg_temp.err($$select public.kitchen_tickets()$$), 'ok', 'kitchen_tickets: the chef reads it');

-- Table access: the log is for the owner and the admin -------------------------------------------------------------------------------------------
create temporary table seen (who text primary key, n int);
grant insert on seen to authenticated;
grant execute on function pg_temp.claims(text) to authenticated;
set local role authenticated;
select pg_temp.claims('owner');
insert into seen select 'owner', count(*) from public.kitchen_event;
select pg_temp.claims('admin');
insert into seen select 'admin', count(*) from public.kitchen_event;
select pg_temp.claims('chef');
insert into seen select 'chef', count(*) from public.kitchen_event;
select pg_temp.claims('waiter');
insert into seen select 'waiter', count(*) from public.kitchen_event;
select pg_temp.claims('waiter2');
insert into seen select 'waiter2', count(*) from public.kitchen_event;
select pg_temp.claims('ownerb');
insert into seen select 'ownerb', count(*) from public.kitchen_event;
reset role;
select is((select string_agg(who || ':' || (n > 0)::text, ',' order by who collate "C") from seen), 'admin:true,chef:false,owner:true,ownerb:false,waiter:false,waiter2:false',
  'owner and admin A read the log; chef A, both waiters and owner B read 0 rows (rows exist)');
select cmp_ok((select n from n0), '>', 0, 'and the rows do exist');

-- Privileges -----------------------------------------------------------------------------------------------------------------------------------------
select is((select bool_and(has_function_privilege('authenticated', f, 'execute')) from unnest(array['public.kitchen_mark_line(uuid, jsonb)', 'public.kitchen_set_ticket(jsonb)', 'public.kitchen_tickets()']) f), true,
  'authenticated executes the three public functions');
select is((select bool_or(has_function_privilege(r, f, 'execute')) from unnest(array['anon', 'service_role']) r,
           unnest(array['public.kitchen_mark_line(uuid, jsonb)', 'public.kitchen_set_ticket(jsonb)', 'public.kitchen_tickets()']) f), false,
  'anon and service_role execute none of them');
select is((select count(*)::int from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
            where p.pronamespace = 'app'::regnamespace and p.proname in ('require_kitchen_marker', 'kitchen_ticket_key', 'kitchen_ticket_lock', 'kitchen_line_done', 'kitchen_ticket_state',
              'kitchen_ticket_open_lines', 'kitchen_board_json', 'kitchen_ticket_rows') and has_function_privilege(r, p.oid, 'execute')), 0,
  'no API role executes any M19b app.* function');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('require_kitchen_marker', 'kitchen_ticket_key', 'kitchen_ticket_lock', 'kitchen_line_done',
              'kitchen_ticket_state', 'kitchen_ticket_open_lines', 'kitchen_board_json', 'kitchen_ticket_rows')), 8, 'and all eight exist (the list is not vacuous)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('kitchen_mark_line', 'kitchen_set_ticket')
              and p.prosecdef and p.proconfig = array['search_path=""']), 2, 'both write procedures are security definer with an empty search_path');
select is((select string_agg(proname::text, ',' order by proname::text collate "C") from pg_proc
            where pronamespace = 'public'::regnamespace and proname ~* '(cost|margin|price)'),
          'batch_costs,cost_settings,count_variance_costs,enter_fixed_costs,fixed_cost_status,ingredient_costs,plate_costs,plate_margins_pct,raw_waste_costs,recipe_cost_at,recipe_costs,set_ingredient_cost_basis,update_cost_settings,waste_costs', 'the cost-named public functions are those of 214: none is added');

select * from finish();
rollback;
