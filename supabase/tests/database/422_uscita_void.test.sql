-- Comanda per uscita, step 7 (docs/plans/2026-11-18-comanda-uscite.md section 3.7; migration 20261206220300_uscita_void.sql): M4, not_prepared.
-- A held line (sent, its uscita not called) can only be voided not_prepared: one reversal per original consume and consumption row and NO
-- waste, so the stock comes back; a portion of a batch discarded since stays waste with the discard's reason, and the batch stays discarded.
-- A called line refuses not_prepared (conflict uscita_called) and keeps today's reversal + waste. The cost row stays (append-only); the KPI
-- drops the voided line. Fake data only.
begin;
set local timezone = 'UTC';
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('b3000000-0000-4000-8000-0000000000d3', 'waiter-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('b3100000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'b3000000-0000-4000-8000-0000000000d3', 'waiter', 'Cameriere B Demo');
insert into public.location (id, tenant_id, name) values ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella (demo)');
-- Raw stock: onions, 5 kg booked unlotted at 2,00 a kg (an opening row); the plate takes 0,1 kg.
insert into public.ingredient (id, tenant_id, name, base_unit, is_stock) values
  ('16000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Cipolla (demo)', 'kg', true);
insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, ref_type, ref_id, effective_on, created_by)
  values ('11111111-1111-4111-8111-111111111111', '16000000-0000-4000-8000-000000000001', null, '10000000-0000-4000-8000-0000000000a1', 'opening', 5, 2,
          'opening', gen_random_uuid(), current_date - 5, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by) values
  ('ec000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'batch', 1, 'spezzatino (demo)', 'a1000000-0000-4000-8000-00000000000a'),
  ('ec000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'plate', 1, 'spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit, portions_per_batch, shelf_life_hours, created_by) values
  ('ed000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 1, now() - interval '5 days', 'Spezzatino (demo)', 2, 'kg', 10, 48, 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, created_by) values
  ('ed000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e2', 1, now() - interval '5 days', 'Spezzatino con polenta (demo)', 'a1000000-0000-4000-8000-00000000000a');
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, ingredient_id, qty, unit, yield_factor, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 1, 'ec000000-0000-4000-8000-0000000000e1', null, 1, 'porz', 1, 'a1000000-0000-4000-8000-00000000000a'),
  ('11111111-1111-4111-8111-111111111111', 'ed000000-0000-4000-8000-0000000000d2', 2, null, '16000000-0000-4000-8000-000000000001', 0.1, 'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item (id, tenant_id, name, category, course_default, recipe_key, is_available, is_active, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Bruschetta (demo)', 'Antipasti', 'antipasti', null, true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a'),
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Spezzatino con polenta (demo)', 'Secondi', 'secondi', 'ec000000-0000-4000-8000-0000000000e2', true, true, 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.menu_item_price (tenant_id, menu_item_id, price, vat_rate, valid_from, created_by)
  select '11111111-1111-4111-8111-111111111111', id, 10, 10, now() - interval '1 day', 'a1000000-0000-4000-8000-00000000000a' from public.menu_item;
-- Batch A: 1 portion, the first to go (FEFO); batch B: 20 portions.
insert into public.batch (id, tenant_id, recipe_key, recipe_id, recipe_version, lot_code, lot_date, lot_recipe_code, lot_seq, produced_at, produced_by,
                          output_qty, output_unit, portions_computed, portions_initial, shelf_life_hours, use_by, state, location_id, created_by)
  values ('ba000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1,
          '981023-SPE-1', '1998-10-23', 'SPE', 1, now() - interval '20 hours', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 1, 1, 48, now() + interval '28 hours',
          'fresh', '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a'),
         ('ba000000-0000-4000-8000-00000000000b', '11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-0000000000e1', 'ed000000-0000-4000-8000-0000000000d1', 1,
          '981023-SPE-2', '1998-10-23', 'SPE', 2, now() - interval '2 hours', 'a1000000-0000-4000-8000-00000000000a', 2, 'kg', 20, 20, 48, now() + interval '46 hours',
          'fresh', '10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-00000000000a');
insert into public.batch_movement (tenant_id, batch_id, type, portions, ref_type, ref_id, effective_on, created_by)
  select '11111111-1111-4111-8111-111111111111', b.id, 'produce', b.portions_initial, 'batch', b.id, '1998-10-23', 'a1000000-0000-4000-8000-00000000000a' from public.batch b;
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 2) n;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  select ('14000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', ('13000000-0000-4000-8000-00000000000' || n)::uuid,
         'Tavolo ' || n || ' (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', '1998-10-24', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 2) n;

create function pg_temp.draft(p_n int, p_s int, p_i int, p_u int) returns void language sql as $$
  insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, uscita, segue, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by)
  select ('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111',
         ('14000000-0000-4000-8000-00000000000' || p_s)::uuid, m.id, m.course_default, 1, p_u, p_u >= 2, 10, 10, 'menu', '1998-10-24 19:00+00',
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from public.menu_item m where m.id = ('11000000-0000-4000-8000-00000000000' || p_i)::uuid $$;
create function pg_temp.l(p_n int) returns uuid language sql as $$ select ('e1000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;
create function pg_temp.as_role(p_auth uuid, p_tenant uuid, p_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_role, 'aal', 'aal1')::text, true) $$;
create temp table res (nm text primary key, j jsonb);
grant all on res to authenticated;
create function pg_temp.run(p_nm text, stmt text, p_who text default 'waiter') returns text language plpgsql as $$
declare
  v jsonb;
  state text;
  msg text;
begin
  case p_who
    when 'waiter' then perform pg_temp.as_role('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
    when 'chef' then perform pg_temp.as_role('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
    when 'waiterb' then perform pg_temp.as_role('b3000000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'waiter');
  end case;
  set local role authenticated;
  begin
    execute stmt into v;
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
create function pg_temp.j(p_nm text) returns jsonb language sql as $$ select j from res where nm = p_nm $$;
create function pg_temp.fire(p_s int, p_lines int[]) returns text language sql as $$
  select 'select public.fire_course(''14000000-0000-4000-8000-00000000000' || p_s || ''', jsonb_build_object(''lineIds'', to_jsonb(array['
         || array_to_string(array(select quote_literal(pg_temp.l(n)) || '::uuid' from unnest(p_lines) n), ',') || ']), ''hold'', true))' $$;
create function pg_temp.void(p_n int, p_reason text) returns text language sql as $$
  select 'select public.void_line(' || quote_literal(pg_temp.l(p_n)) || '::uuid, ''{"reason": "' || p_reason || '", "clientUpdatedAt": "1998-10-24T19:30:00Z"}''::jsonb)' $$;
create function pg_temp.rem(p_batch text) returns numeric language sql as $$ select trim_scale(app.batch_remaining('11111111-1111-4111-8111-111111111111', ('ba000000-0000-4000-8000-00000000000' || p_batch)::uuid)) $$;
create function pg_temp.onions() returns numeric language sql as $$ select trim_scale(sum(qty)) from public.stock_movement where ingredient_id = '16000000-0000-4000-8000-000000000001' $$;
create function pg_temp.moves(p_n int) returns text language sql as $$
  select coalesce(string_agg(x, ',' order by x), '-') from (
    select 'b:' || type || ':' || trim_scale(portions) || ':' || ref_type || ':' || (reverses_id is not null)::text || ':' || coalesce(reason_code, '-') x
      from public.batch_movement where ref_id = pg_temp.l(p_n)
    union all
    select 's:' || type || ':' || trim_scale(qty) || ':' || ref_type || ':' || (reverses_id is not null)::text || ':' || coalesce(reason_code, '-')
      from public.stock_movement where ref_id = pg_temp.l(p_n)) y $$;
create temp table before_send (onions numeric, rem_a numeric);
grant all on before_send to authenticated;

-- 1-6 (AT6): the founder's held spezzatino, voided not_prepared.
select pg_temp.draft(1, 1, 1, 1), pg_temp.draft(3, 1, 3, 2), pg_temp.draft(4, 1, 3, 2);
insert into before_send values (pg_temp.onions(), pg_temp.rem('a'));
select pg_temp.run('send', pg_temp.fire(1, array[1, 3]));
select pg_temp.run('v3', pg_temp.void(3, 'not_prepared'));
select is(pg_temp.moves(3) || ' / ' || pg_temp.rem('a') || ' ' || (select rem_a from before_send),
  'b:consume:-1:order_line:false:-,b:consume:1:order_void:true:-,s:consumption:-0.1:order_line:false:-,s:consumption:0.1:order_void:true:- / 1 1',
  'voiding a held spezzatino not_prepared writes one consume reversal per original and no waste, and the batch remaining equals its value before the send');
select is(pg_temp.onions(), (select onions from before_send), 'the raw stock is back to its balance before the send');
select is((select count(*)::int from public.stock_movement r join public.stock_movement o on o.id = r.reverses_id
             where r.ref_id = pg_temp.l(3) and (r.unit_cost is distinct from o.unit_cost or r.raw_lot_id is distinct from o.raw_lot_id or r.location_id <> o.location_id)), 0,
  'the reversal rows mirror unit cost, lot and location');
select is((select state::text from public.batch where id = 'ba000000-0000-4000-8000-00000000000a'), 'open', 'a finished batch that gets its portion back is open');
select is((pg_temp.j('v3') ->> 'changed') || ' ' || (pg_temp.j('v3') -> 'line' ->> 'state'), 'true voided', 'the reply is the voided line');
select is((select count(*)::int from public.order_line_cost where order_line_id = pg_temp.l(3)), 1, 'its order_line_cost row still exists (append-only)');

-- 7-10: replay and conflicts.
select is(pg_temp.run('v3b', pg_temp.void(3, 'not_prepared')) || ' ' || (pg_temp.j('v3b') ->> 'changed'), 'ok false', 'a replay -> changed: false');
select pg_temp.run('send4', pg_temp.fire(1, array[4]));
select is(pg_temp.run('ret', pg_temp.void(4, 'returned')) || ' ' || (pg_temp.j('ret') -> 'conflict' ->> 'reason') || ' ' || pg_temp.moves(4),
  'ok held b:consume:-1:order_line:false:-,s:consumption:-0.1:order_line:false:-', 'returned on a held line -> conflict held, nothing written');
select pg_temp.run('call', 'select public.call_uscita(''14000000-0000-4000-8000-000000000001'', ''{"uscita": 2}''::jsonb)');
select is(pg_temp.run('np', pg_temp.void(4, 'not_prepared')) || ' ' || (pg_temp.j('np') -> 'conflict' ->> 'reason') || ' ' || pg_temp.moves(4),
  'ok uscita_called b:consume:-1:order_line:false:-,s:consumption:-0.1:order_line:false:-', 'not_prepared on a called line -> conflict uscita_called, nothing written');
select is(pg_temp.run('ret2', pg_temp.void(4, 'returned')) || ' ' || pg_temp.moves(4),
  'ok b:consume:-1:order_line:false:-,b:consume:1:order_void:true:-,b:waste:-1:order_void:false:plating_error,s:consumption:-0.1:order_line:false:-,s:consumption:0.1:order_void:true:-,s:waste:-0.1:order_void:false:plating_error',
  'after the call, returned -> today''s reversal + waste');

-- 11-14: a held portion of a batch discarded since stays waste, with the discard's reason; the batch stays discarded.
select pg_temp.draft(5, 2, 3, 2), pg_temp.draft(6, 2, 3, 2);
select pg_temp.run('send2', pg_temp.fire(2, array[5, 6]));
select is((select string_agg(pg_temp.l(n)::text || '>' || (select right(b.batch_id::text, 1) from public.batch_movement b where b.ref_id = pg_temp.l(n) and b.type = 'consume'), ',' order by n)
             from unnest(array[5, 6]) n), pg_temp.l(5) || '>b,' || pg_temp.l(6) || '>b', 'fixture: lines 5 and 6 took batch B''s portions (A''s one went to line 4, voided returned)');
select is(pg_temp.run('disc', 'select public.discard_batch(''ba000000-0000-4000-8000-00000000000b'', ' || pg_temp.rem('b') || ', ''spoilage'')', 'chef'), 'ok',
  'fixture: the chef discards what is left of batch B (spoilage)');
select pg_temp.run('v6', pg_temp.void(6, 'not_prepared'));
select is(pg_temp.moves(6) || ' / ' || (select state::text from public.batch where id = 'ba000000-0000-4000-8000-00000000000b') || ' ' || pg_temp.rem('b'),
  'b:consume:-1:order_line:false:-,b:consume:1:order_void:true:-,b:waste:-1:order_void:false:spoilage,s:consumption:-0.1:order_line:false:-,s:consumption:0.1:order_void:true:- / discarded 0',
  'a held line whose batch was discarded since -> reversal + waste with the discard''s reason, and the batch stays discarded');
select is((select count(*)::int from app.ledger_checks_body('11111111-1111-4111-8111-111111111111', now() + interval '1 minute')
             where check_key in ('reversal_mirror', 'fire_depletion', 'batch_state')), 0, 'reversal_mirror, fire_depletion and batch_state of ledger_checks_body stay empty');

-- 15-17: drafts, tenancy, the reason list.
select pg_temp.draft(7, 2, 1, 1);
select is(pg_temp.run('vd', pg_temp.void(7, 'not_prepared')) || ' ' || (pg_temp.j('vd') -> 'line' ->> 'state') || ' ' || pg_temp.moves(7), 'ok voided -',
  'a draft accepts not_prepared and writes no movement');
select is(pg_temp.run('xb', pg_temp.void(5, 'not_prepared'), 'waiterb'), 'P0002 line_not_found', 'B voiding A''s line -> P0002 (X)');
select is((app.order_void_reason_codes())[7] || ' ' || cardinality(app.order_void_reason_codes()) || ' ' || coalesce(app.void_waste_reason('not_prepared'), 'null'),
  'not_prepared 7 null', 'not_prepared is the seventh void reason (last) and maps to no waste reason');

-- 18-20: the KPI drops the voided held line after the close; its cost row stays.
update public.table_session set closed_at = now(), closed_by = 'd1000000-0000-4000-8000-00000000000d', closed_business_date = '1998-10-24',
  receipt_type = 'scontrino', receipt_number = '0001-0001', payment_type = 'card', total = 10 where id = '14000000-0000-4000-8000-000000000001';
select is((select count(*)::int from app.kpi_sales_lines('11111111-1111-4111-8111-111111111111', '1998-10-24', '1998-10-24') k
             where k.session_id = '14000000-0000-4000-8000-000000000001'), 1, 'after the close the KPI has the bruschetta only: the voided spezzatini left');
select is((select count(*)::int from public.order_line_cost where order_line_id in (pg_temp.l(3), pg_temp.l(4))), 2, 'and both cost rows still exist');
select is((select count(*)::int from public.batch_movement where type = 'waste' and ref_id = pg_temp.l(3))
          + (select count(*)::int from public.stock_movement where type = 'waste' and ref_id = pg_temp.l(3)), 0, 'the not_prepared line wrote no waste anywhere');

-- 21-24: the second held line of the discarded batch, and the end state.
select is(pg_temp.run('v5', pg_temp.void(5, 'not_prepared')) || ' ' || pg_temp.moves(5) || ' / ' || (select state::text from public.batch where id = 'ba000000-0000-4000-8000-00000000000b') || ' ' || pg_temp.rem('b'),
  'ok b:consume:-1:order_line:false:-,b:consume:1:order_void:true:-,b:waste:-1:order_void:false:spoilage,s:consumption:-0.1:order_line:false:-,s:consumption:0.1:order_void:true:- / discarded 0',
  'the second held line of the discarded batch: the same reversal + waste, and the batch stays discarded with nothing left');
select is((select count(*)::int from public.order_line where table_session_id = '14000000-0000-4000-8000-000000000002' and voided_at is not null), 3,
  'session 2: lines 5, 6 and 7 are voided');
select is((select count(*)::int from app.held_lines('11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-000000000002', 2::smallint)), 0,
  'a voided held line is no longer held');
select is(pg_temp.run('bad', 'select public.void_line(' || quote_literal(pg_temp.l(1)) || '::uuid, ''{"reason": "not_ready", "clientUpdatedAt": "1998-10-24T19:30:00Z"}''::jsonb)'),
  'P0001 void_reason_invalid', 'an unknown reason is still void_reason_invalid');

select * from finish();
rollback;
