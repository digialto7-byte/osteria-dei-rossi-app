-- Comanda per uscita, step 5 (docs/plans/2026-11-18-comanda-uscite.md section 3.12; migration 20261206220200_uscita_fire_call.sql): M3, the sync
-- side. app.sync_op_kinds gains call_uscita (last); public.apply_op (unchanged) dispatches it through app.apply_op_dispatch and records it once
-- (applied_op deduplicates by op id). A fire op carries hold; a legacy fire op without hold still calls (fire_now); a legacy edit_line
-- {segue: true} still lands in the 2nd. Fake data only.
begin;
set local timezone = 'UTC';
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'waiter-a2@example.test'),
  ('b3000000-0000-4000-8000-0000000000d3', 'waiter-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('e1000000-0000-4000-8000-00000000000e', '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-00000000000e', 'waiter', 'Cameriere Due Demo'),
  ('b3100000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'b3000000-0000-4000-8000-0000000000d3', 'waiter', 'Cameriere B Demo');
insert into public.location (id, tenant_id, name) values ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
-- The stew: a batch recipe (10 portions) and the plate that takes one portion of it.
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, now() - interval '5 days', 'Spezzatino (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, now() - interval '5 days', 'Spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 1, 'ec000000-0000-4000-8000-0000000000e1', 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, is_available, is_active, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Bruschetta (demo)', 'Antipasti', 'antipasti', null, true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle (demo)', 'Primi', 'primi', null, true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 'ec000000-0000-4000-8000-0000000000e2', true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', null, true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  select '11111111-1111-4111-8111-111111111111', id, 10, 10, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a' from public.menu_item;
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by,
                          output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by)
  values ('ba000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1,
          '981023-SPE-1', '1998-10-23', 'SPE', 1, now() - interval '2 hours', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 20, 20, 48, now() + interval '46 hours',
          'fresh', '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', 'ba000000-0000-4000-8000-000000000001', 'produce', 20, 'batch', 'ba000000-0000-4000-8000-000000000001', '1998-10-23',
          'a1000000-0000-4000-8000-00000000000a');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 3) n;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b3100000-0000-4000-8000-0000000000d3', 'b3100000-0000-4000-8000-0000000000d3');
-- S1 the founder's table, S2 the comparison (sent without hold), S3 closed; SB of tenant B.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  select ('14000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', ('13000000-0000-4000-8000-00000000000' || n)::uuid,
         'Tavolo ' || n || ' (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '1998-10-24', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 3) n;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '13000000-0000-4000-8000-0000000000b1', 'Tavolo B (demo)', 2,
   'b3100000-0000-4000-8000-0000000000d3', '1998-10-24', 'b3100000-0000-4000-8000-0000000000d3', 'b3100000-0000-4000-8000-0000000000d3');
update public.table_session set closed_at = now(), closed_by = 'd1000000-0000-4000-8000-00000000000d', closed_business_date = '1998-10-24',
  receipt_type = 'scontrino', receipt_number = '0001-0001', payment_type = 'card', total = 0 where id = '14000000-0000-4000-8000-000000000003';

-- A draft line n of session s, item i, uscita u (as the table owner: the entry path is pgTAP 420's).
create function pg_temp.draft(p_n int, p_s int, p_i int, p_u int) returns void language sql as $$
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, uscita, segue, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  select ('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('14000000-0000-4000-8000-00000000000' || p_s)::uuid, m.id, m.course_default, 1, p_u, p_u >= 2, 10, 10, 'menu', now() - interval '1 hour',
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from public.menu_item m where m.id = ('11000000-0000-4000-8000-00000000000' || p_i)::uuid $$;
create function pg_temp.l(p_n int) returns uuid language sql as $$ select ('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;
create function pg_temp.as_role(p_auth uuid, p_tenant uuid, p_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role, 'aal', 'aal1')::text, true) $$;
create temp table res (nm text primary key, j jsonb);
grant all on res to authenticated;
create function pg_temp.ts() returns text language sql as $$ select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;
create function pg_temp.op(p_kind text, p_payload jsonb, p_id uuid default null, p_seq int default 1) returns jsonb language sql as $$
  select jsonb_build_object('opId', coalesce(p_id, gen_random_uuid()), 'seq', p_seq, 'kind', p_kind, 'clientTs', pg_temp.ts(),
                            'userId', 'd1000000-0000-4000-8000-00000000000d', 'payload', p_payload) $$;
-- apply_op as waiter A; 'ok' (the reply stored under nm) or "SQLSTATE message".
create function pg_temp.apply(p_nm text, p_op jsonb) returns text language plpgsql as $$
declare
  v jsonb;
  state text;
  msg text;
begin
  perform pg_temp.as_role('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
  set local role authenticated;
  begin
    v := public.apply_op(p_op);
  exception when others then
    reset role;
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    return state || ' ' || msg;
  end;
  reset role;
  insert into res values (p_nm, v) on conflict (nm) do update set j = excluded.j;
  return 'ok';
end
$$;
create function pg_temp.r(p_nm text) returns jsonb language sql as $$ select j from res where nm = p_nm $$;
create function pg_temp.calls(p_s int) returns text language sql as $$
  select coalesce(string_agg(uscita || ':' || cause, ',' order by uscita), '-') from public.uscita_call where table_session_id = ('14000000-0000-4000-8000-00000000000' || p_s)::uuid $$;
create temp table o (k text primary key, op jsonb not null);

-- Table 1: the founder's 2nd sent with hold through the queue.
select pg_temp.draft(1, 1, 1, 1), pg_temp.draft(3, 1, 3, 2);
insert into o values ('fire', pg_temp.op('fire', jsonb_build_object('sessionId', '14000000-0000-4000-8000-000000000001', 'lineIds', jsonb_build_array(pg_temp.l(1), pg_temp.l(3)), 'hold', true)));
select count(*) from (select pg_temp.apply('fire', (select op from o where k = 'fire'))) x;
-- 1
select is((pg_temp.r('fire') ->> 'status') || ' ' || (pg_temp.r('fire') -> 'result' -> 'held')::text || ' ' || pg_temp.calls(1),
  'applied ["' || pg_temp.l(3) || '"] -', 'a fire op with hold: true is applied, the 2nd is held and no call row exists');
-- 2-4: the call op, once.
insert into o values ('call', pg_temp.op('call_uscita', jsonb_build_object('sessionId', '14000000-0000-4000-8000-000000000001', 'uscita', 2)));
select count(*) from (select pg_temp.apply('call', (select op from o where k = 'call'))) x;
select is((pg_temp.r('call') ->> 'status') || ' ' || (pg_temp.r('call') -> 'result' ->> 'changed') || ' ' || pg_temp.calls(1), 'applied true 2:call',
  'apply_op of a call_uscita op calls once');
select count(*) from (select pg_temp.apply('call_dup', (select op from o where k = 'call'))) x;
select is((pg_temp.r('call_dup') ->> 'status') || ' ' || (pg_temp.r('call_dup') -> 'stored' ->> 'status') || ' ' || pg_temp.calls(1)
          || ' ' || (select count(*) from public.applied_op where op_id = (select (op ->> 'opId')::uuid from o where k = 'call')),
  'duplicate applied 2:call 1', 'the same op again answers duplicate with no second row');
insert into o values ('call2', pg_temp.op('call_uscita', jsonb_build_object('sessionId', '14000000-0000-4000-8000-000000000001', 'uscita', 2), null, 2));
select count(*) from (select pg_temp.apply('call2', (select op from o where k = 'call2'))) x;
select is((pg_temp.r('call2') ->> 'status') || ' ' || (pg_temp.r('call2') -> 'result' ->> 'changed') || ' ' || pg_temp.calls(1), 'applied false 2:call',
  'a second op id for the same call -> applied, changed: false');

-- 5-6: legacy ops (an old bundle's queue).
select pg_temp.draft(5, 2, 3, 2);
insert into o values ('legacy', pg_temp.op('fire', jsonb_build_object('sessionId', '14000000-0000-4000-8000-000000000002', 'lineIds', jsonb_build_array(pg_temp.l(5)))));
select count(*) from (select pg_temp.apply('legacy', (select op from o where k = 'legacy'))) x;
select is((pg_temp.r('legacy') ->> 'status') || ' ' || (pg_temp.r('legacy') -> 'result' -> 'held')::text || ' ' || pg_temp.calls(2), 'applied [] 2:fire_now',
  'a legacy fire op without hold on a segue line -> fired and called (fire_now)');
select pg_temp.draft(6, 2, 2, 1);
insert into o values ('edit', pg_temp.op('edit_line', jsonb_build_object('lineId', pg_temp.l(6), 'segue', true)));
select count(*) from (select pg_temp.apply('edit', (select op from o where k = 'edit'))) x;
select is((pg_temp.r('edit') ->> 'status') || ' ' || (select uscita || '/' || segue from public.order_line where id = pg_temp.l(6)), 'applied 2/true',
  'a legacy edit_line {segue: true} op -> uscita 2');

-- 7-10: refusals and conflicts are stored, never raised.
insert into o values ('u1', pg_temp.op('call_uscita', jsonb_build_object('sessionId', '14000000-0000-4000-8000-000000000001', 'uscita', 1)));
select count(*) from (select pg_temp.apply('u1', (select op from o where k = 'u1'))) x;
select is((pg_temp.r('u1') ->> 'status') || ' ' || (pg_temp.r('u1') -> 'result' ->> 'message'), 'rejected invalid_request', 'a call_uscita with uscita 1 -> stored rejected invalid_request');
insert into o values ('none', pg_temp.op('call_uscita', jsonb_build_object('sessionId', '14000000-0000-4000-8000-000000000001', 'uscita', 5)));
select count(*) from (select pg_temp.apply('none', (select op from o where k = 'none'))) x;
select is((pg_temp.r('none') ->> 'status') || ' ' || (pg_temp.r('none') -> 'result' -> 'conflict' ->> 'reason') || ' ' || (pg_temp.r('none') ->> 'stop'),
  'conflict nothing_waiting false', 'a call with nothing waiting -> stored conflict nothing_waiting, and the batch goes on');
select is(pg_temp.apply('x', pg_temp.op('call_uscita', jsonb_build_object('sessionId', '14000000-0000-4000-8000-000000000001', 'uscita', 2, 'hold', true))),
  '22023 invalid_request', 'an unknown key in a call_uscita payload -> 22023, nothing stored');
select is(pg_temp.apply('y', pg_temp.op('fire', jsonb_build_object('sessionId', '14000000-0000-4000-8000-000000000001', 'lineIds', jsonb_build_array(pg_temp.l(1)), 'uscita', 2))),
  '22023 invalid_request', 'uscita is not a fire key');
insert into o values ('hold_bad', pg_temp.op('fire', jsonb_build_object('sessionId', '14000000-0000-4000-8000-000000000001', 'lineIds', jsonb_build_array(pg_temp.l(1)), 'hold', 'yes')));
select count(*) from (select pg_temp.apply('hold_bad', (select op from o where k = 'hold_bad'))) x;
select is((pg_temp.r('hold_bad') ->> 'status') || ' ' || (pg_temp.r('hold_bad') -> 'result' ->> 'message'), 'rejected invalid_request', 'hold "yes" in a fire op -> stored rejected');

-- 12-14: the kind list.
select is((app.sync_op_kinds())[7] || ' ' || cardinality(app.sync_op_kinds()), 'call_uscita 7', 'call_uscita is the seventh kind, last');
select is((select string_agg(kind, ',' order by kind) from public.applied_op where kind = 'call_uscita'), 'call_uscita,call_uscita,call_uscita,call_uscita',
  'applied_op accepts the new kind (two applied, one rejected, one conflict)');
select is((select count(*)::int from public.applied_op where kind not in (select unnest(app.sync_op_kinds()))), 0, 'every stored kind is still in the list');

select * from finish();
rollback;
