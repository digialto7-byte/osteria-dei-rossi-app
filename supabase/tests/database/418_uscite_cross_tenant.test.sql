-- Comanda per uscita, step 2 (docs/plans/2026-11-18-comanda-uscite.md section 5 step 2; platform plan 6.5 rule 4): X, the cross-tenant suite
-- on the Demo A / Demo B fixture, for the procedures and reads this feature touches. 390 already proves, for every table with a tenant_id,
-- that B's owner reads and writes nothing of A's; this file proves it for the paths that are security definer and therefore not protected
-- by the table policies alone:
--   fire_course     as B's waiter on A's session and A's draft line      -> P0002 session_not_found, A's line stays a draft;
--   void_line       as B's waiter on A's fired line                      -> P0002 line_not_found, A's line stays fired;
--   kitchen_tickets as B's chef: B's ticket is on the board, nothing of A's; A's chef sees A's ticket (the control);
--   tables_list     as B's waiter: B's table, nothing of A's;
--   order_line      as B's waiter and owner: 0 rows of A's (the policy).
-- It passes on main by design (nothing of the feature exists yet). Later steps add their B rows (3: uscita_call; 5: call_uscita and the
-- hold fire; 7: not_prepared; 13: the board by uscita; 17: the waiter reads).
-- The proof that the checks can fail is the mutation block at the end: a temporary policy letting B read A's order_line, and the leak count
-- must leave 0. Fake data only. The board reads "today's business day", so the lines are fired at the start of that day, never after now.
begin;
-- The pins render timestamptz as text: a session time zone other than UTC (a non-UTC PGTZ) would move the pins, so it is fixed here.
set local timezone = 'UTC';
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('b2000000-0000-4000-8000-0000000000c2', 'chef-b@example.test'),
  ('b3000000-0000-4000-8000-0000000000d3', 'waiter-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef A Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere A Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('b2100000-0000-4000-8000-0000000000c2', '22222222-2222-4222-8222-222222222222', 'b2000000-0000-4000-8000-0000000000c2', 'chef', 'Chef B Demo'),
  ('b3100000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'b3000000-0000-4000-8000-0000000000d3', 'waiter', 'Cameriere B Demo');
insert into public.menu_item (id, tenant_id, name, category, course_default, position, created_by, updated_by) values
  ('31000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Spezzatino A Demo', 'Secondi', 'secondi', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('32000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Bruschetta B Demo', 'Antipasti', 'antipasti', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('33000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo A Demo', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('43000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Tavolo B Demo', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
create function pg_temp.day_start(p_tenant uuid) returns timestamptz language sql as $$
  select least(app.local_instant(app.business_date(t.id, now()), app.business_day_cutoff(t.id), t.timezone), now()) from public.tenant t where t.id = p_tenant $$;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by) values
  ('34000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '33000000-0000-4000-8000-000000000001', 'Tavolo A Demo', 2,
   pg_temp.day_start('11111111-1111-4111-8111-111111111111'), 'd1000000-0000-4000-8000-00000000000d', app.business_date('11111111-1111-4111-8111-111111111111', now()),
   'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'),
  ('44000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '43000000-0000-4000-8000-000000000001', 'Tavolo B Demo', 2,
   pg_temp.day_start('22222222-2222-4222-8222-222222222222'), 'b3100000-0000-4000-8000-0000000000d3', app.business_date('22222222-2222-4222-8222-222222222222', now()),
   'b3100000-0000-4000-8000-0000000000d3', 'b3100000-0000-4000-8000-0000000000d3');
-- A: a fired line (the void target and the board's ticket) and a draft (the fire target). B: one fired line.
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by) values
  ('35000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001',
   'secondi', 1, 14.00, 10, 'menu', pg_temp.day_start('11111111-1111-4111-8111-111111111111'), 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d',
   pg_temp.day_start('11111111-1111-4111-8111-111111111111'), 'd1000000-0000-4000-8000-00000000000d'),
  ('35000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '34000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001',
   'secondi', 1, 14.00, 10, 'menu', pg_temp.day_start('11111111-1111-4111-8111-111111111111'), 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', null, null),
  ('45000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '44000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001',
   'antipasti', 1, 5.00, 10, 'menu', pg_temp.day_start('22222222-2222-4222-8222-222222222222'), 'b3100000-0000-4000-8000-0000000000d3', 'b3100000-0000-4000-8000-0000000000d3',
   pg_temp.day_start('22222222-2222-4222-8222-222222222222'), 'b3100000-0000-4000-8000-0000000000d3');

create function pg_temp.claims(p_auth uuid, p_tenant uuid, p_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role, 'aal', 'aal1')::text, true)
$$;
-- Runs a statement as the given user (role authenticated); returns 'ok' or "SQLSTATE message". A failed call rolls back its own writes.
create function pg_temp.as_err(p_auth uuid, p_tenant uuid, p_role text, stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  perform pg_temp.claims(p_auth, p_tenant, p_role);
  set local role authenticated;
  begin
    execute stmt;
    reset role;
    return 'ok';
  exception when others then
    reset role;
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    return state || ' ' || msg;
  end;
end
$$;
-- A payload read as the given user (the whole jsonb of a public read function).
create function pg_temp.as_json(p_auth uuid, p_tenant uuid, p_role text, stmt text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.claims(p_auth, p_tenant, p_role);
  set local role authenticated;
  execute stmt into v;
  reset role;
  return v;
end
$$;
-- How many of A's order_line rows a given user can read through the table policy.
create function pg_temp.sees_a_lines(p_auth uuid, p_tenant uuid, p_role text) returns bigint language plpgsql as $$
declare
  n bigint;
begin
  perform pg_temp.claims(p_auth, p_tenant, p_role);
  set local role authenticated;
  select count(*) into n from public.order_line where tenant_id = '11111111-1111-4111-8111-111111111111';
  reset role;
  return n;
end
$$;

-- Controls: the roles are not simply denied everywhere, and A really holds what B must not see.
select is(pg_temp.sees_a_lines('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner'), 2::bigint, 'control: A''s owner reads A''s two lines');
select is(pg_temp.sees_a_lines('b3000000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'waiter'), 0::bigint, 'X: B''s waiter reads 0 of A''s order lines');
select is(pg_temp.sees_a_lines('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner'), 0::bigint, 'X: B''s owner reads 0 of A''s order lines');

-- fire_course as B's waiter on A's session, with A's draft line.
select is(pg_temp.as_err('b3000000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'waiter',
  $$ select public.fire_course('34000000-0000-4000-8000-000000000001', '{"lineIds": ["35000000-0000-4000-8000-000000000002"]}'::jsonb) $$),
  'P0002 session_not_found', 'X: fire_course as B''s waiter on A''s session is P0002 session_not_found');
select is(pg_temp.as_err('b3000000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'waiter',
  $$ select public.fire_course('44000000-0000-4000-8000-000000000001', '{"lineIds": ["35000000-0000-4000-8000-000000000002"]}'::jsonb) $$),
  'P0002 line_not_found', 'X: fire_course on B''s own session with A''s line is P0002 line_not_found');
select is((select state from public.order_line where id = '35000000-0000-4000-8000-000000000002'), 'draft', 'X: A''s draft line is still a draft');

-- void_line as B's waiter on A's fired line.
select is(pg_temp.as_err('b3000000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'waiter',
  $$ select public.void_line('35000000-0000-4000-8000-000000000001', '{"reason": "comp", "clientUpdatedAt": "1998-01-01T00:00:00Z"}'::jsonb) $$),
  'P0002 line_not_found', 'X: void_line as B''s waiter on A''s line is P0002 line_not_found');
select is((select state from public.order_line where id = '35000000-0000-4000-8000-000000000001'), 'fired', 'X: A''s fired line is still fired');
-- Control: the same call by B's waiter on B's own fired line works, so the P0002 above comes from tenant isolation and not from a broken path.
select is(pg_temp.as_err('b3000000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'waiter',
  $$ select public.void_line('45000000-0000-4000-8000-000000000001', '{"reason": "comp", "clientUpdatedAt": "1998-01-01T00:00:00Z"}'::jsonb) $$),
  'ok', 'control: void_line as B''s waiter on B''s own line works');
select is((select state from public.order_line where id = '45000000-0000-4000-8000-000000000001'), 'voided', 'control: and B''s line is voided');
select is((select count(*)::int from public.order_line where tenant_id = '11111111-1111-4111-8111-111111111111' and voided_at is not null), 0, 'X: nothing of A''s was voided');

-- The kitchen board: A's chef sees A's ticket; B's chef sees B's ticket and nothing of A's.
create temp table board (who text primary key, j jsonb not null);
insert into board values
  ('a', pg_temp.as_json('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef', 'select public.kitchen_tickets()')),
  ('b', pg_temp.as_json('b2000000-0000-4000-8000-0000000000c2', '22222222-2222-4222-8222-222222222222', 'chef', 'select public.kitchen_tickets()'));
select is((select (j ->> 'remaining')::int from board where who = 'a'), 1, 'control: A''s chef has A''s line on the board');
select ok((select j::text like '%34000000-0000-4000-8000-000000000001%' from board where who = 'a'), 'control: and it is A''s session');
select ok((select j::text like '%44000000-0000-4000-8000-000000000001%' and j::text not like '%34000000-0000-4000-8000-000000000001%' and j::text not like '%35000000-0000-4000-8000-00000000000%' and j::text not like '%Spezzatino A Demo%'
             from board where who = 'b'), 'X: B''s chef sees B''s ticket and nothing of A''s (session, lines, dish)');

-- tables_list as B's waiter: B's table and nothing of A's.
create temp table tl (who text primary key, j jsonb not null);
insert into tl values
  ('a', pg_temp.as_json('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter', 'select public.tables_list()')),
  ('b', pg_temp.as_json('b3000000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'waiter', 'select public.tables_list()'));
select ok((select j::text like '%34000000-0000-4000-8000-000000000001%' and j::text like '%Tavolo A Demo%' from tl where who = 'a'), 'control: A''s waiter lists A''s table and session');
select ok((select j::text like '%44000000-0000-4000-8000-000000000001%' and j::text like '%Tavolo B Demo%'
             and j::text not like '%34000000-0000-4000-8000-000000000001%' and j::text not like '%Tavolo A Demo%' from tl where who = 'b'), 'X: B''s waiter lists B''s table and nothing of A''s');

-- Mutation: a temporary policy lets any authenticated user read order lines. B's waiter then reads A's lines, so the check that said 0 can fail.
create policy x_mutation_read_all on public.order_line for select to authenticated using (true);
select is(pg_temp.sees_a_lines('b3000000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'waiter'), 2::bigint,
  'mutation: a policy granting B a read on A makes B''s waiter see A''s two lines (so the 0 above means something)');
select isnt(pg_temp.sees_a_lines('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner'), 0::bigint,
  'mutation: and B''s owner too');

select * from finish();
rollback;
