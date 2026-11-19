-- Comanda per uscita, step 4 (docs/plans/2026-11-18-comanda-uscite.md section 3.4, migration 20261206220100_uscita_order_entry.sql): M2, order
-- entry with an uscita. add_order_line and update_order_line take an optional uscita (0..9); legacy segue maps (true -> 2, false -> the default of
-- the line's course); uscita and segue together are 22023; segue mirrors uscita >= 2 in the same write; the line JSON carries uscita; the sync
-- payload check admits the key for add_line and edit_line. Fake data only.
begin;
set local timezone = 'UTC';
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');
insert into public.menu_item (id, tenant_id, name, category, course_default, is_available, is_active, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Bruschetta (demo)', 'Antipasti', 'antipasti', true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle (demo)', 'Primi', 'primi', true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Spezzatino (demo)', 'Secondi', 'secondi', true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  select '11111111-1111-4111-8111-111111111111', id, 5, 10, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a' from public.menu_item;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 4,
   'd1000000-0000-4000-8000-00000000000d', '1998-10-24', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');

select set_config('request.jwt.claims', json_build_object('sub', 'd0000000-0000-4000-8000-00000000000d', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'waiter', 'aal', 'aal1')::text, true);
create temp table tb as select date_trunc('minute', clock_timestamp()) - interval '1 hour' as base;
grant select on tb to authenticated;
create function pg_temp.t(n int) returns text language sql as $$
  select to_char((base + n * interval '1 minute') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from tb $$;
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
-- add_order_line on session 1 as the waiter, line id e1..0n, at t(0); returns the reply.
create function pg_temp.addl(p_n int, p_item int, p_extra jsonb default '{}') returns jsonb language plpgsql as $$
declare
  r jsonb;
begin
  set local role authenticated;
  r := public.add_order_line('14000000-0000-4000-8000-000000000001',
    jsonb_build_object('lineId', 'e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'),
                       'menuItemId', '11000000-0000-4000-8000-00000000000' || p_item, 'clientUpdatedAt', pg_temp.t(0)) || p_extra);
  reset role;
  return r;
end
$$;
create function pg_temp.upd(p_n int, p_t int, p_extra jsonb) returns jsonb language plpgsql as $$
declare
  r jsonb;
begin
  set local role authenticated;
  r := public.update_order_line(('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid,
                                jsonb_build_object('clientUpdatedAt', pg_temp.t(p_t)) || p_extra);
  reset role;
  return r;
end
$$;
create function pg_temp.us(p_n int) returns text language sql as $$
  select uscita::text || '/' || segue::text from public.order_line where id = ('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;

-- 1-3: add with uscita.
select is((select (r -> 'line' ->> 'uscita') || ' ' || pg_temp.us(1) from (select pg_temp.addl(1, 3, '{"uscita": 2}') r) x), '2 2/true',
  'add_order_line with {uscita: 2} stores uscita 2 and segue true, and the reply line has uscita: 2');
select is((select pg_temp.us(2) from (select pg_temp.addl(2, 2)) x), '1/false', 'no uscita, course primi -> 1');
select is((select pg_temp.us(3) from (select pg_temp.addl(3, 4)) x), '0/false', 'no uscita, course bevande -> 0');
-- 4-6: legacy segue and the final course.
select is((select pg_temp.us(4) from (select pg_temp.addl(4, 3, '{"segue": true}')) x), '2/true', 'legacy {segue: true} -> 2');
select is((select pg_temp.us(5) from (select pg_temp.addl(5, 2, '{"segue": false}')) x), '1/false', 'legacy {segue: false} -> the default (primi: 1)');
select is((select pg_temp.us(6) from (select pg_temp.addl(6, 2, '{"course": "bevande"}')) x), '0/false', 'no uscita, the default follows the final course (bevande: 0)');
select is((select pg_temp.us(7) from (select pg_temp.addl(7, 4, '{"uscita": 3}')) x), '3/true', 'a drink may be held too when the waiter says so (uscita 3)');
-- 8-11: refusals; nothing written.
select is(pg_temp.err($$select pg_temp.addl(20, 3, '{"uscita": 2, "segue": true}')$$), '22023 invalid_request', 'uscita together with segue -> 22023');
select is(pg_temp.err($$select pg_temp.addl(21, 3, '{"uscita": "2"}')$$), '22023 invalid_request', 'uscita "2" -> 22023');
select is(pg_temp.err($$select pg_temp.addl(22, 3, '{"uscita": 10}')$$), '22023 invalid_request', 'uscita 10 -> 22023');
select is((select count(*)::int from public.order_line where id in ('e1000000-0000-4000-8000-000000000020', 'e1000000-0000-4000-8000-000000000021',
  'e1000000-0000-4000-8000-000000000022')), 0, 'and no refused add wrote a line');
-- 12: the same add replayed answers the stored line (the replay comes first, unchanged).
select is((select r -> 'line' ->> 'uscita' from (select pg_temp.addl(1, 3, '{"uscita": 2}') r) x), '2', 'a replayed add answers the stored line with its uscita');

-- 13-20: update_order_line.
select is((select (r ->> 'changed') || ' ' || (r -> 'line' ->> 'uscita') || ' ' || pg_temp.us(2) from (select pg_temp.upd(2, 1, '{"uscita": 3}') r) x),
  'true 3 3/true', 'update {uscita: 3} on a draft -> 3 and segue true');
select is((select pg_temp.us(2) from (select pg_temp.upd(2, 2, '{"uscita": 0}')) x), '0/false', 'update {uscita: 0} -> 0 and segue false');
select is((select pg_temp.us(7) from (select pg_temp.upd(7, 1, '{"segue": false}')) x), '0/false', 'legacy edit {segue: false} on a drink -> 0');
select is((select pg_temp.us(3) from (select pg_temp.upd(3, 1, '{"segue": true}')) x), '2/true', 'legacy edit {segue: true} -> 2');
select is((select pg_temp.us(3) from (select pg_temp.upd(3, 2, '{"segue": false, "course": "primi"}')) x), '1/false',
  'legacy edit {segue: false} with a course change -> the default of the course after the patch');
select is(pg_temp.err($$select pg_temp.upd(5, 1, '{"uscita": 2, "segue": true}')$$), '22023 invalid_request', 'edit with uscita and segue -> 22023');
select is(pg_temp.err($$select pg_temp.upd(5, 1, '{"uscita": 1.5}')$$), '22023 invalid_request', 'edit with uscita 1.5 -> 22023');
select is((select (r ->> 'changed') from (select pg_temp.upd(2, 2, '{"uscita": 0}') r) x), 'false', 'a same-stamp replay with the same uscita -> changed: false');
select is((select r -> 'conflict' ->> 'reason' from (select pg_temp.upd(2, 2, '{"uscita": 4}') r) x), 'stale', 'a same-stamp edit with another uscita -> stale');
-- 22: a sent line answers the conflict fired, unchanged.
update public.order_line set fired_at = now(), fired_by = 'd1000000-0000-4000-8000-00000000000d' where id = 'e1000000-0000-4000-8000-000000000005';
select is((select (r -> 'conflict' ->> 'reason') || ' ' || pg_temp.us(5) from (select pg_temp.upd(5, 5, '{"uscita": 2}') r) x), 'fired 1/false',
  'on a sent line -> conflict fired, nothing changes');

-- 23: the line JSON.
select ok((select app.order_line_json(l) ? 'uscita' and app.order_line_json(l) ? 'segue' from public.order_line l where l.id = 'e1000000-0000-4000-8000-000000000001'),
  'the line JSON carries uscita, and segue stays');

-- 24-27: the sync payload check.
select is(pg_temp.err($$select app.apply_op_check_payload('add_line', '{"sessionId": "x", "lineId": "y", "menuItemId": "z", "uscita": 2}')$$), 'ok',
  'apply_op_check_payload accepts uscita for add_line');
select is(pg_temp.err($$select app.apply_op_check_payload('edit_line', '{"lineId": "y", "uscita": 2}')$$), 'ok', 'and for edit_line');
select is(pg_temp.err($$select app.apply_op_check_payload('edit_line', '{"lineId": "y", "hold": true}')$$), '22023 invalid_request', 'and still refuses an unknown key');
select is(pg_temp.err($$select app.apply_op_check_payload('fire', '{"sessionId": "x", "lineIds": [], "uscita": 2}')$$), '22023 invalid_request',
  'uscita is not a fire key');

select * from finish();
rollback;
