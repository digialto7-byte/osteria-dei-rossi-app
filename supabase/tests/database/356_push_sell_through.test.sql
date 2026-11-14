-- P2-2 S5 (docs/plans/2026-11-14-p2-2-trace-sell-through.md section 3.4 and step S5): the push sell-through of a business day. Fixture: business day D = 1998-11-13 (Rome is UTC+1; the day window is
-- [1998-11-13T01:00Z, 1998-11-14T01:00Z)), p_now 1998-11-14T09:00Z (10:00 Rome, business day D+1). Lasagne is pushed from 11:00 Rome with a day price and the batch key of Ragù; Ragù batch R1
-- (use-by D 23:00 Rome: due soon at the push start) is sold, voided, discarded, eaten by staff and split into R1c; R2 (use-by D+3) is not due soon. Tagliatelle is pushed and stopped at 13:00 Rome
-- (one weighed line); Pizza is pushed from D-1 until 04:00 Rome on D. Dates are 1998; the rows are written as fire_course, void_line, discard_batch, split_batch and the staff meal write them.
-- Definitions fixed here where the plan text is open: a movement exactly at the window start belongs to the window (atStart counts movements strictly before it, so
-- otherDuring = leftAtEnd - atStart + soldDuring + wastedDuring holds exactly); startedAt and endedAt are the window clipped to the business day and to now; per-push ongoing means the window is
-- still open at now. Plan deviation, from the money-key rule the chef reply must pass: the plan's `totals` is `summary` and its `withDayPrice` is `hasDayRate`. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

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
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'ragu (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000eb', '22222222-2222-4222-8222-222222222222', 'batch', 1, 'ragu b (demo)', 'b1000000-0000-4000-8000-00000000000b');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d3', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 1, '1998-10-01', 'Ragù Demo', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a'),
  ('ed000000-0000-4000-8000-0000000000db', '22222222-2222-4222-8222-222222222222', 'ec000000-0000-4000-8000-0000000000eb', 1, '1998-10-01', 'Ragù B Demo', 2, 'kg', 10, 48, 'b1000000-0000-4000-8000-00000000000b');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Lasagne Demo', 'Primi', 'primi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Tagliatelle Demo', 'Primi', 'primi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Pizza Demo', 'Secondi', 'secondi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Gnocchi Demo', 'Primi', 'primi', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Piatto B Demo', 'Primi', 'primi', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by) values
  ('13000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Tavolo 1 (demo)', 1, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('13000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Tavolo B (demo)', 1, 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_at, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000001', 'Tavolo 1 (demo)', 4, '1998-03-01T10:00Z',
   'a1000000-0000-4000-8000-00000000000a', '1998-03-01', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('14000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '13000000-0000-4000-8000-0000000000b1', 'Tavolo B (demo)', 2, '1998-03-01T10:00Z',
   'b1000000-0000-4000-8000-00000000000b', '1998-03-01', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');

create temporary table reg (k text primary key, id uuid not null);
insert into reg values ('lasagne', '11000000-0000-4000-8000-000000000001'), ('tagliatelle', '11000000-0000-4000-8000-000000000002'), ('pizza', '11000000-0000-4000-8000-000000000003'),
  ('gnocchi', '11000000-0000-4000-8000-000000000004'), ('ragu', 'ec000000-0000-4000-8000-0000000000e3');
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
end $$;
create function pg_temp.act_as(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub',
    case p_who when 'owner' then 'a0000000-0000-4000-8000-00000000000a' when 'admin' then 'f0000000-0000-4000-8000-00000000000f'
               when 'chef' then 'c0000000-0000-4000-8000-00000000000c' when 'ownerb' then 'b0000000-0000-4000-8000-00000000000b'
               else 'd0000000-0000-4000-8000-00000000000d' end, 'role', 'authenticated',
    'tenant_id', case when p_who = 'ownerb' then '22222222-2222-4222-8222-222222222222' else '11111111-1111-4111-8111-111111111111' end,
    'app_role', case when p_who = 'ownerb' then 'owner' else p_who end, 'aal', case when p_who = 'admin' then 'aal2' else 'aal1' end)::text, true) $$;
create function pg_temp.out(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  set local role authenticated;
  execute stmt;
  reset role;
  return 'ok';
exception when others then
  reset role;
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end $$;
create function pg_temp.all_keys(j jsonb) returns setof text language plpgsql as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    for k, v in select * from jsonb_each(j) loop
      return next k;
      return query select * from pg_temp.all_keys(v);
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    for v in select * from jsonb_array_elements(j) loop
      return query select * from pg_temp.all_keys(v);
    end loop;
  end if;
end $$;

-- Writers ------------------------------------------------------------------------------------------------------------------------------------
create sequence pg_temp.seq;
-- A batch of Ragù: produced at p_produced with p_shelf hours of shelf life and p_portions portions; a split child (p_parent) gets the split pair at p_created and keeps the parent's times.
create function pg_temp.mkbatch(p_k text, p_produced timestamptz, p_shelf int, p_portions int, p_parent text default null, p_created timestamptz default null) returns void language plpgsql as $$
declare
  v_n int := nextval('pg_temp.seq');
  v_id uuid := gen_random_uuid();
  v_at timestamptz := coalesce(p_created, p_produced);
begin
  insert into reg values (p_k, v_id);
  insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by, output_qty, output_unit,
      portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, split_from_batch_id, created_at, created_by)
    values (v_id, '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e3', 'ed000000-0000-4000-8000-0000000000d3', 1, '981101-RAG-' || v_n, '1998-11-01', 'RAG', v_n, p_produced,
            'a1000000-0000-4000-8000-00000000000a', 2, 'kg', p_portions, p_portions, p_shelf, p_produced + make_interval(hours => p_shelf), 'fresh', '10000000-0000-4000-8000-0000000000a1',
            case when p_parent is null then null else pg_temp.id(p_parent) end, v_at, 'a1000000-0000-4000-8000-00000000000a');
  if p_parent is null then
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by)
      values ('11111111-1111-4111-8111-111111111111', v_id, 'produce', p_portions, 'batch', v_id, p_produced::date, v_at, 'a1000000-0000-4000-8000-00000000000a');
  else
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by) values
      ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_parent), 'split', -p_portions, 'batch_split', v_id, v_at::date, v_at, 'a1000000-0000-4000-8000-00000000000a'),
      ('11111111-1111-4111-8111-111111111111', v_id, 'split', p_portions, 'batch_split', v_id, v_at::date, v_at, 'a1000000-0000-4000-8000-00000000000a');
  end if;
end $$;
-- A fired line (p_weight: a weighed line with a 250 g reference portion).
create function pg_temp.mkline(p_k text, p_item text, p_fired timestamptz, p_weight int default null) returns void language plpgsql as $$
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_at, created_by, updated_by, fired_at, fired_by,
      weight_g, price_per_100g, portion_weight_g)
    values (pg_temp.id(p_k), '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000001', pg_temp.id(p_item), 'primi', 1,
            case when p_weight is null then 12 else round(4.8 * p_weight / 100, 2) end, 10, 'menu', p_fired - interval '1 hour', p_fired - interval '1 hour',
            'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', p_fired, 'd1000000-0000-4000-8000-00000000000d',
            p_weight, case when p_weight is null then null else 4.8 end, case when p_weight is null then null else 250 end);
end $$;
create function pg_temp.consume(p_line text, p_batch text, p_at timestamptz, p_portions numeric default 1) returns void language sql as $$
  insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_batch), 'consume', -p_portions, 'order_line', pg_temp.id(p_line), p_at::date, p_at, 'd1000000-0000-4000-8000-00000000000d') $$;
create function pg_temp.void_consume(p_line text, p_at timestamptz) returns void language plpgsql as $$
declare
  m record;
begin
  for m in select id, batch_id, portions from public.batch_movement where ref_id = pg_temp.id(p_line) and type = 'consume' and reverses_id is null loop
    insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, reverses_id, effective_on, created_at, created_by)
      values ('11111111-1111-4111-8111-111111111111', m.batch_id, 'consume', -m.portions, 'order_void', pg_temp.id(p_line), m.id, p_at::date, p_at, 'd1000000-0000-4000-8000-00000000000d');
    insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_at, created_by)
      values ('11111111-1111-4111-8111-111111111111', m.batch_id, 'waste', m.portions, 'plating_error', 'order_void', pg_temp.id(p_line), p_at::date, p_at, 'd1000000-0000-4000-8000-00000000000d');
  end loop;
  update public.order_line set voided_at = p_at, voided_by = 'd1000000-0000-4000-8000-00000000000d', void_reason = 'order_error' where id = pg_temp.id(p_line);
end $$;
create function pg_temp.bmove(p_batch text, p_type text, p_portions numeric, p_reason text, p_ref text, p_at timestamptz) returns void language sql as $$
  insert into public.batch_movement (tenant_id, batch_id, type, portions, reason_code, ref_type, ref_id, effective_on, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_batch), p_type::public.batch_movement_type, p_portions, p_reason, p_ref, gen_random_uuid(), p_at::date, p_at, 'c1000000-0000-4000-8000-00000000000c') $$;
create function pg_temp.push(p_item text, p_at timestamptz, p_until timestamptz, p_price numeric, p_keys uuid[]) returns void language sql as $$
  insert into public.menu_push (tenant_id, menu_item_id, action, push_until, push_price, batch_keys, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_item), 'start', p_until, p_price, p_keys, p_at, 'a1000000-0000-4000-8000-00000000000a') $$;
create function pg_temp.unpush(p_item text, p_at timestamptz) returns void language sql as $$
  insert into public.menu_push (tenant_id, menu_item_id, action, created_at, created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_item), 'stop', p_at, 'a1000000-0000-4000-8000-00000000000a') $$;

-- The fixture -----------------------------------------------------------------------------------------------------------------------------------
-- R1: 20 portions, produced 1998-11-11 22:00Z, 48 h shelf life: use-by D 23:00 Rome (22:00Z). R2: 10 portions, 72 h: use-by D+3.
select pg_temp.mkbatch('r1', '1998-11-11T22:00Z', 48, 20);
select pg_temp.mkbatch('r2', '1998-11-12T10:00Z', 72, 10);
-- Before the push (10:00Z): two plates from R1 at 10:00 Rome; so R1 holds 18 at the push start.
select pg_temp.mkline('e1', 'lasagne', '1998-11-13T09:00Z'); select pg_temp.consume('e1', 'r1', '1998-11-13T09:00Z');
select pg_temp.mkline('e2', 'lasagne', '1998-11-13T09:05Z'); select pg_temp.consume('e2', 'r1', '1998-11-13T09:05Z');
-- The push: Lasagne from 11:00 Rome (10:00Z) to the end of the day (1998-11-14T01:00Z), day price 12, the Ragù key.
select pg_temp.push('lasagne', '1998-11-13T10:00Z', '1998-11-14T01:00Z', 12.00, array['ec000000-0000-4000-8000-0000000000e3']::uuid[]);
-- During: seven plates from R1, one from R2; one plate from R1 fired and voided; R1 discard, staff meal, a split into R1c at 15:00 Rome; one plate from R1c.
select pg_temp.mkline('l' || g, 'lasagne', timestamptz '1998-11-13T10:30Z' + g * interval '10 minutes'), pg_temp.consume('l' || g, 'r1', timestamptz '1998-11-13T10:30Z' + g * interval '10 minutes') from generate_series(1, 7) g;
select pg_temp.mkline('l8', 'lasagne', '1998-11-13T11:50Z'); select pg_temp.consume('l8', 'r2', '1998-11-13T11:50Z');
select pg_temp.mkline('lv', 'lasagne', '1998-11-13T11:30Z'); select pg_temp.consume('lv', 'r1', '1998-11-13T11:30Z'); select pg_temp.void_consume('lv', '1998-11-13T11:45Z');
select pg_temp.bmove('r1', 'waste', -1, 'spoilage', 'batch_discard', '1998-11-13T13:00Z');
select pg_temp.bmove('r1', 'waste', -1, 'staff_meal', 'staff_meal', '1998-11-13T13:30Z');
select pg_temp.mkbatch('r1c', '1998-11-11T22:00Z', 48, 2, 'r1', '1998-11-13T14:00Z');
select pg_temp.mkline('l9', 'lasagne', '1998-11-13T15:00Z'); select pg_temp.consume('l9', 'r1c', '1998-11-13T15:00Z');
-- After the day (the next morning, before now): one portion of R1c discarded. A Lasagne plate after the push window (not counted).
select pg_temp.bmove('r1c', 'waste', -1, 'spoilage', 'batch_discard', '1998-11-14T08:00Z');
select pg_temp.mkline('lx', 'lasagne', '1998-11-14T05:00Z'); select pg_temp.consume('lx', 'r2', '1998-11-14T05:00Z');
-- Tagliatelle: pushed at 11:00 Rome and stopped at 13:00 Rome; a plate at 11:30, a 350 g plate at 12:00 (1.4 portions), a plate at 13:30 (after the stop). No batch key.
select pg_temp.push('tagliatelle', '1998-11-13T10:00Z', '1998-11-14T01:00Z', null, '{}');
select pg_temp.unpush('tagliatelle', '1998-11-13T12:00Z');
select pg_temp.mkline('t1', 'tagliatelle', '1998-11-13T10:30Z');
select pg_temp.mkline('t2', 'tagliatelle', '1998-11-13T11:00Z', 350);
select pg_temp.mkline('t3', 'tagliatelle', '1998-11-13T12:30Z');
-- Pizza: pushed on D-1 at 21:00 Rome (20:00Z) until 04:00 Rome on D (03:00Z). Plates: 00:00 Rome (D-1's night, 23:00Z), 03:00 Rome (02:00Z) and 05:00 Rome (04:00Z).
select pg_temp.push('pizza', '1998-11-12T20:00Z', '1998-11-13T03:00Z', null, '{}');
select pg_temp.mkline('p1', 'pizza', '1998-11-12T23:00Z');
select pg_temp.mkline('p2', 'pizza', '1998-11-13T02:00Z');
select pg_temp.mkline('p3', 'pizza', '1998-11-13T04:00Z');
-- Today (D+1 = 1998-11-14, p_now 09:00Z): Pizza pushed again from 08:00 Rome (07:00Z) to the end of the day; one plate at 09:00 Rome.
select pg_temp.push('pizza', '1998-11-14T07:00Z', '1998-11-15T01:00Z', null, '{}');
select pg_temp.mkline('p4', 'pizza', '1998-11-14T08:00Z');
-- DST: Gnocchi pushed 1998-03-28 11:00 Rome until the next day; plates at 1998-03-29 01:59 Rome (00:59Z, CET: still business day 1998-03-28) and 03:01 Rome (01:01Z, CEST).
select pg_temp.push('gnocchi', '1998-03-28T10:00Z', '1998-03-29T10:00Z', null, '{}');
select pg_temp.mkline('g1', 'gnocchi', '1998-03-29T00:59Z');
select pg_temp.mkline('g2', 'gnocchi', '1998-03-29T01:01Z');
-- Tenant B: a push and a plate of its own on D.
insert into public.menu_push (tenant_id, menu_item_id, action, push_until, push_price, batch_keys, created_at, created_by)
  values ('22222222-2222-4222-8222-222222222222', '11000000-0000-4000-8000-0000000000b1', 'start', '1998-11-14T01:00Z', 9, '{}', '1998-11-13T10:00Z', 'b1000000-0000-4000-8000-00000000000b');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_at, created_by, updated_by, fired_at, fired_by)
  values ('a3000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', '14000000-0000-4000-8000-0000000000b1', '11000000-0000-4000-8000-0000000000b1', 'primi', 1, 9, 10, 'menu',
          '1998-11-13T10:00Z', '1998-11-13T10:00Z', 'b1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', '1998-11-13T10:30Z', 'b1000000-0000-4000-8000-00000000000b');

create function pg_temp.st(p_date date, p_role text default 'owner', p_now timestamptz default '1998-11-14T09:00Z') returns jsonb language sql as $$
  select app.push_sell_through_json('11111111-1111-4111-8111-111111111111', p_role, p_date, p_now) $$;
create function pg_temp.card(p_date date, p_item text, p_role text default 'owner', p_now timestamptz default '1998-11-14T09:00Z') returns jsonb language sql as $$
  select c from jsonb_array_elements(pg_temp.st(p_date, p_role, p_now) -> 'pushes') c where c ->> 'menuItemId' = pg_temp.id(p_item)::text order by c ->> 'startedAt' limit 1 $$;

select pg_temp.act_as('owner');

-- 1. The Lasagne push on D ---------------------------------------------------------------------------------------------------------------------
select is(pg_temp.card('1998-11-13', 'lasagne'),
  jsonb_build_object('menuItemId', pg_temp.id('lasagne'), 'name', 'Lasagne Demo', 'startedAt', '1998-11-13T10:00:00Z', 'endedAt', '1998-11-14T01:00:00Z', 'ongoing', false, 'hasDayRate', true, 'pushPrice', 12,
    'plates', jsonb_build_object('lines', 9, 'portions', 9),
    'atRisk', jsonb_build_array(jsonb_build_object('recipeKey', 'ec000000-0000-4000-8000-0000000000e3', 'name', 'Ragù Demo', 'batches', 2, 'atStart', 18, 'soldDuring', 8, 'wastedDuring', 2, 'otherDuring', -1,
                                                   'leftAtEnd', 7, 'discardedAfter', 1, 'sellThroughPct', 44))),
  'the Lasagne card: 9 plates (the voided line and the plate after the window are out); Ragù: R1 and R1c at risk (R2 is not due soon), 18 at start, 8 sold (7 + R1c''s 1; R2''s plate is not R1''s), 2 wasted (the discard and the void''s waste), other -1 (staff meal), 7 left, 1 discarded after, 44%');
select is(pg_temp.st('1998-11-13') ->> 'businessDate', '1998-11-13', 'the reply names the business date');
select is(pg_temp.st('1998-11-13') -> 'ongoing', 'false'::jsonb, 'a past day is not ongoing');
select is(pg_temp.st('1998-11-13') -> 'summary', jsonb_build_object('pushes', 3, 'lines', 12, 'portions', 12.4), 'totals: three pushes, 12 lines, 12.4 portions (the sum of the cards, nothing at risk summed)');
select is((select array_agg(c ->> 'name' order by o) from jsonb_array_elements(pg_temp.st('1998-11-13') -> 'pushes') with ordinality t (c, o)), array['Pizza Demo', 'Lasagne Demo', 'Tagliatelle Demo'],
          'cards ordered by window start, then name: Pizza (clipped to the day start), Lasagne, Tagliatelle');
select is((select (c ->> 'otherDuring')::numeric from jsonb_array_elements(pg_temp.card('1998-11-13', 'lasagne') -> 'atRisk') c), -1::numeric, 'otherDuring is the staff meal');
select is((select (c ->> 'leftAtEnd')::numeric - (c ->> 'atStart')::numeric + (c ->> 'soldDuring')::numeric + (c ->> 'wastedDuring')::numeric - (c ->> 'otherDuring')::numeric
             from jsonb_array_elements(pg_temp.card('1998-11-13', 'lasagne') -> 'atRisk') c), 0::numeric, 'otherDuring = leftAtEnd - atStart + soldDuring + wastedDuring, exactly');

-- 2. A push stopped at 13:00 Rome, a weighed line ------------------------------------------------------------------------------------------------
select is(pg_temp.card('1998-11-13', 'tagliatelle'),
  jsonb_build_object('menuItemId', pg_temp.id('tagliatelle'), 'name', 'Tagliatelle Demo', 'startedAt', '1998-11-13T10:00:00Z', 'endedAt', '1998-11-13T12:00:00Z', 'ongoing', false, 'hasDayRate', false, 'pushPrice', null,
    'plates', jsonb_build_object('lines', 2, 'portions', 2.4), 'atRisk', '[]'::jsonb),
  'a stopped push ends its window at the stop (13:00 Rome): the 13:30 plate is out; the 350 g line counts 1.4 portions; a push with no batch key has atRisk []');

-- 3. A push that began on D-1 ---------------------------------------------------------------------------------------------------------------------
select is(pg_temp.card('1998-11-13', 'pizza'),
  jsonb_build_object('menuItemId', pg_temp.id('pizza'), 'name', 'Pizza Demo', 'startedAt', '1998-11-13T01:00:00Z', 'endedAt', '1998-11-13T03:00:00Z', 'ongoing', false, 'hasDayRate', false, 'pushPrice', null,
    'plates', jsonb_build_object('lines', 1, 'portions', 1), 'atRisk', '[]'::jsonb),
  'a push started on D-1 with push_until in D is clipped to [day start, push_until): only the 03:00 Rome plate counts');
select is((pg_temp.card('1998-11-12', 'pizza') -> 'plates' ->> 'lines')::int, 1, 'and on D-1 the same push counts the plate at 00:00 Rome (clipped to the day end)');
select is(pg_temp.card('1998-11-12', 'pizza') ->> 'endedAt', '1998-11-13T01:00:00Z', 'D-1''s window ends at the cut-off');

-- 4. Today and yesterday --------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.st(null) -> 'businessDate', '"1998-11-13"'::jsonb, 'p_date null: yesterday''s business date (D)');
select is(pg_temp.st(null) -> 'summary', pg_temp.st('1998-11-13') -> 'summary', 'and the same figures');
select is(pg_temp.st('1998-11-14') ->> 'businessDate', '1998-11-14', 'today is allowed');
select is(pg_temp.st('1998-11-14') -> 'ongoing', 'true'::jsonb, 'and ongoing');
select is(pg_temp.card('1998-11-14', 'pizza'),
  jsonb_build_object('menuItemId', pg_temp.id('pizza'), 'name', 'Pizza Demo', 'startedAt', '1998-11-14T07:00:00Z', 'endedAt', '1998-11-14T09:00:00Z', 'ongoing', true, 'hasDayRate', false, 'pushPrice', null,
    'plates', jsonb_build_object('lines', 1, 'portions', 1), 'atRisk', '[]'::jsonb),
  'today: the window ends at now, the push is ongoing, the plate at 09:00 Rome counts');
select is((select count(*)::int from jsonb_array_elements(pg_temp.st('1998-11-14') -> 'pushes') c where c ->> 'name' = 'Lasagne Demo'), 0, 'a push that ended at the day start is not in the next day');
select is(pg_temp.err($$select pg_temp.st('1998-11-15')$$), 'P0001 date_in_future', 'tomorrow: P0001 date_in_future');

-- 5. DST -----------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.card('1998-03-28', 'gnocchi', 'owner', '1998-04-01T10:00Z') ->> 'endedAt', app.iso_utc(app.kpi_cutoff_end('11111111-1111-4111-8111-111111111111', '1998-03-28')),
          'DST: the window of 1998-03-28 ends at kpi_cutoff_end of that day');
select is((pg_temp.card('1998-03-28', 'gnocchi', 'owner', '1998-04-01T10:00Z') -> 'plates' ->> 'lines')::int, 1, 'the plate at 01:59 Rome on the change night counts in 1998-03-28, the one at 03:01 does not');
select is((pg_temp.card('1998-03-29', 'gnocchi', 'owner', '1998-04-01T10:00Z') -> 'plates' ->> 'lines')::int, 1, 'and the next day has the 03:01 plate');

-- 6. Roles, keys, tenancy -------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_temp.all_keys(pg_temp.st('1998-11-13', 'owner')) k where k = 'pushPrice'), 3, 'the owner reply has pushPrice on every card');
select is((select count(*)::int from pg_temp.all_keys(pg_temp.st('1998-11-13', 'admin')) k where k = 'pushPrice'), 3, 'the admin reply too');
select is((select count(*)::int from pg_temp.all_keys(pg_temp.st('1998-11-13', 'chef')) k where k = 'pushPrice'), 0, 'the chef reply has no pushPrice key at any depth');
select is(pg_temp.card('1998-11-13', 'lasagne', 'chef') -> 'hasDayRate', 'true'::jsonb, 'but the chef still sees hasDayRate');
select is(app.payload_money_keys(pg_temp.st('1998-11-13', 'chef')), '{}'::text[], 'the chef reply has no money key');
select is(app.payload_money_keys(pg_temp.st('1998-11-13', 'owner')), '{pushPrice}'::text[], 'the owner reply has the one money key, pushPrice');
select is(pg_temp.out(format('select public.push_sell_through(%L)', '1998-11-13'::date)), 'ok', 'owner: public.push_sell_through');
select is(pg_temp.out(format('select public.push_sell_through(%L)', (current_date + 3))), 'P0001 date_in_future', 'a future date through the public function: P0001 date_in_future');
select is(pg_temp.out('select public.push_sell_through()'), 'ok', 'the date defaults to null');
select pg_temp.act_as('chef');
select is(pg_temp.out('select public.push_sell_through(null)'), 'ok', 'chef: public.push_sell_through');
select is((select count(*)::int from pg_temp.all_keys(public.push_sell_through('1998-11-13')) k where k = 'pushPrice'), 0, 'the session role decides: no pushPrice from the public function for the chef');
select pg_temp.act_as('admin');
select is(pg_temp.out('select public.push_sell_through(null)'), 'ok', 'admin at aal2: public.push_sell_through');
select pg_temp.act_as('waiter');
select matches(pg_temp.out('select public.push_sell_through(null)'), '^42501 ', 'waiter: 42501');
select pg_temp.act_as('ownerb');
select is((select count(*)::int from jsonb_array_elements(app.push_sell_through_json('22222222-2222-4222-8222-222222222222', 'owner', '1998-11-13', '1998-11-14T09:00Z') -> 'pushes') c), 1, 'tenant B sees its own push only');
select is((select c ->> 'menuItemId' from jsonb_array_elements(app.push_sell_through_json('22222222-2222-4222-8222-222222222222', 'owner', '1998-11-13', '1998-11-14T09:00Z') -> 'pushes') c),
          '11000000-0000-4000-8000-0000000000b1', 'and it is not one of A''s');
select pg_temp.act_as('owner');
select is((select count(*)::int from jsonb_array_elements(pg_temp.st('1998-11-13') -> 'pushes') c where c ->> 'menuItemId' = '11000000-0000-4000-8000-0000000000b1'), 0, 'tenant B''s push is not in A''s reply');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'push_sell_through' and p.prosecdef and p.proconfig = array['search_path=""']
            and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE')), 1,
  'public.push_sell_through is a definer with an empty search_path, executable by authenticated only');

select * from finish();
rollback;
