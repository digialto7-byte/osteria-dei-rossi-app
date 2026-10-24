-- M13 step 1: count_session and count_line, their guards and RLS, the widened audit_event and job_run lists and the
-- reconciliation/audit indexes (M13 plan §3.2, §5 step 1; ADR-012). Fake data only. Rows are inserted as the
-- migration owner; the role cases use `set local role authenticated` with claims.
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('ad000000-0000-4000-8000-0000000000ad', 'admin-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('e0000000-0000-4000-8000-0000000000e0', 'waiter-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('ad100000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111',
   'ad000000-0000-4000-8000-0000000000ad', 'admin', 'Admin Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('e1000000-0000-4000-8000-0000000000e0', '11111111-1111-4111-8111-111111111111',
   'e0000000-0000-4000-8000-0000000000e0', 'waiter', 'Cameriere Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Freezer (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo muscolo (demo)', 'kg'),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Farina di mais (demo)', 'kg'),
  ('2a000000-0000-4000-8000-00000000002a', '22222222-2222-4222-8222-222222222222', 'Burro B (demo)', 'kg');

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

-- A session of tenant A (open unless told otherwise). Defaults: daily at Cella started by the owner.
create function pg_temp.sess(p_id uuid, p_loc uuid default '10000000-0000-4000-8000-0000000000a1',
    p_type text default 'daily', p_status text default 'open', p_started_by uuid default 'a1000000-0000-4000-8000-00000000000a',
    p_closed_at timestamptz default null, p_closed_by uuid default null) returns uuid language sql as $$
  insert into public.count_session (id, tenant_id, location_id, type, status, started_by, closed_at, closed_by)
    values (p_id, '11111111-1111-4111-8111-111111111111', p_loc, p_type, p_status, p_started_by, p_closed_at, p_closed_by)
  returning id
$$;
create function pg_temp.line(p_session uuid, p_ing uuid, p_pos int, p_expected numeric default null,
    p_counted numeric default null, p_at timestamptz default null, p_by uuid default null,
    p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns uuid language sql as $$
  insert into public.count_line (tenant_id, session_id, ingredient_id, position, expected_qty, counted_qty,
      entered_at, entered_by, created_by)
    values (p_tenant, p_session, p_ing, p_pos, p_expected, p_counted, p_at, p_by, 'a1000000-0000-4000-8000-00000000000a')
  returning id
$$;

-- Constraints -------------------------------------------------------------------------------------------
select alike(pg_temp.err($$ select pg_temp.sess('51000000-0000-4000-8000-000000000001', p_type => 'weekly') $$),
  '23514%count_session_type_check%', 'type weekly is refused');
select alike(pg_temp.err($$ select pg_temp.sess('51000000-0000-4000-8000-000000000001', p_status => 'closed') $$),
  '23514%count_session_closed_ck%', 'status closed without closed_at/closed_by is refused');
select alike(pg_temp.err($$ select pg_temp.sess('51000000-0000-4000-8000-000000000001', p_status => 'cancelled') $$),
  '23514%count_session_cancelled_ck%', 'status cancelled without cancelled_at/cancelled_by is refused');
select is(pg_temp.err($$ select pg_temp.sess('51000000-0000-4000-8000-000000000001') $$), 'ok',
  'an open session at Cella is accepted');
select alike(pg_temp.err($$ select pg_temp.sess('51000000-0000-4000-8000-000000000002', p_type => 'monthly') $$),
  '23505%count_session_open_uq%', 'a second open session at the same location is refused');
select is(pg_temp.err($$ select pg_temp.sess('51000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-0000000000a2') $$),
  'ok', 'an open session at another location is accepted');
select alike(pg_temp.err($$ select pg_temp.sess('51000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-0000000000b1') $$),
  '23503%count_session_location_fk%', 'a session at tenant B''s location is refused');
select alike(pg_temp.err($$ select pg_temp.sess('51000000-0000-4000-8000-000000000004', p_status => 'closed', p_started_by => 'b1000000-0000-4000-8000-00000000000b',
    p_closed_at => now(), p_closed_by => 'a1000000-0000-4000-8000-00000000000a') $$),
  '23503%count_session_started_by_fk%', 'started_by = a user of tenant B is refused');

select is(pg_temp.err($$ select pg_temp.line('51000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-00000000001a', 1) $$),
  'ok', 'a line without entry is accepted');
select alike(pg_temp.err($$ select pg_temp.line('51000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-00000000001b', 2, 5, -1, now(), 'c1000000-0000-4000-8000-00000000000c') $$),
  '23514%count_line_counted_qty_check%', 'counted_qty -1 is refused');
select alike(pg_temp.err($$ select pg_temp.line('51000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-00000000001b', 2, null, 4) $$),
  '23514%count_line_entry_ck%', 'counted_qty without expected_qty is refused');
select alike(pg_temp.err($$ select pg_temp.line('51000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-00000000001a', 3) $$),
  '23505%count_line_session_id_ingredient_id_key%', 'two lines of one ingredient are refused');
select alike(pg_temp.err($$ select pg_temp.line('51000000-0000-4000-8000-000000000001', '2a000000-0000-4000-8000-00000000002a', 3) $$),
  '23503%count_line_ingredient_fk%', 'a line pointing at tenant B''s ingredient is refused');
select alike(pg_temp.err($$ select pg_temp.line('51000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-00000000001b', 0) $$),
  '23514%count_line_position_check%', 'position 0 is refused');

-- Guards ------------------------------------------------------------------------------------------------
select is(pg_temp.err($$ update public.count_session set status = 'closed', closed_at = now(),
    closed_by = 'c1000000-0000-4000-8000-00000000000c' where id = '51000000-0000-4000-8000-000000000003' $$),
  'ok', 'open -> closed with its columns is allowed');
select is(pg_temp.err($$ update public.count_session set status = 'open', closed_at = null, closed_by = null
    where id = '51000000-0000-4000-8000-000000000003' $$),
  'P0001 count_immutable', 'closed -> open is refused');
select is(pg_temp.err($$ update public.count_session set location_id = '10000000-0000-4000-8000-0000000000a2'
    where id = '51000000-0000-4000-8000-000000000001' $$),
  'P0001 count_immutable', 'changing location_id of an open session is refused');
select is(pg_temp.err($$ update public.count_session set status = 'cancelled', cancelled_at = now(),
    cancelled_by = 'c1000000-0000-4000-8000-00000000000c', type = 'monthly'
    where id = '51000000-0000-4000-8000-000000000001' $$),
  'P0001 count_immutable', 'closing while changing the type is refused');

-- A closed session with a counted line and an open session for the line guard.
select pg_temp.sess('51000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-0000000000a2', 'monthly');
select pg_temp.line('51000000-0000-4000-8000-000000000005', '1a000000-0000-4000-8000-00000000001a', 1, 5, 4.5, now(),
  'c1000000-0000-4000-8000-00000000000c');
select is(pg_temp.err($$ update public.count_line set counted_qty = 4, entered_at = now()
    where session_id = '51000000-0000-4000-8000-000000000005' $$),
  'ok', 'an entry column of a line of an open session can change');
select is(pg_temp.err($$ update public.count_line set position = 9
    where session_id = '51000000-0000-4000-8000-000000000005' $$),
  'P0001 count_immutable', 'position of a line never changes');
update public.count_session set status = 'cancelled', cancelled_at = now(),
  cancelled_by = 'c1000000-0000-4000-8000-00000000000c' where id = '51000000-0000-4000-8000-000000000005';
select is(pg_temp.err($$ update public.count_line set counted_qty = 3 where session_id = '51000000-0000-4000-8000-000000000005' $$),
  'P0001 count_immutable', 'updating a line of a cancelled session is refused');
select is(pg_temp.err($$ select pg_temp.line('51000000-0000-4000-8000-000000000003', '1a000000-0000-4000-8000-00000000001a', 1) $$),
  'P0001 count_immutable', 'inserting a line into a closed session is refused');
select is(pg_temp.err($$ delete from public.count_session where id = '51000000-0000-4000-8000-000000000001' $$),
  'P0001 append_only', 'DELETE of a session is refused');
select is(pg_temp.err($$ delete from public.count_line $$), 'P0001 append_only', 'DELETE of a line is refused');
select is(pg_temp.err($$ truncate public.count_line $$), 'P0001 append_only', 'TRUNCATE of lines is refused');
select is(pg_temp.err($$ truncate public.count_session cascade $$), 'P0001 append_only', 'TRUNCATE of sessions is refused');

-- RLS ---------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('count_session', 'count_line')), 2,
  'one policy on each count table');
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is((select count(*)::int from public.count_session), 3, 'owner A reads A''s sessions');
select is((select count(*)::int from public.count_line), 2, 'owner A reads A''s lines');
select pg_temp.act_as('ad000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111', 'admin');
select is((select count(*)::int from public.count_session), 3, 'admin A reads A''s sessions');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((select count(*)::int from public.count_session) + (select count(*)::int from public.count_line), 5,
  'chef A reads sessions and lines');
select pg_temp.act_as('e0000000-0000-4000-8000-0000000000e0', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(*)::int from public.count_session) + (select count(*)::int from public.count_line), 0,
  'waiter A reads none');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select count(*)::int from public.count_session) + (select count(*)::int from public.count_line), 0,
  'owner B reads none of A''s');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.err($$ insert into public.count_session (location_id, type, started_by)
    values ('10000000-0000-4000-8000-0000000000a1', 'daily', 'a1000000-0000-4000-8000-00000000000a') $$),
  '42501 permission denied for table count_session', 'authenticated cannot INSERT a session');
select is(pg_temp.err($$ update public.count_line set counted_qty = 1 $$),
  '42501 permission denied for table count_line', 'authenticated cannot UPDATE a line');
reset role;
select is(pg_temp.err($$ set local role service_role; insert into public.count_line (session_id, ingredient_id, position, created_by)
    values ('51000000-0000-4000-8000-000000000001', '1b000000-0000-4000-8000-00000000001b', 5, 'a1000000-0000-4000-8000-00000000000a') $$),
  '42501 permission denied for table count_line', 'service_role cannot INSERT a line');
reset role;

-- Lists and indexes ---------------------------------------------------------------------------------------
select is((select count(*)::int from (
    select pg_temp.err(format($f$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
      values ('11111111-1111-4111-8111-111111111111', %L, gen_random_uuid(), %L, 'a1000000-0000-4000-8000-00000000000a') $f$, et, ac)) r
      from (values ('count_session', 'count_session.closed'), ('count_session', 'count_session.cancelled'),
                   ('ingredient', 'ingredient.critical_changed'), ('invoice', 'invoice.approved'),
                   ('invoice', 'invoice.rejected'), ('invoice', 'invoice.duplicate_cleared'),
                   ('ingredient', 'ingredient.allergens_confirmed'), ('recipe', 'recipe.deactivated'),
                   ('recipe', 'recipe.reactivated'), ('tenant', 'tenant.settings_changed'),
                   ('payable', 'payable.status_changed'), ('payable', 'payable.payment_reversed')) v (et, ac)) x
    where r = 'ok'), 12, 'audit_event accepts the three new actions and every earlier one');
select alike(pg_temp.err($$ insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
    values ('11111111-1111-4111-8111-111111111111', 'count_session', gen_random_uuid(), 'count_session.reopened',
            'a1000000-0000-4000-8000-00000000000a') $$), '23514%audit_event_action_check%', 'an unknown action is still refused');
select is(pg_temp.err($$ select app.job_run_begin('ledger-invariants') $$), 'ok', 'job_run accepts ledger-invariants');
select alike(pg_temp.err($$ select app.job_run_begin('foo') $$), '23514%job_run_job_check%', 'job_run still refuses foo');
select has_index('public', 'audit_event', 'audit_event_tenant_at_idx', 'audit_event has the feed index');
select has_index('public', 'stock_movement', 'stock_movement_location_date_idx', 'stock_movement has the reconciliation index');
select has_index('public', 'stock_movement', 'stock_movement_tenant_at_idx', 'stock_movement has the audit feed index');

select * from finish();
rollback;
