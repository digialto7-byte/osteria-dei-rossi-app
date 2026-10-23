-- M13 step 3: count_start, count_record_lines, count_close, count_cancel, set_ingredient_critical
-- (M13 plan §3.1.2-7, §5 step 3; AT2, AT3; ADR-012). Procedures are called under claims (chef A unless stated);
-- fixtures and checks run as the migration owner. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(95);

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
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B (demo)');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
   'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('2a000000-0000-4000-8000-00000000002a', '22222222-2222-4222-8222-222222222222', 'Burro B (demo)', 'kg');

create temporary table reg (k text primary key, id uuid not null);
create temporary table results (k text primary key, j jsonb);
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
create function pg_temp.res(p_k text) returns jsonb language sql as $$ select j from results where k = p_k $$;
create function pg_temp.sid(p_k text) returns uuid language sql as $$ select (j->>'id')::uuid from results where k = p_k $$;

-- Switch identity: 'super' is the migration owner; the others set the role and the claims.
create function pg_temp.as_(p_who text) returns void language plpgsql as $$
declare
  v record;
begin
  if p_who = 'super' then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'none', true);
    return;
  end if;
  select * into v from (values
    ('owner', 'a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111'),
    ('admin', 'ad000000-0000-4000-8000-0000000000ad', '11111111-1111-4111-8111-111111111111'),
    ('chef', 'c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111'),
    ('waiter', 'e0000000-0000-4000-8000-0000000000e0', '11111111-1111-4111-8111-111111111111'),
    ('ownerb', 'b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222')) w (who, auth_id, tenant)
   where w.who = p_who;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v.auth_id, 'role', 'authenticated',
    'tenant_id', v.tenant, 'app_role', case p_who when 'ownerb' then 'owner' else p_who end)::text, true);
end
$$;
-- Runs a statement that returns jsonb as p_who; stores the answer under p_key; returns 'ok' or 'SQLSTATE message'.
create function pg_temp.run(p_key text, p_who text, p_sql text) returns text language plpgsql as $$
declare
  v jsonb;
  state text;
  msg text;
begin
  perform pg_temp.as_(p_who);
  begin
    execute p_sql into v;
  exception when others then
    get stacked diagnostics state = returned_sqlstate, msg = message_text;
    perform pg_temp.as_('super');
    return state || ' ' || msg;
  end;
  perform pg_temp.as_('super');
  insert into results values (p_key, v) on conflict (k) do update set j = excluded.j;
  return 'ok';
end
$$;
-- Runs a call for its effect: a bare select would print 'ok', which pg_prove reads as a TAP line.
create function pg_temp.quiet(p text) returns void language plpgsql as $$ begin return; end $$;
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

create sequence pg_temp.line_seq;
create function pg_temp.new_line() returns uuid language plpgsql as $$
declare
  v_n int := nextval('pg_temp.line_seq');
  v_line uuid := ('a2000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid;
begin
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, unit_price,
      line_amount, field_confidence, extracted)
    values (v_line, '11111111-1111-4111-8111-111111111111', 'e1000000-0000-4000-8000-0000000000e1',
            v_n, 'Riga demo', 1, 10, 10, '{}', '{}');
  return v_line;
end
$$;
-- An ingredient of tenant A with a lot of p_qty kg at Cella (receipt at unit_cost 10) and, when p_price is set, a
-- purchase price (the cost basis the count rows freeze).
create function pg_temp.mk(p_k text, p_name text, p_qty numeric, p_critical boolean default false, p_price numeric default 10,
    p_stock boolean default true, p_active boolean default true) returns void language plpgsql as $$
declare
  v_line uuid := pg_temp.new_line();
  v_lot uuid := gen_random_uuid();
begin
  insert into reg values (p_k, gen_random_uuid());
  insert into public.ingredient (id, tenant_id, name, base_unit, is_stock, is_critical, is_active)
    values (pg_temp.id(p_k), '11111111-1111-4111-8111-111111111111', p_name, 'kg', p_stock, p_critical, p_active);
  if p_qty > 0 then
    insert into public.raw_lot (id, tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id, lot_code,
        expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor, created_by)
      values (v_lot, '11111111-1111-4111-8111-111111111111', pg_temp.id(p_k), '10000000-0000-4000-8000-0000000000a1',
        '5a000000-0000-4000-8000-00000000005a', v_line, 'L-' || p_k, '2026-11-20', '2026-10-20', p_qty, 'kg', p_qty,
        'kg', 1, 'a1000000-0000-4000-8000-00000000000a');
    insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost,
        ref_type, ref_id, effective_on, created_by)
      values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_k), v_lot, '10000000-0000-4000-8000-0000000000a1',
        'receipt', p_qty, 10, 'invoice_line', v_line, '2026-10-20', 'a1000000-0000-4000-8000-00000000000a');
  end if;
  if p_price is not null then
    insert into public.price_history (tenant_id, ingredient_id, supplier_id, invoice_line_id, unit_price, base_unit,
        effective_on, created_by)
      values ('11111111-1111-4111-8111-111111111111', pg_temp.id(p_k), '5a000000-0000-4000-8000-00000000005a',
        pg_temp.new_line(), p_price, 'kg', '2026-10-20', 'a1000000-0000-4000-8000-00000000000a');
  end if;
end
$$;
create function pg_temp.on_hand(p_k text) returns numeric language sql as $$
  select app.location_on_hand('11111111-1111-4111-8111-111111111111', pg_temp.id(p_k), '10000000-0000-4000-8000-0000000000a1')
$$;
create function pg_temp.counts(p_k text) returns numeric language sql as $$
  select coalesce(sum(qty), 0) from public.stock_movement where ingredient_id = pg_temp.id(p_k) and type = 'count'
$$;
create function pg_temp.count_rows(p_session uuid) returns bigint language sql as $$
  select count(*) from public.stock_movement where ref_type = 'count_session' and ref_id = p_session
$$;
-- One line element for count_record_lines.
create function pg_temp.ln(p_k text, p_qty numeric, p_unit text default 'kg') returns jsonb language sql as $$
  select jsonb_build_object('ingredient_id', pg_temp.id(p_k), 'qty', p_qty, 'unit', p_unit)
$$;
create function pg_temp.rec(p_key text, p_who text, p_session uuid, p_lines jsonb) returns text language sql as $$
  select pg_temp.run(p_key, p_who, format($f$ select public.count_record_lines(%L, %L::jsonb) $f$, p_session, p_lines::text))
$$;
create function pg_temp.audit_n(p_action text) returns bigint language sql as $$
  select count(*) from public.audit_event where action = p_action
$$;

-- The 20 critical ingredients (5 kg each), an inactive and a non-stock critical one, and others -------------
select pg_temp.mk('x1', 'Altro ingrediente (demo)', 3);
select is(pg_temp.run('s0', 'chef', $$ select public.count_start('daily') $$), 'P0001 no_critical_ingredients',
  'daily with no critical ingredient is refused');
select is(pg_temp.run('s0', 'chef', $$ select public.count_start('weekly') $$), 'P0001 type_invalid', 'an unknown type is refused');
select is((select count(*)::int from public.count_session), 0, '... no session was created');
select pg_temp.mk('c' || lpad(g::text, 2, '0'), 'Ingrediente critico ' || lpad(g::text, 2, '0') || ' (demo)', 5, true)
  from generate_series(1, 20) g;
select pg_temp.mk('inact', 'Ingrediente spento (demo)', 0, true, null, true, false);
select pg_temp.mk('nostock', 'Detersivo critico (demo)', 0, true, null, false);

-- Start -------------------------------------------------------------------------------------------------
select is(pg_temp.run('d1', 'chef', $$ select public.count_start('daily') $$), 'ok', 'chef starts a daily count');
select is((select count(*)::int from public.count_line where session_id = pg_temp.sid('d1')), 20,
  '20 lines: the inactive and the non-stock critical ingredients are excluded');
select is((select string_agg(i.name, '|' order by l.position) from public.count_line l
             join public.ingredient i on i.id = l.ingredient_id where l.session_id = pg_temp.sid('d1') and l.position <= 3),
  'Ingrediente critico 01 (demo)|Ingrediente critico 02 (demo)|Ingrediente critico 03 (demo)', 'lines are ordered by name');
select is(pg_temp.res('d1')->>'resumed', 'false', '... resumed is false');
select is((select started_by from public.count_session where id = pg_temp.sid('d1')), 'c1000000-0000-4000-8000-00000000000c'::uuid,
  '... started by the chef');
select is(pg_temp.run('d1b', 'chef', $$ select public.count_start('daily') $$), 'ok', 'starting daily again succeeds');
select is(pg_temp.sid('d1b'), pg_temp.sid('d1'), '... with the same session');
select is(pg_temp.res('d1b')->>'resumed', 'true', '... resumed is true');
select is(pg_temp.run('x', 'chef', $$ select public.count_start('monthly') $$), 'P0001 count_open_exists',
  'starting monthly while daily is open is refused');
select is(pg_temp.run('x', 'waiter', $$ select public.count_start('daily') $$), '42501 permission denied: stock changes need owner, admin or chef',
  'the waiter is refused');

-- AT2: 20 items, 15 equal and 5 different --------------------------------------------------------------
select is(pg_temp.rec('r1', 'chef', pg_temp.sid('d1'), (select jsonb_agg(pg_temp.ln('c' || lpad(g::text, 2, '0'),
    case g when 3 then 4.5 when 7 then 5.25 when 11 then 0 when 15 then 6 when 19 then 4.9 else 5 end) order by g)
    from generate_series(1, 20) g)), 'ok', 'the chef saves 20 lines');
select is(jsonb_array_length(pg_temp.res('r1')->'lines'), 20, '... and gets 20 entries back');
select is((select (e->>'expectedQty')::numeric from jsonb_array_elements(pg_temp.res('r1')->'lines') e
            where e->>'ingredientId' = pg_temp.id('c03')::text), 5::numeric, '... expected is the location total (5)');
select is((select (e->>'differenceQty')::numeric from jsonb_array_elements(pg_temp.res('r1')->'lines') e
            where e->>'ingredientId' = pg_temp.id('c03')::text), -0.5, '... difference is counted - expected');
select is(pg_temp.count_rows(pg_temp.sid('d1')), 0::bigint, 'nothing is posted before the close');
select is(pg_temp.run('cl1', 'chef', format($f$ select public.count_close(%L) $f$, pg_temp.sid('d1'))), 'ok', 'the chef closes the count');
select is(pg_temp.count_rows(pg_temp.sid('d1')), 5::bigint, 'AT2: 5 count rows');
select is((select count(distinct ingredient_id)::int from public.stock_movement where ref_id = pg_temp.sid('d1')), 5,
  '... for exactly 5 ingredients');
select is((select count(*)::int from public.stock_movement m where m.type = 'count'
             and m.ingredient_id in (select pg_temp.id('c' || lpad(g::text, 2, '0')) from generate_series(1, 20) g
                                     where g not in (3, 7, 11, 15, 19))), 0, '... and none for the other 15');
select is((select count(*)::int from public.count_line l
            where l.session_id = pg_temp.sid('d1')
              and (select coalesce(sum(m.qty), 0) from public.stock_movement m
                    where m.ref_id = l.session_id and m.ingredient_id = l.ingredient_id) <> l.counted_qty - l.expected_qty), 0,
  '... each line''s rows sum to counted - expected');
select is((select unit_cost from public.stock_movement where ref_id = pg_temp.sid('d1') limit 1), 10.0000, '... at the cost basis in force (10)');
select is((select status from public.count_session where id = pg_temp.sid('d1')), 'closed', 'the session is closed');
select is((select closed_by from public.count_session where id = pg_temp.sid('d1')), 'c1000000-0000-4000-8000-00000000000c'::uuid,
  '... by the chef');
select is((select after->>'lines_with_difference' from public.audit_event where action = 'count_session.closed'
            and entity_id = pg_temp.sid('d1')), '5', 'one audit event with lines_with_difference 5');
select is((select after->>'lines_counted' || '/' || (after->>'lines_skipped') from public.audit_event
            where action = 'count_session.closed' and entity_id = pg_temp.sid('d1')), '20/0', '... 20 counted, 0 skipped');
select is(pg_temp.res('cl1')->>'linesWithDifference', '5', 'the answer carries the counters');
select is(jsonb_array_length(pg_temp.res('cl1')->'lines'), 5, '... and the five differences');
select is(pg_temp.on_hand('c03'), 4.5, 'the stock of an item counted 4,5 is 4,5');
select is(pg_temp.on_hand('c11'), 0::numeric, '... and 0 for an item counted 0');
select is(pg_temp.on_hand('c15'), 6::numeric, '... and 6 for an item counted 6');

-- AT3: closing twice ----------------------------------------------------------------------------------------
select is(pg_temp.run('x', 'chef', format($f$ select public.count_close(%L) $f$, pg_temp.sid('d1'))), 'P0001 count_closed',
  'AT3: closing a closed count is refused');
select is(pg_temp.count_rows(pg_temp.sid('d1')), 5::bigint, '... and posts nothing more');
select is(pg_temp.audit_n('count_session.closed'), 1::bigint, '... and writes no second audit row');
select is(pg_temp.rec('x', 'chef', pg_temp.sid('d1'), jsonb_build_array(pg_temp.ln('c01', 1))), 'P0001 count_closed',
  'saving a line of a closed count is refused');
select is(pg_temp.run('x', 'chef', format($f$ select public.count_cancel(%L) $f$, pg_temp.sid('d1'))), 'P0001 count_closed',
  'cancelling a closed count is refused');

-- A count where every line equals the expected quantity: no row, one audit event -----------------------------
select pg_temp.quiet(pg_temp.run('d2', 'chef', $$ select public.count_start('daily') $$));
select pg_temp.quiet(pg_temp.rec('x', 'chef', pg_temp.sid('d2'), (select jsonb_agg(pg_temp.ln('c' || lpad(g::text, 2, '0'), pg_temp.on_hand('c' || lpad(g::text, 2, '0'))) order by g)
  from generate_series(1, 20) g)));
select is(pg_temp.run('cl2', 'chef', format($f$ select public.count_close(%L) $f$, pg_temp.sid('d2'))), 'ok', 'a count with no difference closes');
select is(pg_temp.count_rows(pg_temp.sid('d2')), 0::bigint, '... without a movement');
select is(pg_temp.audit_n('count_session.closed'), 2::bigint, '... and still has its audit event');

-- Errors, clearing, cancel ----------------------------------------------------------------------------------
select pg_temp.quiet(pg_temp.run('d3', 'chef', $$ select public.count_start('daily') $$));
select is(pg_temp.run('x', 'chef', format($f$ select public.count_close(%L) $f$, pg_temp.sid('d3'))), 'P0001 count_empty',
  'no counted line: count_empty');
select is(pg_temp.rec('x', 'chef', pg_temp.sid('d3'), jsonb_build_array(pg_temp.ln('x1', 1))), 'P0002 count_line_not_found',
  'an ingredient that is not a line is P0002');
select is(pg_temp.rec('x', 'chef', pg_temp.sid('d3'), jsonb_build_array(pg_temp.ln('c01', 1), pg_temp.ln('c01', 2))), 'P0001 duplicate_line',
  'the same ingredient twice is refused');
select is(pg_temp.run('x', 'chef', format($f$ select public.count_record_lines(%L, '{"a":1}'::jsonb) $f$, pg_temp.sid('d3'))), '22023 invalid_request',
  'p_lines that is not an array is 22023');
select is(pg_temp.run('x', 'chef', format($f$ select public.count_record_lines(%L, '[]'::jsonb) $f$, pg_temp.sid('d3'))), '22023 invalid_request',
  'an empty array is 22023');
select is(pg_temp.run('x', 'chef', format($f$ select public.count_record_lines(%L, (select jsonb_agg(%L::jsonb) from generate_series(1, 201))) $f$,
    pg_temp.sid('d3'), pg_temp.ln('c01', 1)::text)), '22023 invalid_request', '201 items is 22023');
select is(pg_temp.run('x', 'chef', format($f$ select public.count_record_lines(%L, '[{"ingredient_id":"nope","qty":1,"unit":"kg"}]'::jsonb) $f$,
    pg_temp.sid('d3'))), '22023 invalid_request', 'a malformed ingredient id is 22023');
select is(pg_temp.rec('x', 'chef', pg_temp.sid('d3'), jsonb_build_array(pg_temp.ln('c01', -1))), 'P0001 qty_invalid', 'a negative quantity is refused');
select is(pg_temp.rec('x', 'chef', pg_temp.sid('d3'), jsonb_build_array(pg_temp.ln('c01', 1, 'ml'))), 'P0001 unit_mismatch', 'a wrong unit is refused');
select is(pg_temp.run('x', 'ownerb', format($f$ select public.count_record_lines(%L, %L::jsonb) $f$, pg_temp.sid('d3'),
    jsonb_build_array(pg_temp.ln('c01', 1))::text)), 'P0002 count_not_found', 'tenant B cannot reach tenant A''s session');
select is(pg_temp.run('x', 'ownerb', format($f$ select public.count_close(%L) $f$, pg_temp.sid('d3'))), 'P0002 count_not_found',
  '... nor close it');
select pg_temp.quiet(pg_temp.rec('x', 'chef', pg_temp.sid('d3'), jsonb_build_array(pg_temp.ln('c01', 4))));
select is((select counted_qty from public.count_line where session_id = pg_temp.sid('d3') and ingredient_id = pg_temp.id('c01')), 4::numeric,
  'a line is saved');
select pg_temp.quiet(pg_temp.rec('x', 'chef', pg_temp.sid('d3'), jsonb_build_array(jsonb_build_object('ingredient_id', pg_temp.id('c01'), 'qty', null, 'unit', 'kg'))));
select is((select count(*)::int from public.count_line where session_id = pg_temp.sid('d3') and counted_qty is not null), 0,
  'qty null clears the line');
select is(pg_temp.run('x', 'chef', format($f$ select public.count_close(%L) $f$, pg_temp.sid('d3'))), 'P0001 count_empty', '... and a cleared line cannot be closed');
select is(pg_temp.run('x', 'chef', format($f$ select public.count_cancel(%L) $f$, pg_temp.sid('d3'))), 'ok', 'an open count is cancelled');
select is((select status from public.count_session where id = pg_temp.sid('d3')), 'cancelled', '... status cancelled');
select is(pg_temp.audit_n('count_session.cancelled'), 1::bigint, '... with one audit event');
select is(pg_temp.run('x', 'chef', format($f$ select public.count_close(%L) $f$, pg_temp.sid('d3'))), 'P0001 count_cancelled',
  'AT3: closing a cancelled count is refused');
select is(pg_temp.rec('x', 'chef', pg_temp.sid('d3'), jsonb_build_array(pg_temp.ln('c01', 1))), 'P0001 count_cancelled',
  'saving a line of a cancelled count is refused');
select is(pg_temp.run('x', 'chef', format($f$ select public.count_cancel(%L) $f$, pg_temp.sid('d3'))), 'P0001 count_cancelled',
  'cancelling twice is refused');

-- Snapshot semantics (monthly) ------------------------------------------------------------------------------
select pg_temp.mk('s1', 'Snapshot uno (demo)', 5);
select pg_temp.mk('s2', 'Snapshot due (demo)', 5);
select pg_temp.mk('s3', 'Senza prezzo (demo)', 5, false, null);
select pg_temp.mk('s4', 'Spento con scorta (demo)', 1, false, 10, true, false);
select is(pg_temp.run('m1', 'chef', $$ select public.count_start('monthly') $$), 'ok', 'chef starts a monthly count');
select is((select count(*)::int from public.count_line where session_id = pg_temp.sid('m1')), 25,
  'monthly: every active stock ingredient (24) plus the inactive one that still has stock');
select is((select count(*)::int from public.count_line l where l.session_id = pg_temp.sid('m1') and l.ingredient_id = pg_temp.id('s4')), 1,
  '... the inactive item with stock is a line');
select is((select count(*)::int from public.count_line l where l.session_id = pg_temp.sid('m1') and l.ingredient_id = pg_temp.id('inact')), 0,
  '... the inactive item without stock is not');
select pg_temp.quiet(pg_temp.rec('x', 'chef', pg_temp.sid('m1'), jsonb_build_array(pg_temp.ln('s1', 4.5), pg_temp.ln('s2', 4.5), pg_temp.ln('s3', 4))));
-- a waste of 1 kg of each of s1 and s2 lands after they were entered
select pg_temp.quiet(pg_temp.run('w1', 'chef', format($f$ select public.post_waste(%L, 1, 'kg', 'spoilage') $f$, pg_temp.id('s1'))));
select pg_temp.quiet(pg_temp.run('w2', 'chef', format($f$ select public.post_waste(%L, 1, 'kg', 'spoilage') $f$, pg_temp.id('s2'))));
select pg_temp.quiet(pg_temp.rec('re', 'chef', pg_temp.sid('m1'), jsonb_build_array(pg_temp.ln('s2', 4.5))));
select is((select (e->>'expectedQty')::numeric from jsonb_array_elements(pg_temp.res('re')->'lines') e), 4::numeric,
  'a line re-entered after the waste takes the new expected quantity (4)');
select is(pg_temp.run('clm', 'chef', format($f$ select public.count_close(%L) $f$, pg_temp.sid('m1'))), 'ok', 'the monthly count closes');
select is(pg_temp.counts('s1'), -0.5, 'entered before the waste: the count posts -0,5');
select is(pg_temp.on_hand('s1'), 3.5, '... and the waste still applies on top (3,5)');
select is(pg_temp.counts('s2'), 0.5, 'entered after the waste: the count posts +0,5');
select is(pg_temp.on_hand('s2'), 4.5, '... and the stock is the counted 4,5');
select is((select unit_cost from public.stock_movement where ingredient_id = pg_temp.id('s3') and type = 'count'), null,
  'an ingredient with no purchase price gets a null unit_cost');
select is((select unit_cost from public.stock_movement where ingredient_id = pg_temp.id('s1') and type = 'count'), 10.0000,
  '... and one with a price gets it');
select is(pg_temp.res('clm')->>'linesSkipped', '22', 'uncounted lines are skipped, not changed');

-- Critical flag ------------------------------------------------------------------------------------------
select is(pg_temp.run('k1', 'chef', format($f$ select public.set_ingredient_critical(%L, true) $f$, pg_temp.id('x1'))), 'ok',
  'the chef flags an ingredient critical');
select is(pg_temp.res('k1')->>'changed', 'true', '... changed is true');
select is((select before::text || '>' || after::text from public.audit_event where action = 'ingredient.critical_changed'
            and entity_id = pg_temp.id('x1')), '{"is_critical": false}>{"is_critical": true}', '... one audit event with before and after');
select is(pg_temp.run('k2', 'chef', format($f$ select public.set_ingredient_critical(%L, true) $f$, pg_temp.id('x1'))), 'ok', 'flagging again succeeds');
select is(pg_temp.res('k2')->>'changed', 'false', '... changed is false');
select is(pg_temp.audit_n('ingredient.critical_changed'), 1::bigint, '... and no second audit event');
select is(pg_temp.run('x', 'chef', format($f$ select public.set_ingredient_critical(%L, true) $f$, pg_temp.id('nostock'))),
  'P0001 ingredient_not_stock', 'a non-stock ingredient is refused');
select is(pg_temp.run('x', 'chef', $$ select public.set_ingredient_critical('2a000000-0000-4000-8000-00000000002a', true) $$),
  'P0002 ingredient_not_found', 'tenant B''s ingredient is P0002');

-- Owner and admin may count; the waiter and no one else may not --------------------------------------------
select pg_temp.quiet(pg_temp.run('o1', 'owner', $$ select public.count_start('daily') $$));
select is(pg_temp.run('o1c', 'owner', format($f$ select public.count_cancel(%L) $f$, pg_temp.sid('o1'))), 'ok', 'owner A starts and cancels');
select pg_temp.quiet(pg_temp.run('a1', 'admin', $$ select public.count_start('daily') $$));
select is(pg_temp.rec('a1r', 'admin', pg_temp.sid('a1'), jsonb_build_array(pg_temp.ln('c01', 5))), 'ok', 'admin A saves a line');
select is(pg_temp.run('a1c', 'admin', format($f$ select public.count_close(%L) $f$, pg_temp.sid('a1'))), 'ok', 'admin A closes');
select is((select count(*)::int from (select 1 from public.count_session where started_by = 'a1000000-0000-4000-8000-00000000000a'
   union all select 1 from public.count_session where closed_by = 'ad100000-0000-4000-8000-0000000000ad') x), 2, '... under their own names');
select is(pg_temp.run('x', 'waiter', format($f$ select public.count_close(%L) $f$, pg_temp.sid('a1'))),
  '42501 permission denied: stock changes need owner, admin or chef', 'the waiter cannot close');
select is(pg_temp.rec('x', 'waiter', pg_temp.sid('a1'), jsonb_build_array(pg_temp.ln('c01', 5))),
  '42501 permission denied: stock changes need owner, admin or chef', '... nor save lines');
select is(pg_temp.run('x', 'waiter', format($f$ select public.count_cancel(%L) $f$, pg_temp.sid('a1'))),
  '42501 permission denied: stock changes need owner, admin or chef', '... nor cancel');
select is(pg_temp.run('x', 'waiter', format($f$ select public.set_ingredient_critical(%L, true) $f$, pg_temp.id('c01'))),
  '42501 permission denied: stock changes need owner, admin or chef', '... nor flag');

-- One transaction ----------------------------------------------------------------------------------------
create function pg_temp.fail_close_audit() returns trigger language plpgsql as $$
begin
  if new.action = 'count_session.closed' then
    raise exception 'audit_down' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger zz_fail_close_audit before insert on public.audit_event
  for each row execute function pg_temp.fail_close_audit();
select pg_temp.quiet(pg_temp.run('t1', 'chef', $$ select public.count_start('daily') $$));
select pg_temp.quiet(pg_temp.rec('x', 'chef', pg_temp.sid('t1'), jsonb_build_array(pg_temp.ln('c01', 3))));
select is(pg_temp.run('x', 'chef', format($f$ select public.count_close(%L) $f$, pg_temp.sid('t1'))), 'P0001 audit_down',
  'a failing audit insert fails the close');
select is(pg_temp.count_rows(pg_temp.sid('t1')), 0::bigint, '... no count row remains');
select is((select status from public.count_session where id = pg_temp.sid('t1')), 'open', '... and the session is still open');
drop trigger zz_fail_close_audit on public.audit_event;

-- Grants ---------------------------------------------------------------------------------------------------
select is((select count(*)::int
             from (values ('public.count_start(text, uuid)'), ('public.count_record_lines(uuid, jsonb)'),
                          ('public.count_close(uuid)'), ('public.count_cancel(uuid)'),
                          ('public.set_ingredient_critical(uuid, boolean)')) f (sig)
             cross join (values ('anon'), ('service_role')) r (rolname)
            where has_function_privilege(r.rolname, f.sig, 'execute')), 0, 'anon and service_role cannot execute the five');
select is((select count(*)::int
             from (values ('public.count_start(text, uuid)'), ('public.count_record_lines(uuid, jsonb)'),
                          ('public.count_close(uuid)'), ('public.count_cancel(uuid)'),
                          ('public.set_ingredient_critical(uuid, boolean)')) f (sig)
            where has_function_privilege('authenticated', f.sig, 'execute')), 5, 'authenticated can');

select * from finish();
rollback;
