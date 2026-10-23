-- M13 step 4: the count reads count_sessions, count_session_view, count_variance and count_variance_costs
-- (M13 plan §3.1.8, §3.2, §5 step 4; V6). Sessions are built through the real procedures under claims; the
-- checks run as the migration owner. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(64);

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
-- Two invoices that wait for approval (review, received) and one already approved.
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e1000000-0000-4000-8000-0000000000e1.pdf',
   'application/pdf', 2048, 'review', '5a000000-0000-4000-8000-00000000005a'),
  ('e3000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e3000000-0000-4000-8000-0000000000e3.pdf',
   'application/pdf', 2048, 'received', null);
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status) values
  ('e4000000-0000-4000-8000-0000000000e4', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/e4000000-0000-4000-8000-0000000000e4.pdf',
   'application/pdf', 2048, 'rejected');

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

create function pg_temp.bad_keys(j jsonb) returns boolean language sql as $$
  select j::text ~* '"[^"]*(cost|price|eur|value|amount|margin)[^"]*"\s*:'
$$;
-- Moves a session to a chosen start (the guard forbids it, so it is switched off for the statement).
create function pg_temp.start_at(p_session uuid, p_at timestamptz) returns void language plpgsql as $$
begin
  alter table public.count_session disable trigger count_session_guard;
  update public.count_session set started_at = p_at where id = p_session;
  alter table public.count_session enable trigger count_session_guard;
end
$$;

-- Fixture: stock with a purchase price, one without, a gain, two never counted ---------------------------------
select pg_temp.mk('beef', 'Manzo muscolo (demo)', 5, true);
select pg_temp.mk('sale', 'Sale grosso (demo)', 5, false, null);
select pg_temp.mk('farina', 'Farina di mais (demo)', 5);
select pg_temp.mk('olio', 'Olio EVO (demo)', 5);
select pg_temp.mk('uova', 'Uova (demo)', 5);
select pg_temp.mk('burro', 'Burro (demo)', 5);

-- S0 cancelled (chef), S1 monthly closed (owner), S2 daily open (chef), three days apart.
select pg_temp.quiet(pg_temp.run('s0', 'chef', $$ select public.count_start('daily') $$));
select pg_temp.quiet(pg_temp.run('x', 'chef', format($f$ select public.count_cancel(%L) $f$, pg_temp.sid('s0'))));
select pg_temp.start_at(pg_temp.sid('s0'), '2026-10-20T08:00Z');
select pg_temp.quiet(pg_temp.run('s1', 'owner', $$ select public.count_start('monthly') $$));
select pg_temp.quiet(pg_temp.rec('x', 'owner', pg_temp.sid('s1'), jsonb_build_array(
  pg_temp.ln('beef', 4.5), pg_temp.ln('sale', 5.5), pg_temp.ln('farina', 5), pg_temp.ln('olio', 6))));
select pg_temp.quiet(pg_temp.run('cl1', 'owner', format($f$ select public.count_close(%L) $f$, pg_temp.sid('s1'))));
select pg_temp.start_at(pg_temp.sid('s1'), '2026-10-21T08:00Z');
select pg_temp.quiet(pg_temp.run('s2', 'chef', $$ select public.count_start('daily') $$));
select pg_temp.start_at(pg_temp.sid('s2'), '2026-10-22T08:00Z');
select pg_temp.quiet(pg_temp.rec('x', 'chef', pg_temp.sid('s2'), jsonb_build_array(pg_temp.ln('beef', 3))));

-- Sessions ----------------------------------------------------------------------------------------------
select is(pg_temp.run('l1', 'chef', $$ select public.count_sessions() $$), 'ok', 'the chef lists sessions');
select is((select string_agg(e->>'type' || ':' || (e->>'status'), ',' order by ord) from jsonb_array_elements(pg_temp.res('l1')->'sessions') with ordinality x (e, ord)),
  'daily:open,monthly:closed,daily:cancelled', 'newest first');
select is(pg_temp.res('l1')->'nextCursor', 'null'::jsonb, '... no cursor when everything fits');
select is(pg_temp.run('l2', 'chef', $$ select public.count_sessions('all', null, null, 2) $$), 'ok', 'a page of 2');
select is(jsonb_array_length(pg_temp.res('l2')->'sessions'), 2, '... has 2 sessions');
select is(pg_temp.run('l3', 'chef', format($f$ select public.count_sessions('all', %L, %L, 2) $f$,
    pg_temp.res('l2')->'nextCursor'->>'at', pg_temp.res('l2')->'nextCursor'->>'id')), 'ok', 'the next page');
select is((pg_temp.res('l3')->'sessions'->0->>'id')::uuid, pg_temp.sid('s0'), '... continues without a gap or a repeat');
select is(pg_temp.res('l3')->'nextCursor', 'null'::jsonb, '... and ends');
select is(jsonb_array_length((select j->'sessions' from results where k = 'l1')), 3, 'three sessions in all');
select is(pg_temp.run('l4', 'chef', $$ select public.count_sessions('closed') $$), 'ok', 'filter by status');
select is(jsonb_array_length(pg_temp.res('l4')->'sessions'), 1, '... one closed session');
select is(pg_temp.run('x', 'chef', $$ select public.count_sessions('all', null, null, 0) $$), '22023 invalid_request', 'limit 0 is invalid');
select is(pg_temp.run('x', 'chef', $$ select public.count_sessions('all', null, null, 101) $$), '22023 invalid_request', 'limit 101 is invalid');
select is(pg_temp.run('x', 'chef', $$ select public.count_sessions('weekly') $$), '22023 invalid_request', 'an unknown status is invalid');
select is(pg_temp.run('x', 'chef', $$ select public.count_sessions('all', now(), null, 5) $$), '22023 invalid_request', 'half a cursor is invalid');
select is(pg_temp.res('l1')->'sessions'->1->'startedBy', '{"me": false, "name": null}'::jsonb, 'the chef sees no name on the owner''s session');
select is(pg_temp.res('l1')->'sessions'->0->'startedBy', '{"me": true, "name": "Chef Demo"}'::jsonb, '... and their own name on theirs');
select is(pg_temp.res('l1')->'sessions'->1->'closedBy', '{"me": false, "name": null}'::jsonb, '... nor on the closer');
select pg_temp.quiet(pg_temp.run('lo', 'owner', $$ select public.count_sessions() $$));
select is(pg_temp.res('lo')->'sessions'->1->'startedBy'->>'name', 'Titolare Demo', 'the owner sees names');
select is(pg_temp.res('lo')->'sessions'->1->>'linesTotal', '6', 'linesTotal');
select is(pg_temp.res('lo')->'sessions'->1->>'linesCounted' || '/' || (pg_temp.res('lo')->'sessions'->1->>'linesWithDifference'), '4/3',
  '... linesCounted and linesWithDifference match the fixture');
select is(pg_temp.res('lo')->'sessions'->1->'location'->>'name', 'Cella (demo)', 'the location name');
select is(pg_temp.run('x', 'waiter', $$ select public.count_sessions() $$), '42501 permission denied: stock needs owner, admin or chef', 'the waiter is refused');
select is(pg_temp.run('lb', 'ownerb', $$ select public.count_sessions() $$), 'ok', 'tenant B lists');
select is(jsonb_array_length(pg_temp.res('lb')->'sessions'), 0, '... none of A''s');

-- View --------------------------------------------------------------------------------------------------
select is(pg_temp.run('v1', 'chef', format($f$ select public.count_session_view(%L) $f$, pg_temp.sid('s2'))), 'ok', 'the chef reads the open session');
select is(pg_temp.res('v1')->>'invoicesAwaitingApproval', '2', 'invoicesAwaitingApproval counts the review and received invoices');
select is(pg_temp.res('v1')->>'today', (select app.venue_date(now(), timezone)::text from public.tenant where name = 'Osteria Demo A'),
  'today is the venue date');
select is(jsonb_array_length(pg_temp.res('v1')->'lines'), 1, 'one line (beef is the only critical ingredient)');
select is(pg_temp.res('v1')->'lines'->0->>'expectedQty', '4.5000', 'the entered line shows its snapshot (taken after the first count)');
select is(pg_temp.res('v1')->'lines'->0->>'countedQty', '3.0000', '... and what was counted');
select is(pg_temp.res('v1')->'lines'->0->>'expectedNowQty', '4.5000', 'expectedNowQty is the total now (the closed count moved it to 4,5)');
select is(pg_temp.run('v2', 'chef', format($f$ select public.count_session_view(%L) $f$, pg_temp.sid('s1'))), 'ok', 'the chef reads the closed session');
select is((select count(*)::int from jsonb_array_elements(pg_temp.res('v2')->'lines') e where e->'expectedQty' = 'null'::jsonb), 2,
  'uncounted lines have a null expectedQty');
select is(pg_temp.run('x', 'ownerb', format($f$ select public.count_session_view(%L) $f$, pg_temp.sid('s1'))), 'P0002 count_not_found', 'tenant B gets P0002');
select is(pg_temp.run('vb', 'ownerb', $$ select public.count_session_view(gen_random_uuid()) $$), 'P0002 count_not_found', 'an unknown id is P0002');
select is(pg_temp.run('x', 'waiter', format($f$ select public.count_session_view(%L) $f$, pg_temp.sid('s1'))),
  '42501 permission denied: stock needs owner, admin or chef', 'the waiter is refused');

-- Variance (quantities) --------------------------------------------------------------------------------------
select is(pg_temp.run('x', 'chef', format($f$ select public.count_variance(%L) $f$, pg_temp.sid('s2'))), 'P0001 count_not_closed', 'an open session has no variance');
select is(pg_temp.run('x', 'chef', format($f$ select public.count_variance(%L) $f$, pg_temp.sid('s0'))), 'P0001 count_not_closed', 'nor a cancelled one');
select is(pg_temp.run('var', 'chef', format($f$ select public.count_variance(%L) $f$, pg_temp.sid('s1'))), 'ok', 'the chef reads the variance of the closed session');
select is(jsonb_array_length(pg_temp.res('var')->'lines'), 4, '... 4 counted lines');
select is(pg_temp.res('var')->>'linesSkipped', '2', '... and 2 skipped');
select is((select count(*)::int from jsonb_array_elements(pg_temp.res('var')->'lines') e
            where (e->>'differenceQty')::numeric = (e->>'postedQty')::numeric), 4, 'differenceQty = postedQty for each line');
select is((select (e->>'differenceQty')::numeric from jsonb_array_elements(pg_temp.res('var')->'lines') e
            where e->>'ingredientId' = pg_temp.id('beef')::text), -0.5, 'beef: -0,5');
select is((select e->>'name' || '/' || (e->>'baseUnit') from jsonb_array_elements(pg_temp.res('var')->'lines') e
            where e->>'ingredientId' = pg_temp.id('beef')::text), 'Manzo muscolo (demo)/kg', '... with its name and unit');
select ok(not pg_temp.bad_keys(pg_temp.res('var')) and not pg_temp.bad_keys(pg_temp.res('v1')) and not pg_temp.bad_keys(pg_temp.res('lo')),
  'no cost-like key in the sessions, the view or the variance');
select is(pg_temp.run('x', 'waiter', format($f$ select public.count_variance(%L) $f$, pg_temp.sid('s1'))),
  '42501 permission denied: stock needs owner, admin or chef', 'the waiter is refused');
select is(pg_temp.run('x', 'ownerb', format($f$ select public.count_variance(%L) $f$, pg_temp.sid('s1'))), 'P0002 count_not_found', 'tenant B gets P0002');

-- Variance in EUR -----------------------------------------------------------------------------------------
select is(pg_temp.run('vc', 'owner', format($f$ select public.count_variance_costs(%L) $f$, pg_temp.sid('s1'))), 'ok', 'the owner reads the variance in EUR');
select is((select (e->>'valueEur')::numeric from jsonb_array_elements(pg_temp.res('vc')->'lines') e
            where e->>'ingredientId' = pg_temp.id('beef')::text), -5.0000, 'beef -0,5 kg at 10 = -5');
select is((select e->'valueEur' from jsonb_array_elements(pg_temp.res('vc')->'lines') e
            where e->>'ingredientId' = pg_temp.id('sale')::text), 'null'::jsonb, 'a row without a cost makes the line value null');
select is((select (e->>'valueEur')::numeric from jsonb_array_elements(pg_temp.res('vc')->'lines') e
            where e->>'ingredientId' = pg_temp.id('olio')::text), 10.0000, 'olio +1 kg at 10 = +10');
select is((select (e->>'valueEur')::numeric from jsonb_array_elements(pg_temp.res('vc')->'lines') e
            where e->>'ingredientId' = pg_temp.id('farina')::text), 0::numeric, 'a line with no difference is worth 0');
select is(pg_temp.res('vc')->>'lossEur', '-5.0000', 'lossEur');
select is(pg_temp.res('vc')->>'gainEur', '10.0000', 'gainEur');
select is(pg_temp.res('vc')->>'valueEur', '5.0000', 'net valueEur');
select is(pg_temp.res('vc')->>'unvaluedCount', '1', 'unvaluedCount');
select is(pg_temp.run('vca', 'admin', format($f$ select public.count_variance_costs(%L) $f$, pg_temp.sid('s1'))), 'ok', 'admin may read it');
select is(pg_temp.run('x', 'chef', format($f$ select public.count_variance_costs(%L) $f$, pg_temp.sid('s1'))),
  '42501 permission denied: costs need owner or admin', 'the chef is refused');
select is(pg_temp.run('x', 'waiter', format($f$ select public.count_variance_costs(%L) $f$, pg_temp.sid('s1'))),
  '42501 permission denied: costs need owner or admin', 'the waiter is refused');
select is(pg_temp.run('x', 'owner', format($f$ select public.count_variance_costs(%L) $f$, pg_temp.sid('s2'))), 'P0001 count_not_closed', 'an open session has no EUR variance');
select is(pg_temp.run('x', 'ownerb', format($f$ select public.count_variance_costs(%L) $f$, pg_temp.sid('s1'))), 'P0002 count_not_found', 'tenant B gets P0002');
select is((select count(*)::int
             from (values ('public.count_sessions(text, timestamptz, uuid, integer)'), ('public.count_session_view(uuid)'),
                          ('public.count_variance(uuid)'), ('public.count_variance_costs(uuid)')) f (sig)
             cross join (values ('anon'), ('service_role')) r (rolname)
            where has_function_privilege(r.rolname, f.sig, 'execute')), 0, 'anon and service_role cannot execute the four');
select is((select count(*)::int
             from (values ('public.count_sessions(text, timestamptz, uuid, integer)'), ('public.count_session_view(uuid)'),
                          ('public.count_variance(uuid)'), ('public.count_variance_costs(uuid)')) f (sig)
            where has_function_privilege('authenticated', f.sig, 'execute')), 4, 'authenticated can');

select * from finish();
rollback;
